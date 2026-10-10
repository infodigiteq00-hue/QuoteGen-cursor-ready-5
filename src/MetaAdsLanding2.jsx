import React, { useEffect, useRef, useState } from 'react'
import logoUrl from './assets/landing/quotegen-logo.png'
import { writeMetaAdsLead } from './metaTrialLead.js'
import { trackPixel } from './metaPixel.js'
import { indiaMobileInputValue, isValidIndiaMobile, normalizeIndiaMobileDigits } from '../shared/phone.js'
import { DEMO_HOWTO_PROCESS_CLIPS, DEMO_HOWTO_VIDEO_POSTER, DEMO_HOWTO_VIDEO_STREAM } from './DemoHowToVideo.jsx'
import './metaAdsLanding.css'
import './metaAdsLanding2.css'

const CTA_STYLE = { fontFamily: 'Archivo, Inter, system-ui, sans-serif', fontWeight: 800 }
const ENTRY_PRICE = 199
const ENTRY_QUOTES = 20
const WA_ADDON = 49
const OFFER_MS = 10 * 60 * 1000
const OFFER_KEY = 'qg_landing2_offer_started'
const SEAT_CAP = 100
const SEAT_FLOOR = 17
const INDUSTRY_OPTIONS = ['Manufacturing', 'Trading', 'Construction', 'Electrical', 'Engineering', 'Services', 'Other']
const QUOTE_VOLUME_OPTIONS = ['1–10', '10–40', '40–100', '100+']
const RECHARGE_PACKS = [
  { quotes: 25, price: 199, note: 'Light weeks' },
  { quotes: 100, price: 499, note: 'Busy months' },
  { quotes: 250, price: 999, note: 'Teams that quote daily' }
]

const IMPACT_BEATS = [
  {
    id: 'volume',
    soft: 'If you make',
    hard: '10–100+ quotations',
    softAfter: 'every month'
  },
  {
    id: 'deserve',
    soft: 'You deserve',
    hard: 'QuoteGen',
    brand: true
  },
  {
    id: 'future',
    soft: 'This is the future of',
    hard: 'AI Quotation Making'
  }
]

const TRUST_TICKER_LINES = [
  'Manufacturers quoting faster',
  'Rated 4.9 ★',
  'Pay as you go · no monthly lock-in',
  '10,000+ quotations drafted',
  'Recharge when you need more quotes',
  'Trading · Construction · Electrical',
  'From enquiry to PDF today'
]

const PROOF_STATS = [
  { value: '2,400+', label: 'Teams exploring QuoteGen' },
  { value: '4.9 ★', label: 'Early user rating' },
  { value: '48k+', label: 'Quotations drafted' },
  { value: '12k hrs', label: 'Quoting time saved' }
]

const PROOF_REVIEWS = [
  {
    quote: 'I paste the WhatsApp enquiry and the draft is ready before I finish my tea.',
    tip: 'Draft ready before tea finishes',
    name: 'Plant owner',
    role: 'Trading firm — Pune'
  },
  {
    quote: 'Our team stopped fighting Excel formats. Clients get a clean PDF the same day.',
    tip: 'Clean PDF same day — no Excel fight',
    name: 'Sales lead',
    role: 'Electrical supplies — Ahmedabad'
  },
  {
    quote: 'First quote took minutes with someone walking us through it on the call.',
    tip: 'First quote in minutes on a call',
    name: 'Operations',
    role: 'Fabrication shop — Jaipur'
  }
]

/** Step-by-step demo tutorial — same walkthrough MP4, Indian-English coaching copy. */
const TUTORIAL_STEPS = [
  {
    id: 'paste',
    title: 'Step 1 · Paste the enquiry',
    coach: 'Customer ne WhatsApp pe rate maanga? Bas copy karo aur QuoteGen mein paste karo. Messy notes bhi chalenge.',
    tip: 'Email, chat, ya phone pe likha — sab chalega.',
    start: DEMO_HOWTO_PROCESS_CLIPS[0].start,
    end: DEMO_HOWTO_PROCESS_CLIPS[0].end
  },
  {
    id: 'check',
    title: 'Step 2 · Check line items',
    coach: 'QuoteGen khud description, qty, rate nikaal ke table bana deta hai. Aap bas verify karo — galat ho to edit kar do.',
    tip: 'Amount aur GST yahin pe clear dikhega.',
    start: DEMO_HOWTO_PROCESS_CLIPS[1].start,
    end: DEMO_HOWTO_PROCESS_CLIPS[1].end
  },
  {
    id: 'send',
    title: 'Step 3 · Pick layout & send',
    coach: 'Apna brand layout choose karo, PDF ready. Client ko WhatsApp ya email pe bhej do — same day.',
    tip: 'Pehli quotation ke baad flow yaad ho jaata hai.',
    start: DEMO_HOWTO_PROCESS_CLIPS[2].start,
    end: DEMO_HOWTO_PROCESS_CLIPS[2].end
  }
]

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function readOfferStart() {
  try {
    const at = Number(localStorage.getItem(OFFER_KEY))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

function writeOfferStart(at) {
  try { localStorage.setItem(OFFER_KEY, String(at)) } catch { /* private mode */ }
}

function seatsLeftFrom(startedAt) {
  if (!startedAt) return 53
  const elapsed = Date.now() - startedAt
  const drop = Math.min(36, Math.floor(elapsed / (OFFER_MS / 36)))
  return Math.max(SEAT_FLOOR, 53 - drop)
}

function IndustryField({ value, onChange, id = 'meta2-industry' }) {
  const [open, setOpen] = useState(false)
  const q = String(value || '').trim().toLowerCase()
  const matches = INDUSTRY_OPTIONS.filter((option) => !q || option.toLowerCase().includes(q))
  const shown = open && matches.length > 0

  return (
    <div className="meta-suggest">
      <input
        id={id}
        name="industry"
        autoComplete="off"
        value={value}
        placeholder="Start typing, e.g. Trading"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {shown ? (
        <ul className="meta-suggest-list" role="listbox">
          {matches.map((option) => (
            <li key={option} role="option">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(option); setOpen(false) }}>
                {option}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function TrustTicker() {
  const loop = [...TRUST_TICKER_LINES, ...TRUST_TICKER_LINES]
  return (
    <div className="m2-ticker" aria-label="Social proof highlights">
      <div className="m2-ticker-track">
        {loop.map((line, i) => (
          <span key={`${line}-${i}`} className="m2-ticker-item">
            {line}
            <em aria-hidden="true">·</em>
          </span>
        ))}
      </div>
    </div>
  )
}

function ProofStats() {
  return (
    <section className="m2-proof-strip" aria-label="Proof before you pay">
      <div className="m2-shell m2-proof-strip-inner">
        <header className="m2-proof-strip-head">
          <p className="m2-eyebrow">Proof before you pay</p>
          <h2>Built for teams who quote every day</h2>
        </header>
        <div className="m2-proof-stats" aria-label="Illustrative stats">
          {PROOF_STATS.map((s) => (
            <div key={s.label} className="m2-proof-stat">
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        <p className="m2-proof-note">Illustrative until launch — sample, not audited metrics.</p>
      </div>
    </section>
  )
}

/** Kinetic typography — short scroll, high impact, no sticky trap. */
function ImpactType() {
  const rootRef = useRef(null)
  const [visible, setVisible] = useState({})

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const nodes = root.querySelectorAll('[data-impact-beat]')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduce) {
      const all = {}
      IMPACT_BEATS.forEach((b) => { all[b.id] = true })
      setVisible(all)
      return undefined
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const id = entry.target.getAttribute('data-impact-beat')
          if (!id) return
          setVisible((prev) => (prev[id] ? prev : { ...prev, [id]: true }))
        })
      },
      { threshold: 0.35, rootMargin: '0px 0px -8% 0px' }
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const rect = root.getBoundingClientRect()
        const view = window.innerHeight || 1
        const p = Math.min(1, Math.max(0, (view - rect.top) / (view + rect.height)))
        root.style.setProperty('--m2-impact-p', String(p))
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <section className="m2-impact" ref={rootRef} aria-label="Why QuoteGen">
      <div className="m2-impact-orb" aria-hidden="true" />
      <div className="m2-shell m2-impact-stack">
        {IMPACT_BEATS.map((beat, i) => (
          <p
            key={beat.id}
            data-impact-beat={beat.id}
            className={`m2-impact-beat is-${i + 1}${visible[beat.id] ? ' is-in' : ''}`}
          >
            {beat.soft ? <span className="m2-impact-soft">{beat.soft}</span> : null}
            <strong className={beat.brand ? 'm2-impact-brand' : 'm2-impact-hard'}>{beat.hard}</strong>
            {beat.softAfter ? <span className="m2-impact-soft">{beat.softAfter}</span> : null}
          </p>
        ))}
      </div>
    </section>
  )
}

function GuidedTutorial() {
  const videoRef = useRef(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const step = TUTORIAL_STEPS[stepIndex] || TUTORIAL_STEPS[0]
  const stepIndexRef = useRef(0)
  const playStepRef = useRef(() => {})
  const advanceTimerRef = useRef(0)

  const clearAdvance = () => {
    window.clearTimeout(advanceTimerRef.current)
    advanceTimerRef.current = 0
  }

  const pauseVideo = () => {
    clearAdvance()
    const video = videoRef.current
    if (!video) return
    video.pause()
    setPlaying(false)
  }

  const playStep = (index, { resume = false, auto = false } = {}) => {
    const next = TUTORIAL_STEPS[index]
    if (!next) return
    clearAdvance()
    stepIndexRef.current = index
    setStepIndex(index)
    const video = videoRef.current
    if (!video) return
    const start = () => {
      const t = video.currentTime
      const canResume = resume && t > next.start + 0.05 && t < next.end - 0.12
      if (!canResume) {
        try { video.currentTime = next.start } catch { /* ignore */ }
      }
      if (auto) video.muted = true
      video.play()
        .then(() => setPlaying(true))
        .catch(() => {
          if (!auto) {
            setPlaying(false)
            return
          }
          video.muted = true
          video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
        })
    }
    if (video.readyState >= 1) start()
    else {
      const onMeta = () => {
        video.removeEventListener('loadedmetadata', onMeta)
        start()
      }
      video.addEventListener('loadedmetadata', onMeta)
      video.load()
    }
  }
  playStepRef.current = playStep

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const onTime = () => {
      const cur = TUTORIAL_STEPS[stepIndexRef.current]
      if (!cur || video.paused) return
      if (video.currentTime >= cur.end - 0.08) {
        video.pause()
        try { video.currentTime = cur.end } catch { /* ignore */ }
        setPlaying(false)
        const next = stepIndexRef.current + 1
        if (next < TUTORIAL_STEPS.length) {
          clearAdvance()
          const keepMuted = Boolean(video.muted)
          advanceTimerRef.current = window.setTimeout(
            () => playStepRef.current(next, { auto: keepMuted }),
            420
          )
        }
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      clearAdvance()
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    let started = false
    const tryAutoplay = () => {
      if (started) return
      started = true
      playStepRef.current(0, { auto: true })
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.35)) {
          tryAutoplay()
          io.disconnect()
        }
      },
      { threshold: [0.35] }
    )
    io.observe(video)
    return () => io.disconnect()
  }, [])

  return (
    <section className="m2-howto" aria-label="How QuoteGen works">
      <div className="m2-shell m2-howto-inner">
        <p className="m2-eyebrow">How it works</p>
        <div className="m2-tutorial">
          <header className="m2-tutorial-head">
            <h2>Simple guide — how to use QuoteGen</h2>
            <p className="m2-proof-lead m2-proof-lead-sm">
              Demo users ke liye seedha walkthrough: paste karo, check karo, bhej do. Har step pe thoda coaching.
            </p>
          </header>

          <div className="m2-tutorial-layout">
            <div className="m2-tutorial-player">
              <video
                ref={videoRef}
                className="m2-tutorial-video"
                src={DEMO_HOWTO_VIDEO_STREAM}
                poster={DEMO_HOWTO_VIDEO_POSTER}
                playsInline
                preload="auto"
                controls={false}
                aria-label={step.title}
              />
              {playing ? (
                <button
                  type="button"
                  className="m2-tutorial-pause"
                  onClick={pauseVideo}
                  aria-label="Pause video"
                >
                  <span aria-hidden="true">❚❚</span>
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="m2-tutorial-play"
                  onClick={() => {
                    const video = videoRef.current
                    if (video) video.muted = false
                    playStep(stepIndex, { resume: true })
                  }}
                  aria-label="Play this step"
                >
                  <span aria-hidden="true">▶</span>
                  Watch this step
                </button>
              )}
              <p className="m2-tutorial-caption" aria-live="polite">
                <strong>{step.title}</strong>
                <span>{step.coach}</span>
              </p>
            </div>

            <ol className="m2-tutorial-steps">
              {TUTORIAL_STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`m2-tutorial-step${i === stepIndex ? ' is-on' : ''}`}
                    onClick={() => {
                      const video = videoRef.current
                      if (video) video.muted = false
                      playStep(i)
                    }}
                    aria-current={i === stepIndex ? 'step' : undefined}
                  >
                    <em>{String(i + 1).padStart(2, '0')}</em>
                    <span>
                      <strong>{s.title.replace(/^Step \d+ · /, '')}</strong>
                      <small>{s.tip}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  )
}

function ReviewsSection() {
  return (
    <section className="m2-reviews" aria-label="Early user reviews">
      <div className="m2-shell m2-reviews-inner">
        <h3>What early users say</h3>
        <p className="m2-proof-note m2-proof-note-inline">Sample — real stories coming soon</p>
        <ul className="m2-review-tips" aria-label="Quick feedback">
          {PROOF_REVIEWS.map((r) => (
            <li key={`tip-${r.role}`}>
              <strong>{r.tip}</strong>
              <span>{r.role}</span>
            </li>
          ))}
        </ul>
        <div className="m2-proof-review-grid">
          {PROOF_REVIEWS.map((r) => (
            <blockquote key={r.role} className="m2-proof-review">
              <p>“{r.quote}”</p>
              <footer>
                <strong>{r.name}</strong>
                <span>{r.role}</span>
              </footer>
            </blockquote>
          ))}
        </div>
      </div>
    </section>
  )
}

function PayAsYouGoSection({ onStart }) {
  return (
    <section className="m2-paygo" aria-label="Pay as you go">
      <div className="m2-shell m2-paygo-inner">
        <header className="m2-paygo-head">
          <p className="m2-paygo-eyebrow">No fixed subscription</p>
          <h2>Recharge as you quote</h2>
          <p>
            Start with {ENTRY_QUOTES} quotations. When you need more, top up for the volume you use —
            this week, this month, or whenever enquiry traffic picks up.
          </p>
        </header>
        <div className="m2-paygo-grid">
          <article className="m2-paygo-start">
            <span>Entry</span>
            <strong>₹{ENTRY_PRICE}</strong>
            <em>{ENTRY_QUOTES} quotations to start</em>
            <button type="button" className="meta-btn meta-btn-primary" style={CTA_STYLE} onClick={onStart}>
              Pay ₹{ENTRY_PRICE} &amp; start
            </button>
          </article>
          <div className="m2-paygo-packs" aria-label="Recharge packs">
            {RECHARGE_PACKS.map((pack) => (
              <div key={pack.quotes} className="m2-paygo-pack">
                <strong>+{pack.quotes}</strong>
                <span>quotations</span>
                <b>₹{pack.price.toLocaleString('en-IN')}</b>
                <em>{pack.note}</em>
              </div>
            ))}
          </div>
        </div>
        <ul className="m2-paygo-points">
          <li>No monthly plan to cancel</li>
          <li>Top up only when you need quotes</li>
          <li>Quiet weeks cost you nothing extra</li>
        </ul>
      </div>
    </section>
  )
}

function FinaleSection({ entryForm, seats, offerLive, offerLeft }) {
  return (
    <section className="m2-finale-section" aria-label="Start QuoteGen">
      <div className="m2-demo-finale m2-shell">
        <div className="m2-demo-finale-copy">
          <p className="m2-demo-close m2-demo-close-xl">
            <span className="m2-demo-close-soft">Just verify your pricing and send to clients.</span>
            <strong>Leave the rest on Quote<span className="m2-gen">Gen</span>.</strong>
          </p>
          <p className="m2-finale-meta">
            <strong>₹{ENTRY_PRICE}</strong>
            <span>· {ENTRY_QUOTES} quotes to start</span>
            <span aria-hidden="true">·</span>
            <span>then recharge as you go</span>
            <span aria-hidden="true">·</span>
            <span>{seats} seats left</span>
            {offerLive ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Ends in {formatCountdown(offerLeft)}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="m2-demo-finale-form" id="entry-form">
          {entryForm}
        </div>
      </div>
    </section>
  )
}

export default function MetaAdsLanding2({ onSignIn }) {
  const formRef = useRef(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [quoteBand, setQuoteBand] = useState('')
  const [quoteExact, setQuoteExact] = useState('')
  const [industry, setIndustry] = useState('')
  const [whatsappAddon, setWhatsappAddon] = useState(false)
  const [waPhone, setWaPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [offerStartedAt, setOfferStartedAt] = useState(readOfferStart)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!offerStartedAt) {
      const at = Date.now()
      writeOfferStart(at)
      setOfferStartedAt(at)
    }
  }, [offerStartedAt])

  useEffect(() => {
    if (!offerStartedAt) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [offerStartedAt])

  useEffect(() => {
    // PageView fires from initMetaPixel() in adsShell; ViewContent marks this offer page.
    trackPixel('ViewContent', {
      content_name: 'QuoteGen landing2',
      content_category: 'meta_ads_landing2',
      value: ENTRY_PRICE,
      currency: 'INR'
    })
  }, [])

  const offerLeft = offerStartedAt ? offerStartedAt + OFFER_MS - now : OFFER_MS
  const offerLive = offerLeft > 0
  // Landing2 entry stays ₹199 — then recharge / pay as you go.
  const total = ENTRY_PRICE + (whatsappAddon ? WA_ADDON : 0)
  const seats = seatsLeftFrom(offerStartedAt)

  const fireInitiateCheckout = (value = ENTRY_PRICE, contentName = 'QuoteGen landing2 entry') => {
    trackPixel('InitiateCheckout', {
      value,
      currency: 'INR',
      content_name: contentName,
      content_ids: ['landing2'],
      num_items: 1
    })
  }

  const openForm = () => {
    fireInitiateCheckout(ENTRY_PRICE, 'QuoteGen landing2 entry')
    const el = document.getElementById('entry-form')
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  }

  const pay = async (e) => {
    e.preventDefault()
    if (busy) return
    setError('')
    const n = name.trim()
    const p = normalizeIndiaMobileDigits(phone)
    const em = email.trim().toLowerCase()
    const exact = quoteExact.trim()
    const quotes = quoteBand === '100+' ? exact : quoteBand.trim()
    const trade = industry.trim()
    const wa = whatsappAddon ? normalizeIndiaMobileDigits(waPhone || phone) : ''

    if (!n) return setError('Please enter your name.')
    if (!isValidIndiaMobile(p)) return setError('Enter a valid 10-digit mobile number.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return setError('Enter a valid email address.')
    if (!quoteBand) return setError('Select how many quotations you make in a month.')
    if (quoteBand === '100+') {
      const nQuotes = Number(exact)
      if (!exact || !Number.isFinite(nQuotes) || nQuotes < 100) {
        return setError('Enter how many quotations you make (100 or more).')
      }
    }
    if (!trade) return setError('Enter your industry.')
    if (whatsappAddon && !isValidIndiaMobile(wa)) return setError('Enter a valid WhatsApp number for the add-on.')

    const contentName = whatsappAddon ? 'QuoteGen landing2 + WhatsApp' : 'QuoteGen landing2 entry'
    fireInitiateCheckout(total, contentName)

    const payload = {
      name: n,
      phone: p,
      whatsappSame: !whatsappAddon || wa === p,
      whatsapp: whatsappAddon ? wa : p,
      email: em,
      company: company.trim(),
      monthlyQuotes: quotes,
      industry: trade,
      source: 'meta_ads_landing2',
      path: '/metaadslanding2',
      query: typeof window !== 'undefined' ? window.location.search : '',
      submittedAt: new Date().toISOString(),
      submitted: true,
      landing2: true,
      whatsappAddon: Boolean(whatsappAddon)
    }

    setBusy(true)
    try {
      const leadRes = await fetch('/api/meta-ads-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const leadData = await leadRes.json().catch(() => ({}))
      if (!leadRes.ok) throw new Error(leadData.error || 'Could not save your details.')

      writeMetaAdsLead({ ...payload, id: leadData.id || null, verified: true })
      trackPixel('Lead', { content_name: 'QuoteGen landing2' }, { once: leadData.id || em })

      const product = whatsappAddon ? 'landing2_wa' : 'landing2'
      const payRes = await fetch('/api/pay/phonepe/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product,
          offerStartedAt,
          name: n,
          company: company.trim(),
          phone: whatsappAddon ? wa : p,
          email: em
        })
      })
      const payData = await payRes.json().catch(() => ({}))
      if (payRes.ok && payData?.redirectUrl) {
        try {
          sessionStorage.setItem('qg_pixel_purchase', JSON.stringify({
            value: total,
            content_name: contentName,
            product
          }))
        } catch { /* private mode */ }
        window.location.assign(payData.redirectUrl)
        return
      }
      throw new Error(payData.error || 'Could not open PhonePe. Please try again.')
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="meta-ads meta-ads-2">
      <header className="meta-header m2-header">
        <div className="meta-shell meta-header-inner">
          <div className="meta-brand">
            <img src={logoUrl} alt="" />
            <div className="meta-brand-stack">
              <span className="meta-brand-name">QuoteGen</span>
              <span className="meta-brand-sub">THE FUTURE OF QUOTING</span>
            </div>
          </div>
          <div className="meta-header-actions">
            {onSignIn ? (
              <button type="button" className="meta-btn meta-btn-signin" onClick={onSignIn}>Sign in</button>
            ) : null}
            <button type="button" className="meta-btn meta-btn-primary meta-btn-header" style={CTA_STYLE} onClick={openForm}>
              Join @ ₹{ENTRY_PRICE}
            </button>
          </div>
        </div>
      </header>

      <section className="m2-hero">
        <div className="m2-hero-bg" aria-hidden="true" />
        <div className="m2-shell m2-hero-inner">
          <p className="m2-hero-brand">Quote<span className="m2-gen">Gen</span></p>
          <p className="m2-hero-badge">214+ businesses already quoting faster</p>
          <h1 className="m2-hero-title">
            <span className="m2-hero-title-desk">
              Turn any WhatsApp enquiry into a
              <br />
              <span>Professional Quotation</span>
              {' '}in 2 minutes
            </span>
            <span className="m2-hero-title-mob">
              WhatsApp enquiry →
              {' '}
              <span>Professional Quotation</span>
              {' '}in 2 min
            </span>
          </h1>
          <p className="m2-hero-lead">
            <span className="m2-hero-lead-desk">
              Paste the enquiry. Verify the numbers. Send a clean PDF —
              while the buyer is still waiting.
            </span>
            <span className="m2-hero-lead-mob">
              Paste · verify · send PDF before the competitor is ready.
            </span>
          </p>

          <div className="m2-hero-offer">
            <div className="m2-hero-offer-price">
              <strong>₹{ENTRY_PRICE}</strong>
              <em>{ENTRY_QUOTES} quotations to start · then recharge as you go</em>
            </div>
            <button
              type="button"
              className="meta-btn meta-btn-primary meta-btn-lg m2-hero-cta"
              onClick={openForm}
              style={CTA_STYLE}
            >
              Pay ₹{ENTRY_PRICE} &amp; start QuoteGen
            </button>
            <ol className="m2-hero-steps" aria-label="What happens next">
              <li><b>1</b><span>Enter details</span></li>
              <li><b>2</b><span>Pay on PhonePe</span></li>
              <li><b>3</b><span>You’re in</span></li>
            </ol>
            <p className="m2-hero-fine" aria-live="polite">
              No monthly lock-in
              <span aria-hidden="true"> · </span>
              <b>{seats}</b> seats left
              {offerLive ? (
                <>
                  <span aria-hidden="true"> · </span>
                  Ends in <b>{formatCountdown(offerLeft)}</b>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </section>

      <TrustTicker />
      <ProofStats />
      <ImpactType />
      <GuidedTutorial />
      <PayAsYouGoSection onStart={openForm} />
      <ReviewsSection />
      <FinaleSection
        seats={seats}
        offerLive={offerLive}
        offerLeft={offerLeft}
        entryForm={(
          <form className="meta-form-card meta2-form m2-finale-form-card" ref={formRef} onSubmit={pay}>
            <header className="m2-finale-form-head">
              <h2>Start Quote<span className="m2-gen">Gen</span></h2>
              <p className="meta-form-lead">
                <strong className="m2-price-pop">₹{ENTRY_PRICE}</strong>
                {' '}unlocks {ENTRY_QUOTES} quotations. Recharge later — no subscription.
              </p>
            </header>

            <div className="meta-fields m2-finale-fields">
              <div className="meta-field m2-field-span">
                <label htmlFor="meta2-name">Your name</label>
                <input id="meta2-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" autoComplete="name" />
              </div>
              <div className="meta-field">
                <label htmlFor="meta2-phone">Mobile</label>
                <div className="meta-phone-field">
                  <div className="meta-phone-prefix">+91</div>
                  <input
                    id="meta2-phone"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(indiaMobileInputValue(e.target.value))}
                    placeholder="9876543210"
                    maxLength={16}
                    autoComplete="tel-national"
                  />
                </div>
              </div>
              <div className="meta-field">
                <label htmlFor="meta2-email">Work email</label>
                <input id="meta2-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
              </div>
              <div className="meta-field m2-field-span">
                <label htmlFor="meta2-company">Company <span>(optional)</span></label>
                <input id="meta2-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Your business name" autoComplete="organization" />
              </div>
              <div className="meta-field m2-field-span">
                <label htmlFor="meta2-industry">Industry</label>
                <IndustryField value={industry} onChange={setIndustry} />
              </div>
              <div className="meta-field m2-field-span">
                <label id="meta2-monthly-label">Quotes / month</label>
                <div className="m2-chip-row" role="group" aria-labelledby="meta2-monthly-label">
                  {QUOTE_VOLUME_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`m2-chip${quoteBand === option ? ' is-on' : ''}`}
                      aria-pressed={quoteBand === option}
                      onClick={() => {
                        setQuoteBand(option)
                        if (option !== '100+') setQuoteExact('')
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                {quoteBand === '100+' ? (
                  <input
                    id="meta2-monthly"
                    className="m2-quote-exact"
                    inputMode="numeric"
                    value={quoteExact}
                    onChange={(e) => setQuoteExact(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                    placeholder="e.g. 150"
                    aria-label="Exact quotations per month"
                    autoFocus
                  />
                ) : null}
              </div>
            </div>

            <div className={`meta2-addon${whatsappAddon ? ' is-on' : ''}`}>
              <button
                type="button"
                className="meta2-addon-toggle"
                aria-pressed={whatsappAddon}
                onClick={() => setWhatsappAddon((v) => !v)}
              >
                <span>
                  <strong>WhatsApp quoting</strong>
                  <em>Connect QuoteGen to WhatsApp — enquiry to quote in chat. No second app. (+ ₹{WA_ADDON})</em>
                </span>
                <b>{whatsappAddon ? 'Added' : `+ ₹${WA_ADDON}`}</b>
              </button>
              {whatsappAddon ? (
                <div className="meta-field meta2-addon-phone">
                  <label htmlFor="meta2-wa">WhatsApp number</label>
                  <div className="meta-phone-field">
                    <div className="meta-phone-prefix">+91</div>
                    <input
                      id="meta2-wa"
                      inputMode="numeric"
                      value={waPhone}
                      onChange={(e) => setWaPhone(indiaMobileInputValue(e.target.value))}
                      placeholder={phone || '9876543210'}
                      maxLength={16}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {error ? <p className="meta-form-error" role="alert">{error}</p> : null}

            <button type="submit" className="meta-btn meta-btn-primary meta-btn-lg m2-finale-cta" style={CTA_STYLE} disabled={busy}>
              {busy ? 'Opening PhonePe…' : `Pay ₹${total} & start`}
            </button>
            <p className="meta-form-fine">
              PhonePe · Recharge anytime · No monthly plan
              {whatsappAddon ? ` · WA +₹${WA_ADDON}` : ''}
              {' · '}
              <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
            </p>
          </form>
        )}
      />

      <footer className="m2-closure">
        <div className="m2-shell m2-closure-inner">
          <div className="m2-closure-brand">
            <img src={logoUrl} alt="" />
            <div>
              <strong>QuoteGen</strong>
              <span>RECHARGE · QUOTE · SEND</span>
            </div>
          </div>
          <p className="m2-closure-tagline">
            Pay for quotations — not for months you don’t use.
          </p>
          <p className="m2-closure-query">Got a query? We’re one call away.</p>
          <div className="m2-closure-actions">
            <a className="m2-closure-call" href="tel:+919067610118">
              Call 9067610118
            </a>
            <a
              className="m2-closure-wa"
              href="https://wa.me/919067610118"
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp us
            </a>
          </div>
          <p className="m2-closure-credit">
            Built for Indian manufacturers, traders &amp; contractors who quote every day.
          </p>
          <p className="m2-closure-legal">
            <a href="/privacy">Privacy</a>
            <span aria-hidden="true">·</span>
            <a href="/terms">Terms</a>
            <span aria-hidden="true">·</span>
            <span>© {new Date().getFullYear()} QuoteGen</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
