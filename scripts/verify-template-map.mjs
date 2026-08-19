/**
 * Word/Excel layout mapping — unique columns, extra item rows, no re-scrub junk.
 * Run: node scripts/verify-template-map.mjs
 */
import assert from 'node:assert/strict'
import {
  mapHeadersToFields,
  layoutFieldRole,
  isLineItemStopText,
  fillWordTemplate,
  expandExcelLineItemRows,
  fillExcelItemRow,
  cellValueForField
} from '../shared/templateMap.js'

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

const columns = [
  { id: 'description', label: 'Description' },
  { id: 'quantity', label: 'Qty' },
  { id: 'rate', label: 'Rate' },
  { id: 'amount', label: 'Amount' }
]

const quote = {
  number: 'QG-2026-42',
  date: '19 Aug 2026',
  title: 'MS plates for shed',
  customer: {
    company: 'Acme Steels Pvt Ltd',
    name: 'Ravi Kumar',
    location: 'Pune',
    gst: '27AABCU9603R1ZM'
  },
  items: [
    { description: 'MS Plate 8mm', specification: 'IS 2062', quantity: '10', rate: '50', amount: '500' },
    { description: 'MS Plate 10mm', specification: 'IS 2062', quantity: '4', rate: '60', amount: '240' },
    { description: 'GSTIN verification jig', specification: 'Tooling', quantity: '1', rate: '100', amount: '100' }
  ]
}

const totals = { subtotal: 840, taxTotal: 151.2, grandTotal: 991.2 }

const sampleHtml = `
<table>
  <tr><td>TO</td><td>Old Client Ltd<br/>Old Street</td></tr>
  <tr><td>Customer GSTIN</td><td>27AAAAA0000A1Z5</td></tr>
  <tr><td>Subject</td><td>Old subject from sample</td></tr>
  <tr><td>Quotation No.</td><td>QTN - 007</td></tr>
</table>
<table>
  <tr><td>Sr</td><td>Item</td><td>Description</td><td>Qty</td><td>Rate</td><td>Amount</td></tr>
  <tr><td>1</td><td>Old Item</td><td>Old Desc</td><td>1</td><td>10</td><td>10</td></tr>
  <tr><td>2</td><td>Old Two</td><td>Old Two Desc</td><td>1</td><td>10</td><td>10</td></tr>
  <tr><td>Sub Total</td><td></td><td></td><td></td><td></td><td>20</td></tr>
  <tr><td>Grand Total</td><td></td><td></td><td></td><td></td><td>20</td></tr>
</table>
`

group('Header mapping')

test('Item and Description stay unique columns', () => {
  const ids = mapHeadersToFields(['Sr', 'Item', 'Description', 'Qty', 'Rate', 'Amount'], columns)
  assert.deepEqual(ids, ['__sr__', 'description', 'specification', 'quantity', 'rate', 'amount'])
})

test('single Description column still maps to description', () => {
  const ids = mapHeadersToFields(['Description', 'Qty', 'Rate', 'Amount'], columns)
  assert.deepEqual(ids, ['description', 'quantity', 'rate', 'amount'])
})

group('Field roles')

test('Customer GSTIN is gst, not the TO block', () => {
  assert.equal(layoutFieldRole('Customer GSTIN'), 'customer_gst')
  assert.equal(layoutFieldRole('Customer GSTIN: 27AAAAA0000A1Z5'), 'customer_gst')
  assert.equal(layoutFieldRole('TO'), 'customer_block')
  assert.equal(layoutFieldRole('Company GSTIN'), null)
})

group('Stop rows')

test('product lines that mention GST are not totals', () => {
  assert.equal(isLineItemStopText('GSTIN verification jig 1 100 100'), false)
  assert.equal(isLineItemStopText('Chemical resistant gasket'), false)
  assert.equal(isLineItemStopText('GST 18% 1,234.00'), true)
  assert.equal(isLineItemStopText('Sub Total 20.00'), true)
  assert.equal(isLineItemStopText('Grand Total 991.20'), true)
})

group('Word fill')

test('fills the right cells and drops sample client/products', () => {
  const html = fillWordTemplate(sampleHtml, quote, columns, {}, totals)
  assert.match(html, /Acme Steels Pvt Ltd/)
  assert.match(html, /27AABCU9603R1ZM/)
  assert.doesNotMatch(html, /Old Client Ltd/)
  assert.doesNotMatch(html, /27AAAAA0000A1Z5/)
  assert.doesNotMatch(html, /Old Item/)
  assert.doesNotMatch(html, /Old subject from sample/)
  assert.match(html, /MS Plate 8mm/)
  assert.match(html, /MS Plate 10mm/)
  assert.match(html, /GSTIN verification jig/)
  assert.match(html, /data-qg-field="description"/)
  assert.match(html, /data-qg-field="specification"/)
  assert.match(html, /data-qg-item="2"/)
  assert.match(html, /data-slot="customer_gst"/)
  assert.match(html, /991\.20/)
  const gstRow = html.match(/Customer GSTIN[\s\S]*?<\/tr>/i)?.[0] || ''
  assert.match(gstRow, /27AABCU9603R1ZM/)
  assert.doesNotMatch(gstRow, /27AAAAA0000A1Z5/)
})

test('Item column is not a copy of Description', () => {
  const html = fillWordTemplate(sampleHtml, quote, columns, {}, totals)
  const itemRow = html.match(/data-qg-item="0"[\s\S]*?<\/tr>/i)?.[0] || ''
  assert.match(itemRow, /MS Plate 8mm/)
  assert.match(itemRow, /IS 2062/)
  const descCell = itemRow.match(/data-qg-field="description"[^>]*>([\s\S]*?)<\/td>/i)?.[1] || ''
  const specCell = itemRow.match(/data-qg-field="specification"[^>]*>([\s\S]*?)<\/td>/i)?.[1] || ''
  assert.match(descCell, /MS Plate 8mm/)
  assert.doesNotMatch(descCell, /IS 2062/)
  assert.match(specCell, /IS 2062/)
  assert.doesNotMatch(specCell, /MS Plate 8mm/)
})

test('already-slotted shell is not re-scrubbed into temp_value', () => {
  const first = fillWordTemplate(sampleHtml, quote, columns, {}, totals)
  const second = fillWordTemplate(first, quote, columns, {}, totals)
  assert.doesNotMatch(second, /data-slot="temp_value"/)
  assert.doesNotMatch(second, /Old Item/)
  assert.match(second, /Acme Steels Pvt Ltd/)
  assert.match(second, /MS Plate 8mm/)
})

group('Excel rows')

function excelSheet() {
  const headers = ['Sr', 'Item', 'Description', 'Qty', 'Rate', 'Amount']
  return {
    columns: headers.map((_, i) => ({ index: i + 1, widthPx: 80 })),
    rows: [
      {
        index: 1,
        heightPx: 20,
        cells: headers.map((value, i) => ({ col: i + 1, value }))
      },
      {
        index: 2,
        heightPx: 20,
        cells: ['1', 'Old Item', 'Old Desc', '1', '10', '10'].map((value, i) => ({ col: i + 1, value }))
      },
      {
        index: 3,
        heightPx: 20,
        cells: ['Sub Total', '', '', '', '', '20'].map((value, i) => ({ col: i + 1, value }))
      }
    ]
  }
}

test('grows one Excel row per enquiry line and maps columns uniquely', () => {
  const sheet = excelSheet()
  const { start, colMap } = expandExcelLineItemRows(sheet, quote.items.length, columns)
  assert.deepEqual(colMap, ['__sr__', 'description', 'specification', 'quantity', 'rate', 'amount'])
  assert.equal(start, 1)
  assert.equal(sheet.rows.length, 5)
  quote.items.forEach((item, i) => {
    fillExcelItemRow(sheet.rows[start + i], item, i, colMap, columns)
  })
  assert.equal(sheet.rows[start].cells[1].value, 'MS Plate 8mm')
  assert.equal(sheet.rows[start].cells[2].value, 'IS 2062')
  assert.equal(sheet.rows[start + 2].cells[1].value, 'GSTIN verification jig')
  assert.equal(sheet.rows[start + 2].cells[3].value, '1')
  assert.equal(sheet.rows[start + quote.items.length].cells[0].value, 'Sub Total')
})

test('cellValueForField does not dump description into specification', () => {
  const item = quote.items[0]
  assert.equal(cellValueForField(item, 'description', 0, columns), 'MS Plate 8mm')
  assert.equal(cellValueForField(item, 'specification', 0, columns), 'IS 2062')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  for (const item of failures) {
    console.error(`\n${item.name}\n${item.error.stack}`)
  }
  process.exit(1)
}
