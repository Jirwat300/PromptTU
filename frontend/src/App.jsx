import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import PopTu from './poptu.jsx'

const ComingSoon = lazy(() => import('./comingsoon.jsx'))

// Hash-based page switcher: default + `#poptu` → game; `#comingsoon` → teaser.
// Home (`home.jsx`) is off for now — re-enable by importing Home and branching in getPage/render.
function getPage() {
  if (typeof window === 'undefined') return 'poptu'
  const h = window.location.hash
  if (h === '#comingsoon') return 'comingsoon'
  return 'poptu'
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
    if (page === 'comingsoon') document.title = 'พร้อมธรรม · เร็ว ๆ นี้'
    else document.title = 'พร้อมธรรม · POPTU เกม'
  }, [page])

  if (page === 'comingsoon') {
    return (
      <Suspense fallback={null}>
        <ComingSoon />
      </Suspense>
    )
  }
  return <PopTu onNavigateToComingSoon={navigateToComingSoon} />
}

export default App
