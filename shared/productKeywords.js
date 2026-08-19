/**
 * Custom product keywords: map a customer's local / trade name
 * ("plates", "bags") onto the company's standard catalogue name ("blades").
 *
 * Matching never rewrites the enquiry description. The standard name belongs
 * in the "Our suggested" column only.
 */

export const SUGGESTED_COLUMN_ID = 'ourSuggested'
export const SUGGESTED_COLUMN = { id: SUGGESTED_COLUMN_ID, label: 'Our suggested', type: 'text' }

export const KEYWORD_MATCH_MIN = 0.72

export function normalizeMatchKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseKeywords(raw) {
  const chunks = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/[,;|\n]+/)
  const seen = new Set()
  const out = []
  for (const chunk of chunks) {
    const value = String(chunk || '').trim()
    const key = normalizeMatchKey(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value.replace(/\s+/g, ' ').trim())
  }
  return out
}

export function formatKeywords(raw) {
  return parseKeywords(raw).join(', ')
}

export function isSuggestedColumn(col) {
  if (!col) return false
  const id = String(col.id || '').replace(/[_-\s]/g, '').toLowerCase()
  const label = String(col.label || '').replace(/[_-\s]/g, '').toLowerCase()
  return id === 'oursuggested' || label === 'oursuggested'
}

function descriptionIndex(columns) {
  const list = columns || []
  const byId = list.findIndex(c => String(c?.id || '').toLowerCase() === 'description')
  if (byId >= 0) return byId
  return list.findIndex(c => /desc|enquiry|inquiry|item name|particular/i.test(String(c?.label || '')))
}

/** Insert "Our suggested" immediately after the enquiry/description column. */
export function ensureSuggestedColumn(columns) {
  const list = Array.isArray(columns) ? columns : []
  if (list.some(isSuggestedColumn)) return list
  const next = [...list]
  const col = { ...SUGGESTED_COLUMN }
  const descIdx = descriptionIndex(next)
  if (descIdx >= 0) next.splice(descIdx + 1, 0, col)
  else if (next.length) next.splice(1, 0, col)
  else next.push(col)
  return next
}

export function suggestedColumnId(columns) {
  return (columns || []).find(isSuggestedColumn)?.id || null
}

function tokenize(text) {
  return normalizeMatchKey(text).split(' ').filter(t => t.length >= 2)
}

function stemSet(token) {
  const t = String(token || '').toLowerCase()
  const out = new Set([t])
  if (t.length < 3) return out
  if (t.endsWith('ies') && t.length > 4) out.add(`${t.slice(0, -3)}y`)
  if (t.endsWith('es') && t.length > 3) out.add(t.slice(0, -2))
  if (t.endsWith('s') && t.length > 3) out.add(t.slice(0, -1))
  out.add(`${t}s`)
  if (!t.endsWith('e')) out.add(`${t}es`)
  return out
}

function tokenStems(text) {
  const stems = new Set()
  for (const token of tokenize(text)) {
    for (const s of stemSet(token)) stems.add(s)
  }
  return stems
}

function nameScore(queryKey, name) {
  const pKey = normalizeMatchKey(name)
  if (!queryKey || !pKey) return 0
  if (queryKey === pKey) return 1
  if (queryKey.includes(pKey) || pKey.includes(queryKey)) {
    const shorter = Math.min(queryKey.length, pKey.length)
    const longer = Math.max(queryKey.length, pKey.length)
    return 0.72 + (shorter / longer) * 0.2
  }
  const qTokens = new Set(queryKey.split(' ').filter(t => t.length > 1))
  const pTokens = pKey.split(' ').filter(t => t.length > 1)
  if (!qTokens.size || !pTokens.length) return 0
  const overlap = pTokens.filter(t => qTokens.has(t)).length
  const ratio = overlap / Math.max(pTokens.length, qTokens.size)
  if (ratio >= 0.7) return 0.6 + ratio * 0.25
  if (ratio >= 0.5 && overlap >= 2) return 0.55 + ratio * 0.15
  return 0
}

function keywordScore(query, keywords) {
  const queryKey = normalizeMatchKey(query)
  if (!queryKey) return 0
  const qStems = tokenStems(query)
  let best = 0
  for (const kw of parseKeywords(keywords)) {
    const kNorm = normalizeMatchKey(kw)
    if (!kNorm) continue
    if (queryKey === kNorm) {
      best = Math.max(best, 1)
      continue
    }
    if (queryKey.includes(kNorm) || kNorm.includes(queryKey)) {
      const ratio = Math.min(queryKey.length, kNorm.length) / Math.max(queryKey.length, kNorm.length)
      best = Math.max(best, 0.88 + ratio * 0.1)
      continue
    }
    const kTokens = tokenize(kw)
    if (!kTokens.length) continue
    const matched = kTokens.filter(t => [...stemSet(t)].some(s => s.length >= 3 && qStems.has(s)))
    if (matched.length === kTokens.length) {
      best = Math.max(best, kTokens.length === 1 ? 0.9 : 0.94)
    } else if (matched.length) {
      best = Math.max(best, 0.74)
    }
  }
  return best
}

export function scoreProductKeywords(query, product) {
  if (!product) return 0
  const queryKey = normalizeMatchKey(query)
  const fromName = Math.max(
    nameScore(queryKey, product.key),
    nameScore(queryKey, product.description)
  )
  const fromKeywords = keywordScore(query, product.keywords)
  return Math.max(fromName, fromKeywords)
}

export function standardProductName(product) {
  const name = String(product?.description || '').split('\n')[0].trim()
  return name || String(product?.key || '').trim()
}

export function bestProductMatch(query, products, minScore = KEYWORD_MATCH_MIN) {
  let best = null
  let bestScore = 0
  for (const product of products || []) {
    const score = scoreProductKeywords(query, product)
    if (score > bestScore) {
      bestScore = score
      best = product
    }
  }
  if (!best || bestScore < minScore) return null
  return { product: best, score: bestScore }
}

function itemEnquiryText(item, columns) {
  if (!item || typeof item !== 'object') return ''
  if (item.description != null && String(item.description).trim()) {
    return String(item.description)
  }
  const descCol = (columns || []).find(c => String(c?.id || '').toLowerCase() === 'description')
    || (columns || []).find(c => /desc|enquiry|inquiry/i.test(String(c?.label || '')))
  if (descCol && item[descCol.id] != null) return String(item[descCol.id])
  return ''
}

/**
 * Write the catalogue name into Our suggested. Never touches description,
 * quantity, unit, or any other enquiry field. Leaves a user-typed suggestion
 * alone unless it still matches the last auto-filled value.
 */
export function applySuggestedName(item, columns, product) {
  if (!item) return item
  const colId = suggestedColumnId(columns)
  const name = standardProductName(product)
  if (!colId || !name) return item
  const current = String(item[colId] || '').trim()
  const prevAuto = String(item._suggestedAuto || '').trim()
  if (current && current !== prevAuto) return item
  if (current === name && prevAuto === name) return item
  return { ...item, [colId]: name, _suggestedAuto: name }
}

/** Insert Our suggested and add the empty cell key without touching other fields. */
export function attachSuggestedColumn(columns, items) {
  const nextColumns = ensureSuggestedColumn(columns)
  const colId = suggestedColumnId(nextColumns)
  const nextItems = (items || []).map(item => {
    if (!item || !colId || item[colId] != null) return item
    return { ...item, [colId]: '' }
  })
  return { columns: nextColumns, items: nextItems }
}

export function fillSuggestedOnItems(items, columns, products) {
  if (!Array.isArray(items) || !items.length) return items || []
  const colId = suggestedColumnId(columns)
  if (!colId) return items
  return items.map(item => {
    const query = itemEnquiryText(item, columns)
    const matched = bestProductMatch(query, products)
    if (!matched) return item
    return applySuggestedName(item, columns, matched.product)
  })
}
