import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { usePoll } from './hooks.js'

const Ctx = createContext(null)
export const useAlerts = () => useContext(Ctx)

/** Alertes serveur (Telegram + flux) + notifications du navigateur + toasts affichés partout sur le site. */
export function AlertsProvider({ children }) {
  const [alerts, setAlerts] = useState([])
  const [telegram, setTelegram] = useState(false)
  const [toasts, setToasts] = useState([])
  const [perm, setPerm] = useState('Notification' in window ? Notification.permission : 'unsupported')
  const last = useRef(null)

  const load = useCallback(() => api('/api/macro/alerts?since=' + (last.current ?? 0), { auth: false }).then((d) => {
    setTelegram(!!d.telegram)
    const first = last.current === null
    const fresh = d.alerts || []
    fresh.forEach((a) => {
      if (first) return
      const id = a.id + '-' + Date.now()
      setToasts((t) => [...t, { id, title: a.title.replace('NEXUS TRADING · ', ''), text: a.text }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 9000)
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(a.title, { body: a.text, tag: 'nexus-' + a.id }) } catch { /* ignoré */ }
      }
    })
    if (fresh.length) setAlerts((cur) => [...cur, ...fresh].slice(-50))
    last.current = d.latest || 0
  }).catch(() => {}), [])

  usePoll(load, 60000)
  useEffect(() => { /* première charge déjà faite par usePoll */ }, [])

  const requestPermission = () => Notification.requestPermission().then((p) => setPerm(p))
  const sendTest = () => api('/api/macro/alerts/test', { method: 'POST' }).then((d) => { load(); return d })

  return (
    <Ctx.Provider value={{ alerts, telegram, perm, requestPermission, sendTest, reload: load }}>
      {children}
      <div className="mx-toasts" aria-live="polite">
        {toasts.map((t) => <div className="mx-toast" key={t.id}><b>{t.title}</b><span>{t.text}</span></div>)}
      </div>
    </Ctx.Provider>
  )
}
