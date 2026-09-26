import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { isSuperAdmin } from './superAdmin.js'
import { formatIndiaMobileDisplay } from '../shared/phone.js'
import {
  normalizeAccountStatus,
  normalizeQuoteLimit,
  periodLabel
} from '../shared/accountControls.js'
import {
  countQuotesInPeriod,
  ensureProfileRow
} from './accountAccess.js'

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

function requireSuperAdmin(req, res, requestId) {
  if (!isSuperAdmin(req.userEmail)) {
    res.status(403).json({ error: 'Super admin only.', code: 'FORBIDDEN', requestId })
    return false
  }
  return true
}

async function listAllAuthUsers(supabase) {
  const users = []
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const batch = data?.users || []
    users.push(...batch)
    if (batch.length < perPage) break
    page += 1
    if (page > 50) break
  }
  return users
}

async function quotationCountsByUser(supabase) {
  const counts = new Map()
  let from = 0
  const pageSize = 1000
  for (;;) {
    const { data, error } = await supabase
      .from('quotations')
      .select('user_id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data || []
    for (const row of batch) {
      if (!row?.user_id) continue
      counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1)
    }
    if (batch.length < pageSize) break
    from += pageSize
    if (from > 200000) break
  }
  return counts
}

function phoneFromMeta(user) {
  const meta = user?.user_metadata || {}
  return meta.phone_e164 || meta.phone || meta.phone_digits || ''
}

function emptyBuckets(range) {
  return { day: [], week: [], month: [], range }
}

function bucketQuotes(createdAts, { daysBack = 30, weeksBack = 12, monthsBack = 12 } = {}) {
  const now = new Date()
  const dayMap = new Map()
  const weekMap = new Map()
  const monthMap = new Map()

  for (let i = daysBack - 1; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    dayMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (let i = weeksBack - 1; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - d.getDay() - (i * 7))
    weekMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthMap.set(key, 0)
  }

  for (const raw of createdAts) {
    const dt = new Date(raw)
    if (!Number.isFinite(dt.getTime())) continue
    const dayKey = dt.toISOString().slice(0, 10)
    if (dayMap.has(dayKey)) dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + 1)

    const weekStart = new Date(dt)
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    const weekKey = weekStart.toISOString().slice(0, 10)
    if (weekMap.has(weekKey)) weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + 1)

    const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
    if (monthMap.has(monthKey)) monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1)
  }

  const toSeries = (map) => [...map.entries()].map(([label, count]) => ({ label, count }))
  return {
    day: toSeries(dayMap),
    week: toSeries(weekMap),
    month: toSeries(monthMap),
    range: { daysBack, weeksBack, monthsBack }
  }
}

export function registerAdminUserRoutes(app) {
  app.get('/api/admin/users', async (req, res) => {
    const requestId = `admin-users-${Date.now()}`
    if (!requireSuperAdmin(req, res, requestId)) return
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const [authUsers, profilesRes, quoteCounts] = await Promise.all([
        listAllAuthUsers(supabase),
        supabase
          .from('user_profiles')
          .select('user_id, email, phone_digits, phone_e164, account_status, quote_limit_count, quote_limit_period, admin_note, status_updated_at'),
        quotationCountsByUser(supabase)
      ])

      const profilesByUser = new Map()
      for (const row of profilesRes.data || []) profilesByUser.set(row.user_id, row)
      if (profilesRes.error && !/user_profiles|schema cache|PGRST|42703|account_status/i.test(profilesRes.error.message || '')) {
        throw profilesRes.error
      }

      const usersBase = authUsers
        .map((u) => {
          const profile = profilesByUser.get(u.id)
          const phoneRaw = profile?.phone_e164 || profile?.phone_digits || phoneFromMeta(u)
          const limit = normalizeQuoteLimit(profile?.quote_limit_count, profile?.quote_limit_period)
          return {
            id: u.id,
            email: u.email || profile?.email || '',
            phone: phoneRaw ? formatIndiaMobileDisplay(phoneRaw) : '',
            phoneE164: profile?.phone_e164 || (phoneRaw ? String(phoneRaw) : ''),
            createdAt: u.created_at || null,
            lastSignInAt: u.last_sign_in_at || null,
            emailConfirmedAt: u.email_confirmed_at || null,
            quotationCount: quoteCounts.get(u.id) || 0,
            accountStatus: normalizeAccountStatus(profile?.account_status),
            quoteLimitCount: limit.quoteLimitCount,
            quoteLimitPeriod: limit.quoteLimitPeriod,
            currentPeriodUsed: null,
            adminNote: profile?.admin_note || '',
            statusUpdatedAt: profile?.status_updated_at || null,
            isSuperAdmin: isSuperAdmin(u.email || profile?.email || ''),
            // Passwords are hashed in Auth and cannot be retrieved.
            passwordAvailable: false
          }
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

      // Period usage only for accounts that have a quota set.
      const limited = usersBase.filter((u) => u.quoteLimitCount != null && u.quoteLimitPeriod)
      const periodUsedPairs = await Promise.all(limited.map(async (u) => {
        try {
          const used = await countQuotesInPeriod(supabase, u.id, u.quoteLimitPeriod)
          return [u.id, used]
        } catch {
          return [u.id, null]
        }
      }))
      const periodUsedById = new Map(periodUsedPairs)
      const users = usersBase.map((u) => ({
        ...u,
        currentPeriodUsed: periodUsedById.has(u.id) ? periodUsedById.get(u.id) : null
      }))

      const activeCount = users.filter((u) => u.accountStatus === 'active').length
      const nearingLimits = users.filter((u) => {
        if (u.accountStatus !== 'active') return false
        if (u.quoteLimitCount == null || u.quoteLimitCount <= 0 || !u.quoteLimitPeriod) return false
        if (u.currentPeriodUsed == null) return false
        return (u.currentPeriodUsed / u.quoteLimitCount) >= 0.8
      }).map((u) => ({
        id: u.id,
        email: u.email,
        used: u.currentPeriodUsed,
        limit: u.quoteLimitCount,
        period: u.quoteLimitPeriod,
        pct: Math.min(100, Math.round((u.currentPeriodUsed / u.quoteLimitCount) * 100))
      }))

      res.json({
        total: users.length,
        activeCount,
        nearingLimitsCount: nearingLimits.length,
        nearingLimits,
        users,
        note: 'Passwords cannot be shown — Supabase Auth stores only secure hashes.',
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] admin users failed`, error?.code, error?.message)
      supabaseError(error, res, requestId)
    }
  })

  app.get('/api/admin/users/:userId/usage', async (req, res) => {
    const requestId = `admin-usage-${Date.now()}`
    if (!requireSuperAdmin(req, res, requestId)) return
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const userId = String(req.params.userId || '').trim()
    if (!userId) {
      return res.status(400).json({ error: 'userId required', code: 'BAD_REQUEST', requestId })
    }
    try {
      const [{ data: authData, error: authError }, profileRes, quotesRes] = await Promise.all([
        supabase.auth.admin.getUserById(userId),
        supabase
          .from('user_profiles')
          .select('email, phone_digits, phone_e164, account_status, quote_limit_count, quote_limit_period, admin_note, status_updated_at')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('quotations')
          .select('id, created_at, number, title, doc_type')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(2000)
      ])
      if (authError) throw authError
      if (quotesRes.error) throw quotesRes.error

      const user = authData?.user
      if (!user) {
        return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND', requestId })
      }

      const profile = profileRes.error && /user_profiles|schema cache|PGRST|42703|account_status/i.test(profileRes.error.message || '')
        ? null
        : profileRes.data
      if (profileRes.error && profile !== null && !profileRes.data) {
        if (!/user_profiles|schema cache|PGRST|42703|account_status/i.test(profileRes.error.message || '')) throw profileRes.error
      }

      const quotes = quotesRes.data || []
      const phoneRaw = profile?.phone_e164 || profile?.phone_digits || phoneFromMeta(user)
      const series = quotes.length ? bucketQuotes(quotes.map(q => q.created_at)) : emptyBuckets({ daysBack: 30, weeksBack: 12, monthsBack: 12 })

      const last30 = series.day.reduce((sum, b) => sum + b.count, 0)
      const last12w = series.week.reduce((sum, b) => sum + b.count, 0)
      const last12m = series.month.reduce((sum, b) => sum + b.count, 0)

      const limit = normalizeQuoteLimit(profile?.quote_limit_count, profile?.quote_limit_period)
      let periodUsed = null
      if (limit.quoteLimitPeriod && limit.quoteLimitCount != null) {
        try {
          periodUsed = await countQuotesInPeriod(supabase, userId, limit.quoteLimitPeriod)
        } catch {
          periodUsed = null
        }
      }

      res.json({
        user: {
          id: user.id,
          email: user.email || profile?.email || '',
          phone: phoneRaw ? formatIndiaMobileDisplay(phoneRaw) : '',
          phoneE164: profile?.phone_e164 || '',
          createdAt: user.created_at || null,
          lastSignInAt: user.last_sign_in_at || null,
          emailConfirmedAt: user.email_confirmed_at || null,
          accountStatus: normalizeAccountStatus(profile?.account_status),
          quoteLimitCount: limit.quoteLimitCount,
          quoteLimitPeriod: limit.quoteLimitPeriod,
          adminNote: profile?.admin_note || '',
          statusUpdatedAt: profile?.status_updated_at || null,
          isSuperAdmin: isSuperAdmin(user.email || profile?.email || ''),
          passwordAvailable: false
        },
        totals: {
          allTime: quotes.length,
          last30Days: last30,
          last12Weeks: last12w,
          last12Months: last12m,
          currentPeriodUsed: periodUsed,
          currentPeriodLabel: limit.quoteLimitPeriod ? periodLabel(limit.quoteLimitPeriod) : null
        },
        series,
        recent: quotes.slice(0, 20).map(q => ({
          id: q.id,
          number: q.number || '',
          title: q.title || '',
          docType: q.doc_type || 'quotation',
          createdAt: q.created_at
        })),
        note: 'Passwords cannot be shown — Supabase Auth stores only secure hashes.',
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] admin usage failed`, error?.code, error?.message)
      supabaseError(error, res, requestId)
    }
  })

  /** Pause / resume / set quote limit for a user. */
  app.patch('/api/admin/users/:userId/controls', async (req, res) => {
    const requestId = `admin-controls-${Date.now()}`
    if (!requireSuperAdmin(req, res, requestId)) return
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const userId = String(req.params.userId || '').trim()
    if (!userId) {
      return res.status(400).json({ error: 'userId required', code: 'BAD_REQUEST', requestId })
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId)
      if (authError) throw authError
      const user = authData?.user
      if (!user) {
        return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND', requestId })
      }
      if (isSuperAdmin(user.email)) {
        return res.status(400).json({
          error: 'Cannot change controls on the super-admin account.',
          code: 'FORBIDDEN_TARGET',
          requestId
        })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const patch = {
        user_id: userId,
        email: String(user.email || '').trim().toLowerCase(),
        updated_at: new Date().toISOString()
      }
      let nextStatus = null

      if (body.accountStatus != null) {
        const status = normalizeAccountStatus(body.accountStatus)
        if (!['active', 'paused', 'removed'].includes(status)) {
          return res.status(400).json({ error: 'Invalid accountStatus', code: 'BAD_REQUEST', requestId })
        }
        // Resume from "removed" via active is allowed (soft restore).
        patch.account_status = status
        patch.status_updated_at = new Date().toISOString()
        nextStatus = status
      }

      if (body.clearQuoteLimit === true || body.quoteLimitCount === null || body.quoteLimitPeriod === null) {
        patch.quote_limit_count = null
        patch.quote_limit_period = null
      } else if (body.quoteLimitCount != null || body.quoteLimitPeriod != null) {
        let limit
        try {
          limit = normalizeQuoteLimit(body.quoteLimitCount, body.quoteLimitPeriod)
        } catch (err) {
          return res.status(err.status || 400).json({
            error: err.message || 'Invalid quote limit',
            code: err.code || 'BAD_REQUEST',
            requestId
          })
        }
        if (limit.quoteLimitCount == null || !limit.quoteLimitPeriod) {
          return res.status(400).json({
            error: 'Provide both quoteLimitCount and quoteLimitPeriod (day|month|year), or clear the limit.',
            code: 'BAD_REQUEST',
            requestId
          })
        }
        patch.quote_limit_count = limit.quoteLimitCount
        patch.quote_limit_period = limit.quoteLimitPeriod
      }

      if (body.adminNote != null) {
        patch.admin_note = String(body.adminNote).slice(0, 500)
      }

      await ensureProfileRow(supabase, { userId, email: user.email })
      const { data, error } = await supabase
        .from('user_profiles')
        .upsert(patch, { onConflict: 'user_id' })
        .select('user_id, account_status, quote_limit_count, quote_limit_period, admin_note, status_updated_at')
        .single()
      if (error) throw error

      // Pause/remove bans Auth; resume clears the ban.
      if (nextStatus === 'paused' || nextStatus === 'removed') {
        const { error: banError } = await supabase.auth.admin.updateUserById(userId, {
          ban_duration: '876000h'
        })
        if (banError) throw banError
      } else if (nextStatus === 'active') {
        const { error: unbanError } = await supabase.auth.admin.updateUserById(userId, {
          ban_duration: 'none'
        })
        if (unbanError) throw unbanError
      }

      let periodUsed = null
      if (data.quote_limit_period && data.quote_limit_count != null) {
        periodUsed = await countQuotesInPeriod(supabase, userId, data.quote_limit_period)
      }

      res.json({
        ok: true,
        user: {
          id: data.user_id,
          accountStatus: normalizeAccountStatus(data.account_status),
          quoteLimitCount: data.quote_limit_count == null ? null : Number(data.quote_limit_count),
          quoteLimitPeriod: data.quote_limit_period || null,
          adminNote: data.admin_note || '',
          statusUpdatedAt: data.status_updated_at || null,
          currentPeriodUsed: periodUsed
        },
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] admin controls failed`, error?.code, error?.message)
      supabaseError(error, res, requestId)
    }
  })

  /** Soft-remove: mark removed + ban Auth sign-in. Hard delete Auth user is optional via ?hard=1 */
  app.delete('/api/admin/users/:userId', async (req, res) => {
    const requestId = `admin-remove-${Date.now()}`
    if (!requireSuperAdmin(req, res, requestId)) return
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const userId = String(req.params.userId || '').trim()
    const hard = String(req.query.hard || '') === '1'
    if (!userId) {
      return res.status(400).json({ error: 'userId required', code: 'BAD_REQUEST', requestId })
    }

    try {
      const { data: authData, error: authError } = await supabase.auth.admin.getUserById(userId)
      if (authError) throw authError
      const user = authData?.user
      if (!user) {
        return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND', requestId })
      }
      if (isSuperAdmin(user.email)) {
        return res.status(400).json({
          error: 'Cannot remove the super-admin account.',
          code: 'FORBIDDEN_TARGET',
          requestId
        })
      }

      await ensureProfileRow(supabase, { userId, email: user.email })
      const { error: profileError } = await supabase.from('user_profiles').upsert({
        user_id: userId,
        email: String(user.email || '').trim().toLowerCase(),
        account_status: 'removed',
        status_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        admin_note: hard ? 'Hard-deleted from Auth' : 'Removed by super-admin'
      }, { onConflict: 'user_id' })
      if (profileError && !/user_profiles|schema cache|PGRST|42703|account_status/i.test(profileError.message || '')) {
        throw profileError
      }

      // Ban sign-in so they cannot create quotes even if profile columns are missing.
      const { error: banError } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: '876000h' // ~100 years
      })
      if (banError) throw banError

      if (hard) {
        const { error: delError } = await supabase.auth.admin.deleteUser(userId)
        if (delError) throw delError
      }

      res.json({
        ok: true,
        removed: true,
        hard,
        userId,
        requestId
      })
    } catch (error) {
      console.error(`[${requestId}] admin remove failed`, error?.code, error?.message)
      supabaseError(error, res, requestId)
    }
  })
}
