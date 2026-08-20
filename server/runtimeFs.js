/**
 * Local `npm run dev` keeps writing to project `data/` as before.
 * Vercel's bundle is read-only, so on VERCEL we copy bundled files into /tmp
 * once per cold start and use that writable copy.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUNDLED_DATA_DIR = path.join(__dirname, '..', 'data')

let cachedDir = null

function copyMissing(src, dest) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyMissing(from, to)
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to)
  }
}

export function getDataDir() {
  if (cachedDir) return cachedDir
  if (!process.env.VERCEL) {
    cachedDir = BUNDLED_DATA_DIR
    return cachedDir
  }
  const dest = path.join(os.tmpdir(), 'quotegen-data')
  try {
    copyMissing(BUNDLED_DATA_DIR, dest)
  } catch (error) {
    console.warn('[runtimeFs] could not seed /tmp data dir', error?.message || error)
    fs.mkdirSync(dest, { recursive: true })
  }
  cachedDir = dest
  return cachedDir
}
