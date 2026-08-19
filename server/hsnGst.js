/**
 * Step 6: HSN + GST lookup — cache first (products / hsn_cache), AI only on miss.
 */
import OpenAI from 'openai'
import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { columnMode, columnType, isAttachmentColumn, isImageColumn, isNestedColumn, rateKey } from '../shared/quoteColumns.js'

function normalizeKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function primaryDescription(item, columns, description) {
  if (description != null && String(description).trim()) {
    return String(description).split('\n')[0].trim()
  }
  if (!item || typeof item !== 'object') return ''
  if (item.description != null && String(item.description).trim()) {
    return String(item.description).split('\n')[0].trim()
  }
  const first = columns?.[0]?.id
  if (first && item[first] != null) return String(item[first]).split('\n')[0].trim()
  return ''
}

/** Plain text columns only — image, attachment, and nested tax/discount columns hold no scalar value. */
function scalarColumns(columns) {
  return (columns || []).filter(c => c && !isNestedColumn(c) && !isImageColumn(c) && !isAttachmentColumn(c))
}

function findColumnId(columns, candidates) {
  const scalar = scalarColumns(columns)
  const ids = new Set(scalar.map(c => c.id))
  for (const id of candidates) {
    if (ids.has(id)) return id
  }
  for (const col of scalar) {
    const label = String(col.label || '').toLowerCase()
    const idLower = String(col.id || '').toLowerCase()
    for (const cand of candidates) {
      const c = String(cand).toLowerCase()
      if (idLower === c || idLower.includes(c)) return col.id
      if (label.includes(c) || label.includes(c.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())) {
        return col.id
      }
    }
    if (/hsn|sac/.test(label) && candidates.some(x => /hsn/i.test(x))) return col.id
    if (/(gst\s*%|gst%|\bgst\b|tax\s*%|igst)/.test(label) && candidates.some(x => /gst|tax/i.test(x))) {
      return col.id
    }
  }
  return null
}

/** Apply HSN/GST onto an item using column fuzzy match (overwrites on explicit fetch). */
export function applyHsnGstToItem(item, columns, { hsn, gst }, meta = {}) {
  const next = { ...(item || {}) }
  const filledFields = []
  const hsnCol = findColumnId(columns, ['hsnCode', 'hsn', 'hsncode', 'sac', 'sacCode'])
  const gstCol = findColumnId(
    (columns || []).filter(c => !(columnType(c) === 'tax' && columnMode(c) === 'amount')),
    ['gst%', 'gstPercent', 'gst', 'gstpercent', 'tax', 'taxPercent', 'igst']
  )

  const put = (colId, value) => {
    if (!colId || value == null || String(value).trim() === '') return
    next[colId] = String(value).trim()
    filledFields.push(colId)
  }

  put(hsnCol, hsn)
  put(gstCol, gst)

  const taxColumns = (columns || []).filter(c => columnType(c) === 'tax' && isNestedColumn(c))
  const putRate = (col, value) => {
    const key = rateKey(col)
    next[key] = String(value)
    next[`${col.id}__src`] = 'rate'
    filledFields.push(key)
  }

  if (!gstCol && gst && taxColumns.length) {
    const rate = Number(String(gst).trim())
    const labelOf = c => String(c.label || '').toLowerCase()
    // Intra-state GST splits evenly across a CGST + SGST/UTGST pair.
    const isHalfSplit = taxColumns.length === 2 &&
      taxColumns.some(c => /\bcgst\b/.test(labelOf(c))) &&
      taxColumns.some(c => /\b(sgst|utgst)\b/.test(labelOf(c)))

    if (taxColumns.length === 1) {
      putRate(taxColumns[0], String(gst).trim())
    } else if (isHalfSplit && Number.isFinite(rate)) {
      for (const col of taxColumns) putRate(col, String(Math.round((rate / 2) * 100) / 100))
    }
    // Any other combination (e.g. CGST + IGST) is the user's call — leave it.
  }

  // Canonical fallbacks when columns not yet added to the template
  if (!hsnCol && hsn) {
    next.hsn = String(hsn).trim()
    filledFields.push('hsn')
  }
  if (!gstCol && gst) {
    next.gst = String(gst).trim()
    filledFields.push('gst')
  }

  if (filledFields.length) {
    next._hsnGstFill = {
      source: meta.source || 'unknown',
      key: meta.key || null,
      fields: filledFields,
      at: new Date().toISOString()
    }
  }
  return { item: next, fields: filledFields, hsnCol, gstCol }
}

export function createAiClient() {
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

const HSN_GST_SYSTEM = `You are an Indian GST / HSN classification assistant for industrial quotations.
Given a product or service description, return the most likely HSN/SAC code and GST rate percent used in India.
Use standard chapter codes when exact 8-digit codes are uncertain. Prefer common commercial rates (0, 5, 12, 18, 28).
If unsure, still give your best HSN chapter (4–8 digits) and GST percent; set confidence low.
Return ONLY valid JSON: {"hsn":"7307","gst":"18","confidence":0.8,"note":"optional short note"}
hsn must be digits only (4–8). gst must be a number string without % sign.`

async function callHsnGstAi(description, requestId) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const client = createAiClient()
  console.info(`[${requestId}] HSN/GST AI lookup`, { model, description: description.slice(0, 80) })
  const completion = await client.chat.completions.create({
    model,
    max_tokens: 200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: HSN_GST_SYSTEM },
      { role: 'user', content: `Item description:\n${description}` }
    ]
  })
  const raw = completion.choices?.[0]?.message?.content || '{}'
  return JSON.parse(raw)
}

function sanitizeHsn(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length < 4 || digits.length > 8) return ''
  return digits
}

function sanitizeGst(value) {
  const n = String(value || '').replace(/%/g, '').trim()
  if (!n) return ''
  const num = Number(n)
  if (!Number.isFinite(num) || num < 0 || num > 40) return ''
  return String(Number.isInteger(num) ? num : num)
}

async function lookupCache(supabase, key, userId) {
  // Prefer this tenant's own products row with HSN; fall back to the
  // global/shared hsn_cache (HSN/GST are public tax codes, not tenant secrets).
  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('key, description, hsn, gst, updated_at')
    .eq('key', key)
    .eq('user_id', userId)
    .maybeSingle()
  if (pErr) throw pErr
  if (product && sanitizeHsn(product.hsn)) {
    return {
      key: product.key,
      description: product.description || '',
      hsn: sanitizeHsn(product.hsn),
      gst: sanitizeGst(product.gst) || String(product.gst || '').trim(),
      from: 'products'
    }
  }

  const { data: cached, error: cErr } = await supabase
    .from('hsn_cache')
    .select('key, description, hsn, gst, updated_at')
    .eq('key', key)
    .maybeSingle()
  if (cErr) throw cErr
  if (cached && sanitizeHsn(cached.hsn)) {
    return {
      key: cached.key,
      description: cached.description || '',
      hsn: sanitizeHsn(cached.hsn),
      gst: sanitizeGst(cached.gst) || String(cached.gst || '').trim(),
      from: 'hsn_cache'
    }
  }

  return null
}

async function upsertCache(supabase, { key, description, hsn, gst }, userId) {
  const updated_at = new Date().toISOString()
  const productRow = {
    key,
    user_id: userId,
    description: description || key,
    hsn,
    gst,
    updated_at
  }

  let { data: product, error } = await supabase
    .from('products')
    .upsert(productRow, { onConflict: 'user_id,key' })
    .select('*')
    .maybeSingle()

  if (error && /rate|schema cache|PGRST204/i.test(error.message || '')) {
    ;({ data: product, error } = await supabase
      .from('products')
      .upsert(productRow, { onConflict: 'user_id,key' })
      .select('*')
      .maybeSingle())
  }
  if (error) {
    // If products missing rate column conflict already handled; other errors: try without extras
    console.warn('[hsn-gst] products upsert', error.message)
  }

  // hsn_cache is global/shared — every tenant benefits from a code looked up once.
  const { error: cacheErr } = await supabase.from('hsn_cache').upsert({
    key,
    description: description || key,
    hsn,
    gst,
    updated_at
  }, { onConflict: 'key' })
  if (cacheErr) console.warn('[hsn-gst] hsn_cache upsert', cacheErr.message)

  return product
}

/**
 * Core lookup: cache → AI → persist.
 */
export async function lookupHsnGst({ description, item, columns = [] }, requestId = `hsn-${Date.now()}`, userId) {
  const desc = primaryDescription(item, columns, description)
  const key = normalizeKey(desc)
  if (!key || key.length < 2) {
    const err = new Error('Provide an item description to look up HSN/GST.')
    err.status = 400
    err.code = 'VALIDATION_ERROR'
    throw err
  }

  if (!isSupabaseConfigured()) {
    const err = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
    err.code = 'SUPABASE_UNAVAILABLE'
    err.status = 503
    throw err
  }

  const supabase = getSupabase()

  // 1) Cache hit — never call AI
  const cached = await lookupCache(supabase, key, userId)
  if (cached) {
    const applied = applyHsnGstToItem(item || {}, columns, cached, { source: 'cache', key: cached.key })
    return {
      hsn: cached.hsn,
      gst: cached.gst,
      description: cached.description || desc,
      key: cached.key || key,
      source: 'cache',
      cacheTable: cached.from,
      item: applied.item,
      fields: applied.fields,
      requestId
    }
  }

  // 2) AI miss path
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('No cached HSN/GST for this item, and OPENAI_API_KEY is not set for AI lookup.')
    err.status = 503
    err.code = 'AI_UNAVAILABLE'
    throw err
  }

  let draft
  try {
    draft = await callHsnGstAi(desc, requestId)
  } catch (error) {
    const err = new Error(error?.message || 'AI HSN/GST lookup failed')
    err.status = error?.status || 502
    err.code = 'AI_ERROR'
    err.details = { name: error?.name, message: error?.message, status: error?.status }
    throw err
  }

  const hsn = sanitizeHsn(draft.hsn)
  const gst = sanitizeGst(draft.gst)
  if (!hsn) {
    const err = new Error('AI did not return a usable HSN code. Try a clearer description.')
    err.status = 422
    err.code = 'PARSE_ERROR'
    throw err
  }

  await upsertCache(supabase, {
    key,
    description: desc,
    hsn,
    gst: gst || ''
  }, userId)

  const applied = applyHsnGstToItem(item || {}, columns, { hsn, gst: gst || '' }, { source: 'ai', key })
  return {
    hsn,
    gst: gst || '',
    description: desc,
    key,
    source: 'ai',
    confidence: draft.confidence ?? null,
    note: draft.note || null,
    item: applied.item,
    fields: applied.fields,
    requestId
  }
}

export function registerHsnGstRoutes(app) {
  app.post('/api/hsn-gst/lookup', async (req, res) => {
    const requestId = `hsn-${Date.now()}`
    try {
      const body = req.body || {}
      const result = await lookupHsnGst({
        description: body.description,
        item: body.item,
        columns: Array.isArray(body.columns) ? body.columns : []
      }, requestId, req.userId)
      res.json(result)
    } catch (error) {
      if (error?.code === 'SUPABASE_UNAVAILABLE' || error?.code === 'AI_UNAVAILABLE') {
        return res.status(error.status || 503).json({
          error: error.message,
          code: error.code,
          requestId
        })
      }
      if (error?.code === 'VALIDATION_ERROR' || error?.code === 'PARSE_ERROR') {
        return res.status(error.status || 400).json({
          error: error.message,
          code: error.code,
          requestId
        })
      }
      if (error?.code === 'AI_ERROR') {
        return res.status(error.status || 502).json({
          error: error.message,
          code: error.code,
          details: error.details,
          requestId
        })
      }
      // PostgREST / missing table → clear hint
      if (/relation|does not exist|PGRST|schema cache/i.test(error?.message || '')) {
        return res.status(503).json({
          error: 'Database tables missing or incomplete. Apply supabase migrations (persistence foundation + knowledge autofill), then retry.',
          code: 'SCHEMA_MISSING',
          detail: error.message,
          requestId
        })
      }
      supabaseError(error, res, requestId)
    }
  })
}
