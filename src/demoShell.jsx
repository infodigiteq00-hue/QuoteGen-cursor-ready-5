import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import MetaTrialGuide from './MetaTrialGuide.jsx'
import PaymentStatus from './PaymentStatus.jsx'
import SetPasswordScreen from './SetPasswordScreen.jsx'
import BrandMark from './BrandMark.jsx'
import { getCurrentSession, installAuthFetch, onAuthChange } from './apiAuth.js'
import { initMetaPixel } from './metaPixel.js'
import { clearMetaTrialLock, readMetaAdsLead, usefulLead } from './metaTrialLead.js'
import { saveCompanyProfile } from './quotePersistence.js'
import {
  DEMO_QUOTE_CAP,
  fetchDemoQuoteCount,
  generateTrialQuote,
  readDemoQuoteCount,
  recordDemoQuote
} from './demoQuotes.js'

installAuthFetch()
initMetaPixel()

function currentPath() {
  return String(window.location.pathname || '/').replace(/\/+$/, '') || '/'
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
  const lead = usefulLead(readMetaAdsLead()) || readMetaAdsLead()
  const [path, setPath] = useState(currentPath)
  const [ready, setReady] = useState(false)
  const [enquiry, setEnquiry] = useState('')
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [used, setUsed] = useState(() => readDemoQuoteCount(lead?.email))

  useEffect(() => {
    let cancelled = false
    const bootTimer = setTimeout(() => { if (!cancelled) setReady(true) }, 4500)
    getCurrentSession().finally(() => {
      clearTimeout(bootTimer)
      if (!cancelled) setReady(true)
    })
    const unsubscribe = onAuthChange(() => {})
    return () => { cancelled = true; clearTimeout(bootTimer); unsubscribe() }
  }, [])

  useEffect(() => {
    if (!lead?.email) return undefined
    let cancelled = false
    fetchDemoQuoteCount(lead).then((row) => {
      if (!cancelled) setUsed(row.used)
    })
    return () => { cancelled = true }
  }, [lead?.email])

  if (!ready) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3.5 bg-mist">
        <BrandMark size={56} alt="" />
        <div className="text-lg font-bold text-ink">QuoteGen</div>
      </main>
    )
  }

  if (path === '/set-password') {
    return (
      <SetPasswordScreen
        onDone={() => {
          clearMetaTrialLock()
          window.location.assign('/')
        }}
      />
    )
  }

  if (path === '/payment-status') {
    return (
      <PaymentStatus
        onPaid={() => {
          try { sessionStorage.setItem('qg_needs_password', '1') } catch { /* ignore */ }
        }}
        onContinue={(state) => {
          if (state === 'COMPLETED') {
            window.history.pushState({}, '', '/set-password')
            setPath('/set-password')
            return
          }
          window.location.assign('/demo')
        }}
      />
    )
  }

  if (!lead?.email) return <DemoGate />

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
          const row = await recordDemoQuote(lead)
          setUsed(row.used)
          return built
        } catch (err) {
          setError(err.message || 'Could not create the quotation.')
          return null
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
