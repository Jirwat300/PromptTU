import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './poptu.css'
import lizard1 from './assets/Lizard1.PNG'
import lizard2 from './assets/Lizard2.PNG'
import lizard3 from './assets/Lizard3.PNG'
import lizard4 from './assets/Lizard4.PNG'
import lizard5 from './assets/Lizard5.PNG'
import lizard6 from './assets/Lizard6.PNG'

/* =========================================================================
 * POP TU — Popcat-style clicker themed as a Windows 95 desktop app.
 *
 * Features:
 *   - Faculty picker (blocks the game until a faculty is chosen)
 *   - Clickable lizard that RANDOMLY swaps to one of 6 PNGs each click
 *   - Big blue 4-digit LCD counter (turns red when anti-cheat catches you)
 *   - Per-faculty Rankings window — REAL, shared via backend API
 *     (GET /api/ranking/scores, POST /api/ranking/pop)
 *   - Anti-autoclicker: statistical check on click-interval variance + CPS
 *   - Retro ERROR dialog + counter reset when cheating is detected
 *   - Bottom taskbar with Home button that returns to the main site
 * ========================================================================= */

/** Thammasat University faculties — keep each id stable for persistence */
const FACULTIES = [
  { id: 'arch',    emoji: '🏛️', name: 'คณะสถาปัตยกรรมศาสตร์และการผังเมือง' },
  { id: 'law',     emoji: '⚖️', name: 'คณะนิติศาสตร์' },
  { id: 'comm',    emoji: '📊', name: 'คณะพาณิชยศาสตร์และการบัญชี' },
  { id: 'polsci',  emoji: '🏛️', name: 'คณะรัฐศาสตร์' },
  { id: 'econ',    emoji: '💹', name: 'คณะเศรษฐศาสตร์' },
  { id: 'soc',     emoji: '🤝', name: 'คณะสังคมสงเคราะห์ศาสตร์' },
  { id: 'anthro',  emoji: '👥', name: 'คณะสังคมวิทยาและมานุษยวิทยา' },
  { id: 'arts',    emoji: '📚', name: 'คณะศิลปศาสตร์' },
  { id: 'journ',   emoji: '📰', name: 'คณะวารสารศาสตร์และสื่อสารมวลชน' },
  { id: 'sci',     emoji: '🔬', name: 'คณะวิทยาศาสตร์และเทคโนโลยี' },
  { id: 'eng',     emoji: '⚙️', name: 'คณะวิศวกรรมศาสตร์' },
  { id: 'fine',    emoji: '🎨', name: 'คณะศิลปกรรมศาสตร์' },
  { id: 'med',     emoji: '🩺', name: 'คณะแพทยศาสตร์' },
  { id: 'dent',    emoji: '🦷', name: 'คณะทันตแพทยศาสตร์' },
  { id: 'nurse',   emoji: '💉', name: 'คณะพยาบาลศาสตร์' },
  { id: 'pub',     emoji: '🏥', name: 'คณะสาธารณสุขศาสตร์' },
  { id: 'allied',  emoji: '🧪', name: 'คณะสหเวชศาสตร์' },
  { id: 'inter',   emoji: '🌏', name: 'วิทยาลัยนานาชาติปรีดี พนมยงค์' },
  { id: 'learn',   emoji: '🎓', name: 'วิทยาลัยสหวิทยาการ' },
]

const MAX_CLICK_BUFFER = 20 // how many recent click timestamps we analyse
const CPS_CAP = 25          // >25 clicks/sec sustained ⇒ almost certainly a bot
const JITTER_MIN = 0.08     // stdev/mean threshold. Humans jitter ≳ 0.15

/** Backend base URL. Configure via `VITE_API_URL` in frontend/.env.
 *  Fallback: same origin `/api`. If the frontend is hosted separately from
 *  the backend, set VITE_API_URL to the backend's Vercel URL.             */
const API_BASE = (import.meta.env && import.meta.env.VITE_API_URL) || ''
const RANKING_REFRESH_MS = 4000   // how often we re-poll the leaderboard
const POP_FLUSH_MS = 800          // batch window for /api/ranking/pop

/* ----------------------------- Lizard poses ---------------------------- */
/* Every click picks a random pose from this array (always different from
 * the current one, so the image always changes).                          */
const LIZARD_POSES = [lizard1, lizard2, lizard3, lizard4, lizard5, lizard6]

function pickRandomPose(currentSrc) {
  if (LIZARD_POSES.length <= 1) return LIZARD_POSES[0]
  // Pick any index except the current one.
  const pool = LIZARD_POSES.filter((src) => src !== currentSrc)
  return pool[Math.floor(Math.random() * pool.length)]
}

function Lizard({ src }) {
  return (
    <img
      src={src}
      alt="Lizard mascot"
      className="lizard-img"
      draggable={false}
    />
  )
}

/* ---------------------------- 7-segment digit -------------------------- */

// 7-segment lookup — each value is the set of lit segments.
const SEG_MAP = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
}

function LcdDigit({ char }) {
  const lit = SEG_MAP[char] || []
  return (
    <div className="lcd-digit" aria-hidden="true">
      {['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((seg) => (
        <div key={seg} className={`seg ${seg}${lit.includes(seg) ? ' on' : ''}`} />
      ))}
    </div>
  )
}

function Lcd({ value, caught }) {
  const padded = String(Math.max(0, Math.floor(value))).padStart(4, '0')
  return (
    <div className={`lcd ${caught ? 'lcd--red' : 'lcd--on'}`} role="status" aria-label={`Score ${value}`}>
      {padded.split('').map((ch, i) => <LcdDigit key={i} char={ch} />)}
    </div>
  )
}

/* ------------------------- Faculty picker modal ------------------------ */

function FacultyPicker({ onPick }) {
  const [selected, setSelected] = useState(FACULTIES[0].id)
  return (
    <div className="poptu-modal-root" role="dialog" aria-modal="true" aria-labelledby="fp-title">
      <div className="win-dialog" style={{ width: 'min(420px, 100%)' }}>
        <div className="win-titlebar">
          <span className="win-title" id="fp-title">เลือกคณะก่อนเริ่มเล่น</span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" aria-label="Minimise">_</button>
          </div>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 10px' }}>
            <img
              src={lizard5}
              alt=""
              aria-hidden="true"
              style={{ width: 72, height: 'auto', flexShrink: 0 }}
              draggable={false}
            />
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.35 }}>
              เลือกคณะของคุณเพื่อช่วยสะสมคะแนนให้คณะในตาราง Rankings
            </p>
          </div>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{
              width: '100%', fontSize: 13, padding: '4px 6px',
              border: '2px solid #000',
              boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff',
              background: '#fff',
            }}
          >
            {FACULTIES.map((f) => (
              <option key={f.id} value={f.id}>{f.emoji} {f.name}</option>
            ))}
          </select>
        </div>
        <div className="win-dialog-actions">
          <button type="button" className="w95-btn" onClick={() => onPick(selected)}>เริ่มเล่น</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------- Error dialog ---------------------------- */

function ErrorDialog({ onOk }) {
  return (
    <div className="poptu-modal-root" role="alertdialog" aria-modal="true" aria-labelledby="err-title">
      <div className="win-dialog">
        <div className="win-titlebar">
          <span className="win-title" id="err-title">ERROR</span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" onClick={onOk} aria-label="Close">×</button>
          </div>
        </div>
        <div className="win-dialog-body">
          <div className="win-err-icon" aria-hidden="true">×</div>
          <div className="win-dialog-msg">อย่าโกง ผมจับได้นะ !!!</div>
        </div>
        <div className="win-dialog-actions">
          <button type="button" className="w95-btn" onClick={onOk} autoFocus>OK</button>
        </div>
      </div>
    </div>
  )
}

/* ================================ Page ================================ */

export default function PopTu() {
  const [facultyId, setFacultyId] = useState(null)
  /** Server-truth scores keyed by faculty id. Starts empty; populated on mount. */
  const [scores, setScores] = useState({})
  /** Random current pose image src */
  const [poseSrc, setPoseSrc] = useState(lizard1)
  const [caught, setCaught] = useState(false)
  const [errOpen, setErrOpen] = useState(false)
  const [floaters, setFloaters] = useState([])
  const [popAnim, setPopAnim] = useState(0)

  const clickTimes = useRef([])
  const floaterIdRef = useRef(0)

  /** Pending click deltas per faculty that haven't been flushed to the backend yet. */
  const pendingDeltaRef = useRef(0)
  const flushTimerRef = useRef(null)
  /** Locally applied (optimistic) additions per faculty we've already rendered in the
   *  counter but are still waiting for the server round-trip to confirm. */
  const optimisticRef = useRef({})

  // Mark body for theme background
  useEffect(() => {
    document.body.classList.add('poptu-active')
    return () => document.body.classList.remove('poptu-active')
  }, [])

  // -------------------- Fetch scores from backend --------------------
  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ranking/scores`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      if (json?.scores) {
        // Merge server truth with any still-pending optimistic adds so the
        // user doesn't see their own clicks roll back during a refresh.
        const merged = { ...json.scores }
        for (const [id, add] of Object.entries(optimisticRef.current)) {
          merged[id] = (merged[id] ?? 0) + add
        }
        setScores(merged)
      }
    } catch {
      /* network hiccup — we'll try again on the next poll */
    }
  }, [])

  useEffect(() => {
    // Kick off an immediate fetch, then poll every RANKING_REFRESH_MS.
    // The state update inside `fetchScores` is awaited (async), so it won't
    // trigger a render inside the effect body itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchScores()
    const iv = setInterval(fetchScores, RANKING_REFRESH_MS)
    return () => clearInterval(iv)
  }, [fetchScores])

  // -------------------- Flush pending clicks to backend --------------------
  const flushPending = useCallback(async () => {
    if (!facultyId) return
    const delta = pendingDeltaRef.current
    if (delta <= 0) return
    pendingDeltaRef.current = 0

    // mark as optimistic so concurrent refreshes don't overwrite
    optimisticRef.current[facultyId] = (optimisticRef.current[facultyId] ?? 0) + delta

    try {
      const res = await fetch(`${API_BASE}/api/ranking/pop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faculty_id: facultyId, delta }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && typeof json?.count === 'number') {
        // reconcile: server now knows about the delta we just sent, drop it
        optimisticRef.current[facultyId] = Math.max(
          (optimisticRef.current[facultyId] ?? 0) - delta,
          0,
        )
        setScores((prev) => ({ ...prev, [facultyId]: json.count + (optimisticRef.current[facultyId] ?? 0) }))
      } else {
        // roll back optimistic add on error
        optimisticRef.current[facultyId] = Math.max(
          (optimisticRef.current[facultyId] ?? 0) - delta,
          0,
        )
      }
    } catch {
      // network failure: roll back optimistic add and requeue delta
      optimisticRef.current[facultyId] = Math.max(
        (optimisticRef.current[facultyId] ?? 0) - delta,
        0,
      )
      pendingDeltaRef.current += delta
    }
  }, [facultyId])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      flushPending()
    }, POP_FLUSH_MS)
  }, [flushPending])

  // Flush outstanding clicks on unmount / page hide
  useEffect(() => {
    const onHide = () => { flushPending() }
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      flushPending()
    }
  }, [flushPending])

  // -------------------- Anti-cheat --------------------
  const detectCheating = useCallback(() => {
    const buf = clickTimes.current
    if (buf.length < MAX_CLICK_BUFFER) return false
    const deltas = []
    for (let i = 1; i < buf.length; i++) deltas.push(buf[i] - buf[i - 1])
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length
    const variance = deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length
    const stdev = Math.sqrt(variance)
    const jitter = mean > 0 ? stdev / mean : 0
    const cps = 1000 / Math.max(1, mean)

    if (cps > CPS_CAP) return true
    if (mean < 90 && jitter < JITTER_MIN) return true
    return false
  }, [])

  // -------------------- Click handler --------------------
  const onLizardClick = useCallback(() => {
    if (caught || errOpen || !facultyId) return
    const now = Date.now()
    const buf = clickTimes.current
    buf.push(now)
    if (buf.length > MAX_CLICK_BUFFER) buf.shift()

    // Random pose (always different from the current one)
    setPoseSrc((cur) => pickRandomPose(cur))
    setPopAnim((n) => n + 1)

    // Optimistic local bump so the LCD feels instant
    setScores((prev) => ({ ...prev, [facultyId]: (prev[facultyId] ?? 0) + 1 }))
    pendingDeltaRef.current += 1
    scheduleFlush()

    // Floater +1
    const fid = ++floaterIdRef.current
    setFloaters((fs) => [...fs, { id: fid }])
    setTimeout(() => setFloaters((fs) => fs.filter((f) => f.id !== fid)), 700)

    // Anti-cheat
    if (detectCheating()) {
      setCaught(true)
      setErrOpen(true)
      // Penalty: roll back 100 optimistic pts locally (server stays authoritative)
      setScores((prev) => {
        const penalty = 100
        const cur = prev[facultyId] ?? 0
        return { ...prev, [facultyId]: Math.max(cur - penalty, 0) }
      })
    }
  }, [caught, errOpen, facultyId, detectCheating, scheduleFlush])

  const closeError = useCallback(() => {
    setErrOpen(false)
    setCaught(false)
    clickTimes.current = []
  }, [])

  const goHome = useCallback(() => {
    // flush any queued pops before navigating away
    flushPending()
    window.location.hash = ''
  }, [flushPending])

  const myCount = facultyId ? scores[facultyId] ?? 0 : 0

  const rankings = useMemo(() => {
    return FACULTIES
      .map((f) => ({ ...f, score: scores[f.id] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
  }, [scores])

  const currentFaculty = FACULTIES.find((f) => f.id === facultyId)

  return (
    <main className="poptu">
      <section className="poptu-window" aria-label="POP TU window">
        <header className="win-titlebar">
          <span className="win-title">POP TU</span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" aria-label="Minimise">_</button>
            <button type="button" className="win-btn" aria-label="Maximise">□</button>
            <button type="button" className="win-btn" aria-label="Close" onClick={goHome}>×</button>
          </div>
        </header>

        <div className="win-menubar" aria-hidden="true">
          <span><u>F</u>ile</span>
          <span><u>E</u>dit</span>
          <span><u>V</u>iew</span>
          <span><u>H</u>elp</span>
        </div>

        <div className="poptu-body">
          {/* Rankings window */}
          <section className="rankings-window" aria-label="Rankings">
            <header className="win-titlebar">
              <span className="win-title">Rankings</span>
              <div className="win-title-btns">
                <button type="button" className="win-btn" aria-label="Minimise">_</button>
                <button type="button" className="win-btn" aria-label="Maximise">□</button>
                <button type="button" className="win-btn" aria-label="Close">×</button>
              </div>
            </header>
            <div className="rankings-body">
              {rankings.map((r, i) => (
                <div key={r.id} className="ranking-row">
                  <span className="ranking-num">{i + 1}</span>
                  <span className="ranking-faculty" title={r.name}>{r.name}</span>
                  <span className="ranking-score">{r.score.toLocaleString('en-US')} POP</span>
                </div>
              ))}
              {rankings.length === 0 && (
                <div className="ranking-row" style={{ opacity: 0.6 }}>
                  <span className="ranking-faculty">กำลังโหลด…</span>
                </div>
              )}
            </div>
          </section>

          {/* LCD counter */}
          <div className="lcd-wrap">
            <Lcd value={myCount} caught={caught} />
          </div>

          {/* Lizard stage */}
          <div className="lizard-stage">
            <div className="lizard-wrap">
              <button
                type="button"
                className="lizard-btn"
                onClick={onLizardClick}
                aria-label="Pop the lizard"
              >
                {/* key re-mounts only the inner span so CSS animation restarts
                    on every click — the button itself keeps focus. */}
                <span className="lizard-pop-anchor" key={popAnim}>
                  <Lizard src={poseSrc} />
                </span>
              </button>
              <div className="floater-layer" aria-hidden="true">
                {floaters.map((f) => (
                  <span key={f.id} className="floater">+1</span>
                ))}
              </div>
            </div>
          </div>

          {/* Faculty fieldset */}
          <fieldset className="fieldset">
            <legend>Faculty</legend>
            <div className="faculty-row">
              <span className="faculty-emoji" aria-hidden="true">
                {currentFaculty ? currentFaculty.emoji : '😀'}
              </span>
              <span className="faculty-name">
                {currentFaculty ? currentFaculty.name : 'ยังไม่ได้เลือกคณะ'}
              </span>
              <button
                type="button"
                className="w95-btn"
                onClick={() => {
                  // flush any pending clicks for the previous faculty first
                  flushPending()
                  setFacultyId(null)
                }}
              >เปลี่ยน</button>
            </div>
          </fieldset>

          <p className="poptu-credit">สื่อดิจิทัลนี้จัดทำและเว็บไซต์นี้จัดทำโดย พรรคพร้อมธรรม</p>
        </div>
      </section>

      {/* faculty picker shown until chosen */}
      {facultyId === null && (
        <FacultyPicker onPick={(id) => {
          setFacultyId(id)
          clickTimes.current = []
        }} />
      )}

      {/* cheat error */}
      {errOpen && <ErrorDialog onOk={closeError} />}

      {/* bottom taskbar */}
      <nav className="poptu-taskbar" aria-label="Taskbar">
        <button
          type="button"
          className="taskbar-item taskbar-item--home"
          onClick={goHome}
          title="ไปหน้าหลักเว็บพร้อมธรรม"
        >
          <span className="taskbar-icon" aria-hidden="true">🖥️</span>
          <span className="taskbar-label">Home</span>
        </button>
        <button
          type="button"
          className="taskbar-item taskbar-item--help"
          onClick={() => alert('คลิกไปเรื่อย ๆ จนกว่าจะเมื่อย\nอย่าใช้ auto-click เด็ดขาด เดี๋ยวโดนจับ!')}
          title="วิธีเล่น"
        >
          <span className="taskbar-icon" aria-hidden="true">❓</span>
          <span className="taskbar-label">วิธีเล่น</span>
        </button>
        <button
          type="button"
          className="taskbar-item taskbar-item--share"
          onClick={async () => {
            const url = window.location.href
            try {
              if (navigator.share) {
                await navigator.share({ title: 'POP TU — พร้อมธรรม', url })
              } else {
                await navigator.clipboard.writeText(url)
                alert('คัดลอกลิงก์แล้ว — ไปส่งให้เพื่อนได้เลย')
              }
            } catch { /* user cancelled share */ }
          }}
          title="ข้อมูลสปอย์เว็บกับนโยบาย"
        >
          <span className="taskbar-icon" aria-hidden="true">✨</span>
          <span className="taskbar-label">Share</span>
        </button>
      </nav>
    </main>
  )
}
