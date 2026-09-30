const META_ADS_LEADS_EMAILS = [
  'info@digiteqsolution.com',
  'info.digiteq00@gmail.com'
]

export function canManageMetaAdsLeads(email) {
  return META_ADS_LEADS_EMAILS.includes(String(email || '').trim().toLowerCase())
}
