/** India mobile: 10 digits starting 6–9, stored as +91XXXXXXXXXX. */

export const INDIA_COUNTRY_CODE = '+91'

export function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '')
}

/** Strip leading 91 / 0 so we validate the local 10-digit mobile. */
export function normalizeIndiaMobileDigits(raw) {
  let digits = digitsOnly(raw)
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

export function isValidIndiaMobile(raw) {
  return /^[6-9]\d{9}$/.test(normalizeIndiaMobileDigits(raw))
}

export function toIndiaE164(raw) {
  const digits = normalizeIndiaMobileDigits(raw)
  if (!/^[6-9]\d{9}$/.test(digits)) return null
  return `${INDIA_COUNTRY_CODE}${digits}`
}

export function formatIndiaMobileDisplay(raw) {
  const e164 = toIndiaE164(raw) || (String(raw || '').startsWith('+91') ? String(raw) : null)
  if (!e164) {
    const digits = normalizeIndiaMobileDigits(raw)
    return digits ? `${INDIA_COUNTRY_CODE} ${digits}` : ''
  }
  return `${INDIA_COUNTRY_CODE} ${e164.slice(3)}`
}
