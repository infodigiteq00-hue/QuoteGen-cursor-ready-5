/**
 * Express side of the login gate.
 *
 * The browser signs in against Supabase Auth directly with the anon key
 * (src/supabaseClient.js) and sends the resulting access token as a bearer
 * token on every /api call. This module's job is only to verify that token.
 *
 * Data stays shared/single-tenant: the service role key is still the only
 * credential Express uses to read and write application tables, and logging in
 * simply unlocks the app rather than scoping data to the signed-in user.
 */
import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { readDemoLeadByCode } from './googleSheetLead.js'

function authUnavailable(res, requestId) {
  const err = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
  err.code = 'SUPABASE_UNAVAILABLE'
  err.status = 503
  return supabaseError(err, res, requestId)
}

function isPublicApiRequest(req) {
  const full = String(req.originalUrl || req.url || '').split('?')[0]
  const mounted = String(req.path || '').split('?')[0]
  const paths = [full, mounted, `/api${mounted}`]
  const method = String(req.method || 'GET').toUpperCase()
  return paths.some((p) => (
    /* Lead form + funnel progress are public; GET list is super-admin and must stay behind auth. */
    ((p === '/api/meta-ads-leads' || p === '/meta-ads-leads') && method === 'POST')
    || ((p === '/api/meta-ads-leads/progress' || p === '/meta-ads-leads/progress') && method === 'POST')
    || p.startsWith('/api/meta-ads-trial/')
    || p.startsWith('/meta-ads-trial/')
    || p.startsWith('/api/pay/phonepe/')
    || p.startsWith('/pay/phonepe/')
  ))
}

async function isShortDemoQuote(req) {
  const method = String(req.method || 'GET').toUpperCase()
  if (method !== 'POST') return false
  const full = String(req.originalUrl || req.url || '').split('?')[0]
  const mounted = String(req.path || '').split('?')[0]
  const paths = [full, mounted, `/api${mounted}`]
  if (!paths.some((p) => p === '/api/generate-quotation' || p === '/generate-quotation')) return false
  const code = String(req.get('x-demo-code') || '').replace(/\D/g, '')
  if (!code) return false
  try {
    const lead = await readDemoLeadByCode(code)
    return Boolean(lead?.email || (lead?.phone && lead.phone.length === 10))
  } catch {
    return false
  }
}

/** Attach req.userId / req.userEmail from a Bearer access token, or 401. */
export async function requireAuth(req, res, next) {
  if (isPublicApiRequest(req)) return next()
  if (await isShortDemoQuote(req)) return next()
  const requestId = `auth-mw-${Date.now()}`
  if (!isSupabaseConfigured()) return authUnavailable(res, requestId)
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    return res.status(401).json({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED', requestId })
  }
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Your session has expired. Please log in again.', code: 'UNAUTHENTICATED', requestId })
    }
    req.userId = data.user.id
    req.userEmail = data.user.email
    next()
  } catch (error) {
    res.status(401).json({ error: error?.message || 'Not authenticated', code: 'UNAUTHENTICATED', requestId })
  }
}

export function registerAuthRoutes(app) {
  // Sign up / sign in / OTP / refresh / sign out all happen in the browser
  // against Supabase Auth, so Express exposes no auth endpoints of its own.
  // Echoing the verified token back is useful for debugging the gate.
  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: { id: req.userId, email: req.userEmail } })
  })
}
