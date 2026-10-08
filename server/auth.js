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
import { sendUserEmail } from './mail.js'

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
    || ((p === '/api/pay/request' || p === '/pay/request' || p.startsWith('/api/pay/request/') || p.startsWith('/pay/request/') || p.startsWith('/api/pay/quotation/') || p.startsWith('/pay/quotation/')) && method === 'GET')
    || ((p === '/api/whatsapp/enquiry' || p === '/whatsapp/enquiry') && method === 'POST')
    || ((p === '/api/auth/request-password-reset' || p === '/auth/request-password-reset') && method === 'POST')
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

  /**
   * Password reset via Resend — same delivery path as trial OTP.
   * Supabase's built-in resetPasswordForEmail often never arrives (default
   * mailer / unverified SMTP). We generate a recovery link with the service
   * role and send it ourselves. Always return a generic ok to avoid email enumeration.
   */
  app.post('/api/auth/request-password-reset', async (req, res) => {
    const requestId = `pwd-reset-${Date.now()}`
    const email = String(req.body?.email || '').trim().toLowerCase()
    const redirectTo = String(req.body?.redirectTo || '').trim() || undefined
    const genericOk = () => res.json({
      ok: true,
      email,
      message: 'If that email has an account, a reset link is on its way.',
      requestId
    })

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.', code: 'VALIDATION', requestId })
    }
    if (!isSupabaseConfigured()) return authUnavailable(res, requestId)
    if (!process.env.RESEND_API_KEY?.trim()) {
      console.error(`[${requestId}] RESEND_API_KEY missing — cannot email password reset`)
      return res.status(503).json({
        error: 'Reset email isn’t available right now. Please try again in a minute.',
        requestId
      })
    }

    try {
      const supabase = getSupabase()
      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: redirectTo ? { redirectTo } : undefined
      })
      if (error) {
        // Unknown / unconfirmed accounts: pretend success so callers can't probe.
        console.warn(`[${requestId}] recovery link skipped for ${email}:`, error.message)
        return genericOk()
      }

      const actionLink = String(data?.properties?.action_link || '').trim()
      const otp = String(data?.properties?.email_otp || '').trim()
      if (!actionLink && !otp) {
        console.error(`[${requestId}] recovery generateLink returned no link/otp for ${email}`)
        return genericOk()
      }

      const lines = [
        'Reset your QuoteGen password',
        '',
        actionLink ? `Open this link to choose a new password:` : null,
        actionLink || null,
        actionLink && otp ? '' : null,
        otp ? `Or enter this code on the QuoteGen reset screen: ${otp}` : null,
        '',
        'If you did not ask for a reset, you can ignore this email.',
        '',
        '— QuoteGen'
      ].filter((line) => line != null)

      const mailed = await sendUserEmail({
        to: email,
        subject: 'Reset your QuoteGen password',
        text: lines.join('\n')
      })
      if (!mailed.ok) {
        console.error(`[${requestId}] password reset email failed`, mailed.error)
        const unverified = /not verified|verify your domain/i.test(mailed.error || '')
        return res.status(502).json({
          error: unverified
            ? 'Email sending isn’t set up yet — the sender domain is not verified in Resend.'
            : 'Could not email the reset link. Try again in a minute.',
          code: 'MAIL_FAILED',
          requestId
        })
      }
      if (process.env.NODE_ENV !== 'production' || process.env.LOG_PASSWORD_RESET === '1') {
        console.log(`[${requestId}] password reset emailed to ${email}`)
      }
      return genericOk()
    } catch (error) {
      console.error(`[${requestId}] password reset failed`, error?.message)
      return supabaseError(error, res, requestId)
    }
  })
}
