import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './poptu.css'
import lizard1 from './assets/Lizard1.webp'
/* Lizard2–5 load after first paint (dynamic import) to speed initial mobile load */
import iconHome from './assets/computer_icon.png'
import iconHelp from './assets/question_icon.png'
import iconShare from './assets/internet_icon.png'

/* =========================================================================
 * PT — Popcat-style clicker themed as a Windows 95 desktop app.
 *
 * Features:
 *   - Faculty picker (blocks the game until a faculty is chosen)
 *   - Clickable lizard that RANDOMLY swaps between 5 WebP poses each click
 *   - Big blue 4-digit LCD — session click count only (Popcat-style), not global faculty total
 *   - Per-faculty Rankings window — REAL, shared via backend API
 *     (GET /api/ranking/scores, POST /api/ranking/pop)
 *   - Anti-autoclicker: statistical check on click-interval variance + CPS
 *   - Retro ERROR dialog + counter reset when cheating is detected
 *   - Bottom taskbar with Home button that returns to the main site
 * ========================================================================= */

/** Thammasat University faculties — keep each id stable for persistence */
const FACULTIES = [
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
  { id: 'arch',    emoji: '🏛️', name: 'คณะสถาปัตยกรรมศาสตร์และการผังเมือง' },
  { id: 'fine',    emoji: '🎨', name: 'คณะศิลปกรรมศาสตร์' },
  { id: 'med',     emoji: '🩺', name: 'คณะแพทยศาสตร์' },
  { id: 'allied',  emoji: '🧪', name: 'คณะสหเวชศาสตร์' },
  { id: 'dent',    emoji: '🦷', name: 'คณะทันตแพทยศาสตร์' },
  { id: 'nurse',   emoji: '💉', name: 'คณะพยาบาลศาสตร์' },
  { id: 'pub',     emoji: '🏥', name: 'คณะสาธารณสุขศาสตร์' },
  { id: 'pharm',   emoji: '💊', name: 'คณะเภสัชศาสตร์' },
  { id: 'learn',   emoji: '🎓', name: 'คณะวิทยาการเรียนรู้และศึกษาศาสตร์' },
  { id: 'puey',    emoji: '🌱', name: 'วิทยาลัยพัฒนศาสตร์ ป๋วย อึ๊งภากรณ์' },
  { id: 'glob',    emoji: '🌐', name: 'วิทยาลัยโลกคดีศึกษา' },
  { id: 'cicm',    emoji: '⚕️', name: 'วิทยาลัยแพทยศาสตร์นานาชาติจุฬาภรณ์' },
  { id: 'inter',   emoji: '🌏', name: 'วิทยาลัยนานาชาติปรีดี พนมยงค์' },
  { id: 'siit',    emoji: '🔧', name: 'สถาบันเทคโนโลยีนานาชาติสิรินธร' },
]

const MAX_CLICK_BUFFER = 20 // how many recent click timestamps we analyse
const CPS_CAP = 25          // >25 clicks/sec sustained ⇒ almost certainly a bot
const JITTER_MIN = 0.08     // stdev/mean threshold. Humans jitter ≳ 0.15

/** Backend base URL. Configure via `VITE_API_URL` in frontend/.env.
 *  Fallback: same origin `/api`. If the frontend is hosted separately from
 *  the backend, set VITE_API_URL to the backend's Vercel URL.             */
const API_BASE = (import.meta.env && import.meta.env.VITE_API_URL) || ''
/** PT mark on lizard stage — from public/ so URL respects Vite base (Vercel-safe) */
const STAGE_PT_LOGO = `${(import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/') }PTLOGO.webp`
const RANKING_REFRESH_MS = 10000         // leaderboard poll while tab visible (lower = more network + re-renders)
const RANKING_REFRESH_HIDDEN_MS = 30000 // slow poll when tab in background (saves work + data)
const POP_FLUSH_MS = 800                  // batch window for /api/ranking/pop
/** Cap simultaneous “+1” floaters — rapid clicks used to grow DOM without bound. */
const MAX_FLOATERS = 12

/* ----------------------------- Lizard poses ---------------------------- */
function pickRandomPose(currentSrc, poses) {
  if (!poses?.length) return currentSrc
  if (poses.length <= 1) return poses[0]
  const pool = poses.filter((src) => src !== currentSrc)
  return pool[Math.floor(Math.random() * pool.length)]
}

const Lizard = memo(function Lizard({ src }) {
  return (
    <img
      src={src}
      alt="Lizard mascot"
      className="lizard-img"
      draggable={false}
      decoding="async"
    />
  )
})

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
      {['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((seg) => {
        const isHoriz = seg === 'a' || seg === 'd' || seg === 'g'
        const dirClass = isHoriz ? 'horiz' : 'vert'
        return (
          <div key={seg} className={`seg ${seg} ${dirClass}${lit.includes(seg) ? ' on' : ''}`} />
        )
      })}
    </div>
  )
}

function Lcd({ value, caught }) {
  const padded = String(Math.max(0, Math.floor(value))).padStart(4, '0')
  if (caught) {
    return (
      <div className="lcd lcd--caught" role="alert" aria-live="assertive" aria-label="ตรวจพบการโกง">
        <span className="lcd-caught-msg" lang="th">อย่าโกง ผมจับได้นะ !!!</span>
      </div>
    )
  }
  return (
    <div className="lcd lcd--on" role="status" aria-label={`Score ${value}`}>
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
          <span className="win-title" id="fp-title" lang="th">เลือกคณะก่อนเริ่มเล่น</span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" aria-label="Minimise">_</button>
          </div>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 10px' }}>
            <img
              src={lizard1}
              alt=""
              aria-hidden="true"
              style={{ width: 72, height: 'auto', flexShrink: 0 }}
              draggable={false}
              decoding="async"
            />
            <p className="poptu-faculty-blurb" lang="th">
              เลือกคณะของคุณเพื่อช่วยสะสมคะแนนให้คณะในตาราง Rankings
            </p>
          </div>
          <select
            lang="th"
            className="poptu-faculty-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{
              width: '100%',
              border: '2px solid #000',
              boxShadow: 'inset 1px 1px 0 #808080, inset -1px -1px 0 #fff',
              background: '#fff',
            }}
          >
            {FACULTIES.map((f) => (
              <option key={f.id} value={f.id}>{f.emoji} {f.name}</option>
            ))}
          </select>
          <p className="poptu-faculty-meta" lang="th">
            สื่ออิเล็กทรอนิกส์และเว็บไซต์ผลิตโดย พรรคพร้อมธรรม
          </p>
        </div>
        <div className="win-dialog-actions">
          <button type="button" className="w95-btn" lang="th" onClick={() => onPick(selected)}>เริ่มเล่น</button>
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
          <div className="win-dialog-msg" lang="th">อย่าโกง ผมจับได้นะ !!!</div>
        </div>
        <div className="win-dialog-actions">
          <button type="button" className="w95-btn" onClick={onOk} autoFocus>OK</button>
        </div>
      </div>
    </div>
  )
}

/** “Ready?” taskbar — teaser window (Win95 chrome) */
function ReadyDialog({ onClose }) {
  return (
    <div
      className="poptu-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ready-dialog-title"
      onClick={onClose}
    >
      <div
        className="win-dialog win-dialog--ready"
        style={{ width: 'min(420px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="win-titlebar">
          <span className="win-title" id="ready-dialog-title">POPTU Game</span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" aria-label="Minimise">_</button>
            <button type="button" className="win-btn" aria-label="Maximise">□</button>
            <button type="button" className="win-btn" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className="win-dialog-body win-dialog-body--ready">
          <p className="win-dialog-msg win-dialog-msg--ready-teaser" lang="th">
            พบกับฟีเจอร์สนุกๆ จาก พรรคพร้อมธรรม เร็วๆ นี้
          </p>
        </div>
        <div className="win-dialog-actions">
          <button type="button" className="w95-btn" lang="en" onClick={onClose} autoFocus>
            Ready!
          </button>
        </div>
      </div>
    </div>
  )
}

/* ================================ Page ================================ */

export default function PopTu({ onNavigateToComingSoon }) {
  const [facultyId, setFacultyId] = useState(null)
  /** Server-truth scores keyed by faculty id. Used for Rankings (global); LCD uses sessionClicks. */
  const [scores, setScores] = useState({})
  /** Local pops this session for the selected faculty — LCD shows this only (not global total). */
  const [sessionClicks, setSessionClicks] = useState(0)
  /** Random current pose image src */
  const [poseSrc, setPoseSrc] = useState(lizard1)
  /** All pose URLs; starts with [lizard1], then Lizard2–5 load asynchronously */
  const lizardPosesRef = useRef([lizard1])
  const [caught, setCaught] = useState(false)
  const [errOpen, setErrOpen] = useState(false)
  const [readyOpen, setReadyOpen] = useState(false)
  const [floaters, setFloaters] = useState([])
  const [popAnim, setPopAnim] = useState(0)
  const lizardPopAnchorRef = useRef(null)

  /** Restart CSS pop animation without remounting (remount was collapsing flex height and jumping the faculty row). */
  useLayoutEffect(() => {
    if (popAnim === 0) return
    const el = lizardPopAnchorRef.current
    if (!el) return
    el.style.animation = 'none'
    void el.offsetWidth
    el.style.animation = ''
  }, [popAnim])

  const clickTimes = useRef([])
  const floaterIdRef = useRef(0)

  /** Pending click deltas per faculty that haven't been flushed to the backend yet. */
  const pendingDeltaRef = useRef(0)
  const flushTimerRef = useRef(null)
  /** Locally applied (optimistic) additions per faculty we've already rendered in the
   *  counter but are still waiting for the server round-trip to confirm. */
  const optimisticRef = useRef({})
  /** Monotonic id per GET /scores. Ignore responses whose id is not latest (avoids out-of-order writes). */
  const scoresFetchGenRef = useRef(0)

  // Mark body for theme background
  useEffect(() => {
    document.body.classList.add('poptu-active')
    return () => document.body.classList.remove('poptu-active')
  }, [])

  // Defer Lizard2–5 so first paint competes with fewer image downloads on mobile
  useEffect(() => {
    let cancelled = false
    Promise.all([
      import('./assets/Lizard2.webp'),
      import('./assets/Lizard3.webp'),
      import('./assets/Lizard4.webp'),
      import('./assets/Lizard5.webp'),
    ])
      .then((mods) => {
        if (cancelled) return
        lizardPosesRef.current = [lizard1, ...mods.map((m) => m.default)]
      })
      .catch(() => {
        /* keep single-pose fallback */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSessionClicks(0)
  }, [facultyId])

  // -------------------- Fetch scores from backend --------------------
  const fetchScores = useCallback(async () => {
    const gen = ++scoresFetchGenRef.current
    try {
      // Do NOT abort the previous request when a new poll fires: if the API is
      // slower than the poll interval, abort-on-retry would cancel every flight
      // and the scoreboard would never update.
      const res = await fetch(`${API_BASE}/api/ranking/scores`, { cache: 'no-store' })
      if (gen !== scoresFetchGenRef.current) return
      if (!res.ok) return
      const json = await res.json()
      if (gen !== scoresFetchGenRef.current) return
      if (json?.scores) {
        // Merge server truth with any still-pending optimistic adds so the
        // user doesn't see their own clicks roll back during a refresh.
        const merged = { ...json.scores }
        for (const [id, add] of Object.entries(optimisticRef.current)) {
          merged[id] = (merged[id] ?? 0) + add
        }
        startTransition(() => {
          if (gen !== scoresFetchGenRef.current) return
          setScores(merged)
        })
      }
    } catch {
      /* network hiccup — we'll try again on the next poll */
    }
  }, [])

  useEffect(() => {
    const pollMs = () => (document.hidden ? RANKING_REFRESH_HIDDEN_MS : RANKING_REFRESH_MS)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchScores()
    let iv = setInterval(fetchScores, pollMs())

    const onVisibility = () => {
      clearInterval(iv)
      if (!document.hidden) fetchScores()
      iv = setInterval(fetchScores, pollMs())
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      scoresFetchGenRef.current += 1
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisibility)
    }
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
        startTransition(() => {
          setScores((prev) => ({
            ...prev,
            [facultyId]: json.count + (optimisticRef.current[facultyId] ?? 0),
          }))
        })
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
    if (caught || errOpen || readyOpen || !facultyId) return
    const now = Date.now()
    const buf = clickTimes.current
    buf.push(now)
    if (buf.length > MAX_CLICK_BUFFER) buf.shift()

    // Random pose (always different from the current one)
    setPoseSrc((cur) => pickRandomPose(cur, lizardPosesRef.current))
    setPopAnim((n) => n + 1)

    // LCD: session-only count. Rankings: optimistic global bump until server poll confirms.
    setSessionClicks((n) => n + 1)
    setScores((prev) => ({ ...prev, [facultyId]: (prev[facultyId] ?? 0) + 1 }))
    pendingDeltaRef.current += 1
    scheduleFlush()

    // Floater +1
    const fid = ++floaterIdRef.current
    setFloaters((fs) => {
      const next = [...fs, { id: fid }]
      return next.length > MAX_FLOATERS ? next.slice(-MAX_FLOATERS) : next
    })
    setTimeout(() => setFloaters((fs) => fs.filter((f) => f.id !== fid)), 700)

    // Anti-cheat
    if (detectCheating()) {
      setCaught(true)
      setErrOpen(true)
      // Penalty: roll back 100 optimistic pts for rankings + session LCD (server stays authoritative)
      setSessionClicks((c) => Math.max(c - 100, 0))
      setScores((prev) => {
        const penalty = 100
        const cur = prev[facultyId] ?? 0
        return { ...prev, [facultyId]: Math.max(cur - penalty, 0) }
      })
    }
  }, [caught, errOpen, readyOpen, facultyId, detectCheating, scheduleFlush])

  const closeError = useCallback(() => {
    setErrOpen(false)
    setCaught(false)
    clickTimes.current = []
  }, [])

  const goHome = useCallback(() => {
    // flush any queued pops before navigating away
    flushPending()
    window.location.hash = '#comingsoon'
    onNavigateToComingSoon?.()
  }, [flushPending, onNavigateToComingSoon])

  const myCount = facultyId ? sessionClicks : 0

  const rankings = useMemo(() => {
    return FACULTIES
      .map((f) => ({ ...f, score: scores[f.id] ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
  }, [scores])

  const currentFaculty = FACULTIES.find((f) => f.id === facultyId)

  return (
    <main className="poptu">
      <section className="poptu-window" aria-label="POPTU window">
        <header className="win-titlebar">
          <span className="win-title">POPTU</span>
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
                  <span className="ranking-faculty" title={r.name} lang="th">
                    <span className="poptu-zoom-text">{r.name}</span>
                  </span>
                  <span className="ranking-score">{r.score.toLocaleString('en-US')} POP</span>
                </div>
              ))}
              {rankings.length === 0 && (
                <div className="ranking-row" style={{ opacity: 0.6 }}>
                  <span className="ranking-faculty" lang="th">
                    <span className="poptu-zoom-text">กำลังโหลด…</span>
                  </span>
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
                <span className="lizard-pop-anchor" ref={lizardPopAnchorRef}>
                  <Lizard src={poseSrc} />
                </span>
              </button>
              <div className="floater-layer" aria-hidden="true">
                {floaters.map((f) => (
                  <span key={f.id} className="floater" lang="en" translate="no">+1</span>
                ))}
              </div>
            </div>
            <img
              className="poptu-stage-logo"
              src={STAGE_PT_LOGO}
              alt=""
              decoding="async"
              fetchPriority="low"
              aria-hidden="true"
            />
          </div>

          {/* Faculty fieldset */}
          <fieldset className="fieldset">
            <legend>Faculty</legend>
            <div className="faculty-row">
              <span className="faculty-emoji" aria-hidden="true">
                {currentFaculty ? currentFaculty.emoji : '😀'}
              </span>
              <span className="faculty-name" lang="th">
                <span className="poptu-zoom-text">
                  {currentFaculty ? currentFaculty.name : 'ยังไม่ได้เลือกคณะ'}
                </span>
              </span>
              <button
                type="button"
                className="w95-btn"
                lang="th"
                onClick={() => {
                  // flush any pending clicks for the previous faculty first
                  flushPending()
                  setFacultyId(null)
                }}
              >เปลี่ยน</button>
            </div>
          </fieldset>
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

      {readyOpen && <ReadyDialog onClose={() => setReadyOpen(false)} />}

      {/* bottom taskbar */}
      <nav className="poptu-taskbar" aria-label="Taskbar">
        <div className="poptu-taskbar-cluster">
          <button
            type="button"
            className="taskbar-item taskbar-item--home"
            onClick={goHome}
            title="ไปหน้าหลักเว็บพร้อมธรรม"
          >
            <img src={iconHome} alt="Home" className="taskbar-icon-img" draggable={false} />
            <span className="taskbar-label">Home</span>
          </button>
          <button
            type="button"
            className="taskbar-item taskbar-item--help"
            onClick={() => setReadyOpen(true)}
            title="POPTU — เร็วๆ นี้"
          >
            <img src={iconHelp} alt="Help" className="taskbar-icon-img" draggable={false} />
            <span className="taskbar-label">Ready?</span>
          </button>
          <button
            type="button"
            className="taskbar-item taskbar-item--share"
            onClick={async () => {
              const url = window.location.href
              try {
                if (navigator.share) {
                  await navigator.share({ title: 'พร้อมธรรม · POPTU เกม', url })
                } else {
                  await navigator.clipboard.writeText(url)
                  alert('คัดลอกลิงก์แล้ว — ไปส่งให้เพื่อนได้เลย')
                }
              } catch { /* user cancelled share */ }
            }}
            title="ข้อมูลสปอย์เว็บกับนโยบาย"
          >
            <img src={iconShare} alt="Share" className="taskbar-icon-img" draggable={false} />
            <span className="taskbar-label">Share</span>
          </button>
        </div>
      </nav>
    </main>
  )
}
