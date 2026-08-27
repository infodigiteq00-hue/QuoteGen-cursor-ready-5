/**
 * Export slices must keep rows and closing blocks intact.
 * Run: node scripts/verify-export-slices.mjs
 */
import assert from 'node:assert/strict'
import { packExportSlices } from '../src/exportSlices.js'

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

test('a short quote stays on one page', () => {
  const slices = packExportSlices([
    { top: 0, bottom: 120, kind: 'item' },
    { top: 120, bottom: 200, kind: 'item' },
    { top: 200, bottom: 360, kind: 'close' }
  ], 1123)
  assert.equal(slices.length, 1)
  assert.equal(slices[0].y, 0)
  assert.ok(slices[0].h > 360)
})

test('a row that would be cut in half moves to the next page', () => {
  const slices = packExportSlices([
    { top: 0, bottom: 800, kind: 'item' },
    { top: 800, bottom: 1050, kind: 'item' }
  ], 1000)
  assert.equal(slices.length, 2)
  assert.equal(slices[0].y, 0)
  assert.ok(slices[0].h <= 800)
  assert.equal(slices[1].y, 800)
  assert.ok(slices[1].h >= 250)
})

test('totals and sign-off stay together when they fit', () => {
  const slices = packExportSlices([
    { top: 0, bottom: 900, kind: 'item' },
    { top: 900, bottom: 1040, kind: 'close' },
    { top: 1040, bottom: 1280, kind: 'close' }
  ], 1000)
  assert.equal(slices.length, 2)
  assert.ok(slices[0].h <= 900)
  assert.equal(slices[1].y, 900)
  assert.ok(slices[1].h >= 380)
})

test('empty leftover height does not become its own page', () => {
  const slices = packExportSlices([
    { top: 0, bottom: 400, kind: 'item' },
    { top: 400, bottom: 410, kind: 'row' }
  ], 1000, { pad: 8, minTail: 28 })
  assert.equal(slices.length, 1)
})

console.log(`${pass} passed, ${fail} failed`)
if (fail) {
  for (const item of failures) console.error(item)
  process.exit(1)
}
