/** Client helpers for quotation series + autosave (talks to Express only). */
import { normalizeColumnList } from '../shared/quoteColumns.js'

export function formatSeriesPreview({ prefix = 'QG', padding = 4, nextNumber = 1, includeYear = true } = {}) {
  const safePadding = Math.min(12, Math.max(1, Number(padding) || 4))
  const safeNext = Math.max(1, Number(nextNumber) || 1)
  const padded = String(safeNext).padStart(safePadding, '0')
  const cleanPrefix = String(prefix || 'QG').trim() || 'QG'
  if (includeYear === false) return `${cleanPrefix}-${padded}`
  return `${cleanPrefix}-${new Date().getUTCFullYear()}-${padded}`
}

/** Split a sample like QT-0020 into prefix / padding / next number so the counter can increment. */
export function parseQuotationSample(sample, defaultPrefix = 'QG') {
  const fallback = String(defaultPrefix || 'QG').trim() || 'QG'
  const raw = String(sample || '').trim()
  if (!raw) {
    return { prefix: fallback, padding: 4, nextNumber: 1, includeYear: false }
  }
  const match = raw.match(/^(.*?)(\d+)\s*$/)
  if (!match) {
    return {
      prefix: raw.replace(/[-_/.\s]+$/, '').trim() || fallback,
      padding: 4,
      nextNumber: 1,
      includeYear: false
    }
  }
  const digits = match[2]
  const nextNumber = parseInt(digits, 10)
  return {
    prefix: String(match[1]).replace(/[-_/.\s]+$/, '').trim() || fallback,
    padding: Math.min(12, Math.max(1, digits.length)),
    nextNumber: Number.isInteger(nextNumber) && nextNumber >= 1 ? nextNumber : 1,
    includeYear: false
  }
}

/**
 * After assigning `number` to a quote, return the series settings so the NEXT
 * quote gets +1 (e.g. QG-2026-0069 → nextNumber 70).
 */
export function seriesAfterAssignedNumber(number) {
  const raw = String(number || '').trim()
  if (!raw) return null

  const yearForm = raw.match(/^([A-Za-z][A-Za-z0-9]*?)-(\d{4})-(\d+)$/)
  if (yearForm) {
    const digits = yearForm[3]
    const n = parseInt(digits, 10)
    if (!Number.isFinite(n) || n < 1) return null
    return {
      prefix: yearForm[1],
      includeYear: true,
      padding: Math.min(12, Math.max(1, digits.length)),
      nextNumber: n + 1
    }
  }

  const plain = raw.match(/^([A-Za-z][A-Za-z0-9]*?)-(\d+)$/)
  if (plain) {
    const digits = plain[2]
    const n = parseInt(digits, 10)
    if (!Number.isFinite(n) || n < 1) return null
    return {
      prefix: plain[1],
      includeYear: false,
      padding: Math.min(12, Math.max(1, digits.length)),
      nextNumber: n + 1
    }
  }

  const parsed = parseQuotationSample(raw)
  return { ...parsed, nextNumber: Math.max(1, parsed.nextNumber + 1) }
}

/** Push the company quotation series forward after the user sets a number inline. */
export async function syncQuotationSeriesFromNumber(number, lastSynced = '') {
  const trimmed = String(number || '').trim()
  if (!trimmed || trimmed === String(lastSynced || '').trim()) {
    return { synced: false, number: trimmed, profile: null }
  }
  const series = seriesAfterAssignedNumber(trimmed)
  if (!series) return { synced: false, number: trimmed, profile: null }
  const result = await saveCompanyProfile({ series })
  if (result.unavailable) return { synced: false, number: trimmed, profile: null }
  return { synced: true, number: trimmed, profile: result.profile || null }
}

/**
 * Persistence can be unavailable for four quite different reasons, and telling
 * the user to check their .env keys when the real problem is a missing
 * migration or an expired session sends them the wrong way entirely.
 */
const HINTS = {
  unconfigured: 'Configure Supabase: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env, run the persistence migration, then restart npm run dev.',
  unauthenticated: 'Your session has expired. Log out, log back in, and your data will reload.',
  migration: 'Database setup is incomplete: open supabase/apply_multi_tenant.sql, run it in the Supabase SQL editor, then reload this page.',
  unreachable: 'Cannot reach the QuoteGen API on port 3001. Start it with npm run dev, then reload this page.'
}

/**
 * The current diagnosis, as a live module binding: the checks below rewrite it
 * the moment we learn the real reason, and every panel that renders it picks up
 * the new wording on its next render. This keeps one source of truth for the
 * message instead of duplicating the logic into each panel.
 */
export let SUPABASE_SETUP_HINT = HINTS.unconfigured

/** Which of the four reasons this response represents, or null if it's a genuine error. */
function diagnose(response, data) {
  const status = response?.status
  const message = String(data?.error || '')

  if (status === 503 || data?.code === 'SUPABASE_UNAVAILABLE') return 'unconfigured'
  if (status === 401 || data?.code === 'UNAUTHENTICATED') return 'unauthenticated'
  // 42703 is Postgres "undefined_column" — the per-account columns aren't there yet.
  if (data?.code === '42703' || /column .* does not exist/i.test(message)) return 'migration'
  // A 5xx with no JSON body is the Vite proxy failing to reach a stopped Express.
  if (status >= 500 && !message) return 'unreachable'
  return null
}

function note(reason) {
  if (reason) SUPABASE_SETUP_HINT = HINTS[reason]
  return Boolean(reason)
}

export function isPersistenceUnavailable(response, data) {
  return note(diagnose(response, data))
}

export async function checkPersistenceHealth() {
  try {
    const response = await fetch('/api/health/persistence')
    const data = await response.json().catch(() => ({}))
    if (response.ok && data?.configured) return { configured: true, ok: true }
    note(diagnose(response, data) || 'unconfigured')
    return { configured: false, ok: response.ok }
  } catch {
    note('unreachable')
    return { configured: false, ok: false }
  }
}

function hydrateCompanyProfile(profile) {
  if (!profile) return profile
  const raw = String(profile.footerText || '')
  const mark = '__QG_BANK__'
  const idx = raw.indexOf(mark)
  if (idx === -1) return profile
  const note = raw.slice(0, idx).replace(/\s+$/, '')
  let extra = {}
  try {
    extra = JSON.parse(raw.slice(idx + mark.length).trim()) || {}
  } catch {
    extra = {}
  }
  return {
    ...profile,
    footerText: note,
    bankName: profile.bankName || extra.bankName || '',
    bankAccountNo: profile.bankAccountNo || extra.accountNo || extra.bankAccountNo || '',
    bankIfsc: profile.bankIfsc || extra.ifsc || extra.bankIfsc || '',
    bankAccountName: profile.bankAccountName || extra.accountName || extra.bankAccountName || '',
    bankBranch: profile.bankBranch || extra.branch || extra.bankBranch || '',
    bankQrUrl: profile.bankQrUrl || extra.bankQrUrl || null,
    standardTerms: profile.standardTerms || extra.terms || extra.standardTerms || '',
    invoiceSeries: extra.invoiceSeries && typeof extra.invoiceSeries === 'object'
      ? {
          ...(profile.invoiceSeries || {}),
          type: extra.invoiceSeries.defaultType || profile.invoiceSeries?.type,
          types: {
            ...(extra.invoiceSeries.series || {}),
            ...(profile.invoiceSeries?.types || {}),
            sales_invoice: {
              prefix: profile.invoiceSeries?.prefix || 'INV',
              padding: profile.invoiceSeries?.padding ?? 4,
              nextNumber: profile.invoiceSeries?.nextNumber ?? 1,
              includeYear: profile.invoiceSeries?.includeYear !== false
            }
          }
        }
      : profile.invoiceSeries,
    columnLayouts: Array.isArray(extra.columnLayouts) && extra.columnLayouts.length
      ? extra.columnLayouts
      : (Array.isArray(profile.columnLayouts) && profile.columnLayouts.length
        ? profile.columnLayouts
        : (Array.isArray(extra.columnLayouts) ? extra.columnLayouts : profile.columnLayouts)),
    activeColumnLayoutId: extra.activeColumnLayoutId || profile.activeColumnLayoutId,
    defaultUploadTemplateId: Object.prototype.hasOwnProperty.call(extra, 'defaultUploadTemplateId')
      ? extra.defaultUploadTemplateId
      : profile.defaultUploadTemplateId,
    footerFit: extra.footerFit || profile.footerFit
  }
}

export async function fetchCompanyProfile() {
  const response = await fetch('/api/company-profile')
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, profile: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not load company profile')
  return { unavailable: false, profile: hydrateCompanyProfile(data.profile) }
}

export async function saveCompanyProfile(body) {
  const response = await fetch('/api/company-profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, profile: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not save company profile')
  return { unavailable: false, profile: hydrateCompanyProfile(data.profile) }
}

/** Turns a plain-English numbering instruction into {prefix,padding,nextNumber,includeYear}. */
export async function suggestNumbering({ kind, note, current }) {
  const response = await fetch('/api/company-profile/numbering-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, note, current })
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, suggestion: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not work out the numbering from that.')
  return { unavailable: false, suggestion: data.suggestion }
}

export async function uploadCompanyLogo(file, { logoWidth, logoHeight } = {}) {
  const form = new FormData()
  form.append('logo', file)
  if (logoWidth != null) form.append('logoWidth', String(logoWidth))
  if (logoHeight != null) form.append('logoHeight', String(logoHeight))
  const response = await fetch('/api/company-profile/logo', { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, profile: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not upload logo')
  return { unavailable: false, profile: data.profile }
}

export async function removeCompanyLogo() {
  const response = await fetch('/api/company-profile/logo', { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, profile: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not remove logo')
  return { unavailable: false, profile: data.profile }
}

export async function uploadCompanyBankQr(file) {
  const form = new FormData()
  form.append('image', file)
  const response = await fetch('/api/company-profile/bank-qr', { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, profile: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not upload bank QR')
  return { unavailable: false, profile: hydrateCompanyProfile(data.profile) }
}

export async function removeCompanyBankQr() {
  const response = await fetch('/api/company-profile/bank-qr', { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, profile: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not remove bank QR')
  return { unavailable: false, profile: hydrateCompanyProfile(data.profile) }
}

/** slot is 'header' or 'footer'; the image replaces that part of the letterhead. */
export async function uploadCompanyBanner(slot, file) {
  const form = new FormData()
  form.append('image', file)
  const response = await fetch(`/api/company-profile/banner/${slot}`, { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, profile: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || `Could not upload ${slot} image`)
  return { unavailable: false, profile: data.profile }
}

export async function removeCompanyBanner(slot) {
  const response = await fetch(`/api/company-profile/banner/${slot}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, profile: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || `Could not remove ${slot} image`)
  return { unavailable: false, profile: data.profile }
}

/**
 * Convert a saved quotation into a sales invoice. `customerGst` covers the case
 * where the user just typed a GSTIN and autosave hasn't landed yet.
 * Returns { gstRequired: true } rather than throwing, so the UI can point the
 * user at the GST field instead of showing a raw error.
 */
export async function convertQuotationToInvoice(quotationId, { customerGst, title, number } = {}) {
  const response = await fetch(`/api/quotations/${quotationId}/convert-to-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerGst, title, number })
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, invoice: null, error: data.error }
  }
  if (data.code === 'GST_REQUIRED') {
    return { unavailable: false, gstRequired: true, invoice: null, error: data.error }
  }
  if (data.code === 'NUMBER_IN_USE') {
    return { unavailable: false, numberInUse: true, invoice: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not create the invoice')
  return { unavailable: false, invoice: data.invoice }
}

/** Suggested next invoice number, without consuming it. */
export async function peekInvoiceSeries() {
  const response = await fetch('/api/invoice-series/peek')
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) return { unavailable: true, peek: null }
  if (!response.ok) throw new Error(data.error || 'Could not read the invoice series')
  return { unavailable: false, peek: data }
}

export async function peekQuotationSeries() {
  const response = await fetch('/api/quotation-series/peek')
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, peek: null }
  }
  if (!response.ok) throw new Error(data.error || 'Could not peek series')
  return { unavailable: false, peek: data }
}

export async function listProducts(query = '') {
  const q = String(query || '').trim()
  const response = await fetch(`/api/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, products: [] }
  }
  if (!response.ok) throw new Error(data.error || 'Could not list products')
  return { unavailable: false, products: data.products || [] }
}

export async function saveProduct(product) {
  const response = await fetch('/api/products', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product || {})
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, product: null }
  }
  if (!response.ok) throw new Error(data.error || 'Could not save product')
  return { unavailable: false, product: data.product || null }
}

export async function listQuotations(limit = 30) {
  const response = await fetch(`/api/quotations?limit=${limit}`)
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, quotations: [] }
  }
  if (!response.ok) throw new Error(data.error || 'Could not list quotations')
  return { unavailable: false, quotations: data.quotations || [] }
}

export async function getQuotation(id) {
  const response = await fetch(`/api/quotations/${id}`)
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, quotation: null }
  }
  if (response.status === 404) throw new Error('Quotation not found')
  if (!response.ok) throw new Error(data.error || 'Could not load quotation')
  return { unavailable: false, quotation: data.quotation }
}

/** Build the JSON payload stored in quotations.data (+ top-level fields). */
export function buildQuotationPayload(quote, { layoutRef, uploadTemplateId } = {}) {
  if (!quote) return null
  const payload = {
    title: quote.title ?? '',
    number: quote.number ?? null,
    date: quote.date ?? null,
    // normalizeColumnList keeps id/label/type (+ colour, image width) so typed
    // columns survive autosave -> reopen -> clone.
    columns: normalizeColumnList(quote.columns || []),
    customer: quote.customer || {},
    items: quote.items || [],
    extraLines: Array.isArray(quote.extraLines) ? quote.extraLines : [],
    notes: quote.notes || [],
    clarifications: quote.clarifications || [],
    terms: quote.terms || {},
    mode: quote.mode,
    // Kept so autosaving an invoice can't quietly turn it back into a quotation.
    docType: quote.docType === 'invoice' ? 'invoice' : 'quotation',
    invoiceKind: quote.invoiceKind || null,
    layoutRef: layoutRef ?? quote.layoutRef ?? null,
    uploadTemplateId: uploadTemplateId ?? quote.uploadTemplateId ?? null,
    paperStyle: quote.paperStyle || null,
    tableColorId: quote.tableColorId || 'blue',
    tableAccent: quote.tableAccent || null,
    logoPalette: quote.logoPalette || null
  }
  return {
    number: payload.number,
    title: payload.title,
    date: payload.date,
    layoutRef: payload.layoutRef,
    data: payload
  }
}

export async function createQuotation(body) {
  const response = await fetch('/api/quotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, quotation: null }
  }
  if (!response.ok) throw new Error(data.error || 'Could not save quotation')
  return { unavailable: false, quotation: data.quotation }
}

export async function updateQuotation(id, body) {
  const response = await fetch(`/api/quotations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, quotation: null }
  }
  if (!response.ok) throw new Error(data.error || 'Could not update quotation')
  return { unavailable: false, quotation: data.quotation }
}

export function quotationToEditorState(quotation) {
  const data = quotation?.data && typeof quotation.data === 'object' ? quotation.data : {}
  return {
    title: data.title ?? quotation?.title ?? '',
    number: data.number ?? quotation?.number ?? '',
    date: data.date ?? quotation?.date ?? '',
    columns: Array.isArray(data.columns) && data.columns.length ? normalizeColumnList(data.columns) : undefined,
    customer: data.customer || { name: '', company: '', gst: '', location: '' },
    items: Array.isArray(data.items) ? data.items : [],
    extraLines: Array.isArray(data.extraLines) ? data.extraLines : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    clarifications: Array.isArray(data.clarifications) ? data.clarifications : [],
    terms: data.terms || {},
    // The row's doc_type is authoritative; data.docType is the copy inside the payload.
    docType: quotation?.docType || data.docType || 'quotation',
    invoiceKind: data.invoiceKind || null,
    mode: data.mode || 'saved',
    layoutRef: data.layoutRef ?? quotation?.layoutRef ?? null,
    uploadTemplateId: data.uploadTemplateId ?? null,
    paperStyle: data.paperStyle || 'corporate',
    tableColorId: data.tableColorId || 'blue',
    tableAccent: data.tableAccent || null,
    logoPalette: data.logoPalette || null,
    // Authoritative revision lives in the column, not the JSON snapshot.
    revision: quotation?.revision
  }
}

export function cloneQuotationForNew(editorQuote, newNumber) {
  const clone = structuredClone(editorQuote)
  clone.number = newNumber
  clone.date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  clone.mode = clone.mode === 'demo' ? 'demo' : 'cloned'
  // A clone is a brand-new quotation, so its revision history starts fresh.
  delete clone.revision
  return clone
}

/** Knowledge base (Steps 4–5) — Express only. */

export async function listKnowledgeDocuments() {
  const response = await fetch('/api/knowledge-documents')
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, documents: [] }
  }
  if (!response.ok) throw new Error(data.error || 'Could not list knowledge documents')
  return { unavailable: false, documents: data.documents || [] }
}

export async function getKnowledgeDocument(id) {
  const response = await fetch(`/api/knowledge-documents/${id}`)
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, document: null }
  }
  if (response.status === 404) throw new Error('Document not found')
  if (!response.ok) throw new Error(data.error || 'Could not load document')
  return { unavailable: false, document: data.document }
}

export async function deleteKnowledgeDocument(id) {
  const response = await fetch(`/api/knowledge-documents/${id}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true }
  }
  if (!response.ok) throw new Error(data.error || 'Could not delete document')
  return { unavailable: false, ok: true }
}

export async function uploadKnowledgeDocuments(fileList) {
  const form = new FormData()
  for (const file of fileList) form.append('files', file)
  const response = await fetch('/api/knowledge-documents/upload', { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, documents: [], failed: [], productsUpserted: 0, error: data.error }
  }
  if (!response.ok && !(data.documents?.length)) {
    throw new Error(data.error || 'Knowledge upload failed')
  }
  return {
    unavailable: false,
    documents: data.documents || [],
    failed: data.failed || [],
    productsUpserted: data.productsUpserted || 0
  }
}

export async function autofillFromKnowledge(items, columns) {
  const response = await fetch('/api/knowledge/autofill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, columns })
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, items, fills: [], mode: 'skipped' }
  }
  if (!response.ok) throw new Error(data.error || 'Autofill failed')
  return {
    unavailable: false,
    items: data.items || items,
    fills: data.fills || [],
    mode: data.mode,
    stats: data.stats
  }
}

/** Step 10: named quotation revisions (Rev 0, Rev 1, …).
 *
 * The live quotation is always the current revision; each entry returned here is
 * a frozen snapshot of a superseded one. `unavailable` is returned (rather than
 * thrown) when the revisions migration has not been applied, so the editor can
 * simply hide the panel instead of erroring. */

function revisionsUnavailable(response, data) {
  return response.status === 503 || data?.code === 'REVISIONS_SCHEMA_MISSING' || data?.code === 'SUPABASE_UNAVAILABLE'
}

export async function listRevisions(quotationId) {
  const response = await fetch(`/api/quotations/${quotationId}/revisions`)
  const data = await response.json().catch(() => ({}))
  if (revisionsUnavailable(response, data)) {
    return { unavailable: true, revisions: [], current: null, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not load revisions')
  return { unavailable: false, revisions: data.revisions || [], current: data.current || null }
}

export async function getRevision(quotationId, revisionId) {
  const response = await fetch(`/api/quotations/${quotationId}/revisions/${revisionId}`)
  const data = await response.json().catch(() => ({}))
  if (revisionsUnavailable(response, data)) return { unavailable: true, revision: null }
  if (!response.ok) throw new Error(data.error || 'Could not load revision')
  return { unavailable: false, revision: data.revision }
}

export async function createRevision(quotationId, label = '') {
  const response = await fetch(`/api/quotations/${quotationId}/revisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  })
  const data = await response.json().catch(() => ({}))
  if (revisionsUnavailable(response, data)) {
    return { unavailable: true, error: data.error }
  }
  if (!response.ok) throw new Error(data.error || 'Could not create revision')
  return { unavailable: false, revision: data.revision, frozenRevision: data.frozenRevision, revisionId: data.revisionId }
}

export async function restoreRevision(quotationId, revisionId) {
  const response = await fetch(`/api/quotations/${quotationId}/revisions/${revisionId}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  })
  const data = await response.json().catch(() => ({}))
  if (revisionsUnavailable(response, data)) return { unavailable: true, error: data.error }
  if (!response.ok) throw new Error(data.error || 'Could not restore revision')
  return { unavailable: false, quotation: data.quotation, restoredFrom: data.restoredFrom, revision: data.revision }
}

export async function deleteRevision(quotationId, revisionId) {
  const response = await fetch(`/api/quotations/${quotationId}/revisions/${revisionId}`, { method: 'DELETE' })
  const data = await response.json().catch(() => ({}))
  if (revisionsUnavailable(response, data)) return { unavailable: true }
  if (!response.ok) throw new Error(data.error || 'Could not delete revision')
  return { unavailable: false, ok: true }
}

/** Step 8: learn from quoted line items — called after every autosave so the
 *  next quotation with a matching item autofills its rate/HSN/GST/image. */
export async function learnFromQuote(items, columns) {
  const response = await fetch('/api/knowledge/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, columns })
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data)) {
    return { unavailable: true, learned: 0 }
  }
  if (!response.ok) throw new Error(data.error || 'Learning from quote failed')
  return { unavailable: false, learned: data.learned || 0 }
}

/** Step 7: image cells. Storage-backed URL, inline data URL when Storage is unavailable. */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read the image file.'))
    reader.readAsDataURL(file)
  })
}

export async function uploadQuoteImage(file) {
  if (!file) throw new Error('Choose an image file.')
  const looksImage = /^image\//i.test(file.type || '') || /\.(png|jpe?g|webp|gif|svg|bmp|heic|heif)$/i.test(file.name || '')
  if (!looksImage) throw new Error('That file is not an image.')

  const form = new FormData()
  form.append('image', file)
  try {
    const response = await fetch('/api/quote-assets/image', { method: 'POST', body: form })
    const data = await response.json().catch(() => ({}))
    if (response.ok && data.url) {
      return { url: data.url, path: data.path || null, storage: data.storage || 'supabase' }
    }
    if (response.status === 400) throw new Error(data.error || 'Image upload failed')
  } catch (error) {
    if (error?.message && !/Failed to fetch/i.test(error.message) && /image/i.test(error.message)) throw error
  }

  // Server or Storage unavailable — keep the image usable inside the quote JSON.
  if (file.size > 400 * 1024) {
    throw new Error('Image storage is unavailable and this file is over 400 KB. Use a smaller image.')
  }
  return { url: await readFileAsDataUrl(file), path: null, storage: 'inline' }
}

export async function deleteQuoteImage(path) {
  if (!path) return { ok: true }
  try {
    await fetch(`/api/quote-assets/image?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
  } catch {
    /* best effort — the quote no longer references it */
  }
  return { ok: true }
}

export async function uploadQuoteFile(file) {
  if (!file) throw new Error('Choose a file.')

  const form = new FormData()
  form.append('file', file)
  try {
    const response = await fetch('/api/quote-assets/file', { method: 'POST', body: form })
    const data = await response.json().catch(() => ({}))
    if (response.ok && data.url) {
      return { url: data.url, path: data.path || null, storage: data.storage || 'supabase' }
    }
    if (response.status === 400) throw new Error(data.error || 'File upload failed')
    if (data.error) throw new Error(data.error)
  } catch (error) {
    if (error?.message && !/Failed to fetch/i.test(error.message)) throw error
  }

  if (file.size > 400 * 1024) {
    throw new Error('File storage is unavailable and this file is over 400 KB. Use a smaller file.')
  }
  return { url: await readFileAsDataUrl(file), path: null, storage: 'inline' }
}

/** Step 6: Fetch HSN + GST — cache first, AI only on miss. */
export async function lookupHsnGst({ description, item, columns } = {}) {
  const response = await fetch('/api/hsn-gst/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, item, columns })
  })
  const data = await response.json().catch(() => ({}))
  if (isPersistenceUnavailable(response, data) || data.code === 'SUPABASE_UNAVAILABLE') {
    return { unavailable: true, code: data.code || 'SUPABASE_UNAVAILABLE', error: data.error, source: null }
  }
  if (data.code === 'AI_UNAVAILABLE' || data.code === 'SCHEMA_MISSING') {
    return { unavailable: true, code: data.code, error: data.error, source: null }
  }
  if (!response.ok) {
    throw new Error(data.error || 'HSN/GST lookup failed')
  }
  return {
    unavailable: false,
    hsn: data.hsn || '',
    gst: data.gst || '',
    description: data.description || '',
    key: data.key,
    source: data.source,
    item: data.item,
    fields: data.fields || [],
    confidence: data.confidence,
    note: data.note
  }
}
