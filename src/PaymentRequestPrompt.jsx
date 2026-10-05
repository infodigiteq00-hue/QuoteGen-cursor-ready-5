import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

function rupees(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return ''
  return `₹${value.toLocaleString('en-IN')}`
}

function tillLabel(value) {
  if (!value) return ''
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function PaymentOfferModal({ offer, busy, error, note, onPay, onClose, framed = false }) {
  const quotes = Number(offer.quotesPerMonth)
  const quoteLine = Number.isFinite(quotes) && quotes > 0
    ? `${quotes.toLocaleString('en-IN')} quotations${offer.period === 'once' ? '' : ' / month'}`
    : ''
  const detail = [
    quoteLine,
    offer.period === 'year' ? 'Yearly' : offer.period === 'month' ? 'Monthly' : offer.period === 'once' ? 'One-time' : '',
    offer.validTill ? `Valid till ${tillLabel(offer.validTill)}` : ''
  ].filter(Boolean)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qg-pay-offer-title"
      style={{ position: framed ? 'absolute' : 'fixed', inset: 0, zIndex: framed ? 2 : 280, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(15,23,42,.42)' }}
    >
      <div style={{ width: 'min(440px, 100%)', background: '#fff', borderRadius: 20, boxShadow: '0 28px 60px -24px rgba(20,35,80,.45)', border: '1px solid #E8EBF2', padding: '22px 24px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: '#1A73E8' }}>Payment ready</div>
        <h2 id="qg-pay-offer-title" style={{ margin: '8px 0 0', fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: '#0D1117' }}>Your package is ready to pay</h2>
        <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.5, color: '#6B7688' }}>{offer.label}</p>
        <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 14, background: '#F4F7FB', border: '1px solid #E6EDF6' }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.03em', color: '#0D1117' }}>{rupees(offer.amount)}</div>
          {detail.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 14, color: '#3D4859', lineHeight: 1.45 }}>{detail.join(' · ')}</div>
          )}
        </div>
        {note && (
          <p style={{ margin: '12px 0 0', fontSize: 13.5, color: '#3D4859' }}>{note}</p>
        )}
        {error && (
          <p style={{ margin: '12px 0 0', fontSize: 13.5, color: '#B03A3A' }}>{error}</p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onClose} disabled={busy} style={{ minHeight: 42, padding: '0 16px', borderRadius: 12, border: '1.5px solid #D5DDE9', background: '#fff', color: '#3D4859', fontSize: 14.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>Not now</button>
          <button type="button" onClick={onPay} disabled={busy} style={{ minHeight: 42, padding: '0 18px', borderRadius: 12, border: 0, background: '#1A73E8', color: '#fff', fontSize: 14.5, fontWeight: 750, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Opening PhonePe…' : 'Pay now'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function usePaymentRequestOffer({ email = '', name = '', company = '', phone = '' } = {}) {
  const [offer, setOffer] = useState(null)
  const [dismissed, setDismissed] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const target = String(email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setOffer(null)
      return undefined
    }
    let stop = false
    const load = async () => {
      try {
        const response = await fetch(`/api/pay/request?email=${encodeURIComponent(target)}`)
        const data = await response.json().catch(() => ({}))
        if (stop || !response.ok) return
        const next = data?.request?.id ? data.request : null
        setOffer((prev) => {
          if (!next) return null
          if (
            prev
            && prev.id === next.id
            && prev.amount === next.amount
            && prev.label === next.label
            && prev.validTill === next.validTill
          ) return prev
          return next
        })
      } catch {
        /* keep the offer already on screen */
      }
    }
    load()
    const timer = window.setInterval(load, 4000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [email])

  const pay = async () => {
    if (!offer || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/pay/phonepe/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: 'request',
          requestId: offer.id,
          email,
          name,
          company,
          phone
        })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data?.redirectUrl) {
        window.location.assign(data.redirectUrl)
        return
      }
      setError(data?.error || 'Could not open PhonePe. Please try again.')
    } catch {
      setError('Could not open PhonePe. Check your connection and try again.')
    }
    setBusy(false)
  }

  useEffect(() => {
    if (!offer || dismissed === offer.id) return undefined
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const close = () => setDismissed(offer.id)
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    root.render(
      <PaymentOfferModal
        offer={offer}
        busy={busy}
        error={error}
        onPay={pay}
        onClose={close}
      />
    )
    return () => {
      window.removeEventListener('keydown', onKey)
      root.unmount()
      host.remove()
    }
  }, [offer, dismissed, busy, error])
}
