import { useEffect, useState } from 'react'
import { api, setToken } from '../api.js'

const USER_RE = /^[\w .-]{3,32}$/u

export default function AuthGate({ onAuth }) {
  const [tab, setTab] = useState('login')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [f, setF] = useState({ loginUser: '', loginPass: '', regUser: '', regEmail: '', regPass: '', regPass2: '' })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  useEffect(() => {
    document.body.classList.add('locked')
    return () => document.body.classList.remove('locked')
  }, [])

  const switchTab = (t) => { setTab(t); setMsg('') }

  async function submit(e, kind) {
    e.preventDefault()
    let url, body
    if (kind === 'login') {
      if (!f.loginUser.trim() || !f.loginPass) return setMsg('Renseignez identifiant et mot de passe.')
      url = '/api/login'; body = { username: f.loginUser.trim(), password: f.loginPass }
    } else {
      if (!USER_RE.test(f.regUser.trim())) return setMsg("Nom d'utilisateur : 3 à 32 caractères (lettres, chiffres, espace, _ . -).")
      if (f.regPass.length < 6) return setMsg('Le mot de passe doit contenir au moins 6 caractères.')
      if (f.regPass !== f.regPass2) return setMsg('Les deux mots de passe ne correspondent pas.')
      url = '/api/register'; body = { username: f.regUser.trim(), email: f.regEmail.trim(), password: f.regPass }
    }
    setBusy(true); setMsg('')
    try {
      const d = await api(url, { method: 'POST', body, auth: false })
      setToken(d.token)
      onAuth(d.user)
    } catch (err) {
      setMsg(err.status ? err.message : 'Serveur injoignable : lancez le backend (python server.py).')
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-gate" id="authGate">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', border: '1px solid var(--gold)', background: '#090c12', width: 38, height: 38, color: 'var(--gold)', font: "600 15px/1 'Playfair Display',Georgia,serif" }}>KN</span>
          <b>NEXUS <span>TRADING</span></b>
        </div>
        <p className="auth-sub">Poste de contrôle trading sécurisé. Créez votre compte ou connectez-vous pour accéder au Command Center, aux news temps réel et à l’analyse IA des marchés.</p>
        <div className="auth-tabs" role="tablist">
          <button className={'auth-tab' + (tab === 'login' ? ' active' : '')} id="tabLogin" type="button" role="tab" aria-selected={tab === 'login'} onClick={() => switchTab('login')}>Connexion</button>
          <button className={'auth-tab' + (tab === 'register' ? ' active' : '')} id="tabRegister" type="button" role="tab" aria-selected={tab === 'register'} onClick={() => switchTab('register')}>Créer un compte</button>
        </div>
        {tab === 'login' ? (
          <form className="auth-form" onSubmit={(e) => submit(e, 'login')} noValidate>
            <div className="field"><label htmlFor="loginUser">Nom d’utilisateur</label><input id="loginUser" value={f.loginUser} onChange={set('loginUser')} autoComplete="username" placeholder="votre identifiant" /></div>
            <div className="field"><label htmlFor="loginPass">Mot de passe</label><input id="loginPass" type="password" value={f.loginPass} onChange={set('loginPass')} autoComplete="current-password" placeholder="••••••••" /></div>
            <div className="auth-msg" role="alert">{msg}</div>
            <button className="btn btn-primary" id="loginBtn" type="submit" disabled={busy}>{busy ? '…' : 'Se connecter'}</button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={(e) => submit(e, 'register')} noValidate>
            <div className="field"><label htmlFor="regUser">Nom d’utilisateur</label><input id="regUser" value={f.regUser} onChange={set('regUser')} maxLength={32} autoComplete="username" placeholder="3 à 32 caractères : lettres, chiffres, espace, _ . -" /></div>
            <div className="field"><label htmlFor="regEmail">Email (optionnel)</label><input id="regEmail" type="email" value={f.regEmail} onChange={set('regEmail')} autoComplete="email" placeholder="vous@exemple.com" /></div>
            <div className="field"><label htmlFor="regPass">Mot de passe</label><input id="regPass" type="password" value={f.regPass} onChange={set('regPass')} autoComplete="new-password" placeholder="6 caractères minimum" /></div>
            <div className="field"><label htmlFor="regPass2">Confirmer le mot de passe</label><input id="regPass2" type="password" value={f.regPass2} onChange={set('regPass2')} autoComplete="new-password" placeholder="répétez le mot de passe" /></div>
            <div className="auth-msg" role="alert">{msg}</div>
            <button className="btn btn-primary" id="regBtn" type="submit" disabled={busy}>{busy ? '…' : 'Créer mon compte'}</button>
          </form>
        )}
        <p className="auth-foot">Vos données de trading locales restent dans votre navigateur. L’authentification protège l’accès au dashboard et active les services serveur : news temps réel &amp; analyse IA.</p>
      </div>
    </div>
  )
}
