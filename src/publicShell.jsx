import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import MarketingLanding from './MarketingLanding.jsx'

const AuthScreen = React.lazy(() => import('./AuthScreen.jsx'))
const LegalPages = React.lazy(() => import('./LegalPages.jsx'))

function pathName() {
  return String(window.location.pathname || '/').replace(/\/+$/, '') || '/'
}

function isSignInPath(path) {
  return path === '/signin' || path === '/login' || path === '/sign-in'
}

function hasAuthHash() {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return false
  const params = new URLSearchParams(hash)
  return params.has('access_token') || params.has('error_code') || params.get('type') === 'recovery'
}

function legalPageId(path) {
  if (path === '/privacy' || path === '/privacy-policy') return 'privacy'
  if (path === '/terms' || path === '/terms-of-service' || path === '/terms-and-conditions') return 'terms'
  if (path === '/refund' || path === '/refund-policy' || path === '/cancellation') return 'refund'
  if (path === '/contact' || path === '/contact-us') return 'contact'
  return ''
}

const PENDING_QUOTE_KEY = 'qg_pending_quote'

function quoteIdFromLocation() {
  try {
    const id = new URLSearchParams(window.location.search).get('quote') || ''
    return /^[0-9a-f-]{36}$/i.test(id) ? id : ''
  } catch {
    return ''
  }
}

function rememberPendingQuote() {
  const id = quoteIdFromLocation()
  if (!id) return
  try { sessionStorage.setItem(PENDING_QUOTE_KEY, id) } catch { /* private mode */ }
}

function homeAfterLogin() {
  let id = quoteIdFromLocation()
  if (!id) {
    try { id = sessionStorage.getItem(PENDING_QUOTE_KEY) || '' } catch { id = '' }
  }
  if (/^[0-9a-f-]{36}$/i.test(id)) return `/?quote=${encodeURIComponent(id)}`
  return '/'
}

function ScreenFallback() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f7fa', fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: '#1e293b' }}>Loading…</div>
    </main>
  )
}

function PublicApp() {
  rememberPendingQuote()
  const [mode, setMode] = useState(() => (
    isSignInPath(pathName()) || hasAuthHash() || quoteIdFromLocation() ? 'login' : ''
  ))
  const [email, setEmail] = useState('')
  const [stylesReady, setStylesReady] = useState(false)
  const legalId = legalPageId(pathName())

  useEffect(() => {
    if (!mode) return undefined
    let cancelled = false
    import('./styles.css').then(() => { if (!cancelled) setStylesReady(true) })
    return () => { cancelled = true }
  }, [mode])

  useEffect(() => {
    if (!mode && !hasAuthHash()) return undefined
    let stop = () => {}
    let cancelled = false
    import('./apiAuth.js').then(({ installAuthFetch, getCurrentSession, onAuthChange }) => {
      if (cancelled) return
      installAuthFetch()
      getCurrentSession().then((session) => {
        if (!cancelled && session) window.location.assign(homeAfterLogin())
      })
      stop = onAuthChange((session) => {
        if (session) window.location.assign(homeAfterLogin())
      })
    })
    return () => { cancelled = true; stop() }
  }, [mode])

  if (legalId) {
    return (
      <React.Suspense fallback={<ScreenFallback />}>
        <LegalPages pageId={legalId} />
      </React.Suspense>
    )
  }

  if (mode) {
    if (!stylesReady) return <ScreenFallback />
    return (
      <React.Suspense fallback={<ScreenFallback />}>
        <AuthScreen
          initialMode={mode}
          prefillEmail={email}
          onLoggedIn={() => { window.location.assign(homeAfterLogin()) }}
        />
      </React.Suspense>
    )
  }

  return (
    <MarketingLanding
      onSignIn={() => {
        window.history.pushState({}, '', '/signin')
        setMode('login')
      }}
      onSignUp={() => {
        window.location.assign('/metaadslanding')
      }}
    />
  )
}

export function mountPublicShell() {
  const rootEl = document.getElementById('root')
  rootEl.__qgRoot = rootEl.__qgRoot || createRoot(rootEl)
  rootEl.__qgRoot.render(<PublicApp />)
}
