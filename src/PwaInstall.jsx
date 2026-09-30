import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import logoUrl from './assets/landing/quotegen-logo.png'
import {
  isPwaInstalled,
  onPwaInstallOpen,
  onPwaInstalled,
  openPwaInstall,
  promptPwaInstall,
  pwaMode
} from './pwaInstall.js'

function IosShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V4" stroke="#1A73E8" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8 7.5 12 3.5 16 7.5" stroke="#1A73E8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 14v5.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V14" stroke="#1A73E8" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function usePwaInstallAvailable() {
  const [available, setAvailable] = useState(() => !isPwaInstalled())
  useEffect(() => {
    const sync = () => setAvailable(!isPwaInstalled())
    const media = window.matchMedia?.('(display-mode: standalone)')
    media?.addEventListener?.('change', sync)
    const stop = onPwaInstalled(sync)
    window.addEventListener('qg-pwa-ready', sync)
    return () => {
      media?.removeEventListener?.('change', sync)
      stop()
      window.removeEventListener('qg-pwa-ready', sync)
    }
  }, [])
  return available
}

export function PwaAccountCard() {
  const available = usePwaInstallAvailable()
  if (!available) return null
  return (
    <section className="qg-pwa-entry" style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 20, padding: 26, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 17, fontWeight: 750 }}>Add to Home Screen</div>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6B7688', lineHeight: 1.5 }}>Save QuoteGen on your phone like an app — our logo, one tap, no web address to remember.</p>
      </div>
      <button
        type="button"
        onClick={openPwaInstall}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 48, padding: '0 18px', border: 0, borderRadius: 14, background: '#1A73E8', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
      >
        Add to Home Screen
      </button>
    </section>
  )
}

export function PwaInstallButton({ children = 'Add to Home Screen', className = '', style }) {
  const available = usePwaInstallAvailable()
  if (!available) return null
  return (
    <button type="button" className={`qg-pwa-entry ${className}`.trim()} style={style} onClick={openPwaInstall}>
      {children}
    </button>
  )
}

export function PwaHomeCard() {
  const available = usePwaInstallAvailable()
  if (!available) return null
  return (
    <section className="qg-pwa-home-card qg-pwa-entry">
      <img src={logoUrl} alt="" width="48" height="48" />
      <div>
        <h2>Keep QuoteGen on your phone</h2>
        <p>Add it to your home screen. Same website — opens like an app, with our logo, no address to remember.</p>
      </div>
      <button type="button" onClick={openPwaInstall}>Add to Home Screen</button>
    </section>
  )
}

export default function PwaInstallHost() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState(() => pwaMode())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => setMode(pwaMode())
    const stopOpen = onPwaInstallOpen(() => { sync(); setOpen(true) })
    const stopInstalled = onPwaInstalled(() => { sync(); setOpen(false) })
    window.addEventListener('qg-pwa-ready', sync)
    return () => {
      stopOpen()
      stopInstalled()
      window.removeEventListener('qg-pwa-ready', sync)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape' && !busy) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy])

  const close = () => { if (!busy) setOpen(false) }

  const addNow = async () => {
    setBusy(true)
    const result = await promptPwaInstall()
    setBusy(false)
    setMode(pwaMode())
    if (result.outcome === 'accepted') setOpen(false)
  }

  if (!open) return null

  const canNative = mode === 'prompt'
  const iosSafari = mode === 'ios-safari'
  const iosOther = mode === 'ios-other'
  const android = mode === 'android'
  const desktop = mode === 'desktop'
  const installed = mode === 'installed'

  return createPortal(
    <div
      className="qg-pwa-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qg-pwa-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}
    >
      <div className="qg-pwa-card">
        <div className="qg-pwa-card-head">
          <img src={logoUrl} alt="" width="52" height="52" />
          <div>
            <h2 id="qg-pwa-title">Add QuoteGen to your home screen</h2>
            <p>It still runs on the web. Your phone just keeps a shortcut with our logo, so it opens like an app.</p>
          </div>
          <button type="button" className="qg-pwa-close" aria-label="Close" disabled={busy} onClick={close}>×</button>
        </div>

        {installed ? (
          <p className="qg-pwa-note">QuoteGen is already on this device. Open it from your home screen.</p>
        ) : canNative ? (
          <button type="button" className="qg-pwa-primary" disabled={busy} onClick={addNow}>
            {busy ? 'Waiting…' : 'Add to Home Screen'}
          </button>
        ) : iosSafari ? (
          <ol className="qg-pwa-steps">
            <li><span>1</span><p>Tap the <strong>Share</strong> button <IosShareIcon /> at the bottom of Safari.</p></li>
            <li><span>2</span><p>Scroll and tap <strong>Add to Home Screen</strong>.</p></li>
            <li><span>3</span><p>Tap <strong>Add</strong>. QuoteGen appears with our logo, like any other app.</p></li>
          </ol>
        ) : iosOther ? (
          <p className="qg-pwa-note">iPhone can only pin websites from <strong>Safari</strong>. Open this page in Safari, then tap Share → Add to Home Screen.</p>
        ) : android ? (
          <ol className="qg-pwa-steps">
            <li><span>1</span><p>Tap the <strong>menu</strong> (three dots) in Chrome.</p></li>
            <li><span>2</span><p>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.</p></li>
            <li><span>3</span><p>Confirm. QuoteGen sits on your home screen with our logo.</p></li>
          </ol>
        ) : desktop ? (
          <p className="qg-pwa-note">In Chrome or Edge, open the browser menu and choose <strong>Install QuoteGen</strong> / <strong>Cast, save, and share → Install page as app</strong>. On the phone it is even simpler: Add to Home Screen.</p>
        ) : null}

        {!canNative && !installed ? (
          <button type="button" className="qg-pwa-secondary" onClick={close}>Got it</button>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
