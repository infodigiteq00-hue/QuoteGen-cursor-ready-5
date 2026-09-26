import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { sendAdminEmail } from './mail.js'
import { isSuperAdmin } from './superAdmin.js'

function requireDb(res, requestId) {
  if (!isSupabaseConfigured()) {
    const err = new Error('Supabase is not configured.')
    err.code = 'SUPABASE_UNAVAILABLE'
    err.status = 503
    supabaseError(err, res, requestId)
    return null
  }
  return getSupabase()
}

function migrationRequired(res, requestId) {
  return res.status(503).json({
    error: 'Meta ads leads are not set up yet. Run the meta_ads_leads migration in Supabase.',
    code: 'MIGRATION_REQUIRED',
    requestId
  })
}

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '')
}

function normalizeLeadBody(body) {
  const name = String(body?.name || '').trim()
  const phone = digitsOnly(body?.phone)
  const email = String(body?.email || '').trim().toLowerCase()
  const company = String(body?.company || '').trim()
  const source = String(body?.source || 'meta_ads_landing').trim() || 'meta_ads_landing'
  const path = String(body?.path || '').trim().slice(0, 200)
  const query = String(body?.query || '').trim().slice(0, 500)
  return { name, phone, email, company, source, path, query }
}

function validateLead(lead) {
  if (!lead.name) return 'Please enter your name.'
  if (lead.phone.length !== 10) return 'Enter a valid 10-digit mobile number.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return 'Enter a valid email address.'
  return ''
}

/** Public — must be registered before requireAuth. */
export function registerPublicMetaAdsLeadRoutes(app) {
  app.post('/api/meta-ads-leads', async (req, res) => {
    const requestId = `mal-post-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    const lead = normalizeLeadBody(req.body)
    const validationError = validateLead(lead)
    if (validationError) {
      return res.status(400).json({ error: validationError, code: 'VALIDATION', requestId })
    }

    try {
      const { data, error } = await supabase
        .from('meta_ads_leads')
        .insert({
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          company: lead.company,
          source: lead.source,
          path: lead.path,
          query: lead.query
        })
        .select('id, created_at')
        .single()
      if (error) throw error

      let emailed = false
      if (process.env.RESEND_API_KEY?.trim()) {
        const mail = await sendAdminEmail({
          to: process.env.META_ADS_LEADS_NOTIFY || process.env.FEATURE_INTEREST_NOTIFY || 'info@digiteqsolution.com',
          subject: `QuoteGen Meta lead: ${lead.name}`,
          text: [
            'New Meta ads landing lead',
            '',
            `Name: ${lead.name}`,
            `Phone: +91 ${lead.phone}`,
            `Email: ${lead.email}`,
            `Company: ${lead.company || '(not provided)'}`,
            `Source: ${lead.source}`,
            `Path: ${lead.path || '/'}`,
            `Time: ${data?.created_at || new Date().toISOString()}`,
            '',
            '— QuoteGen'
          ].join('\n')
        })
        emailed = Boolean(mail.ok)
      }

      res.status(201).json({
        ok: true,
        id: data?.id || null,
        createdAt: data?.created_at || null,
        emailed,
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] meta ads lead insert failed`, error?.code, error?.message)
      if (/meta_ads_leads|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })

  /**
   * Temporary pre-launch bypass: establish a session without email OTP.
   * OTP UI stays in the app; turn off with META_TRIAL_ALLOW_SKIP_OTP=0 before go-live.
   */
  app.post('/api/meta-ads-trial/skip-verify', async (req, res) => {
    const requestId = `mal-skip-${Date.now()}`
    if (String(process.env.META_TRIAL_ALLOW_SKIP_OTP || '1').trim() === '0') {
      return res.status(403).json({
        error: 'Email verification is required.',
        code: 'SKIP_DISABLED',
        requestId
      })
    }
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    const email = String(req.body?.email || '').trim().toLowerCase()
    const name = String(req.body?.name || '').trim()
    const company = String(req.body?.company || '').trim()
    const phoneDigits = digitsOnly(req.body?.phone).slice(0, 10)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.', code: 'VALIDATION', requestId })
    }

    const meta = {
      source: 'meta_ads_landing',
      meta_trial_skip_otp: true
    }
    if (name) meta.full_name = name
    if (company) meta.company = company
    if (phoneDigits.length === 10) {
      meta.phone_digits = phoneDigits
      meta.phone = `+91${phoneDigits}`
      meta.phone_e164 = `+91${phoneDigits}`
    }

    try {
      const created = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: meta
      })
      if (created.error && !/already|registered|exists/i.test(created.error.message || '')) {
        throw created.error
      }

      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { data: meta }
      })
      if (error) throw error
      const tokenHash = data?.properties?.hashed_token || ''
      if (!tokenHash) {
        return res.status(500).json({
          error: 'Could not start the trial session. Try again.',
          code: 'NO_TOKEN',
          requestId
        })
      }
      return res.json({ ok: true, email, tokenHash, requestId })
    } catch (error) {
      console.error(`[${requestId}] meta trial skip-verify failed`, error?.message)
      supabaseError(error, res, requestId)
    }
  })
}

/** Authenticated — super-admin list. */
export function registerMetaAdsLeadRoutes(app) {
  app.get('/api/meta-ads-leads', async (req, res) => {
    const requestId = `mal-list-${Date.now()}`
    if (!isSuperAdmin(req.userEmail)) {
      return res.status(403).json({ error: 'Super admin only.', code: 'FORBIDDEN', requestId })
    }
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    try {
      const { data, error, count } = await supabase
        .from('meta_ads_leads')
        .select('id, name, phone, email, company, source, path, query, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error

      const leads = (data || []).map((row) => ({
        id: row.id,
        name: row.name || '',
        phone: row.phone || '',
        email: row.email || '',
        company: row.company || '',
        source: row.source || '',
        path: row.path || '',
        query: row.query || '',
        createdAt: row.created_at
      }))

      res.json({ total: count ?? leads.length, leads, requestId })
    } catch (error) {
      console.error(`[${requestId}] meta ads leads list failed`, error?.code, error?.message)
      if (/meta_ads_leads|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })
}
