# -*- coding: utf-8 -*-
"""
NEXUS TRADING — Macro Intelligence (données 100 % réelles)
===========================================================
Module backend ajouté au dashboard. Aucune donnée simulée : si une source est
injoignable, le champ est renvoyé vide (« n/d ») et l'erreur est visible dans /api/macro/status.

Sources :
  - COT (Commerciaux / Non-commerciaux / Non-reportables) : CFTC, rapport « Legacy futures-only »,
    API Socrata publicreporting.cftc.gov (repli : archive annuelle deacotAAAA.zip sur cftc.gov).
  - Rapports des banques : titres de presse réels (Google News RSS) citant Goldman Sachs, JPMorgan,
    Morgan Stanley, UBS… avec lien source. Le sens (acheteur / neutre / vendeur) et l'objectif sont
    lus automatiquement dans le titre : ce n'est PAS le rapport complet.
  - Régimes de marché / Risk-On : Yahoo Finance (indices, VIX, dollar, devises, rendement US 10 ans)
    + FRED (taux directeurs, rendements 10 ans) sans clé API.
  - Verdict par marché : Macro (32 %) + Fondamental (24 %) + Technique (44 %), calculés sur ces données
    et sur l'analyse technique D1/W1 déjà produite par le serveur.

Endpoints :
  GET /api/macro/cot            GET /api/macro/banks?symbol=XAUUSD
  GET /api/macro/regimes        GET /api/macro/verdicts        GET /api/macro/status
"""
import bisect
import csv
import io
import json
import os
import re
import time
import zipfile
import threading
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import requests
from flask import jsonify, request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/125 Safari/537.36"}
MACRO_REFRESH = 900          # drivers + régimes : 15 min
COT_REFRESH = 6 * 3600       # le COT est hebdomadaire : 6 h suffisent
BANK_TTL = 3 * 3600
FRED_TTL = 6 * 3600
WEIGHTS = {"macro": 32, "fundamental": 24, "technical": 44}

_lock = threading.Lock()
_state = {"cot": {}, "cot_at": None, "cot_source": None,
          "drivers": {}, "drivers_at": None,
          "fred": {}, "regimes": None, "regimes_at": None,
          "banks": {}, "status": {}}
_ctx = {"markets": {}, "analysis": lambda: {}, "classify": None, "deriv_history": None, "deriv_ping": None,
        "data_dir": None, "current_user": lambda: None}
_state.update({"alerts": [], "alert_seq": 0, "side": {}, "pending": {}, "regime_side": None, "regime_pending": None,
               "calib": None, "calib_running": False})


def _post(url, **kw):
    kw.setdefault("timeout", 12)
    return requests.post(url, **kw)


def _get(url, **kw):
    """Point d'entrée HTTP unique (remplaçable dans les tests)."""
    kw.setdefault("headers", UA)
    kw.setdefault("timeout", 20)
    return requests.get(url, **kw)


def _mark(source, ok, err=None, detail=None):
    with _lock:
        _state["status"][source] = {"ok": ok, "at": int(time.time()),
                                    "error": (str(err)[:240] if err else None), "detail": detail}


def _fr(x, d=1, sign=False):
    if x is None:
        return "n/d"
    s = ("{:+,.%df}" if sign else "{:,.%df}") % d
    return s.format(x).replace(",", " ").replace(".", ",").replace("-", "−")


def _clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


# ===========================================================================
# 1. COT — CFTC Legacy futures-only
# ===========================================================================
# clé -> (code CFTC, libellé, inversé pour la paire USD/xxx)
COT_CODES = {
    "XAUUSD": ("088691", "Or COMEX (GC)", False),
    "XAGUSD": ("084691", "Argent COMEX (SI)", False),
    "GBPUSD": ("096742", "Livre sterling CME (6B)", False),
    "EURUSD": ("099741", "Euro FX CME (6E)", False),
    "USDJPY": ("097741", "Yen japonais CME (6J)", True),
    "AUDUSD": ("232741", "Dollar australien CME (6A)", False),
    "USDCAD": ("090741", "Dollar canadien CME (6C)", True),
    "DXY":    ("098662", "US Dollar Index ICE", False),
    "US30":   ("124603", "E-mini Dow ($5) CBOT", False),
    "US100":  ("209742", "E-mini Nasdaq-100 CME", False),
    "US500":  ("13874A", "E-mini S&P 500 CME", False),
    "USOIL":  ("067651", "Pétrole WTI NYMEX", False),
    "BTCUSD": ("133741", "Bitcoin CME (BTC)", False),
}


def _num(x):
    try:
        return int(float(str(x).replace(",", "").strip()))
    except Exception:
        return None


def _cot_socrata(codes, since):
    url = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"
    where = ("cftc_contract_market_code in(%s) AND report_date_as_yyyy_mm_dd >= '%sT00:00:00.000'"
             % (",".join("'%s'" % c for c in codes), since))
    r = _get(url, params={"$where": where, "$order": "report_date_as_yyyy_mm_dd DESC", "$limit": "6000"})
    if r.status_code != 200:
        raise RuntimeError("Socrata HTTP %s" % r.status_code)
    rows = []
    for d in r.json():
        rows.append({
            "code": str(d.get("cftc_contract_market_code", "")).strip(),
            "date": str(d.get("report_date_as_yyyy_mm_dd", ""))[:10],
            "name": d.get("market_and_exchange_names") or d.get("contract_market_name") or "",
            "oi": _num(d.get("open_interest_all")),
            "ncl": _num(d.get("noncomm_positions_long_all")), "ncs": _num(d.get("noncomm_positions_short_all")),
            "cl": _num(d.get("comm_positions_long_all")), "cs": _num(d.get("comm_positions_short_all")),
            "nrl": _num(d.get("nonrept_positions_long_all")), "nrs": _num(d.get("nonrept_positions_short_all")),
        })
    if not rows:
        raise RuntimeError("Socrata : aucune ligne")
    return rows


def _cot_zip(codes, years):
    rows = []
    for y in years:
        r = _get("https://www.cftc.gov/files/dea/history/deacot%d.zip" % y, timeout=60)
        if r.status_code != 200:
            continue
        z = zipfile.ZipFile(io.BytesIO(r.content))
        txt = z.read(z.namelist()[0]).decode("latin-1")
        for d in csv.DictReader(io.StringIO(txt)):
            d = {(k or "").strip().lower(): v for k, v in d.items()}
            code = (d.get("cftc contract market code") or "").strip()
            if code not in codes:
                continue
            rows.append({
                "code": code, "date": (d.get("as of date in form yyyy-mm-dd") or "").strip()[:10],
                "name": (d.get("market and exchange names") or "").strip(),
                "oi": _num(d.get("open interest (all)")),
                "ncl": _num(d.get("noncommercial positions-long (all)")),
                "ncs": _num(d.get("noncommercial positions-short (all)")),
                "cl": _num(d.get("commercial positions-long (all)")),
                "cs": _num(d.get("commercial positions-short (all)")),
                "nrl": _num(d.get("nonreportable positions-long (all)")),
                "nrs": _num(d.get("nonreportable positions-short (all)")),
            })
    if not rows:
        raise RuntimeError("Archive CFTC : aucune ligne")
    return rows


def _pct_rank(values, x):
    n = len(values)
    if n < 8:
        return None
    less = sum(1 for v in values if v < x)
    eq = sum(1 for v in values if v == x)
    return int(round((less + 0.5 * eq) / n * 100))


def _build_cot(rows):
    out = {}
    for key, (code, label, invert) in COT_CODES.items():
        mrows = sorted({r["date"]: r for r in rows if r["code"] == code and r["date"]}.values(),
                       key=lambda r: r["date"])
        mrows = [r for r in mrows if None not in (r["cl"], r["cs"], r["ncl"], r["ncs"])]
        if len(mrows) < 2:
            continue
        last, prev = mrows[-1], mrows[-2]
        win = mrows[-52:]
        net_c = [r["cl"] - r["cs"] for r in win]
        net_n = [r["ncl"] - r["ncs"] for r in win]
        c_now, n_now = last["cl"] - last["cs"], last["ncl"] - last["ncs"]
        c_prev, n_prev = prev["cl"] - prev["cs"], prev["ncl"] - prev["ncs"]
        c_p, n_p = _pct_rank(net_c, c_now), _pct_rank(net_n, n_now)
        score = None
        if c_p is not None and n_p is not None:
            score = _clamp((0.6 * (c_p - 50) + 0.4 * (n_p - 50)) / 50.0, -1, 1) * 100
            if invert:
                score = -score
        flag = None
        if n_p is not None and n_p >= 90:
            flag = "Spéculateurs en position longue extrême (positionnement encombré)."
        elif n_p is not None and n_p <= 10:
            flag = "Spéculateurs en position courte extrême (positionnement encombré)."
        nr_l, nr_s = last.get("nrl"), last.get("nrs")
        out[key] = {
            "symbol": key, "label": label, "code": code, "invert": invert, "date": last["date"],
            "weeks": len(win), "open_interest": last.get("oi"),
            "commercial": {"long": last["cl"], "short": last["cs"], "net": c_now,
                           "chg_week": c_now - c_prev, "pct52": c_p},
            "noncommercial": {"long": last["ncl"], "short": last["ncs"], "net": n_now,
                              "chg_week": n_now - n_prev, "pct52": n_p},
            "nonreportable": {"long": nr_l, "short": nr_s,
                              "net": (nr_l - nr_s) if None not in (nr_l, nr_s) else None},
            "ratio_comm_spec": round(c_now / n_now, 2) if n_now else None,
            "score": None if score is None else round(score, 1),
            "flag": flag,
        }
    return out


def refresh_cot():
    codes = [v[0] for v in COT_CODES.values()]
    since = "%d-%02d-%02d" % (datetime.now(timezone.utc).year - 1, 1, 1)
    rows, source, errs = None, None, []
    for name, fn in (("CFTC Socrata (Legacy futures-only)", lambda: _cot_socrata(codes, since)),
                     ("CFTC archive deacot.zip",
                      lambda: _cot_zip(codes, [datetime.now(timezone.utc).year, datetime.now(timezone.utc).year - 1]))):
        try:
            rows, source = fn(), name
            break
        except Exception as exc:
            errs.append("%s : %s" % (name, exc))
    if rows is None:
        _mark("cot", False, " | ".join(errs))
        return
    data = _build_cot(rows)
    with _lock:
        _state["cot"], _state["cot_at"], _state["cot_source"] = data, int(time.time()), source
    _mark("cot", bool(data), None if data else "Aucun contrat reconnu", {"source": source, "markets": len(data)})


# ===========================================================================
# 2. Rapports des banques — titres de presse réels (Google News RSS)
# ===========================================================================
BANKS = [("Goldman Sachs", r"goldman"), ("JPMorgan", r"jp ?morgan"), ("Morgan Stanley", r"morgan stanley"),
         ("UBS", r"\bubs\b"), ("Citi", r"\bciti(group|bank)?\b"), ("Bank of America", r"bank of america|\bbofa\b"),
         ("ING", r"\bing\b"), ("Commerzbank", r"commerzbank")]
MARKET_TERMS = {   # (mot-clé de recherche, regex de contrôle dans le titre)
    "XAUUSD": ("gold price", r"\bgold\b"), "XAGUSD": ("silver price", r"\bsilver\b"),
    "GBPUSD": ("pound sterling GBP/USD", r"pound|sterling|gbp"), "EURUSD": ("euro EUR/USD", r"\beuro\b|eur/?usd"),
    "USDJPY": ("yen USD/JPY", r"\byen\b|usd/?jpy"), "AUDUSD": ("Australian dollar AUD/USD", r"aussie|australian dollar|aud"),
    "USDCAD": ("Canadian dollar USD/CAD", r"loonie|canadian dollar|cad"), "DXY": ("US dollar DXY", r"dollar|dxy"),
    "US30": ("Dow Jones", r"\bdow\b"), "US100": ("Nasdaq 100", r"nasdaq"),
    "US500": ("S&P 500", r"s&p|s&amp;p"), "USOIL": ("oil price", r"\boil\b|crude|brent|wti"),
    "BTCUSD": ("bitcoin price", r"bitcoin|\bbtc\b"),
}
_BULL = re.compile(r"\b(raises?|lifts?|boosts?|hikes?|upgrades?|bullish|overweight|buy|"
                   r"sees? (?:\w+ )?(?:higher|rally|rise|rising|surge|climb|gains?|upside)|"
                   r"to (?:rise|climb|rally|surge|hit|reach|top|test)|forecasts? (?:higher|rally)|"
                   r"upside|rally|rallies|soar|surge)\b", re.I)
_BEAR = re.compile(r"\b(cuts?|lowers?|slashes|trims?|downgrades?|bearish|underweight|sell|"
                   r"to (?:fall|drop|slide|decline|tumble|weaken)|sees? (?:\w+ )?(?:lower|drop|fall|decline|downside|correction)|"
                   r"downside|slump|selloff|sell-off|pullback|correction|plunge|tumble)\b", re.I)


def _stance(title):
    b, s = len(_BULL.findall(title)), len(_BEAR.findall(title))
    if b > s:
        return "ACHETEUR"
    if s > b:
        return "VENDEUR"
    return "NEUTRE"


def _target(title, price):
    """Objectif chiffré cité dans le titre, retenu seulement s'il est cohérent avec le prix actuel."""
    if not price:
        return None
    for m in re.finditer(r"(?<![\w.])\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(k|K)?(?![\w%])", title):
        try:
            v = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        if m.group(2):
            v *= 1000
        if 0.6 * price <= v <= 1.6 * price:
            return v
    return None


def _gnews(query):
    url = "https://news.google.com/rss/search?q=%s&hl=en-US&gl=US&ceid=US:en" % quote_plus(query)
    r = _get(url, timeout=15)
    if r.status_code != 200:
        raise RuntimeError("Google News HTTP %s" % r.status_code)
    root = ET.fromstring(r.content)
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src = (it.findtext("source") or "").strip()
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3].strip()
        try:
            ts = int(parsedate_to_datetime(it.findtext("pubDate")).timestamp())
        except Exception:
            ts = 0
        items.append({"title": title, "source": src, "link": (it.findtext("link") or "").strip(), "ts": ts})
    return items


def _price_of(symbol):
    try:
        a = _ctx["analysis"]().get(symbol) or {}
        if a.get("price"):
            return float(a["price"])
    except Exception:
        pass
    return None


def _fetch_banks(symbol):
    term, check = MARKET_TERMS.get(symbol, (symbol, symbol.lower()))
    check_re = re.compile(check, re.I)
    price = _price_of(symbol)

    def one(bank):
        name, rx = bank
        try:
            items = _gnews('"%s" %s forecast when:45d' % (name, term))
        except Exception as exc:
            return name, None, str(exc)
        rx = re.compile(rx, re.I)
        items = [i for i in items if rx.search(i["title"]) and check_re.search(i["title"]) and i["ts"]]
        items.sort(key=lambda i: i["ts"], reverse=True)
        return name, (items[0] if items else None), None

    out, errors, missing = [], [], []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for name, it, err in ex.map(one, BANKS):
            if err:
                errors.append("%s: %s" % (name, err))
            elif it is None:
                missing.append(name)
            else:
                out.append({"bank": name, "title": it["title"], "source": it["source"], "link": it["link"],
                            "ts": it["ts"], "stance": _stance(it["title"]), "target": _target(it["title"], price)})
    buy = sum(1 for o in out if o["stance"] == "ACHETEUR")
    sell = sum(1 for o in out if o["stance"] == "VENDEUR")
    if not out:
        label = "AUCUN TITRE RÉCENT"
    elif buy > sell:
        label = "CONSENSUS HAUSSIER (+%d)" % (buy - sell)
    elif sell > buy:
        label = "CONSENSUS BAISSIER (−%d)" % (sell - buy)
    else:
        label = "CONSENSUS PARTAGÉ"
    if errors and not out:
        _mark("banks", False, "; ".join(errors[:3]))
    else:
        _mark("banks", True, None, {"symbol": symbol, "banks": len(out)})
    return {"symbol": symbol, "items": out, "missing": missing, "buy": buy, "sell": sell,
            "neutral": len(out) - buy - sell, "label": label,
            "score": round((buy - sell) / len(out) * 100, 1) if out else None}


def banks_supported(symbol):
    return symbol in MARKET_TERMS and not (_ctx["markets"].get(symbol) or {}).get("deriv")


def banks_for(symbol, force=False):
    now = time.time()
    with _lock:
        c = _state["banks"].get(symbol)
    if c and not force and now - c["at"] < BANK_TTL:
        return c["data"]
    data = _fetch_banks(symbol)
    with _lock:
        _state["banks"][symbol] = {"at": now, "data": data}
    return data


# ===========================================================================
# 3. Drivers de marché, régimes & Risk-On (Yahoo Finance + FRED)
# ===========================================================================
YF = {"SPX": "^GSPC", "VIX": "^VIX", "TNX": "^TNX", "DXY": "DX-Y.NYB", "STOXX": "^STOXX50E",
      "N225": "^N225", "HSI": "^HSI", "USDJPY": "USDJPY=X", "EURUSD": "EURUSD=X", "USDCNY": "CNY=X",
      "GOLD": "GC=F", "COPPER": "HG=F", "OIL": "CL=F", "BTC": "BTC-USD"}


def _yf_closes(symbol):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}".format(sym=symbol)
    r = _get(url, params={"interval": "1d", "range": "6mo"}, timeout=15)
    res = r.json()["chart"]["result"][0]
    closes = [c for c in res["indicators"]["quote"][0]["close"] if c is not None]
    if len(closes) < 25:
        raise RuntimeError("série trop courte")
    return closes


def _drv(closes):
    sma50 = sum(closes[-50:]) / min(50, len(closes))
    return {"last": closes[-1], "p20": (closes[-1] / closes[-21] - 1) * 100,
            "d20": closes[-1] - closes[-21], "sma50": sma50, "above50": closes[-1] > sma50}


def _fred_last(series):
    now = time.time()
    with _lock:
        c = _state["fred"].get(series)
    if c and now - c["at"] < FRED_TTL:
        return c["v"]
    val = None
    try:
        start = "%d-01-01" % (datetime.now(timezone.utc).year - 2)
        r = _get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": series, "cosd": start}, timeout=20)
        if r.status_code == 200:
            rows = list(csv.reader(io.StringIO(r.text)))[1:]
            for row in reversed(rows):
                if len(row) >= 2 and row[1] not in (".", ""):
                    val = (float(row[1]), row[0])
                    break
    except Exception:
        val = None
    with _lock:
        _state["fred"][series] = {"at": now, "v": val}
    return val


def refresh_macro():
    drivers, errs = {}, []

    def one(item):
        k, sym = item
        try:
            return k, _drv(_yf_closes(sym)), None
        except Exception as exc:
            return k, None, "%s: %s" % (sym, exc)

    with ThreadPoolExecutor(max_workers=6) as ex:
        for k, d, e in ex.map(one, YF.items()):
            if d:
                drivers[k] = d
            else:
                errs.append(e)
    if not drivers:
        _mark("yahoo", False, "; ".join(errs[:3]))
        return
    _mark("yahoo", True, "; ".join(errs[:4]) or None, {"series": len(drivers), "missing": len(errs)})
    with _lock:
        _state["drivers"], _state["drivers_at"] = drivers, int(time.time())
    fred = {}
    for sid in ("DFEDTARL", "DFEDTARU", "ECBDFR", "IRSTCB01JPM156N", "IRLTLT01DEM156N",
                "IRLTLT01JPM156N", "IRSTCI01CNM156N", "IRLTLT01CNM156N"):
        fred[sid] = _fred_last(sid)
    _mark("fred", any(fred.values()), None if any(fred.values()) else "Aucune série FRED lue",
          {"ok": [k for k, v in fred.items() if v], "ko": [k for k, v in fred.items() if not v]})
    regimes = _compute_regimes(drivers, fred)
    with _lock:
        _state["regimes"], _state["regimes_at"] = regimes, int(time.time())
    try:
        evaluate_alerts()
    except Exception as exc:
        _mark("alerts", False, exc)
    _persist()


def _rate(v, d=2):
    return None if not v else "%s %%" % _fr(v[0], d)


def _compute_regimes(dr, fred):
    sig = []

    def add(label, cond, detail):
        if cond is not None:
            sig.append({"label": label, "on": bool(cond), "detail": detail})

    g = dr.get
    if g("SPX"):
        add("S&P 500 au-dessus de sa MM50", g("SPX")["above50"], _fr(g("SPX")["p20"], 1, True) + " % sur 20 j")
        add("S&P 500 en hausse sur 20 j", g("SPX")["p20"] > 0, _fr(g("SPX")["p20"], 1, True) + " %")
    if g("VIX"):
        add("VIX sous 20", g("VIX")["last"] < 20, "VIX à " + _fr(g("VIX")["last"], 1))
        add("VIX sous sa MM50", not g("VIX")["above50"], "MM50 à " + _fr(g("VIX")["sma50"], 1))
    if g("DXY"):
        add("Dollar (DXY) en baisse sur 20 j", g("DXY")["p20"] < 0, _fr(g("DXY")["p20"], 1, True) + " %")
    if g("USDJPY"):
        add("Carry : USD/JPY en hausse sur 20 j", g("USDJPY")["p20"] > 0, _fr(g("USDJPY")["p20"], 1, True) + " %")
    if g("COPPER") and g("GOLD"):
        add("Cuivre plus fort que l'or (20 j)", g("COPPER")["p20"] > g("GOLD")["p20"],
            "cuivre %s %% · or %s %%" % (_fr(g("COPPER")["p20"], 1, True), _fr(g("GOLD")["p20"], 1, True)))
    if g("BTC"):
        add("Bitcoin en hausse sur 20 j", g("BTC")["p20"] > 0, _fr(g("BTC")["p20"], 1, True) + " %")
    for k, lab in (("STOXX", "Euro Stoxx 50"), ("N225", "Nikkei 225"), ("HSI", "Hang Seng")):
        if g(k):
            add("%s au-dessus de sa MM50" % lab, g(k)["above50"], _fr(g(k)["p20"], 1, True) + " % sur 20 j")
    n_on = sum(1 for s in sig if s["on"])
    pct = int(round(n_on / len(sig) * 100)) if sig else None
    label = None if pct is None else ("RISK-ON" if pct >= 60 else "RISK-OFF" if pct <= 40 else "MIXTE")

    def region(code, name, idx_key, ccy_key, ccy_label, ccy_sign, y10, policy):
        idx, ccy = g(idx_key), g(ccy_key)
        if not idx:
            return {"code": code, "name": name, "regime": None}
        score = (1 if idx["p20"] > 1.5 else -1 if idx["p20"] < -1.5 else 0) + (1 if idx["above50"] else -1)
        notes = ["Indice %s %% sur 20 j" % _fr(idx["p20"], 1, True),
                 "au-dessus de la MM50" if idx["above50"] else "sous la MM50"]
        if code == "US" and g("VIX"):
            v = g("VIX")["last"]
            score += 1 if v < 16 else -1 if v > 25 else 0
            notes.append("VIX %s (%s)" % (_fr(v, 1), "calme" if v < 16 else "tension" if v > 25 else "normal"))
        regime = "RISK-ON" if score >= 2 else "RISK-OFF" if score <= -2 else "TRANSITOIRE"
        return {"code": code, "name": name, "regime": regime, "pos": int(round((score + 3) / 6 * 100)),
                "rows": [{"k": "Taux directeur", "v": policy[0], "d": policy[1]},
                         {"k": "10Y souverain", "v": y10[0], "d": y10[1]},
                         {"k": ccy_label, "v": None if not ccy else _fr(ccy_sign * ccy["p20"], 2, True) + " %", "d": "20 j"},
                         {"k": "Indice (20 j)", "v": _fr(idx["p20"], 2, True) + " %", "d": None}],
                "summary": " · ".join(notes)}

    def fv(s):
        return fred.get(s)

    us_pol = (None, None)
    lo, hi = fv("DFEDTARL"), fv("DFEDTARU")
    if lo and hi:
        us_pol = ("%s – %s %%" % (_fr(lo[0], 2), _fr(hi[0], 2)), hi[1])
    us_y = (_fr(g("TNX")["last"], 2) + " %", "Yahoo ^TNX") if g("TNX") else (None, None)
    eu = fv("ECBDFR")
    de = fv("IRLTLT01DEM156N")
    jp_p, jp_y = fv("IRSTCB01JPM156N"), fv("IRLTLT01JPM156N")
    cn_p, cn_y = fv("IRSTCI01CNM156N"), fv("IRLTLT01CNM156N")
    regions = [
        region("US", "UNITED STATES", "SPX", "DXY", "USD momentum", 1, us_y, us_pol),
        region("EU", "EURO AREA", "STOXX", "EURUSD", "EUR momentum", 1, (_rate(de), de and de[1]), (_rate(eu) and _rate(eu) + " dépôt", eu and eu[1])),
        region("JP", "JAPAN", "N225", "USDJPY", "JPY momentum", -1, (_rate(jp_y), jp_y and jp_y[1]), (_rate(jp_p), jp_p and jp_p[1])),
        region("CN", "CHINA", "HSI", "USDCNY", "CNY momentum", -1, (_rate(cn_y), cn_y and cn_y[1]), (_rate(cn_p), cn_p and cn_p[1])),
    ]
    return {"global": {"pct": pct, "label": label, "on": n_on, "total": len(sig), "signals": sig}, "regions": regions}


# ===========================================================================
# 4. Verdict par marché : Macro 32 % + Fondamental 24 % + Technique 44 %
# ===========================================================================
# (driver, poids signé : + = hausse du driver favorable au marché)
DRIVERS = {
    "XAUUSD": [("DXY", -.40), ("TNX", -.35), ("VIX", .25)],
    "XAGUSD": [("DXY", -.35), ("TNX", -.25), ("SPX", .20), ("VIX", .20)],
    "GBPUSD": [("DXY", -.60), ("SPX", .20), ("TNX", -.20)],
    "EURUSD": [("DXY", -.65), ("SPX", .15), ("TNX", -.20)],
    "AUDUSD": [("DXY", -.45), ("SPX", .30), ("VIX", -.25)],
    "USDJPY": [("TNX", .50), ("DXY", .30), ("VIX", -.20)],
    "USDCAD": [("DXY", .50), ("OIL", -.50)],
    "DXY":    [("TNX", .45), ("VIX", .25), ("SPX", -.30)],
    "US30":   [("VIX", -.40), ("TNX", -.30), ("DXY", -.30)],
    "US100":  [("VIX", -.40), ("TNX", -.40), ("DXY", -.20)],
    "US500":  [("VIX", -.40), ("TNX", -.30), ("DXY", -.30)],
    "USOIL":  [("DXY", -.40), ("SPX", .35), ("VIX", -.25)],
    "BTCUSD": [("SPX", .40), ("DXY", -.30), ("VIX", -.30)],
}
DRV_NAME = {"DXY": "Dollar (DXY)", "TNX": "Rendement US 10 ans", "VIX": "VIX", "SPX": "S&P 500", "OIL": "Pétrole WTI"}
DRV_SCALE = {"DXY": 2.0, "SPX": 4.0, "OIL": 10.0, "VIX": 25.0, "TNX": 0.30}   # TNX : points de % absolus
REGIME_PTS = {"HAUSSIER FORT": 1.0, "HAUSSIER": 0.5, "RANGE / NEUTRE": 0.0, "BAISSIER": -0.5, "BAISSIER FORT": -1.0}


def _macro_component(symbol, name):
    with _lock:
        dr = dict(_state["drivers"])
    spec = DRIVERS.get(symbol)
    if not spec or not dr:
        return None
    num = den = 0.0
    reasons = []
    for key, w in spec:
        d = dr.get(key)
        if not d:
            continue
        chg = d["d20"] if key == "TNX" else d["p20"]
        sig = _clamp(chg / DRV_SCALE[key])
        num += w * sig
        den += abs(w)
        unit = " pt" if key == "TNX" else " %"
        txt = "%s %s%s sur 20 j" % (DRV_NAME[key], _fr(chg, 2 if key == "TNX" else 1, True), unit)
        if abs(w * sig) < 0.04:
            reasons.append(txt + " → neutre pour %s" % name)
        else:
            reasons.append(txt + " → %s à %s" % ("favorable" if w * sig > 0 else "défavorable", name))
    if not den:
        return None
    return {"score": round(num / den * 100, 1), "reasons": reasons}


def _fund_component(symbol):
    with _lock:
        cot = _state["cot"].get(symbol)
        bk = _state["banks"].get(symbol)
    parts, reasons = [], []
    if cot and cot.get("score") is not None:
        parts.append((0.7, cot["score"]))
        c, n = cot["commercial"], cot["noncommercial"]
        reasons.append("COT (%s) : net commercial %s (percentile 52 sem. %s), net non-commercial %s (percentile %s)%s"
                       % (cot["date"], _fr(c["net"], 0, True), c["pct52"], _fr(n["net"], 0, True), n["pct52"],
                          " — lecture inversée (paire USD/xxx)" if cot["invert"] else ""))
        if cot.get("flag"):
            reasons.append(cot["flag"])
    if bk and time.time() - bk["at"] < 6 * 3600 and bk["data"].get("score") is not None:
        parts.append((0.3, bk["data"]["score"]))
        reasons.append("Titres de banques : %s (%d acheteur / %d vendeur)" %
                       (bk["data"]["label"].lower(), bk["data"]["buy"], bk["data"]["sell"]))
    if not parts:
        return None
    tw = sum(w for w, _ in parts)
    return {"score": round(sum(w * s for w, s in parts) / tw, 1), "reasons": reasons}


def _tech_component(a):
    if not a or a.get("error"):
        return None
    d, w = a.get("daily") or {}, a.get("weekly") or {}
    pd_, pw = REGIME_PTS.get(d.get("regime")), REGIME_PTS.get(w.get("regime"))
    if pd_ is None and pw is None:
        return None
    pd_, pw = pd_ or 0.0, pw or 0.0
    reasons = ["Régime D1 : %s · W1 : %s" % (d.get("regime", "—"), w.get("regime", "—"))]
    reasons += (d.get("reasons") or [])[:2]
    return {"score": round((0.6 * pd_ + 0.4 * pw) * 100, 1), "reasons": reasons}


def compute_verdicts():
    analysis = _ctx["analysis"]() or {}
    out = {}
    for sym, meta in _ctx["markets"].items():
        a = analysis.get(sym)
        comps = {"macro": _macro_component(sym, meta["name"]), "fundamental": _fund_component(sym),
                 "technical": _tech_component(a)}
        avail = {k: v for k, v in comps.items() if v}
        na_text = "Non applicable (indice synthétique)" if meta.get("deriv") else "Donnée indisponible"
        if not avail:
            continue
        tw = sum(WEIGHTS[k] for k in avail)
        total = sum(WEIGHTS[k] * v["score"] for k, v in avail.items()) / tw
        signs = [1 if v["score"] > 10 else -1 if v["score"] < -10 else 0 for v in avail.values()]
        lead = 1 if total > 0 else -1
        agree = sum(1 for s in signs if s == lead)
        strong = len(avail) >= 2          # une seule composante (ex. indice synthétique) : jamais « FORT »
        label = "ACHAT FORT" if total >= 50 and strong else "ACHAT" if total >= 25 else \
                "VENTE FORTE" if total <= -50 and strong else "VENTE" if total <= -25 else "NEUTRE"
        out[sym] = {"symbol": sym, "name": meta["name"], "group": meta["group"], "total": round(total, 1),
                    "label": label, "conviction": int(round(abs(total))), "agree": agree, "of": len(avail),
                    "components": {k: (dict(v, weight=WEIGHTS[k]) if v else {"score": None, "weight": WEIGHTS[k],
                                                                              "reasons": [na_text]})
                                   for k, v in comps.items()}}
    return out


# ===========================================================================
# 5. Alertes (Telegram + flux pour les notifications du navigateur)
# ===========================================================================
ALERT_MAX = 100


def _side(label):
    return "ACHAT" if label.startswith("ACHAT") else "VENTE" if label.startswith("VENTE") else "NEUTRE"


def telegram_configured():
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"))


def _telegram(text):
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not tok or not chat:
        return False
    try:
        r = _post("https://api.telegram.org/bot%s/sendMessage" % tok,
                  json={"chat_id": chat, "text": text, "disable_web_page_preview": True})
        ok = r.status_code == 200
        _mark("telegram", ok, None if ok else "HTTP %s" % r.status_code)
        return ok
    except Exception:
        _mark("telegram", False, "envoi impossible")   # jamais d'URL ni de jeton dans le message
        return False


def push_alert(kind, symbol, title, text, telegram=True):
    with _lock:
        _state["alert_seq"] += 1
        a = {"id": _state["alert_seq"], "ts": int(time.time()), "kind": kind, "symbol": symbol,
             "title": title, "text": text}
        _state["alerts"].append(a)
        del _state["alerts"][:-ALERT_MAX]
    sent = _telegram("%s\n%s" % (title, text)) if telegram else False
    return a, sent


def evaluate_alerts():
    """Bascule de verdict (ACHAT / NEUTRE / VENTE) ou de régime global, confirmée sur 2 cycles consécutifs."""
    for sym, v in compute_verdicts().items():
        side = _side(v["label"])
        prev = _state["side"].get(sym)
        if prev is None or side == prev:
            _state["side"][sym] = side if prev is None else prev
            _state["pending"].pop(sym, None)
            continue
        if _state["pending"].get(sym) == side:
            _state["side"][sym] = side
            _state["pending"].pop(sym, None)
            c = v["components"]
            fm = lambda k: _fr(c[k]["score"], 0, True) if c[k].get("score") is not None else "n/d"
            push_alert("verdict", sym, "NEXUS TRADING · %s : %s → %s" % (v["name"], prev, side),
                       "Verdict %s (score %s). Macro %s · Fondamental %s · Technique %s. Informatif, pas un conseil financier."
                       % (v["label"], _fr(v["total"], 0, True), fm("macro"), fm("fundamental"), fm("technical")))
        else:
            _state["pending"][sym] = side
    with _lock:
        g = ((_state["regimes"] or {}).get("global") or {})
    lab = g.get("label")
    if lab:
        prev = _state["regime_side"]
        if prev is None or lab == prev:
            _state["regime_side"] = lab if prev is None else prev
            _state["regime_pending"] = None
        elif _state["regime_pending"] == lab:
            _state["regime_side"], _state["regime_pending"] = lab, None
            push_alert("regime", "GLOBAL", "NEXUS TRADING · Régime global : %s → %s" % (prev, lab),
                       "Risk-On à %s %% (%s signaux sur %s). Informatif, pas un conseil financier."
                       % (g.get("pct"), g.get("on"), g.get("total")))
        else:
            _state["regime_pending"] = lab


# ===========================================================================
# 6. Calibration : fiabilité historique des composantes (horizon 5 jours)
# ===========================================================================
CAL_HORIZON, CAL_THRESHOLD, CAL_TTL = 5, 25, 24 * 3600


def _yf_full(symbol, range_="2y"):
    url = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}".format(sym=symbol)
    res = _get(url, params={"interval": "1d", "range": range_}, timeout=20).json()["chart"]["result"][0]
    q, ts = res["indicators"]["quote"][0], res["timestamp"]
    out = []
    for i, c in enumerate(q["close"]):
        if c is not None:
            out.append({"t": ts[i], "close": c, "high": q["high"][i] if q["high"][i] is not None else c,
                        "low": q["low"][i] if q["low"][i] is not None else c})
    return out


def _history(sym):
    cfg = _ctx["markets"][sym]
    if cfg.get("deriv"):
        return _ctx["deriv_history"](sym)
    return _yf_full(cfg["yahoo"])


def _macro_at(sym, t, drv):
    spec = DRIVERS.get(sym)
    if not spec:
        return None
    num = den = 0.0
    for key, w in spec:
        d = drv.get(key)
        if not d:
            continue
        i = bisect.bisect_right(d["ts"], t) - 1
        if i < 20:
            continue
        c = d["close"]
        chg = (c[i] - c[i - 20]) if key == "TNX" else (c[i] / c[i - 20] - 1) * 100
        num += w * _clamp(chg / DRV_SCALE[key])
        den += abs(w)
    return None if not den else num / den * 100


def _hit(samples):
    sel = [(s, f) for s, f in samples if abs(s) >= CAL_THRESHOLD and f != 0]
    if len(sel) < 20:
        return None
    hits = sum(1 for s, f in sel if (s > 0) == (f > 0))
    edge = sum((f if s > 0 else -f) for s, f in sel) / len(sel) * 100
    return {"n": len(sel), "hit": round(hits / len(sel) * 100, 1), "edge": round(edge, 3)}


def _agg(lst):
    n = sum(x["n"] for x in lst)
    if n < 50:
        return None
    return {"n": n, "hit": round(sum(x["hit"] * x["n"] for x in lst) / n, 1),
            "edge": round(sum(x["edge"] * x["n"] for x in lst) / n, 3)}


def run_calibration():
    with _lock:
        if _state["calib_running"]:
            return
        _state["calib_running"] = True
    try:
        drv = {}
        for k, sym in YF.items():
            try:
                rows = _yf_full(sym)
                drv[k] = {"ts": [r["t"] for r in rows], "close": [r["close"] for r in rows]}
            except Exception:
                pass
        per = {}
        for sym in _ctx["markets"]:
            try:
                rows = _history(sym)
            except Exception:
                continue
            if len(rows) < 200:
                continue
            cl, hi, lo, ts = ([r[k] for r in rows] for k in ("close", "high", "low", "t"))
            tech, mac, comb = [], [], []
            for t in range(120, len(rows) - CAL_HORIZON, 3):
                fwd = cl[t + CAL_HORIZON] / cl[t] - 1
                pts = REGIME_PTS.get((_ctx["classify"](cl[:t + 1], hi[:t + 1], lo[:t + 1]) or {}).get("regime"))
                m = _macro_at(sym, ts[t], drv)
                if pts is not None:
                    tech.append((pts * 100, fwd))
                if m is not None:
                    mac.append((m, fwd))
                    if pts is not None:
                        comb.append(((WEIGHTS["technical"] * pts * 100 + WEIGHTS["macro"] * m)
                                     / (WEIGHTS["technical"] + WEIGHTS["macro"]), fwd))
            per[sym] = {"technical": _hit(tech), "macro": _hit(mac), "combined": _hit(comb)}
        g = {k: _agg([v[k] for v in per.values() if v.get(k)]) for k in ("technical", "macro", "combined")}
        sug = None
        if g["technical"] and g["macro"]:
            e = {k: max(g[k]["hit"] - 50, 1.0) for k in ("technical", "macro")}
            tot = e["technical"] + e["macro"]
            room = 100 - WEIGHTS["fundamental"]
            sug = {"technical": round(room * e["technical"] / tot), "macro": round(room * e["macro"] / tot),
                   "fundamental": WEIGHTS["fundamental"]}
        with _lock:
            _state["calib"] = {"at": int(time.time()), "per": per, "global": g, "suggest": sug,
                               "horizon": CAL_HORIZON, "threshold": CAL_THRESHOLD, "markets": len(per)}
        _mark("calibration", True, None, {"markets": len(per)})
        _persist()
    except Exception as exc:
        _mark("calibration", False, exc)
    finally:
        with _lock:
            _state["calib_running"] = False


# ===========================================================================
# 7. Persistance disque, limitation d'appels, auto-test des sources
# ===========================================================================
def _cache_path():
    d = _ctx["data_dir"]
    return os.path.join(d, "macro_cache.json") if d else None


def _persist():
    path = _cache_path()
    if not path:
        return
    with _lock:
        snap = {k: _state[k] for k in ("cot", "cot_at", "cot_source", "drivers", "drivers_at", "fred", "regimes",
                                       "regimes_at", "banks", "alerts", "alert_seq", "side", "regime_side", "calib")}
    try:
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(snap, f)
        os.replace(path + ".tmp", path)
    except Exception:
        pass


def _restore():
    path = _cache_path()
    if not path or not os.path.exists(path) or time.time() - os.path.getmtime(path) > 24 * 3600:
        return
    try:
        with open(path, encoding="utf-8") as f:
            snap = json.load(f)
        with _lock:
            _state.update({k: v for k, v in snap.items() if k in _state})
    except Exception:
        pass


RATE_RULES = {"/api/login": (10, 600), "/api/register": (6, 600), "/api/macro/banks": (40, 600),
              "/api/macro/selftest": (6, 600), "/api/macro/calibration": (40, 600), "/api/macro/alerts/test": (5, 600)}
_rl_hits = {}


def _rate_limit_hook():
    rule = RATE_RULES.get(request.path)
    if not rule:
        return None
    ip = (request.headers.get("X-Forwarded-For", "").split(",")[0].strip()) or request.remote_addr or "?"
    key, now, (lim, win) = (request.path, ip), time.time(), rule
    with _lock:
        if len(_rl_hits) > 5000:
            _rl_hits.clear()
        q = [t for t in _rl_hits.get(key, []) if now - t < win]
        if len(q) >= lim:
            _rl_hits[key] = q
            return jsonify(ok=False, error="Trop de requêtes : réessayez dans quelques minutes."), 429
        q.append(now)
        _rl_hits[key] = q
    return None


def _selftest():
    year = datetime.now(timezone.utc).year
    jobs = [
        ("CFTC Socrata (COT)", lambda: "%d lignes" % len(_cot_socrata(["088691"], "%d-01-01" % (year - 1)))),
        ("CFTC archive deacot.zip", lambda: "%d lignes" % len(_cot_zip(["088691"], [year]))),
        ("Yahoo Finance (^GSPC)", lambda: "%d clôtures" % len(_yf_closes("^GSPC"))),
        ("FRED (DGS10)", lambda: "dernière valeur %s" % (_fred_last("DGS10") or ["indisponible"])[0]),
        ("Google News RSS", lambda: "%d titres" % len(_gnews("gold price forecast when:7d"))),
        ("Deriv WebSocket", lambda: _ctx["deriv_ping"]()),
    ]
    if telegram_configured():
        jobs.append(("Telegram (bot)", lambda: _tg_check()))

    def run(job):
        name, fn = job
        t0 = time.time()
        try:
            detail, ok = fn(), True
        except Exception as exc:
            detail, ok = str(exc), False
        return {"name": name, "ok": ok, "detail": str(detail)[:180], "ms": int((time.time() - t0) * 1000)}

    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(run, jobs))
    if not telegram_configured():
        res.append({"name": "Telegram (bot)", "ok": False, "ms": 0,
                    "detail": "non configuré : définir TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID sur le serveur"})
    return res


def _tg_check():
    r = _get("https://api.telegram.org/bot%s/getMe" % os.environ.get("TELEGRAM_BOT_TOKEN"), timeout=10)
    if r.status_code != 200:
        raise RuntimeError("HTTP %s (jeton invalide ?)" % r.status_code)
    return "bot joignable"


# ===========================================================================
# 8. Boucle de fond + routes
# ===========================================================================
def _loop():
    last_cot = 0
    while True:
        try:
            refresh_macro()
        except Exception as exc:
            _mark("yahoo", False, exc)
        if time.time() - last_cot > COT_REFRESH and not (_state["cot_at"] and time.time() - _state["cot_at"] < COT_REFRESH):
            try:
                refresh_cot()
            except Exception as exc:
                _mark("cot", False, exc)
            last_cot = time.time() if _state["cot"] else time.time() - COT_REFRESH + 300
            _persist()
        else:
            last_cot = time.time()
        time.sleep(MACRO_REFRESH)


def init(app, markets, analysis_snapshot, classify=None, deriv_history=None, deriv_ping=None,
         data_dir=None, current_user=None, start_thread=True):
    _ctx.update({"markets": markets, "analysis": analysis_snapshot, "classify": classify,
                 "deriv_history": deriv_history, "deriv_ping": deriv_ping, "data_dir": data_dir,
                 "current_user": current_user or (lambda: None)})
    _restore()
    app.before_request(_rate_limit_hook)

    @app.route("/api/macro/cot", methods=["GET"])
    def api_macro_cot():
        with _lock:
            return jsonify(ok=True, markets=dict(_state["cot"]), updated_at=_state["cot_at"],
                           source=_state["cot_source"], loading=_state["cot_at"] is None)

    @app.route("/api/macro/banks", methods=["GET"])
    def api_macro_banks():
        sym = request.args.get("symbol", "XAUUSD").upper()
        if sym not in markets:
            return jsonify(ok=False, error="Marché inconnu."), 404
        if not banks_supported(sym):
            return jsonify(ok=True, na=True, symbol=sym,
                           message="Non applicable : pas de rapports de banques pour cet instrument.")
        try:
            return jsonify(ok=True, **banks_for(sym, force=request.args.get("force") == "1"))
        except Exception as exc:
            return jsonify(ok=False, error=str(exc)), 502

    @app.route("/api/macro/regimes", methods=["GET"])
    def api_macro_regimes():
        with _lock:
            return jsonify(ok=True, data=_state["regimes"], updated_at=_state["regimes_at"],
                           loading=_state["regimes_at"] is None)

    @app.route("/api/macro/verdicts", methods=["GET"])
    def api_macro_verdicts():
        return jsonify(ok=True, verdicts=compute_verdicts(), weights=WEIGHTS, updated_at=int(time.time()),
                       loading=_state["drivers_at"] is None)

    @app.route("/api/macro/status", methods=["GET"])
    def api_macro_status():
        with _lock:
            return jsonify(ok=True, sources=dict(_state["status"]), cot_updated=_state["cot_at"],
                           macro_updated=_state["drivers_at"], telegram=telegram_configured())

    @app.route("/api/macro/selftest", methods=["GET"])
    def api_macro_selftest():
        return jsonify(ok=True, checks=_selftest())

    @app.route("/api/macro/calibration", methods=["GET"])
    def api_macro_calibration():
        with _lock:
            c, running = _state["calib"], _state["calib_running"]
        stale = not c or time.time() - c["at"] > CAL_TTL
        if stale and not running and _ctx["classify"]:
            threading.Thread(target=run_calibration, daemon=True).start()
            running = True
        if c:
            return jsonify(ok=True, status="ready", refreshing=running and stale, **c)
        return jsonify(ok=True, status="computing")

    @app.route("/api/macro/alerts", methods=["GET"])
    def api_macro_alerts():
        since = request.args.get("since", type=int, default=0)
        with _lock:
            items = [a for a in _state["alerts"] if a["id"] > since]
            latest = _state["alert_seq"]
        return jsonify(ok=True, alerts=items[-30:], latest=latest, telegram=telegram_configured())

    @app.route("/api/macro/alerts/test", methods=["POST"])
    def api_macro_alert_test():
        if _ctx["current_user"] and not _ctx["current_user"]():
            return jsonify(ok=False, error="Connexion requise."), 401
        a, sent = push_alert("test", "TEST", "NEXUS TRADING · Alerte de test",
                             "Si vous lisez ce message, les alertes fonctionnent.")
        return jsonify(ok=True, alert=a, telegram_configured=telegram_configured(), telegram_sent=sent)

    if start_thread:
        threading.Thread(target=_loop, daemon=True).start()
