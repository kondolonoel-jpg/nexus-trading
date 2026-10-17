import { useRef, useState } from 'react'
import { api } from '../api.js'
import { usePoll } from '../hooks.js'
import { MarketSelect, useMarket } from '../markets.jsx'
import { ago, chgmt, fmtPrice } from '../format.js'
import VerdictPanel from './VerdictPanel.jsx'

const regimeClass = (r) => (/HAUSSIER/.test(r) ? 'up' : /BAISSIER/.test(r) ? 'down' : /RANGE|NEUTRE/.test(r) ? 'flat' : 'mix')

function Regime({ label, r }) {
  return (
    <div className="ai-regime">
      <span className="ai-tf">{label}</span>
      <span className={'regime-badge ' + regimeClass(r.regime || '')}>{r.regime || '—'}</span>
      <div className="ai-conf"><span>force</span><span className="ai-conf-bar"><i style={{ width: (r.strength || 0) + '%' }} /></span><span>{r.strength || 0}%</span></div>
    </div>
  )
}

function AnalysisCard({ a, updatedAt }) {
  const dr = a.daily || {}, wr = a.weekly || {}, lv = a.levels || {}, ch = a.change || {}
  return (
    <article className="ai-card">
      <header className="ai-head">
        <div><h3>{a.name}</h3><div className="ai-sym">{a.symbol} · {a.group}</div></div>
        <div className="ai-price">{fmtPrice(a.price)}<small>{a.currency || ''} · MAJ {ago(updatedAt)}</small></div>
      </header>
      <div className="ai-regimes"><Regime label="Régime journalier (D1)" r={dr} /><Regime label="Régime hebdomadaire (W1)" r={wr} /></div>
      <p className="ai-bias"><b>Biais :</b> {a.bias || '—'}</p>
      <ul className="ai-reasons">
        {(dr.reasons || []).map((r, i) => <li className="tech" key={'d' + i}>{r}</li>)}
        {(wr.reasons || []).map((r, i) => <li className="tech" key={'w' + i}>[W1] {r}</li>)}
        {(a.fundamental || []).map((r, i) => <li className="fund" key={'f' + i}>{r}</li>)}
      </ul>
      {lv.support != null || lv.resistance != null ? (
        <div className="ai-levels">
          {lv.support != null ? <span className="lv sup">S <b>{fmtPrice(lv.support)}</b></span> : null}
          {lv.resistance != null ? <span className="lv res">R <b>{fmtPrice(lv.resistance)}</b></span> : null}
        </div>
      ) : null}
      <div className="ai-newsbox">
        <h4>Contexte actualités ({a.symbol})</h4>
        {(a.news || []).length ? a.news.map((n, i) => <p key={i}>«&nbsp;{n.title}&nbsp;» <i>— {n.source}{n.impact === 'high' ? ' · ⚡ impact fort' : ''}</i></p>)
          : <p style={{ color: 'var(--text-faint)' }}>Pas d’actualité spécifique détectée sur les dernières heures.</p>}
      </div>
      <footer className="ai-foot">
        <span>RSI D1 {dr.rsi ?? '—'} · ADX D1 {dr.adx ?? '—'} · {chgmt(ch.d5)} / 5j · {chgmt(ch.d20)} / 20j</span><span>{a.symbol}</span>
      </footer>
    </article>
  )
}

function CalendarRadar() {
  const [ev, setEv] = useState(null)
  usePoll(() => api('/api/calendar?limit=80').then((d) => setEv(d.events || []), () => setEv(false)), 300000)
  let body
  if (ev === null) body = <div className="live-feed-empty">Chargement du calendrier…</div>
  else if (ev === false) body = <div className="live-feed-empty">Calendrier indisponible.</div>
  else {
    const now = Date.now() / 1000
    const hi = ev.filter((e) => e.impact === 'High' || e.impact === 'Medium').sort((a, b) => Math.abs(a.timestamp - now) - Math.abs(b.timestamp - now)).slice(0, 18)
    body = hi.length ? hi.map((e, i) => {
      const d = new Date(e.timestamp * 1000)
      const when = (e.past ? '✔ publié' : '⏳ prévu') + ' · ' + d.toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      const nums = [e.forecast && 'prév. ' + e.forecast, e.previous && 'préc. ' + e.previous].filter(Boolean)
      return (
        <div className={'cal-ev' + (e.past ? ' past' : '')} key={i}>
          <span className="when">{when}</span><span className="ttl">{e.title}</span>
          <span className="meta"><span className={'imp ' + e.impact}>{e.impact}</span><span>{e.country}</span>{nums.length ? <span>{nums.join(' · ')}</span> : null}</span>
        </div>
      )
    }) : <div className="live-feed-empty">Aucun événement High/Medium cette semaine.</div>
  }
  return (
    <article className="card cal-radar" id="calRadar">
      <header className="cal-head"><div><h3>Radar macro de la semaine</h3><p className="card-sub" style={{ margin: '4px 0 0' }}>Calendrier économique ForexFactory : publications et discours à impact High/Medium, croisés avec les marchés suivis.</p></div><span className="external-source">Source · ForexFactory</span></header>
      <div className="cal-list" id="calList">{body}</div>
    </article>
  )
}

export default function AnalysisSection() {
  const { sym, offline } = useMarket()
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const updated = useRef(0)

  const fetchAnalysis = () => api('/api/analysis').then((d) => { updated.current = d.updated_at || updated.current; setData(d); setError(false); return d }, () => { setError(true); return null })
  usePoll(fetchAnalysis, 300000)

  const force = () => {
    setBusy(true)
    setNote('Recalcul demandé… le moteur actualise les régimes (± 15 s).')
    const old = updated.current
    api('/api/analysis/refresh', { method: 'POST' }).catch(() => {})
    let tries = 0
    const poll = setInterval(async () => {
      tries++
      const d = await fetchAnalysis()
      if ((d && d.updated_at > old) || tries >= 20) { clearInterval(poll); setBusy(false); setNote(null) }
    }, 2000)
  }

  const a = data?.analysis?.[sym]
  let grid
  if (error && !data) grid = <div className="ai-loading">Backend injoignable (/api/analysis). Vérifiez que le serveur tourne.</div>
  else if (!data) grid = <div className="ai-loading">Calcul des régimes journalier &amp; hebdomadaire en cours…</div>
  else if (!a || a.error) grid = <div className="ai-loading">Aucune analyse disponible pour {sym} pour le moment (données de marché indisponibles).</div>
  else grid = <AnalysisCard a={a} updatedAt={data.updated_at} />

  return (
    <section className="container reveal" id="analysis" aria-labelledby="analysisTitle">
      <div className="section-head">
        <div>
          <div className="section-index">07 — Analyse IA des marchés</div>
          <h2 id="analysisTitle">Régime journalier &amp; hebdomadaire, avec les raisons</h2>
          <p className="section-desc">Le moteur NEXUS AI croise l’analyse technique (EMA 20/50, RSI, MACD, ADX, structure des plus hauts/plus bas), le calendrier économique, le contexte fondamental et les actualités à fort impact pour qualifier le régime de 35 marchés : 13 marchés classiques (Or, Argent, forex, indices, pétrole, Bitcoin) et 22 indices synthétiques Deriv (Volatility, Boom/Crash, Step, Jump — analyse technique uniquement). Choisissez le marché dans le menu déroulant. Actualisation serveur toutes les 15 minutes.</p>
        </div>
        <p className="section-aside">L’analyse automatique informe le contexte : elle ne remplace ni votre plan de trade ni votre gestion du risque.</p>
      </div>
      <div className="ai-toolbar">
        <p id="aiStatus">
          {note ? <><strong>Recalcul…</strong> <em>{note}</em></>
            : data?.updated_at ? <><strong>Synchronisé</strong> <em>· dernière analyse {ago(data.updated_at)} · prochain calcul automatique dans {Math.round((data.refresh_interval || 900) / 60)} min</em></>
            : <><strong>Initialisation…</strong> <em>le moteur calcule les régimes en cours.</em></>}
        </p>
        <button className="btn btn-small" id="aiRefresh" type="button" disabled={busy} onClick={force}>{busy ? 'Recalcul en cours…' : '↻ Actualiser l’analyse'}</button>
      </div>
      <div className="mk-picker" id="mkPicker">
        <label className="mk-title" htmlFor="mkSelect">Marché</label>
        <MarketSelect id="mkSelect" className="mk-select" />
        {offline ? <span className="mk-note">Serveur injoignable : liste locale affichée, les données ne se chargeront qu’une fois le serveur joignable.</span> : null}
      </div>
      <VerdictPanel />
      <CalendarRadar />
      <div className="ai-grid" id="aiGrid">{grid}</div>
      <div className="ai-legend">
        <span><i style={{ background: 'var(--blue)' }} /> Raison technique</span>
        <span><i style={{ background: 'var(--green)' }} /> Raison fondamentale / news</span>
        <span><i style={{ background: 'var(--gold-dim)' }} /> Synthèse &amp; niveaux</span>
        <span>MAJ serveur : <b id="aiUpdatedAt">{data?.updated_at ? new Date(data.updated_at * 1000).toLocaleString('fr-FR') : '—'}</b></span>
      </div>
    </section>
  )
}
