import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { sendAdminEmail, sendUserEmail } from './mail.js'
import { canManageMetaAdsLeads, isSuperAdmin, superAdminEmails } from './superAdmin.js'
import { isHiddenMetaLead } from '../shared/metaAdsAccess.js'
import { isValidIndiaMobile, normalizeIndiaMobileDigits } from '../shared/phone.js'
import { accountSnapshotsByEmail } from './adminUsers.js'
import { assignPlanOnPassword, loadUserControls, NEW_ACCOUNT_CUTOFF } from './accountAccess.js'
import { upsertUserProfile } from './userProfile.js'
import { appendLeadToSheet, findDemoCodeForLead, readSheetOutreach } from './googleSheetLead.js'
import { buildPaymentRequest } from './paymentRequestBuild.js'

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
        whatsapp: lead.whatsapp || lead.phone,
        whatsappE164: (lead.whatsapp || lead.phone) ? `+91${lead.whatsapp || lead.phone}` : '',
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
  const phone = normalizeIndiaMobileDigits(body?.phone)
  const whatsappSame = body?.whatsappSame !== false
  const whatsapp = whatsappSame ? phone : normalizeIndiaMobileDigits(body?.whatsapp)
  const email = String(body?.email || '').trim().toLowerCase()
  const company = String(body?.company || '').trim()
  const monthlyQuotes = String(body?.monthlyQuotes || '').trim().slice(0, 40)
  const industry = String(body?.industry || '').trim().slice(0, 80)
  const source = String(body?.source || 'meta_ads_landing').trim() || 'meta_ads_landing'
  const path = String(body?.path || '').trim().slice(0, 200)
  const query = String(body?.query || '').trim().slice(0, 500)
  return { name, phone, whatsapp, whatsappSame, email, company, monthlyQuotes, industry, source, path, query }
}

function validateLead(lead) {
  if (!lead.name) return 'Please enter your name.'
  if (!isValidIndiaMobile(lead.phone)) return 'Enter a valid 10-digit mobile number.'
  if (!lead.whatsappSame && !isValidIndiaMobile(lead.whatsapp)) return 'Enter a valid 10-digit WhatsApp number.'
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
    phone: normalizeIndiaMobileDigits(row.phone) || row.phone || '',
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
  const ph = normalizeIndiaMobileDigits(phone)
  if (em) {
    const { data, error } = await supabase
      .from('meta_ads_leads')
      .select('id, name, status, intent, email, phone, demo_at, purchase_order_id')
      .eq('email', em)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) throw error
    const rows = data || []
    if (isValidIndiaMobile(ph)) {
      const byPhone = rows.find((row) => normalizeIndiaMobileDigits(row.phone) === ph || row.phone === ph)
      if (byPhone) return byPhone
    }
    return rows[0] || null
  }
  if (isValidIndiaMobile(ph)) {
    const { data, error } = await supabase
      .from('meta_ads_leads')
      .select('id, name, status, intent, email, phone, demo_at, purchase_order_id')
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
  const ph = normalizeIndiaMobileDigits(phone)
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
    phone: isValidIndiaMobile(ph) ? ph : '',
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
  const phoneDigits = normalizeIndiaMobileDigits(body?.phone)
  const meta = { source: 'meta_ads_landing' }
  if (name) meta.full_name = name
  if (company) meta.company = company
  if (isValidIndiaMobile(phoneDigits)) {
    meta.phone_digits = phoneDigits
    meta.phone = `+91${phoneDigits}`
    meta.phone_e164 = `+91${phoneDigits}`
  }
  return { email: String(body?.email || '').trim().toLowerCase(), meta, phoneDigits, name, company }
}

export async function findAuthUserByEmail(supabase, email) {
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
  app.get('/api/meta-ads-trial/demo/:code', async (req, res) => {
    try {
      const { readDemoLeadByCode } = await import('./googleSheetLead.js')
      const lead = await readDemoLeadByCode(req.params.code)
      if (!lead) return res.status(404).json({ error: 'This demo link was not found.' })
      return res.json({ lead })
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Could not open this demo link.' })
    }
  })

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
      const row = {
        name: lead.name,
        phone: lead.phone,
        whatsapp: lead.whatsapp || lead.phone,
        email: lead.email,
        company: lead.company,
        monthly_quotes: lead.monthlyQuotes,
        industry: lead.industry,
        source: lead.source,
        path: lead.path,
        query: lead.query,
        status: 'lead'
      }
      let inserted = await supabase.from('meta_ads_leads').insert(row).select('id, created_at').single()
      if (inserted.error && /whatsapp|schema cache|42703/i.test(inserted.error.message || '')) {
        const { whatsapp, ...withoutWhatsapp } = row
        void whatsapp
        inserted = await supabase.from('meta_ads_leads').insert(withoutWhatsapp).select('id, created_at').single()
      }
      const { data, error } = inserted
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
            `WhatsApp: +91 ${lead.whatsapp || lead.phone}`,
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
      try {
        const sheet = await appendLeadToSheet(lead)
        if (!sheet.ok) console.error('[sheets] lead not added:', sheet.reason)
      } catch (sheetError) {
        console.error('[sheets] lead append failed', sheetError?.message || sheetError)
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

  app.post('/api/meta-ads-leads/progress', async (req, res) => {
    const requestId = `mal-prog-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    const stage = String(req.body?.stage || '').trim().toLowerCase()
    if (stage !== 'demo' && stage !== 'company') {
      return res.status(400).json({ error: 'Unknown step.', code: 'VALIDATION', requestId })
    }
    const email = String(req.body?.email || '').trim().toLowerCase()
    const phone = normalizeIndiaMobileDigits(req.body?.phone)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isValidIndiaMobile(phone)) {
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

  app.post('/api/meta-ads-trial/account', async (req, res) => {
    const requestId = `mal-acct-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.', code: 'VALIDATION', requestId })
    }
    try {
      const lead = await findLatestLead(supabase, { email, phone: '' })
      const user = await findAuthUserByEmail(supabase, email)
      const verified = Boolean(lead?.id) || Boolean(user?.email_confirmed_at || user?.confirmed_at)
      if (!verified) return res.json({ ok: true, verified: false, needsPassword: false, plan: null, requestId })
      if (!user) return res.json({ ok: true, verified: true, needsPassword: true, plan: 'demo', requestId })
      const controls = await loadUserControls(supabase, user.id)
      const { count } = await supabase
        .from('quotations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      const legacy = String(user.created_at || '') < NEW_ACCOUNT_CUTOFF || (count || 0) > 0
      const plan = controls.billingPlan || (legacy ? 'legacy' : 'demo')
      return res.json({
        ok: true,
        verified: true,
        needsPassword: !legacy && !controls.passwordSetAt,
        plan: legacy && !controls.billingPlan ? 'legacy' : plan,
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] trial account lookup failed`, error?.message)
      supabaseError(error, res, requestId)
    }
  })

  app.post('/api/meta-ads-trial/set-password', async (req, res) => {
    const requestId = `mal-pass-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.', code: 'VALIDATION', requestId })
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Use at least 8 characters.', code: 'VALIDATION', requestId })
    }
    try {
      const lead = await findLatestLead(supabase, { email, phone: '' })
      let user = await findAuthUserByEmail(supabase, email)
      const verified = Boolean(lead?.id) || Boolean(user?.email_confirmed_at || user?.confirmed_at)
      if (!verified) {
        return res.status(403).json({ error: 'Verify your email on the enquiry form first.', code: 'NOT_VERIFIED', requestId })
      }
      const legacy = user && String(user.created_at || '') < NEW_ACCOUNT_CUTOFF
      if (legacy) {
        return res.json({ ok: true, plan: 'legacy', needsLogin: true, requestId })
      }
      const phoneDigits = normalizeIndiaMobileDigits(req.body?.phone)
      const company = String(req.body?.company || '').trim()
      user = await ensureConfirmedMetaTrialUser(supabase, email, {
        source: 'meta_ads_landing',
        full_name: lead?.name || req.body?.name || '',
        company: company || lead?.company || '',
        phone_digits: isValidIndiaMobile(phoneDigits) ? phoneDigits : ''
      })
      const { error } = await supabase.auth.admin.updateUserById(user.id, { password, email_confirm: true })
      if (error) throw error
      if (isValidIndiaMobile(phoneDigits)) {
        await upsertUserProfile(supabase, { userId: user.id, email, phoneRaw: phoneDigits }).catch((profileError) => {
          console.error(`[${requestId}] profile phone save failed`, profileError?.message)
        })
      }
      const plan = await assignPlanOnPassword(supabase, { ...user, email })
      return res.json({ ok: true, plan, requestId })
    } catch (error) {
      console.error(`[${requestId}] set password failed`, error?.message)
      supabaseError(error, res, requestId)
    }
  })

  app.post('/api/meta-ads-leads/demo-quote', async (req, res) => {
    const requestId = `mal-demo-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const email = String(req.body?.email || '').trim().toLowerCase()
    const action = String(req.body?.action || 'read').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required to count demo quotations.', code: 'VALIDATION', requestId })
    }
    const cap = 10
    try {
      const { data, error } = await supabase
        .from('demo_quote_counts')
        .select('used')
        .eq('email', email)
        .maybeSingle()
      if (error) throw error
      let used = Number(data?.used) || 0
      const localUsed = Math.min(cap, Math.max(0, Number(req.body?.localUsed) || 0))
      if (localUsed > used) used = localUsed
      if (action === 'use' && used < cap) used += 1
      if (used !== (Number(data?.used) || 0)) {
        const { error: saveError } = await supabase
          .from('demo_quote_counts')
          .upsert({ email, used, updated_at: new Date().toISOString() }, { onConflict: 'email' })
        if (saveError) throw saveError
      }
      return res.json({ ok: true, used, cap, allowed: used < cap, persisted: true, requestId })
    } catch (error) {
      console.error(`[${requestId}] demo quote count failed`, error?.message)
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
      const outreachRows = await readSheetOutreach()
      const outreachByPhone = new Map()
      const outreachByEmail = new Map()
      for (const row of outreachRows) {
        if (row.phone) outreachByPhone.set(row.phone, row)
        if (row.email) outreachByEmail.set(row.email, row)
      }
      const leads = (data || []).map((row) => {
        const lead = serializeLead(row)
        const account = accounts.get(String(lead.email || '').trim().toLowerCase()) || null
        const phone = normalizeIndiaMobileDigits(lead.phone)
        const outreach = outreachByPhone.get(phone) || outreachByEmail.get(String(lead.email || '').trim().toLowerCase()) || null
        return {
          ...lead,
          quotationCount: account ? account.quotationCount : null,
          accountStatus: account?.accountStatus || '',
          joinedAt: account?.joinedAt || null,
          videoSeen: outreach?.videoSeen || '',
          remindersSent: outreach?.remindersSent ?? null,
          lastReply: outreach?.lastReply || '',
          demoCode: outreach?.demoCode || 0
        }
      })
      const hiddenEmails = new Set([...superAdminEmails(), 'infodigiteq@gmail.com'])
      const visibleLeads = leads.filter((lead) => {
        const email = String(lead.email || '').trim().toLowerCase()
        return !isHiddenMetaLead(lead) && !hiddenEmails.has(email)
      })
      const counts = { lead: 0, demo: 0, purchased: 0, inactive: 0 }
      for (const lead of visibleLeads) {
        if (lead.deactivated) {
          counts.inactive += 1
          continue
        }
        if (lead.status === 'purchased') counts.purchased += 1
        else if (lead.status === 'demo') counts.demo += 1
        else counts.lead += 1
      }

      res.json({ total: visibleLeads.length, counts, leads: visibleLeads, requestId })
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

  app.post('/api/meta-ads-leads/:id/payment-request', async (req, res) => {
    const requestId = `mal-pay-${Date.now()}`
    if (!canManageMetaAdsLeads(req.userEmail)) {
      return res.status(403).json({ error: 'Meta ads leads access only.', code: 'FORBIDDEN', requestId })
    }
    const supabase = requireDb(res, requestId)
    if (!supabase) return

    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ error: 'Lead id is required.', code: 'VALIDATION', requestId })

    const built = buildPaymentRequest(req.body || {})
    if (built.error) return res.status(400).json({ error: built.error, code: 'VALIDATION', requestId })

    try {
      const { data: lead, error: leadError } = await supabase
        .from('meta_ads_leads')
        .select('id, email, name, phone, company')
        .eq('id', id)
        .maybeSingle()
      if (leadError) throw leadError
      const email = String(lead?.email || '').trim().toLowerCase()
      if (!lead || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'This lead needs an email before a payment can be sent.', code: 'VALIDATION', requestId })
      }

      const { error: cancelError } = await supabase
        .from('payment_requests')
        .update({ status: 'cancelled' })
        .eq('email', email)
        .eq('status', 'pending')
      if (cancelError) throw cancelError

      const { data, error } = await supabase
        .from('payment_requests')
        .insert({
          email,
          lead_id: lead.id,
          amount: built.amount,
          label: built.label,
          quotes_per_month: built.quotesPerMonth,
          period: built.period,
          valid_till: built.validTill,
          status: 'pending'
        })
        .select('id, amount, label, quotes_per_month, period, valid_till')
        .single()
      if (error) throw error
      const demoCode = await findDemoCodeForLead({ email, phone: lead.phone })
      const payPath = demoCode ? `/quotation/demo${demoCode}/paymentpage${built.amount}` : ''
      return res.status(201).json({
        ok: true,
        payPath,
        request: {
          id: data.id,
          amount: data.amount,
          label: data.label,
          quotesPerMonth: data.quotes_per_month,
          period: data.period,
          validTill: data.valid_till,
          email,
          name: lead.name || '',
          phone: lead.phone || '',
          company: lead.company || ''
        },
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] payment request failed`, error?.code, error?.message)
      if (/payment_requests|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return res.status(503).json({ error: 'Payment requests are not ready yet.', code: 'MIGRATION_REQUIRED', requestId })
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
