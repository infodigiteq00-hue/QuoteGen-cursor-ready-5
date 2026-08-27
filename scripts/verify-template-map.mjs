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
  fillExcelTemplate,
  expandExcelLineItemRows,
  fillExcelItemRow,
  cellValueForField,
  scrubTransientWordShell,
  markTransientWordShell,
  maxTempWave,
  collectWordSlots,
  collectExcelMapping,
  learnExcelPlacements,
  applyLayoutEditsToSheets,
  placementsEqual,
  insertExcelRow,
  removeExcelRow,
  insertExcelColumn,
  removeExcelColumn,
  excelColLetter,
  shiftLayoutEditsForColChange,
  detectExcelTableRegions,
  inferTemplatePageWidth,
  insertWordLineItemColumn,
  removeWordLineItemColumn
} from '../shared/templateMap.js'
import { scrubExcelSheets } from '../server/uploadTemplates.js'

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

test('mark preview keeps sample text and headers, then fade targets only temp values', () => {
  const html = `
    <div data-qg-permanent="header"><p>Phone: +91 98765 43210 | GSTIN: 27SELLER1234F1Z5</p></div>
    ${sampleHtml}
    <p>Bank Name: HDFC Bank IFSC: HDFC0001234 Account No 123456</p>
    <p>Authorized Signatory</p>
  `
  const marked = markTransientWordShell(html)
  assert.match(marked, /Old Item/)
  assert.match(marked, /QTN - 007/)
  assert.match(marked, /data-qg-temp="1"/)
  assert.match(marked, /Sr/)
  assert.match(marked, /HDFC0001234/)
  assert.match(marked, /27SELLER1234F1Z5/)
  assert.match(marked, /Authorized Signatory/)
  assert.ok(maxTempWave(marked) >= 1)
  assert.doesNotMatch(marked, /qg-temp-strip[^>]*>Sr</)
})

test('scrub marks line cells and keeps seller GSTIN in header chrome', () => {
  const html = `
    <div data-qg-permanent="header"><p>Phone: +91 98765 43210 | Email: sales@acme.example | GSTIN: 27SELLER1234F1Z5</p></div>
    ${sampleHtml}
    <p>Bank Name: HDFC Bank IFSC: HDFC0001234 Account No 123456</p>
  `
  const scrubbed = scrubTransientWordShell(html)
  assert.match(scrubbed, /data-slot="line_cell"/)
  assert.match(scrubbed, /27SELLER1234F1Z5/)
  assert.doesNotMatch(scrubbed, /Old Client Ltd/)
  const slots = collectWordSlots(scrubbed)
  assert.ok(slots.some(s => s.role === 'customer_gst' && !s.permanent))
  assert.ok(slots.some(s => s.role === 'line_items' && !s.permanent))
  assert.ok(slots.some(s => s.role === 'header_footer' && s.permanent))
  const filled = fillWordTemplate(html, quote, columns, {}, totals)
  assert.match(filled, /27SELLER1234F1Z5/)
  assert.match(filled, /HDFC0001234/)
  assert.match(filled, /Acme Steels Pvt Ltd/)
})

test('terms validity boilerplate is not a valid_until slot', () => {
  const html = `<p>Valid: 30 days from the date of delivery</p>${sampleHtml}`
  const filled = fillWordTemplate(html, quote, columns, {}, totals)
  assert.match(filled, /30 days from the date of delivery/)
  const validSlots = [...filled.matchAll(/data-slot="valid_until"/g)]
  assert.equal(validSlots.length, 0)
})

test('standalone totals table amounts refresh', () => {
  const html = `${sampleHtml}<table><tr><td>Grand Total</td><td>₹20.00</td></tr></table>`
  const filled = fillWordTemplate(html, quote, columns, {}, totals)
  assert.match(filled, /991\.20/)
  assert.doesNotMatch(filled, /₹20\.00/)
})

test('extra lines land in the items table before Grand Total', () => {
  const filled = fillWordTemplate(sampleHtml, quote, columns, {}, {
    ...totals,
    freightTotal: 5000,
    grandTotal: 5991.2,
    resolvedExtraLines: [{ label: 'Freight', kind: 'add', resolved: 5000 }]
  })
  assert.match(filled, /data-qg-extra/)
  assert.match(filled, /5,000\.00/)
  const freightAt = filled.indexOf('Freight')
  const grandAt = filled.lastIndexOf('Grand Total')
  assert.ok(freightAt > 0 && freightAt < grandAt, 'Freight should sit above Grand Total')
  assert.match(filled, /5,991\.20/)
})

test('word line-item column insert grows every row', () => {
  const next = insertWordLineItemColumn(sampleHtml, 3, { label: 'HSN' })
  assert.match(next, /Qty<\/td><th>HSN<\/th><td>Rate/)
  const itemRows = [...next.matchAll(/<tr><td>\d+<\/td>[\s\S]*?<\/tr>/gi)]
  assert.ok(itemRows.length >= 2)
  for (const row of itemRows) {
    assert.equal((row[0].match(/<t[dh]\b/gi) || []).length, 7)
  }
})

test('word line-item column remove shrinks every row', () => {
  const withHsn = insertWordLineItemColumn(sampleHtml, 3, { label: 'HSN' })
  const removed = removeWordLineItemColumn(withHsn, 4)
  assert.doesNotMatch(removed, />HSN</)
  const itemRows = [...removed.matchAll(/<tr><td>\d+<\/td>[\s\S]*?<\/tr>/gi)]
  for (const row of itemRows) {
    assert.equal((row[0].match(/<t[dh]\b/gi) || []).length, 6)
  }
})

test('images survive fill', () => {
  const html = `<p><img src="data:image/png;base64,aaa" width="80"/></p>${sampleHtml}`
  const filled = fillWordTemplate(html, quote, columns, {}, totals)
  assert.match(filled, /<img src="data:image\/png;base64,aaa"/)
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

test('GST column header is not mapped as customer GSTIN', () => {
  const sheets = [{
    name: 'Q',
    columns: [{ index: 1, widthPx: 80 }, { index: 2, widthPx: 80 }, { index: 3, widthPx: 80 }, { index: 4, widthPx: 80 }],
    rows: [
      { index: 1, heightPx: 20, cells: [
        { col: 1, value: 'GSTIN', formula: null, style: {}, role: 'content' },
        { col: 2, value: '27AAAAA0000A1Z5', formula: null, style: {}, role: 'content' }
      ]},
      { index: 2, heightPx: 20, cells: [
        { col: 1, value: 'Item', formula: null, style: {}, role: 'content' },
        { col: 2, value: 'Qty', formula: null, style: {}, role: 'content' },
        { col: 3, value: 'GST', formula: null, style: {}, role: 'content' },
        { col: 4, value: 'Amount', formula: null, style: {}, role: 'content' }
      ]},
      { index: 3, heightPx: 20, cells: [
        { col: 1, value: 'Old Item', formula: null, style: {}, role: 'content' },
        { col: 2, value: '1', formula: null, style: {}, role: 'content' },
        { col: 3, value: '18', formula: null, style: {}, role: 'content' },
        { col: 4, value: '10', formula: null, style: {}, role: 'content' }
      ]}
    ]
  }]
  const filled = fillExcelTemplate(sheets, quote, columns, {}, totals)
  const gstHeader = filled[0].rows[1].cells.find(c => c.col === 3)
  assert.notEqual(gstHeader.role, 'customer_gst')
  const gstinValue = filled[0].rows[0].cells.find(c => c.col === 2)
  assert.equal(gstinValue.role, 'customer_gst')
  assert.match(String(gstinValue.value), /27AABCU9603R1ZM/)
  const mapped = collectExcelMapping(filled)
  assert.ok(mapped.slots.some(s => s.role === 'customer_gst' && !s.permanent))
  assert.ok(mapped.dynamicCells.some(c => c.role === 'customer_gst'))
})

group('Chemical-style sparse buyer row')
test('side-by-side labels map to empty cells below', () => {
  const sheets = [{
    name: 'Offer',
    columns: [],
    rows: [
      { index: 4, heightPx: 22, cells: [
        { col: 1, value: 'BUYER & ENQUIRY', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 2, value: 'BUYER & ENQUIRY', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 }
      ]},
      { index: 5, heightPx: 22, cells: [
        { col: 1, value: 'Client / Company', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 3, value: 'Contact', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 5, value: 'Quote No.', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 6, value: 'Date', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 7, value: 'Valid Through', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 }
      ]},
      { index: 6, heightPx: 22, cells: [] },
      { index: 16, heightPx: 22, cells: [
        { col: 1, value: 'COMMERCIAL OFFER', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 }
      ]},
      { index: 17, heightPx: 22, cells: [
        { col: 1, value: 'Description', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 2, value: 'Qty.', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 3, value: 'UOM', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 4, value: 'Rate', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 5, value: 'Amount', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 }
      ]},
      { index: 18, heightPx: 22, cells: [
        { col: 1, value: 'Sample chemical', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 2, value: '1', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 }
      ]}
    ]
  }]
  const mapped = scrubExcelSheets(sheets)
  const roles = new Set(mapped.mapping.dynamicCells.map(c => c.role))
  assert.ok(roles.has('customer_company'))
  assert.ok(roles.has('customer_name'))
  assert.ok(roles.has('quote_number'))
  assert.ok(roles.has('date'))
  assert.ok(roles.has('valid_until'))
  assert.ok(mapped.mapping.columns.some(c => c.id === 'quantity' && c.label === 'Qty.'))
})

group('Placement learning')
test('remembers subject cell after user moves it', () => {
  const sheets = [{
    name: 'Offer',
    columns: [],
    rows: [
      { index: 5, heightPx: 22, cells: [
        { col: 1, value: 'Enquiry reference', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 2, value: 'Quotation for MEK', role: 'subject', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 3, value: '_______', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 }
      ]},
      { index: 17, heightPx: 22, cells: [
        { col: 1, value: 'Description', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 2, value: 'Qty.', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 3, value: 'Rate', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 },
        { col: 4, value: 'Amount', role: 'content', formula: null, style: {}, rowSpan: 1, colSpan: 1 }
      ]}
    ]
  }]
  const q = { ...quote, title: 'Quotation for MEK' }
  // User cleared the wrong cell and typed the title into the blank box on the right.
  const edits = {
    '0:5:2': '',
    '0:5:3': 'Quotation for MEK'
  }
  const snapshot = applyLayoutEditsToSheets(sheets, edits)
  const learned = learnExcelPlacements(snapshot, q, edits, {})
  assert.equal(learned.subject.col, 3)
  assert.equal(learned.subject.row, 0)

  const filled = fillExcelTemplate(sheets, q, columns, {}, totals, { placements: learned })
  const row5 = filled[0].rows[0]
  const wrong = row5.cells.find(c => c.col === 2)
  const right = row5.cells.find(c => c.col === 3)
  assert.equal(String(wrong.value || '').trim(), '')
  assert.match(String(right.value || ''), /Quotation for MEK/)
  assert.equal(false, placementsEqual(learned, {}))
})

group('Structure editing')
test('insert/remove row and column keeps styles and shifts keys', () => {
  const sheet = {
    name: 'S',
    columns: [
      { index: 1, widthPx: 100 },
      { index: 2, widthPx: 80 }
    ],
    rows: [
      {
        index: 1,
        heightPx: 24,
        cells: [
          { col: 1, value: 'A', style: { backgroundColor: '#0f5c5c' }, rowSpan: 1, colSpan: 1, role: 'content', formula: null },
          { col: 2, value: 'B', style: { backgroundColor: '#0f5c5c' }, rowSpan: 1, colSpan: 1, role: 'content', formula: null }
        ]
      },
      {
        index: 2,
        heightPx: 22,
        cells: [
          { col: 1, value: 'x', style: { border: true }, rowSpan: 1, colSpan: 1, role: 'content', formula: null },
          { col: 2, value: 'y', style: { border: true }, rowSpan: 1, colSpan: 1, role: 'content', formula: null }
        ]
      }
    ]
  }
  insertExcelRow(sheet, 0)
  assert.equal(sheet.rows.length, 3)
  assert.equal(sheet.rows[1].cells[0].value, '')
  assert.equal(sheet.rows[1].cells[0].style.backgroundColor, '#0f5c5c')
  assert.equal(sheet.rows[2].index, 3)

  insertExcelColumn(sheet, 1)
  assert.equal(sheet.columns.length, 3)
  assert.equal(sheet.columns[1].index, 2)
  assert.ok(sheet.rows[0].cells.some(c => Number(c.col) === 2 && c.value === ''))
  assert.equal(excelColLetter(3), 'C')

  const edits = shiftLayoutEditsForColChange({ '0:1:2': 'keep' }, 0, 1, 1)
  assert.equal(edits['0:1:3'], 'keep')
  assert.equal(edits['0:1:2'], undefined)

  removeExcelColumn(sheet, 2)
  assert.equal(sheet.columns.length, 2)
  removeExcelRow(sheet, 1)
  assert.equal(sheet.rows.length, 2)
})

test('detects multiple table regions and applies extra-line totals', () => {
  const sheet = {
    columns: [{ index: 1, widthPx: 80 }, { index: 2, widthPx: 80 }, { index: 3, widthPx: 80 }],
    rows: [
      { index: 1, heightPx: 22, cells: [{ col: 1, value: 'MATERIAL IDENTITY', style: { backgroundColor: '#0f5c5c' }, colSpan: 3, rowSpan: 1, formula: null, role: 'content' }] },
      { index: 2, heightPx: 22, cells: [
        { col: 1, value: 'Product', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' },
        { col: 2, value: 'Grade', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' },
        { col: 3, value: 'Form', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' }
      ] },
      { index: 3, heightPx: 22, cells: [] },
      { index: 4, heightPx: 22, cells: [{ col: 1, value: 'COMMERCIAL OFFER', style: { backgroundColor: '#0f5c5c' }, colSpan: 3, rowSpan: 1, formula: null, role: 'content' }] },
      { index: 5, heightPx: 22, cells: [
        { col: 1, value: 'Description', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' },
        { col: 2, value: 'Qty', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' },
        { col: 3, value: 'Amount', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' }
      ] },
      { index: 6, heightPx: 22, cells: [
        { col: 1, value: '', role: 'line_item', style: {}, rowSpan: 1, colSpan: 1, formula: null },
        { col: 2, value: '', role: 'line_item', style: {}, rowSpan: 1, colSpan: 1, formula: null },
        { col: 3, value: '', role: 'line_item', style: {}, rowSpan: 1, colSpan: 1, formula: null }
      ] },
      { index: 7, heightPx: 22, cells: [
        { col: 1, value: 'Grand Total', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' },
        { col: 2, value: '', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' },
        { col: 3, value: '0', style: {}, rowSpan: 1, colSpan: 1, formula: null, role: 'content' }
      ] }
    ]
  }
  const regions = detectExcelTableRegions(sheet)
  assert.ok(regions.length >= 2)
  assert.ok(regions.some(r => r.kind === 'line_items'))
})

test('excel page width auto-widens past a stale design width', () => {
  const sheet = {
    columns: [
      { index: 1, widthPx: 200 },
      { index: 2, widthPx: 200 },
      { index: 3, widthPx: 200 },
      { index: 4, widthPx: 200 }
    ]
  }
  const wide = inferTemplatePageWidth('excel', [sheet], { pageWidthPx: 640 })
  assert.ok(wide >= 800 + 56)
  const stillMin = inferTemplatePageWidth('excel', [{ columns: [{ index: 1, widthPx: 80 }] }], { pageWidthPx: 900 })
  assert.equal(stillMin, 900)
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  for (const item of failures) {
    console.error(`\n${item.name}\n${item.error.stack}`)
  }
  process.exit(1)
}
