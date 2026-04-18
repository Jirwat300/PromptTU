import { useEffect, useMemo, useState } from 'react'
import logo from './assets/logo.png'
import daoImage from './assets/Dao.png'
import diwImage from './assets/Diw.png'

const navItems = [
  { label: 'เกี่ยวกับพรรค', href: '#about' },
  { label: 'นโยบาย', href: '#activity' },
  { label: 'ผู้สมัคร', href: '#home' },
  { label: 'POP TU', href: '#poptu' },
  { label: 'ติดต่อเรา', href: '#contact' },
]

/**
 * วันเลือกตั้งธรรมศาสตร์ — 28 เมษายน 08:00 น.
 * ถ้าปีปัจจุบันเลยวันที่ 28 เม.ย. ไปแล้ว ให้นับไปปีถัดไปโดยอัตโนมัติ
 */
const ELECTION_DATE = (() => {
  const now = new Date()
  const thisYear = new Date(now.getFullYear(), 3, 28, 8, 0, 0) // month 3 = April
  return now > thisYear
    ? new Date(now.getFullYear() + 1, 3, 28, 8, 0, 0)
    : thisYear
})()

function getTimeLeft(target = ELECTION_DATE) {
  const diff = Math.max(0, target.getTime() - Date.now())
  return {
    d: Math.floor(diff / 86_400_000),
    h: Math.floor((diff / 3_600_000) % 24),
    m: Math.floor((diff / 60_000) % 60),
    s: Math.floor((diff / 1_000) % 60),
    done: diff === 0,
  }
}

const activityCards = [1, 2, 3]
const todayCards = [1, 2, 3]
const membershipCards = [
  { subtitle: 'สมัครเป็น', title: 'คณะทำงาน' },
  { subtitle: 'สมัครเป็น', title: 'สมาชิกพรรค' },
  { subtitle: 'สมัครเป็น', title: 'SUPPORTER' },
]

function Home() {
  const [scrollY, setScrollY] = useState(0)
  /** 'dao' | 'diw' | null — ควบคุมโฟกัสทีละคนบนเดสก์ท็อป (เลเยอร์ hit แยกซ้าย/ขวา) */
  const [candidateHover, setCandidateHover] = useState(null)
  const [timeLeft, setTimeLeft] = useState(getTimeLeft)

  // อัปเดตทุกวินาที (หน้าเว็บ tab ทำงานเมื่อมองเห็น — ไม่มี tick เพิ่มโหลด)
  useEffect(() => {
    setTimeLeft(getTimeLeft())
    const id = setInterval(() => setTimeLeft(getTimeLeft()), 1000)
    return () => clearInterval(id)
  }, [])

  const countdownItems = useMemo(
    () => [
      { value: timeLeft.d, label: 'วัน' },
      { value: timeLeft.h, label: 'ชั่วโมง' },
      { value: timeLeft.m, label: 'นาที', active: true },
      { value: timeLeft.s, label: 'วินาที' },
    ],
    [timeLeft],
  )

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 721px)')
    const clearWhenNarrow = () => {
      if (!mq.matches) setCandidateHover(null)
    }
    mq.addEventListener('change', clearWhenNarrow)
    clearWhenNarrow()
    return () => mq.removeEventListener('change', clearWhenNarrow)
  }, [])

  const heroStyle = useMemo(() => {
    const viewportHeight = window.innerHeight || 1
    const progress = Math.min(scrollY / (viewportHeight * 0.75), 1)

    return {
      opacity: 1 - progress,
      transform: `translate3d(0, ${progress * 90}px, 0) scale(${1 - progress * 0.08})`,
    }
  }, [scrollY])

  return (
    <main className="page-shell">
      <section id="home" className="hero-shell">
        <header className="navbar">
          <nav className="navbar-inner" aria-label="Main navigation">
            <a className="brand" href="#home" aria-label="Party home">
              <img src={logo} alt="Party logo" className="brand-logo" />
            </a>

            <div className="nav-links">
              {navItems.map((item) => (
                <a key={item.label} href={item.href}>
                  {item.label}
                </a>
              ))}
            </div>
          </nav>
        </header>

        <div className="hero-layer" style={heroStyle}>
          <div className="hero-content">
            <div
              className={
                candidateHover
                  ? `hero-visual hero-visual--hover-${candidateHover}`
                  : 'hero-visual'
              }
            >
              <div className="hero-copy sr-only">
                <p>Promoted Candidate Election</p>
                <h1>คุณพร้อมเปลี่ยนธรรมศาสตร์ไปพร้อมเราไหม</h1>
              </div>

              <div className="hero-heading">
                <h1 className="hero-title">
                  คุณพร้อมเปลี่ยน
                  <br />
                  ธรรมศาสตร์
                  <br />
                  ไปพร้อมเราไหม
                </h1>
              </div>

              <div className="hero-election-badge" aria-hidden="true">
                <p className="hero-election-date">
                  28 เมษายน นี้
                  <br />
                  กาเบอร์
                </p>
                <p className="hero-election-number">3</p>
              </div>

              <div className="hero-candidate-dim" aria-hidden="true" />

              <div className="dao-spot">
                <div className="dao-hover-label" aria-hidden="true">
                  <h3>พพ.ดาว</h3>
                  <p className="candidate-sub">ผู้ลงสมัครตำแหน่งประธานนักศึกษา</p>
                  <ul className="candidate-bio-list">
                    <li>มุ่งมั่นสร้างธรรมศาสตร์ที่ทุกคนมีส่วนร่วม</li>
                    <li>มีประสบการณ์การทำงานเพื่อส่วนรวม</li>
                    <li>มีปัญหาปรึกษาดาว เราพร้อมช่วยเหลือ</li>
                  </ul>
                </div>
                <img src={daoImage} alt="Dao candidate" className="candidate-photo dao-photo" />
              </div>

              <div className="diw-spot">
                <div className="diw-hover-label" aria-hidden="true">
                  <h3>พพ.ดิว</h3>
                  <p className="candidate-sub">ผู้ลงสมัครตำแหน่งประธานสภานักศึกษา</p>
                  <ul className="candidate-bio-list">
                    <li>เชี่ยวชาญการทำงานจัดการภายในองค์กร</li>
                    <li>พร้อมเป็นกระบอกเสียงให้ทุกกลุ่ม</li>
                    <li>ธรรมศาสตร์และการดิว จัดการได้ตามนโยบาย</li>
                  </ul>
                </div>
                <img src={diwImage} alt="Diw candidate" className="candidate-photo diw-photo" />
              </div>

              <div
                className="candidate-hit-layer"
                aria-hidden="true"
                onMouseLeave={() => setCandidateHover(null)}
              >
                <div
                  className="candidate-hit candidate-hit--dao"
                  onMouseEnter={() => setCandidateHover('dao')}
                />
                <div
                  className="candidate-hit candidate-hit--gap"
                  onMouseEnter={() => setCandidateHover(null)}
                />
                <div
                  className="candidate-hit candidate-hit--diw"
                  onMouseEnter={() => setCandidateHover('diw')}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="countdown" className="countdown-section">
        <div className="section-inner">
          <h2 className="section-title">นับถอยหลังเลือกตั้งธรรมศาสตร์</h2>
          <div className="countdown-board">
            <p className="countdown-board-title">นับถอยหลังเลือกตั้งธรรมศาสตร์</p>
            <div className="countdown-grid" role="timer" aria-live="polite">
              {countdownItems.map((item) => (
                <article
                  key={item.label}
                  className={`countdown-card${item.active ? ' countdown-card--active' : ''}`}
                >
                  <p className="countdown-value">
                    {String(item.value).padStart(item.label === 'วินาที' ? 2 : 1, '0')}
                  </p>
                  <p className="countdown-label">{item.label}</p>
                </article>
              ))}
            </div>
            <ul className="countdown-links">
              <li>↗ เข้าสู่เว็บไซต์เลือกตั้ง</li>
              <li>↗ เข้าสู่เว็บไซต์กกต. มธ.</li>
              <li>↗ ฉันเป็นผู้มีสิทธิเลือกพรรคพร้อมธรรมหรือไม่</li>
            </ul>
            <p className="countdown-watermark">3</p>
          </div>
        </div>
      </section>

      <section id="about" className="why-section">
        <div className="section-inner why-inner">
          <h2 className="section-title">ทำไมถึงชื่อพร้อมธรรม</h2>
          <p className="why-copy">
            “RIGHTLY PROMPT, RIGHT BY YOU” “พร้อมธรรม” ทำไมพร้อมอยู่ตลอด
            <br />
            “พร้อมธรรม” เป็นวิสัยทัศน์ที่ไม่ใช่มีที่มาจากการหาวิธีอยู่ตอบโต้ในเชิงนิยาม
            <br />
            หากแต่ต้องย้อนกลับไปผ่านสายตาของกลุ่มคน ผู้ที่อยากจะกลายเป็นองค์กรที่เชื่อว่า
            <br />
            องค์การนักศึกษามหาวิทยาลัยธรรมศาสตร์ คือเป็นดั่งน้องจากการที่เรา “มองเห็นปัญหา”
            <br />
            ที่ในช่วงเวลานั้นยังไม่สามารถแก้ไขได้อย่างเต็มศักยภาพ
          </p>
          <button type="button" className="pill-outline-button">
            อ่านเพิ่มเติม
          </button>
        </div>
      </section>

      <section id="activity" className="cards-section">
        <div className="section-inner">
          <div className="section-header-row">
            <h2 className="section-title">กิจกรรมจากพรรค</h2>
            <button type="button" className="pill-outline-button pill-outline-button--small">
              แสดงมุมมองแบบปฏิทิน
            </button>
          </div>
          <div className="cards-grid">
            <button type="button" className="card-nav card-nav--left" aria-label="Previous">
              ←
            </button>
            {activityCards.map((card) => (
              <article key={card} className="blue-card" />
            ))}
            <button type="button" className="card-nav card-nav--right" aria-label="Next">
              →
            </button>
          </div>
        </div>
      </section>

      <section id="today" className="cards-section">
        <div className="section-inner">
          <div className="section-header-row">
            <h2 className="section-title">วันนี้พร้อมธรรม ทำอะไร</h2>
            <button type="button" className="pill-outline-button pill-outline-button--small">
              โซเชียลมีเดียพรรค
            </button>
          </div>
          <div className="cards-grid">
            <button type="button" className="card-nav card-nav--left" aria-label="Previous">
              ←
            </button>
            {todayCards.map((card) => (
              <article key={card} className="blue-card" />
            ))}
            <button type="button" className="card-nav card-nav--right" aria-label="Next">
              →
            </button>
          </div>
        </div>
      </section>

      <section id="membership" className="cards-section">
        <div className="section-inner">
          <h2 className="section-title">สมัครสมาชิกพรรค</h2>
          <div className="cards-grid">
            {membershipCards.map((card) => (
              <article key={card.title} className="blue-card blue-card--membership">
                <p>{card.subtitle}</p>
                <h3>{card.title}</h3>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="contact-section">
        <div className="section-inner">
          <div className="contact-grid">
            <div>
              <h2 className="section-title section-title--left">ติดต่อเรา</h2>
              <article className="blue-card blue-card--contact" />
            </div>
            <div>
              <h2 className="section-title section-title--left">บริจาคให้พรรค</h2>
              <article className="blue-card blue-card--donate" />
            </div>
          </div>
        </div>
      </section>

      <footer id="footer" className="site-footer">
        <div className="footer-pill">#พร้อมโหวต</div>
        <div className="footer-meta">
          <p>สื่อดิจิทัลนี้จัดทำและเว็บไซต์นี้จัดทำโดย พรรคพร้อมธรรม</p>
          <p>Copyright © 2026 พรรคพร้อมโหวต. All Rights Reserved.</p>
        </div>
        <p className="footer-display">พร้อมธรรม</p>
      </footer>
    </main>
  )
}

export default Home
