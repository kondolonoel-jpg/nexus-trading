#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NEXUS Command — Backend
=======================
Backend Flask qui alimente le dashboard NEXUS avec :
  1. Authentification   : création de compte + connexion par mot de passe (SQLite + token signé).
  2. News temps réel    : agrégation multi-sources (RSS) mise à jour en continu.
  3. Analyse IA marchés : régime journalier + hebdomadaire avec raisons (technique + fondamental + news).

Endpoints :
  POST /api/register | /api/login | GET /api/whoami -> comptes (non utilisés par l'interface)
  GET  /api/news                -> flux d'actualités en temps réel
  GET  /api/analysis            -> analyse IA des marchés (régime D1/W1 + raisons)
  GET  /api/analysis/<symbol>   -> analyse d'un marché précis
  GET  /api/markets             -> liste des marchés suivis
  GET  /api/macro/cot|banks|regimes|verdicts|status -> Macro Intelligence (voir macro.py)
  GET  /api/health              -> état du serveur
"""

import os
import re
import json
import time
import hmac
import sqlite3
import hashlib
import secrets
import threading
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import requests
from flask import Flask, jsonify, request, send_from_directory

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# NEXUS_STATIC permet de servir la version React compilée : NEXUS_STATIC=react-version/static
STATIC_DIR = os.path.join(BASE_DIR, os.environ.get("NEXUS_STATIC", "static"))
# NEXUS_DATA_DIR : dossier des données persistantes (comptes, clé, cache macro) ; à pointer vers un disque Render si besoin
DATA_DIR = os.environ.get("NEXUS_DATA_DIR") or os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "nexus.db")
# Clé de signature des tokens (régénérée si absente)
SECRET_PATH = os.path.join(DATA_DIR, ".secret_key")

TOKEN_TTL_SECONDS = 7 * 24 * 3600  # 7 jours
NEWS_REFRESH_SECONDS = 180          # rafraîchissement des news toutes les 3 min
ANALYSIS_REFRESH_SECONDS = 900      # rafraîchissement de l'analyse toutes les 15 min

app = Flask(__name__, static_folder=STATIC_DIR)
try:
    from flask_compress import Compress
    Compress(app)
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Utilitaires crypto / token
# ---------------------------------------------------------------------------
def _load_secret():
    # NEXUS_SECRET (variable d'environnement) : clé stable même si le disque est effacé à chaque redémarrage
    if os.environ.get("NEXUS_SECRET"):
        return os.environ["NEXUS_SECRET"].strip()
    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH, "r") as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(SECRET_PATH, "w") as f:
        f.write(key)
    return key


SECRET = _load_secret()


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000
    ).hex()


def sign_token(payload: dict) -> str:
    """Token simple : payload base64 + signature HMAC + expiration."""
    import base64
    payload = dict(payload)
    payload["exp"] = int(time.time()) + TOKEN_TTL_SECONDS
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    b64 = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    sig = hmac.new(SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"


def verify_token(token: str):
    import base64
    try:
        b64, sig = token.split(".")
    except Exception:
        return None
    expected = hmac.new(SECRET.encode(), b64.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    pad = "=" * (-len(b64) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(b64 + pad))
    except Exception:
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return payload


def current_user():
    """Récupère l'utilisateur à partir du header Authorization ou ?token=."""
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
    elif request.args.get("token"):
        token = request.args.get("token")
    if not token:
        return None
    payload = verify_token(token)
    if not payload:
        return None
    return payload.get("user")


# ---------------------------------------------------------------------------
# Base de données (SQLite)
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Authentification
# ---------------------------------------------------------------------------
USERNAME_RE = re.compile(r"^[\w .\-]{3,32}$", re.UNICODE)  # lettres (avec accents), chiffres, espace, _ . -


@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip()

    if not USERNAME_RE.match(username):
        return jsonify(ok=False, error="Nom d'utilisateur invalide (3 à 32 caractères : lettres, chiffres, _ . -)."), 400
    if len(password) < 6:
        return jsonify(ok=False, error="Le mot de passe doit contenir au moins 6 caractères."), 400

    salt = secrets.token_hex(16)
    pw_hash = hash_password(password, salt)
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, email, salt, password_hash, created_at) VALUES (?,?,?,?,?)",
            (username, email, salt, pw_hash, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify(ok=False, error="Ce nom d'utilisateur existe déjà."), 409
    conn.close()

    token = sign_token({"user": username})
    return jsonify(ok=True, token=token, user=username)


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    conn = get_db()
    row = conn.execute(
        "SELECT username, salt, password_hash FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()

    if not row:
        return jsonify(ok=False, error="Identifiants incorrects."), 401
    if hash_password(password, row["salt"]) != row["password_hash"]:
        return jsonify(ok=False, error="Identifiants incorrects."), 401

    token = sign_token({"user": username})
    return jsonify(ok=True, token=token, user=username)


@app.route("/api/whoami", methods=["GET"])
def api_whoami():
    user = current_user()
    if not user:
        return jsonify(ok=False, error="Non authentifié."), 401
    return jsonify(ok=True, user=user)


# ---------------------------------------------------------------------------
# NEWS TEMPS RÉEL — agrégation multi-sources
# ---------------------------------------------------------------------------
NEWS_SOURCES = [
    # (nom, catégorie, URL flux RSS)
    ("Investing.com", "Macro", "https://www.investing.com/rss/news_25.rss"),
    ("Investing.com Forex", "Forex", "https://www.investing.com/rss/news_301.rss"),
    ("ForexLive", "Forex", "https://www.forexlive.com/feed/"),
    ("OilPrice", "Énergie", "https://oilprice.com/rss/main"),
    ("CryptoPotato", "Crypto", "https://cryptopotato.com/feed/"),
]

_news_cache = {"items": [], "updated_at": None, "fetching": False}
_news_lock = threading.Lock()

_HIGH_IMPACT_RE = re.compile(
    r"\b(fomc|fed\b|federal reserve|nfp|non-?farm|payrolls|cpi\b|ppi\b|inflation|"
    r"gdp|pib|rate (hike|cut|decision)|interest rate|boe\b|ecb\b|boj\b|powell|"
    r"lagarde|earnings|chomage|unemployment|retail sales|pmi\b|ism\b|opec|opep)",
    re.IGNORECASE,
)


def _parse_rss(xml_bytes, source_name, category):
    """Parse un flux RSS/Atom et renvoie une liste d'items normalisés."""
    items = []
    try:
        root = ET.fromstring(xml_bytes)
    except Exception:
        return items

    ns_atom = "{http://www.w3.org/2005/Atom}"

    def clean(txt):
        if not txt:
            return ""
        txt = re.sub(r"<[^>]+>", " ", txt)
        txt = re.sub(r"\s+", " ", txt)
        return txt.strip()

    # RSS 2.0
    for item in root.iter("item"):
        title = clean(item.findtext("title"))
        link = (item.findtext("link") or "").strip()
        desc = clean(item.findtext("description"))[:260]
        pub = item.findtext("pubDate")
        ts = _parse_date(pub)
        if title:
            items.append(_make_item(title, link, desc, ts, source_name, category))

    # Atom
    for entry in root.iter(f"{ns_atom}entry"):
        title = clean(entry.findtext(f"{ns_atom}title"))
        link_el = entry.find(f"{ns_atom}link")
        link = link_el.get("href") if link_el is not None else ""
        desc = clean(entry.findtext(f"{ns_atom}summary") or entry.findtext(f"{ns_atom}content"))[:260]
        pub = entry.findtext(f"{ns_atom}updated") or entry.findtext(f"{ns_atom}published")
        ts = _parse_date(pub)
        if title:
            items.append(_make_item(title, link, desc, ts, source_name, category))

    return items


def _parse_date(pub):
    if not pub:
        return int(time.time())
    try:
        dt = parsedate_to_datetime(pub)
        return int(dt.timestamp())
    except Exception:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            dt = datetime.strptime(pub.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        except Exception:
            continue
    return int(time.time())


def _make_item(title, link, desc, ts, source_name, category):
    impact = "high" if _HIGH_IMPACT_RE.search(title + " " + desc) else "normal"
    return {
        "id": hashlib.sha1((title + link).encode("utf-8")).hexdigest()[:16],
        "title": title,
        "link": link,
        "summary": desc,
        "timestamp": ts,
        "time_iso": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(),
        "source": source_name,
        "category": category,
        "impact": impact,
    }


def _fetch_all_news():
    """Récupère tous les flux, déduplique et trie du plus récent au plus ancien."""
    all_items = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/125 Safari/537.36"
    }
    for name, category, url in NEWS_SOURCES:
        try:
            resp = requests.get(url, headers=headers, timeout=12)
            if resp.status_code == 200:
                all_items.extend(_parse_rss(resp.content, name, category))
        except Exception:
            continue

    # Déduplication par id + tri décroissant
    seen = set()
    unique = []
    for it in sorted(all_items, key=lambda x: x["timestamp"], reverse=True):
        if it["id"] in seen:
            continue
        seen.add(it["id"])
        unique.append(it)

    with _news_lock:
        _news_cache["items"] = unique[:120]
        _news_cache["updated_at"] = int(time.time())
        _news_cache["fetching"] = False


def _news_loop():
    while True:
        with _news_lock:
            _news_cache["fetching"] = True
        try:
            _fetch_all_news()
        except Exception:
            with _news_lock:
                _news_cache["fetching"] = False
        time.sleep(NEWS_REFRESH_SECONDS)


@app.route("/api/news", methods=["GET"])
def api_news():
    limit = int(request.args.get("limit", 40))
    category = request.args.get("category", "").strip()
    impact = request.args.get("impact", "").strip()

    with _news_lock:
        items = list(_news_cache["items"])
        updated = _news_cache["updated_at"]
        fetching = _news_cache["fetching"]

    if category:
        items = [i for i in items if i["category"].lower() == category.lower()]
    if impact:
        items = [i for i in items if i["impact"] == impact]

    return jsonify(
        ok=True,
        items=items[:limit],
        total=len(items),
        updated_at=updated,
        fetching=fetching,
        refresh_interval=NEWS_REFRESH_SECONDS,
    )


# ---------------------------------------------------------------------------
# CALENDRIER ÉCONOMIQUE (ForexFactory — flux JSON hebdomadaire)
# ---------------------------------------------------------------------------
FF_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
CALENDAR_REFRESH_SECONDS = 1800  # 30 min

_calendar_cache = {"events": [], "updated_at": None, "fetching": False}
_calendar_lock = threading.Lock()

# Devise d'un événement -> marchés concernés
_CCY_MARKETS = {
    "USD": ["DXY", "XAUUSD", "XAGUSD", "US30", "US100", "US500", "BTCUSD"],
    "GBP": ["GBPUSD"],
    "JPY": ["USDJPY"],
    "EUR": ["EURUSD"],
    "AUD": ["AUDUSD"],
    "CAD": ["USDCAD", "USOIL"],
    "NZD": [],
    "CHF": [],
    "CNY": ["XAUUSD"],
    "All": ["USOIL", "US500"],
}


def _fetch_calendar():
    try:
        resp = requests.get(
            FF_CALENDAR_URL,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
            timeout=15,
        )
        raw = resp.json()
    except Exception:
        with _calendar_lock:
            _calendar_cache["fetching"] = False
        return

    now = time.time()
    events = []
    for e in raw:
        try:
            ts = datetime.fromisoformat(e["date"]).timestamp()
        except Exception:
            continue
        impact = (e.get("impact") or "").strip()
        if impact in ("Holiday", "", "Non-Economic"):
            continue
        events.append({
            "title": e.get("title", ""),
            "country": e.get("country", ""),
            "timestamp": int(ts),
            "impact": impact,  # High / Medium / Low
            "forecast": e.get("forecast", ""),
            "previous": e.get("previous", ""),
            "past": ts < now,
        })
    events.sort(key=lambda x: x["timestamp"])
    with _calendar_lock:
        _calendar_cache["events"] = events
        _calendar_cache["updated_at"] = int(time.time())
        _calendar_cache["fetching"] = False


def _calendar_loop():
    while True:
        with _calendar_lock:
            _calendar_cache["fetching"] = True
        try:
            _fetch_calendar()
        except Exception:
            with _calendar_lock:
                _calendar_cache["fetching"] = False
        time.sleep(CALENDAR_REFRESH_SECONDS)


@app.route("/api/calendar", methods=["GET"])
def api_calendar():
    impact = request.args.get("impact", "").strip().capitalize()
    country = request.args.get("country", "").strip().upper()
    upcoming_only = request.args.get("upcoming", "") in ("1", "true", "yes")
    limit = int(request.args.get("limit", 60))
    with _calendar_lock:
        events = list(_calendar_cache["events"])
        updated = _calendar_cache["updated_at"]
    if impact:
        events = [e for e in events if e["impact"] == impact]
    if country:
        events = [e for e in events if e["country"] == country]
    if upcoming_only:
        events = [e for e in events if not e["past"]]
    return jsonify(ok=True, events=events[:limit], total=len(events), updated_at=updated)


def _calendar_events_for(market_key, max_items=3):
    """Événements de la semaine liés à un marché (High/Medium), récents d'abord."""
    target_markets = None
    for ccy, mkts in _CCY_MARKETS.items():
        if market_key in mkts:
            target_markets = mkts
            break
    with _calendar_lock:
        events = list(_calendar_cache["events"])
    if target_markets is None:
        return []
    ccys = [c for c, mkts in _CCY_MARKETS.items() if market_key in mkts]
    matched = [
        e for e in events
        if e["country"] in ccys and e["impact"] in ("High", "Medium")
    ]
    # OPEC / pétrole : rajout explicite pour USOIL
    if market_key == "USOIL":
        matched += [e for e in events if re.search(r"opec|crude|oil", e["title"], re.I)]
    # Dédoublonne + priorité High puis proximité temporelle
    seen, out = set(), []
    for e in sorted(matched, key=lambda x: (x["impact"] != "High", abs(x["timestamp"] - time.time()))):
        k = (e["title"], e["timestamp"])
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
        if len(out) >= max_items:
            break
    return out


# ---------------------------------------------------------------------------
# ANALYSE IA DES MARCHÉS
# ---------------------------------------------------------------------------
# Symboles Yahoo Finance
MARKETS = {
    "XAUUSD": {"yahoo": "GC=F",    "name": "Or (Gold)",            "group": "Métaux"},
    "XAGUSD": {"yahoo": "SI=F",    "name": "Argent (Silver)",      "group": "Métaux"},
    "GBPUSD": {"yahoo": "GBPUSD=X", "name": "GBP/USD",             "group": "Forex"},
    "EURUSD": {"yahoo": "EURUSD=X", "name": "EUR/USD",             "group": "Forex"},
    "USDJPY": {"yahoo": "USDJPY=X", "name": "USD/JPY",             "group": "Forex"},
    "AUDUSD": {"yahoo": "AUDUSD=X", "name": "AUD/USD",             "group": "Forex"},
    "USDCAD": {"yahoo": "USDCAD=X", "name": "USD/CAD",             "group": "Forex"},
    "DXY":    {"yahoo": "DX-Y.NYB", "name": "Dollar Index (DXY)",  "group": "Forex"},
    "US30":   {"yahoo": "^DJI",     "name": "US30 (Dow Jones)",    "group": "Indices"},
    "US100":  {"yahoo": "^NDX",     "name": "US100 (Nasdaq)",      "group": "Indices"},
    "US500":  {"yahoo": "^GSPC",    "name": "US500 (S&P 500)",     "group": "Indices"},
    "USOIL":  {"yahoo": "CL=F",     "name": "Pétrole WTI",         "group": "Énergie"},
    "BTCUSD": {"yahoo": "BTC-USD",  "name": "Bitcoin (BTC/USD)",   "group": "Crypto"},
}

# Indices synthétiques Deriv (analyse technique D1/W1 uniquement, via l'API WebSocket publique de Deriv).
_DERIV_LIST = [
    ("VOL10", "R_10", "Volatility 10", "Volatility"), ("VOL25", "R_25", "Volatility 25", "Volatility"),
    ("VOL50", "R_50", "Volatility 50", "Volatility"), ("VOL75", "R_75", "Volatility 75", "Volatility"),
    ("VOL100", "R_100", "Volatility 100", "Volatility"),
    ("VOL10S", "1HZ10V", "Volatility 10 (1s)", "Volatility"), ("VOL25S", "1HZ25V", "Volatility 25 (1s)", "Volatility"),
    ("VOL50S", "1HZ50V", "Volatility 50 (1s)", "Volatility"), ("VOL75S", "1HZ75V", "Volatility 75 (1s)", "Volatility"),
    ("VOL100S", "1HZ100V", "Volatility 100 (1s)", "Volatility"),
    ("BOOM300", "BOOM300N", "Boom 300", "Boom & Crash"), ("BOOM500", "BOOM500", "Boom 500", "Boom & Crash"),
    ("BOOM1000", "BOOM1000", "Boom 1000", "Boom & Crash"), ("CRASH300", "CRASH300N", "Crash 300", "Boom & Crash"),
    ("CRASH500", "CRASH500", "Crash 500", "Boom & Crash"), ("CRASH1000", "CRASH1000", "Crash 1000", "Boom & Crash"),
    ("STEP", "stpRNG", "Step Index", "Step"),
    ("JUMP10", "JD10", "Jump 10", "Jump"), ("JUMP25", "JD25", "Jump 25", "Jump"), ("JUMP50", "JD50", "Jump 50", "Jump"),
    ("JUMP75", "JD75", "Jump 75", "Jump"), ("JUMP100", "JD100", "Jump 100", "Jump"),
]
for _k, _sym, _name, _fam in _DERIV_LIST:
    MARKETS[_k] = {"deriv": _sym, "name": _name, "group": "Synthétiques", "family": _fam}

DERIV_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=" + os.environ.get("DERIV_APP_ID", "1089")
_deriv_data = {}


def _deriv_fetch_many(symbols):
    """Bougies D1 (800 jours) pour plusieurs symboles Deriv sur UNE seule connexion WebSocket."""
    out = {}
    try:
        import websocket
        ws = websocket.create_connection(DERIV_WS_URL, timeout=15)
    except Exception:
        return out
    try:
        for i, sym in enumerate(symbols, 1):
            try:
                ws.send(json.dumps({"ticks_history": sym, "adjust_start_time": 1, "count": 800, "end": "latest",
                                    "start": 1, "style": "candles", "granularity": 86400, "req_id": i}))
                for _ in range(4):                       # ignore les messages parasites
                    resp = json.loads(ws.recv())
                    if resp.get("req_id") == i or "candles" in resp or "error" in resp:
                        break
                cs = resp.get("candles") or []
                if len(cs) >= 30 and not resp.get("error"):
                    out[sym] = cs
            except Exception:
                continue
    finally:
        try:
            ws.close()
        except Exception:
            pass
    return out


def _deriv_prefetch():
    syms = [v["deriv"] for v in MARKETS.values() if v.get("deriv")]
    got = _deriv_fetch_many(syms)
    if got:
        _deriv_data.update(got)
    return len(got)


def _deriv_rows(sym):
    cs = _deriv_data.get(sym) or []
    return [{"t": int(c.get("epoch", 0)), "close": float(c["close"]), "high": float(c["high"]), "low": float(c["low"])}
            for c in cs]


def _deriv_history(key):
    """Historique D1 d'un indice synthétique (pour la calibration)."""
    sym = MARKETS[key]["deriv"]
    if sym not in _deriv_data:
        _deriv_data.update(_deriv_fetch_many([sym]))
    return _deriv_rows(sym)


def _deriv_ping():
    import websocket
    t0 = time.time()
    ws = websocket.create_connection(DERIV_WS_URL, timeout=10)
    try:
        ws.send(json.dumps({"ping": 1}))
        resp = json.loads(ws.recv())
    finally:
        ws.close()
    return "ping %s en %d ms" % (resp.get("ping", "?"), (time.time() - t0) * 1000)


def _resample_weekly(rows):
    """D1 -> W1 par blocs de 7 bougies (les synthétiques cotent 24 h/24, 7 j/7)."""
    out = []
    for i in range(len(rows) % 7, len(rows) - 6, 7):
        blk = rows[i:i + 7]
        out.append({"close": blk[-1]["close"], "high": max(r["high"] for r in blk), "low": min(r["low"] for r in blk)})
    return out

_analysis_cache = {"data": {}, "updated_at": None, "fetching": False}
_analysis_lock = threading.Lock()
_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125 Safari/537.36"
}


def _yf_history(symbol, interval, range_):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}".format(sym=symbol)
    params = {"interval": interval, "range": range_}
    try:
        resp = requests.get(url, params=params, headers=_YF_HEADERS, timeout=15)
        data = resp.json()
        result = data["chart"]["result"][0]
        q = result["indicators"]["quote"][0]
        closes = q.get("close", [])
        highs = q.get("high", [])
        lows = q.get("low", [])
        # Nettoie les valeurs nulles
        rows = []
        for i in range(len(closes)):
            if closes[i] is not None:
                rows.append({
                    "close": closes[i],
                    "high": highs[i] if highs[i] is not None else closes[i],
                    "low": lows[i] if lows[i] is not None else closes[i],
                })
        meta = result.get("meta", {})
        return rows, meta
    except Exception:
        return [], {}


def _ema(values, period):
    if not values:
        return []
    k = 2 / (period + 1)
    ema_vals = [values[0]]
    for v in values[1:]:
        ema_vals.append(v * k + ema_vals[-1] * (1 - k))
    return ema_vals


def _rsi(values, period=14):
    if len(values) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(values)):
        diff = values[i] - values[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _macd(values):
    if len(values) < 26:
        return None, None, None
    ema12 = _ema(values, 12)
    ema26 = _ema(values, 26)
    macd_line = [a - b for a, b in zip(ema12, ema26)]
    signal = _ema(macd_line, 9)
    hist = macd_line[-1] - signal[-1]
    return macd_line[-1], signal[-1], hist


def _adx(highs, lows, closes, period=14):
    """ADX avec lissage de Wilder (valeur stable et représentative)."""
    n = len(closes)
    if n < period * 2 + 5:
        return None
    trs = [0.0] * n
    pdm = [0.0] * n
    mdm = [0.0] * n
    for i in range(1, n):
        trs[i] = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        up = highs[i] - highs[i - 1]
        dn = lows[i - 1] - lows[i]
        pdm[i] = up if (up > dn and up > 0) else 0.0
        mdm[i] = dn if (dn > up and dn > 0) else 0.0
    # Lissage de Wilder
    str_ = sum(trs[1:period + 1])
    sp = sum(pdm[1:period + 1])
    sm = sum(mdm[1:period + 1])
    dxs = []
    for i in range(period + 1, n):
        str_ = str_ - str_ / period + trs[i]
        sp = sp - sp / period + pdm[i]
        sm = sm - sm / period + mdm[i]
        pdi = 100 * sp / str_ if str_ > 0 else 0
        mdi = 100 * sm / str_ if str_ > 0 else 0
        dx = 100 * abs(pdi - mdi) / (pdi + mdi) if (pdi + mdi) > 0 else 0
        dxs.append(dx)
    if len(dxs) < period:
        return None
    adx = sum(dxs[:period]) / period
    for v in dxs[period:]:
        adx = (adx * (period - 1) + v) / period
    return adx


def _classify_regime(closes, highs, lows):
    """Détermine le régime (tendance) + les raisons techniques."""
    if len(closes) < 30:
        return {"regime": "INDETERMINÉ", "strength": 0, "reasons": ["Pas assez de données."]}

    price = closes[-1]
    ema20 = _ema(closes, 20)[-1]
    ema50 = _ema(closes, 50)[-1] if len(closes) >= 50 else ema20
    rsi = _rsi(closes) or 50
    macd_line, signal, hist = _macd(closes)
    adx = _adx(highs, lows, closes)
    if adx is None:
        adx = 0.0

    score = 0
    reasons = []

    # Structure EMA
    if price > ema20 > ema50:
        score += 2
        reasons.append("Prix au-dessus des EMA 20 et 50, elles-mêmes haussières (structure alignée à l'achat).")
    elif price < ema20 < ema50:
        score -= 2
        reasons.append("Prix sous les EMA 20 et 50, elles-mêmes baissières (structure alignée à la vente).")
    else:
        reasons.append("EMA 20/50 entremêlées, sans direction nette des moyennes mobiles.")

    # RSI
    if rsi >= 60:
        score += 1
        reasons.append(f"RSI à {rsi:.0f} : momentum haussier affirmé.")
    elif rsi <= 40:
        score -= 1
        reasons.append(f"RSI à {rsi:.0f} : momentum baissier affirmé.")
    else:
        reasons.append(f"RSI neutre à {rsi:.0f}.")

    # MACD
    if hist is not None:
        if hist > 0 and macd_line > signal:
            score += 1
            reasons.append("Histogramme MACD positif, momentum acheteur.")
        elif hist < 0 and macd_line < signal:
            score -= 1
            reasons.append("Histogramme MACD négatif, momentum vendeur.")

    # ADX / force de tendance
    if adx >= 25:
        reasons.append(f"ADX à {adx:.0f} : tendance établie et puissante.")
    elif adx >= 18:
        reasons.append(f"ADX à {adx:.0f} : tendance modérée.")
    else:
        reasons.append(f"ADX faible à {adx:.0f} : marché en range / sans tendance.")

    # Plus hauts / plus bas récents
    lookback = min(20, len(closes))
    recent_high = max(highs[-lookback:])
    recent_low = min(lows[-lookback:])
    if price >= recent_high * 0.995:
        score += 1
        reasons.append("Prix proche des plus hauts récents (pression acheteuse).")
    elif price <= recent_low * 1.005:
        score -= 1
        reasons.append("Prix proche des plus bas récents (pression vendeuse).")

    # Régime final
    if score >= 3:
        regime = "HAUSSIER FORT"
    elif score >= 1:
        regime = "HAUSSIER"
    elif score <= -3:
        regime = "BAISSIER FORT"
    elif score <= -1:
        regime = "BAISSIER"
    else:
        regime = "RANGE / NEUTRE"

    return {
        "regime": regime,
        "score": score,
        "strength": min(100, int(abs(score) / 5 * 100)),
        "reasons": reasons,
        "price": price,
        "rsi": round(rsi, 1),
        "adx": round(adx, 1),
        "ema20": ema20,
        "ema50": ema50,
    }


def _news_context_for(market_key, market_name):
    """Récupère les news récentes pertinentes pour ce marché (mots-clés avec limites de mot)."""
    patterns = {
        "XAUUSD": r"\bgold\b|\bxau\b|bullion|precious metal",
        "GBPUSD": r"\bgbp\b|sterling|\bpound\b|\bboe\b|bank of england|britain|\buk\b",
        "DXY":    r"\bdxy\b|\bdollar\b|\bfed\b|federal reserve|powell|fomc",
        "US30":   r"\bdow\b|us30|wall street",
        "USDJPY": r"\byen\b|\bjpy\b|\bboj\b|bank of japan|\bjapan\b",
        "EURUSD": r"\beuro\b|\beur\b|\becb\b|lagarde|eurozone",
        "US100":  r"nasdaq|us100",
        "BTCUSD": r"bitcoin|\bbtc\b|crypto|ethereum",
    }
    pat = re.compile(patterns.get(market_key, ""), re.IGNORECASE)
    with _news_lock:
        items = list(_news_cache["items"])
    matched = []
    for it in items:
        text = it["title"] + " " + it["summary"]
        if pat.search(text):
            matched.append({"title": it["title"], "source": it["source"], "impact": it["impact"]})
        if len(matched) >= 3:
            break
    return matched


def _key_levels(highs, lows, closes, k=2, lookback=60):
    """Support / résistance via pivots fractals sur les dernières bougies."""
    n = len(closes)
    if n < k * 2 + 5:
        return None, None
    start = max(k, n - lookback)
    ph, pl = [], []
    for i in range(start, n - k):
        if highs[i] == max(highs[i - k:i + k + 1]):
            ph.append(highs[i])
        if lows[i] == min(lows[i - k:i + k + 1]):
            pl.append(lows[i])
    price = closes[-1]
    above = [p for p in ph if p > price]
    below = [p for p in pl if p < price]
    resistance = min(above) if above else (max(ph) if ph else None)
    support = max(below) if below else (min(pl) if pl else None)
    return support, resistance


def _pct_change(closes, bars):
    if len(closes) <= bars:
        return None
    old = closes[-1 - bars]
    if not old:
        return None
    return round((closes[-1] / old - 1) * 100, 2)


def _fmt_event(e):
    dt = datetime.fromtimestamp(e["timestamp"], tz=timezone.utc)
    jour = dt.strftime("%a %d/%m %H:%M UTC")
    if e["past"]:
        return f"📅 {e['title']} ({e['country']}, impact {e['impact']}) publié {jour}" + \
               (f" — prévision {e['forecast']}, précédent {e['previous']}" if e["forecast"] and e["previous"] else "")
    return f"📅 À venir : {e['title']} ({e['country']}, impact {e['impact']}) prévu {jour}" + \
           (f" — prévision {e['forecast']}" if e["forecast"] else "")


def _analyze_market(key):
    cfg = MARKETS[key]
    if cfg.get("deriv"):
        rows = [{"close": r["close"], "high": r["high"], "low": r["low"]} for r in _deriv_rows(cfg["deriv"])]
        if len(rows) < 30:
            raise RuntimeError("Données Deriv indisponibles")
        daily = rows[-130:]
        weekly = _resample_weekly(rows)
        meta = {"regularMarketPrice": rows[-1]["close"], "currency": ""}
    else:
        daily, meta = _yf_history(cfg["yahoo"], "1d", "6mo")
        weekly, _ = _yf_history(cfg["yahoo"], "1wk", "2y")

    daily_closes = [r["close"] for r in daily]
    daily_highs = [r["high"] for r in daily]
    daily_lows = [r["low"] for r in daily]
    weekly_closes = [r["close"] for r in weekly]
    weekly_highs = [r["high"] for r in weekly]
    weekly_lows = [r["low"] for r in weekly]

    daily_regime = _classify_regime(daily_closes, daily_highs, daily_lows)
    weekly_regime = _classify_regime(weekly_closes, weekly_highs, weekly_lows)

    if cfg.get("deriv"):
        news_ctx, cal_events = [], []
    else:
        news_ctx = _news_context_for(key, cfg["name"])
        cal_events = _calendar_events_for(key, max_items=3)

    # Niveaux clés + variations (journalier)
    support, resistance = _key_levels(daily_highs, daily_lows, daily_closes)
    chg5 = _pct_change(daily_closes, 5)
    chg20 = _pct_change(daily_closes, 20)

    # Synthèse globale
    d_score = daily_regime.get("score", 0)
    w_score = weekly_regime.get("score", 0)
    if d_score > 0 and w_score > 0:
        bias = "Alignement haussier journalier + hebdomadaire : préférence acheteuse."
    elif d_score < 0 and w_score < 0:
        bias = "Alignement baissier journalier + hebdomadaire : préférence vendeuse."
    else:
        bias = "Divergence entre journalier et hebdomadaire : prudence, attendre confirmation."

    # Raisons fondamentales : news + calendrier économique
    fund_reasons = []
    if cfg.get("deriv"):
        fund_reasons.append("Indice synthétique Deriv : pas d'actualités ni de calendrier économique applicables — "
                            "analyse purement technique (D1/W1).")
    elif news_ctx:
        high_impact = [n for n in news_ctx if n["impact"] == "high"]
        if high_impact:
            fund_reasons.append(
                "Actualités à fort impact détectées : " + high_impact[0]["title"] +
                " — risque de volatilité accrue."
            )
        else:
            fund_reasons.append("Actualités récentes sans impact majeur immédiat.")
    else:
        fund_reasons.append("Aucune actualité spécifique détectée sur les dernières heures.")
    for e in cal_events:
        fund_reasons.append(_fmt_event(e))

    price = meta.get("regularMarketPrice") or daily_regime.get("price")

    return {
        "symbol": key,
        "name": cfg["name"],
        "group": cfg["group"],
        "price": price,
        "currency": meta.get("currency", "USD"),
        "daily": {
            "regime": daily_regime["regime"],
            "strength": daily_regime.get("strength", 0),
            "rsi": daily_regime.get("rsi"),
            "adx": daily_regime.get("adx"),
            "reasons": daily_regime["reasons"],
        },
        "weekly": {
            "regime": weekly_regime["regime"],
            "strength": weekly_regime.get("strength", 0),
            "rsi": weekly_regime.get("rsi"),
            "adx": weekly_regime.get("adx"),
            "reasons": weekly_regime["reasons"],
        },
        "levels": {"support": support, "resistance": resistance},
        "change": {"d5": chg5, "d20": chg20},
        "events": [
            {"title": e["title"], "country": e["country"], "impact": e["impact"],
             "timestamp": e["timestamp"], "past": e["past"],
             "forecast": e["forecast"], "previous": e["previous"]}
            for e in cal_events
        ],
        "fundamental": fund_reasons,
        "news": news_ctx,
        "bias": bias,
        "disclaimer": "Analyse générée automatiquement à titre informatif. Ceci n'est pas un conseil financier.",
    }


def _refresh_analysis():
    with _analysis_lock:
        _analysis_cache["fetching"] = True
    # S'assurer que le cache de news est alimenté avant de croiser les actualités.
    with _news_lock:
        has_news = bool(_news_cache["items"])
    if not has_news:
        try:
            _fetch_all_news()
        except Exception:
            pass
    # Idem pour le calendrier économique.
    with _calendar_lock:
        has_cal = bool(_calendar_cache["events"])
    if not has_cal:
        try:
            _fetch_calendar()
        except Exception:
            pass
    try:
        _deriv_prefetch()
    except Exception:
        pass
    results = {}
    for key in MARKETS:
        try:
            results[key] = _analyze_market(key)
        except Exception as exc:
            results[key] = {"symbol": key, "error": str(exc)}
    with _analysis_lock:
        _analysis_cache["data"] = results
        _analysis_cache["updated_at"] = int(time.time())
        _analysis_cache["fetching"] = False


def _analysis_loop():
    while True:
        try:
            _refresh_analysis()
        except Exception:
            with _analysis_lock:
                _analysis_cache["fetching"] = False
        time.sleep(ANALYSIS_REFRESH_SECONDS)


@app.route("/api/markets", methods=["GET"])
def api_markets():
    return jsonify(ok=True, markets=[
        {"symbol": k, "name": v["name"], "group": v["group"], "family": v.get("family") or v["group"]}
        for k, v in MARKETS.items()
    ])


@app.route("/api/analysis", methods=["GET"])
def api_analysis():
    with _analysis_lock:
        data = dict(_analysis_cache["data"])
        updated = _analysis_cache["updated_at"]
        fetching = _analysis_cache["fetching"]
    return jsonify(ok=True, analysis=data, updated_at=updated, fetching=fetching,
                   refresh_interval=ANALYSIS_REFRESH_SECONDS)


@app.route("/api/analysis/refresh", methods=["POST"])
def api_analysis_refresh():
    """Force un recalcul immédiat de l'analyse (en arrière-plan)."""
    with _analysis_lock:
        busy = _analysis_cache["fetching"]
    if not busy:
        threading.Thread(target=_refresh_analysis, daemon=True).start()
    return jsonify(ok=True, started=not busy)


@app.route("/api/analysis/<symbol>", methods=["GET"])
def api_analysis_one(symbol):
    symbol = symbol.upper()
    if symbol not in MARKETS:
        return jsonify(ok=False, error="Marché inconnu."), 404
    # Analyse fraîche à la demande
    try:
        result = _analyze_market(symbol)
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 502
    return jsonify(ok=True, analysis=result)


@app.route("/api/health", methods=["GET"])
def api_health():
    with _news_lock:
        news_updated = _news_cache["updated_at"]
        news_count = len(_news_cache["items"])
    with _analysis_lock:
        an_updated = _analysis_cache["updated_at"]
    return jsonify(
        ok=True,
        server_time=int(time.time()),
        news_items=news_count,
        news_updated_at=news_updated,
        analysis_updated_at=an_updated,
    )


# ---------------------------------------------------------------------------
# MACRO INTELLIGENCE (COT, banques, régimes Risk-On, verdict par marché) — voir macro.py
# ---------------------------------------------------------------------------
init_db()

import macro


def _analysis_snapshot():
    with _analysis_lock:
        return dict(_analysis_cache["data"])


macro.init(app, MARKETS, _analysis_snapshot, classify=_classify_regime, deriv_history=_deriv_history,
           deriv_ping=_deriv_ping, data_dir=DATA_DIR, current_user=current_user)


# ---------------------------------------------------------------------------
# Servir le frontend
# ---------------------------------------------------------------------------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path.startswith("api/"):
        return jsonify(ok=False, error="Route inconnue."), 404
    if path and os.path.exists(os.path.join(STATIC_DIR, path)):
        resp = send_from_directory(STATIC_DIR, path)
        # Images : cache longue durée. CSS/JS : revalidation (ETag) pour voir les mises à jour.
        if path.startswith("assets/"):
            resp.headers["Cache-Control"] = "public, max-age=604800"
        return resp
    resp = send_from_directory(STATIC_DIR, "index.html")
    # Pas de cache sur la page principale : les mises à jour du frontend sont visibles immédiatement.
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


# ---------------------------------------------------------------------------
# Démarrage
# ---------------------------------------------------------------------------

# Chargement initial des données en arrière-plan.
# Chaque boucle effectue immédiatement un premier fetch puis se met à jour en continu.
threading.Thread(target=_news_loop, daemon=True).start()
threading.Thread(target=_calendar_loop, daemon=True).start()
threading.Thread(target=_analysis_loop, daemon=True).start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
