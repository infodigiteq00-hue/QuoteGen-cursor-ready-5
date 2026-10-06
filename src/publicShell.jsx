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

function ScreenFallback() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f7fa', fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}>
      <div style={{ fontWeight: 700, fontSize: 18, color: '#1e293b' }}>Loading…</div>
    </main>
  )
}

function PublicApp() {
  const [mode, setMode] = useState(() => (isSignInPath(pathName()) || hasAuthHash() ? 'login' : ''))
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
        if (!cancelled && session) window.location.assign('/')
      })
      stop = onAuthChange((session) => {
        if (session) window.location.assign('/')
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
          onLoggedIn={() => { window.location.assign('/') }}
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
      onSignUp={(value) => {
        setEmail(value || '')
        setMode('signup')
      }}
    />
  )
}

export function mountPublicShell() {
  const rootEl = document.getElementById('root')
  rootEl.__qgRoot = rootEl.__qgRoot || createRoot(rootEl)
  rootEl.__qgRoot.render(<PublicApp />)
}
