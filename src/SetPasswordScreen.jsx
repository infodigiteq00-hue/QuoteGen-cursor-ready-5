import React, { useState } from 'react'
import { updatePassword } from './apiAuth.js'
import { supabase } from './supabaseClient.js'
import { readMetaAdsLead } from './metaTrialLead.js'

function paidProfile() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem('qg_paid_profile') || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export default function SetPasswordScreen({ onDone }) {
  const lead = readMetaAdsLead() || {}
  const paid = paidProfile()
  const name = String(paid.name || lead.name || '').trim()
  const email = String(paid.email || lead.email || '').trim()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const save = async (e) => {
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
      if (supabase) {
        const { data } = await supabase.auth.getSession()
        if (!data?.session) {
          setError('Open this page on the phone where you verified your email, then set the password.')
          setLoading(false)
          return
        }
      }
      await updatePassword(password)
      if (supabase && name) {
        await supabase.auth.updateUser({ data: { full_name: name, name } }).catch(() => {})
      }
      try { sessionStorage.removeItem('qg_needs_password') } catch { /* ignore */ }
      onDone?.()
    } catch (err) {
      setError(err.message || 'Could not save the password.')
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-mist px-4 py-10">
      <form onSubmit={save} className="w-full max-w-md rounded-[20px] bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,.12)]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1A73E8]">Payment received</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">Set your password</h1>
        <p className="mt-2 text-sm text-slate-500">Name and email are already on the account. Choose a password to open QuoteGen.</p>
        <label className="mt-5 block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Name</span>
          <input value={name} readOnly className="w-full rounded-xl border border-sand bg-slate-50 px-3 py-2.5 text-sm text-slate-600" />
        </label>
        <label className="mt-3 block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Email</span>
          <input value={email} readOnly className="w-full rounded-xl border border-sand bg-slate-50 px-3 py-2.5 text-sm text-slate-600" />
        </label>
        <label className="mt-3 block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50"
          />
        </label>
        <label className="mt-3 block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Retype your password"
            className="w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50"
          />
        </label>
        {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-xl bg-[#1A73E8] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? 'Saving…' : 'Open QuoteGen'}
        </button>
      </form>
    </main>
  )
}
