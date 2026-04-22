import { useCallback, useEffect, useRef, useState } from 'react'

const SCRIPT_LOAD_TIMEOUT_MS = 5000

// Load the Cloudflare Turnstile script (shared with the invisible widget in
// turnstileClient.js — it tags the script element so we don't double-load).
function ensureTurnstileScript() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false)
  }
  if (window.turnstile) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), SCRIPT_LOAD_TIMEOUT_MS)

    const existing = document.querySelector('script[data-turnstile-script="1"]')
    if (existing) {
      existing.addEventListener('load', () => done(true), { once: true })
      existing.addEventListener('error', () => done(false), { once: true })
      if (window.turnstile) done(true)
      return
    }

    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.defer = true
    s.setAttribute('data-turnstile-script', '1')
    s.onload = () => done(true)
    s.onerror = () => done(false)
    document.head.appendChild(s)
  })
}

/**
 * Visible Turnstile gate. Blocks the screen until the user solves a CAPTCHA.
 *
 * Props:
 *   siteKey — Cloudflare Turnstile site key (VITE_TURNSTILE_SITE_KEY).
 *   onSolve(token) — called when the widget returns a token.
 *   onSkip — called if Turnstile fails to load (network issue, ad-blocker).
 *            Parent should let the user keep playing so we never lock them out.
 */
export default function CaptchaGate({ siteKey, onSolve, onSkip }) {
  const hostRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | error

  const reset = useCallback(() => {
    const ts = typeof window !== 'undefined' ? window.turnstile : null
    if (ts && widgetIdRef.current != null) {
      try {
        ts.reset(widgetIdRef.current)
      } catch {
        /* widget may already be gone */
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      if (!siteKey) {
        setStatus('error')
        return
      }
      const loaded = await ensureTurnstileScript()
      if (cancelled) return
      const ts = typeof window !== 'undefined' ? window.turnstile : null
      if (!loaded || !ts || !hostRef.current) {
        setStatus('error')
        return
      }
      try {
        widgetIdRef.current = ts.render(hostRef.current, {
          sitekey: siteKey,
          size: 'flexible',
          theme: 'light',
          appearance: 'always',
          action: 'ranking_pop_gate',
          callback: (token) => {
            if (cancelled) return
            if (typeof token === 'string' && token) {
              onSolve(token)
            }
          },
          'error-callback': () => {
            if (cancelled) return
            setStatus('error')
          },
          'expired-callback': () => {
            if (cancelled) return
            reset()
          },
        })
        setStatus('ready')
      } catch {
        setStatus('error')
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
      const ts = typeof window !== 'undefined' ? window.turnstile : null
      if (ts && widgetIdRef.current != null) {
        try {
          ts.remove(widgetIdRef.current)
        } catch {
          /* noop */
        }
        widgetIdRef.current = null
      }
    }
  }, [siteKey, onSolve, reset])

  return (
    <div
      className="poptu-modal-root"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="captcha-title"
    >
      <div className="win-dialog" style={{ maxWidth: 360 }}>
        <div className="win-titlebar">
          <span className="win-title" id="captcha-title">Human check</span>
        </div>
        <div className="win-dialog-body" style={{ flexDirection: 'column', gap: 12 }}>
          <div className="win-dialog-msg" lang="th" style={{ textAlign: 'center' }}>
            กดติดกันมาสักพักแล้ว<br />
            ช่วยยืนยันว่าเป็นคนจริงก่อนเล่นต่อ
          </div>
          <div
            ref={hostRef}
            className="poptu-captcha-host"
            style={{ minHeight: 65, display: 'flex', justifyContent: 'center' }}
          />
          {status === 'loading' && (
            <div className="win-dialog-msg" lang="th" style={{ fontSize: 12, opacity: 0.7 }}>
              กำลังโหลด…
            </div>
          )}
          {status === 'error' && (
            <div className="win-dialog-msg" lang="th" style={{ fontSize: 12, color: '#a00' }}>
              โหลด CAPTCHA ไม่สำเร็จ (network / ad-blocker?)
            </div>
          )}
        </div>
        {status === 'error' && (
          <div className="win-dialog-actions">
            <button type="button" className="w95-btn" onClick={onSkip} autoFocus>
              ข้าม
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
