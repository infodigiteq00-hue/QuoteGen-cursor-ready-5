/**
 * Proves per-account isolation against the running API.
 *
 *   node scripts/verify-tenant-isolation.mjs
 *
 * Run this after applying supabase/apply_multi_tenant.sql. It signs in as the
 * real account (via an admin-generated magic link, so no password and no email
 * is needed), then creates a throwaway second account and checks it sees an
 * empty workspace. The throwaway account is always deleted again.
 *
 * Requires: Express running on :3001, and .env with SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY.
 */
import 'dotenv/config'
import { getSupabase } from '../server/db.js'

const API = process.env.QUOTEGEN_API || 'http://localhost:3001'
const OWNER_EMAIL = 'dharmikchokhaliya62@gmail.com'

const supabase = getSupabase()
let failures = 0

function check(label, passed, detail = '') {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures++
}

async function api(path, token) {
  const res = await fetch(`${API}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
  let body = null
  try { body = await res.json() } catch { /* empty body */ }
  return { status: res.status, body }
}

/** A session for an existing account without needing its password. */
async function sessionFor(email) {
  const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`generateLink(${email}): ${error.message}`)
  const { data: verified, error: vErr } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: 'magiclink'
  })
  if (vErr) throw new Error(`verifyOtp(${email}): ${vErr.message}`)
  return verified.session.access_token
}

console.log('QuoteGen per-account isolation\n')

// -- 0. schema present? -------------------------------------------------------
console.log('Schema')
const probe = await supabase.from('quotations').select('user_id').limit(1)
if (probe.error) {
  console.log(`  FAIL user_id columns are missing — ${probe.error.message}`)
  console.log('\n  Apply supabase/apply_multi_tenant.sql in the Supabase SQL Editor first.')
  process.exit(1)
}
check('user_id columns exist', true)

const rpc = await supabase.rpc('allocate_quotation_number', { p_user_id: null })
check(
  'allocate_quotation_number is per-account',
  !/Could not find the function/i.test(rpc.error?.message || ''),
  rpc.error?.message?.slice(0, 60)
)

// -- 1. unauthenticated access ------------------------------------------------
console.log('\nUnauthenticated access is refused')
for (const path of ['/api/quotations', '/api/products', '/api/company-profile', '/api/health/persistence']) {
  const { status } = await api(path)
  check(`${path} -> 401`, status === 401, `got ${status}`)
}

// -- 2. the owner still sees their data --------------------------------------
console.log(`\nOwner (${OWNER_EMAIL}) keeps their data`)
const ownerToken = await sessionFor(OWNER_EMAIL)
const ownerQuotes = await api('/api/quotations', ownerToken)
const ownerProducts = await api('/api/products', ownerToken)
const ownerProfile = await api('/api/company-profile', ownerToken)
const ownerKnowledge = await api('/api/knowledge-documents', ownerToken)
const ownerSeries = await api('/api/quotation-series/peek', ownerToken)

const countOf = (r) => Array.isArray(r.body) ? r.body.length
  : Array.isArray(r.body?.quotations) ? r.body.quotations.length
    : Array.isArray(r.body?.products) ? r.body.products.length
      : Array.isArray(r.body?.documents) ? r.body.documents.length : null

check('quotations load', ownerQuotes.status === 200, `HTTP ${ownerQuotes.status}`)
console.log(`       quotations: ${countOf(ownerQuotes)}`)
check('products load', ownerProducts.status === 200, `HTTP ${ownerProducts.status}`)
console.log(`       products: ${countOf(ownerProducts)}`)
check('knowledge documents load', ownerKnowledge.status === 200, `HTTP ${ownerKnowledge.status}`)
console.log(`       documents: ${countOf(ownerKnowledge)}`)
check('company profile loads', ownerProfile.status === 200, `HTTP ${ownerProfile.status}`)
console.log(`       company: ${JSON.stringify(ownerProfile.body?.profile?.companyName ?? ownerProfile.body?.companyName ?? null)}`)
check('series peek works', ownerSeries.status === 200, `HTTP ${ownerSeries.status}`)
console.log(`       next number: ${ownerSeries.body?.number}`)

// -- 3. a brand new account sees nothing -------------------------------------
console.log('\nA second account sees an empty workspace')
const email = `qg.isolation.${Date.now()}@example.com`
const password = 'TestPass123!'
const { data: madeUser, error: makeErr } = await supabase.auth.admin.createUser({
  email, password, email_confirm: true
})
if (makeErr) { console.log('  FAIL could not create throwaway account:', makeErr.message); process.exit(1) }

try {
  const { data: signedIn, error: sErr } = await supabase.auth.signInWithPassword({ email, password })
  if (sErr) throw new Error(sErr.message)
  const otherToken = signedIn.session.access_token

  const theirQuotes = await api('/api/quotations', otherToken)
  const theirProducts = await api('/api/products', otherToken)
  const theirKnowledge = await api('/api/knowledge-documents', otherToken)
  const theirProfile = await api('/api/company-profile', otherToken)
  const theirSeries = await api('/api/quotation-series/next', otherToken)

  check('sees 0 quotations', countOf(theirQuotes) === 0, `saw ${countOf(theirQuotes)}`)
  check('sees 0 products', countOf(theirProducts) === 0, `saw ${countOf(theirProducts)}`)
  check('sees 0 knowledge documents', countOf(theirKnowledge) === 0, `saw ${countOf(theirKnowledge)}`)

  const ownerCompany = ownerProfile.body?.profile?.companyName ?? ownerProfile.body?.companyName
  const theirCompany = theirProfile.body?.profile?.companyName ?? theirProfile.body?.companyName
  check(
    'gets its own company branding, not the owner\'s',
    theirCompany !== ownerCompany || !ownerCompany,
    `owner=${JSON.stringify(ownerCompany)} other=${JSON.stringify(theirCompany)}`
  )

  check(
    'gets its own quotation series counter',
    theirSeries.body?.allocated === 1,
    `owner next=${ownerSeries.body?.number}, new account got ${theirSeries.body?.number} (allocated ${theirSeries.body?.allocated})`
  )
  console.log(`       owner series: ${ownerSeries.body?.number} | new account series: ${theirSeries.body?.number}`)

  // Cross-account read by id must not work.
  const ownerFirstId = (Array.isArray(ownerQuotes.body) ? ownerQuotes.body : ownerQuotes.body?.quotations)?.[0]?.id
  if (ownerFirstId) {
    const stolen = await api(`/api/quotations/${ownerFirstId}`, otherToken)
    check('cannot fetch the owner\'s quotation by id', stolen.status === 404 || stolen.status === 403, `HTTP ${stolen.status}`)
  }
} finally {
  await supabase.auth.admin.deleteUser(madeUser.user.id)
  console.log('\nthrowaway account deleted')
}

console.log(`\n${failures === 0 ? 'All isolation checks passed.' : `${failures} check(s) FAILED.`}`)
process.exit(failures === 0 ? 0 : 1)
