import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import OpenAI from 'openai'
import { registerAuthRoutes, requireAuth } from './auth.js'
import { registerUploadDocRoutes } from './uploadDoc.js'
import { registerPersistenceRoutes } from './persistence.js'
import { registerRevisionRoutes } from './revisions.js'
import { registerKnowledgeRoutes, autofillItemsFromKnowledge, retrieveKnowledgeContext, formatKnowledgePromptBlock } from './knowledge.js'
import { registerHsnGstRoutes } from './hsnGst.js'
import { registerQuoteAssetRoutes } from './quoteAssets.js'
import { registerPdfRoutes } from './pdfExport.js'
import { getSupabase, isSupabaseConfigured } from './db.js'
import { aiFillableColumns, blankItemFor, normalizeColumnList } from '../shared/quoteColumns.js'
import { catalogItemCountHint, catalogItemsToQuoteRows, extractCatalogLineItems } from './enquiryItems.js'
import { ensureSuggestedColumn } from '../shared/productKeywords.js'

const app = express()
if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) app.set('trust proxy', 1)
app.use(cors())
app.use(express.json({ limit: '30mb' }))

// Auth endpoints are public; everything else under /api requires a session.
registerAuthRoutes(app)
app.use('/api', requireAuth)

registerUploadDocRoutes(app)
registerRevisionRoutes(app)
registerPersistenceRoutes(app)
registerKnowledgeRoutes(app)
registerHsnGstRoutes(app)
registerQuoteAssetRoutes(app)
registerPdfRoutes(app)

const DEFAULT_DATA_COLUMNS = [
  { id: 'description', label: 'Description' },
  { id: 'unit', label: 'Unit' },
  { id: 'quantity', label: 'Quantity' },
  { id: 'rate', label: 'Rate' },
  { id: 'amount', label: 'Amount' }
]

function createClient() {
  const baseURL = process.env.OPENAI_BASE_URL
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    ...(baseURL ? { baseURL } : {}),
    ...(baseURL?.includes('openrouter.ai') ? {
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:5173',
        'X-Title': process.env.OPENROUTER_SITE_NAME || 'QuoteGen'
      }
    } : {})
  })
}

/** Keep Step 7 column typing (type/colour/image width) through the AI round trip. */
function normalizeColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) return DEFAULT_DATA_COLUMNS
  const next = normalizeColumnList(columns.filter(c => c && !c.system))
  return next.length ? next : DEFAULT_DATA_COLUMNS
}

/** Image and nested tax/discount cells are never AI-authored. */
function buildItemTemplate(columns) {
  return Object.fromEntries(aiFillableColumns(columns).map(c => [c.id, '']))
}

function buildQuotationPrompt(columns) {
  const fillable = aiFillableColumns(columns)
  const itemTemplate = buildItemTemplate(columns)
  const columnGuide = fillable.map(c => `"${c.id}" (${c.label})`).join(', ')
  const hasDescription = fillable.some(c => c.id === 'description')
  const descriptionRule = hasDescription ? `
For the "description" column specifically: keep the customer's own wording, including local names, slang, or trade names. Do not replace it with a catalogue name.
Use a two-line format stored as a single string with a newline character.
- Line 1: the product or service as the customer wrote it (short, plain text). Do NOT use markdown, asterisks, or bold formatting.
- Line 2+: secondary details NOT already captured in other columns (e.g. class, standard, finish). Put specs that belong in dedicated columns (Material Grade, Size, HSN, etc.) in those columns instead — not in description.
If there are no secondary details, use line 1 only.
Leave "ourSuggested" empty when that column exists — the system fills the standard product name.` : ''
  return `You are an experienced industrial quotation engineer.
Your job is to convert any raw customer enquiry into a professional quotation draft. Understand the enquiry naturally like a human engineer would. Use your judgement to identify what the customer is asking for, commercially important details, available technical information, and missing information. Recognize industry terminology, brands, materials, dimensions, specifications, quantities, standards, scope and commercial details whenever relevant.

Do not invent technical information, rates, tax rates, delivery commitments, or commercial details. If important information is missing, list it under clarifications. Never treat greetings or pleasantries as line items. Accuracy of the number of requested line items is critical: capture every core product/service requested and do not add unrelated items. If output space is tight, omit notes/clarifications/terms before omitting any line item. Never close the items array early.

The quotation table uses these columns (in order): ${columnGuide}
Each line item MUST be a JSON object with exactly these keys and no others: ${fillable.map(c => c.id).join(', ')}
Use empty strings when information is unknown. Rate and amount must be empty unless provided in the enquiry. Make descriptions concise and professional.${descriptionRule}

Return ONLY valid JSON matching this shape:
{
 "title":"Quotation for ...",
 "customer":{"name":"","company":"","gst":"","location":""},
 "items":[${JSON.stringify(itemTemplate)}],
 "notes":[""],
 "clarifications":[""],
 "terms":{"validity":"","delivery":"","payment":"","taxes":"","freight":""}
}`
}

const suggestColumnsPrompt = `You are an experienced quotation engineer. Analyze the customer enquiry and suggest additional quotation table columns that would be useful for this specific industry or enquiry type.

Standard columns already present: Description, Unit, Quantity, Rate, Amount — do NOT suggest these again.

Return ONLY valid JSON:
{"columns":[{"label":"Column display name"}]}

Suggest 0–6 highly relevant columns only. Use clear professional labels suitable for a quotation table (e.g. Material Grade, HSN Code, Drawing No.). Return an empty array if the standard columns are sufficient.`

function fallback(enquiry, customer, columns = DEFAULT_DATA_COLUMNS) {
  const template = blankItemFor(columns)
  const fillable = aiFillableColumns(columns)
  const candidates = enquiry.split(/\n|(?<=[.;])\s+/).map(s => s.trim()).filter(s => s.length > 5 && /\d|\b(for|supply|require|need|item|pcs|nos|kg|meter|service)\b/i.test(s))
  const lines = (candidates.length ? candidates : [enquiry.trim()]).slice(0, 12)
  const items = lines.map((line) => {
    const item = { ...template }
    const quantity = line.match(/\b(\d+(?:\.\d+)?)\s*(pcs?|nos?|units?|kg|kgs?|meters?|mtr|sets?|boxes?)\b/i)
    if ('description' in item) item.description = line.replace(/^(please\s+)?(need|require|looking for|we need)\s*/i, '')
    else if (fillable[0]) item[fillable[0].id] = line
    if ('quantity' in item) item.quantity = quantity?.[1] || ''
    if ('unit' in item) item.unit = quantity?.[2] || ''
    return item
  })
  return {
    title: 'Quotation – As per enquiry',
    customer,
    items,
    notes: ['Rates, taxes and delivery details to be confirmed before sending.'],
    clarifications: ['Please confirm specifications, applicable rates and delivery requirements.'],
    terms: { validity: 'To be confirmed', delivery: 'To be confirmed', payment: 'To be confirmed', taxes: 'Extra as applicable', freight: 'To be confirmed' }
  }
}

function normalizeItems(items, columns) {
  const template = blankItemFor(columns)
  if (!Array.isArray(items) || !items.length) return []
  return items.map(item => {
    const row = { ...template }
    for (const col of aiFillableColumns(columns)) {
      if (item[col.id] != null) {
        let val = String(item[col.id])
        if (col.id === 'description') val = val.replace(/\*\*/g, '').trim()
        row[col.id] = val
      }
    }
    return row
  })
}

async function callAI(system, user, requestId, options = {}) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const baseURL = process.env.OPENAI_BASE_URL
  const client = createClient()
  const maxTokens = options.max_tokens ?? 16000
  const temperature = options.temperature ?? 0
  console.info(`[${requestId}] calling AI`, { model, baseURL: baseURL || 'https://api.openai.com/v1', maxTokens, temperature })
  const completion = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    temperature,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  })
  const finishReason = completion.choices?.[0]?.finish_reason
  const usage = completion.usage || null
  console.info(`[${requestId}] AI response received`, {
    responseId: completion.id,
    finishReason,
    usage
  })
  if (finishReason === 'length') {
    console.warn(`[${requestId}] AI output hit max_tokens (${maxTokens}); JSON may omit trailing line items`)
  }
  return {
    data: JSON.parse(completion.choices[0].message.content),
    finishReason,
    usage
  }
}

function metadataPrompt() {
  return `You are an experienced industrial quotation engineer.
Line items were already extracted from the enquiry. Do NOT return line items.
Fill only quotation metadata from the enquiry. Do not invent rates, taxes, or commercial commitments.

Return ONLY valid JSON matching this shape:
{
 "title":"Quotation for ...",
 "customer":{"name":"","company":"","gst":"","location":""},
 "items":[],
 "notes":[""],
 "clarifications":[""],
 "terms":{"validity":"","delivery":"","payment":"","taxes":"","freight":""}
}`
}

function splitEnquiryChunks(enquiry, size = 3500) {
  const text = String(enquiry || '')
  if (text.length <= size) return [text]
  const chunks = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + size)
    if (end < text.length) {
      const window = text.slice(start, end)
      const breakAt = window.lastIndexOf('\n')
      if (breakAt > size * 0.4) end = start + breakAt
    }
    const chunk = text.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    start = end
  }
  return chunks
}

function itemKey(item) {
  return JSON.stringify(item)
}

async function extractItemsByChunks(enquiry, columns, emptyCustomer, requestId) {
  const chunks = splitEnquiryChunks(enquiry)
  if (chunks.length < 2) return null
  console.info(`[${requestId}] retrying item extraction in ${chunks.length} chunks after truncated AI output`)
  const seen = new Set()
  const items = []
  for (let i = 0; i < chunks.length; i++) {
    const { data } = await callAI(
      buildQuotationPrompt(columns),
      `Customer details already provided by the user: ${JSON.stringify(emptyCustomer)}\n\nThis is chunk ${i + 1} of ${chunks.length} of the same enquiry. Extract ONLY the line items present in this chunk. Do not invent items from outside the chunk.\n\nRaw enquiry chunk:\n${chunks[i]}`,
      `${requestId}-chunk-${i + 1}`,
      { max_tokens: 8000, temperature: 0 }
    )
    for (const item of normalizeItems(data.items, columns)) {
      const key = itemKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}

function aiError(error, requestId, res) {
  const details = {
    name: error?.name,
    message: error?.message || 'Unknown AI error',
    status: error?.status,
    code: error?.code,
    type: error?.type
  }
  console.error(`[${requestId}] AI request failed`, details)
  res.status(error?.status || 502).json({ error: details.message, details, requestId })
}

app.post('/api/suggest-columns', async (req, res) => {
  const { enquiry, columns: existing = [] } = req.body || {}
  const requestId = `cols-${Date.now()}`
  if (!enquiry?.trim()) return res.status(400).json({ error: 'Paste the customer enquiry first.' })
  const current = normalizeColumns(existing)
  if (!process.env.OPENAI_API_KEY) {
    return res.json({ columns: [], mode: 'demo' })
  }
  try {
    const { data: draft } = await callAI(
      suggestColumnsPrompt,
      `Existing columns: ${current.map(c => c.label).join(', ')}\n\nRaw enquiry:\n${enquiry}`,
      requestId,
      { max_tokens: 1200 }
    )
    const suggestions = (draft.columns || [])
      .filter(c => c?.label)
      .map(c => ({ label: String(c.label).trim() }))
      .filter(c => c.label && !current.some(x => x.label.toLowerCase() === c.label.toLowerCase()))
    res.json({ columns: suggestions, mode: 'ai' })
  } catch (error) {
    aiError(error, requestId, res)
  }
})

async function enrichWithKnowledge(draft, columns, enquiry, requestId, userId) {
  if (!isSupabaseConfigured()) {
    return { ...draft, knowledgeAutofill: { mode: 'skipped', fills: [] } }
  }
  try {
    const supabase = getSupabase()
    const result = await autofillItemsFromKnowledge(supabase, draft.items || [], columns, userId)
    console.info(`[${requestId}] knowledge autofill`, result.stats || result.mode)
    return {
      ...draft,
      items: result.items,
      knowledgeAutofill: {
        mode: result.mode,
        fills: result.fills,
        stats: result.stats
      }
    }
  } catch (error) {
    console.warn(`[${requestId}] knowledge autofill failed`, error?.message || error)
    return { ...draft, knowledgeAutofill: { mode: 'error', fills: [], error: error?.message } }
  }
}

async function knowledgePromptAddon(enquiry, requestId, userId) {
  if (!isSupabaseConfigured()) return ''
  try {
    const context = await retrieveKnowledgeContext(getSupabase(), enquiry, userId)
    const block = formatKnowledgePromptBlock(context)
    if (block) console.info(`[${requestId}] knowledge context`, { mode: context.mode, snippets: context.snippets?.length || 0, products: context.products?.length || 0 })
    return block
  } catch (error) {
    console.warn(`[${requestId}] knowledge context skipped`, error?.message || error)
    return ''
  }
}

app.post('/api/generate-quotation', async (req, res) => {
  const { enquiry, customer = {}, columns: rawColumns } = req.body || {}
  const requestId = `quote-${Date.now()}`
  if (!enquiry?.trim()) return res.status(400).json({ error: 'Please paste the customer enquiry.' })
  const emptyCustomer = { name: '', company: '', gst: '', location: '', ...customer }
  const columns = ensureSuggestedColumn(normalizeColumns(rawColumns))
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY)
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const baseURL = process.env.OPENAI_BASE_URL

  console.info(`[${requestId}] quotation generation requested`, {
    hasApiKey, model, baseURL: baseURL || 'https://api.openai.com/v1',
    enquiryLength: enquiry.length, columnCount: columns.length
  })

  if (!hasApiKey) {
    console.warn(`[${requestId}] OPENAI_API_KEY is unavailable; returning local demo draft`)
    const draft = fallback(enquiry, emptyCustomer, columns)
    const catalog = extractCatalogLineItems(enquiry)
    if (catalog.length >= 3) {
      draft.items = catalogItemsToQuoteRows(catalog, columns, blankItemFor(columns))
    }
    const enriched = await enrichWithKnowledge(draft, columns, enquiry, requestId, req.userId)
    return res.json({ ...enriched, columns, mode: 'demo', extraction: catalog.length >= 3 ? 'catalog' : 'demo' })
  }

  try {
    const knowledgeBlock = await knowledgePromptAddon(enquiry, requestId, req.userId)
    const catalog = extractCatalogLineItems(enquiry)
    const hintedCount = catalogItemCountHint(enquiry)
    console.info(`[${requestId}] enquiry item scan`, {
      catalogExtracted: catalog.length,
      lineRefHint: hintedCount
    })

    let draft
    let extraction = 'ai'
    if (catalog.length >= 3) {
      const { data } = await callAI(
        metadataPrompt(),
        `Customer details already provided by the user: ${JSON.stringify(emptyCustomer)}\n\n${catalog.length} line items were already extracted from the repeating catalog list (line ref + item code + description + qty + unit). Return items as [].\n\nRaw enquiry:\n${enquiry}${knowledgeBlock}`,
        requestId,
        { max_tokens: 2000, temperature: 0 }
      )
      draft = data
      draft.items = catalogItemsToQuoteRows(catalog, columns, blankItemFor(columns))
      extraction = 'catalog'
      if (hintedCount && catalog.length < hintedCount) {
        console.warn(`[${requestId}] catalog parser found ${catalog.length} items but counted ${hintedCount} line refs`)
      }
    } else {
      const expectedNote = hintedCount >= 3
        ? `\n\nThis enquiry appears to list about ${hintedCount} line items. Return exactly that many items. Do not stop early.`
        : ''
      const { data, finishReason } = await callAI(
        buildQuotationPrompt(columns),
        `Customer details already provided by the user: ${JSON.stringify(emptyCustomer)}\n\nQuotation columns (use exactly these keys in each item): ${JSON.stringify(columns)}${expectedNote}\n\nRaw enquiry:\n${enquiry}${knowledgeBlock}`,
        requestId
      )
      draft = data
      draft.items = normalizeItems(draft.items, columns)
      if (finishReason === 'length' || (hintedCount >= 8 && draft.items.length < hintedCount)) {
        const chunked = await extractItemsByChunks(enquiry, columns, emptyCustomer, requestId)
        if (chunked?.length > draft.items.length) {
          draft.items = chunked
          extraction = 'ai-chunked'
        }
      }
    }

    draft.customer = { ...emptyCustomer, ...(draft.customer || {}) }
    if (!draft.items.length) draft.items = fallback(enquiry, emptyCustomer, columns).items
    const enriched = await enrichWithKnowledge(draft, columns, enquiry, requestId, req.userId)
    res.json({
      ...enriched,
      columns,
      mode: 'ai',
      extraction,
      extractionMeta: { catalogExtracted: catalog.length, lineRefHint: hintedCount, itemCount: (enriched.items || []).length }
    })
  } catch (error) {
    aiError(error, requestId, res)
  }
})

// `npm run dev` runs Vite and this API under a single environment, so a generic
// PORT is ambiguous — Vite claims it too, and whichever binds second dies with
// EADDRINUSE. API_PORT is the unambiguous knob; PORT is honoured only when it
// clearly isn't Vite's dev port. The Vite proxy expects the API on 3001.
const VITE_DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5173
const envPort = Number(process.env.PORT)
const PORT = Number(process.env.API_PORT)
  || (Number.isFinite(envPort) && envPort > 0 && envPort !== VITE_DEV_PORT ? envPort : 3001)

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = path.join(PROJECT_ROOT, 'dist')

function serveBuiltClient() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) return false
  app.use(express.static(DIST_DIR))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
  return true
}

const servingClient = serveBuiltClient()

export default app

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`QuoteGen API listening on http://localhost:${PORT}`)
    console.log(`Persistence: ${isSupabaseConfigured() ? 'Supabase configured' : 'Supabase not configured (APIs return 503; app still works)'}`)
    console.log(`Web UI: ${servingClient ? `serving ${DIST_DIR}` : 'not serving dist (run npm run build, or use Vite on 5173)'}`)
  })
}
