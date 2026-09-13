/**
 * Simple native Excel fill rules:
 * map headers → write inputs only → leave Amount/GST/Total to the template.
 * Run: node scripts/verify-excel-tax-fill.mjs
 */
import assert from 'node:assert/strict'
import {
  mapHeadersToFields,
  resolveColumnForField
} from '../shared/templateMap.js'
import {
  isExcelInputField,
  excelCellInputValue,
  retargetFormulaRows
} from '../server/writeFilledExcel.js'

const columns = [
  { id: 'description', label: 'Description' },
  { id: 'quantity', label: 'Qty' },
  { id: 'rate', label: 'Rate' },
  { id: 'amount', label: 'Amount' },
  { id: 'gst', label: 'GST', type: 'tax' },
  { id: 'total', label: 'Total' }
]

const item = {
  description: 'Caliper',
  quantity: '2',
  rate: '650',
  amount: '1300.00',
  gst__rate: '18',
  gst__amount: '234.00'
}

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.message}`)
    process.exitCode = 1
  }
}

console.log('excel fill — keep template formulas')

test('GST 18% maps to tax (label only — for skip/write decisions)', () => {
  const ids = mapHeadersToFields(
    ['Description', 'Qty', 'Rate', 'Amount', 'GST 18%', 'Total'],
    columns
  )
  assert.equal(ids[4], 'tax')
})

test('write description / qty / rate; skip amount / tax / total', () => {
  assert.equal(isExcelInputField('description', columns), true)
  assert.equal(isExcelInputField('quantity', columns), true)
  assert.equal(isExcelInputField('rate', columns), true)
  assert.equal(isExcelInputField('amount', columns), false)
  assert.equal(isExcelInputField('tax', columns), false)
  assert.equal(isExcelInputField('gst18%', columns), false)
  assert.equal(isExcelInputField('total', columns), false)
})

test('qty/rate written as numbers', () => {
  assert.equal(excelCellInputValue(item, 'quantity', 0, columns, []), 2)
  assert.equal(excelCellInputValue(item, 'rate', 0, columns, []), 650)
})

test('resolveColumnForField(tax) finds gst column', () => {
  assert.equal(resolveColumnForField('tax', columns)?.id, 'gst')
})

test('retargetFormulaRows scales one-row formulas to new rows', () => {
  assert.equal(retargetFormulaRows('G21+H21*G21', 21, 22), 'G22+H22*G22')
  assert.equal(retargetFormulaRows('E21*F21', 21, 23), 'E23*F23')
})

console.log(`\n${passed} passed`)
