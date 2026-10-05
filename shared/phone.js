/** India mobile: 10 digits starting 6–9, stored as +91XXXXXXXXXX. */

export const INDIA_COUNTRY_CODE = '+91'

export function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '')
}

/** Strip +91, 91, or a leading 0 so a pasted 11–13 digit value becomes the local mobile. */
export function normalizeIndiaMobileDigits(raw) {
  let digits = digitsOnly(raw)
  for (let pass = 0; pass < 4 && digits.length > 10; pass += 1) {
    if (digits.startsWith('91')) digits = digits.slice(2)
    else if (digits.startsWith('0')) digits = digits.slice(1)
    else break
  }
  if (digits.length > 10 && /[6-9]\d{9}$/.test(digits)) digits = digits.slice(-10)
  return digits
}

/** What the mobile field should show. A finished number snaps to 10 digits; a prefix can stay while it is typed. */
export function indiaMobileInputValue(raw) {
  const digits = digitsOnly(raw).slice(0, 13)
  const normalized = normalizeIndiaMobileDigits(digits)
  if (/^[6-9]\d{9}$/.test(normalized)) return normalized
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
