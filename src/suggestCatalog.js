import { columnType, isImageColumn, isAttachmentColumn, isNestedColumn, rateKey } from '../shared/quoteColumns.js'
import { isSuggestedColumn, scoreProductKeywords, standardProductName } from '../shared/productKeywords.js'

function norm(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function firstLine(value) {
  return String(value || '').split('\n')[0].trim()
}

export function scoreMatch(query, ...fields) {
  const q = norm(query)
  if (!q) return 0
  const hay = norm(fields.filter(Boolean).join(' · '))
  if (!hay) return 0
  if (hay === q) return 100
  if (hay.startsWith(q)) return 92
  if (hay.includes(q)) return 74
  const tokens = q.split(' ').filter(t => t.length >= 2)
  if (tokens.length && tokens.every(t => hay.includes(t))) return 62
  if (q.length >= 3 && tokens.some(t => hay.includes(t))) return 40
  return 0
}

export function clientsFromQuotations(quotations, extraCustomer) {
  const map = new Map()
  const add = (c, source) => {
    const company = String(c?.company || '').trim()
    const name = String(c?.name || '').trim()
    const gst = String(c?.gst || '').trim()
    const location = String(c?.location || '').trim()
    if (!company && !name && !gst) return
    const key = norm(gst || company || name)
    if (!key || map.has(key)) return
    map.set(key, { company, name, gst, location, source })
  }
  for (const q of quotations || []) add(q.customer, q.number || 'history')
  if (extraCustomer) add(extraCustomer, 'this quote')
  return [...map.values()]
}

export function matchClients(clients, query, field = 'company') {
  const q = String(query || '').trim()
  const list = clients || []
  if (!q) return list.slice(0, 8).map(c => ({ ...c, score: 1 }))
  return list
    .map(c => {
      const focused = field === 'gst' ? c.gst : field === 'name' ? c.name : field === 'location' ? c.location : c.company
      const score = Math.max(
        scoreMatch(q, focused),
        scoreMatch(q, c.company, c.name, c.gst, c.location) * 0.9
      )
      return { ...c, score }
    })
    .filter(c => c.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

function productKey(p) {
  return norm(firstLine(p?.description) || p?.key || p?.hsn)
}

export function productsFromHistory(quotations, catalogProducts, currentItems) {
  const map = new Map()
  const add = (p, source) => {
    const description = firstLine(p?.description)
    const hsn = String(p?.hsn || '').trim()
    const unit = String(p?.unit || '').trim()
    const rate = String(p?.rate ?? '').trim()
    const gst = String(p?.gst ?? '').trim()
    if (!description && !hsn) return
    const key = productKey({ description, hsn, key: p?.key })
    if (!key) return
    const prev = map.get(key)
    if (prev && (prev.rate || prev.hsn) && !rate && !hsn) return
    map.set(key, {
      description,
      hsn,
      unit,
      rate,
      gst,
      keywords: p?.keywords || prev?.keywords || '',
      key: p?.key || prev?.key,
      source
    })
  }
  for (const p of catalogProducts || []) add(p, 'catalogue')
  for (const q of quotations || []) {
    for (const hint of q.lineHints || []) add(hint, q.number || 'history')
  }
  for (const item of currentItems || []) {
    add({
      description: item.description,
      hsn: item.hsn || item.hsnCode,
      unit: item.unit,
      rate: item.rate,
      gst: item.gst || item.gstPercent || item['gst%']
    }, 'this quote')
  }
  return [...map.values()]
}

export function matchProducts(products, query) {
  const q = String(query || '').trim()
  if (q.length < 1) return []
  return (products || [])
    .map(p => ({
      ...p,
      score: Math.max(
        scoreMatch(q, p.description, p.hsn, p.unit, p.rate, p.gst, p.keywords),
        Math.round(scoreProductKeywords(q, p) * 100)
      )
    }))
    .filter(p => p.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

function findCol(columns, test) {
  return (columns || []).find(c => {
    if (!c || isImageColumn(c) || isAttachmentColumn(c) || isNestedColumn(c)) return false
    return test(c)
  })
}

export function applyProductToItem(item, columns, product, typedColId) {
  const next = { ...(item || {}) }
  const descCol = findCol(columns, c => c.id === 'description' || /desc|enquiry|inquiry/i.test(c.label || ''))
  const suggestedCol = (columns || []).find(isSuggestedColumn)
  const hsnCol = findCol(columns, c => columnType(c) === 'hsn' || /hsn|sac/i.test(`${c.id} ${c.label}`))
  const unitCol = findCol(columns, c => /unit|uom/i.test(`${c.id} ${c.label}`))
  const rateCol = findCol(columns, c => c.id === 'rate')
  const put = (id, value) => {
    if (!id || value == null || String(value).trim() === '') return
    const current = String(next[id] ?? '').trim()
    if (id === typedColId || !current) next[id] = String(value)
  }
  const catalogueName = standardProductName(product) || firstLine(product.description)
  if (suggestedCol && catalogueName) {
    next[suggestedCol.id] = catalogueName
    next._suggestedAuto = catalogueName
  } else if (descCol && product.description) {
    if (typedColId === descCol.id || !String(next[descCol.id] || '').trim()) {
      const secondary = String(next[descCol.id] || '').split('\n').slice(1).join('\n').trim()
      next[descCol.id] = secondary ? `${firstLine(product.description)}\n${secondary}` : firstLine(product.description)
    }
  }
  put(hsnCol?.id, product.hsn)
  put(unitCol?.id, product.unit)
  put(rateCol?.id, product.rate)
  const taxCol = (columns || []).find(c => isNestedColumn(c) && columnType(c) === 'tax')
  if (taxCol && product.gst) {
    const rk = rateKey(taxCol)
    if (typedColId === rk || !String(next[rk] || '').trim()) next[rk] = String(product.gst)
  }
  return next
}
