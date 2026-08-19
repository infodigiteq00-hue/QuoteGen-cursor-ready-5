import { createClient } from '@supabase/supabase-js'

let cached = null

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
}

/** Service-role client for Express only. Never expose this key to the frontend. */
export function getSupabase() {
  if (!isSupabaseConfigured()) {
    const err = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
    err.code = 'SUPABASE_UNAVAILABLE'
    err.status = 503
    throw err
  }
  if (!cached) {
    cached = createClient(
      process.env.SUPABASE_URL.trim(),
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
      {
        auth: { persistSession: false, autoRefreshToken: false }
      }
    )
  }
  return cached
}

export function supabaseError(error, res, requestId) {
  const code = error?.code || 'SUPABASE_ERROR'
  const status = error?.status || (code === 'SUPABASE_UNAVAILABLE' ? 503 : 500)
  const message = error?.message || 'Database error'
  console.error(`[${requestId || 'db'}]`, { code, message, details: error?.details || error?.hint })
  return res.status(status).json({ error: message, code, requestId })
}
