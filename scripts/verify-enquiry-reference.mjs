/**
 * Enquiry reference extraction — blank is valid.
 * Run: node scripts/verify-enquiry-reference.mjs
 */
import assert from 'node:assert/strict'
import { extractEnquiryReference } from '../shared/enquiryReference.js'

let pass = 0
let fail = 0

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok   ${name}`)
  } catch (error) {
    fail++
    console.log(`  FAIL ${name}\n       ${error.message}`)
  }
}

test('pulls Ref No from enquiry', () => {
  assert.equal(extractEnquiryReference('Dear Sir,\nYour Ref No: IND/24/8891\nPlease quote MS plates'), 'IND/24/8891')
})

test('pulls Enquiry No', () => {
  assert.equal(extractEnquiryReference('Enquiry No. ENQ-2026-11 for valves'), 'ENQ-2026-11')
})

test('blank when none present', () => {
  assert.equal(extractEnquiryReference('Please quote 10 pcs flanges as discussed.'), '')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
