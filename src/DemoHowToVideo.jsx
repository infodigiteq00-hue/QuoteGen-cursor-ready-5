import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export const DEMO_HOWTO_VIDEO_ID = '1OdToPSkPWfnWkLrLgcaM5SEP8k9cNLKL'
export const DEMO_HOWTO_VIDEO_URL = `https://drive.google.com/file/d/${DEMO_HOWTO_VIDEO_ID}/view?usp=drive_link`
export const DEMO_HOWTO_VIDEO_EMBED = `https://drive.google.com/file/d/${DEMO_HOWTO_VIDEO_ID}/preview`
export const DEMO_HOWTO_VIDEO_THUMB = `https://drive.google.com/thumbnail?id=${DEMO_HOWTO_VIDEO_ID}&sz=w640`
/** Local copy in /public (Drive download is unreliable as a <video> src). Web-optimized ~2MB. */
export const DEMO_HOWTO_VIDEO_STREAM = '/videos/howto-demo.mp4'
export const DEMO_HOWTO_VIDEO_POSTER = '/videos/howto-demo-poster.jpg'
/** Opening beat: copy enquiry from WhatsApp (seconds). */
export const DEMO_HOWTO_COPY_CLIP = { start: 0, end: 11 }
/**
 * How-it-works process beats from the same walkthrough video (seconds).
 * 01 copy-paste enquiry → 02 assemble (old step-2 stream) → 03 layout
 */
export const DEMO_HOWTO_PROCESS_CLIPS = [
  { start: 0, end: 14 },
  { start: 11, end: 23.5 },
  { start: 33, end: 44 }
]

/**
 * Floating “watch how QuoteGen works” chip for the demo preview.
 * Opens an in-app lightbox; Drive is the source of the 2-minute walkthrough.
 */
const DISMISS_KEY = 'qg_howto_chip_dismissed'

export default function DemoHowToVideo({ placement = 'top-right', appearAfterMs = 6000 }) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  const [visible, setVisible] = useState(appearAfterMs <= 0)
  const [thumbFailed, setThumbFailed] = useState(false)

  useEffect(() => {
    if (dismissed || appearAfterMs <= 0) {
      if (!dismissed) setVisible(true)
      return undefined
    }
    const timer = window.setTimeout(() => setVisible(true), appearAfterMs)
    return () => window.clearTimeout(timer)
  }, [appearAfterMs, dismissed])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  const dismissChip = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
    setDismissed(true)
    setVisible(false)
    setOpen(false)
  }

  const placeClass = placement === 'bottom-right' ? 'is-bottom-right' : 'is-top-right'
  if (!visible || dismissed) return null

  return (
    <>
      <div className={`qg-howto-chip-wrap ${placeClass}`}>
        <button
          type="button"
          className="qg-howto-chip-dismiss"
          onClick={dismissChip}
          aria-label="Hide how-to video"
          title="Close"
        >
          ×
        </button>
        <button
          type="button"
          className="qg-howto-chip"
          onClick={() => setOpen(true)}
          aria-label="Watch a 2-minute video on how to use QuoteGen"
        >
          <span className="qg-howto-chip-thumb" aria-hidden="true">
            {thumbFailed ? (
              <span className="qg-howto-chip-fallback" />
            ) : (
              <img
                src={DEMO_HOWTO_VIDEO_THUMB}
                alt=""
                onError={() => setThumbFailed(true)}
              />
            )}
            <span className="qg-howto-chip-play">▶</span>
          </span>
          <span className="qg-howto-chip-copy">
            <strong>Watch how QuoteGen works</strong>
            <em>Only takes 2 minutes</em>
          </span>
        </button>
      </div>

      {open && createPortal(
        <div
          className="qg-howto-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="How to use QuoteGen"
          onClick={() => setOpen(false)}
        >
          <div className="qg-howto-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <div className="qg-howto-lightbox-head">
              <button type="button" className="qg-howto-lightbox-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
              <div>
                <p className="qg-howto-lightbox-kicker">2-minute walkthrough</p>
                <h2>How to use QuoteGen</h2>
              </div>
            </div>
            <div className="qg-howto-lightbox-frame">
              <iframe
                title="How to use QuoteGen"
                src={DEMO_HOWTO_VIDEO_EMBED}
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
            </div>
            <a
              className="qg-howto-lightbox-open"
              href={DEMO_HOWTO_VIDEO_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Google Drive
            </a>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        .qg-howto-chip-wrap {
          position: fixed;
          z-index: 80;
          max-width: min(280px, calc(100vw - 24px));
        }
        .qg-howto-chip-wrap.is-top-right { top: 16px; right: 16px; }
        .qg-howto-chip-wrap.is-bottom-right { bottom: 20px; right: 16px; }
        .qg-howto-chip-dismiss {
          position: absolute;
          top: -8px;
          left: -8px;
          z-index: 2;
          width: 26px;
          height: 26px;
          border: 1px solid #D5DDE9;
          border-radius: 999px;
          background: #fff;
          color: #334155;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
        }
        .qg-howto-chip-dismiss:hover { border-color: #1A73E8; color: #1A73E8; }
        .qg-howto-chip {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 12px 8px 8px;
          border: 1px solid #D5DDE9;
          border-radius: 14px;
          background: #fff;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
          cursor: pointer;
          text-align: left;
          font-family: Outfit, Inter, system-ui, sans-serif;
          color: #0f172a;
        }
        .qg-howto-chip:hover { border-color: #1A73E8; }
        .qg-howto-chip-thumb {
          position: relative;
          width: 56px;
          height: 40px;
          border-radius: 8px;
          overflow: hidden;
          flex-shrink: 0;
          background: #0B1220;
        }
        .qg-howto-chip-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .qg-howto-chip-fallback {
          display: block;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, #1A73E8, #0B1220);
        }
        .qg-howto-chip-play {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: #fff;
          font-size: 12px;
          text-shadow: 0 1px 4px rgba(0,0,0,.45);
          background: rgba(15, 23, 42, 0.28);
        }
        .qg-howto-chip-copy {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .qg-howto-chip-copy strong {
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.25;
        }
        .qg-howto-chip-copy em {
          font-style: normal;
          font-size: 11.5px;
          color: #64748b;
        }
        .qg-howto-lightbox {
          position: fixed;
          inset: 0;
          z-index: 320;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(15, 23, 42, 0.42);
        }
        .qg-howto-lightbox-card {
          width: min(880px, 100%);
          background: #fff;
          border-radius: 20px;
          box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
          overflow: hidden;
        }
        .qg-howto-lightbox-head {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 18px 18px 12px;
        }
        .qg-howto-lightbox-kicker {
          margin: 0 0 4px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #1A73E8;
        }
        .qg-howto-lightbox-head h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          color: #0f172a;
          font-family: Outfit, Inter, system-ui, sans-serif;
        }
        .qg-howto-lightbox-close {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border: 0;
          border-radius: 10px;
          background: #F1F5F9;
          color: #334155;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
        }
        .qg-howto-lightbox-close:hover { background: #E2E8F0; }
        .qg-howto-lightbox-frame {
          aspect-ratio: 16 / 9;
          background: #0B1220;
        }
        .qg-howto-lightbox-frame iframe {
          width: 100%;
          height: 100%;
          border: 0;
          display: block;
        }
        .qg-howto-lightbox-open {
          display: inline-block;
          margin: 12px 18px 16px;
          font-size: 13px;
          font-weight: 600;
          color: #1A73E8;
          text-decoration: none;
        }
        @media (max-width: 640px) {
          .qg-howto-chip-wrap {
            max-width: min(220px, calc(100vw - 20px));
          }
          .qg-howto-chip {
            padding: 6px 10px 6px 6px;
          }
          .qg-howto-chip-copy strong { font-size: 11.5px; }
          .qg-howto-chip-copy em { font-size: 10.5px; }
          .qg-howto-chip-thumb { width: 48px; height: 34px; }
        }
      `}</style>
    </>
  )
}
