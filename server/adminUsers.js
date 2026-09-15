import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { isSuperAdmin } from './superAdmin.js'
import { formatIndiaMobileDisplay } from '../shared/phone.js'

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
        supabase.from('user_profiles').select('user_id, email, phone_digits, phone_e164'),
        quotationCountsByUser(supabase)
      ])

      const profilesByUser = new Map()
      for (const row of profilesRes.data || []) profilesByUser.set(row.user_id, row)
      if (profilesRes.error && !/user_profiles|schema cache|PGRST|42703/i.test(profilesRes.error.message || '')) {
        throw profilesRes.error
      }

      const users = authUsers
        .map((u) => {
          const profile = profilesByUser.get(u.id)
          const phoneRaw = profile?.phone_e164 || profile?.phone_digits || phoneFromMeta(u)
          return {
            id: u.id,
            email: u.email || profile?.email || '',
            phone: phoneRaw ? formatIndiaMobileDisplay(phoneRaw) : '',
            phoneE164: profile?.phone_e164 || (phoneRaw ? String(phoneRaw) : ''),
            createdAt: u.created_at || null,
            lastSignInAt: u.last_sign_in_at || null,
            emailConfirmedAt: u.email_confirmed_at || null,
            quotationCount: quoteCounts.get(u.id) || 0,
            // Passwords are hashed in Auth and cannot be retrieved.
            passwordAvailable: false
          }
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

      res.json({
        total: users.length,
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
        supabase.from('user_profiles').select('email, phone_digits, phone_e164').eq('user_id', userId).maybeSingle(),
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

      const profile = profileRes.error && /user_profiles|schema cache|PGRST|42703/i.test(profileRes.error.message || '')
        ? null
        : profileRes.data
      if (profileRes.error && profile !== null && !profileRes.data) {
        // ignore missing table; otherwise rethrow
        if (!/user_profiles|schema cache|PGRST|42703/i.test(profileRes.error.message || '')) throw profileRes.error
      }

      const quotes = quotesRes.data || []
      const phoneRaw = profile?.phone_e164 || profile?.phone_digits || phoneFromMeta(user)
      const series = quotes.length ? bucketQuotes(quotes.map(q => q.created_at)) : emptyBuckets({ daysBack: 30, weeksBack: 12, monthsBack: 12 })

      const last30 = series.day.reduce((sum, b) => sum + b.count, 0)
      const last12w = series.week.reduce((sum, b) => sum + b.count, 0)
      const last12m = series.month.reduce((sum, b) => sum + b.count, 0)

      res.json({
        user: {
          id: user.id,
          email: user.email || profile?.email || '',
          phone: phoneRaw ? formatIndiaMobileDisplay(phoneRaw) : '',
          phoneE164: profile?.phone_e164 || '',
          createdAt: user.created_at || null,
          lastSignInAt: user.last_sign_in_at || null,
          emailConfirmedAt: user.email_confirmed_at || null,
          passwordAvailable: false
        },
        totals: {
          allTime: quotes.length,
          last30Days: last30,
          last12Weeks: last12w,
          last12Months: last12m
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
}
