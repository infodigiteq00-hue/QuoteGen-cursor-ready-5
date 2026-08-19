/**
 * Browser-side Supabase client — anon (publishable) key only.
 *
 * This client is used for Supabase Auth alone: sign in, sign up, session
 * persistence and refresh. Application data still goes through Express, which
 * holds the service role key. The service role key must never be imported or
 * referenced here, or it would end up in the client bundle.
 */
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || ''

export const supabaseConfigured = Boolean(url && anonKey)

/**
 * Supabase confirmation emails land the browser on `<site-url>/#access_token=…`
 * (or `#error_code=…` when the link has expired). supabase-js consumes that
 * hash and clears it while it establishes the session, so read it once here,
 * before createClient runs, to be able to tell the user what happened after the
 * URL is clean again.
 */
const hash = new URLSearchParams(
  typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '')
)

/** Set when the link was rejected, e.g. "Email link is invalid or has expired". */
export const emailLinkError = hash.get('error_description') || ''

export const supabase = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Turns the `#access_token=…` hash from the confirmation email into a
        // stored session, then strips it from the address bar.
        detectSessionInUrl: true
      }
    })
  : null
