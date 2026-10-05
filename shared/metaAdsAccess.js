const META_ADS_LEADS_EMAILS = [
  'info@digiteqsolution.com',
  'info.digiteq00@gmail.com'
]

/** Owner and staff logins. These are not customer leads. */
const INTERNAL_LEAD_EMAILS = [
  'info@digiteqsolution.com',
  'info.digiteq00@gmail.com',
  'infodigiteq@gmail.com'
]

const TEAM_LEAD_EMAILS = [
  'punitkamaliya4@gmail.com',
  'droplist1901@gmail.com',
  'dharmikchokhaliya62@gmail.com'
]

const TEAM_LEAD_NAMES = new Set([
  'varun',
  'varun kamaliya',
  'dharmik chokhaliya'
])

export function isInternalLeadEmail(email) {
  return INTERNAL_LEAD_EMAILS.includes(String(email || '').trim().toLowerCase())
}

export function isHiddenMetaLead(lead) {
  const email = String(lead?.email || '').trim().toLowerCase()
  const name = String(lead?.name || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return isInternalLeadEmail(email) || TEAM_LEAD_EMAILS.includes(email) || TEAM_LEAD_NAMES.has(name)
}

export function canManageMetaAdsLeads(email) {
  return META_ADS_LEADS_EMAILS.includes(String(email || '').trim().toLowerCase())
}
