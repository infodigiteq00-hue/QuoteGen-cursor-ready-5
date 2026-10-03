import {
  normalizeAccountStatus,
  periodLabel,
  periodWindowStart
} from '../shared/accountControls.js'

/** Load admin controls row (may be missing until first phone/controls save). */
export async function loadUserControls(supabase, userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, account_status, quote_limit_count, quote_limit_period, admin_note, status_updated_at, billing_plan, quote_credits, subscribed_at, password_set_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error && !/user_profiles|schema cache|PGRST|42703|account_status/i.test(error.message || '')) {
    throw error
  }
  if (error || !data) {
    return {
      userId,
      accountStatus: 'active',
      quoteLimitCount: null,
      quoteLimitPeriod: null,
      adminNote: '',
      statusUpdatedAt: null,
      billingPlan: null,
      quoteCredits: null,
      subscribedAt: null,
      passwordSetAt: null,
      missingProfile: true
    }
  }
  return {
    userId: data.user_id,
    email: data.email || '',
    accountStatus: normalizeAccountStatus(data.account_status),
    quoteLimitCount: data.quote_limit_count == null ? null : Number(data.quote_limit_count),
    quoteLimitPeriod: data.quote_limit_period || null,
    adminNote: data.admin_note || '',
    statusUpdatedAt: data.status_updated_at || null,
    billingPlan: data.billing_plan || null,
    quoteCredits: data.quote_credits == null ? null : Number(data.quote_credits),
    subscribedAt: data.subscribed_at || null,
    passwordSetAt: data.password_set_at || null,
    missingProfile: false
  }
}

export async function countQuotesInPeriod(supabase, userId, period) {
  const start = periodWindowStart(period)
  if (!start) return 0
  const { count, error } = await supabase
    .from('quotations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', start.toISOString())
  if (error) throw error
  return count || 0
}

/**
 * Block new quotation creates when paused/removed or over quota.
 * Returns null if OK, or { status, body } for the HTTP response.
 */
export async function assertCanCreateQuotation(supabase, { userId, userEmail }) {
  const controls = await loadUserControls(supabase, userId)
  const status = controls.accountStatus

  if (status === 'removed') {
    return {
      status: 403,
      body: {
        error: 'This account has been disabled by the administrator.',
        code: 'ACCOUNT_REMOVED'
      }
    }
  }
  if (status === 'paused') {
    return {
      status: 403,
      body: {
        error: 'This account is paused. You cannot create new quotations right now.',
        code: 'ACCOUNT_PAUSED'
      }
    }
  }

  if (
    controls.quoteLimitPeriod
    && controls.quoteLimitCount != null
    && Number.isFinite(controls.quoteLimitCount)
  ) {
    const used = await countQuotesInPeriod(supabase, userId, controls.quoteLimitPeriod)
    if (used >= controls.quoteLimitCount) {
      return {
        status: 403,
        body: {
          error: `Quote limit reached (${controls.quoteLimitCount} per ${controls.quoteLimitPeriod}). Used ${used} ${periodLabel(controls.quoteLimitPeriod)}.`,
          code: 'QUOTE_LIMIT_REACHED',
          limit: controls.quoteLimitCount,
          period: controls.quoteLimitPeriod,
          used
        }
      }
    }
  }

  // Null billing plan is an existing account: unlimited until a plan is set.
  if (controls.billingPlan === 'demo') {
    return {
      status: 403,
      body: {
        error: 'Subscribe to open the full QuoteGen workspace.',
        code: 'DEMO_PLAN'
      }
    }
  }
  if (controls.billingPlan === 'paid' && controls.quoteCredits != null) {
    const used = await countQuotesSince(supabase, userId, controls.subscribedAt)
    if (used >= controls.quoteCredits) {
      return {
        status: 403,
        body: {
          error: `You have used ${used} of ${controls.quoteCredits} quotations. Top up to continue.`,
          code: 'QUOTE_CREDITS',
          limit: controls.quoteCredits,
          used
        }
      }
    }
  }

  void userEmail
  return null
}

async function countQuotesSince(supabase, userId, since) {
  let query = supabase
    .from('quotations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (since) query = query.gte('created_at', since)
  const { count, error } = await query
  if (error) throw error
  return count || 0
}

const PAID_QUOTATION_CREDITS = 50

export async function applyPaymentCredits(supabase, { userId, email, label }) {
  if (!userId) return
  const text = String(label || '')
  const topup = text.match(/\+(\d+)\s+Quotations/i)
  const controls = await loadUserControls(supabase, userId)
  const now = new Date().toISOString()
  if (topup) {
    if (controls.billingPlan !== 'paid') return
    const add = Number(topup[1]) || 0
    const next = (Number(controls.quoteCredits) || 0) + add
    await supabase.from('user_profiles').upsert({
      user_id: userId,
      email: String(email || controls.email || '').trim().toLowerCase(),
      billing_plan: 'paid',
      quote_credits: next,
      updated_at: now
    }, { onConflict: 'user_id' })
    return
  }
  if (!/monthly/i.test(text)) return
  if (!controls.billingPlan) return
  await supabase.from('user_profiles').upsert({
    user_id: userId,
    email: String(email || controls.email || '').trim().toLowerCase(),
    billing_plan: 'paid',
    quote_credits: Math.max(Number(controls.quoteCredits) || 0, PAID_QUOTATION_CREDITS),
    subscribed_at: controls.subscribedAt || now,
    updated_at: now
  }, { onConflict: 'user_id' })
}

export const NEW_ACCOUNT_CUTOFF = '2026-10-03T00:00:00.000Z'

export async function assignPlanOnPassword(supabase, user) {
  const createdAt = user?.created_at || new Date().toISOString()
  const { count, error } = await supabase
    .from('quotations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (error) throw error
  const existingCustomer = createdAt < NEW_ACCOUNT_CUTOFF || (count || 0) > 0
  const now = new Date().toISOString()
  const row = {
    user_id: user.id,
    email: String(user.email || '').trim().toLowerCase(),
    password_set_at: now,
    updated_at: now
  }
  if (!existingCustomer) {
    row.billing_plan = 'demo'
    row.quote_credits = 10
  }
  const saved = await supabase.from('user_profiles').upsert(row, { onConflict: 'user_id' })
  if (saved.error && !/billing_plan|quote_credits|password_set_at|schema cache|42703/i.test(saved.error.message || '')) {
    throw saved.error
  }
  return existingCustomer ? 'legacy' : 'demo'
}

export async function ensureProfileRow(supabase, { userId, email }) {
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (existing?.user_id) return
  await supabase.from('user_profiles').upsert({
    user_id: userId,
    email: String(email || '').trim().toLowerCase(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' })
}
