export default function ErrorDialog({ onOk }) {
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
