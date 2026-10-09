import crypto from 'node:crypto'
import { getSupabase, isSupabaseConfigured } from './db.js'
import { readDemoLeadByCode } from './googleSheetLead.js'
import { findAuthUserByEmail, markMetaAdsLeadStage, ensureConfirmedMetaTrialUser } from './metaAdsLeads.js'
import { applyPaymentCredits } from './accountAccess.js'
import { sendAdminEmail } from './mail.js'

const OFFER_PRICE = 399
const REGULAR_PRICE = 799
const OFFER_MS = 10 * 60 * 1000
const OFFER_GRACE_MS = 2 * 60 * 1000

// Server-side prices. The billing screen must not be able to name its own amount.
const PLAN_PRICES = {
  starter: { name: 'Starter', monthly: 399, yearly: 3990 },
  growth: { name: 'Growth', monthly: 799, yearly: 7990 },
  business: { name: 'Business', monthly: 1599, yearly: 15990 },
  pro: { name: 'Pro', monthly: 2999, yearly: 29990 },
  enterprise: { name: 'Enterprise', monthly: 4999, yearly: 49990 },
  scale: { name: 'Scale', monthly: 8999, yearly: 89990 }
}
const LANDING2_PRICES = {
  landing2: { price: 199, label: 'QuoteGen monthly entry ₹199', message: 'QuoteGen entry ₹199' },
  landing2_wa: { price: 248, label: 'QuoteGen monthly entry ₹199 + WhatsApp ₹49', message: 'QuoteGen entry + WhatsApp ₹248' }
}

const DEMO_PACK_PRICES = {
  demo_lite_year: { price: 999, label: 'QuoteGen Starter yearly ₹999' },
  demo_lite_month: { price: 99, label: 'QuoteGen Starter monthly ₹99' },
  demo_growth_year: { price: 2499, label: 'QuoteGen Growth yearly ₹2499' },
  demo_growth_month: { price: 249, label: 'QuoteGen Growth monthly ₹249' },
  demo_pro_year: { price: 3999, label: 'QuoteGen Pro yearly ₹3999' },
  demo_pro_month: { price: 399, label: 'QuoteGen Pro monthly ₹399' },
  demo_business_year: { price: 5999, label: 'QuoteGen Business yearly ₹5999' },
  demo_business_month: { price: 599, label: 'QuoteGen Business monthly ₹599' },
  demo_scale_year: { price: 9999, label: 'QuoteGen Scale yearly ₹9999' },
  demo_scale_month: { price: 999, label: 'QuoteGen Scale monthly ₹999' }
}
const TOPUP_PRICES = {
  25: { label: '+25 Quotations', price: 199 },
  100: { label: '+100 Quotations', price: 499 },
  250: { label: '+250 Quotations', price: 999 }
}

function resolveCharge(body) {
  const product = String(body?.product || '').trim().toLowerCase()
  if (!product || product === 'trial') {
    const offerStartedAt = Number(body?.offerStartedAt)
    const offerLive = Number.isFinite(offerStartedAt)
      && offerStartedAt <= Date.now()
      && Date.now() - offerStartedAt < OFFER_MS + OFFER_GRACE_MS
    const price = offerLive ? OFFER_PRICE : REGULAR_PRICE
    return { price, label: `QuoteGen monthly ₹${price}`, message: `QuoteGen monthly plan ₹${price}` }
  }
  const landing2 = LANDING2_PRICES[product]
  if (landing2) {
    // Pay-first landing always stays at entry price (₹199 / ₹248) — list price is display-only.
    return { price: landing2.price, label: landing2.label, message: landing2.message, landing2: true }
  }
  const demoPack = DEMO_PACK_PRICES[product]
  if (demoPack) {
    return { price: demoPack.price, label: demoPack.label, message: demoPack.label }
  }
  if (product === 'plan') {
    const plan = PLAN_PRICES[String(body?.plan || '').trim().toLowerCase()]
    const period = body?.period === 'yearly' ? 'yearly' : body?.period === 'monthly' ? 'monthly' : ''
    if (!plan || !period) return { error: 'Choose a plan to continue.' }
    const price = plan[period]
    const when = period === 'yearly' ? 'yearly' : 'monthly'
    return { price, label: `${plan.name} ${when} ₹${price}`, message: `QuoteGen ${plan.name} ${when} ₹${price}` }
  }
  if (product === 'topup') {
    const pack = TOPUP_PRICES[String(body?.topup || '').trim()]
    if (!pack) return { error: 'Choose a top-up to continue.' }
    return { price: pack.price, label: `${pack.label} ₹${pack.price}`, message: `QuoteGen ${pack.label} ₹${pack.price}` }
  }
  return { error: 'Choose a plan to continue.' }
}

async function resolveRequestCharge(body) {
  const requestId = String(body?.requestId || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'This payment request is no longer available.' }
  }
  if (!isSupabaseConfigured()) return { error: 'Online payment is not set up yet.' }
  const { data, error } = await getSupabase()
    .from('payment_requests')
    .select('id, email, amount, label, status')
    .eq('id', requestId)
    .maybeSingle()
  if (error || !data || data.status !== 'pending' || data.email !== email) {
    return { error: 'This payment request is no longer available.' }
  }
  const price = Number(data.amount)
  if (!Number.isFinite(price) || price < 1) return { error: 'This payment request is no longer available.' }
  return {
    price,
    label: data.label,
    message: `QuoteGen ${data.label}`.slice(0, 120),
    requestRowId: data.id
  }
}

/** Demo checkout creates a login shell before payment, with no password yet. */
async function accountStillNeedsPassword(email) {
  try {
    const user = await findAuthUserByEmail(getSupabase(), email)
    if (!user?.id) return true
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .select('password_set_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) return true
    return !data?.password_set_at
  } catch (error) {
    console.error('[phonepe] password check failed', error?.message)
    return true
  }
}

const HOSTS = {
  sandbox: {
    token: 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token',
    pg: 'https://api-preprod.phonepe.com/apis/pg-sandbox'
  },
  production: {
    token: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token',
    pg: 'https://api.phonepe.com/apis/pg'
  }
}

function config() {
  const clientId = process.env.PHONEPE_CLIENT_ID?.trim()
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET?.trim()
  const clientVersion = process.env.PHONEPE_CLIENT_VERSION?.trim() || '1'
  const env = process.env.PHONEPE_ENV?.trim().toLowerCase() === 'production' ? 'production' : 'sandbox'
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret, clientVersion, env, hosts: HOSTS[env] }
}

let cachedToken = null

async function getToken(cfg) {
  const nowSec = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.env === cfg.env && cachedToken.expiresAt - 60 > nowSec) {
    return cachedToken.value
  }
  const response = await fetch(cfg.hosts.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_version: cfg.clientVersion,
      client_secret: cfg.clientSecret,
      grant_type: 'client_credentials'
    })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.message || data?.error_description || `PhonePe auth failed (${response.status})`)
  }
  cachedToken = {
    env: cfg.env,
    value: data.access_token,
    expiresAt: Number(data.expires_at) || nowSec + 600
  }
  return cachedToken.value
}

function publicOrigin(req) {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
  if (configured) return configured
  const origin = String(req.headers.origin || '').replace(/\/+$/, '')
  if (/^https?:\/\/[^/]+$/.test(origin)) return origin
  return `${req.protocol}://${req.get('host')}`
}

function clip(v, max) {
  return String(v || '').trim().slice(0, max)
}

const notifiedOrders = new Set()

export function registerPublicPhonePeRoutes(app) {
  app.get('/api/pay/quotation/:demoCode/:amount', async (req, res) => {
    const demoCode = Number(req.params.demoCode)
    const amount = Number(req.params.amount)
    if (!Number.isInteger(demoCode) || demoCode < 2 || !Number.isInteger(amount) || amount < 1 || !isSupabaseConfigured()) {
      return res.status(404).json({ error: 'This payment link is not available.' })
    }
    try {
      const lead = await readDemoLeadByCode(demoCode)
      const email = String(lead?.email || '').trim().toLowerCase()
      if (!email) return res.status(404).json({ error: 'This payment link is not available.' })
      const { data, error } = await getSupabase()
        .from('payment_requests')
        .select('id, email, amount, label, quotes_per_month, period, valid_till, status')
        .eq('email', email)
        .eq('amount', amount)
        .in('status', ['pending', 'paid'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) return res.status(404).json({ error: 'This payment link is not available.' })
      return res.json({
        paid: data.status === 'paid',
        request: {
          id: data.id,
          amount: data.amount,
          label: data.label,
          quotesPerMonth: data.quotes_per_month,
          period: data.period,
          validTill: data.valid_till,
          email,
          name: lead.name || '',
          phone: lead.phone || '',
          company: lead.company || ''
        }
      })
    } catch (error) {
      console.error('[pay] quotation link failed', error?.message)
      return res.status(404).json({ error: 'This payment link is not available.' })
    }
  })

  app.get('/api/pay/request/:id', async (req, res) => {
    const id = String(req.params.id || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(id) || !isSupabaseConfigured()) {
      return res.status(404).json({ error: 'This payment link is not available.' })
    }
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('payment_requests')
        .select('id, email, lead_id, amount, label, quotes_per_month, period, valid_till, status')
        .eq('id', id)
        .maybeSingle()
      if (error || !data || (data.status !== 'pending' && data.status !== 'paid')) {
        return res.status(404).json({ error: 'This payment link is not available.' })
      }
      let customer = { name: '', phone: '', company: '' }
      if (data.lead_id) {
        const lead = await supabase
          .from('meta_ads_leads')
          .select('name, phone, company')
          .eq('id', data.lead_id)
          .maybeSingle()
        if (lead.data) customer = { name: lead.data.name || '', phone: lead.data.phone || '', company: lead.data.company || '' }
      }
      return res.json({
        paid: data.status === 'paid',
        request: {
          id: data.id,
          amount: data.amount,
          label: data.label,
          quotesPerMonth: data.quotes_per_month,
          period: data.period,
          validTill: data.valid_till,
          email: data.email,
          name: customer.name,
          phone: customer.phone,
          company: customer.company
        }
      })
    } catch (error) {
      console.error('[pay] request link failed', error?.message)
      return res.status(404).json({ error: 'This payment link is not available.' })
    }
  })

  app.get('/api/pay/request', async (req, res) => {
    const email = String(req.query?.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !isSupabaseConfigured()) {
      return res.json({ request: null })
    }
    try {
      const { data, error } = await getSupabase()
        .from('payment_requests')
        .select('id, amount, label, quotes_per_month, period, valid_till')
        .eq('email', email)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) return res.json({ request: null })
      return res.json({
        request: {
          id: data.id,
          amount: data.amount,
          label: data.label,
          quotesPerMonth: data.quotes_per_month,
          period: data.period,
          validTill: data.valid_till
        }
      })
    } catch (error) {
      console.error('[pay] request lookup failed', error?.message)
      return res.json({ request: null })
    }
  })

  app.post('/api/pay/phonepe/create', async (req, res) => {
    const cfg = config()
    if (!cfg) return res.status(503).json({ error: 'Online payment is not set up yet.', code: 'PHONEPE_NOT_CONFIGURED' })

    const body = req.body || {}
    const product = String(body?.product || '').trim().toLowerCase()
    const charge = product === 'request' ? await resolveRequestCharge(body) : resolveCharge(body)
    if (charge.error) return res.status(400).json({ error: charge.error, code: 'VALIDATION' })
    const price = charge.price
    const merchantOrderId = `QG-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`

    try {
      if (charge.landing2 && isSupabaseConfigured()) {
        const email = String(body.email || '').trim().toLowerCase()
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await ensureConfirmedMetaTrialUser(getSupabase(), email, {
            source: 'meta_ads_landing2',
            full_name: clip(body.name, 120),
            company: clip(body.company, 120),
            phone_digits: clip(body.phone, 20)
          }).catch((error) => {
            console.error('[phonepe] landing2 user prep failed', error?.message)
          })
        }
      }
      const token = await getToken(cfg)
      const response = await fetch(`${cfg.hosts.pg}/checkout/v2/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` },
        body: JSON.stringify({
          merchantOrderId,
          amount: price * 100,
          expireAfter: 1200,
          metaInfo: {
            udf1: clip(body.name, 256),
            udf2: clip(body.company, 256),
            udf3: clip(body.phone, 256),
            udf4: clip(body.email, 256),
            udf5: clip(charge.label, 256)
          },
          paymentFlow: {
            type: 'PG_CHECKOUT',
            message: clip(charge.message, 120),
            merchantUrls: {
              redirectUrl: `${publicOrigin(req)}/payment-status?order=${encodeURIComponent(merchantOrderId)}`
            }
          }
        })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.redirectUrl) {
        console.error('[phonepe] create failed', response.status, data?.code, data?.message)
        return res.status(502).json({ error: data?.message || 'Could not start PhonePe payment.' })
      }
      if (charge.requestRowId && isSupabaseConfigured()) {
        getSupabase()
          .from('payment_requests')
          .update({ phonepe_order_id: merchantOrderId })
          .eq('id', charge.requestRowId)
          .then(({ error }) => {
            if (error) console.error('[pay] could not store order on request', error.message)
          })
      }
      return res.json({ redirectUrl: data.redirectUrl, merchantOrderId, amount: price })
    } catch (error) {
      console.error('[phonepe] create error', error?.message)
      return res.status(502).json({ error: 'Could not reach PhonePe. Please try again.' })
    }
  })

  app.get('/api/pay/phonepe/status/:orderId', async (req, res) => {
    const cfg = config()
    if (!cfg) return res.status(503).json({ error: 'Online payment is not set up yet.' })
    const orderId = String(req.params.orderId || '')
    if (!/^[A-Za-z0-9_-]{1,63}$/.test(orderId)) return res.status(400).json({ error: 'Invalid order.' })

    try {
      const token = await getToken(cfg)
      const response = await fetch(`${cfg.hosts.pg}/checkout/v2/order/${orderId}/status?details=false`, {
        headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${token}` }
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        return res.status(response.status === 404 ? 404 : 502).json({ error: data?.message || 'Could not check payment.' })
      }
      const state = String(data?.state || 'PENDING').toUpperCase()
      const amount = Math.round(Number(data?.amount || 0) / 100)

      if (state === 'COMPLETED' && !notifiedOrders.has(orderId)) {
        notifiedOrders.add(orderId)
        const m = data?.metaInfo || {}
        sendAdminEmail({
          subject: `New QuoteGen payment ₹${amount} — ${m.udf2 || m.udf1 || m.udf4 || orderId}`,
          text: [
            `Order: ${orderId}`,
            `PhonePe order: ${data?.orderId || ''}`,
            `Amount: ₹${amount}`,
            `Name: ${m.udf1 || '-'}`,
            `Company: ${m.udf2 || '-'}`,
            `Phone: ${m.udf3 || '-'}`,
            `Email: ${m.udf4 || '-'}`,
            `Item: ${m.udf5 || '-'}`
          ].join('\n')
        }).catch(() => {})
        if (isSupabaseConfigured()) {
          markMetaAdsLeadStage(getSupabase(), {
            stage: 'purchased',
            email: m.udf4,
            phone: m.udf3,
            name: m.udf1,
            company: m.udf2,
            amount,
            orderId
          }).catch((error) => {
            console.error('[phonepe] lead purchase update failed', error?.message)
          })
          getSupabase()
            .from('payment_requests')
            .update({ status: 'paid' })
            .eq('phonepe_order_id', orderId)
            .then(({ error }) => {
              if (error) console.error('[pay] request paid update failed', error.message)
            })
          findAuthUserByEmail(getSupabase(), m.udf4)
            .then((user) => applyPaymentCredits(getSupabase(), {
              userId: user?.id,
              email: m.udf4,
              label: m.udf5
            }))
            .catch((error) => {
              console.error('[phonepe] quote credits update failed', error?.message)
            })
        }
      }

      const meta = data?.metaInfo || {}
      const email = String(meta.udf4 || '').trim().toLowerCase()
      const label = String(meta.udf5 || '')
      let setupAccount = false
      if (state === 'COMPLETED' && isSupabaseConfigured()) {
        const linked = await getSupabase()
          .from('payment_requests')
          .select('id, lead_id')
          .eq('phonepe_order_id', orderId)
          .maybeSingle()
        // A lead payment link already knows who they are. The demo ₹399 checkout
        // has no payment-request row, so use the details PhonePe stored on the order.
        if (linked.data?.lead_id) setupAccount = true
        else if (!linked.data && email && (/^QuoteGen monthly/i.test(label) || /entry/i.test(label))) {
          setupAccount = await accountStillNeedsPassword(email)
        }
      }
      return res.json({
        state,
        amount,
        name: meta.udf1 || '',
        company: meta.udf2 || '',
        phone: meta.udf3 || '',
        email,
        setupAccount
      })
    } catch (error) {
      console.error('[phonepe] status error', error?.message)
      return res.status(502).json({ error: 'Could not reach PhonePe. Please try again.' })
    }
  })
}
