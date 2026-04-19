import { useCallback, useMemo, useState } from 'react'
import './admin-traffic.css'

const STORAGE_KEY = 'poptu-admin-analytics-key'

export default function AdminTraffic() {
  const [adminKey, setAdminKey] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [payload, setPayload] = useState(null)

  const base = useMemo(() => {
    const raw = (import.meta.env && import.meta.env.VITE_API_URL) || ''
    return raw ? String(raw).replace(/\/?$/, '') : ''
  }, [])

  const load = useCallback(async () => {
    setErr(null)
    setPayload(null)
    if (!base) {
      setErr('ยังไม่ตั้ง VITE_API_URL — เรียก API ไม่ได้')
      return
    }
    if (!adminKey.trim()) {
      setErr('ใส่ Admin key (ค่าเดียวกับ ADMIN_ANALYTICS_SECRET บนเซิร์ฟเวอร์)')
      return
    }
    setLoading(true)
    try {
      const q = new URLSearchParams({ limit: '400' })
      const res = await fetch(`${base}/api/admin/analytics?${q}`, {
        headers: { 'x-admin-key': adminKey.trim() },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message || `HTTP ${res.status}`)
        return
      }
      setPayload(json)
      try {
        sessionStorage.setItem(STORAGE_KEY, adminKey.trim())
      } catch {
        /* ignore */
      }
    } catch (e) {
      setErr(e?.message || 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [adminKey, base])

  const backToGame = () => {
    window.location.hash = '#poptu'
  }

  return (
    <div className="admin-traffic" lang="th">
      <header className="admin-traffic__header">
        <h1 className="admin-traffic__title">Traffic · Admin</h1>
        <button type="button" className="admin-traffic__link" onClick={backToGame}>
          ← กลับ POPTU
        </button>
      </header>

      {!base && (
        <p className="admin-traffic__warn">
          ตั้งค่า <code>VITE_API_URL</code> ให้ชี้ไปที่ backend ก่อน
        </p>
      )}

      <section className="admin-traffic__panel">
        <label className="admin-traffic__label">
          Admin key
          <input
            className="admin-traffic__input"
            type="password"
            autoComplete="off"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="ADMIN_ANALYTICS_SECRET"
          />
        </label>
        <button
          type="button"
          className="admin-traffic__btn"
          onClick={load}
          disabled={loading || !base}
        >
          {loading ? 'กำลังโหลด…' : 'โหลดข้อมูล'}
        </button>
      </section>

      {err && <p className="admin-traffic__err" role="alert">{err}</p>}

      {payload?.status === 'success' && (
        <>
          <p className="admin-traffic__meta">
            ทั้งหมด <strong>{payload.total ?? '—'}</strong> แถว · แสดงล่าสุด{' '}
            <strong>{payload.events?.length ?? 0}</strong> แถว
          </p>

          {payload.by_event_type?.length > 0 && (
            <div className="admin-traffic__card">
              <h2>ตาม event_type</h2>
              <table className="admin-traffic__table admin-traffic__table--compact">
                <thead>
                  <tr>
                    <th>event_type</th>
                    <th className="admin-traffic__num">จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.by_event_type.map((row) => (
                    <tr key={row.event_type}>
                      <td><code>{row.event_type}</code></td>
                      <td className="admin-traffic__num">{row.cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="admin-traffic__card">
            <h2>เหตุการณ์ล่าสุด</h2>
            <div className="admin-traffic__scroll">
              <table className="admin-traffic__table">
                <thead>
                  <tr>
                    <th>เวลา</th>
                    <th>type</th>
                    <th>path</th>
                    <th>device</th>
                  </tr>
                </thead>
                <tbody>
                  {(payload.events || []).map((ev) => (
                    <tr key={ev.id}>
                      <td className="admin-traffic__nowrap">
                        {ev.created_at ? new Date(ev.created_at).toLocaleString('th-TH') : '—'}
                      </td>
                      <td><code>{ev.event_type}</code></td>
                      <td className="admin-traffic__clip">{ev.path || '—'}</td>
                      <td className="admin-traffic__clip" title={ev.device || ''}>
                        {ev.device
                          ? ev.device.length > 52
                            ? `${ev.device.slice(0, 52)}…`
                            : ev.device
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
