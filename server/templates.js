import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { getDataDir } from './runtimeFs.js'

function storePath() {
  return path.join(getDataDir(), 'templates.json')
}

/** Rich visual style — drives how the whole quotation paper looks. */
export const DEFAULT_VISUAL = {
  lookFamily: 'classic-print', // excel-grid | letterhead | modern-card | classic-print | dense-industrial | centered-formal
  pageBg: '#edf1ed',
  paperBg: '#ffffff',
  textColor: '#17231f',
  mutedColor: '#64748b',
  accent: '#235c4f',
  accentSoft: '#eef6f3',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  titleLabel: 'QUOTATION',
  header: {
    variant: 'split', // split | centered | banner | topbar | letterhead
    bg: '#ffffff',
    textColor: '#17231f',
    borderBottom: '2px solid #235c4f',
    showLogoMark: true,
    titleAlign: 'right'
  },
  customer: {
    variant: 'two-column-soft', // two-column-soft | boxed-grid | plain-lines | underline | single-card
    bg: '#f7f9f7',
    border: 'none',
    radius: '12px'
  },
  table: {
    variant: 'horizontal', // full-grid | horizontal | open | striped
    headerBg: '#f7f9f7',
    headerColor: '#64748b',
    headerUppercase: true,
    borderColor: '#e8ede8',
    density: 'comfortable' // comfortable | compact
  },
  totals: {
    variant: 'right-simple', // right-simple | right-box | full-bar
    show: true
  },
  notes: {
    variant: 'two-col', // two-col | stacked | boxed
    show: true,
    showClarifications: true
  },
  terms: {
    variant: 'dashed-rows', // dashed-rows | boxed-list | compact-grid
    show: true
  },
  signatory: {
    align: 'right',
    show: true,
    label: 'Authorized Signatory'
  },
  showSrNo: true,
  quotedToTitle: 'Quoted to',
  customerDetailsTitle: 'Customer details',
  notesTitle: 'Notes',
  clarificationsTitle: 'Clarifications required',
  termsTitle: 'Commercial terms'
}

export const DEFAULT_LAYOUT = {
  ...DEFAULT_VISUAL,
  // backward-compatible flat keys used by older templates
  headerStyle: 'classic',
  tableDensity: 'comfortable',
  showNotes: true,
  showClarifications: true,
  showTerms: true,
  showTotal: true,
  footerSignatory: 'Authorized Signatory',
  customerFields: ['name', 'company', 'gst', 'location']
}

export const DEFAULT_COMPANY = {
  name: 'Your Company Name',
  address: 'Your address · City, State · PIN',
  phone: '+91 00000 00000',
  email: 'sales@yourcompany.com'
}

export const DEFAULT_TERM_KEYS = ['validity', 'delivery', 'payment', 'taxes', 'freight']

function ensureStore() {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(storePath())) {
    fs.writeFileSync(storePath(), JSON.stringify({ templates: [] }, null, 2))
  }
}

function readStore() {
  ensureStore()
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    return { templates: Array.isArray(raw.templates) ? raw.templates : [] }
  } catch {
    return { templates: [] }
  }
}

function writeStore(store) {
  ensureStore()
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2))
}

function slugify(label) {
  const base = String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9%]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9%]/g, '')
    .replace(/^./, c => c.toLowerCase())
  return base || 'column'
}

function uniqueColumnId(label, existing) {
  let id = slugify(label)
  let n = 2
  while (existing.some(c => c.id === id)) id = `${slugify(label)}${n++}`
  return id
}

export function normalizeTemplateColumns(columns) {
  if (!Array.isArray(columns) || !columns.length) {
    return [
      { id: 'description', label: 'Description' },
      { id: 'unit', label: 'Unit' },
      { id: 'quantity', label: 'Quantity' },
      { id: 'rate', label: 'Rate' },
      { id: 'amount', label: 'Amount' }
    ]
  }
  const out = []
  for (const col of columns) {
    const label = String(col?.label || col?.id || '').trim()
    if (!label) continue
    const id = col?.id ? String(col.id) : uniqueColumnId(label, out)
    if (out.some(c => c.id === id)) continue
    out.push({ id, label })
  }
  return out.length ? out : normalizeTemplateColumns([])
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out
}

/** Map legacy flat layout keys into rich visual structure. */
export function normalizeLayout(input = {}) {
  const visualIn = input.visual && typeof input.visual === 'object' ? input.visual : {}
  const merged = deepMerge(DEFAULT_LAYOUT, { ...input, ...visualIn })

  // legacy bridges
  if (input.headerStyle && !visualIn.header?.variant) {
    const map = { classic: 'split', compact: 'letterhead', banner: 'banner' }
    merged.header = { ...merged.header, variant: map[input.headerStyle] || merged.header.variant }
  }
  if (input.tableDensity && !visualIn.table?.density) {
    merged.table = { ...merged.table, density: input.tableDensity }
  }
  if (input.accent) {
    merged.accent = input.accent
    merged.header = { ...merged.header, borderBottom: merged.header.borderBottom?.includes('solid') ? `2px solid ${input.accent}` : merged.header.borderBottom }
  }
  if (typeof input.showNotes === 'boolean') merged.notes = { ...merged.notes, show: input.showNotes }
  if (typeof input.showClarifications === 'boolean') merged.notes = { ...merged.notes, showClarifications: input.showClarifications }
  if (typeof input.showTerms === 'boolean') merged.terms = { ...merged.terms, show: input.showTerms }
  if (typeof input.showTotal === 'boolean') merged.totals = { ...merged.totals, show: input.showTotal }
  if (input.footerSignatory) merged.signatory = { ...merged.signatory, label: input.footerSignatory }

  merged.customerFields = Array.isArray(merged.customerFields) && merged.customerFields.length
    ? merged.customerFields.map(String)
    : [...DEFAULT_LAYOUT.customerFields]

  // keep flat mirrors for older UI bits
  merged.headerStyle = merged.header?.variant === 'banner' ? 'banner' : merged.header?.variant === 'letterhead' ? 'compact' : 'classic'
  merged.tableDensity = merged.table?.density || 'comfortable'
  merged.showNotes = merged.notes?.show !== false
  merged.showClarifications = merged.notes?.showClarifications !== false
  merged.showTerms = merged.terms?.show !== false
  merged.showTotal = merged.totals?.show !== false
  merged.footerSignatory = merged.signatory?.label || 'Authorized Signatory'
  merged.visual = {
    lookFamily: merged.lookFamily,
    pageBg: merged.pageBg,
    paperBg: merged.paperBg,
    textColor: merged.textColor,
    mutedColor: merged.mutedColor,
    accent: merged.accent,
    accentSoft: merged.accentSoft,
    fontFamily: merged.fontFamily,
    header: merged.header,
    customer: merged.customer,
    table: merged.table,
    totals: merged.totals,
    notes: merged.notes,
    terms: merged.terms,
    signatory: merged.signatory
  }

  return merged
}

function clampPct(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(100, Math.max(0, v))
}

const COMPANY_ROLES = new Set([
  'company.name',
  'company.address',
  'company.phone',
  'company.email',
  'docTitle'
])

/** Keep layout + seller identity only — wipe reference products / customer / WO data. */
export function scrubReplicaShell(replica, company = {}) {
  if (!replica) return null
  const pages = Array.isArray(replica.pages)
    ? replica.pages.map((p, i) => ({
      index: Number(p.index ?? i),
      src: String(p.src || ''),
      width: p.width ? Number(p.width) : null,
      height: p.height ? Number(p.height) : null
    })).filter(p => p.src)
    : []

  const slots = (Array.isArray(replica.slots) ? replica.slots : []).map((s, i) => {
    const role = String(s.role || 'custom')
    const keepValue = COMPANY_ROLES.has(role)
    let value = ''
    if (keepValue) {
      if (role === 'company.name') value = company.name || s.value || ''
      else if (role === 'company.address') value = company.address || s.value || ''
      else if (role === 'company.phone') value = company.phone || s.value || ''
      else if (role === 'company.email') value = company.email || s.value || ''
      else if (role === 'docTitle') value = s.value || 'QUOTATION'
      else value = String(s.value || '')
    }
    return {
      id: String(s.id || `slot_${i}`),
      role,
      label: String(s.label || role || `Field ${i + 1}`),
      page: Number(s.page || 0),
      x: clampPct(s.x),
      y: clampPct(s.y),
      w: Math.max(2, clampPct(s.w ?? 20)),
      h: Math.max(1.2, clampPct(s.h ?? 3)),
      value
    }
  })

  let table = null
  if (replica.table) {
    const x = Math.max(0, clampPct(replica.table.x ?? 5) - 1)
    const y = Math.max(0, clampPct(replica.table.y ?? 28) - 5)
    const w = Math.min(100 - x, Math.max(20, clampPct(replica.table.w ?? 90) + 2))
    const h = Math.min(100 - y, Math.max(15, clampPct(replica.table.h ?? 45) + 8))
    table = {
      page: Number(replica.table.page || 0),
      x, y, w, h,
      headerHeightPct: Math.max(1, Number(replica.table.headerHeightPct || 3)),
      rowHeightPct: Math.max(1, Number(replica.table.rowHeightPct || 3.2)),
      showSrNo: replica.table.showSrNo !== false,
      columns: normalizeTemplateColumns(replica.table.columns || [])
        .map((c, idx, arr) => ({
          ...c,
          widthPct: Number(replica.table.columns?.[idx]?.widthPct) || Math.round(100 / Math.max(1, arr.length))
        }))
    }
  }

  return {
    mode: 'exact',
    assetId: String(replica.assetId || ''),
    pages,
    slots,
    table
  }
}

export function normalizeTemplate(input = {}) {
  const now = new Date().toISOString()
  const layout = normalizeLayout(input.layout || input.visual || {})

  const termKeys = Array.isArray(input.termKeys) && input.termKeys.length
    ? input.termKeys.map(k => String(k).toLowerCase().replace(/\s+/g, ''))
    : [...DEFAULT_TERM_KEYS]

  const defaultTerms = {}
  for (const key of termKeys) {
    defaultTerms[key] = String(input.defaultTerms?.[key] ?? '')
  }

  const company = {
    name: String(input.company?.name || DEFAULT_COMPANY.name),
    address: String(input.company?.address || DEFAULT_COMPANY.address),
    phone: String(input.company?.phone || DEFAULT_COMPANY.phone),
    email: String(input.company?.email || DEFAULT_COMPANY.email)
  }

  const replica = input.replica && typeof input.replica === 'object'
    ? scrubReplicaShell(input.replica, company)
    : null

  const docIn = input.doc && typeof input.doc === 'object' ? input.doc : null
  const docCols = normalizeTemplateColumns(docIn?.table?.columns || input.columns || [])
  const doc = docIn ? {
    accent: String(docIn.accent || '#235c4f'),
    fontFamily: String(docIn.fontFamily || 'Arial, Helvetica, sans-serif'),
    logoText: String(docIn.logoText || (company.name || 'Q').slice(0, 2)).toUpperCase(),
    permanent: {
      companyName: String(docIn.permanent?.companyName || company.name || ''),
      companyDetails: String(docIn.permanent?.companyDetails || company.address || ''),
      phone: String(docIn.permanent?.phone || company.phone || ''),
      email: String(docIn.permanent?.email || company.email || ''),
      docTitle: String(docIn.permanent?.docTitle || 'QUOTATION'),
      notes: String(docIn.permanent?.notes || ''),
      terms: String(docIn.permanent?.terms || ''),
      bank: String(docIn.permanent?.bank || ''),
      footer: String(docIn.permanent?.footer || '')
    },
    dynamic: {
      quoteNumberPlaceholder: String(docIn.dynamic?.quoteNumberPlaceholder || 'QG-XXXX'),
      datePlaceholder: String(docIn.dynamic?.datePlaceholder || 'DD/MM/YYYY'),
      customerPlaceholder: String(docIn.dynamic?.customerPlaceholder || 'Customer company name'),
      subjectPlaceholder: String(docIn.dynamic?.subjectPlaceholder || 'Quotation for …')
    },
    table: {
      showSrNo: docIn.table?.showSrNo !== false,
      columns: docCols
    }
  } : null

  return {
    id: input.id || `tpl_${randomBytes(6).toString('hex')}`,
    name: String(input.name || 'My quotation layout').trim() || 'My quotation layout',
    columns: normalizeTemplateColumns(
      doc?.table?.columns?.length
        ? doc.table.columns
        : (replica?.table?.columns?.length ? replica.table.columns : input.columns)
    ),
    company,
    layout,
    replica,
    doc,
    termKeys,
    defaultTerms,
    notes: [],
    layoutMode: input.layoutMode === 'beautified'
      ? 'beautified'
      : (doc ? 'editable-doc' : (replica?.pages?.length ? 'exact' : 'faithful')),
    lookSummary: String(input.lookSummary || ''),
    confirmed: Boolean(input.confirmed),
    sourceHint: String(input.sourceHint || ''),
    createdAt: input.createdAt || now,
    updatedAt: now
  }
}

export function listTemplates() {
  return readStore().templates.map(normalizeTemplate)
}

export function getTemplate(id) {
  return listTemplates().find(t => t.id === id) || null
}

export function saveTemplate(input) {
  const store = readStore()
  const template = normalizeTemplate(input)
  const idx = store.templates.findIndex(t => t.id === template.id)
  if (idx >= 0) {
    template.createdAt = store.templates[idx].createdAt || template.createdAt
    store.templates[idx] = template
  } else {
    store.templates.push(template)
  }
  writeStore(store)
  return template
}

export function deleteTemplate(id) {
  const store = readStore()
  const before = store.templates.length
  store.templates = store.templates.filter(t => t.id !== id)
  writeStore(store)
  return store.templates.length < before
}

export function heuristicTemplateFromText(text, name = 'Imported layout') {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const headerLine = lines.find(l => /sr\.?\s*no|description|qty|quantity|rate|amount|hsn/i.test(l)) || ''
  const parts = headerLine.split(/\t+| {2,}|\s*\|\s*/).map(p => p.trim()).filter(Boolean)
  const labels = parts
    .map(p => p.replace(/sr\.?\s*no\.?/i, '').trim())
    .filter(p => p && !/^sr/i.test(p))
  const wanted = labels.length >= 3
    ? labels.slice(0, 10)
    : ['Description', 'Unit', 'Quantity', 'Rate', 'Amount']

  const columns = []
  for (const label of wanted) {
    columns.push({ id: uniqueColumnId(label, columns), label })
  }
  if (!columns.some(c => /desc/i.test(c.id) || /desc/i.test(c.label))) {
    columns.unshift({ id: 'description', label: 'Description' })
  }

  const companyName = lines.find(l => /pvt|ltd|llp|industries|traders|enterprises|company/i.test(l)) || DEFAULT_COMPANY.name
  const looksGrid = /\|/.test(text) || /\t/.test(text)

  const company = { ...DEFAULT_COMPANY, name: companyName.slice(0, 80) }
  const termsBlock = lines.filter(l => /validity|payment|delivery|freight|tax|condition|terms/i.test(l)).slice(0, 12).join('\n')
  const bankBlock = lines.filter(l => /bank|ifsc|a\/c|account|favour|favor/i.test(l)).slice(0, 8).join('\n')

  return normalizeTemplate({
    name,
    columns,
    company,
    layout: {
      ...DEFAULT_LAYOUT,
      lookFamily: looksGrid ? 'excel-grid' : 'classic-print',
      table: {
        ...DEFAULT_VISUAL.table,
        variant: looksGrid ? 'full-grid' : 'horizontal',
        density: 'compact'
      },
      showClarifications: /clarif/i.test(text),
      showNotes: /note/i.test(text),
      showTerms: /validity|payment|delivery|freight|tax/i.test(text)
    },
    doc: {
      accent: '#235c4f',
      fontFamily: 'Arial, Helvetica, sans-serif',
      logoText: String(company.name || 'Q').slice(0, 2).toUpperCase(),
      permanent: {
        companyName: company.name,
        companyDetails: company.address || '',
        phone: company.phone || '',
        email: company.email || '',
        docTitle: 'QUOTATION',
        notes: '',
        terms: termsBlock,
        bank: bankBlock,
        footer: [company.phone, company.email].filter(Boolean).join(' · ')
      },
      dynamic: {
        quoteNumberPlaceholder: 'QG-XXXX',
        datePlaceholder: 'DD/MM/YYYY',
        customerPlaceholder: 'Customer company name',
        subjectPlaceholder: 'Quotation for …'
      },
      table: { showSrNo: true, columns }
    },
    lookSummary: 'Editable recreation — permanent shell kept, enquiry data as placeholders',
    layoutMode: 'editable-doc',
    sourceHint: 'heuristic',
    confirmed: false
  })
}

export const analyzeTemplatePrompt = `You convert an uploaded Indian B2B quotation (PDF/image) into an EDITABLE DOCUMENT MODEL for QuoteGen.

Goal: recreate the quotation as structured editable content — NOT coordinate overlays on an image.
Split content into:
- PERMANENT (repeatable shell): company name, logo mark text, address, phones, emails, document title label (e.g. QUOTATION), T&Cs, payment/bank details, footer/contact — keep real values from the seller.
- DYNAMIC (enquiry-specific): quote/WO number, dates, customer/TO, subject, department, and ALL line-item products — replace with placeholders / empty for future enquiries.

Return ONLY valid JSON:
{
  "name": "Short template name",
  "lookSummary": "Editable recreation of the uploaded quotation shell",
  "layoutMode": "editable-doc",
  "company": {"name":"","address":"","phone":"","email":""},
  "columns": [{"label":"Column header as printed"}],
  "doc": {
    "accent": "#c41e3a",
    "fontFamily": "Arial, Helvetica, sans-serif",
    "logoText": "HM",
    "permanent": {
      "companyName": "Seller company as printed",
      "companyDetails": "Full address / PAN / GST / CIN block as printed (seller only)",
      "phone": "",
      "email": "",
      "docTitle": "QUOTATION",
      "notes": "Standing notes if any",
      "terms": "Full T&Cs text as printed (keep)",
      "bank": "Payment terms + bank account details as printed (keep)",
      "footer": "Footer phones / web / address as printed (keep)"
    },
    "dynamic": {
      "quoteNumberPlaceholder": "QG-XXXX",
      "datePlaceholder": "DD/MM/YYYY",
      "customerPlaceholder": "Customer company name",
      "subjectPlaceholder": "Quotation for …"
    },
    "table": {
      "showSrNo": true,
      "columns": [{"label":"STAFF"},{"label":"HRS."},{"label":"SALARY PER PERSON"}]
    }
  },
  "termKeys": ["validity","delivery","payment","taxes","freight"],
  "defaultTerms": {"validity":"","delivery":"","payment":"","taxes":"","freight":""}
}

Rules:
- NEVER copy enquiry-specific line items / dates / quote numbers / customer names into permanent fields.
- Keep seller bank details, T&Cs, footer, company identity in permanent with real text.
- columns = printed table headers left→right (skip Sr. No.; use showSrNo).
- accent = dominant brand colour from the document (hex).
- fontFamily = closest web-safe match to the document (Arial/Calibri/Georgia/Times).
- logoText = 1–3 letter mark from company name if logo cannot be extracted.
- If something is unclear, leave permanent text empty rather than inventing.`

export const beautifyTemplatePrompt = `Improve the editable document model for cleaner professional presentation while keeping the same permanent vs dynamic split and columns. Return the same JSON shape with layoutMode "beautified".`
