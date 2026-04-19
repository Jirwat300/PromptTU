import { memo } from 'react'

const Lizard = memo(function Lizard({ src }) {
  return (
    <img
      src={src}
      alt="Lizard mascot"
      className="lizard-img"
      draggable={false}
      decoding="async"
    />
  )
})

export default Lizard
