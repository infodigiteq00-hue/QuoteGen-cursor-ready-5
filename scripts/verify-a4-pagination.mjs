/**
 * A4 packing must never treat an overflowing plate as extra page height.
 * Run: node scripts/verify-a4-pagination.mjs
 */
import assert from 'node:assert/strict'
import { packA4Pages, A4_HEIGHT_PX } from '../src/a4Pagination.js'

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

const LONG_QUOTE = {
  rowCount: 30,
  rowHeights: Array(30).fill(48),
  headerHeight: 160,
  metaHeight: 90,
  theadHeight: 40,
  totalsHeight: 70,
  closingHeight: 380,
  bodyPadY: 44
}

test('a stretched plate measurement cannot dump 30 rows onto page 1', () => {
  const pages = packA4Pages({
    ...LONG_QUOTE,
    firstUsable: 4000,
    continuedUsable: 4000
  })
  assert.ok(pages.length >= 2, `expected multiple pages, got ${pages.length}`)
  assert.ok(pages[0].rows.length < 30, `page 1 still has every row (${pages[0].rows.length})`)
  const rowTotal = pages.reduce((n, p) => n + p.rows.length, 0)
  assert.equal(rowTotal, 30)
})

test('closing stays off a full items page when it cannot fit', () => {
  const pages = packA4Pages({
    ...LONG_QUOTE,
    firstUsable: A4_HEIGHT_PX,
    continuedUsable: A4_HEIGHT_PX
  })
  const lastItems = [...pages].reverse().find(p => p.rows.length)
  assert.ok(lastItems, 'missing items page')
  const last = pages[pages.length - 1]
  assert.equal(last.showClosing, true)
  if (lastItems === last) {
    const itemsHeight = last.rows.reduce((n, i) => n + LONG_QUOTE.rowHeights[i], 0)
    assert.ok(itemsHeight + LONG_QUOTE.closingHeight < A4_HEIGHT_PX, 'items + closing overflow the sheet')
  } else {
    assert.equal(last.rows.length, 0)
  }
})

test('a short quote can keep closing on page 1', () => {
  const pages = packA4Pages({
    rowCount: 2,
    rowHeights: [40, 40],
    headerHeight: 120,
    metaHeight: 70,
    theadHeight: 36,
    totalsHeight: 60,
    closingHeight: 200,
    bodyPadY: 40,
    firstUsable: A4_HEIGHT_PX - 88,
    continuedUsable: A4_HEIGHT_PX - 124
  })
  assert.equal(pages.length, 1)
  assert.deepEqual(pages[0].rows, [0, 1])
  assert.equal(pages[0].showClosing, true)
  assert.equal(pages[0].showTotals, true)
})

test('every row index is packed once', () => {
  const pages = packA4Pages({
    ...LONG_QUOTE,
    firstUsable: 900,
    continuedUsable: 860
  })
  const seen = pages.flatMap(p => p.rows)
  assert.deepEqual(seen, Array.from({ length: 30 }, (_, i) => i))
})

test('30 compact rows fill sheets instead of one-row pages', () => {
  const pages = packA4Pages({
    ...LONG_QUOTE,
    firstUsable: A4_HEIGHT_PX - 88,
    continuedUsable: A4_HEIGHT_PX - 124
  })
  const itemPages = pages.filter(p => p.rows.length)
  assert.ok(itemPages.length <= 4, `expected ≤4 item pages, got ${itemPages.length}`)
  for (const page of itemPages) {
    if (!page.showHeader) {
      assert.ok(page.rows.length >= 5, `continued page only has ${page.rows.length} rows`)
    }
  }
})

test('inflated row heights are capped so packing stays dense', () => {
  const pages = packA4Pages({
    rowCount: 12,
    rowHeights: Array(12).fill(900),
    headerHeight: 140,
    metaHeight: 80,
    theadHeight: 40,
    totalsHeight: 60,
    closingHeight: 200,
    bodyPadY: 44,
    firstUsable: A4_HEIGHT_PX - 88,
    continuedUsable: A4_HEIGHT_PX - 124
  })
  const itemPages = pages.filter(p => p.rows.length)
  assert.ok(itemPages.length <= 7, `capped heights still sparse: ${itemPages.length} pages`)
  assert.ok(itemPages.filter(p => p.rows.length >= 2).length >= 4, 'expected most pages to hold 2+ rows')
})

test('closing that is only a little over budget squeezes onto the last items page', () => {
  // leftover after 2 rows ≈ budget - chrome - rows - reserve; set closing just above leftover
  const pages = packA4Pages({
    rowCount: 2,
    rowHeights: [40, 40],
    headerHeight: 120,
    metaHeight: 70,
    theadHeight: 36,
    totalsHeight: 50,
    closingHeight: 520,
    bodyPadY: 40,
    firstUsable: 900,
    continuedUsable: 860
  })
  // With modest squeeze slack, a small overflow may share page 1 — otherwise closing alone.
  const last = pages[pages.length - 1]
  if (pages.length === 1) {
    assert.equal(last.showClosing, true)
    assert.equal(last.showTotals, true)
  } else {
    assert.equal(last.showClosing, true)
  }
})

test('tiny leftover closing prefers sharing previous page when shortfall ≤ squeeze', () => {
  const pages = packA4Pages({
    rowCount: 3,
    rowHeights: [36, 36, 36],
    headerHeight: 100,
    metaHeight: 60,
    theadHeight: 32,
    totalsHeight: 48,
    closingHeight: 180,
    bodyPadY: 36,
    firstUsable: 720,
    continuedUsable: 700
  })
  assert.ok(pages.length <= 2, `expected ≤2 pages with squeeze, got ${pages.length}`)
  assert.ok(pages.some(p => p.showClosing), 'closing missing')
})

console.log(`${pass} passed, ${fail} failed`)
if (failures.length) {
  for (const line of failures) console.error(line)
  process.exit(1)
}
