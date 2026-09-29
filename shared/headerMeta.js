/** Which quotation header extras appear on paper. Date always stays. */

export const DEFAULT_HEADER_META = {
  quoteNumber: true,
  reference: true,
  validTill: true,
  totalValue: true
}

export function normalizeHeaderMeta(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    quoteNumber: src.quoteNumber !== false,
    reference: src.reference !== false,
    validTill: src.validTill !== false,
    totalValue: src.totalValue !== false
  }
}

export function patchHeaderMeta(current, patch) {
  return normalizeHeaderMeta({ ...normalizeHeaderMeta(current), ...(patch || {}) })
}

export function headerMetaHasHidden(raw) {
  const meta = normalizeHeaderMeta(raw)
  return !meta.quoteNumber || !meta.reference || !meta.validTill || !meta.totalValue
}
