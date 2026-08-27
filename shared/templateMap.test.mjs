import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  mapHeadersToFields,
  isLineItemStopText,
  fillWordTemplate,
  fillExcelTemplate,
  scrubTransientWordShell,
  markTransientWordShell,
  markTransientExcelShell,
  maxTempWave,
  cellValueForField,
  collectWordSlots,
  lineItemHeaderScore
} from './templateMap.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const failures = []
function assert(cond, msg) {
  if (!cond) failures.push(msg)
}

const columns = [
  { id: 'description', label: 'Description' },
  { id: 'quantity', label: 'Qty' },
  { id: 'unit', label: 'Unit' },
  { id: 'rate', label: 'Rate' },
  { id: 'amount', label: 'Amount' }
]

const slugColumns = [
  { id: 'item', label: 'Item' },
  { id: 'descriptionSpecifications', label: 'Description / Specifications' },
  { id: 'qty', label: 'Qty' }
]

const headers = ['Sr. No.', 'Item', 'Description', 'Qty', 'Unit', 'Rate', 'Amount']
const fields = mapHeadersToFields(headers, columns)
assert(fields[1] === 'description', `Item should map to description, got ${fields[1]}`)
assert(fields[2] === 'specification', `Description should map to specification, got ${fields[2]}`)
assert(fields[3] === 'quantity', `Qty should map to quantity, got ${fields[3]}`)
assert(new Set(fields.filter(id => id && id !== '__sr__')).size === fields.filter(id => id && id !== '__sr__').length, 'no duplicate field ids')

const slugFields = mapHeadersToFields(
  ['Sr. No.', 'Item', 'Description / Specifications', 'Qty'],
  slugColumns
)
assert(slugFields[1] === 'description', `slug Item → description, got ${slugFields[1]}`)
assert(slugFields[2] === 'specification', `slug Description / Specs → specification, got ${slugFields[2]}`)
assert(slugFields[3] === 'quantity', `slug Qty → quantity, got ${slugFields[3]}`)

assert(!isLineItemStopText('GST 18mm compression gland 50 nos'), 'GST 18mm product is not a totals row')
assert(!isLineItemStopText('1 GST Cable Gland 10 100 18 1180'), 'GST in product name is not a totals row')
assert(isLineItemStopText('GST 18% 1,234.00'), 'GST 18% is a totals row')
assert(isLineItemStopText('GST: 1234'), 'GST: amount is a totals row')
assert(isLineItemStopText('Grand Total 5,000.00'), 'Grand Total is a totals row')
assert(!isLineItemStopText('Item Description Qty Rate GST Amount'), 'GST column header row is not a stop')

const item = { description: 'Nylon gland\nPG21, IP68', quantity: '10', unit: 'Nos', rate: '12', amount: '120' }
assert(cellValueForField(item, 'description', 0, columns, ['description', 'specification']) === 'Nylon gland', 'Item col gets primary name')
assert(cellValueForField(item, 'specification', 0, columns, ['description', 'specification']).includes('PG21'), 'Description col gets spec')
assert(cellValueForField(item, 'description', 0, columns, ['description']).includes('Nylon gland'), 'solo Description keeps full text')

const quote = {
  number: 'QG-2026-0042',
  date: '19-Aug-2026',
  title: 'Warehouse lighting enquiry',
  customer: {
    company: 'NorthRock Logistics',
    name: 'Marcus Thorne',
    location: 'Denver, CO',
    gst: '27AAACN1234F1Z9'
  },
  items: [
    { description: 'LED highbay\n150W, 5700K', quantity: '12', unit: 'Nos', rate: '4200', amount: '50400' },
    { description: 'GST 18mm gland\nIP68 nickel', quantity: '40', unit: 'Nos', rate: '18', amount: '720' },
    { description: 'Armoured cable\n4 core 2.5 sqmm', quantity: '200', unit: 'Mtr', rate: '95', amount: '19000' }
  ]
}

const wordShell = `
<table><tr>
  <td><p><strong>Quotation No.</strong></p></td><td><p>DGN-1</p></td>
  <td><p><strong>Date</strong></p></td><td><p>17-Aug-2026</p></td>
</tr><tr>
  <td><p><strong>Customer</strong></p></td><td><p>ABC Enterprises</p></td>
  <td><p><strong>Company</strong></p></td><td><p>ABC Enterprises Pvt Ltd</p></td>
</tr><tr>
  <td><p><strong>GSTIN</strong></p></td><td><p>27AABCT1234F1Z5</p></td>
  <td><p><strong>Delivery Location</strong></p></td><td><p>Mumbai, Maharashtra</p></td>
</tr></table>
<table>
  <tr><th>Sr. No.</th><th>Item</th><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Amount</th></tr>
  <tr><td>1</td><td>Sample lamp</td><td>Old spec</td><td>1</td><td>Nos</td><td>10</td><td>10</td></tr>
  <tr><td>2</td><td>Leftover sample</td><td>Should vanish</td><td>1</td><td>Nos</td><td>10</td><td>10</td></tr>
</table>
<table><tr><td>Sub Total</td><td>₹10.00</td></tr><tr><td>Grand Total</td><td>₹10.00</td></tr></table>
<p>Phone: +91 98765 43210 | Email: sales@techsolutions.example | GSTIN: 27AABCT1234F1Z5</p>
`

const filled = fillWordTemplate(wordShell, quote, columns, {}, { grandTotal: 70120, subtotal: 70120, taxTotal: 0 })
assert(filled.includes('27AAACN1234F1Z9'), 'enquiry GSTIN is written')
assert(!filled.includes('27AABCT1234F1Z5') || filled.indexOf('27AABCT1234F1Z5') > filled.indexOf('sales@techsolutions'), 'sample customer GSTIN is gone; seller GSTIN in letterhead may remain')
assert(/data-slot="customer_gst"[^>]*>27AAACN1234F1Z9/.test(filled), 'GSTIN value sits in the slot, not the label')
assert(filled.includes('LED highbay'), 'first enquiry line appears')
assert(filled.includes('GST 18mm gland'), 'GST-named product is not cut as a totals row')
assert(filled.includes('Armoured cable'), 'third enquiry line appears')
assert(!filled.includes('Sample lamp'), 'sample item is stripped')
assert(!filled.includes('Leftover sample'), 'no leftover sample lines')
assert((filled.match(/LED highbay/g) || []).length === 1, 'product name is not piled into both Item and Description')
assert(filled.includes('150W') && filled.includes('5700K'), 'spec stays in Description')
assert(filled.includes('QG-2026-0042'), 'quote number is filled')

const again = fillWordTemplate(filled, quote, columns, {}, { grandTotal: 70120, subtotal: 70120 })
assert((again.match(/data-slot="customer_gst"/g) || []).length <= 2, 're-fill does not nest extra GSTIN slots')
assert(!again.includes('data-slot="temp_value"'), 'no stray temp_value slots after fill')
assert(again.includes('LED highbay') && again.includes('Armoured cable'), 're-fill still has every enquiry line')

const scrubbedTwice = scrubTransientWordShell(scrubTransientWordShell(wordShell))
assert((scrubbedTwice.match(/data-slot="customer_gst"/g) || []).length === 1, 'double scrub keeps a single GSTIN slot')
assert(/data-slot="line_cell"/.test(scrubbedTwice), 'line body cells are slotted')
assert(collectWordSlots(scrubbedTwice).some(s => s.role === 'customer_gst' && !s.permanent), 'GSTIN slot is saved as dynamic')
assert(collectWordSlots(scrubbedTwice).some(s => s.role === 'line_items' && !s.permanent), 'line_items slot is saved')

const markedWord = markTransientWordShell(wordShell)
assert(markedWord.includes('Sample lamp'), 'upload preview still shows the sample row')
assert(markedWord.includes('data-qg-temp="1"'), 'sample values are marked for the fade')
assert(markedWord.includes('Sr. No.'), 'column headers stay visible')
assert(!/qg-temp-strip[^>]*>Sr\. No\./.test(markedWord), 'column headers are not faded')
assert(maxTempWave(markedWord) >= 1, 'line-item rows get a later fade wave')
assert(markTransientWordShell(`<p>Bank Name: HDFC Bank IFSC: HDFC0001234 Account No 123456</p>${wordShell}`).includes('HDFC0001234'), 'bank details stay')

const withChrome = `<div data-qg-permanent="header"><p>GSTIN: 27AABCT1234F1Z5</p></div>${wordShell}`
const filledChrome = fillWordTemplate(withChrome, quote, columns, {}, { grandTotal: 70120, subtotal: 70120, taxTotal: 0 })
assert(filledChrome.includes('27AABCT1234F1Z5'), 'seller GSTIN in header chrome remains')
assert(filledChrome.includes('<div data-qg-permanent="header">'), 'header wrapper remains')

const excelSheets = [{
  name: 'Quotation',
  columns: [{ index: 1, widthPx: 80 }, { index: 2, widthPx: 160 }, { index: 3, widthPx: 240 }, { index: 4, widthPx: 80 }],
  rows: [
    { index: 1, heightPx: 22, cells: [
      { col: 1, value: 'GSTIN', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' },
      { col: 2, value: '27AABCT1234F1Z5', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' }
    ]},
    { index: 2, heightPx: 22, cells: [
      { col: 1, value: 'Sr. No.', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' },
      { col: 2, value: 'Item', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' },
      { col: 3, value: 'Description / Specifications', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' },
      { col: 4, value: 'Qty', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' }
    ]},
    { index: 3, heightPx: 22, cells: [
      { col: 1, value: '1', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' },
      { col: 2, value: 'Sample A', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' },
      { col: 3, value: 'Old spec', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' },
      { col: 4, value: '1', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' }
    ]},
    { index: 4, heightPx: 22, cells: [
      { col: 1, value: 'Grand Total', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' },
      { col: 2, value: '10', formula: null, style: {}, rowSpan: 1, colSpan: 1, role: 'content' }
    ]}
  ]
}]

const markedExcel = markTransientExcelShell(excelSheets)
const markedItem = markedExcel[0].rows[2].cells.find(c => c.col === 2)
const markedHeader = markedExcel[0].rows[1].cells.find(c => c.col === 2)
assert(markedItem.value === 'Sample A', 'Excel preview keeps the sample product')
assert(Number.isFinite(markedItem.tempWave), 'Excel sample cell is tagged to fade')
assert(markedHeader.value === 'Item', 'Excel column header stays')
assert(markedHeader.tempWave == null, 'Excel column header is not faded')

const filledExcel = fillExcelTemplate(excelSheets, quote, slugColumns, {}, { grandTotal: 70120 })
const sheet = filledExcel[0]
const gstRow = sheet.rows[0]
const gstLabel = gstRow.cells.find(c => c.col === 1)
const gstValue = gstRow.cells.find(c => c.col === 2)
assert(gstLabel.value === 'GSTIN', `GSTIN label stays in its cell, got ${gstLabel.value}`)
assert(gstValue.role === 'customer_gst', `GSTIN value cell is tagged customer_gst, got ${gstValue.role}`)
assert(String(gstValue.value).includes('27AAACN1234F1Z9'), `enquiry GSTIN replaces sample, got ${gstValue.value}`)

const itemRows = sheet.rows.filter(r => (r.cells || []).some(c => Number.isInteger(c.itemIndex)))
assert(itemRows.length === 3, `every enquiry line gets a row, got ${itemRows.length}`)
const names = itemRows.map(r => r.cells.find(c => c.fieldId === 'description' || c.col === 2)?.value || '')
const specs = itemRows.map(r => r.cells.find(c => c.fieldId === 'specification' || c.col === 3)?.value || '')
assert(names[0].includes('LED highbay') && !names[0].includes('5700K'), `Item col is the name only: ${names[0]}`)
assert(specs[0].includes('5700K'), `Description col holds spec: ${specs[0]}`)
assert(names[1].includes('GST 18mm gland'), 'GST-named product still appears')
assert(names[2].includes('Armoured cable'), 'third line appears')
assert(!names.some(n => n.includes('Sample A')), 'sample product is gone')

const storePath = path.join(__dirname, '..', 'data', 'upload-templates.json')
if (fs.existsSync(storePath)) {
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'))
  const wordTpl = (store.templates || []).find(t => t.type === 'word' && /GSTIN/.test(t.content?.html || ''))
  if (wordTpl) {
    const out = fillWordTemplate(wordTpl.content.html, quote, wordTpl.mapping?.columns || columns, {}, { grandTotal: 70120, subtotal: 70120, taxTotal: 0 })
    assert(out.includes('27AAACN1234F1Z9'), `saved Word layout ${wordTpl.name}: GSTIN replaced`)
    assert(!out.includes('>27AABCT1234F1Z5<') && !out.includes('>27AABCT1234F1Z5</'), `saved Word layout ${wordTpl.name}: sample GSTIN not in a value cell`)
  }
  const north = (store.templates || []).find(t => t.type === 'word' && /Item/.test(t.content?.html || '') && /Description/.test(t.content?.html || ''))
  if (north) {
    const out = fillWordTemplate(north.content.html, quote, north.mapping?.columns || columns, {}, { grandTotal: 70120, subtotal: 70120 })
    assert(out.includes('LED highbay'), `saved Word ${north.name}: item name present`)
    assert(out.includes('Armoured cable'), `saved Word ${north.name}: last enquiry line present`)
    assert((out.match(/data-qg-field="description"/g) || []).length === 3, `saved Word ${north.name}: Item column filled 3 times`)
    assert((out.match(/data-qg-field="specification"/g) || []).length === 3, `saved Word ${north.name}: Description column filled 3 times`)
  }
  const excelTpl = (store.templates || []).find(t => (
    t.type === 'excel' &&
    (t.content?.sheets?.[0]?.rows || []).some(r =>
      lineItemHeaderScore((r.cells || []).map(c => String(c.value || ''))) >= 0
    )
  ))
  if (excelTpl) {
    const sheets = fillExcelTemplate(excelTpl.content.sheets, quote, excelTpl.mapping?.columns || columns, {}, { grandTotal: 70120 })
    const s = sheets[0]
    const filledItems = s.rows.filter(r => (r.cells || []).some(c => Number.isInteger(c.itemIndex)))
    assert(filledItems.length === 3, `saved Excel ${excelTpl.name}: ${filledItems.length} item rows`)
    const descCells = filledItems.map(r => r.cells.find(c => c.fieldId === 'description'))
    const specCells = filledItems.map(r => r.cells.find(c => c.fieldId === 'specification'))
    if (descCells[0] && specCells[0]) {
      assert(String(descCells[0].value).includes('LED highbay'), `saved Excel ${excelTpl.name}: Item has product name`)
      assert(!String(descCells[0].value).includes('5700K') || String(specCells[0].value).includes('5700K'), `saved Excel ${excelTpl.name}: spec not dumped into Item`)
    }
  }
}

if (failures.length) {
  console.error(`FAILED ${failures.length}`)
  for (const f of failures) console.error(' -', f)
  process.exit(1)
}
console.log('templateMap mapping checks passed')
