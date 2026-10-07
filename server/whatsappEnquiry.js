/**
 * WhatsApp chatbot intake.
 *
 * The chatbot POSTs the customer's message. QuoteGen runs the same quotation
 * generator as the app, saves it on the account that owns that mobile number,
 * and returns a preview link. QuoteGen does not send the WhatsApp reply.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { decideTurn, enquiryFromPieces } from './whatsappConversation.js'
import { getSupabase, isSupabaseConfigured } from './db.js'
import { assertCanCreateQuotation } from './accountAccess.js'
import { extractKnowledgeText } from './knowledgeExtract.js'
import { isValidIndiaMobile, normalizeIndiaMobileDigits } from '../shared/phone.js'
import { normalizeHeaderMeta } from '../shared/headerMeta.js'

const PREVIEW_ORIGIN = String(process.env.PUBLIC_APP_URL || 'https://www.quotegen.ai').replace(/\/$/, '')
const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

const DEFAULT_COLUMNS = [
  { id: 'description', label: 'Description' },
  { id: 'unit', label: 'Unit' },
  { id: 'quantity', label: 'Quantity' },
  { id: 'rate', label: 'Rate' },
  { id: 'amount', label: 'Amount' }
]

const DEFAULT_TERMS = {
  validity: '15 days',
  delivery: 'To be confirmed',
  payment: 'To be confirmed',
  taxes: 'Extra as applicable',
  freight: 'To be confirmed'
}

function presentedSecret(req) {
  const header = String(req.get('x-quotegen-whatsapp-secret') || '').trim()
  if (header) return header
  const auth = String(req.headers.authorization || '')
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  return ''
}

function secretMatches(given, expected) {
  const a = Buffer.from(String(given || ''))
  const b = Buffer.from(String(expected || ''))
  if (!a.length || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function asText(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && typeof value.body === 'string') return value.body.trim()
  return ''
}

function collectMessages(body) {
  if (!body || typeof body !== 'object') return []
  if (Array.isArray(body.messages) && body.messages.length) return body.messages
  const fromMeta = []
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const messages = change?.value?.messages
      if (Array.isArray(messages)) fromMeta.push(...messages)
    }
  }
  if (fromMeta.length) return fromMeta
  return [body]
}

function senderPhone(messages, body) {
  for (const msg of messages) {
    const raw = msg?.from || msg?.sender || msg?.wa_id || msg?.phone || msg?.mobile || ''
    if (String(raw).trim()) return String(raw).trim()
  }
  return String(body?.from || body?.sender || body?.wa_id || body?.phone || body?.mobile || '').trim()
}

function pushAttachment(list, file, caption) {
  if (!file || typeof file !== 'object') return
  const filename = String(file.filename || file.name || file.fileName || 'attachment').trim() || 'attachment'
  const mime = String(file.mime || file.mime_type || file.mimetype || file.contentType || '').trim()
  const url = String(file.url || file.link || file.mediaUrl || file.media_url || '').trim()
  const data = file.data || file.base64 || file.file || ''
  if (!url && !data) return
  list.push({ filename, mime, url, data, caption: asText(caption || file.caption) })
}

function messageAttachments(msg) {
  const list = []
  if (Array.isArray(msg?.attachments)) {
    for (const file of msg.attachments) pushAttachment(list, file)
  }
  pushAttachment(list, msg?.attachment)
  pushAttachment(list, msg?.document, msg?.document?.caption)
  if (msg?.image) pushAttachment(list, { ...msg.image, filename: msg.image.filename || 'image.jpg', mime: msg.image.mime_type || 'image/jpeg' }, msg.image.caption)
  return list.slice(0, MAX_ATTACHMENTS)
}

function safeHttpsUrl(raw) {
  let url
  try { url = new URL(String(raw || '')) } catch { return null }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === '0.0.0.0' || host === '::1') return null
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return null
  }
  return url
}

function decodeAttachment(raw) {
  const text = String(raw || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '')
  if (!text || text.length < 16) return null
  const buf = Buffer.from(text, 'base64')
  if (!buf.length || buf.length > MAX_ATTACHMENT_BYTES) return null
  return buf
}

async function downloadAttachment(url) {
  const safe = safeHttpsUrl(url)
  if (!safe) return null
  const response = await fetch(safe, { signal: AbortSignal.timeout(15000), redirect: 'follow' })
  if (!response.ok) return null
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_ATTACHMENT_BYTES) return null
  const buf = Buffer.from(await response.arrayBuffer())
  if (!buf.length || buf.length > MAX_ATTACHMENT_BYTES) return null
  const mime = String(response.headers.get('content-type') || '').split(';')[0].trim()
  return { buffer: buf, mime }
}

function sidecarBank(footerText) {
  const raw = String(footerText || '')
  const mark = '__QG_BANK__'
  const idx = raw.indexOf(mark)
  if (idx < 0) return {}
  try {
    const parsed = JSON.parse(raw.slice(idx + mark.length).trim())
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function columnsFromProfile(row, bank) {
  const layouts = Array.isArray(bank.columnLayouts) ? bank.columnLayouts : []
  const active = layouts.find((layout) => layout && layout.id === bank.activeColumnLayoutId) || layouts[0]
  if (Array.isArray(active?.columns) && active.columns.length) return active.columns
  if (Array.isArray(row?.column_layout) && row.column_layout.length) return row.column_layout
  return DEFAULT_COLUMNS
}

function quoteDateLabel(date = new Date()) {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function validUntilLabel(days = 15) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

async function allocateNumber(supabase, userId) {
  const { data, error } = await supabase.rpc('allocate_quotation_number', { p_user_id: userId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  const number = String(row?.number || '').trim()
  if (!number) {
    const err = new Error('Could not allocate a quotation number.')
    err.status = 503
    throw err
  }
  return number
}

function maskPhone(digits) {
  const tail = String(digits || '').slice(-4)
  return tail ? `…${tail}` : 'unknown'
}

function customerReply(text, delayMs = 0) {
  return { ok: true, replies: [{ text, delayMs }] }
}

function limitReply(blocked) {
  const code = blocked?.body?.code
  if (code === 'QUOTE_LIMIT_REACHED') {
    return 'This account has reached its quotation limit for now. Open QuoteGen to continue.'
  }
  if (code === 'ACCOUNT_PAUSED') {
    return 'This QuoteGen account is paused, so I cannot create a quotation right now.'
  }
  if (code === 'ACCOUNT_REMOVED') {
    return 'This QuoteGen account is disabled. Please contact QuoteGen support.'
  }
  return 'I cannot create a quotation on this account right now. Please open QuoteGen and try again.'
}

async function loadSession(supabase, digits) {
  const { data, error } = await supabase
    .from('whatsapp_sessions')
    .select('phase, pieces, prompt_open, last_question_at, updated_at')
    .eq('phone_digits', digits)
    .maybeSingle()
  if (error) throw error
  return {
    phase: data?.phase || 'idle',
    pieces: Array.isArray(data?.pieces) ? data.pieces : [],
    promptOpen: Boolean(data?.prompt_open),
    lastQuestionAt: data?.last_question_at || null,
    updatedAt: data?.updated_at || null
  }
}

async function saveSession(supabase, digits, turn) {
  const { error } = await supabase.from('whatsapp_sessions').upsert({
    phone_digits: digits,
    phase: turn.phase,
    pieces: turn.pieces,
    prompt_open: Boolean(turn.promptOpen),
    last_question_at: turn.lastQuestionAt,
    updated_at: new Date().toISOString()
  })
  if (error) throw error
}

async function rememberResponse(supabase, messageId, digits, response) {
  if (!messageId) {
    await supabase.from('whatsapp_inbound').insert({
      message_id: randomUUID(),
      phone_digits: digits,
      response
    })
    return
  }
  await supabase.from('whatsapp_inbound').update({ response }).eq('message_id', messageId)
}

async function recentInboundCount(supabase, digits) {
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from('whatsapp_inbound')
    .select('message_id', { count: 'exact', head: true })
    .eq('phone_digits', digits)
    .gte('created_at', since)
  if (error) throw error
  return count || 0
}

async function claimMessage(supabase, messageId, digits) {
  if (!messageId) return { fresh: true }
  const { error } = await supabase.from('whatsapp_inbound').insert({
    message_id: messageId,
    phone_digits: digits,
    response: null
  })
  if (!error) return { fresh: true }
  if (error.code !== '23505') throw error
  const { data, error: readError } = await supabase
    .from('whatsapp_inbound')
    .select('response')
    .eq('message_id', messageId)
    .maybeSingle()
  if (readError) throw readError
  return { fresh: false, response: data?.response || null }
}

async function findAccount(supabase, digits) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, phone_digits, updated_at')
    .eq('phone_digits', digits)
    .order('updated_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] || null
}

async function readFilePieces(files, requestId) {
  const pieces = []
  const failed = []
  for (const file of files.slice(0, MAX_ATTACHMENTS)) {
    try {
      let buffer = file.data ? decodeAttachment(file.data) : null
      let mime = file.mime
      if (!buffer && file.url) {
        const downloaded = await downloadAttachment(file.url)
        if (downloaded) {
          buffer = downloaded.buffer
          mime = mime || downloaded.mime
        }
      }
      if (!buffer) {
        failed.push(file.filename)
        continue
      }
      const extracted = await extractKnowledgeText({
        buffer,
        originalname: file.filename,
        mimetype: mime || 'application/octet-stream'
      })
      const text = String(extracted?.text || '').trim()
      if (!text) {
        failed.push(file.filename)
        continue
      }
      const caption = file.caption ? `${file.caption}\n` : ''
      pieces.push({ filename: file.filename, text: `${caption}${text}` })
    } catch (error) {
      console.warn(`[${requestId}] attachment skipped`, error?.message || error)
      failed.push(file.filename)
    }
  }
  return { pieces, failed }
}

async function createQuotation({ supabase, profile, enquiry, generateQuotationDraft, requestId }) {
  const { data: companyRow } = await supabase
    .from('company_profile')
    .select('column_layout, footer_text, default_upload_template_id')
    .eq('user_id', profile.user_id)
    .maybeSingle()
  const bank = sidecarBank(companyRow?.footer_text)
  let columns = columnsFromProfile(companyRow, bank)
  const templateId = bank.defaultUploadTemplateId !== undefined
    ? bank.defaultUploadTemplateId
    : (companyRow?.default_upload_template_id || null)
  let uploadTemplateId = null
  if (templateId) {
    const { data: template } = await supabase
      .from('upload_templates')
      .select('id, mapping')
      .eq('id', templateId)
      .eq('user_id', profile.user_id)
      .maybeSingle()
    if (template?.mapping?.columns?.length) {
      columns = template.mapping.columns
      uploadTemplateId = template.id
    }
  }

  const draft = await generateQuotationDraft({
    enquiry,
    customer: {},
    columns,
    userId: profile.user_id,
    requestId
  })
  const number = await allocateNumber(supabase, profile.user_id)
  const customer = { shippingSame: true, shippingLocation: '', ...(draft.customer || {}) }
  const commercial = bank.commercialTerms && typeof bank.commercialTerms === 'object' ? bank.commercialTerms : {}
  const payload = {
    title: String(draft.title || customer.company || customer.name || 'WhatsApp enquiry').trim() || 'WhatsApp enquiry',
    number,
    date: quoteDateLabel(),
    columns: draft.columns || columns,
    customer,
    items: Array.isArray(draft.items) ? draft.items : [],
    extraLines: [],
    billAdjustments: {},
    notes: Array.isArray(draft.notes) ? draft.notes : [],
    clarifications: Array.isArray(draft.clarifications) ? draft.clarifications : [],
    terms: { ...DEFAULT_TERMS, ...commercial, ...(draft.terms || {}) },
    fields: {
      validUntil: validUntilLabel(15),
      referenceNo: String(draft.referenceNo || '').trim(),
      standardTerms: typeof bank.standardTerms === 'string' ? bank.standardTerms : ''
    },
    mode: draft.mode || 'ai',
    docType: 'quotation',
    layoutRef: uploadTemplateId || 'default',
    uploadTemplateId,
    paperStyle: typeof bank.paperStyle === 'string' ? bank.paperStyle : null,
    headerMeta: bank.headerMeta ? normalizeHeaderMeta(bank.headerMeta) : undefined,
    watermarkEnabled: true,
    tableColorId: 'blue',
    source: 'whatsapp'
  }
  const { data: saved, error: saveError } = await supabase
    .from('quotations')
    .insert({
      user_id: profile.user_id,
      number: payload.number,
      title: payload.title,
      quote_date: payload.date,
      layout_ref: payload.layoutRef,
      doc_type: 'quotation',
      data: payload
    })
    .select('id, number')
    .single()
  if (saveError || !saved?.id) throw saveError || new Error('Could not save the quotation.')
  return {
    previewUrl: `${PREVIEW_ORIGIN}/?quote=${saved.id}`,
    number: saved.number || number
  }
}

export function registerWhatsappEnquiryRoutes(app, { generateQuotationDraft }) {
  app.post('/api/whatsapp/enquiry', async (req, res) => {
    const requestId = `wa-${Date.now()}`
    const expected = String(process.env.WHATSAPP_WEBHOOK_SECRET || '').trim()
    if (!expected) {
      return res.status(503).json({
        error: 'WhatsApp intake is not configured.',
        code: 'WEBHOOK_NOT_CONFIGURED',
        requestId
      })
    }
    if (!secretMatches(presentedSecret(req), expected)) {
      return res.status(401).json({ error: 'Invalid webhook secret.', code: 'BAD_WEBHOOK_SECRET', requestId })
    }
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Quotation storage is not configured.', code: 'SUPABASE_UNAVAILABLE', requestId })
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const messages = collectMessages(body)
    const phoneRaw = senderPhone(messages, body)
    const digits = normalizeIndiaMobileDigits(phoneRaw)
    if (!isValidIndiaMobile(digits)) {
      return res.status(400).json({
        ok: false,
        error: 'A valid Indian mobile number is required.',
        code: 'PHONE_REQUIRED',
        replies: [{ text: 'I need the WhatsApp number this message came from before I can help.', delayMs: 0 }],
        requestId
      })
    }

    const supabase = getSupabase()
    const messageId = String(body.messageId || body.message_id || body.id || '').trim().slice(0, 200)
    const send = async (status, payload) => {
      try {
        await rememberResponse(supabase, messageId, digits, payload)
      } catch (error) {
        console.warn(`[${requestId}] receipt not stored`, error?.message || error)
      }
      return res.status(status).json(payload)
    }

    try {
      if (messageId) {
        const claim = await claimMessage(supabase, messageId, digits)
        if (!claim.fresh) {
          if (claim.response) return res.status(200).json(claim.response)
          return res.status(200).json({ ok: true, replies: [] })
        }
      }

      const recent = await recentInboundCount(supabase, digits)
      if (recent > 30) {
        console.info(`[${requestId}] rate limit`, { phone: maskPhone(digits) })
        return send(200, customerReply('Please wait a few minutes and send that again.'))
      }

      const profile = await findAccount(supabase, digits)
      if (!profile?.user_id) {
        console.info(`[${requestId}] no account`, { phone: maskPhone(digits) })
        return send(200, customerReply('This WhatsApp number is not on a QuoteGen account yet. Sign up at https://www.quotegen.ai, save this mobile number, then send your enquiry again.'))
      }

      const textParts = []
      const attachments = []
      for (const msg of messages) {
        const text = asText(msg?.text) || asText(msg?.body) || asText(msg?.enquiry) || asText(msg?.message) || asText(msg?.caption)
        if (text) textParts.push(text)
        attachments.push(...messageAttachments(msg))
      }
      if (asText(body.text) && !textParts.includes(asText(body.text))) textParts.unshift(asText(body.text))
      if (asText(body.enquiry) && !textParts.includes(asText(body.enquiry))) textParts.unshift(asText(body.enquiry))
      const text = textParts.join('\n').trim()

      let filePieces = []
      let failedFiles = []
      if (attachments.length) {
        const read = await readFilePieces(attachments, requestId)
        filePieces = read.pieces
        failedFiles = read.failed
      }
      if (attachments.length && !filePieces.length && !text) {
        return send(200, customerReply('I could not read that file. Please send it again as a PDF, Word, Excel, or photo.'))
      }

      const session = await loadSession(supabase, digits)
      const turn = decideTurn(session, { text, filePieces })
      if (turn.action === 'generate') {
        const blocked = await assertCanCreateQuotation(supabase, {
          userId: profile.user_id,
          userEmail: profile.email || ''
        })
        if (blocked) {
          await saveSession(supabase, digits, { ...session, phase: 'awaiting_confirm', promptOpen: true })
          return send(200, customerReply(limitReply(blocked)))
        }
        try {
          const created = await createQuotation({
            supabase,
            profile,
            enquiry: enquiryFromPieces(turn.pieces),
            generateQuotationDraft,
            requestId
          })
          await saveSession(supabase, digits, { phase: 'idle', pieces: [], promptOpen: false, lastQuestionAt: null })
          console.info(`[${requestId}] quotation created`, { phone: maskPhone(digits) })
          return send(200, {
            ok: true,
            replies: [{ text: `Your quotation is ready: ${created.previewUrl}`, delayMs: 0 }],
            previewUrl: created.previewUrl,
            number: created.number
          })
        } catch (error) {
          console.error(`[${requestId}] generation failed`, error?.message || error)
          await saveSession(supabase, digits, session)
          return send(200, {
            ok: false,
            replies: [{ text: 'I could not prepare that quotation just now. Please send YES again in a moment.', delayMs: 0 }]
          })
        }
      }

      await saveSession(supabase, digits, turn)
      const replies = failedFiles.length
        ? [{ text: 'I could not read that file. Please send it again as a PDF, Word, Excel, or photo.', delayMs: 0 }, ...turn.replies]
        : turn.replies
      console.info(`[${requestId}] reply`, { phone: maskPhone(digits), phase: turn.phase, replies: replies.length })
      return send(200, { ok: true, replies })
    } catch (error) {
      console.error(`[${requestId}] whatsapp enquiry failed`, error?.message || error)
      return res.status(200).json({
        ok: false,
        replies: [{ text: 'Something went wrong on my side. Please send that again in a moment.', delayMs: 0 }],
        requestId
      })
    }
  })
}
