import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './admin-traffic.css'

const POLL_INTERVAL_MS = 5000
/** How many snapshots to keep for velocity math (5s * 24 = 2 min window). */
const SNAPSHOT_HISTORY = 24
/** Sustained pops/sec that trips the abuse flag. Matches the server per-IP
 *  burst cap (24/s) — if a single faculty exceeds this rolling, abuse is likely. */
const ABUSE_VELOCITY_THRESHOLD = 24
const LS_ADMIN_KEY = 'poptu:admin-key'

function fmtDuration(sec) {
  const n = Math.max(0, Math.floor(Number(sec) || 0))
  if (n < 60) return `${n}s`
  const m = Math.floor(n / 60)
  const s = n % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return '—'
  return Number(n).toLocaleString('th-TH')
}

function fmtRate(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1) return n.toFixed(2)
  if (n < 10) return n.toFixed(1)
  return Math.round(n).toLocaleString('th-TH')
}

export default function AdminPopAbuse() {
  const [adminKey, setAdminKey] = useState(() => {
    try {
      return localStorage.getItem(LS_ADMIN_KEY) || ''
    } catch {
      return ''
    }
  })
  const [authed, setAuthed] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const historyRef = useRef([])

  const base = useMemo(() => {
    const raw = (import.meta.env && import.meta.env.VITE_API_URL) || ''
    return raw ? String(raw).replace(/\/?$/, '') : ''
  }, [])

  const load = useCallback(async () => {
    setErr(null)
    if (!base) {
      setErr('ยังไม่ตั้ง VITE_API_URL — เรียก API ไม่ได้')
      return
    }
    const key = adminKey.trim()
    if (!key) {
      setErr('ใส่รหัสเข้า admin')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`${base}/api/admin/pop-abuse`, {
        headers: { 'x-admin-key': key },
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message || `HTTP ${res.status}`)
        setAuthed(false)
        return
      }
      setAuthed(true)
      const captured = {
        at: Date.now(),
        now: json.now,
        faculties: json.faculties || [],
        banned: json.banned_ips || [],
        limits: json.limits || {},
        writeBehind: !!json.write_behind_enabled,
      }
      setSnapshot(captured)
      const hist = historyRef.current
      hist.push(captured)
      if (hist.length > SNAPSHOT_HISTORY) hist.splice(0, hist.length - SNAPSHOT_HISTORY)
      try {
        localStorage.setItem(LS_ADMIN_KEY, key)
      } catch {
        /* storage disabled / quota */
      }
    } catch (e) {
      setErr(e?.message || 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [adminKey, base])

  useEffect(() => {
    if (!authed || !autoRefresh) return undefined
    const iv = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(iv)
  }, [authed, autoRefresh, load])

  /** Velocity over the rolling window: (latest.count - earliest.count) / seconds.
   *  Falls back to NaN when we don't have enough samples yet. */
  const rows = useMemo(() => {
    if (!snapshot) return []
    const hist = historyRef.current
    const first = hist[0]
    const latest = hist[hist.length - 1] || snapshot
    const spanSec = first && latest && latest.at > first.at ? (latest.at - first.at) / 1000 : 0
    const firstById = new Map((first?.faculties || []).map((r) => [r.id, r]))
    return (snapshot.faculties || []).map((r, idx) => {
      const prev = firstById.get(r.id)
      const delta = prev ? r.count - Number(prev.count || 0) : 0
      const velocity = spanSec > 0 && delta > 0 ? delta / spanSec : 0
      return {
        ...r,
        rank: idx + 1,
        delta,
        velocity,
        flagged: velocity >= ABUSE_VELOCITY_THRESHOLD,
      }
    })
  }, [snapshot])

  const totals = useMemo(() => {
    if (!snapshot) return { count: 0, pending: 0 }
    return (snapshot.faculties || []).reduce(
      (a, r) => ({
        count: a.count + (Number(r.count) || 0),
        pending: a.pending + (Number(r.pending) || 0),
      }),
      { count: 0, pending: 0 },
    )
  }, [snapshot])

  const flaggedRows = useMemo(() => rows.filter((r) => r.flagged), [rows])
  const topAbusers = useMemo(() => {
    return [...rows]
      .filter((r) => r.velocity > 0)
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 5)
  }, [rows])

  const backToTraffic = () => {
    window.location.hash = '#admin'
  }
  const backToGame = () => {
    window.location.hash = '#poptu'
  }

  return (
    <div className={`admin-traffic${loading ? ' admin-traffic--busy' : ''}`} lang="th">
      <div className="admin-traffic__mesh" aria-hidden />
      <div className="admin-traffic__glow admin-traffic__glow--1" aria-hidden />
      <div className="admin-traffic__glow admin-traffic__glow--2" aria-hidden />

      <header className="admin-traffic__hero">
        <div>
          <p className="admin-traffic__eyebrow">พร้อมธรรม · abuse monitor</p>
          <h1 className="admin-traffic__title">POP abuse dashboard</h1>
          <p className="admin-traffic__subtitle">
            ดูคะแนน / คิวที่ค้าง / IP ที่โดนแบน พร้อม velocity realtime (polling ทุก {POLL_INTERVAL_MS / 1000} วินาที)
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="admin-traffic__btn-ghost" onClick={backToTraffic}>
            ← Traffic
          </button>
          <button type="button" className="admin-traffic__btn-ghost" onClick={backToGame}>
            ← กลับเกม
          </button>
        </div>
      </header>

      {!base && (
        <div className="admin-traffic__banner admin-traffic__banner--warn" role="status">
          ตั้งค่า <code>VITE_API_URL</code> ให้ชี้ไปที่ backend ก่อน
        </div>
      )}

      <section className="admin-traffic__auth">
        <div className="admin-traffic__auth-inner">
          <label className="admin-traffic__field">
            <span className="admin-traffic__field-label">รหัสเข้า admin</span>
            <input
              className="admin-traffic__field-input"
              type="password"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="พิมพ์รหัส"
            />
          </label>
          <button
            type="button"
            className="admin-traffic__btn-primary"
            onClick={load}
            disabled={loading || !base}
          >
            {loading ? (
              <>
                <span className="admin-traffic__spinner" aria-hidden />
                กำลังโหลด…
              </>
            ) : authed ? (
              'รีเฟรชตอนนี้'
            ) : (
              'เริ่มมอนิเตอร์'
            )}
          </button>
          {authed && (
            <label className="admin-traffic__field" style={{ maxWidth: 180 }}>
              <span className="admin-traffic__field-label">Auto-refresh</span>
              <button
                type="button"
                className="admin-traffic__btn-ghost"
                onClick={() => setAutoRefresh((v) => !v)}
                style={{ width: '100%' }}
              >
                {autoRefresh ? 'หยุด' : 'เริ่ม'}
              </button>
            </label>
          )}
        </div>
      </section>

      {err && (
        <div className="admin-traffic__banner admin-traffic__banner--err" role="alert">
          {err}
        </div>
      )}

      {snapshot && (
        <div className="admin-traffic__dash">
          {flaggedRows.length > 0 && (
            <div
              className="admin-traffic__banner admin-traffic__banner--err"
              role="alert"
              style={{ fontWeight: 600 }}
            >
              🚨 {flaggedRows.length} คณะ velocity เกิน {ABUSE_VELOCITY_THRESHOLD}/s —{' '}
              {flaggedRows
                .slice(0, 3)
                .map((r) => `${r.emoji || ''} ${r.name} (${fmtRate(r.velocity)}/s)`)
                .join(', ')}
            </div>
          )}

          <div className="admin-traffic__kpis">
            <KpiCard
              accent="cyan"
              label="รวมคะแนนทุกคณะ"
              value={fmtNum(totals.count)}
              hint={`${(snapshot.faculties || []).length} คณะ`}
            />
            <KpiCard
              accent="violet"
              label="คิวค้าง (pending)"
              value={fmtNum(totals.pending)}
              hint={snapshot.writeBehind ? 'write-behind active' : 'write-behind off'}
            />
            <KpiCard
              accent="rose"
              label="IP ถูกแบน"
              value={fmtNum((snapshot.banned || []).length)}
              hint={`block ${fmtDuration(snapshot.limits.block_sec)}`}
            />
            <KpiCard
              accent="emerald"
              label="Rate limit / IP"
              value={`${snapshot.limits.per_sec ?? '—'}/s · ${snapshot.limits.per_min ?? '—'}/min`}
              hint={`violate ${snapshot.limits.violations_to_block ?? '—'} ครั้ง/${fmtDuration(
                snapshot.limits.violation_window_sec,
              )} → ban`}
            />
          </div>

          {topAbusers.length > 0 && (
            <section className="admin-traffic__panel admin-traffic__panel--wide">
              <div className="admin-traffic__panel-head">
                <h2 className="admin-traffic__panel-title">Top velocity (รอบ monitoring ล่าสุด)</h2>
                <p className="admin-traffic__panel-desc">
                  ถ้ามีคณะใดสูงผิดปกติเทียบกับวันปกติ = มีแนวโน้มโดน script
                </p>
              </div>
              <div className="admin-traffic__table-wrap">
                <table className="admin-traffic__table">
                  <thead>
                    <tr>
                      <th>คณะ</th>
                      <th style={{ textAlign: 'right' }}>Δ ช่วงที่ผ่านมา</th>
                      <th style={{ textAlign: 'right' }}>velocity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAbusers.map((r) => (
                      <tr key={r.id} className={r.flagged ? 'admin-traffic__row--flagged' : ''}>
                        <td>
                          <span aria-hidden="true" style={{ marginRight: 6 }}>
                            {r.emoji}
                          </span>
                          {r.name}
                        </td>
                        <td style={{ textAlign: 'right' }}>+{fmtNum(r.delta)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtRate(r.velocity)}/s {r.flagged && '🚩'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="admin-traffic__panel admin-traffic__panel--wide">
            <div className="admin-traffic__panel-head">
              <h2 className="admin-traffic__panel-title">ทุกคณะ</h2>
              <p className="admin-traffic__panel-desc">
                อัปเดตล่าสุด{' '}
                {snapshot.now ? new Date(snapshot.now).toLocaleTimeString('th-TH') : '—'} ·
                ประวัติ {historyRef.current.length}/{SNAPSHOT_HISTORY}
              </p>
            </div>
            <div className="admin-traffic__table-wrap">
              <table className="admin-traffic__table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>คณะ</th>
                    <th style={{ textAlign: 'right' }}>คะแนน</th>
                    <th style={{ textAlign: 'right' }}>pending</th>
                    <th style={{ textAlign: 'right' }}>velocity</th>
                    <th>อัปเดต</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.flagged ? 'admin-traffic__row--flagged' : ''}>
                      <td>{r.rank}</td>
                      <td>
                        <span aria-hidden="true" style={{ marginRight: 6 }}>
                          {r.emoji}
                        </span>
                        {r.name}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtNum(r.count)}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {r.pending ? fmtNum(r.pending) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {r.velocity > 0 ? `${fmtRate(r.velocity)}/s` : '—'}{' '}
                        {r.flagged && '🚩'}
                      </td>
                      <td className="admin-traffic__td-nowrap">
                        {r.updated_at
                          ? new Date(r.updated_at).toLocaleTimeString('th-TH')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-traffic__panel admin-traffic__panel--wide">
            <div className="admin-traffic__panel-head">
              <h2 className="admin-traffic__panel-title">IP ที่โดนแบน</h2>
              <p className="admin-traffic__panel-desc">
                เกิน{' '}
                {snapshot.limits.violations_to_block ?? '—'} violation ภายใน{' '}
                {fmtDuration(snapshot.limits.violation_window_sec)} → banned{' '}
                {fmtDuration(snapshot.limits.block_sec)}
              </p>
            </div>
            <div className="admin-traffic__table-wrap">
              {snapshot.banned.length === 0 ? (
                <p className="admin-traffic__empty">ไม่มี IP ที่ถูกแบนตอนนี้</p>
              ) : (
                <table className="admin-traffic__table">
                  <thead>
                    <tr>
                      <th>IP</th>
                      <th style={{ textAlign: 'right' }}>ปลดแบนอีก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.banned.map((b) => (
                      <tr key={b.ip}>
                        <td>
                          <code>{b.ip}</code>
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmtDuration(b.ttl_sec)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, hint, accent }) {
  return (
    <article className={`admin-traffic__kpi admin-traffic__kpi--${accent}`}>
      <p className="admin-traffic__kpi-label">{label}</p>
      <p className="admin-traffic__kpi-value">{value}</p>
      {hint && <p className="admin-traffic__kpi-hint">{hint}</p>}
    </article>
  )
}
