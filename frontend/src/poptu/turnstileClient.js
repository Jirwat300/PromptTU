let scriptPromise = null
let widgetId = null
let pendingResolve = null
let pendingTimer = null

function getTurnstile() {
  if (typeof window === 'undefined') return null
  return window.turnstile || null
}

function ensureScriptLoaded() {
  if (scriptPromise) return scriptPromise
  if (typeof document === 'undefined') return Promise.resolve(false)

  scriptPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-turnstile-script="1"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      if (getTurnstile()) resolve(true)
      return
    }

    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.defer = true
    s.setAttribute('data-turnstile-script', '1')
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.head.appendChild(s)
  })

  return scriptPromise
}

async function ensureWidget(siteKey) {
  if (!siteKey || typeof document === 'undefined') return null
  if (widgetId != null) return widgetId
  const loaded = await ensureScriptLoaded()
  if (!loaded) return null
  const turnstile = getTurnstile()
  if (!turnstile) return null

  let host = document.getElementById('poptu-turnstile-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'poptu-turnstile-host'
    host.style.position = 'fixed'
    host.style.width = '1px'
    host.style.height = '1px'
    host.style.overflow = 'hidden'
    host.style.opacity = '0'
    host.style.pointerEvents = 'none'
    host.style.bottom = '0'
    host.style.left = '0'
    document.body.appendChild(host)
  }

  widgetId = turnstile.render(host, {
    sitekey: siteKey,
    size: 'invisible',
    execution: 'execute',
    appearance: 'execute',
    callback: (token) => {
      if (!pendingResolve) return
      const resolve = pendingResolve
      pendingResolve = null
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      resolve(typeof token === 'string' ? token : null)
    },
    'error-callback': () => {
      if (!pendingResolve) return
      const resolve = pendingResolve
      pendingResolve = null
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      resolve(null)
    },
    'expired-callback': () => {
      if (!pendingResolve) return
      const resolve = pendingResolve
      pendingResolve = null
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      resolve(null)
    },
  })
  return widgetId
}

export async function createTurnstileToken(siteKey) {
  if (!siteKey) return null
  const id = await ensureWidget(siteKey)
  const turnstile = getTurnstile()
  if (id == null || !turnstile) return null
  if (pendingResolve) return null

  return new Promise((resolve) => {
    pendingResolve = resolve
    pendingTimer = setTimeout(() => {
      if (!pendingResolve) return
      const r = pendingResolve
      pendingResolve = null
      pendingTimer = null
      r(null)
    }, 4500)
    try {
      turnstile.reset(id)
      turnstile.execute(id, { action: 'ranking_pop' })
    } catch {
      if (!pendingResolve) return
      const r = pendingResolve
      pendingResolve = null
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      r(null)
    }
  })
}
