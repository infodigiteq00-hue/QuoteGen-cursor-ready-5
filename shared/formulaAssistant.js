/**
 * Formula assistant: turn a plain-English ask into a verified token formula.
 *
 * Local matching is the source of truth (same engine as Amount before/after tax).
 * Ambiguous asks return choices for the user to confirm before tokens are applied.
 */
import { columnType, findFieldColumn } from './quoteColumns.js'
import {
  defaultFormulaTokens,
  formulaSentence,
  inferFormulaPreset,
  normalizeFormula,
  parsePlainFormula,
  tokensForPreset
} from './quoteFormulas.js'

export function analyzeFormulaTable(columns = [], forColId = '') {
  const cols = (columns || []).filter(Boolean)
  return {
    quantity: findFieldColumn(cols, 'quantity'),
    rate: findFieldColumn(cols, 'rate'),
    amount: findFieldColumn(cols, 'amount'),
    discount: cols.filter(c => c.id !== forColId && columnType(c) === 'discount'),
    tax: cols.filter(c => c.id !== forColId && columnType(c) === 'tax'),
    labels: cols.map(c => c.label).filter(Boolean)
  }
}

function names(cols) {
  return (cols || []).map(c => c.label).filter(Boolean)
}

function proposal({ status, title, steps, tokens, columns, choices = null, missing = [], preset = null }) {
  const formula = tokens?.length || preset
    ? normalizeFormula({ tokens: tokens || [], preset })
    : null
  const ready = status || (choices?.length ? 'need_choice' : (formula ? 'ready' : 'unrecognized'))
  return {
    status: ready,
    title: title || '',
    steps: Array.isArray(steps) ? steps.filter(Boolean) : [],
    formula: ready === 'ready' ? formula : null,
    sentence: formula ? formulaSentence(formula.tokens, columns) : '',
    choices: choices?.length ? choices : null,
    missing
  }
}

function choice(id, label, tokens, columns, steps) {
  const formula = normalizeFormula({ tokens })
  return {
    id,
    label,
    steps: steps || [],
    formula,
    sentence: formula ? formulaSentence(formula.tokens, columns) : ''
  }
}

function stepsForPreset(preset, table) {
  if (preset === 'list_amount') return ['Take Quantity', 'Multiply by Rate']
  if (preset === 'before_tax' || preset === 'after_discount') {
    const steps = ['Take Quantity × Rate']
    if (table.discount.length) {
      steps.push(`Subtract ${names(table.discount).join(' + ')} (a % is converted to rupees first)`)
    } else {
      steps.push('No discount column, so this equals Quantity × Rate')
    }
    return steps
  }
  if (preset === 'after_tax') {
    const steps = ['Take Amount before tax (Quantity × Rate minus any discount)']
    if (table.tax.length) {
      steps.push(`Apply ${names(table.tax).join(' + ')} as Amount before tax × (100 + tax %) / 100`)
    } else {
      steps.push('No tax column, so this equals Amount before tax')
    }
    return steps
  }
  if (preset === 'rate_after_discount') {
    return ['Take Amount before tax', 'Divide by Quantity to get the per-piece rate']
  }
  return []
}

function fromPreset(preset, columns, title) {
  const table = analyzeFormulaTable(columns)
  const tokens = tokensForPreset(preset)
  if (!tokens.length) return null
  return proposal({
    status: 'ready',
    title: title || '',
    steps: stepsForPreset(preset, table),
    tokens,
    preset,
    columns
  })
}

function fromPlainTokens(tokens, columns, table) {
  const formula = normalizeFormula({ tokens })
  if (!formula) return null
  const sentence = formulaSentence(formula.tokens, columns)
  const steps = ['Using the columns on this table', sentence]
  if (!table.tax.length && /tax|gst/i.test(sentence)) {
    steps.push('No tax column, so tax is not added on the row')
  }
  return proposal({
    status: 'ready',
    title: 'Custom formula',
    steps,
    tokens: formula.tokens,
    columns
  })
}

/**
 * Suggest a formula from an ask (and the column's name as a fallback).
 * Returns { status: 'ready' | 'need_choice' | 'unrecognized', steps, formula, choices }.
 */
export function suggestFormulaFromAsk(ask, col, columns = []) {
  const table = analyzeFormulaTable(columns, col?.id)
  const text = String(ask || '').trim()
  const label = String(col?.label || '').trim()
  const source = text || label

  if (!source) {
    const guessed = defaultFormulaTokens(col, columns)
    if (guessed.length) {
      return proposal({
        status: 'ready',
        title: 'From this table',
        steps: ['Quantity × Rate, then minus discount and plus tax when those columns sit before this one'],
        tokens: guessed,
        columns
      })
    }
    return proposal({ status: 'unrecognized', title: '', steps: [], columns, missing: table.labels })
  }

  const lower = source.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim()
  const mentionsTax = /\btax\b|\bgst\b|\bcgst\b|\bsgst\b|\bigst\b/.test(lower)
  const mentionsDisc = /discount/.test(lower)
  const mentionsFinal = /final|gross|incl/.test(lower)
  const vagueTax = mentionsTax && !/before/.test(lower) && !/after/.test(lower) && !mentionsFinal && !/pre tax|pretax|excl/.test(lower)

  if (vagueTax) {
    return proposal({
      status: 'need_choice',
      title: 'Which tax step?',
      steps: [
        `Columns on this table: ${table.labels.join(', ') || 'none'}`,
        table.tax.length
          ? `Tax columns: ${names(table.tax).join(', ')}`
          : 'There is no tax column. After tax would equal Amount before tax.'
      ],
      columns,
      choices: [
        choice('before_tax', 'Amount before tax (after discount)', tokensForPreset('before_tax'), columns, stepsForPreset('before_tax', table)),
        choice('after_tax', 'Amount after tax (final amount)', tokensForPreset('after_tax'), columns, stepsForPreset('after_tax', table))
      ]
    })
  }

  const preset = inferFormulaPreset(source, columns, (columns || []).findIndex(c => c?.id === col?.id))
    || inferFormulaPreset(label, columns)
  if (preset && !/[%*+\-/]/.test(text)) {
    const next = fromPreset(preset, columns, preset === 'after_tax' ? 'Amount after tax' : preset === 'before_tax' ? 'Amount before tax' : '')
    if (next?.formula) return next
  }

  const parsed = parsePlainFormula(text || source, columns, col?.id)
  if (parsed.length) {
    const fromParsed = fromPlainTokens(parsed, columns, table)
    if (fromParsed?.formula) return fromParsed
  }

  if (mentionsDisc && !mentionsTax) {
    return fromPreset('after_discount', columns, 'After discount')
  }
  if (table.quantity && table.rate && /quantity|qty|rate|amount/.test(lower)) {
    return fromPreset('list_amount', columns, 'Quantity × Rate')
  }

  const guessed = defaultFormulaTokens(col, columns)
  if (guessed.length && !text) {
    return proposal({
      status: 'ready',
      title: 'From this column name',
      steps: ['Quantity × Rate, then minus discount and plus tax when those belong in this cell'],
      tokens: guessed,
      columns
    })
  }

  return proposal({
    status: 'unrecognized',
    title: '',
    steps: [
      table.labels.length ? `Known columns: ${table.labels.join(', ')}` : 'This table has no columns to calculate from yet.',
      'Try “Amount before tax”, “Final amount”, or “Quantity × Rate − Discount”.'
    ],
    columns,
    missing: table.labels
  })
}

function tokensAreUsable(tokens, columns = []) {
  const ids = new Set((columns || []).map(c => c && c.id).filter(Boolean))
  for (const token of tokens || []) {
    if (token.type === 'col' && !ids.has(token.colId)) return false
  }
  return (tokens || []).length > 0
}

/** Accept only tokens that survive normalizeFormula (never apply raw AI JSON). */
export function validateFormulaDraft(draft, col, columns = []) {
  const preset = String(draft?.preset || '').trim()
  const tokens = Array.isArray(draft?.tokens) ? draft.tokens : []
  const formula = normalizeFormula({ preset, tokens })
  if (formula && tokensAreUsable(formula.tokens, columns)) {
    const table = analyzeFormulaTable(columns, col?.id)
    return proposal({
      status: 'ready',
      title: String(draft?.title || 'Suggested formula').trim() || 'Suggested formula',
      steps: Array.isArray(draft?.steps) && draft.steps.length ? draft.steps.map(String) : stepsForPreset(formula.preset, table),
      tokens: formula.tokens,
      preset: formula.preset,
      columns
    })
  }
  const ask = String(draft?.ask || '').trim()
  if (ask) return suggestFormulaFromAsk(ask, col, columns)
  return proposal({
    status: 'unrecognized',
    title: '',
    steps: ['That formula did not match the columns on this table.'],
    columns
  })
}
