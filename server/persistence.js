import multer from 'multer'
import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'
import { computeQuoteTotals } from '../shared/quoteColumns.js'
import { normalizeFooterFit } from '../shared/footerFit.js'
import { createAiClient } from './hsnGst.js'
import {
  DEFAULT_INVOICE_SERIES_TYPE,
  INVOICE_SERIES_TYPES,
  formatInvoiceSeriesNumber,
  invoiceSeriesTypeById,
  normalizeSeriesSettings,
  parseInvoiceSeriesPack
} from '../shared/invoiceSeries.js'
import { formatKeywords } from '../shared/productKeywords.js'

const LOGO_BUCKET = 'company-assets'
const MAX_LOGO_BYTES = 1.5 * 1024 * 1024
const INLINE_IMAGE_MAX = 400 * 1024
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES }
})

function dataUrlFromBuffer(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

async function ensureLogoBucket(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) throw error
  const existing = (buckets || []).find(b => b.name === LOGO_BUCKET || b.id === LOGO_BUCKET)
  if (!existing) {
    const { error: createError } = await supabase.storage.createBucket(LOGO_BUCKET, {
      public: true,
      fileSizeLimit: MAX_LOGO_BYTES
    })
    if (createError && !/already exists|duplicate/i.test(createError.message || '')) throw createError
    return
  }
  if (existing.public !== true) {
    await supabase.storage.updateBucket(LOGO_BUCKET, {
      public: true,
      fileSizeLimit: MAX_LOGO_BYTES
    }).catch(() => {})
  }
}

/** Prefer an inline data URL so the preview does not depend on a public Storage policy. */
async function storeCompanyImage(supabase, path, file) {
  const mime = String(file.mimetype || 'image/png')
  const inlineUrl = file.buffer.length <= INLINE_IMAGE_MAX
    ? dataUrlFromBuffer(file.buffer, mime)
    : null
  try {
    await ensureLogoBucket(supabase)
    const { error: upErr } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(path, file.buffer, { contentType: mime, upsert: true, cacheControl: '0' })
    if (upErr) throw upErr
    const { data: pub } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
    const publicUrl = pub?.publicUrl
      ? `${String(pub.publicUrl).split('?')[0]}?v=${Date.now()}`
      : null
    return { url: inlineUrl || publicUrl, path }
  } catch (storageError) {
    if (!inlineUrl) throw storageError
    console.warn('storage upload failed, using inline image', storageError?.message || storageError)
    return { url: inlineUrl, path: null }
  }
}

async function displayImageUrl(supabase, url, path) {
  if (!url) return url || null
  if (String(url).startsWith('data:')) return url
  if (!path) return url
  try {
    const { data, error } = await supabase.storage.from(LOGO_BUCKET).download(path)
    if (error || !data) return url
    const buf = Buffer.from(await data.arrayBuffer())
    if (buf.length > INLINE_IMAGE_MAX) return url
    return dataUrlFromBuffer(buf, data.type || 'image/png')
  } catch {
    return url
  }
}

async function presentCompanyProfile(supabase, row) {
  const profile = mapCompanyProfile(row)
  if (!profile) return null
  profile.logoUrl = await displayImageUrl(supabase, profile.logoUrl, profile.logoPath)
  profile.bankQrUrl = await displayImageUrl(supabase, profile.bankQrUrl, profile.bankQrPath)
  return profile
}

function sidecarQrUrl(value) {
  const raw = String(value || '')
  return raw.startsWith('data:image/') ? raw : ''
}

const BANK_MARK = '__QG_BANK__'

function extractSidecarJsonArray(raw, key) {
  const text = String(raw || '')
  const needle = `"${key}"`
  const i = text.indexOf(needle)
  if (i < 0) return null
  const colon = text.indexOf(':', i + needle.length)
  if (colon < 0) return null
  let start = colon + 1
  while (start < text.length && /\s/.test(text[start])) start++
  if (text[start] !== '[') return null
  let depth = 0
  for (let j = start; j < text.length; j++) {
    const ch = text[j]
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, j + 1)) } catch { return null }
      }
    }
  }
  return null
}

function parseBankSidecar(footerText) {
  const raw = String(footerText || '')
  const idx = raw.indexOf(BANK_MARK)
  const emptyBank = { bankName: '', accountNo: '', ifsc: '', terms: '', accountName: '', branch: '', bankQrUrl: '', invoiceSeries: null, columnLayouts: [], activeColumnLayoutId: null, defaultUploadTemplateId: undefined, footerFit: null }
  if (idx === -1) {
    return { note: raw, bank: emptyBank, ok: true, missing: true }
  }
  const jsonText = raw.slice(idx + BANK_MARK.length).trim()
  const note = raw.slice(0, idx).replace(/\s+$/, '')
  try {
    const parsed = JSON.parse(jsonText)
    if (parsed && typeof parsed === 'object') {
      return {
        note,
        ok: true,
        bank: {
          bankName: String(parsed.bankName || ''),
          accountNo: String(parsed.accountNo || parsed.bankAccountNo || ''),
          ifsc: String(parsed.ifsc || parsed.bankIfsc || ''),
          terms: String(parsed.terms || parsed.standardTerms || ''),
          accountName: String(parsed.accountName || parsed.bankAccountName || ''),
          branch: String(parsed.branch || parsed.bankBranch || ''),
          bankQrUrl: sidecarQrUrl(parsed.bankQrUrl),
          invoiceSeries: parsed.invoiceSeries && typeof parsed.invoiceSeries === 'object' ? parsed.invoiceSeries : null,
          columnLayouts: Array.isArray(parsed.columnLayouts) ? parsed.columnLayouts : [],
          activeColumnLayoutId: parsed.activeColumnLayoutId || null,
          defaultUploadTemplateId: Object.prototype.hasOwnProperty.call(parsed, 'defaultUploadTemplateId')
            ? (parsed.defaultUploadTemplateId || null)
            : undefined,
          footerFit: parsed.footerFit && typeof parsed.footerFit === 'object' ? parsed.footerFit : null
        }
      }
    }
  } catch { /* recover named layouts from a truncated sidecar so a later PUT cannot wipe them */ }
  const recoveredLayouts = extractSidecarJsonArray(jsonText, 'columnLayouts')
  const idMatch = jsonText.match(/"activeColumnLayoutId"\s*:\s*"([^"]*)"/)
  return {
    note,
    ok: false,
    bank: {
      ...emptyBank,
      columnLayouts: Array.isArray(recoveredLayouts) ? recoveredLayouts : [],
      activeColumnLayoutId: idMatch ? idMatch[1] : null
    }
  }
}

function joinFooterWithBank(note, bank) {
  const n = String(note || '').replace(/\s+$/, '')
  const payload = {
    bankName: String(bank?.bankName || ''),
    accountNo: String(bank?.accountNo || ''),
    ifsc: String(bank?.ifsc || ''),
    terms: String(bank?.terms || ''),
    accountName: String(bank?.accountName || ''),
    branch: String(bank?.branch || '')
  }
  const qr = sidecarQrUrl(bank?.bankQrUrl)
  if (qr) payload.bankQrUrl = qr
  if (bank?.invoiceSeries && typeof bank.invoiceSeries === 'object') {
    payload.invoiceSeries = {
      defaultType: bank.invoiceSeries.defaultType || DEFAULT_INVOICE_SERIES_TYPE,
      series: bank.invoiceSeries.series && typeof bank.invoiceSeries.series === 'object' ? bank.invoiceSeries.series : {}
    }
  }
  const namedLayouts = normalizeNamedColumnLayouts(bank?.columnLayouts)
  if (namedLayouts.length) {
    payload.columnLayouts = namedLayouts
    payload.activeColumnLayoutId = bank?.activeColumnLayoutId || namedLayouts[0].id
  }
  if (bank?.defaultUploadTemplateId !== undefined) {
    payload.defaultUploadTemplateId = bank.defaultUploadTemplateId || null
  }
  if (bank?.footerFit) payload.footerFit = normalizeFooterFit(bank.footerFit)
  if (!payload.bankName && !payload.accountNo && !payload.ifsc && !payload.terms && !payload.accountName && !payload.branch && !payload.bankQrUrl && !payload.invoiceSeries && !payload.columnLayouts && !Object.prototype.hasOwnProperty.call(payload, 'defaultUploadTemplateId') && !payload.footerFit) return n
  return `${n}${n ? '\n\n' : ''}${BANK_MARK}\n${JSON.stringify(payload)}`
}

function normalizeNamedColumnLayouts(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.columns) || !item.columns.length) continue
    out.push({
      id: String(item.id || '').trim() || `cl_${out.length + 1}`,
      name: String(item.name || '').trim() || 'Untitled layout',
      columns: item.columns
    })
  }
  return out
}

function bankFromRow(row) {
  const sidecar = parseBankSidecar(row?.footer_text).bank
  return {
    bankName: String(row?.bank_name || sidecar.bankName || ''),
    bankAccountNo: String(row?.bank_account_no || sidecar.accountNo || ''),
    bankIfsc: String(row?.bank_ifsc || sidecar.ifsc || ''),
    bankAccountName: String(sidecar.accountName || ''),
    bankBranch: String(sidecar.branch || ''),
    standardTerms: String(row?.standard_terms || sidecar.terms || ''),
    bankQrUrl: row?.bank_qr_url || sidecar.bankQrUrl || null,
    bankQrPath: row?.bank_qr_path || null
  }
}

/** Header/footer banner images, which replace the text letterhead when set. */
const BANNER_SLOTS = {
  header: { urlCol: 'header_image_url', pathCol: 'header_image_path', folder: 'headers', label: 'Header image' },
  footer: { urlCol: 'footer_image_url', pathCol: 'footer_image_path', folder: 'footers', label: 'Footer image' }
}

function extensionForMime(mime) {
  if (mime.includes('svg')) return 'svg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'jpg'
}

function requireDb(res, requestId) {
  if (!isSupabaseConfigured()) {
    const err = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
    err.code = 'SUPABASE_UNAVAILABLE'
    err.status = 503
    supabaseError(err, res, requestId)
    return null
  }
  return getSupabase()
}

const MISSING_PROFILE_COL = /Could not find the '([^']+)' column/

/** Drops columns the live schema doesn't have yet, so a later migration isn't required to save. */
async function updateCompanyProfileRow(supabase, id, userId, patch) {
  const current = { ...patch }
  let lastError = null
  for (let i = 0; i < 12 && Object.keys(current).length; i++) {
    const { data, error } = await supabase
      .from('company_profile')
      .update(current)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*')
      .single()
    if (!error) return data
    lastError = error
    const match = String(error.message || '').match(MISSING_PROFILE_COL)
    if (!match) throw error
    delete current[match[1]]
  }
  throw lastError
}

function mapCompanyProfile(row) {
  if (!row) return null
  const bank = bankFromRow(row)
  const sidecar = parseBankSidecar(row.footer_text)
  const namedLayouts = normalizeNamedColumnLayouts(sidecar.bank.columnLayouts)
  const dbColumns = Array.isArray(row.column_layout) && row.column_layout.length ? row.column_layout : null
  const layouts = namedLayouts.length
    ? namedLayouts
    : (dbColumns ? [{ id: sidecar.bank.activeColumnLayoutId || 'default', name: 'Company default columns', columns: dbColumns }] : [])
  const activeLayout = layouts.find(l => l.id === sidecar.bank.activeColumnLayoutId) || layouts[0] || null
  const { note } = sidecar
  return {
    id: row.id,
    companyName: row.company_name ?? '',
    headerText: row.header_text ?? '',
    footerText: note,
    logoUrl: row.logo_url ?? null,
    logoPath: row.logo_path ?? null,
    logoWidth: row.logo_width ?? null,
    logoHeight: row.logo_height ?? null,
    headerImageUrl: row.header_image_url ?? null,
    headerImagePath: row.header_image_path ?? null,
    footerImageUrl: row.footer_image_url ?? null,
    footerImagePath: row.footer_image_path ?? null,
    gstNumber: row.gst_number ?? '',
    bankName: bank.bankName,
    bankAccountNo: bank.bankAccountNo,
    bankIfsc: bank.bankIfsc,
    bankAccountName: bank.bankAccountName,
    bankBranch: bank.bankBranch,
    bankQrUrl: bank.bankQrUrl,
    bankQrPath: bank.bankQrPath,
    standardTerms: bank.standardTerms,
    hsnCodeFormat: row.hsn_code_format || '4',
    columnLayout: activeLayout?.columns || dbColumns,
    columnLayouts: layouts,
    activeColumnLayoutId: activeLayout?.id || null,
    defaultUploadTemplateId: sidecar.bank.defaultUploadTemplateId !== undefined
      ? sidecar.bank.defaultUploadTemplateId
      : (row.default_upload_template_id || null),
    footerFit: normalizeFooterFit(sidecar.bank.footerFit),
    series: {
      prefix: row.series_prefix ?? 'QG',
      padding: row.series_padding ?? 4,
      nextNumber: row.series_next_number ?? 1,
      includeYear: row.series_include_year !== false,
      note: row.numbering_note || ''
    },
    invoiceSeries: mapInvoiceSeries(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function companyProfileUpdate(body = {}) {
  const patch = {}
  if (body.companyName != null) patch.company_name = String(body.companyName)
  if (body.headerText != null) patch.header_text = String(body.headerText)
  if (body.footerText != null) patch.footer_text = String(body.footerText)
  if (body.logoUrl !== undefined) patch.logo_url = body.logoUrl
  if (body.logoPath !== undefined) patch.logo_path = body.logoPath
  if (body.logoWidth !== undefined) patch.logo_width = body.logoWidth == null ? null : Number(body.logoWidth)
  if (body.logoHeight !== undefined) patch.logo_height = body.logoHeight == null ? null : Number(body.logoHeight)
  if (body.bankQrUrl !== undefined) patch.bank_qr_url = body.bankQrUrl
  if (body.bankQrPath !== undefined) patch.bank_qr_path = body.bankQrPath

  const series = body.series || {}
  if (series.prefix != null) patch.series_prefix = String(series.prefix).trim() || 'QG'
  if (series.padding != null) {
    const padding = Number(series.padding)
    if (!Number.isInteger(padding) || padding < 1 || padding > 12) {
      const err = new Error('series.padding must be an integer between 1 and 12')
      err.status = 400
      err.code = 'VALIDATION_ERROR'
      throw err
    }
    patch.series_padding = padding
  }
  if (series.nextNumber != null) {
    const next = Number(series.nextNumber)
    if (!Number.isInteger(next) || next < 1) {
      const err = new Error('series.nextNumber must be an integer >= 1')
      err.status = 400
      err.code = 'VALIDATION_ERROR'
      throw err
    }
    patch.series_next_number = next
  }
  if (series.includeYear != null) patch.series_include_year = Boolean(series.includeYear)

  if (body.gstNumber != null) patch.gst_number = String(body.gstNumber).trim()

  if (body.hsnCodeFormat != null) {
    const format = String(body.hsnCodeFormat).trim()
    if (format !== '4' && format !== '8') {
      const err = new Error('hsnCodeFormat must be "4" or "8"')
      err.status = 400
      err.code = 'VALIDATION_ERROR'
      throw err
    }
    patch.hsn_code_format = format
  }

  if (body.columnLayout !== undefined) {
    if (body.columnLayout !== null && !Array.isArray(body.columnLayout)) {
      const err = new Error('columnLayout must be an array of columns or null')
      err.status = 400
      err.code = 'VALIDATION_ERROR'
      throw err
    }
    patch.column_layout = body.columnLayout
  }

  const invoiceSeries = body.invoiceSeries || {}
  const wroteFromTypes = applyInvoiceSeriesTypes(patch, invoiceSeries)
  if (!wroteFromTypes) {
    if (invoiceSeries.prefix != null) patch.invoice_prefix = String(invoiceSeries.prefix).trim() || 'INV'
    if (invoiceSeries.padding != null) {
      const padding = Number(invoiceSeries.padding)
      if (!Number.isInteger(padding) || padding < 1 || padding > 12) {
        const err = new Error('invoiceSeries.padding must be an integer between 1 and 12')
        err.status = 400
        err.code = 'VALIDATION_ERROR'
        throw err
      }
      patch.invoice_padding = padding
    }
    if (invoiceSeries.nextNumber != null) {
      const next = Number(invoiceSeries.nextNumber)
      if (!Number.isInteger(next) || next < 1) {
        const err = new Error('invoiceSeries.nextNumber must be an integer >= 1')
        err.status = 400
        err.code = 'VALIDATION_ERROR'
        throw err
      }
      patch.invoice_next_number = next
    }
    if (invoiceSeries.includeYear != null) patch.invoice_include_year = Boolean(invoiceSeries.includeYear)
  }

  return patch
}

function requireInvoiceSeriesInt(value, min, max, field) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || (max != null && n > max)) {
    const err = new Error(field)
    err.status = 400
    err.code = 'VALIDATION_ERROR'
    throw err
  }
  return n
}

function buildInvoiceSeriesPack(invoiceSeries) {
  if (!invoiceSeries?.types || typeof invoiceSeries.types !== 'object' || Array.isArray(invoiceSeries.types)) {
    return null
  }
  const series = {}
  for (const type of INVOICE_SERIES_TYPES) {
    if (!invoiceSeries.types[type.id]) continue
    const raw = invoiceSeries.types[type.id]
    const fallback = normalizeSeriesSettings(null, type.id)
    series[type.id] = {
      prefix: String(raw?.prefix ?? fallback.prefix).trim() || fallback.prefix,
      padding: requireInvoiceSeriesInt(raw?.padding ?? fallback.padding, 1, 12, `invoiceSeries.${type.id}.padding must be an integer between 1 and 12`),
      nextNumber: requireInvoiceSeriesInt(raw?.nextNumber ?? fallback.nextNumber, 1, null, `invoiceSeries.${type.id}.nextNumber must be an integer >= 1`),
      includeYear: raw?.includeYear !== false
    }
  }
  const known = INVOICE_SERIES_TYPES.some(t => t.id === invoiceSeries.type)
  return {
    defaultType: known ? invoiceSeries.type : DEFAULT_INVOICE_SERIES_TYPE,
    series
  }
}

function applyInvoiceSeriesTypes(patch, invoiceSeries) {
  const pack = buildInvoiceSeriesPack(invoiceSeries)
  if (!pack) return false
  const sales = pack.series.sales_invoice
  if (sales) {
    patch.invoice_prefix = sales.prefix
    patch.invoice_padding = sales.padding
    patch.invoice_next_number = sales.nextNumber
    patch.invoice_include_year = sales.includeYear
  }
  return true
}

function invoicePackFromRow(row) {
  const sidecar = parseBankSidecar(row?.footer_text).bank.invoiceSeries
  if (sidecar && sidecar.series && typeof sidecar.series === 'object') {
    const known = INVOICE_SERIES_TYPES.some(t => t.id === sidecar.defaultType)
    return {
      defaultType: known ? sidecar.defaultType : DEFAULT_INVOICE_SERIES_TYPE,
      series: sidecar.series
    }
  }
  return parseInvoiceSeriesPack(row?.invoice_numbering_note)
}

function mapInvoiceSeries(row) {
  const sales = {
    prefix: row.invoice_prefix ?? 'INV',
    padding: row.invoice_padding ?? 4,
    nextNumber: row.invoice_next_number ?? 1,
    includeYear: row.invoice_include_year !== false
  }
  const pack = invoicePackFromRow(row)
  pack.series.sales_invoice = sales
  return {
    ...sales,
    type: pack.defaultType,
    types: pack.series
  }
}

/** One company_profile row per tenant — created lazily on first access. */
async function ensureCompanyProfile(supabase, userId) {
  const { data, error } = await supabase
    .from('company_profile')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (data) return data

  const { data: created, error: insertError } = await supabase
    .from('company_profile')
    .insert({ user_id: userId, company_name: 'My Company', series_prefix: 'QG', series_padding: 4, series_next_number: 1 })
    .select('*')
    .single()
  if (insertError) throw insertError
  return created
}

function formatSeriesNumber(profile) {
  const prefix = profile.series_prefix || 'QG'
  const padding = profile.series_padding ?? 4
  const next = profile.series_next_number ?? 1
  const padded = String(next).padStart(padding, '0')
  if (profile.series_include_year === false) return `${prefix}-${padded}`
  const year = new Date().getUTCFullYear()
  return `${prefix}-${year}-${padded}`
}

function invoiceKindFromProfile(profile) {
  return invoicePackFromRow(profile).defaultType || DEFAULT_INVOICE_SERIES_TYPE
}

function invoiceSettingsFromProfile(profile, type) {
  const pack = invoicePackFromRow(profile)
  const kind = type || pack.defaultType || DEFAULT_INVOICE_SERIES_TYPE
  if (kind === DEFAULT_INVOICE_SERIES_TYPE) {
    return {
      prefix: profile.invoice_prefix || 'INV',
      padding: profile.invoice_padding ?? 4,
      nextNumber: profile.invoice_next_number ?? 1,
      includeYear: profile.invoice_include_year !== false
    }
  }
  return normalizeSeriesSettings(pack.series[kind], kind)
}

function formatInvoiceNumber(profile, type) {
  return formatInvoiceSeriesNumber(invoiceSettingsFromProfile(profile, type))
}

async function consumeInvoiceNumber(supabase, userId, profile, kind) {
  if (!kind || kind === DEFAULT_INVOICE_SERIES_TYPE) {
    await supabase.rpc('allocate_invoice_number', { p_user_id: userId }).maybeSingle()
    return
  }
  const parsed = parseBankSidecar(profile.footer_text)
  const pack = invoicePackFromRow(profile)
  const current = normalizeSeriesSettings(pack.series[kind], kind)
  pack.series[kind] = { ...current, nextNumber: current.nextNumber + 1 }
  const nextBank = { ...parsed.bank, invoiceSeries: pack }
  const { error } = await supabase
    .from('company_profile')
    .update({ footer_text: joinFooterWithBank(parsed.note, nextBank) })
    .eq('id', profile.id)
    .eq('user_id', userId)
  if (error) throw error
}

function mapQuotation(row) {
  if (!row) return null
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    date: row.quote_date,
    layoutRef: row.layout_ref,
    // Undefined (not 0) before the revisions migration is applied, so the UI can
    // tell "no revision history yet" apart from "currently on Rev 0".
    revision: row.revision,
    docType: row.doc_type || 'quotation',
    sourceQuotationId: row.source_quotation_id ?? null,
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function quotationWriteFields(body = {}) {
  const data = body.data && typeof body.data === 'object' ? body.data : (body.quote && typeof body.quote === 'object' ? body.quote : body)
  const payload = { ...(typeof data === 'object' && !Array.isArray(data) ? data : {}) }
  // Prefer top-level fields when provided
  if (body.number != null) payload.number = body.number
  if (body.title != null) payload.title = body.title
  if (body.date != null) payload.date = body.date
  if (body.layoutRef != null) payload.layoutRef = body.layoutRef
  if (body.layout_ref != null) payload.layoutRef = body.layout_ref

  return {
    number: body.number != null ? String(body.number) : (payload.number != null ? String(payload.number) : null),
    title: body.title != null ? String(body.title) : (payload.title != null ? String(payload.title) : null),
    quote_date: body.date != null ? String(body.date) : (payload.date != null ? String(payload.date) : null),
    layout_ref: body.layoutRef != null
      ? String(body.layoutRef)
      : (body.layout_ref != null ? String(body.layout_ref) : (payload.layoutRef != null ? String(payload.layoutRef) : null)),
    data: payload
  }
}

function compactLineHints(items, columns) {
  const name = (c) => `${c?.id || ''} ${c?.label || ''}`.toLowerCase()
  const hsnCol = (columns || []).find(c => /hsn|sac/.test(name(c)))
  const unitCol = (columns || []).find(c => /unit|uom/.test(name(c)))
  const rateCol = (columns || []).find(c => c?.id === 'rate')
  const hints = []
  const seen = new Set()
  for (const item of items || []) {
    const description = String(item?.description || '').split('\n')[0].trim().slice(0, 240)
    const hsn = String(item?.[hsnCol?.id] || item?.hsn || item?.hsnCode || '').trim()
    const unit = String(item?.[unitCol?.id] || item?.unit || '').trim()
    const rate = String(item?.[rateCol?.id] || item?.rate || '').trim()
    const gst = String(item?.gst || item?.gstPercent || item?.['gst%'] || '').trim()
    if (!description && !hsn) continue
    const key = `${description.toLowerCase()}|${hsn}`
    if (seen.has(key)) continue
    seen.add(key)
    hints.push({ description, hsn, unit, rate, gst })
    if (hints.length >= 40) break
  }
  return hints
}

function mapProduct(row) {
  if (!row) return null
  return {
    id: row.id,
    key: row.key,
    description: row.description ?? '',
    hsn: row.hsn ?? '',
    gst: row.gst ?? '',
    rate: row.rate ?? '',
    keywords: formatKeywords(row.keywords),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function registerPersistenceRoutes(app) {
  app.get('/api/health/persistence', (req, res) => {
    res.json({
      configured: isSupabaseConfigured(),
      tables: ['company_profile', 'quotations', 'products', 'hsn_cache', 'knowledge_documents']
    })
  })

  // ----- company profile -----
  app.get('/api/company-profile', async (req, res) => {
    const requestId = `cp-get-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const row = await ensureCompanyProfile(supabase, req.userId)
      res.json({ profile: await presentCompanyProfile(supabase, row), configured: true })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.put('/api/company-profile', async (req, res) => {
    const requestId = `cp-put-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const body = req.body || {}
      const patch = companyProfileUpdate(body)
      const existing = await ensureCompanyProfile(supabase, req.userId)
      const existingSidecar = parseBankSidecar(existing.footer_text)
      const incomingPack = buildInvoiceSeriesPack(body.invoiceSeries)
      const existingBank = bankFromRow(existing)
      const incoming = body.footerText != null ? parseBankSidecar(body.footerText) : null
      const nextBank = {
        bankName: body.bankName != null ? String(body.bankName) : (incoming?.bank.bankName || existingBank.bankName),
        accountNo: body.bankAccountNo != null ? String(body.bankAccountNo) : (incoming?.bank.accountNo || existingBank.bankAccountNo),
        ifsc: body.bankIfsc != null ? String(body.bankIfsc) : (incoming?.bank.ifsc || existingBank.bankIfsc),
        accountName: body.bankAccountName != null ? String(body.bankAccountName) : (incoming?.bank.accountName || existingBank.bankAccountName),
        branch: body.bankBranch != null ? String(body.bankBranch) : (incoming?.bank.branch || existingBank.bankBranch),
        bankQrUrl: body.bankQrUrl !== undefined
          ? sidecarQrUrl(body.bankQrUrl)
          : (existingSidecar.bank.bankQrUrl || sidecarQrUrl(incoming?.bank.bankQrUrl)),
        terms: body.standardTerms != null ? String(body.standardTerms) : (incoming?.bank.terms || existingBank.standardTerms),
        invoiceSeries: incomingPack
          ? {
              defaultType: incomingPack.defaultType,
              series: { ...(existingSidecar.bank.invoiceSeries?.series || {}), ...incomingPack.series }
            }
          : existingSidecar.bank.invoiceSeries,
        columnLayouts: body.columnLayouts != null
          ? normalizeNamedColumnLayouts(body.columnLayouts)
          : (existingSidecar.bank.columnLayouts || []),
        activeColumnLayoutId: body.activeColumnLayoutId != null
          ? String(body.activeColumnLayoutId)
          : existingSidecar.bank.activeColumnLayoutId,
        defaultUploadTemplateId: body.defaultUploadTemplateId !== undefined
          ? (body.defaultUploadTemplateId || null)
          : existingSidecar.bank.defaultUploadTemplateId,
        footerFit: body.footerFit != null
          ? normalizeFooterFit(body.footerFit)
          : existingSidecar.bank.footerFit
      }
      const bankTouched = body.bankName != null || body.bankAccountNo != null || body.bankIfsc != null || body.bankAccountName != null || body.bankBranch != null
      const termsTouched = body.standardTerms != null
      const invoiceTouched = incomingPack != null
      const layoutsTouched = body.columnLayouts != null || body.activeColumnLayoutId != null
      const defaultLayoutTouched = body.defaultUploadTemplateId !== undefined
      const footerFitTouched = body.footerFit != null
      if (body.footerText != null || bankTouched || termsTouched || invoiceTouched || layoutsTouched || defaultLayoutTouched || footerFitTouched) {
        const note = incoming ? incoming.note : existingSidecar.note
        patch.footer_text = joinFooterWithBank(note, nextBank)
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ error: 'No valid company profile fields provided.', code: 'VALIDATION_ERROR', requestId })
      }

      const data = await updateCompanyProfileRow(supabase, existing.id, req.userId, patch)
      res.json({ profile: await presentCompanyProfile(supabase, data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  /**
   * Turns a plain-English numbering instruction ("we're on QG-2026-0530,
   * continue from there") into the structured {prefix, padding, nextNumber,
   * includeYear} that actually drives the deterministic per-quote counter.
   * The AI only runs here, once, when the user asks — every quote after that
   * just increments a plain integer, so numbering stays sequential and never
   * depends on the AI at generation time.
   */
  app.post('/api/company-profile/numbering-suggest', async (req, res) => {
    const requestId = `cp-numbering-${Date.now()}`
    try {
      const { note, kind, current } = req.body || {}
      if (!String(note || '').trim()) {
        return res.status(400).json({ error: 'Describe how you want the numbering to work first.', code: 'VALIDATION_ERROR', requestId })
      }
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: 'AI is not configured (OPENAI_API_KEY missing).', code: 'AI_UNAVAILABLE', requestId })
      }
      const label = kind === 'invoice' ? 'invoice' : 'quotation'
      const client = createAiClient()
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
      const completion = await client.chat.completions.create({
        model,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You configure ${label} number series for an Indian B2B quotation tool.
Given the user's plain-English instructions and their current series settings, decide the series config.
Return ONLY valid JSON: {"prefix":"QG","padding":4,"nextNumber":1,"includeYear":true}
prefix: short letters, no spaces/numbers. padding: digit count 1-12 (zero-padded). nextNumber: integer >= 1, the NEXT number to assign. includeYear: whether the year is inserted (e.g. QG-2026-0001) vs not (QG-0001).
If the instruction gives a full example number (e.g. "QG-2026-0530" or "continue after INV-2044"), extract prefix/padding/includeYear from its shape and set nextNumber to the number that comes after it.
If something isn't specified, keep the current value.`
          },
          {
            role: 'user',
            content: `Current: ${JSON.stringify(current || {})}\nInstructions: ${note}`
          }
        ]
      })
      const raw = completion.choices?.[0]?.message?.content || '{}'
      let parsed
      try { parsed = JSON.parse(raw) } catch { parsed = {} }

      const prefix = String(parsed.prefix || current?.prefix || 'QG').trim().slice(0, 12) || 'QG'
      const padding = Math.min(12, Math.max(1, Number.isFinite(Number(parsed.padding)) ? Math.round(Number(parsed.padding)) : Number(current?.padding) || 4))
      const nextNumber = Math.max(1, Number.isFinite(Number(parsed.nextNumber)) ? Math.round(Number(parsed.nextNumber)) : Number(current?.nextNumber) || 1)
      const includeYear = parsed.includeYear != null ? Boolean(parsed.includeYear) : (current?.includeYear !== false)

      res.json({ suggestion: { prefix, padding, nextNumber, includeYear }, requestId })
    } catch (error) {
      if (/relation|does not exist|PGRST|schema cache/i.test(error?.message || '')) {
        return res.status(503).json({
          error: 'Database tables missing or incomplete. Apply the latest supabase migration, then retry.',
          code: 'SCHEMA_MISSING',
          detail: error.message,
          requestId
        })
      }
      res.status(502).json({ error: error?.message || 'Could not work out the numbering from that.', code: 'AI_ERROR', requestId })
    }
  })

  app.post('/api/company-profile/logo', (req, res) => {
    const requestId = `cp-logo-${Date.now()}`
    logoUpload.single('logo')(req, res, async (err) => {
      const supabase = requireDb(res, requestId)
      if (!supabase) return
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? 'Logo must be under 1.5 MB.'
          : (err.message || 'Logo upload failed')
        return res.status(400).json({ error: message, code: 'VALIDATION_ERROR', requestId })
      }
      try {
        const file = req.file
        if (!file?.buffer?.length) {
          return res.status(400).json({ error: 'logo file is required.', code: 'VALIDATION_ERROR', requestId })
        }
        const mime = String(file.mimetype || '')
        if (!/^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i.test(mime)) {
          return res.status(400).json({ error: 'Logo must be an image (png, jpg, webp, gif, or svg).', code: 'VALIDATION_ERROR', requestId })
        }

        const existing = await ensureCompanyProfile(supabase, req.userId)
        const widthRaw = req.body?.logoWidth != null ? Number(req.body.logoWidth) : existing.logo_width
        const heightRaw = req.body?.logoHeight != null ? Number(req.body.logoHeight) : existing.logo_height
        const logoWidth = Number.isFinite(widthRaw) && widthRaw > 0 ? Math.round(widthRaw) : 120
        const logoHeight = Number.isFinite(heightRaw) && heightRaw > 0 ? Math.round(heightRaw) : null

        const ext = mime.includes('svg') ? 'svg'
          : mime.includes('png') ? 'png'
            : mime.includes('webp') ? 'webp'
              : mime.includes('gif') ? 'gif'
                : 'jpg'
        const path = `logos/${existing.id}.${ext}`
        let stored
        try {
          stored = await storeCompanyImage(supabase, path, file)
        } catch (storageError) {
          console.warn(`[${requestId}] storage upload failed, falling back to data URL`, storageError?.message || storageError)
          if (file.buffer.length > INLINE_IMAGE_MAX) {
            return res.status(502).json({
              error: 'Could not store logo in Supabase Storage, and file is too large for inline fallback.',
              code: 'STORAGE_ERROR',
              requestId
            })
          }
          stored = { url: dataUrlFromBuffer(file.buffer, mime), path: null }
        }

        const data = await updateCompanyProfileRow(supabase, existing.id, req.userId, {
          logo_url: stored.url,
          logo_path: stored.path,
          logo_width: logoWidth,
          logo_height: logoHeight
        })
        res.json({ profile: await presentCompanyProfile(supabase, data) })
      } catch (error) {
        supabaseError(error, res, requestId)
      }
    })
  })

  app.delete('/api/company-profile/logo', async (req, res) => {
    const requestId = `cp-logo-del-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const existing = await ensureCompanyProfile(supabase, req.userId)
      if (existing.logo_path) {
        await supabase.storage.from(LOGO_BUCKET).remove([existing.logo_path]).catch(() => {})
      }
      const { data, error } = await supabase
        .from('company_profile')
        .update({ logo_url: null, logo_path: null })
        .eq('id', existing.id)
        .eq('user_id', req.userId)
        .select('*')
        .single()
      if (error) throw error
      res.json({ profile: mapCompanyProfile(data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.post('/api/company-profile/bank-qr', (req, res) => {
    const requestId = `cp-bank-qr-${Date.now()}`
    logoUpload.single('image')(req, res, async (err) => {
      const supabase = requireDb(res, requestId)
      if (!supabase) return
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? 'QR image must be under 1.5 MB.'
          : (err.message || 'QR upload failed')
        return res.status(400).json({ error: message, code: 'VALIDATION_ERROR', requestId })
      }
      try {
        const file = req.file
        if (!file?.buffer?.length) {
          return res.status(400).json({ error: 'QR image is required.', code: 'VALIDATION_ERROR', requestId })
        }
        const mime = String(file.mimetype || '')
        if (!/^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i.test(mime)) {
          return res.status(400).json({ error: 'QR must be an image (png, jpg, webp, gif, or svg).', code: 'VALIDATION_ERROR', requestId })
        }

        const existing = await ensureCompanyProfile(supabase, req.userId)
        const path = `bank-qr/${existing.id}.${extensionForMime(mime)}`
        let stored
        try {
          stored = await storeCompanyImage(supabase, path, file)
        } catch (storageError) {
          console.warn(`[${requestId}] storage upload failed, falling back to data URL`, storageError?.message || storageError)
          if (file.buffer.length > INLINE_IMAGE_MAX) {
            return res.status(502).json({
              error: 'Could not store the QR in Supabase Storage, and the file is too large for inline fallback.',
              code: 'STORAGE_ERROR',
              requestId
            })
          }
          stored = { url: dataUrlFromBuffer(file.buffer, mime), path: null }
        }

        const previousPath = existing.bank_qr_path
        if (previousPath && previousPath !== stored.path) {
          await supabase.storage.from(LOGO_BUCKET).remove([previousPath]).catch(() => {})
        }

        let data
        try {
          data = await updateCompanyProfileRow(supabase, existing.id, req.userId, {
            bank_qr_url: stored.url,
            bank_qr_path: stored.path
          })
        } catch (columnError) {
          console.warn(`[${requestId}] bank_qr columns missing, storing QR in profile sidecar`, columnError?.message || columnError)
          data = existing
        }

        const hasCol = data && Object.prototype.hasOwnProperty.call(data, 'bank_qr_url')
        const sidecar = parseBankSidecar(data.footer_text)
        if (!hasCol) {
          if (file.buffer.length > INLINE_IMAGE_MAX) {
            return res.status(502).json({
              error: 'Bank QR columns are missing. Apply supabase/migrations/20260819060000_bank_qr.sql, then retry.',
              code: 'SCHEMA_MISSING',
              requestId
            })
          }
          data = await updateCompanyProfileRow(supabase, existing.id, req.userId, {
            footer_text: joinFooterWithBank(sidecar.note, {
              ...sidecar.bank,
              bankQrUrl: dataUrlFromBuffer(file.buffer, mime)
            })
          })
        } else if (sidecar.bank.bankQrUrl) {
          data = await updateCompanyProfileRow(supabase, existing.id, req.userId, {
            footer_text: joinFooterWithBank(sidecar.note, { ...sidecar.bank, bankQrUrl: '' })
          })
        }

        res.json({ profile: await presentCompanyProfile(supabase, data) })
      } catch (error) {
        supabaseError(error, res, requestId)
      }
    })
  })

  app.delete('/api/company-profile/bank-qr', async (req, res) => {
    const requestId = `cp-bank-qr-del-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const existing = await ensureCompanyProfile(supabase, req.userId)
      if (existing.bank_qr_path) {
        await supabase.storage.from(LOGO_BUCKET).remove([existing.bank_qr_path]).catch(() => {})
      }
      let data = existing
      try {
        data = await updateCompanyProfileRow(supabase, existing.id, req.userId, {
          bank_qr_url: null,
          bank_qr_path: null
        })
      } catch {
        data = existing
      }
      const sidecar = parseBankSidecar(data.footer_text)
      if (sidecar.bank.bankQrUrl) {
        data = await updateCompanyProfileRow(supabase, existing.id, req.userId, {
          footer_text: joinFooterWithBank(sidecar.note, { ...sidecar.bank, bankQrUrl: '' })
        })
      }
      res.json({ profile: await presentCompanyProfile(supabase, data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.post('/api/company-profile/banner/:slot', (req, res) => {
    const requestId = `cp-banner-${Date.now()}`
    const slot = BANNER_SLOTS[String(req.params.slot || '').toLowerCase()]
    if (!slot) {
      return res.status(400).json({ error: 'slot must be header or footer.', code: 'VALIDATION_ERROR', requestId })
    }
    logoUpload.single('image')(req, res, async (err) => {
      const supabase = requireDb(res, requestId)
      if (!supabase) return
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? `${slot.label} must be under 1.5 MB.`
          : (err.message || 'Image upload failed')
        return res.status(400).json({ error: message, code: 'VALIDATION_ERROR', requestId })
      }
      try {
        const file = req.file
        if (!file?.buffer?.length) {
          return res.status(400).json({ error: 'image file is required.', code: 'VALIDATION_ERROR', requestId })
        }
        const mime = String(file.mimetype || '')
        if (!/^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i.test(mime)) {
          return res.status(400).json({ error: `${slot.label} must be an image (png, jpg, webp, gif, or svg).`, code: 'VALIDATION_ERROR', requestId })
        }

        const existing = await ensureCompanyProfile(supabase, req.userId)
        const path = `${slot.folder}/${existing.id}.${extensionForMime(mime)}`
        let imageUrl = null
        let imagePath = null

        try {
          await ensureLogoBucket(supabase)
          const { error: upErr } = await supabase.storage
            .from(LOGO_BUCKET)
            .upload(path, file.buffer, { contentType: mime, upsert: true })
          if (upErr) throw upErr
          const { data: pub } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path)
          imageUrl = pub?.publicUrl || null
          imagePath = path
        } catch (storageError) {
          console.warn(`[${requestId}] storage upload failed, falling back to data URL`, storageError?.message || storageError)
          if (file.buffer.length > 400 * 1024) {
            return res.status(502).json({
              error: `Could not store the ${slot.label.toLowerCase()} in Supabase Storage, and it is too large to embed inline (400 KB max).`,
              code: 'STORAGE_ERROR',
              requestId
            })
          }
          imageUrl = dataUrlFromBuffer(file.buffer, mime)
          imagePath = null
        }

        // Storage upserts by path, so a replacement overwrites the old object
        // unless the file type changed and the extension moved with it.
        const previousPath = existing[slot.pathCol]
        if (previousPath && previousPath !== imagePath) {
          await supabase.storage.from(LOGO_BUCKET).remove([previousPath]).catch(() => {})
        }

        const { data, error } = await supabase
          .from('company_profile')
          .update({ [slot.urlCol]: imageUrl, [slot.pathCol]: imagePath })
          .eq('id', existing.id)
          .eq('user_id', req.userId)
          .select('*')
          .single()
        if (error) throw error
        res.json({ profile: mapCompanyProfile(data) })
      } catch (error) {
        supabaseError(error, res, requestId)
      }
    })
  })

  app.delete('/api/company-profile/banner/:slot', async (req, res) => {
    const requestId = `cp-banner-del-${Date.now()}`
    const slot = BANNER_SLOTS[String(req.params.slot || '').toLowerCase()]
    if (!slot) {
      return res.status(400).json({ error: 'slot must be header or footer.', code: 'VALIDATION_ERROR', requestId })
    }
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const existing = await ensureCompanyProfile(supabase, req.userId)
      if (existing[slot.pathCol]) {
        await supabase.storage.from(LOGO_BUCKET).remove([existing[slot.pathCol]]).catch(() => {})
      }
      const { data, error } = await supabase
        .from('company_profile')
        .update({ [slot.urlCol]: null, [slot.pathCol]: null })
        .eq('id', existing.id)
        .eq('user_id', req.userId)
        .select('*')
        .single()
      if (error) throw error
      res.json({ profile: mapCompanyProfile(data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // ----- quotation series -----
  app.get('/api/quotation-series/peek', async (req, res) => {
    const requestId = `series-peek-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const profile = await ensureCompanyProfile(supabase, req.userId)
      res.json({
        number: formatSeriesNumber(profile),
        prefix: profile.series_prefix,
        padding: profile.series_padding,
        nextNumber: profile.series_next_number,
        includeYear: profile.series_include_year !== false
      })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  /** Suggested next invoice number, without consuming it. */
  app.get('/api/invoice-series/peek', async (req, res) => {
    const requestId = `inv-peek-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const profile = await ensureCompanyProfile(supabase, req.userId)
      const kind = invoiceKindFromProfile(profile)
      const settings = invoiceSettingsFromProfile(profile, kind)
      res.json({
        number: formatInvoiceSeriesNumber(settings),
        prefix: settings.prefix,
        padding: settings.padding,
        nextNumber: settings.nextNumber,
        includeYear: settings.includeYear,
        type: kind,
        label: invoiceSeriesTypeById(kind).label
      })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.get('/api/quotation-series/next', async (req, res) => {
    const requestId = `series-next-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase.rpc('allocate_quotation_number', { p_user_id: req.userId })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.number) {
        // Fallback if RPC missing: client-side style increment via select/update
        const profile = await ensureCompanyProfile(supabase, req.userId)
        const number = formatSeriesNumber(profile)
        const { error: upErr } = await supabase
          .from('company_profile')
          .update({ series_next_number: (profile.series_next_number ?? 1) + 1 })
          .eq('id', profile.id)
        if (upErr) throw upErr
        return res.json({
          number,
          prefix: profile.series_prefix,
          padding: profile.series_padding,
          allocated: profile.series_next_number,
          includeYear: profile.series_include_year !== false,
          mode: 'fallback'
        })
      }
      res.json({
        number: row.number,
        prefix: row.prefix,
        padding: row.padding,
        allocated: row.allocated,
        includeYear: row.include_year,
        mode: 'atomic'
      })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // ----- quotations CRUD -----
  app.get('/api/quotations', async (req, res) => {
    const requestId = `q-list-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
      const listFor = (columns) => supabase
        .from('quotations')
        .select(columns)
        .eq('user_id', req.userId)
        .order('updated_at', { ascending: false })
        .limit(limit)

      const BASE = 'id, number, title, quote_date, layout_ref, created_at, updated_at, data'
      // Each optional column is dropped one step at a time so the list keeps
      // working on databases where a later migration hasn't been applied yet.
      const VARIANTS = [`${BASE}, revision, doc_type, source_quotation_id`, `${BASE}, revision`, BASE]
      let data = null
      let error = null
      for (const columns of VARIANTS) {
        ;({ data, error } = await listFor(columns))
        if (!error) break
        if (!/revision|doc_type|source_quotation_id|schema cache|PGRST20[24]|42703/i.test(error.message || '')) break
      }
      if (error) throw error
      res.json({
        quotations: (data || []).map(r => {
          const items = Array.isArray(r.data?.items) ? r.data.items : []
          const cols = Array.isArray(r.data?.columns) ? r.data.columns : []
          let total = 0
          try { total = computeQuoteTotals(items, cols, r.data?.extraLines).grandTotal || 0 } catch { total = 0 }
          return {
            id: r.id,
            number: r.number,
            title: r.title,
            date: r.quote_date,
            layoutRef: r.layout_ref,
            revision: r.revision,
            docType: r.doc_type || 'quotation',
            sourceQuotationId: r.source_quotation_id ?? null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            customer: r.data?.customer || {},
            columns: cols,
            itemCount: items.length,
            total,
            lineHints: compactLineHints(items, cols)
          }
        })
      })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.get('/api/quotations/:id', async (req, res) => {
    const requestId = `q-get-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('quotations')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'Quotation not found.', code: 'NOT_FOUND', requestId })
      res.json({ quotation: mapQuotation(data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.post('/api/quotations', async (req, res) => {
    const requestId = `q-create-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const fields = { ...quotationWriteFields(req.body || {}), user_id: req.userId }
      const { data, error } = await supabase
        .from('quotations')
        .insert(fields)
        .select('*')
        .single()
      if (error) throw error
      res.status(201).json({ quotation: mapQuotation(data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.put('/api/quotations/:id', async (req, res) => {
    const requestId = `q-update-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const fields = quotationWriteFields(req.body || {})
      const { data, error } = await supabase
        .from('quotations')
        .update(fields)
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .select('*')
        .maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'Quotation not found.', code: 'NOT_FOUND', requestId })
      res.json({ quotation: mapQuotation(data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  /**
   * Convert a quotation into a sales invoice.
   *
   * The invoice is a new row (doc_type 'invoice') carrying a copy of the quote
   * content and its own number from the invoice series, so the original quotation
   * stays exactly as it was sent. A customer GSTIN is mandatory: a tax invoice
   * without one is not a valid document, so this refuses rather than guessing.
   */
  app.post('/api/quotations/:id/convert-to-invoice', async (req, res) => {
    const requestId = `q-invoice-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data: source, error: readError } = await supabase
        .from('quotations')
        .select('*')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (readError) throw readError
      if (!source) return res.status(404).json({ error: 'Quotation not found.', code: 'NOT_FOUND', requestId })

      if ((source.doc_type || 'quotation') === 'invoice') {
        return res.status(400).json({ error: 'This document is already an invoice.', code: 'ALREADY_INVOICE', requestId })
      }

      const sourceData = source.data && typeof source.data === 'object' ? source.data : {}
      const customer = { ...(sourceData.customer || {}) }
      // The request may carry a GSTIN the user just typed, before autosave lands.
      const bodyGst = req.body?.customerGst != null ? String(req.body.customerGst).trim() : ''
      const gst = bodyGst || String(customer.gst || '').trim()
      if (!gst) {
        return res.status(400).json({
          error: 'A customer GST number is required to raise a sales invoice.',
          code: 'GST_REQUIRED',
          requestId
        })
      }
      customer.gst = gst

      // The user types the invoice number; the series only supplies the default.
      // Accepting their number as-is means the series counter is still advanced
      // when they keep the suggestion, so the next default doesn't repeat itself.
      const requested = req.body?.number != null ? String(req.body.number).trim() : ''
      let invoiceNumber = requested
      const profile = await ensureCompanyProfile(supabase, req.userId)
      const invoiceKind = invoiceKindFromProfile(profile)
      const suggested = formatInvoiceNumber(profile, invoiceKind)
      const kindLabel = invoiceSeriesTypeById(invoiceKind).label

      if (requested) {
        const { data: clash, error: clashError } = await supabase
          .from('quotations')
          .select('id')
          .eq('user_id', req.userId)
          .eq('number', requested)
          .limit(1)
        if (clashError) throw clashError
        if (clash?.length) {
          return res.status(409).json({
            error: `${requested} is already used by another document. Invoice numbers must be unique.`,
            code: 'NUMBER_IN_USE',
            requestId
          })
        }

        if (requested === suggested) {
          await consumeInvoiceNumber(supabase, req.userId, profile, invoiceKind)
        }
      } else if (invoiceKind === DEFAULT_INVOICE_SERIES_TYPE) {
        const { data: allocated, error: numberError } = await supabase
          .rpc('allocate_invoice_number', { p_user_id: req.userId })
          .maybeSingle()
        if (numberError) throw numberError
        invoiceNumber = allocated?.number
      } else {
        invoiceNumber = suggested
        await consumeInvoiceNumber(supabase, req.userId, profile, invoiceKind)
      }

      if (!invoiceNumber) throw new Error('Could not allocate an invoice number')

      const today = new Date().toISOString().slice(0, 10)
      const invoiceData = {
        ...sourceData,
        customer,
        number: invoiceNumber,
        date: today,
        docType: 'invoice',
        invoiceKind,
        title: String(req.body?.title || sourceData.title || kindLabel),
        // Provenance kept inside the payload too, so an exported/copied invoice
        // still records which quotation it came from.
        sourceQuotation: { id: source.id, number: source.number || null }
      }
      delete invoiceData.revision

      const insert = {
        user_id: req.userId,
        number: invoiceNumber,
        title: invoiceData.title,
        quote_date: today,
        layout_ref: source.layout_ref,
        doc_type: 'invoice',
        source_quotation_id: source.id,
        data: invoiceData
      }

      const { data, error } = await supabase
        .from('quotations')
        .insert(insert)
        .select('*')
        .single()
      if (error) throw error
      res.status(201).json({ invoice: mapQuotation(data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.delete('/api/quotations/:id', async (req, res) => {
    const requestId = `q-del-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('quotations')
        .delete()
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) return res.status(404).json({ error: 'Quotation not found.', code: 'NOT_FOUND', requestId })
      res.json({ ok: true, id: data.id })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // ----- products (per-tenant; hsn_cache stays global/shared) -----
  app.get('/api/products', async (req, res) => {
    const requestId = `prod-list-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const q = String(req.query.q || '').trim().toLowerCase().replace(/[%_,.()\\]/g, ' ').replace(/\s+/g, ' ').trim()
      let query = supabase
        .from('products')
        .select('*')
        .eq('user_id', req.userId)
        .order('updated_at', { ascending: false })
        .limit(200)
      if (q) query = query.or(`key.ilike.%${q}%,description.ilike.%${q}%,keywords.ilike.%${q}%`)
      let { data, error } = await query
      if (error && /keywords|schema cache|PGRST204/i.test(error.message || '')) {
        query = supabase
          .from('products')
          .select('*')
          .eq('user_id', req.userId)
          .order('updated_at', { ascending: false })
          .limit(200)
        if (q) query = query.or(`key.ilike.%${q}%,description.ilike.%${q}%`)
        ;({ data, error } = await query)
      }
      if (error) throw error
      res.json({ products: (data || []).map(mapProduct) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  app.put('/api/products', async (req, res) => {
    const requestId = `prod-upsert-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const body = req.body || {}
      const key = String(body.key || '').trim().toLowerCase()
      if (!key) {
        return res.status(400).json({ error: 'Product key is required.', code: 'VALIDATION_ERROR', requestId })
      }
      const row = {
        key,
        user_id: req.userId,
        description: body.description != null ? String(body.description) : '',
        hsn: body.hsn != null ? String(body.hsn) : '',
        gst: body.gst != null ? String(body.gst) : '',
        rate: body.rate != null ? String(body.rate) : '',
        updated_at: new Date().toISOString()
      }
      if (body.keywords != null) row.keywords = formatKeywords(body.keywords)
      let { data, error } = await supabase
        .from('products')
        .upsert(row, { onConflict: 'user_id,key' })
        .select('*')
        .single()
      if (error && /rate|schema cache|PGRST204/i.test(error.message || '')) {
        const { rate: _rate, ...withoutRate } = row
        ;({ data, error } = await supabase
          .from('products')
          .upsert(withoutRate, { onConflict: 'user_id,key' })
          .select('*')
          .single())
      }
      if (error && /keywords|schema cache|PGRST204/i.test(error.message || '')) {
        const { keywords: _keywords, rate: _rate, ...withoutKeywords } = row
        ;({ data, error } = await supabase
          .from('products')
          .upsert(withoutKeywords, { onConflict: 'user_id,key' })
          .select('*')
          .single())
      }
      if (error) throw error

      // hsn_cache is global/shared (HSN/GST are public tax codes, not tenant secrets).
      await supabase.from('hsn_cache').upsert({
        key,
        description: row.description,
        hsn: row.hsn,
        gst: row.gst,
        updated_at: row.updated_at
      }, { onConflict: 'key' })

      res.json({ product: mapProduct(data) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // Knowledge document routes live in server/knowledge.js.
}
