import { normalizeIndiaMobileDigits } from '../shared/phone.js'

export const META_ADS_LEAD_KEY = 'qg_meta_ads_lead'
export const META_TRIAL_SEED_KEY = 'qg_trial_company_seed'
export const META_NEXT_KEY = 'qg_meta_ads_next'
export const META_PENDING_KEY = 'qg_meta_auth_pending'
export const META_GUIDE_KEY = 'qg_meta_guide'
export const META_UNPAID_KEY = 'qg_meta_trial_unpaid'
export const META_PAID_KEY = 'qg_meta_trial_paid'
export const META_GUIDE_PROGRESS_KEY = 'qg_meta_guide_progress'
export const META_WELCOME_KEY = 'qg_meta_welcome'

function writeStore(store, key, value) {
  try { store.setItem(key, value) } catch { /* private mode */ }
}

function readStore(store, key) {
  try { return store.getItem(key) || '' } catch { return '' }
}

function removeStore(store, key) {
  try { store.removeItem(key) } catch { /* private mode */ }
}

export function writeMetaTrialIntent(choice, lead) {
  const next = choice === 'company' ? 'company' : 'demo'
  writeStore(sessionStorage, META_NEXT_KEY, next)
  writeStore(localStorage, META_NEXT_KEY, next)
  writeStore(sessionStorage, META_PENDING_KEY, '1')
  writeStore(localStorage, META_PENDING_KEY, '1')
  markMetaTrialUnpaid(lead?.email)
}

export function readMetaTrialIntent() {
  let next = readStore(sessionStorage, META_NEXT_KEY) || readStore(localStorage, META_NEXT_KEY)
  const pending = readStore(sessionStorage, META_PENDING_KEY) === '1'
    || readStore(localStorage, META_PENDING_KEY) === '1'
  if (next !== 'demo' && next !== 'company') next = pending ? 'demo' : ''
  return { next, pending: Boolean(next) }
}

export function clearMetaTrialIntent() {
  removeStore(sessionStorage, META_NEXT_KEY)
  removeStore(localStorage, META_NEXT_KEY)
  removeStore(sessionStorage, META_PENDING_KEY)
  removeStore(localStorage, META_PENDING_KEY)
}

export function markMetaTrialUnpaid(email) {
  const value = String(email || '').trim().toLowerCase() || '1'
  writeStore(localStorage, META_UNPAID_KEY, value)
  writeStore(sessionStorage, META_UNPAID_KEY, value)
  writeStore(sessionStorage, META_GUIDE_KEY, '1')
}

export function markMetaTrialPaid() {
  writeStore(localStorage, META_PAID_KEY, '1')
  writeStore(sessionStorage, META_PAID_KEY, '1')
  removeStore(localStorage, META_UNPAID_KEY)
  removeStore(sessionStorage, META_UNPAID_KEY)
  removeStore(sessionStorage, META_GUIDE_KEY)
  removeStore(sessionStorage, META_GUIDE_PROGRESS_KEY)
}

export function isMetaTrialPaid() {
  return readStore(localStorage, META_PAID_KEY) === '1' || readStore(sessionStorage, META_PAID_KEY) === '1'
}

export function clearMetaTrialLock() {
  clearMetaTrialIntent()
  clearMetaWelcome()
  removeStore(localStorage, META_UNPAID_KEY)
  removeStore(sessionStorage, META_UNPAID_KEY)
  removeStore(sessionStorage, META_GUIDE_KEY)
  removeStore(sessionStorage, META_GUIDE_PROGRESS_KEY)
}

export function writeMetaWelcome(step = 'congrats') {
  const value = step === 'choice' ? 'choice' : 'congrats'
  writeStore(sessionStorage, META_WELCOME_KEY, value)
  writeStore(localStorage, META_WELCOME_KEY, value)
}

export function readMetaWelcome() {
  const value = readStore(sessionStorage, META_WELCOME_KEY) || readStore(localStorage, META_WELCOME_KEY)
  if (value === 'choice' || value === 'congrats') return value
  return ''
}

export function clearMetaWelcome() {
  removeStore(sessionStorage, META_WELCOME_KEY)
  removeStore(localStorage, META_WELCOME_KEY)
}

export function isMetaTrialUnpaid(userEmail) {
  if (isMetaTrialPaid()) return false
  const em = String(userEmail || '').trim().toLowerCase()
  if (!em) return false
  const flag = readStore(localStorage, META_UNPAID_KEY) || readStore(sessionStorage, META_UNPAID_KEY)
  if (!flag) return false
  return flag === '1' || flag === em
}

export function isMetaGuideActive(userEmail) {
  return isMetaTrialUnpaid(userEmail)
}

export function writeMetaGuideProgress(progress) {
  try {
    sessionStorage.setItem(META_GUIDE_PROGRESS_KEY, JSON.stringify(progress || {}))
  } catch { /* private mode */ }
}

export function readMetaGuideProgress() {
  try {
    const raw = sessionStorage.getItem(META_GUIDE_PROGRESS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function parseLead(raw) {
  if (!raw) return null
  try {
    const lead = JSON.parse(raw)
    return lead && typeof lead === 'object' ? lead : null
  } catch {
    return null
  }
}

export function usefulLead(lead) {
  if (!lead || typeof lead !== 'object') return null
  if (lead.email || lead.phone || lead.company || lead.name) return lead
  return null
}

export function readMetaAdsLead() {
  try {
    const seed = parseLead(localStorage.getItem(META_TRIAL_SEED_KEY))
    if (seed?.email || seed?.phone || seed?.company || seed?.name) return seed
  } catch { /* private mode */ }
  try {
    const session = parseLead(sessionStorage.getItem(META_ADS_LEAD_KEY))
    if (session?.email || session?.phone || session?.company || session?.name) return session
  } catch { /* private mode */ }
  return null
}

export function recordMetaLeadProgress(stage, leadOverride) {
  const lead = usefulLead(leadOverride) || readMetaAdsLead() || {}
  const email = String(lead.email || '').trim().toLowerCase()
  const phone = normalizeIndiaMobileDigits(lead.phone)
  if (!email || phone.length !== 10) return
  const next = stage === 'company' ? 'company' : 'demo'
  fetch('/api/meta-ads-leads/progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage: next,
      email,
      phone,
      name: lead.name || '',
      company: lead.company || ''
    })
  }).catch(() => {})
}

export function writeMetaAdsLead(lead) {
  if (!lead || typeof lead !== 'object') return
  // Merge with the stored lead so later partial writes (OTP / password setup)
  // cannot wipe monthlyQuotes / industry used for checkout packing.
  let prev = null
  try { prev = parseLead(sessionStorage.getItem(META_ADS_LEAD_KEY)) } catch { /* private mode */ }
  if (!prev) {
    try { prev = parseLead(localStorage.getItem(META_TRIAL_SEED_KEY)) } catch { /* private mode */ }
  }
  const src = { ...(prev && typeof prev === 'object' ? prev : {}), ...lead }
  const payload = {
    name: String(src.name || '').trim(),
    phone: String(src.phone || '').replace(/\D/g, ''),
    whatsappSame: src.whatsappSame !== false,
    whatsapp: String(src.whatsapp || src.phone || '').replace(/\D/g, ''),
    email: String(src.email || '').trim().toLowerCase(),
    company: String(src.company || '').trim(),
    monthlyQuotes: String(src.monthlyQuotes || '').trim(),
    industry: String(src.industry || '').trim(),
    source: String(src.source || 'meta_ads_landing').trim() || 'meta_ads_landing',
    path: String(src.path || '').trim(),
    query: String(src.query || '').trim(),
    submitted: true,
    submittedAt: src.submittedAt || new Date().toISOString(),
    verified: Boolean(src.verified),
    demoCode: Number(src.demoCode) || 0,
    id: src.id || null
  }
  try { sessionStorage.setItem(META_ADS_LEAD_KEY, JSON.stringify(payload)) } catch { /* ignore */ }
  try { localStorage.setItem(META_TRIAL_SEED_KEY, JSON.stringify(payload)) } catch { /* ignore */ }
}

let verifiedLeadSave = null

/** Persist a Meta ads lead only after the email code is verified. */
export function saveVerifiedMetaLead(leadOverride) {
  const lead = usefulLead(leadOverride) || readMetaAdsLead()
  if (!lead?.email) return Promise.reject(new Error('Enter your details again.'))
  if (lead.verified && lead.id) return Promise.resolve(lead)
  if (verifiedLeadSave) return verifiedLeadSave
  verifiedLeadSave = fetch('/api/meta-ads-leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: lead.name || '',
      phone: String(lead.phone || '').replace(/\D/g, ''),
      whatsapp: String(lead.whatsapp || lead.phone || '').replace(/\D/g, ''),
      whatsappSame: lead.whatsappSame !== false,
      email: lead.email,
      company: lead.company || '',
      monthlyQuotes: lead.monthlyQuotes || '',
      industry: lead.industry || '',
      source: lead.source || 'meta_ads_landing',
      path: lead.path || '',
      query: lead.query || '',
      submittedAt: lead.submittedAt || new Date().toISOString(),
      submitted: true
    })
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Could not save your details. Please try again.')
    }
    const saved = { ...lead, id: data.id || null, verified: true, submitted: true }
    writeMetaAdsLead(saved)
    return saved
  }).finally(() => {
    verifiedLeadSave = null
  })
  return verifiedLeadSave
}

export function formatLeadPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 10) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  }
  return String(phone || '').trim()
}

export function isPlaceholderCompanyName(name) {
  const n = String(name || '').trim().toLowerCase()
  return !n || n === 'my company' || n === 'your company' || n === 'your company name' || n === 'company name'
}

export function companySeedFromLead(lead, profile = null) {
  if (!lead && !profile) {
    return {
      profile: null,
      draft: { companyName: '', headerText: '', phone: '', email: '', standardTerms: '' }
    }
  }
  const leadCompany = String(lead?.company || '').trim()
  const leadName = String(lead?.name || '').trim()
  const profileName = String(profile?.companyName || '').trim()
  const companyName = leadCompany
    || (!isPlaceholderCompanyName(profileName) ? profileName : '')
    || leadName
  const phone = formatLeadPhone(lead?.phone || '')
  const email = String(lead?.email || '').trim()
  const profileHeader = String(profile?.headerText || '').trim()
  const contact = [phone, email].filter(Boolean).join(' · ')
  const headerLooksLikeContact = Boolean(
    profileHeader
    && !profileHeader.includes('\n')
    && (
      (email && profileHeader.toLowerCase().includes(email.toLowerCase()))
      || (phone && profileHeader.replace(/\s/g, '').includes(phone.replace(/\s/g, '')))
    )
  )
  const address = headerLooksLikeContact ? '' : profileHeader
  return {
    profile: {
      ...(profile || {}),
      companyName,
      headerText: address || contact,
      logoUrl: profile?.logoUrl || null,
      standardTerms: profile?.standardTerms || ''
    },
    draft: {
      companyName,
      headerText: address,
      phone,
      email,
      standardTerms: profile?.standardTerms || ''
    }
  }
}
