import {
  normalizeAccountStatus,
  periodLabel,
  periodWindowStart
} from '../shared/accountControls.js'

/** Load admin controls row (may be missing until first phone/controls save). */
export async function loadUserControls(supabase, userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, account_status, quote_limit_count, quote_limit_period, admin_note, status_updated_at')
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

  // Never block the super-admin by accident if somehow marked paused.
  void userEmail
  return null
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
