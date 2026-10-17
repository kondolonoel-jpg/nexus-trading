import { memo } from 'react'

/** Fragment HTML hérité (sections encore en JavaScript « vanilla », liées par core.js).
 *  memo : le DOM n'est jamais ré-injecté, donc les écouteurs posés par core.js survivent aux rendus React. */
function LegacyHtml({ html }) {
  return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />
}
export default memo(LegacyHtml)
