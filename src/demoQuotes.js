import { companySeedFromLead, readMetaAdsLead } from './metaTrialLead.js'
import { defaultValidUntil, readPreferredPaperStyle } from './quotePaperThemes.js'
import { normalizeHeaderMeta } from '../shared/headerMeta.js'

export const DEMO_QUOTE_CAP = 10
const COUNT_KEY = 'qg_demo_quote_counts'

function emailKey(email) {
  return String(email || '').trim().toLowerCase()
}

function readMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COUNT_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function readDemoQuoteCount(email) {
  const key = emailKey(email)
  if (!key) return 0
  const n = Number(readMap()[key])
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function writeDemoQuoteCount(email, used) {
  const key = emailKey(email)
  if (!key) return 0
  const next = Math.max(0, Number(used) || 0)
  const map = readMap()
  map[key] = next
  try { localStorage.setItem(COUNT_KEY, JSON.stringify(map)) } catch { /* private mode */ }
  return next
}

export async function fetchDemoQuoteCount(lead) {
  const email = emailKey(lead?.email)
  const local = readDemoQuoteCount(email)
  if (!email) return { used: local, cap: DEMO_QUOTE_CAP, allowed: local < DEMO_QUOTE_CAP }
  try {
    const response = await fetch('/api/meta-ads-leads/demo-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'read',
        email,
        phone: lead?.phone || '',
        localUsed: local
      })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.persisted === false) return { used: local, cap: DEMO_QUOTE_CAP, allowed: local < DEMO_QUOTE_CAP }
    const used = Number.isFinite(Number(data.used)) ? Number(data.used) : local
    writeDemoQuoteCount(email, used)
    return { used, cap: DEMO_QUOTE_CAP, allowed: used < DEMO_QUOTE_CAP }
  } catch {
    return { used: local, cap: DEMO_QUOTE_CAP, allowed: local < DEMO_QUOTE_CAP }
  }
}

export async function recordDemoQuote(lead) {
  const email = emailKey(lead?.email)
  const local = readDemoQuoteCount(email) + 1
  writeDemoQuoteCount(email, local)
  try {
    const response = await fetch('/api/meta-ads-leads/demo-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'use',
        email,
        phone: lead?.phone || '',
        localUsed: Math.max(0, local - 1)
      })
    })
    const data = await response.json().catch(() => ({}))
    if (response.ok && Number.isFinite(Number(data.used))) {
      const used = Math.max(local, Number(data.used))
      writeDemoQuoteCount(email, used)
      return {
        used,
        pdfsExported: Number(data.pdfsExported) || 0,
        cap: DEMO_QUOTE_CAP,
        allowed: used < DEMO_QUOTE_CAP
      }
    }
  } catch { /* this phone still counts the quotation */ }
  return { used: local, pdfsExported: 0, cap: DEMO_QUOTE_CAP, allowed: local < DEMO_QUOTE_CAP }
}

const PDF_COUNT_KEY = 'qg_demo_pdf_exports'

function readPdfMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PDF_COUNT_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function readDemoPdfExportCount(email) {
  const key = emailKey(email)
  if (!key) return 0
  const n = Number(readPdfMap()[key])
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function writeDemoPdfExportCount(email, count) {
  const key = emailKey(email)
  if (!key) return 0
  const next = Math.max(0, Number(count) || 0)
  const map = readPdfMap()
  map[key] = next
  try { localStorage.setItem(PDF_COUNT_KEY, JSON.stringify(map)) } catch { /* private mode */ }
  return next
}

/** Count a successful demo PDF download for the Meta ads lead admin cards. */
export async function recordDemoPdfExport(lead) {
  const email = emailKey(lead?.email)
  const local = readDemoPdfExportCount(email) + 1
  writeDemoPdfExportCount(email, local)
  if (!email) return { pdfsExported: local }
  try {
    const response = await fetch('/api/meta-ads-leads/demo-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'export',
        email,
        phone: lead?.phone || '',
        localUsed: readDemoQuoteCount(email),
        localPdfsExported: Math.max(0, local - 1)
      })
    })
    const data = await response.json().catch(() => ({}))
    if (response.ok && Number.isFinite(Number(data.pdfsExported))) {
      const pdfsExported = Math.max(local, Number(data.pdfsExported))
      writeDemoPdfExportCount(email, pdfsExported)
      return { pdfsExported, used: Number(data.used) || readDemoQuoteCount(email) }
    }
  } catch { /* local count still stands */ }
  return { pdfsExported: local }
}

const defaultTerms = {
  validity: '15 days',
  delivery: 'To be confirmed',
  payment: 'To be confirmed',
  taxes: 'Extra as applicable',
  freight: 'To be confirmed'
}

function fallbackQuoteNumber() {
  return `QG-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`
}

async function fetchNextQuoteNumber() {
  try {
    const response = await fetch('/api/quotation-series/next')
    const data = await response.json().catch(() => ({}))
    if (response.ok && data?.number) return data.number
  } catch { /* series is optional during the demo */ }
  return fallbackQuoteNumber()
}

/** Build one demo quotation without opening the signed-in editor. */
export async function generateTrialQuote({ enquiry, columns, customer = {} }) {
  const enquiryText = String(enquiry || '').trim()
  if (!enquiryText) throw new Error('Paste the customer enquiry to generate a quotation.')
  const leadForCode = readMetaAdsLead()
  const demoCode = Number(leadForCode?.demoCode) || 0
  const response = await fetch('/api/generate-quotation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(demoCode ? { 'x-demo-code': String(demoCode) } : {})
    },
    body: JSON.stringify({ enquiry: enquiryText, customer, columns }),
    signal: AbortSignal.timeout(40000)
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Could not create the quotation.')
  const quoteNumber = await fetchNextQuoteNumber()
  const lead = readMetaAdsLead()
  return {
    ...data,
    columns: data.columns || columns,
    customer: {
      shippingSame: true,
      shippingLocation: '',
      ...(data.customer || {}),
      ...(customer?.company || customer?.name || customer?.gst ? customer : {})
    },
    number: quoteNumber,
    date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    companyProfile: companySeedFromLead(lead, null).profile || undefined,
    layoutRef: 'default',
    uploadTemplateId: null,
    paperStyle: readPreferredPaperStyle(),
    tableColorId: 'blue',
    watermarkEnabled: true,
    headerMeta: normalizeHeaderMeta(null),
    fields: {
      validUntil: defaultValidUntil(15),
      referenceNo: String(data.referenceNo || '').trim(),
      standardTerms: ''
    },
    terms: { ...defaultTerms, ...(data.terms || {}) }
  }
}
