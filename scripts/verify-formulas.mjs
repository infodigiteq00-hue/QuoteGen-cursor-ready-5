/**
 * Custom column formulas — shortcuts and click-built tokens.
 * Run: node scripts/verify-formulas.mjs
 */
import assert from 'node:assert/strict'
import {
  aiFillableColumns,
  amountKey,
  normalizeColumnList,
  rateKey,
  recalcRow,
  sourceKey
} from '../shared/quoteColumns.js'
import {
  FORMULA_PRESETS,
  applyFormulaColumns,
  canHaveFormula,
  chainToTokens,
  clearFormulaOverride,
  defaultFormulaTokens,
  evaluateTokens,
  formulaEditPatch,
  formulaOperandOptions,
  formulaSentence,
  inferFormulaPreset,
  isFormulaColumn,
  normalizeFormula,
  parsePlainFormula,
  presetsForTable,
  tokensForPreset,
  tokensToChain
} from '../shared/quoteFormulas.js'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok   ${name}`)
  } catch (error) {
    fail++
    failures.push({ name, error })
    console.log(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`)
  }
}

function group(title) {
  console.log(`\n${title}`)
}

const disc = { id: 'disc', label: 'Discount', type: 'discount' }
const gst = { id: 'gst', label: 'GST', type: 'tax' }
const cols = [
  { id: 'description', label: 'Description', type: 'text' },
  { id: 'quantity', label: 'Quantity', type: 'text' },
  { id: 'rate', label: 'Rate', type: 'text' },
  { id: 'amount', label: 'Amount', type: 'text' },
  disc,
  gst
]

function withFormula(id, label, presetOrTokens) {
  const formula = typeof presetOrTokens === 'string'
    ? normalizeFormula({ preset: presetOrTokens, tokens: tokensForPreset(presetOrTokens) })
    : normalizeFormula({ tokens: presetOrTokens })
  return { id, label, type: 'text', formula }
}

function rowWith(formulaCols, itemExtra = {}) {
  const table = [...cols, ...formulaCols]
  return recalcRow({
    quantity: '2',
    rate: '100',
    [rateKey(disc)]: '10',
    [sourceKey(disc)]: 'rate',
    [rateKey(gst)]: '18',
    [sourceKey(gst)]: 'rate',
    ...itemExtra
  }, table)
}

group('Title shortcuts')

test('Amount before tax', () => {
  assert.equal(inferFormulaPreset('Amount before tax'), 'before_tax')
})

test('Amount after discount', () => {
  assert.equal(inferFormulaPreset('Amount after discount'), 'after_discount')
})

test('Amount after tax / final amount', () => {
  assert.equal(inferFormulaPreset('Amount after tax'), 'after_tax')
  assert.equal(inferFormulaPreset('Final amount'), 'after_tax')
})

test('Rate after discount stays a rate shortcut', () => {
  assert.equal(inferFormulaPreset('Rate after discount'), 'rate_after_discount')
})

test('name wins over a vague Amount sitting after tax', () => {
  assert.equal(inferFormulaPreset('Amount before tax', [...cols, { id: 'x', label: 'Amount before tax' }], 6), 'before_tax')
})

group('Shortcut maths (qty 2 × rate 100, 10% discount, 18% tax)')

test('built-in Amount is still Quantity × Rate', () => {
  const beforeTax = withFormula('before_tax', 'Amount before tax', 'before_tax')
  const row = rowWith([beforeTax])
  assert.equal(row.amount, '200.00')
  assert.equal(row[amountKey(disc)], '20.00')
  assert.equal(row[amountKey(gst)], '32.40')
})

test('before tax / after discount = 180.00', () => {
  const beforeTax = withFormula('before_tax', 'Amount before tax', 'before_tax')
  const afterDisc = withFormula('after_disc', 'Amount after discount', 'after_discount')
  const row = rowWith([beforeTax, afterDisc])
  assert.equal(row.before_tax, '180.00')
  assert.equal(row.after_disc, '180.00')
})

test('after tax = 212.40', () => {
  const afterTax = withFormula('after_tax', 'Amount after tax', 'after_tax')
  const row = rowWith([afterTax])
  assert.equal(row.after_tax, '212.40')
})

test('rate after discount = 90 (per piece, not a line total)', () => {
  const rad = withFormula('rad', 'Rate after discount', 'rate_after_discount')
  const row = rowWith([rad])
  assert.equal(row.rad, '90')
})

group('Click-built formulas')

test('Quantity × Rate', () => {
  const col = withFormula('list', 'List', [
    { type: 'field', field: 'quantity' },
    { type: 'op', op: '*' },
    { type: 'field', field: 'rate' }
  ])
  const row = rowWith([col])
  assert.equal(row.list, '200.00')
  assert.equal(formulaSentence(col.formula.tokens, cols), 'Quantity × Rate')
})

test('Amount % of 18', () => {
  const col = withFormula('gst18', 'GST 18', [
    { type: 'field', field: 'amount' },
    { type: 'pctOf' },
    { type: 'number', value: 18 }
  ])
  const row = rowWith([col])
  assert.equal(row.gst18, '36.00')
  assert.equal(formulaSentence(col.formula.tokens, cols), 'Amount % of 18')
})

test('mix of columns: Quantity × Rate − Discount ₹', () => {
  const col = withFormula('mix', 'Net', [
    { type: 'field', field: 'quantity' },
    { type: 'op', op: '*' },
    { type: 'field', field: 'rate' },
    { type: 'op', op: '-' },
    { type: 'stage', stage: 'discountTotal' }
  ])
  const row = rowWith([col])
  assert.equal(row.mix, '180.00')
})

test('GST % chip × Amount / 100 matches GST ₹', () => {
  const col = withFormula('frompct', 'From %', [
    { type: 'col', colId: 'gst', part: 'percent' },
    { type: 'op', op: '*' },
    { type: 'field', field: 'amount' },
    { type: 'op', op: '/' },
    { type: 'number', value: 100 }
  ])
  const row = rowWith([col])
  assert.equal(row.frompct, '36.00')
})

test('later formula column can read an earlier formula column', () => {
  const gstAmt = withFormula('gstamt', 'GST amount', [
    { type: 'stage', stage: 'taxable' },
    { type: 'pctOf' },
    { type: 'number', value: 18 }
  ])
  const final = withFormula('final', 'Line total', [
    { type: 'stage', stage: 'taxable' },
    { type: 'op', op: '+' },
    { type: 'col', colId: 'gstamt', part: 'value' }
  ])
  const row = rowWith([gstAmt, final])
  assert.equal(row.gstamt, '32.40')
  assert.equal(row.final, '212.40')
})

test('empty inputs stay blank, never NaN', () => {
  const col = withFormula('list', 'List', 'list_amount')
  const table = [...cols, col]
  const row = recalcRow({ quantity: '', rate: '' }, table)
  assert.equal(row.list, '')
  assert.equal(String(row.list).toLowerCase().includes('nan'), false)
})

test('typing a formula cell overrides; clear returns to the formula', () => {
  const col = withFormula('before_tax', 'Amount before tax', 'before_tax')
  const table = [...cols, col]
  let row = rowWith([col])
  assert.equal(row.before_tax, '180.00')
  const typed = { ...row, before_tax: '999', ...formulaEditPatch({ ...row, before_tax: '999' }, table, 'before_tax', '999') }
  row = recalcRow(typed, table, { editingKey: 'before_tax' })
  assert.equal(row.before_tax, '999')
  row = recalcRow(row, table)
  assert.equal(row.before_tax, '999', 'override is not clobbered')
  row = clearFormulaOverride(row, col, table)
  assert.equal(row.before_tax, '180.00')
})

group('Safety / persistence')

test('Quantity, Rate, Amount and Description can host a formula; images and nested tax cannot', () => {
  assert.equal(canHaveFormula({ id: 'description', label: 'Description', type: 'text' }, cols), true)
  assert.equal(canHaveFormula({ id: 'quantity', label: 'Quantity', type: 'text' }, cols), true)
  assert.equal(canHaveFormula({ id: 'rate', label: 'Rate', type: 'text' }, cols), true)
  assert.equal(canHaveFormula({ id: 'amount', label: 'Amount', type: 'text' }, cols), true)
  assert.equal(canHaveFormula({ id: 'before_tax', label: 'Amount before tax', type: 'text' }, cols), true)
  assert.equal(canHaveFormula({ id: 'photo', label: 'Image', type: 'image' }, cols), false)
  assert.equal(canHaveFormula({ id: 'photo', label: 'Image', type: 'text' }, cols), false)
  assert.equal(canHaveFormula(gst, cols), false)
})

test('AI fill skips formula columns', () => {
  const col = withFormula('before_tax', 'Amount before tax', 'before_tax')
  const ids = aiFillableColumns([...cols, col]).map(c => c.id)
  assert.equal(ids.includes('before_tax'), false)
  assert.equal(ids.includes('description'), true)
})

test('normalizeColumnList keeps the formula on the column', () => {
  const col = withFormula('before_tax', 'Amount before tax', 'before_tax')
  const saved = normalizeColumnList([...cols, col])
  const found = saved.find(c => c.id === 'before_tax')
  assert.ok(found.formula)
  assert.equal(found.formula.preset, 'before_tax')
  assert.ok(isFormulaColumn(found))
})

test('shortcut cards hide tax/discount presets when those columns are missing', () => {
  const ids = presetsForTable([
    { id: 'description', label: 'Description', type: 'text' },
    { id: 'quantity', label: 'Quantity', type: 'text' },
    { id: 'rate', label: 'Rate', type: 'text' },
    { id: 'amount', label: 'Amount', type: 'text' }
  ]).map(p => p.id)
  assert.deepEqual(ids, ['list_amount'])
  assert.equal(FORMULA_PRESETS.length > ids.length, true)
})

test('plain English Quantity × Rate becomes the usual Amount shortcut', () => {
  assert.deepEqual(parsePlainFormula('Quantity × Rate', cols), [{ type: 'stage', stage: 'list' }])
  assert.deepEqual(parsePlainFormula('= Quantity * Rate', cols), [{ type: 'stage', stage: 'list' }])
  assert.deepEqual(parsePlainFormula('qty * rate', cols), [{ type: 'stage', stage: 'list' }])
})

test('typed 18 % of Amount is Quantity-style percent of', () => {
  assert.deepEqual(parsePlainFormula('18 % of Amount', cols), [
    { type: 'number', value: 18 },
    { type: 'pctOf' },
    { type: 'field', field: 'amount' }
  ])
})

test('evaluateTokens is left-to-right (no hidden precedence)', () => {
  const value = evaluateTokens([
    { type: 'number', value: 10 },
    { type: 'op', op: '+' },
    { type: 'number', value: 2 },
    { type: 'op', op: '*' },
    { type: 'number', value: 3 }
  ], {})
  assert.equal(value, 36)
})

test('applyFormulaColumns is a no-op when nothing is a formula column', () => {
  const item = { quantity: '2', rate: '100', amount: '200.00' }
  assert.equal(applyFormulaColumns(item, cols), item)
})

group('Amount defaults from columns before it')

test('plain Amount before discount/tax is Quantity × Rate', () => {
  assert.deepEqual(defaultFormulaTokens({ id: 'amount', label: 'Amount' }, cols), [
    { type: 'field', field: 'quantity' },
    { type: 'op', op: '*' },
    { type: 'field', field: 'rate' }
  ])
})

test('Amount after tax sitting last is qty × rate − discount + tax', () => {
  const after = { id: 'after', label: 'Amount after tax' }
  const table = [...cols, after]
  assert.deepEqual(defaultFormulaTokens(after, table), [
    { type: 'field', field: 'quantity' },
    { type: 'op', op: '*' },
    { type: 'field', field: 'rate' },
    { type: 'op', op: '-' },
    { type: 'col', colId: 'disc', part: 'amount' },
    { type: 'op', op: '+' },
    { type: 'col', colId: 'gst', part: 'amount' }
  ])
})

test('Amount before tax keeps discount and drops tax', () => {
  const before = { id: 'before', label: 'Amount before tax' }
  const table = [...cols, before]
  assert.deepEqual(defaultFormulaTokens(before, table), [
    { type: 'field', field: 'quantity' },
    { type: 'op', op: '*' },
    { type: 'field', field: 'rate' },
    { type: 'op', op: '-' },
    { type: 'col', colId: 'disc', part: 'amount' }
  ])
})

test('Final amount with discount uses the same after-tax shape', () => {
  const final = { id: 'final', label: 'Final amount' }
  const table = [...cols, final]
  const tokens = defaultFormulaTokens(final, table)
  assert.equal(tokens.some(t => t.colId === 'disc'), true)
  assert.equal(tokens.some(t => t.colId === 'gst'), true)
})

test('Description does not get an Amount default', () => {
  assert.deepEqual(defaultFormulaTokens({ id: 'description', label: 'Description' }, cols), [])
})

test('builder chain round-trips Quantity × Rate − Discount', () => {
  const tokens = [
    { type: 'field', field: 'quantity' },
    { type: 'op', op: '*' },
    { type: 'field', field: 'rate' },
    { type: 'op', op: '-' },
    { type: 'col', colId: 'disc', part: 'amount' }
  ]
  const options = formulaOperandOptions(cols, 'net')
  const chain = tokensToChain(tokens, cols)
  assert.deepEqual(chainToTokens(chain, options), tokens)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  for (const item of failures) console.error(`\n${item.name}\n${item.error.stack}`)
  process.exit(1)
}
