import React, { useEffect, useState } from 'react'
import { trackPixel } from './metaPixel.js'
import './paymentStatus.css'

const POLL_MS = 3000
const MAX_POLLS = 40

export default function PaymentStatus({ onContinue, onPaid }) {
  const orderId = new URLSearchParams(window.location.search).get('order') || ''
  const [state, setState] = useState(orderId ? 'PENDING' : 'MISSING')
  const [amount, setAmount] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!orderId) return undefined
    let cancelled = false
    let polls = 0
    let timer = null

    const check = async () => {
      polls += 1
      try {
        const response = await fetch(`/api/pay/phonepe/status/${encodeURIComponent(orderId)}`)
        const data = await response.json().catch(() => ({}))
        if (cancelled) return
        if (!response.ok) {
          setError(data?.error || 'Could not check the payment.')
        } else {
          setError('')
          setAmount(data.amount || 0)
          setState(data.state)
          if (data.state === 'COMPLETED') {
            try { sessionStorage.removeItem('qg_needs_password') } catch { /* ignore */ }
            onPaid?.()
            trackPixel('Purchase', { value: data.amount || 0, currency: 'INR', content_name: 'QuoteGen monthly' }, { once: orderId })
          }
          if (data.state !== 'PENDING') return
        }
      } catch {
        if (cancelled) return
        setError('Could not reach the server.')
      }
      if (polls < MAX_POLLS) timer = setTimeout(check, POLL_MS)
    }

    check()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [orderId])

  const done = state === 'COMPLETED'
  const failed = state === 'FAILED' || state === 'MISSING'

  return (
    <main className="qg-pay-status">
      <div className="qg-pay-status-card">
        <div className={`qg-pay-status-icon ${done ? 'is-done' : failed ? 'is-failed' : 'is-pending'}`} aria-hidden="true">
          {done ? '✓' : failed ? '!' : ''}
        </div>
        <h1>
          {done ? 'Welcome to QuoteGen!' : failed ? 'Payment not completed' : 'Confirming your payment…'}
        </h1>
        <p>
          {done
            ? `We received ₹${amount}. Your QuoteGen plan is active — our team will reach out shortly.`
            : failed
              ? 'No money was taken for this attempt. You can go back and try again.'
              : 'This usually takes a few seconds. Please don’t close this page.'}
        </p>
        {error && !done && !failed ? <p className="qg-pay-status-error">{error}</p> : null}
        {orderId ? <p className="qg-pay-status-ref">Reference: {orderId}</p> : null}
        {done || failed ? (
          <button type="button" onClick={() => onContinue?.(state)}>
            {done ? 'Go to QuoteGen' : 'Back to QuoteGen'}
          </button>
        ) : null}
      </div>
    </main>
  )
}
