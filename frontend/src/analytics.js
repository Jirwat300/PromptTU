import { API_BASE } from './poptu/constants.js'

/**
 * Fire-and-forget POST to backend analytics (requires VITE_API_URL in prod).
 * @param {Record<string, unknown>} fields
 */
export function sendAnalytics(fields) {
  if (!API_BASE || typeof fetch === 'undefined') return
  const body = {
    event_type: fields.event_type || 'event',
    path:
      typeof window !== 'undefined'
        ? `${window.location.pathname || ''}${window.location.hash || ''}`
        : null,
    device: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    watchtower: fields.watchtower ?? null,
    metadata: fields.metadata ?? null,
    user_id: fields.user_id ?? null,
    ...fields,
  }
  void fetch(`${API_BASE.replace(/\/?$/, '')}/api/analytics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}

export function sendPoptuPageView() {
  sendAnalytics({ event_type: 'poptu_page' })
}
