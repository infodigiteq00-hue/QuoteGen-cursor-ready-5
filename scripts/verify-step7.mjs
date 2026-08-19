/**
 * Step 7 verification harness — typed columns + tax/discount maths.
 * Run: node scripts/verify-step7.mjs
 */
import assert from 'node:assert/strict'
import {
  amountCellState,
  amountEditPatch,
  amountKey,
  amountSource,
  blankItemFor,
  clearAmountOverride,
  columnSpan,
  columnType,
  computeQuoteTotals,
  computeRowTotals,
  convertItemForType,
  findFieldColumn,
  moveColumnInList,
  normalizeColumnList,
  rateKey,
  recalcAllRows,
  recalcRow,
  rowBaseAmount,
  sourceKey,
  withColumnKeys,
  withoutColumnKeys
} from '../shared/quoteColumns.js'
import { cellValueForField, fillWordLineItems, mapHeaderToField } from '../shared/templateMap.js'

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

const baseCols = [
  { id: 'description', label: 'Description', type: 'text' },
  { id: 'quantity', label: 'Quantity', type: 'text' },
  { id: 'rate', label: 'Rate', type: 'text' },
  { id: 'amount', label: 'Amount', type: 'text' }
]
const cgst = { id: 'cgst', label: 'CGST', type: 'tax' }
const disc = { id: 'disc', label: 'Discount', type: 'discount' }
const taxCols = [...baseCols, cgst]
const bothCols = [...baseCols, disc, cgst]

// ---------------------------------------------------------------------------
group('Base resolution (fuzzy templateMap matching)')

test('amount column wins when filled', () => {
  assert.equal(rowBaseAmount({ amount: '1000' }, baseCols), 1000)
})

test('falls back to quantity x rate when amount is empty', () => {
  assert.equal(rowBaseAmount({ quantity: '4', rate: '250' }, baseCols), 1000)
})

test('fuzzy header names resolve (Qty / Unit Rate / Value)', () => {
  const fuzzy = [
    { id: 'c1', label: 'Qty', type: 'text' },
    { id: 'c2', label: 'Unit Rate', type: 'text' },
    { id: 'c3', label: 'Value', type: 'text' }
  ]
  assert.equal(mapHeaderToField('Qty', []), 'quantity')
  assert.equal(mapHeaderToField('Unit Rate', []), 'rate')
  assert.equal(mapHeaderToField('Value', []), 'amount')
  assert.equal(findFieldColumn(fuzzy, 'amount').id, 'c3')
  assert.equal(rowBaseAmount({ c3: '2500' }, fuzzy), 2500)
  assert.equal(rowBaseAmount({ c1: '3', c2: '100' }, fuzzy), 300)
})

test('empty base is 0, not NaN', () => {
  assert.equal(rowBaseAmount({}, baseCols), 0)
  assert.equal(rowBaseAmount({ quantity: '', rate: '' }, baseCols), 0)
  assert.equal(rowBaseAmount({ quantity: 'abc', rate: 'xyz' }, baseCols), 0)
})

test('currency-formatted values parse', () => {
  assert.equal(rowBaseAmount({ amount: '₹ 1,250.50' }, baseCols), 1250.5)
})

// ---------------------------------------------------------------------------
group('Amount = Quantity x Rate')

const amountCol = baseCols[3]
const amountSrc = sourceKey(amountCol)

/** One editor keystroke: mark the amount source the way updateItem does, then recalc. */
function typeInto(item, columns, key, value) {
  const next = { ...item, [key]: value, ...amountEditPatch({ ...item, [key]: value }, columns, key, value) }
  return recalcRow(next, columns, { editingKey: key })
}

test('quantity x rate fills the amount', () => {
  const row = recalcRow({ quantity: '4', rate: '250' }, baseCols)
  assert.equal(row.amount, '1000.00')
  assert.equal(row[amountSrc], 'auto')
})

test('changing quantity recomputes the amount', () => {
  let row = recalcRow({ quantity: '4', rate: '250' }, baseCols)
  row = typeInto(row, baseCols, 'quantity', '6')
  assert.equal(row.amount, '1500.00')
  assert.equal(row.quantity, '6', 'the field being typed must not be rewritten')
})

test('changing rate recomputes the amount', () => {
  let row = recalcRow({ quantity: '4', rate: '250' }, baseCols)
  row = typeInto(row, baseCols, 'rate', '300.5')
  assert.equal(row.amount, '1202.00')
  assert.equal(row.rate, '300.5')
})

test('fractions round to 2 decimals and repeated recalc does not drift', () => {
  let row = recalcRow({ quantity: '3', rate: '33.333' }, baseCols)
  assert.equal(row.amount, '100.00')
  for (let i = 0; i < 5; i++) row = recalcRow(row, baseCols)
  assert.equal(row.amount, '100.00')
})

test('typing an amount overrides the formula and is not clobbered', () => {
  let row = recalcRow({ quantity: '4', rate: '250' }, baseCols)
  row = typeInto(row, baseCols, 'amount', '1234')
  assert.equal(row.amount, '1234', 'the field being typed must not be rewritten')
  assert.equal(amountSource(row, baseCols), 'manual')
  // A later keystroke anywhere else must leave the override alone.
  row = typeInto(row, baseCols, 'description', 'Widget')
  assert.equal(row.amount, '1234')
})

test('an override survives a later quantity or rate change', () => {
  let row = typeInto(recalcRow({ quantity: '4', rate: '250' }, baseCols), baseCols, 'amount', '900')
  row = typeInto(row, baseCols, 'quantity', '10')
  assert.equal(row.amount, '900', 'the typed amount is not silently discarded')
  const state = amountCellState(row, baseCols, amountCol)
  assert.equal(state.overridden, true, 'the UI can show the amount is manual')
  assert.equal(state.computed, '2500.00', 'and offer the calculated value')
})

test('reverting an override returns to quantity x rate', () => {
  let row = typeInto(recalcRow({ quantity: '4', rate: '250' }, baseCols), baseCols, 'amount', '900')
  row = clearAmountOverride(row, baseCols)
  assert.equal(row.amount, '1000.00')
  assert.equal(amountCellState(row, baseCols, amountCol).overridden, false)
})

test('clearing the amount hands the cell back to the formula', () => {
  let row = typeInto(recalcRow({ quantity: '4', rate: '250' }, baseCols), baseCols, 'amount', '900')
  row = typeInto(row, baseCols, 'amount', '')
  assert.equal(row.amount, '', 'the cleared field is not refilled under the cursor')
  assert.equal(recalcRow(row, baseCols).amount, '1000.00', 'and recalculates on the next pass')
})

test('empty or non-numeric quantity/rate leaves the amount blank, not 0 or NaN', () => {
  const start = recalcRow({ quantity: '4', rate: '250' }, baseCols)
  for (const [key, value] of [['rate', ''], ['quantity', ''], ['rate', 'abc'], ['quantity', '-']]) {
    const row = typeInto(start, baseCols, key, value)
    assert.equal(row.amount, '', `${key}="${value}" should clear the amount`)
    assert.ok(!/NaN|Infinity/.test(String(row.amount)))
  }
  assert.equal(recalcRow({ quantity: '', rate: '' }, baseCols).amount, undefined)
})

test('zero quantity is a real 0.00, not a blank', () => {
  assert.equal(recalcRow({ quantity: '0', rate: '250' }, baseCols).amount, '0.00')
})

test('changing quantity cascades into discount, tax and the totals footer', () => {
  let row = recalcRow({
    quantity: '4', rate: '250',
    [rateKey(disc)]: '10', [sourceKey(disc)]: 'rate',
    [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate'
  }, bothCols)
  assert.equal(row.amount, '1000.00')
  assert.equal(row[amountKey(disc)], '100.00')
  assert.equal(row[amountKey(cgst)], '162.00')

  row = typeInto(row, bothCols, 'quantity', '8')
  assert.equal(row.amount, '2000.00')
  assert.equal(row[amountKey(disc)], '200.00', 'discount follows the new base')
  assert.equal(row[amountKey(cgst)], '324.00', '18% of the reduced 1800')

  const t = computeQuoteTotals([row], bothCols)
  assert.deepEqual(
    { sub: t.subtotal, disc: t.discountTotal, taxable: t.taxableTotal, tax: t.taxTotal, grand: t.grandTotal },
    { sub: 2000, disc: 200, taxable: 1800, tax: 324, grand: 2124 }
  )
})

test('an overridden amount is the base the taxes are charged on', () => {
  let row = recalcRow({ quantity: '4', rate: '250', [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' }, taxCols)
  row = typeInto(row, taxCols, 'amount', '500')
  assert.equal(row[amountKey(cgst)], '90.00')
  assert.equal(computeQuoteTotals([row], taxCols).grandTotal, 590)
})

test('AI-supplied amount that disagrees with qty x rate is kept, not overwritten', () => {
  const asGenerated = { description: 'Widget', quantity: '4', rate: '250', amount: '1500' }
  const [row] = recalcAllRows([asGenerated], baseCols)
  assert.equal(row.amount, '1500')
  assert.equal(amountSource(row, baseCols), 'manual', 'a deliberate figure reads as an override')
  assert.equal(amountCellState(row, baseCols, amountCol).computed, '1000.00')
})

test('AI-supplied amount that agrees is adopted as calculated', () => {
  const [row] = recalcAllRows([{ quantity: '4', rate: '250', amount: '1000' }], baseCols)
  assert.equal(row.amount, '1000.00')
  assert.equal(amountSource(row, baseCols), 'auto')
})

test('AI row with no amount gets one on load', () => {
  const [row] = recalcAllRows([{ description: 'Widget', quantity: '2.5', rate: '99.99' }], baseCols)
  assert.equal(row.amount, '249.98')
})

test('a cloned row keeps its override, and a blank row starts calculated', () => {
  const source = typeInto(recalcRow({ quantity: '4', rate: '250' }, baseCols), baseCols, 'amount', '900')
  const clone = JSON.parse(JSON.stringify(source))
  assert.deepEqual(recalcRow(clone, baseCols), clone, 'reopening a clone changes nothing')

  const blank = recalcRow(blankItemFor(baseCols), baseCols)
  assert.equal(blank.amount, '')
  assert.equal(amountSource(blank, baseCols), 'auto')
})

test('renamed and reordered columns still calculate', () => {
  const renamed = [
    { id: 'c1', label: 'Value', type: 'text' },
    { id: 'c2', label: 'Unit Rate', type: 'text' },
    { id: 'c3', label: 'Particulars', type: 'text' },
    { id: 'c4', label: 'Qty', type: 'text' }
  ]
  const row = recalcRow({ c4: '3', c2: '150' }, renamed)
  assert.equal(row.c1, '450.00')
  assert.equal(row[sourceKey(renamed[0])], 'auto')
})

test('no rate or no quantity column leaves amount as free text', () => {
  const noRate = [baseCols[0], baseCols[1], baseCols[3]]
  const typed = recalcRow({ quantity: '4', amount: '777' }, noRate)
  assert.equal(typed.amount, '777')
  assert.equal(amountCellState(typed, noRate, amountCol), null, 'no formula, so no override badge')

  const noQty = [baseCols[0], baseCols[2], baseCols[3]]
  assert.equal(recalcRow({ rate: '250', amount: '777' }, noQty).amount, '777')
  assert.equal(recalcRow({ description: 'x' }, [baseCols[0]]).description, 'x', 'no amount column is safe too')
})

test('currency-formatted quantity and rate parse', () => {
  assert.equal(recalcRow({ quantity: '1,200', rate: '₹ 2.50' }, baseCols).amount, '3000.00')
})

test('an uploaded layout shows the calculated amount in its own cell', () => {
  const row = recalcRow({ description: 'Widget', quantity: '4', rate: '250' }, baseCols)
  assert.equal(cellValueForField(row, 'amount', 0, baseCols), '1000.00')
})

// ---------------------------------------------------------------------------
group('Tax: bidirectional Rate <-> Amount')

test('typing Rate computes Amount', () => {
  const row = recalcRow(
    { amount: '1000', [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' },
    taxCols,
    { editingKey: rateKey(cgst) }
  )
  assert.equal(row[amountKey(cgst)], '180.00')
  assert.equal(row[rateKey(cgst)], '18', 'the field being typed must not be rewritten')
})

test('typing Amount back-computes Rate', () => {
  const row = recalcRow(
    { amount: '1000', [amountKey(cgst)]: '90', [sourceKey(cgst)]: 'amount' },
    taxCols,
    { editingKey: amountKey(cgst) }
  )
  assert.equal(row[rateKey(cgst)], '9')
  assert.equal(row[amountKey(cgst)], '90', 'the field being typed must not be rewritten')
})

test('fractional rate rounds to 2 decimals', () => {
  const row = recalcRow(
    { amount: '1000', [rateKey(cgst)]: '2.5', [sourceKey(cgst)]: 'rate' },
    taxCols,
    { editingKey: rateKey(cgst) }
  )
  assert.equal(row[amountKey(cgst)], '25.00')
})

test('repeated recalc is stable (no drift)', () => {
  let row = { amount: '1234.56', [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' }
  row = recalcRow(row, taxCols)
  const first = row[amountKey(cgst)]
  for (let i = 0; i < 5; i++) row = recalcRow(row, taxCols)
  assert.equal(row[amountKey(cgst)], first)
  assert.equal(first, '222.22')
})

test('divide-by-zero guarded: amount typed with zero base clears rate', () => {
  const row = recalcRow(
    { amount: '0', [amountKey(cgst)]: '50', [sourceKey(cgst)]: 'amount' },
    taxCols,
    { editingKey: amountKey(cgst) }
  )
  assert.equal(row[rateKey(cgst)], '', 'no Infinity/NaN leaks into the rate cell')
  assert.equal(row[amountKey(cgst)], '50')
})

test('empty base with a rate clears the amount', () => {
  const row = recalcRow(
    { [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' },
    taxCols,
    { editingKey: rateKey(cgst) }
  )
  assert.equal(row[amountKey(cgst)], '')
})

test('clearing the rate clears the derived amount', () => {
  const row = recalcRow(
    { amount: '1000', [rateKey(cgst)]: '', [amountKey(cgst)]: '180', [sourceKey(cgst)]: 'rate' },
    taxCols,
    { editingKey: rateKey(cgst) }
  )
  assert.equal(row[amountKey(cgst)], '')
})

test('no NaN or Infinity in any nested output', () => {
  const nasty = [
    { amount: '0', [rateKey(cgst)]: '18' },
    { amount: '', [amountKey(cgst)]: '5', [sourceKey(cgst)]: 'amount' },
    { amount: '-100', [rateKey(cgst)]: '18' },
    { amount: 'abc', [rateKey(cgst)]: 'xyz' }
  ]
  for (const row of nasty) {
    const out = recalcRow(row, taxCols)
    for (const key of [rateKey(cgst), amountKey(cgst)]) {
      assert.ok(!/NaN|Infinity/.test(String(out[key])), `${key} = ${out[key]}`)
    }
  }
})

// ---------------------------------------------------------------------------
group('Discount reduces the base, tax applies after')

test('discount applied before tax', () => {
  const row = recalcRow({
    amount: '1000',
    [rateKey(disc)]: '10', [sourceKey(disc)]: 'rate',
    [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate'
  }, bothCols)
  assert.equal(row[amountKey(disc)], '100.00', 'discount is 10% of 1000')
  assert.equal(row[amountKey(cgst)], '162.00', 'tax is 18% of the reduced 900, not of 1000')
})

test('discount typed as Amount back-computes its rate off the full base', () => {
  const row = recalcRow({
    amount: '1000',
    [amountKey(disc)]: '250', [sourceKey(disc)]: 'amount',
    [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate'
  }, bothCols, { editingKey: amountKey(disc) })
  assert.equal(row[rateKey(disc)], '25')
  assert.equal(row[amountKey(cgst)], '135.00', '18% of 750')
})

test('row totals: base -> discount -> taxable -> tax -> total', () => {
  const row = recalcRow({
    amount: '1000',
    [rateKey(disc)]: '10', [sourceKey(disc)]: 'rate',
    [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate'
  }, bothCols)
  const t = computeRowTotals(row, bothCols)
  assert.deepEqual(
    { base: t.base, discount: t.discount, taxable: t.taxable, tax: t.tax, total: t.total },
    { base: 1000, discount: 100, taxable: 900, tax: 162, total: 1062 }
  )
})

test('discount larger than the base cannot make the taxable value negative', () => {
  const row = recalcRow({
    amount: '100',
    [amountKey(disc)]: '500', [sourceKey(disc)]: 'amount',
    [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate'
  }, bothCols, { editingKey: amountKey(disc) })
  const t = computeRowTotals(row, bothCols)
  assert.equal(t.taxable, 0)
  assert.equal(t.tax, 0)
})

test('CGST + SGST split (two tax columns) both use the same taxable base', () => {
  const sgst = { id: 'sgst', label: 'SGST', type: 'tax' }
  const cols = [...baseCols, disc, cgst, sgst]
  const row = recalcRow({
    amount: '1000',
    [rateKey(disc)]: '10', [sourceKey(disc)]: 'rate',
    [rateKey(cgst)]: '9', [sourceKey(cgst)]: 'rate',
    [rateKey(sgst)]: '9', [sourceKey(sgst)]: 'rate'
  }, cols)
  assert.equal(row[amountKey(cgst)], '81.00')
  assert.equal(row[amountKey(sgst)], '81.00')
  assert.equal(computeRowTotals(row, cols).total, 1062)
})

// ---------------------------------------------------------------------------
group('Quote totals footer')

test('totals aggregate across rows', () => {
  const items = recalcAllRows([
    { amount: '1000', [rateKey(disc)]: '10', [sourceKey(disc)]: 'rate', [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' },
    { quantity: '2', rate: '500', [rateKey(disc)]: '10', [sourceKey(disc)]: 'rate', [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' }
  ], bothCols)
  const t = computeQuoteTotals(items, bothCols)
  assert.equal(t.subtotal, 2000)
  assert.equal(t.discountTotal, 200)
  assert.equal(t.taxableTotal, 1800)
  assert.equal(t.taxTotal, 324)
  assert.equal(t.grandTotal, 2124)
  assert.equal(t.hasNested, true)
})

test('per-column footer lines carry label and type', () => {
  const items = recalcAllRows([{ amount: '1000', [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' }], bothCols)
  const t = computeQuoteTotals(items, bothCols)
  const entry = t.perColumn.find(e => e.id === 'cgst')
  assert.equal(entry.label, 'CGST')
  assert.equal(entry.type, 'tax')
  assert.equal(entry.amount, 180)
})

test('totals without any nested column still sum the amount column', () => {
  const t = computeQuoteTotals([{ amount: '100' }, { amount: '250.25' }], baseCols)
  assert.equal(t.subtotal, 350.25)
  assert.equal(t.grandTotal, 350.25)
  assert.equal(t.hasNested, false)
})

test('extra discount/add lines adjust the grand total after tax', () => {
  const t = computeQuoteTotals([{ amount: '1000' }], baseCols, [
    { id: 'd1', label: 'Discount', kind: 'less', amount: '100' },
    { id: 'f1', label: 'Freight', kind: 'add', amount: '50' }
  ])
  assert.equal(t.subtotal, 1000)
  assert.equal(t.grandTotal, 950)
})

test('percent extra line is calculated from the total before extra lines', () => {
  const t = computeQuoteTotals([{ amount: '1000' }], baseCols, [
    { id: 'd1', label: 'Discount', kind: 'less', amount: '10', unit: 'percent' }
  ])
  assert.equal(t.extraBase, 1000)
  assert.equal(t.extraLess, 100)
  assert.equal(t.grandTotal, 900)
})

test('percent extra line still works after GST', () => {
  const items = recalcAllRows([{ amount: '1000', [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' }], taxCols)
  const t = computeQuoteTotals(items, taxCols, [
    { id: 'd1', label: 'Discount', kind: 'less', amount: '10', unit: 'percent' }
  ])
  assert.equal(t.taxTotal, 180)
  assert.equal(t.extraBase, 1180)
  assert.equal(t.extraLess, 118)
  assert.equal(t.grandTotal, 1062)
})

test('omitting extra lines leaves existing totals unchanged', () => {
  const t = computeQuoteTotals([{ amount: '1000' }], baseCols)
  assert.equal(t.grandTotal, 1000)
  assert.equal(t.extraLess, 0)
  assert.equal(t.extraAdd, 0)
})

// ---------------------------------------------------------------------------
group('Column add / remove / rename / reorder / retype')

test('adding a nested column seeds rate/amount/src keys', () => {
  const item = withColumnKeys({ amount: '1000' }, cgst)
  assert.equal(item[rateKey(cgst)], '')
  assert.equal(item[amountKey(cgst)], '')
  assert.equal(item[sourceKey(cgst)], 'rate')
  assert.equal(item.amount, '1000', 'existing data is preserved')
})

test('removing a column strips every key it owns', () => {
  const item = withoutColumnKeys({ amount: '1000', [rateKey(cgst)]: '18', [amountKey(cgst)]: '180', [sourceKey(cgst)]: 'rate' }, cgst)
  assert.deepEqual(Object.keys(item), ['amount'])
})

test('removing an image column strips its storage path key', () => {
  const img = { id: 'photo', label: 'Photo', type: 'image' }
  const item = withoutColumnKeys({ description: 'x', photo: 'https://cdn/x.png', photo__path: 'quote-images/x.png' }, img)
  assert.deepEqual(Object.keys(item), ['description'], `leftover: ${Object.keys(item)}`)
})

test('reorder moves a column and preserves the rest', () => {
  const moved = moveColumnInList(bothCols, 4, 1)
  assert.equal(moved[1].id, 'disc')
  assert.equal(moved.length, bothCols.length)
  assert.deepEqual(moved.map(c => c.id).sort(), bothCols.map(c => c.id).sort())
})

test('reorder is a no-op at the edges', () => {
  assert.equal(moveColumnInList(bothCols, 0, -1), bothCols)
  assert.equal(moveColumnInList(bothCols, 5, 6), bothCols)
})

test('retype flat -> nested migrates keys', () => {
  const flat = { id: 'gst', label: 'GST %', type: 'text' }
  const item = convertItemForType({ gst: '18', amount: '1000' }, flat, 'tax')
  assert.equal(item.gst, undefined)
  assert.equal(item['gst__rate'], '')
  assert.equal(item['gst__src'], 'rate')
  assert.equal(item.amount, '1000')
})

test('retype nested -> flat keeps the calculated amount as text', () => {
  const item = convertItemForType(
    { [rateKey(cgst)]: '18', [amountKey(cgst)]: '180.00', [sourceKey(cgst)]: 'rate' },
    cgst,
    'text'
  )
  assert.equal(item.cgst, '180.00')
  assert.equal(item[rateKey(cgst)], undefined)
})

test('retype image -> text drops the storage path', () => {
  const img = { id: 'photo', label: 'Photo', type: 'image' }
  const item = convertItemForType({ photo: 'https://cdn/x.png', photo__path: 'quote-images/x.png' }, img, 'text')
  assert.equal(item.photo__path, undefined, 'stale storage path must not survive the retype')
})

test('blank row seeds every column type', () => {
  const item = blankItemFor([...bothCols, { id: 'photo', label: 'Photo', type: 'image' }])
  assert.equal(item.description, '')
  assert.equal(item.photo, '')
  assert.equal(item[sourceKey(cgst)], 'rate')
})

test('nested columns occupy two cells, others one', () => {
  assert.equal(columnSpan(cgst), 2)
  assert.equal(columnSpan(disc), 2)
  assert.equal(columnSpan({ id: 'a', label: 'A', type: 'image' }), 1)
})

// ---------------------------------------------------------------------------
group('Persistence round-trip (autosave -> reopen -> clone)')

const richCols = [
  ...baseCols,
  { id: 'photo', label: 'Photo', type: 'image', imageWidth: 140 },
  { id: 'urgent', label: 'Urgent', type: 'highlight', color: '#ffe3e3' },
  { id: 'note', label: 'Site Note', type: 'custom' },
  disc,
  cgst
]

test('normalizeColumnList retains type and per-type config', () => {
  const round = normalizeColumnList(JSON.parse(JSON.stringify(richCols)))
  assert.equal(round.length, richCols.length)
  const photo = round.find(c => c.id === 'photo')
  assert.equal(photo.type, 'image')
  assert.equal(photo.imageWidth, 140)
  const urgent = round.find(c => c.id === 'urgent')
  assert.equal(urgent.type, 'highlight')
  assert.equal(urgent.color, '#ffe3e3')
  assert.equal(round.find(c => c.id === 'cgst').type, 'tax')
  assert.equal(round.find(c => c.id === 'disc').type, 'discount')
  assert.equal(round.find(c => c.id === 'note').type, 'custom')
})

test('normalizeColumnList is idempotent and drops duplicates/garbage', () => {
  const once = normalizeColumnList(richCols)
  assert.deepEqual(normalizeColumnList(once), once)
  const messy = normalizeColumnList([...richCols, { id: 'photo', label: 'Dupe', type: 'image' }, null, { label: 'no id' }])
  assert.equal(messy.length, richCols.length)
})

test('unknown column type degrades to text rather than being dropped', () => {
  const round = normalizeColumnList([{ id: 'x', label: 'X', type: 'wormhole' }])
  assert.equal(round[0].type, 'text')
})

test('image URL and nested values survive a JSON round-trip', () => {
  const item = recalcRow({
    description: 'Widget',
    amount: '1000',
    photo: 'https://example.supabase.co/storage/v1/object/public/quote-assets/quote-images/a.png',
    photo__path: 'quote-images/a.png',
    urgent: 'YES',
    [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate'
  }, richCols)
  const reopened = JSON.parse(JSON.stringify(item))
  assert.equal(reopened.photo__path, 'quote-images/a.png')
  assert.equal(reopened[amountKey(cgst)], '180.00')
  assert.equal(reopened.urgent, 'YES')
  // Reopening recalculates without changing anything.
  assert.deepEqual(recalcRow(reopened, richCols), reopened)
})

test('inline data-URL fallback survives the round-trip', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
  const item = { photo: dataUrl }
  assert.equal(JSON.parse(JSON.stringify(item)).photo, dataUrl)
})

// ---------------------------------------------------------------------------
group('Uploaded-template degradation')

test('nested column collapses to its amount in a flat template cell', () => {
  const item = recalcRow({ amount: '1000', [rateKey(cgst)]: '18', [sourceKey(cgst)]: 'rate' }, richCols)
  assert.equal(cellValueForField(item, 'cgst', 0, richCols), '180.00')
})

test('image column yields no stray text in a spreadsheet cell', () => {
  assert.equal(cellValueForField({ photo: 'https://cdn/x.png' }, 'photo', 0, richCols), '')
})

test('Word template renders an <img> for an image column and tints a highlight column', () => {
  const html = '<table><tr><th>Description</th><th>Photo</th><th>Urgent</th></tr><tr><td>x</td><td>y</td><td>z</td></tr></table>'
  const out = fillWordLineItems(html, {
    items: [{ description: 'Widget', photo: 'https://cdn/x.png', urgent: 'YES' }]
  }, richCols)
  assert.ok(/<img src="https:\/\/cdn\/x.png"[^>]*width="140"/.test(out), 'image cell renders at the configured width')
  assert.ok(/background-color:#ffe3e3/.test(out), 'highlight colour is applied')
  assert.ok(/print-color-adjust:exact/.test(out), 'highlight prints in colour')
})

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(60)}`)
console.log(`${pass} passed, ${fail} failed`)
if (fail) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`\n### ${f.name}\n${f.error.message}`)
  process.exit(1)
}
