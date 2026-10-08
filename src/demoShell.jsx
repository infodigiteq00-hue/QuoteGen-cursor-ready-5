import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import MetaTrialGuide from './MetaTrialGuide.jsx'
import MetaAdsLanding from './MetaAdsLanding.jsx'
import PaymentStatus from './PaymentStatus.jsx'
import AuthScreen from './AuthScreen.jsx'
import BrandMark from './BrandMark.jsx'
import { getCurrentSession, installAuthFetch, onAuthChange, signIn } from './apiAuth.js'
import { initMetaPixel } from './metaPixel.js'
import { clearMetaTrialLock, readMetaAdsLead, usefulLead, writeMetaAdsLead } from './metaTrialLead.js'
import { saveCompanyProfile } from './quotePersistence.js'
import {
  DEMO_QUOTE_CAP,
  fetchDemoQuoteCount,
  generateTrialQuote,
  readDemoQuoteCount,
  recordDemoQuote
} from './demoQuotes.js'
import { PaymentLinkPage, readPayAccount, savePayAccount, usePaymentRequestOffer } from './PaymentRequestPrompt.jsx'

installAuthFetch()
initMetaPixel()

function currentPath() {
  return String(window.location.pathname || '/').replace(/\/+$/, '') || '/'
}

function demoCodeFromPath(path) {
  const match = String(path || '').match(/^\/(?:d|demo)\/(\d+)$/)
  return match ? Number(match[1]) : 0
}

function DemoGate() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#07111f] px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101a2e] p-6 text-center text-white">
        <h1 className="text-2xl font-bold">Submit the enquiry first</h1>
        <p className="mt-3 text-sm text-slate-300">The demo opens after the QuoteGen enquiry form. Use the same phone you used for that form.</p>
        <a href="/metaadslanding" className="mt-5 inline-flex rounded-xl bg-[#1A73E8] px-4 py-3 text-sm font-semibold text-white">Open the enquiry form</a>
      </div>
    </main>
  )
}

function DemoApp() {
  const [path, setPath] = useState(currentPath)
  const demoCode = demoCodeFromPath(path)
  const payId = (String(path || '').match(/^\/pay\/([0-9a-f-]{36})$/i) || [])[1] || ''
  const quotationPay = String(path || '').match(/^\/quotation\/demo(\d+)\/paymentpage(\d+)$/i)
  const payDemo = quotationPay ? Number(quotationPay[1]) : 0
  const payAmount = quotationPay ? Number(quotationPay[2]) : 0
  const [lead, setLead] = useState(() => (demoCode ? null : (usefulLead(readMetaAdsLead()) || readMetaAdsLead())))
  const [ready, setReady] = useState(false)
  const [enquiry, setEnquiry] = useState('')
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [used, setUsed] = useState(() => readDemoQuoteCount(lead?.email))
  const [account, setAccount] = useState(null)
  const [previewDemo, setPreviewDemo] = useState(false)
  const [linkWelcomeDone, setLinkWelcomeDone] = useState(false)
  usePaymentRequestOffer({
    email: payId || payDemo ? '' : (lead?.email || ''),
    name: lead?.name || '',
    company: lead?.company || '',
    phone: lead?.phone || ''
  })

  const openAccount = (row, session) => {
    setAccount(row)
    if (!row?.verified) return 'gate'
    if (session && row.plan === 'demo') return 'demo'
    if (row.needsPassword) return 'password'
    if (!session) return 'login'
    if (row.plan === 'demo') return 'demo'
    window.location.assign('/')
    return 'leave'
  }

  useEffect(() => {
    if (!demoCode) return undefined
    let cancelled = false
    fetch(`/api/meta-ads-trial/demo/${demoCode}`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        const next = data?.lead
        if (!ok || !next || (!next.email && !next.phone)) {
          setAccount({ verified: false, step: 'gate' })
          setReady(true)
          return
        }
        writeMetaAdsLead({ ...next, verified: true, demoCode })
        setLead({ ...next, demoCode })
        setUsed(readDemoQuoteCount(next.email))
        setAccount({ verified: true, plan: 'demo', step: 'demo', needsPassword: false })
        setReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setAccount({ verified: false, step: 'gate' })
        setReady(true)
      })
    return () => { cancelled = true }
  }, [demoCode])

  useEffect(() => {
    if (payId || payDemo) {
      setReady(true)
      return undefined
    }
    if (demoCode || previewDemo) return undefined
    let cancelled = false
    const bootTimer = setTimeout(() => { if (!cancelled) setReady(true) }, 4500)
    const email = lead?.email
    const savedAccount = path === '/set-password' ? readPayAccount() : null
    if (savedAccount?.email) {
      clearTimeout(bootTimer)
      setLead({
        ...(usefulLead(readMetaAdsLead()) || {}),
        email: savedAccount.email,
        name: savedAccount.name || '',
        phone: savedAccount.phone || '',
        company: savedAccount.company || ''
      })
      setAccount({ verified: true, needsPassword: true, step: 'password', plan: 'paid' })
      setReady(true)
      return
    }
    Promise.all([
      getCurrentSession(),
      email
        ? fetch('/api/meta-ads-trial/account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        }).then((response) => response.json().catch(() => ({}))).catch(() => ({}))
        : Promise.resolve(null)
    ]).then(([session, row]) => {
      clearTimeout(bootTimer)
      if (cancelled) return
      let adminPreview = false
      try { adminPreview = sessionStorage.getItem('qg_admin_demo_preview') === '1' } catch { /* ignore */ }
      if (adminPreview && session?.user) {
        try { sessionStorage.removeItem('qg_admin_demo_preview') } catch { /* ignore */ }
        setPreviewDemo(true)
        if (!email) {
          setLead({
            name: session.user.user_metadata?.name || 'Preview',
            email: session.user.email || '',
            company: ''
          })
        }
        setAccount({ verified: true, plan: 'demo', step: 'demo', needsPassword: false })
        setReady(true)
        return
      }
      if (!email) {
        setAccount({ verified: false })
      } else if (row && row.verified != null) {
        const next = openAccount(row, session)
        setAccount({ ...row, step: next })
      } else if (session) {
        setAccount({ verified: true, plan: 'demo', step: 'demo' })
      } else {
        setAccount({ verified: true, needsPassword: true, step: 'password' })
      }
      setReady(true)
    })
    const unsubscribe = onAuthChange(() => {})
    return () => { cancelled = true; clearTimeout(bootTimer); unsubscribe() }
  }, [demoCode, lead?.email, previewDemo])

  useEffect(() => {
    if (!ready) return
    try { sessionStorage.removeItem('qg_demo_from_intro') } catch { /* ignore */ }
  }, [ready])

  useEffect(() => {
    if (!lead?.email) return undefined
    let cancelled = false
    fetchDemoQuoteCount(lead).then((row) => {
      if (!cancelled) setUsed(row.used)
    })
    return () => { cancelled = true }
  }, [lead?.email])

  if (payId || payDemo) return <PaymentLinkPage requestId={payId} demoCode={payDemo} amount={payAmount} />

  if (!ready) {
    let fromIntro = false
    try { fromIntro = sessionStorage.getItem('qg_demo_from_intro') === '1' } catch { /* ignore */ }
    if (fromIntro) return <main style={{ minHeight: '100vh', background: '#000' }} />
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3.5 bg-mist">
        <BrandMark size={56} alt="" />
        <div className="text-lg font-bold text-ink">QuoteGen</div>
      </main>
    )
  }

  if (path === '/payment-status') {
    return (
      <PaymentStatus
        onPaid={() => { clearMetaTrialLock() }}
        onAccountReady={(details) => {
          savePayAccount(details)
          window.location.assign('/set-password')
        }}
        onContinue={(state) => {
          window.location.assign(state === 'COMPLETED' ? '/' : '/demo')
        }}
      />
    )
  }

  if (!lead?.email || account?.verified === false) return <DemoGate />

  if (account?.step === 'password') {
    return (
      <AuthScreen
        initialMode="create-password"
        prefillEmail={lead.email}
        prefillPhone={lead.phone || ''}
        leadName={lead.name || ''}
        leadCompany={lead.company || ''}
        accountReady={account?.plan === 'paid'}
        onCreatePassword={async (password) => {
          const response = await fetch('/api/meta-ads-trial/set-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: lead.email,
              password,
              name: lead.name || '',
              phone: lead.phone || '',
              company: lead.company || ''
            })
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error || 'Could not save the password.')
          if (data.plan === 'legacy' || data.needsLogin) {
            window.location.assign('/signin')
            return
          }
          await signIn(lead.email, password)
          if (data.plan === 'demo') {
            setAccount({ verified: true, plan: 'demo', step: 'demo', needsPassword: false })
            return
          }
          window.location.assign('/')
        }}
      />
    )
  }

  if (account?.step === 'leave') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mist">
        <div className="text-lg font-bold text-ink">Opening QuoteGen…</div>
      </main>
    )
  }

  if (demoCode && account?.step === 'demo' && !linkWelcomeDone) {
    return (
      <MetaAdsLanding
        celebrate
        initialLead={lead}
        onSignIn={() => window.location.assign('/signin')}
        onContinueTrial={() => setLinkWelcomeDone(true)}
      />
    )
  }

  if (account?.step === 'login') {
    return (
      <AuthScreen
        initialMode="login"
        prefillEmail={lead.email}
        onLoggedIn={() => {
          if (account.plan === 'demo') setAccount({ ...account, step: 'demo' })
          else window.location.assign('/')
        }}
      />
    )
  }

  return (
    <MetaTrialGuide
      enquiry={enquiry}
      setEnquiry={setEnquiry}
      columns={columns}
      loading={loading}
      error={error}
      companyProfile={profile}
      trialLead={lead}
      demoQuotesUsed={used}
      demoQuoteCap={DEMO_QUOTE_CAP}
      onSaveCompany={async (partial) => {
        const result = await saveCompanyProfile(partial)
        const next = result?.profile || { ...(profile || {}), ...partial }
        setProfile(next)
        return next
      }}
      onCompanyProfileSaved={(next) => { if (next) setProfile(next) }}
      onGenerate={async (nextColumns) => {
        if (used >= DEMO_QUOTE_CAP) {
          setError('You have used all 10 demo quotations. Join QuoteGen to continue.')
          return null
        }
        setColumns(nextColumns)
        setLoading(true)
        setError('')
        try {
          const built = await generateTrialQuote({ enquiry, columns: nextColumns })
          const row = previewDemo ? { used } : await recordDemoQuote(lead)
          setUsed(row.used)
          return built
        } catch (err) {
          const message = err.message || 'Could not create the quotation.'
          setError(message)
          throw new Error(message)
        } finally {
          setLoading(false)
        }
      }}
      onTryAnother={() => {
        setEnquiry('')
        setError('')
      }}
    />
  )
}

export function mountDemoShell() {
  const rootEl = document.getElementById('root')
  rootEl.__qgRoot = rootEl.__qgRoot || createRoot(rootEl)
  rootEl.__qgRoot.render(<DemoApp />)
}
