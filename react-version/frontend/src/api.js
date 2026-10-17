export const TOKEN_KEY = 'nexus_token_v1'
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* stockage indisponible */ } }
export const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* stockage indisponible */ } }

/** Appel JSON vers le backend Flask. Lève une Error(message, status) si la réponse n'est pas OK. */
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {}
  const token = getToken()
  if (token && auth) headers.Authorization = 'Bearer ' + token
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
  let data = {}
  try { data = await res.json() } catch { /* corps vide ou non JSON */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Erreur ' + res.status)
    err.status = res.status
    throw err
  }
  return data
}
