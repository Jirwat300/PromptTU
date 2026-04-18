import { useCallback, useEffect, useState } from 'react'
import ComingSoon from './comingsoon.jsx'
import Home from './home.jsx'
import PopTu from './poptu.jsx'

// Hash-based page switcher: `#poptu` game, `#comingsoon` teaser, else main site (Home + section anchors).
function getPage() {
  if (typeof window === 'undefined') return 'home'
  const h = window.location.hash
  if (h === '#poptu') return 'poptu'
  if (h === '#comingsoon') return 'comingsoon'
  return 'home'
}

function App() {
  const [page, setPage] = useState(getPage)

  /** POPTU taskbar Home → coming soon (also if hashchange is flaky on mobile). */
  const navigateToComingSoon = useCallback(() => {
    setPage('comingsoon')
  }, [])

  useEffect(() => {
    const onHash = () => setPage(getPage())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Reset scroll when navigating between pages (so the game doesn't start mid-page)
  useEffect(() => { window.scrollTo(0, 0) }, [page])

  useEffect(() => {
    if (page === 'poptu') document.title = 'พร้อมธรรม · POPTU เกม'
    else if (page === 'comingsoon') document.title = 'พร้อมธรรม · เร็ว ๆ นี้'
    else document.title = 'พร้อมธรรม'
  }, [page])

  if (page === 'poptu') return <PopTu onNavigateToComingSoon={navigateToComingSoon} />
  if (page === 'comingsoon') return <ComingSoon />
  return <Home />
}

export default App
