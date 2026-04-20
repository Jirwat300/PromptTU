import FACULTIES from '@poptu-faculties'

export { FACULTIES }

export const MAX_CLICK_BUFFER = 20
export const CPS_CAP = 25
export const JITTER_MIN = 0.08

export const API_BASE = (import.meta.env && import.meta.env.VITE_API_URL) || ''
export const TURNSTILE_SITE_KEY =
  (import.meta.env && import.meta.env.VITE_TURNSTILE_SITE_KEY) || ''
export const STAGE_PT_LOGO = `${(import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/') }PTLOGO.webp`
export const RANKING_REFRESH_MS = 10000
export const RANKING_REFRESH_HIDDEN_MS = 30000
export const ALL_FACULTIES_POLL_MS = 2000
export const POP_FLUSH_MS = 800
export const MAX_FLOATERS = 12

export const WIN_DECO_BTN = { disabled: true, title: 'ตกแต่ง (ยังไม่ใช้งาน)' }
