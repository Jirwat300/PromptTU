import { WIN_DECO_BTN } from '../constants.js'

export default function AllFacultiesDialog({ rows, onClose }) {
  return (
    <div
      className="poptu-modal-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="all-fac-title"
      onClick={onClose}
    >
      <div
        className="win-dialog win-dialog--all-faculties"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="win-titlebar">
          <span className="win-title win-title--font-2005" id="all-fac-title" lang="th">
            คะแนนทั้งหมด (คณะและทีม)
          </span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" aria-label="Minimise" {...WIN_DECO_BTN}>_</button>
            <button type="button" className="win-btn" aria-label="Maximise" {...WIN_DECO_BTN}>□</button>
            <button type="button" className="win-btn" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className="win-dialog-body win-dialog-body--all-faculties">
          <ul className="all-faculties-list" lang="th" aria-live="polite" aria-relevant="text">
            {rows.map((r) => (
              <li key={r.id} className="all-faculties-row">
                <span className="all-faculties-rank" aria-hidden="true">{r.rank}</span>
                <span className="all-faculties-meta">
                  <span className="all-faculties-emoji" aria-hidden="true">{r.emoji}</span>
                  <span className="all-faculties-name poptu-zoom-text">{r.name}</span>
                </span>
                <span className="all-faculties-score" translate="no">
                  <span className="all-faculties-score-num">{r.score.toLocaleString('en-US')}</span>
                  <span className="all-faculties-score-suffix"> POP</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="win-dialog-actions">
          <button type="button" className="w95-btn" lang="th" onClick={onClose} autoFocus>
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}
