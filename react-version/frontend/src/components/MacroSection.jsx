import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { usePoll } from '../hooks.js'
import { MarketSelect, useMarket } from '../markets.jsx'
import { useAlerts } from '../alerts.jsx'
import { ago, cls, dfr, kfmt, nf, sg, tone } from '../format.js'

const Head = ({ chip, title, children }) => (
  <div className="mx-head"><span className="mx-chip">{chip}</span><h3>{title}</h3>{children}</div>
)
const Empty = ({ children }) => <div className="ai-loading">{children}</div>

/* ---------------- COT ---------------- */
function CotRow({ kind, name, sub, r }) {
  const total = (r.long || 0) + (r.short || 0) || 1
  const lp = Math.max(4, Math.round(((r.long || 0) / total) * 100))
  return (
    <>
      <div className="cot-name">{name}<br /><span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>{sub}</span></div>
      <div className={'cot-bar ' + kind}><i className="l" style={{ width: lp + '%' }}>L {kfmt(r.long)}</i><i className="s" style={{ width: 100 - lp + '%' }}>S {kfmt(r.short)}</i></div>
      <div className={'cot-net ' + (r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : '')}>{r.net == null ? 'n/d' : sg(r.net / 1000, 1) + 'k net'}</div>
      <div className="cot-rowline" />
    </>
  )
}
const Gauge = ({ label, p }) => (
  <div className="cot-gauge">
    <div className="g-top"><span>{label}</span><b>{p == null ? 'n/d' : p}</b></div>
    <div className="g-bar">{p == null ? null : <i style={{ left: p + '%' }} />}</div>
    <div className="g-ends"><span>0 · short extrême</span><span>50</span><span>100 · long extrême</span></div>
  </div>
)
function CotCard({ cot }) {
  const { sym, isSynth } = useMarket()
  const title = 'COT · Commerciaux vs Non-Commerciaux'
  if (isSynth) return <article className="card mx-card" id="mxCot"><Head chip="M1" title={title} /><Empty>Non applicable : les indices synthétiques Deriv n’ont pas de rapport COT (ils ne sont pas cotés sur un marché à terme réglementé).</Empty></article>
  if (!cot || cot.loading) return <article className="card mx-card" id="mxCot"><Head chip="M1" title={title} /><Empty>Le serveur lit le rapport COT de la CFTC (mise à jour hebdomadaire)…</Empty></article>
  const c = cot.markets?.[sym]
  if (!c) return <article className="card mx-card" id="mxCot"><Head chip="M1" title={title} /><Empty>Aucune donnée COT pour {sym} (source CFTC indisponible ou marché non couvert).</Empty></article>
  const { commercial: cm, noncommercial: nc, nonreportable: nr } = c
  const bt = cm.pct52 == null ? 'mid' : cm.pct52 >= 65 ? 'up' : cm.pct52 <= 35 ? 'down' : 'mid'
  return (
    <article className="card mx-card" id="mxCot">
      <Head chip="M1" title={title}><span className="mx-badge mid">{c.symbol} · CFTC rapport du {dfr(c.date)}</span></Head>
      <div className="mx-meta"><b>{c.label}</b><span className={'mx-badge ' + bt}>Percentile net 52 sem. · Com {cm.pct52 ?? 'n/d'} · Non-com {nc.pct52 ?? 'n/d'}</span></div>
      <div className="cot-cols">
        <div className="cot-th">Long / Short (contrats)</div><div className="cot-th" /><div className="cot-th">Net</div>
        <CotRow kind="c" name="Commerciaux" sub="smart money" r={cm} />
        <CotRow kind="n" name="Non-Commerciaux" sub="spéculateurs" r={nc} />
        <CotRow kind="r" name="Non-reportables" sub="petits traders" r={nr} />
      </div>
      <div className="cot-gauges"><Gauge label="Commerciaux · percentile net 52 sem." p={cm.pct52} /><Gauge label="Non-commerciaux · percentile net 52 sem." p={nc.pct52} /></div>
      <p className="mx-note">
        Variation hebdomadaire du net commercial : <b className={cls(cm.chg_week)}>{sg(cm.chg_week)}</b> contrats (non-commerciaux : <b className={cls(nc.chg_week)}>{sg(nc.chg_week)}</b>).
        {' '}Ratio net commercial / net spéculatif = <b>{c.ratio_comm_spec == null ? 'n/d' : nf(c.ratio_comm_spec, 2)}</b>.{' '}
        {cm.net > 0 ? 'Les Commerciaux sont nets acheteurs : le biais institutionnel soutient la hausse.' : `Les Commerciaux sont nets vendeurs — position de couverture habituelle sur ce marché ; lisez-la avec le percentile 52 semaines (${cm.pct52 ?? 'n/d'}).`}
        {c.invert ? <> <b>Contrat sur la devise opposée :</b> lecture inversée pour la paire {c.symbol}.</> : null}
      </p>
      {c.flag ? <p className="mx-note warn">⚠ {c.flag}</p> : null}
      <p className="mx-note" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>Rapport Legacy futures-only de la CFTC, publié le vendredi pour le mardi précédent · {c.weeks} semaines d’historique · score COT du verdict : <b>{sg(c.score, 0)}</b>.</p>
    </article>
  )
}

/* ---------------- Banques ---------------- */
function BanksCard() {
  const { sym, isSynth } = useMarket()
  const [st, setSt] = useState({ loading: true })
  const [force, setForce] = useState(0)
  useEffect(() => {
    if (isSynth) return undefined
    let alive = true
    setSt({ loading: true })
    api('/api/macro/banks?symbol=' + encodeURIComponent(sym) + (force ? '&force=1' : ''), { auth: false })
      .then((d) => alive && setSt({ d }), (e) => alive && setSt({ err: e.message }))
    return () => { alive = false }
  }, [sym, isSynth, force])
  useEffect(() => {
    const h = () => setForce((n) => n + 1)
    window.addEventListener('nexus:refresh-macro', h)
    return () => window.removeEventListener('nexus:refresh-macro', h)
  }, [])
  const title = 'Rapports de recherche banques'
  if (isSynth) return <article className="card mx-card" id="mxBanks"><Head chip="M1" title={title} /><Empty>Non applicable : pas de rapports de banques pour les indices synthétiques Deriv.</Empty></article>
  if (st.loading) return <article className="card mx-card" id="mxBanks"><Head chip="M1" title={title} /><Empty>Lecture des titres de presse sur {sym}… (5 à 15 s)</Empty></article>
  if (st.err || !st.d?.ok) return <article className="card mx-card" id="mxBanks"><Head chip="M1" title={title} /><Empty>Titres indisponibles : {st.err || 'source injoignable'}.</Empty></article>
  const d = st.d
  if (d.na) return <article className="card mx-card" id="mxBanks"><Head chip="M1" title={title} /><Empty>{d.message}</Empty></article>
  return (
    <article className="card mx-card" id="mxBanks">
      <Head chip="M1" title={title}><span className={'mx-badge ' + tone(d.label)}>{d.label}</span></Head>
      <div className="bk-list">
        {d.items.length ? d.items.map((i) => (
          <div className="bk-row" key={i.bank}>
            <div className="bk-name">{i.bank}</div>
            <div className="bk-text">
              <a href={i.link} target="_blank" rel="noopener noreferrer">{i.title}</a>
              <small>{i.target != null ? <><b>objectif cité : {nf(i.target, i.target < 20 ? 4 : 0)}</b> · </> : null}{i.source || 'presse'} · {ago(i.ts)}</small>
            </div>
            <span className={'bk-stance ' + tone(i.stance)}>{i.stance}</span>
          </div>
        )) : <Empty>Aucun titre récent des banques suivies sur {sym} (45 derniers jours).</Empty>}
      </div>
      {d.missing?.length && d.items.length ? <p className="mx-note" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>Pas de titre récent : {d.missing.join(', ')}.</p> : null}
      <p className="mx-note" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>Titres réels de la presse financière (Google News), lien vers la source. Le sens et l’objectif sont lus automatiquement dans le titre : ce n’est pas le rapport complet — ouvrez le lien pour le détail.</p>
    </article>
  )
}

/* ---------------- Régimes ---------------- */
function RegimesCard({ reg }) {
  const title = 'Carte des régimes de marché'
  if (!reg || reg.loading || !reg.data) return <article className="card mx-card" id="mxRegimes"><Head chip="M2" title={title} /><Empty>Le serveur calcule les régimes à partir des indices, du VIX, du dollar et des taux…</Empty></article>
  const g = reg.data.global || {}
  return (
    <article className="card mx-card" id="mxRegimes">
      <Head chip="M2" title={title}><span className={'mx-badge ' + tone(g.label)}>{g.label ? g.label + (g.pct != null ? ' ' + g.pct + '%' : '') : 'n/d'}</span></Head>
      <div className="rg-grid">
        {(reg.data.regions || []).map((x) => x.regime ? (
          <div className="rg-card" key={x.code}>
            <div className="rg-top"><b><em>{x.code}</em>{x.name}</b><span className={'mx-badge ' + (x.regime === 'TRANSITOIRE' ? 'mid' : tone(x.regime))}>{x.regime}</span></div>
            <div className="rg-bar"><i style={{ left: x.pos + '%' }} /></div>
            {(x.rows || []).map((w) => <div className="rg-row" key={w.k}><span>{w.k}</span><b className={w.v ? '' : 'na'} title={w.v ? undefined : 'source indisponible'}>{w.v || 'n/d'}</b></div>)}
            <p className="rg-sum">{x.summary}</p>
          </div>
        ) : (
          <div className="rg-card" key={x.code}><div className="rg-top"><b><em>{x.code}</em>{x.name}</b></div><p className="rg-sum">Données de marché indisponibles pour cette région.</p></div>
        ))}
      </div>
      <div className="rg-signals">
        <span className="t">Signaux risk-on : {g.on != null ? g.on + ' / ' + g.total : 'n/d'} · ≥ 60 % = Risk-On · ≤ 40 % = Risk-Off</span>
        {(g.signals || []).map((s) => <span key={s.label} className={'rg-sig' + (s.on ? ' on' : '')} title={s.detail}>{s.on ? '● ' : '○ '}{s.label}</span>)}
      </div>
      <p className="mx-note" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>Régime par région : tendance de l’indice (20 j, MM50), VIX pour les États-Unis. Taux : FRED (mensuel pour le Japon, la Chine et le 10 ans allemand) ; « n/d » si la série est indisponible.</p>
    </article>
  )
}

/* ---------------- Alertes ---------------- */
function AlertsCard() {
  const { alerts, telegram, perm, requestPermission, sendTest } = useAlerts()
  const [msg, setMsg] = useState('')
  const onTest = () => {
    setMsg('Envoi…')
    sendTest().then(
      (d) => setMsg(d.telegram_configured ? (d.telegram_sent ? 'Envoyée sur Telegram.' : 'Telegram : échec d’envoi.') : 'Alerte créée (Telegram non configuré).'),
      (e) => setMsg(e.message),
    )
  }
  const KIND = { verdict: 'VERDICT', regime: 'RÉGIME', test: 'TEST' }
  return (
    <article className="card mx-card" id="mxAlerts">
      <Head chip="M3" title="Alertes"><span className={'mx-badge ' + (telegram ? 'up' : 'mid')}>Telegram : {telegram ? 'configuré' : 'non configuré'}</span></Head>
      <div className="al-actions">
        {perm !== 'unsupported' ? (
          <button className="btn btn-small" type="button" disabled={perm === 'granted'} onClick={requestPermission}>
            {perm === 'granted' ? '🔔 Notifications activées' : perm === 'denied' ? '🔕 Bloquées par le navigateur' : '🔔 Activer les notifications'}
          </button>
        ) : null}
        <button className="btn btn-small" type="button" onClick={onTest}>Envoyer une alerte de test</button>
        <span className="al-msg">{msg}</span>
      </div>
      <div className="al-list">
        {alerts.length ? [...alerts].slice(-8).reverse().map((a) => (
          <div className="al-row" key={a.id}>
            <span className={'al-k ' + a.kind}>{KIND[a.kind] || 'ALERTE'}</span>
            <div><b>{a.title.replace('NEXUS TRADING · ', '')}</b><small>{a.text} · {ago(a.ts)}</small></div>
          </div>
        )) : <Empty>Aucune alerte pour l’instant. Une alerte part quand un verdict bascule (ACHAT / NEUTRE / VENTE) ou quand le régime global change, confirmé sur 2 cycles de 15 min.</Empty>}
      </div>
      <p className="mx-note" style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>Telegram : définissez <code>TELEGRAM_BOT_TOKEN</code> et <code>TELEGRAM_CHAT_ID</code> sur le serveur. Les notifications du navigateur ne s’affichent que tant que cet onglet reste ouvert ; Telegram, lui, prévient même onglet fermé.</p>
    </article>
  )
}

/* ---------------- Section ---------------- */
export default function MacroSection() {
  const { offline } = useMarket()
  const { reload: reloadAlerts } = useAlerts()
  const [data, setData] = useState({ cot: null, reg: null, status: null, tries: 0 })
  const [test, setTest] = useState(null)

  const load = () => Promise.all([
    api('/api/macro/cot', { auth: false }).catch(() => null),
    api('/api/macro/regimes', { auth: false }).catch(() => null),
    api('/api/macro/status', { auth: false }).catch(() => null),
  ]).then(([cot, reg, status]) => setData((s) => ({ cot, reg, status, tries: s.tries + 1 })))
  usePoll(load, 300000)
  // tant que le serveur n'a pas fini son premier calcul : nouvel essai toutes les 10 s (max. 12 fois)
  useEffect(() => {
    if ((data.cot && !data.cot.loading) || data.tries > 12) return undefined
    const id = setTimeout(load, 10000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const bad = data.status?.sources ? Object.entries(data.status.sources).filter(([, v]) => !v.ok).map(([k, v]) => k + ' (' + (v.error || 'erreur') + ')') : []
  const times = [data.cot?.updated_at && 'COT ' + ago(data.cot.updated_at), data.reg?.updated_at && 'régimes ' + ago(data.reg.updated_at)].filter(Boolean)
  let status
  if (!data.status && !data.cot && !data.reg) status = <><strong className="bad">Serveur injoignable</strong> <em>· ouvrez le site via le serveur NEXUS.</em></>
  else if (bad.length) status = <><strong className="bad">Source en erreur</strong> <em>· {bad.join(' · ')}</em></>
  else status = <><strong>Synchronisé</strong> <em>· {times.join(' · ') || 'en attente des premières données'}</em></>

  const runTest = () => {
    setTest({ loading: true })
    api('/api/macro/selftest', { auth: false }).then((d) => setTest({ checks: d.checks }), (e) => setTest({ err: e.message }))
  }
  const refresh = () => { load(); reloadAlerts(); window.dispatchEvent(new Event('nexus:refresh-macro')) }

  return (
    <section className="container reveal" id="macro" aria-labelledby="macroTitle">
      <div className="section-head"><div>
        <div className="section-index">06 — Macro Intelligence</div>
        <h2 id="macroTitle">Positionnement institutionnel &amp; régime de risque</h2>
        <p className="section-desc">Données réelles uniquement : COT hebdomadaire de la CFTC, titres de presse des grandes banques, indices, VIX, dollar et taux (Yahoo Finance, FRED). Le verdict par marché est dans la section Analyse IA.</p>
      </div></div>
      <div className="mx-toolbar">
        <div className="field"><label htmlFor="mxMarket">Marché</label><MarketSelect id="mxMarket" /></div>
        <p id="mxStatus">{status}</p>
        <button className="btn btn-small" id="mxRefresh" type="button" onClick={refresh}>↻ Actualiser</button>
        <button className="btn btn-small" id="mxTest" type="button" onClick={runTest}>✔ Tester les sources</button>
      </div>
      {offline ? <p className="mk-note">Serveur injoignable : liste locale affichée, les données ne se chargeront qu’une fois le serveur joignable.</p> : null}
      {test ? (
        <div className="mx-selftest" id="mxSelftest">
          {test.loading ? <Empty>Test des sources en cours… (jusqu’à 20 s)</Empty>
            : test.err ? <Empty>Test impossible : {test.err}</Empty>
            : test.checks.map((c) => <div className="st-row" key={c.name}><span className={'st-dot ' + (c.ok ? 'ok' : 'ko')} /><b>{c.name}</b><span>{c.detail}</span><em>{c.ms} ms</em></div>)}
        </div>
      ) : null}
      <div className="mx-label"><span>Module 1 — Positionnement institutionnel</span></div>
      <div className="mx-grid2"><CotCard cot={data.cot} /><BanksCard /></div>
      <div className="mx-label"><span>Module 2 — Carte des régimes de marché</span></div>
      <RegimesCard reg={data.reg} />
      <div className="mx-label"><span>Module 3 — Alertes</span></div>
      <AlertsCard />
      <p className="mx-foot">Sources : CFTC (Commitments of Traders, Legacy futures-only) · Google News (titres de presse) · Yahoo Finance · FRED · Deriv (indices synthétiques). Aucune valeur simulée : une donnée indisponible s’affiche « n/d ». Informatif uniquement, pas un conseil financier.</p>
    </section>
  )
}
