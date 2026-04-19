import { WIN_DECO_BTN } from '../constants.js'

export default function ReadyDialog({ onClose }) {
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
            <button type="button" className="win-btn" aria-label="Minimise" {...WIN_DECO_BTN}>_</button>
            <button type="button" className="win-btn" aria-label="Maximise" {...WIN_DECO_BTN}>□</button>
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
