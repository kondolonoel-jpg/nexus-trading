export const nf = (n, d = 0) => (n == null || Number.isNaN(n) ? 'n/d' : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }))
export const sg = (n, d = 0) => (n == null ? 'n/d' : (n > 0 ? '+' : n < 0 ? '−' : '') + nf(Math.abs(n), d))
export const kfmt = (n) => (n == null ? 'n/d' : Math.abs(n) >= 1000 ? nf(n / 1000, 1) + 'k' : nf(n))
export const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '')
export const dfr = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—')
export const tone = (l) => (/ACHAT|HAUSS|RISK-ON|ACHETEUR/.test(l || '') ? 'up' : /VENTE|BAISS|RISK-OFF|VENDEUR/.test(l || '') ? 'down' : 'mid')

export function ago(ts) {
  if (!ts) return '—'
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return 'il y a ' + s + ' s'
  const m = Math.floor(s / 60)
  if (m < 60) return 'il y a ' + m + ' min'
  const h = Math.floor(m / 60)
  if (h < 24) return 'il y a ' + h + ' h'
  return 'il y a ' + Math.floor(h / 24) + ' j'
}
export function fmtPrice(p) {
  if (p == null || Number.isNaN(p)) return '—'
  const d = p >= 1000 ? 1 : p >= 50 ? 2 : p >= 2 ? 3 : 5
  return p.toLocaleString('fr-FR', { minimumFractionDigits: Math.min(d, 4), maximumFractionDigits: d })
}
export function chgmt(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return (v > 0 ? '+' : '') + v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + '%'
}
