/**
 * Generic Win95-style error dialog. Defaults to the cheat-detection copy used
 * by the client-side CPS guard; pass `title` / `message` / `okLabel` to reuse
 * the same chrome for other fatal-ish states (e.g. captcha block).
 */
export default function ErrorDialog({
  onOk,
  title = 'ERROR',
  message = 'อย่าโกง ผมจับได้นะ !!!',
  okLabel = 'OK',
}) {
  return (
    <div className="poptu-modal-root" role="alertdialog" aria-modal="true" aria-labelledby="err-title">
      <div className="win-dialog">
        <div className="win-titlebar">
          <span className="win-title" id="err-title">{title}</span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" onClick={onOk} aria-label="Close">×</button>
          </div>
        </div>
        <div className="win-dialog-body">
          <div className="win-err-icon" aria-hidden="true">×</div>
          <div className="win-dialog-msg" lang="th">{message}</div>
        </div>
        <div className="win-dialog-actions">
          <button type="button" className="w95-btn" onClick={onOk} autoFocus>{okLabel}</button>
        </div>
      </div>
    </div>
  )
}
