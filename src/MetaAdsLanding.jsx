import React, { useEffect, useRef, useState } from 'react'
import logoUrl from './assets/landing/quotegen-logo.png'
import { META_ADS_LEAD_KEY as LEAD_KEY, writeMetaAdsLead, writeMetaTrialIntent, clearMetaTrialIntent } from './metaTrialLead.js'
import './metaAdsLanding.css'

const CTA_STYLE = { fontFamily: 'Archivo, Inter, system-ui, sans-serif', fontWeight: 400 }

function DemoCtaLabel() {
  return (
    <>
      Create My Demo Workspace — <span className="meta-cta-em">Free Trial</span> →
    </>
  )
}

function IconPaste() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="8" y="3" width="8" height="4" rx="1" />
    </svg>
  )
}

function IconSpark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  )
}

function IconSend() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  )
}

function IconBolt() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
    </svg>
  )
}

function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function IconX() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function IconWhatsApp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.5 11.6c0 4.7-3.8 8.5-8.5 8.5-1.5 0-2.9-.4-4.1-1.1L3.5 20l.9-4.3A8.4 8.4 0 0 1 3.5 11.6C3.5 6.9 7.3 3.1 12 3.1s8.5 3.8 8.5 8.5Zm-3.3-3.1c-.2-.3-.7-.5-1.4-.5-.4 0-.7.1-1 .4l-.3.3c-.2.2-.5.3-.7.2-.8-.3-1.6.1-2.2.7s-1 1.5-1.3 2.3c-.1.3 0 .5.2.7l.3.3c.1.2.2.4.1.6-.3.8-.8 1.6-1.4 2.2-.2.2-.2.5 0 .7l.4.4c.2.2.4.3.6.2 1.4-.3 2.7-1 3.8-1.9 1.1-.9 1.9-2 2.3-3.2.1-.3 0-.5-.2-.7l-.3-.3c-.2-.2-.3-.5-.2-.7l.3-.3c.2-.3.3-.6.2-1 0-.3-.1-.6-.3-.8Z" />
    </svg>
  )
}

function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '')
}

function TrialForm({ formRef, autoFocusName, onNextStep, initialLead = null }) {
  const [name, setName] = useState(initialLead?.name || '')
  const [phone, setPhone] = useState(initialLead?.phone || '')
  const [email, setEmail] = useState(initialLead?.email || '')
  const [company, setCompany] = useState(initialLead?.company || '')
  const [error, setError] = useState('')
  const [done, setDone] = useState(Boolean(initialLead))
  const [submitting, setSubmitting] = useState(false)
  const nameRef = useRef(null)

  useEffect(() => {
    if (autoFocusName) nameRef.current?.focus()
  }, [autoFocusName])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const n = name.trim()
    const p = digitsOnly(phone)
    const em = email.trim().toLowerCase()
    if (!n) {
      setError('Please enter your name.')
      return
    }
    if (p.length !== 10) {
      setError('Enter a valid 10-digit mobile number.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError('Enter a valid email address.')
      return
    }
    const payload = {
      name: n,
      phone: p,
      email: em,
      company: company.trim(),
      source: 'meta_ads_landing',
      path: typeof window !== 'undefined' ? window.location.pathname : '',
      query: typeof window !== 'undefined' ? window.location.search : '',
      submittedAt: new Date().toISOString(),
      submitted: true
    }
    setSubmitting(true)
    try {
      const response = await fetch('/api/meta-ads-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Could not save your details. Please try again.')
      }
      writeMetaAdsLead({ ...payload, id: data.id || null })
      setDone(true)
    } catch (err) {
      setError(err.message || 'Could not save your details. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="meta-form-card" ref={formRef} id="trial-form">
        <h2>You’re in — thank you</h2>
        <p className="meta-form-lead">
          We’ve saved your details. Pick how you’d like to start — you can do both.
        </p>
        <p className="meta-form-ok">
          Start with your letterhead, or jump straight into a demo quotation — you can do both.
        </p>
        <p className="meta-next-prompt">How would you like to continue?</p>
        <div className="meta-next-actions">
          <button
            type="button"
            className="meta-btn meta-btn-ghost meta-btn-lg meta-next-secondary"
            onClick={() => onNextStep?.('company', { name, phone, email, company })}
          >
            Set up company details
          </button>
          <button
            type="button"
            className="meta-btn meta-btn-primary meta-btn-lg meta-next-primary"
            style={CTA_STYLE}
            onClick={() => onNextStep?.('demo', { name, phone, email, company })}
          >
            Create a <span className="meta-cta-em">demo quotation</span>
          </button>
        </div>
        <p className="meta-form-fine">Takes a few minutes · No credit card required</p>
      </div>
    )
  }

  return (
    <form className="meta-form-card" ref={formRef} id="trial-form" onSubmit={submit}>
      <h2>Create your free trial</h2>
      <p className="meta-form-lead">
        Enter your details to unlock your demo workspace — no credit card required.
      </p>
      <div className="meta-fields">
        <div className="meta-field">
          <label htmlFor="meta-name">Your name</label>
          <input
            ref={nameRef}
            id="meta-name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rahul Sharma"
          />
        </div>
        <div className="meta-field">
          <label htmlFor="meta-phone">Mobile</label>
          <div className="meta-phone-field">
            <div className="meta-phone-prefix">+91</div>
            <input
              id="meta-phone"
              name="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={phone}
              onChange={(e) => setPhone(digitsOnly(e.target.value).slice(0, 10))}
              placeholder="9876543210"
            />
          </div>
        </div>
        <div className="meta-field">
          <label htmlFor="meta-email">Work email</label>
          <input
            id="meta-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div className="meta-field">
          <label htmlFor="meta-company">Company <span style={{ fontWeight: 500, color: '#6F7F9C' }}>(optional)</span></label>
          <input
            id="meta-company"
            name="organization"
            autoComplete="organization"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Your business name"
          />
        </div>
      </div>
      {error && <p className="meta-form-error">{error}</p>}
      <button
        type="submit"
        className="meta-btn meta-btn-primary meta-btn-lg"
        style={CTA_STYLE}
        disabled={submitting}
      >
        {submitting ? 'Saving…' : <DemoCtaLabel />}
      </button>
      <p className="meta-form-fine">
        No credit card required · Free to try
      </p>
    </form>
  )
}

export default function MetaAdsLanding({ onSignIn, onContinueTrial, initialLead = null }) {
  const formRef = useRef(null)
  const [focusForm, setFocusForm] = useState(0)

  // Fresh visit / refresh of the ads landing should start on the empty form —
  // not restore the post-submit “You’re in” screen from a prior attempt.
  // A signed-in user coming Back from the trial guide lands on the choice card.
  useEffect(() => {
    if (initialLead) {
      document.getElementById('trial-form')?.scrollIntoView({ block: 'center' })
      return
    }
    try {
      sessionStorage.removeItem(LEAD_KEY)
      sessionStorage.removeItem('qg_meta_otp_sent')
    } catch { /* ignore */ }
    clearMetaTrialIntent()
  }, [])

  const goToForm = () => {
    setFocusForm((n) => n + 1)
    const el = document.getElementById('trial-form')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleNextStep = (choice, lead) => {
    writeMetaTrialIntent(choice)
    if (lead) writeMetaAdsLead({ ...lead, submitted: true, next: choice })
    // Leave the long landing URL so refresh / back doesn't dump them into the ads page again.
    // Signed-in users (initialLead) skip verify and go straight back into the app.
    try {
      if (!initialLead) window.history.pushState({}, '', '/trial-verify')
      window.scrollTo(0, 0)
    } catch { /* ignore */ }
    onContinueTrial?.(choice, lead)
  }

  return (
    <div className="meta-ads">
      <header className="meta-header">
        <div className="meta-shell meta-header-inner">
          <div className="meta-brand">
            <img src={logoUrl} alt="" />
            <div className="meta-brand-stack">
              <span className="meta-brand-name">QuoteGen</span>
              <span className="meta-brand-sub">BY DIGITEQ SOLUTION</span>
            </div>
          </div>
          <div className="meta-header-actions">
            <a className="meta-phone" href="tel:+919067610118">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.35a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.75.32 1.54.55 2.35.68A2 2 0 0 1 22 16.92z" />
              </svg>
              +91 90676 10118
            </a>
            {onSignIn && (
              <button type="button" className="meta-btn meta-btn-signin" onClick={onSignIn}>
                Sign in
              </button>
            )}
            <button
              type="button"
              className="meta-btn meta-btn-primary meta-btn-header"
              onClick={goToForm}
              style={{ fontFamily: 'Archivo, Inter, system-ui, sans-serif', fontWeight: 700 }}
            >
              Start Free Trial
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </header>

      <section className="meta-hero">
        <div className="meta-hero-glow" aria-hidden="true" />
        <div className="meta-shell meta-shell-center" style={{ position: 'relative' }}>
          <div className="meta-badge">214+ businesses already quoting faster</div>
          <h1>
            Turn Any Enquiry Into a
            <br />
            <span className="meta-highlight">Professional Quotation</span>
            {' '}in 2 Minutes
          </h1>
          <div className="meta-hero-cta">
            <button
              type="button"
              className="meta-btn meta-btn-primary meta-btn-hero"
              onClick={goToForm}
              style={CTA_STYLE}
            >
              <DemoCtaLabel />
            </button>
          </div>
          <p className="meta-hero-note">No credit card required · Free to try</p>
          {onSignIn && (
            <p className="meta-hero-signin">
              Already have an account?{' '}
              <button type="button" className="meta-text-link" onClick={onSignIn}>Sign In</button>
            </p>
          )}
          <div className="meta-stats">
            <div className="meta-stat">
              <div className="meta-stat-value">3,841</div>
              <div className="meta-stat-label">Quotes Generated</div>
            </div>
            <div className="meta-stat">
              <div className="meta-stat-value">214+</div>
              <div className="meta-stat-label">Businesses Using QuoteGen</div>
            </div>
            <div className="meta-stat">
              <div className="meta-stat-value">&lt; 2 min</div>
              <div className="meta-stat-label">Avg. Quotation Time</div>
            </div>
            <div className="meta-stat">
              <div className="meta-stat-value">4.9 ★</div>
              <div className="meta-stat-label">Average Rating</div>
            </div>
          </div>
        </div>
      </section>

      <section className="meta-section meta-section-light" id="how">
        <div className="meta-shell meta-shell-center">
          <h2>From enquiry to quotation in 3 simple steps</h2>
          <p className="meta-section-lead">
            No training. No complicated setup. Just paste, generate, and send — usually in under 2 minutes.
          </p>
          <div className="meta-steps">
            <article className="meta-step">
              <div className="meta-step-icon"><IconPaste /></div>
              <div className="meta-step-num">Step 01</div>
              <h3>Paste any enquiry</h3>
              <p>WhatsApp text, email, notes, or an RFQ attachment — drop it in exactly as the client sent it.</p>
            </article>
            <article className="meta-step">
              <div className="meta-step-icon"><IconSpark /></div>
              <div className="meta-step-num">Step 02</div>
              <h3>Get a professional quotation</h3>
              <p>QuoteGen drafts line items, quantities, and rates into a clean, client-ready layout.</p>
            </article>
            <article className="meta-step">
              <div className="meta-step-icon"><IconSend /></div>
              <div className="meta-step-num">Step 03</div>
              <h3>Verify pricing &amp; send</h3>
              <p>Check the numbers once, send the quotation, and move straight to the next deal conversation.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="meta-section meta-section-outcome" id="outcome">
        <div className="meta-compare-band">
          <div className="meta-shell">
            <div className="meta-compare-head">
              <h2>Same Enquiry. <span>Different Results.</span></h2>
              <p>
                Turn messy enquiries into{' '}
                <span className="meta-compare-mark">accurate, professional quotations</span>
                {' '}— in seconds.
              </p>
            </div>

            <div className="meta-compare-stage" aria-hidden="true">
              <div className="meta-compare-pane is-bad">
                <div className="meta-compare-kicker is-bad">
                  <span className="meta-compare-ico"><IconX /></span>
                  Manual process
                </div>
                <p className="meta-compare-note">Prone to errors. Risky for your business.</p>
                <div className="meta-wa-card">
                  <div className="meta-wa-label">
                    Typical reply today
                    <span className="meta-wa-icon"><IconWhatsApp /></span>
                  </div>
                  <pre>{`Sir please check our rates below —

1) 2" valve 12 nos = 48000
2) flange 4 inch 8 nos ~ 18400
3) packing + transport 3500

GST extra · delivery 7-10 days
pls confirm`}</pre>
                </div>
              </div>

              <div className="meta-compare-arrow">
                <span>→</span>
              </div>

              <div className="meta-compare-pane is-good">
                <div className="meta-compare-kicker is-good">
                  <span className="meta-compare-ico"><IconCheck /></span>
                  With QuoteGen
                </div>
                <p className="meta-compare-note">Accurate calculations. Professional quotations. Assured profits.</p>
                <article className="meta-quote-doc">
                  <header className="meta-quote-doc-head">
                    <div>
                      <strong>Apex Industrial Co.</strong>
                      <p>Precision Engineering · Industrial Solutions</p>
                      <p>Plot 42, MIDC Industrial Area, Ahmedabad 380015, India</p>
                    </div>
                    <div className="meta-quote-doc-meta">
                      <em>QUOTATION</em>
                      <span>QTN/2026-00001</span>
                      <small>Date: 06/12/2026</small>
                      <small>Valid Until: 27/06/2026</small>
                    </div>
                  </header>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item</th>
                        <th>Description</th>
                        <th>MOC</th>
                        <th>Qty</th>
                        <th>Unit</th>
                        <th>Rate (₹)</th>
                        <th>Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>1</td>
                        <td>FRP Pump</td>
                        <td>5 HP, Horizontal</td>
                        <td>FRP</td>
                        <td>2</td>
                        <td>Nos</td>
                        <td>35,000.00</td>
                        <td>70,000.00</td>
                      </tr>
                      <tr>
                        <td>2</td>
                        <td>Butterfly Valve</td>
                        <td>4&quot;, PN16</td>
                        <td>CI</td>
                        <td>4</td>
                        <td>Nos</td>
                        <td>5,000.00</td>
                        <td>20,000.00</td>
                      </tr>
                      <tr>
                        <td>3</td>
                        <td>SS Pipe</td>
                        <td>Schedule 40</td>
                        <td>SS304</td>
                        <td>10</td>
                        <td>Mtr</td>
                        <td>1,200.00</td>
                        <td>12,000.00</td>
                      </tr>
                    </tbody>
                  </table>
                  <footer className="meta-quote-doc-totals">
                    <div><span>Subtotal</span><strong>₹1,02,000.00</strong></div>
                    <div><span>Tax (18%)</span><strong>₹18,360.00</strong></div>
                    <div className="is-grand"><span>Grand Total</span><strong>₹1,20,360.00</strong></div>
                  </footer>
                </article>
              </div>
            </div>
          </div>
        </div>

        <div className="meta-shell meta-outcome-v2">
          <div className="meta-outcome-cta">
            <p className="meta-outcome-impact">
              Create professional looking quotations in{' '}
              <span className="meta-hand-underline">
                less than a minute
                <svg className="meta-hand-stroke" viewBox="0 0 200 18" preserveAspectRatio="none" aria-hidden="true">
                  <path
                    d="M4 5.8 L196 4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M6 12.8 L194 11.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </p>
            <button
              type="button"
              className="meta-btn meta-btn-primary meta-btn-lg"
              onClick={goToForm}
              style={CTA_STYLE}
            >
              <DemoCtaLabel />
            </button>
            <p>No credit card required · Free to try</p>
          </div>
        </div>
      </section>

      <section className="meta-section" id="why">
        <div className="meta-shell meta-shell-center">
          <h2>Why 214+ businesses quote with QuoteGen</h2>
          <p className="meta-section-lead">
            Faster quotations win more deals. QuoteGen removes the formatting bottleneck so your team closes instead of typing.
          </p>
          <div className="meta-values">
            <div className="meta-value-row">
              <div className="meta-value-icon"><IconBolt /></div>
              <div>
                <h3>Reply before your competitors send their quote</h3>
                <p>Turn a fresh enquiry into a professional quotation while the buyer is still waiting — often in under 2 minutes.</p>
              </div>
            </div>
            <div className="meta-value-row">
              <div className="meta-value-icon"><IconClock /></div>
              <div>
                <h3>Spend less time drafting, more time closing</h3>
                <p>QuoteGen builds the first draft. You verify pricing, send, and move on to the next enquiry.</p>
              </div>
            </div>
            <div className="meta-value-row">
              <div className="meta-value-icon"><IconCheck /></div>
              <div>
                <h3>Look professional on every quotation you send</h3>
                <p>No more rough WhatsApp rate lists. Every reply looks like a proper business quotation.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="meta-impact-strip" aria-label="Closing statement">
        <div className="meta-shell meta-shell-center">
          <div className="meta-impact-logos" aria-hidden="true">
            <span className="meta-impact-icon meta-impact-icon-timer">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2.5 1.5" />
                <path d="M9 2h6" />
                <path d="M12 2v2.2" />
              </svg>
            </span>
            <img src={logoUrl} alt="" className="meta-impact-logo meta-impact-logo-b" />
            <span className="meta-impact-icon meta-impact-icon-check">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M8.2 12.2 10.8 14.8 15.8 9.4" />
              </svg>
            </span>
          </div>
          <p className="meta-impact-line">
            Faster Quotations → <span className="meta-impact-accent">More Enquiries</span> → Faster Growth
          </p>
        </div>
      </section>

      <section className="meta-impact">
        <div className="meta-shell">
          <p>
            Start your free trial below.
            <span>Turn your next enquiry into a professional quotation today.</span>
          </p>
        </div>
      </section>

      <div className="meta-form-wrap">
        <div className="meta-shell">
          <TrialForm formRef={formRef} autoFocusName={focusForm > 0} onNextStep={handleNextStep} initialLead={initialLead} />
        </div>
      </div>

      <footer className="meta-footer">
        <div className="meta-shell">
          <div>© {new Date().getFullYear()} QuoteGen by Digiteq Solution</div>
          {onSignIn && (
            <button type="button" className="meta-link" onClick={onSignIn}>Already have an account? Sign In</button>
          )}
        </div>
      </footer>
    </div>
  )
}
