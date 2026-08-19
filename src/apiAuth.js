/**
 * Auth actions plus the bearer-token plumbing between the browser and Express.
 *
 * Sessions live in supabase-js now, which persists them in localStorage and
 * refreshes them on its own. What is kept from the original hand-rolled version
 * is the idea of patching window.fetch exactly once, so the ~25 existing
 * `fetch('/api/...')` call sites across the app don't each need to know about
 * auth — they keep working untouched and simply travel with a token.
 */
import { supabase, supabaseConfigured } from './supabaseClient.js'

// The pre-supabase-js build stored a hand-rolled session under this key. Drop it
// on startup so an old value can't linger in localStorage forever.
const LEGACY_STORAGE_KEY = 'quotegen_session'

/**
 * Cached copy of the live session.
 *
 * supabase-js guards its auth methods with an internal lock, and it emits
 * onAuthStateChange while still holding it. So the fetch interceptor must never
 * call supabase.auth.getSession() itself: a data request triggered by the
 * SIGNED_IN re-render would block on the lock that signInWithPassword is still
 * holding, and sign-in would hang forever. Reading a plain variable that
 * supabase-js pushes updates into avoids touching the lock at all.
 */
let currentSession = null
let sessionReady = null

function watchSession() {
  if (sessionReady || !supabase) return sessionReady
  sessionReady = supabase.auth.getSession().then(({ data }) => {
    currentSession = data.session || null
    return currentSession
  }).catch(() => null)
  supabase.auth.onAuthStateChange((_event, session) => { currentSession = session || null })
  return sessionReady
}

export async function getCurrentSession() {
  if (!supabase) return null
  await watchSession()
  return currentSession
}

/** Subscribe to sign-in / sign-out / token-refresh. Returns an unsubscribe fn. */
export function onAuthChange(callback) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    currentSession = session || null
    callback(session, event)
  })
  return () => data.subscription.unsubscribe()
}

let refreshInFlight = null

function refreshOnce() {
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth.refreshSession().finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

/** Call once at app startup, before any component renders. */
export function installAuthFetch() {
  try { localStorage.removeItem(LEGACY_STORAGE_KEY) } catch { /* private mode */ }
  watchSession()

  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url
    if (!url || !url.startsWith('/api/')) return nativeFetch(input, init)

    const withToken = (token) => {
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined))
      if (token) headers.set('Authorization', `Bearer ${token}`)
      return { ...init, headers }
    }

    const session = await getCurrentSession()
    let response = await nativeFetch(input, withToken(session?.access_token))
    if (response.status === 401 && session?.refresh_token) {
      const { data } = await refreshOnce()
      if (data?.session?.access_token) {
        response = await nativeFetch(input, withToken(data.session.access_token))
      }
    }
    return response
  }
}

/**
 * Supabase's own wording is usually the most useful thing to show, so it is
 * passed through by default (rate limits, weak-password rules, and so on).
 * Only the few messages that are cryptic or actionable get rewritten.
 */
function authErrorMessage(error) {
  const code = error?.code || ''
  const message = error?.message || 'Something went wrong. Please try again.'
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'Your email is not confirmed yet — open the confirmation link we emailed you, or resend it from the login screen.'
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'Incorrect email or password. If you just signed up, confirm your email first. If this account already exists, reset your password.'
  }
  if (code === 'email_address_not_authorized' || (/not authorized/i.test(message) && /email/i.test(message))) {
    return 'Supabase’s default email service can only send to project team members. Use a team email, or ask an admin to confirm your account in the dashboard.'
  }
  if (code === 'over_email_send_rate_limit' || (/rate limit/i.test(message) && /email/i.test(message))) {
    return 'Too many emails were just sent to this address. Wait a minute, then try again.'
  }
  if (/invalid api key|no api key/i.test(message)) {
    return 'The Supabase anon key is missing or wrong. Set VITE_SUPABASE_ANON_KEY in .env and restart the dev server.'
  }
  if (/failed to fetch|network/i.test(message)) {
    return 'Could not reach Supabase. Check VITE_SUPABASE_URL and your connection.'
  }
  return message
}

/**
 * Duplicate confirmed accounts come back as a fake user with no identities.
 * A brand-new signup can also omit identities, so only treat it as “already
 * registered” when the account is older than a couple of minutes.
 */
function isExistingConfirmedUser(user) {
  if (!user || !Array.isArray(user.identities) || user.identities.length > 0) return false
  const createdAt = Date.parse(user.created_at || '')
  if (!Number.isFinite(createdAt)) return true
  return Date.now() - createdAt > 2 * 60 * 1000
}

function assertConfigured() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart the dev server.')
  }
}

/**
 * Where Supabase should send the user after they click the confirmation link.
 * Using the running origin means the link comes back to whatever port this app
 * is served on, instead of the dashboard's default Site URL.
 */
function emailRedirectTo() {
  return `${window.location.origin}/`
}

export async function signIn(email, password) {
  assertConfigured()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(authErrorMessage(error))
  return data
}

export async function signUp(email, password) {
  assertConfigured()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: emailRedirectTo() }
  })
  if (error) throw new Error(authErrorMessage(error))
  const alreadyRegistered = isExistingConfirmedUser(data.user)
  return { session: data.session, alreadyRegistered, needsConfirmation: !data.session && !alreadyRegistered }
}

export async function resendConfirmation(email) {
  assertConfigured()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: emailRedirectTo() }
  })
  if (error) throw new Error(authErrorMessage(error))
}

/** Fallback for projects whose email template sends a 6-digit code instead of a link. */
export async function verifyEmailCode(email, token) {
  assertConfigured()
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })
  if (error) throw new Error(authErrorMessage(error))
  return data
}

export async function requestPasswordReset(email) {
  assertConfigured()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: emailRedirectTo()
  })
  if (error) throw new Error(authErrorMessage(error))
}

export async function updatePassword(password) {
  assertConfigured()
  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(authErrorMessage(error))
  return data
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
}
