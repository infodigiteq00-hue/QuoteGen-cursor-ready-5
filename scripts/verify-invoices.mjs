/**
 * Checks quotation -> sales invoice conversion against the running API.
 * Run with: node scripts/verify-invoices.mjs
 *
 * Requires Express on :3001 and .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Creates and deletes its own test documents.
 */
import 'dotenv/config'
import { getSupabase } from '../server/db.js'

const OWNER_EMAIL = process.env.QG_TEST_EMAIL || 'dharmikchokhaliya62@gmail.com'
const API = 'http://localhost:3001'
const supabase = getSupabase()

let failures = 0
const created = []

function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function sessionFor(email) {
  const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`generateLink: ${error.message}`)
  const { data: v, error: vErr } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: 'magiclink'
  })
  if (vErr) throw new Error(`verifyOtp: ${vErr.message}`)
  return v.session.access_token
}

const token = await sessionFor(OWNER_EMAIL)
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function makeQuote(customer) {
  const res = await fetch(`${API}/api/quotations`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      title: 'Invoice conversion test',
      number: 'TEST-CONV',
      columns: [
        { id: 'description', label: 'Description', type: 'text' },
        { id: 'quantity', label: 'Qty', type: 'text' },
        { id: 'rate', label: 'Rate', type: 'text' },
        { id: 'amount', label: 'Amount', type: 'text' },
        { id: 'gst', label: 'GST', type: 'tax' }
      ],
      items: [{ description: 'SS 304 Flange', quantity: '4', rate: '250', amount: '1000', gst__rate: '18', gst__amount: '180.00', gst__src: 'rate' }],
      customer
    })
  })
  const body = await res.json()
  if (body.quotation?.id) created.push(body.quotation.id)
  return body.quotation
}

async function convert(id, extra = {}) {
  const res = await fetch(`${API}/api/quotations/${id}/convert-to-invoice`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(extra)
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

// --- auth ---
{
  const res = await fetch(`${API}/api/quotations/00000000-0000-0000-0000-000000000000/convert-to-invoice`, { method: 'POST' })
  check('conversion requires a session', res.status === 401, `got ${res.status}`)
}

// --- GST is mandatory ---
const noGst = await makeQuote({ name: 'No GST Ltd', company: 'No GST Ltd', gst: '', location: 'Pune' })
{
  const { status, body } = await convert(noGst.id)
  check('conversion refused without a customer GST number', status === 400 && body.code === 'GST_REQUIRED', `${status} ${body.code || body.error || ''}`)
}
{
  const { status, body } = await convert(noGst.id, { customerGst: '   ' })
  check('whitespace-only GST is still refused', status === 400 && body.code === 'GST_REQUIRED', `${status} ${body.code || ''}`)
}

// --- GST supplied in the request body (before autosave lands) ---
{
  const { status, body } = await convert(noGst.id, { customerGst: '27ABCDE1234F1Z5' })
  if (/does not exist|schema cache|Could not find/i.test(JSON.stringify(body))) {
    console.log('SKIP  conversion — run supabase/migrations/20260812220000_sales_invoices.sql first')
    console.log(failures === 0 ? '\nChecks that do not need the migration passed.' : `\n${failures} check(s) failed.`)
    for (const id of created) await fetch(`${API}/api/quotations/${id}`, { method: 'DELETE', headers: auth })
    process.exit(failures === 0 ? 0 : 1)
  }
  check('GST passed in the request is accepted', status === 201, `${status} ${body.error || ''}`)
  if (body.invoice?.id) created.push(body.invoice.id)
  check('invoice records the GST it was given', body.invoice?.data?.customer?.gst === '27ABCDE1234F1Z5', body.invoice?.data?.customer?.gst)
}

// --- full conversion from a quote that already has a GSTIN ---
const quote = await makeQuote({ name: 'Acme Steel', company: 'Acme Steel Pvt Ltd', gst: '27AAAAA0000A1Z5', location: 'Mumbai' })
const { status, body } = await convert(quote.id)
check('conversion succeeds', status === 201, `${status} ${body.error || ''}`)
const invoice = body.invoice
if (invoice?.id) created.push(invoice.id)

if (invoice) {
  check('invoice is typed as an invoice', invoice.docType === 'invoice', invoice.docType)
  check('invoice links back to the quotation', invoice.sourceQuotationId === quote.id)
  check('invoice number comes from the invoice series, not the quote series',
    Boolean(invoice.number) && invoice.number !== quote.number, `${quote.number} -> ${invoice.number}`)
  check('line items and typed columns carry over',
    invoice.data?.items?.[0]?.gst__amount === '180.00' && invoice.data?.columns?.some(c => c.type === 'tax'),
    JSON.stringify(invoice.data?.items?.[0]?.gst__amount))
  check('invoice is dated today', invoice.date === new Date().toISOString().slice(0, 10), invoice.date)

  // numbering increments
  const second = await makeQuote({ name: 'Acme Steel', company: 'Acme', gst: '27AAAAA0000A1Z5', location: 'Mumbai' })
  const { body: secondBody } = await convert(second.id)
  if (secondBody.invoice?.id) created.push(secondBody.invoice.id)
  check('each invoice gets the next number in its own series',
    secondBody.invoice?.number && secondBody.invoice.number !== invoice.number,
    `${invoice.number} then ${secondBody.invoice?.number}`)

  // --- the user's own number wins over the series ---
  {
    const custom = `MY/INV/${Date.now()}`
    const q = await makeQuote({ name: 'Custom Number Co', company: 'CNC', gst: '27CCCCC0000C1Z5', location: 'Nashik' })
    const { status: s, body: b } = await convert(q.id, { number: custom })
    if (b.invoice?.id) created.push(b.invoice.id)
    check('a user-supplied invoice number is used verbatim', s === 201 && b.invoice?.number === custom, `${s} ${b.invoice?.number || b.error || ''}`)

    // reusing it must be refused, so two documents can't share a number
    const q2 = await makeQuote({ name: 'Custom Number Co', company: 'CNC', gst: '27CCCCC0000C1Z5', location: 'Nashik' })
    const dup = await convert(q2.id, { number: custom })
    check('a duplicate invoice number is refused', dup.status === 409 && dup.body.code === 'NUMBER_IN_USE', `${dup.status} ${dup.body.code || ''}`)

    // a blank number falls back to the series rather than saving an empty one
    const blank = await convert(q2.id, { number: '   ' })
    if (blank.body.invoice?.id) created.push(blank.body.invoice.id)
    check('a blank number falls back to the series', blank.status === 201 && Boolean(blank.body.invoice?.number), `${blank.status} ${blank.body.invoice?.number || ''}`)
  }

  // --- keeping the suggested number still advances the counter ---
  {
    const peek1 = await (await fetch(`${API}/api/invoice-series/peek`, { headers: auth })).json()
    const q = await makeQuote({ name: 'Series Co', company: 'Series Co', gst: '27SSSSS0000S1Z5', location: 'Surat' })
    const { body: b } = await convert(q.id, { number: peek1.number })
    if (b.invoice?.id) created.push(b.invoice.id)
    const peek2 = await (await fetch(`${API}/api/invoice-series/peek`, { headers: auth })).json()
    check('accepting the suggested number advances the series',
      peek2.number !== peek1.number,
      `${peek1.number} -> next suggestion ${peek2.number}`)
  }

  // an invoice cannot be converted again
  const again = await convert(invoice.id)
  check('an invoice cannot be converted again', again.status === 400 && again.body.code === 'ALREADY_INVOICE', `${again.status} ${again.body.code || ''}`)

  // the source quotation is untouched
  const src = await (await fetch(`${API}/api/quotations/${quote.id}`, { headers: auth })).json()
  check('the original quotation is left as a quotation',
    (src.quotation?.docType || 'quotation') === 'quotation' && src.quotation?.number === quote.number)

  // invoices appear in the list with their type
  const list = await (await fetch(`${API}/api/quotations?limit=50`, { headers: auth })).json()
  const listed = (list.quotations || []).find(q => q.id === invoice.id)
  check('invoice appears in the document list as an invoice', listed?.docType === 'invoice', listed?.docType)
}

// --- another account cannot convert this quotation ---
{
  const email = `qg.invoice.${Date.now()}@example.com`
  const password = `Pw-${Math.random().toString(36).slice(2)}A1!`
  const { data: made, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (!error) {
    const { data: signed } = await supabase.auth.signInWithPassword({ email, password })
    const res = await fetch(`${API}/api/quotations/${quote.id}/convert-to-invoice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signed.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    check('another account cannot convert your quotation', res.status === 404, `got ${res.status}`)
    await supabase.auth.admin.deleteUser(made.user.id)
  } else {
    console.log('SKIP  cross-account check —', error.message)
  }
}

for (const id of created) {
  await fetch(`${API}/api/quotations/${id}`, { method: 'DELETE', headers: auth })
}
console.log(`\ncleaned up ${created.length} test document(s)`)
console.log(failures === 0 ? 'All invoice checks passed.' : `${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
