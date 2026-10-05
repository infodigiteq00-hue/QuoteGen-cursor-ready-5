import React, { useEffect, useRef, useState } from 'react'
import {
  requestEmailOtp,
  requestPasswordReset,
  resendConfirmation,
  saveUserPhone,
  signIn,
  signUp,
  updatePassword,
  verifyEmailCode,
  verifyEmailLoginOtp
} from './apiAuth.js'
import { emailLinkError, supabaseConfigured } from './supabaseClient.js'
import BrandMark from './BrandMark.jsx'
import { trackPixel } from './metaPixel.js'
import { INDIA_COUNTRY_CODE, indiaMobileInputValue, isValidIndiaMobile, normalizeIndiaMobileDigits, toIndiaE164 } from '../shared/phone.js'
import { markMetaTrialUnpaid, readMetaAdsLead, writeMetaAdsLead } from './metaTrialLead.js'

function Field({ label, hint, ...props }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none transition-all duration-200 focus:border-moss focus:ring-4 focus:ring-blue-50"
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

function Alert({ tone, children }) {
  if (!children) return null
  const tones = {
    error: 'bg-rose-50 text-rose-700',
    success: 'bg-blue-50 text-moss',
    warn: 'bg-amber-50 text-amber-800'
  }
  return <p className={`auth-alert-in rounded-lg px-3 py-2 text-sm ${tones[tone] || tones.error}`}>{children}</p>
}

function Submit({ loading, idle, busy }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-xl bg-moss px-5 py-3 font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#1558b0] hover:shadow-lg hover:shadow-blue-200/60 active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          {busy}
        </span>
      ) : idle}
    </button>
  )
}

function LoginForm({ onSwitch, onNeedsConfirmation, onForgotPassword, onLoggedIn, prefillEmail, notice, emailLocked = false }) {
  const [email, setEmail] = useState(prefillEmail || '')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      // A successful sign-in fires onAuthStateChange, which swaps this screen
      // out for the app — nothing else to do here.
      await signIn(email.trim(), password)
      await onLoggedIn?.()
    } catch (err) {
      const next = err.message || 'Login failed'
      setError(next)
      if (/not confirmed/i.test(next)) onNeedsConfirmation(email.trim())
    } finally {
      setLoading(false)
    }
  }

  const resend = async () => {
    if (!email.trim()) {
      setError('Enter your email first, then resend the confirmation link.')
      return
    }
    setResending(true)
    setError('')
    setMessage('')
    try {
      await resendConfirmation(email.trim())
      setMessage('Confirmation email sent — check your inbox and spam folder.')
    } catch (err) {
      setError(err.message || 'Could not resend the email')
    } finally {
      setResending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Alert tone="warn">{notice}</Alert>
      <Field label="Email" type="email" autoComplete="email" required readOnly={emailLocked} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
      <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
      <Submit loading={loading} idle="Log in" busy="Logging in…" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" onClick={onForgotPassword} className="font-semibold text-moss hover:underline">
          Forgot password?
        </button>
        <button type="button" disabled={resending} onClick={resend} className="text-slate-500 hover:underline disabled:opacity-60">
          {resending ? 'Sending…' : 'Resend confirmation'}
        </button>
      </div>
      <p className="text-center text-sm text-slate-500">
        New here?{' '}
        <button type="button" onClick={onSwitch} className="font-semibold text-moss hover:underline">Create an account</button>
      </p>
    </form>
  )
}

function CreatePasswordForm({ email, name = '', phone = '', company = '', accountReady = false, onCreatePassword }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Those passwords don’t match.')
      return
    }
    setLoading(true)
    try {
      await onCreatePassword?.(password)
    } catch (err) {
      setError(err.message || 'Could not save the password.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email" type="email" autoComplete="email" required readOnly value={email} placeholder="you@company.com" />
      {accountReady && name ? <Field label="Name" readOnly value={name} /> : null}
      {accountReady && phone ? <Field label="Mobile" readOnly value={phone.startsWith('+') ? phone : `+91 ${phone}`} /> : null}
      {accountReady && company ? <Field label="Company" readOnly value={company} /> : null}
      <Field label="Create password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
      <Field label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Retype your password" />
      <Alert tone="error">{error}</Alert>
      <Submit loading={loading} idle={accountReady ? 'Create account' : 'Log in'} busy={accountReady ? 'Creating account…' : 'Logging in…'} />
    </form>
  )
}

function SignupForm({ onNeedsConfirmation, onAlreadyRegistered, onSwitch, prefillEmail = '' }) {
  const [email, setEmail] = useState(prefillEmail || '')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const phoneDigits = normalizeIndiaMobileDigits(mobile)
    if (!isValidIndiaMobile(phoneDigits)) {
      setError('Enter a valid 10-digit Indian mobile number.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const phoneE164 = toIndiaE164(phoneDigits)
      const result = await signUp(email.trim(), password, { phoneDigits, phoneE164 })
      if (result.alreadyRegistered) {
        onAlreadyRegistered(email.trim())
        return
      }
      // Persist phone on user_profiles when we already have a session (email confirm off).
      // If confirmation is required, metadata holds the number until first login sync.
      if (result.session) {
        try {
          await saveUserPhone(phoneDigits)
        } catch (phoneErr) {
          console.warn('Could not save mobile on signup', phoneErr)
        }
      } else {
        try {
          sessionStorage.setItem('qg_pending_phone', phoneDigits)
        } catch { /* private mode */ }
      }
      // With email confirmation on there is no session yet; with it off Supabase
      // signs the user straight in and onAuthStateChange takes over.
      if (result.needsConfirmation) onNeedsConfirmation(email.trim())
    } catch (err) {
      setError(err.message || 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium text-slate-700">Mobile number</span>
        <div className="flex overflow-hidden rounded-xl border border-sand bg-white focus-within:border-moss focus-within:ring-4 focus-within:ring-blue-50">
          <span className="flex items-center border-r border-sand bg-slate-50 px-3 text-sm font-semibold text-slate-600">{INDIA_COUNTRY_CODE}</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            maxLength={16}
            value={mobile}
            onChange={e => setMobile(indiaMobileInputValue(e.target.value))}
            placeholder="9876543210"
            className="w-full bg-transparent px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <span className="mt-1 block text-xs text-slate-400">10-digit Indian mobile. A leading 0 or {INDIA_COUNTRY_CODE} is removed.</span>
      </label>
      <Field label="Password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
      <Field label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Retype your password" />
      <Alert tone="error">{error}</Alert>
      <Submit loading={loading} idle="Sign up" busy="Creating account…" />
      <p className="text-center text-xs leading-relaxed text-slate-500">
        By signing up you agree to our <a href="/privacy" className="font-semibold text-moss hover:underline">Privacy Policy</a>
        {' '}and <a href="/terms" className="font-semibold text-moss hover:underline">Terms of Service</a>.
      </p>
      <p className="text-center text-sm text-slate-500">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="font-semibold text-moss hover:underline">Log in</button>
      </p>
    </form>
  )
}

const META_OTP_SENT_KEY = 'qg_meta_otp_sent'

function readMetaOtpSent(email) {
  try {
    const raw = sessionStorage.getItem(META_OTP_SENT_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved?.email || saved.email !== email) return null
    const ageMs = Date.now() - Number(saved.at || 0)
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10 * 60 * 1000) return null
    return { ...saved, ageMs, remainSec: Math.max(0, 60 - Math.floor(ageMs / 1000)) }
  } catch {
    return null
  }
}

function writeMetaOtpSent(email) {
  try {
    sessionStorage.setItem(META_OTP_SENT_KEY, JSON.stringify({ email, at: Date.now() }))
  } catch { /* ignore */ }
}

function isOtpRateLimitError(message) {
  return /too many|rate limit|after\s*\d+\s*seconds|security purposes/i.test(String(message || ''))
}

/**
 * Meta ads trial — email only + OTP. Mobile was already captured on the landing form.
 * Dark, minimal screen inspired by a simple verify UI (email instead of phone).
 */
function MetaTrialAuthPage({ prefillEmail = '', prefillPhone = '', leadName = '', leadCompany = '', onSwitchLogin }) {
  const OTP_LENGTH = 8
  const emptyDigits = () => Array.from({ length: OTP_LENGTH }, () => '')
  const [email, setEmail] = useState(prefillEmail || '')
  const [digits, setDigits] = useState(emptyDigits)
  const [otpLength, setOtpLength] = useState(OTP_LENGTH)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [codeSent, setCodeSent] = useState(false)
  const [delivery, setDelivery] = useState('code')
  const inputsRef = useRef([])
  const sentForRef = useRef('')

  const phoneDigits = normalizeIndiaMobileDigits(prefillPhone || '').slice(0, 10)
  const otp = digits.join('')

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const markSent = (em, remainSec = 60) => {
    sentForRef.current = em
    writeMetaOtpSent(em)
    setCodeSent(true)
    setCooldown(Math.max(0, remainSec))
  }

  const sendOtp = async ({ silent = false } = {}) => {
    if (!silent) setError('')
    const em = email.trim().toLowerCase()
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      if (!silent) setError('Enter a valid email address.')
      return false
    }
    setSending(true)
    try {
      const phoneE164 = isValidIndiaMobile(phoneDigits) ? toIndiaE164(phoneDigits) : ''
      const sent = await requestEmailOtp(em, {
        phoneDigits: isValidIndiaMobile(phoneDigits) ? phoneDigits : '',
        phoneE164,
        name: leadName,
        company: leadCompany
      })
      if (isValidIndiaMobile(phoneDigits)) {
        try { sessionStorage.setItem('qg_pending_phone', phoneDigits) } catch { /* ignore */ }
      }
      setDelivery(sent?.delivery === 'link' ? 'link' : 'code')
      const len = Number(sent?.otpLength) || OTP_LENGTH
      setOtpLength(len)
      markSent(em, 60)
      setDigits(Array.from({ length: len }, () => ''))
      return true
    } catch (err) {
      const message = err.message || 'Could not send the code. Please try again.'
      // Auto-send often hits Supabase’s “too many emails” after refresh / remount —
      // treat that as “code already on the way”, not a hard failure.
      if (silent && isOtpRateLimitError(message)) {
        markSent(em, 60)
        return true
      }
      if (!silent) setError(message)
      return false
    } finally {
      setSending(false)
    }
  }

  // Auto-send once when we land with a prefilled email — skip if we just sent.
  useEffect(() => {
    const em = String(prefillEmail || '').trim().toLowerCase()
    if (!em || sentForRef.current === em) return
    const prior = readMetaOtpSent(em)
    if (prior) {
      markSent(em, prior.remainSec || 60)
      return
    }
    sendOtp({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDigitChange = (index, raw) => {
    const value = String(raw || '').replace(/\D/g, '')
    if (!value) {
      setDigits((prev) => {
        const next = [...prev]
        next[index] = ''
        return next
      })
      return
    }
    // Paste full code into one box
    if (value.length > 1) {
      const chars = value.slice(0, otpLength).split('')
      setDigits((prev) => {
        const next = [...prev]
        for (let i = 0; i < otpLength; i += 1) next[i] = chars[i] || ''
        return next
      })
      const focusAt = Math.min(chars.length, otpLength - 1)
      inputsRef.current[focusAt]?.focus()
      return
    }
    setDigits((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
    if (index < otpLength - 1) inputsRef.current[index + 1]?.focus()
  }

  const onDigitKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus()
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    setError('')
    const em = email.trim().toLowerCase()
    if (!/^\d+$/.test(otp) || otp.length !== otpLength) {
      setError(`Enter the ${otpLength}-digit code from your email.`)
      return
    }
    if (!codeSent && sentForRef.current !== em) {
      const ok = await sendOtp()
      if (!ok) return
      setError('Code sent — enter it below, then tap Verify again.')
      return
    }
    setLoading(true)
    try {
      const stored = readMetaAdsLead()
      if (stored?.email) {
        writeMetaAdsLead({ ...stored, email: em, verified: false, id: stored.email === em ? stored.id : null })
      }
      await verifyEmailLoginOtp(em, otp)
      markMetaTrialUnpaid(em)
      trackPixel('CompleteRegistration', { status: 'verified' }, { once: em })
      if (isValidIndiaMobile(phoneDigits)) {
        try {
          await saveUserPhone(phoneDigits)
          sessionStorage.removeItem('qg_pending_phone')
        } catch (phoneErr) {
          console.warn('Could not save mobile after OTP login', phoneErr)
        }
      }
    } catch (err) {
      setError(err.message || 'That code didn’t work. Try again or resend.')
    } finally {
      setLoading(false)
    }
  }

  const cooldownLabel = `00:${String(cooldown).padStart(2, '0')}`

  return (
    <main className="meta-otp-page">
      <div className="meta-otp-shell">
        <h1 className="meta-otp-welcome">
          Welcome to <span>QuoteGen</span>
        </h1>

        <form onSubmit={verify} className="meta-otp-form">
          <label className="meta-otp-label" htmlFor="meta-otp-email">Your email</label>
          <input
            id="meta-otp-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setCodeSent(false)
            }}
            placeholder="you@company.com"
            className="meta-otp-email"
          />

          <div className="meta-otp-row">
            <span className="meta-otp-label">OTP</span>
            <div className="meta-otp-resend">
              <button
                type="button"
                className="meta-otp-resend-btn"
                disabled={sending || cooldown > 0}
                onClick={() => sendOtp()}
              >
                {sending ? 'Sending…' : 'Resend OTP'}
              </button>
              {cooldown > 0 && <span className="meta-otp-timer">{cooldownLabel}</span>}
            </div>
          </div>

          {delivery === 'link' && codeSent ? (
            <p className="meta-otp-link-sent">
              We emailed a sign-in link to <strong>{email.trim()}</strong>. Open the mail “Your sign-in link” and tap <strong>Sign in</strong> — you’ll continue your trial from there.
            </p>
          ) : (
          <>
          <div className="meta-otp-slots" role="group" aria-label="One-time password">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputsRef.current[i] = el }}
                type="text"
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={otpLength}
                value={d}
                onChange={(e) => onDigitChange(i, e.target.value)}
                onKeyDown={(e) => onDigitKeyDown(i, e)}
                className="meta-otp-slot"
                aria-label={`Digit ${i + 1}`}
              />
            ))}
          </div>

          <p className="meta-otp-hint">Enter the {otpLength}-digit code from the email.</p>
          </>
          )}

          {error && <p className="meta-otp-error">{error}</p>}

          {!(delivery === 'link' && codeSent) && (
            <button type="submit" className="meta-otp-submit" disabled={loading || sending}>
              {loading ? 'Verifying…' : (
                <>
                  Verify &amp; Login
                  <span className="meta-otp-submit-ico" aria-hidden="true">↗</span>
                </>
              )}
            </button>
          )}
        </form>

        <p className="meta-otp-terms">
          By continuing you agree to our Terms. Password can be set later.
        </p>
        <button type="button" className="meta-otp-login-link" onClick={onSwitchLogin}>
          Already have a password? Log in
        </button>
      </div>
    </main>
  )
}

/**
 * Post-signup screen. The confirmation email normally carries a link, which
 * brings the browser back to this origin and signs the user in automatically.
 * The code box is a fallback for projects whose email template was changed to
 * send a {{ .Token }} code instead.
 */
function ConfirmEmail({ email, onBack }) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [resending, setResending] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  const resend = async () => {
    setResending(true)
    setError('')
    setMessage('')
    try {
      await resendConfirmation(email)
      setMessage('Sent — check your inbox again.')
    } catch (err) {
      setError(err.message || 'Could not resend the email')
    } finally {
      setResending(false)
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    setVerifying(true)
    setError('')
    try {
      await verifyEmailCode(email, code.trim())
    } catch (err) {
      setError(err.message || 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-4">
      <Alert tone="success">
        We emailed a confirmation link to <span className="font-semibold">{email}</span>. Open it and you'll come
        straight back here, logged in.
      </Alert>
      <p className="text-sm text-slate-500">
        Nothing in your inbox? Check spam, then resend. Until you confirm, login will fail even with the right
        password. The link opens this app, so keep this tab's address
        (<span className="font-medium text-slate-600">{window.location.origin}</span>) allowed in your Supabase
        redirect settings.
      </p>
      <Alert tone="success">{message}</Alert>
      <Alert tone="error">{error}</Alert>
      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="text-slate-500 hover:underline">Back to log in</button>
        <button
          type="button"
          disabled={resending}
          onClick={resend}
          className="font-semibold text-moss hover:underline disabled:opacity-60"
        >
          {resending ? 'Sending…' : 'Resend email'}
        </button>
      </div>

      {showCode ? (
        <form onSubmit={verify} className="space-y-3 border-t border-sand pt-4">
          <Field
            label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            required
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 12))}
            placeholder="6-digit code"
            hint="Only needed if your email contains a code rather than a link."
          />
          <Submit loading={verifying} idle="Verify code" busy="Verifying…" />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowCode(true)}
          className="w-full border-t border-sand pt-4 text-center text-xs text-slate-400 hover:text-slate-600"
        >
          Got a 6-digit code instead of a link?
        </button>
      )}
    </div>
  )
}

function ForgotPasswordForm({ prefillEmail, onBack }) {
  const [email, setEmail] = useState(prefillEmail || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      await requestPasswordReset(email.trim())
      setMessage('If that email has an account, you’ll get a reset link shortly. Open it in this same browser.')
    } catch (err) {
      setError(err.message || 'Could not send a reset email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
      <Submit loading={loading} idle="Send reset link" busy="Sending…" />
      <p className="text-center text-sm text-slate-500">
        <button type="button" onClick={onBack} className="font-semibold text-moss hover:underline">Back to log in</button>
      </p>
    </form>
  )
}

function ResetPasswordForm({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await updatePassword(password)
      onDone?.()
    } catch (err) {
      setError(err.message || 'Could not update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="New password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
      <Field label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Retype your password" />
      <Alert tone="error">{error}</Alert>
      <Submit loading={loading} idle="Save password" busy="Saving…" />
    </form>
  )
}

const COPY = {
  login: {
    title: 'Log in',
    blurb: 'Sign in to open your quotations, products, and knowledge base.'
  },
  signup: {
    title: 'Create your account',
    blurb: 'We’ll email you a confirmation link to check it’s really you.'
  },
  'meta-trial': {
    title: 'Continue your free trial',
    blurb: 'Confirm your email with a one-time code — no password needed yet.'
  },
  confirm: {
    title: 'Confirm your email',
    blurb: 'One more step before you can log in.'
  },
  forgot: {
    title: 'Reset your password',
    blurb: 'We’ll email you a link to choose a new password.'
  },
  reset: {
    title: 'Choose a new password',
    blurb: 'This signs you in and replaces the old password on the account.'
  },
  'create-password': {
    title: 'Log in',
    blurb: 'Sign in to open your quotations, products, and knowledge base.'
  }
}

export default function AuthScreen({
  recovery = false,
  onPasswordUpdated,
  initialMode,
  prefillEmail = '',
  prefillPhone = '',
  leadName = '',
  leadCompany = '',
  accountReady = false,
  onPreferLogin,
  onCreatePassword,
  onLoggedIn
}) {
  const [mode, setMode] = useState(recovery ? 'reset' : (initialMode || 'login'))
  const [pendingEmail, setPendingEmail] = useState('')
  const [loginNotice, setLoginNotice] = useState('')

  const needsConfirmation = (email) => {
    setPendingEmail(email)
    setLoginNotice('')
    setMode('confirm')
  }

  const alreadyRegistered = (email) => {
    setPendingEmail(email)
    setLoginNotice('This email already has an account. Log in below, or reset your password if you don’t remember it. If you never confirmed the address, resend the confirmation email first.')
    setMode('login')
  }

  const copy = (mode === 'create-password' && accountReady)
    ? { title: 'Create your account', blurb: 'Your details are already filled. Choose a password to sign in.' }
    : (COPY[mode] || COPY.login)

  if (mode === 'meta-trial') {
    return (
      <MetaTrialAuthPage
        prefillEmail={prefillEmail}
        prefillPhone={prefillPhone}
        leadName={leadName}
        leadCompany={leadCompany}
        onSwitchLogin={() => {
          setLoginNotice('')
          onPreferLogin?.()
          setMode('login')
        }}
      />
    )
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-mist px-5 py-10 text-ink">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="auth-blob left-[-8%] top-[-10%] h-72 w-72 bg-blue-300" style={{ animationDelay: '0s' }} />
        <div className="auth-blob right-[-6%] top-[8%] h-96 w-96 bg-blue-200" style={{ animationDelay: '3s' }} />
        <div className="auth-blob bottom-[-12%] left-[18%] h-80 w-80 bg-indigo-200" style={{ animationDelay: '6s' }} />
      </div>
      <div className="relative w-full max-w-md">
        <div className="auth-logo-in mb-6 flex items-center justify-center gap-2.5">
          <BrandMark size={40} />
          <span className="text-lg font-semibold tracking-tight">QuoteGen</span>
        </div>
        <div className="auth-card-in rounded-3xl bg-white p-6 shadow-soft ring-1 ring-black/[.03] sm:p-8">
          <h1 className="mb-1 text-xl font-semibold">{copy.title}</h1>
          <p className="mb-6 text-sm text-slate-500">{copy.blurb}</p>

          {!supabaseConfigured && (
            <div className="mb-5">
              <Alert tone="warn">
                Supabase isn’t configured for the browser yet. Add <span className="font-mono text-xs">VITE_SUPABASE_URL</span> and{' '}
                <span className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</span> to <span className="font-mono text-xs">.env</span>,
                then restart the dev server.
              </Alert>
            </div>
          )}

          {emailLinkError && (
            <div className="mb-5">
              <Alert tone="error">
                That confirmation link didn’t work: {emailLinkError}. Sign up again to get a fresh one.
              </Alert>
            </div>
          )}

          {mode === 'login' && (
            <LoginForm
              onSwitch={() => { setLoginNotice(''); setMode('signup') }}
              onNeedsConfirmation={needsConfirmation}
              onForgotPassword={() => setMode('forgot')}
              onLoggedIn={onLoggedIn}
              prefillEmail={pendingEmail || prefillEmail}
              emailLocked={Boolean(prefillEmail)}
              notice={loginNotice}
            />
          )}
          {mode === 'create-password' && (
            <CreatePasswordForm
              email={prefillEmail}
              name={leadName}
              phone={prefillPhone}
              company={leadCompany}
              accountReady={accountReady}
              onCreatePassword={onCreatePassword}
            />
          )}
          {mode === 'signup' && (
            <SignupForm
              onNeedsConfirmation={needsConfirmation}
              onAlreadyRegistered={alreadyRegistered}
              onSwitch={() => setMode('login')}
              prefillEmail={pendingEmail || prefillEmail}
            />
          )}
          {mode === 'confirm' && (
            <ConfirmEmail email={pendingEmail} onBack={() => setMode('login')} />
          )}
          {mode === 'forgot' && (
            <ForgotPasswordForm prefillEmail={pendingEmail} onBack={() => setMode('login')} />
          )}
          {mode === 'reset' && (
            <ResetPasswordForm onDone={onPasswordUpdated} />
          )}
        </div>
      </div>
    </main>
  )
}
