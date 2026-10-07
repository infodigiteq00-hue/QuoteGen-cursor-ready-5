/** Pure WhatsApp conversation decisions. No I/O, no logging. */

export const CONFIRM_DEBOUNCE_MS = 20_000
const SESSION_STALE_MS = 12 * 60 * 60 * 1000

const YES_RE = /^(y|yes|yeah|yep|yup|done|haan|han|ha|ji|ok|okay|okk|generate)[.!?\s]*$/i
const NO_RE = /^(n|no|nope|nah|nahi|naahi|na|not yet|more|add more)[.!?\s]*$/i
const GREET_RE = /^(hi+|hey+|hello+|hlo+|helo+|namaste|namaskar|good morning|good afternoon|good evening|gm)[.!?\s🙏]*$/i

export const GREETING_REPLIES = [
  { text: 'Hi! 👋 Welcome to QuoteGen.', delayMs: 0 },
  { text: 'Send your enquiry as a message, or as a PDF, Word, Excel, or photo.', delayMs: 500 }
]

export const CONFIRM_REPLY = {
  text: 'Have you uploaded all the documents? Reply YES to generate your quotation or NO to add more.',
  delayMs: 500
}

export const MORE_FILES_REPLY = {
  text: 'Sure, please send the remaining files.',
  delayMs: 0
}

export function normalizeChatText(raw) {
  return String(raw || '').replace(/[\u200e\u200f\ufeff]/g, '').trim()
}

export function classifyUtterance(text, hasFiles) {
  if (hasFiles) return 'content'
  const t = normalizeChatText(text)
  if (!t) return 'empty'
  if (GREET_RE.test(t)) return 'greeting'
  if (YES_RE.test(t)) return 'yes'
  if (NO_RE.test(t)) return 'no'
  return 'content'
}

function freshPieces(pieces, at) {
  const next = []
  const text = normalizeChatText(at.text)
  if (text && at.kind === 'content') {
    next.push({ kind: 'text', text: text.slice(0, 20000), at: at.nowIso })
  }
  for (const file of at.filePieces || []) {
    const body = String(file?.text || '').trim()
    if (!body) continue
    next.push({
      kind: 'file',
      filename: String(file.filename || 'file').slice(0, 120),
      text: body.slice(0, 20000),
      at: at.nowIso
    })
  }
  return pieces.concat(next).slice(-30)
}

/**
 * @returns {{ action: 'reply'|'generate', phase: string, pieces: object[], promptOpen: boolean, lastQuestionAt: string|null, replies: {text: string, delayMs: number}[] }}
 */
export function decideTurn(state, input, now = Date.now()) {
  const updatedAt = state?.updatedAt ? new Date(state.updatedAt).getTime() : 0
  const stale = updatedAt > 0 && now - updatedAt > SESSION_STALE_MS
  const pieces = stale ? [] : (Array.isArray(state?.pieces) ? state.pieces : [])
  const phase = stale ? 'idle' : (state?.phase || 'idle')
  const promptOpen = stale ? false : Boolean(state?.promptOpen)
  const lastQuestionAt = stale ? null : (state?.lastQuestionAt || null)
  const lastQuestionMs = lastQuestionAt ? new Date(lastQuestionAt).getTime() : 0
  const filePieces = Array.isArray(input?.filePieces) ? input.filePieces : []
  const kind = classifyUtterance(input?.text, filePieces.length > 0)
  const nowIso = new Date(now).toISOString()

  if (kind === 'greeting') {
    return {
      action: 'reply',
      phase: pieces.length ? phase : 'idle',
      pieces,
      promptOpen: pieces.length ? promptOpen : false,
      lastQuestionAt: pieces.length ? lastQuestionAt : null,
      replies: GREETING_REPLIES
    }
  }

  if (kind === 'yes') {
    if (!pieces.length) {
      return {
        action: 'reply',
        phase: 'idle',
        pieces: [],
        promptOpen: false,
        lastQuestionAt: null,
        replies: [{ text: 'Send the enquiry first — a message, PDF, Word, Excel, or photo — and I will prepare the quotation.', delayMs: 0 }]
      }
    }
    return { action: 'generate', phase: 'idle', pieces, promptOpen: false, lastQuestionAt: null, replies: [] }
  }

  if (kind === 'no') {
    return {
      action: 'reply',
      phase: 'collecting',
      pieces,
      promptOpen: false,
      lastQuestionAt: null,
      replies: [MORE_FILES_REPLY]
    }
  }

  if (kind === 'empty') {
    return {
      action: 'reply',
      phase,
      pieces,
      promptOpen,
      lastQuestionAt,
      replies: [{ text: 'Send your enquiry as a message, or as a PDF, Word, Excel, or photo.', delayMs: 0 }]
    }
  }

  const nextPieces = freshPieces(pieces, { text: input?.text, kind, filePieces, nowIso })
  const askedRecently = promptOpen && lastQuestionMs && now - lastQuestionMs < CONFIRM_DEBOUNCE_MS && phase === 'awaiting_confirm'
  if (askedRecently) {
    return {
      action: 'reply',
      phase: 'awaiting_confirm',
      pieces: nextPieces,
      promptOpen: true,
      lastQuestionAt,
      replies: []
    }
  }

  return {
    action: 'reply',
    phase: 'awaiting_confirm',
    pieces: nextPieces,
    promptOpen: true,
    lastQuestionAt: nowIso,
    replies: [CONFIRM_REPLY]
  }
}

export function enquiryFromPieces(pieces) {
  return (pieces || [])
    .map((piece) => {
      if (!piece?.text) return ''
      if (piece.kind === 'file') return `Attachment: ${piece.filename || 'file'}\n${piece.text}`
      return piece.text
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 80000)
}
