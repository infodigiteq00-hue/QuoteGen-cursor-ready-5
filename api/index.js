/**
 * Vercel Node function at /api. Rewrites send /api/* here.
 * Local `npm run dev` still runs `node server/index.js` and never imports this file.
 *
 * bodyParser is off so Express + multer see the raw body (uploads / JSON).
 */
import app from '../server/index.js'

function ensureApiUrl(req) {
  const raw = req.url || '/'
  if (raw === '/api' || raw.startsWith('/api/') || raw.startsWith('/api?')) return
  const q = raw.indexOf('?')
  const pathname = q === -1 ? raw : raw.slice(0, q)
  const search = q === -1 ? '' : raw.slice(q)
  const suffix = pathname === '/' ? '' : pathname
  req.url = `/api${suffix}${search}`
}

export default function handler(req, res) {
  ensureApiUrl(req)
  return app(req, res)
}

export const runtime = 'nodejs'
export const maxDuration = 60

export const config = {
  runtime: 'nodejs',
  api: {
    bodyParser: false
  },
  maxDuration: 60
}
