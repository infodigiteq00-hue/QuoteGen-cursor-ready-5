import crypto from 'node:crypto'
import { normalizeIndiaMobileDigits } from '../shared/phone.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEMO_LINK_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demoLinks.json')

const DEFAULT_SHEET_ID = '1rKISpU522DOODWglPH9QJ0hg-97rIUffwPwlKjJaSVk'
const SHEET_TAB = () => process.env.GOOGLE_SHEETS_TAB?.trim() || 'Sheet1'
/** Personal demo URL. The number is the sheet row, so row 12 is www.quotegen.ai/demo/12. */
export function shortDemoLink(code) {
  const n = Number(code)
  if (!Number.isInteger(n) || n < 2) return ''
  return `https://www.quotegen.ai/demo/${n}`
}

function leadFromSheetRow(row, code) {
  if (!row?.some((cell) => String(cell || '').trim())) return null
  const phone = String(row[1] || '').replace(/\D/g, '').slice(-10)
  const email = String(row[8] || '').trim().toLowerCase()
  if (!email && phone.length !== 10) return null
  return {
    name: String(row[0] || '').trim(),
    phone,
    email,
    company: String(row[9] || '').trim(),
    monthlyQuotes: String(row[10] || '').trim(),
    industry: String(row[11] || '').trim(),
    demoCode: code,
    source: 'demo_link'
  }
}

function bundledDemoLead(code) {
  try {
    const rows = JSON.parse(fs.readFileSync(DEMO_LINK_FILE, 'utf8'))
    return (Array.isArray(rows) ? rows : []).find((row) => Number(row.demoCode) === Number(code)) || null
  } catch {
    return null
  }
}

function demoCodeFromLink(value) {
  const match = String(value || '').match(/\/demo\/(\d+)/i)
  const code = match ? Number(match[1]) : 0
  return Number.isInteger(code) && code >= 2 ? code : 0
}

/** Outreach columns n8n keeps on the sheet: Video Seen (E) and Reminders Sent (F). Demo number comes from the link in column M. */
export async function readSheetOutreach() {
  const account = serviceAccount()
  if (!account) return []
  try {
    const token = await accessToken(account)
    const range = encodeURIComponent(`${SHEET_TAB()}!A2:M`)
    const data = await sheetsFetch(token, `/values/${range}`)
    return (data.values || []).flatMap((row, index) => {
      const phone = normalizeIndiaMobileDigits(row[1])
      const email = String(row[8] || '').trim().toLowerCase()
      const demoCode = demoCodeFromLink(row[12]) || index + 2
      if (!phone && !email) return []
      const remindersRaw = String(row[5] || '').trim()
      const remindersSent = /^\d+$/.test(remindersRaw) ? Number(remindersRaw) : null
      return [{
        phone,
        email,
        demoCode,
        videoSeen: String(row[4] || '').trim(),
        remindersSent,
        lastReply: String(row[7] || '').trim()
      }]
    })
  } catch (error) {
    console.warn('[sheet] outreach read failed', error.message)
    return []
  }
}

export async function findDemoCodeForLead({ email = '', phone = '' } = {}) {
  const em = String(email || '').trim().toLowerCase()
  const ph = normalizeIndiaMobileDigits(phone)
  const rows = await readSheetOutreach()
  const hit = rows.find((row) => (em && row.email === em) || (ph.length === 10 && row.phone === ph))
  if (hit?.demoCode) return hit.demoCode
  try {
    const saved = JSON.parse(fs.readFileSync(DEMO_LINK_FILE, 'utf8'))
    const local = (Array.isArray(saved) ? saved : []).find((row) => (
      (em && String(row.email || '').trim().toLowerCase() === em)
      || (ph.length === 10 && normalizeIndiaMobileDigits(row.phone) === ph)
    ))
    const code = Number(local?.demoCode)
    return Number.isInteger(code) && code >= 2 ? code : 0
  } catch {
    return 0
  }
}

export async function readDemoLeadByCode(code) {
  const n = Number(code)
  if (!Number.isInteger(n) || n < 2) return null
  try {
    const account = serviceAccount()
    if (account) {
      const token = await accessToken(account)
      const range = encodeURIComponent(`${SHEET_TAB()}!A${n}:L${n}`)
      const data = await sheetsFetch(token, `/values/${range}`)
      const lead = leadFromSheetRow(data.values?.[0] || [], n)
      if (lead) return lead
    }
  } catch (error) {
    console.warn('[demo-link] sheet lookup failed', error.message)
  }
  return bundledDemoLead(n)
}

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
  const range = encodeURIComponent(`${SHEET_TAB()}!I1:M1`)
  const current = await sheetsFetch(token, `/values/${range}`)
  const row = current.values?.[0] || []
  const next = [
    String(row[0] || '').trim() || 'Email',
    String(row[1] || '').trim() || 'Company',
    String(row[2] || '').trim() || 'Quotations per month',
    String(row[3] || '').trim() || 'Industry',
    String(row[4] || '').trim() || 'Demo link'
  ]
  const missingDemo = !String(row[4] || '').trim()
  const missingEmail = !String(row[0] || '').trim()
  if (!missingDemo && !missingEmail) return
  await sheetsFetch(token, `/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [next] })
  })
}

/** Append one lead. Columns A–H stay the n8n WhatsApp columns; form extras go at the end. */
export async function appendLeadToSheet(lead) {
  const account = serviceAccount()
  if (!account) return { ok: false, reason: 'not_configured' }
  const token = await accessToken(account)
  await ensureExtraHeaders(token)
  const range = encodeURIComponent(`${SHEET_TAB()}!A:M`)
  const phone = lead.whatsapp || lead.phone || ''
  const appended = await sheetsFetch(token, `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    body: JSON.stringify({
      values: [[
        lead.name || '',
        phone,
        '',
        '',
        '',
        '',
        '',
        '',
        lead.email || '',
        lead.company || '',
        lead.monthlyQuotes || '',
        lead.industry || '',
        ''
      ]]
    })
  })
  const rowMatch = String(appended.updates?.updatedRange || '').match(/!(?:[A-Z]+)(\d+)/i)
  const code = rowMatch ? Number(rowMatch[1]) : 0
  const link = shortDemoLink(code)
  if (link) {
    const cell = encodeURIComponent(`${SHEET_TAB()}!M${code}`)
    await sheetsFetch(token, `/values/${cell}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [[link]] })
    })
  }
  return { ok: true, demoLink: link }
}

/** Fill column M only. Columns A–L are left untouched. */
export async function backfillDemoLinks() {
  const account = serviceAccount()
  if (!account) return { ok: false, reason: 'not_configured' }
  const token = await accessToken(account)
  await ensureExtraHeaders(token)
  const readRange = encodeURIComponent(`${SHEET_TAB()}!A2:M`)
  const current = await sheetsFetch(token, `/values/${readRange}`)
  const rows = current.values || []
  const links = rows.map((row, index) => {
    const blank = row.every((cell) => !String(cell || '').trim())
    if (blank) return ['']
    return [shortDemoLink(index + 2)]
  })
  const packed = rows.flatMap((row, index) => {
    const lead = leadFromSheetRow(row, index + 2)
    return lead ? [lead] : []
  })
  fs.writeFileSync(DEMO_LINK_FILE, `${JSON.stringify(packed, null, 2)}\n`)
  if (!links.length) return { ok: true, updated: 0 }
  const writeRange = encodeURIComponent(`${SHEET_TAB()}!M2:M${links.length + 1}`)
  await sheetsFetch(token, `/values/${writeRange}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: links })
  })
  return { ok: true, updated: links.filter((cell) => cell[0]).length }
}
