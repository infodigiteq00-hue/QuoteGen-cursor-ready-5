import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { sendAdminEmail } from './mail.js'
import { isSuperAdmin } from './superAdmin.js'

const CUSTOM_UPLOAD_FEATURE = 'custom_upload'

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
    error: 'Interest tracking is not set up yet. Run the feature_interest migration in Supabase.',
    code: 'MIGRATION_REQUIRED',
    requestId
  })
}

export function registerFeatureInterestRoutes(app) {
  /** Super-admin only: full list of emails for a feature waitlist. */
  app.get('/api/feature-interest/:feature/voters', async (req, res) => {
    const requestId = `fi-voters-${Date.now()}`
    if (!isSuperAdmin(req.userEmail)) {
      return res.status(403).json({ error: 'Super admin only.', code: 'FORBIDDEN', requestId })
    }
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const feature = String(req.params.feature || '').trim() || CUSTOM_UPLOAD_FEATURE
    try {
      const { data, error } = await supabase
        .from('feature_interest')
        .select('email, created_at, user_id')
        .eq('feature', feature)
        .order('created_at', { ascending: false })
      if (error) throw error
      const voters = (data || []).map(row => ({
        email: row.email || '',
        createdAt: row.created_at,
        userId: row.user_id
      }))
      res.json({ feature, total: voters.length, voters, requestId })
    } catch (error) {
      console.error(`[${requestId}] voters failed`, error?.code, error?.message)
      if (/feature_interest|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })

  app.get('/api/feature-interest/:feature', async (req, res) => {
    const requestId = `fi-get-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const feature = String(req.params.feature || '').trim() || CUSTOM_UPLOAD_FEATURE
    try {
      const { data, error } = await supabase
        .from('feature_interest')
        .select('id, created_at')
        .eq('user_id', req.userId)
        .eq('feature', feature)
        .maybeSingle()
      if (error) throw error
      const { count, error: countError } = await supabase
        .from('feature_interest')
        .select('id', { count: 'exact', head: true })
        .eq('feature', feature)
      if (countError) throw countError
      res.json({
        feature,
        interested: Boolean(data),
        createdAt: data?.created_at || null,
        total: count || 0,
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] get failed`, error?.code, error?.message)
      if (/feature_interest|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })

  app.post('/api/feature-interest', async (req, res) => {
    const requestId = `fi-post-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const feature = String(req.body?.feature || CUSTOM_UPLOAD_FEATURE).trim() || CUSTOM_UPLOAD_FEATURE
    const email = String(req.userEmail || req.body?.email || '').trim().toLowerCase()
    try {
      const { data: existing, error: findError } = await supabase
        .from('feature_interest')
        .select('id, created_at')
        .eq('user_id', req.userId)
        .eq('feature', feature)
        .maybeSingle()
      if (findError) throw findError

      if (existing) {
        const { count } = await supabase
          .from('feature_interest')
          .select('id', { count: 'exact', head: true })
          .eq('feature', feature)
        return res.json({
          ok: true,
          already: true,
          feature,
          total: count || 0,
          message: 'You already registered interest from this account.',
          requestId
        })
      }

      const { error: insertError } = await supabase
        .from('feature_interest')
        .insert({
          user_id: req.userId,
          feature,
          email
        })
      if (insertError) {
        if (insertError.code === '23505') {
          const { count } = await supabase
            .from('feature_interest')
            .select('id', { count: 'exact', head: true })
            .eq('feature', feature)
          return res.json({
            ok: true,
            already: true,
            feature,
            total: count || 0,
            message: 'You already registered interest from this account.',
            requestId
          })
        }
        throw insertError
      }

      const { count, error: countError } = await supabase
        .from('feature_interest')
        .select('id', { count: 'exact', head: true })
        .eq('feature', feature)
      if (countError) throw countError
      const total = count || 1

      // Optional: only if RESEND_API_KEY is set. Otherwise admin panel is the source of truth.
      let emailed = false
      if (process.env.RESEND_API_KEY?.trim()) {
        const mail = await sendAdminEmail({
          to: process.env.FEATURE_INTEREST_NOTIFY || 'info@digiteqsolution.com',
          subject: `QuoteGen interest: custom upload (total ${total})`,
          text: [
            'Hey boss,',
            '',
            `The user with this email id is interested in the custom upload feature of QuoteGen:`,
            email || '(no email on account)',
            '',
            `With this user, our total number of interested users for this feature has come to ${total}.`,
            '',
            `Feature: ${feature}`,
            `Time: ${new Date().toISOString()}`,
            '',
            '— QuoteGen'
          ].join('\n')
        })
        emailed = Boolean(mail.ok)
      }

      res.status(201).json({
        ok: true,
        already: false,
        feature,
        total,
        emailed,
        message: 'Thanks — we recorded your interest.',
        requestId
      })
    } catch (error) {
      if (/feature_interest|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })
}
