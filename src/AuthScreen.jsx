import React, { useState } from 'react'
import {
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
  updatePassword,
  verifyEmailCode
} from './apiAuth.js'
import { emailLinkError, supabaseConfigured } from './supabaseClient.js'
import BrandMark from './BrandMark.jsx'

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

function LoginForm({ onSwitch, onNeedsConfirmation, onForgotPassword, prefillEmail, notice }) {
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
      <Field label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
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

function SignupForm({ onNeedsConfirmation, onAlreadyRegistered, onSwitch }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const result = await signUp(email.trim(), password)
      if (result.alreadyRegistered) {
        onAlreadyRegistered(email.trim())
        return
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
      <Field label="Password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
      <Field label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Retype your password" />
      <Alert tone="error">{error}</Alert>
      <Submit loading={loading} idle="Sign up" busy="Creating account…" />
      <p className="text-center text-sm text-slate-500">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="font-semibold text-moss hover:underline">Log in</button>
      </p>
    </form>
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
  }
}

export default function AuthScreen({ recovery = false, onPasswordUpdated }) {
  const [mode, setMode] = useState(recovery ? 'reset' : 'login')
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
          <h1 className="mb-1 text-xl font-semibold">{COPY[mode].title}</h1>
          <p className="mb-6 text-sm text-slate-500">{COPY[mode].blurb}</p>

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
              prefillEmail={pendingEmail}
              notice={loginNotice}
            />
          )}
          {mode === 'signup' && (
            <SignupForm
              onNeedsConfirmation={needsConfirmation}
              onAlreadyRegistered={alreadyRegistered}
              onSwitch={() => setMode('login')}
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
