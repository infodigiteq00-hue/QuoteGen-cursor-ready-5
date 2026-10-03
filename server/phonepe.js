import crypto from 'node:crypto'
import { getSupabase, isSupabaseConfigured } from './db.js'
import { findAuthUserByEmail, markMetaAdsLeadStage } from './metaAdsLeads.js'
import { applyPaymentCredits } from './accountAccess.js'
import { sendAdminEmail } from './mail.js'

const OFFER_PRICE = 499
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
  app.post('/api/pay/phonepe/create', async (req, res) => {
    const cfg = config()
    if (!cfg) return res.status(503).json({ error: 'Online payment is not set up yet.', code: 'PHONEPE_NOT_CONFIGURED' })

    const body = req.body || {}
    const charge = resolveCharge(body)
    if (charge.error) return res.status(400).json({ error: charge.error, code: 'VALIDATION' })
    const price = charge.price
    const merchantOrderId = `QG-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`

    try {
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
      return res.json({
        state,
        amount,
        name: meta.udf1 || '',
        email: meta.udf4 || ''
      })
    } catch (error) {
      console.error('[phonepe] status error', error?.message)
      return res.status(502).json({ error: 'Could not reach PhonePe. Please try again.' })
    }
  })
}
