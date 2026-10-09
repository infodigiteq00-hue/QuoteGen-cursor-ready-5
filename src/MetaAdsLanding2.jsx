import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import logoUrl from './assets/landing/quotegen-logo.png'
import { writeMetaAdsLead } from './metaTrialLead.js'
import { trackPixel } from './metaPixel.js'
import { indiaMobileInputValue, isValidIndiaMobile, normalizeIndiaMobileDigits } from '../shared/phone.js'
import { DEMO_HOWTO_PROCESS_CLIPS, DEMO_HOWTO_VIDEO_STREAM } from './DemoHowToVideo.jsx'
import './metaAdsLanding.css'
import './metaAdsLanding2.css'

const CTA_STYLE = { fontFamily: 'Archivo, Inter, system-ui, sans-serif', fontWeight: 800 }
const ENTRY_PRICE = 199
const LIST_PRICE = 1999
const WA_ADDON = 49
const OFFER_MS = 10 * 60 * 1000
const OFFER_KEY = 'qg_landing2_offer_started'
const SEAT_CAP = 100
const SEAT_FLOOR = 17
const INDUSTRY_OPTIONS = ['Manufacturing', 'Trading', 'Construction', 'Electrical', 'Engineering', 'Services', 'Other']

const MESSAGE_SLIDES = [
  {
    id: 'volume',
    lines: [
      { t: 'If you are', c: 'soft' },
      { t: 'making 10–100', c: 'big' },
      { t: 'quotations per month', c: 'big' },
      { t: 'or more', c: 'soft' }
    ]
  },
  {
    id: 'deserve',
    lines: [
      { t: 'You deserve', c: 'soft' },
      { t: 'QuoteGen', c: 'brand' }
    ]
  },
  {
    id: 'future',
    lines: [
      { t: 'This is the future', c: 'soft' },
      { t: 'of AI Quotation', c: 'big' },
      { t: 'Making', c: 'big' }
    ]
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

/** Apple-style: sticky scene driven by continuous scroll progress (0 → 1). */
function useScrollFilm(count) {
  const rootRef = useRef(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root || count < 1) return undefined
    let frame = 0
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    const tick = () => {
      frame = 0
      const rect = root.getBoundingClientRect()
      const total = Math.max(1, root.offsetHeight - window.innerHeight)
      const raw = Math.min(1, Math.max(0, -rect.top / total))
      setProgress(raw)
    }

    const onScroll = () => {
      if (reduce) {
        tick()
        return
      }
      if (!frame) frame = requestAnimationFrame(tick)
    }

    tick()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [count])

  // Equal dwell per slide; last slide holds until the section fully ends
  // so the next block does not start mid-beat.
  const segment = progress * count
  const float = Math.min(count - 1, segment)
  const active = Math.min(count - 1, Math.floor(Math.min(segment, count - 1e-4)))
  return { rootRef, progress, float, active }
}

function slideStyle(float, index, { punchy = false } = {}) {
  const d = float - index
  const abs = Math.abs(d)
  if (abs > 1.05) return { opacity: 0, visibility: 'hidden', pointerEvents: 'none' }
  const opacity = Math.max(0, 1 - abs * (punchy ? 1.35 : 1.15))
  const y = d * (punchy ? -72 : -48)
  const scale = punchy ? 0.88 + (1 - Math.min(1, abs)) * 0.14 : 1 - abs * 0.06
  return {
    opacity,
    visibility: opacity < 0.02 ? 'hidden' : 'visible',
    transform: `translate3d(0, ${y}px, 0) scale(${scale})`,
    pointerEvents: abs < 0.35 ? 'auto' : 'none'
  }
}

/** One step’s video bit — plays through once; scroll can speed it up via videoRef. */
function HowToClip({ active, start, end, label, onComplete, onProgress, videoRef }) {
  const ref = useRef(null)
  const doneRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const onProgressRef = useRef(onProgress)

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  useEffect(() => {
    const video = ref.current
    if (videoRef) videoRef.current = video
    return () => {
      if (videoRef && videoRef.current === video) videoRef.current = null
    }
  }, [videoRef])

  useEffect(() => {
    const video = ref.current
    if (!video) return undefined

    let cancelled = false
    doneRef.current = false
    const span = Math.max(0.05, end - start)
    onProgressRef.current?.(0)

    const seekStart = () => {
      try {
        video.currentTime = start
      } catch {
        /* ignore seek before ready */
      }
    }

    const kick = async () => {
      if (cancelled || !active) return
      video.muted = true
      video.defaultMuted = true
      video.setAttribute('muted', '')
      video.playbackRate = 1
      seekStart()
      try {
        await video.play()
      } catch {
        /* muted autoplay */
      }
    }

    if (!active) {
      video.pause()
      return undefined
    }

    if (video.readyState >= 1) kick()
    else video.addEventListener('loadedmetadata', kick, { once: true })
    video.addEventListener('canplay', kick, { once: true })

    const finish = () => {
      if (cancelled || doneRef.current) return
      doneRef.current = true
      try {
        video.currentTime = Math.max(start, end - 0.05)
      } catch {
        /* ignore */
      }
      video.pause()
      video.playbackRate = 1
      onProgressRef.current?.(1)
      onCompleteRef.current?.()
    }

    const onTime = () => {
      if (cancelled || !active || doneRef.current) return
      const p = Math.min(1, Math.max(0, (video.currentTime - start) / span))
      onProgressRef.current?.(p)
      if (video.currentTime >= end - 0.08) finish()
    }
    video.addEventListener('timeupdate', onTime)

    return () => {
      cancelled = true
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', kick)
      video.removeEventListener('canplay', kick)
      video.pause()
      video.playbackRate = 1
    }
  }, [active, start, end])

  return (
    <div className="m2-howto-clip">
      <video
        ref={ref}
        src={DEMO_HOWTO_VIDEO_STREAM}
        muted
        autoPlay={active}
        playsInline
        preload="auto"
        controls={false}
        aria-label={label || 'QuoteGen process'}
      />
    </div>
  )
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

/** Full-viewport message film — whole-screen scroll beats, no word pops. */
function MessageFilm() {
  const { rootRef, float, active, progress } = useScrollFilm(MESSAGE_SLIDES.length)

  return (
    <section className="m2-film m2-film-light" ref={rootRef} aria-label="Why QuoteGen" style={{ '--m2-film-p': progress }}>
      <div className="m2-film-sticky">
        <div className="m2-film-orb" aria-hidden="true" />
        <div className="m2-film-spark" aria-hidden="true" />
        <div className="m2-film-stage">
          {MESSAGE_SLIDES.map((slide, i) => {
            const live = active === i
            return (
              <div
                key={slide.id}
                className={`m2-msg${live ? ' is-on' : ''}`}
                style={slideStyle(float, i)}
                aria-hidden={!live}
              >
                {slide.lines.map((line) => (
                  <span key={`${slide.id}-${line.t}`} className={`m2-msg-line is-${line.c}`}>
                    {line.t}
                  </span>
                ))}
              </div>
            )
          })}
        </div>
        <div className="m2-film-rail" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0.08, progress)})` }} />
        </div>
      </div>
      <div className="m2-film-track" aria-hidden="true" style={{ height: `${MESSAGE_SLIDES.length * 100}vh` }} />
    </section>
  )
}

const DemoFilm = forwardRef(function DemoFilm({ entryForm }, ref) {
  const demos = [
    {
      id: 'copy',
      kicker: '01',
      title: 'Copy paste the enquiry',
      sub: 'WhatsApp. Email. Notes. Messy is fine.'
    },
    {
      id: 'assemble',
      kicker: '02',
      title: 'Watch it assemble',
      sub: 'Line items. Amounts. Ready in seconds.'
    },
    {
      id: 'layouts',
      kicker: '03',
      title: 'Choose the layout',
      sub: 'Professional templates. Your brand. Send.'
    }
  ]

  const CLOSE_STEP = demos.length
  const count = demos.length + 1
  const clips = DEMO_HOWTO_PROCESS_CLIPS
  const { rootRef, active } = useScrollFilm(count)
  const videoRef = useRef(null)
  const [stepDone, setStepDone] = useState(false)
  const [clipProgress, setClipProgress] = useState(0)
  /** Text/video only advance when a clip finishes — never mid-scroll ghost. */
  const [shownStep, setShownStep] = useState(0)
  const activeRef = useRef(active)
  const stepDoneRef = useRef(stepDone)
  const shownRef = useRef(0)
  const isClose = shownStep >= CLOSE_STEP

  useEffect(() => {
    activeRef.current = active
    // Scrolling back: follow. Scrolling forward: wait for video end.
    if (active < shownRef.current) {
      shownRef.current = active
      setShownStep(active)
      const closing = active >= CLOSE_STEP
      setStepDone(closing)
      stepDoneRef.current = closing
      setClipProgress(closing ? 1 : 0)
    }
  }, [active])

  useEffect(() => {
    stepDoneRef.current = stepDone
  }, [stepDone])

  // Scroll speeds up the clip; do not skip to the next step until it finishes.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    let decay = 0
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    const engaged = () => {
      const rect = root.getBoundingClientRect()
      return rect.top <= 8 && rect.bottom > window.innerHeight * 0.45
    }

    const maxScrollForStep = (stepIndex, allowAdvance) => {
      const total = Math.max(1, root.offsetHeight - window.innerHeight)
      // Hold scroll inside the current beat until the clip finishes — no mid-step float bleed.
      const frac = allowAdvance ? (stepIndex + 1 - 0.001) / count : (stepIndex + 0.08) / count
      return root.offsetTop + frac * total
    }

    const boostVideo = (delta) => {
      const video = videoRef.current
      if (!video || stepDoneRef.current || shownRef.current >= CLOSE_STEP) return
      const boost = reduce ? 1 : Math.min(4, 1.35 + Math.abs(delta) / 70)
      video.playbackRate = boost
      if (video.paused) video.play().catch(() => {})
      window.clearTimeout(decay)
      decay = window.setTimeout(() => {
        if (videoRef.current) videoRef.current.playbackRate = 1
      }, 200)
    }

    const onWheel = (e) => {
      if (!engaged()) return
      if (e.deltaY <= 0) return
      if (stepDoneRef.current || shownRef.current >= CLOSE_STEP) return
      e.preventDefault()
      boostVideo(e.deltaY)
    }

    let touchY = null
    const onTouchStart = (e) => {
      touchY = e.touches?.[0]?.clientY ?? null
    }
    const onTouchMove = (e) => {
      if (!engaged() || touchY == null) return
      if (stepDoneRef.current || shownRef.current >= CLOSE_STEP) return
      const y = e.touches?.[0]?.clientY
      if (y == null) return
      const dy = touchY - y
      if (dy > 6) {
        e.preventDefault()
        boostVideo(dy)
        touchY = y
      }
    }

    const onScroll = () => {
      if (!engaged()) return
      if (shownRef.current >= CLOSE_STEP) return
      const cap = maxScrollForStep(shownRef.current, stepDoneRef.current)
      if (window.scrollY > cap + 1) {
        window.scrollTo(0, cap)
      }
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(decay)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('scroll', onScroll)
    }
  }, [rootRef, count])

  const goToStep = (index) => {
    const root = rootRef.current
    if (!root) return
    const next = Math.max(0, Math.min(CLOSE_STEP, index))
    if (next === shownRef.current) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const total = Math.max(1, root.offsetHeight - window.innerHeight)
    const toClose = next >= CLOSE_STEP
    const target = toClose
      ? root.offsetTop + ((CLOSE_STEP + 0.2) / count) * total
      : root.offsetTop + ((next + 0.12) / count) * total

    stepDoneRef.current = true
    setStepDone(true)
    setClipProgress(1)
    shownRef.current = next
    setShownStep(next)

    window.setTimeout(() => {
      window.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' })
      if (toClose) {
        stepDoneRef.current = true
        setStepDone(true)
        setClipProgress(1)
        return
      }
      window.setTimeout(() => {
        setClipProgress(0)
        setStepDone(false)
        stepDoneRef.current = false
      }, reduce ? 60 : 480)
    }, 40)
  }

  const onClipComplete = () => goToStep(shownRef.current + 1)

  const goToStepRef = useRef(goToStep)
  goToStepRef.current = goToStep
  useImperativeHandle(ref, () => ({
    goToClose: () => goToStepRef.current(CLOSE_STEP)
  }), [])

  const hardStepStyle = (live) => ({
    opacity: live ? 1 : 0,
    visibility: live ? 'visible' : 'hidden',
    pointerEvents: live ? 'auto' : 'none',
    transform: live ? 'translate3d(0,0,0)' : 'translate3d(0,10px,0)'
  })

  return (
    <section className="m2-demo" ref={rootRef} aria-label="How QuoteGen works">
      <div className={`m2-demo-sticky${isClose ? ' is-finale' : ''}`}>
        {isClose ? (
          <div className="m2-demo-finale m2-shell">
            <div className="m2-demo-finale-copy">
              <p className="m2-demo-close m2-demo-close-xl">
                <span>Just verify your pricing and send to clients.</span>
                <strong>Leave the rest on QuoteGen.</strong>
              </p>
              <p className="m2-demo-finale-meta">
                <s>₹{LIST_PRICE.toLocaleString('en-IN')}/month</s>
                <span>Limited-time entry · Free cancellation</span>
              </p>
            </div>
            <div className="m2-demo-finale-form" id="entry-form">
              {entryForm}
            </div>
          </div>
        ) : (
          <div className="m2-shell m2-demo-grid">
            <div className="m2-demo-copy">
              <p className="m2-eyebrow">How it works</p>
              <div className="m2-demo-stepper" aria-label="Steps">
                {demos.map((d, i) => (
                  <div
                    key={d.id}
                    className={`m2-demo-stepper-item${i === shownStep ? ' is-on' : ''}${i < shownStep ? ' is-done' : ''}`}
                  >
                    <span className="m2-demo-stepper-dot" aria-hidden="true" />
                    <span className="m2-demo-stepper-label">Step {i + 1}</span>
                  </div>
                ))}
              </div>
              <div className="m2-demo-body">
                {demos.map((d, i) => (
                  <div
                    key={d.id}
                    className={`m2-demo-text${i === shownStep ? ' is-on' : ''}`}
                    style={hardStepStyle(i === shownStep)}
                    aria-hidden={i !== shownStep}
                  >
                    <h2>{d.title}</h2>
                    <p className="m2-demo-sub">{d.sub}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="m2-demo-stage m2-demo-stage-phone" aria-live="polite">
              {demos.map((d, i) => {
                const clip = clips[i] || clips[0]
                const live = shownStep === i
                return (
                  <div
                    key={d.id}
                    className={`m2-stage m2-stage-phone${live ? ' is-on' : ''}`}
                    style={hardStepStyle(live)}
                    aria-hidden={!live}
                  >
                    {live ? (
                      <HowToClip
                        key={`${d.id}-${clip.start}-${clip.end}`}
                        active
                        start={clip.start}
                        end={clip.end}
                        label={d.title}
                        videoRef={videoRef}
                        onProgress={setClipProgress}
                        onComplete={onClipComplete}
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <div className="m2-demo-skip">
          <button
            type="button"
            className="m2-demo-skip-btn"
            aria-label="Previous step"
            disabled={shownStep <= 0}
            onClick={() => goToStep(shownStep - 1)}
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            type="button"
            className="m2-demo-skip-btn"
            aria-label={isClose ? 'Already on closing step' : 'Next step'}
            disabled={shownStep >= CLOSE_STEP}
            onClick={() => goToStep(shownStep + 1)}
          >
            <span aria-hidden="true">↓</span>
          </button>
        </div>
        {!isClose ? (
          <div className="m2-demo-steps" aria-hidden="true">
            {demos.map((d, i) => {
              const fill = i < shownStep ? 1 : i === shownStep ? (stepDone ? 1 : clipProgress) : 0
              return (
                <span key={d.id} className={`m2-demo-step${i === shownStep ? ' is-live' : ''}${fill >= 1 ? ' is-done' : ''}`}>
                  <i style={{ transform: `scaleX(${Math.max(0.02, fill)})` }} />
                </span>
              )
            })}
          </div>
        ) : null}
      </div>
      <div className="m2-demo-track" aria-hidden="true" style={{ height: `${count * 100}vh` }} />
    </section>
  )
})

export default function MetaAdsLanding2({ onSignIn }) {
  const formRef = useRef(null)
  const demoRef = useRef(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [monthlyQuotes, setMonthlyQuotes] = useState('')
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
    trackPixel('ViewContent', { content_name: 'QuoteGen landing2 offer' })
  }, [])

  const offerLeft = offerStartedAt ? offerStartedAt + OFFER_MS - now : OFFER_MS
  const offerLive = offerLeft > 0
  // Landing2 entry stays ₹199 — list price is only the strike / next-month anchor.
  const total = ENTRY_PRICE + (whatsappAddon ? WA_ADDON : 0)
  const seats = seatsLeftFrom(offerStartedAt)

  const openForm = () => {
    trackPixel('InitiateCheckout', {
      value: ENTRY_PRICE,
      currency: 'INR',
      content_name: 'QuoteGen landing2 entry'
    })
    demoRef.current?.goToClose?.()
    window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 420)
  }

  const pay = async (e) => {
    e.preventDefault()
    if (busy) return
    setError('')
    const n = name.trim()
    const p = normalizeIndiaMobileDigits(phone)
    const em = email.trim().toLowerCase()
    const quotes = monthlyQuotes.trim()
    const trade = industry.trim()
    const wa = whatsappAddon ? normalizeIndiaMobileDigits(waPhone || phone) : ''

    if (!n) return setError('Please enter your name.')
    if (!isValidIndiaMobile(p)) return setError('Enter a valid 10-digit mobile number.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return setError('Enter a valid email address.')
    if (!quotes) return setError('Enter how many quotations you make in a month.')
    if (!trade) return setError('Enter your industry.')
    if (whatsappAddon && !isValidIndiaMobile(wa)) return setError('Enter a valid WhatsApp number for the add-on.')

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
        trackPixel('InitiateCheckout', {
          value: total,
          currency: 'INR',
          content_name: whatsappAddon ? 'QuoteGen landing2 + WhatsApp' : 'QuoteGen landing2 entry'
        })
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
          <p className="m2-kicker">QuoteGen</p>
          <h1>
            The future of
            <br />
            <span>smart quotation making</span>
          </h1>
          <p className="m2-hero-lead">
            Not another tool you learn. A faster way to quote —
            <br />
            so every enquiry becomes a professional PDF you can send today.
          </p>
          <div className="m2-hero-actions">
            <button type="button" className="meta-btn meta-btn-primary meta-btn-lg m2-hero-cta" onClick={openForm}>
              Try QuoteGen now @ ₹{ENTRY_PRICE}/-
            </button>
            <p className="m2-hero-price">
              <s>₹{LIST_PRICE.toLocaleString('en-IN')}/-</s>
              <span>Limited-time entry</span>
            </p>
          </div>
          <div className="m2-seats" aria-live="polite">
            <strong className="m2-seats-count">{seats}</strong>
            <span>seats left</span>
            {offerLive ? (
              <em className="m2-seats-timer">
                Ends in <b>{formatCountdown(offerLeft)}</b>
              </em>
            ) : null}
          </div>
        </div>
      </section>

      <MessageFilm />
      <DemoFilm
        ref={demoRef}
        entryForm={(
          <form className="meta-form-card meta2-form m2-finale-form-card" ref={formRef} onSubmit={pay}>
            <header className="m2-finale-form-head">
              <h2>Start QuoteGen</h2>
              <p className="meta-form-lead">
                Enter details → pay <strong>₹{ENTRY_PRICE}/-</strong> → you’re in.
              </p>
            </header>

            <div className="meta-fields m2-finale-fields">
              <div className="meta-field">
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
                  />
                </div>
              </div>
              <div className="meta-field">
                <label htmlFor="meta2-email">Work email</label>
                <input id="meta2-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
              </div>
              <div className="meta-field">
                <label htmlFor="meta2-company">Company <span>(optional)</span></label>
                <input id="meta2-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Your business name" />
              </div>
              <div className="meta-field">
                <label htmlFor="meta2-monthly">Quotes / month</label>
                <input id="meta2-monthly" value={monthlyQuotes} onChange={(e) => setMonthlyQuotes(e.target.value)} placeholder="e.g. 40" />
              </div>
              <div className="meta-field">
                <label htmlFor="meta2-industry">Industry</label>
                <IndustryField value={industry} onChange={setIndustry} />
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
                  <em>
                    Just forward to your QuoteGen WhatsApp number and create a professional quotation directly on WhatsApp.
                    {' '}(+ ₹{WA_ADDON}/mo)
                  </em>
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
              {busy ? 'Opening PhonePe…' : `Start QuoteGen at ₹${total}/-`}
            </button>
            <p className="meta-form-fine">
              ₹{ENTRY_PRICE} today · then ₹{LIST_PRICE.toLocaleString('en-IN')}/mo · Free cancel
              {whatsappAddon ? ` · WA +₹${WA_ADDON}` : ''}
              <br />
              <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
            </p>
          </form>
        )}
      />

      <footer className="m2-closure">
        <div className="m2-shell m2-closure-inner">
          <p className="m2-closure-query">Got a query? Contact us</p>
          <a className="m2-closure-call" href="tel:+919067610118">
            Call 9067610118
          </a>
          <p className="m2-closure-legal">
            <a href="/privacy">Privacy</a>
            <span aria-hidden="true">·</span>
            <a href="/terms">Terms</a>
          </p>
        </div>
      </footer>
    </div>
  )
}
