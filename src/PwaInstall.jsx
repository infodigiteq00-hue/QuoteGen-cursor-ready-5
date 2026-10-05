import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import logoUrl from './assets/landing/quotegen-logo.png'
import {
  isPwaSaved,
  onPwaInstallOpen,
  onPwaInstalled,
  openPwaInstall,
  promptPwaInstall,
  pwaMode
} from './pwaInstall.js'

function InstallIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="14" rx="2" stroke="#1A73E8" strokeWidth="2" />
      <path d="M12 8v6M9.5 12.5 12 15l2.5-2.5" stroke="#1A73E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Shot({ children, caption }) {
  return (
    <li className="qg-pwa-shot-item">
      <div className="qg-pwa-shot" aria-hidden="true">{children}</div>
      <p>{caption}</p>
    </li>
  )
}

export function usePwaInstallAvailable() {
  const [available, setAvailable] = useState(() => !isPwaSaved())
  useEffect(() => {
    const sync = () => setAvailable(!isPwaSaved())
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
            <p>Two taps. Then it opens from your home screen, like an app.</p>
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
          <ol className="qg-pwa-shots">
            <Shot caption={<><strong>1.</strong> Tap Share at the bottom of Safari.</>}>
              <div className="qg-pwa-shot-bar">
                <span className="qg-pwa-shot-url">quotegen.ai</span>
                <span className="qg-pwa-shot-chip">Share</span>
              </div>
            </Shot>
            <Shot caption={<><strong>2.</strong> Tap Add to Home Screen, then Add.</>}>
              <div className="qg-pwa-shot-bar">
                <span className="qg-pwa-shot-label">Add to Home Screen</span>
              </div>
            </Shot>
          </ol>
        ) : iosOther ? (
          <p className="qg-pwa-note">Open this page in <strong>Safari</strong>, then tap Share → Add to Home Screen.</p>
        ) : android ? (
          <ol className="qg-pwa-shots">
            <Shot caption={<><strong>1.</strong> Tap the three dots in Chrome.</>}>
              <div className="qg-pwa-shot-bar">
                <span className="qg-pwa-shot-url">quotegen.ai</span>
                <span className="qg-pwa-shot-chip">⋮</span>
              </div>
            </Shot>
            <Shot caption={<><strong>2.</strong> Tap Install app.</>}>
              <div className="qg-pwa-shot-bar">
                <span className="qg-pwa-shot-label">Install app</span>
              </div>
            </Shot>
          </ol>
        ) : desktop ? (
          <ol className="qg-pwa-shots">
            <Shot caption={<><strong>1.</strong> Click this icon in the address bar.</>}>
              <div className="qg-pwa-shot-bar">
                <span className="qg-pwa-shot-url">quotegen.ai</span>
                <span className="qg-pwa-shot-chip is-icon"><InstallIcon /></span>
              </div>
            </Shot>
            <Shot caption={<><strong>2.</strong> Click Install.</>}>
              <div className="qg-pwa-shot-bar">
                <span className="qg-pwa-shot-label">Install</span>
              </div>
            </Shot>
          </ol>
        ) : null}

        {!canNative && !installed ? (
          <button type="button" className="qg-pwa-secondary" onClick={close}>Got it</button>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
