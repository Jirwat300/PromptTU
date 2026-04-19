export function pickRandomPose(currentSrc, poses) {
  if (!poses?.length) return currentSrc
  if (poses.length <= 1) return poses[0]
  const pool = poses.filter((src) => src !== currentSrc)
  return pool[Math.floor(Math.random() * pool.length)]
}
