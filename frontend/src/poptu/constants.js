import FACULTIES from '@poptu-faculties'

export { FACULTIES }

export const MAX_CLICK_BUFFER = 20
export const CPS_CAP = 80

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
// Polling / batching cadence is tuned to keep Upstash command usage inside the
// free tier. Shared leaderboard refreshes on this interval; per-user POPs are
// optimistically rendered client-side so users still feel responsive.
export const RANKING_REFRESH_MS = 5000
export const RANKING_REFRESH_HIDDEN_MS = 20_000
export const ALL_FACULTIES_POLL_MS = 5000
export const POP_FLUSH_MS = 3000
export const MAX_FLOATERS = 12

// Show a visible Turnstile CAPTCHA gate after this long has elapsed since
// the first click in the session. Reset after each successful solve so a
// sustained auto-clicker hits the gate again on the next cycle.
// Tweak via VITE_POP_CAPTCHA_AFTER_MS if a specific event needs shorter/longer.
function resolveCaptchaAfterMs() {
  const raw = (import.meta.env && import.meta.env.VITE_POP_CAPTCHA_AFTER_MS) || ''
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return Math.max(30_000, Math.floor(n))
  return 7 * 60 * 1000
}
export const POP_CAPTCHA_AFTER_MS = resolveCaptchaAfterMs()

export const WIN_DECO_BTN = { disabled: true, title: 'ตกแต่ง (ยังไม่ใช้งาน)' }
