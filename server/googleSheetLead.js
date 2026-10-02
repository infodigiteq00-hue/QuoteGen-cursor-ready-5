import crypto from 'node:crypto'

const DEFAULT_SHEET_ID = '1rKISpU522DOODWglPH9QJ0hg-97rIUffwPwlKjJaSVk'
const SHEET_TAB = () => process.env.GOOGLE_SHEETS_TAB?.trim() || 'Sheet1'

function sheetId() {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || DEFAULT_SHEET_ID
}

function serviceAccount() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const key = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  if (!email || !key.includes('BEGIN PRIVATE KEY')) return null
  return { email, key }
}

let cachedToken = null

async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.email === account.email && cachedToken.expiresAt - 60 > now) {
    return cachedToken.value
  }
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: account.email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })).toString('base64url')
  const unsigned = `${header}.${payload}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  const assertion = `${unsigned}.${signer.sign(account.key).toString('base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google auth failed (${response.status})`)
  }
  cachedToken = { email: account.email, value: data.access_token, expiresAt: now + Number(data.expires_in || 3600) }
  return cachedToken.value
}

async function sheetsFetch(token, path, options = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.error?.message || `Google Sheets failed (${response.status})`
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return data
}

async function ensureExtraHeaders(token) {
  const range = encodeURIComponent(`${SHEET_TAB()}!I1:L1`)
  const current = await sheetsFetch(token, `/values/${range}`)
  if (String(current.values?.[0]?.[0] || '').trim()) return
  await sheetsFetch(token, `/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({
      values: [['Email', 'Company', 'Quotations per month', 'Industry']]
    })
  })
}

/** Append one lead. Columns A–H stay the n8n WhatsApp columns; form extras go at the end. */
export async function appendLeadToSheet(lead) {
  const account = serviceAccount()
  if (!account) return { ok: false, reason: 'not_configured' }
  const token = await accessToken(account)
  await ensureExtraHeaders(token)
  const range = encodeURIComponent(`${SHEET_TAB()}!A:L`)
  await sheetsFetch(token, `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({
      values: [[
        lead.name || '',
        lead.phone || '',
        '',
        '',
        '',
        '',
        '',
        '',
        lead.email || '',
        lead.company || '',
        lead.monthlyQuotes || '',
        lead.industry || ''
      ]]
    })
  })
  return { ok: true }
}
