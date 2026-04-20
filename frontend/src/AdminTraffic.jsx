import { useCallback, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './admin-traffic.css'

const CHART_COLORS = [
  '#22d3ee',
  '#a78bfa',
  '#fb7185',
  '#34d399',
  '#fbbf24',
  '#60a5fa',
  '#c084fc',
  '#2dd4bf',
  '#f472b6',
  '#94a3b8',
]

function aggregateDailyFromEvents(events) {
  const map = new Map()
  for (const ev of events || []) {
    if (!ev?.created_at) continue
    const d = new Date(ev.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .map(([dateKey, eventsCount]) => ({
      dateKey,
      events: eventsCount,
      label: new Date(`${dateKey}T12:00:00`).toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'short',
      }),
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
}

function topEventTypes(rows, n = 10) {
  const list = [...(rows || [])].sort((a, b) => (Number(b.cnt) || 0) - (Number(a.cnt) || 0))
  return list.slice(0, n).map((r) => ({
    name: r.event_type || '—',
    value: Number(r.cnt) || 0,
  }))
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="admin-traffic__tooltip">
      {label != null && <div className="admin-traffic__tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="admin-traffic__tooltip-row">
          <span className="admin-traffic__tooltip-dot" style={{ background: p.color }} />
          <span>{p.name}</span>
          <strong>{typeof p.value === 'number' ? p.value.toLocaleString('th-TH') : p.value}</strong>
        </div>
      ))}
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

export default function AdminTraffic() {
  const [adminKey, setAdminKey] = useState('')
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
      setErr('ใส่รหัสเข้า admin')
      return
    }
    setLoading(true)
    try {
      const q = new URLSearchParams({ limit: '2000' })
      const res = await fetch(`${base}/api/admin/analytics?${q}`, {
        headers: { 'x-admin-key': adminKey.trim() },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.message || `HTTP ${res.status}`)
        return
      }
      setPayload(json)
    } catch (e) {
      setErr(e?.message || 'โหลดไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [adminKey, base])

  const dailySeries = useMemo(
    () => aggregateDailyFromEvents(payload?.events),
    [payload?.events],
  )

  const barData = useMemo(() => topEventTypes(payload?.by_event_type, 10), [payload?.by_event_type])

  const pieData = useMemo(() => {
    const rows = topEventTypes(payload?.by_event_type, 8)
    return rows.map((r) => ({ name: r.name, value: r.value }))
  }, [payload?.by_event_type])

  const topType = payload?.by_event_type?.length
    ? [...payload.by_event_type].sort((a, b) => (Number(b.cnt) || 0) - (Number(a.cnt) || 0))[0]
    : null

  const latestAt = payload?.events?.[0]?.created_at
    ? new Date(payload.events[0].created_at).toLocaleString('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—'

  const backToGame = () => {
    window.location.hash = '#poptu'
  }
  const goAbuse = () => {
    window.location.hash = '#admin/pop'
  }

  return (
    <div className={`admin-traffic${loading ? ' admin-traffic--busy' : ''}`} lang="th">
      <div className="admin-traffic__mesh" aria-hidden />
      <div className="admin-traffic__glow admin-traffic__glow--1" aria-hidden />
      <div className="admin-traffic__glow admin-traffic__glow--2" aria-hidden />

      <header className="admin-traffic__hero">
        <div>
          <p className="admin-traffic__eyebrow">พร้อมธรรม · internal</p>
          <h1 className="admin-traffic__title">Analytics dashboard</h1>
          <p className="admin-traffic__subtitle">
            สรุป traffic จาก <code>analytics_events</code> — อัปเดตแบบ on-demand
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="admin-traffic__btn-ghost" onClick={goAbuse}>
            POP abuse →
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
            ) : (
              'โหลดข้อมูล'
            )}
          </button>
        </div>
      </section>

      {err && (
        <div className="admin-traffic__banner admin-traffic__banner--err" role="alert">
          {err}
        </div>
      )}

      {payload?.status === 'success' && (
        <div className="admin-traffic__dash">
          <div className="admin-traffic__kpis">
            <KpiCard
              accent="cyan"
              label="เหตุการณ์ทั้งหมด (DB)"
              value={(payload.total ?? 0).toLocaleString('th-TH')}
              hint="นับจากตารางทั้งก้อน"
            />
            <KpiCard
              accent="violet"
              label="ในชุดตัวอย่าง"
              value={(payload.events?.length ?? 0).toLocaleString('th-TH')}
              hint="แถวล่าสุดที่ดึงมาแสดง"
            />
            <KpiCard
              accent="rose"
              label="อันดับ 1 event"
              value={topType ? String(topType.event_type) : '—'}
              hint={
                topType
                  ? `${Number(topType.cnt).toLocaleString('th-TH')} ครั้ง`
                  : 'ยังไม่มีข้อมูล'
              }
            />
            <KpiCard accent="emerald" label="เหตุการณ์ล่าสุด" value={latestAt} hint="จากแถวแรกของชุดตัวอย่าง" />
          </div>

          <div className="admin-traffic__charts">
            <section className="admin-traffic__panel">
              <div className="admin-traffic__panel-head">
                <h2 className="admin-traffic__panel-title">กิจกรรมตามวัน</h2>
                <p className="admin-traffic__panel-desc">รวมจากชุดล่าสุดที่โหลด (สูงสุด 2,000 แถว)</p>
              </div>
              <div className="admin-traffic__chart-box">
                {dailySeries.length === 0 ? (
                  <p className="admin-traffic__empty">ยังไม่มีข้อมูลตามวันในชุดนี้</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={dailySeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="adminAreaFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 6" stroke="rgba(148,163,184,0.12)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        dy={6}
                      />
                      <YAxis
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={36}
                      />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(34,211,238,0.35)' }} />
                      <Area
                        type="monotone"
                        dataKey="events"
                        name="เหตุการณ์"
                        stroke="#22d3ee"
                        strokeWidth={2.5}
                        fill="url(#adminAreaFill)"
                        dot={{ fill: '#0f172a', stroke: '#22d3ee', strokeWidth: 2, r: 3 }}
                        activeDot={{ r: 5, strokeWidth: 0, fill: '#e0f2fe' }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="admin-traffic__panel">
              <div className="admin-traffic__panel-head">
                <h2 className="admin-traffic__panel-title">สัดส่วน event_type</h2>
                <p className="admin-traffic__panel-desc">8 อันดับแรกจากสรุปทั้งระบบ</p>
              </div>
              <div className="admin-traffic__chart-box admin-traffic__chart-box--split">
                {pieData.length === 0 ? (
                  <p className="admin-traffic__empty">ยังไม่มีข้อมูล</p>
                ) : (
                  <>
                    <div className="admin-traffic__pie-wrap">
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={58}
                            outerRadius={92}
                            paddingAngle={2}
                            stroke="none"
                          >
                            {pieData.map((_, i) => (
                              <Cell key={pieData[i].name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="admin-traffic__legend">
                      {pieData.map((row, i) => (
                        <li key={row.name} className="admin-traffic__legend-item">
                          <span
                            className="admin-traffic__legend-swatch"
                            style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                          />
                          <span className="admin-traffic__legend-name">{row.name}</span>
                          <span className="admin-traffic__legend-val">
                            {row.value.toLocaleString('th-TH')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </section>
          </div>

          <section className="admin-traffic__panel admin-traffic__panel--wide">
            <div className="admin-traffic__panel-head">
              <h2 className="admin-traffic__panel-title">ปริมาณตามประเภท (Top 10)</h2>
              <p className="admin-traffic__panel-desc">แท่งแนวนอน — อ่านชื่อ event ยาวได้สะดวก</p>
            </div>
            <div className="admin-traffic__chart-box admin-traffic__chart-box--tall">
              {barData.length === 0 ? (
                <p className="admin-traffic__empty">ยังไม่มีข้อมูล</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(320, barData.length * 36)}>
                  <BarChart layout="vertical" data={barData} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 6" stroke="rgba(148,163,184,0.1)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ fill: '#cbd5e1', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(167,139,250,0.08)' }} />
                    <Bar dataKey="value" name="จำนวน" radius={[0, 8, 8, 0]} barSize={14}>
                      {barData.map((_, i) => (
                        <Cell key={barData[i].name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="admin-traffic__panel admin-traffic__panel--wide">
            <div className="admin-traffic__panel-head">
              <h2 className="admin-traffic__panel-title">เหตุการณ์ล่าสุด</h2>
              <p className="admin-traffic__panel-desc">ตารางดิบ — scroll ภายในกรอบ</p>
            </div>
            <div className="admin-traffic__table-wrap">
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
                      <td className="admin-traffic__td-nowrap">
                        {ev.created_at ? new Date(ev.created_at).toLocaleString('th-TH') : '—'}
                      </td>
                      <td>
                        <span className="admin-traffic__pill">{ev.event_type}</span>
                      </td>
                      <td className="admin-traffic__td-clip" title={ev.path || ''}>
                        {ev.path || '—'}
                      </td>
                      <td className="admin-traffic__td-clip" title={ev.device || ''}>
                        {ev.device
                          ? ev.device.length > 64
                            ? `${ev.device.slice(0, 64)}…`
                            : ev.device
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
