/**
 * Click-built formulas on custom quotation columns.
 *
 * Built-in Quantity, Rate, Amount, tax, and discount stay as they are.
 * A formula is a list of tokens (or a shortcut that expands to tokens).
 * Evaluation is left-to-right so the click builder never hides operator precedence.
 */
import {
  AMOUNT_AUTO,
  AMOUNT_MANUAL,
  columnMoneyAmount,
  columnType,
  computeRowTotals,
  findFieldColumn,
  formatAmount,
  formatRate,
  isAttachmentColumn,
  isImageColumn,
  isNestedColumn,
  rateKey,
  resolveRowBase,
  sourceKey,
  toNumber
} from './quoteColumns.js'

export const FORMULA_PRESETS = [
  { id: 'list_amount', title: 'Quantity × Rate', hint: 'The usual Amount' },
  { id: 'before_tax', title: 'After discount', hint: 'Quantity × Rate, minus discount' },
  { id: 'after_discount', title: 'After discount', hint: 'Quantity × Rate − discount' },
  { id: 'after_tax', title: 'After tax', hint: 'After discount, plus tax' },
  { id: 'rate_after_discount', title: 'Rate after discount', hint: 'Per-piece rate once discount is off' }
]

export function presetsForTable(columns) {
  const hasTax = (columns || []).some(c => columnType(c) === 'tax')
  const hasDisc = (columns || []).some(c => columnType(c) === 'discount')
  return FORMULA_PRESETS.filter(p => {
    if (p.id === 'after_tax') return hasTax
    if (p.id === 'before_tax') return hasTax || hasDisc
    if (p.id === 'after_discount' || p.id === 'rate_after_discount') return hasDisc
    return true
  })
}

export function tokensForPreset(presetId) {
  switch (presetId) {
    case 'list_amount':
      return [{ type: 'stage', stage: 'list' }]
    case 'before_tax':
    case 'after_discount':
      return [{ type: 'stage', stage: 'taxable' }]
    case 'after_tax':
      return [{ type: 'stage', stage: 'gross' }]
    case 'rate_after_discount':
      return [
        { type: 'stage', stage: 'taxable' },
        { type: 'op', op: '/' },
        { type: 'field', field: 'quantity' }
      ]
    default:
      return []
  }
}

export function normalizeFormula(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const preset = String(raw.preset || '').trim() || null
  const tokens = Array.isArray(raw.tokens) ? raw.tokens.map(normalizeToken).filter(Boolean) : []
  const expanded = tokens.length ? tokens : (preset ? tokensForPreset(preset) : [])
  if (!expanded.length) return null
  return { version: 1, preset, tokens: expanded }
}

function normalizeToken(token) {
  if (!token || typeof token !== 'object') return null
  if (token.type === 'paren' && (token.paren === '(' || token.paren === ')')) {
    return { type: 'paren', paren: token.paren }
  }
  if (token.type === 'op' && ['+', '-', '*', '/'].includes(token.op)) return { type: 'op', op: token.op }
  if (token.type === 'pctOf') return { type: 'pctOf' }
  if (token.type === 'number') {
    const n = toNumber(token.value)
    if (n == null) return null
    return { type: 'number', value: n }
  }
  if (token.type === 'field' && ['quantity', 'rate', 'amount'].includes(token.field)) {
    return { type: 'field', field: token.field }
  }
  if (token.type === 'stage' && ['list', 'taxable', 'gross', 'discountTotal', 'taxTotal'].includes(token.stage)) {
    return { type: 'stage', stage: token.stage }
  }
  if (token.type === 'col' && token.colId) {
    const part = token.part === 'percent' || token.part === 'amount' ? token.part : 'value'
    return { type: 'col', colId: String(token.colId), part }
  }
  return null
}

export function isFormulaColumn(col) {
  return Boolean(normalizeFormula(col?.formula))
}

/** Explicit custom formula column (not the built-in Amount path). */
export function isCalculatedColumn(col) {
  return Boolean(col?.calculated)
}

/**
 * fx is only for the Amount column or columns marked calculated
 * (created via "Formula column"). Description / Unit / Qty / Rate stay plain.
 */
export function canHaveFormula(col, columns = []) {
  if (!col) return false
  if (isImageColumn(col) || isAttachmentColumn(col) || isNestedColumn(col)) return false
  const type = columnType(col)
  if (type === 'tax' || type === 'discount') return false
  if (String(col.id || '').toLowerCase() === 'oursuggested') return false
  if (isCalculatedColumn(col)) return true
  const amountCol = findFieldColumn(columns, 'amount')
  if (amountCol && col.id === amountCol.id) return true
  return false
}

/**
 * Soften casual typing before tokenization.
 * Important: `qty x rate - disc x tax%` means commercial A:
 * qty×rate − discount% + tax%  (not disc×tax).
 */
function normalizeCommercialShorthand(text) {
  let raw = String(text || '').trim().replace(/^=/, '')
  if (!raw) return ''
  raw = raw.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
  // Treat lone "x" / "X" between operands as multiply
  raw = raw.replace(/\bx\b/gi, '*')
  // qty*rate / quantity*rate → stage nickname
  raw = raw.replace(/\bqty\s*\*\s*rate\b/ig, 'Quantity × Rate')
  raw = raw.replace(/\bquantity\s*\*\s*rate\b/ig, 'Quantity × Rate')
  // `- disc * tax%` or `- discount x gst%` → `- disc + tax%` (user intent A)
  raw = raw.replace(
    /-\s*((?:disc(?:ount)?|gst|tax|cgst|sgst|igst)(?:\s*%|%)?)\s*\*\s*((?:disc(?:ount)?|gst|tax|cgst|sgst|igst)(?:\s*%|%)?)/gi,
    (_m, left, right) => {
      const L = String(left).toLowerCase()
      const R = String(right).toLowerCase()
      const leftIsDisc = /disc/.test(L)
      const rightIsTax = /tax|gst|cgst|sgst|igst/.test(R)
      const leftIsTax = /tax|gst|cgst|sgst|igst/.test(L)
      const rightIsDisc = /disc/.test(R)
      if (leftIsDisc && rightIsTax) return `- ${left.replace(/%/g, '').trim()} + ${right.replace(/%/g, '').trim()}%`
      if (leftIsTax && rightIsDisc) return `- ${right.replace(/%/g, '').trim()} + ${left.replace(/%/g, '').trim()}%`
      return `- ${left} + ${right}`
    }
  )
  return raw
}

function findOperandColumn(name, columns, forColId) {
  const cleaned = String(name || '')
    .toLowerCase()
    .replace(/%/g, '')
    .replace(/₹|rs\.?/g, '')
    .replace(/[_\s.]+/g, ' ')
    .trim()
  if (!cleaned) return null
  const list = (columns || []).filter(c => c && c.id !== forColId)

  const byExact = list.find(c => String(c.label || '').toLowerCase().trim() === cleaned
    || String(c.id || '').toLowerCase() === cleaned.replace(/\s/g, ''))
  if (byExact) return byExact

  const aliases = {
    qty: 'quantity',
    quantity: 'quantity',
    nos: 'quantity',
    pcs: 'quantity',
    rate: 'rate',
    price: 'rate',
    amount: 'amount',
    disc: 'discount',
    discount: 'discount',
    tax: 'tax',
    gst: 'tax',
    cgst: 'tax',
    sgst: 'tax',
    igst: 'tax'
  }
  const fieldHint = aliases[cleaned] || aliases[cleaned.replace(/\s+/g, '')]
  if (fieldHint === 'quantity' || fieldHint === 'rate' || fieldHint === 'amount') {
    return findFieldColumn(list, fieldHint)
  }
  if (fieldHint === 'discount') {
    return list.find(c => columnType(c) === 'discount') || null
  }
  if (fieldHint === 'tax') {
    // Prefer exact gst/tax label match, else first tax column
    return list.find(c => columnType(c) === 'tax' && /gst|^tax$/i.test(String(c.label || '')))
      || list.find(c => columnType(c) === 'tax')
      || null
  }

  // Fuzzy: label contains the typed word (disc ↔ Discount)
  return list.find(c => {
    const label = String(c.label || '').toLowerCase()
    const id = String(c.id || '').toLowerCase()
    return label === cleaned || label.includes(cleaned) || cleaned.includes(label) || id.includes(cleaned.replace(/\s/g, ''))
  }) || null
}

function tokenForOperandColumn(col, { wantPercent = false } = {}) {
  if (!col) return null
  if (columnType(col) === 'tax' || columnType(col) === 'discount' || isNestedColumn(col)) {
    // % columns: use ₹ contribution (base × % / 100). Raw percent only for "N % of".
    if (wantPercent) return { type: 'col', colId: col.id, part: 'percent' }
    return { type: 'col', colId: col.id, part: 'amount' }
  }
  return { type: 'col', colId: col.id, part: 'value' }
}

/** Turn a typed Excel-style / casual line into tokens. */
export function parsePlainFormula(text, columns = [], forColId = '') {
  let raw = normalizeCommercialShorthand(text)
  if (!raw) return []
  const parts = raw
    .split(/(\s*\+\s*|\s*-\s*|\s*\*\s*|\s*\/\s*|% of|Quantity × Rate|\(|\))/i)
    .map(s => s.trim())
    .filter(Boolean)
  const tokens = []
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (part === '(' || part === ')') {
      tokens.push({ type: 'paren', paren: part })
      continue
    }
    if (part === '+' || part === '-' || part === '*' || part === '/') {
      tokens.push({ type: 'op', op: part === '*' ? '*' : part === '/' ? '/' : part })
      continue
    }
    if (lower === '% of') {
      tokens.push({ type: 'pctOf' })
      continue
    }
    if (lower === 'quantity × rate' || lower === 'qty × rate') {
      tokens.push({ type: 'stage', stage: 'list' })
      continue
    }
    if (lower === 'quantity' || lower === 'qty') {
      tokens.push({ type: 'field', field: 'quantity' })
      continue
    }
    if (lower === 'rate') {
      tokens.push({ type: 'field', field: 'rate' })
      continue
    }
    if (lower === 'amount') {
      tokens.push({ type: 'field', field: 'amount' })
      continue
    }
    if (lower === 'after discount' || lower === 'amount after discount' || lower === 'amount before tax') {
      tokens.push({ type: 'stage', stage: 'taxable' })
      continue
    }
    if (lower === 'after tax' || lower === 'amount after tax' || lower === 'final amount') {
      tokens.push({ type: 'stage', stage: 'gross' })
      continue
    }
    const n = Number(String(part).replace(/,/g, '').replace(/%/g, ''))
    if (Number.isFinite(n) && String(part).replace(/[,\s%]/g, '') !== '' && !/[a-z]/i.test(part)) {
      // Bare "18%" in a chain is unusual; keep as number (use with "% of")
      tokens.push({ type: 'number', value: n })
      continue
    }
    const wantPercent = /%/.test(part)
    const col = findOperandColumn(part, columns, forColId)
    if (col) {
      const qty = findFieldColumn(columns, 'quantity')
      const rate = findFieldColumn(columns, 'rate')
      const amount = findFieldColumn(columns, 'amount')
      if (qty && col.id === qty.id) {
        tokens.push({ type: 'field', field: 'quantity' })
        continue
      }
      if (rate && col.id === rate.id) {
        tokens.push({ type: 'field', field: 'rate' })
        continue
      }
      if (amount && col.id === amount.id) {
        tokens.push({ type: 'field', field: 'amount' })
        continue
      }
      const tok = tokenForOperandColumn(col, { wantPercent: false })
      if (tok) tokens.push(tok)
      continue
    }
  }
  return rewritePercentOpsToMoney(tokens, columns)
}

/**
 * If someone still built `… * Discount%` after a minus, turn tax/discount
 * percent multiplies into ₹ amount tokens so 10 means 10% of list, not ×10.
 */
function rewritePercentOpsToMoney(tokens, columns) {
  if (!tokens?.length) return tokens
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (
      t?.type === 'col'
      && t.part === 'percent'
      && (columnType((columns || []).find(c => c.id === t.colId)) === 'tax'
        || columnType((columns || []).find(c => c.id === t.colId)) === 'discount')
    ) {
      out.push({ ...t, part: 'amount' })
      continue
    }
    out.push(t)
  }
  return out
}

/**
 * Formula to attach when a column is added. Only clearly named
 * Amount-before/after-tax columns get a shortcut without the Formula type —
 * vague labels like "including" / "exclusive" stay ordinary text cells.
 * Other columns only get a guess when `guessTokens` is set (the Formula type
 * or the "this column is a formula" checkbox) — same as before.
 */
export function formulaForAddedColumn(col, columns = [], { guessTokens = false } = {}) {
  if (!canHaveFormula(col, columns)) return null
  const text = String(col?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const namedBeforeTax = (/before/.test(text) && (/\btax\b/.test(text) || /\bgst\b/.test(text)))
    || /pre tax/.test(text)
    || /pretax/.test(text)
    || (/\btaxable\b/.test(text) && /\bamount\b/.test(text))
  const namedAfterTax = (/after/.test(text) && (/\btax\b/.test(text) || /\bgst\b/.test(text)))
    || /final amount/.test(text)
  if (namedBeforeTax) {
    return normalizeFormula({ preset: 'before_tax', tokens: tokensForPreset('before_tax') })
  }
  if (namedAfterTax) {
    return normalizeFormula({ preset: 'after_tax', tokens: tokensForPreset('after_tax') })
  }
  if (!guessTokens) return null
  const guessed = defaultFormulaTokens(col, columns)
  if (!guessed.length) return null
  return normalizeFormula({ tokens: guessed })
}

const AUTO_AMOUNT_PRESETS = new Set([
  'list_amount',
  'before_tax',
  'after_discount',
  'after_tax',
  'rate_after_discount'
])

function amountLabelLocksBeforeTax(col) {
  const text = String(col?.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return (/before/.test(text) && (/\btax\b/.test(text) || /\bgst\b/.test(text)))
    || /pre tax/.test(text)
    || /pretax/.test(text)
    || (/\btaxable\b/.test(text) && /\bamount\b/.test(text))
    || /excl/.test(text)
}

function isCommercialAmountToken(token, columns = []) {
  if (!token) return false
  if (token.type === 'op') return true
  if (token.type === 'stage' && ['list', 'taxable', 'gross', 'discountTotal', 'taxTotal'].includes(token.stage)) return true
  if (token.type === 'field' && (token.field === 'quantity' || token.field === 'rate')) return true
  if (token.type === 'col') {
    const col = (columns || []).find(c => c.id === token.colId)
    return Boolean(col && (columnType(col) === 'tax' || columnType(col) === 'discount'))
  }
  return false
}

/** True when Amount is still on the built-in / shortcut path (safe to auto-upgrade). */
export function isAutoAmountFormula(formula, columns = []) {
  const f = normalizeFormula(formula)
  if (!f) return true
  if (f.preset && AUTO_AMOUNT_PRESETS.has(f.preset)) return true
  if (
    f.tokens.length === 1
    && f.tokens[0]?.type === 'stage'
    && ['list', 'taxable', 'gross'].includes(f.tokens[0].stage)
  ) return true
  // Click-builder / guessed Qty × Rate − Discount (+ Tax) chains without a preset.
  if (f.tokens.length && f.tokens.every(t => isCommercialAmountToken(t, columns))) {
    return f.tokens.some(t => t.type === 'field' || t.type === 'stage' || t.type === 'col')
  }
  return false
}

/** Best commercial preset for the Amount column given current tax/discount columns. */
export function suggestedAmountPreset(columns = []) {
  const cols = columns || []
  const hasTax = cols.some(c => columnType(c) === 'tax')
  const hasDisc = cols.some(c => columnType(c) === 'discount')
  if (hasTax) return 'after_tax'
  if (hasDisc) return 'after_discount'
  return null
}

/**
 * When Tax % / Discount is added (or removed), keep the Amount cell in sync:
 * Qty × Rate → after discount → after tax. Hand-built custom formulas stay put.
 * Returns `{ columns, amountFormulaChanged }`.
 */
export function adaptAmountFormula(columns = []) {
  const cols = Array.isArray(columns) ? columns : []
  const amountCol = findFieldColumn(cols, 'amount')
  if (!amountCol || !canHaveFormula(amountCol, cols)) {
    return { columns: cols, amountFormulaChanged: false }
  }
  if (!isAutoAmountFormula(amountCol.formula, cols)) {
    return { columns: cols, amountFormulaChanged: false }
  }
  if (amountLabelLocksBeforeTax(amountCol)) {
    return { columns: cols, amountFormulaChanged: false }
  }

  const preset = suggestedAmountPreset(cols)
  const current = normalizeFormula(amountCol.formula)

  if (!preset) {
    if (!current) return { columns: cols, amountFormulaChanged: false }
    return {
      columns: cols.map(c => {
        if (c.id !== amountCol.id) return c
        const next = { ...c }
        delete next.formula
        return next
      }),
      amountFormulaChanged: true
    }
  }

  const nextFormula = normalizeFormula({ preset, tokens: tokensForPreset(preset) })
  if (
    current?.preset === nextFormula.preset
    && JSON.stringify(current.tokens) === JSON.stringify(nextFormula.tokens)
  ) {
    return { columns: cols, amountFormulaChanged: false }
  }

  return {
    columns: cols.map(c => (c.id === amountCol.id ? { ...c, formula: nextFormula } : c)),
    amountFormulaChanged: true
  }
}

/**
 * Adapt Amount's commercial formula and clear stale overrides so recalc can
 * rewrite line Amount (e.g. 180 after discount → 216 after tax).
 */
export function syncAmountFormula(columns = [], items = []) {
  const { columns: nextColumns, amountFormulaChanged } = adaptAmountFormula(columns)
  if (!amountFormulaChanged) return { columns: nextColumns, items, changed: false }
  const amountCol = findFieldColumn(nextColumns, 'amount')
  const nextItems = amountCol
    ? (Array.isArray(items) ? items : []).map(item => ({
      ...(item || {}),
      [sourceKey(amountCol)]: AMOUNT_AUTO
    }))
    : items
  return { columns: nextColumns, items: nextItems, changed: true }
}

export function inferFormulaPreset(label, columns = [], colIndex = -1) {
  const text = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (!text) return null

  const isRate = /\brate\b/.test(text) && !/\bamount\b/.test(text)
  if (isRate && /after/.test(text) && /discount/.test(text)) return 'rate_after_discount'
  if (isRate && /after/.test(text) && /\btax\b|gst/.test(text)) return 'rate_after_discount'

  if (/after/.test(text) && (/\btax\b/.test(text) || /\bgst\b/.test(text) || /final/.test(text) || /gross/.test(text))) {
    return 'after_tax'
  }
  if (/before/.test(text) && /discount/.test(text)) return 'list_amount'
  if (/after/.test(text) && /discount/.test(text)) return 'after_discount'
  if (/before/.test(text) && (/\btax\b/.test(text) || /\bgst\b/.test(text) || /taxable/.test(text))) return 'before_tax'
  if (/taxable/.test(text) || /pre tax/.test(text) || /pretax/.test(text) || /excl/.test(text)) return 'before_tax'
  if (/final amount/.test(text) || /incl/.test(text)) return 'after_tax'
  if (/list amount/.test(text) || /list price/.test(text)) return 'list_amount'

  if (/\bamount\b/.test(text) && Array.isArray(columns) && colIndex >= 0) {
    const lastTax = lastIndexOfType(columns, 'tax')
    if (lastTax >= 0 && colIndex > lastTax) return 'after_tax'
    const lastDisc = lastIndexOfType(columns, 'discount')
    if (lastDisc >= 0 && colIndex > lastDisc) return 'after_discount'
  }
  return null
}

function lastIndexOfType(columns, type) {
  let found = -1
  for (let i = 0; i < columns.length; i++) {
    if (columnType(columns[i]) === type) found = i
  }
  return found
}

function valueTokenFor(col, columns) {
  if (!col) return null
  const qty = findFieldColumn(columns, 'quantity')
  const rate = findFieldColumn(columns, 'rate')
  const amount = findFieldColumn(columns, 'amount')
  if (qty && col.id === qty.id) return { type: 'field', field: 'quantity' }
  if (rate && col.id === rate.id) return { type: 'field', field: 'rate' }
  if (amount && col.id === amount.id) return { type: 'field', field: 'amount' }
  if (isNestedColumn(col) || columnType(col) === 'tax' || columnType(col) === 'discount') {
    return { type: 'col', colId: col.id, part: 'amount' }
  }
  return { type: 'col', colId: col.id, part: 'value' }
}

function looksLikeAmountColumn(col) {
  const id = String(col?.id || '').toLowerCase()
  const text = String(col?.label || '').toLowerCase()
  if (id === 'amount') return true
  return /\bamount\b|\btotal\b|\btaxable\b|\bfinal\b|\bvalue\b|\bprice\b|\bnet\b/.test(text)
}

function looksLikeRateColumn(col) {
  const text = String(col?.label || '').toLowerCase()
  return /\brate\b/.test(text) && !/\bamount\b/.test(text)
}

/**
 * Default formula for an Amount-style column, from its name and the columns
 * sitting before it: Quantity × Rate, then − Discount, then + Tax when those
 * belong in this cell. The user can still change every piece in the picker.
 */
export function defaultFormulaTokens(col, columns = []) {
  if (!col) return []
  const cols = columns || []
  const qty = findFieldColumn(cols, 'quantity')
  const rate = findFieldColumn(cols, 'rate')
  if (!qty || !rate || col.id === qty.id || col.id === rate.id) return []
  if (!looksLikeAmountColumn(col) && !looksLikeRateColumn(col)) return []

  const idx = cols.findIndex(c => c.id === col.id)
  const before = idx >= 0 ? cols.slice(0, idx) : cols.filter(c => c.id !== col.id)
  const discsBefore = before.filter(c => columnType(c) === 'discount')
  const taxesBefore = before.filter(c => columnType(c) === 'tax')
  const discsAll = cols.filter(c => c.id !== col.id && columnType(c) === 'discount')
  const taxesAll = cols.filter(c => c.id !== col.id && columnType(c) === 'tax')

  const label = String(col.label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const namedBeforeTax = (/before/.test(label) && (/\btax\b/.test(label) || /\bgst\b/.test(label) || /taxable/.test(label)))
    || /pre tax/.test(label) || /pretax/.test(label) || /excl/.test(label) || /taxable/.test(label)
  const namedAfterTax = (/after/.test(label) && (/\btax\b/.test(label) || /\bgst\b/.test(label) || /final/.test(label) || /gross/.test(label)))
    || /final amount/.test(label) || /incl/.test(label)
  const namedBeforeDisc = /before/.test(label) && /discount/.test(label)
  const namedAfterDisc = /after/.test(label) && /discount/.test(label) && !namedAfterTax

  let discCols = []
  let taxCols = []
  if (namedBeforeDisc) {
    discCols = []
    taxCols = []
  } else if (namedBeforeTax) {
    discCols = discsAll
    taxCols = []
  } else if (namedAfterTax) {
    discCols = discsAll
    taxCols = taxesAll
  } else if (namedAfterDisc) {
    discCols = discsAll
    taxCols = []
  } else {
    // Canonical Amount should include every tax/discount on the row, even when
    // those columns sit after it (e.g. user reordered). Other amount-like
    // columns still only pick up what appears before them.
    const amountField = findFieldColumn(cols, 'amount')
    const isCanonicalAmount = amountField && col.id === amountField.id
    discCols = isCanonicalAmount ? discsAll : discsBefore
    taxCols = isCanonicalAmount ? taxesAll : taxesBefore
  }

  const tokens = [valueTokenFor(qty, cols), { type: 'op', op: '*' }, valueTokenFor(rate, cols)]
  for (const d of discCols) tokens.push({ type: 'op', op: '-' }, valueTokenFor(d, cols))
  for (const t of taxCols) tokens.push({ type: 'op', op: '+' }, valueTokenFor(t, cols))
  if (looksLikeRateColumn(col) && discCols.length) tokens.push({ type: 'op', op: '/' }, valueTokenFor(qty, cols))
  return tokens.filter(Boolean)
}

export function formulaOperandOptions(columns = [], forColId = '') {
  const cols = columns || []
  const options = []
  const seen = new Set()
  const push = (option) => {
    if (!option?.key || seen.has(option.key)) return
    seen.add(option.key)
    options.push(option)
  }
  const qty = findFieldColumn(cols, 'quantity')
  const rate = findFieldColumn(cols, 'rate')
  const amount = findFieldColumn(cols, 'amount')
  if (qty && qty.id !== forColId) push({ key: 'field:quantity', label: qty.label || 'Quantity', token: { type: 'field', field: 'quantity' } })
  if (rate && rate.id !== forColId) push({ key: 'field:rate', label: rate.label || 'Rate', token: { type: 'field', field: 'rate' } })
  if (amount && amount.id !== forColId) push({ key: 'field:amount', label: amount.label || 'Amount', token: { type: 'field', field: 'amount' } })
  for (const col of cols) {
    if (!col || col.id === forColId) continue
    if (isImageColumn(col) || isAttachmentColumn(col)) continue
    if (qty && col.id === qty.id) continue
    if (rate && col.id === rate.id) continue
    if (amount && col.id === amount.id) continue
    if (isNestedColumn(col) || columnType(col) === 'tax' || columnType(col) === 'discount') {
      push({ key: `col:${col.id}:amount`, label: col.label, token: { type: 'col', colId: col.id, part: 'amount' } })
      continue
    }
    push({ key: `col:${col.id}:value`, label: col.label, token: { type: 'col', colId: col.id, part: 'value' } })
  }
  return options
}

export function tokenOperandKey(token) {
  if (!token) return ''
  if (token.type === 'field') return `field:${token.field}`
  if (token.type === 'col') return `col:${token.colId}:${token.part || 'value'}`
  if (token.type === 'number') return `number:${token.value}`
  return ''
}

function expandStageToken(token, columns) {
  if (!token || token.type !== 'stage') return [token]
  if (token.stage === 'list') {
    return [
      { type: 'field', field: 'quantity' },
      { type: 'op', op: '*' },
      { type: 'field', field: 'rate' }
    ]
  }
  if (token.stage === 'taxable') {
    return defaultFormulaTokens({ id: '__tmp', label: 'Amount after discount' }, [...columns, { id: '__tmp', label: 'Amount after discount' }])
  }
  if (token.stage === 'gross') {
    return defaultFormulaTokens({ id: '__tmp', label: 'Amount after tax' }, [...columns, { id: '__tmp', label: 'Amount after tax' }])
  }
  if (token.stage === 'discountTotal') {
    const d = (columns || []).find(c => columnType(c) === 'discount')
    return d ? [valueTokenFor(d, columns)] : [token]
  }
  if (token.stage === 'taxTotal') {
    const t = (columns || []).find(c => columnType(c) === 'tax')
    return t ? [valueTokenFor(t, columns)] : [token]
  }
  return [token]
}

export function tokensToChain(tokens, columns = []) {
  const flat = []
  for (const token of tokens || []) {
    if (token?.type === 'paren') {
      flat.push(token)
      continue
    }
    flat.push(...expandStageToken(token, columns).filter(Boolean))
  }
  const chain = []
  for (const token of flat) {
    if (token.type === 'paren') {
      chain.push({ kind: 'paren', paren: token.paren })
      continue
    }
    if (token.type === 'op') {
      if (chain.length && (chain[chain.length - 1].kind === 'value' || chain[chain.length - 1].kind === 'paren')) {
        chain.push({ kind: 'op', op: token.op })
      }
      continue
    }
    if (token.type === 'pctOf') {
      if (chain.length && chain[chain.length - 1].kind === 'value') chain.push({ kind: 'op', op: 'pctOf' })
      continue
    }
    chain.push({ kind: 'value', key: tokenOperandKey(token), number: token.type === 'number' ? token.value : undefined })
  }
  while (chain.length && chain[chain.length - 1].kind === 'op') chain.pop()
  if (!chain.length) {
    return [
      { kind: 'value', key: '' },
      { kind: 'op', op: '*' },
      { kind: 'value', key: '' }
    ]
  }
  if (chain.length === 1 && chain[0].kind === 'value') {
    chain.push({ kind: 'op', op: '*' }, { kind: 'value', key: '' })
  }
  return chain
}

export function chainToTokens(chain, options = []) {
  const byKey = new Map((options || []).map(o => [o.key, o.token]))
  const tokens = []
  for (const item of chain || []) {
    if (!item) continue
    if (item.kind === 'paren' && (item.paren === '(' || item.paren === ')')) {
      tokens.push({ type: 'paren', paren: item.paren })
      continue
    }
    if (item.kind === 'op') {
      if (!tokens.length) continue
      if (item.op === 'pctOf') tokens.push({ type: 'pctOf' })
      else if (['+', '-', '*', '/'].includes(item.op)) tokens.push({ type: 'op', op: item.op })
      continue
    }
    if (item.key === 'number' || String(item.key || '').startsWith('number:')) {
      const n = item.number ?? Number(String(item.key).slice(7))
      if (Number.isFinite(n)) tokens.push({ type: 'number', value: n })
      continue
    }
    const token = byKey.get(item.key)
    if (token) tokens.push(token)
  }
  while (tokens.length && (tokens[tokens.length - 1].type === 'op' || tokens[tokens.length - 1].type === 'pctOf')) tokens.pop()
  return tokens
}

export function formulaSentence(tokens, columns = []) {
  const parts = (tokens || []).map(token => tokenLabel(token, columns)).filter(Boolean)
  return parts.length ? parts.join(' ') : ''
}

/** Typeable expression string from tokens (uses × ÷ − for display). */
export function formulaExpression(tokens, columns = []) {
  return formulaSentence(tokens, columns)
}

function tokenLabel(token, columns) {
  if (!token) return ''
  if (token.type === 'paren') return token.paren
  if (token.type === 'op') return token.op === '*' ? '×' : token.op === '/' ? '÷' : token.op === '-' ? '−' : '+'
  if (token.type === 'pctOf') return '% of'
  if (token.type === 'number') return String(token.value)
  if (token.type === 'field') {
    if (token.field === 'quantity') return 'Quantity'
    if (token.field === 'rate') return 'Rate'
    return 'Amount'
  }
  if (token.type === 'stage') {
    if (token.stage === 'list') return 'Qty × Rate'
    if (token.stage === 'taxable') return 'Amount after discount'
    if (token.stage === 'gross') return 'Amount after tax'
    if (token.stage === 'discountTotal') return 'Discount ₹'
    if (token.stage === 'taxTotal') return 'Tax ₹'
  }
  if (token.type === 'col') {
    const col = (columns || []).find(c => c.id === token.colId)
    const name = col?.label || 'Column'
    if (token.part === 'percent') return `${name} %`
    if (token.part === 'amount') return `${name} ₹`
    return name
  }
  return ''
}

export function formulaChipSources(columns, forColId) {
  const cols = columns || []
  const hasTax = cols.some(c => columnType(c) === 'tax')
  const hasDisc = cols.some(c => columnType(c) === 'discount')
  const chips = [
    { type: 'stage', stage: 'list', label: 'Qty × Rate' },
    { type: 'field', field: 'quantity', label: 'Quantity' },
    { type: 'field', field: 'rate', label: 'Rate' },
    { type: 'field', field: 'amount', label: 'Amount' }
  ]
  if (hasDisc) {
    chips.push({ type: 'stage', stage: 'taxable', label: 'After discount' })
    chips.push({ type: 'stage', stage: 'discountTotal', label: 'Discount ₹' })
  }
  if (hasTax) {
    chips.push({ type: 'stage', stage: 'gross', label: 'After tax' })
    chips.push({ type: 'stage', stage: 'taxTotal', label: 'Tax ₹' })
  }
  for (const col of cols) {
    if (!col || col.id === forColId) continue
    if (isImageColumn(col) || isAttachmentColumn(col) || columnType(col) === 'hsn') continue
    if (isNestedColumn(col) || columnType(col) === 'tax' || columnType(col) === 'discount') {
      chips.push({ type: 'col', colId: col.id, part: 'percent', label: `${col.label} %` })
      chips.push({ type: 'col', colId: col.id, part: 'amount', label: `${col.label} ₹` })
      continue
    }
    const qty = findFieldColumn(cols, 'quantity')
    const rate = findFieldColumn(cols, 'rate')
    const amount = findFieldColumn(cols, 'amount')
    if (qty && col.id === qty.id) continue
    if (rate && col.id === rate.id) continue
    if (amount && col.id === amount.id) continue
    chips.push({ type: 'col', colId: col.id, part: 'value', label: col.label })
  }
  return chips
}

function resolveTokenValue(token, ctx) {
  if (token.type === 'number') return token.value
  if (token.type === 'field') {
    if (token.field === 'quantity') return ctx.quantity
    if (token.field === 'rate') return ctx.rate
    return ctx.amount
  }
  if (token.type === 'stage') return ctx[token.stage]
  if (token.type === 'col') {
    const col = (ctx.columns || []).find(c => c.id === token.colId)
    if (!col) return null
    if (token.part === 'percent') {
      if (isNestedColumn(col) || columnType(col) === 'tax' || columnType(col) === 'discount') {
        return toNumber(ctx.item?.[rateKey(col)]) ?? toNumber(ctx.item?.[col.id])
      }
      return toNumber(ctx.item?.[col.id])
    }
    if (token.part === 'amount') {
      if (isNestedColumn(col) || columnType(col) === 'tax' || columnType(col) === 'discount') {
        const percentBase = columnType(col) === 'tax' ? ctx.taxable : ctx.list
        return columnMoneyAmount(ctx.item, col, percentBase)
      }
      return toNumber(ctx.item?.[col.id])
    }
    return toNumber(ctx.item?.[col.id])
  }
  return null
}

export function evaluateTokens(tokens, ctx) {
  const list = Array.isArray(tokens) ? tokens : []
  if (!list.length) return null
  const flattened = flattenParenGroups(list, ctx)
  if (!flattened) return null
  return evaluateFlatTokens(flattened, ctx)
}

/** Resolve `( … )` groups first; inside each group use the same left-to-right rules. */
function flattenParenGroups(tokens, ctx) {
  const out = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (token?.type === 'paren' && token.paren === '(') {
      let depth = 1
      let j = i + 1
      while (j < tokens.length && depth > 0) {
        if (tokens[j]?.type === 'paren' && tokens[j].paren === '(') depth += 1
        else if (tokens[j]?.type === 'paren' && tokens[j].paren === ')') depth -= 1
        j += 1
      }
      if (depth !== 0) return null
      const inner = tokens.slice(i + 1, j - 1)
      const value = evaluateTokens(inner, ctx)
      if (value == null || !Number.isFinite(value)) return null
      out.push({ type: 'number', value })
      i = j
      continue
    }
    if (token?.type === 'paren' && token.paren === ')') return null
    out.push(token)
    i += 1
  }
  return out
}

function evaluateFlatTokens(list, ctx) {
  let acc = null
  let pendingOp = null
  let pendingPctOf = false

  const apply = (value) => {
    if (value == null || !Number.isFinite(value)) return false
    if (acc == null) {
      if (pendingOp || pendingPctOf) return false
      acc = value
      return true
    }
    if (pendingPctOf) {
      acc = acc * value / 100
      pendingPctOf = false
      pendingOp = null
      return Number.isFinite(acc)
    }
    if (!pendingOp) return false
    if (pendingOp === '+') acc = acc + value
    else if (pendingOp === '-') acc = acc - value
    else if (pendingOp === '*') acc = acc * value
    else if (pendingOp === '/') {
      if (value === 0) return false
      acc = acc / value
    }
    pendingOp = null
    return Number.isFinite(acc)
  }

  for (const token of list) {
    if (token.type === 'op') {
      if (acc == null) return null
      pendingOp = token.op
      continue
    }
    if (token.type === 'pctOf') {
      if (acc == null) return null
      pendingPctOf = true
      continue
    }
    if (!apply(resolveTokenValue(token, ctx))) return null
  }
  if (pendingOp || pendingPctOf || acc == null || !Number.isFinite(acc)) return null
  return acc
}

function formulaContext(item, columns) {
  const totals = computeRowTotals(item, columns)
  const qtyCol = findFieldColumn(columns, 'quantity')
  const rateCol = findFieldColumn(columns, 'rate')
  const amountCol = findFieldColumn(columns, 'amount')
  const quantity = qtyCol ? toNumber(item?.[qtyCol.id]) : null
  const rate = rateCol ? toNumber(item?.[rateCol.id]) : null
  const amount = amountCol ? toNumber(item?.[amountCol.id]) : null
  const list = resolveRowBase(item, columns)
  const hasLine = list != null
  return {
    item,
    columns,
    quantity,
    rate,
    amount: amount ?? (hasLine ? totals.base : null),
    list,
    taxable: hasLine ? totals.taxable : null,
    gross: hasLine ? totals.total : null,
    discountTotal: hasLine ? totals.discount : null,
    taxTotal: hasLine ? totals.tax : null
  }
}

export function evaluateColumnFormula(col, item, columns) {
  const formula = normalizeFormula(col?.formula)
  if (!formula) return null
  return evaluateTokens(formula.tokens, formulaContext(item, columns))
}

function isRateFormula(col) {
  const preset = normalizeFormula(col?.formula)?.preset
  if (preset && String(preset).startsWith('rate_')) return true
  const label = String(col?.label || '')
  return /\brate\b/i.test(label) && !/\bamount\b/i.test(label)
}

export function formulaSource(item, col, columns) {
  if (!isFormulaColumn(col)) return AMOUNT_MANUAL
  const marked = item?.[sourceKey(col)]
  if (marked === AMOUNT_MANUAL || marked === AMOUNT_AUTO) return marked
  const current = String(item?.[col.id] ?? '').trim()
  if (!current) return AMOUNT_AUTO
  const computedRaw = evaluateColumnFormula(col, item, columns)
  if (computedRaw == null) return AMOUNT_MANUAL
  const computed = isRateFormula(col) ? formatRate(computedRaw) : formatAmount(computedRaw)
  return toNumber(current) === toNumber(computed) ? AMOUNT_AUTO : AMOUNT_MANUAL
}

export function formulaCellState(item, columns, col) {
  if (!isFormulaColumn(col)) return null
  const computedRaw = evaluateColumnFormula(col, item, columns)
  const computed = computedRaw == null ? null : (isRateFormula(col) ? formatRate(computedRaw) : formatAmount(computedRaw))
  const manual = formulaSource(item, col, columns) === AMOUNT_MANUAL
  return {
    manual,
    computed,
    overridden: manual && computed != null && toNumber(item?.[col.id]) !== toNumber(computed)
  }
}

export function formulaEditPatch(item, columns, key, value) {
  const col = (columns || []).find(c => c.id === key)
  if (!isFormulaColumn(col)) return null
  const src = String(value ?? '').trim() ? AMOUNT_MANUAL : AMOUNT_AUTO
  return { [sourceKey(col)]: src }
}

export function applyFormulaColumns(item, columns, editingKey = null, skipIds = null) {
  const cols = columns || []
  if (!cols.some(isFormulaColumn)) return item
  const next = { ...(item || {}) }
  for (const col of cols) {
    if (!isFormulaColumn(col)) continue
    if (skipIds && skipIds.has(col.id)) continue
    if (col.id === editingKey) continue
    if (formulaSource(next, col, cols) === AMOUNT_MANUAL) continue
    const computedRaw = evaluateColumnFormula(col, next, cols)
    const nextValue = computedRaw == null ? '' : (isRateFormula(col) ? formatRate(computedRaw) : formatAmount(computedRaw))
    const current = String(next[col.id] ?? '')
    if (current === nextValue && next[sourceKey(col)] === AMOUNT_AUTO) continue
    next[col.id] = nextValue
    if (computedRaw != null) next[sourceKey(col)] = AMOUNT_AUTO
  }
  return next
}

export function clearFormulaOverride(item, col, columns) {
  if (!isFormulaColumn(col)) return item
  return applyFormulaColumns({ ...(item || {}), [sourceKey(col)]: AMOUNT_AUTO }, columns)
}
