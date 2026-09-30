const DROP_LINE = /^(messages and calls are end-to-end encrypted.*|this message was deleted|you deleted this message|<media omitted>|image omitted|video omitted|audio omitted|sticker omitted|document omitted|gif omitted|contact card omitted|waiting for this message|this message is no longer available\.?)$/i
const CHAT_STAMP = /^\[(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}(?:,\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)?|\d{1,2}:\d{2}(?:\s*[ap]m)?)[^\]]*\]\s*/i
const CLOCK_PREFIX = /^\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?\s*[-–]\s*/i
const SPEC_LABEL = /^(qty|quantity|rate|amount|size|material|grade|hsn|gst|unit|uom|item|desc|description|spec|moc|make|brand|delivery|payment|note|notes|ref|reference|total)$/i
const CHATTER = /^(hi|hii|hello|hey|ok|okay|okk|thanks|thank you|thankyou|thx|sure|yes|yeah|yep|no|ji|haan|ha|hmm|noted|done)[.!?\s🙏👍]*$/i

function stripSpeaker(line) {
  const match = String(line || '').match(/^([^:\n]{1,40}):\s+([\s\S]+)$/)
  if (!match) return line
  const label = match[1].trim()
  if (SPEC_LABEL.test(label) || /\d/.test(label)) return line
  return match[2].trim()
}

export function looksLikeWhatsAppExport(raw) {
  const text = String(raw || '')
  if (/end-to-end encrypted/i.test(text)) return true
  if (/\[\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4},\s*\d{1,2}:\d{2}/.test(text)) return true
  const chatty = text.split('\n').filter((line) => CHAT_STAMP.test(line.trim()) || CLOCK_PREFIX.test(line.trim()))
  return chatty.length >= 2
}

export function sanitizeWhatsAppEnquiry(raw) {
  const text = String(raw || '')
    .replace(/[\u200e\u200f\ufeff\u202a\u202c]/g, '')
    .replace(/\r\n/g, '\n')
  if (!text.trim()) return ''
  if (!looksLikeWhatsAppExport(text)) return text.trim()

  const lines = text.split('\n').map((line) => {
    let next = String(line || '').trim()
    const stamped = CHAT_STAMP.test(next) || CLOCK_PREFIX.test(next)
    next = next.replace(CHAT_STAMP, '').replace(CLOCK_PREFIX, '').trim()
    if (stamped) next = stripSpeaker(next)
    return next
  }).filter((line) => line && !DROP_LINE.test(line) && !CHATTER.test(line))

  return lines.join('\n').trim() || text.trim()
}

export function whatsAppPasteReplacement(current, start, end, pasted) {
  if (!looksLikeWhatsAppExport(pasted)) return null
  const clean = sanitizeWhatsAppEnquiry(pasted)
  return String(current || '').slice(0, start) + clean + String(current || '').slice(end)
}
