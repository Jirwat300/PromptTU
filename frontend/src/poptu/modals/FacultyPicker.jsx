import { useState } from 'react'
import { FACULTIES, WIN_DECO_BTN } from '../constants.js'

export default function FacultyPicker({ onPick, lizard1Src }) {
  const [selected, setSelected] = useState(FACULTIES[0].id)
  return (
    <div className="poptu-modal-root" role="dialog" aria-modal="true" aria-labelledby="fp-title">
      <div className="win-dialog" style={{ width: 'min(420px, 100%)' }}>
        <div className="win-titlebar">
          <span className="win-title win-title--font-2005" id="fp-title" lang="th">เลือกคณะก่อนเริ่มเล่น</span>
          <div className="win-title-btns">
            <button type="button" className="win-btn" aria-label="Minimise" {...WIN_DECO_BTN}>_</button>
          </div>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 10px' }}>
            <img
              src={lizard1Src}
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
