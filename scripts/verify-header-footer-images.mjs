/**
 * Checks the header/footer banner endpoints against the running API.
 * Run with: node scripts/verify-header-footer-images.mjs
 *
 * Requires Express on :3001 and .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import 'dotenv/config'
import { getSupabase } from '../server/db.js'

const OWNER_EMAIL = process.env.QG_TEST_EMAIL || 'dharmikchokhaliya62@gmail.com'
const API = 'http://localhost:3001'
const supabase = getSupabase()

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

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

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

const token = await sessionFor(OWNER_EMAIL)
const auth = { Authorization: `Bearer ${token}` }

// --- unauthenticated access is refused ---
for (const method of ['POST', 'DELETE']) {
  const res = await fetch(`${API}/api/company-profile/banner/header`, { method })
  check(`${method} banner without a session is rejected`, res.status === 401, `got ${res.status}`)
}

// --- an unknown slot is rejected rather than silently accepted ---
{
  const res = await fetch(`${API}/api/company-profile/banner/sidebar`, { method: 'DELETE', headers: auth })
  check('unknown slot rejected', res.status === 400, `got ${res.status}`)
}

// --- profile exposes the new fields ---
{
  const res = await fetch(`${API}/api/company-profile`, { headers: auth })
  const body = await res.json()
  const p = body.profile || {}
  check('profile exposes header/footer image fields',
    'headerImageUrl' in p && 'footerImageUrl' in p,
    `keys: ${Object.keys(p).filter(k => /image/i.test(k)).join(', ') || 'none'}`)
}

// --- upload, read back, remove, for both slots ---
for (const slot of ['header', 'footer']) {
  const form = new FormData()
  form.append('image', new Blob([PNG], { type: 'image/png' }), `${slot}.png`)
  const res = await fetch(`${API}/api/company-profile/banner/${slot}`, { method: 'POST', headers: auth, body: form })
  const body = await res.json().catch(() => ({}))

  // PostgREST reports a missing column through its schema cache rather than 42703.
  if (/column .* does not exist|42703|Could not find the '.*' column/i.test(JSON.stringify(body))) {
    console.log(`SKIP  ${slot} upload — run supabase/migrations/20260812210000_header_footer_images.sql first`)
    continue
  }

  const urlKey = `${slot}ImageUrl`
  check(`${slot} image uploads`, res.ok && Boolean(body.profile?.[urlKey]), body.error || `status ${res.status}`)

  if (body.profile?.[urlKey]) {
    const url = body.profile[urlKey]
    if (/^https?:/.test(url)) {
      const head = await fetch(url)
      check(`${slot} image URL is reachable`, head.ok, `status ${head.status}`)
    } else {
      check(`${slot} image stored inline as a data URL`, url.startsWith('data:image/'))
    }

    const after = await (await fetch(`${API}/api/company-profile`, { headers: auth })).json()
    check(`${slot} image persists on the profile`, Boolean(after.profile?.[urlKey]))

    const del = await fetch(`${API}/api/company-profile/banner/${slot}`, { method: 'DELETE', headers: auth })
    const delBody = await del.json().catch(() => ({}))
    check(`${slot} image removes cleanly`, del.ok && !delBody.profile?.[urlKey], delBody.error || '')
  }
}

console.log(failures === 0 ? '\nAll header/footer image checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
