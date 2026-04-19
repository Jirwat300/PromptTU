#!/usr/bin/env node
/**
 * Vercel install from monorepo root: cwd can vary; resolve paths from this file.
 * npm in CI sometimes exits non‑zero on audit noise — use --no-audit --no-fund.
 */
const { execSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const frontend = path.join(root, 'frontend')
const backend = path.join(root, 'backend')

const run = (cwd, label) => {
  console.log(`[vercel-install] ${label}: npm install in ${cwd}`)
  execSync('npm install --no-audit --no-fund', { cwd, stdio: 'inherit' })
}

run(frontend, 'frontend')
run(backend, 'backend')
