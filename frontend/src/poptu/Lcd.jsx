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

export function Lcd({ value, caught }) {
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
