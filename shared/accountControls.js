/** Period windows for quote quotas (calendar day / month / year in UTC). */

export function periodWindowStart(period, now = new Date()) {
  const d = new Date(now)
  if (period === 'day') {
    d.setUTCHours(0, 0, 0, 0)
    return d
  }
  if (period === 'month') {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  }
  if (period === 'year') {
    return new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  }
  return null
}

export function periodLabel(period) {
  if (period === 'day') return 'today'
  if (period === 'month') return 'this month'
  if (period === 'year') return 'this year'
  return ''
}

export function normalizeAccountStatus(raw) {
  const s = String(raw || 'active').trim().toLowerCase()
  if (s === 'paused' || s === 'removed' || s === 'active') return s
  return 'active'
}

export function normalizeQuoteLimit(count, period) {
  const p = String(period || '').trim().toLowerCase()
  const n = count == null || count === '' ? null : Number(count)
  if (!p || p === 'none' || p === 'unlimited') {
    return { quoteLimitCount: null, quoteLimitPeriod: null }
  }
  if (!['day', 'month', 'year'].includes(p)) {
    const err = new Error('Limit period must be day, month, or year.')
    err.code = 'INVALID_LIMIT'
    err.status = 400
    throw err
  }
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    const err = new Error('Limit must be a whole number (0 or more), or clear it for unlimited.')
    err.code = 'INVALID_LIMIT'
    err.status = 400
    throw err
  }
  return { quoteLimitCount: n, quoteLimitPeriod: p }
}
