import FACULTIES from '@poptu-faculties'

export { FACULTIES }

export const MAX_CLICK_BUFFER = 20
export const CPS_CAP = 55
export const JITTER_MIN = 0.03

export const API_BASE = (import.meta.env && import.meta.env.VITE_API_URL) || ''
function resolveTurnstileSiteKey() {
  const env = import.meta.env || {}
  const direct = env.VITE_TURNSTILE_SITE_KEY
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string' || !v.trim()) continue
    // Accept near-miss names to avoid silent captcha misconfiguration.
    if (/^VITE_TURN.*TILE.*SITE.*KEY$/i.test(k)) return v.trim()
  }
  return ''
}
export const TURNSTILE_SITE_KEY = resolveTurnstileSiteKey()
export const STAGE_PT_LOGO = `${(import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/') }PTLOGO.webp`
export const RANKING_REFRESH_MS = 2000
export const RANKING_REFRESH_HIDDEN_MS = 8000
export const ALL_FACULTIES_POLL_MS = 2000
export const POP_FLUSH_MS = 1500
export const MAX_FLOATERS = 12

export const WIN_DECO_BTN = { disabled: true, title: 'ตกแต่ง (ยังไม่ใช้งาน)' }
