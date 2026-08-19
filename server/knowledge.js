import multer from 'multer'
import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { extractKnowledgeText, extractProductCandidates } from './knowledgeExtract.js'
import { isAttachmentColumn, isImageColumn, isNestedColumn } from '../shared/quoteColumns.js'
import {
  applySuggestedName,
  fillSuggestedOnItems,
  formatKeywords,
  scoreProductKeywords,
  suggestedColumnId
} from '../shared/productKeywords.js'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 12 }
})

const SNIPPET_LEN = 280
const MIN_CONFIDENCE = 0.55

function requireDb(res, requestId) {
  if (!isSupabaseConfigured()) {
    const err = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
    err.code = 'SUPABASE_UNAVAILABLE'
    err.status = 503
    supabaseError(err, res, requestId)
    return null
  }
  return getSupabase()
}

function mapKnowledgeDoc(row, { fullText = false } = {}) {
  if (!row) return null
  const text = row.extracted_text ?? ''
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime ?? null,
    extractedText: fullText ? text : null,
    snippet: text ? text.slice(0, SNIPPET_LEN) + (text.length > SNIPPET_LEN ? '…' : '') : '',
    charCount: text.length,
    metadata: row.metadata ?? {},
    createdAt: row.created_at
  }
}

function normalizeKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function primaryDescription(item, columns) {
  if (!item || typeof item !== 'object') return ''
  if (item.description != null && String(item.description).trim()) {
    return String(item.description).split('\n')[0].trim()
  }
  const first = columns?.[0]?.id
  if (first && item[first] != null) return String(item[first]).split('\n')[0].trim()
  return ''
}

function scoreProductMatch(query, product) {
  return scoreProductKeywords(query, product)
}

function columnIds(columns) {
  return new Set((columns || []).map(c => c.id))
}

/** Skip image and nested tax/discount columns — they hold no scalar value. */
function scalarColumns(columns) {
  return (columns || []).filter(c => c && !isNestedColumn(c) && !isImageColumn(c) && !isAttachmentColumn(c))
}

function findColumnId(columns, candidates) {
  const scalar = scalarColumns(columns)
  const ids = new Set(scalar.map(c => c.id))
  for (const id of candidates) {
    if (ids.has(id)) return id
  }
  // Fuzzy by label
  for (const col of scalar) {
    const label = String(col.label || '').toLowerCase()
    for (const cand of candidates) {
      if (label.includes(cand.replace(/([A-Z])/g, ' $1').toLowerCase().trim()) || label.includes(cand)) {
        return col.id
      }
    }
  }
  return null
}

function applyFill(item, columns, fill, source) {
  const next = { ...item }
  const filledFields = []
  const ids = columnIds(columns)

  const mapping = [
    ['rate', fill.rate],
    ['hsn', fill.hsn],
    ['hsnCode', fill.hsn],
    ['gst', fill.gst],
    ['gst%', fill.gst],
    ['gstPercent', fill.gst]
  ]

  // Prefer canonical column ids when present
  const hsnCol = findColumnId(columns, ['hsnCode', 'hsn', 'hsncode'])
  const gstCol = findColumnId(columns, ['gst%', 'gstPercent', 'gst', 'gstpercent'])
  const rateCol = findColumnId(columns, ['rate'])

  const put = (colId, value) => {
    if (!colId || value == null || value === '') return
    const current = next[colId]
    const empty = current == null || String(current).trim() === ''
    if (!empty) return
    next[colId] = String(value)
    filledFields.push(colId)
  }

  // Never rewrite the customer's enquiry wording in description.
  if (rateCol) put(rateCol, fill.rate)
  if (hsnCol) put(hsnCol, fill.hsn)
  if (gstCol) put(gstCol, fill.gst)

  // Also try generic mapping for oddly named ids already in item template
  for (const [id, value] of mapping) {
    if (ids.has(id) && !filledFields.includes(id)) put(id, value)
  }

  // Learned image: only into an empty cell — never overwrite a user's own upload.
  const imageCol = (columns || []).find(isImageColumn)
  if (imageCol && fill.image) {
    const current = next[imageCol.id]
    const empty = current == null || String(current).trim() === ''
    if (empty) {
      next[imageCol.id] = String(fill.image)
      if (fill.imagePath) next[`${imageCol.id}__path`] = String(fill.imagePath)
      filledFields.push(imageCol.id)
    }
  }

  if (fill.suggestedName) {
    const named = applySuggestedName(next, columns, { description: fill.suggestedName, key: fill.suggestedName })
    const sid = suggestedColumnId(columns)
    if (sid && named[sid] && named[sid] !== next[sid]) filledFields.push(sid)
    Object.assign(next, named)
  }

  if (!filledFields.length) return { item: next, filled: false }

  next._knowledgeFill = {
    source: source.type,
    label: source.label,
    confidence: source.confidence,
    fields: filledFields,
    productKey: source.productKey || null
  }
  return { item: next, filled: true }
}

async function loadProducts(supabase, userId) {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data || []
}

/** Fixed marker filename used to remember learned images before the
 *  image_url/image_path migration is applied — one row per tenant. */
const IMAGE_MEMORY_FILENAME = '__product_image_memory__'

async function loadKnowledgeDocs(supabase, userId) {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, filename, mime, extracted_text, metadata, created_at')
    .eq('user_id', userId)
    .neq('filename', IMAGE_MEMORY_FILENAME)
    .order('created_at', { ascending: false })
    .limit(80)
  if (error) throw error
  return data || []
}

function productsFromKnowledgeMeta(docs) {
  const products = []
  for (const doc of docs) {
    const list = doc.metadata?.products
    if (!Array.isArray(list)) continue
    for (const p of list) {
      if (!p?.key && !p?.description) continue
      products.push({
        key: p.key || normalizeKey(p.description),
        description: p.description || '',
        hsn: p.hsn || '',
        gst: p.gst || '',
        rate: p.rate || '',
        keywords: p.keywords || '',
        image_url: p.image || p.image_url || '',
        image_path: p.imagePath || p.image_path || '',
        _fromDoc: doc.filename,
        _docId: doc.id
      })
    }
  }
  return products
}

async function loadImageMemory(supabase, userId) {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, metadata')
    .eq('filename', IMAGE_MEMORY_FILENAME)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return { id: data?.id || null, products: Array.isArray(data?.metadata?.products) ? data.metadata.products : [] }
}

async function saveImageMemory(supabase, userId, id, products) {
  const row = {
    filename: IMAGE_MEMORY_FILENAME,
    user_id: userId,
    mime: 'application/vnd.quotegen.learned+json',
    extracted_text: '',
    metadata: { products, learned: true }
  }
  if (id) {
    const { error } = await supabase.from('knowledge_documents').update(row).eq('id', id).eq('user_id', userId)
    if (error) throw error
  } else {
    const { error } = await supabase.from('knowledge_documents').insert(row)
    if (error) throw error
  }
}

function searchTextSnippets(docs, queryKey, limit = 4) {
  if (!queryKey) return []
  const tokens = queryKey.split(' ').filter(t => t.length > 2)
  const scored = []
  for (const doc of docs) {
    const text = doc.extracted_text || ''
    if (!text) continue
    const lower = text.toLowerCase()
    let hits = 0
    for (const t of tokens) {
      if (lower.includes(t)) hits++
    }
    if (!hits) continue
    // Find a window around the first matching token
    let idx = -1
    for (const t of tokens) {
      idx = lower.indexOf(t)
      if (idx >= 0) break
    }
    const start = Math.max(0, idx - 80)
    const snippet = text.slice(start, start + 220).replace(/\s+/g, ' ').trim()
    const rank = hits / Math.max(tokens.length, 1)
    if (rank < 0.4) continue
    scored.push({
      docId: doc.id,
      filename: doc.filename,
      snippet,
      rank
    })
  }
  return scored.sort((a, b) => b.rank - a.rank).slice(0, limit)
}

function parseRateNearQuery(snippet, queryKey) {
  if (!snippet) return null
  const lower = snippet.toLowerCase()
  const q = queryKey.split(' ')[0]
  const qIdx = q ? lower.indexOf(q) : 0
  const window = snippet.slice(Math.max(0, qIdx - 40), qIdx + 160)
  const keyword = window.match(/(?:rate|price|rs\.?|₹)\s*[:\-]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i)
  if (keyword?.[1]) return keyword[1]
  // Avoid mistaking HSN (4–8 digits) for a unit rate
  const loose = window.match(/\b([0-9]{1,7}(?:\.[0-9]{1,2})?)\b/g) || []
  for (const n of loose) {
    if (/^\d{4,8}$/.test(n)) continue
    if (Number(n) > 0) return n
  }
  return null
}

function productRichness(p) {
  return (p?.rate ? 2 : 0) + (p?.hsn ? 1 : 0) + (p?.gst ? 1 : 0)
}

/**
 * Autofill line items from products + knowledge documents, scoped to one tenant.
 */
export async function autofillItemsFromKnowledge(supabase, items, columns = [], userId) {
  if (!Array.isArray(items) || !items.length) {
    return { items: items || [], fills: [], mode: 'empty' }
  }

  const [products, docs, imageMemory] = await Promise.all([
    loadProducts(supabase, userId),
    loadKnowledgeDocs(supabase, userId),
    loadImageMemory(supabase, userId).catch(() => ({ id: null, products: [] }))
  ])
  const metaProducts = productsFromKnowledgeMeta(docs)
  const memoryProducts = (imageMemory.products || []).map(p => ({
    key: p.key,
    image_url: p.image || p.image_url || '',
    image_path: p.imagePath || p.image_path || '',
    _source: 'image_memory'
  }))
  const allProducts = [
    ...products.map(p => ({ ...p, rate: p.rate ?? '', _source: 'products' })),
    ...metaProducts.map(p => ({ ...p, _source: 'knowledge_meta' })),
    ...memoryProducts
  ]

  const fills = []
  const nextItems = items.map((item, index) => {
    const desc = primaryDescription(item, columns)
    const queryKey = normalizeKey(desc)
    if (!queryKey || queryKey.length < 3) return item

    let best = null
    let bestScore = 0
    let bestRich = -1
    for (const product of allProducts) {
      const score = scoreProductMatch(desc, product)
      const rich = productRichness(product)
      if (score > bestScore || (score === bestScore && rich > bestRich)) {
        bestScore = score
        bestRich = rich
        best = product
      }
    }

    if (best && bestScore >= MIN_CONFIDENCE) {
      // Merge same-key rows so metadata rates complement products-table HSN/GST
      const sameKey = allProducts.filter(p => normalizeKey(p.key) === normalizeKey(best.key) || scoreProductMatch(desc, p) >= bestScore - 0.05)
      const fill = {
        description: '',
        suggestedName: best.description || best.key,
        rate: sameKey.find(p => p.rate)?.rate || best.rate || '',
        hsn: sameKey.find(p => p.hsn)?.hsn || best.hsn || '',
        gst: sameKey.find(p => p.gst)?.gst || best.gst || '',
        image: sameKey.find(p => p.image_url)?.image_url || best.image_url || '',
        imagePath: sameKey.find(p => p.image_url)?.image_path || best.image_path || ''
      }
      // If rate missing, try snippet near match (never use HSN-like numbers)
      if (!fill.rate) {
        const snippets = searchTextSnippets(docs, queryKey, 2)
        for (const s of snippets) {
          const rate = parseRateNearQuery(s.snippet, queryKey)
          if (rate && rate !== fill.hsn) {
            fill.rate = rate
            break
          }
        }
      }
      const { item: filledItem, filled } = applyFill(item, columns, fill, {
        type: best._source === 'products' ? 'product' : 'knowledge',
        label: best._fromDoc || best.key || best.description,
        confidence: Number(bestScore.toFixed(2)),
        productKey: best.key
      })
      if (filled) {
        fills.push({ index, confidence: bestScore, source: filledItem._knowledgeFill })
        return filledItem
      }
      return item
    }

    // Fallback: text search only — fill rate/hsn if pattern is clear in a snippet
    const snippets = searchTextSnippets(docs, queryKey, 3)
    if (!snippets.length) return item
    const top = snippets[0]
    const rate = parseRateNearQuery(top.snippet, queryKey)
    const hsn = top.snippet.match(/\b(?:hsn|sac)?[:\s#-]*([0-9]{4,8})\b/i)?.[1]
    const gst = top.snippet.match(/\b([0-9]{1,2})\s*%\s*(?:gst|igst)?\b/i)?.[1]
    if (!rate && !hsn) return item
    const { item: filledItem, filled } = applyFill(item, columns, {
      description: '',
      rate: rate || '',
      hsn: hsn || '',
      gst: gst || ''
    }, {
      type: 'knowledge_text',
      label: top.filename,
      confidence: Number(Math.min(0.7, 0.45 + top.rank * 0.3).toFixed(2)),
      productKey: null
    })
    if (filled) {
      fills.push({ index, confidence: top.rank, source: filledItem._knowledgeFill })
      return filledItem
    }
    return item
  })

  const withSuggested = fillSuggestedOnItems(nextItems, columns, allProducts)

  return {
    items: withSuggested,
    fills,
    mode: fills.length ? 'matched' : 'none',
    stats: {
      productsLoaded: products.length,
      knowledgeDocs: docs.length,
      filledRows: fills.length
    }
  }
}

/**
 * Build compact knowledge context snippets for AI prompts (token-light), scoped to one tenant.
 */
export async function retrieveKnowledgeContext(supabase, enquiry, userId, { maxSnippets = 6 } = {}) {
  const query = normalizeKey(enquiry).split(' ').filter(t => t.length > 2).slice(0, 12).join(' ')
  if (!query) return { snippets: [], products: [] }

  // Prefer RPC full-text when migration applied
  try {
    const { data, error } = await supabase.rpc('search_knowledge_documents', {
      query,
      p_user_id: userId,
      max_rows: maxSnippets
    })
    if (!error && Array.isArray(data) && data.length) {
      const products = await loadProducts(supabase, userId)
      const matchedProducts = products
        .map(p => ({ p, score: scoreProductMatch(enquiry, p) }))
        .filter(x => x.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(x => x.p)
      return {
        snippets: data.map(r => ({
          filename: r.filename,
          text: r.snippet,
          rank: r.rank
        })),
        products: matchedProducts,
        mode: 'fts'
      }
    }
  } catch {
    /* fall through to client-side search */
  }

  const docs = await loadKnowledgeDocs(supabase, userId)
  const snippets = searchTextSnippets(docs, normalizeKey(enquiry), maxSnippets)
  const products = await loadProducts(supabase, userId)
  const matchedProducts = products
    .map(p => ({ p, score: scoreProductMatch(enquiry, p) }))
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(x => x.p)

  return {
    snippets: snippets.map(s => ({ filename: s.filename, text: s.snippet, rank: s.rank })),
    products: matchedProducts,
    mode: 'ilike'
  }
}

export function formatKnowledgePromptBlock(context) {
  if (!context) return ''
  const lines = []
  if (context.products?.length) {
    lines.push('Known products (prefer these rates/HSN/GST when the enquiry matches; do not invent others):')
    for (const p of context.products.slice(0, 8)) {
      lines.push(
        `- ${p.description || p.key}` +
        (p.keywords ? ` | also called: ${p.keywords}` : '') +
        (p.hsn ? ` | HSN ${p.hsn}` : '') +
        (p.gst ? ` | GST ${p.gst}%` : '') +
        (p.rate ? ` | Rate ${p.rate}` : '')
      )
    }
    lines.push('Keep each line item description as the customer wrote it, including local names or slang. Do not replace it with the catalogue name. Leave ourSuggested empty — the system fills the standard product name.')
  }
  if (context.snippets?.length) {
    lines.push('Relevant knowledge base snippets:')
    for (const s of context.snippets.slice(0, 6)) {
      lines.push(`From ${s.filename}: ${String(s.text || '').slice(0, 280)}`)
    }
  }
  if (!lines.length) return ''
  return `\n\n${lines.join('\n')}`
}

async function upsertExtractedProducts(supabase, candidates, userId) {
  if (!candidates?.length) return { upserted: 0, products: [] }
  const upserted = []
  for (const c of candidates.slice(0, 40)) {
    const key = normalizeKey(c.key || c.description)
    if (!key) continue
    const row = {
      key,
      user_id: userId,
      description: c.description || key,
      hsn: c.hsn || '',
      gst: c.gst || '',
      rate: c.rate || '',
      updated_at: new Date().toISOString()
    }
    let { data, error } = await supabase
      .from('products')
      .upsert(row, { onConflict: 'user_id,key' })
      .select('*')
      .maybeSingle()

    // Retry without rate if column not migrated yet
    if (error && /rate|schema cache|PGRST204/i.test(error.message || '')) {
      const { rate: _r, ...withoutRate } = row
      ;({ data, error } = await supabase
        .from('products')
        .upsert(withoutRate, { onConflict: 'user_id,key' })
        .select('*')
        .maybeSingle())
    }
    if (error) {
      console.warn('[knowledge] product upsert skipped', error.message)
      continue
    }
    if (data) upserted.push(data)

    // hsn_cache is global/shared (HSN/GST are public tax codes, not tenant secrets).
    await supabase.from('hsn_cache').upsert({
      key,
      description: row.description,
      hsn: row.hsn,
      gst: row.gst,
      updated_at: row.updated_at
    }, { onConflict: 'key' }).then(() => {}).catch(() => {})
  }
  return { upserted: upserted.length, products: upserted }
}

/**
 * Step 8: learn from quoted line items. Every autosave calls this with the
 * quote's current items/columns; description + rate + HSN + GST + image (per
 * row) merge into `products` so the next quotation with a matching item name
 * autofills from it — no re-typing, no repeat AI/HSN lookups. Never overwrites
 * a good existing field with a blank one from a half-filled row. Scoped to one
 * tenant so nobody else's quotes ever leak into your autofill.
 */
export async function learnItemsIntoProducts(supabase, items, columns = [], userId) {
  if (!Array.isArray(items) || !items.length) return { learned: 0 }

  const hsnCol = findColumnId(columns, ['hsnCode', 'hsn', 'hsncode'])
  const gstCol = findColumnId(columns, ['gst%', 'gstPercent', 'gst', 'gstpercent'])
  const rateCol = findColumnId(columns, ['rate'])
  const imageCol = (columns || []).find(isImageColumn)
  const sugId = suggestedColumnId(columns)

  const candidates = new Map()
  for (const item of items) {
    const desc = primaryDescription(item, columns)
    const suggested = sugId ? String(item[sugId] || '').split('\n')[0].trim() : ''
    const learnDesc = suggested || desc
    const key = normalizeKey(learnDesc)
    if (!key || key.length < 3) continue

    const rate = rateCol ? String(item[rateCol] ?? '').trim() : ''
    const hsn = hsnCol ? String(item[hsnCol] ?? '').trim() : ''
    const gst = gstCol ? String(item[gstCol] ?? '').trim() : ''
    const image = imageCol ? String(item[imageCol.id] ?? '').trim() : ''
    const imagePath = imageCol ? String(item[`${imageCol.id}__path`] ?? '').trim() : ''
    const alias = (suggested && desc && normalizeKey(desc) !== normalizeKey(suggested))
      ? desc.split('\n')[0].trim()
      : ''

    if (!rate && !hsn && !gst && !image) continue // nothing learnable on this row yet
    candidates.set(key, { key, description: learnDesc, rate, hsn, gst, image, imagePath, alias })
  }

  if (!candidates.size) return { learned: 0 }

  const keys = [...candidates.keys()]
  const { data: existingRows, error: existingErr } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', userId)
    .in('key', keys)
  if (existingErr) throw existingErr
  const existingByKey = new Map((existingRows || []).map(r => [r.key, r]))

  const now = new Date().toISOString()
  const rows = [...candidates.values()].map(c => {
    const existing = existingByKey.get(c.key)
    return {
      key: c.key,
      user_id: userId,
      description: existing?.description || c.description || c.key,
      hsn: c.hsn || existing?.hsn || '',
      gst: c.gst || existing?.gst || '',
      rate: c.rate || existing?.rate || '',
      image_url: c.image || existing?.image_url || '',
      image_path: c.imagePath || existing?.image_path || '',
      keywords: formatKeywords([existing?.keywords, c.alias]),
      updated_at: now
    }
  })

  let { error } = await supabase.from('products').upsert(rows, { onConflict: 'user_id,key' })
  let imageColumnMissing = false

  // Retry without image_url/image_path if that migration isn't applied yet.
  if (error && /image_url|image_path|schema cache|PGRST204/i.test(error.message || '')) {
    imageColumnMissing = true
    const rowsWithoutImage = rows.map(({ image_url: _u, image_path: _p, ...rest }) => rest)
    ;({ error } = await supabase.from('products').upsert(rowsWithoutImage, { onConflict: 'user_id,key' }))
  }
  // Defensive: retry without rate too, in case the earlier migration is also missing.
  if (error && /rate|schema cache|PGRST204/i.test(error.message || '')) {
    const rowsWithoutRate = rows.map(({ rate: _r, image_url: _u, image_path: _p, ...rest }) => rest)
    ;({ error } = await supabase.from('products').upsert(rowsWithoutRate, { onConflict: 'user_id,key' }))
  }
  if (error && /keywords|schema cache|PGRST204/i.test(error.message || '')) {
    const rowsWithoutKeywords = rows.map(({ keywords: _k, image_url: _u, image_path: _p, ...rest }) => rest)
    ;({ error } = await supabase.from('products').upsert(rowsWithoutKeywords, { onConflict: 'user_id,key' }))
  }
  if (error) {
    console.warn('[knowledge] learn upsert skipped', error.message)
    return { learned: 0, error: error.message }
  }

  await Promise.all(rows.filter(r => r.hsn).map(r =>
    supabase.from('hsn_cache').upsert({
      key: r.key, description: r.description, hsn: r.hsn, gst: r.gst, updated_at: r.updated_at
    }, { onConflict: 'key' }).then(() => {}).catch(() => {})
  ))

  // Migration not applied yet — remember learned images via knowledge_documents metadata instead.
  if (imageColumnMissing) {
    const imageRows = rows.filter(r => r.image_url)
    if (imageRows.length) {
      try {
        const memory = await loadImageMemory(supabase, userId)
        const byKey = new Map(memory.products.map(p => [p.key, p]))
        for (const r of imageRows) byKey.set(r.key, { key: r.key, image: r.image_url, imagePath: r.image_path })
        await saveImageMemory(supabase, userId, memory.id, [...byKey.values()])
      } catch (memErr) {
        console.warn('[knowledge] image memory fallback failed', memErr?.message || memErr)
      }
    }
  }

  return { learned: rows.length }
}

export function registerKnowledgeRoutes(app) {
  // List
  app.get('/api/knowledge-documents', async (req, res) => {
    const requestId = `kd-list-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('knowledge_documents')
        .select('id, filename, mime, extracted_text, metadata, created_at')
        .eq('user_id', req.userId)
        .neq('filename', IMAGE_MEMORY_FILENAME)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      res.json({ documents: (data || []).map(r => mapKnowledgeDoc(r, { fullText: false })) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // Get one (full text)
  app.get('/api/knowledge-documents/:id', async (req, res) => {
    const requestId = `kd-get-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('knowledge_documents')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'Document not found.', code: 'NOT_FOUND', requestId })
      res.json({ document: mapKnowledgeDoc(data, { fullText: true }) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // Delete
  app.delete('/api/knowledge-documents/:id', async (req, res) => {
    const requestId = `kd-del-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('knowledge_documents')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'Document not found.', code: 'NOT_FOUND', requestId })
      res.json({ ok: true, id: data.id })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // Multi-file upload + extract + store
  app.post('/api/knowledge-documents/upload', (req, res) => {
    const requestId = `kd-up-${Date.now()}`
    upload.array('files', 12)(req, res, async (err) => {
      const supabase = requireDb(res, requestId)
      if (!supabase) return
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? 'Each file must be under 20 MB.'
          : (err.message || 'Upload failed')
        return res.status(400).json({ error: message, code: 'VALIDATION_ERROR', requestId })
      }
      try {
        const files = req.files || []
        if (!files.length) {
          return res.status(400).json({ error: 'Choose one or more files to upload.', code: 'VALIDATION_ERROR', requestId })
        }

        const results = []
        for (const file of files) {
          try {
            const extracted = await extractKnowledgeText(file)
            const candidates = extractProductCandidates(extracted.text)
            const row = {
              filename: file.originalname || 'upload',
              user_id: req.userId,
              mime: extracted.mime,
              extracted_text: extracted.text,
              metadata: {
                ...extracted.meta,
                products: candidates,
                productCount: candidates.length
              }
            }
            const { data, error } = await supabase
              .from('knowledge_documents')
              .insert(row)
              .select('*')
              .single()
            if (error) throw error

            const productResult = await upsertExtractedProducts(supabase, candidates, req.userId)
            results.push({
              ok: true,
              document: mapKnowledgeDoc(data, { fullText: false }),
              productsUpserted: productResult.upserted
            })
          } catch (fileError) {
            console.error(`[${requestId}] extract failed`, file.originalname, fileError?.message)
            results.push({
              ok: false,
              filename: file.originalname,
              error: fileError?.message || 'Could not extract text from this file.',
              code: fileError?.code || 'EXTRACT_FAILED'
            })
          }
        }

        const saved = results.filter(r => r.ok)
        const failed = results.filter(r => !r.ok)
        res.status(saved.length ? 201 : 422).json({
          documents: saved.map(r => r.document),
          productsUpserted: saved.reduce((n, r) => n + (r.productsUpserted || 0), 0),
          failed,
          requestId
        })
      } catch (error) {
        supabaseError(error, res, requestId)
      }
    })
  })

  // Autofill endpoint for editor / generate
  app.post('/api/knowledge/autofill', async (req, res) => {
    const requestId = `kd-af-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { items = [], columns = [] } = req.body || {}
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'items must be an array.', code: 'VALIDATION_ERROR', requestId })
      }
      const result = await autofillItemsFromKnowledge(supabase, items, columns, req.userId)
      res.json({ ...result, requestId })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // Step 8: learn from quoted line items — called on every autosave.
  app.post('/api/knowledge/learn', async (req, res) => {
    const requestId = `kd-learn-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { items = [], columns = [] } = req.body || {}
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'items must be an array.', code: 'VALIDATION_ERROR', requestId })
      }
      const result = await learnItemsIntoProducts(supabase, items, columns, req.userId)
      res.json({ ...result, requestId })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })
}
