import './comingsoon.css'

/**
 * Standalone “coming soon” landing (hash #comingsoon).
 * Linked from POPTU taskbar Home; CTA returns to the game.
 */
export default function ComingSoon() {
  return (
    <main className="coming-soon" lang="th">
      <div className="coming-soon-main">
        <h1 className="coming-soon-title">
          พบกับเว็บ พร้อมธรรม
          <br />
          เร็ว ๆ นี้
        </h1>
        <a className="coming-soon-cta" href="#poptu">
          เล่น POP TU!
        </a>
      </div>

      <footer className="coming-soon-footer">
        <p className="coming-soon-meta">
          สื่ออิเล็กทรอนิกส์และเว็บไซต์ผลิตโดย พรรคพร้อมธรรม
        </p>
        <p className="coming-soon-copy">
          Copyright © 2026 พรรคพร้อมธรรม. All Rights Reserved.
        </p>
      </footer>

      <p className="coming-soon-brand" aria-hidden="true">
        พร้อมธรรม
      </p>
    </main>
  )
}
