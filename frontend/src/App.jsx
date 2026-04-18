import { useEffect, useState } from 'react'
import Home from './home.jsx'
import PopTu from './poptu.jsx'

// Tiny hash-based page switcher. `#poptu` ⇒ the Popcat-style mini game;
// anything else (including the section anchors used by Home like #about)
// falls through to the main site.
function getPage() {
  if (typeof window === 'undefined') return 'home'
  return window.location.hash === '#poptu' ? 'poptu' : 'home'
}

function App() {
  const [page, setPage] = useState(getPage)

  useEffect(() => {
    const onHash = () => setPage(getPage())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Reset scroll when navigating between pages (so the game doesn't start mid-page)
  useEffect(() => { window.scrollTo(0, 0) }, [page])

  useEffect(() => {
    document.title = page === 'poptu' ? 'PT — พร้อมธรรม' : 'พร้อมธรรม'
  }, [page])

  return page === 'poptu' ? <PopTu /> : <Home />
}

export default App
