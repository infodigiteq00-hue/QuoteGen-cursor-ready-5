import { INVOICE_SERIES_TYPES } from './invoiceSeries.js'

/** Document titles produced by the convert menu — shown on the paper header. */
export const CONVERT_DOC_LABELS = {
  'proforma invoice': 'PROFORMA INVOICE',
  'tax invoice': 'TAX INVOICE',
  'delivery challan': 'DELIVERY CHALLAN',
  'purchase order': 'PURCHASE ORDER'
}

export function resolveDocLabel(quote) {
  if (!quote) return 'QUOTATION'

  const title = String(quote.title || quote.fields?.docTitle || '').trim()
  const titleKey = title.toLowerCase()
  const fromConvert = CONVERT_DOC_LABELS[titleKey]
  const isInvoice = (quote.docType || quote.doc_type) === 'invoice'

  if (isInvoice) {
    const kind = INVOICE_SERIES_TYPES.find((t) => t.id === quote.invoiceKind)
    if (kind?.label) return kind.label.toUpperCase()
    if (fromConvert) return fromConvert
    if (title) return title.toUpperCase()
    return 'TAX INVOICE'
  }

  if (fromConvert) return fromConvert
  return 'QUOTATION'
}
