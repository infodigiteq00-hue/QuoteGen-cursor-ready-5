/**
 * Deterministic extraction for industrial enquiry lists that repeat as:
 *   line-ref (7–12 digits)
 *   item/material code (5–12 digits)
 *   short description
 *   long specification (1+ lines)
 *   quantity
 *   unit
 *
 * Also accepts the same fields on one tab-separated row, and quantity+unit
 * on a single line ("3,600 Nos"). This format must not go through a single
 * LLM JSON call: max_tokens truncation and sampling drop different rows on
 * every run (e.g. 25 vs 28 of 32).
 */

import { isSuggestedColumn } from '../shared/productKeywords.js'

const UNIT_RE = /^(nos?|pcs?|pieces?|kg|kgs|kilograms?|m|mtr|mtrs|meters?|metres?|set|sets|box|boxes|ltr|ltrs|litres?|liters?|pair|pairs|roll|rolls|pkt|pkts|packet|packets|each|ea|unit|units|no\.?)\.?$/i
const QTY_RE = /^(?:\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d+)?$/
const CODE_RE = /^\d{5,12}$/
const LINE_REF_RE = /^\d{8,12}$/

function isCode(line) {
  return CODE_RE.test(line)
}

function isLineRef(line) {
  return LINE_REF_RE.test(line)
}

function isQty(line) {
  return QTY_RE.test(line) && !isCode(line)
}

function isUnit(line) {
  return UNIT_RE.test(String(line || '').trim())
}

function normalizeQty(raw) {
  return String(raw || '').replace(/,/g, '')
}

function normalizeLine(line) {
  return String(line || '').replace(/\u00a0/g, ' ').replace(/\t/g, ' ').trim()
}

function looksLikeNextItem(lines, index, hasDesc) {
  if (!hasDesc || index + 1 >= lines.length) return false
  return isLineRef(lines[index]) && isCode(lines[index + 1])
}

/** Quantity alone, or "3,600 Nos" / "3.050 M" on one line. */
function qtyUnitFromLine(line) {
  const text = normalizeLine(line)
  if (!text) return null
  if (isQty(text)) return { quantity: text, unit: null }
  const m = text.match(/^((?:\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d+)?)\s+(\S+)$/)
  if (m && isQty(m[1]) && isUnit(m[2])) return { quantity: m[1], unit: m[2] }
  return null
}

function catalogItem(lineRef, itemCode, descLines, quantityRaw, unit) {
  const shortName = descLines[0]
  const spec = descLines.slice(1).join(' ').replace(/\s+/g, ' ').trim()
  return {
    lineRef,
    itemCode,
    shortName,
    spec,
    quantity: normalizeQty(quantityRaw),
    unit: String(unit || '').replace(/\.$/, '')
  }
}

function parseTsvCatalogLine(raw) {
  if (!String(raw || '').includes('\t')) return null
  const parts = String(raw)
    .split('\t')
    .map(part => part.replace(/\u00a0/g, ' ').trim())
    .filter(part => part.length > 0)
  if (parts.length < 4 || !isLineRef(parts[0]) || !isCode(parts[1])) return null

  const last = qtyUnitFromLine(parts[parts.length - 1])
  let quantityRaw
  let unit
  let descParts
  if (last?.unit) {
    quantityRaw = last.quantity
    unit = last.unit
    descParts = parts.slice(2, -1)
  } else if (parts.length >= 5 && isQty(parts[parts.length - 2]) && isUnit(parts[parts.length - 1])) {
    quantityRaw = parts[parts.length - 2]
    unit = parts[parts.length - 1]
    descParts = parts.slice(2, -2)
  } else {
    return null
  }
  if (!descParts.length) return null
  return catalogItem(parts[0], parts[1], descParts, quantityRaw, unit)
}

function extractBlockCatalogItems(enquiry) {
  const lines = String(enquiry || '')
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(line => line.length > 0)

  const items = []
  let i = 0
  while (i < lines.length) {
    if (!isLineRef(lines[i])) {
      i += 1
      continue
    }
    const lineRef = lines[i]
    let j = i + 1
    if (j >= lines.length || !isCode(lines[j])) {
      i += 1
      continue
    }
    const itemCode = lines[j]
    j += 1

    const descLines = []
    while (j < lines.length && !qtyUnitFromLine(lines[j]) && !isUnit(lines[j])) {
      if (looksLikeNextItem(lines, j, descLines.length >= 1)) break
      descLines.push(lines[j])
      j += 1
      if (descLines.length > 16) break
    }

    const parsedQty = j < lines.length ? qtyUnitFromLine(lines[j]) : null
    if (!parsedQty || !descLines.length) {
      i += 1
      continue
    }
    j += 1
    let unit = parsedQty.unit
    if (!unit) {
      if (j >= lines.length || !isUnit(lines[j])) {
        i += 1
        continue
      }
      unit = lines[j]
      j += 1
    }

    items.push(catalogItem(lineRef, itemCode, descLines, parsedQty.quantity, unit))
    i = j
  }

  return items
}

/**
 * Split pasted enquiry text into catalog rows. Returns [] when the repeating
 * code/desc/qty/unit pattern is not present (plain-language emails stay on AI).
 */
export function extractCatalogLineItems(enquiry) {
  const tsvItems = String(enquiry || '')
    .split(/\r?\n/)
    .map(parseTsvCatalogLine)
    .filter(Boolean)
  if (tsvItems.length >= 3) return tsvItems
  return extractBlockCatalogItems(enquiry)
}

export function catalogItemCountHint(enquiry) {
  const matches = String(enquiry || '').match(/^\d{8,12}(?:\s|\t|$)/gm)
  return matches ? matches.length : 0
}

function normalizeColKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Tokens that signal a column's *role*, not a single hard-coded label. */
const FIELD_HINTS = {
  lineRef: [
    'lineref', 'lineno', 'linenumber', 'enquiryline', 'indent', 'indentno', 'indentnumber',
    'purchaserequisition', 'purchasereq', 'prno', 'prnumber',
    'requisition', 'requisitionno', 'requisitionnumber', 'reqno', 'reqnumber',
    'series', 'seriesno', 'seriesnumber', 'serial', 'serialno', 'serialnumber',
    'enquiryno', 'enquiryref', 'enquirynumber', 'enquiryid',
    'referenceno', 'referencenumber', 'refno', 'refnumber',
    'docno', 'documentno', 'documentnumber', 'pr'
  ],
  itemCode: [
    'itemcode', 'itemno', 'itemnumber', 'itemid',
    'materialcode', 'materialno', 'materialnumber', 'material',
    'partno', 'partnumber', 'partcode', 'sku', 'productcode', 'productno', 'productnumber',
    'code', 'matcode', 'sapcode', 'materialid'
  ],
  quantity: ['quantity', 'qty', 'qtynos', 'orderqty', 'reqqty'],
  unit: ['unit', 'uom', 'uomcode', 'measure', 'unitofmeasure']
}

function columnMatchKeys(col) {
  const id = normalizeColKey(col?.id)
  const label = normalizeColKey(col?.label)
  return { id, label, both: `${id}${label}` }
}

/**
 * Score how well a quotation column fits a catalog field (line ref / material / qty…).
 * Uses id + label meaning — "Series Number", "PR No.", "Purchase Requisition" all
 * compete for the purchase-requisition / line-ref value.
 */
function scoreColumnForField(col, field) {
  const hints = FIELD_HINTS[field] || []
  if (!hints.length || !col) return 0
  const { id, label, both } = columnMatchKeys(col)
  if (!id && !label) return 0

  let score = 0
  for (const hint of hints) {
    if (!hint) continue
    if (id === hint || label === hint) score = Math.max(score, 100)
    else if (id.startsWith(hint) || label.startsWith(hint)) score = Math.max(score, 88)
    else if (id.includes(hint) || label.includes(hint)) score = Math.max(score, 72)
    else if (hint.length >= 4 && both.includes(hint)) score = Math.max(score, 60)
  }

  // Prefer requisition/series-style labels for lineRef over bare "number".
  if (field === 'lineRef') {
    if (/series|requisition|\bpr\b|indent|enquiry|reference|serial/.test(`${id} ${label}`)) score += 12
    if (/material|part|sku|product/.test(`${id} ${label}`)) score -= 40
  }
  if (field === 'itemCode') {
    if (/material|part|sku|product|item|code|mat/.test(`${id} ${label}`)) score += 10
    if (/series|requisition|indent|enquiryref|purchase/.test(`${id} ${label}`)) score -= 40
  }
  return score
}

function pickBestColumn(columns, field, usedIds) {
  let best = null
  let bestScore = 0
  for (const col of columns || []) {
    if (!col?.id || usedIds.has(col.id)) continue
    const score = scoreColumnForField(col, field)
    if (score > bestScore) {
      bestScore = score
      best = col
    }
  }
  // Require a real signal — don't dump PR into a random text column.
  if (!best || bestScore < 55) return null
  return best
}

function fillKnownCodeColumns(row, parsed, columns) {
  const used = new Set()
  const assignField = (field, value) => {
    if (value == null || value === '') return
    const col = pickBestColumn(columns, field, used)
    if (!col) return
    if (row[col.id] == null || row[col.id] === '') {
      row[col.id] = value
      used.add(col.id)
    }
  }

  // Line-ref (Purchase Requisition) first so "Series Number" wins over material.
  assignField('lineRef', parsed.lineRef)
  assignField('itemCode', parsed.itemCode)
  assignField('quantity', parsed.quantity)
  assignField('unit', parsed.unit)
}

/**
 * Map catalog rows onto the quotation column template.
 */
export function catalogItemsToQuoteRows(parsedItems, columns, blankItem) {
  return parsedItems.map(parsed => {
    const row = { ...blankItem }
    const description = parsed.spec
      ? `${parsed.shortName}\n${parsed.spec}`
      : parsed.shortName
    const descCol = (columns || []).find(c => String(c?.id || '').toLowerCase() === 'description')
      || (columns || []).find(c => /desc|enquiry|inquiry|item name|particular/i.test(String(c?.label || '')))
    if (descCol) row[descCol.id] = description
    else if ('description' in row) row.description = description
    else {
      const first = (columns || []).find(c => c && !isSuggestedColumn(c))
      if (first) row[first.id] = description
    }
    fillKnownCodeColumns(row, parsed, columns)
    return row
  })
}

export function isCatalogEnquiry(enquiry) {
  const items = extractCatalogLineItems(enquiry)
  const hinted = catalogItemCountHint(enquiry)
  return items.length >= 3 && hinted >= 3 && items.length >= Math.min(hinted, items.length)
}
