/** Invoice document kinds and per-type numbering helpers. */

export const DEFAULT_INVOICE_SERIES_TYPE = 'sales_invoice'

export const INVOICE_SERIES_TYPES = [
  { id: 'sales_invoice', label: 'Sales Invoice', prefix: 'INV' },
  { id: 'tax_invoice', label: 'Tax Invoice', prefix: 'TAX' },
  { id: 'proforma_invoice', label: 'Proforma Invoice', prefix: 'PRO' },
  { id: 'credit_note', label: 'Credit Note', prefix: 'CN' },
  { id: 'debit_note', label: 'Debit Note', prefix: 'DN' },
  { id: 'export_invoice', label: 'Export Invoice', prefix: 'EXP' },
  { id: 'service_invoice', label: 'Service Invoice', prefix: 'SRV' },
  { id: 'commercial_invoice', label: 'Commercial Invoice', prefix: 'COM' }
]

export function invoiceSeriesTypeById(id) {
  return INVOICE_SERIES_TYPES.find(t => t.id === id) || INVOICE_SERIES_TYPES[0]
}

export function defaultSeriesSettings(id) {
  const type = invoiceSeriesTypeById(id)
  return { prefix: type.prefix, padding: 4, nextNumber: 1, includeYear: true }
}

export function normalizeSeriesSettings(raw, typeId) {
  const fallback = defaultSeriesSettings(typeId)
  if (!raw || typeof raw !== 'object') return fallback
  const padding = Number(raw.padding)
  const next = Number(raw.nextNumber)
  return {
    prefix: String(raw.prefix || fallback.prefix).trim() || fallback.prefix,
    padding: Number.isInteger(padding) && padding >= 1 && padding <= 12 ? padding : fallback.padding,
    nextNumber: Number.isInteger(next) && next >= 1 ? next : fallback.nextNumber,
    includeYear: raw.includeYear !== false
  }
}

export function parseInvoiceSeriesPack(note) {
  const empty = { defaultType: DEFAULT_INVOICE_SERIES_TYPE, series: {} }
  const raw = String(note || '').trim()
  if (!raw.startsWith('{')) return empty
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.series || typeof parsed.series !== 'object') {
      return empty
    }
    const known = INVOICE_SERIES_TYPES.some(t => t.id === parsed.defaultType)
    return {
      defaultType: known ? parsed.defaultType : DEFAULT_INVOICE_SERIES_TYPE,
      series: parsed.series
    }
  } catch {
    return empty
  }
}

export function stringifyInvoiceSeriesPack(pack) {
  return JSON.stringify({
    defaultType: pack?.defaultType || DEFAULT_INVOICE_SERIES_TYPE,
    series: pack?.series && typeof pack.series === 'object' ? pack.series : {}
  })
}

export function formatInvoiceSeriesNumber(settings) {
  const prefix = String(settings?.prefix || 'INV').trim() || 'INV'
  const padding = settings?.padding ?? 4
  const next = settings?.nextNumber ?? 1
  const padded = String(next).padStart(padding, '0')
  if (settings?.includeYear === false) return `${prefix}-${padded}`
  return `${prefix}-${new Date().getUTCFullYear()}-${padded}`
}
