import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'

const SYN = ['Volatility', 'Boom & Crash', 'Step', 'Jump']
/** Liste de repli : le menu reste complet même si /api/markets est injoignable. */
const FALLBACK = [
  ['XAUUSD', 'Or (Gold)', 'Métaux'], ['XAGUSD', 'Argent (Silver)', 'Métaux'], ['GBPUSD', 'GBP/USD', 'Forex'],
  ['EURUSD', 'EUR/USD', 'Forex'], ['USDJPY', 'USD/JPY', 'Forex'], ['AUDUSD', 'AUD/USD', 'Forex'],
  ['USDCAD', 'USD/CAD', 'Forex'], ['DXY', 'Dollar Index (DXY)', 'Forex'], ['US30', 'US30 (Dow Jones)', 'Indices'],
  ['US100', 'US100 (Nasdaq)', 'Indices'], ['US500', 'US500 (S&P 500)', 'Indices'], ['USOIL', 'Pétrole WTI', 'Énergie'],
  ['BTCUSD', 'Bitcoin (BTC/USD)', 'Crypto'],
  ['VOL10', 'Volatility 10', 'Volatility'], ['VOL25', 'Volatility 25', 'Volatility'], ['VOL50', 'Volatility 50', 'Volatility'],
  ['VOL75', 'Volatility 75', 'Volatility'], ['VOL100', 'Volatility 100', 'Volatility'],
  ['VOL10S', 'Volatility 10 (1s)', 'Volatility'], ['VOL25S', 'Volatility 25 (1s)', 'Volatility'],
  ['VOL50S', 'Volatility 50 (1s)', 'Volatility'], ['VOL75S', 'Volatility 75 (1s)', 'Volatility'],
  ['VOL100S', 'Volatility 100 (1s)', 'Volatility'],
  ['BOOM300', 'Boom 300', 'Boom & Crash'], ['BOOM500', 'Boom 500', 'Boom & Crash'], ['BOOM1000', 'Boom 1000', 'Boom & Crash'],
  ['CRASH300', 'Crash 300', 'Boom & Crash'], ['CRASH500', 'Crash 500', 'Boom & Crash'], ['CRASH1000', 'Crash 1000', 'Boom & Crash'],
  ['STEP', 'Step Index', 'Step'], ['JUMP10', 'Jump 10', 'Jump'], ['JUMP25', 'Jump 25', 'Jump'],
  ['JUMP50', 'Jump 50', 'Jump'], ['JUMP75', 'Jump 75', 'Jump'], ['JUMP100', 'Jump 100', 'Jump'],
].map(([symbol, name, family]) => ({ symbol, name, family, group: SYN.includes(family) ? 'Synthétiques' : family }))

const KEY = 'nexus.market'
const saved = () => { try { return localStorage.getItem(KEY) || 'XAUUSD' } catch { return 'XAUUSD' } }
const Ctx = createContext(null)
export const useMarket = () => useContext(Ctx)

export function MarketProvider({ children }) {
  const [markets, setMarkets] = useState(FALLBACK)
  const [offline, setOffline] = useState(false)
  const [sym, setSymState] = useState(saved)

  useEffect(() => {
    api('/api/markets', { auth: false }).then((d) => {
      if (d.markets?.length) {
        setMarkets(d.markets.map((m) => ({ symbol: m.symbol, name: m.name, group: m.group, family: m.family || m.group })))
        setOffline(false)
      } else setOffline(true)
    }).catch(() => setOffline(true))
  }, [])

  const value = useMemo(() => {
    const current = markets.find((m) => m.symbol === sym) || markets[0]
    const setSym = (s) => { setSymState(s); try { localStorage.setItem(KEY, s) } catch { /* ignoré */ } }
    return { markets, offline, sym: current.symbol, market: current, setSym, isSynth: current.group === 'Synthétiques' }
  }, [markets, offline, sym])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Menu déroulant unique (groupé par famille) — le seul endroit où la liste des marchés est visible. */
export function MarketSelect({ id, className }) {
  const { markets, sym, setSym } = useMarket()
  const groups = useMemo(() => {
    const out = []
    markets.forEach((m) => {
      const g = m.family || m.group
      let e = out.find((x) => x.name === g)
      if (!e) out.push((e = { name: g, items: [] }))
      e.items.push(m)
    })
    return out
  }, [markets])
  return (
    <select id={id} className={className} value={sym} onChange={(e) => setSym(e.target.value)} aria-label="Choisir le marché">
      {groups.map((g) => (
        <optgroup key={g.name} label={g.name}>
          {g.items.map((m) => <option key={m.symbol} value={m.symbol}>{m.name} — {m.symbol}</option>)}
        </optgroup>
      ))}
    </select>
  )
}
