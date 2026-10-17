import LegacyHtml from './LegacyHtml.jsx'
import NewsLiveFeed from './NewsLiveFeed.jsx'
import newsTop from '../legacy/newsTop.html?raw'
import newsBottom from '../legacy/newsBottom.html?raw'

/** Règle News / radar macro / planificateur : HTML hérité (core.js). Le flux temps réel est un vrai composant React. */
export default function NewsSection() {
  return (
    <section className="container reveal" id="news" aria-labelledby="newsTitle">
      <LegacyHtml html={newsTop} />
      <NewsLiveFeed />
      <LegacyHtml html={newsBottom} />
    </section>
  )
}
