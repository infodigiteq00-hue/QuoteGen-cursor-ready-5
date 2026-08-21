/**
 * Shared helpers for uploaded Word/Excel quotation templates.
 * Safe around images/data-URIs; fuzzy header → field mapping.
 */

export function protectImages(html) {
  const held = []
  const out = String(html || '').replace(/<img\b[^>]*(?:\/>|>)/gi, (tag) => {
    held.push(tag)
    return `<!--QGIMG:${held.length - 1}-->`
  })
  return { html: out, held }
}

export function restoreImages(html, held = []) {
  return String(html || '').replace(/<!--QGIMG:(\d+)-->/g, (full, i) => (
    Object.prototype.hasOwnProperty.call(held, Number(i)) ? (held[Number(i)] || '') : full
  ))
}

function protectPermanent(html) {
  const held = []
  const out = String(html || '').replace(/<div[^>]*data-qg-permanent[^>]*>[\s\S]*?<\/div>/gi, (tag) => {
    held.push(tag)
    return `<!--QGPERM:${held.length - 1}-->`
  })
  return { html: out, held }
}

function restorePermanent(html, held = []) {
  return String(html || '').replace(/<!--QGPERM:(\d+)-->/g, (full, i) => (
    Object.prototype.hasOwnProperty.call(held, Number(i)) ? (held[Number(i)] || '') : full
  ))
}

const DYNAMIC_SLOT_ROLES = new Set([
  'quote_number', 'date', 'valid_until', 'customer_name', 'customer_company',
  'customer_gst', 'customer_location', 'customer_block', 'subject',
  'line_items', 'line_cell', 'total', 'notes'
])

export function collectWordSlots(html) {
  const found = new Set()
  for (const m of String(html || '').matchAll(/data-slot="([^"]+)"/gi)) found.add(m[1])
  const slots = []
  const seen = new Set()
  const add = (role, permanent) => {
    if (!role || seen.has(role) || role === 'temp_value') return
    seen.add(role)
    slots.push({ role, permanent: Boolean(permanent) })
  }
  for (const role of found) {
    if (role === 'line_cell') add('line_items', false)
    else add(role, !DYNAMIC_SLOT_ROLES.has(role))
  }
  for (const role of ['company_block', 'bank_details', 'terms', 'images', 'header_footer']) {
    add(role, true)
  }
  return slots
}

export function collectExcelMapping(sheets) {
  const dynamicCells = []
  const roles = new Set()
  let hasLines = false
  ;(sheets || []).forEach((sheet, si) => {
    (sheet.rows || []).forEach((row, ri) => {
      (row.cells || []).forEach((cell) => {
        const role = cell.role
        if (role === 'line_item') hasLines = true
        if (!role || role === 'content' || role === 'line_item' || role === 'formula') return
        roles.add(role)
        if (role !== 'total') {
          dynamicCells.push({ sheet: si, row: ri, col: cell.col, role, permanent: false })
        }
      })
    })
  })
  const slots = []
  const add = (role, permanent) => {
    if (!role || slots.some(s => s.role === role)) return
    slots.push({ role, permanent: Boolean(permanent) })
  }
  for (const role of roles) add(role, false)
  if (hasLines) add('line_items', false)
  add('formulas', true)
  add('header_footer', true)
  add('images', true)
  return { slots, dynamicCells }
}

export function sheetsHaveMappedRoles(sheets) {
  return (sheets || []).some(s =>
    (s.rows || []).some(r => (r.cells || []).some(c => c.role && c.role !== 'content'))
  )
}

export function templatePaperStyle(design = {}, pageWidthPx) {
  const style = {
    background: design.paperBg || '#fff',
    width: pageWidthPx,
    maxWidth: 'none',
    '--upload-page-width': `${pageWidthPx}px`
  }
  const pads = [
    ['marginTopPx', 'paddingTop', '--upload-margin-top'],
    ['marginRightPx', 'paddingRight', '--upload-margin-right'],
    ['marginBottomPx', 'paddingBottom', '--upload-margin-bottom'],
    ['marginLeftPx', 'paddingLeft', '--upload-margin-left']
  ]
  for (const [key, pad, cssVar] of pads) {
    const n = Number(design[key])
    if (Number.isFinite(n) && n > 0) {
      const px = `${Math.round(n)}px`
      style[pad] = px
      style[cssVar] = px
    }
  }
  const h = Number(design.pageHeightPx)
  if (Number.isFinite(h) && h > 0) style.minHeight = `${Math.round(h)}px`
  return style
}

/** Only match real quote-number tokens — never bare QG/QT inside base64. */
export function scrubQuoteNumbers(html) {
  return String(html || '').replace(
    /\b(?:QG-\d{4}-\d{1,6}|QTN\s*[-–]\s*[\w./-]+|Quotation\s*No\.?\s*[:\-]\s*[\w./-]+)\b/gi,
    '<span data-slot="quote_number" data-temp="true"></span>'
  )
}

export function normalizeHeader(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/&nbsp;/g, ' ')
    .replace(/[^a-z0-9%/\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugifyHeader(label) {
  const base = String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9%]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9%]/g, '')
    .replace(/^./, c => c.toLowerCase())
  return base || ''
}

function canonicalHeaderField(label) {
  const l = normalizeHeader(label)
  if (!l) return null
  if (/^(sr\.?|s\.?)\s*no|^sr$|^(sl|serial)|^\#$|^sno$/.test(l)) return '__sr__'
  if (/partic|desc|item\b|product|material(?!\s*grade)/.test(l)) return 'description'
  if (/spe[ci]+f/.test(l) || /^spec\b/.test(l)) return 'specification'
  if (/grade|make|brand/.test(l)) return 'grade'
  if (/^qty$|quantity|^nos?$|^pcs?$/.test(l)) return 'quantity'
  if (/^unit$|^uom$|^u\.?o\.?m/.test(l)) return 'unit'
  if (/^rate$|unit\s*rate|price|₹\/|rs\.?\//.test(l)) return 'rate'
  if (/gst\s*amount|tax\s*amount/.test(l)) return 'taxAmount'
  if (/tax|gst\s*%|gst%|gst\s*rate/.test(l)) return 'tax'
  if (/^amount$|value|line\s*total/.test(l) && !/sub\s*total|grand/.test(l)) return 'amount'
  if (/hsn|sac/.test(l)) return 'hsn'
  if (/remark|note/.test(l)) return 'remarks'
  if (/size|dimen/.test(l)) return 'size'
  if (/weight|wt\b/.test(l)) return 'weight'
  if (/delivery|lead/.test(l)) return 'delivery'
  return null
}

function findColumnForHeader(label, columns = []) {
  const l = normalizeHeader(label)
  if (!l) return null
  return (columns || []).find(c => {
    const cl = normalizeHeader(c.label)
    const id = String(c.id || '').toLowerCase()
    const compact = l.replace(/\s/g, '')
    return cl === l || id === compact || id.replace(/_/g, ' ') === l
  }) || null
}

/** Fuzzy / typo-tolerant header → canonical field id (one header at a time). */
export function mapHeaderToField(label, columns = []) {
  const canonical = canonicalHeaderField(label)
  if (canonical) return canonical
  return findColumnForHeader(label, columns)?.id || null
}

/**
 * Map a whole header row so two columns never steal the same field
 * (Item + Description both used to dump into Description).
 */
function isPrimaryItemHeader(label) {
  return /^(item|product|particulars?|particualrs)$/i.test(normalizeHeader(label))
}

function hasPrimaryItemHeader(labels) {
  return (labels || []).some(isPrimaryItemHeader)
}

function canonicalFieldForHeader(label, labels, used) {
  let id = canonicalHeaderField(label)
  if (id !== 'description') return id
  // Item / Product / Particulars keep the product name; Description holds spec.
  if (hasPrimaryItemHeader(labels) && !isPrimaryItemHeader(label)) {
    return used.has('specification') ? null : 'specification'
  }
  if (used.has('description')) {
    return used.has('specification') ? null : 'specification'
  }
  return 'description'
}

export function mapHeadersToFields(headers, columns = []) {
  const labels = (headers || []).map(h => String(h || ''))
  const result = labels.map(() => null)
  const used = new Set()

  const assign = (i, id) => {
    if (!id || result[i]) return false
    if (id !== '__sr__' && used.has(id)) return false
    result[i] = id
    if (id !== '__sr__') used.add(id)
    return true
  }

  labels.forEach((label, i) => {
    if (!normalizeHeader(label)) return
    assign(i, canonicalFieldForHeader(label, labels, used))
  })

  labels.forEach((label, i) => {
    if (result[i]) return
    const col = findColumnForHeader(label, columns)
    if (col) assign(i, col.id)
  })

  labels.forEach((label, i) => {
    if (result[i]) return
    const slug = slugifyHeader(label)
    if (!slug) return
    let id = slug
    let n = 2
    while (used.has(id)) id = `${slug}${n++}`
    assign(i, id)
  })

  return result
}

export function headerQualityScore(headerLabels) {
  let score = 0
  for (const label of headerLabels) {
    const id = mapHeaderToField(label, [])
    if (id === 'description' || id === 'quantity' || id === 'rate' || id === 'amount') score += 3
    else if (id && id !== '__sr__') score += 2
    else if (id === '__sr__') score += 1
  }
  return score
}

export function extractTableHeaderLabels(tableHtml) {
  const rowMatches = String(tableHtml || '').match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []
  const headerRow = rowMatches[0] || ''
  return cellLabelsFromRow(headerRow)
}

function stripCellText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cellLabelsFromRow(rowHtml) {
  return [...String(rowHtml || '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => stripCellText(m[1]))
}

/** True item-table header: description/item plus qty/rate/amount. Not a letterhead grid. */
export function lineItemHeaderScore(labels) {
  const list = (labels || []).map(l => String(l || '').trim())
  if (list.some(l => l.length > 70)) return -1
  const ids = list.map(l => mapHeaderToField(l, []))
  const hasDesc = ids.includes('description')
  const hasQty = ids.includes('quantity')
  const hasRate = ids.includes('rate')
  const hasAmt = ids.includes('amount')
  const hasSr = ids.includes('__sr__')
  const mapped = ids.filter(Boolean).length
  if (mapped < 3) return -1
  if (!(hasDesc && (hasQty || hasRate || hasAmt || hasSr))) return -1
  return headerQualityScore(list) + (hasQty && hasRate ? 8 : 0) + (hasAmt ? 4 : 0)
}

function rowLooksLikeLayout(labels) {
  const joined = labels.join(' ').toLowerCase()
  if (/\bto\b/.test(joined) && /subject/.test(joined)) return true
  if (/quotation/.test(joined) && /date/.test(joined) && labels.some(l => l.length > 40)) return true
  return false
}

/** Prefer the real line-item table/row over the outer letterhead grid. */
export function pickLineItemsTable(html) {
  const tables = String(html || '').match(/<table\b[^>]*>(?:(?!<table\b)[\s\S])*?<\/table>/gi) || []
  let best = null
  let bestScore = -1
  for (const table of tables) {
    const rowMatches = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []
    for (let i = 0; i < rowMatches.length; i++) {
      const headers = cellLabelsFromRow(rowMatches[i])
      if (rowLooksLikeLayout(headers)) continue
      const quality = lineItemHeaderScore(headers)
      if (quality < 0) continue
      const score = quality * 100 - i
      if (score > bestScore) {
        bestScore = score
        best = { table, headers, headerRowIndex: i, rowMatches }
      }
    }
  }
  return best
}

/**
 * Typed columns (Step 7) in an uploaded layout.
 * Kept literal rather than importing quoteColumns.js, which imports this module.
 */
function typedColumnValue(item, fieldId, columns) {
  const col = (columns || []).find(c => c?.id === fieldId)
  if (!col) return null
  const type = String(col.type || '').toLowerCase()
  // A nested tax/discount column collapses to its calculated amount.
  if (type === 'tax' || type === 'discount') return String(item[`${col.id}__amount`] ?? '')
  // Image cells have no text representation in a spreadsheet cell.
  if (type === 'image') return ''
  return null
}

function itemDescriptionText(item) {
  return String(item?.description || item?.particulars || item?.particualrs || item?.item || '')
}

export function cellValueForField(item, fieldId, rowIndex, columns = [], fieldIds = []) {
  if (!item) return ''
  if (fieldId === '__sr__' || fieldId === 'sr') return String(rowIndex + 1)
  const typed = typedColumnValue(item, fieldId, columns)
  if (typed != null) return typed

  const hasSpecCol = (fieldIds || []).includes('specification')
  const fullDesc = itemDescriptionText(item)

  if (fieldId === 'description' || fieldId === 'item' || fieldId === 'product' || fieldId === 'particulars') {
    if (item[fieldId] != null && String(item[fieldId]).trim() !== '' && fieldId !== 'description' && fieldId !== 'item') {
      return String(item[fieldId])
    }
    if (hasSpecCol) return splitDescription(fullDesc).primary
    if (item.description != null && String(item.description).trim() !== '') return String(item.description)
    return fullDesc
  }
  if (fieldId === 'specification' || fieldId === 'descriptionSpecifications') {
    const explicit = String(item.specification || item.speification || item.spec || '')
    if (explicit.trim()) return explicit
    return splitDescription(fullDesc).secondary
  }

  if (item[fieldId] != null && String(item[fieldId]).trim() !== '') return String(item[fieldId])

  if (fieldId === 'grade') return String(item.grade || item.gradeMake || item.materialGrade || item.brand || '')
  if (fieldId === 'quantity' || fieldId === 'qty') return String(item.quantity || item.qty || '')
  if (fieldId === 'unit') return String(item.unit || item.uom || '')
  if (fieldId === 'rate') return String(item.rate || item.price || '')
  if (fieldId === 'amount') return String(item.amount || item.total || '')
  if (fieldId === 'tax' || fieldId === 'gstRate') return String(item.tax || item.gst || item.taxPercent || item['gst%'] || '')
  if (fieldId === 'taxAmount' || fieldId === 'gstAmount') return String(item.taxAmount || item.gstAmount || item['gst%__amount'] || '')
  if (fieldId === 'hsn') return String(item.hsn || item.hsnCode || '')

  const col = columns.find(c => c.id === fieldId)
  if (col) {
    const byLabel = Object.entries(item).find(([k, v]) =>
      normalizeHeader(k) === normalizeHeader(col.label) && v != null && String(v).trim() !== ''
    )
    if (byLabel) return String(byLabel[1])
  }
  return ''
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function stripMarkdownBold(text) {
  return String(text || '').replace(/\*\*/g, '').trim()
}

/** Same split as QuoteGen description column — bold primary + muted secondary. */
export function splitDescription(value) {
  const text = stripMarkdownBold(value)
  if (!text) return { primary: '', secondary: '' }

  const newline = text.indexOf('\n')
  if (newline >= 0) {
    return { primary: text.slice(0, newline).trim(), secondary: text.slice(newline + 1).trim() }
  }

  const dash = text.match(/^(.+?)\s+[–—-]\s+(.+)$/)
  if (dash) return { primary: dash[1].trim(), secondary: dash[2].trim() }

  const parts = text.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length >= 3) {
    return { primary: parts.slice(0, 2).join(', '), secondary: parts.slice(2).join(', ') }
  }
  if (parts.length === 2) {
    return { primary: parts[0], secondary: parts[1] }
  }

  return { primary: text, secondary: '' }
}

export function formatDescriptionHtml(value) {
  const { primary, secondary } = splitDescription(value)
  if (!primary && !secondary) return ''
  let html = ''
  if (primary) {
    html += `<p class="qg-desc-primary" style="margin:0;color:#17231f;line-height:1.35">${escapeHtml(primary)}</p>`
  }
  if (secondary) {
    html += `<p class="qg-desc-secondary" style="margin:4px 0 0;font-size:11px;font-weight:400;color:#64748b;line-height:1.45;white-space:pre-line">${escapeHtml(secondary).replace(/\n/g, '<br/>')}</p>`
  }
  return html
}

function contrastText(bgHex) {
  const hex = String(bgHex || '').replace('#', '')
  if (hex.length < 6) return '#ffffff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#17231f' : '#ffffff'
}

function mergeCellStyle(attrs, stylePatch) {
  const styleRe = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i
  const m = attrs.match(styleRe)
  const existing = (m ? (m[2] ?? m[3] ?? '') : '').replace(/;?\s*$/, '')
  const patch = Object.entries(stylePatch).map(([k, v]) => `${k}:${v}`).join(';')
  // Remove conflicting props from existing
  let cleaned = existing
  for (const key of Object.keys(stylePatch)) {
    cleaned = cleaned.replace(new RegExp(`(?:^|;)\\s*${key}\\s*:[^;]*`, 'ig'), '')
  }
  cleaned = cleaned.replace(/^;+|;+$/g, '').trim()
  const next = [cleaned, patch].filter(Boolean).join(';')
  if (m) return attrs.replace(styleRe, ` style="${next}"`)
  return `${attrs} style="${next}"`
}

/** Tint the detected line-item header row with the template accent. */
export function applyAccentToLineItemHeaders(html, accent) {
  if (!accent) return html
  const picked = pickLineItemsTable(html)
  if (!picked) return html

  const color = contrastText(accent)
  const headerRow = picked.rowMatches[0]
  const tinted = headerRow.replace(/<t([dh])(\b[^>]*)>/gi, (_, tag, attrs) => {
    const next = mergeCellStyle(attrs || '', {
      'background-color': accent,
      color
    })
    return `<t${tag}${next}>`
  })
  return html.replace(headerRow, tinted)
}

function isPermanentBlockText(text) {
  const t = String(text || '')
  if (/^(to|bill\s*to|buyer|customer|consignee|subject)\b/i.test(t.trim())) return false
  return /bank\s*name|ifsc|swift|account\s*(?:name|no|number)|authorized\s*signatory|standard\s*terms|terms\s*(?:and|&)\s*conditions|\bcin\b|letterhead/i.test(t)
}

/** Totals / bank / terms rows — not a product line that happens to mention GST. */
export function isLineItemStopText(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!t) return false
  if (/amount\s*in\s*words|bank\s*details|authorized\s*sign/.test(t)) return true
  if (/terms\s*(?:and|&)\s*conditions|\bterms\s*and\b/.test(t)) return true
  if (/sub\s*total|grand\s*total|taxable\s*(?:value|amount)|net\s*(?:amount|total|payable)|total\s*amount/.test(t)) return true
  if (/^(sub\s*total|grand\s*total|total|discount|cgst|sgst|igst)(\b|:)/.test(t) && t.length < 80) return true
  // Totals like "GST 18%" / "GST: 1,234" — not a product that happens to mention GST.
  if (/^gst(\s*%|\s*@|\s*:)/.test(t) && t.length < 80) return true
  if (/^gst\s+\d+([.,]\d+)*\s*%/.test(t) && t.length < 80) return true
  if (/^gst\s+[\d,]+\.?\d*\s*$/.test(t)) return true
  if (/^sub(\s+|$)/i.test(t) && /[\d,]/.test(t) && t.length < 80) return true
  return false
}

function rowLooksLikeTotals(labels) {
  const list = (labels || []).map(l => String(l || '').trim())
  const joined = list.join(' ')
  if (isLineItemStopText(joined)) return true
  if (isLineItemStopText(list[0] || '')) return true
  const first = (list[0] || '').toLowerCase()
  if (/^(sub|total|gst|discount|cgst|sgst|igst)\b/.test(first) && list.some(l => /[\d,]+\.\d{2}/.test(l))) return true
  return false
}

function replaceFirst(haystack, needle, replacement) {
  const src = String(haystack || '')
  const from = String(needle || '')
  if (!from) return src
  const idx = src.indexOf(from)
  if (idx < 0) return src
  return src.slice(0, idx) + replacement + src.slice(idx + from.length)
}

export function layoutFieldRole(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (/^total\b|^sub\s*total|^grand\s*total/i.test(t)) return null
  if (/(?:seller|supplier|our)\s*gst|company\s*gstin|company\s*gst\b/i.test(t)) return null
  if (/phone|email|\bcin\b/i.test(t) && /gstin/i.test(t) && t.length > 40) return null
  if (/^(?:customer\s*)?(gstin|gst\s*(?:no|number|#))\b/i.test(t) && t.length < 80) return 'customer_gst'
  if (/delivery\s*location|ship\s*to|^location\b/i.test(t)) return 'customer_location'
  if (/^(to|bill\s*to|buyer|consignee|m\/s\.?)\b/i.test(t)) return 'customer_block'
  if (/^customer\s*company\b/i.test(t) || /^company\b/i.test(t)) return 'customer_company'
  if (/^customer(\s*name)?$|^kind\s*attn/i.test(t) || /^customer\s*[:\-–]/i.test(t)) return 'customer_name'
  if (/^subject\b|^sub$|^sub\s*[:\-–]|^ref(?:erence)?\b/i.test(t)) return 'subject'
  if (/quotation\s*no|quote\s*no|invoice\s*no/i.test(t)) return 'quote_number'
  if (/^no\.?\s*[:\-–]/i.test(t) || /^no\.?$/i.test(t)) return 'quote_number'
  if (/^date\b|^dated\b|quote\s*date|invoice\s*date/i.test(t)) return 'date'
  if (/valid\s*(?:till|until|upto)|^validity\b/i.test(t)) return 'valid_until'
  if (/^notes\b|^clarifications\b|^remarks\b/i.test(t)) return 'notes'
  return null
}

function labelOnlyCell(text, role) {
  const t = String(text || '').trim()
  if (t.length > 48) return false
  if (role === 'customer_block') return /^(to|bill\s*to|buyer|customer|consignee|m\/s\.?)\s*[:\-–]?$/i.test(t)
  if (role === 'customer_name') return /^(customer(?:\s*name)?|kind\s*attn)\s*[:\-–]?$/i.test(t)
  if (role === 'customer_company') return /^(company|customer\s*company)\s*[:\-–]?$/i.test(t)
  if (role === 'customer_gst') return /^(gstin|customer\s*gstin|customer\s*gst|gst(?:\s*(?:no|number|#))?)\s*[:\-–]?$/i.test(t)
  if (role === 'customer_location') return /^(delivery\s*location|ship\s*to|location)\s*[:\-–]?$/i.test(t)
  if (role === 'subject') return /^(subject|sub|ref(?:erence)?)\s*[:\-–]?$/i.test(t)
  if (role === 'quote_number') return /^(quotation\s*no\.?|quote\s*no\.?|invoice\s*no\.?|no\.?)\s*[:\-–]?$/i.test(t)
  if (role === 'date') return /^(date|dated|quote\s*date|invoice\s*date)\s*[:\-–]?$/i.test(t)
  if (role === 'valid_until') return /^(valid\s*(?:till|until|upto)|validity)\s*[:\-–]?$/i.test(t)
  if (role === 'notes') return /^(notes|clarifications|remarks)\s*[:\-–]?$/i.test(t)
  return false
}

const ROLE_LABEL_RE = {
  customer_block: '\\b(?:TO|BILL\\s*TO|BUYER|CUSTOMER|CONSIGNEE|M\\/S\\.?)\\b',
  customer_name: '\\b(?:CUSTOMER(?:\\s*NAME)?|KIND\\s*ATTN)\\b',
  customer_company: '\\b(?:COMPANY|CUSTOMER\\s*COMPANY)\\b',
  customer_gst: '\\b(?:GSTIN|CUSTOMER\\s*GSTIN|CUSTOMER\\s*GST|GST(?:\\s*(?:NO|NUMBER|#))?)\\b',
  customer_location: '(?:DELIVERY\\s*LOCATION|SHIP\\s*TO|LOCATION)',
  subject: '\\b(?:SUBJECT|SUB(?:JECT)?\\s*[:\\-–]|\\bREF(?:ERENCE)?)\\b',
  quote_number: '(?:QUOTATION\\s*NO\\.?|QUOTE\\s*NO\\.?|INVOICE\\s*NO\\.?|\\bNO\\.?)',
  date: '\\b(?:DATE|DATED|QUOTE\\s*DATE|INVOICE\\s*DATE)\\b',
  valid_until: '(?:VALID\\s*(?:TILL|UNTIL|UPTO)|VALIDITY)',
  notes: '\\b(?:NOTES|CLARIFICATIONS|REMARKS)\\b'
}

function setCellValueKeepingLabel(inner, role, valueHtml) {
  const label = ROLE_LABEL_RE[role]
  if (!label) return valueHtml || inner
  if (role === 'customer_block' || role === 'notes' || role === 'subject') {
    const re = new RegExp(`([\\s\\S]*?${label}(?:\\s*[:\\-–])?(?:\\s*</[^>]+>)*)([\\s\\S]*)`, 'i')
    const m = String(inner || '').match(re)
    if (!m) return valueHtml ? `${inner}${valueHtml}` : inner
    return `${m[1]}${valueHtml || ''}`
  }
  const re = new RegExp(`(${label}(?:\\s*[:\\-–])?\\s*)([^<]{0,80})`, 'i')
  if (re.test(inner)) return String(inner).replace(re, `$1${valueHtml || ''}`)
  return valueHtml ? `${inner}${valueHtml}` : inner
}

function quoteFieldValueHtml(role, quote) {
  const c = quote?.customer || {}
  const fields = quote?.fields || {}
  if (role === 'customer_block') {
    const lines = [c.company, c.name, c.location, c.gst].filter(Boolean)
    return lines.length ? lines.map(l => escapeHtml(l)).join('<br/>') : ''
  }
  if (role === 'customer_name') return escapeHtml(c.name || '')
  if (role === 'customer_company') return escapeHtml(c.company || '')
  if (role === 'customer_gst') return escapeHtml(c.gst || '')
  if (role === 'customer_location') return escapeHtml(c.location || '')
  if (role === 'subject') return escapeHtml(quote?.title || '')
  if (role === 'quote_number') return escapeHtml(quote?.number || '')
  if (role === 'date') return escapeHtml(quote?.date || '')
  if (role === 'valid_until') return escapeHtml(fields.validUntil || quote?.validUntil || '')
  if (role === 'notes') return escapeHtml((quote?.notes || []).filter(Boolean).join('\n')).replace(/\n/g, '<br/>')
  return ''
}

function cellAlreadySlotted(inner) {
  return /data-slot="(?!temp_value|line_cell|line_items)/i.test(String(inner || ''))
}

function slotHtml(role, innerHtml = '', editing = false) {
  const extra = editing ? ' data-qg-edit="1"' : ' data-temp="true"'
  return `<span data-slot="${role}"${extra}>${innerHtml || ''}</span>`
}

function mapWordLayoutCells(html, onValue) {
  return String(html || '').replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    if (/<table\b/i.test(row)) return row
    const cellMatches = [...row.matchAll(/<t([dh])(\b[^>]*)>([\s\S]*?)<\/t\1>/gi)]
    if (!cellMatches.length) return row
    const labels = cellMatches.map(m => stripCellText(m[3]))
    if (lineItemHeaderScore(labels) >= 0) return row
    if (rowLooksLikeTotals(labels)) return row
    const inners = cellMatches.map(m => m[3])
    for (let i = 0; i < cellMatches.length; i++) {
      const text = labels[i]
      if (isPermanentBlockText(text)) continue
      if (/data-slot="(?:line_cell|line_items)/i.test(inners[i])) continue
      const role = layoutFieldRole(text)
      if (!role) continue
      if (labelOnlyCell(text, role) && i + 1 < inners.length) {
        inners[i + 1] = onValue(inners[i + 1], role, 'value-cell')
      } else {
        inners[i] = onValue(inners[i], role, 'same-cell')
      }
    }
    let k = 0
    return row.replace(/<t([dh])(\b[^>]*)>([\s\S]*?)<\/t\1>/gi, (_, tag, attrs) => (
      `<t${tag}${attrs}>${inners[k++]}</t${tag}>`
    ))
  })
}

function looksLikeDateValue(text) {
  const t = String(text || '').replace(/<[^>]+>/g, ' ').trim()
  if (!t) return true
  if (/days|weeks|months|year|from\s+(?:the\s+)?date|of\s+delivery/i.test(t)) return false
  return t.length <= 40
}

function applyWordPrefixedSlots(html, quote, editing) {
  const valueFor = (role) => (quote ? quoteFieldValueHtml(role, quote) : '')
  const wrap = (role) => slotHtml(role, valueFor(role), editing)
  let out = String(html || '')
  const rules = [
    { re: /\b((?:Quotation|Quote|Invoice)\s*No\.?\s*[:\-–]?\s*)(?!<span[^>]*data-slot=)([A-Z]{2,}[\s./-]*\d[\w./-]*)/gi, role: 'quote_number' },
    { re: /\b(No\.?\s*[:\-–]\s*)(?!<span[^>]*data-slot=)([A-Z]{2,}[\s./-]*\d[\w./-]*)/gi, role: 'quote_number' },
    { re: /\b(Date\s*[:\-–]\s*)(?!<span[^>]*data-slot=)([^<]{0,40})/gi, role: 'date' },
    { re: /\b(Valid(?:\s*(?:till|until|upto))?\s*[:\-–]\s*)(?!<span[^>]*data-slot=)([^<]{0,40})/gi, role: 'valid_until' }
  ]
  for (const rule of rules) {
    out = out.replace(rule.re, (full, prefix, value) => {
      if ((rule.role === 'date' || rule.role === 'valid_until') && !looksLikeDateValue(value)) return full
      return `${prefix}${wrap(rule.role)}`
    })
  }
  return out
}

/** Strip sample quote *text* only. Labels, columns, and cells stay. */
export function scrubTransientWordShell(html) {
  const images = protectImages(html)
  const perm = protectPermanent(images.html)
  let out = String(perm.html || '').replace(/<span[^>]*data-slot="temp_value"[^>]*>[\s\S]*?<\/span>/gi, '')
  out = mapWordLayoutCells(out, (inner, role, mode) => {
    if (cellAlreadySlotted(inner)) return inner
    if (mode === 'value-cell') return slotHtml(role)
    return setCellValueKeepingLabel(inner, role, slotHtml(role))
  })
  out = applyWordPrefixedSlots(out, null, false)

  const picked = pickLineItemsTable(out)
  if (picked) {
    const { table, headerRowIndex, rowMatches } = picked
    const nextRows = rowMatches.map((row, i) => {
      if (i <= headerRowIndex) return row
      if (isLineItemStopText(stripCellText(row))) {
        return row.replace(
          />(\s*(?:₹|rs\.?|inr)?\s*[\d,]+\.?\d*\s*)</gi,
          '><span data-slot="total" data-temp="true"></span><'
        )
      }
      if (/data-slot="(?:line_cell|line_items)/i.test(row) && !stripCellText(row)) return row
      return row.replace(/<t([dh])(\b[^>]*)>([\s\S]*?)<\/t\1>/gi, (_, tag, attrs) => (
        `<t${tag}${attrs} data-slot="line_cell"><br/></t${tag}>`
      ))
    })
    const open = table.match(/^<table\b[^>]*>/i)?.[0] || '<table>'
    out = replaceFirst(out, table, `${open}${nextRows.join('')}</table>`)
  }

  return restoreImages(restorePermanent(out, perm.held), images.held)
}

function looksLikeHeaderRow(cells) {
  const labels = cells.map(c => String(c.value || ''))
  return lineItemHeaderScore(labels) >= 0
}

/** "No: QTN - 007" / "Date: Jul 17, 2026" / "Valid: Jul 31, 2026" / "GSTIN: 27…" */
const EXCEL_PREFIX_RE = /^(No|Date|Dated|Valid(?:\s*(?:till|until|upto))?|Kind\s*Attn|Quotation\s*No\.?|Quote\s*No\.?|Customer(?:\s*Name)?|Customer\s*GSTIN|GSTIN|GST(?:\s*No\.?)?|Company|Delivery\s*Location)\s*:\s*/i

export function splitExcelPrefixedValue(text) {
  const raw = String(text || '')
  const m = raw.match(EXCEL_PREFIX_RE)
  if (!m) return null
  const label = m[1].replace(/\s+/g, ' ')
  const value = raw.slice(m[0].length).trim()
  let role = 'content'
  if (/^no$|^quotation\s*no|^quote\s*no/i.test(label)) role = 'quote_number'
  else if (/^date|^dated/i.test(label)) role = 'date'
  else if (/^valid/i.test(label)) role = 'valid_until'
  else if (/kind\s*attn|^customer(\s*name)?$/i.test(label)) role = 'customer_name'
  else if (/gstin|customer\s*gst/i.test(label)) role = 'customer_gst'
  else if (/^company$/i.test(label)) role = 'customer_company'
  else if (/delivery\s*location/i.test(label)) role = 'customer_location'
  return { prefix: m[0], value, role, label }
}

function classifyExcelCell(text) {
  const t = String(text || '').trim()
  if (!t) return 'empty'
  const prefixed = splitExcelPrefixedValue(t)
  if (prefixed && prefixed.role !== 'content') return prefixed.role
  if (/\bQTN\s*[-–]\s*[\w./]+/i.test(t) || /^QG-?\d|^QT[N]?[-/]?\d/i.test(t) || /quotation\s*no/i.test(t)) return 'quote_number'
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}$|^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(t)) return 'date'
  return 'content'
}

function excelLabelRole(label) {
  const l = normalizeHeader(label)
  if (!l) return null
  if (/(?:seller|supplier|our)\s*gst|company gst/.test(l)) return null
  if (/^(?:customer\s*)?(gstin|gst no|gst number)$/.test(l)) return 'customer_gst'
  if (/delivery location|ship to|^location$/.test(l)) return 'customer_location'
  if (/^(to|bill to|buyer|consignee|m s|m\/s)$/.test(l) || /bill to|consignee/.test(l)) return 'customer_block'
  if (/^customer company|^company$/.test(l)) return 'customer_company'
  if (/^customer name|^kind attn|^customer$/.test(l)) return 'customer_name'
  if (/^subject$|^sub$|^ref$|reference|enquiry/.test(l)) return 'subject'
  if (/quotation no|quote no|^qtn/.test(l) || /^no$/.test(l)) return 'quote_number'
  if (/^date$|quote date|dated|invoice date/.test(l)) return 'date'
  if (/valid till|valid until|valid upto|^valid$|^validity$/.test(l)) return 'valid_until'
  if (/^notes$|clarifications|^remarks$/.test(l)) return 'notes'
  return null
}

function findCellByCol(row, col) {
  return (row?.cells || []).find(c => Number(c.col) === Number(col))
}

function nextCellInRow(row, col, colSpan = 1) {
  const start = Number(col) + Math.max(1, Number(colSpan) || 1)
  return (row?.cells || []).filter(c => Number(c.col) >= start).sort((a, b) => a.col - b.col)[0] || null
}

function findItemHeaderRowIndex(sheet) {
  let headerRowIndex = -1
  let best = -1
  for (let i = 0; i < Math.min(sheet.rows.length, 80); i++) {
    const score = lineItemHeaderScore(sheet.rows[i].cells.map(c => String(c.value || '')))
    if (score > best) {
      best = score
      headerRowIndex = i
    }
  }
  return best < 0 ? -1 : headerRowIndex
}

/** Strip sample quote data from uploaded Excel sheets; keep formulas + permanent blocks. */
export function scrubTransientExcelShell(sheets) {
  const next = structuredClone(sheets || [])

  for (const sheet of next) {
    for (const row of sheet.rows) {
      for (const cell of row.cells) {
        if (cell.formula) continue
        if (cell.role && cell.role !== 'content') cell.role = 'content'
        delete cell.labelPrefix
      }
    }
    const headerRowIndex = findItemHeaderRowIndex(sheet)
    const limit = headerRowIndex >= 0 ? headerRowIndex : sheet.rows.length

    if (headerRowIndex >= 0) {
      for (let i = headerRowIndex + 1; i < sheet.rows.length; i++) {
        const row = sheet.rows[i]
        const joined = row.cells.map(c => c.value).join(' ').toLowerCase()
        const hasFormula = row.cells.some(c => c.formula)
        const isTotal = isLineItemStopText(joined)
        if (isTotal || hasFormula) {
          for (const cell of row.cells) {
            if (cell.formula || /total|subtotal|grand/i.test(cell.value || '')) {
              cell.role = cell.formula ? 'formula' : 'total'
            }
          }
          continue
        }
        for (const cell of row.cells) {
          if (cell.formula) {
            cell.role = 'formula'
            continue
          }
          if (String(cell.value || '').trim()) {
            cell.value = ''
            cell.role = 'line_item'
          }
        }
      }
    }

    // Same-cell labels: keep "No:" / "Date:" / "Valid:" and drop the sample value.
    for (let ri = 0; ri < limit; ri++) {
      const row = sheet.rows[ri]
      for (const cell of row.cells) {
        if (cell.formula) {
          cell.role = cell.role || 'formula'
          continue
        }
        if (isPermanentBlockText(String(cell.value || ''))) continue
        const prefixed = splitExcelPrefixedValue(cell.value)
        if (prefixed && prefixed.role !== 'content') {
          cell.role = prefixed.role
          cell.labelPrefix = prefixed.prefix
          cell.value = prefixed.prefix
          continue
        }
        const kind = classifyExcelCell(cell.value)
        if (kind === 'quote_number' || kind === 'date' || kind === 'valid_until') {
          cell.role = kind
          cell.value = ''
        }
      }
    }

    // TO / SUBJECT sit above their values (same column, next rows) — not in the next column.
    const labelHits = []
    for (let ri = 0; ri < limit; ri++) {
      for (const cell of sheet.rows[ri].cells) {
        const role = excelLabelRole(cell.value)
        if (!role) continue
        const onlyLabel = labelOnlyExcel(cell.value, role)
        labelHits.push({ ri, col: cell.col, role, onlyLabel })
      }
    }

    for (const hit of labelHits) {
      if (!hit.onlyLabel) continue
      if (hit.role !== 'customer_block' && hit.role !== 'subject') continue
      for (let ri = hit.ri + 1; ri < limit; ri++) {
        const row = sheet.rows[ri]
        if (lineItemHeaderScore(row.cells.map(c => String(c.value || ''))) >= 0) break
        const cell = findCellByCol(row, hit.col)
        if (!cell || cell.formula) continue
        const text = String(cell.value || '').trim()
        if (!text) continue
        if (excelLabelRole(text) || isPermanentBlockText(text)) break
        if (cell.labelPrefix || cell.role === 'quote_number' || cell.role === 'date' || cell.role === 'valid_until') continue
        cell.role = hit.role === 'customer_block' ? 'customer_block' : hit.role
        const prefixed = splitExcelPrefixedValue(text)
        if (prefixed) {
          cell.labelPrefix = prefixed.prefix
          cell.value = prefixed.prefix
        } else {
          cell.value = ''
        }
      }
    }

    for (const hit of labelHits) {
      if (hit.role === 'customer_block' || hit.role === 'subject') continue
      const row = sheet.rows[hit.ri]
      const labelCell = findCellByCol(row, hit.col)
      if (!labelCell) continue
      if (hit.onlyLabel) {
        const valueCell = nextCellInRow(row, hit.col, labelCell.colSpan)
        if (!valueCell || valueCell.formula) continue
        const valueText = String(valueCell.value || '').trim()
        const valueRole = excelLabelRole(valueText)
        if (valueRole && labelOnlyExcel(valueText, valueRole)) continue
        if (isPermanentBlockText(valueText)) continue
        valueCell.role = hit.role
        valueCell.value = ''
      }
    }

    // After TO, also clear other columns in those rows (subject often has no "SUBJECT" label).
    const toHit = labelHits.find(h => h.role === 'customer_block')
    if (toHit) {
      for (let ri = toHit.ri + 1; ri < limit; ri++) {
        const row = sheet.rows[ri]
        if (lineItemHeaderScore(row.cells.map(c => String(c.value || ''))) >= 0) break
        for (const cell of row.cells) {
          if (cell.formula || cell.role === 'line_item') continue
          const text = String(cell.value || '').trim()
          if (!text) continue
          if (excelLabelRole(text) || isPermanentBlockText(text)) continue
          if (cell.role && cell.role !== 'content') continue
          if (cell.labelPrefix) continue
          const prefixed = splitExcelPrefixedValue(text)
          if (prefixed && prefixed.role !== 'content') {
            cell.role = prefixed.role
            cell.labelPrefix = prefixed.prefix
            cell.value = prefixed.prefix
          } else {
            cell.role = Number(cell.col) === Number(toHit.col) ? 'customer_block' : 'subject'
            cell.value = ''
          }
        }
      }
    }
  }

  return next
}

function labelOnlyExcel(text, role) {
  const t = String(text || '').trim()
  if (t.length > 40) return false
  if (role === 'customer_block') return /^(to|bill\s*to|buyer|customer|consignee|m\/s\.?)\s*:?$/i.test(t)
  if (role === 'subject') return /^(subject|sub|ref(?:erence)?)\s*:?$/i.test(t)
  if (role === 'customer_name') return /^(customer(?:\s*name)?|kind\s*attn)\s*:?$/i.test(t)
  if (role === 'customer_company') return /^(company|customer\s*company)\s*:?$/i.test(t)
  if (role === 'customer_gst') return /^(gstin|customer\s*gstin|customer\s*gst|gst(?:\s*(?:no|number|#))?)\s*:?$/i.test(t)
  if (role === 'customer_location') return /^(delivery\s*location|ship\s*to|location)\s*:?$/i.test(t)
  if (role === 'quote_number') return /^(no\.?|quotation\s*no\.?|quote\s*no\.?)\s*:?$/i.test(t)
  if (role === 'date') return /^(date|dated|quote\s*date|invoice\s*date)\s*:?$/i.test(t)
  if (role === 'valid_until') return /^(valid|validity|valid\s*(?:till|until|upto))\s*:?$/i.test(t)
  return /^(notes|remarks)\s*:?$/i.test(t)
}

/** Natural page width for uploaded layouts — never force A4. */
export function inferTemplatePageWidth(type, content, design = {}) {
  if (Number(design.pageWidthPx) > 0) return Math.round(Number(design.pageWidthPx))

  if (type === 'excel') {
    const sheet = Array.isArray(content) ? content[0] : null
    if (sheet?.columns?.length) {
      const tableW = sheet.columns.reduce((sum, c) => sum + (Number(c.widthPx) || 80), 0)
      return Math.max(640, Math.round(tableW + 48))
    }
  }

  if (type === 'word') {
    const html = String(content || '')
    let max = 816
    for (const m of html.matchAll(/<table\b[^>]*style="[^"]*width:\s*(\d+(?:\.\d+)?)(px|pt)/gi)) {
      const n = Number(m[1])
      max = Math.max(max, m[2] === 'pt' ? Math.round(n * 96 / 72) : n)
    }
    for (const m of html.matchAll(/\bwidth:\s*(\d+(?:\.\d+)?)(px|pt)/gi)) {
      const n = Number(m[1])
      if (n >= 480) max = Math.max(max, m[2] === 'pt' ? Math.round(n * 96 / 72) : n)
    }
    return Math.min(Math.max(max, 816), 1600)
  }

  return 816
}

export function fillTransientFields(html, quote) {
  let out = mapWordLayoutCells(html, (inner, role, mode) => {
    const valueHtml = quoteFieldValueHtml(role, quote)
    const span = slotHtml(role, valueHtml, true)
    if (mode === 'value-cell') {
      if (/data-slot="(?:total|line_cell|line_items)/i.test(inner)) return inner
      return span
    }
    return setCellValueKeepingLabel(inner, role, valueHtml ? span : '')
  })

  out = String(out || '').replace(/<span[^>]*data-slot="temp_value"[^>]*>[\s\S]*?<\/span>/gi, '')
  out = out.replace(
    /<span[^>]*data-slot="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (full, role) => {
      if (role === 'total' || role === 'line_cell' || role === 'line_items_row' || role === 'temp_value') return full
      const valueHtml = quoteFieldValueHtml(role, quote)
      return slotHtml(role, valueHtml, true)
    }
  )
  out = applyWordPrefixedSlots(out, quote, true)
  return out
}

/**
 * Uploaded templates keep their own "Total / Subtotal / GST" rows byte-for-byte
 * so boilerplate (terms, bank details) survives untouched — but that leaves the
 * NUMBER in those rows frozen at whatever the sample quotation had the day the
 * template was uploaded. This resolves which computed total a row's label is
 * showing, and replaceLastAmount swaps in the real figure.
 *
 * Priority matters: "Grand Total" must not fall through to the generic /total/
 * match meant for a plain "Total" row, and a specific "CGST" line must not be
 * swallowed by a bare /tax/ test before its own check runs.
 */
export function totalFieldForLabel(label) {
  const l = String(label || '').toLowerCase()
  if (/grand\s*total|net\s*(amount|total|payable)|total\s*amount/.test(l)) return 'grandTotal'
  if (/taxable\s*(value|amount)/.test(l)) return 'taxableTotal'
  if (/sub\s*total/.test(l)) return 'subtotal'
  if (/^sub(\s|$)/.test(l) && /[\d,]/.test(l)) return 'subtotal'
  if (/discount/.test(l)) return 'discountTotal'
  if (/cgst|sgst|igst|gst|tax/.test(l)) return 'taxTotal'
  if (/\btotal\b/.test(l)) return 'grandTotal'
  return null
}

const NUMBER_TOKEN_RE = /[0-9][0-9,]*(?:\.[0-9]{1,2})?/g

export function formatIndianAmount(amount) {
  return Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Last currency-looking number token in `text`, swapped for the real amount. */
export function replaceLastAmount(text, amount) {
  const formatted = formatIndianAmount(amount)
  const matches = [...String(text || '').matchAll(NUMBER_TOKEN_RE)]
  if (!matches.length) return text
  const last = matches[matches.length - 1]
  return text.slice(0, last.index) + formatted + text.slice(last.index + last[0].length)
}

function fillTotalSlot(row, amount) {
  const formatted = formatIndianAmount(amount)
  if (/data-slot="total"/i.test(row)) {
    return String(row).replace(
      /<span[^>]*data-slot="total"[^>]*>[\s\S]*?<\/span>/gi,
      `<span data-slot="total">${formatted}</span>`
    )
  }
  return replaceLastAmount(row, amount)
}

export function fillWordLineItems(html, quote, columns, totals) {
  const picked = pickLineItemsTable(html)
  if (!picked) return html

  const { table, headers, headerRowIndex = 0, rowMatches } = picked
  const fieldIds = mapHeadersToFields(headers, columns)
  const items = quote.items || []

  let bodyEnd = rowMatches.length
  for (let i = headerRowIndex + 1; i < rowMatches.length; i++) {
    if (isLineItemStopText(stripCellText(rowMatches[i]))) {
      bodyEnd = i
      break
    }
  }

  const templateRow = rowMatches[headerRowIndex + 1] || rowMatches[headerRowIndex]
  const bodyRows = items.map((item, idx) => fillRowFromTemplate(templateRow, fieldIds, item, idx, columns)).join('')

  const trailing = rowMatches.slice(bodyEnd).map((row) => {
    const rawText = stripCellText(row)
    if (/bank|ifsc|account|swift/.test(rawText.toLowerCase()) && !/grand\s*total|sub\s*total/.test(rawText.toLowerCase())) return row
    const field = totalFieldForLabel(rawText)
    const amount = field ? totals?.[field] : null
    return amount != null ? fillTotalSlot(row, amount) : row
  }).join('')

  const open = table.match(/^<table\b[^>]*>/i)?.[0] || '<table>'
  const head = rowMatches.slice(0, headerRowIndex + 1).join('')
  const rebuilt = `${open}${head}${bodyRows}${trailing}</table>`
  return replaceFirst(html, table, rebuilt)
}

function fillRowFromTemplate(rowHtml, fieldIds, item, idx, columns) {
  let i = 0
  const cleaned = String(rowHtml || '').replace(/\sdata-qg-(?:item|field)="[^"]*"/gi, '')
  return cleaned.replace(/<t([dh])(\b[^>]*)>([\s\S]*?)<\/t\1>/gi, (_, tag, attrs) => {
    const id = fieldIds[i++]
    const marked = `${attrs} data-qg-item="${idx}"${id ? ` data-qg-field="${escapeHtml(id)}"` : ''}`
    if (!id) return `<t${tag}${marked}></t${tag}>`
    const col = (columns || []).find(c => c?.id === id)
    const type = String(col?.type || '').toLowerCase()
    if (type === 'image') {
      const src = String(item?.[id] || '')
      if (!src) return `<t${tag}${marked}></t${tag}>`
      const w = Number(col.imageWidth) > 0 ? Math.round(Number(col.imageWidth)) : 96
      return `<t${tag}${marked}><img src="${escapeHtml(src)}" width="${w}" style="max-width:100%;height:auto"/></t${tag}>`
    }
    const val = cellValueForField(item, id, idx, columns, fieldIds)
    if (id === 'description' || id === 'specification' || id === 'item') {
      const inner = formatDescriptionHtml(val) || ''
      return `<t${tag}${marked}>${inner}</t${tag}>`
    }
    return `<t${tag}${marked}>${escapeHtml(val).replace(/\n/g, '<br/>')}</t${tag}>`
  })
}

/**
 * Uploaded templates often keep Subtotal/Tax/Grand Total in a SEPARATE small
 * table right after the line-items table, not as trailing rows inside it —
 * fillWordLineItems only rebuilds the one table it identifies as line items,
 * so a standalone totals table is never touched by that pass. This sweeps
 * every <tr> in the whole document (any table) and refreshes ones whose
 * label matches a known total field, so stale sample amounts don't survive.
 */
export function patchTrailingTotals(html, totals) {
  if (!totals) return html
  return String(html || '').replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
    const text = stripCellText(row)
    const lower = text.toLowerCase()
    if (/bank|ifsc|account|swift/.test(lower) && !/grand\s*total|sub\s*total/.test(lower)) return row
    if (!isLineItemStopText(text)) return row
    const field = totalFieldForLabel(text)
    if (!field || totals[field] == null) return row
    return fillTotalSlot(row, totals[field])
  })
}

export function fillWordTemplate(html, quote, columns, design = {}, totals) {
  const images = protectImages(html)
  const perm = protectPermanent(images.html)
  const alreadyLineShell = /data-slot="(?:line_cell|line_items)/i.test(perm.html)
  let out = alreadyLineShell ? perm.html : scrubTransientWordShell(perm.html)
  out = fillTransientFields(out, quote)
  out = fillWordLineItems(out, quote, columns, totals)
  out = patchTrailingTotals(out, totals)
  return restoreImages(restorePermanent(out, perm.held), images.held)
}

function isExcelItemStopRow(row) {
  if (!row) return true
  const hasItemRole = (row.cells || []).some(c => c.role === 'line_item')
  const hasTotalRole = (row.cells || []).some(c => c.role === 'total' || c.role === 'formula')
  if (hasTotalRole && !hasItemRole) return true
  const joined = (row.cells || []).map(c => c.value).join(' ')
  if (isLineItemStopText(joined) && !hasItemRole) return true
  if ((row.cells || []).some(c => c.formula) && !hasItemRole) return true
  return false
}

function blankItemRowFromHeader(headerRow) {
  return {
    index: 0,
    heightPx: headerRow?.heightPx || 22,
    cells: (headerRow?.cells || []).map(c => ({
      col: c.col,
      value: '',
      formula: null,
      style: { ...(c.style || {}), fontWeight: null, backgroundColor: null },
      rowSpan: 1,
      colSpan: c.colSpan || 1,
      role: 'line_item'
    }))
  }
}

function cloneExcelItemRow(row) {
  return {
    index: 0,
    heightPx: row?.heightPx || 22,
    cells: (row?.cells || []).map(c => ({
      ...c,
      value: c.formula ? c.value : '',
      role: c.formula ? (c.role || 'formula') : 'line_item'
    }))
  }
}

/** Grow or shrink the Excel item block so there is one row per enquiry line. */
export function expandExcelLineItemRows(sheet, itemCount, columns = []) {
  const headerRowIndex = findItemHeaderRowIndex(sheet)
  if (headerRowIndex < 0) {
    return { headerRowIndex: -1, start: -1, colMap: [] }
  }
  const headers = sheet.rows[headerRowIndex].cells.map(c => String(c.value || ''))
  const colMap = mapHeadersToFields(headers, columns)
  let start = headerRowIndex + 1
  let end = start
  for (let i = start; i < sheet.rows.length; i++) {
    if (isExcelItemStopRow(sheet.rows[i])) break
    end = i + 1
  }
  const needed = Math.max(0, Number(itemCount) || 0)
  const existing = sheet.rows[start]
  const template = (existing && !isExcelItemStopRow(existing))
    ? existing
    : blankItemRowFromHeader(sheet.rows[headerRowIndex])
  let count = Math.max(0, end - start)
  if (count === 0 && needed > 0) {
    sheet.rows.splice(start, 0, cloneExcelItemRow(template))
    count = 1
    end = start + 1
  }
  while (count < needed) {
    const src = sheet.rows[start + count - 1] || template
    sheet.rows.splice(start + count, 0, cloneExcelItemRow(src))
    count++
  }
  while (count > needed) {
    sheet.rows.splice(start + needed, 1)
    count--
  }
  sheet.rows.forEach((row, i) => { row.index = i + 1 })
  return { headerRowIndex, start, colMap }
}

export function fillExcelItemRow(row, item, itemIdx, colMap, columns) {
  if (!row) return
  for (let ci = 0; ci < row.cells.length; ci++) {
    const cell = row.cells[ci]
    if (cell.formula) continue
    const id = colMap[ci]
    cell.role = 'line_item'
    cell.fieldId = id || null
    cell.itemIndex = itemIdx
    if (!id) {
      cell.value = ''
      continue
    }
    cell.value = cellValueForField(item, id, itemIdx, columns, colMap)
  }
}

function applyComputedTotalsToSheet(sheet, totals) {
  if (!totals) return
  for (const row of sheet.rows) {
    if ((row.cells || []).some(c => c.role === 'line_item' || Number.isInteger(c.itemIndex))) continue
    const joined = (row.cells || []).map(c => c.value).join(' ')
    if (!isLineItemStopText(joined)) continue
    const field = totalFieldForLabel(joined)
    if (!field || totals[field] == null) continue

    let targetIdx = -1
    for (let ci = row.cells.length - 1; ci >= 0; ci--) {
      if (/[0-9]/.test(String(row.cells[ci].value || ''))) { targetIdx = ci; break }
    }
    if (targetIdx < 0) targetIdx = row.cells.length - 1
    if (targetIdx < 0) continue

    const cell = row.cells[targetIdx]
    const original = String(cell.value || '')
    const replaced = replaceLastAmount(original, totals[field])
    cell.value = replaced !== original ? replaced : formatIndianAmount(totals[field])
  }
}

export function fillExcelTemplate(sheets, quote, columns, design = {}, totals) {
  const next = sheetsHaveMappedRoles(sheets)
    ? structuredClone(sheets || [])
    : scrubTransientExcelShell(sheets || [])
  const items = quote.items || []
  const fields = quote.fields || {}
  const validUntil = fields.validUntil || quote.validUntil || ''
  const notesText = (quote.notes || []).filter(Boolean).join('\n')
  const customer = quote.customer || {}

  const roleValue = {
    quote_number: quote.number || '',
    date: quote.date || '',
    valid_until: validUntil,
    notes: notesText,
    customer_name: customer.name || '',
    customer_company: customer.company || '',
    customer_gst: customer.gst || '',
    customer_location: customer.location || '',
    customer_block: [customer.company, customer.name, customer.location, customer.gst].filter(Boolean).join('\n'),
    subject: quote.title || ''
  }

  for (const sheet of next) {
    const { headerRowIndex, start, colMap } = expandExcelLineItemRows(sheet, items.length, columns)
    if (headerRowIndex >= 0 && start >= 0) {
      for (let i = 0; i < items.length; i++) {
        fillExcelItemRow(sheet.rows[start + i], items[i], i, colMap, columns)
      }
    }

    const blockCells = []
    for (const row of sheet.rows) {
      for (const cell of row.cells) {
        if (cell.formula) continue
        if (!cell.role || cell.role === 'content' || cell.role === 'line_item' || cell.role === 'total' || cell.role === 'formula') continue
        const prefix = cell.labelPrefix || splitExcelPrefixedValue(cell.value)?.prefix || ''
        if (cell.role === 'customer_block') {
          blockCells.push(cell)
          continue
        }
        if (roleValue[cell.role] != null) cell.value = `${prefix}${roleValue[cell.role]}`
      }
    }

    const blockLines = [
      customer.company,
      customer.name,
      customer.location,
      customer.gst
    ].filter(Boolean)
    if (blockCells.length <= 1) {
      blockCells.forEach((cell) => {
        cell.value = `${cell.labelPrefix || ''}${blockLines.join('\n')}`
      })
    } else {
      blockCells.forEach((cell, i) => {
        cell.value = `${cell.labelPrefix || ''}${blockLines[i] || ''}`
      })
    }

    applyComputedTotalsToSheet(sheet, totals)
    sheet._colMap = colMap || []
    sheet._headerRowIndex = headerRowIndex
    sheet._itemStart = start
  }

  return next
}
