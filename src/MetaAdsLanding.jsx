import React, { useEffect, useRef, useState } from 'react'
import logoUrl from './assets/landing/quotegen-logo.png'
import { META_ADS_LEAD_KEY as LEAD_KEY, readMetaAdsLead, writeMetaAdsLead, writeMetaTrialIntent, clearMetaTrialIntent, clearMetaWelcome, recordMetaLeadProgress } from './metaTrialLead.js'
import { trackPixel } from './metaPixel.js'
import { whatsappChatsLink } from './whatsappEnquiry.js'
import { indiaMobileInputValue, isValidIndiaMobile, normalizeIndiaMobileDigits } from '../shared/phone.js'
import { trialWhatsappHref } from '../shared/trialWhatsapp.js'
import './metaAdsLanding.css'

const CTA_STYLE = { fontFamily: 'Archivo, Inter, system-ui, sans-serif', fontWeight: 400 }

const INDUSTRY_OPTIONS = ['Manufacturing', 'Trading', 'Construction', 'Electrical', 'Engineering', 'Services', 'Other']

function editDistance(a, b) {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i < rows; i += 1) dp[i][0] = i
  for (let j = 0; j < cols; j += 1) dp[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[a.length][b.length]
}

function rankIndustries(query) {
  const q = String(query || '').trim().toLowerCase()
  const scored = INDUSTRY_OPTIONS.map((option) => {
    const name = option.toLowerCase()
    if (!q) return { option, score: 1 }
    if (name === q) return { option, score: 100 }
    if (name.startsWith(q) || q.startsWith(name)) return { option, score: 80 }
    if (name.includes(q) || q.includes(name)) return { option, score: 60 }
    const dist = editDistance(q, name)
    const similarity = 1 - dist / Math.max(q.length, name.length)
    return { option, score: similarity >= 0.45 ? Math.round(similarity * 40) : 0 }
  })
  return scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score).map((row) => row.option)
}

function IndustryField({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const matches = rankIndustries(value)
  const shown = open && matches.length > 0

  const choose = (option) => {
    onChange(option)
    setOpen(false)
  }

  return (
    <div className="meta-suggest">
      <input
        id="meta-industry"
        name="industry"
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-autocomplete="list"
        aria-controls="meta-industry-list"
        value={value}
        placeholder="Start typing, e.g. Trading"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => {
          setOpen(true)
          setActive(0)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!matches.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((index) => Math.min(index + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            setActive((index) => Math.max(index - 1, 0))
          } else if (e.key === 'Escape') {
            setOpen(false)
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault()
            choose(matches[active])
          }
        }}
      />
      {shown && (
        <ul id="meta-industry-list" role="listbox" className="meta-suggest-list">
          {matches.map((option, index) => (
            <li key={option} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={index === active ? 'is-active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

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

function IconWhatsApp({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function NextChoices({ lead, onNextStep }) {
  const whatsapp = whatsappChatsLink()
  return (
    <div className="meta-form-card meta-form-card-next">
      <p className="meta-next-kicker">You’re in</p>
      <h2>How would you like to go further?</h2>
      <div className="meta-next-actions">
        <button
          type="button"
          className="meta-next-tile is-primary"
          style={CTA_STYLE}
          onClick={() => onNextStep?.('demo', lead)}
        >
          <span className="meta-next-tile-copy">
            <strong>Create a demo quotation</strong>
            <em>Ready in about 2 minutes</em>
          </span>
          <span className="meta-next-tile-go" aria-hidden="true">→</span>
        </button>
        <a
          className="meta-next-tile"
          href={whatsapp.href}
          target={whatsapp.external ? '_blank' : undefined}
          rel={whatsapp.external ? 'noopener noreferrer' : undefined}
        >
          <span className="meta-next-tile-copy">
            <strong>Open WhatsApp</strong>
            <em>Copy a client enquiry from a chat</em>
          </span>
          <span className="meta-next-tile-go is-wa" aria-hidden="true"><IconWhatsApp size={22} /></span>
        </a>
      </div>
      <p className="meta-form-fine">No card needed</p>
    </div>
  )
}

function VerifiedArrival({ saving, saveError, onRetrySave, onSignIn }) {
  let body = null
  if (saving) {
    body = (
      <div className="meta-form-card meta-form-card-next">
        <p className="meta-next-kicker">Great, your enquiry is submitted</p>
        <h2>Confirming your email…</h2>
      </div>
    )
  } else if (saveError) {
    body = (
      <div className="meta-form-card meta-form-card-next">
        <p className="meta-next-kicker">Great, your enquiry is submitted</p>
        <h2>We couldn’t save your details.</h2>
        <p className="meta-form-lead">{saveError}</p>
        <button type="button" className="meta-btn meta-btn-primary meta-btn-lg" style={CTA_STYLE} onClick={onRetrySave}>
          Try again
        </button>
      </div>
    )
  } else {
    body = (
      <div className="meta-form-card meta-form-card-next meta-success">
        <div className="meta-success-mark" aria-hidden="true">
          <span className="meta-success-dot" />
          <span className="meta-success-dot" />
          <span className="meta-success-dot" />
          <span className="meta-success-dot" />
          <span className="meta-success-dot" />
          <span className="meta-success-dot" />
          <svg className="meta-success-tick" viewBox="0 0 52 52">
            <circle className="meta-success-ring" cx="26" cy="26" r="23" />
            <path className="meta-success-check" d="M15 27.5l7.2 7.2L37.5 18" />
          </svg>
        </div>
        <p className="meta-next-kicker">You’re all set</p>
        <h2>Your account has been successfully set up.</h2>
        <p className="meta-form-lead">Let’s start with your first trial now.</p>
        <button
          type="button"
          className="meta-btn meta-btn-primary meta-btn-lg"
          style={CTA_STYLE}
          onClick={() => { window.location.assign(trialWhatsappHref()) }}
        >
          Start trial
        </button>
        <a
          className="meta-success-signin"
          href="/signin"
          onClick={(e) => {
            e.preventDefault()
            onSignIn?.()
          }}
        >
          Already have a password? Sign in
        </a>
      </div>
    )
  }

  return (
    <div className="meta-ads meta-verified">
      <div className="meta-form-wrap is-ready">
        <div className="meta-shell">{body}</div>
      </div>
    </div>
  )
}

function TrialForm({ formRef, autoFocusName, onNextStep, onSubmitted, onReadyChange, initialLead = null }) {
  const [name, setName] = useState(initialLead?.name || '')
  const [phone, setPhone] = useState(() => indiaMobileInputValue(initialLead?.phone || ''))
  const [whatsappSame, setWhatsappSame] = useState(initialLead?.whatsappSame !== false)
  const [whatsapp, setWhatsapp] = useState(() => indiaMobileInputValue(initialLead?.whatsapp || ''))
  const [email, setEmail] = useState(initialLead?.email || '')
  const [company, setCompany] = useState(initialLead?.company || '')
  const [monthlyQuotes, setMonthlyQuotes] = useState(initialLead?.monthlyQuotes || '')
  const [industry, setIndustry] = useState(initialLead?.industry || '')
  const [error, setError] = useState('')
  const [done, setDone] = useState(Boolean(initialLead))
  const [submitting, setSubmitting] = useState(false)
  const nameRef = useRef(null)

  useEffect(() => {
    if (autoFocusName) nameRef.current?.focus()
  }, [autoFocusName])

  useEffect(() => {
    onReadyChange?.(done)
  }, [done, onReadyChange])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const n = name.trim()
    const p = normalizeIndiaMobileDigits(phone)
    const em = email.trim().toLowerCase()
    if (!n) {
      setError('Please enter your name.')
      return
    }
    if (!isValidIndiaMobile(p)) {
      setError('Enter a valid 10-digit mobile number.')
      return
    }
    const wa = whatsappSame ? p : normalizeIndiaMobileDigits(whatsapp)
    if (!whatsappSame && !isValidIndiaMobile(wa)) {
      setError('Enter a valid 10-digit WhatsApp number.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError('Enter a valid email address.')
      return
    }
    const quotes = monthlyQuotes.trim()
    const trade = industry.trim()
    if (!quotes) {
      setError('Enter how many quotations you make in a month.')
      return
    }
    if (!trade) {
      setError('Enter your industry.')
      return
    }
    const payload = {
      name: n,
      phone: p,
      whatsappSame,
      whatsapp: wa,
      email: em,
      company: company.trim(),
      monthlyQuotes: quotes,
      industry: trade,
      source: 'meta_ads_landing',
      path: typeof window !== 'undefined' ? window.location.pathname : '',
      query: typeof window !== 'undefined' ? window.location.search : '',
      submittedAt: new Date().toISOString(),
      submitted: true
    }
    setSubmitting(true)
    try {
      writeMetaAdsLead({ ...payload, verified: false })
      onSubmitted?.(payload)
    } catch (err) {
      setError(err.message || 'Could not continue. Please try again.')
      setSubmitting(false)
    }
  }

  if (done) {
    const lead = { name, phone, email, company }
    return (
      <div ref={formRef} id="trial-form">
        <NextChoices lead={lead} onNextStep={onNextStep} />
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
              onChange={(e) => setPhone(indiaMobileInputValue(e.target.value))}
              placeholder="9876543210"
              maxLength={16}
            />
          </div>
          <label className="meta-whatsapp-same">
            <input
              type="checkbox"
              checked={whatsappSame}
              onChange={(e) => setWhatsappSame(e.target.checked)}
            />
            <span>Same as WhatsApp number</span>
          </label>
          {whatsappSame ? null : (
            <div className="meta-phone-field meta-whatsapp-field">
              <div className="meta-phone-prefix">+91</div>
              <input
                id="meta-whatsapp"
                name="whatsapp"
                inputMode="numeric"
                autoComplete="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(indiaMobileInputValue(e.target.value))}
                placeholder="WhatsApp number"
                maxLength={16}
                aria-label="WhatsApp number"
              />
            </div>
          )}
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
        <div className="meta-field">
          <label htmlFor="meta-monthly">How many quotations do you make in a month?</label>
          <input
            id="meta-monthly"
            name="monthlyQuotes"
            value={monthlyQuotes}
            onChange={(e) => setMonthlyQuotes(e.target.value)}
            placeholder="e.g. 40"
          />
        </div>
        <div className="meta-field">
          <label htmlFor="meta-industry">Which industry are you in?</label>
          <IndustryField value={industry} onChange={setIndustry} />
        </div>
      </div>
      {error && <p className="meta-form-error">{error}</p>}
      <button
        type="submit"
        className="meta-btn meta-btn-primary meta-btn-lg"
        style={CTA_STYLE}
        disabled={submitting}
      >
        {submitting ? 'Continuing…' : <DemoCtaLabel />}
      </button>
      <p className="meta-form-fine">
        No credit card required · Free to try
        <br />
        By continuing you agree to our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms of Service</a>.
      </p>
    </form>
  )
}

export default function MetaAdsLanding({ onSignIn, onContinueTrial, onStartVerify, initialLead = null, celebrate = false, saving = false, saveError = '', onRetrySave }) {
  const formRef = useRef(null)
  const [focusForm, setFocusForm] = useState(0)
  const [formReady, setFormReady] = useState(Boolean(initialLead))

  // Fresh visit / refresh of the ads landing should start on the empty form —
  // not restore the post-submit “You’re in” screen from a prior attempt.
  // A signed-in user coming Back from the trial guide lands on the choice card.
  useEffect(() => {
    if (celebrate) return
    if (initialLead) {
      document.getElementById('trial-form')?.scrollIntoView({ block: 'center' })
      return
    }
    try {
      sessionStorage.removeItem(LEAD_KEY)
      sessionStorage.removeItem('qg_meta_otp_sent')
    } catch { /* ignore */ }
    clearMetaTrialIntent()
  }, [celebrate, initialLead])

  useEffect(() => {
    const el = document.getElementById('trial-form')
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      trackPixel('ViewContent', { content_name: 'QuoteGen trial form' })
      observer.disconnect()
    }, { threshold: 0.5 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const goToForm = () => {
    setFocusForm((n) => n + 1)
    const el = document.getElementById('trial-form')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleNextStep = (choice, lead) => {
    const stored = readMetaAdsLead()
    const merged = {
      ...(stored || {}),
      ...(lead || {}),
      verified: Boolean(stored?.verified || lead?.verified),
      id: lead?.id || stored?.id || null
    }
    writeMetaTrialIntent(choice, merged)
    if (merged.email) writeMetaAdsLead(merged)
    recordMetaLeadProgress(choice === 'company' ? 'company' : 'demo', merged)
    // Leave the long landing URL so refresh / back doesn't dump them into the ads page again.
    // Signed-in users (initialLead) skip verify and go straight back into the app.
    try {
      if (!initialLead) window.history.pushState({}, '', '/trial-verify')
      window.scrollTo(0, 0)
    } catch { /* ignore */ }
    onContinueTrial?.(choice, merged)
  }

  const startVerify = (lead) => {
    clearMetaWelcome()
    writeMetaAdsLead({ ...lead, verified: false })
    try {
      window.history.pushState({}, '', '/trial-verify')
      window.scrollTo(0, 0)
    } catch { /* ignore */ }
    onStartVerify?.(lead)
  }

  if (celebrate) {
    return (
      <VerifiedArrival
        saving={saving}
        saveError={saveError}
        onRetrySave={onRetrySave}
        onSignIn={onSignIn}
      />
    )
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

      {!formReady && (
        <section className="meta-impact">
          <div className="meta-shell">
            <p>
              Start your free trial below.
              <span>Turn your next enquiry into a professional quotation today.</span>
            </p>
          </div>
        </section>
      )}

      <div className={`meta-form-wrap${formReady ? ' is-ready' : ''}`}>
        <div className="meta-shell">
          <TrialForm
            formRef={formRef}
            autoFocusName={focusForm > 0}
            onNextStep={handleNextStep}
            onSubmitted={startVerify}
            onReadyChange={setFormReady}
            initialLead={initialLead}
          />
        </div>
      </div>

      <footer className="meta-footer">
        <div className="meta-shell">
          <div>© {new Date().getFullYear()} QuoteGen by Digiteq Solution</div>
          <nav className="meta-footer-legal" aria-label="Legal">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="/refund">Refund Policy</a>
            <a href="/contact">Contact</a>
          </nav>
          {onSignIn && (
            <button type="button" className="meta-link" onClick={onSignIn}>Already have an account? Sign In</button>
          )}
        </div>
      </footer>
    </div>
  )
}
