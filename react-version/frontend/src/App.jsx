import { useEffect, useState } from 'react'
import { api, clearToken, getToken } from './api.js'
import { MarketProvider } from './markets.jsx'
import { AlertsProvider } from './alerts.jsx'
import AuthGate from './components/AuthGate.jsx'
import NavBar from './components/NavBar.jsx'
import LegacyHtml from './components/LegacyHtml.jsx'
import NewsSection from './components/NewsSection.jsx'
import MacroSection from './components/MacroSection.jsx'
import AnalysisSection from './components/AnalysisSection.jsx'
import { runLegacyScripts } from './legacyScripts.js'
import partA from './legacy/partA.html?raw'
import partB from './legacy/partB.html?raw'
import partC from './legacy/partC.html?raw'   // boîte de dialogue du journal + toast (hors sections)

// partA = bandeau + hero + sections Command/Risque/Protocole/Playbook ; partB = Journal…Système + pied de page
const iHero = partA.indexOf('<header'), iHeroEnd = partA.indexOf('</header>', iHero) + '</header>'.length
const tick = partA.slice(0, iHero), hero = partA.slice(iHero, iHeroEnd), sectionsA = partA.slice(iHeroEnd)
const iFoot = partB.indexOf('<footer'), sectionsB = partB.slice(0, iFoot), footer = partB.slice(iFoot)

/** Tableau de bord (monté seulement une fois connecté : les scripts hérités se branchent sur son DOM). */
function Dashboard({ user }) {
  useEffect(() => { runLegacyScripts() }, [])
  const logout = () => { clearToken(); window.location.reload() }   // recharge : les scripts hérités repartent d'un DOM neuf
  return (
    <MarketProvider>
      <AlertsProvider>
        <LegacyHtml html={tick} />
        <NavBar user={user} onLogout={logout} />
        <LegacyHtml html={hero} />
        <main>
          <LegacyHtml html={sectionsA} />
          <NewsSection />
          <MacroSection />
          <AnalysisSection />
          <LegacyHtml html={sectionsB} />
        </main>
        <LegacyHtml html={footer} />
        <LegacyHtml html={partC} />
      </AlertsProvider>
    </MarketProvider>
  )
}

/** Écran de connexion / création de compte, puis tableau de bord. */
export default function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(!!getToken())
  useEffect(() => {
    if (!getToken()) return
    api('/api/whoami').then((d) => setUser(d.user), () => clearToken()).finally(() => setChecking(false))
  }, [])
  if (checking) return null
  return user ? <Dashboard user={user} /> : <AuthGate onAuth={setUser} />
}
