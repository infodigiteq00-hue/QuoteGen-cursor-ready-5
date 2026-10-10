import React, { useEffect, useState } from 'react'
import { trackPixel } from './metaPixel.js'
import './paymentStatus.css'

const POLL_MS = 3000
const MAX_POLLS = 40

export default function PaymentStatus({ onContinue, onPaid, onAccountReady, previewCustomer = null }) {
  const orderId = previewCustomer ? '' : (new URLSearchParams(window.location.search).get('order') || '')
  const [state, setState] = useState(previewCustomer ? 'COMPLETED' : (orderId ? 'PENDING' : 'MISSING'))
  const [amount, setAmount] = useState(previewCustomer?.amount || 0)
  const [error, setError] = useState('')
  const [customer, setCustomer] = useState(previewCustomer)

  useEffect(() => {
    if (previewCustomer) return undefined
    if (state !== 'COMPLETED' || !customer?.setupAccount) return undefined
    onAccountReady?.(customer)
  }, [state, customer, previewCustomer])

  useEffect(() => {
    if (previewCustomer || !orderId) return undefined
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
          if (data.setupAccount) {
            setCustomer({
              setupAccount: true,
              email: data.email || '',
              name: data.name || '',
              phone: data.phone || '',
              company: data.company || ''
            })
          }
          if (data.state === 'COMPLETED') {
            if (!data.setupAccount) {
              try { sessionStorage.removeItem('qg_needs_password') } catch { /* ignore */ }
            }
            onPaid?.()
            let purchase = {
              value: data.amount || 0,
              currency: 'INR',
              content_name: 'QuoteGen monthly'
            }
            try {
              const pending = JSON.parse(sessionStorage.getItem('qg_pixel_purchase') || 'null')
              if (pending && typeof pending === 'object') {
                purchase = {
                  value: Number(pending.value) || data.amount || 0,
                  currency: 'INR',
                  content_name: pending.content_name || purchase.content_name,
                  content_ids: pending.product ? [pending.product] : undefined
                }
                sessionStorage.removeItem('qg_pixel_purchase')
              } else if (Number(data.amount) === 199 || Number(data.amount) === 248) {
                purchase.content_name = Number(data.amount) === 248
                  ? 'QuoteGen landing2 + WhatsApp'
                  : 'QuoteGen landing2 entry'
              }
            } catch { /* private mode */ }
            trackPixel('Purchase', purchase, { once: orderId })
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
          {done && customer?.setupAccount ? 'Payment received' : done ? 'Welcome to QuoteGen!' : failed ? 'Payment not completed' : 'Confirming your payment…'}
        </h1>
        <p>
          {done && customer?.setupAccount
            ? 'Your account is created, let\'s finish log in'
            : done
            ? `We received ₹${amount}. Your QuoteGen plan is active — our team will reach out shortly.`
            : failed
              ? 'No money was taken for this attempt. You can go back and try again.'
              : 'This usually takes a few seconds. Please don’t close this page.'}
        </p>
        {error && !done && !failed ? <p className="qg-pay-status-error">{error}</p> : null}
        {orderId ? <p className="qg-pay-status-ref">Reference: {orderId}</p> : null}
        {previewCustomer && done && customer?.setupAccount ? (
          <button type="button" onClick={() => onAccountReady?.(customer)}>Continue</button>
        ) : null}
        {((done && !customer?.setupAccount) || failed) ? (
          <button type="button" onClick={() => onContinue?.(state)}>
            {done ? 'Go to QuoteGen' : 'Back to QuoteGen'}
          </button>
        ) : null}
      </div>
    </main>
  )
}
