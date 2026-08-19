/**
 * Deterministic extraction for industrial enquiry lists that repeat as:
 *   line-ref (7–12 digits)
 *   item/material code (5–12 digits)
 *   short description
 *   long specification (1+ lines)
 *   quantity
 *   unit
 *
 * This format must not go through a single LLM JSON call: max_tokens truncation
 * and sampling drop different rows on every run (e.g. 25 vs 28 of 32).
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
  return UNIT_RE.test(line.trim())
}

function normalizeQty(raw) {
  return String(raw || '').replace(/,/g, '')
}

function looksLikeNextItem(lines, index, hasDesc) {
  if (!hasDesc || index + 1 >= lines.length) return false
  return isLineRef(lines[index]) && isCode(lines[index + 1])
}

/**
 * Split pasted enquiry text into catalog rows. Returns [] when the repeating
 * code/desc/qty/unit pattern is not present (plain-language emails stay on AI).
 */
export function extractCatalogLineItems(enquiry) {
  const lines = String(enquiry || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\u00a0/g, ' ').replace(/\t/g, ' ').trim())
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
    while (j < lines.length && !isQty(lines[j]) && !isUnit(lines[j])) {
      if (looksLikeNextItem(lines, j, descLines.length >= 1)) break
      descLines.push(lines[j])
      j += 1
      if (descLines.length > 16) break
    }

    if (j >= lines.length || !isQty(lines[j]) || !descLines.length) {
      i += 1
      continue
    }
    const quantityRaw = lines[j]
    j += 1
    if (j >= lines.length || !isUnit(lines[j])) {
      i += 1
      continue
    }
    const unit = lines[j]
    j += 1

    const shortName = descLines[0]
    const spec = descLines.slice(1).join(' ').replace(/\s+/g, ' ').trim()
    items.push({
      lineRef,
      itemCode,
      shortName,
      spec,
      quantity: normalizeQty(quantityRaw),
      unit: unit.replace(/\.$/, '')
    })
    i = j
  }

  return items
}

export function catalogItemCountHint(enquiry) {
  const matches = String(enquiry || '').match(/^\d{8,12}\s*$/gm)
  return matches ? matches.length : 0
}

function fillKnownCodeColumns(row, parsed, columns) {
  const byId = new Map((columns || []).map(c => [String(c.id).toLowerCase(), c.id]))
  const byLabel = new Map((columns || []).map(c => [String(c.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ''), c.id]))

  const assign = (keys, value) => {
    if (!value) return
    for (const key of keys) {
      const id = byId.get(key) || byLabel.get(key)
      if (id && (row[id] == null || row[id] === '')) row[id] = value
    }
  }

  assign(['itemcode', 'itemno', 'itemnumber', 'materialcode', 'partno', 'partnumber', 'code'], parsed.itemCode)
  assign(['lineref', 'lineno', 'linenumber', 'enquiryline', 'indentno', 'indentnumber'], parsed.lineRef)
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
    if ('quantity' in row) row.quantity = parsed.quantity
    if ('unit' in row) row.unit = parsed.unit
    fillKnownCodeColumns(row, parsed, columns)
    return row
  })
}

export function isCatalogEnquiry(enquiry) {
  const items = extractCatalogLineItems(enquiry)
  const hinted = catalogItemCountHint(enquiry)
  return items.length >= 3 && hinted >= 3 && items.length >= Math.min(hinted, items.length)
}
