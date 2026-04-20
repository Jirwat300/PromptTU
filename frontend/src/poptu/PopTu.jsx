import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import '../poptu.css'
import lizard1 from '../assets/Lizard1.webp'
import iconHome from '../assets/computer_icon.png'
import iconHelp from '../assets/question_icon.png'
import iconShare from '../assets/internet_icon.png'
import {
  ALL_FACULTIES_POLL_MS,
  API_BASE,
  CPS_CAP,
  FACULTIES,
  JITTER_MIN,
  MAX_CLICK_BUFFER,
  MAX_FLOATERS,
  POP_FLUSH_MS,
  RANKING_REFRESH_HIDDEN_MS,
  RANKING_REFRESH_MS,
  STAGE_PT_LOGO,
  TURNSTILE_SITE_KEY,
  WIN_DECO_BTN,
} from './constants.js'
import Lizard from './Lizard.jsx'
import { Lcd } from './Lcd.jsx'
import { pickRandomPose } from './pickRandomPose.js'
import AllFacultiesDialog from './modals/AllFacultiesDialog.jsx'
import ErrorDialog from './modals/ErrorDialog.jsx'
import FacultyPicker from './modals/FacultyPicker.jsx'
import ReadyDialog from './modals/ReadyDialog.jsx'
import { loadPoptuUserState, writePoptuUserState } from './userStateStorage.js'
import { sendPoptuPageView } from '../analytics.js'
import { createTurnstileToken } from './turnstileClient.js'

const PERSISTED_FACULTY_IDS = FACULTIES.map((f) => f.id)
const PERSISTED_INIT = loadPoptuUserState(PERSISTED_FACULTY_IDS)

export default function PopTu({ onNavigateToComingSoon }) {
  const [facultyId, setFacultyId] = useState(PERSISTED_INIT.facultyId)
  const [scores, setScores] = useState({})
  const [facultyMetaFromApi, setFacultyMetaFromApi] = useState(null)
  const [sessionClicks, setSessionClicks] = useState(PERSISTED_INIT.sessionClicks)
  const [poseSrc, setPoseSrc] = useState(lizard1)
  const lizardPosesRef = useRef([lizard1])
  const [caught, setCaught] = useState(false)
  const [errOpen, setErrOpen] = useState(false)
  const [readyOpen, setReadyOpen] = useState(false)
  const [allFacultiesOpen, setAllFacultiesOpen] = useState(false)
  const [floaters, setFloaters] = useState([])
  const [popAnim, setPopAnim] = useState(0)
  const lizardPopAnchorRef = useRef(null)
  const popAudioCtxRef = useRef(null)
  const popAudioGainRef = useRef(null)

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
  const pendingDeltaRef = useRef(0)
  const pendingFirstClickMsRef = useRef(0)
  const pendingLastClickMsRef = useRef(0)
  const flushTimerRef = useRef(null)
  const flushInFlightRef = useRef(false)
  const sessionTokenRef = useRef(null)
  const sessionTokenExpRef = useRef(0)
  const sessionStateRef = useRef('unknown') // unknown | enabled | disabled
  const sessionReqRef = useRef(null)
  const optimisticRef = useRef({})
  const scoresFetchGenRef = useRef(0)
  const facultyIdRef = useRef(null)
  useEffect(() => {
    facultyIdRef.current = facultyId
  }, [facultyId])

  useEffect(() => {
    document.body.classList.add('poptu-active')
    return () => document.body.classList.remove('poptu-active')
  }, [])

  const ensurePopAudio = useCallback(() => {
    if (typeof window === 'undefined') return null
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    if (!popAudioCtxRef.current) {
      const ctx = new AC()
      const master = ctx.createGain()
      master.gain.value = 0.35
      master.connect(ctx.destination)
      popAudioCtxRef.current = ctx
      popAudioGainRef.current = master
    }
    const ctx = popAudioCtxRef.current
    if (ctx?.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
    return ctx
  }, [])

  const playPopSound = useCallback(() => {
    const ctx = ensurePopAudio()
    if (!ctx) return
    const output = popAudioGainRef.current || ctx.destination
    const osc = ctx.createOscillator()
    const filter = ctx.createBiquadFilter()
    const gain = ctx.createGain()
    const now = ctx.currentTime

    filter.type = 'highpass'
    filter.frequency.setValueAtTime(140, now)

    osc.type = 'square'
    osc.frequency.setValueAtTime(540, now)
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.06)

    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(output)

    osc.start(now)
    osc.stop(now + 0.085)
  }, [ensurePopAudio])

  useEffect(() => {
    sendPoptuPageView()
  }, [])

  const fetchSessionToken = useCallback(async () => {
    if (sessionStateRef.current === 'disabled') return null
    if (sessionReqRef.current) return sessionReqRef.current
    sessionReqRef.current = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/ranking/session`, { cache: 'no-store' })
        if (!res.ok) return null
        const json = await res.json().catch(() => null)
        if (!json || json.enabled === false) {
          sessionStateRef.current = 'disabled'
          sessionTokenRef.current = null
          sessionTokenExpRef.current = 0
          return null
        }
        const token = typeof json.token === 'string' ? json.token : ''
        const expMs = Number(json.expires_at) || 0
        if (!token) return null
        sessionStateRef.current = 'enabled'
        sessionTokenRef.current = token
        sessionTokenExpRef.current = expMs
        return token
      } catch {
        return null
      } finally {
        sessionReqRef.current = null
      }
    })()
    return sessionReqRef.current
  }, [])

  const ensureSessionToken = useCallback(async () => {
    if (sessionStateRef.current === 'disabled') return null
    const now = Date.now()
    if (
      typeof sessionTokenRef.current === 'string' &&
      sessionTokenRef.current &&
      sessionTokenExpRef.current - now > 8000
    ) {
      return sessionTokenRef.current
    }
    return fetchSessionToken()
  }, [fetchSessionToken])

  useEffect(() => {
    void ensureSessionToken()
  }, [ensureSessionToken])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      import('../assets/Lizard2.webp'),
      import('../assets/Lizard3.webp'),
      import('../assets/Lizard4.webp'),
      import('../assets/Lizard5.webp'),
    ])
      .then((mods) => {
        if (cancelled) return
        lizardPosesRef.current = [lizard1, ...mods.map((m) => m.default)]
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  /** Remember selected faculty + LCD session count across refresh (localStorage). */
  useEffect(() => {
    const t = window.setTimeout(() => {
      writePoptuUserState(facultyId, sessionClicks)
    }, 400)
    return () => clearTimeout(t)
  }, [facultyId, sessionClicks])

  const fetchScores = useCallback(async () => {
    const gen = ++scoresFetchGenRef.current
    try {
      const res = await fetch(`${API_BASE}/api/ranking/scores`, { cache: 'no-store' })
      if (gen !== scoresFetchGenRef.current) return
      if (!res.ok) return
      const json = await res.json()
      if (gen !== scoresFetchGenRef.current) return
      if (json?.scores != null) {
        const merged = Object.fromEntries(FACULTIES.map((f) => [f.id, 0]))
        for (const [id, raw] of Object.entries(json.scores)) {
          merged[id] = Number(raw) || 0
        }
        for (const [id, add] of Object.entries(optimisticRef.current)) {
          merged[id] = (merged[id] ?? 0) + add
        }
        if (facultyId && pendingDeltaRef.current > 0) {
          merged[facultyId] = (merged[facultyId] ?? 0) + pendingDeltaRef.current
        }
        if (gen !== scoresFetchGenRef.current) return
        if (Array.isArray(json.rows)) {
          setFacultyMetaFromApi(
            json.rows.map((r) => ({
              id: r.id,
              name: r.name,
              emoji: r.emoji ?? '',
            })),
          )
        }
        setScores(merged)
      }
    } catch {
      /* network hiccup */
    }
  }, [facultyId])

  useEffect(() => {
    const pollMs = () => (document.hidden ? RANKING_REFRESH_HIDDEN_MS : RANKING_REFRESH_MS)
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

  useEffect(() => {
    if (!allFacultiesOpen) return
    fetchScores()
    const iv = setInterval(fetchScores, ALL_FACULTIES_POLL_MS)
    return () => clearInterval(iv)
  }, [allFacultiesOpen, fetchScores])

  const flushPending = useCallback(async () => {
    if (flushInFlightRef.current) return
    if (!facultyId) return
    const delta = pendingDeltaRef.current
    if (delta <= 0) return
    const firstClickMs = pendingFirstClickMsRef.current || 0
    const lastClickMs = pendingLastClickMsRef.current || 0
    flushInFlightRef.current = true
    pendingDeltaRef.current = 0
    pendingFirstClickMsRef.current = 0
    pendingLastClickMsRef.current = 0

    optimisticRef.current[facultyId] = (optimisticRef.current[facultyId] ?? 0) + delta

    try {
      const turnstileToken = TURNSTILE_SITE_KEY
        ? await createTurnstileToken(TURNSTILE_SITE_KEY)
        : null
      const sessionToken = await ensureSessionToken()
      const res = await fetch(`${API_BASE}/api/ranking/pop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          faculty_id: facultyId,
          delta,
          client_first_click_ms: firstClickMs || undefined,
          client_last_click_ms: lastClickMs || undefined,
          session_token: sessionToken || undefined,
          turnstile_token: turnstileToken || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      const serverCount = Number(json?.count)
      const appliedRaw = Number(json?.applied)

      if (res.ok) {
        const ack =
          Number.isFinite(appliedRaw) && appliedRaw >= 0 ? Math.min(appliedRaw, delta) : delta
        optimisticRef.current[facultyId] = Math.max(
          (optimisticRef.current[facultyId] ?? 0) - delta,
          0,
        )
        if (ack < delta) pendingDeltaRef.current += delta - ack

        if (Number.isFinite(serverCount)) {
          startTransition(() => {
            setScores((prev) => ({
              ...prev,
              [facultyId]: serverCount + (optimisticRef.current[facultyId] ?? 0),
            }))
          })
        }
      } else {
        if (res.status === 403 && String(json?.message || '').includes('session')) {
          sessionTokenRef.current = null
          sessionTokenExpRef.current = 0
          void fetchSessionToken()
        }
        optimisticRef.current[facultyId] = Math.max(
          (optimisticRef.current[facultyId] ?? 0) - delta,
          0,
        )
        pendingDeltaRef.current += delta
        if (!pendingFirstClickMsRef.current && firstClickMs) pendingFirstClickMsRef.current = firstClickMs
        if (lastClickMs) pendingLastClickMsRef.current = Math.max(pendingLastClickMsRef.current, lastClickMs)
      }
    } catch {
      optimisticRef.current[facultyId] = Math.max(
        (optimisticRef.current[facultyId] ?? 0) - delta,
        0,
      )
      pendingDeltaRef.current += delta
      if (!pendingFirstClickMsRef.current && firstClickMs) pendingFirstClickMsRef.current = firstClickMs
      if (lastClickMs) pendingLastClickMsRef.current = Math.max(pendingLastClickMsRef.current, lastClickMs)
    } finally {
      flushInFlightRef.current = false
      if (pendingDeltaRef.current > 0 && !flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null
          flushPending()
        }, POP_FLUSH_MS)
      }
    }
  }, [ensureSessionToken, facultyId, fetchSessionToken])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      flushPending()
    }, POP_FLUSH_MS)
  }, [flushPending])

  useEffect(() => {
    const flushOnDocumentLeave = () => {
      const fid = facultyIdRef.current
      const delta = pendingDeltaRef.current
      if (!fid || delta <= 0) return
      const firstClickMs = pendingFirstClickMsRef.current || 0
      const lastClickMs = pendingLastClickMsRef.current || 0
      pendingDeltaRef.current = 0
      pendingFirstClickMsRef.current = 0
      pendingLastClickMsRef.current = 0
      optimisticRef.current[fid] = (optimisticRef.current[fid] ?? 0) + delta
      const url = `${API_BASE}/api/ranking/pop`
      const body = JSON.stringify({
        faculty_id: fid,
        delta,
        client_first_click_ms: firstClickMs || undefined,
        client_last_click_ms: lastClickMs || undefined,
        session_token: sessionTokenRef.current || undefined,
      })
      try {
        if (
          typeof navigator !== 'undefined' &&
          navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))
        ) {
          return
        }
      } catch {
        /* very old browsers */
      }
      try {
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        })
      } catch {
        /* ignore */
      }
    }
    const onHide = () => flushOnDocumentLeave()
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

  const onLizardClick = useCallback(() => {
    if (caught || errOpen || readyOpen || !facultyId) return
    const now = Date.now()
    const buf = clickTimes.current
    buf.push(now)
    if (buf.length > MAX_CLICK_BUFFER) buf.shift()

    if (detectCheating()) {
      setCaught(true)
      setErrOpen(true)
      setSessionClicks((c) => Math.max(c - 100, 0))
      setScores((prev) => {
        const cur = prev[facultyId] ?? 0
        return { ...prev, [facultyId]: Math.max(cur - 100, 0) }
      })
      return
    }

    setPoseSrc((cur) => pickRandomPose(cur, lizardPosesRef.current))
    setPopAnim((n) => n + 1)
    playPopSound()

    setSessionClicks((n) => n + 1)
    setScores((prev) => ({ ...prev, [facultyId]: (prev[facultyId] ?? 0) + 1 }))
    if (!pendingFirstClickMsRef.current) pendingFirstClickMsRef.current = now
    pendingLastClickMsRef.current = now
    pendingDeltaRef.current += 1
    scheduleFlush()

    const fid = ++floaterIdRef.current
    setFloaters((fs) => {
      const next = [...fs, { id: fid }]
      return next.length > MAX_FLOATERS ? next.slice(-MAX_FLOATERS) : next
    })
    setTimeout(() => setFloaters((fs) => fs.filter((f) => f.id !== fid)), 700)
  }, [caught, errOpen, readyOpen, facultyId, detectCheating, playPopSound, scheduleFlush])

  const closeError = useCallback(() => {
    setErrOpen(false)
    setCaught(false)
    clickTimes.current = []
  }, [])

  const goHome = useCallback(() => {
    flushPending()
    window.location.hash = '#comingsoon'
    onNavigateToComingSoon?.()
  }, [flushPending, onNavigateToComingSoon])

  const myCount = facultyId ? sessionClicks : 0

  const allFacultyRows = useMemo(() => {
    const facIds = new Set(FACULTIES.map((f) => f.id))
    const base = FACULTIES.map((f) => ({
      ...f,
      score: scores[f.id] ?? 0,
    }))
    const extras =
      facultyMetaFromApi?.filter((r) => !facIds.has(r.id)).map((r) => ({
        ...r,
        score: scores[r.id] ?? 0,
      })) ?? []
    return [...base, ...extras]
      .sort((a, b) => b.score - a.score)
      .map((row, idx) => ({ ...row, rank: idx + 1 }))
  }, [scores, facultyMetaFromApi])

  const rankings = useMemo(() => allFacultyRows.slice(0, 3), [allFacultyRows])
  const currentFaculty = FACULTIES.find((f) => f.id === facultyId)

  return (
    <main className="poptu">
      <section className="poptu-window" aria-label="POPTU window">
        <header className="win-titlebar">
          <span className="win-title">POPTU</span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" aria-label="Minimise" {...WIN_DECO_BTN}>_</button>
            <button type="button" className="win-btn" aria-label="Maximise" {...WIN_DECO_BTN}>□</button>
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
          <div className="poptu-rankings-wrap">
            <section className="rankings-window" aria-label="Rankings">
              <header className="win-titlebar">
                <span className="win-title">Rankings</span>
                <div className="win-title-btns">
                  <button type="button" className="win-btn" aria-label="Minimise" {...WIN_DECO_BTN}>_</button>
                  <button type="button" className="win-btn" aria-label="Maximise" {...WIN_DECO_BTN}>□</button>
                  <button type="button" className="win-btn" aria-label="Close">×</button>
                </div>
              </header>
              <div className="rankings-body">
                {rankings.length > 0 ? (
                  <div className="ranking-row--combined" role="list">
                    {rankings.map((r, i) => (
                      <div key={r.id} className="ranking-row" role="listitem">
                        <span className="ranking-num">{i + 1}</span>
                        <span className="ranking-faculty" title={r.name} lang="th">
                          <span className="poptu-zoom-text">{r.name}</span>
                        </span>
                        <span className="ranking-score">{r.score.toLocaleString('en-US')} POP</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ranking-row--combined ranking-row--loading" style={{ opacity: 0.6 }}>
                    <div className="ranking-row ranking-row--placeholder">
                      <span className="ranking-faculty" lang="th">
                        <span className="poptu-zoom-text">กำลังโหลด…</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>
            <button
              type="button"
              className="rankings-chart-btn rankings-chart-btn--float"
              onClick={() => setAllFacultiesOpen(true)}
              aria-label="ดูคะแนนทุกคณะ"
              title="ดูคะแนนทุกคณะ"
            >
              <svg
                className="rankings-chart-icon"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
                focusable="false"
              >
                <rect x="3" y="14" width="4" height="7" fill="currentColor" />
                <rect x="9" y="9" width="4" height="12" fill="currentColor" />
                <rect x="15" y="12" width="4" height="9" fill="currentColor" />
                <rect x="21" y="6" width="3" height="15" fill="currentColor" />
              </svg>
            </button>
          </div>

          <div className="lcd-wrap">
            <Lcd value={myCount} caught={caught} />
          </div>

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
                  flushPending()
                  setFacultyId(null)
                }}
              >เปลี่ยน</button>
            </div>
          </fieldset>
        </div>
      </section>

      {facultyId === null && (
        <FacultyPicker
          lizard1Src={lizard1}
          onPick={(id) => {
            setFacultyId(id)
            setSessionClicks(0)
            clickTimes.current = []
          }}
        />
      )}

      {errOpen && <ErrorDialog onOk={closeError} />}
      {readyOpen && <ReadyDialog onClose={() => setReadyOpen(false)} />}
      {allFacultiesOpen && (
        <AllFacultiesDialog rows={allFacultyRows} onClose={() => setAllFacultiesOpen(false)} />
      )}

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
