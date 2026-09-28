export const META_ADS_LEAD_KEY = 'qg_meta_ads_lead'
export const META_TRIAL_SEED_KEY = 'qg_trial_company_seed'
export const META_NEXT_KEY = 'qg_meta_ads_next'
export const META_PENDING_KEY = 'qg_meta_auth_pending'

function writeStore(store, key, value) {
  try { store.setItem(key, value) } catch { /* private mode */ }
}

function readStore(store, key) {
  try { return store.getItem(key) || '' } catch { return '' }
}

function removeStore(store, key) {
  try { store.removeItem(key) } catch { /* private mode */ }
}

export function writeMetaTrialIntent(choice) {
  const next = choice === 'company' ? 'company' : 'demo'
  writeStore(sessionStorage, META_NEXT_KEY, next)
  writeStore(localStorage, META_NEXT_KEY, next)
  writeStore(sessionStorage, META_PENDING_KEY, '1')
  writeStore(localStorage, META_PENDING_KEY, '1')
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
  const phone = String(lead.phone || '').replace(/\D/g, '')
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
  const payload = {
    name: String(lead.name || '').trim(),
    phone: String(lead.phone || '').replace(/\D/g, ''),
    email: String(lead.email || '').trim().toLowerCase(),
    company: String(lead.company || '').trim(),
    submitted: true,
    submittedAt: lead.submittedAt || new Date().toISOString()
  }
  try { sessionStorage.setItem(META_ADS_LEAD_KEY, JSON.stringify({ ...lead, ...payload })) } catch { /* ignore */ }
  try { localStorage.setItem(META_TRIAL_SEED_KEY, JSON.stringify(payload)) } catch { /* ignore */ }
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
