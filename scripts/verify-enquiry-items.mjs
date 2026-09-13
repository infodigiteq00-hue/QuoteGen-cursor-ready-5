/**
 * Catalog enquiry extraction — line-ref lists must keep quantity.
 * Run: node scripts/verify-enquiry-items.mjs
 */
import assert from 'node:assert/strict'
import {
  catalogItemCountHint,
  catalogItemsToQuoteRows,
  extractCatalogLineItems
} from '../server/enquiryItems.js'
import { blankItemFor } from '../shared/quoteColumns.js'

const enquiry = `1002693876
329627
NUT,HEX,MS,CADMIUM COATED,M3	
NUT,TYPE:HEXAGONAL,MATERIAL:MILD STEEL,COATING:CADMIUM,SIZE:M3,METRIC
3,600
Nos
1002693522
1037361
CIRCLIP PLIER(INNER),5-1/2IN	
ITEM NAME:CIRCLIP PLIER(INNER),SIZE:5-1/2 INCH
1
Nos
1002692418
339880
ADHESIVE,ANABOND,BTL,MM:202,20ML	
ADHESIVE,BRAND NAME:ANABOND,FORM OF SUPPLY:BOTTLE,20ML,MM:202
310
Nos`

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
  } catch (error) {
    fail += 1
    failures.push(`${name}: ${error.message}`)
  }
}

test('block enquiry keeps comma quantities', () => {
  const items = extractCatalogLineItems(enquiry)
  assert.equal(items.length, 3)
  assert.equal(catalogItemCountHint(enquiry), 3)
  assert.equal(items[0].quantity, '3600')
  assert.equal(items[0].unit, 'Nos')
  assert.equal(items[1].quantity, '1')
  assert.equal(items[2].quantity, '310')
})

test('writes qty onto a QTY. column whose id is qty, not quantity', () => {
  const items = extractCatalogLineItems(enquiry)
  const columns = [
    { id: 'description', label: 'Description', type: 'text' },
    { id: 'ourSuggested', label: 'Our suggested', type: 'text' },
    { id: 'qty', label: 'QTY.', type: 'text' },
    { id: 'unit', label: 'UOM', type: 'text' },
    { id: 'rate', label: 'Rate', type: 'text' },
    { id: 'amount', label: 'Amount', type: 'text' }
  ]
  const rows = catalogItemsToQuoteRows(items, columns, blankItemFor(columns))
  assert.equal(rows[0].qty, '3600')
  assert.equal(rows[0].unit, 'Nos')
  assert.equal(rows[0].quantity, undefined)
  assert.match(rows[0].description, /NUT,HEX/)
})

test('still fills canonical quantity / unit ids', () => {
  const items = extractCatalogLineItems(enquiry)
  const columns = [
    { id: 'description', label: 'Description', type: 'text' },
    { id: 'unit', label: 'Unit', type: 'text' },
    { id: 'quantity', label: 'Quantity', type: 'text' },
    { id: 'rate', label: 'Rate', type: 'text' },
    { id: 'amount', label: 'Amount', type: 'text' }
  ]
  const rows = catalogItemsToQuoteRows(items, columns, blankItemFor(columns))
  assert.equal(rows[0].quantity, '3600')
  assert.equal(rows[0].unit, 'Nos')
})

test('quantity and unit on the same line', () => {
  const text = `1002693876
329627
NUT,HEX,MS,CADMIUM COATED,M3
NUT,TYPE:HEXAGONAL
3,600 Nos
1002693522
1037361
CIRCLIP PLIER(INNER),5-1/2IN
ITEM NAME:CIRCLIP
1 Nos
1002692418
339880
ADHESIVE,ANABOND,BTL,MM:202,20ML
ADHESIVE,BRAND NAME:ANABOND
310 Nos`
  const items = extractCatalogLineItems(text)
  assert.equal(items.length, 3)
  assert.equal(items[0].quantity, '3600')
  assert.equal(items[0].unit, 'Nos')
  assert.equal(items[2].quantity, '310')
})

test('tab-separated enquiry rows keep quantity', () => {
  const text = [
    '1002693876\t329627\tNUT,HEX,MS,CADMIUM COATED,M3\tNUT,TYPE:HEXAGONAL\t3,600\tNos',
    '1002693522\t1037361\tCIRCLIP PLIER(INNER),5-1/2IN\tITEM NAME:CIRCLIP\t1\tNos',
    '1002692418\t339880\tADHESIVE,ANABOND\tADHESIVE,BRAND\t310\tNos'
  ].join('\n')
  const items = extractCatalogLineItems(text)
  assert.equal(items.length, 3)
  assert.equal(items[0].quantity, '3600')
  assert.equal(items[0].unit, 'Nos')
  assert.equal(items[0].shortName, 'NUT,HEX,MS,CADMIUM COATED,M3')
  assert.equal(items[1].quantity, '1')
})

test('decimal metre quantity', () => {
  const text = `1002687539
1003031
CHAIN,ROLLER,DUPLEX,1 IN,3 M
ITEM NAME:FEELER GAUGE,SIZE:4 INCH,26 LEAF SET
3.050
M
1002686254
300960
BOLT,ALLEN,MTRC COARSE,M4X10MM
BOLT,ALLEN,THREAD TYPE:METRIC COARSE
600
Nos
1002686258
325391
BOLT,HEX HD,MTRC,FULL THD,HTS,M10X50MM
BOLT,HEXAGONAL HEAD
280
Nos`
  const items = extractCatalogLineItems(text)
  assert.equal(items.length, 3)
  assert.equal(items[0].quantity, '3.050')
  assert.equal(items[0].unit, 'M')
})

test('Series Number column gets Purchase Requisition (line ref), not material', () => {
  const items = extractCatalogLineItems(enquiry)
  const columns = [
    { id: 'description', label: 'Description', type: 'text' },
    { id: 'seriesNumber', label: 'Series Number', type: 'text' },
    { id: 'qty', label: 'QTY.', type: 'text' },
    { id: 'unit', label: 'UOM', type: 'text' }
  ]
  const rows = catalogItemsToQuoteRows(items, columns, blankItemFor(columns))
  assert.equal(rows[0].seriesNumber, '1002693876')
  assert.equal(rows[1].seriesNumber, '1002693522')
  assert.match(rows[0].description, /NUT,HEX/)
  assert.ok(!String(rows[0].description).includes('1002693876'))
})

test('Item Number still maps material code; PR No maps line ref when both exist', () => {
  const items = extractCatalogLineItems(enquiry)
  const columns = [
    { id: 'description', label: 'Description', type: 'text' },
    { id: 'prNo', label: 'PR No.', type: 'text' },
    { id: 'itemNumber', label: 'Item Number', type: 'text' },
    { id: 'quantity', label: 'Quantity', type: 'text' },
    { id: 'unit', label: 'Unit', type: 'text' }
  ]
  const rows = catalogItemsToQuoteRows(items, columns, blankItemFor(columns))
  assert.equal(rows[0].prNo, '1002693876')
  assert.equal(rows[0].itemNumber, '329627')
  assert.equal(rows[0].quantity, '3600')
})

console.log(`${pass} passed, ${fail} failed`)
if (failures.length) {
  for (const line of failures) console.error(line)
  process.exit(1)
}
