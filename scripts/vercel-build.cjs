#!/usr/bin/env node
const { execSync } = require('node:child_process')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const frontend = path.join(root, 'frontend')

console.log(`[vercel-build] npm run build in ${frontend}`)
execSync('npm run build', { cwd: frontend, stdio: 'inherit' })
