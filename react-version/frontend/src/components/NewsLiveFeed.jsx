import { useState } from 'react'
import { api } from '../api.js'
import { usePoll } from '../hooks.js'
import { ago } from '../format.js'

const CATS = [['all', 'Tous'], ['Forex', 'Forex'], ['Macro', 'Macro'], ['Crypto', 'Crypto'], ['Énergie', 'Énergie']]
const catClass = (c) => 'cat-' + String(c).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '')

export default function NewsLiveFeed() {
  const [state, setState] = useState({ items: [], updated: null, error: false })
  const [cat, setCat] = useState('all')
  const [impact, setImpact] = useState(false)

  usePoll(() => {
    api('/api/news?limit=120').then(
      (d) => setState({ items: d.items || [], updated: d.updated_at, error: false }),
      () => setState((s) => ({ ...s, error: true })),
    )
  }, 180000)

  const items = state.items.filter((it) => (cat === 'all' || it.category === cat) && (!impact || it.impact === 'high'))
  let status
  if (state.error) status = <span style={{ color: 'var(--red)' }}>Flux indisponible — vérifiez le serveur.</span>
  else if (!state.updated) status = <span className="source-live" style={{ color: 'var(--text-faint)' }}><i></i> Synchronisation…</span>
  else status = <><span className="source-live"><i></i> LIVE</span> · dernière synchro serveur <b>{ago(state.updated)}</b> · {state.items.length} dépêches</>

  return (
    <article className="card live-feed" id="liveFeed">
      <header className="live-feed-head">
        <div>
          <h3>Flux d’actualités temps réel</h3>
          <p className="card-sub" style={{ margin: '5px 0 0' }}>Agrégation continue ForexLive · Investing.com · OilPrice · CryptoPotato — rafraichie côté serveur toutes les 3 minutes.</p>
        </div>
        <div className="live-feed-status" id="nfStatus">{status}</div>
      </header>
      <div className="live-feed-filters" id="nfFilters">
        {CATS.map(([k, label]) => <button key={k} className={'nf-chip' + (cat === k ? ' active' : '')} type="button" onClick={() => setCat(k)}>{label}</button>)}
        <button className={'nf-chip hot' + (impact ? ' active' : '')} type="button" onClick={() => setImpact(!impact)}>⚡ Impact fort</button>
      </div>
      <div className="live-feed-list" id="nfList">
        {state.error && !state.items.length ? <div className="live-feed-empty">Impossible de joindre le backend /api/news.</div>
          : !state.updated ? <div className="live-feed-empty">Chargement du flux temps réel…</div>
          : !items.length ? <div className="live-feed-empty">Aucune actualité pour ce filtre.</div>
          : items.slice(0, 60).map((it, i) => (
            <div className="nf-item" key={(it.link || '') + i}>
              <div className="nf-time">{ago(it.timestamp)}<small>{new Date(it.timestamp * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} UTC</small></div>
              <div>
                <p className="nf-title"><a href={it.link || '#'} target="_blank" rel="noopener noreferrer">{it.title}</a></p>
                {it.summary ? <p className="nf-sum">{it.summary}</p> : null}
                <div className="nf-meta"><span className="nf-src">{it.source}</span><span className={'nf-tag ' + catClass(it.category)}>{it.category}</span>{it.impact === 'high' ? <span className="nf-tag hi">⚡ impact fort</span> : null}</div>
              </div>
            </div>
          ))}
      </div>
    </article>
  )
}
