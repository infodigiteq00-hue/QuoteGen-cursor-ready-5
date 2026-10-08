import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import AuthScreen from './AuthScreen.jsx'
import MetaAdsLanding from './MetaAdsLanding.jsx'
import BrandMark from './BrandMark.jsx'
import PwaInstallHost from './PwaInstall.jsx'
import { getCurrentSession, installAuthFetch, onAuthChange } from './apiAuth.js'
import { initMetaPixel, trackPixel } from './metaPixel.js'
import {
  clearMetaWelcome,
  markMetaTrialUnpaid,
  readMetaAdsLead,
  readMetaWelcome,
  recordMetaLeadProgress,
  saveVerifiedMetaLead,
  writeMetaAdsLead,
  writeMetaWelcome
} from './metaTrialLead.js'
import { usePaymentRequestOffer } from './PaymentRequestPrompt.jsx'

installAuthFetch()
initMetaPixel()

function currentPath() {
  return String(window.location.pathname || '/').replace(/\/+$/, '') || '/'
}

function storedTrialLead() {
  if (currentPath() !== '/trial-verify') return null
  return readMetaAdsLead()
}

function AdsApp() {
  const resumedLead = storedTrialLead()
  const [authChecked, setAuthChecked] = useState(false)
  const [authUser, setAuthUser] = useState(null)
  const [publicPath, setPublicPath] = useState(currentPath)
  const [guestAuthMode, setGuestAuthMode] = useState(() => (currentPath() === '/trial-verify' ? 'meta-trial' : null))
  const [guestEmail, setGuestEmail] = useState(resumedLead?.email || '')
  const [guestPhone, setGuestPhone] = useState(resumedLead?.phone || '')
  const [guestLeadName, setGuestLeadName] = useState(resumedLead?.name || '')
  const [guestLeadCompany, setGuestLeadCompany] = useState(resumedLead?.company || '')
  usePaymentRequestOffer({
    email: authUser?.email || guestEmail || '',
    name: guestLeadName || '',
    company: guestLeadCompany || '',
    phone: guestPhone || ''
  })
  const [metaWelcome, setMetaWelcome] = useState(() => Boolean(readMetaWelcome()))
  const [metaLeadError, setMetaLeadError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const apply = (session) => {
      if (cancelled) return
      setAuthUser(session?.user || null)
      setAuthChecked(true)
    }
    const bootTimer = setTimeout(() => apply(null), 4500)
    getCurrentSession()
      .then((session) => { clearTimeout(bootTimer); apply(session) })
      .catch(() => { clearTimeout(bootTimer); apply(null) })
    const unsubscribe = onAuthChange(apply)
    const syncPath = () => setPublicPath(currentPath())
    window.addEventListener('popstate', syncPath)
    return () => {
      cancelled = true
      clearTimeout(bootTimer)
      unsubscribe()
      window.removeEventListener('popstate', syncPath)
    }
  }, [])

  useEffect(() => {
    if (!authUser) return undefined
    const lead = readMetaAdsLead()
    if (!lead?.email || lead.verified) {
      if (lead?.verified) setMetaWelcome(true)
      return undefined
    }
    let cancelled = false
    setSaving(true)
    saveVerifiedMetaLead(lead)
      .then((saved) => {
        if (cancelled) return
        trackPixel('Lead', { content_name: 'QuoteGen trial' }, { once: saved?.id || saved?.email || lead.email })
        writeMetaWelcome('congrats')
        setMetaLeadError('')
        setMetaWelcome(true)
      })
      .catch((err) => {
        if (cancelled) return
        setMetaLeadError(err.message || 'Could not save your details. Please try again.')
        setMetaWelcome(true)
      })
      .finally(() => { if (!cancelled) setSaving(false) })
    return () => { cancelled = true }
  }, [authUser])

  const openSignIn = () => { window.location.assign('/signin') }

  const openTrialDemo = () => {
    const lead = readMetaAdsLead()
    markMetaTrialUnpaid(lead?.email)
    recordMetaLeadProgress('demo', lead)
    clearMetaWelcome()
    try { sessionStorage.setItem('qg_demo_from_intro', '1') } catch { /* ignore */ }
    window.location.assign('/demo')
  }

  if (!authChecked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3.5 bg-mist">
        <BrandMark size={56} alt="" />
        <div className="text-center">
          <div className="text-lg font-bold tracking-tight text-ink">QuoteGen</div>
          <div className="mt-2 text-sm text-slate-500">Loading…</div>
        </div>
      </main>
    )
  }

  if (!authUser) {
    const verifying = publicPath === '/trial-verify' || guestAuthMode === 'meta-trial'
    if (verifying || guestAuthMode === 'login') {
      return (
        <AuthScreen
          initialMode={guestAuthMode === 'login' ? 'login' : 'meta-trial'}
          prefillEmail={guestEmail}
          prefillPhone={guestPhone}
          leadName={guestLeadName}
          leadCompany={guestLeadCompany}
          onPreferLogin={openSignIn}
        />
      )
    }
    return (
      <MetaAdsLanding
        onSignIn={openSignIn}
        onStartVerify={(lead) => {
          clearMetaWelcome()
          if (lead) writeMetaAdsLead({ ...lead, verified: false })
          setGuestEmail(lead?.email || '')
          setGuestPhone(lead?.phone || '')
          setGuestLeadName(lead?.name || '')
          setGuestLeadCompany(lead?.company || '')
          setGuestAuthMode('meta-trial')
          window.history.pushState({}, '', '/trial-verify')
          setPublicPath('/trial-verify')
          try { window.scrollTo(0, 0) } catch { /* ignore */ }
        }}
      />
    )
  }

  if (metaWelcome || readMetaWelcome() || saving || metaLeadError) {
    return (
      <>
        <MetaAdsLanding
          celebrate
          initialLead={readMetaAdsLead() || {}}
          saving={saving && !metaLeadError}
          saveError={metaLeadError}
          onRetrySave={() => {
            setMetaLeadError('')
            setSaving(true)
            saveVerifiedMetaLead(readMetaAdsLead())
              .then(() => {
                writeMetaWelcome('congrats')
                setMetaWelcome(true)
              })
              .catch((err) => setMetaLeadError(err.message || 'Could not save your details. Please try again.'))
              .finally(() => setSaving(false))
          }}
          onSignIn={openSignIn}
          onContinueTrial={openTrialDemo}
        />
        <PwaInstallHost />
      </>
    )
  }

  return (
    <MetaAdsLanding
      onSignIn={openSignIn}
      onStartVerify={(lead) => {
        if (lead) writeMetaAdsLead({ ...lead, verified: false })
        window.history.pushState({}, '', '/trial-verify')
        setPublicPath('/trial-verify')
        setGuestAuthMode('meta-trial')
      }}
    />
  )
}

export function mountAdsShell() {
  const rootEl = document.getElementById('root')
  rootEl.__qgRoot = rootEl.__qgRoot || createRoot(rootEl)
  rootEl.__qgRoot.render(<AdsApp />)
}
