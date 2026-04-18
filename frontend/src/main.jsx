import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

/* Favicon from /public — respect Vite base so tab icon works on Vercel/subpaths */
{
  const base = import.meta.env.BASE_URL ?? '/'
  const prefix = base.endsWith('/') ? base : `${base}/`
  const href = `${prefix}PTLOGO.png`
  for (const rel of ['icon', 'apple-touch-icon']) {
    const el = document.querySelector(`link[rel="${rel}"]`)
    if (el) el.setAttribute('href', href)
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
