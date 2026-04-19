/**
 * One-shot asset pipeline: PNG → WebP (resize + compress).
 * Run: npm run optimize-assets
 * Re-run after replacing source PNGs.
 */
import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const assetsDir = path.join(root, 'src/assets')
const publicDir = path.join(root, 'public')

async function toWebp(src, dest, { maxWidth, quality = 82 }) {
  if (!existsSync(src)) {
    console.warn(`skip (missing): ${src}`)
    return
  }
  let pipeline = sharp(src)
  const meta = await sharp(src).metadata()
  if (maxWidth && meta.width && meta.width > maxWidth) {
    pipeline = sharp(src).resize({ width: maxWidth, withoutEnlargement: true })
  }
  await mkdir(path.dirname(dest), { recursive: true })
  await pipeline.webp({ quality, effort: 5 }).toFile(dest)
  const st = await stat(dest)
  console.log(`ok ${path.relative(root, dest)} (${Math.round(st.size / 1024)} KB)`)
}

const jobs = [
  ...[1, 2, 3, 4, 5].map((n) => ({
    src: path.join(assetsDir, `Lizard${n}.PNG`),
    dest: path.join(assetsDir, `Lizard${n}.webp`),
    maxWidth: 720,
  })),
  {
    src: path.join(assetsDir, 'pt.PNG'),
    dest: path.join(assetsDir, 'pt.webp'),
    maxWidth: 1600,
    quality: 78,
  },
  {
    src: path.join(publicDir, 'PTLOGO.png'),
    dest: path.join(publicDir, 'PTLOGO.webp'),
    maxWidth: 320,
    quality: 85,
  },
]

for (const j of jobs) {
  await toWebp(j.src, j.dest, j)
}

console.log('done.')
