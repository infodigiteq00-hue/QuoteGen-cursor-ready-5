/**
 * Transactional mail for admin alerts (feature interest, etc.).
 * Prefer Resend (HTTPS). Optional SMTP via nodemailer if you add the package later —
 * for now Resend alone keeps deploys dependency-light.
 */
export async function sendAdminEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = (process.env.FEATURE_INTEREST_FROM || process.env.MAIL_FROM || 'QuoteGen <onboarding@resend.dev>').trim()
  const dest = String(to || process.env.FEATURE_INTEREST_NOTIFY || 'info@digiteqsolution.com').trim()
  if (!dest) return { ok: false, error: 'No notify address configured.' }
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY is not set. Interest was saved; email was not sent.' }
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [dest],
        subject: String(subject || 'QuoteGen notice'),
        text: String(text || '')
      })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return { ok: false, error: data?.message || `Email provider returned ${response.status}` }
    }
    return { ok: true, id: data?.id || null }
  } catch (error) {
    return { ok: false, error: error?.message || 'Could not send email' }
  }
}
