import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { sendAdminEmail, sendUserEmail } from './mail.js'
import { canManageMetaAdsLeads, isSuperAdmin } from './superAdmin.js'
import { accountSnapshotsByEmail } from './adminUsers.js'

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

async function notifyN8nLead(lead, saved) {
  const url = String(process.env.N8N_LEAD_WEBHOOK_URL || '').trim()
  if (!url) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        id: saved?.id || null,
        name: lead.name,
        phone: lead.phone,
        phoneE164: lead.phone ? `+91${lead.phone}` : '',
        email: lead.email,
        company: lead.company || '',
        monthlyQuotes: lead.monthlyQuotes,
        industry: lead.industry,
        source: lead.source,
        createdAt: saved?.created_at || new Date().toISOString()
      })
    })
    if (!response.ok) {
      console.error('[n8n] lead webhook returned', response.status)
    }
  } catch (err) {
    console.error('[n8n] lead webhook failed', err?.message || err)
  } finally {
    clearTimeout(timer)
  }
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
  const monthlyQuotes = String(body?.monthlyQuotes || '').trim().slice(0, 40)
  const industry = String(body?.industry || '').trim().slice(0, 80)
  const source = String(body?.source || 'meta_ads_landing').trim() || 'meta_ads_landing'
  const path = String(body?.path || '').trim().slice(0, 200)
  const query = String(body?.query || '').trim().slice(0, 500)
  return { name, phone, email, company, monthlyQuotes, industry, source, path, query }
}

function validateLead(lead) {
  if (!lead.name) return 'Please enter your name.'
  if (lead.phone.length !== 10) return 'Enter a valid 10-digit mobile number.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return 'Enter a valid email address.'
  if (!lead.monthlyQuotes) return 'Enter how many quotations you make in a month.'
  if (!lead.industry) return 'Enter your industry.'
  return ''
}

const STAGE_RANK = { lead: 0, demo: 1, purchased: 2 }
const REMINDER_MINUTES = [5, 10, 15, 30, 60, 1440]

function reminderMinutesOf(value) {
  const n = Number(value)
  return REMINDER_MINUTES.includes(n) ? n : 10
}

function serializeLead(row) {
  return {
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    company: row.company || '',
    monthlyQuotes: row.monthly_quotes || '',
    industry: row.industry || '',
    source: row.source || '',
    path: row.path || '',
    query: row.query || '',
    status: row.status === 'purchased' || row.status === 'demo' ? row.status : 'lead',
    intent: row.intent === 'company' ? 'company' : row.intent === 'demo' ? 'demo' : '',
    demoAt: row.demo_at || null,
    purchasedAt: row.purchased_at || null,
    purchaseAmount: row.purchase_amount || null,
    purchaseOrderId: row.purchase_order_id || '',
    remarks: row.remarks || '',
    followUpAt: row.follow_up_at || null,
    reminderMinutes: reminderMinutesOf(row.reminder_minutes),
    deactivated: Boolean(row.deactivated_at),
    deactivatedAt: row.deactivated_at || null,
    createdAt: row.created_at
  }
}

const LEAD_COLUMNS = 'id, name, phone, email, company, monthly_quotes, industry, source, path, query, status, intent, demo_at, purchased_at, purchase_amount, purchase_order_id, remarks, follow_up_at, reminder_minutes, deactivated_at, created_at'

async function findLatestLead(supabase, { email, phone }) {
  const em = String(email || '').trim().toLowerCase()
  const ph = digitsOnly(phone)
  if (em) {
    const { data, error } = await supabase
      .from('meta_ads_leads')
      .select('id, status, intent, email, phone, demo_at, purchase_order_id')
      .eq('email', em)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw error
    const rows = data || []
    if (ph.length === 10) {
      const byPhone = rows.find((row) => row.phone === ph)
      if (byPhone) return byPhone
    }
    return rows[0] || null
  }
  if (ph.length === 10) {
    const { data, error } = await supabase
      .from('meta_ads_leads')
      .select('id, status, intent, email, phone, demo_at, purchase_order_id')
      .eq('phone', ph)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data || null
  }
  return null
}

/** Advance a Meta ads lead without downgrading (lead → demo → purchased). */
export async function markMetaAdsLeadStage(supabase, {
  email,
  phone,
  name,
  company,
  stage,
  amount,
  orderId
} = {}) {
  const nextStage = stage === 'purchased' ? 'purchased' : (stage === 'company' || stage === 'demo') ? 'demo' : ''
  if (!nextStage) return null

  const em = String(email || '').trim().toLowerCase()
  const ph = digitsOnly(phone)
  const now = new Date().toISOString()
  const existing = await findLatestLead(supabase, { email: em, phone: ph })

  const patch = {}
  if (nextStage === 'demo') {
    if (stage === 'company' || stage === 'demo') patch.intent = stage
    if (!existing?.demo_at) patch.demo_at = now
    if ((STAGE_RANK[existing?.status] ?? 0) < STAGE_RANK.demo) patch.status = 'demo'
  }
  if (nextStage === 'purchased') {
    patch.status = 'purchased'
    patch.purchased_at = now
    const rupees = Math.round(Number(amount) || 0)
    if (rupees > 0) patch.purchase_amount = rupees
    if (orderId) patch.purchase_order_id = String(orderId).slice(0, 80)
  }

  if (!Object.keys(patch).length) return existing?.id || null

  if (existing) {
    if (nextStage === 'purchased' && existing.purchase_order_id && orderId && existing.purchase_order_id === String(orderId)) {
      return existing.id
    }
    const { error } = await supabase.from('meta_ads_leads').update(patch).eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  if (nextStage !== 'purchased') return null

  const insert = {
    name: String(name || '').trim() || 'Customer',
    phone: ph.length === 10 ? ph : '',
    email: em || '',
    company: String(company || '').trim(),
    source: 'phonepe',
    status: 'purchased',
    intent: 'demo',
    purchased_at: now,
    purchase_amount: Math.round(Number(amount) || 0) || null,
    purchase_order_id: orderId ? String(orderId).slice(0, 80) : null
  }
  if (!insert.email && !insert.phone) return null
  const { data, error } = await supabase.from('meta_ads_leads').insert(insert).select('id').single()
  if (error) throw error
  return data?.id || null
}

function trialUserMeta(body) {
  const name = String(body?.name || '').trim()
  const company = String(body?.company || '').trim()
  const phoneDigits = digitsOnly(body?.phone).slice(0, 10)
  const meta = { source: 'meta_ads_landing' }
  if (name) meta.full_name = name
  if (company) meta.company = company
  if (phoneDigits.length === 10) {
    meta.phone_digits = phoneDigits
    meta.phone = `+91${phoneDigits}`
    meta.phone_e164 = `+91${phoneDigits}`
  }
  return { email: String(body?.email || '').trim().toLowerCase(), meta, phoneDigits, name, company }
}

async function findAuthUserByEmail(supabase, email) {
  const em = String(email || '').trim().toLowerCase()
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const users = data?.users || []
    const match = users.find((u) => String(u.email || '').toLowerCase() === em)
    if (match) return match
    if (users.length < 200) return null
  }
  return null
}

/**
 * New users + signInWithOtp would otherwise get the Confirm signup *link*
 * (and log them straight into the app). Confirm the user first so Resend OTP
 * uses the Magic Link / 6-digit template instead.
 */
async function ensureConfirmedMetaTrialUser(supabase, email, meta) {
  const created = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: meta
  })
  if (created.data?.user && !created.error) return created.data.user
  if (!/already|registered|exists/i.test(created.error?.message || '')) {
    throw created.error
  }
  const existing = await findAuthUserByEmail(supabase, email)
  if (!existing) throw created.error
  const nextMeta = { ...(existing.user_metadata || {}), ...meta }
  const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
    email_confirm: true,
    user_metadata: nextMeta
  })
  if (error) throw error
  return data?.user || existing
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
          monthly_quotes: lead.monthlyQuotes,
          industry: lead.industry,
          source: lead.source,
          path: lead.path,
          query: lead.query,
          status: 'lead'
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
            `Quotations / month: ${lead.monthlyQuotes}`,
            `Industry: ${lead.industry}`,
            `Source: ${lead.source}`,
            `Path: ${lead.path || '/'}`,
            `Time: ${data?.created_at || new Date().toISOString()}`,
            '',
            '— QuoteGen'
          ].join('\n')
        })
        emailed = Boolean(mail.ok)
      }

      await notifyN8nLead(lead, data)

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

  app.post('/api/meta-ads-leads/progress', async (req, res) => {
    const requestId = `mal-prog-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    const stage = String(req.body?.stage || '').trim().toLowerCase()
    if (stage !== 'demo' && stage !== 'company') {
      return res.status(400).json({ error: 'Unknown step.', code: 'VALIDATION', requestId })
    }
    const email = String(req.body?.email || '').trim().toLowerCase()
    const phone = digitsOnly(req.body?.phone)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length !== 10) {
      return res.status(400).json({ error: 'Enter the same email and mobile used on the form.', code: 'VALIDATION', requestId })
    }

    try {
      const id = await markMetaAdsLeadStage(supabase, {
        email,
        phone,
        name: req.body?.name,
        company: req.body?.company,
        stage
      })
      if (!id) {
        return res.status(404).json({ error: 'Lead not found.', code: 'NOT_FOUND', requestId })
      }
      return res.json({ ok: true, id, requestId })
    } catch (error) {
      console.error(`[${requestId}] meta ads lead progress failed`, error?.code, error?.message)
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
    const { meta } = trialUserMeta(req.body)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.', code: 'VALIDATION', requestId })
    }

    try {
      await ensureConfirmedMetaTrialUser(supabase, email, { ...meta, meta_trial_skip_otp: true })

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

  /**
   * Issue a login OTP and email the digits. One generateLink call — do not
   * also call signInWithOtp from the browser (that 429s as a second send).
   */
  app.post('/api/meta-ads-trial/prepare-otp', async (req, res) => {
    const requestId = `mal-otp-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    const { email, meta } = trialUserMeta(req.body)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.', code: 'VALIDATION', requestId })
    }

    if (!process.env.RESEND_API_KEY?.trim()) {
      console.error(`[${requestId}] RESEND_API_KEY missing — cannot email trial OTP`)
      return res.status(503).json({
        error: 'Verification email isn’t available right now. Please try again in a minute.',
        requestId
      })
    }
    try {
      await ensureConfirmedMetaTrialUser(supabase, email, meta)
      const { data, error } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          data: meta,
          redirectTo: String(req.body?.redirectTo || '').trim() || undefined
        }
      })
      if (error) {
        if (/rate limit|after\s*\d+\s*seconds|security purposes/i.test(error.message || '')) {
          return res.status(429).json({
            error: 'A code was just sent to this email. Wait a minute, then tap Resend OTP.',
            code: 'RATE_LIMIT',
            requestId
          })
        }
        throw error
      }
      const otp = String(data?.properties?.email_otp || '').trim()
      if (!otp) {
        return res.status(500).json({
          error: 'Could not create a verification code. Try again.',
          code: 'NO_OTP',
          requestId
        })
      }
      if (process.env.NODE_ENV !== 'production' || process.env.META_TRIAL_LOG_OTP === '1') {
        console.log(`[${requestId}] trial OTP for ${email}: ${otp}`)
      }
      const mailed = await sendUserEmail({
        to: email,
        subject: `${otp} is your QuoteGen code`,
        text: [
          `Your QuoteGen verification code is ${otp}.`,
          '',
          'Type this code on the QuoteGen screen to continue.',
          'Ignore any Confirm / Log in link in other emails from Supabase.',
          '',
          '— QuoteGen'
        ].join('\n')
      })
      if (!mailed.ok) {
        console.error(`[${requestId}] trial OTP email failed`, mailed.error)
        const unverified = /not verified|verify your domain/i.test(mailed.error || '')
        return res.status(502).json({
          error: unverified
            ? 'Email sending isn’t set up yet — the sender domain is not verified in Resend.'
            : 'Could not email the code. Try again in a minute.',
          code: 'MAIL_FAILED',
          requestId
        })
      }
      return res.json({
        ok: true,
        email,
        delivery: 'code',
        otpLength: otp.length,
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] meta trial prepare-otp failed`, error?.message)
      if (/rate limit|after\s*\d+\s*seconds|security purposes/i.test(error.message || '')) {
        return res.status(429).json({
          error: 'A code was just sent to this email. Wait a minute, then tap Resend OTP.',
          code: 'RATE_LIMIT',
          requestId
        })
      }
      supabaseError(error, res, requestId)
    }
  })
}

/** Authenticated — super-admin list. */
export function registerMetaAdsLeadRoutes(app) {
  app.get('/api/meta-ads-leads', async (req, res) => {
    const requestId = `mal-list-${Date.now()}`
    if (!canManageMetaAdsLeads(req.userEmail)) {
      return res.status(403).json({ error: 'Meta ads leads access only.', code: 'FORBIDDEN', requestId })
    }
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    try {
      const { data, error, count } = await supabase
        .from('meta_ads_leads')
        .select(LEAD_COLUMNS, { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error

      let accounts = new Map()
      try {
        accounts = await accountSnapshotsByEmail(supabase)
      } catch (accountError) {
        console.error(`[${requestId}] lead account lookup failed`, accountError?.message)
      }
      const leads = (data || []).map((row) => {
        const lead = serializeLead(row)
        const account = accounts.get(String(lead.email || '').trim().toLowerCase()) || null
        return {
          ...lead,
          quotationCount: account ? account.quotationCount : null,
          accountStatus: account?.accountStatus || '',
          joinedAt: account?.joinedAt || null
        }
      })
      const counts = { lead: 0, demo: 0, purchased: 0, inactive: 0 }
      for (const lead of leads) {
        if (lead.deactivated) {
          counts.inactive += 1
          continue
        }
        if (lead.status === 'purchased') counts.purchased += 1
        else if (lead.status === 'demo') counts.demo += 1
        else counts.lead += 1
      }

      res.json({ total: count ?? leads.length, counts, leads, requestId })
    } catch (error) {
      console.error(`[${requestId}] meta ads leads list failed`, error?.code, error?.message)
      if (/meta_ads_leads|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })

  app.patch('/api/meta-ads-leads/:id', async (req, res) => {
    const requestId = `mal-patch-${Date.now()}`
    if (!canManageMetaAdsLeads(req.userEmail)) {
      return res.status(403).json({ error: 'Meta ads leads access only.', code: 'FORBIDDEN', requestId })
    }
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: 'Lead id is required.', code: 'VALIDATION', requestId })

    const body = req.body || {}
    const patch = {}
    if (body.status != null) {
      const status = String(body.status)
      if (!['lead', 'demo', 'purchased'].includes(status)) {
        return res.status(400).json({ error: 'Status must be lead, demo, or purchased.', code: 'VALIDATION', requestId })
      }
      patch.status = status
    }
    if (body.remarks != null) patch.remarks = String(body.remarks).slice(0, 2000)
    if (body.followUpAt !== undefined) {
      if (!body.followUpAt) patch.follow_up_at = null
      else {
        const when = new Date(body.followUpAt)
        if (Number.isNaN(when.getTime())) {
          return res.status(400).json({ error: 'Follow-up date is not valid.', code: 'VALIDATION', requestId })
        }
        patch.follow_up_at = when.toISOString()
      }
    }
    if (body.reminderMinutes != null) {
      const minutes = Number(body.reminderMinutes)
      if (!REMINDER_MINUTES.includes(minutes)) {
        return res.status(400).json({ error: 'Pick a reminder of 5, 10, 15, 30, or 60 minutes, or 1 day.', code: 'VALIDATION', requestId })
      }
      patch.reminder_minutes = minutes
    }
    if (body.deactivated != null) {
      patch.deactivated_at = body.deactivated ? new Date().toISOString() : null
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'Nothing to update.', code: 'VALIDATION', requestId })
    }

    try {
      const { data: existing, error: readError } = await supabase
        .from('meta_ads_leads')
        .select('id, demo_at, purchased_at')
        .eq('id', id)
        .maybeSingle()
      if (readError) throw readError
      if (!existing) return res.status(404).json({ error: 'Lead not found.', code: 'NOT_FOUND', requestId })

      const now = new Date().toISOString()
      if (patch.status === 'demo' && !existing.demo_at) patch.demo_at = now
      if (patch.status === 'purchased' && !existing.purchased_at) patch.purchased_at = now

      const { data, error } = await supabase
        .from('meta_ads_leads')
        .update(patch)
        .eq('id', id)
        .select(LEAD_COLUMNS)
        .single()
      if (error) throw error
      res.json({ lead: serializeLead(data), requestId })
    } catch (error) {
      console.error(`[${requestId}] meta ads lead update failed`, error?.code, error?.message)
      if (/meta_ads_leads|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })

  app.delete('/api/meta-ads-leads/:id', async (req, res) => {
    const requestId = `mal-del-${Date.now()}`
    if (!isSuperAdmin(req.userEmail)) {
      return res.status(403).json({ error: 'Only the QuoteGen owner can delete a lead.', code: 'FORBIDDEN', requestId })
    }
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: 'Lead id is required.', code: 'VALIDATION', requestId })

    try {
      const { data, error } = await supabase
        .from('meta_ads_leads')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'Lead not found.', code: 'NOT_FOUND', requestId })
      res.json({ ok: true, id: data.id, requestId })
    } catch (error) {
      console.error(`[${requestId}] meta ads lead delete failed`, error?.code, error?.message)
      if (/meta_ads_leads|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })
}
