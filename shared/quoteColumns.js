/**
 * Step 7: typed quotation columns.
 *
 * Column model: { id, label, type, color?, imageWidth?, mode?, digits? }
 *   text      — default free-text cell (existing behaviour)
 *   custom    — legacy user-named free-text cell
 *   attachment — uploaded file shown as a named hyperlink (`col.id` = label,
 *                `${col.id}__url` = file URL, `${col.id}__path` = storage path)
 *   image     — cell holds an image URL (Supabase Storage or inline data URL)
 *   hsn       — plain text HSN/SAC cell
 *   highlight — legacy free-text cell, whole column tinted (header + body, print-safe)
 *   tax       — nested column: merged header + "Rate %" and "Amount" sub-columns
 *   discount  — same nesting as tax, but reduces the taxable base
 *
 * Nested values live in flat item keys so the quote JSON stays diff-friendly:
 *   `${col.id}__rate`, `${col.id}__amount`, `${col.id}__src`
 * `__src` records which side the user typed last so the derived side is the only
 * one ever rewritten — the field being edited is never overwritten.
 *
 * The Amount column uses the same `__src` idea: `${amountCol.id}__src` is
 * 'auto' while Amount = Quantity × Rate, and 'manual' once the user types an
 * Amount of their own, which then survives later Quantity/Rate edits.
 *
 * Calculation order per row: quantity × rate -> base -> minus all discounts ->
 * taxable -> plus all taxes.
 */
import { mapHeaderToField } from './templateMap.js'
import { applyFormulaColumns, isFormulaColumn, normalizeFormula } from './quoteFormulas.js'
import { isSuggestedColumn } from './productKeywords.js'

export { isSuggestedColumn } from './productKeywords.js'

export const COLUMN_TYPES = ['text', 'custom', 'image', 'highlight', 'tax', 'discount', 'attachment', 'hsn']

export const COLUMN_TYPE_LABELS = {
  text: 'Text',
  custom: 'Custom',
  attachment: 'Attachment',
  image: 'Image',
  hsn: 'HSN',
  highlight: 'Highlight',
  tax: 'Tax',
  discount: 'Discount',
  formula: 'Formula'
}

export const DEFAULT_HIGHLIGHT_COLOR = '#fff3bf'
export const DEFAULT_IMAGE_WIDTH = 96

export function columnMode(col) {
  const raw = String(col?.mode || '').toLowerCase()
  if (raw === 'amount') return 'amount'
  return 'percent'
}

export function hsnDigits(col) {
  return String(col?.digits) === '8' ? '8' : '4'
}

export function columnType(col) {
  const type = String(col?.type || '').toLowerCase()
  return COLUMN_TYPES.includes(type) ? type : 'text'
}

export function isTaxOrDiscountColumn(col) {
  const type = columnType(col)
  return type === 'tax' || type === 'discount'
}

export function isNestedColumn(col) {
  return isTaxOrDiscountColumn(col) && columnMode(col) !== 'amount'
}

function columnName(col) {
  return `${String(col?.id || '')} ${String(col?.label || '')}`
}

export function isImageColumn(col) {
  if (columnType(col) === 'image') return true
  if (columnType(col) === 'attachment' || isNestedColumn(col)) return false
  const id = String(col?.id || '').trim()
  const label = String(col?.label || '').trim()
  return /^(image|photo|picture)$/i.test(id) || /^(image|photo|picture)$/i.test(label)
}

export function isAttachmentColumn(col) {
  if (columnType(col) === 'attachment') return true
  if (columnType(col) === 'image' || isNestedColumn(col)) return false
  return /attach/i.test(columnName(col))
}

export function isHighlightColumn(col) {
  return columnType(col) === 'highlight'
}

export function highlightColor(col) {
  const raw = String(col?.color || '').trim()
  return /^#[0-9a-f]{3,8}$/i.test(raw) ? raw : DEFAULT_HIGHLIGHT_COLOR
}

export function imageWidth(col) {
  const n = Number(col?.imageWidth)
  return Number.isFinite(n) && n > 0 ? Math.max(24, Math.min(320, Math.round(n))) : DEFAULT_IMAGE_WIDTH
}

export function rateKey(col) { return `${col?.id}__rate` }
export function amountKey(col) { return `${col?.id}__amount` }
export function sourceKey(col) { return `${col?.id}__src` }
/** Storage object path for an image or attachment cell, kept so replaced files can be deleted. */
export function imagePathKey(col) { return `${col?.id}__path` }
/** Public URL for an attachment cell. The visible cell value is the link label. */
export function attachmentUrlKey(col) { return `${col?.id}__url` }
/** Per-cell image crop / size / fit, stored as a small object on the item. */
export function imageEditKey(col) { return `${col?.id}__edit` }

export function normalizeImageEdit(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const size = Number(src.size)
  const zoom = Number(src.zoom)
  const panX = Number(src.panX)
  const panY = Number(src.panY)
  const fit = src.fit === 'cover' || src.fit === 'fill' ? src.fit : 'contain'
  const widthRaw = Number(src.width)
  return {
    size: Number.isFinite(size) ? Math.max(32, Math.min(240, Math.round(size))) : 48,
    width: Number.isFinite(widthRaw) ? Math.max(24, Math.min(480, Math.round(widthRaw))) : null,
    fit,
    zoom: Number.isFinite(zoom) ? Math.max(1, Math.min(3, Math.round(zoom * 20) / 20)) : 1,
    panX: Number.isFinite(panX) ? Math.max(0, Math.min(100, Math.round(panX))) : 50,
    panY: Number.isFinite(panY) ? Math.max(0, Math.min(100, Math.round(panY))) : 50
  }
}

export function nestedKeys(col) {
  return [rateKey(col), amountKey(col), sourceKey(col)]
}

/** Every item key a column owns, whatever its type. */
export function allColumnKeys(col) {
  return [col?.id, ...nestedKeys(col), imagePathKey(col), attachmentUrlKey(col), imageEditKey(col)]
}

/** Which nested sub-field (if any) an item key belongs to. */
export function nestedFieldInfo(columns, key) {
  for (const col of columns || []) {
    if (!isNestedColumn(col)) continue
    if (key === rateKey(col)) return { col, part: 'rate' }
    if (key === amountKey(col)) return { col, part: 'amount' }
  }
  return null
}

/** Columns an AI draft or knowledge autofill can write plain values into. */
export function aiFillableColumns(columns) {
  return (columns || []).filter(c => c && !isNestedColumn(c) && !isImageColumn(c) && !isAttachmentColumn(c) && !isFormulaColumn(c) && !isSuggestedColumn(c))
}

export function toNumber(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = String(value).replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export function round2(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return 0
  return Math.round((num + Number.EPSILON) * 100) / 100
}

export function formatAmount(n) {
  return round2(n).toFixed(2)
}

/** Rates print without trailing zeros: 18, 2.5, 9.99 */
export function formatRate(n) {
  return String(round2(n))
}

function plainColumns(columns) {
  return (columns || []).filter(c => c && !isNestedColumn(c) && !isImageColumn(c) && !isAttachmentColumn(c))
}

/**
 * Resolve a canonical field (amount / quantity / rate) to a real column,
 * reusing the fuzzy header matching from templateMap.
 */
export function findFieldColumn(columns, field) {
  const plain = plainColumns(columns)
  const byId = plain.find(c => String(c.id || '').toLowerCase() === field)
  if (byId) return byId
  return plain.find(c => mapHeaderToField(c.label, []) === field) || null
}

export const AMOUNT_AUTO = 'auto'
export const AMOUNT_MANUAL = 'manual'

/**
 * The Quantity × Rate formula for a row, or null when the layout cannot run it:
 * without all three columns (or with one column answering to two of them) Amount
 * stays an ordinary free-text cell.
 * `computed` is null when either input is empty or unparseable, which is what
 * keeps Amount blank instead of showing 0 or NaN.
 */
export function amountFormula(item, columns) {
  const amountCol = findFieldColumn(columns, 'amount')
  const qtyCol = findFieldColumn(columns, 'quantity')
  const rateCol = findFieldColumn(columns, 'rate')
  if (!amountCol || !qtyCol || !rateCol) return null
  if (amountCol.id === qtyCol.id || amountCol.id === rateCol.id || qtyCol.id === rateCol.id) return null

  const qty = toNumber(item?.[qtyCol.id])
  const rate = toNumber(item?.[rateCol.id])
  return {
    amountCol,
    qtyCol,
    rateCol,
    computed: qty == null || rate == null ? null : formatAmount(qty * rate)
  }
}

/**
 * Whether a row's Amount is derived or a deliberate override.
 * The `__src` marker wins when present. Without one — AI drafts, knowledge
 * autofill, quotes saved before this existed — the answer is inferred from the
 * data: an Amount that disagrees with Quantity × Rate is taken as deliberate and
 * kept, so no supplied figure is ever silently overwritten on load.
 */
export function amountSource(item, columns, formula = amountFormula(item, columns)) {
  if (!formula) return AMOUNT_MANUAL
  const marked = item?.[sourceKey(formula.amountCol)]
  if (marked === AMOUNT_MANUAL || marked === AMOUNT_AUTO) return marked

  const current = String(item?.[formula.amountCol.id] ?? '').trim()
  if (!current) return AMOUNT_AUTO
  if (formula.computed == null) return AMOUNT_MANUAL
  return toNumber(current) === toNumber(formula.computed) ? AMOUNT_AUTO : AMOUNT_MANUAL
}

/** What the Amount cell should render: is it overridden, and what would the formula say? */
export function amountCellState(item, columns, col) {
  const formula = amountFormula(item, columns)
  if (!formula || formula.amountCol.id !== col?.id) return null
  const manual = amountSource(item, columns, formula) === AMOUNT_MANUAL
  return {
    manual,
    computed: formula.computed,
    // Only worth flagging when there is a different calculated value to go back to.
    overridden: manual && formula.computed != null && toNumber(item?.[col.id]) !== toNumber(formula.computed)
  }
}

/**
 * Record what an edit means for the Amount source, before the row is recalculated.
 * Typing an Amount overrides the formula; clearing the cell hands it back.
 */
export function amountEditPatch(item, columns, key, value) {
  const formula = amountFormula(item, columns)
  if (!formula || formula.amountCol.id !== key) return null
  const src = String(value ?? '').trim() ? AMOUNT_MANUAL : AMOUNT_AUTO
  return { [sourceKey(formula.amountCol)]: src }
}

/** Drop a manual Amount and return to Quantity × Rate. */
export function clearAmountOverride(item, columns) {
  const formula = amountFormula(item, columns)
  if (!formula) return item
  return recalcRow({ ...(item || {}), [sourceKey(formula.amountCol)]: AMOUNT_AUTO }, columns)
}

/**
 * Write Amount = Quantity × Rate. A manual Amount and the field being typed in
 * are both left alone, and an untouched row is returned unchanged so reopening a
 * quote recalculates to exactly what was saved.
 */
function applyRowAmount(item, columns, editingKey) {
  const formula = amountFormula(item, columns)
  if (!formula) return item
  const { amountCol, computed } = formula
  const key = amountCol.id
  if (key === editingKey) return item
  if (amountSource(item, columns, formula) === AMOUNT_MANUAL) return item

  const srcK = sourceKey(amountCol)
  const current = String(item[key] ?? '')
  const next = computed == null ? '' : computed
  // Nothing to derive and nothing derived before: leave the row exactly as it is.
  if (computed == null && !current && item[srcK] == null) return item
  if (current === next && item[srcK] === AMOUNT_AUTO) return item

  const out = { ...item, [key]: next }
  // Remember the row is formula-driven, so clearing Quantity later clears Amount
  // rather than leaving a stale figure that would then look hand-typed.
  if (computed != null) out[srcK] = AMOUNT_AUTO
  return out
}

/**
 * Taxable base for a row, or null when the row carries no usable amount yet.
 * The null case matters: a base of 0 because a discount consumed the row is a
 * real 0.00 tax, while an unresolvable base should leave derived cells blank.
 *
 * A formula on the Amount column is ignored here — that cell may be
 * "Amount after tax", which must never become the discount/tax base.
 */
export function resolveRowBase(item, columns) {
  if (!item) return null
  const amountCol = findFieldColumn(columns, 'amount')
  if (amountCol && !isFormulaColumn(amountCol)) {
    const n = toNumber(item[amountCol.id])
    if (n != null) return round2(n)
  }
  const qtyCol = findFieldColumn(columns, 'quantity')
  const rateCol = findFieldColumn(columns, 'rate')
  if (qtyCol && rateCol) {
    const qty = toNumber(item[qtyCol.id])
    const rate = toNumber(item[rateCol.id])
    if (qty == null || rate == null) return null
    return round2(qty * rate)
  }
  return null
}

/** Same as resolveRowBase but 0 rather than null, for summing. */
export function rowBaseAmount(item, columns) {
  return resolveRowBase(item, columns) ?? 0
}

/**
 * Write the derived half of one nested column and return its amount contribution.
 * `editingKey` is never touched, so typing is never fought.
 * `base` is null when the row has no usable amount yet.
 */
/**
 * Rupee value of a tax/discount column against `percentBase` (list amount for
 * discount, taxable amount for tax). Percent columns follow the visible Rate %
 * whenever it disagrees with a stale ₹ amount — the studio table only shows %.
 */
export function columnMoneyAmount(item, col, percentBase) {
  if (columnMode(col) === 'amount') {
    const n = toNumber(item?.[col.id])
    return n == null ? 0 : round2(n)
  }
  const rate = toNumber(item?.[rateKey(col)])
  const amount = toNumber(item?.[amountKey(col)])
  const src = item?.[sourceKey(col)] === 'amount' ? 'amount' : 'rate'
  if (src === 'amount') {
    if (rate != null && percentBase != null && percentBase > 0) {
      const fromRate = round2((percentBase * rate) / 100)
      if (amount == null || fromRate !== round2(amount)) return fromRate
    }
    return amount == null ? 0 : round2(amount)
  }
  if (rate == null || percentBase == null) return amount == null ? 0 : round2(amount)
  return round2((percentBase * rate) / 100)
}

function applyNestedPair(item, col, base, editingKey) {
  const rk = rateKey(col)
  const ak = amountKey(col)
  let src = item[sourceKey(col)] === 'amount' ? 'amount' : 'rate'

  // Hidden ₹ leftover (e.g. 10% → ₹18) must not win after the user types 18%.
  if (src === 'amount' && ak !== editingKey) {
    const rate = toNumber(item[rk])
    const amount = toNumber(item[ak])
    if (rate != null && base != null && base > 0) {
      const fromRate = round2((base * rate) / 100)
      if (amount == null || fromRate !== round2(amount)) src = 'rate'
    }
  }

  if (src === 'amount') {
    const amount = toNumber(item[ak])
    if (amount == null) {
      if (rk !== editingKey) item[rk] = ''
      return 0
    }
    // A rate is only meaningful against a positive base.
    if (rk !== editingKey) item[rk] = base > 0 ? formatRate((amount / base) * 100) : ''
    return round2(amount)
  }

  const rate = toNumber(item[rk])
  if (rate == null || base == null) {
    if (ak !== editingKey) item[ak] = ''
    return 0
  }
  const amount = round2((base * rate) / 100)
  if (ak !== editingKey) item[ak] = formatAmount(amount)
  return amount
}

/** Flat ₹ tax/discount: the typed value in `col.id` is the contribution. */
function applyAmountModeColumn(item, col, editingKey) {
  const key = col.id
  const amount = toNumber(item[key])
  if (key === editingKey) return amount == null ? 0 : round2(amount)
  return amount == null ? 0 : round2(amount)
}

/**
 * One tax or discount column's rupee contribution. Percent columns keep the
 * Rate % ↔ Amount pair; amount-mode columns stay a single rupee cell.
 */
function applyTaxOrDiscount(item, col, base, editingKey) {
  if (columnMode(col) === 'amount') return applyAmountModeColumn(item, col, editingKey)
  return applyNestedPair(item, col, base, editingKey)
}

/**
 * Recompute a row: Amount first, then every tax/discount cell from the new base.
 * `editingKey` is the cell the user is typing in and is never rewritten.
 *
 * Order: Quantity × Rate → minus discounts → Amount before tax → plus taxes
 * (Amount after tax = before tax × (100 + tax %) / 100, via the tax ₹ cells).
 */
export function recalcRow(item, columns, { editingKey = null } = {}) {
  const cols = columns || []
  const amountCol = findFieldColumn(cols, 'amount')
  const skipAmount = amountCol ? new Set([amountCol.id]) : null
  let next = applyFormulaColumns({ ...(item || {}) }, cols, editingKey, skipAmount)
  if (!isFormulaColumn(amountCol)) {
    next = applyRowAmount(next, cols, editingKey)
  }
  if (cols.some(isTaxOrDiscountColumn)) {
    const base = resolveRowBase(next, cols)

    let discountTotal = 0
    for (const col of cols) {
      if (columnType(col) !== 'discount') continue
      discountTotal += applyTaxOrDiscount(next, col, base, editingKey)
    }

    // Discounts come off first; tax is charged on what is left, never below zero.
    const taxable = base == null ? null : round2(Math.max(0, base - discountTotal))
    for (const col of cols) {
      if (columnType(col) !== 'tax') continue
      applyTaxOrDiscount(next, col, taxable, editingKey)
    }
  }
  return applyFormulaColumns(next, cols, editingKey)
}

export function recalcAllRows(items, columns) {
  if (!Array.isArray(items)) return []
  const cols = columns || []
  if (!cols.some(isTaxOrDiscountColumn) && !amountFormula({}, cols) && !cols.some(isFormulaColumn)) return items
  return items.map(item => recalcRow(item, cols))
}

/** Read-only row maths from already-recalculated cells. */
export function computeRowTotals(item, columns) {
  const cols = columns || []
  const base = rowBaseAmount(item, cols)
  const perColumn = {}
  let discount = 0

  for (const col of cols) {
    if (columnType(col) !== 'discount') continue
    const amount = columnMoneyAmount(item, col, base)
    perColumn[col.id] = amount
    discount += amount
  }

  const taxable = round2(Math.max(0, base - discount))
  let tax = 0
  for (const col of cols) {
    if (columnType(col) !== 'tax') continue
    const amount = columnMoneyAmount(item, col, taxable)
    perColumn[col.id] = amount
    tax += amount
  }

  const taxRounded = round2(tax)
  // Amount after tax = Amount before tax × (100 + tax %) / 100, which is the
  // same as taxable + independently rounded tax ₹ (CGST+SGST on the same base).
  return {
    base: round2(base),
    discount: round2(discount),
    taxable,
    tax: taxRounded,
    total: round2(taxable + taxRounded),
    perColumn
  }
}

export function extraLineUnit(line) {
  return line?.unit === 'percent' ? 'percent' : 'amount'
}

/** Rupee value of an extra line. Percent is of `base` (total before extra lines). */
export function extraLineResolvedAmount(line, base) {
  const raw = Math.abs(toNumber(line?.amount) || 0)
  if (extraLineUnit(line) === 'percent') return round2(Math.abs(Number(base) || 0) * raw / 100)
  return round2(raw)
}

function extraLabelText(line) {
  return String(line?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Freight / packing / cartage extra lines (quote-level add, not a tax column). */
export function isFreightExtraLabel(label) {
  const t = extraLabelText({ label })
  return /freight|packing|cartage|transport|shipping|handling/.test(t)
}

export function normalizeExtraLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines.map((line, i) => ({
    id: String(line?.id || `extra-${i}`),
    label: String(line?.label ?? '').trim(),
    kind: line?.kind === 'add' ? 'add' : 'less',
    unit: extraLineUnit(line),
    amount: line?.amount ?? ''
  }))
}

export function blankExtraLine() {
  return {
    id: `extra-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: 'Discount',
    kind: 'less',
    unit: 'amount',
    amount: ''
  }
}

/** Quote-level totals: subtotal -> discounts -> taxable -> taxes -> extra lines -> grand total. */
export function computeQuoteTotals(items, columns, extraLines) {
  const cols = columns || []
  const rows = Array.isArray(items) ? items : []
  const nestedCols = cols.filter(isNestedColumn)
  const perColumn = cols.filter(isTaxOrDiscountColumn).map(col => ({
    id: col.id,
    label: col.label,
    type: columnType(col),
    amount: 0
  }))

  let subtotal = 0
  let discountTotal = 0
  let taxTotal = 0
  let taxableTotal = 0
  let lineTotal = 0

  for (const item of rows) {
    const totals = computeRowTotals(item, cols)
    subtotal += totals.base
    discountTotal += totals.discount
    taxTotal += totals.tax
    taxableTotal += totals.taxable
    lineTotal += totals.total
    for (const entry of perColumn) {
      entry.amount = round2(entry.amount + (totals.perColumn[entry.id] || 0))
    }
  }

  subtotal = round2(subtotal)
  discountTotal = round2(discountTotal)
  taxTotal = round2(taxTotal)
  // Sum of per-row taxables (tax is charged per row). Do not recompute as
  // max(0, subtotal − discounts): an over-discount on one row must not steal
  // taxable value from another.
  taxableTotal = round2(taxableTotal)
  const extraBase = round2(lineTotal)
  const resolvedExtraLines = normalizeExtraLines(extraLines).map(line => ({
    ...line,
    resolved: extraLineResolvedAmount(line, extraBase)
  }))
  let extraAdd = 0
  let extraLess = 0
  let freightTotal = 0
  for (const line of resolvedExtraLines) {
    const amount = line.resolved
    if (line.kind === 'add') {
      extraAdd += amount
      if (isFreightExtraLabel(line.label)) freightTotal += amount
    } else extraLess += amount
  }
  extraAdd = round2(extraAdd)
  extraLess = round2(extraLess)
  freightTotal = round2(freightTotal)

  return {
    subtotal,
    discountTotal,
    taxableTotal,
    taxTotal,
    extraBase,
    extraAdd,
    extraLess,
    freightTotal,
    grandTotal: round2(Math.max(0, extraBase + extraAdd - extraLess)),
    perColumn,
    resolvedExtraLines,
    hasNested: nestedCols.length > 0
  }
}

export function blankItemFor(columns) {
  const item = {}
  for (const col of columns || []) {
    if (isNestedColumn(col)) {
      item[rateKey(col)] = ''
      item[amountKey(col)] = ''
      item[sourceKey(col)] = 'rate'
    } else {
      item[col.id] = ''
    }
  }
  return item
}

/** Add the keys a newly created column needs, without touching other data. */
export function withColumnKeys(item, col) {
  const next = { ...(item || {}) }
  if (isNestedColumn(col)) {
    if (next[rateKey(col)] == null) next[rateKey(col)] = ''
    if (next[amountKey(col)] == null) next[amountKey(col)] = ''
    if (next[sourceKey(col)] == null) next[sourceKey(col)] = 'rate'
  } else if (next[col.id] == null) {
    next[col.id] = ''
  }
  return next
}

export function withoutColumnKeys(item, col) {
  const next = { ...(item || {}) }
  for (const key of allColumnKeys(col)) delete next[key]
  return next
}

/** Migrate item keys when a column changes type (nested <-> flat, image <-> text). */
export function convertItemForType(item, col, nextType) {
  const next = { ...(item || {}) }
  const wasNested = isNestedColumn(col)
  const willNest = isNestedColumn({ type: nextType })

  // An image cell's URL is meaningless as text, and its storage path is dead weight.
  if (isImageColumn(col) && nextType !== 'image') {
    delete next[imagePathKey(col)]
    delete next[imageEditKey(col)]
    next[col.id] = ''
  }
  if (isAttachmentColumn(col) && nextType !== 'attachment') {
    delete next[imagePathKey(col)]
    delete next[attachmentUrlKey(col)]
    next[col.id] = ''
  }

  if (wasNested && !willNest) {
    const amount = next[amountKey(col)]
    for (const key of nestedKeys(col)) delete next[key]
    next[col.id] = amount != null ? String(amount) : ''
  } else if (!wasNested && willNest) {
    delete next[col.id]
    delete next[imagePathKey(col)]
    delete next[attachmentUrlKey(col)]
    next[rateKey(col)] = ''
    next[amountKey(col)] = ''
    next[sourceKey(col)] = 'rate'
  } else if (next[col.id] == null && !willNest) {
    next[col.id] = ''
  }
  return next
}

/** Keep only known column fields; used before persisting or sending to the AI. */
export function normalizeColumn(col) {
  if (!col?.id || !col?.label) return null
  const type = columnType(col)
  const normalized = { id: String(col.id), label: String(col.label), type }
  if (type === 'highlight') normalized.color = highlightColor(col)
  if (type === 'image') normalized.imageWidth = imageWidth(col)
  if (type === 'tax' || type === 'discount') normalized.mode = columnMode(col)
  if (type === 'hsn') normalized.digits = hsnDigits(col)
  const formula = normalizeFormula(col.formula)
  if (formula) normalized.formula = formula
  if (col.calculated === true) normalized.calculated = true
  return normalized
}

export function normalizeColumnList(columns) {
  const seen = new Set()
  return (Array.isArray(columns) ? columns : [])
    .map(normalizeColumn)
    .filter(col => {
      if (!col || seen.has(col.id)) return false
      seen.add(col.id)
      return true
    })
}

/** How many table cells a column occupies. */
export function columnSpan(col) {
  return isNestedColumn(col) ? 2 : 1
}

export function moveColumnInList(columns, from, to) {
  if (!Array.isArray(columns)) return []
  if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) return columns
  const next = [...columns]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function isRateOrPriceCol(col) {
  const id = String(col?.id || '').toLowerCase()
  const label = String(col?.label || '').toLowerCase()
  return id === 'rate' || id === 'price' || /^(rate|price|unit\s*rate)$/i.test(label)
}

function isQtyCol(col) {
  const id = String(col?.id || '').toLowerCase()
  const label = String(col?.label || '').toLowerCase()
  return id === 'quantity' || id === 'qty' || /^(qty|quantity)$/i.test(label)
}

/** Where a newly added column should land in the row. */
export function insertIndexForNewColumn(columns, col) {
  const list = Array.isArray(columns) ? columns : []
  const type = columnType(col)
  const label = String(col?.label || '')
  const looksHsn = type === 'hsn' || /hsn|sac/i.test(`${col?.id || ''} ${label}`)

  if (looksHsn) {
    // Before Quantity or Rate — whichever comes first.
    let best = -1
    list.forEach((c, i) => {
      if (isQtyCol(c) || isRateOrPriceCol(c)) {
        if (best < 0 || i < best) best = i
      }
    })
    if (best >= 0) return best
    const unitIdx = list.findIndex(c => c.id === 'unit')
    return unitIdx >= 0 ? unitIdx : list.length
  }

  if (type === 'discount') {
    // After Rate / Price.
    let rateIdx = -1
    list.forEach((c, i) => { if (isRateOrPriceCol(c)) rateIdx = i })
    if (rateIdx >= 0) return rateIdx + 1
    const amountIdx = list.findIndex(c => c.id === 'amount' || /amount/i.test(c.label || ''))
    if (amountIdx >= 0) return amountIdx
    return list.length
  }

  if (type === 'tax') {
    // After the last Discount; else after Rate; else before Amount.
    let lastDisc = -1
    list.forEach((c, i) => { if (columnType(c) === 'discount') lastDisc = i })
    if (lastDisc >= 0) return lastDisc + 1
    let rateIdx = -1
    list.forEach((c, i) => { if (isRateOrPriceCol(c)) rateIdx = i })
    if (rateIdx >= 0) return rateIdx + 1
    const amountIdx = list.findIndex(c => c.id === 'amount' || /amount/i.test(c.label || ''))
    if (amountIdx >= 0) return amountIdx
    return list.length
  }

  // Default (text / image / formula…): before Unit, else before Qty, else end.
  const unitIdx = list.findIndex(c => c.id === 'unit')
  if (unitIdx >= 0) return unitIdx
  const qtyIdx = list.findIndex(isQtyCol)
  return qtyIdx >= 0 ? qtyIdx : list.length
}

/** Insert one or more columns at the appropriate commercial positions. */
export function insertTypedColumns(columns, newCols) {
  let next = Array.isArray(columns) ? [...columns] : []
  for (const col of newCols || []) {
    if (!col) continue
    const idx = insertIndexForNewColumn(next, col)
    next.splice(idx, 0, col)
  }
  return next
}

export function isImageValue(value) {
  const v = String(value || '')
  return /^data:image\//i.test(v) || /^https?:\/\//i.test(v) || v.startsWith('/')
}
