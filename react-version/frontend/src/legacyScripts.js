import core from './legacy/core.js?raw'
import fx from './legacy/fx.js?raw'
import rail from './legacy/rail.js?raw'
import logo from './legacy/logo.js?raw'

/** Exécute une seule fois les scripts hérités (journal, risque, playbook…) comme scripts classiques,
 *  une fois le DOM React + HTML hérité monté. Ils sont inchangés : migration progressive section par section. */
export function runLegacyScripts() {
  if (window.__nexusLegacy) return
  window.__nexusLegacy = true
  for (const code of [core, fx, rail, logo]) {
    const s = document.createElement('script')
    s.text = code
    document.body.appendChild(s)
    s.remove()
  }
}
