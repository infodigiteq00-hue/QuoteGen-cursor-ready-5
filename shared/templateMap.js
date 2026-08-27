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

const ROLE_LABELS = {
  quote_number: 'Quote number',
  date: 'Quote date',
  valid_until: 'Valid through',
  customer_name: 'Contact / customer name',
  customer_company: 'Client / company',
  customer_gst: 'Customer GSTIN',
  customer_location: 'Delivery city / location',
  customer_block: 'Buyer block',
  subject: 'Subject / enquiry reference',
  notes: 'Notes',
  line_items: 'Line items table',
  total: 'Totals'
}

/** Human-readable summary of what the layout mapper detected (for upload preview / debugging). */
export function summarizeTemplateMapping(mapping = {}, sheets = []) {
  const lines = []
  const seen = new Set()
  for (const col of mapping.columns || []) {
    if (!col?.label || seen.has(`col:${col.id}`)) continue
    seen.add(`col:${col.id}`)
    lines.push({ kind: 'column', label: col.label, role: col.id })
  }
  for (const slot of mapping.slots || []) {
    const role = slot?.role
    if (!role || seen.has(`slot:${role}`)) continue
    seen.add(`slot:${role}`)
    lines.push({ kind: 'field', label: ROLE_LABELS[role] || role, role })
  }
  for (const cell of mapping.dynamicCells || []) {
    const key = `cell:${cell.sheet}:${cell.row}:${cell.col}:${cell.role}`
    if (seen.has(key)) continue
    seen.add(key)
    const sheet = sheets[cell.sheet]
    const row = sheet?.rows?.[cell.row]
    const hit = row?.cells?.find(c => Number(c.col) === Number(cell.col))
    lines.push({
      kind: 'cell',
      label: ROLE_LABELS[cell.role] || cell.role,
      role: cell.role,
      at: `row ${Number(cell.row) + 1}, col ${cell.col}`
    })
  }
  return lines
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
  if (/partic|desc|item\b|product|chemical|material(?!\s*grade)/.test(l)) return 'description'
  if (/spe[ci]+f|purity|assay/.test(l) || /^spec\b/.test(l)) return 'specification'
  if (/grade|make|brand|\bcas\b/.test(l)) return 'grade'
  if (/^qty\.?$|^qty$|quantity|^nos\.?$|^pcs\.?$/.test(l)) return 'quantity'
  if (/^unit$|^uom$|^u\.?o\.?m/.test(l)) return 'unit'
  if (/^rate$|unit\s*rate|price|₹\/|rs\.?\//.test(l)) return 'rate'
  if (/gst\s*amount|tax\s*amount/.test(l)) return 'taxAmount'
  // Formula / stage columns like "Amount after tax" are not the GST % column.
  if (/amount\s+(before|after)\s+(tax|gst)|(?:^|\b)(before|after)\s+(tax|gst)\b|final\s+amount|taxable\s+amount|list\s+amount/.test(l)) {
    return null
  }
  if (/tax|gst\s*%|gst%|gst\s*rate|^gst$/.test(l)) return 'tax'
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

/** Pick readable text on any Excel/Word cell background (hex, rgb, rgba). */
export function contrastTextForBackground(bg) {
  const raw = String(bg || '').trim()
  if (!raw || raw === 'transparent') return '#17231f'
  let r = 0
  let g = 0
  let b = 0
  let a = 1
  const hex = raw.replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  } else {
    const m = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i)
    if (!m) return '#17231f'
    r = Number(m[1])
    g = Number(m[2])
    b = Number(m[3])
    a = m[4] != null ? Number(m[4]) : 1
  }
  if (a < 0.35) return '#17231f'
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#17231f' : '#ffffff'
}

/** Ensure filled Word/Excel HTML keeps readable text on tinted header cells. */
export function applyReadableTextOnFilledHtml(html) {
  return String(html || '').replace(/<t([dh])(\b[^>]*)>/gi, (full, tag, attrs) => {
    const styleRe = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i
    const sm = attrs.match(styleRe)
    const style = sm ? (sm[2] ?? sm[3] ?? '') : ''
    const bgM = style.match(/background-color\s*:\s*([^;]+)/i)
    if (!bgM) return full
    const color = contrastTextForBackground(bgM[1].trim())
    let nextStyle = style.replace(/(?:^|;)\s*color\s*:[^;]*/gi, '').replace(/^;+|;+$/g, '').trim()
    nextStyle = [nextStyle, `color:${color}`].filter(Boolean).join(';')
    const nextAttrs = sm
      ? attrs.replace(styleRe, `style="${nextStyle}"`)
      : `${attrs} style="${nextStyle}"`
    return `<t${tag}${nextAttrs}>`
  })
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
  if (/delivery\s*(?:city|location)|ship\s*to|^location\b/i.test(t)) return 'customer_location'
  if (/^(to|bill\s*to|buyer|consignee|m\/s\.?)\b/i.test(t)) return 'customer_block'
  if (/^customer\s*company\b|^company\b|^client\b/i.test(t) || /client\s*\/\s*company/i.test(t)) return 'customer_company'
  if (/^customer(\s*name)?$|^kind\s*attn|^contact\b/i.test(t) || /^customer\s*[:\-–]/i.test(t)) return 'customer_name'
  if (/^subject\b|^sub$|^sub\s*[:\-–]|^ref(?:erence)?\b|enquiry\s*ref/i.test(t)) return 'subject'
  if (/quotation\s*no|quote\s*no|invoice\s*no/i.test(t)) return 'quote_number'
  if (/^no\.?\s*[:\-–]/i.test(t) || /^no\.?$/i.test(t)) return 'quote_number'
  if (/^date\b|^dated\b|quote\s*date|invoice\s*date/i.test(t)) return 'date'
  if (/valid\s*(?:till|until|upto|through)|^validity\b/i.test(t)) return 'valid_until'
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

const ROLE_TEMP_WAVE = {
  quote_number: 0,
  date: 0,
  valid_until: 0,
  customer_name: 0,
  customer_company: 0,
  customer_gst: 0,
  customer_location: 0,
  customer_block: 0,
  subject: 1,
  notes: 1
}

function extractValueAfterLabel(inner, role) {
  const label = ROLE_LABEL_RE[role]
  if (!label) return inner
  if (role === 'customer_block' || role === 'notes' || role === 'subject') {
    const re = new RegExp(`(?:${label}(?:\\s*[:\\-–])?(?:\\s*</[^>]+>)*)([\\s\\S]*)`, 'i')
    const m = String(inner || '').match(re)
    return m ? m[1] : ''
  }
  const re = new RegExp(`${label}(?:\\s*[:\\-–])?\\s*([^<]{0,80})`, 'i')
  const m = String(inner || '').match(re)
  return m ? m[1] : ''
}

/** Wrap sample quote text so the upload preview can fade it out without moving layout. */
export function wrapTempStrip(innerHtml, wave = 0, role = '', { inline = false } = {}) {
  const html = String(innerHtml ?? '')
  if (!stripCellText(html)) return html
  if (/data-qg-temp=/.test(html) || /<!--QGIMG:/.test(html)) return html
  const block = !inline && /<(?:p|div|table|ul|ol|h[1-6]|tr|t[dh])\b/i.test(html)
  const tag = block ? 'div' : 'span'
  const roleAttr = role ? ` data-qg-temp-role="${escapeHtml(role)}"` : ''
  return `<${tag} class="qg-temp-strip" data-qg-temp="1"${roleAttr} style="--qg-temp-wave:${Number(wave) || 0}">${html}</${tag}>`
}

export function maxTempWave(html, sheets) {
  let max = 0
  for (const m of String(html || '').matchAll(/--qg-temp-wave:\s*(\d+)/g)) {
    max = Math.max(max, Number(m[1]) || 0)
  }
  for (const sheet of sheets || []) {
    for (const row of sheet.rows || []) {
      for (const cell of row.cells || []) {
        if (Number.isFinite(cell.tempWave)) max = Math.max(max, cell.tempWave)
      }
    }
  }
  return max
}

function applyWordPrefixedMarks(html) {
  let out = String(html || '')
  const rules = [
    { re: /\b((?:Quotation|Quote|Invoice)\s*No\.?\s*[:\-–]?\s*)(?!<span[^>]*(?:data-slot|data-qg-temp)=)([A-Z]{2,}[\s./-]*\d[\w./-]*)/gi, role: 'quote_number' },
    { re: /\b(No\.?\s*[:\-–]\s*)(?!<span[^>]*(?:data-slot|data-qg-temp)=)([A-Z]{2,}[\s./-]*\d[\w./-]*)/gi, role: 'quote_number' },
    { re: /\b(Date\s*[:\-–]\s*)(?!<span[^>]*(?:data-slot|data-qg-temp)=)([^<]{0,40})/gi, role: 'date' },
    { re: /\b(Valid(?:\s*(?:till|until|upto))?\s*[:\-–]\s*)(?!<span[^>]*(?:data-slot|data-qg-temp)=)([^<]{0,40})/gi, role: 'valid_until' }
  ]
  for (const rule of rules) {
    out = out.replace(rule.re, (full, prefix, value) => {
      if ((rule.role === 'date' || rule.role === 'valid_until') && !looksLikeDateValue(value)) return full
      if (!String(value || '').trim()) return full
      return `${prefix}${wrapTempStrip(value, ROLE_TEMP_WAVE[rule.role] || 0, rule.role, { inline: true })}`
    })
  }
  return out
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

/** Same targets as scrub, but the sample text stays visible so the UI can fade it. */
export function markTransientWordShell(html) {
  const images = protectImages(html)
  const perm = protectPermanent(images.html)
  let out = String(perm.html || '')

  out = mapWordLayoutCells(out, (inner, role, mode) => {
    if (cellAlreadySlotted(inner) || isPermanentBlockText(stripCellText(inner))) return inner
    const wave = ROLE_TEMP_WAVE[role] ?? 0
    if (mode === 'value-cell') return wrapTempStrip(inner, wave, role)
    const valuePart = extractValueAfterLabel(inner, role)
    if (!stripCellText(valuePart)) return inner
    return setCellValueKeepingLabel(inner, role, wrapTempStrip(valuePart, wave, role, { inline: true }))
  })
  out = applyWordPrefixedMarks(out)

  const picked = pickLineItemsTable(out)
  if (picked) {
    const { table, headerRowIndex, rowMatches } = picked
    const nextRows = rowMatches.map((row, i) => {
      if (i <= headerRowIndex) return row
      const wave = 1 + Math.min(Math.max(i - headerRowIndex - 1, 0), 10)
      if (isLineItemStopText(stripCellText(row))) {
        return row.replace(
          />(\s*(?:₹|rs\.?|inr)?\s*[\d,]+\.?\d*\s*)</gi,
          (_, num) => `>${wrapTempStrip(num, wave, 'total', { inline: true })}<`
        )
      }
      if (/data-qg-temp=/.test(row)) return row
      return row.replace(/<t([dh])(\b[^>]*)>([\s\S]*?)<\/t\1>/gi, (full, tag, attrs, inner) => {
        if (!stripCellText(inner) || /<!--QGIMG:/.test(inner) || /data-qg-temp=/.test(inner)) return full
        return `<t${tag}${attrs}>${wrapTempStrip(inner, wave, 'line_cell')}</t${tag}>`
      })
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
const EXCEL_PREFIX_RE = /^(No|Date|Dated|Valid(?:\s*(?:till|until|upto|through))?|Kind\s*Attn|Quotation\s*No\.?|Quote\s*No\.?|Customer(?:\s*Name)?|Customer\s*GSTIN|GSTIN|GST(?:\s*No\.?)?|Company|Client|Contact|Delivery\s*(?:City|Location))\s*:\s*/i

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
  else if (/kind\s*attn|^customer(\s*name)?$|^contact$/i.test(label)) role = 'customer_name'
  else if (/gstin|customer\s*gst/i.test(label)) role = 'customer_gst'
  else if (/^company$|^client$/i.test(label)) role = 'customer_company'
  else if (/delivery\s*(?:city|location)/i.test(label)) role = 'customer_location'
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
  if (/delivery (?:city|location)|ship to|^location$/.test(l)) return 'customer_location'
  if (/^(to|bill to|buyer|consignee|m s|m\/s)$/.test(l) || /bill to|consignee/.test(l)) return 'customer_block'
  if (/^customer company|^company$|^client$/.test(l) || /client\s*\/?\s*company/.test(l)) return 'customer_company'
  if (/^customer name|^kind attn|^customer$|^contact$/.test(l)) return 'customer_name'
  if (/^subject$|^sub$|^ref$|reference|enquiry ref/.test(l)) return 'subject'
  if (/quotation no\.?|quote no\.?|^qtn/.test(l) || /^no\.?$/.test(l)) return 'quote_number'
  if (/^date$|quote date|dated|invoice date/.test(l)) return 'date'
  if (/valid till|valid until|valid upto|valid through|^valid$|^validity$/.test(l)) return 'valid_until'
  if (/^notes$|clarifications|^remarks$/.test(l)) return 'notes'
  return null
}

function looksLikeFieldHint(text) {
  const t = String(text || '').trim()
  if (!t || t.length > 80) return false
  if (/:\s*(yes|no)\s*\/\s*(yes|no)/i.test(t)) return true
  if (/\b(?:liquid|powder|granules|drum|bag|ibc|bulk)\b/i.test(t) && t.includes('/')) return true
  return false
}

function cellBelowValue(sheet, rowIndex, col, colSpan = 1) {
  for (let ri = rowIndex + 1; ri < Math.min(sheet.rows.length, rowIndex + 4); ri++) {
    const row = sheet.rows[ri]
    if (lineItemHeaderScore((row.cells || []).map(c => String(c.value || ''))) >= 0) break
    const cell = ensureCellAt(row, col)
    if (!cell || cell.formula) continue
    const text = String(cell.value || '').trim()
    if (!text) return cell
    if (excelLabelRole(text) || isPermanentBlockText(text) || looksLikeFieldHint(text)) return null
    return cell
  }
  const nextRow = sheet.rows[rowIndex + 1]
  if (!nextRow) return null
  return ensureCellAt(nextRow, col)
}

function findCellByCol(row, col) {
  return (row?.cells || []).find(c => Number(c.col) === Number(col))
}

/** Columns covered by another cell's colspan in the same row (must not render or invent). */
export function coveredColsInRow(row) {
  const covered = new Set()
  for (const cell of row?.cells || []) {
    const span = Math.max(1, Number(cell.colSpan) || 1)
    const start = Number(cell.col)
    for (let c = start + 1; c < start + span; c++) covered.add(c)
  }
  return covered
}

export function visibleRowCells(row) {
  const covered = coveredColsInRow(row)
  return (row?.cells || []).filter(c => !covered.has(Number(c.col)))
}

/** Excel-style column letter (1 → A, 27 → AA). */
export function excelColLetter(col) {
  let n = Math.max(1, Number(col) || 1)
  let out = ''
  while (n > 0) {
    n -= 1
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return out
}

/** Line-item table range on a sheet, or null if none detected. */
export function excelLineItemRange(sheet) {
  const headerRowIndex = findItemHeaderRowIndex(sheet)
  if (headerRowIndex < 0) return null
  let start = headerRowIndex + 1
  let end = start
  for (let i = start; i < (sheet.rows || []).length; i++) {
    if (isExcelItemStopRow(sheet.rows[i])) break
    end = i + 1
  }
  return { headerRowIndex, start, end }
}

function rowLooksOccupied(row) {
  return (row?.cells || []).some((c) => {
    if (String(c.value || '').trim()) return true
    if (c.formula) return true
    const s = c.style || {}
    return Boolean(
      s.hasOwnBorder
      || s.borderTop
      || s.borderRight
      || s.borderBottom
      || s.borderLeft
      || s.backgroundColor
    )
  })
}

/** Full-width / tinted section title row — starts a new visual table. */
function isSectionBannerRow(row) {
  const cells = visibleRowCells(row)
  if (!cells.length) return false
  const text = String(cells[0]?.value || '').trim()
  if (!text || text.length < 3) return false
  const span = Math.max(1, Number(cells[0].colSpan) || 1)
  if (span >= 3 && cells.length <= 2) return true
  const bg = cells[0]?.style?.backgroundColor
  if (bg && /material|commercial|technical|particular|offer|identity|terms/i.test(text)) return true
  if (bg && cells.length >= 2 && cells.every(c => (c.style?.backgroundColor || '') === bg)) return true
  return false
}

/**
 * Detect visual table blocks in an Excel sheet (split on empty separator rows
 * and section banner headers). Each region gets its own add-row / add-column controls.
 */
export function detectExcelTableRegions(sheet) {
  const rows = sheet?.rows || []
  if (!rows.length) return []
  const maxCol = Math.max(1, ...(sheet.columns || []).map(c => Number(c.index) || 0), 1)
  const raw = []
  let start = -1
  for (let i = 0; i < rows.length; i++) {
    const busy = rowLooksOccupied(rows[i])
    const banner = isSectionBannerRow(rows[i])
    if (banner && start >= 0 && i > start) {
      raw.push({ startRi: start, endRi: i - 1 })
      start = i
      continue
    }
    if (busy) {
      if (start < 0) start = i
      continue
    }
    if (start < 0) continue
    if (i + 1 < rows.length && rowLooksOccupied(rows[i + 1])) continue
    raw.push({ startRi: start, endRi: i - 1 })
    start = -1
  }
  if (start >= 0) raw.push({ startRi: start, endRi: rows.length - 1 })

  const lineRange = excelLineItemRange(sheet)
  return raw
    .filter(r => r.endRi >= r.startRi)
    .map((r, idx) => {
      let kind = 'generic'
      if (lineRange && r.startRi <= lineRange.headerRowIndex && r.endRi >= Math.max(lineRange.headerRowIndex, lineRange.start - 1)) {
        kind = 'line_items'
      }
      let headerRi = r.startRi
      for (let i = r.startRi; i <= r.endRi; i++) {
        const labels = (rows[i].cells || []).map(c => String(c.value || ''))
        if (lineItemHeaderScore(labels) >= 0) {
          headerRi = i
          break
        }
      }
      return {
        id: `tbl-${idx}-${r.startRi}-${r.endRi}`,
        startRi: r.startRi,
        endRi: r.endRi,
        headerRi,
        kind,
        minCol: 1,
        maxCol
      }
    })
}

function renumberExcelRows(sheet) {
  ;(sheet.rows || []).forEach((row, i) => { row.index = i + 1 })
}

function cloneStyleForStructure(style = {}) {
  return { ...(style || {}) }
}

/**
 * Insert a blank row after array index `afterRi`, cloning height/styles from the
 * source row so custom uploaded tables keep their look.
 */
export function insertExcelRow(sheet, afterRi, options = {}) {
  if (!sheet) return sheet
  const rows = sheet.rows || []
  const at = Math.max(-1, Math.min(rows.length - 1, Number(afterRi)))
  const src = rows[at >= 0 ? at : 0] || { heightPx: 22, cells: [] }
  const asLine = Boolean(options.asLineItem)
  const newRow = {
    index: 0,
    heightPx: src.heightPx || 22,
    cells: (src.cells || []).map(c => ({
      col: Number(c.col),
      value: '',
      formula: null,
      style: cloneStyleForStructure(c.style),
      rowSpan: 1,
      colSpan: Math.max(1, Number(c.colSpan) || 1),
      role: asLine ? 'line_item' : (c.role === 'line_item' ? 'line_item' : 'content')
    }))
  }
  // Expand rowSpans that cover the insert point
  for (let ri = 0; ri <= at; ri++) {
    for (const cell of rows[ri]?.cells || []) {
      const span = Math.max(1, Number(cell.rowSpan) || 1)
      if (span > 1 && ri + span - 1 > at) cell.rowSpan = span + 1
    }
  }
  rows.splice(at + 1, 0, newRow)
  renumberExcelRows(sheet)
  return sheet
}

/** Remove the row at array index `ri`. */
export function removeExcelRow(sheet, ri) {
  if (!sheet?.rows?.length) return sheet
  const idx = Number(ri)
  if (!Number.isInteger(idx) || idx < 0 || idx >= sheet.rows.length) return sheet
  if (sheet.rows.length <= 1) return sheet
  for (let i = 0; i < idx; i++) {
    for (const cell of sheet.rows[i]?.cells || []) {
      const span = Math.max(1, Number(cell.rowSpan) || 1)
      if (span > 1 && i + span - 1 >= idx) cell.rowSpan = Math.max(1, span - 1)
    }
  }
  sheet.rows.splice(idx, 1)
  renumberExcelRows(sheet)
  return sheet
}

/**
 * Insert a column after 1-based `afterCol`, cloning width/styles from the neighbor.
 */
export function insertExcelColumn(sheet, afterCol, options = {}) {
  if (!sheet) return sheet
  const col = Math.max(0, Number(afterCol) || 0)
  const newCol = col + 1
  const oldCols = [...(sheet.columns || [])].sort((a, b) => Number(a.index) - Number(b.index))
  const srcCol = oldCols.find(c => Number(c.index) === col) || oldCols[oldCols.length - 1] || { widthPx: 80 }
  const nextCols = []
  for (const c of oldCols) {
    const idx = Number(c.index)
    if (idx <= col) nextCols.push({ ...c, index: idx })
    else nextCols.push({ ...c, index: idx + 1 })
  }
  nextCols.push({
    index: newCol,
    widthPx: Number(options.widthPx) || Number(srcCol.widthPx) || 80
  })
  sheet.columns = nextCols.sort((a, b) => Number(a.index) - Number(b.index))

  for (const row of sheet.rows || []) {
    const cells = row.cells || []
    for (const cell of cells) {
      const start = Number(cell.col)
      const span = Math.max(1, Number(cell.colSpan) || 1)
      if (start > col) cell.col = start + 1
      else if (start <= col && start + span - 1 > col) cell.colSpan = span + 1
    }
    const styleSrc = cells.find(c => Number(c.col) === col)
      || cells.find(c => Number(c.col) === newCol + 1)
      || cells[0]
    if (!cells.some(c => Number(c.col) === newCol)) {
      cells.push({
        col: newCol,
        value: '',
        formula: null,
        style: cloneStyleForStructure(styleSrc?.style),
        rowSpan: 1,
        colSpan: 1,
        role: styleSrc?.role === 'line_item' ? 'line_item' : 'content'
      })
      cells.sort((a, b) => Number(a.col) - Number(b.col))
    }
    row.cells = cells
  }
  return sheet
}

/** Remove 1-based column `col`. */
export function removeExcelColumn(sheet, col) {
  if (!sheet) return sheet
  const target = Number(col)
  if (!Number.isInteger(target) || target < 1) return sheet
  const cols = sheet.columns || []
  if (cols.length <= 1) return sheet
  sheet.columns = cols
    .filter(c => Number(c.index) !== target)
    .map(c => ({
      ...c,
      index: Number(c.index) > target ? Number(c.index) - 1 : Number(c.index)
    }))
    .sort((a, b) => Number(a.index) - Number(b.index))

  for (const row of sheet.rows || []) {
    const nextCells = []
    for (const cell of row.cells || []) {
      const start = Number(cell.col)
      const span = Math.max(1, Number(cell.colSpan) || 1)
      if (start === target) {
        if (span > 1) {
          nextCells.push({ ...cell, colSpan: span - 1 })
        }
        continue
      }
      if (start < target && start + span - 1 >= target) {
        nextCells.push({ ...cell, colSpan: Math.max(1, span - 1) })
        continue
      }
      if (start > target) nextCells.push({ ...cell, col: start - 1 })
      else nextCells.push(cell)
    }
    row.cells = nextCells.sort((a, b) => Number(a.col) - Number(b.col))
  }
  return sheet
}

/** Shift layoutEdit keys after a row insert/remove on one sheet. */
export function shiftLayoutEditsForRowChange(edits, sheetIndex, afterRi, delta) {
  const out = {}
  const si = Number(sheetIndex)
  for (const [key, value] of Object.entries(edits || {})) {
    const parts = String(key).split(':')
    if (parts.length < 3) { out[key] = value; continue }
    const kSi = Number(parts[0])
    const rowIndex = Number(parts[1])
    const col = parts[2]
    if (kSi !== si) { out[key] = value; continue }
    if (delta > 0 && rowIndex > afterRi + 1) out[`${si}:${rowIndex + delta}:${col}`] = value
    else if (delta < 0 && rowIndex === afterRi + 1) continue
    else if (delta < 0 && rowIndex > afterRi + 1) out[`${si}:${rowIndex + delta}:${col}`] = value
    else out[key] = value
  }
  return out
}

/** Shift layoutEdit keys after a column insert/remove on one sheet. */
export function shiftLayoutEditsForColChange(edits, sheetIndex, afterCol, delta) {
  const out = {}
  const si = Number(sheetIndex)
  for (const [key, value] of Object.entries(edits || {})) {
    const parts = String(key).split(':')
    if (parts.length < 3) { out[key] = value; continue }
    const kSi = Number(parts[0])
    const rowIndex = parts[1]
    const col = Number(parts[2])
    if (kSi !== si) { out[key] = value; continue }
    if (delta > 0 && col > afterCol) out[`${si}:${rowIndex}:${col + delta}`] = value
    else if (delta < 0 && col === afterCol) continue
    else if (delta < 0 && col > afterCol) out[`${si}:${rowIndex}:${col + delta}`] = value
    else out[key] = value
  }
  return out
}

export function shiftPlacementsForRowChange(placements, sheetIndex, afterRi, delta) {
  const out = { ...(placements || {}) }
  const si = Number(sheetIndex)
  for (const [role, loc] of Object.entries(out)) {
    if (!loc || Number(loc.sheet) !== si) continue
    const row = Number(loc.row)
    if (delta > 0 && row > afterRi) out[role] = { ...loc, row: row + delta }
    else if (delta < 0 && row === afterRi) delete out[role]
    else if (delta < 0 && row > afterRi) out[role] = { ...loc, row: row + delta }
  }
  return out
}

export function shiftPlacementsForColChange(placements, sheetIndex, afterCol, delta) {
  const out = { ...(placements || {}) }
  const si = Number(sheetIndex)
  for (const [role, loc] of Object.entries(out)) {
    if (!loc || Number(loc.sheet) !== si) continue
    const col = Number(loc.col)
    if (delta > 0 && col > afterCol) out[role] = { ...loc, col: col + delta }
    else if (delta < 0 && col === afterCol) delete out[role]
    else if (delta < 0 && col > afterCol) out[role] = { ...loc, col: col + delta }
  }
  return out
}

function ensureCellAt(row, col) {
  if (!row) return null
  const covered = coveredColsInRow(row)
  if (covered.has(Number(col))) return null
  let cell = findCellByCol(row, col)
  if (cell) return cell
  cell = {
    col: Number(col),
    value: '',
    formula: null,
    style: {},
    rowSpan: 1,
    colSpan: 1,
    role: 'content'
  }
  row.cells = [...(row.cells || []), cell].sort((a, b) => a.col - b.col)
  return cell
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
      if (!hit.onlyLabel || hit.role === 'customer_block' || hit.role === 'subject') continue
      const belowRow = sheet.rows[hit.ri + 1]
      if (belowRow) ensureCellAt(belowRow, hit.col)
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
      if (!labelCell || !hit.onlyLabel) continue
      const valueCell = nextCellInRow(row, hit.col, labelCell.colSpan)
      let mapped = false
      if (valueCell && !valueCell.formula) {
        const valueText = String(valueCell.value || '').trim()
        if (!excelLabelRole(valueText) && !isPermanentBlockText(valueText)) {
          valueCell.role = hit.role
          valueCell.value = ''
          mapped = true
        }
      }
      if (!mapped) {
        const belowCell = cellBelowValue(sheet, hit.ri, hit.col, labelCell.colSpan)
        if (belowCell) {
          belowCell.role = hit.role
          belowCell.value = ''
        }
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

/** Tag Excel cells whose sample values scrub will drop, without clearing them yet. */
export function markTransientExcelShell(sheets) {
  const next = structuredClone(sheets || [])
  const scrubbed = scrubTransientExcelShell(structuredClone(sheets || []))

  for (let si = 0; si < next.length; si++) {
    const src = next[si]
    const dst = scrubbed[si]
    if (!src?.rows || !dst?.rows) continue
    const headerRowIndex = findItemHeaderRowIndex(src)

    for (let ri = 0; ri < src.rows.length; ri++) {
      const srcRow = src.rows[ri]
      const dstRow = dst.rows[ri]
      if (!srcRow?.cells || !dstRow?.cells) continue
      const wave = headerRowIndex >= 0 && ri > headerRowIndex
        ? 1 + Math.min(ri - headerRowIndex - 1, 10)
        : 0

      for (const cell of srcRow.cells) {
        if (cell.formula) continue
        const cleared = dstRow.cells.find(c => Number(c.col) === Number(cell.col))
        if (!cleared) continue
        const before = String(cell.value || '')
        const after = String(cleared.value || '')
        if (!before || before === after) continue
        cell.tempWave = wave
        if (after && before.startsWith(after)) {
          cell.labelPrefix = after
          cell.tempFadeValue = before.slice(after.length)
        } else {
          cell.tempFadeValue = before
          cell.tempTo = after
        }
      }
    }
  }

  return next
}

function labelOnlyExcel(text, role) {
  const t = String(text || '').trim()
  if (t.length > 48) return false
  if (role === 'customer_block') return /^(to|bill\s*to|buyer|customer|consignee|m\/s\.?)\s*:?$/i.test(t)
  if (role === 'subject') return /^(subject|sub|ref(?:erence)?|enquiry\s*ref(?:erence)?)\s*:?$/i.test(t)
  if (role === 'customer_name') return /^(customer(?:\s*name)?|kind\s*attn|contact)\s*:?$/i.test(t)
  if (role === 'customer_company') return /^(company|customer\s*company|client(?:\s*\/\s*company)?)\s*:?$/i.test(t)
  if (role === 'customer_gst') return /^(gstin|customer\s*gstin|customer\s*gst|gst(?:\s*(?:no|number|#))?)\s*:?$/i.test(t)
  if (role === 'customer_location') return /^(delivery\s*(?:city|location)|ship\s*to|location)\s*:?$/i.test(t)
  if (role === 'quote_number') return /^(no\.?|quotation\s*no\.?|quote\s*no\.?)\s*:?$/i.test(t)
  if (role === 'date') return /^(date|dated|quote\s*date|invoice\s*date)\s*:?$/i.test(t)
  if (role === 'valid_until') return /^(valid|validity|valid\s*(?:till|until|upto|through))\s*:?$/i.test(t)
  return /^(notes|remarks)\s*:?$/i.test(t)
}

/** Natural page width for uploaded layouts — never force A4.
 *  Always widens to fit Excel column widths (and optional design hint).
 */
export function excelSheetContentWidthPx(sheet, { chromePx = 56 } = {}) {
  const cols = sheet?.columns || []
  if (!cols.length) return 0
  const tableW = cols.reduce((sum, c) => sum + Math.max(40, Number(c.widthPx) || 80), 0)
  return Math.round(tableW + chromePx)
}

export function inferTemplatePageWidth(type, content, design = {}) {
  const designed = Number(design.pageWidthPx) > 0 ? Math.round(Number(design.pageWidthPx)) : 0

  if (type === 'excel') {
    const sheets = Array.isArray(content) ? content : (content ? [content] : [])
    const sheet = sheets[design.activeSheet || 0] || sheets[0] || null
    const fromSheet = excelSheetContentWidthPx(sheet)
    // Prefer the wider of saved design vs live columns so added columns
    // auto-widen the page instead of spilling outside the frame.
    return Math.max(640, designed, fromSheet || 0)
  }

  if (designed > 0) return designed

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
    const cols = countWordLineItemColumns(html)
    if (cols > 6) max = Math.max(max, Math.round(cols * 110 + 96))
    // Keep growing with columns so the page can scroll horizontally —
    // don't hard-cap when the user adds fields.
    return Math.max(designed || 816, max, 816)
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
  if (/freight|packing|cartage|transport|shipping|handling/.test(l)) return 'freightTotal'
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
  const replaced = replaceLastAmount(row, amount)
  if (replaced !== row) return replaced
  const labels = cellLabelsFromRow(row).filter(Boolean)
  if (labels.length > 1) return row
  return String(row).replace(/(<td\b[^>]*>)(\s*)(<\/td>)(?![\s\S]*<td\b)/i, `$1${formatted}$3`)
}

function splitTrailingForExtras(trailingRows) {
  let insertAt = 0
  trailingRows.forEach((row, i) => {
    const field = totalFieldForLabel(stripCellText(row))
    if (field === 'subtotal' || field === 'taxableTotal' || field === 'taxTotal') insertAt = i + 1
    if (field === 'grandTotal' && insertAt <= i) insertAt = i
  })
  return {
    before: trailingRows.slice(0, insertAt),
    after: trailingRows.slice(insertAt)
  }
}

function rowCellMatches(rowHtml) {
  return [...String(rowHtml || '').matchAll(/<t([dh])(\b[^>]*)>([\s\S]*?)<\/t\1>/gi)].map(m => ({
    full: m[0],
    tag: `t${m[1]}`,
    attrs: m[2] || '',
    inner: m[3] || ''
  }))
}

function insertCellIntoRowHtml(rowHtml, afterColIndex, { header = false, label = '' } = {}) {
  const open = String(rowHtml || '').match(/^<tr\b[^>]*>/i)?.[0] || '<tr>'
  const cells = rowCellMatches(rowHtml)
  if (!cells.length) return rowHtml
  const insertAt = Math.min(cells.length, Math.max(0, Number(afterColIndex) + 1))
  const src = cells[Math.min(insertAt, cells.length - 1)] || cells[cells.length - 1]
  const tag = header ? 'th' : (src.tag === 'th' ? 'td' : src.tag)
  const cleanAttrs = String(src.attrs || '').replace(/\sdata-qg-[^=]+="[^"]*"/gi, '')
  const inner = header ? escapeHtml(label || 'New') : ''
  const fresh = `<${tag}${cleanAttrs}>${inner}</${tag}>`
  const body = [
    ...cells.slice(0, insertAt).map(c => c.full),
    fresh,
    ...cells.slice(insertAt).map(c => c.full)
  ].join('')
  return `${open}${body}</tr>`
}

/** Insert one column into the Word line-items table after 0-based cell index. */
export function insertWordLineItemColumn(html, afterColIndex, options = {}) {
  const picked = pickLineItemsTable(html)
  if (!picked) return html
  const { table, headerRowIndex = 0, rowMatches } = picked
  const label = String(options.label || 'New').trim() || 'New'
  const nextRows = rowMatches.map((row, i) => insertCellIntoRowHtml(row, afterColIndex, {
    header: i === headerRowIndex,
    label
  }))
  const open = table.match(/^<table\b[^>]*>/i)?.[0] || '<table>'
  const rebuilt = `${open}${nextRows.join('')}</table>`
  return replaceFirst(html, table, rebuilt)
}

function removeCellFromRowHtml(rowHtml, colIndex) {
  const open = String(rowHtml || '').match(/^<tr\b[^>]*>/i)?.[0] || '<tr>'
  const cells = rowCellMatches(rowHtml)
  if (cells.length <= 1) return rowHtml
  const idx = Math.max(0, Math.min(cells.length - 1, Number(colIndex)))
  const body = cells.filter((_, i) => i !== idx).map(c => c.full).join('')
  return `${open}${body}</tr>`
}

/** Remove one column from the Word line-items table at 0-based cell index. */
export function removeWordLineItemColumn(html, colIndex) {
  const picked = pickLineItemsTable(html)
  if (!picked) return html
  const { table, headers, rowMatches } = picked
  if ((headers || []).length <= 1) return html
  const nextRows = rowMatches.map(row => removeCellFromRowHtml(row, colIndex))
  const open = table.match(/^<table\b[^>]*>/i)?.[0] || '<table>'
  const rebuilt = `${open}${nextRows.join('')}</table>`
  return replaceFirst(html, table, rebuilt)
}

export function countWordLineItemColumns(html) {
  const picked = pickLineItemsTable(html)
  return picked?.headers?.length || 0
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

  const trailingRows = rowMatches.slice(bodyEnd)
  const trailingText = trailingRows.map(stripCellText).join(' ').toLowerCase()
  const extraRows = extraLineTableRows(
    fieldIds.length,
    (totals?.resolvedExtraLines || []).filter(line => extraLineNeedsOwnRow(line, trailingText))
  )
  const filledTrailing = trailingRows.map((row) => {
    const rawText = stripCellText(row)
    if (/bank|ifsc|account|swift/.test(rawText.toLowerCase()) && !/grand\s*total|sub\s*total/.test(rawText.toLowerCase())) return row
    const field = totalFieldForLabel(rawText)
    const amount = field ? totals?.[field] : null
    return amount != null ? fillTotalSlot(row, amount) : row
  })
  const split = splitTrailingForExtras(filledTrailing)
  const hasGrand = filledTrailing.some(row => totalFieldForLabel(stripCellText(row)) === 'grandTotal')
  const grandRow = (!hasGrand && totals?.grandTotal != null)
    ? extraLineTableRows(fieldIds.length, [{ label: 'Grand Total', resolved: totals.grandTotal, kind: 'add' }])
    : ''

  const open = table.match(/^<table\b[^>]*>/i)?.[0] || '<table>'
  const head = rowMatches.slice(0, headerRowIndex + 1).join('')
  const rebuilt = `${open}${head}${bodyRows}${split.before.join('')}${extraRows}${split.after.join('')}${grandRow}</table>`
  return replaceFirst(html, table, rebuilt)
}

function extraLineNeedsOwnRow(line, trailingText) {
  const label = String(line?.label || '').trim().toLowerCase()
  if (!label) return false
  if (trailingText.includes(label)) return false
  const field = totalFieldForLabel(label)
  if (field === 'freightTotal' && /freight|packing|cartage|transport|shipping/.test(trailingText)) return false
  if (field === 'grandTotal' && /grand\s*total|\btotal\b/.test(trailingText)) return false
  return true
}

function extraLineTableRows(fieldCount, lines) {
  const cols = Math.max(1, Number(fieldCount) || 1)
  return (lines || []).map(line => {
    const label = escapeHtml(String(line.label || 'Extra').trim() || 'Extra')
    const amount = formatIndianAmount(line.resolved ?? 0)
    const signed = line.kind === 'less' ? `− ${amount}` : amount
    if (cols <= 1) return `<tr data-qg-extra="1"><td>${label} ${signed}</td></tr>`
    const middle = cols > 2 ? '<td></td>'.repeat(cols - 2) : ''
    return `<tr data-qg-extra="1"><td>${label}</td>${middle}<td>${signed}</td></tr>`
  }).join('')
}

function fillRowFromTemplate(rowHtml, fieldIds, item, idx, columns) {
  let i = 0
  let cleaned = String(rowHtml || '').replace(/\sdata-qg-(?:item|field)="[^"]*"/gi, '')
  // Keep blank inserts from collapsing thinner than a normal line row.
  if (!/^<tr\b[^>]*\bstyle=/i.test(cleaned)) {
    cleaned = cleaned.replace(/^<tr\b/i, '<tr style="min-height:36px"')
  } else if (!/min-height\s*:/i.test(cleaned.match(/^<tr\b[^>]*>/i)?.[0] || '')) {
    cleaned = cleaned.replace(/^<tr\b([^>]*?)\bstyle=(["'])([^"']*)\2/i, (_, pre, q, style) => (
      `<tr${pre}style=${q}${style};min-height:36px${q}`
    ))
  }
  return cleaned.replace(/<t([dh])(\b[^>]*)>([\s\S]*?)<\/t\1>/gi, (_, tag, attrs) => {
    const id = fieldIds[i++]
    const marked = `${attrs} data-qg-item="${idx}"${id ? ` data-qg-field="${escapeHtml(id)}"` : ''}`
    if (!id) return `<t${tag}${marked}>&nbsp;</t${tag}>`
    const col = (columns || []).find(c => c?.id === id)
    const type = String(col?.type || '').toLowerCase()
    if (type === 'image') {
      const src = String(item?.[id] || '')
      if (!src) return `<t${tag}${marked}>&nbsp;</t${tag}>`
      const w = Number(col.imageWidth) > 0 ? Math.round(Number(col.imageWidth)) : 96
      return `<t${tag}${marked}><img src="${escapeHtml(src)}" width="${w}" style="max-width:100%;height:auto"/></t${tag}>`
    }
    const val = cellValueForField(item, id, idx, columns, fieldIds)
    if (id === 'description' || id === 'specification' || id === 'item') {
      const inner = formatDescriptionHtml(val) || '&nbsp;'
      return `<t${tag}${marked}>${inner}</t${tag}>`
    }
    const text = escapeHtml(val).replace(/\n/g, '<br/>')
    return `<t${tag}${marked}>${text || '&nbsp;'}</t${tag}>`
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
    if ((row.cells || []).some(c => c.role === 'extra_line')) continue
    const joined = (row.cells || []).map(c => c.value).join(' ')
    if (!isLineItemStopText(joined) && !/freight|packing|cartage|transport|shipping/i.test(joined)) continue
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

/** Fill freight / packing / custom extra-line rows, then standard totals. */
export function applyExtraLinesAndTotalsToSheet(sheet, totals) {
  if (!sheet || !totals) return
  const lines = totals.resolvedExtraLines || []
  for (const line of lines) {
    const label = String(line.label || '').trim().toLowerCase()
    if (!label) continue
    for (const row of sheet.rows || []) {
      if ((row.cells || []).some(c => c.role === 'line_item' || Number.isInteger(c.itemIndex))) continue
      const labelCell = (row.cells || []).find(c => {
        const t = String(c.value || '').trim().toLowerCase()
        return t && (t === label || t.includes(label) || label.includes(t.replace(/[:/].*$/, '').trim()))
      })
      if (!labelCell) continue
      let amountCell = null
      for (let ci = (row.cells || []).length - 1; ci >= 0; ci--) {
        const c = row.cells[ci]
        if (c === labelCell) continue
        if (c.formula) continue
        amountCell = c
        break
      }
      if (!amountCell) continue
      const amount = Number(line.resolved) || 0
      const original = String(amountCell.value || '')
      const replaced = replaceLastAmount(original, amount)
      amountCell.value = replaced !== original ? replaced : formatIndianAmount(amount)
      amountCell.role = amountCell.role || 'extra_line'
    }
  }
  applyComputedTotalsToSheet(sheet, totals)
}

/** Find the best array index to insert an extra line (before Grand Total / after Subtotal). */
export function findExtraLineInsertIndex(sheet) {
  const rows = sheet?.rows || []
  let grandRi = -1
  let subRi = -1
  let stopRi = -1
  for (let i = 0; i < rows.length; i++) {
    const joined = (rows[i].cells || []).map(c => c.value).join(' ')
    const field = totalFieldForLabel(joined)
    if (field === 'grandTotal' && grandRi < 0) grandRi = i
    if (field === 'subtotal' && subRi < 0) subRi = i
    if (stopRi < 0 && isLineItemStopText(joined)) stopRi = i
  }
  if (grandRi >= 0) return grandRi
  if (subRi >= 0) return subRi + 1
  if (stopRi >= 0) return stopRi
  return rows.length
}

/** Quote field values keyed by layout role (for fill + placement learning). */
export function quoteRoleValues(quote = {}) {
  const customer = quote.customer || {}
  const fields = quote.fields || {}
  return {
    quote_number: quote.number || '',
    date: quote.date || '',
    valid_until: fields.validUntil || quote.validUntil || '',
    notes: (quote.notes || []).filter(Boolean).join('\n'),
    customer_name: customer.name || '',
    customer_company: customer.company || '',
    customer_gst: customer.gst || '',
    customer_location: customer.location || '',
    customer_block: [customer.company, customer.name, customer.location, customer.gst].filter(Boolean).join('\n'),
    subject: quote.title || ''
  }
}

function normalizePlacementText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function cellDisplayForLearning(cell, layoutKey, layoutEdits) {
  let displayed = Object.prototype.hasOwnProperty.call(layoutEdits || {}, layoutKey)
    ? layoutEdits[layoutKey]
    : (cell?.value ?? '')
  const prefix = cell?.labelPrefix || ''
  if (prefix && String(displayed).startsWith(prefix)) {
    displayed = String(displayed).slice(prefix.length)
  }
  return String(displayed ?? '')
}

/**
 * Learn where each quote field currently lives after the user edits the layout.
 * Exact cell matches win; coordinates use sheet array row index (stable above line items).
 */
export function learnExcelPlacements(sheets, quote, layoutEdits = {}, previous = {}) {
  const roleValues = quoteRoleValues(quote)
  const placements = { ...(previous || {}) }
  const LEARN_ROLES = [
    'subject', 'quote_number', 'date', 'valid_until',
    'customer_name', 'customer_company', 'customer_gst', 'customer_location', 'notes'
  ]

  for (const role of LEARN_ROLES) {
    const value = roleValues[role]
    const nv = normalizePlacementText(value)
    if (!nv || nv.length < 2) continue

    let best = null
    ;(sheets || []).forEach((sheet, si) => {
      ;(sheet.rows || []).forEach((row, ri) => {
        for (const cell of row.cells || []) {
          if (cell.formula) continue
          const key = `${si}:${row.index}:${cell.col}`
          const nd = normalizePlacementText(cellDisplayForLearning(cell, key, layoutEdits))
          if (!nd) continue
          if (nd === nv) {
            best = { sheet: si, row: ri, col: cell.col, score: 100 }
          } else if (nv.length >= 10 && nd.includes(nv) && (!best || best.score < 60)) {
            best = { sheet: si, row: ri, col: cell.col, score: 60 }
          }
        }
      })
    })
    if (best) {
      placements[role] = { sheet: best.sheet, row: best.row, col: best.col }
    }
  }
  return placements
}

/** Move role tags onto remembered cells so future fills use the corrected spots. */
export function applyPlacementRolesToSheets(sheets, placements = {}) {
  const next = structuredClone(sheets || [])
  const roles = Object.keys(placements || {})
  if (!roles.length) return next

  for (const sheet of next) {
    for (const row of sheet.rows || []) {
      for (const cell of row.cells || []) {
        if (roles.includes(cell.role)) cell.role = 'content'
      }
    }
  }

  for (const [role, loc] of Object.entries(placements || {})) {
    const hit = findSheetCellByArrayIndex(next, loc)
    if (hit?.cell) hit.cell.role = role
  }
  return next
}

/**
 * Build export sheets from what the user actually sees — reads live cell inputs
 * tagged with data-qg-cell-key (sheetIndex:rowIndex:col).
 */
export function snapshotExcelSheetsFromDom(sheets, root = typeof document !== 'undefined' ? document : null) {
  const next = structuredClone(sheets || [])
  if (!root?.querySelectorAll) return next

  for (const node of root.querySelectorAll('[data-qg-cell-key]')) {
    const key = node.getAttribute('data-qg-cell-key')
    if (!key) continue
    const parts = String(key).split(':')
    if (parts.length < 3) continue
    const si = Number(parts[0])
    const rowIndex = Number(parts[1])
    const col = Number(parts[2])
    const sheet = next[si]
    if (!sheet) continue
    const row = (sheet.rows || []).find(r => Number(r.index) === rowIndex)
    if (!row) continue
    const cell = (row.cells || []).find(c => Number(c.col) === col)
    if (!cell || cell.formula) continue
    const raw = node.value != null ? node.value : (node.innerText ?? '')
    const prefix = cell.labelPrefix || ''
    cell.value = prefix ? `${prefix}${raw}` : raw
  }
  return next
}

/** Overlay free-form cell edits onto filled sheets (export / learning snapshot). */
export function applyLayoutEditsToSheets(sheets, layoutEdits = {}) {
  const next = structuredClone(sheets || [])
  for (const [key, value] of Object.entries(layoutEdits || {})) {
    const parts = String(key).split(':')
    if (parts.length < 3) continue
    const si = Number(parts[0])
    const rowIndex = Number(parts[1])
    const col = Number(parts[2])
    const sheet = next[si]
    if (!sheet) continue
    const row = (sheet.rows || []).find(r => Number(r.index) === rowIndex)
    if (!row) continue
    const cell = (row.cells || []).find(c => Number(c.col) === col)
    if (!cell || cell.formula) continue
    const prefix = cell.labelPrefix || ''
    cell.value = prefix ? `${prefix}${value}` : value
  }
  return next
}

export function placementsEqual(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
  for (const key of keys) {
    const x = a?.[key]
    const y = b?.[key]
    if (!x && !y) continue
    if (!x || !y) return false
    if (Number(x.sheet) !== Number(y.sheet) || Number(x.row) !== Number(y.row) || Number(x.col) !== Number(y.col)) {
      return false
    }
  }
  return true
}

function findSheetCellByArrayIndex(sheets, loc) {
  if (!loc) return null
  const sheet = sheets?.[Number(loc.sheet)]
  if (!sheet) return null
  const row = sheet.rows?.[Number(loc.row)]
  if (!row) return null
  const cell = (row.cells || []).find(c => Number(c.col) === Number(loc.col))
  if (!cell) return null
  return { sheet, row, cell }
}

export function fillExcelTemplate(sheets, quote, columns, design = {}, totals, options = {}) {
  const next = sheetsHaveMappedRoles(sheets)
    ? structuredClone(sheets || [])
    : scrubTransientExcelShell(sheets || [])
  const items = quote.items || []
  const customer = quote.customer || {}
  const roleValue = quoteRoleValues(quote)
  const placements = options.placements || {}
  const placedRoles = new Set(Object.keys(placements))

  for (let si = 0; si < next.length; si++) {
    const sheet = next[si]
    const { headerRowIndex, start, colMap } = expandExcelLineItemRows(sheet, items.length, columns)
    if (headerRowIndex >= 0 && start >= 0) {
      for (let i = 0; i < items.length; i++) {
        fillExcelItemRow(sheet.rows[start + i], items[i], i, colMap, columns)
      }
    }

    const blockCells = []
    for (let ri = 0; ri < sheet.rows.length; ri++) {
      const row = sheet.rows[ri]
      for (const cell of row.cells) {
        if (cell.formula) continue
        if (!cell.role || cell.role === 'content' || cell.role === 'line_item' || cell.role === 'total' || cell.role === 'formula') continue
        // Only trust explicit labelPrefix — never re-parse filled values as prefixes
        // (that was doubling "Rohan Mehta" → "Rohan MehtaRohan Mehta").
        const prefix = cell.labelPrefix || ''
        if (placedRoles.has(cell.role)) {
          const loc = placements[cell.role]
          const isTarget = loc
            && Number(loc.sheet) === si
            && Number(loc.row) === ri
            && Number(loc.col) === Number(cell.col)
          if (!isTarget) {
            if (!prefix) cell.value = ''
            else cell.value = prefix
            continue
          }
        }
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
    if (!placedRoles.has('customer_block')) {
      if (blockCells.length <= 1) {
        blockCells.forEach((cell) => {
          cell.value = `${cell.labelPrefix || ''}${blockLines.join('\n')}`
        })
      } else {
        blockCells.forEach((cell, i) => {
          cell.value = `${cell.labelPrefix || ''}${blockLines[i] || ''}`
        })
      }
    }

    applyExtraLinesAndTotalsToSheet(sheet, totals)
    sheet._colMap = colMap || []
    sheet._headerRowIndex = headerRowIndex
    sheet._itemStart = start
  }

  for (const [role, loc] of Object.entries(placements)) {
    if (roleValue[role] == null || role === 'customer_block') continue
    const hit = findSheetCellByArrayIndex(next, loc)
    if (!hit?.cell || hit.cell.formula) continue
    const prefix = hit.cell.labelPrefix || ''
    hit.cell.role = role
    hit.cell.value = `${prefix}${roleValue[role]}`
  }

  return next
}
