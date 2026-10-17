import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { usePoll } from '../hooks.js'
import { useMarket } from '../markets.jsx'
import { ago, cls, nf, sg, tone } from '../format.js'

const LINES = [['macro', 'Macro'], ['fundamental', 'Fondamental'], ['technical', 'Technique D1/W1']]

function CalibLine({ calib, sym }) {
  if (!calib) return <p className="vd-cal">Fiabilité historique : calcul en cours sur ~2 ans de données…</p>
  const c = calib.per?.[sym]
  if (!c) return <p className="vd-cal">Fiabilité historique : historique insuffisant pour ce marché.</p>
  const part = (label, x) => {
    if (!x) return <>{label} <small>n/d</small></>
    const weak = x.n < 100
    return <>{label} <b className={weak ? '' : x.hit >= 55 ? 'pos' : x.hit <= 48 ? 'neg' : ''}>{nf(x.hit, 0)} %</b> <small>(n={x.n}{weak ? ' · échantillon faible' : ''})</small></>
  }
  return (
    <p className="vd-cal" title="Part des signaux (score ≥ 25 en valeur absolue) dont le sens a vu juste 5 jours plus tard, sur ~2 ans. Le COT n’est pas inclus (pas d’historique). Le passé ne garantit pas l’avenir.">
      Fiabilité à 5 jours · {part('Technique', c.technical)} · {part('Macro', c.macro)} · {part('Combiné', c.combined)}
    </p>
  )
}

function CalibNote({ calib }) {
  if (!calib) return null
  if (!calib.global) return <p className="mx-note vd-calib" id="vdCalib">Calibration : historique insuffisant pour estimer une pondération.</p>
  const g = calib.global, sug = calib.suggest
  const p = (l, x) => (x ? `${l} ${nf(x.hit, 0)} % (n=${x.n})` : null)
  return (
    <p className="mx-note vd-calib" id="vdCalib">
      <b>Calibration</b> ({calib.markets} marchés, ~2 ans, horizon {calib.horizon} j) : {[p('Technique', g.technical), p('Macro', g.macro), p('Combiné', g.combined)].filter(Boolean).join(' · ')}
      {sug ? ` — pondération suggérée par l’historique : Macro ${sug.macro} · Technique ${sug.technical} (Fondamental ${sug.fundamental} non testable). Poids appliqués : 32 / 24 / 44.` : ''}
      {' '}Un taux proche de 50 % signifie peu d’avantage statistique ; ce n’est pas une garantie.
    </p>
  )
}

export default function VerdictPanel() {
  const { sym } = useMarket()
  const [v, setV] = useState(null)
  const [err, setErr] = useState(false)
  const [calib, setCalib] = useState(null)

  usePoll(() => api('/api/macro/verdicts', { auth: false }).then((d) => { setV(d); setErr(false) }, () => setErr(true)), 300000)
  // premier calcul serveur : nouvel essai rapide tant que les données ne sont pas prêtes
  useEffect(() => {
    if (!v?.loading) return undefined
    const id = setTimeout(() => api('/api/macro/verdicts', { auth: false }).then(setV).catch(() => {}), 10000)
    return () => clearTimeout(id)
  }, [v])
  // calibration : le serveur la calcule en arrière-plan (jusqu'à ~7 min), on réessaie toutes les 15 s
  useEffect(() => {
    let alive = true, tries = 0, timer
    const go = () => api('/api/macro/calibration', { auth: false }).then((d) => {
      if (!alive) return
      if (d.status === 'ready') setCalib(d)
      else if (tries++ < 30) timer = setTimeout(go, 15000)
    }).catch(() => {})
    go()
    return () => { alive = false; clearTimeout(timer) }
  }, [])

  const x = v?.verdicts?.[sym]
  let body
  if (err && !v) body = <div className="ai-loading">Serveur injoignable (/api/macro/verdicts). Ouvrez le site via le serveur NEXUS.</div>
  else if (!x) body = <div className="ai-loading">{v?.loading ? 'Le serveur récupère les données de marché…' : `Aucun verdict disponible pour ${sym} pour le moment (données de marché insuffisantes).`}</div>
  else {
    body = (
      <div className="vd-card">
        <div className="vd-top">
          <div><h4>{x.name}</h4><small>{x.symbol} · {x.group} · {x.agree}/{x.of} composantes alignées</small></div>
          <div style={{ textAlign: 'right' }}><div className={'vd-score ' + cls(x.total)}>{sg(x.total, 0)}</div><span className={'mx-badge ' + tone(x.label)} style={{ marginTop: 6 }}>{x.label}</span></div>
        </div>
        {LINES.map(([k, label]) => {
          const c = x.components[k] || {}
          return (
            <div className="vd-line" key={k}>
              <div className="vd-lab">{label}<small>poids {c.weight} %</small></div>
              <div className="vd-bar">{c.score == null ? null : <i className={c.score >= 0 ? 'p' : 'n'} style={{ width: Math.min(50, Math.abs(c.score) / 2) + '%' }} />}</div>
              <div className={'vd-val ' + cls(c.score)}>{c.score == null ? 'n/a' : sg(c.score, 0)}</div>
            </div>
          )
        })}
        <CalibLine calib={calib} sym={x.symbol} />
        <details open><summary>Raisons</summary>
          <ul>{LINES.map(([k, label]) => <li key={k}><b>{label} :</b> {(x.components[k]?.reasons || []).join(' · ')}</li>)}</ul>
        </details>
      </div>
    )
  }
  return (
    <article className="card vd-panel" id="verdictPanel">
      <header className="cal-head">
        <div><h3>Verdict par marché</h3><p className="card-sub" style={{ margin: '4px 0 0' }}>Synthèse pondérée : Macro 32 % · Fondamental 24 % · Technique D1/W1 44 %. Chaque barre va de −100 (vendeur) à +100 (acheteur) et se calcule sur des données réelles ; ouvrez « Raisons » pour voir les chiffres.</p></div>
        <span className="mx-pill">{v?.updated_at ? 'MAJ ' + ago(v.updated_at) : '—'}</span>
      </header>
      <div className="vd-grid single" id="vdGrid">{body}</div>
      <CalibNote calib={calib} />
    </article>
  )
}
