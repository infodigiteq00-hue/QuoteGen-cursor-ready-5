import React, { useEffect, useRef, useState } from 'react'
import './metaTrialGuide.css'

export const CEREMONY_MIN_MS = 4400

const CEREMONY_BEATS = [
  { id: 'read', stage: 'scan', title: 'Scanning the enquiry', detail: 'Reading every line of the client message…' },
  { id: 'extract', stage: 'lift', title: 'Pulling the details free', detail: 'Products, quantities, and rates lifting off the page…' },
  { id: 'map', stage: 'map', title: 'Slotting into your layout', detail: 'Each detail snapping into the columns you chose…' },
  { id: 'build', stage: 'forge', title: 'Forging the quotation', detail: 'Assembling a client-ready sheet — almost there…' }
]

const CEREMONY_SHARD_FALLBACKS = ['Qty', 'Rate', 'Item', 'Unit', '12', '1,250', 'Nos', 'Amount']

function ceremonyShards(enquiryText, columns) {
  const fromText = String(enquiryText || '')
    .replace(/[^\w\s.,%/₹$-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 18)
    .slice(0, 6)
  const fromCols = (Array.isArray(columns) ? columns : [])
    .map((c) => c.label)
    .filter(Boolean)
    .slice(0, 4)
  const mixed = [...fromText, ...fromCols, ...CEREMONY_SHARD_FALLBACKS]
  const seen = new Set()
  const out = []
  for (const raw of mixed) {
    const key = String(raw).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(String(raw).slice(0, 16))
    if (out.length >= 8) break
  }
  return out
}

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  )
}

export default function QuoteGenerateCeremony({ enquiry, columns }) {
  const [beatIndex, setBeatIndex] = useState(0)
  const enquiryScrollRef = useRef(null)
  const enquiryPreview = String(enquiry || '').trim()
  const cols = Array.isArray(columns) && columns.length ? columns : []
  const beat = CEREMONY_BEATS[Math.min(beatIndex, CEREMONY_BEATS.length - 1)]
  const shards = ceremonyShards(enquiryPreview, cols)
  const previewLines = (enquiryPreview || 'Your enquiry').split(/\n/)

  useEffect(() => {
    let cancelled = false
    let next = 0
    setBeatIndex(0)
    const timer = setInterval(() => {
      if (cancelled) return
      next += 1
      if (next >= CEREMONY_BEATS.length) {
        clearInterval(timer)
        return
      }
      setBeatIndex(next)
    }, 1050)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [enquiryPreview])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      return undefined
    }
    let raf = 0
    let cancelled = false
    let direction = 1
    let last = 0
    const speed = 32

    const tick = (now) => {
      if (cancelled) return
      const el = enquiryScrollRef.current
      if (!el) {
        raf = requestAnimationFrame(tick)
        return
      }
      if (!last) last = now
      const max = Math.max(0, el.scrollHeight - el.clientHeight)
      if (max > 0) {
        const dt = Math.min(50, now - last) / 1000
        last = now
        let top = el.scrollTop + direction * speed * dt
        if (top >= max - 0.5) {
          top = max
          direction = -1
        } else if (top <= 0.5) {
          top = 0
          direction = 1
        }
        el.scrollTop = top
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [enquiryPreview])

  return (
    <main className={`meta-guide meta-guide-ceremony is-${beat.stage}`}>
      <div className="meta-guide-ceremony-aura" aria-hidden="true">
        <span className="meta-guide-ceremony-orb meta-guide-ceremony-orb-a" />
        <span className="meta-guide-ceremony-orb meta-guide-ceremony-orb-b" />
        <span className="meta-guide-ceremony-orb meta-guide-ceremony-orb-c" />
        <div className="meta-guide-ceremony-stars">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} className={`meta-guide-ceremony-star s${i + 1}`} />
          ))}
        </div>
      </div>

      <div className="meta-guide-ceremony-shell">
        <p className="meta-guide-step">QuoteGen at work</p>
        <h1 className="meta-guide-title meta-guide-ceremony-title" key={beat.id}>
          {beat.title}
        </h1>
        <p className="meta-guide-lead meta-guide-ceremony-detail" key={`d-${beat.id}`}>
          {beat.detail}
        </p>

        <div className="meta-guide-alchemy" aria-hidden="true">
          <div className="meta-guide-alchemy-enquiry">
            <div className="meta-guide-alchemy-enquiry-label"><IconMail /> Enquiry</div>
            <div className="meta-guide-alchemy-enquiry-body" ref={enquiryScrollRef}>
              {previewLines.length ? previewLines.map((line, i) => (
                <p key={i}>{line || '\u00a0'}</p>
              )) : <p>—</p>}
            </div>
            <span className="meta-guide-alchemy-scan" />
            <span className="meta-guide-alchemy-glow" />
          </div>

          <div className="meta-guide-alchemy-stream">
            {shards.map((label, i) => (
              <span
                key={`${label}-${i}`}
                className={`meta-guide-alchemy-shard shard-${i}${beatIndex >= 1 ? ' is-lift' : ''}${beatIndex >= 2 ? ' is-fly' : ''}`}
                style={{ '--i': i }}
              >
                {label}
              </span>
            ))}
            <span className="meta-guide-alchemy-beam" />
          </div>

          <div className="meta-guide-alchemy-layout">
            <div className="meta-guide-alchemy-cols">
              {cols.map((c, i) => (
                <span
                  key={c.id}
                  className={`meta-guide-alchemy-col${beatIndex >= 2 ? ' is-catch' : ''}${beatIndex >= 3 ? ' is-fuse' : ''}`}
                  style={{ '--i': i }}
                >
                  {c.label}
                </span>
              ))}
            </div>
            <div className={`meta-guide-alchemy-sheet${beatIndex >= 3 ? ' is-forge' : ''}`}>
              <span className="meta-guide-alchemy-sheet-bar" />
              <span className="meta-guide-alchemy-sheet-bar" />
              <span className="meta-guide-alchemy-sheet-bar" />
              <span className="meta-guide-alchemy-burst" />
            </div>
          </div>
        </div>

        <div className="meta-guide-ceremony-progress" aria-hidden="true">
          {CEREMONY_BEATS.map((b, i) => (
            <span key={b.id} className={`meta-guide-ceremony-dot${i <= beatIndex ? ' is-on' : ''}${i === beatIndex ? ' is-active' : ''}`} />
          ))}
        </div>
      </div>
    </main>
  )
}
