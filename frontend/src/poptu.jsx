import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './poptu.css'
import lizardIdle        from './assets/Lizard1.PNG' // standing, mouth closed
import lizardTongue      from './assets/Lizard2.PNG' // standing, tongue out (pop)
import lizardHug3        from './assets/Lizard3.PNG' // hugging the number-3 sign
import lizardHold3       from './assets/Lizard4.PNG' // holding the 3 sign high
import lizardSmile       from './assets/Lizard5.PNG' // full-body smile (for faculty picker)
// Lizard6 (side-profile running pose) is available at ./assets/Lizard6.PNG
// but not yet used — swap it in anywhere you want more variety.

/* =========================================================================
 * POP TU — Popcat-style clicker themed as a Windows 95 desktop app.
 *
 * Features:
 *   - Faculty picker (blocks the game until a faculty is chosen)
 *   - Clickable lizard that toggles mouth-closed ↔ tongue-out on each click
 *   - Big blue 4-digit LCD counter (turns red when anti-cheat catches you)
 *   - Per-faculty Rankings window (top 3 by POP count, live)
 *   - Anti-autoclicker: statistical check on click-interval variance + CPS
 *   - Retro ERROR dialog + counter reset when cheating is detected
 *   - Bottom taskbar with Home button that returns to the main site (#home)
 *   - Celebration poses at every 100 POP (hug3) and every 500 POP (hold3)
 * ========================================================================= */

/** Thammasat University faculties — keep each id stable for persistence */
const FACULTIES = [
  { id: 'arch',    emoji: '🏛️', name: 'คณะสถาปัตยกรรมศาสตร์และการผังเมือง', seed: 10000 },
  { id: 'law',     emoji: '⚖️', name: 'คณะนิติศาสตร์',                         seed: 9800 },
  { id: 'comm',    emoji: '📊', name: 'คณะพาณิชยศาสตร์และการบัญชี',            seed: 9650 },
  { id: 'polsci',  emoji: '🏛️', name: 'คณะรัฐศาสตร์',                         seed: 8700 },
  { id: 'econ',    emoji: '💹', name: 'คณะเศรษฐศาสตร์',                       seed: 7400 },
  { id: 'soc',     emoji: '🤝', name: 'คณะสังคมสงเคราะห์ศาสตร์',                seed: 5200 },
  { id: 'anthro',  emoji: '👥', name: 'คณะสังคมวิทยาและมานุษยวิทยา',            seed: 4800 },
  { id: 'arts',    emoji: '📚', name: 'คณะศิลปศาสตร์',                         seed: 6700 },
  { id: 'journ',   emoji: '📰', name: 'คณะวารสารศาสตร์และสื่อสารมวลชน',         seed: 5900 },
  { id: 'sci',     emoji: '🔬', name: 'คณะวิทยาศาสตร์และเทคโนโลยี',            seed: 6100 },
  { id: 'eng',     emoji: '⚙️', name: 'คณะวิศวกรรมศาสตร์',                    seed: 7900 },
  { id: 'fine',    emoji: '🎨', name: 'คณะศิลปกรรมศาสตร์',                     seed: 3800 },
  { id: 'med',     emoji: '🩺', name: 'คณะแพทยศาสตร์',                         seed: 6400 },
  { id: 'dent',    emoji: '🦷', name: 'คณะทันตแพทยศาสตร์',                     seed: 2900 },
  { id: 'nurse',   emoji: '💉', name: 'คณะพยาบาลศาสตร์',                       seed: 3100 },
  { id: 'pub',     emoji: '🏥', name: 'คณะสาธารณสุขศาสตร์',                   seed: 2700 },
  { id: 'allied',  emoji: '🧪', name: 'คณะสหเวชศาสตร์',                        seed: 2400 },
  { id: 'inter',   emoji: '🌏', name: 'วิทยาลัยนานาชาติปรีดี พนมยงค์',         seed: 4200 },
  { id: 'learn',   emoji: '🎓', name: 'วิทยาลัยสหวิทยาการ',                    seed: 3500 },
]

const MAX_CLICK_BUFFER = 20 // how many recent click timestamps we analyse
const CPS_CAP = 25          // >25 clicks/sec sustained ⇒ almost certainly a bot
const JITTER_MIN = 0.08     // stdev/mean threshold. Humans jitter ≳ 0.15

/* ----------------------------- Lizard poses ---------------------------- */
/* Pose keys map to the PNGs imported above. Each click toggles
 *   'idle' ↔ 'tongue' (classic Popcat behaviour).
 * At score milestones we briefly force 'hug3' or 'hold3' as a celebration. */
const LIZARD_SRC = {
  idle:   lizardIdle,
  tongue: lizardTongue,
  hug3:   lizardHug3,
  hold3:  lizardHold3,
}

function Lizard({ pose }) {
  return (
    <img
      src={LIZARD_SRC[pose] || LIZARD_SRC.idle}
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
              src={lizardSmile}
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
  const [scores, setScores] = useState(() =>
    Object.fromEntries(FACULTIES.map((f) => [f.id, f.seed])),
  )
  // 'idle' = mouth closed · 'tongue' = click pop · 'hug3' / 'hold3' = milestones
  const [pose, setPose] = useState('idle')
  const milestoneTimer = useRef(null)
  const [caught, setCaught] = useState(false)
  const [errOpen, setErrOpen] = useState(false)
  const [floaters, setFloaters] = useState([]) // { id, n }
  const [popAnim, setPopAnim] = useState(0)
  const clickTimes = useRef([])
  const floaterIdRef = useRef(0)

  // Mark body for theme background
  useEffect(() => {
    document.body.classList.add('poptu-active')
    return () => document.body.classList.remove('poptu-active')
  }, [])

  // Clear any pending milestone timer when unmounting
  useEffect(() => () => {
    if (milestoneTimer.current) clearTimeout(milestoneTimer.current)
  }, [])

  const myCount = facultyId ? scores[facultyId] ?? 0 : 0

  /** Anti-cheat analysis — updates caught state in-place. */
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

    // Two signatures:
    //   1. Too fast overall (unlikely sustainable by human)
    //   2. Suspiciously even cadence (classic autoclicker)
    if (cps > CPS_CAP) return true
    if (mean < 90 && jitter < JITTER_MIN) return true
    return false
  }, [])

  const onLizardClick = useCallback(() => {
    if (caught || errOpen || !facultyId) return
    const now = Date.now()
    const buf = clickTimes.current
    buf.push(now)
    if (buf.length > MAX_CLICK_BUFFER) buf.shift()

    // Toggle pose (Popcat-style), bump score
    setPose((p) => (p === 'tongue' ? 'idle' : 'tongue'))
    setPopAnim((n) => n + 1)

    // Derive the new count from current state BEFORE scheduling the update,
    // so the milestone check is synchronous and reliable.
    const newCount = (scores[facultyId] ?? 0) + 1
    setScores((prev) => ({ ...prev, [facultyId]: (prev[facultyId] ?? 0) + 1 }))

    // Milestones: hold the celebration pose briefly, then return to idle.
    const scheduleCelebration = (kind, durMs) => {
      setPose(kind)
      if (milestoneTimer.current) clearTimeout(milestoneTimer.current)
      milestoneTimer.current = setTimeout(() => setPose('idle'), durMs)
    }
    if (newCount % 500 === 0)      scheduleCelebration('hold3', 1600)
    else if (newCount % 100 === 0) scheduleCelebration('hug3', 900)

    // Floater +1
    const fid = ++floaterIdRef.current
    setFloaters((fs) => [...fs, { id: fid }])
    setTimeout(() => setFloaters((fs) => fs.filter((f) => f.id !== fid)), 700)

    // Anti-cheat
    if (detectCheating()) {
      setCaught(true)
      setErrOpen(true)
      // Penalty: roll back 100 pts (not below seed) to discourage retries
      setScores((prev) => {
        const penalty = 100
        const cur = prev[facultyId] ?? 0
        return { ...prev, [facultyId]: Math.max(cur - penalty, 0) }
      })
    }
  }, [caught, errOpen, facultyId, detectCheating, scores])

  const closeError = useCallback(() => {
    setErrOpen(false)
    setCaught(false)
    clickTimes.current = []
  }, [])

  const goHome = useCallback(() => {
    window.location.hash = '' // App.jsx listens to hashchange → switches back to Home
  }, [])

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
                  <Lizard pose={pose} />
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
                onClick={() => setFacultyId(null)}
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
