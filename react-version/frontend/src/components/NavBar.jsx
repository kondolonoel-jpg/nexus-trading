import { useEffect } from 'react'
import { initNav } from '../nav-init.js'

const GROUPS = [
  { label: 'Trading', links: [['command', 'Command'], ['risk', 'Risque'], ['protocol', 'Protocole'], ['playbook', 'Playbook']] },
  { label: 'Marché', links: [['news', 'News'], ['macro', 'Macro'], ['analysis', 'Analyse IA']] },
  { label: 'Suivi', links: [['journal', 'Journal'], ['shots', 'Captures'], ['reviews', 'Revues'], ['accounts', 'Comptes']] },
]

export default function NavBar({ user, onLogout }) {
  useEffect(() => { initNav() }, [])
  return (
    <nav className="site-nav" aria-label="Navigation principale">
      <div className="container nav-inner">
        <a className="brand" href="#home" aria-label="KN NEXUS — accueil">
          <span className="brand-mark" aria-hidden="true"><img src="/assets/brand-mark.jpg" alt="" /></span>
          <span className="brand-text">NEXUS <span>TRADING</span></span>
        </a>
        <div className="user-chip" id="userChip">
          <span className="user-chip-name" id="userChipName">● {user}</span>
          <button className="btn btn-small" id="quickBackup" type="button" title="Exporter une sauvegarde JSON de vos données">⬇ <span>Sauvegarde</span></button>
          <button className="btn btn-small" id="quickRestore" type="button" title="Importer une sauvegarde JSON">⬆</button>
          <button className="btn btn-small" id="logoutBtn" type="button" title="Déconnexion" onClick={onLogout}>⏻ <span className="logout-txt">Déconnexion</span></button>
        </div>
        <button className="nav-toggle" id="navToggle" type="button" aria-expanded="false" aria-controls="navLinks">Menu</button>
        <div className="nav-links" id="navLinks">
          <a href="#home">Accueil</a>
          {GROUPS.map((g) => (
            <div className="nav-group" key={g.label}>
              <button className="nav-group-btn" type="button" aria-expanded="false" aria-haspopup="true">{g.label}</button>
              <div className="nav-menu">{g.links.map(([id, t]) => <a key={id} href={'#' + id}>{t}</a>)}</div>
            </div>
          ))}
          <a href="#system">Système</a>
        </div>
      </div>
    </nav>
  )
}
