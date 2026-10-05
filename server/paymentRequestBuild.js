const PAYMENT_PLANS = [
  ['starter', 'Starter', 399, 3990, 50],
  ['growth', 'Growth', 799, 7990, 125],
  ['business', 'Business', 1599, 15990, 300],
  ['pro', 'Pro', 2999, 29990, 750],
  ['enterprise', 'Enterprise', 4999, 49990, 1500],
  ['scale', 'Scale', 8999, 89990, 5000]
]
const PAYMENT_TOPUPS = [
  [25, 199],
  [100, 499],
  [250, 999]
]

function inr(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`
}

function paymentPreset(key) {
  if (key === '199') return paymentPreset('topup:25')
  if (key === '399') return paymentPreset('plan:starter:month')
  const topup = /^topup:(\d+)$/.exec(key)
  if (topup) {
    const row = PAYMENT_TOPUPS.find(([quotes]) => String(quotes) === topup[1])
    if (!row) return null
    const [quotes, amount] = row
    return { amount, quotesPerMonth: quotes, period: 'once', validTill: null, label: `${inr(amount)} · ${quotes.toLocaleString('en-IN')} quotations` }
  }
  const planKey = /^plan:([a-z]+):(month|year)$/.exec(key)
  if (!planKey) return null
  const plan = PAYMENT_PLANS.find(([id]) => id === planKey[1])
  if (!plan) return null
  const [, name, monthly, yearly, quotes] = plan
  const yearlyPlan = planKey[2] === 'year'
  const amount = yearlyPlan ? yearly : monthly
  const quoteLabel = `${quotes.toLocaleString('en-IN')} quotations / month`
  return {
    amount,
    quotesPerMonth: quotes,
    period: yearlyPlan ? 'year' : 'month',
    validTill: null,
    label: yearlyPlan ? `${inr(amount)} · ${name} yearly, ${quoteLabel}` : `${inr(amount)} · ${name}, ${quoteLabel}`
  }
}

function paymentDateLabel(iso) {
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function buildPaymentRequest(body) {
  const preset = paymentPreset(String(body.preset || '').trim())
  if (preset) return { ...preset, validTill: null }
  const amount = Math.round(Number(body.amount))
  const quotesPerMonth = Math.round(Number(body.quotesPerMonth))
  const period = body.period === 'year' ? 'year' : body.period === 'month' ? 'month' : ''
  if (!Number.isFinite(amount) || amount < 1 || amount > 500000) {
    return { error: 'Enter an amount between ₹1 and ₹5,00,000.' }
  }
  if (!Number.isFinite(quotesPerMonth) || quotesPerMonth < 1 || quotesPerMonth > 100000) {
    return { error: 'Enter how many quotations per month.' }
  }
  if (!period) return { error: 'Choose monthly or yearly.' }
  let validTill = null
  if (period === 'year') {
    validTill = String(body.validTill || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validTill)) {
      return { error: 'Choose the date this yearly plan is valid till.' }
    }
  }
  const money = `₹${amount.toLocaleString('en-IN')}`
  const quotes = `${quotesPerMonth.toLocaleString('en-IN')} quotations / month`
  const label = period === 'year'
    ? `${money} · ${quotes} · yearly, valid till ${paymentDateLabel(validTill)}`
    : `${money} · ${quotes}`
  return { amount, quotesPerMonth, period, validTill, label }
}
