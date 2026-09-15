export function superAdminEmails() {
  const raw = process.env.SUPER_ADMIN_EMAILS || 'info@digiteqsolution.com'
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export function isSuperAdmin(email) {
  return superAdminEmails().includes(String(email || '').trim().toLowerCase())
}
