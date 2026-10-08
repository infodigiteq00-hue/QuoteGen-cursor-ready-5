import React, { useState } from 'react'
import { requestEmailOtp, verifyEmailLoginOtp } from './apiAuth.js'
import { writeMetaAdsLead } from './metaTrialLead.js'
import SetPasswordScreen from './SetPasswordScreen.jsx'

const inputClass = 'w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50'

export default function DemoAccountSetup({ sessionUser, initialEmail = '', initialName = '', onReady }) {
  const signedIn = Boolean(sessionUser?.email)
  const [step, setStep] = useState(signedIn ? 'password' : 'email')
  const [email, setEmail] = useState(initialEmail || sessionUser?.email || '')
  const [name, setName] = useState(initialName)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const lookup = async (em) => {
    const response = await fetch('/api/meta-ads-leads/demo-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: em })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Submit the enquiry form with this email first.')
    return data
  }

  const sendCode = async (e) => {
    e.preventDefault()
    setError('')
    const em = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError('Enter a valid email address.')
      return
    }
    setLoading(true)
    try {
      const lead = await lookup(em)
      setName(lead.name || '')
      writeMetaAdsLead({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email || em,
        company: lead.company,
        monthlyQuotes: lead.monthlyQuotes,
        industry: lead.industry,
        verified: false,
        submitted: true
      })
      await requestEmailOtp(em, { name: lead.name || '', phoneDigits: lead.phone || '' })
      setEmail(em)
      setStep('code')
    } catch (err) {
      setError(err.message || 'Could not send the code.')
    } finally {
      setLoading(false)
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    setError('')
    const token = code.replace(/\D/g, '')
    if (token.length < 6) {
      setError('Enter the code from your email.')
      return
    }
    setLoading(true)
    try {
      await verifyEmailLoginOtp(email, token)
      const stored = { email, name, verified: true, submitted: true }
      writeMetaAdsLead(stored)
      setStep('password')
    } catch (err) {
      setError(err.message || 'That code didn’t work. Try again.')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'password') {
    return (
      <SetPasswordScreen
        kicker="Create your account"
        title="Set your password"
        blurb="This is your QuoteGen login. You’ll use this email and password from Sign in later."
        submitLabel="Continue to demo"
        showRemember
        name={name || initialName}
        email={email || sessionUser?.email || ''}
        onDone={onReady}
      />
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-mist px-4 py-10">
      <form onSubmit={step === 'email' ? sendCode : verify} className="w-full max-w-md rounded-[20px] bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,.12)]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1A73E8]">Create your account</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">
          {step === 'email' ? 'Enter your email' : 'Enter the code'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {step === 'email'
            ? 'Use the email from your enquiry. We’ll send a code, then you can set a password.'
            : `We sent a code to ${email}.`}
        </p>
        {step === 'email' ? (
          <label className="mt-5 block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={inputClass}
            />
          </label>
        ) : (
          <label className="mt-5 block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Email code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="8-digit code"
              className={inputClass}
            />
          </label>
        )}
        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-xl bg-[#1A73E8] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? 'Please wait…' : step === 'email' ? 'Send code' : 'Continue'}
        </button>
        {step === 'code' ? (
          <button type="button" className="mt-3 w-full text-sm font-semibold text-[#1A73E8]" onClick={() => { setStep('email'); setError('') }}>
            Use a different email
          </button>
        ) : null}
      </form>
    </main>
  )
}
