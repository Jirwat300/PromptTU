/** Browser persistence for POPTU (no login). Bump `v` if the JSON shape changes. */
export const POPTU_USER_STATE_KEY = 'poptu:user-state:v1'

/**
 * @returns {{ facultyId: string | null, sessionClicks: number }}
 */
export function loadPoptuUserState(facultyIds) {
  const allowed = new Set(facultyIds)
  try {
    if (typeof localStorage === 'undefined') return { facultyId: null, sessionClicks: 0 }
    const raw = localStorage.getItem(POPTU_USER_STATE_KEY)
    if (!raw) return { facultyId: null, sessionClicks: 0 }
    const o = JSON.parse(raw)
    if (o?.v !== 1 || typeof o.facultyId !== 'string' || !allowed.has(o.facultyId)) {
      return { facultyId: null, sessionClicks: 0 }
    }
    const sessionClicks = Math.max(0, Math.floor(Number(o.sessionClicks)) || 0)
    return { facultyId: o.facultyId, sessionClicks }
  } catch {
    return { facultyId: null, sessionClicks: 0 }
  }
}

export function clearPoptuUserState() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(POPTU_USER_STATE_KEY)
  } catch {
    /* private mode, quota */
  }
}

export function writePoptuUserState(facultyId, sessionClicks) {
  try {
    if (typeof localStorage === 'undefined') return
    if (!facultyId) {
      localStorage.removeItem(POPTU_USER_STATE_KEY)
      return
    }
    localStorage.setItem(
      POPTU_USER_STATE_KEY,
      JSON.stringify({
        v: 1,
        facultyId,
        sessionClicks: Math.max(0, Math.floor(sessionClicks) || 0),
      }),
    )
  } catch {
    /* ignore */
  }
}
