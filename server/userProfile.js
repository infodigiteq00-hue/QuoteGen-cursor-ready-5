import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { isValidIndiaMobile, normalizeIndiaMobileDigits, toIndiaE164 } from '../shared/phone.js'

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
    error: 'User profiles are not set up yet. Run the user_profiles migration in Supabase.',
    code: 'MIGRATION_REQUIRED',
    requestId
  })
}

export async function upsertUserProfile(supabase, { userId, email, phoneRaw }) {
  const digits = normalizeIndiaMobileDigits(phoneRaw)
  if (!isValidIndiaMobile(digits)) {
    const err = new Error('Enter a valid 10-digit Indian mobile number.')
    err.code = 'INVALID_PHONE'
    err.status = 400
    throw err
  }
  const phoneE164 = toIndiaE164(digits)
  const row = {
    user_id: userId,
    email: String(email || '').trim().toLowerCase(),
    phone_digits: digits,
    phone_e164: phoneE164,
    updated_at: new Date().toISOString()
  }
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select('user_id, email, phone_digits, phone_e164, created_at, updated_at')
    .single()
  if (error) throw error
  return data
}

export function registerUserProfileRoutes(app) {
  app.get('/api/me/profile', async (req, res) => {
    const requestId = `profile-get-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('user_id, email, phone_digits, phone_e164, created_at, updated_at')
        .eq('user_id', req.userId)
        .maybeSingle()
      if (error) throw error
      res.json({
        profile: data
          ? {
              userId: data.user_id,
              email: data.email,
              phoneDigits: data.phone_digits,
              phoneE164: data.phone_e164,
              createdAt: data.created_at,
              updatedAt: data.updated_at
            }
          : null,
        requestId
      })
    } catch (error) {
      if (/user_profiles|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })

  app.post('/api/me/profile', async (req, res) => {
    const requestId = `profile-post-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const data = await upsertUserProfile(supabase, {
        userId: req.userId,
        email: req.userEmail,
        phoneRaw: req.body?.phone || req.body?.phoneDigits || ''
      })
      res.json({
        ok: true,
        profile: {
          userId: data.user_id,
          email: data.email,
          phoneDigits: data.phone_digits,
          phoneE164: data.phone_e164,
          createdAt: data.created_at,
          updatedAt: data.updated_at
        },
        requestId
      })
    } catch (error) {
      if (error?.code === 'INVALID_PHONE') {
        return res.status(400).json({ error: error.message, code: error.code, requestId })
      }
      if (error?.code === '23505') {
        return res.status(409).json({
          error: 'That mobile number is already registered on another account.',
          code: 'PHONE_TAKEN',
          requestId
        })
      }
      if (/user_profiles|schema cache|PGRST|42703/i.test(error?.message || '')) {
        return migrationRequired(res, requestId)
      }
      supabaseError(error, res, requestId)
    }
  })
}
