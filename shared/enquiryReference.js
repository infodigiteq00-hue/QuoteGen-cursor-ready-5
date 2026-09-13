/**
 * Pull a customer / enquiry reference number from free text when present.
 * Returns '' when none is found — blank is a valid outcome.
 */
export function extractEnquiryReference(text = '') {
  const raw = String(text || '')
  if (!raw.trim()) return ''

  const patterns = [
    /\b(?:your\s+)?(?:ref(?:erence)?|enquiry|enquir(?:y|ies)|indent|requisition|pr|po|purchase\s*order)\s*(?:no\.?|number|#)?\s*[:\-–]?\s*([A-Z0-9][A-Z0-9./_-]{2,40})\b/i,
    /\b(?:ref(?:erence)?|enquiry)\s*(?:no\.?|number|#)\s*[:\-–]?\s*([A-Z0-9][A-Z0-9./_-]{2,40})\b/i,
    /\b(?:our\s+)?ref\.?\s*[:\-–]\s*([A-Z0-9][A-Z0-9./_-]{2,40})\b/i,
    /\breference\s*(?:no\.?|number|#)?\s*[:\-–]\s*([A-Z0-9][A-Z0-9./_-]{2,40})\b/i
  ]

  for (const re of patterns) {
    const m = raw.match(re)
    if (!m?.[1]) continue
    const value = String(m[1]).trim()
    // Skip false positives that are clearly dates or bare years
    if (/^\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?$/.test(value)) continue
    if (/^(19|20)\d{2}$/.test(value)) continue
    // Skip catalog line-ref / material codes that are just long digit runs without a label nearby
    if (/^\d{8,12}$/.test(value) && !/ref|enquiry|indent|requisition|po\b|pr\b/i.test(m[0])) continue
    return value
  }
  return ''
}

export function normalizeReferenceNo(value) {
  return String(value ?? '').trim()
}
