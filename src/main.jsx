import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import UploadDoc from './UploadDoc.jsx'
import UploadedTemplateQuote from './UploadedTemplateQuote.jsx'
import KnowledgeBasePanel from './KnowledgeBasePanel.jsx'
import AuthScreen from './AuthScreen.jsx'
import BrandMark from './BrandMark.jsx'
import { getCurrentSession, installAuthFetch, onAuthChange, signOut } from './apiAuth.js'
import { downloadQuotationPdf, onQuoteAssetImgError, quotationFileName, quoteAssetSrc } from './pdfExport.js'
import { downloadQuotationExcel, downloadQuotationWord } from './officeExport.js'
import { formatIndianAmount } from '../shared/templateMap.js'
import {
  autofillFromKnowledge,
  buildQuotationPayload,
  checkPersistenceHealth,
  cloneQuotationForNew,
  createQuotation,
  createRevision,
  deleteQuoteImage,
  fetchCompanyProfile,
  formatSeriesPreview,
  getQuotation,
  getRevision,
  ingestEnquiryFiles,
  learnFromQuote,
  listProducts,
  listQuotations,
  listRevisions,
  lookupHsnGst,
  restoreRevision,
  peekQuotationSeries,
  parseQuotationSample,
  syncQuotationSeriesFromNumber,
  quotationToEditorState,
  convertQuotationToInvoice,
  peekInvoiceSeries,
  removeCompanyBanner,
  removeCompanyLogo,
  removeCompanyBankQr,
  saveCompanyProfile,
  SUPABASE_SETUP_HINT,
  updateQuotation,
  uploadCompanyBanner,
  uploadCompanyLogo,
  uploadCompanyBankQr,
  uploadQuoteFile,
  uploadQuoteImage
} from './quotePersistence.js'
import {
  DEFAULT_INVOICE_SERIES_TYPE,
  INVOICE_SERIES_TYPES,
  defaultSeriesSettings,
  invoiceSeriesTypeById
} from '../shared/invoiceSeries.js'
import {
  QuotePaperHeader,
  QuoteStudioCanvas,
  QuoteStudioFooterBar,
  QuoteStudioToolbar,
  QuoteToSubjectBlock,
  LayoutStyleCards
} from './QuoteStudio.jsx'
import { defaultValidUntil, resolvePaperTheme, DEFAULT_ACCENT, PAPER_THEMES, extractImagePalette, accentForTableColor } from './quotePaperThemes.js'
import { A4_WIDTH_PX, defaultA4Pages, measureA4Blocks, normalizeA4Pages, packA4Pages, pagesEqual } from './a4Pagination.js'
import { SuggestField, SuggestionMenu } from './SuggestField.jsx'
import { applyProductToItem, clientsFromQuotations, matchProducts, productsFromHistory } from './suggestCatalog.js'
import FormulaGuide from './FormulaGuide.jsx'
import RichTextField, { RichTextView } from './RichTextField.jsx'
import FloatingPop from './FloatingPop.jsx'
import { footerFitCssVars, normalizeFooterFit, patchFooterFit } from '../shared/footerFit.js'
import {
  amountCellState,
  amountEditPatch,
  amountKey,
  blankExtraLine,
  blankItemFor,
  clearAmountOverride,
  columnMode,
  columnType,
  COLUMN_TYPE_LABELS,
  computeQuoteTotals,
  convertItemForType,
  DEFAULT_HIGHLIGHT_COLOR,
  extraLineResolvedAmount,
  extraLineUnit,
  findFieldColumn,
  attachmentUrlKey,
  highlightColor,
  hsnDigits as getHsnDigits,
  imageEditKey,
  imagePathKey,
  isAttachmentColumn,
  isHighlightColumn,
  isImageColumn,
  isNestedColumn,
  isSuggestedColumn,
  insertTypedColumns,
  moveColumnInList,
  nestedFieldInfo,
  normalizeColumnList,
  normalizeImageEdit,
  rateKey,
  recalcAllRows,
  recalcRow,
  sourceKey,
  toNumber,
  withColumnKeys,
  withoutColumnKeys
} from '../shared/quoteColumns.js'
import {
  canHaveFormula,
  clearFormulaOverride,
  formulaCellState,
  formulaEditPatch,
  adaptAmountFormula,
  syncAmountFormula,
  formulaForAddedColumn,
  formulaSentence,
  isFormulaColumn,
  normalizeFormula
} from '../shared/quoteFormulas.js'
import {
  attachSuggestedColumn,
  fillSuggestedOnItems,
  SUGGESTED_COLUMN_ENABLED,
  withoutSuggestedColumns
} from '../shared/productKeywords.js'

const DEFAULT_DATA_COLUMNS = [
  { id: 'description', label: 'Description', type: 'text' },
  { id: 'unit', label: 'Unit', type: 'text' },
  { id: 'quantity', label: 'Quantity', type: 'text' },
  { id: 'rate', label: 'Rate', type: 'text' },
  { id: 'amount', label: 'Amount', type: 'text' }
]

function columnLayoutKey(cols) {
  return (cols || []).map(c => {
    const formula = normalizeFormula(c.formula)
    return [
      c.id,
      c.label,
      c.type || 'text',
      c.mode || '',
      c.digits || '',
      c.imageWidth || '',
      c.color || '',
      formula ? JSON.stringify(formula) : ''
    ].join(':')
  }).join('|')
}

/** Named company layouts, the company default, then unique layouts from recent quotes. */
function collectSavedLayouts(profile, quotations = []) {
  const out = []
  const seenIds = new Set()
  const seenKeys = new Set()
  const push = (layout) => {
    if (!layout || !Array.isArray(layout.columns) || !layout.columns.length) return
    const id = String(layout.id || '').trim() || `cl_${out.length + 1}`
    const key = columnLayoutKey(layout.columns)
    if (seenIds.has(id) || seenKeys.has(key)) return
    seenIds.add(id)
    seenKeys.add(key)
    out.push({
      id,
      name: String(layout.name || '').trim() || 'Untitled layout',
      columns: layout.columns,
      source: layout.source || 'company'
    })
  }

  const named = Array.isArray(profile?.columnLayouts) ? profile.columnLayouts : []
  for (const layout of named) push({ ...layout, source: 'company' })

  if (Array.isArray(profile?.columnLayout) && profile.columnLayout.length) {
    push({
      id: profile.activeColumnLayoutId || 'default',
      name: 'Company default columns',
      columns: profile.columnLayout,
      source: 'company'
    })
  }

  for (const q of quotations || []) {
    const cols = Array.isArray(q.columns) && q.columns.length
      ? q.columns
      : (Array.isArray(q.data?.columns) ? q.data.columns : [])
    if (!cols.length) continue
    push({
      id: `used_${q.id}`,
      name: q.number ? `Used on ${q.number}` : (q.title || 'Previous quotation'),
      columns: cols,
      source: 'quote'
    })
  }

  return out
}

/** Step 7: keep the add-column choices simple and practical. */
const ADDABLE_COLUMN_TYPES = [
  { type: 'image', label: 'Image column', hint: 'Drop an image per row — it shows in the table, preview, and PDF', defaultLabel: 'Image' },
  { type: 'attachment', label: 'Attachment column', hint: 'Drop a file, name the link, open it from the quotation', defaultLabel: 'Attachment' },
  { type: 'tax', label: 'Tax column', hint: 'A % or amount column — pick below', defaultLabel: 'Tax' },
  { type: 'discount', label: 'Discount column', hint: 'A % or amount column — pick below', defaultLabel: 'Discount' },
  { type: 'hsn', label: 'HSN column', hint: 'HSN or SAC code per row', defaultLabel: 'HSN' }
]

/** The landing-page "+ Add column" panel offers plain text alongside the typed options. */
const BUILDER_COLUMN_TYPES = [
  { type: 'text', label: 'Text column', hint: 'Plain text cell — the default', defaultLabel: 'Column' },
  { type: 'formula', label: 'Formula column', hint: 'Custom calculated column — Quantity × Rate, % of Amount…', defaultLabel: 'Calculated' },
  ...ADDABLE_COLUMN_TYPES
]

const HIGHLIGHT_SWATCHES = ['#fff3bf', '#ffe3e3', '#d3f9d8', '#d0ebff', '#e5dbff', '#ffe8cc']

// Attaches the bearer token to every /api/* call before any component mounts.
installAuthFetch()

const defaultTerms = { validity: '15 days', delivery: 'To be confirmed', payment: 'To be confirmed', taxes: 'Extra as applicable', freight: 'To be confirmed' }
const Icon = ({ children, size = 18 }) => <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center">{children}</span>

function slugify(label) {
  const base = label.trim().toLowerCase()
    .replace(/[^a-z0-9%]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9%]/g, '')
    .replace(/^./, c => c.toLowerCase())
  return base || 'column'
}

function uniqueId(label, existing) {
  let id = slugify(label)
  let n = 2
  while (existing.some(c => c.id === id)) { id = `${slugify(label)}${n++}` }
  return id
}

function makeTypedColumn(label, type = 'text', existing = [], options = {}) {
  const resolved = type === 'formula' ? 'text' : type
  const col = { id: uniqueId(label, existing), label, type: resolved }
  if (type === 'formula') col.calculated = true
  if (resolved === 'highlight') col.color = DEFAULT_HIGHLIGHT_COLOR
  if (resolved === 'image') col.imageWidth = 96
  if (resolved === 'tax' || resolved === 'discount') col.mode = options.mode === 'amount' ? 'amount' : 'percent'
  if (resolved === 'hsn') col.digits = options.digits === '8' ? '8' : '4'
  return col
}

function unitInsertIndex(columns) {
  const unitIdx = columns.findIndex(c => c.id === 'unit')
  if (unitIdx >= 0) return unitIdx
  const qtyIdx = columns.findIndex(c => c.id === 'quantity')
  return qtyIdx >= 0 ? qtyIdx : columns.length
}

function insertColumnsBeforeUnit(columns, newCols) {
  // Prefer commercial placement (HSN / discount / tax); fall back to before Unit.
  return insertTypedColumns(columns, newCols)
}

/** Ensure an HSN column exists so HSN lookup has somewhere to write. */
function ensureHsnGstColumns(columns) {
  const next = Array.isArray(columns) ? [...columns] : []
  const scalar = next.filter(c => !isNestedColumn(c) && !isImageColumn(c))
  const hasHsn = scalar.some(c => /hsn|sac/i.test(String(c.id)) || /hsn|sac/i.test(String(c.label)))
  const toAdd = []
  if (!hasHsn) toAdd.push({ id: uniqueId('HSN Code', [...next, ...toAdd]), label: 'HSN Code', type: 'hsn', digits: '4' })
  if (!toAdd.length) return columns
  return insertTypedColumns(next, toAdd)
}

const moveColumn = moveColumnInList

const blankItem = blankItemFor

function stripMarkdownBold(text) {
  return String(text || '').replace(/\*\*/g, '')
}

function splitDescription(value) {
  const text = stripMarkdownBold(value)
  if (!text) return { primary: '', secondary: '' }

  const newline = text.indexOf('\n')
  if (newline >= 0) {
    return { primary: text.slice(0, newline).trim(), secondary: text.slice(newline + 1).trim() }
  }

  const dash = text.match(/^(.+?)\s+[–—-]\s+(.+)$/)
  if (dash) return { primary: dash[1].trim(), secondary: dash[2].trim() }

  // Industrial comma-separated format: "BOLT, ALLEN, BSW, 5/8X3 Inch"
  const parts = text.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length >= 3) {
    return { primary: parts.slice(0, 2).join(', '), secondary: parts.slice(2).join(', ') }
  }
  if (parts.length === 2) {
    return { primary: parts[0], secondary: parts[1] }
  }

  return { primary: text, secondary: '' }
}

async function readApiResponse(response) {
  const text = await response.text()
  if (!text) {
    throw new Error('Server returned an empty response. Run npm run dev and keep the terminal open.')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Server returned an invalid response. Run npm run dev and try again.')
  }
}

function money(n) {
  return `₹ ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function TotalsExtraLines({ lines, base, onAdd, onUpdate, onRemove }) {
  const nameRef = useRef(null)
  const pendingFocus = useRef(false)

  const add = () => {
    pendingFocus.current = true
    onAdd({ ...blankExtraLine(), label: '', amount: '' })
  }

  useEffect(() => {
    if (!pendingFocus.current) return
    pendingFocus.current = false
    nameRef.current?.focus()
  }, [lines.length])

  return (
    <>
      {lines.map((line, i) => {
        const resolved = extraLineResolvedAmount(line, base)
        const isLess = line.kind !== 'add'
        const isPercent = extraLineUnit(line) === 'percent'
        const name = String(line.label || '').trim() || 'Extra'
        return (
          <div key={line.id || i}>
            <div className="no-print mt-1.5 flex items-center gap-1">
              <button
                type="button"
                title={isLess ? 'Subtract from total' : 'Add to total'}
                onClick={() => onUpdate(i, { kind: isLess ? 'add' : 'less' })}
                className="w-5 shrink-0 text-sm text-slate-400 hover:text-slate-700"
              >
                {isLess ? '−' : '+'}
              </button>
              <input
                ref={i === lines.length - 1 ? nameRef : undefined}
                value={line.label || ''}
                onChange={e => onUpdate(i, { label: e.target.value })}
                placeholder="Name"
                className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] text-slate-500 outline-none placeholder:text-slate-300"
              />
              <input
                value={line.amount ?? ''}
                onChange={e => onUpdate(i, { amount: e.target.value })}
                placeholder="0"
                inputMode="decimal"
                className="w-14 bg-transparent py-0.5 text-right text-[13px] text-slate-500 outline-none placeholder:text-slate-300"
              />
              <button
                type="button"
                title={isPercent ? 'Percent of total' : 'Rupee amount'}
                onClick={() => onUpdate(i, { unit: isPercent ? 'amount' : 'percent' })}
                className="w-5 shrink-0 text-xs text-slate-400 hover:text-slate-600"
              >
                {isPercent ? '%' : '₹'}
              </button>
              <button
                type="button"
                onClick={() => onRemove(i)}
                title="Remove"
                className="w-4 shrink-0 text-slate-300 hover:text-rose-500"
              >
                ×
              </button>
            </div>
            <div className="mt-1 hidden justify-between text-sm text-slate-500 print:flex">
              <span>{name}{isPercent ? ` (${String(line.amount || '').trim()}%)` : ''}</span>
              <span>{isLess ? '− ' : ''}{money(resolved)}</span>
            </div>
          </div>
        )
      })}
      <button type="button" onClick={add} className="no-print mt-1.5 text-[12px] font-normal text-slate-400 hover:text-moss">
        + add line
      </button>
    </>
  )
}

function printAmountText(value) {
  if (value === '' || value == null) return ''
  const num = Number(value)
  if (!Number.isFinite(num)) return String(value)
  const hasFraction = Math.abs(num % 1) > 0.004
  return num.toLocaleString('en-IN', { minimumFractionDigits: hasFraction ? 2 : 0, maximumFractionDigits: 2 })
}

function productSuggestionItems(products, query) {
  return matchProducts(products, query).map(p => ({
    id: `${p.description}|${p.hsn}|${p.rate}`,
    title: p.description || p.hsn || 'Product',
    meta: [p.hsn, p.unit, p.rate !== '' ? `₹ ${p.rate}` : ''].filter(Boolean).join(' · '),
    product: p
  }))
}

function DescriptionCell({ value, onChange, onBlurExtra, products, onPickProduct }) {
  const [editing, setEditing] = useState(false)
  const pickedRef = useRef(false)
  const clean = stripMarkdownBold(value)
  const { primary, secondary } = splitDescription(clean)
  const [draft, setDraft] = useState(clean)
  useEffect(() => {
    if (!editing) setDraft(stripMarkdownBold(value))
  }, [value, editing])

  const suggestions = useMemo(() => {
    if (!editing || String(draft || '').trim().length < 1) return []
    return productSuggestionItems(products, draft)
  }, [editing, draft, products])

  // Resting view: first line bold (title), details muted — same as original.
  // Edit mode only while focused, so typing stays snappy without losing hierarchy.
  if (!editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={e => { if (e.key === 'Enter') setEditing(true) }}
        className="description-cell min-w-0 w-full cursor-text rounded p-2 leading-snug hover:bg-slate-50"
      >
        {primary
          ? <p className="font-semibold text-ink">{primary}</p>
          : <span className="text-slate-300">—</span>}
        {secondary && <p className="mt-1 whitespace-pre-line text-xs font-normal leading-relaxed text-slate-500">{secondary}</p>}
      </div>
    )
  }

  return (
    <>
      <SuggestField
        multiline
        autoFocus
        value={draft}
        onChange={(v) => {
          const next = stripMarkdownBold(v)
          setDraft(next)
          onChange(next)
        }}
        suggestions={suggestions}
        onPick={(item) => {
          pickedRef.current = true
          onPickProduct?.(item.product)
          setEditing(false)
        }}
        onBlur={() => {
          if (pickedRef.current) {
            pickedRef.current = false
            return
          }
          setEditing(false)
          onBlurExtra?.()
        }}
        placeholder={'Product name on first line\ndetails on lines below'}
        className="no-print w-full min-w-0 resize-y rounded p-2 text-sm outline-none ring-2 ring-blue-50 hover:bg-slate-50 focus:bg-blue-50"
      />
      <div className="description-cell hidden min-w-0 print:block">
        {primary ? <p className="font-semibold text-ink">{primary}</p> : null}
        {secondary && <p className="mt-1 whitespace-pre-line text-xs font-normal leading-relaxed text-slate-500">{secondary}</p>}
      </div>
    </>
  )
}

function KnowledgeFillBadge() {
  return null
}

function HsnGstFillBadge({ fill }) {
  return null
}

/** A typed Amount that disagrees with Quantity × Rate — and the way back to it. */
function AmountOverrideBadge({ computed, onRevert }) {
  return (
    <button
      type="button"
      onClick={onRevert}
      title={`Manual amount. Quantity × Rate is ${computed}. Click to use the calculated value.`}
      className="no-print ml-1 inline-flex items-center rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 hover:bg-amber-100"
    >
      ↺
    </button>
  )
}

function displayNameFromFile(file) {
  const name = String(file?.name || 'Document').trim()
  return name.replace(/\.[a-z0-9]+$/i, '') || name
}

function isImageFile(file) {
  if (!file) return false
  if (/^image\//i.test(file.type || '')) return true
  return /\.(png|jpe?g|webp|gif|svg|bmp|heic|heif)$/i.test(file.name || '')
}

function stopFileDrag(e) {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function ImageCell({ col, value, path, edit, onChange, onEditChange, onFitColumn, rowIndex }) {
  const fileRef = useRef(null)
  const drag = useRef(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')
  const [liveSize, setLiveSize] = useState(null)
  const [natural, setNatural] = useState({ w: 1, h: 1 })
  const savedSize = normalizeImageEdit(edit).size
  const size = liveSize ?? savedSize
  const aspect = natural.w > 0 && natural.h > 0 ? natural.w / natural.h : 1
  const height = size
  const width = Math.max(24, Math.round(size * aspect))
  const src = quoteAssetSrc(value, path)
  const fitRef = useRef(onFitColumn)
  fitRef.current = onFitColumn

  useEffect(() => {
    fitRef.current?.(col.id, rowIndex, value ? width : 0)
  }, [col.id, rowIndex, value, width])

  useEffect(() => () => {
    fitRef.current?.(col.id, rowIndex, 0)
  }, [col.id, rowIndex])

  const addFile = async (file) => {
    if (!file) return
    if (!isImageFile(file)) {
      setError('Drop an image file.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await uploadQuoteImage(file)
      onChange(result.url, result.path)
    } catch (err) {
      setError(err?.message || 'Could not add this image.')
    } finally {
      setBusy(false)
    }
  }

  const clear = (e) => {
    e?.stopPropagation()
    onChange('', null)
  }

  const onResizeStart = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, size }
    drag.current = { ...start, latest: size }
    setLiveSize(size)
    const move = (ev) => {
      const delta = Math.round((ev.clientX - start.x + ev.clientY - start.y) / 2)
      const next = Math.max(32, Math.min(240, start.size + delta))
      drag.current = { ...start, latest: next }
      setLiveSize(next)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      const next = drag.current?.latest ?? start.size
      drag.current = null
      setLiveSize(null)
      onEditChange({ size: next, width: Math.round(next * aspect) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  return (
    <div
      className={`quote-media-cell ${src ? 'quote-media-cell--image' : ''} relative flex min-h-[42px] items-center justify-center overflow-visible p-0.5 ${src ? 'rounded-md border border-sand bg-white' : `qg-drop-zone ${over ? 'qg-drop-zone--over' : ''}`} ${src ? '' : 'no-print'}`}
      onDragEnter={stopFileDrag}
      onDragOver={(e) => { stopFileDrag(e); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { stopFileDrag(e); setOver(false); addFile(e.dataTransfer.files?.[0]) }}
    >
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={e => { addFile(e.target.files?.[0]); e.target.value = '' }} />
      {src ? (
        <div className="qg-image-wrap">
          <img
            src={src}
            alt={col.label}
            draggable={false}
            onError={onQuoteAssetImgError}
            onLoad={e => {
              const w = e.currentTarget.naturalWidth || 1
              const h = e.currentTarget.naturalHeight || 1
              setNatural({ w, h })
            }}
            style={{ width, height, maxWidth: 'none', maxHeight: 'none' }}
          />
          <button
            type="button"
            onClick={clear}
            className="no-print absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] text-slate-500 shadow hover:text-rose-600"
            title="Remove"
          >
            ×
          </button>
          <span
            className="qg-image-resize no-print"
            title="Drag to resize"
            onPointerDown={onResizeStart}
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="no-print flex min-h-[42px] w-full items-center justify-center px-1 text-center text-[11px] leading-snug"
        >
          {busy ? 'Adding…' : error || 'Drop image'}
        </button>
      )}
      {error && src ? <p className="no-print absolute bottom-0.5 left-1 right-1 truncate text-[9px] text-rose-500">{error}</p> : null}
    </div>
  )
}

/** Attachment cell: drop a file, name the link, open the uploaded document. */
function AttachmentCell({ col, item, onChange }) {
  const fileRef = useRef(null)
  const nameRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [error, setError] = useState('')
  const [naming, setNaming] = useState(null)
  const [draftName, setDraftName] = useState('')

  const label = String(item?.[col.id] || '').trim()
  const storedUrl = String(item?.[attachmentUrlKey(col)] || '').trim()
  const url = quoteAssetSrc(storedUrl, item?.[imagePathKey(col)])
    || (/^(https?:|data:)/i.test(label) ? label : '')
  const linkLabel = url && /^(https?:|data:)/i.test(label) ? 'Open file' : (label || 'Open file')

  useEffect(() => {
    if (naming) nameRef.current?.focus()
  }, [naming])

  const addFile = async (file) => {
    if (!file) return
    setBusy(true)
    setError('')
    setNaming(null)
    try {
      const result = await uploadQuoteFile(file)
      const suggested = displayNameFromFile(file)
      setDraftName(suggested)
      setNaming({ url: result.url, path: result.path || null, suggested })
    } catch (err) {
      setError(err?.message || 'Could not add this file.')
    } finally {
      setBusy(false)
    }
  }

  const commitName = (e) => {
    e?.preventDefault()
    if (!naming) return
    const name = draftName.trim() || naming.suggested || 'Document'
    onChange({ name, url: naming.url, path: naming.path })
    setNaming(null)
    setDraftName('')
  }

  const clear = (e) => {
    e?.stopPropagation()
    setNaming(null)
    onChange({ name: '', url: '', path: null })
  }

  return (
    <div
      className={`quote-media-cell flex min-h-[42px] w-full items-center justify-center px-1.5 py-1 ${url ? 'rounded-md border border-sand bg-white' : `qg-drop-zone ${over ? 'qg-drop-zone--over' : ''}`} ${url && !naming ? '' : 'no-print'}`}
      onDragEnter={stopFileDrag}
      onDragOver={(e) => { stopFileDrag(e); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { stopFileDrag(e); setOver(false); addFile(e.dataTransfer.files?.[0]) }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*"
        className="hidden"
        onChange={e => { addFile(e.target.files?.[0]); e.target.value = '' }}
      />
      {naming ? (
        <form onSubmit={commitName} className="no-print flex w-full flex-col gap-1 py-0.5">
          <label className="text-[10px] font-medium text-slate-500">File name</label>
          <input
            ref={nameRef}
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            className="w-full rounded border border-sand px-1.5 py-1 text-[11px] text-slate-700 outline-none focus:border-moss"
            placeholder="What should the file be called?"
          />
          <button type="submit" className="rounded bg-moss px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-[#1558b0]">
            Add file
          </button>
        </form>
      ) : url ? (
        <div className="flex min-w-0 items-center gap-1">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="quote-attachment-link truncate text-[11px] font-medium"
            title={linkLabel}
            onClick={(e) => e.stopPropagation()}
          >
            {linkLabel}
          </a>
          <button type="button" onClick={clear} className="no-print shrink-0 text-slate-400 hover:text-rose-600" title="Remove">×</button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="no-print px-1 text-center text-[11px] leading-snug"
        >
          {busy ? 'Adding…' : error || 'Drop file'}
        </button>
      )}
      {error && url ? <p className="no-print text-[9px] text-rose-500">{error}</p> : null}
    </div>
  )
}

function WrapCellTextarea({ value, onChange, onFocus, onBlur, placeholder, ariaLabel, className = '', inputRef }) {
  const localRef = useRef(null)
  const focusedRef = useRef(false)
  const [draft, setDraft] = useState(value ?? '')
  const setRefs = (node) => {
    localRef.current = node
    if (!inputRef) return
    if (typeof inputRef === 'function') inputRef(node)
    else inputRef.current = node
  }
  const resize = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(() => {
    if (!focusedRef.current) setDraft(value ?? '')
  }, [value])
  useEffect(() => { resize(localRef.current) }, [draft])
  return (
    <textarea
      ref={setRefs}
      rows={1}
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      autoComplete="off"
      onChange={e => {
        const next = e.target.value
        setDraft(next)
        onChange(next)
        resize(e.target)
      }}
      onFocus={(e) => {
        focusedRef.current = true
        onFocus?.(e)
      }}
      onBlur={(e) => {
        focusedRef.current = false
        onBlur?.(e)
      }}
      className={`no-print min-w-0 w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded bg-transparent p-2 leading-snug outline-none hover:bg-slate-50/60 focus:bg-blue-50 ${className}`}
    />
  )
}

function shouldWrapTableCell(col) {
  if (isSuggestedColumn(col)) return true
  if (isImageColumn(col) || isAttachmentColumn(col) || isNestedColumn(col)) return false
  const id = String(col?.id || '').toLowerCase()
  if (['rate', 'amount', 'quantity', 'qty', 'unit'].includes(id)) return false
  if (columnType(col) === 'hsn') return false
  if (id === 'description' || /^(description|enquiry|inquiry)$/i.test(String(col.label || '').trim())) return false
  return true
}

function QuoteTableCell(props) {
  const { col } = props
  if (isImageColumn(col)) {
    const { item, rowIndex, updateItem, onImageChange, onFitColumn } = props
    const highlightClass = isHighlightColumn(col) ? 'qg-highlight' : ''
    const compactClass = isCompactColumn(col) ? 'qg-cell-compact' : ''
    return (
      <td className={`align-top ${highlightClass} ${compactClass}`}>
        <ImageCell
          col={col}
          value={item[col.id] ?? ''}
          path={item[imagePathKey(col)]}
          edit={item[imageEditKey(col)]}
          rowIndex={rowIndex}
          onChange={(url, path) => onImageChange(rowIndex, col, url, path)}
          onEditChange={(next) => updateItem(rowIndex, imageEditKey(col), next)}
          onFitColumn={onFitColumn}
        />
      </td>
    )
  }
  if (isAttachmentColumn(col)) {
    const { item, rowIndex, onAttachmentChange } = props
    const highlightClass = isHighlightColumn(col) ? 'qg-highlight' : ''
    const compactClass = isCompactColumn(col) ? 'qg-cell-compact' : ''
    return (
      <td className={`align-top ${highlightClass} ${compactClass}`}>
        <AttachmentCell
          col={col}
          item={item}
          onChange={(payload) => onAttachmentChange(rowIndex, col, payload)}
        />
      </td>
    )
  }
  if (col.id === 'description' || /^(description|enquiry|inquiry)$/i.test(String(col.label || '').trim())) {
    const { item, rowIndex, updateItem, onDescriptionBlur, products, onApplyProduct } = props
    const highlightClass = isHighlightColumn(col) ? 'qg-highlight' : ''
    const compactClass = isCompactColumn(col) ? 'qg-cell-compact' : ''
    return (
      <td className={`p-1 align-top ${highlightClass} ${compactClass}`}>
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <DescriptionCell
              value={item[col.id] ?? ''}
              onChange={v => updateItem(rowIndex, col.id, v)}
              onBlurExtra={() => onDescriptionBlur?.(rowIndex)}
              products={products}
              onPickProduct={(product) => onApplyProduct?.(rowIndex, product, col.id)}
            />
          </div>
        </div>
      </td>
    )
  }
  return <QuoteTextTableCell {...props} />
}

function QuoteTextTableCell({ col, columns, item, rowIndex, updateItem, onRevertAmount, onAmountBlur, products, onApplyProduct }) {
  const [focused, setFocused] = useState(false)
  const focusedRef = useRef(false)
  const suggestWrapRef = useRef(null)
  const fieldRef = useRef(null)
  const value = item[col.id] ?? ''
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    if (!focusedRef.current) setDraft(value)
  }, [value])
  const fill = item._knowledgeFill
  const hsnFill = item._hsnGstFill
  const filledHere = fill?.fields?.includes(col.id)
  const hsnHere = hsnFill?.fields?.includes(col.id)
  const amount = amountCellState(item, columns, col)
  const formula = formulaCellState(item, columns, col)
  const derived = amount || formula
  const highlighted = isHighlightColumn(col)
  const highlightClass = highlighted ? 'qg-highlight' : ''
  const compactClass = isCompactColumn(col) ? 'qg-cell-compact' : ''
  const tint = derived?.overridden ? 'bg-amber-50/60' : (filledHere || hsnHere) ? 'bg-blue-50/40' : ''
  const isCurrency = col.id === 'rate' || col.id === 'amount' || Boolean(derived) || ((columnType(col) === 'tax' || columnType(col) === 'discount') && columnMode(col) === 'amount')
  const displayValue = (isCurrency && !focused && draft !== '' && Number.isFinite(Number(draft)))
    ? formatIndianAmount(draft)
    : draft
  const canSuggest = col.id !== 'amount' && !derived
  const suggestions = useMemo(() => {
    if (!focused || !canSuggest || String(draft || '').trim().length < 1) return []
    return productSuggestionItems(products, draft)
  }, [focused, canSuggest, draft, products])
  const wrapText = shouldWrapTableCell(col)
  const commitValue = (raw) => {
    const next = isCurrency ? String(raw).replace(/,/g, '') : raw
    setDraft(next)
    updateItem(rowIndex, col.id, next)
  }
  return (
    <td
      className={`p-1 align-top ${highlightClass} ${compactClass} ${!highlighted ? tint : ''}`}
    >
      <div ref={suggestWrapRef} className={`qg-suggest min-w-0 w-full ${wrapText ? '' : 'flex items-center gap-1'} ${focused && suggestions.length ? 'qg-suggest--open' : ''}`}>
        {wrapText ? (
          <WrapCellTextarea
            ariaLabel={col.label}
            value={displayValue}
            onChange={commitValue}
            inputRef={fieldRef}
            onFocus={() => { focusedRef.current = true; setFocused(true) }}
            onBlur={() => {
              window.setTimeout(() => {
                focusedRef.current = false
                setFocused(false)
                if (derived) onAmountBlur(rowIndex)
              }, 120)
            }}
            placeholder={derived && !derived.manual ? (amount ? 'Qty × Rate' : 'Auto') : '—'}
          />
        ) : (
          <input
            ref={fieldRef}
            aria-label={col.label}
            value={displayValue}
            onChange={e => commitValue(e.target.value)}
            onFocus={() => { focusedRef.current = true; setFocused(true) }}
            onBlur={() => {
              window.setTimeout(() => {
                focusedRef.current = false
                setFocused(false)
                if (derived) onAmountBlur(rowIndex)
              }, 120)
            }}
            className={`no-print w-full min-w-0 rounded bg-transparent p-2 outline-none hover:bg-slate-50/60 focus:bg-blue-50 ${compactClass ? 'whitespace-nowrap' : ''} ${derived || col.id === 'amount' ? 'text-right font-medium' : ''}`}
            placeholder={derived && !derived.manual ? (amount ? 'Qty × Rate' : 'Auto') : '—'}
            autoComplete="off"
          />
        )}
        {focused && suggestions.length ? (
          <SuggestionMenu
            items={suggestions}
            active={0}
            onPick={(item) => onApplyProduct?.(rowIndex, item.product, col.id)}
            anchorRef={suggestWrapRef}
          />
        ) : null}
        <span className={`print-only-cell w-full min-w-0 p-2 ${compactClass ? 'whitespace-nowrap' : 'whitespace-pre-wrap break-words'} ${derived || col.id === 'amount' ? 'text-right font-medium' : ''}`}>
          {isCurrency ? printAmountText(value) : (value || (derived && !derived.manual ? (amount ? 'Qty × Rate' : 'Auto') : ''))}
        </span>
        {derived?.overridden && <AmountOverrideBadge computed={derived.computed} onRevert={() => onRevertAmount(rowIndex, col)} />}
      </div>
    </td>
  )
}

/** Tax / discount % cell. Amount still calculates in the background for totals. */
function NestedTableCells({ col, item, rowIndex, updateItem }) {
  const rk = rateKey(col)
  const hsnFill = item._hsnGstFill
  const hsnHere = hsnFill?.fields?.includes(rk)
  const rateValue = item[rk] ?? ''
  return (
    <td className="qg-cell-compact p-1 align-top">
      <div className="flex items-center gap-1">
        <input
          aria-label={`${col.label} %`}
          value={rateValue}
          onChange={e => updateItem(rowIndex, rk, e.target.value)}
          inputMode="decimal"
          className="no-print w-full rounded bg-transparent p-2 text-right outline-none hover:bg-white focus:bg-blue-50"
          placeholder="%"
        />
        <span className="no-print shrink-0 pr-1 text-xs text-slate-400">%</span>
        <span className="print-only-cell w-full p-2 text-right">{rateValue ? `${rateValue}%` : ''}</span>
        {hsnHere && <HsnGstFillBadge fill={hsnFill} />}
      </div>
    </td>
  )
}

function fallbackQuoteNumber() {
  return `QG-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`
}

async function fetchNextQuoteNumber() {
  try {
    const response = await fetch('/api/quotation-series/next')
    const data = await readApiResponse(response)
    if (response.ok && data?.number) return data.number
  } catch {
    // Supabase optional — fall back below
  }
  return fallbackQuoteNumber()
}

function saveStatusLabel(status) {
  if (status === 'saving') return 'Saving to cloud…'
  if (status === 'saved') return 'Saved to cloud'
  if (status === 'unavailable') return 'Local only — configure Supabase to autosave'
  if (status === 'error') return 'Could not save — will retry on next edit'
  return 'Changes save when you edit'
}

/** Below this width the fixed 262px sidebar would eat most of the screen —
 *  matches the `md` breakpoint used everywhere else for mobile layout switches. */
const MOBILE_BREAKPOINT = 900

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [authUser, setAuthUser] = useState(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [view, setView] = useState('home')
  const [customer, setCustomer] = useState({ name: '', company: '', gst: '', location: '', shippingSame: true, shippingLocation: '' })
  const [enquiry, setEnquiry] = useState('')
  const [columns, setColumns] = useState(DEFAULT_DATA_COLUMNS)
  const [quote, setQuote] = useState(null)
  const [quoteId, setQuoteId] = useState(null)
  const [saveStatus, setSaveStatus] = useState('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [uploadTemplates, setUploadTemplates] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [activeUploadTemplate, setActiveUploadTemplate] = useState(null)
  const [companyProfile, setCompanyProfile] = useState(null)
  const [companyDraft, setCompanyDraft] = useState({})
  const footerFitSaveTimer = useRef(null)
  const [persistenceConfigured, setPersistenceConfigured] = useState(false)
  const [recentQuotations, setRecentQuotations] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  // Dashboard-shell navigation — which page shows inside the sidebar layout
  // when no quotation is open. Separate from `view`, which only gates the
  // full-screen Upload Doc flow.
  const [workspaceView, setWorkspaceView] = useState('home')
  const [listQuery, setListQuery] = useState('')
  const [listTab, setListTab] = useState('all')
  const [settingsTab, setSettingsTab] = useState('company')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('qg-sidebar-hidden') === '1' } catch { return false }
  })
  const hideSidebar = (hidden) => {
    setSidebarHidden(hidden)
    try { localStorage.setItem('qg-sidebar-hidden', hidden ? '1' : '0') } catch { /* ignore */ }
  }
  const [brandingOpen, setBrandingOpen] = useState(true)
  const [bankDetailsOpen, setBankDetailsOpen] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [columnLayoutOpen, setColumnLayoutOpen] = useState(false)
  const [layoutPreview, setLayoutPreview] = useState(null)
  const [paperStyle, setPaperStyle] = useState('corporate')
  const [uploadLayoutName, setUploadLayoutName] = useState('')
  const [uploadReturnTo, setUploadReturnTo] = useState('home')
  const [newQuoteStep, setNewQuoteStep] = useState(1)
  const [newQuoteSession, setNewQuoteSession] = useState(0)
  const [knowledgeOpen, setKnowledgeOpen] = useState(true)
  const isMobile = useIsMobile()

  const quoteIdRef = useRef(null)
  const lastSavedJsonRef = useRef('')
  const lastSeriesSyncedNumberRef = useRef('')
  const selectedTemplateIdRef = useRef(selectedTemplateId)

  useEffect(() => { quoteIdRef.current = quoteId }, [quoteId])
  useEffect(() => { selectedTemplateIdRef.current = selectedTemplateId }, [selectedTemplateId])

  /**
   * Undo/redo — one entry per settled burst of edits, not per keystroke. A whole
   * word typed into a cell collapses into a single undo step (same idea as
   * Docs/Sheets), via the same debounce window the autosave already uses.
   * History is plain quote snapshots; since every mutation in this file replaces
   * `quote` with a fresh structuredClone rather than mutating in place, old
   * references sitting in the stack are never touched again — safe to reuse
   * directly with no extra cloning.
   */
  const MAX_HISTORY = 50
  const undoStackRef = useRef([])
  const redoStackRef = useRef([])
  const lastCommittedRef = useRef(null)
  const applyingHistoryRef = useRef(false)
  const historyDebounceRef = useRef(null)
  const [historyVersion, setHistoryVersion] = useState(0)

  // A different quotation was opened — old history doesn't apply to it. This
  // must run (and its reset take effect) *before* the recorder effect below on
  // the same render, so declaration order here is load-bearing: on the render
  // where a quote is first opened, quoteId and quote change together, and this
  // reset has to land first or it wipes the baseline the recorder just set.
  useEffect(() => {
    undoStackRef.current = []
    redoStackRef.current = []
    lastCommittedRef.current = null
    setHistoryVersion(v => v + 1)
  }, [quoteId])

  useEffect(() => {
    if (!quote) {
      undoStackRef.current = []
      redoStackRef.current = []
      lastCommittedRef.current = null
      clearTimeout(historyDebounceRef.current)
      setHistoryVersion(v => v + 1)
      return
    }
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false
      lastCommittedRef.current = quote
      return
    }
    if (lastCommittedRef.current == null) {
      // First render of a newly opened/generated quote — nothing to undo into yet.
      lastCommittedRef.current = quote
      return
    }
    if (lastCommittedRef.current === quote) return
    clearTimeout(historyDebounceRef.current)
    historyDebounceRef.current = setTimeout(() => {
      undoStackRef.current = [...undoStackRef.current, lastCommittedRef.current].slice(-MAX_HISTORY)
      redoStackRef.current = []
      lastCommittedRef.current = quote
      setHistoryVersion(v => v + 1)
    }, 600)
    return () => clearTimeout(historyDebounceRef.current)
  }, [quote])

  // Re-read on every render (including the ones `historyVersion` forces after a
  // push/pop) so these always reflect the live stacks, not a stale snapshot.
  const canUndo = undoStackRef.current.length > 0
  const canRedo = redoStackRef.current.length > 0
  void historyVersion

  const undoEdit = () => {
    if (!undoStackRef.current.length) return
    clearTimeout(historyDebounceRef.current)
    const prev = undoStackRef.current[undoStackRef.current.length - 1]
    undoStackRef.current = undoStackRef.current.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current, quote]
    applyingHistoryRef.current = true
    setQuote(prev)
    setHistoryVersion(v => v + 1)
  }

  const redoEdit = () => {
    if (!redoStackRef.current.length) return
    clearTimeout(historyDebounceRef.current)
    const next = redoStackRef.current[redoStackRef.current.length - 1]
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    undoStackRef.current = [...undoStackRef.current, quote]
    applyingHistoryRef.current = true
    setQuote(next)
    setHistoryVersion(v => v + 1)
  }

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo — active only while a
  // quotation is open, and takes priority over the browser's native per-field
  // undo (which is unreliable anyway on React-controlled inputs).
  useEffect(() => {
    if (!quote) return
    const onKeyDown = (e) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      const key = e.key.toLowerCase()
      if (key === 'z' && e.shiftKey) { e.preventDefault(); redoEdit(); return }
      if (key === 'z') { e.preventDefault(); undoEdit(); return }
      if (key === 'y') { e.preventDefault(); redoEdit() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote])

  const refreshLandingData = async () => {
    const health = await checkPersistenceHealth()
    setPersistenceConfigured(health.configured)
    if (!health.configured) {
      setCompanyProfile(null)
      setCompanyDraft({})
      setRecentQuotations([])
      return
    }
    try {
      const profileRes = await fetchCompanyProfile()
      if (profileRes.unavailable) {
        setPersistenceConfigured(false)
        setCompanyProfile(null)
        setCompanyDraft({})
        return
      }
      if (profileRes.profile) setCompanyProfile(profileRes.profile)
    } catch {
      /* profile optional on landing */
    }
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const listRes = await listQuotations(40)
      if (listRes.unavailable) {
        setPersistenceConfigured(false)
        setRecentQuotations([])
      } else {
        setRecentQuotations(listRes.quotations)
      }
    } catch (e) {
      setHistoryError(e.message || 'Could not load quotation history')
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    // Covers all three ways a session can appear: already in localStorage, just
    // established from a confirmation link's #access_token, or a fresh sign-in.
    const apply = (session, event) => {
      if (cancelled) return
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      setAuthUser(session?.user || null)
      setAuthChecked(true)
    }
    getCurrentSession().then(session => apply(session)).catch(() => apply(null))
    const unsubscribe = onAuthChange(apply)
    return () => { cancelled = true; unsubscribe() }
  }, [])

  useEffect(() => {
    if (authUser) refreshLandingData()
  }, [authUser])

  useEffect(() => {
    if (!authUser) return
    fetch('/api/upload-templates')
      .then(r => r.json())
      .then(d => setUploadTemplates(d.templates || []))
      .catch(() => {})
  }, [view, authUser])

  // Debounced autosave while editing a quotation
  useEffect(() => {
    if (!quote) {
      setSaveStatus('idle')
      return
    }
    if (!persistenceConfigured) {
      setSaveStatus('unavailable')
      return
    }

    const layoutRef = quote.layoutRef ?? (activeUploadTemplate?.id || selectedTemplateIdRef.current || 'default')
    const uploadTemplateId = quote.uploadTemplateId ?? activeUploadTemplate?.id ?? (selectedTemplateIdRef.current || null)
    const body = buildQuotationPayload(quote, { layoutRef, uploadTemplateId })
    const json = JSON.stringify(body)
    if (json === lastSavedJsonRef.current) return

    const timer = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        if (quoteIdRef.current) {
          const result = await updateQuotation(quoteIdRef.current, body)
          if (result.unavailable) {
            setPersistenceConfigured(false)
            setSaveStatus('unavailable')
            return
          }
          lastSavedJsonRef.current = json
          setSaveStatus('saved')
          learnFromQuote(body.data.items, body.data.columns).catch(() => {})
          if ((quote.docType || 'quotation') !== 'invoice' && body.number) {
            syncQuotationSeriesFromNumber(body.number, lastSeriesSyncedNumberRef.current)
              .then((r) => {
                if (r.synced) {
                  lastSeriesSyncedNumberRef.current = r.number
                  if (r.profile) setCompanyProfile(r.profile)
                }
              })
              .catch(() => {})
          }
        } else {
          const result = await createQuotation(body)
          if (result.unavailable) {
            setPersistenceConfigured(false)
            setSaveStatus('unavailable')
            return
          }
          quoteIdRef.current = result.quotation.id
          setQuoteId(result.quotation.id)
          lastSavedJsonRef.current = json
          setSaveStatus('saved')
          learnFromQuote(body.data.items, body.data.columns).catch(() => {})
          if ((quote.docType || 'quotation') !== 'invoice' && body.number) {
            syncQuotationSeriesFromNumber(body.number, lastSeriesSyncedNumberRef.current)
              .then((r) => {
                if (r.synced) {
                  lastSeriesSyncedNumberRef.current = r.number
                  if (r.profile) setCompanyProfile(r.profile)
                }
              })
              .catch(() => {})
          }
        }
      } catch {
        setSaveStatus('error')
      }
    }, 900)

    return () => clearTimeout(timer)
  }, [quote, persistenceConfigured, activeUploadTemplate])

  const resetEditorSession = () => {
    setQuote(null)
    setQuoteId(null)
    quoteIdRef.current = null
    lastSavedJsonRef.current = ''
    lastSeriesSyncedNumberRef.current = ''
    setActiveUploadTemplate(null)
    setSaveStatus('idle')
  }

  const openQuoteInEditor = async (editorQuote, { id = null, template = null } = {}) => {
    // AI drafts, reopened quotes and clones all land here, so this is where rows
    // get their calculated Amount. A supplied Amount that disagrees with
    // Quantity × Rate reads as deliberate and is kept.
    const synced = syncAmountFormula(
      editorQuote.columns?.length ? editorQuote.columns : columns,
      editorQuote.items || []
    )
    const attached = attachSuggestedColumn(synced.columns, synced.items)
    const ready = {
      ...editorQuote,
      columns: attached.columns,
      items: recalcAllRows(attached.items, attached.columns)
    }
    lastSavedJsonRef.current = id
      ? JSON.stringify(buildQuotationPayload(ready, {
        layoutRef: ready.layoutRef,
        uploadTemplateId: ready.uploadTemplateId
      }))
      : ''
    setQuoteId(id)
    quoteIdRef.current = id
    lastSeriesSyncedNumberRef.current = ready.number || ''
    setActiveUploadTemplate(template)
    if (ready.columns?.length) setColumns(ready.columns)
    setQuote(ready)
    setSaveStatus(persistenceConfigured ? (id ? 'saved' : 'idle') : 'unavailable')
  }

  const loadUploadTemplateIfNeeded = async (editorQuote) => {
    const tplId = editorQuote.uploadTemplateId || (editorQuote.layoutRef && editorQuote.layoutRef !== 'default' ? editorQuote.layoutRef : null)
    if (!tplId) return null
    try {
      const tplRes = await fetch(`/api/upload-templates/${tplId}`)
      const tplData = await readApiResponse(tplRes)
      if (tplRes.ok) return tplData
    } catch {
      /* fall back to default editor */
    }
    return null
  }

  const handleOpenQuotation = async (id) => {
    setError('')
    setHistoryError('')
    try {
      const result = await getQuotation(id)
      if (result.unavailable) {
        setPersistenceConfigured(false)
        setHistoryError(SUPABASE_SETUP_HINT)
        return
      }
      const editorQuote = {
        ...quotationToEditorState(result.quotation),
        companyProfile: companyProfile || undefined
      }
      const template = await loadUploadTemplateIfNeeded(editorQuote)
      await openQuoteInEditor(editorQuote, { id: result.quotation.id, template })
    } catch (e) {
      setHistoryError(e.message || 'Could not open quotation')
    }
  }

  const handleCloneQuotation = async (id) => {
    setError('')
    setHistoryError('')
    try {
      const result = await getQuotation(id)
      if (result.unavailable) {
        setPersistenceConfigured(false)
        setHistoryError(SUPABASE_SETUP_HINT)
        return
      }
      const base = quotationToEditorState(result.quotation)
      const newNumber = await fetchNextQuoteNumber()
      const cloned = {
        ...cloneQuotationForNew(base, newNumber),
        companyProfile: companyProfile || undefined
      }
      const template = await loadUploadTemplateIfNeeded(cloned)
      await openQuoteInEditor(cloned, { id: null, template })
    } catch (e) {
      setHistoryError(e.message || 'Could not clone quotation')
    }
  }

  /**
   * Turn the open quotation into a sales invoice and switch the editor to it.
   * The quotation is left untouched, so both documents stay on record.
   */
  const handleConvertToInvoice = async ({ number } = {}) => {
    if (!quoteIdRef.current) {
      return { error: 'Wait for this quotation to finish saving, then convert it.' }
    }
    const result = await convertQuotationToInvoice(quoteIdRef.current, {
      customerGst: quote?.customer?.gst,
      number
    })
    if (result.unavailable) {
      setPersistenceConfigured(false)
      return { error: SUPABASE_SETUP_HINT }
    }
    if (result.gstRequired) return { gstRequired: true, error: result.error }
    if (result.numberInUse) return { numberInUse: true, error: result.error }

    const invoiceQuote = {
      ...quotationToEditorState(result.invoice),
      companyProfile: companyProfile || undefined
    }
    const template = await loadUploadTemplateIfNeeded(invoiceQuote)
    await openQuoteInEditor(invoiceQuote, { id: result.invoice.id, template })
    refreshLandingData()
    return { invoice: result.invoice }
  }

  /** After a restore the server is the source of truth — reload the editor from
   *  its response so autosave doesn't immediately push the pre-restore state back. */
  const handleRevisionRestored = async (quotation) => {
    if (!quotation) return
    const editorQuote = {
      ...quotationToEditorState(quotation),
      companyProfile: companyProfile || undefined
    }
    const template = await loadUploadTemplateIfNeeded(editorQuote)
    await openQuoteInEditor(editorQuote, { id: quotation.id, template })
  }

  if (!authChecked) {
    return <main className="flex min-h-screen items-center justify-center bg-mist"><span className="animate-spin text-2xl text-moss">◌</span></main>
  }

  if (!authUser) {
    return <AuthScreen />
  }

  if (passwordRecovery) {
    return <AuthScreen recovery onPasswordUpdated={() => setPasswordRecovery(false)} />
  }

  if (view === 'upload') {
    return (
      <UploadDoc
        suggestedName={uploadLayoutName}
        onBack={(tpl) => {
          setView('home')
          setUploadLayoutName('')
          fetch('/api/upload-templates').then(r => r.json()).then(d => setUploadTemplates(d.templates || [])).catch(() => {})
          refreshLandingData()
          if (uploadReturnTo === 'new') {
            setWorkspaceView('new')
            setNewQuoteStep(2)
          }
          if (tpl?.id) {
            setSelectedTemplateId(tpl.id)
            if (uploadReturnTo !== 'new') {
              saveCompanyProfile({ defaultUploadTemplateId: tpl.id })
                .then(res => { if (res.profile) setCompanyProfile(res.profile) })
                .catch(() => {})
            }
          }
          setUploadReturnTo('home')
        }}
      />
    )
  }

  const changeCustomer = (key, value) => setCustomer(c => ({ ...c, [key]: value }))

  const makeQuote = async () => {
    if (!enquiry.trim()) return setError('Paste the customer enquiry to generate a quotation.')
    setLoading(true); setError('')
    try {
      let colsForAi = columns
      let tplData = null
      if (selectedTemplateId) {
        const tplRes = await fetch(`/api/upload-templates/${selectedTemplateId}`)
        tplData = await readApiResponse(tplRes)
        if (!tplRes.ok) throw new Error(tplData.error || 'Could not load uploaded template')
        if (tplData.mapping?.columns?.length) colsForAi = tplData.mapping.columns
      }

      const response = await fetch('/api/generate-quotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enquiry, customer, columns: colsForAi })
      })
      const data = await readApiResponse(response)
      if (!response.ok) throw new Error(data.error)
      const quoteNumber = await fetchNextQuoteNumber()
      const built = {
        ...data,
        columns: data.columns || colsForAi,
        customer: {
          shippingSame: true,
          shippingLocation: '',
          ...(data.customer || {}),
          ...(customer?.company || customer?.name || customer?.gst ? customer : {})
        },
        number: quoteNumber,
        date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        companyProfile: companyProfile || undefined,
        layoutRef: selectedTemplateId || 'default',
        uploadTemplateId: selectedTemplateId || null,
        paperStyle: selectedTemplateId ? undefined : paperStyle,
        tableColorId: 'blue',
        fields: { validUntil: defaultValidUntil(15) }
      }

      await openQuoteInEditor(built, { id: null, template: tplData || null })
    } catch (e) {
      setError(e.message === 'Failed to fetch'
        ? 'Cannot reach the API server. Run npm run dev in the project folder and keep that terminal open.'
        : e.message || 'Something went wrong. Please retry.')
    }
    finally { setLoading(false) }
  }

  // "Fill it in myself" — no AI: one blank row in the layout they just picked.
  const createManualQuote = async () => {
    setError('')
    setLoading(true)
    try {
      let cols = columns
      let tplData = null
      if (selectedTemplateId) {
        const tplRes = await fetch(`/api/upload-templates/${selectedTemplateId}`)
        tplData = await readApiResponse(tplRes)
        if (!tplRes.ok) throw new Error(tplData.error || 'Could not load uploaded template')
        if (tplData.mapping?.columns?.length) cols = tplData.mapping.columns
      }
      const quoteNumber = await fetchNextQuoteNumber()
      const built = {
        title: '',
        items: [blankItem(cols)],
        columns: cols,
        customer: { name: '', company: '', gst: '', location: '', shippingSame: true, shippingLocation: '', ...customer },
        notes: [],
        clarifications: [],
        number: quoteNumber,
        date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        companyProfile: companyProfile || undefined,
        layoutRef: selectedTemplateId || 'default',
        uploadTemplateId: selectedTemplateId || null,
        paperStyle: selectedTemplateId ? undefined : paperStyle,
        tableColorId: 'blue',
        fields: { validUntil: defaultValidUntil(15) }
      }
      await openQuoteInEditor(built, { id: null, template: tplData || null })
    } catch (e) {
      setError(e.message === 'Failed to fetch'
        ? 'Cannot reach the API server. Run npm run dev in the project folder and keep that terminal open.'
        : e.message || 'Could not open a blank quotation.')
    } finally {
      setLoading(false)
    }
  }

  const update = (path, value) => setQuote(q => {
    const next = structuredClone(q)
    let ref = next
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]
      const child = ref[key]
      if (child == null || typeof child !== 'object') {
        ref[key] = typeof path[i + 1] === 'number' ? [] : {}
      }
      ref = ref[key]
    }
    ref[path.at(-1)] = value
    return next
  })

  // Functional variant of `update`, for editors that need to read-then-write the
  // latest quote (not a fixed value) — e.g. column mutators applying on top of
  // whatever the current columns/items are, not a stale render's snapshot.
  const updateQuote = (fn) => setQuote(fn)

  const applyFooterFit = (raw) => {
    const footerFit = normalizeFooterFit(raw)
    setCompanyDraft(prev => ({ ...prev, footerFit }))
    setCompanyProfile(prev => (prev ? { ...prev, footerFit } : prev))
    if (!persistenceConfigured) return
    clearTimeout(footerFitSaveTimer.current)
    footerFitSaveTimer.current = setTimeout(() => {
      saveCompanyProfile({ footerFit }).then((result) => {
        if (result.unavailable) setPersistenceConfigured(false)
        else if (result.profile) setCompanyProfile(result.profile)
      }).catch(() => {})
    }, 450)
  }

  const quoteColumns = quote?.columns || columns
  const totals = computeQuoteTotals(quote?.items || [], quoteColumns, quote?.extraLines)
  const total = totals.grandTotal

  if (quote && activeUploadTemplate) {
    return (
      <UploadedTemplateQuote
        template={activeUploadTemplate}
        quote={quote}
        columns={quoteColumns}
        total={total}
        update={update}
        saveStatus={saveStatus}
        companyProfile={companyProfile || quote.companyProfile}
        persistenceConfigured={persistenceConfigured}
        onColumnsChange={setColumns}
        onNew={() => { resetEditorSession(); refreshLandingData() }}
        onHome={() => { resetEditorSession(); refreshLandingData(); setWorkspaceView('home') }}
        onRetry={makeQuote}
      />
    )
  }

  if (quote) {
    return (
      <QuoteEditor
        quote={quote}
        quoteId={quoteId}
        columns={quoteColumns}
        update={update}
        updateQuote={updateQuote}
        total={total}
        totals={totals}
        saveStatus={saveStatus}
        companyProfile={companyProfile || quote.companyProfile}
        persistenceConfigured={persistenceConfigured}
        onColumnsChange={setColumns}
        onNew={() => { resetEditorSession(); refreshLandingData() }}
        onHome={() => { resetEditorSession(); refreshLandingData(); setWorkspaceView('home') }}
        onRetry={makeQuote}
        onRestored={handleRevisionRestored}
        onConvertToInvoice={handleConvertToInvoice}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undoEdit}
        onRedo={redoEdit}
        onFooterFitChange={applyFooterFit}
        seriesSyncedRef={lastSeriesSyncedNumberRef}
      />
    )
  }

  // Real stats only — no fabricated credits/team numbers. docType flips from
  // 'quotation' to 'invoice' via the existing Convert-to-invoice flow, which is
  // the only genuine "finished" signal this schema has, so it stands in for
  // Draft vs Completed.
  const wsNow = new Date()
  const wsDraftCount = recentQuotations.filter(q => q.docType !== 'invoice').length
  const wsCompletedCount = recentQuotations.filter(q => q.docType === 'invoice').length
  const wsThisMonthCount = recentQuotations.filter(q => {
    const d = new Date(q.updatedAt || q.createdAt)
    return !Number.isNaN(d.getTime()) && d.getMonth() === wsNow.getMonth() && d.getFullYear() === wsNow.getFullYear()
  }).length
  const wsTotalValue = recentQuotations.reduce((a, q) => a + (q.total || 0), 0)

  const wsHomeStats = [
    { label: 'Drafts to finish', value: String(wsDraftCount), sub: 'Not yet converted', go: () => { setListTab('draft'); setWorkspaceView('list') } },
    { label: 'Completed', value: String(wsCompletedCount), sub: 'Converted to invoice', go: () => { setListTab('completed'); setWorkspaceView('list') } },
    { label: 'This month', value: String(wsThisMonthCount), sub: 'Quotations touched', go: () => setWorkspaceView('list') },
    { label: 'Total quoted', value: money(wsTotalValue), sub: `Across ${recentQuotations.length} quotations`, go: () => setWorkspaceView('insights') }
  ]

  const wsClientGroups = new Map()
  for (const q of recentQuotations) {
    const name = (q.customer?.company || q.customer?.name || '').trim()
    if (!name) continue
    const g = wsClientGroups.get(name) || { name, count: 0, value: 0 }
    g.count += 1
    g.value += q.total || 0
    wsClientGroups.set(name, g)
  }
  const wsTopClientsRaw = [...wsClientGroups.values()].sort((a, b) => b.value - a.value).slice(0, 4)
  const wsMaxClientValue = Math.max(1, ...wsTopClientsRaw.map(c => c.value))
  const wsTopClients = wsTopClientsRaw.map(c => ({ ...c, pct: Math.max(4, Math.round((c.value / wsMaxClientValue) * 100)) }))

  const wsInsightStats = [
    { label: 'Total quoted', value: money(wsTotalValue), sub: `Across ${recentQuotations.length} quotations` },
    { label: 'Completed value', value: money(recentQuotations.filter(q => q.docType === 'invoice').reduce((a, q) => a + (q.total || 0), 0)), sub: `${wsCompletedCount} quotations` },
    { label: 'Average quotation', value: money(recentQuotations.length ? wsTotalValue / recentQuotations.length : 0), sub: 'Per enquiry' },
    { label: 'Drafts pending', value: String(wsDraftCount), sub: 'Finish these first' }
  ]

  const wsGreetingHour = wsNow.getHours()
  const wsGreetingWord = wsGreetingHour < 12 ? 'Good morning' : wsGreetingHour < 17 ? 'Good afternoon' : 'Good evening'
  const wsGreetingName = initialsFromEmail(authUser.email).length
    ? String(authUser.email || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join(' ')
    : 'there'

  const wsTitles = {
    home: ['Home', 'Everything starts here'],
    new: ['New quotation', 'Give QuoteGen the enquiry'],
    list: ['Recent quotations', 'Every quotation in your workspace'],
    insights: ['Insights', 'How your quoting is going'],
    knowledge: ['Knowledge', 'Your uploaded rate lists and catalogues'],
    company: ['Company', 'Your letterhead and quotation numbering'],
    team: ['Team', 'People who can make quotations'],
    account: ['Account', 'Your own details'],
    billing: ['Billing', 'Your plan']
  }
  const [wsPageTitle, wsPageHint] = wsTitles[workspaceView] || wsTitles.home

  const goNewQuote = () => {
    const layouts = collectSavedLayouts(companyProfile, recentQuotations)
    const active = layouts.find(l => l.id === companyProfile?.activeColumnLayoutId) || layouts[0]
    setColumns(active?.columns?.length
      ? active.columns.map(c => ({ ...c }))
      : (companyProfile?.columnLayout?.length ? companyProfile.columnLayout : DEFAULT_DATA_COLUMNS))
    setSelectedTemplateId(companyProfile?.defaultUploadTemplateId || '')
    setNewQuoteStep(1)
    setNewQuoteSession(n => n + 1)
    setWorkspaceView('new')
  }

  return <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'stretch', background: '#f5f7fa', color: '#2d3748' }}>
    <WsSidebar
      view={workspaceView}
      onNav={(v) => { setWorkspaceView(v); setMobileNavOpen(false) }}
      onNewQuote={() => { goNewQuote(); setMobileNavOpen(false) }}
      recentCount={recentQuotations.length}
      authUserEmail={authUser.email}
      isMobile={isMobile}
      mobileOpen={mobileNavOpen}
      hidden={!isMobile && sidebarHidden}
      onClose={() => setMobileNavOpen(false)}
      onHide={() => hideSidebar(true)}
    />

    <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <WsHeader
        title={wsPageTitle}
        hint={wsPageHint}
        showBack={workspaceView !== 'home'}
        onBack={() => setWorkspaceView(workspaceView === 'new' ? 'home' : 'home')}
        isMobile={isMobile}
        showMenu={isMobile || sidebarHidden}
        onMenu={() => {
          if (isMobile) setMobileNavOpen(o => !o)
          else hideSidebar(false)
        }}
      />

      <div style={{ padding: isMobile ? '16px 16px 56px' : '24px 30px 64px', maxWidth: workspaceView === 'company' ? 'none' : 1440, width: '100%' }}>
        {historyError && workspaceView !== 'new' && (
          <div style={{ marginBottom: 20, borderRadius: 12, background: '#FDF2F2', border: '1px solid #E7CFCF', padding: '12px 16px', fontSize: 14.5, color: '#B03A3A' }}>{historyError}</div>
        )}
        {workspaceView === 'home' && (
          <WsHome
            greetingWord={wsGreetingWord}
            greetingName={wsGreetingName}
            stats={wsHomeStats}
            recent={recentQuotations.slice(0, 4)}
            topClients={wsTopClients}
            onOpen={handleOpenQuotation}
            onClone={handleCloneQuotation}
            onOpenCompany={(name) => { setListQuery(name); setListTab('all'); setWorkspaceView('list') }}
            onNav={setWorkspaceView}
            onNewQuote={goNewQuote}
          />
        )}

        {workspaceView === 'new' && (
          <WsNew
            key={newQuoteSession}
            enquiry={enquiry}
            setEnquiry={setEnquiry}
            onGenerate={makeQuote}
            onManual={createManualQuote}
            onUploadLayout={() => { setUploadReturnTo('new'); setNewQuoteStep(2); setView('upload') }}
            initialStep={newQuoteStep}
            loading={loading}
            error={error}
            detailsOpen={showDetails}
            setDetailsOpen={setShowDetails}
            customer={customer}
            changeCustomer={changeCustomer}
            columns={columns}
            setColumns={setColumns}
            savedLayouts={collectSavedLayouts(companyProfile, recentQuotations)}
            activeLayoutId={companyProfile?.activeColumnLayoutId || ''}
            persistenceConfigured={persistenceConfigured}
            onSavedProfile={(profile) => { if (profile) setCompanyProfile(profile) }}
            uploadTemplates={uploadTemplates}
            selectedTemplateId={selectedTemplateId}
            setSelectedTemplateId={setSelectedTemplateId}
            paperStyle={paperStyle}
            setPaperStyle={setPaperStyle}
            isMobile={isMobile}
          />
        )}

        {workspaceView === 'list' && (
          <WsList
            quotations={recentQuotations}
            query={listQuery}
            setQuery={setListQuery}
            tab={listTab}
            setTab={setListTab}
            onOpen={handleOpenQuotation}
            onClone={handleCloneQuotation}
          />
        )}

        {workspaceView === 'insights' && (
          <WsInsights stats={wsInsightStats} topClients={wsTopClients} />
        )}

        {workspaceView === 'knowledge' && (
          <KnowledgeBasePanel
            open={knowledgeOpen}
            onToggle={() => setKnowledgeOpen(o => !o)}
            persistenceConfigured={persistenceConfigured}
            onUnavailable={() => setPersistenceConfigured(false)}
          />
        )}

        {workspaceView === 'company' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            alignItems: 'start',
            gap: isMobile ? 16 : 28
          }}>
            <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <CompanyBrandingPanel
                open={brandingOpen}
                onToggle={() => setBrandingOpen(o => !o)}
                profile={companyProfile}
                persistenceConfigured={persistenceConfigured}
                onDraftChange={(partial) => setCompanyDraft(prev => ({ ...prev, ...partial }))}
                onFooterFitChange={applyFooterFit}
                onSaved={(profile) => { setCompanyProfile(profile); setPersistenceConfigured(true) }}
                onUnavailable={() => setPersistenceConfigured(false)}
              />
              <BankDetailsPanel
                open={bankDetailsOpen}
                onToggle={() => setBankDetailsOpen(o => !o)}
                profile={companyProfile}
                persistenceConfigured={persistenceConfigured}
                onDraftChange={(partial) => setCompanyDraft(prev => ({ ...prev, ...partial }))}
                onSaved={(profile) => { setCompanyProfile(profile); setPersistenceConfigured(true) }}
                onUnavailable={() => setPersistenceConfigured(false)}
              />
              <TermsAndConditionsPanel
                open={termsOpen}
                onToggle={() => setTermsOpen(o => !o)}
                profile={companyProfile}
                persistenceConfigured={persistenceConfigured}
                onDraftChange={(partial) => setCompanyDraft(prev => ({ ...prev, ...partial }))}
                onSaved={(profile) => { setCompanyProfile(profile); setPersistenceConfigured(true) }}
                onUnavailable={() => setPersistenceConfigured(false)}
              />
              <SeriesSettingsPanel
                open={seriesOpen}
                onToggle={() => setSeriesOpen(o => !o)}
                profile={companyProfile}
                persistenceConfigured={persistenceConfigured}
                onDraftChange={(partial) => setCompanyDraft(prev => ({ ...prev, ...partial }))}
                onSaved={(profile) => { setCompanyProfile(profile); setPersistenceConfigured(true) }}
                onUnavailable={() => setPersistenceConfigured(false)}
              />
              <CompanyColumnLayoutPanel
                open={columnLayoutOpen}
                onToggle={() => setColumnLayoutOpen(o => !o)}
                profile={companyProfile}
                persistenceConfigured={persistenceConfigured}
                onSaved={(profile) => { setCompanyProfile(profile); setPersistenceConfigured(true) }}
                onUnavailable={() => setPersistenceConfigured(false)}
                templates={uploadTemplates}
                onPreviewChange={setLayoutPreview}
                onUploadNew={(name) => {
                  setUploadLayoutName(name || '')
                  setUploadReturnTo('company')
                  setView('upload')
                }}
              />
            </div>
            <div className="qg-hide-scrollbar" style={{ minWidth: 0, position: 'sticky', top: 20, maxHeight: 'calc(100vh - 40px)', overflow: 'auto' }}>
              <CompanyQuotePreview
                profile={{ ...(companyProfile || {}), ...companyDraft }}
                layoutPreview={layoutPreview}
                uploadTemplates={uploadTemplates}
                onFooterFitChange={applyFooterFit}
              />
            </div>
          </div>
        )}

        {workspaceView === 'account' && (
          <WsAccountSettings email={authUser.email} onSignOut={() => signOut()} />
        )}

        {workspaceView === 'team' && <WsTeamComingSoon />}

        {workspaceView === 'billing' && <WsBilling />}
      </div>
    </main>
  </div>
}

function CompanyLetterhead({ profile, compact = false, hideLogo = false, showPlaceholders = true, dense = false }) {
  const name = profile?.companyName?.trim() || 'Your Company Name'
  const headerText = profile?.headerText?.trim() || ''
  const logoUrl = hideLogo ? null : profile?.logoUrl
  const headerImageUrl = profile?.headerImageUrl
  const width = Math.max(24, Math.min(320, Number(profile?.logoWidth) || 64))
  const height = profile?.logoHeight != null
    ? Math.max(24, Math.min(240, Number(profile.logoHeight) || 64))
    : null
  const initial = name.charAt(0).toUpperCase() || 'Q'
  const showMark = !hideLogo
  const titleClass = dense ? 'text-[13px] leading-tight' : compact ? 'text-base' : 'text-lg'
  const metaClass = dense ? 'text-[10px] leading-snug' : 'text-sm'

  if (headerImageUrl) {
    return (
      <img
        src={headerImageUrl}
        alt={`${name} header`}
        className="block h-auto w-full object-contain"
        style={{ maxHeight: compact || dense ? 90 : 180 }}
        onError={onQuoteAssetImgError}
      />
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: dense ? 10 : 14 }}>
      {showMark && (
        <div style={{ flexShrink: 0, width: Math.min(width, compact ? 40 : 80) }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={`${name} logo`}
              onError={onQuoteAssetImgError}
              style={{
                width: '100%',
                height: height || 'auto',
                maxHeight: height || (compact || dense ? 48 : 80),
                objectFit: 'contain',
                display: 'block',
                background: 'transparent'
              }}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-xl bg-moss font-bold text-white"
              style={{ width: Math.min(width, 56), height: Math.min(height || width, 56), fontSize: Math.min(width, 56) * 0.4 }}
            >
              {initial}
            </div>
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h2 className={`${titleClass} font-semibold`} style={{ margin: 0 }}>{name}</h2>
        {headerText ? (
          <p className={`mt-1 whitespace-pre-line text-slate-500 ${metaClass}`}>{headerText}</p>
        ) : (
          showPlaceholders && !compact && (
            <>
              <p className={`mt-1 text-slate-500 ${metaClass}`}>Your address · City, State · PIN</p>
              <p className={`text-slate-500 ${metaClass}`}>+91 00000 00000 · sales@yourcompany.com</p>
            </>
          )
        )}
      </div>
    </div>
  )
}

const PROFILE_SIDECAR_MARK = '__QG_BANK__'

function parseProfileSidecar(footerText) {
  const raw = String(footerText || '')
  const idx = raw.indexOf(PROFILE_SIDECAR_MARK)
  if (idx === -1) {
    return { note: raw, extra: { bankName: '', accountNo: '', ifsc: '', terms: '', accountName: '', branch: '' } }
  }
  let extra = { bankName: '', accountNo: '', ifsc: '', terms: '', accountName: '', branch: '' }
  try {
    const parsed = JSON.parse(raw.slice(idx + PROFILE_SIDECAR_MARK.length).trim())
    if (parsed && typeof parsed === 'object') {
      extra = {
        bankName: String(parsed.bankName || ''),
        accountNo: String(parsed.accountNo || parsed.bankAccountNo || ''),
        ifsc: String(parsed.ifsc || parsed.bankIfsc || ''),
        terms: String(parsed.terms || parsed.standardTerms || ''),
        accountName: String(parsed.accountName || parsed.bankAccountName || ''),
        branch: String(parsed.branch || parsed.bankBranch || '')
      }
    }
  } catch { /* ignore malformed sidecar */ }
  return { note: raw.slice(0, idx).replace(/\s+$/, ''), extra }
}

function joinProfileSidecar(note, extra = {}) {
  const n = visibleFooterText(note)
  const payload = {
    bankName: String(extra.bankName || ''),
    accountNo: String(extra.accountNo || extra.bankAccountNo || ''),
    ifsc: String(extra.ifsc || extra.bankIfsc || ''),
    terms: String(extra.terms || extra.standardTerms || ''),
    accountName: String(extra.accountName || extra.bankAccountName || ''),
    branch: String(extra.branch || extra.bankBranch || '')
  }
  if (!payload.bankName && !payload.accountNo && !payload.ifsc && !payload.terms && !payload.accountName && !payload.branch) return n
  return `${n}${n ? '\n\n' : ''}${PROFILE_SIDECAR_MARK}\n${JSON.stringify(payload)}`
}

function profileSidecarPayload(profile, overrides = {}) {
  return {
    bankName: overrides.bankName != null ? overrides.bankName : (profile?.bankName || ''),
    accountNo: overrides.accountNo != null ? overrides.accountNo : (profile?.bankAccountNo || ''),
    ifsc: overrides.ifsc != null ? overrides.ifsc : (profile?.bankIfsc || ''),
    terms: overrides.terms != null ? overrides.terms : (profile?.standardTerms || ''),
    accountName: overrides.accountName != null ? overrides.accountName : (profile?.bankAccountName || ''),
    branch: overrides.branch != null ? overrides.branch : (profile?.bankBranch || '')
  }
}

/** Footer banner if one was uploaded, otherwise the footer text. */
function visibleFooterText(footerText) {
  const raw = String(footerText || '')
  const idx = raw.indexOf(PROFILE_SIDECAR_MARK)
  return (idx === -1 ? raw : raw.slice(0, idx)).trim()
}

function CompanyFooter({ profile, className = '', editable = false, onFitChange }) {
  const footerImageUrl = profile?.footerImageUrl
  const footerText = visibleFooterText(profile?.footerText)
  const fit = normalizeFooterFit(profile?.footerFit)
  const wrapRef = useRef(null)
  const dragRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const canEdit = Boolean(editable && onFitChange)
  const fitActive = canEdit && editing

  useEffect(() => {
    if (!fitActive) return undefined
    const onMove = (event) => {
      const drag = dragRef.current
      if (!drag) return
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect?.width || !rect?.height) return
      event.preventDefault()
      const dx = event.clientX - drag.x
      const dy = event.clientY - drag.y
      if (drag.mode === 'pan') {
        onFitChange?.(patchFooterFit(drag.fit, {
          x: drag.fit.x - (dx / rect.width) * 100,
          y: drag.fit.y - (dy / rect.height) * 100
        }))
      } else if (drag.mode === 'height') {
        onFitChange?.(patchFooterFit(drag.fit, { height: drag.fit.height + dy }))
      } else if (drag.mode === 'width') {
        const parentW = wrapRef.current?.parentElement?.getBoundingClientRect()?.width || rect.width
        onFitChange?.(patchFooterFit(drag.fit, { width: drag.fit.width + (dx / parentW) * 100 }))
      }
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [fitActive, onFitChange])

  if (footerImageUrl) {
    const startDrag = (mode) => (event) => {
      if (!fitActive) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = { mode, x: event.clientX, y: event.clientY, fit }
    }
    return (
      <div
        ref={wrapRef}
        className={`qg-footer-image-wrap ${fitActive ? 'is-editable' : ''} ${canEdit && !editing ? 'is-adjustable' : ''} ${className}`}
        style={footerFitCssVars(fit)}
        onPointerDown={fitActive ? startDrag('pan') : undefined}
        onWheel={fitActive ? (event) => {
          event.preventDefault()
          onFitChange?.(patchFooterFit(fit, { zoom: fit.zoom + (event.deltaY > 0 ? -6 : 6) }))
        } : undefined}
        title={fitActive ? 'Drag to reposition · scroll to zoom · handles for height and width' : undefined}
      >
        <img
          src={footerImageUrl}
          alt="Quotation footer"
          className="qg-footer-image"
          draggable={false}
          onError={onQuoteAssetImgError}
        />
        {canEdit && !editing && (
          <button
            type="button"
            className="qg-footer-edit-btn no-print"
            title="Adjust how this footer banner sits on the page"
            onClick={(event) => { event.stopPropagation(); setEditing(true) }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Edit footer
          </button>
        )}
        {fitActive && (
          <>
            <div className="qg-footer-fit-bar no-print" onPointerDown={e => e.stopPropagation()}>
              <button type="button" onClick={() => onFitChange?.(patchFooterFit(fit, { height: fit.height - 12 }))}>Slimmer</button>
              <button type="button" onClick={() => onFitChange?.(patchFooterFit(fit, { height: fit.height + 12 }))}>Taller</button>
              <button type="button" onClick={() => onFitChange?.(patchFooterFit(fit, { zoom: fit.zoom - 10 }))}>Zoom −</button>
              <button type="button" onClick={() => onFitChange?.(patchFooterFit(fit, { zoom: fit.zoom + 10 }))}>Zoom +</button>
              <button type="button" onClick={() => onFitChange?.(patchFooterFit(fit, { width: 100, x: 50, y: 50, zoom: 100 }))}>Reset</button>
              <button type="button" className="qg-footer-fit-done" onClick={() => setEditing(false)}>Done</button>
            </div>
            <span className="qg-footer-handle qg-footer-handle--height no-print" onPointerDown={startDrag('height')} />
            <span className="qg-footer-handle qg-footer-handle--width no-print" onPointerDown={startDrag('width')} />
          </>
        )}
      </div>
    )
  }
  if (!footerText) return null
  return <p className={`whitespace-pre-line text-center text-xs leading-relaxed text-slate-500 ${className}`}>{footerText}</p>
}

function PageEndBand({ children, dense = false }) {
  if (!children) return null
  return (
    <div className={dense ? 'mt-5 border-t border-slate-300 pt-2.5' : 'mt-8 border-t border-slate-300 pt-4'}>
      {children}
    </div>
  )
}

function bankDetailRows(profile) {
  return [
    { label: 'Bank Name', value: profile?.bankName?.trim() || '' },
    { label: 'Account Name', value: (profile?.bankAccountName || profile?.companyName || '').trim() },
    { label: 'Account No', value: profile?.bankAccountNo?.trim() || '' },
    { label: 'IFSC / SWIFT', value: profile?.bankIfsc?.trim() || '' }
  ]
}

function bankDetailLines(profile) {
  return bankDetailRows(profile).filter(row => row.value).map(row => `${row.label}: ${row.value}`)
}

function CompanyBankDetails({ profile, className = '', showEmpty = false, heading = true, dense = false }) {
  const rows = bankDetailRows(profile)
  const display = showEmpty ? rows : rows.filter(row => row.value)
  const qrUrl = profile?.bankQrUrl || null
  if (!display.length && !qrUrl) return null
  return (
    <section className={className}>
      {heading && (
        <h3 className={`qg-section-heading mb-2 border-b pb-1.5 ${dense ? 'text-[10px]' : 'text-[11px]'}`} style={{ borderColor: 'var(--qg-table-border, #e8edf3)' }}>Bank details</h3>
      )}
      <div className={`qg-bank-block${qrUrl ? ' qg-bank-block--with-qr' : ''}`}>
        {qrUrl ? (
          <>
            <div className="qg-bank-qr-col">
              <img
                src={qrUrl}
                alt="Payment QR"
                className={dense ? 'qg-bank-qr qg-bank-qr-dense' : 'qg-bank-qr'}
                onError={onQuoteAssetImgError}
              />
              <p className={dense ? 'qg-bank-qr-hint qg-bank-qr-hint-dense' : 'qg-bank-qr-hint'}>Scan with any UPI payment app</p>
            </div>
            <span className="qg-bank-divider" aria-hidden="true" />
          </>
        ) : null}
        <div className={dense ? 'text-[11px] leading-5 text-slate-700' : 'text-sm leading-7 text-slate-700'}>
          {display.map(row => (
            <p key={row.label}>
              <span className="text-slate-600">{row.label}:</span>
              {row.value ? ` ${row.value}` : ''}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}

const PREVIEW_SAMPLE_LINES = [
  { description: 'Industrial control panel', unit: 'Nos', quantity: '2', rate: 45000 },
  { description: 'Cable assembly, 10 m', unit: 'Nos', quantity: '4', rate: 3250 }
]

function resolvePreviewColumns(layoutPreview, profile, templates) {
  if (layoutPreview?.mode === 'upload') {
    const id = layoutPreview.uploadTemplateId || profile?.defaultUploadTemplateId || null
    const tpl = (templates || []).find(t => t.id === id)
    if (tpl?.columns?.length) return tpl.columns
  }
  if (layoutPreview?.columns?.length) return layoutPreview.columns
  if (profile?.defaultUploadTemplateId) {
    const tpl = (templates || []).find(t => t.id === profile.defaultUploadTemplateId)
    if (tpl?.columns?.length) return tpl.columns
  }
  if (profile?.columnLayout?.length) return profile.columnLayout
  return DEFAULT_DATA_COLUMNS
}

function previewSampleItems(columns) {
  const cols = columns?.length ? columns : DEFAULT_DATA_COLUMNS
  const descCol = findFieldColumn(cols, 'description')
  const unitCol = findFieldColumn(cols, 'unit')
  const qtyCol = findFieldColumn(cols, 'quantity')
  const rateCol = findFieldColumn(cols, 'rate')
  const amountCol = findFieldColumn(cols, 'amount')
  return PREVIEW_SAMPLE_LINES.map(line => {
    const item = blankItemFor(cols)
    if (descCol) item[descCol.id] = line.description
    if (unitCol) item[unitCol.id] = line.unit
    if (qtyCol) item[qtyCol.id] = line.quantity
    if (rateCol) item[rateCol.id] = String(line.rate)
    for (const col of cols) {
      if (isNestedColumn(col) || isImageColumn(col) || isAttachmentColumn(col) || isFormulaColumn(col)) continue
      if (col.id === descCol?.id || col.id === unitCol?.id || col.id === qtyCol?.id || col.id === rateCol?.id || col.id === amountCol?.id) continue
      if (item[col.id] == null || item[col.id] === '') item[col.id] = '—'
    }
    return recalcRow(item, cols)
  })
}

function previewColAlignRight(col, columns) {
  if (isNestedColumn(col)) return true
  const qtyCol = findFieldColumn(columns, 'quantity')
  const rateCol = findFieldColumn(columns, 'rate')
  const amountCol = findFieldColumn(columns, 'amount')
  return col.id === qtyCol?.id || col.id === rateCol?.id || col.id === amountCol?.id || isFormulaColumn(col)
}

function formatPreviewCell(item, col, columns) {
  if (isImageColumn(col) || isAttachmentColumn(col)) return ''
  const raw = item?.[col.id]
  const rateCol = findFieldColumn(columns, 'rate')
  const amountCol = findFieldColumn(columns, 'amount')
  if (col.id === amountCol?.id || col.id === rateCol?.id || isFormulaColumn(col)) {
    const n = toNumber(raw)
    return n == null ? (raw || '—') : money(n)
  }
  if (raw === '' || raw == null) return '—'
  return String(raw)
}

function CompanyQuotePreview({ profile, layoutPreview = null, uploadTemplates = [], onFooterFitChange }) {
  const A4_W = 794
  const A4_H = 1123
  const frameRef = useRef(null)
  const paperRef = useRef(null)
  const [scale, setScale] = useState(0.55)
  const [paperH, setPaperH] = useState(A4_H)
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const quoteNumber = profile?.seriesPreview
    || formatSeriesPreview(profile?.series?.prefix ? profile.series : { prefix: 'QG', padding: 4, nextNumber: 1, includeYear: true })
  const terms = String(profile?.standardTerms || '').trim()
  const awaitingHeaderBanner = profile?.headerMode === 'image' && !profile?.headerImageUrl
  const awaitingFooterBanner = profile?.footerMode === 'image' && !profile?.footerImageUrl
  const previewColumns = resolvePreviewColumns(layoutPreview, profile, uploadTemplates)
  const sampleItems = previewSampleItems(previewColumns)
  const previewTotals = computeQuoteTotals(sampleItems, previewColumns)
  const sampleTotal = previewTotals.grandTotal
  const columnsKey = previewColumns.map(c => `${c.id}:${c.label}:${c.type || ''}:${c.formula ? JSON.stringify(c.formula) : ''}`).join('|')

  useEffect(() => {
    const frame = frameRef.current
    const paper = paperRef.current
    if (!frame || !paper || typeof ResizeObserver === 'undefined') return undefined
    const apply = () => {
      const width = frame.clientWidth
      if (width > 0) setScale(Math.min(1, width / A4_W))
      const height = Math.max(A4_H, paper.scrollHeight || paper.offsetHeight || 0)
      if (height > 0) setPaperH(height)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(frame)
    observer.observe(paper)
    return () => observer.disconnect()
  }, [profile, terms, columnsKey, profile?.footerFit?.height, profile?.footerFit?.width])

  return (
    <aside>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Live preview</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {profile?.footerImageUrl
              ? 'Drag the footer banner to crop · scroll to zoom · pull the blue handles'
              : 'Printed quotation, actual A4 width'}
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">A4 · 210 × 297 mm</span>
      </div>
      <div
        className="rounded-2xl p-4 pb-8 sm:p-5 sm:pb-10"
        style={{ background: 'linear-gradient(180deg, #E7EDF5 0%, #D5DCE6 100%)' }}
      >
        <div ref={frameRef} className="mx-auto" style={{ width: '100%' }}>
          <div
            className="relative mx-auto"
            style={{ width: A4_W * scale, height: paperH * scale }}
          >
            <article
              ref={paperRef}
              className="absolute left-0 top-0 flex flex-col bg-white"
              style={{
                width: A4_W,
                minHeight: A4_H,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                color: '#2d3748',
                fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
                boxShadow: '0 1px 0 rgba(255,255,255,.65) inset, 0 18px 40px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.06)',
                pointerEvents: 'none'
              }}
            >
              <header className="border-b-2 border-moss">
                <div className="flex items-start justify-between gap-6 px-8 py-6">
                  <div className="min-w-0 flex-1">
                    <CompanyLetterhead profile={profile} dense showPlaceholders={profile?.headerMode !== 'image'} />
                    {awaitingHeaderBanner && (
                      <div className="mt-2 flex h-14 items-center justify-center rounded-lg bg-[#f7f9f7] text-[11px] text-slate-400">
                        Header banner will appear here
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 pt-0.5 text-right">
                    <p className="text-lg font-semibold tracking-tight text-moss">QUOTATION</p>
                    <p className="mt-1 text-[11px] text-slate-600">{quoteNumber} &nbsp;|&nbsp; {today}</p>
                  </div>
                </div>
              </header>

              <div className={`flex flex-1 flex-col px-8 py-6 ${profile?.footerImageUrl || awaitingFooterBanner ? 'pb-4' : 'pb-8'}`}>
                <h1 className="mb-5 text-[15px] font-semibold">Supply of industrial components</h1>
                <div className="mb-5 grid grid-cols-2 gap-4 rounded-xl bg-[#f7f9f7] p-3.5">
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-moss">Quoted to</p>
                    <p className="text-[11px] text-slate-800">Asha Mehta</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Acme Industries Pvt Ltd</p>
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-moss">Customer details</p>
                    <p className="text-[11px] text-slate-800">GST 27AABCU9603R1ZM</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">Mumbai, Maharashtra</p>
                  </div>
                </div>

                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-y text-[9px] uppercase tracking-wide" style={{ borderColor: '#e8edf3', background: '#f7f9fc', color: '#3d6db5' }}>
                      <th className="w-8 px-2 py-2 font-semibold">Sr.</th>
                      {previewColumns.map(col => {
                        const right = previewColAlignRight(col, previewColumns)
                        const highlight = isHighlightColumn(col) ? { backgroundColor: highlightColor(col) } : undefined
                        if (isNestedColumn(col)) {
                          return (
                            <th key={col.id} className="px-2 py-2 text-right font-semibold" style={highlight}>
                              {col.label} %
                            </th>
                          )
                        }
                        return (
                          <th
                            key={col.id}
                            className={`px-2 py-2 font-semibold ${right ? 'text-right' : ''}`}
                            style={highlight}
                          >
                            {col.label}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleItems.map((item, index) => (
                      <tr key={index} className="border-b border-sand">
                        <td className="px-2 py-2 text-slate-400">{index + 1}</td>
                        {previewColumns.map(col => {
                          const highlight = isHighlightColumn(col) ? { backgroundColor: highlightColor(col) } : undefined
                          if (isNestedColumn(col)) {
                            const rate = item[rateKey(col)]
                            return (
                              <td key={col.id} className="px-2 py-2 text-right text-slate-600">
                                {rate ? `${rate}%` : '—'}
                              </td>
                            )
                          }
                          const right = previewColAlignRight(col, previewColumns)
                          const amountCol = findFieldColumn(previewColumns, 'amount')
                          const isAmount = col.id === amountCol?.id
                          return (
                            <td
                              key={col.id}
                              className={`px-2 py-2 ${right ? 'text-right' : ''} ${isAmount ? 'text-slate-800' : right ? 'text-slate-600' : 'text-slate-800'}`}
                              style={highlight}
                            >
                              {isImageColumn(col) ? (
                                <span className="inline-block h-6 w-10 rounded border border-dashed border-sand bg-[#f7f9f7]" />
                              ) : isAttachmentColumn(col) ? (
                                <span className="text-[10px] text-slate-400">Drop file</span>
                              ) : formatPreviewCell(item, col, previewColumns)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="ml-auto mt-4 w-64 border-t-2 border-moss pt-2">
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Subtotal</span>
                    <span>{money(sampleTotal)}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between text-[13px] font-semibold">
                    <span>Total</span>
                    <span>{money(sampleTotal)}</span>
                  </div>
                  <p className="mt-1 text-right text-[10px] text-slate-400">Taxes extra as applicable</p>
                </div>

                <section className="mt-7">
                  <h3 className="mb-1.5 border-b border-sand pb-1 text-[10px] font-bold uppercase tracking-wider text-moss">Standard terms</h3>
                  {terms ? (
                    <p className="whitespace-pre-line text-[11px] leading-relaxed text-slate-700">{terms}</p>
                  ) : (
                    <p className="text-[11px] text-slate-400">Standard terms for this quotation</p>
                  )}
                </section>

                <CompanyBankDetails profile={profile} showEmpty dense className="mt-4" />

                <div className="mt-auto pt-8">
                  <div className="flex justify-end">
                    <div className="w-44 text-center">
                      <div className="h-10" />
                      <div className="border-t border-slate-400 pt-1.5">
                        <p className="text-[10px] font-semibold text-slate-800">Authorized Signatory</p>
                        <p className="mt-0.5 text-[9px] text-slate-500">For {profile?.companyName?.trim() || 'Your Company'}</p>
                      </div>
                    </div>
                  </div>
                  {visibleFooterText(profile?.footerText) && !profile?.footerImageUrl && !awaitingFooterBanner ? (
                    <PageEndBand dense>
                      <CompanyFooter profile={profile} className="text-[10px]" />
                    </PageEndBand>
                  ) : null}
                </div>
              </div>
              {awaitingFooterBanner ? (
                <div className="qg-footer-image-wrap">
                  <div className="flex h-[72px] items-center justify-center bg-[#f7f9f7] text-[11px] text-slate-400">
                    Footer banner will appear here
                  </div>
                </div>
              ) : profile?.footerImageUrl ? (
                <CompanyFooter
                  profile={profile}
                  editable={Boolean(onFooterFitChange)}
                  onFitChange={onFooterFitChange}
                />
              ) : null}
            </article>
          </div>
        </div>
      </div>
    </aside>
  )
}

const BRANDING_FIELD_CLASS = 'w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50'
const BRANDING_SAVE_BTN_CLASS = 'rounded-xl bg-moss px-4 py-2 text-sm font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50'

function BrandingSaveButton({ saving, disabled, onClick, children }) {
  return (
    <button
      type="button"
      disabled={saving || disabled}
      onClick={onClick}
      className={BRANDING_SAVE_BTN_CLASS}
    >
      {saving ? 'Saving…' : children}
    </button>
  )
}
const SELECT_FIELD_CLASS = 'w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-moss focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50'
const PHONE_LINE_RE = /(?:\+91[\s-]*)?(?:\d[\s()-]*){10,}/
const PIN_LINE_RE = /\b(\d{6})\b/
const EMAIL_LINE_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/

function parseHeaderFields(headerText) {
  const lines = String(headerText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  let phone = ''
  let pinCode = ''
  let email = ''
  const addressParts = []
  for (const line of lines) {
    const pinOnly = /^(?:pin(?:\s*code)?|pincode)\s*[:.\-]?\s*(\d{6})\s*$/i.exec(line)
    if (pinOnly) {
      if (!pinCode) pinCode = pinOnly[1]
      continue
    }
    const phoneOnly = /^(?:phone|tel|mobile|mob)\s*[:.\-]?\s*(.+)$/i.exec(line)
    if (phoneOnly && !phone) {
      phone = phoneOnly[1].trim()
      continue
    }
    if (!phone && PHONE_LINE_RE.test(line) && line.replace(/[\d\s+\-().]/g, '').length <= 6) {
      phone = line
      continue
    }
    const emailOnly = /^(?:e-?mail)\s*[:.\-]?\s*(.+)$/i.exec(line)
    if (emailOnly && !email) {
      email = emailOnly[1].trim()
      continue
    }
    const emailMatch = line.match(EMAIL_LINE_RE)
    if (emailMatch && !email && line.replace(EMAIL_LINE_RE, '').replace(/[\s:.\-]/g, '').length === 0) {
      email = emailMatch[0]
      continue
    }
    const pinInLine = line.match(/(?:[,\s\-–]|pin(?:\s*code)?[:.\-\s]+)(\d{6})\s*$/i) || (PIN_LINE_RE.test(line) && /(?:pin|pincode|\d{6}\s*$)/i.test(line) ? line.match(PIN_LINE_RE) : null)
    if (pinInLine && !pinCode && /(?:pin|pincode|[,\s\-–]\s*\d{6}\s*$)/i.test(line)) {
      pinCode = pinInLine[1]
      const stripped = line.replace(/[,\s\-–]*(?:pin(?:\s*code)?[:.\-\s]*)?\d{6}\s*$/i, '').trim()
      if (stripped) addressParts.push(stripped)
      continue
    }
    addressParts.push(line)
  }
  return { address: addressParts.join('\n'), phone, pinCode, email }
}

function composeHeaderText({ address, phone, pinCode, email }) {
  const pin = String(pinCode || '').trim()
  let addressBlock = String(address || '').trim()
  if (pin) {
    if (addressBlock) {
      const lines = addressBlock.split(/\r?\n/)
      const last = lines.length - 1
      const lastLine = lines[last].replace(/[,\s]+$/, '')
      lines[last] = /\d{6}\s*$/.test(lastLine) ? lastLine : `${lastLine} – ${pin}`
      addressBlock = lines.join('\n')
    } else {
      addressBlock = pin
    }
  }
  return [addressBlock, phone, email]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join('\n')
}

function parseFooterFields(footerText) {
  return { note: visibleFooterText(footerText) }
}

function composeFooterText({ note }) {
  return String(note || '').trim()
}

function TextOrImageToggle({ value, onChange, disabled, textTitle, textHint, imageTitle, imageHint }) {
  const options = [
    {
      id: 'text',
      title: textTitle,
      hint: textHint,
      icon: (
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M4 4h12v2H4V4zm0 5h8v2H4V9zm0 5h12v2H4v-2z" />
        </svg>
      )
    },
    {
      id: 'image',
      title: imageTitle,
      hint: imageHint,
      icon: (
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
          <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11zM5 14l3.2-4 2.3 2.8L13 9.5 16 14H5z" />
        </svg>
      )
    }
  ]
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
      {options.map(option => {
        const selected = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-left shadow-sm transition disabled:opacity-50 ${
              selected
                ? 'border-moss bg-moss text-white shadow-[0_0_0_3px_rgba(29,99,237,0.18)]'
                : 'border-sand bg-white text-slate-800 hover:border-moss hover:bg-blue-50'
            }`}
          >
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
              selected ? 'bg-white/20 text-white' : 'bg-[#eef3fb] text-moss'
            }`}>
              {option.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className={`text-sm font-semibold ${selected ? 'text-white' : 'text-slate-800'}`}>{option.title}</span>
                {selected && (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Selected
                  </span>
                )}
              </span>
              <span className={`mt-0.5 block text-[11px] leading-4 ${selected ? 'text-blue-100' : 'text-slate-500'}`}>{option.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function FooterFitSliders({ fit, disabled, onChange }) {
  const row = (label, key, min, max, suffix) => (
    <label className="block text-xs text-slate-600">
      <span className="mb-1 flex justify-between font-medium">
        <span>{label}</span>
        <span className="tabular-nums text-slate-400">{fit[key]}{suffix}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={fit[key]}
        disabled={disabled}
        onChange={e => onChange({ [key]: Number(e.target.value) })}
        className="w-full accent-[#1A73E8] disabled:opacity-50"
      />
    </label>
  )
  return (
    <div className="mt-3 space-y-2.5 rounded-lg bg-[#f7f9f7] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fit in the footer box</p>
      {row('Height', 'height', 48, 280, ' px')}
      {row('Width', 'width', 50, 100, '%')}
      {row('Zoom', 'zoom', 70, 200, '%')}
      {row('Move left / right', 'x', 0, 100, '%')}
      {row('Move up / down', 'y', 0, 100, '%')}
      <p className="text-[11px] leading-snug text-slate-400">You can also drag the banner in the live preview, scroll to zoom, and pull the blue handles.</p>
    </div>
  )
}

function BannerImageCard({ title, url, inputRef, note, busy, disabled, onPick, onRemove, bleed = false, fit = null }) {
  return (
    <div className={bleed ? '' : 'mt-3'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{title}</p>
        <div className="flex items-center gap-1">
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={onPick} />
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-moss hover:bg-blue-50 disabled:opacity-50"
          >
            {busy ? 'Uploading…' : (url ? 'Replace image' : 'Choose image')}
          </button>
          {url && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={onRemove}
              className="rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {url ? (
        bleed ? (
          <div className="qg-footer-image-wrap mt-3 -mx-3 mb-[-0.75rem] w-[calc(100%+1.5rem)]" style={footerFitCssVars(fit)}>
            <img src={url} alt={title} className="qg-footer-image" />
          </div>
        ) : (
          <img src={url} alt={title} className="mt-3 w-full rounded-lg border border-sand bg-white object-contain" style={{ maxHeight: 90 }} />
        )
      ) : (
        <p className="mt-3 text-xs text-slate-400">{note}</p>
      )}
    </div>
  )
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Could not read that image.'))
    reader.readAsDataURL(file)
  })
}

function CompanyBrandingPanel({ open, onToggle, profile, persistenceConfigured, onSaved, onUnavailable, onDraftChange, onFooterFitChange }) {
  const [companyName, setCompanyName] = useState(profile?.companyName || '')
  const [headerFields, setHeaderFields] = useState(() => parseHeaderFields(profile?.headerText))
  const [footerFields, setFooterFields] = useState(() => parseFooterFields(profile?.footerText))
  const [headerMode, setHeaderMode] = useState(profile?.headerImageUrl ? 'image' : 'text')
  const [footerMode, setFooterMode] = useState(profile?.footerImageUrl ? 'image' : 'text')
  const [logoWidth, setLogoWidth] = useState(profile?.logoWidth ?? 64)
  const [logoHeight, setLogoHeight] = useState(profile?.logoHeight ?? 64)
  const [lockAspect, setLockAspect] = useState(true)
  const [aspect, setAspect] = useState(
    profile?.logoWidth && profile?.logoHeight ? profile.logoWidth / profile.logoHeight : 1
  )
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [bannerBusy, setBannerBusy] = useState('')
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(profile?.logoUrl || null)
  const fileRef = useRef(null)
  const headerImageRef = useRef(null)
  const footerImageRef = useRef(null)

  useEffect(() => {
    if (!profile) return
    setCompanyName(profile.companyName || '')
    setLogoWidth(profile.logoWidth ?? 120)
    setLogoHeight(profile.logoHeight ?? 48)
    if (profile.logoWidth && profile.logoHeight) {
      setAspect(profile.logoWidth / profile.logoHeight)
    }
    setLogoPreviewUrl(prev => {
      if (!profile.logoUrl) return null
      if (prev && String(prev).startsWith('data:')) return prev
      return profile.logoUrl
    })
  }, [profile])

  useEffect(() => {
    setHeaderFields(parseHeaderFields(profile?.headerText))
  }, [profile?.headerText])

  useEffect(() => {
    setFooterFields(parseFooterFields(profile?.footerText))
  }, [profile?.footerText])

  useEffect(() => {
    if (profile?.headerImageUrl) setHeaderMode('image')
  }, [profile?.headerImageUrl])

  useEffect(() => {
    if (profile?.footerImageUrl) setFooterMode('image')
  }, [profile?.footerImageUrl])

  const headerText = composeHeaderText(headerFields)
  const footerText = composeFooterText(footerFields)
  const patchHeaderField = (key, value) => setHeaderFields(prev => ({ ...prev, [key]: value }))
  const patchFooterField = (key, value) => setFooterFields(prev => ({ ...prev, [key]: value }))

  const previewLogoUrl = logoPreviewUrl || profile?.logoUrl || null
  const previewProfile = {
    companyName,
    headerText: headerMode === 'text' ? headerText : '',
    footerText: footerMode === 'text' ? footerText : '',
    logoUrl: previewLogoUrl,
    headerImageUrl: headerMode === 'image' ? profile?.headerImageUrl : null,
    footerImageUrl: footerMode === 'image' ? profile?.footerImageUrl : null,
    footerFit: profile?.footerFit,
    logoWidth: Number(logoWidth) || 64,
    logoHeight: Number(logoHeight) || 64
  }

  useEffect(() => {
    onDraftChange?.({
      companyName,
      headerText: previewProfile.headerText,
      footerText: previewProfile.footerText,
      logoUrl: previewLogoUrl,
      headerImageUrl: previewProfile.headerImageUrl,
      footerImageUrl: previewProfile.footerImageUrl,
      footerFit: previewProfile.footerFit,
      logoWidth: previewProfile.logoWidth,
      logoHeight: previewProfile.logoHeight,
      headerMode,
      footerMode
    })
  }, [companyName, headerText, footerText, headerMode, footerMode, previewLogoUrl, profile?.headerImageUrl, profile?.footerImageUrl, profile?.footerFit, logoWidth, logoHeight])

  const selectSlotMode = (slot) => async (mode) => {
    if (slot === 'header') setHeaderMode(mode)
    else setFooterMode(mode)
    const hasImage = slot === 'header' ? profile?.headerImageUrl : profile?.footerImageUrl
    if (mode !== 'text' || !hasImage) return
    setBannerBusy(slot)
    setError('')
    setMessage('')
    try {
      const result = await removeCompanyBanner(slot)
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        if (slot === 'header') setHeaderMode('image')
        else setFooterMode('image')
        return
      }
      onSaved?.(result.profile)
    } catch (err) {
      setError(err.message || `Could not remove ${slot} image`)
      if (slot === 'header') setHeaderMode('image')
      else setFooterMode('image')
    } finally {
      setBannerBusy('')
    }
  }

  const handleWidthChange = (raw) => {
    const w = Math.max(24, Math.min(320, Number(raw) || 24))
    setLogoWidth(w)
    if (lockAspect && aspect > 0) setLogoHeight(Math.max(24, Math.round(w / aspect)))
  }

  const handleHeightChange = (raw) => {
    const h = Math.max(24, Math.min(240, Number(raw) || 24))
    setLogoHeight(h)
    if (lockAspect && aspect > 0) setLogoWidth(Math.max(24, Math.round(h * aspect)))
  }

  const handleSave = async (okMessage = 'Company branding saved.') => {
    setSaving(true)
    setError('')
    setMessage('')
    const headerTextToSave = (headerMode === 'image' && profile?.headerImageUrl) ? '' : headerText
    const footerTextToSave = (footerMode === 'image' && profile?.footerImageUrl) ? '' : footerText
    const nameToSave = companyName
    const widthToSave = Number(logoWidth) || null
    const heightToSave = Number(logoHeight) || null
    try {
      if (headerMode === 'text' && profile?.headerImageUrl) {
        const removed = await removeCompanyBanner('header')
        if (removed.unavailable) {
          onUnavailable?.()
          setError(SUPABASE_SETUP_HINT)
          return
        }
      }
      if (footerMode === 'text' && profile?.footerImageUrl) {
        const removed = await removeCompanyBanner('footer')
        if (removed.unavailable) {
          onUnavailable?.()
          setError(SUPABASE_SETUP_HINT)
          return
        }
      }
      const result = await saveCompanyProfile({
        companyName: nameToSave,
        headerText: headerTextToSave,
        footerText: footerTextToSave,
        logoWidth: widthToSave,
        logoHeight: heightToSave,
        footerFit: normalizeFooterFit(profile?.footerFit)
      })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      setMessage(okMessage)
    } catch (e) {
      setError(e.message || 'Could not save branding')
    } finally {
      setSaving(false)
    }
  }

  const handleLogoPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    setMessage('')
    try {
      const localPreview = await fileToDataUrl(file)
      if (localPreview) setLogoPreviewUrl(localPreview)
      const result = await uploadCompanyLogo(file, {
        logoWidth: Number(logoWidth) || 64,
        logoHeight: Number(logoHeight) || 64
      })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      if (result.profile?.logoUrl?.startsWith('data:')) setLogoPreviewUrl(result.profile.logoUrl)
      setMessage('Logo uploaded.')
      if (result.profile?.logoWidth && result.profile?.logoHeight) {
        setAspect(result.profile.logoWidth / result.profile.logoHeight)
      }
    } catch (err) {
      setError(err.message || 'Could not upload logo')
    } finally {
      setUploading(false)
    }
  }

  const handleBannerPick = (slot) => async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBannerBusy(slot)
    setError('')
    setMessage('')
    try {
      const result = await uploadCompanyBanner(slot, file)
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      if (slot === 'header') {
        setHeaderMode('image')
        setHeaderFields({ address: '', phone: '', pinCode: '', email: '' })
      } else {
        setFooterMode('image')
        setFooterFields({ note: '' })
      }
      const cleared = await saveCompanyProfile(slot === 'header' ? { headerText: '' } : { footerText: '' })
      if (cleared.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(cleared.profile || result.profile)
      setMessage(`${slot === 'header' ? 'Header' : 'Footer'} image uploaded.`)
    } catch (err) {
      setError(err.message || `Could not upload ${slot} image`)
    } finally {
      setBannerBusy('')
    }
  }

  const handleRemoveBanner = (slot) => async () => {
    setBannerBusy(slot)
    setError('')
    setMessage('')
    try {
      const result = await removeCompanyBanner(slot)
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      if (slot === 'header') setHeaderMode('image')
      else setFooterMode('image')
      setMessage(`${slot === 'header' ? 'Header' : 'Footer'} image removed.`)
    } catch (err) {
      setError(err.message || `Could not remove ${slot} image`)
    } finally {
      setBannerBusy('')
    }
  }

  const handleRemoveLogo = async () => {
    setUploading(true)
    setError('')
    setMessage('')
    try {
      const result = await removeCompanyLogo()
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      setLogoPreviewUrl(null)
      setMessage('Logo removed.')
    } catch (err) {
      setError(err.message || 'Could not remove logo')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mb-5 rounded-3xl border border-sand bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Company header & footer</h2>
          <p className="mt-1 text-xs text-slate-500">Company name, logo, and how the header and footer appear on quotations.</p>
        </div>
        <button type="button" onClick={onToggle} className="text-sm font-medium text-moss">
          {open ? 'Hide branding' : 'Edit branding'}
        </button>
      </div>
      {!persistenceConfigured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{SUPABASE_SETUP_HINT}</p>
      )}
      {persistenceConfigured && !open && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-sand bg-[#f7f9f7]">
          <div className="p-4">
            <CompanyLetterhead profile={profile} compact />
          </div>
          {profile?.footerImageUrl ? (
            <CompanyFooter profile={profile} />
          ) : visibleFooterText(profile?.footerText) ? (
            <div className="px-4 pb-4">
              <CompanyFooter profile={profile} />
            </div>
          ) : null}
        </div>
      )}
      {open && (
        <div className="mt-4 space-y-4">
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-moss">
            Preview on the right updates as you type. Click Save so new quotations use these details.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block min-w-0 flex-1 text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Company name</span>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} disabled={!persistenceConfigured} className={BRANDING_FIELD_CLASS} />
            </label>
            <BrandingSaveButton saving={saving} disabled={!persistenceConfigured} onClick={() => handleSave('Company name saved.')}>
              Save company name
            </BrandingSaveButton>
          </div>

          <div className="rounded-2xl border border-sand bg-[#f7f9f7] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">Logo</p>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={handleLogoPick} />
                <button type="button" disabled={!persistenceConfigured || uploading} onClick={() => fileRef.current?.click()} className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-moss hover:bg-blue-50 disabled:opacity-50">
                  {uploading ? 'Uploading…' : (profile?.logoUrl ? 'Replace logo' : 'Upload logo')}
                </button>
                {profile?.logoUrl && (
                  <button type="button" disabled={!persistenceConfigured || uploading} onClick={handleRemoveLogo} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                    Remove
                  </button>
                )}
              </div>
            </div>
            {previewLogoUrl && (
              <img
                src={previewLogoUrl}
                alt="Company logo"
                className="mt-3 max-h-20 w-auto object-contain"
              />
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700">Width (px)</span>
                <input type="number" min={24} max={320} value={logoWidth} onChange={e => handleWidthChange(e.target.value)} disabled={!persistenceConfigured} className="w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50" />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700">Height (px)</span>
                <input type="number" min={24} max={240} value={logoHeight} onChange={e => handleHeightChange(e.target.value)} disabled={!persistenceConfigured} className="w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50" />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
                <input type="checkbox" checked={lockAspect} onChange={e => setLockAspect(e.target.checked)} disabled={!persistenceConfigured} className="rounded border-sand text-moss focus:ring-moss" />
                Lock aspect ratio
              </label>
            </div>
            <input
              type="range"
              min={24}
              max={320}
              value={Number(logoWidth) || 120}
              onChange={e => handleWidthChange(e.target.value)}
              disabled={!persistenceConfigured}
              className="mt-3 w-full accent-[#1A73E8]"
            />
            <div className="mt-3 flex justify-end">
              <BrandingSaveButton saving={saving} disabled={!persistenceConfigured} onClick={() => handleSave('Logo size saved.')}>
                Save logo size
              </BrandingSaveButton>
            </div>
          </div>

          <div className="rounded-2xl border border-sand bg-[#f7f9f7] p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">Header</p>
              <p className="mt-1 text-xs text-slate-500">Pick one: typed contact details, or a banner image. Both cannot show at once.</p>
            </div>
            <TextOrImageToggle
              value={headerMode}
              onChange={selectSlotMode('header')}
              disabled={!persistenceConfigured || bannerBusy === 'header'}
              textTitle="Type details"
              textHint="Address, phone, pin code and email"
              imageTitle="Upload a banner"
              imageHint="A letterhead image instead of typed text"
            />
            {headerMode === 'text' && (
              <div className="space-y-3 rounded-xl border border-moss/20 bg-white p-3 ring-2 ring-blue-50">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700">Address</span>
                  <textarea value={headerFields.address} onChange={e => patchHeaderField('address', e.target.value)} disabled={!persistenceConfigured} rows={2} placeholder="Street, city, state" className={`resize-y ${BRANDING_FIELD_CLASS}`} />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-slate-700">Phone number</span>
                    <input value={headerFields.phone} onChange={e => patchHeaderField('phone', e.target.value)} disabled={!persistenceConfigured} placeholder="+91 00000 00000" className={BRANDING_FIELD_CLASS} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-slate-700">Pin code</span>
                    <input value={headerFields.pinCode} onChange={e => patchHeaderField('pinCode', e.target.value)} disabled={!persistenceConfigured} inputMode="numeric" maxLength={6} placeholder="400069" className={BRANDING_FIELD_CLASS} />
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium text-slate-700">Email</span>
                  <input type="email" value={headerFields.email || ''} onChange={e => patchHeaderField('email', e.target.value)} disabled={!persistenceConfigured} placeholder="sales@yourcompany.com" className={BRANDING_FIELD_CLASS} />
                </label>
                <div className="flex justify-end">
                  <BrandingSaveButton saving={saving} disabled={!persistenceConfigured} onClick={() => handleSave('Header details saved.')}>
                    Save header
                  </BrandingSaveButton>
                </div>
              </div>
            )}
            {headerMode === 'image' && (
              <div className="rounded-xl border border-moss/20 bg-white p-3 ring-2 ring-blue-50">
              <BannerImageCard
                title="Banner image"
                url={profile?.headerImageUrl}
                inputRef={headerImageRef}
                note="This image replaces the typed address on quotations. Your logo and company name still appear. Uploads apply immediately."
                busy={bannerBusy === 'header'}
                disabled={!persistenceConfigured}
                onPick={handleBannerPick('header')}
                onRemove={handleRemoveBanner('header')}
              />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-sand bg-[#f7f9f7] p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">Footer</p>
              <p className="mt-1 text-xs text-slate-500">Pick one: a short note, or a footer image. Both cannot show at once.</p>
            </div>
            <TextOrImageToggle
              value={footerMode}
              onChange={selectSlotMode('footer')}
              disabled={!persistenceConfigured || bannerBusy === 'footer'}
              textTitle="Type a note"
              textHint="A line of text at the bottom of quotations"
              imageTitle="Upload a banner"
              imageHint="A designed footer image instead of text"
            />
            {footerMode === 'text' && (
              <div className="rounded-xl border border-moss/20 bg-white p-3 ring-2 ring-blue-50">
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700">Footer note</span>
                <textarea value={footerFields.note} onChange={e => patchFooterField('note', e.target.value)} disabled={!persistenceConfigured} rows={2} placeholder="Thank you for your business!" className={`resize-y ${BRANDING_FIELD_CLASS}`} />
              </label>
              <div className="mt-3 flex justify-end">
                <BrandingSaveButton saving={saving} disabled={!persistenceConfigured} onClick={() => handleSave('Footer saved.')}>
                  Save footer
                </BrandingSaveButton>
              </div>
              </div>
            )}
            {footerMode === 'image' && (
              <div className="overflow-hidden rounded-xl border border-moss/20 bg-white p-3 ring-2 ring-blue-50">
              <BannerImageCard
                title="Banner image"
                url={profile?.footerImageUrl}
                inputRef={footerImageRef}
                note="This image replaces the footer note on quotations. Uploads apply immediately."
                busy={bannerBusy === 'footer'}
                disabled={!persistenceConfigured}
                onPick={handleBannerPick('footer')}
                onRemove={handleRemoveBanner('footer')}
                bleed
                fit={profile?.footerFit}
              />
              {profile?.footerImageUrl && (
                <FooterFitSliders
                  fit={normalizeFooterFit(profile?.footerFit)}
                  disabled={!persistenceConfigured}
                  onChange={(patch) => onFooterFitChange?.(patchFooterFit(profile?.footerFit, patch))}
                />
              )}
              </div>
            )}
          </div>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {message && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-moss">{message}</p>}
          <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand bg-white px-4 py-3 shadow-lg">
            <p className="text-xs text-slate-500">Preview is a draft until you save.</p>
            <BrandingSaveButton saving={saving} disabled={!persistenceConfigured} onClick={() => handleSave('Company branding saved.')}>
              Save branding
            </BrandingSaveButton>
          </div>
        </div>
      )}
    </div>
  )
}

function BankDetailsPanel({ open, onToggle, profile, persistenceConfigured, onSaved, onUnavailable, onDraftChange }) {
  const [bankName, setBankName] = useState(profile?.bankName || '')
  const [accountName, setAccountName] = useState(profile?.bankAccountName || profile?.companyName || '')
  const [accountNo, setAccountNo] = useState(profile?.bankAccountNo || '')
  const [gstin, setGstin] = useState(profile?.gstNumber || '')
  const [ifsc, setIfsc] = useState(profile?.bankIfsc || '')
  const [saving, setSaving] = useState(false)
  const [uploadingQr, setUploadingQr] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const qrFileRef = useRef(null)

  useEffect(() => {
    if (!profile) return
    if (profile.bankName) setBankName(profile.bankName)
    setAccountName(profile.bankAccountName || profile.companyName || '')
    if (profile.bankAccountNo) setAccountNo(profile.bankAccountNo)
    if (profile.gstNumber) setGstin(profile.gstNumber)
    if (profile.bankIfsc) setIfsc(profile.bankIfsc)
  }, [profile?.bankName, profile?.bankAccountName, profile?.bankAccountNo, profile?.gstNumber, profile?.bankIfsc, profile?.companyName])

  useEffect(() => {
    onDraftChange?.({
      bankName,
      bankAccountName: accountName,
      bankAccountNo: accountNo,
      gstNumber: gstin,
      bankIfsc: ifsc
    })
  }, [bankName, accountName, accountNo, gstin, ifsc])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await saveCompanyProfile({
        bankName,
        bankAccountName: accountName,
        bankAccountNo: accountNo,
        bankIfsc: ifsc,
        gstNumber: gstin,
        footerText: joinProfileSidecar(profile?.footerText, profileSidecarPayload(profile, {
          bankName,
          accountNo,
          ifsc,
          accountName,
          terms: profile?.standardTerms || ''
        }))
      })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.({
        ...(profile || {}),
        ...(result.profile || {}),
        bankName: result.profile?.bankName || bankName,
        bankAccountName: result.profile?.bankAccountName || accountName,
        bankAccountNo: result.profile?.bankAccountNo || accountNo,
        bankIfsc: result.profile?.bankIfsc || ifsc,
        gstNumber: result.profile?.gstNumber || gstin,
        standardTerms: result.profile?.standardTerms || profile?.standardTerms || ''
      })
      setMessage('Bank details saved.')
    } catch (e) {
      setError(e.message || 'Could not save bank details')
    } finally {
      setSaving(false)
    }
  }

  const handleQrPick = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingQr(true)
    setError('')
    setMessage('')
    try {
      const result = await uploadCompanyBankQr(file)
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      setMessage('Payment QR added.')
    } catch (e) {
      setError(e.message || 'Could not upload QR')
    } finally {
      setUploadingQr(false)
    }
  }

  const handleRemoveQr = async () => {
    setUploadingQr(true)
    setError('')
    setMessage('')
    try {
      const result = await removeCompanyBankQr()
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      setMessage('Payment QR removed.')
    } catch (e) {
      setError(e.message || 'Could not remove QR')
    } finally {
      setUploadingQr(false)
    }
  }

  return (
    <div className="mb-5 rounded-3xl border border-sand bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Bank details</h2>
          <p className="mt-1 text-xs text-slate-500">Printed on quotations as Bank Name, Account Name, Account No, IFSC / SWIFT, and an optional payment QR.</p>
        </div>
        <button type="button" onClick={onToggle} className="text-sm font-medium text-moss">
          {open ? 'Hide bank details' : 'Edit bank details'}
        </button>
      </div>
      {!persistenceConfigured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{SUPABASE_SETUP_HINT}</p>
      )}
      {persistenceConfigured && !open && (
        <div className="mt-4 rounded-2xl border border-sand bg-[#f7f9f7] p-4">
          <CompanyBankDetails profile={profile} heading={false} />
          {!bankDetailLines(profile).length && !profile?.bankQrUrl && (
            <p className="text-sm text-slate-400">No bank details yet.</p>
          )}
        </div>
      )}
      {open && (
        <div className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Bank name</span>
            <input value={bankName} onChange={e => setBankName(e.target.value)} disabled={!persistenceConfigured} placeholder="HDFC Bank" className={BRANDING_FIELD_CLASS} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Account name</span>
            <input value={accountName} onChange={e => setAccountName(e.target.value)} disabled={!persistenceConfigured} placeholder="Tech Solutions Pvt Ltd" className={BRANDING_FIELD_CLASS} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Account number</span>
            <input value={accountNo} onChange={e => setAccountNo(e.target.value)} disabled={!persistenceConfigured} className={BRANDING_FIELD_CLASS} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">IFSC / SWIFT</span>
            <input value={ifsc} onChange={e => setIfsc(e.target.value)} disabled={!persistenceConfigured} placeholder="HDFC0001234" className={BRANDING_FIELD_CLASS} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">GSTIN number</span>
            <input value={gstin} onChange={e => setGstin(e.target.value)} disabled={!persistenceConfigured} placeholder="27AABCT1234F1Z5" className={BRANDING_FIELD_CLASS} />
          </label>
          <div className="rounded-2xl border border-sand bg-[#f7f9f7] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-700">Payment QR</p>
                <p className="mt-0.5 text-xs text-slate-500">Shown to the right of bank details on quotations. Upload a UPI or bank QR image.</p>
              </div>
              <div className="flex items-center gap-2">
                <input ref={qrFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={handleQrPick} />
                <button type="button" disabled={!persistenceConfigured || uploadingQr} onClick={() => qrFileRef.current?.click()} className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-moss hover:bg-blue-50 disabled:opacity-50">
                  {uploadingQr ? 'Uploading…' : (profile?.bankQrUrl ? 'Replace QR' : 'Upload QR')}
                </button>
                {profile?.bankQrUrl && (
                  <button type="button" disabled={!persistenceConfigured || uploadingQr} onClick={handleRemoveQr} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                    Remove
                  </button>
                )}
              </div>
            </div>
            {profile?.bankQrUrl && (
              <img src={profile.bankQrUrl} alt="Payment QR preview" className="mt-3 h-24 w-24 rounded-lg border border-sand bg-white object-contain p-1" />
            )}
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {message && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-moss">{message}</p>}
          <button
            type="button"
            disabled={saving || !persistenceConfigured}
            onClick={handleSave}
            className="rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save bank details'}
          </button>
        </div>
      )}
    </div>
  )
}

function TermsAndConditionsPanel({ open, onToggle, profile, persistenceConfigured, onSaved, onUnavailable, onDraftChange }) {
  const [terms, setTerms] = useState(profile?.standardTerms || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (profile?.standardTerms) setTerms(profile.standardTerms)
  }, [profile?.standardTerms])

  useEffect(() => {
    onDraftChange?.({ standardTerms: terms })
  }, [terms])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await saveCompanyProfile({
        standardTerms: terms,
        footerText: joinProfileSidecar(profile?.footerText, profileSidecarPayload(profile, { terms }))
      })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.({
        ...(profile || {}),
        ...(result.profile || {}),
        bankName: result.profile?.bankName || profile?.bankName || '',
        bankAccountNo: result.profile?.bankAccountNo || profile?.bankAccountNo || '',
        bankIfsc: result.profile?.bankIfsc || profile?.bankIfsc || '',
        standardTerms: result.profile?.standardTerms || terms
      })
      setTerms(result.profile?.standardTerms || terms)
      setMessage('Terms and conditions saved.')
    } catch (e) {
      setError(e.message || 'Could not save terms and conditions')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-5 rounded-3xl border border-sand bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Standard terms and conditions</h2>
          <p className="mt-1 text-xs text-slate-500">Printed on every quotation below the commercial terms.</p>
        </div>
        <button type="button" onClick={onToggle} className="text-sm font-medium text-moss">
          {open ? 'Hide terms' : 'Edit terms'}
        </button>
      </div>
      {!persistenceConfigured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{SUPABASE_SETUP_HINT}</p>
      )}
      {persistenceConfigured && !open && (
        <div className="mt-4 rounded-2xl border border-sand bg-[#f7f9f7] p-4">
          {profile?.standardTerms?.trim() ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-500">{profile.standardTerms}</p>
          ) : (
            <p className="text-sm text-slate-400">No terms and conditions yet.</p>
          )}
        </div>
      )}
      {open && (
        <div className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Terms and conditions</span>
            <textarea
              value={terms}
              onChange={e => setTerms(e.target.value)}
              disabled={!persistenceConfigured}
              rows={8}
              placeholder={'1. Prices are exclusive of taxes unless stated otherwise.\n2. Payment as per the commercial terms on this quotation.\n3. Delivery schedule to be confirmed at order.'}
              className={`resize-y ${BRANDING_FIELD_CLASS}`}
            />
          </label>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {message && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-moss">{message}</p>}
          <button
            type="button"
            disabled={saving || !persistenceConfigured}
            onClick={handleSave}
            className="rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save terms'}
          </button>
        </div>
      )}
    </div>
  )
}

function invoiceTypesFromProfile(invoiceSeries = {}) {
  const types = { ...(invoiceSeries.types || {}) }
  types.sales_invoice = {
    prefix: invoiceSeries.prefix || 'INV',
    padding: invoiceSeries.padding ?? 4,
    nextNumber: invoiceSeries.nextNumber ?? 1,
    includeYear: invoiceSeries.includeYear !== false
  }
  return types
}

function SeriesSettingsPanel({ open, onToggle, profile, persistenceConfigured, onSaved, onUnavailable, onDraftChange }) {
  const series = profile?.series || {}
  const [sample, setSample] = useState(() => formatSeriesPreview(series.prefix ? series : { prefix: 'QG', padding: 4, nextNumber: 1, includeYear: true }))
  const invoiceSeries = profile?.invoiceSeries || {}
  const initialInvTypes = invoiceTypesFromProfile(invoiceSeries)
  const initialInvType = invoiceSeries.type || DEFAULT_INVOICE_SERIES_TYPE
  const initialInv = initialInvTypes[initialInvType] || defaultSeriesSettings(initialInvType)
  const [invType, setInvType] = useState(initialInvType)
  const [invTypes, setInvTypes] = useState(initialInvTypes)
  const [invSample, setInvSample] = useState(() => formatSeriesPreview(initialInv))
  const [hsnCodeFormat, setHsnCodeFormat] = useState(profile?.hsnCodeFormat || '4')
  const [serverPeek, setServerPeek] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile) return
    if (profile.series) {
      setSample(formatSeriesPreview(profile.series))
    }
    if (profile.invoiceSeries) {
      const types = invoiceTypesFromProfile(profile.invoiceSeries)
      const type = profile.invoiceSeries.type || DEFAULT_INVOICE_SERIES_TYPE
      const current = types[type] || defaultSeriesSettings(type)
      setInvType(type)
      setInvTypes(types)
      setInvSample(formatSeriesPreview(current))
    }
    setHsnCodeFormat(profile.hsnCodeFormat || '4')
  }, [profile])

  useEffect(() => {
    if (!open || !persistenceConfigured) {
      setServerPeek('')
      return
    }
    let cancelled = false
    peekQuotationSeries()
      .then(res => {
        if (cancelled) return
        if (res.unavailable) {
          onUnavailable?.()
          return
        }
        if (res.peek?.number) setServerPeek(res.peek.number)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, persistenceConfigured, profile])

  useEffect(() => {
    onDraftChange?.({ seriesPreview: formatSeriesPreview(parseQuotationSample(sample)) })
  }, [sample])

  const parsedSample = parseQuotationSample(sample)
  const preview = formatSeriesPreview(parsedSample)
  const followingNumber = formatSeriesPreview({ ...parsedSample, nextNumber: parsedSample.nextNumber + 1 })
  const invTypeMeta = invoiceSeriesTypeById(invType)
  const parsedInvSample = parseQuotationSample(invSample, invTypeMeta.prefix)
  const followingInvNumber = formatSeriesPreview({ ...parsedInvSample, nextNumber: parsedInvSample.nextNumber + 1 })

  const currentInvSettings = () => parseQuotationSample(invSample, invTypeMeta.prefix)

  const selectInvType = (nextId) => {
    if (nextId === invType) return
    const merged = { ...invTypes, [invType]: currentInvSettings() }
    const next = merged[nextId] || defaultSeriesSettings(nextId)
    setInvTypes(merged)
    setInvType(nextId)
    setInvSample(formatSeriesPreview(next))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await saveCompanyProfile({
        hsnCodeFormat,
        series: parseQuotationSample(sample),
        invoiceSeries: (() => {
          const types = { ...invTypes, [invType]: currentInvSettings() }
          const sales = types.sales_invoice || defaultSeriesSettings(DEFAULT_INVOICE_SERIES_TYPE)
          return {
            prefix: sales.prefix,
            padding: Number(sales.padding),
            nextNumber: Number(sales.nextNumber),
            includeYear: sales.includeYear !== false,
            type: invType,
            types
          }
        })()
      })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      setMessage('Series settings saved.')
      if (result.profile?.series) {
        setServerPeek(formatSeriesPreview(result.profile.series))
      }
    } catch (e) {
      setError(e.message || 'Could not save series settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-3xl border border-sand bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Quotation number series</h2>
          <p className="mt-1 text-xs text-slate-500">Enter the next quotation number. Each new quotation will increase it by 1.</p>
        </div>
        <button type="button" onClick={onToggle} className="text-sm font-medium text-moss">
          {open ? 'Hide settings' : 'Edit series'}
        </button>
      </div>
      {!persistenceConfigured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{SUPABASE_SETUP_HINT}</p>
      )}
      {persistenceConfigured && !open && (
        <p className="mt-3 text-sm text-slate-600">
          Next number: <span className="font-semibold text-moss">{formatSeriesPreview(profile?.series || { prefix: 'QG', padding: 4, nextNumber: 1, includeYear: true })}</span>
        </p>
      )}
      {open && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-sand bg-[#f7f9f7] p-4">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Next quotation number</span>
              <input
                value={sample}
                onChange={e => setSample(e.target.value)}
                disabled={!persistenceConfigured}
                placeholder="QT-0020"
                className="w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50"
              />
            </label>
            <p className="mt-3 text-sm text-slate-500">
              After this one: <span className="font-semibold text-moss">{followingNumber}</span>
            </p>
            {serverPeek && serverPeek !== preview && (
              <p className="mt-1 text-xs text-slate-400">Currently allocated: {serverPeek}</p>
            )}
          </div>

          {/* Tax invoice numbering is legally its own continuous sequence, so it
              never shares the quotation counter. */}
          <div className="rounded-2xl border border-sand bg-[#f7f9f7] p-4">
            <p className="text-sm font-semibold text-slate-700">{invTypeMeta.label} series</p>
            <p className="mt-1 text-xs text-slate-500">Used when you convert a quotation into an invoice.</p>
            <label className="mt-3 block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Series type</span>
              <select
                value={invType}
                onChange={e => selectInvType(e.target.value)}
                disabled={!persistenceConfigured}
                className={SELECT_FIELD_CLASS}
              >
                {INVOICE_SERIES_TYPES.map(type => (
                  <option key={type.id} value={type.id}>{type.label}</option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Next invoice number</span>
              <input
                value={invSample}
                onChange={e => setInvSample(e.target.value)}
                disabled={!persistenceConfigured}
                placeholder="INV-0002"
                className="w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50"
              />
            </label>
            <p className="mt-3 text-sm text-slate-500">
              After this one: <span className="font-semibold text-moss">{followingInvNumber}</span>
            </p>
          </div>

          <div className="rounded-2xl border border-sand bg-[#f7f9f7] p-4">
            <p className="text-sm font-semibold text-slate-700">HSN code format</p>
            <p className="mt-1 text-xs text-slate-500">
              How many digits to show when Fetch HSN/GST fills a row. 4-digit is enough for most small businesses; 8-digit gives the fuller export-grade code when it's known.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setHsnCodeFormat('4')}
                disabled={!persistenceConfigured}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold ${hsnCodeFormat === '4' ? 'border-moss bg-blue-50 text-moss' : 'border-sand bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                4-digit <span className="block text-xs font-normal text-slate-400">e.g. 7309</span>
              </button>
              <button
                type="button"
                onClick={() => setHsnCodeFormat('8')}
                disabled={!persistenceConfigured}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold ${hsnCodeFormat === '8' ? 'border-moss bg-blue-50 text-moss' : 'border-sand bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                8-digit <span className="block text-xs font-normal text-slate-400">e.g. 73090000</span>
              </button>
            </div>
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {message && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-moss">{message}</p>}
          <button
            type="button"
            disabled={saving || !persistenceConfigured}
            onClick={handleSave}
            className="rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save series settings'}
          </button>
        </div>
      )}
    </div>
  )
}

function ColumnBuilder({ columns, setColumns }) {
  const [showAdd, setShowAdd] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customType, setCustomType] = useState('text')
  const [specialMode, setSpecialMode] = useState('percent')
  const [hsnDigits, setHsnDigits] = useState('4')
  const [dragIndex, setDragIndex] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)
  const [editingIndex, setEditingIndex] = useState(null)
  const [editLabel, setEditLabel] = useState('')
  const [formulaColId, setFormulaColId] = useState(null)
  const [wantFormula, setWantFormula] = useState(false)

  const columnExists = (label) => columns.some(c => c.label.toLowerCase() === label.trim().toLowerCase())

  const addColumn = (label, type = 'text', { openFormula } = {}) => {
    const trimmed = label.trim()
    if (!trimmed || columnExists(trimmed)) return
    const resolvedType = type === 'formula' ? 'text' : type
    const options = {}
    if (resolvedType === 'tax' || resolvedType === 'discount') options.mode = specialMode
    if (resolvedType === 'hsn') options.digits = hsnDigits
    const col = makeTypedColumn(trimmed, resolvedType, columns, options)
    if (type === 'formula' || wantFormula || openFormula) col.calculated = true
    let nextColumns = insertColumnsBeforeUnit(columns, [col])
    const shouldOpen = openFormula || type === 'formula' || wantFormula
    const formula = formulaForAddedColumn(col, nextColumns, { guessTokens: shouldOpen })
    if (formula) col.formula = formula
    nextColumns = adaptAmountFormula(nextColumns).columns
    setColumns(nextColumns)
    setCustomName('')
    setShowAdd(false)
    setWantFormula(false)
    if (shouldOpen && canHaveFormula(col, nextColumns)) setFormulaColId(col.id)
  }

  const selectedType = BUILDER_COLUMN_TYPES.find(o => o.type === customType) || BUILDER_COLUMN_TYPES[0]
  const duplicateName = Boolean(customName.trim()) && columnExists(customName)

  /** Name is optional: without one the chosen type contributes its own default label. */
  const submitColumn = () => {
    const typed = customName.trim()
    if (typed) { addColumn(typed, customType); return }
    let label = selectedType.defaultLabel
    let n = 2
    while (columnExists(label)) label = `${selectedType.defaultLabel} ${n++}`
    addColumn(label, customType)
  }

  const renameColumn = (index, label) => {
    const trimmed = label.trim()
    if (!trimmed) return
    if (columns.some((c, i) => i !== index && c.label.toLowerCase() === trimmed.toLowerCase())) return
    const nextColumns = columns.map((c, i) => i === index ? { ...c, label: trimmed } : c)
    setColumns(nextColumns)
  }

  const saveColumnFormula = (colId, formula) => {
    setColumns(prev => prev.map(c => {
      if (c.id !== colId) return c
      const next = { ...c }
      if (formula) {
        next.formula = formula
        const amountCol = findFieldColumn(prev, 'amount')
        if (!amountCol || c.id !== amountCol.id) next.calculated = true
      } else {
        delete next.formula
      }
      return next
    }))
    setFormulaColId(null)
  }

  const startEditing = (index, e) => {
    e.stopPropagation()
    setEditingIndex(index)
    setEditLabel(columns[index].label)
  }

  const commitEdit = (index) => {
    renameColumn(index, editLabel)
    setEditingIndex(null)
  }

  const handleDrop = (to) => {
    if (dragIndex == null) return
    setColumns(prev => moveColumn(prev, dragIndex, to))
    setDragIndex(null)
    setDropIndex(null)
  }

  const removeColumn = (index) => {
    if (columns.length <= 1) return
    const removedId = columns[index]?.id
    if (removedId && formulaColId === removedId) setFormulaColId(null)
    setColumns(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="mt-5 rounded-2xl border border-sand bg-[#f7f9f7] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">Quotation columns</p>
        <span className="hidden text-xs text-slate-400 sm:inline">Drag to reorder · click to rename · hover to remove</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-sand bg-white">
        <table className="w-full min-w-max text-left text-sm">
          <thead>
            <tr className="border-b border-sand bg-[#f7f9f7]">
              <th className="whitespace-nowrap p-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sr. No.</th>
              {columns.map((col, i) => (
                <th
                  key={col.id}
                  draggable={editingIndex !== i}
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => { e.preventDefault(); setDropIndex(i) }}
                  onDragLeave={() => setDropIndex(null)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={() => { setDragIndex(null); setDropIndex(null) }}
                  title="Drag to reorder · click to rename"
                  style={isHighlightColumn(col) ? { backgroundColor: highlightColor(col) } : undefined}
                  className={`group relative whitespace-nowrap p-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition ${dragIndex === i ? 'opacity-40' : ''} ${dropIndex === i && dragIndex !== i ? 'bg-blue-50 ring-2 ring-inset ring-moss' : ''} ${editingIndex === i ? '' : 'cursor-grab active:cursor-grabbing'} ${formulaColId === col.id ? 'z-20' : ''}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-300">☰</span>
                    {editingIndex === i ? (
                      <input
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        onBlur={() => commitEdit(i)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitEdit(i)
                          if (e.key === 'Escape') setEditingIndex(null)
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        autoFocus
                        className="w-28 rounded border border-moss bg-white px-1.5 py-0.5 text-[11px] font-semibold normal-case text-slate-700 outline-none ring-2 ring-blue-50"
                      />
                    ) : (
                      <span
                        onClick={(e) => startEditing(i, e)}
                        className="cursor-text normal-case"
                      >
                        {col.label}
                      </span>
                    )}
                    {canHaveFormula(col, columns) && editingIndex !== i && (
                      <button
                        type="button"
                        draggable={false}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setFormulaColId(formulaColId === col.id ? null : col.id) }}
                        title={isFormulaColumn(col) ? formulaSentence(col.formula?.tokens, columns) : (col.id === 'amount' ? 'Custom formula on Amount (optional)' : 'Set a formula')}
                        className={`qg-col-fx shrink-0 rounded px-1.5 text-[9px] font-bold normal-case tracking-normal ${isFormulaColumn(col) ? 'bg-blue-50 text-moss' : 'text-moss/70 hover:bg-blue-50 hover:text-moss'}`}
                      >
                        fx
                      </button>
                    )}
                    {columns.length > 1 && editingIndex !== i && (
                      <button
                        type="button"
                        draggable={false}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeColumn(i) }}
                        title="Remove column"
                        className="qg-col-remove inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold leading-none opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        ×
                      </button>
                    )}
                  </span>
                  {formulaColId === col.id && (
                    <FormulaGuide
                      col={col}
                      columns={columns}
                      onSave={(formula) => saveColumnFormula(col.id, formula)}
                      onClose={() => setFormulaColId(null)}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-sand text-slate-300">
              <td className="p-3 text-slate-400">1</td>
              {columns.map(col => (
                <td key={col.id} className="p-3" style={isHighlightColumn(col) ? { backgroundColor: highlightColor(col) } : undefined}>
                  {col.id === 'description' ? (
                    <div className="leading-snug">
                      <p className="text-xs font-semibold text-slate-600">Sample product</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">Class 150 · ANSI B16.5</p>
                    </div>
                  ) : isNestedColumn(col) || ((columnType(col) === 'tax' || columnType(col) === 'discount') && columnMode(col) === 'percent') ? (
                    <span className="text-[10px] text-slate-400">%</span>
                  ) : isImageColumn(col) ? (
                    <span className="text-[10px] text-slate-400">Drop image</span>
                  ) : isAttachmentColumn(col) ? (
                    <span className="text-[10px] text-slate-400">Drop file</span>
                  ) : columnType(col) === 'hsn' ? (
                    <span className="text-[10px] text-slate-400">{getHsnDigits(col)}-digit code</span>
                  ) : ((columnType(col) === 'tax' || columnType(col) === 'discount') && columnMode(col) === 'amount') ? (
                    <span className="text-[10px] text-slate-400">Amount</span>
                  ) : isFormulaColumn(col) ? (
                    <span className="text-[10px] text-slate-400">Auto</span>
                  ) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="relative mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-sand bg-white px-3 py-1.5 text-xs font-semibold text-moss outline-none transition hover:border-moss hover:bg-blue-50 focus:ring-2 focus:ring-blue-50"
        >
          + Add column
        </button>
        {showAdd && (
          <div className="absolute bottom-full right-0 z-30 mb-2 w-[22rem] rounded-2xl border border-sand bg-white p-4 shadow-soft">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-700">Add column</p>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                title="Close"
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                ×
              </button>
            </div>
            <input
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !duplicateName) submitColumn() }}
              placeholder="Column name (optional)"
              aria-label="Column name"
              className="w-full rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-moss focus:ring-2 focus:ring-blue-50"
            />
            {duplicateName && (
              <p className="mt-1.5 text-[11px] text-rose-500">A column called “{customName.trim()}” already exists.</p>
            )}

            <p className="mb-1.5 mt-3 text-xs font-medium text-slate-600">Type</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Column type">
              {BUILDER_COLUMN_TYPES.map(option => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => {
                    setCustomType(option.type)
                    if (option.type === 'formula') setWantFormula(true)
                    if (option.type === 'image' || option.type === 'attachment' || option.type === 'tax' || option.type === 'discount' || option.type === 'hsn') setWantFormula(false)
                  }}
                  title={`${option.label} — ${option.hint}`}
                  aria-pressed={customType === option.type}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${customType === option.type ? 'border-moss bg-moss text-white' : 'border-sand bg-white text-slate-600 hover:border-moss hover:bg-blue-50 hover:text-moss'}`}
                >
                  {COLUMN_TYPE_LABELS[option.type] || option.label.replace(/ column$/i, '')}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-tight text-slate-400">
              {selectedType.hint}
              {!customName.trim() && <> · named “{selectedType.defaultLabel}” unless you type a name</>}
            </p>

            {(customType === 'tax' || customType === 'discount') && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-slate-600">How should this work?</p>
                <div className="flex gap-2">
                  {[
                    ['percent', '% wise'],
                    ['amount', 'Amount wise']
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSpecialMode(value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${specialMode === value ? 'border-moss bg-blue-50 text-moss' : 'border-sand bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {customType === 'hsn' && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-slate-600">Which code length?</p>
                <div className="flex gap-2">
                  {[
                    ['4', '4 digit'],
                    ['8', '8 digit']
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setHsnDigits(value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${hsnDigits === value ? 'border-moss bg-blue-50 text-moss' : 'border-sand bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {customType !== 'image' && customType !== 'attachment' && customType !== 'tax' && customType !== 'discount' && customType !== 'hsn' && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-sand bg-[#f7f9f7] px-3 py-2">
                <input
                  type="checkbox"
                  checked={wantFormula || customType === 'formula'}
                  onChange={e => setWantFormula(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-700">Calculate with a formula</span>
                  <span className="block text-[11px] leading-snug text-slate-500">Like Excel — Quantity × Rate, or a custom formula. Use Formula column type, or fx on Amount.</span>
                </span>
              </label>
            )}

            <button
              type="button"
              onClick={submitColumn}
              disabled={duplicateName}
              className="mt-3 w-full rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#1558b0] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add column
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Company-level default column set: whatever is saved here seeds every new
 * quotation (AI-generated or "Fill it in myself"), so a company only has to
 * set up its columns once instead of rebuilding them on every quote. Reuses
 * the exact same add/rename/reorder/remove UI as the "New quote" page.
 */
function CompanyColumnLayoutPanel({ open, onToggle, profile, persistenceConfigured, onSaved, onUnavailable, templates = [], onUploadNew, onPreviewChange }) {
  const [layoutColumns, setLayoutColumns] = useState(profile?.columnLayout?.length ? profile.columnLayout : DEFAULT_DATA_COLUMNS)
  const [savedLayouts, setSavedLayouts] = useState(Array.isArray(profile?.columnLayouts) ? profile.columnLayouts : [])
  const [activeId, setActiveId] = useState(profile?.activeColumnLayoutId || null)
  const [layoutMode, setLayoutMode] = useState(profile?.defaultUploadTemplateId ? 'upload' : 'create')
  const [naming, setNaming] = useState(false)
  const [layoutName, setLayoutName] = useState('')
  const [uploadName, setUploadName] = useState('')
  const [uploadSaving, setUploadSaving] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!profile) return
    setLayoutColumns(profile.columnLayout?.length ? profile.columnLayout : DEFAULT_DATA_COLUMNS)
    setSavedLayouts(Array.isArray(profile.columnLayouts) ? profile.columnLayouts : [])
    setActiveId(profile.activeColumnLayoutId || null)
    if (profile.defaultUploadTemplateId) setLayoutMode('upload')
  }, [profile])

  const activeUploadId = profile?.defaultUploadTemplateId || null

  useEffect(() => {
    onPreviewChange?.({
      mode: layoutMode,
      columns: layoutColumns,
      uploadTemplateId: layoutMode === 'upload' ? activeUploadId : null
    })
  }, [layoutMode, layoutColumns, activeUploadId, onPreviewChange])

  const openNaming = () => {
    const current = savedLayouts.find(l => l.id === activeId)
    setLayoutName(current?.name || '')
    setNaming(true)
    setError('')
    setMessage('')
  }

  const handleSave = async () => {
    const name = layoutName.trim()
    if (!name) {
      setError('Enter a name for this layout.')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const savedColumns = normalizeColumnList(layoutColumns)
      const existing = savedLayouts.find(l => l.name.toLowerCase() === name.toLowerCase())
      const id = existing?.id || `cl_${Date.now()}`
      const nextLayouts = existing
        ? savedLayouts.map(l => (l.id === id ? { id, name, columns: savedColumns } : l))
        : [...savedLayouts, { id, name, columns: savedColumns }]
      const result = await saveCompanyProfile({
        columnLayout: savedColumns,
        columnLayouts: nextLayouts,
        activeColumnLayoutId: id,
        defaultUploadTemplateId: null
      })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
      setSavedLayouts(result.profile?.columnLayouts || nextLayouts)
      setActiveId(id)
      setNaming(false)
      setMessage(`Saved “${name}” — every new quotation will start with these columns.`)
    } catch (e) {
      setError(e.message || 'Could not save column layout')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => setLayoutColumns(DEFAULT_DATA_COLUMNS)
  const activeName = savedLayouts.find(l => l.id === activeId)?.name
  const activeUpload = templates.find(t => t.id === activeUploadId) || null

  const selectLayoutMode = async (mode) => {
    const next = mode === 'image' ? 'upload' : 'create'
    setLayoutMode(next)
    setError('')
    setMessage('')
    if (next !== 'create' || !activeUploadId) return
    setUploadSaving('default')
    try {
      const result = await saveCompanyProfile({ defaultUploadTemplateId: null })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        setLayoutMode('upload')
        return
      }
      onSaved?.(result.profile)
    } catch (e) {
      setError(e.message || 'Could not switch layout mode')
      setLayoutMode('upload')
    } finally {
      setUploadSaving(null)
    }
  }

  const makeUploadDefault = async (templateId) => {
    setUploadSaving(templateId || 'default')
    setError('')
    try {
      const result = await saveCompanyProfile({ defaultUploadTemplateId: templateId })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
    } catch (e) {
      setError(e.message || 'Could not set the uploaded layout')
    } finally {
      setUploadSaving(null)
    }
  }

  return (
    <div className="rounded-3xl border border-sand bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Default column layout</h2>
          <p className="mt-1 text-xs text-slate-500">Pick one: build columns here, or upload an existing quotation. Both cannot be used at once.</p>
        </div>
        <button type="button" onClick={onToggle} className="text-sm font-medium text-moss">
          {open ? 'Hide layout' : 'Edit layout'}
        </button>
      </div>
      {!persistenceConfigured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{SUPABASE_SETUP_HINT}</p>
      )}
      {persistenceConfigured && !open && (
        <p className="mt-3 text-sm text-slate-600">
          {activeUploadId && activeUpload ? (
            <>Uploaded layout: <span className="font-medium text-slate-700">{activeUpload.name}</span></>
          ) : (
            <>
              {activeName ? <span className="font-medium text-slate-700">{activeName} · </span> : null}
              {layoutColumns.length} column{layoutColumns.length === 1 ? '' : 's'}: <span className="font-medium text-slate-700">{layoutColumns.map(c => c.label).join(', ')}</span>
            </>
          )}
        </p>
      )}
      {open && (
        <div className="mt-4 space-y-4">
          <TextOrImageToggle
            value={layoutMode === 'upload' ? 'image' : 'text'}
            onChange={selectLayoutMode}
            disabled={!persistenceConfigured || uploadSaving != null}
            textTitle="Create columns"
            textHint="Add, rename, reorder, or remove columns"
            imageTitle="Upload a layout"
            imageHint="A Word or Excel quotation you already use"
          />
          {layoutMode === 'create' && (
            <div className="space-y-4 rounded-xl border border-moss/20 bg-[#f7f9f7] p-4 ring-2 ring-blue-50">
              <ColumnBuilder columns={layoutColumns} setColumns={setLayoutColumns} />
              {savedLayouts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {savedLayouts.map(layout => (
                    <button
                      key={layout.id}
                      type="button"
                      onClick={() => {
                        setLayoutColumns(layout.columns)
                        setActiveId(layout.id)
                        setLayoutName(layout.name)
                        setMessage('')
                      }}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${layout.id === activeId ? 'border-moss bg-blue-50 text-moss' : 'border-sand bg-white text-slate-600 hover:border-moss hover:bg-blue-50'}`}
                    >
                      {layout.name}
                    </button>
                  ))}
                </div>
              )}
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
              {message && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-moss">{message}</p>}
              <div className="flex flex-wrap items-end gap-3">
                {naming ? (
                  <>
                    <label className="block text-sm">
                      <span className="mb-1.5 block font-medium text-slate-700">Layout name</span>
                      <input
                        autoFocus
                        value={layoutName}
                        onChange={e => setLayoutName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
                        placeholder="e.g. Flanges"
                        className="w-56 rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={saving || !persistenceConfigured || !layoutName.trim()}
                      onClick={handleSave}
                      className="rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => { setNaming(false); setError('') }}
                      className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={saving || !persistenceConfigured}
                    onClick={openNaming}
                    className="rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
                  >
                    Save column layout
                  </button>
                )}
                <button type="button" onClick={handleReset} disabled={saving} className="text-sm font-medium text-slate-500 hover:text-slate-700">
                  Reset to built-in default
                </button>
              </div>
            </div>
          )}
          {layoutMode === 'upload' && (
            <div className="space-y-3 rounded-xl border border-moss/20 bg-[#f7f9f7] p-4 ring-2 ring-blue-50">
              <p className="text-xs leading-5 text-slate-500">
                Our system will match its exact layout with formulas for all future quotation generations.
                Colours, quality, the name you give it, and bold text stay as they are in the file you upload.
              </p>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700">Layout name</span>
                <input
                  value={uploadName}
                  onChange={e => setUploadName(e.target.value)}
                  placeholder="e.g. Company quotation format"
                  className="w-full max-w-md rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50"
                />
              </label>
              <button
                type="button"
                disabled={!persistenceConfigured}
                onClick={() => onUploadNew?.(uploadName.trim())}
                className="rounded-xl border border-sand bg-white px-4 py-2.5 text-sm font-semibold text-moss hover:bg-blue-50 disabled:opacity-50"
              >
                Upload Word or Excel
              </button>
              {templates.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {templates.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={uploadSaving != null || !persistenceConfigured}
                      onClick={() => makeUploadDefault(t.id)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold ${activeUploadId === t.id ? 'border-moss bg-blue-50 text-moss' : 'border-sand bg-white text-slate-600 hover:border-moss hover:bg-blue-50'}`}
                    >
                      {uploadSaving === t.id ? 'Setting…' : t.name}
                    </button>
                  ))}
                </div>
              )}
              {activeUpload && (
                <p className="text-xs text-slate-500">Default uploaded layout: <span className="font-medium text-slate-700">{activeUpload.name}</span></p>
              )}
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A company's own quotation format — uploaded once via "Upload a layout",
 * where the app reads its structure (columns, letterhead, T&Cs) and turns it
 * into a reusable shell. Marking one "default" here means every new
 * quotation starts from it automatically, with a one-click way back to the
 * built-in QuoteGen layout.
 */
function DefaultLayoutPanel({ open, onToggle, profile, templates, persistenceConfigured, onSaved, onUnavailable, onUploadNew }) {
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')
  const activeId = profile?.defaultUploadTemplateId || null
  const activeTemplate = templates.find(t => t.id === activeId) || null

  const makeDefault = async (templateId) => {
    setSaving(templateId || 'default')
    setError('')
    try {
      const result = await saveCompanyProfile({ defaultUploadTemplateId: templateId })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      onSaved?.(result.profile)
    } catch (e) {
      setError(e.message || 'Could not set the default layout')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="rounded-3xl border border-sand bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Default quotation layout</h2>
          <p className="mt-1 text-xs text-slate-500">Upload your own quotation format once — we read its columns and letterhead and reuse it. Mark one as default so every new quotation starts from it.</p>
        </div>
        <button type="button" onClick={onToggle} className="text-sm font-medium text-moss">
          {open ? 'Hide' : 'Manage layouts'}
        </button>
      </div>
      {!persistenceConfigured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{SUPABASE_SETUP_HINT}</p>
      )}
      {persistenceConfigured && !open && (
        <p className="mt-3 text-sm text-slate-600">
          Default: <span className="font-medium text-slate-700">{activeTemplate ? activeTemplate.name : 'Built-in QuoteGen layout'}</span>
        </p>
      )}
      {open && (
        <div className="mt-4 space-y-3">
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => makeDefault(null)}
              disabled={saving != null || !persistenceConfigured}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${!activeId ? 'border-moss bg-blue-50 ring-2 ring-blue-50' : 'border-sand bg-white hover:border-moss/40'}`}
            >
              <p className="font-semibold text-slate-800">Built-in QuoteGen layout</p>
              <p className="text-[11px] text-slate-500">{saving === 'default' ? 'Setting…' : 'The default nested table layout'}</p>
            </button>
            {templates.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => makeDefault(t.id)}
                disabled={saving != null || !persistenceConfigured}
                className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${activeId === t.id ? 'border-moss bg-blue-50 ring-2 ring-blue-50' : 'border-sand bg-white hover:border-moss/40'}`}
              >
                <p className="font-semibold text-slate-800">{t.name}</p>
                <p className="text-[11px] text-slate-500">{saving === t.id ? 'Setting…' : `${t.type} layout`}</p>
              </button>
            ))}
          </div>
          {!templates.length && (
            <p className="text-sm text-slate-500">No layouts uploaded yet.</p>
          )}
          <button
            type="button"
            onClick={onUploadNew}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-moss hover:bg-blue-50"
          >
            + Upload a layout
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Step 10: named revisions.
 *
 * The quote on screen is always the current revision. "New revision" freezes
 * what the customer has right now as Rev N and moves the live quote to Rev N+1,
 * so every version you ever sent stays recoverable exactly as it was sent.
 */
function RevisionsPanel({ quoteId, currentRevision, persistenceConfigured, onRestored, onRevisionCreated, open, onToggle }) {
  const [revisions, setRevisions] = useState([])
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [expandedData, setExpandedData] = useState(null)

  const refresh = async () => {
    if (!quoteId || !persistenceConfigured) return
    setLoading(true)
    setError('')
    try {
      const result = await listRevisions(quoteId)
      if (result.unavailable) {
        setUnavailable(true)
        setRevisions([])
        return
      }
      setUnavailable(false)
      setRevisions(result.revisions)
    } catch (e) {
      setError(e.message || 'Could not load revisions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quoteId])

  const handleCreate = async () => {
    setCreating(true)
    setError('')
    setMessage('')
    try {
      const result = await createRevision(quoteId, label.trim())
      if (result.unavailable) {
        setUnavailable(true)
        setError(result.error || 'Revision history is not set up yet.')
        return
      }
      setLabel('')
      setMessage(`Rev ${result.frozenRevision} archived — you are now editing Rev ${result.revision}.`)
      onRevisionCreated?.(result.revision)
      await refresh()
    } catch (e) {
      setError(e.message || 'Could not create revision')
    } finally {
      setCreating(false)
    }
  }

  const handleView = async (rev) => {
    if (expanded === rev.id) {
      setExpanded(null)
      setExpandedData(null)
      return
    }
    setExpanded(rev.id)
    setExpandedData(null)
    try {
      const result = await getRevision(quoteId, rev.id)
      if (!result.unavailable) setExpandedData(result.revision?.data || {})
    } catch {
      /* keep the row expanded but empty */
    }
  }

  const handleRestore = async (rev) => {
    const ok = window.confirm(
      `Restore Rev ${rev.revision}?\n\nYour current work is archived as a new revision first, so nothing is lost.`
    )
    if (!ok) return
    setBusyId(rev.id)
    setError('')
    setMessage('')
    try {
      const result = await restoreRevision(quoteId, rev.id)
      if (result.unavailable) {
        setError(result.error || 'Could not restore.')
        return
      }
      setMessage(`Restored the contents of Rev ${result.restoredFrom}. You are on Rev ${result.revision}.`)
      onRestored?.(result.quotation)
      await refresh()
    } catch (e) {
      setError(e.message || 'Could not restore revision')
    } finally {
      setBusyId(null)
    }
  }

  const when = (iso) => {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch {
      return iso
    }
  }

  if (!quoteId || !open) return null

  return (
    <div className="no-print mb-4 rounded-2xl border border-sand bg-[#f7f9f7] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-700">
            Revisions
            <span className="ml-2 rounded-full bg-moss px-2 py-0.5 text-[11px] font-semibold text-white">
              Rev {currentRevision ?? 0}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Freeze what you sent, then keep editing. Every past revision stays viewable and restorable.
          </p>
        </div>
        <button type="button" onClick={onToggle} className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-moss hover:bg-blue-50">
          Done
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          {unavailable ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Revision history needs one migration:
              run <code className="font-mono text-xs">supabase/migrations/20260812140000_quotation_revisions.sql</code> in
              the Supabase SQL Editor, then reopen this quotation.
            </p>
          ) : (
            <>
              <div className="rounded-xl border border-dashed border-sand bg-white p-3">
                <p className="mb-2 text-xs font-medium text-slate-600">
                  Archive the current quote as Rev {currentRevision ?? 0} and start Rev {(currentRevision ?? 0) + 1}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                    placeholder="What changed? (optional, e.g. “Revised rates after call”)"
                    className="min-w-[12rem] flex-1 rounded-lg border border-sand px-2 py-1.5 text-sm outline-none focus:border-moss focus:ring-2 focus:ring-blue-50"
                  />
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating || !persistenceConfigured}
                    className="rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1558b0] disabled:opacity-40"
                  >
                    {creating ? 'Archiving…' : 'New revision'}
                  </button>
                </div>
              </div>

              {message && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-moss">{message}</p>}
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

              {loading && !revisions.length && <p className="text-sm text-slate-400">Loading revisions…</p>}
              {!loading && !revisions.length && (
                <p className="text-sm text-slate-500">
                  No earlier revisions yet. This quotation is still on its original Rev {currentRevision ?? 0}.
                </p>
              )}

              {revisions.length > 0 && (
                <ul className="divide-y divide-sand rounded-xl border border-sand bg-white">
                  {revisions.map(rev => (
                    <li key={rev.id} className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">
                            Rev {rev.revision}
                            {rev.label ? <span className="ml-2 font-normal text-slate-500">{rev.label}</span> : null}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {rev.number || 'No number'} · {rev.itemCount} item{rev.itemCount === 1 ? '' : 's'} · {when(rev.createdAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button type="button" onClick={() => handleView(rev)} className="rounded-lg border border-sand bg-white px-2.5 py-1 text-xs font-semibold text-moss hover:bg-blue-50">
                            {expanded === rev.id ? 'Hide' : 'View'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === rev.id}
                            onClick={() => handleRestore(rev)}
                            className="rounded-lg bg-moss px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
                          >
                            {busyId === rev.id ? 'Restoring…' : 'Restore'}
                          </button>
                        </div>
                      </div>

                      {expanded === rev.id && (
                        <div className="mt-2 rounded-lg bg-[#f7f9f7] p-2">
                          {!expandedData ? (
                            <p className="text-xs text-slate-400">Loading…</p>
                          ) : (
                            <>
                              <p className="mb-1 text-xs font-medium text-slate-600">{expandedData.title || 'Untitled'}</p>
                              <ul className="space-y-0.5">
                                {(expandedData.items || []).slice(0, 12).map((it, i) => (
                                  <li key={i} className="text-[11px] leading-relaxed text-slate-600">
                                    {i + 1}. {String(it.description || '').split('\n')[0] || '—'}
                                    {it.quantity ? ` · qty ${it.quantity}` : ''}
                                    {it.rate ? ` · rate ${it.rate}` : ''}
                                  </li>
                                ))}
                                {(expandedData.items || []).length > 12 && (
                                  <li className="text-[11px] text-slate-400">+{expandedData.items.length - 12} more…</li>
                                )}
                              </ul>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Click-to-rename a quotation table header. Print still shows the committed name. */
function QuoteColumnName({ col, editing, draft, onStart, onChange, onCommit, onCancel }) {
  if (editing) {
    return (
      <>
        <input
          value={draft}
          onChange={e => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          draggable={false}
          autoFocus
          aria-label={`Rename ${col.label}`}
          className="no-print relative z-10 max-w-[10rem] rounded border border-moss bg-white px-1 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-slate-700 outline-none"
        />
        <span className="qg-col-title qg-col-title--capture">{col.label}</span>
      </>
    )
  }
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onStart() }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      title="Click to rename"
      className="qg-col-title cursor-text"
    >
      {col.label}
    </span>
  )
}

const HEADER_TITLE_PX = 13

/** Pixel width needed to show an uppercase header title without clipping. */
function minWidthForHeaderLabel(label, chromePx = 54) {
  const text = String(label || '').trim()
  if (!text) return chromePx
  const perChar = HEADER_TITLE_PX * 0.82
  const tracking = HEADER_TITLE_PX * 0.04 * Math.max(0, text.length - 1)
  return Math.ceil(text.length * perChar + tracking + chromePx)
}

/** Column and paper geometry stay on this size so preview font changes do not stretch the page. */
const LAYOUT_FONT_PX = 14

function defaultWidthForColumn(col, fontPx = LAYOUT_FONT_PX) {
  const s = fontPx / LAYOUT_FONT_PX
  let content = Math.round(118 * s)
  if (col?.id === 'description') content = Math.round(248 * s)
  else if (isImageColumn(col)) content = Math.round(88 * s)
  else if (isAttachmentColumn(col)) content = Math.round(124 * s)
  else if (columnType(col) === 'hsn') content = Math.round(88 * s)
  else if (col?.id === 'unit') content = Math.round(72 * s)
  else if (col?.id === 'quantity') content = Math.round(120 * s)
  else if (col?.id === 'rate' || col?.id === 'amount') content = Math.round(148 * s)
  else if (isNestedColumn(col)) content = Math.round(86 * s)
  else if (columnType(col) === 'tax' || columnType(col) === 'discount') content = Math.round(100 * s)
  return Math.max(content, minWidthForHeaderLabel(col?.label))
}

function isCompactColumn(col) {
  if (!col) return false
  if (col.id === 'unit' || col.id === 'quantity' || col.id === 'rate' || col.id === 'amount') return true
  if (columnType(col) === 'hsn') return true
  if (isNestedColumn(col)) return true
  return false
}

function isNumericFitColumn(col) {
  if (!col) return false
  const id = String(col.id || '').toLowerCase()
  if (id === 'amount' || id === 'rate' || id === 'quantity' || id === 'qty') return true
  return isFormulaColumn(col)
}

function formattedNumericCell(raw, asMoney) {
  if (raw === '' || raw == null) return ''
  if (!asMoney) return String(raw)
  const n = Number(String(raw).replace(/,/g, ''))
  return Number.isFinite(n) ? formatIndianAmount(n) : String(raw)
}

function widthForNumericText(text, fontPx = LAYOUT_FONT_PX) {
  const chars = Math.max(String(text || '').length, 4)
  return Math.ceil(chars * fontPx * 0.74 + 40)
}

function contentWidthForNumericColumn(col, items, fontPx = LAYOUT_FONT_PX) {
  if (!isNumericFitColumn(col)) return 0
  const id = String(col.id || '').toLowerCase()
  const asMoney = id === 'amount' || id === 'rate' || isFormulaColumn(col)
  let longest = String(col.label || '')
  for (const item of items || []) {
    const shown = formattedNumericCell(item?.[col.id], asMoney)
    if (shown.length > longest.length) longest = shown
  }
  return widthForNumericText(longest, fontPx)
}

function QuoteEditor({ quote, quoteId, columns, update, updateQuote, total, totals, saveStatus = 'idle', onNew, onHome, onRetry, onRestored, onConvertToInvoice, companyProfile, persistenceConfigured, onColumnsChange, canUndo, canRedo, onUndo, onRedo, onFooterFitChange, seriesSyncedRef }) {
  const [autofilling, setAutofilling] = useState(false)
  const [autofillNote, setAutofillNote] = useState('')
  const [hsnNote, setHsnNote] = useState('')
  const [hsnBulkRunning, setHsnBulkRunning] = useState(false)
  const [hsnBulkProgress, setHsnBulkProgress] = useState(null)
  const [revisionsOpen, setRevisionsOpen] = useState(false)
  const [dockAddColumnOpen, setDockAddColumnOpen] = useState(false)
  const [dockNewColumnLabel, setDockNewColumnLabel] = useState('')
  const [dockNewColumnType, setDockNewColumnType] = useState('text')
  const [dockSpecialMode, setDockSpecialMode] = useState('percent')
  const [dockHsnDigits, setDockHsnDigits] = useState('4')
  const [formulaColId, setFormulaColId] = useState(null)
  const [dockWantFormula, setDockWantFormula] = useState(false)
  const addColBtnRef = useRef(null)
  const autoHsnSignatureRef = useRef('')
  const revisionsPanelRef = useRef(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceNote, setInvoiceNote] = useState('')
  const [invoicePromptOpen, setInvoicePromptOpen] = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceKindLabel, setInvoiceKindLabel] = useState('Sales Invoice')
  const [gstMissing, setGstMissing] = useState(false)
  const gstFieldRef = useRef(null)
  const [paperWidthMode, setPaperWidthMode] = useState('a4')
  const studioRef = useRef(null)
  const exportReadyRef = useRef(null)
  const [a4Pages, setA4Pages] = useState(() => defaultA4Pages(0))
  const [paperFontPx, setPaperFontPx] = useState(14)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saveFlash, setSaveFlash] = useState('')
  const [paperStyle, setPaperStyleLocal] = useState(quote.paperStyle || quote.companyProfile?.paperStyle || 'corporate')
  const [logoColorBusy, setLogoColorBusy] = useState(false)
  const [logoColorNote, setLogoColorNote] = useState('')
  const logoExtractedUrl = useRef('')
  const profile = companyProfile || quote.companyProfile || null
  const [historyQuotes, setHistoryQuotes] = useState([])
  const [catalogProducts, setCatalogProducts] = useState([])
  const suggestedFillSigRef = useRef('')

  const setPaperStyle = (id) => {
    setPaperStyleLocal(id)
    update(['paperStyle'], id)
  }

  const tableColorId = quote.tableColorId || 'blue'
  const chosenAccent = accentForTableColor(tableColorId, quote.logoPalette)
  const paperTheme = resolvePaperTheme(paperStyle, chosenAccent)

  const applyLogoPalette = (palette, colorId = tableColorId) => {
    const nextId = palette?.primary ? colorId : 'blue'
    updateQuote(q => ({
      ...q,
      logoPalette: palette || null,
      tableColorId: nextId,
      tableAccent: accentForTableColor(nextId, palette)
    }))
  }

  const detectColorsFromLogo = async (preferId) => {
    const url = profile?.logoUrl
    if (!url) {
      setLogoColorNote('Add a company logo first.')
      return null
    }
    setLogoColorBusy(true)
    setLogoColorNote('')
    try {
      const palette = await extractImagePalette(url)
      logoExtractedUrl.current = url
      if (!palette?.primary) {
        setLogoColorNote('No strong colour found in the logo.')
        return null
      }
      const nextId = preferId || (tableColorId === 'blue' ? 'logo-primary' : tableColorId)
      applyLogoPalette(palette, nextId)
      return palette
    } catch {
      setLogoColorNote('Could not read colours from this logo.')
      return null
    } finally {
      setLogoColorBusy(false)
    }
  }

  const setTableColor = async (id) => {
    if (id === 'blue') {
      updateQuote(q => ({ ...q, tableColorId: 'blue', tableAccent: DEFAULT_ACCENT }))
      setLogoColorNote('')
      return
    }
    if (quote.logoPalette?.primary) {
      applyLogoPalette(quote.logoPalette, id)
      return
    }
    await detectColorsFromLogo(id)
  }

  useEffect(() => {
    const url = profile?.logoUrl || ''
    if (!url || logoExtractedUrl.current === url) return
    let cancelled = false
    setLogoColorBusy(true)
    extractImagePalette(url)
      .then((palette) => {
        if (cancelled || !palette?.primary) return
        logoExtractedUrl.current = url
        updateQuote(q => {
          if (q.logoPalette?.primary === palette.primary && q.logoPalette?.secondary === palette.secondary) return q
          const nextId = q.tableColorId || 'blue'
          return {
            ...q,
            logoPalette: palette,
            tableAccent: accentForTableColor(nextId, palette)
          }
        })
        setLogoColorNote('')
      })
      .catch(() => {
        if (!cancelled) setLogoColorNote('Could not read colours from this logo.')
      })
      .finally(() => { if (!cancelled) setLogoColorBusy(false) })
    return () => { cancelled = true }
  }, [profile?.logoUrl])

  // Keep line Amount in sync with Tax/Discount columns (180 after discount → 216 with tax).
  useEffect(() => {
    let adaptedColumns = null
    updateQuote(q => {
      const synced = syncAmountFormula(q.columns || [], q.items || [])
      if (!synced.changed) return q
      adaptedColumns = synced.columns
      const next = structuredClone(q)
      next.columns = synced.columns
      next.items = recalcAllRows(synced.items, synced.columns)
      return next
    })
    if (adaptedColumns) onColumnsChange?.(adaptedColumns)
  }, [columnLayoutKey(quote.columns)])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      listQuotations(80).then(r => r.quotations || []).catch(() => []),
      listProducts().then(r => r.products || []).catch(() => [])
    ]).then(([quotes, products]) => {
      if (cancelled) return
      setHistoryQuotes(quotes)
      setCatalogProducts(products)
    })
    return () => { cancelled = true }
  }, [quoteId])

  const suggestClients = useMemo(() => clientsFromQuotations(historyQuotes), [historyQuotes])
  const suggestProducts = useMemo(
    () => productsFromHistory(historyQuotes, catalogProducts, quote.items),
    [historyQuotes, catalogProducts, quote.items]
  )

  useEffect(() => {
    suggestedFillSigRef.current = ''
  }, [quoteId])

  useEffect(() => {
    if (!SUGGESTED_COLUMN_ENABLED) {
      updateQuote(q => {
        if (!q) return q
        const nextColumns = withoutSuggestedColumns(q.columns?.length ? q.columns : columns)
        if (nextColumns.length === (q.columns || []).length) return q
        return { ...q, columns: nextColumns }
      })
      return
    }
    if (!catalogProducts.length) return
    const sig = `${quoteId || 'draft'}|${catalogProducts.map(p => p.key || p.description).join(',')}`
    if (suggestedFillSigRef.current === sig) return
    suggestedFillSigRef.current = sig
    updateQuote(q => {
      if (!q) return q
      const attached = attachSuggestedColumn(q.columns?.length ? q.columns : columns, q.items || [])
      const filled = fillSuggestedOnItems(attached.items, attached.columns, catalogProducts)
      const sameCols = attached.columns === q.columns
      const sameItems = filled.length === (q.items || []).length && filled.every((it, i) => it === q.items[i])
      if (sameCols && sameItems) return q
      return { ...q, columns: attached.columns, items: filled }
    })
  }, [quoteId, catalogProducts])

  const pickClient = (client) => {
    if (!client) return
    updateQuote(q => {
      const cur = q.customer || {}
      const shippingSame = cur.shippingSame !== false
      const shipList = Array.isArray(client.shippingAddresses) ? client.shippingAddresses.filter(Boolean) : []
      const next = {
        ...cur,
        company: client.company || cur.company || '',
        name: client.name || cur.name || '',
        gst: client.gst || cur.gst || '',
        location: client.location || cur.location || '',
        shippingSame,
        shippingLocation: cur.shippingLocation || '',
        shippingAddresses: shipList.length ? shipList : (cur.shippingAddresses || [])
      }
      if (!shippingSame && shipList.length && !String(cur.shippingLocation || '').trim()) {
        next.shippingLocation = shipList[0]
      }
      return { ...q, customer: next }
    })
  }

  const applyProductSuggestion = (rowIndex, product, typedColId) => {
    updateQuote(q => {
      const cols = q.columns || columns
      const items = Array.isArray(q.items) ? [...q.items] : []
      if (!items[rowIndex]) return q
      items[rowIndex] = recalcRow(applyProductToItem(items[rowIndex], cols, product, typedColId), cols)
      return { ...q, items }
    })
  }

  const isInvoice = (quote.docType || quote.doc_type) === 'invoice'
  const invoiceKindMeta = INVOICE_SERIES_TYPES.find(t => t.id === quote.invoiceKind)
  const docLabel = isInvoice ? (invoiceKindMeta?.label || 'TAX INVOICE').toUpperCase() : 'QUOTATION'

  const commitQuoteNumberSeries = async (number) => {
    if (isInvoice || !persistenceConfigured) return
    const result = await syncQuotationSeriesFromNumber(number, seriesSyncedRef?.current)
    if (result.synced) {
      if (seriesSyncedRef) seriesSyncedRef.current = result.number
    }
  }

  /**
   * Ask for the invoice number (prefilled from the series, but the user's to
   * change) and check the customer GSTIN, which a tax invoice cannot omit.
   */
  const openInvoicePrompt = async () => {
    setInvoiceNote('')
    setGstMissing(false)
    if (!String(quote.customer?.gst || '').trim()) {
      setGstMissing(true)
      setInvoiceNote('Add the customer GST number first — a sales invoice cannot be raised without it.')
      gstFieldRef.current?.focus()
      gstFieldRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    setInvoicePromptOpen(true)
    try {
      const res = await peekInvoiceSeries()
      if (!res.unavailable && res.peek?.number) setInvoiceNumber(res.peek.number)
      if (!res.unavailable && res.peek?.label) setInvoiceKindLabel(res.peek.label)
    } catch {
      // A suggestion is a convenience; the user can always type the number.
    }
  }

  const handleConvertToInvoice = async () => {
    setInvoiceNote('')
    const number = invoiceNumber.trim()
    if (!number) {
      setInvoiceNote('Enter the invoice number.')
      return
    }
    setInvoiceBusy(true)
    try {
      const result = await onConvertToInvoice?.({ number })
      if (result?.gstRequired) {
        setGstMissing(true)
        setInvoiceNote(result.error || 'A customer GST number is required.')
        gstFieldRef.current?.focus()
        return
      }
      if (result?.numberInUse) {
        setInvoiceNote(result.error || 'That invoice number is already used.')
        return
      }
      if (result?.error) {
        setInvoiceNote(result.error)
        return
      }
      setInvoicePromptOpen(false)
      if (result?.invoice?.number) setInvoiceNote(`${invoiceKindLabel} ${result.invoice.number} created.`)
    } catch (e) {
      setInvoiceNote(e.message || 'Could not create the invoice')
    } finally {
      setInvoiceBusy(false)
    }
  }

  /** PDF = Chrome print (untouched). Excel = live preview pages + Items. Word = editable HTML. */
  const handleExport = async (kind) => {
    setPdfBusy(true)
    setPdfNote('')
    try {
      if (kind === 'word') {
        downloadQuotationWord({ quote, profile, columns, totals: quoteTotals, theme: paperTheme, docLabel })
        return
      }
      if (kind === 'excel') {
        await downloadQuotationExcel({ quote, profile, columns, totals: quoteTotals, theme: paperTheme, docLabel })
        return
      }
      await downloadQuotationPdf(quotationFileName(quote, 'pdf'))
    } catch (error) {
      if (kind === 'pdf' || !kind) {
        setPdfNote(`Could not build the PDF — ${error.message}`)
      } else {
        setPdfNote(`Could not export ${kind === 'word' ? 'Word' : 'Excel'} — ${error.message}.`)
      }
    } finally {
      setPdfBusy(false)
    }
  }

  const items = quote.items || []

  const patchItem = (rowIndex, patchFn) => {
    updateQuote(q => {
      const list = Array.isArray(q.items) ? q.items : []
      return { ...q, items: list.map((item, i) => (i === rowIndex ? patchFn(item) : item)) }
    })
  }

  const updateItem = (i, key, val) => {
    patchItem(i, (current) => {
      const fill = current._knowledgeFill
      const hsnFill = current._hsnGstFill
      let next = { ...current, [key]: val }
      if (fill?.fields?.includes(key)) {
        const nextFields = fill.fields.filter(f => f !== key)
        next._knowledgeFill = nextFields.length ? { ...fill, fields: nextFields } : null
      }
      if (hsnFill?.fields?.includes(key)) {
        const nextFields = hsnFill.fields.filter(f => f !== key)
        next._hsnGstFill = nextFields.length ? { ...hsnFill, fields: nextFields } : null
      }
      const nested = nestedFieldInfo(columns, key)
      if (nested) next[sourceKey(nested.col)] = nested.part
      Object.assign(next, amountEditPatch(next, columns, key, val))
      Object.assign(next, formulaEditPatch(next, columns, key, val) || {})
      return recalcRow(next, columns, { editingKey: key })
    })
  }

  const revertAmount = (i, col) => {
    if (col && isFormulaColumn(col)) {
      update(['items', i], clearFormulaOverride(items[i] || {}, col, columns))
      return
    }
    update(['items', i], clearAmountOverride(items[i] || {}, columns))
  }
  const refreshAmount = (i) => update(['items', i], recalcRow(items[i] || {}, columns))

  const setImageCell = (rowIndex, col, url, path) => {
    const pathKey = imagePathKey(col)
    const editKey = imageEditKey(col)
    patchItem(rowIndex, (current) => {
      const previousPath = current[pathKey]
      if (previousPath && previousPath !== path) deleteQuoteImage(previousPath)
      const next = { ...current, [col.id]: url || '' }
      if (path) next[pathKey] = path
      else delete next[pathKey]
      delete next[editKey]
      return next
    })
  }

  const setAttachmentCell = (rowIndex, col, { name = '', url = '', path = null } = {}) => {
    const current = items[rowIndex] || {}
    const pathKey = imagePathKey(col)
    const urlKey = attachmentUrlKey(col)
    const previousPath = current[pathKey]
    if (previousPath && previousPath !== path) deleteQuoteImage(previousPath)
    const next = { ...current, [col.id]: name || '' }
    if (url) next[urlKey] = url
    else delete next[urlKey]
    if (path) next[pathKey] = path
    else delete next[pathKey]
    update(['items', rowIndex], next)
  }

  const setItems = (nextItems) => update(['items'], nextItems)
  const addItem = () => setItems([...items, blankItem(columns)])
  const removeItem = i => setItems(items.filter((_, index) => index !== i))
  const extraLines = Array.isArray(quote.extraLines) ? quote.extraLines : []
  const setExtraLines = (next) => update(['extraLines'], next)
  const addExtraLine = (line) => setExtraLines([...extraLines, line || blankExtraLine()])
  const updateExtraLine = (i, patch) => setExtraLines(extraLines.map((row, index) => (index === i ? { ...row, ...patch } : row)))
  const removeExtraLine = (i) => setExtraLines(extraLines.filter((_, index) => index !== i))
  // Drag a row by its Sr. No. cell to drop it into a new position — replaces
  // the old one-at-a-time ↑+ "insert above" click with a direct move.
  const [dragRowIndex, setDragRowIndex] = useState(null)
  const [dropRowIndex, setDropRowIndex] = useState(null)
  const moveItem = (from, to) => {
    if (from == null || to == null || from === to) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setItems(next)
  }

  /**
   * Column edits must land in both the app-level column state and the saved quote JSON.
   *
   * `mutate` reads/writes columns and items from *inside* the functional setQuote
   * updater — never the `columns`/`items` props — so that rapid-fire edits (several
   * quick-add clicks landing in the same React batch) each apply on top of the
   * previous one instead of all reading the same stale snapshot and silently
   * clobbering each other down to whichever one happened to commit last.
   */
  const mutateColumns = (mutate) => {
    let latestColumns = columns
    updateQuote(q => {
      const currentColumns = q.columns || []
      const currentItems = q.items || []
      const result = mutate(currentColumns, currentItems) || {}
      const synced = syncAmountFormula(result.columns || currentColumns, result.items || currentItems)
      const nextColumns = synced.columns
      const needsRecalc = synced.changed
        || nextColumns.some(c => columnType(c) === 'tax' || columnType(c) === 'discount')
        || nextColumns.some(isFormulaColumn)
      const nextItems = needsRecalc ? recalcAllRows(synced.items, nextColumns) : synced.items
      latestColumns = nextColumns
      const next = structuredClone(q)
      next.columns = nextColumns
      next.items = nextItems
      return next
    })
    onColumnsChange?.(latestColumns)
  }

  const addColumn = (label, type, { openFormula, mode, digits } = {}) => {
    const trimmed = String(label || '').trim()
    if (!trimmed) return
    let added = null
    const resolvedType = type === 'formula' ? 'text' : type
    const taxMode = (mode === 'amount' || mode === 'percent') ? mode : dockSpecialMode
    const hsnLen = (digits === '8' || digits === '4') ? digits : dockHsnDigits
    mutateColumns((cols, its) => {
      const options = {}
      if (resolvedType === 'tax' || resolvedType === 'discount') options.mode = taxMode
      if (resolvedType === 'hsn') options.digits = hsnLen
      const col = makeTypedColumn(trimmed, resolvedType, cols, options)
      if (type === 'formula' || openFormula) col.calculated = true
      const shouldGuess = openFormula || type === 'formula'
      const formula = formulaForAddedColumn(col, [...cols, col], { guessTokens: shouldGuess })
      if (formula) col.formula = formula
      added = col
      return { columns: insertTypedColumns(cols, [col]), items: its.map(item => withColumnKeys(item, col)) }
    })
    if ((openFormula || type === 'formula') && added && canHaveFormula(added, [...columns, added])) setFormulaColId(added.id)
  }

  const saveColumnFormula = (colId, formula) => {
    mutateColumns((cols, its) => {
      const nextColumns = cols.map(c => {
        if (c.id !== colId) return c
        const next = { ...c }
        if (formula) {
          next.formula = formula
          const amountCol = findFieldColumn(cols, 'amount')
          if (!amountCol || c.id !== amountCol.id) next.calculated = true
        } else {
          delete next.formula
        }
        return next
      })
      return { columns: nextColumns, items: recalcAllRows(its, nextColumns) }
    })
    setFormulaColId(null)
  }

  const resizeImageColumn = (colId, width) => {
    const w = Math.max(32, Math.min(320, Math.round(Number(width) || 96)))
    mutateColumns((cols) => ({ columns: cols.map(c => (c.id === colId ? { ...c, imageWidth: w } : c)) }))
  }

  const updateList = (key, raw) => update([key], raw.split('\n').filter(Boolean))
  const quoteTotals = totals || computeQuoteTotals(items, columns, extraLines)
  const hasNested = columns.some(isNestedColumn)
  const hasAmount = columns.some(c => c.id === 'amount') || hasNested
  const kbFilled = (quote.items || []).filter(i => i?._knowledgeFill?.fields?.length).length

  /**
   * Same column-width assumption as the table's own minWidth (180 + 120px per
   * column unit, nested tax/discount counting double), scaled by the chosen
   * font size, against A4's usable print width after margins (~718px at
   * 96dpi with 10mm sides). This is an estimate, not a layout measurement —
   * good enough to warn before export, not to promise pixel-perfect fit.
   */
  const A4_PRINTABLE_PX = 718

  const runAutofill = async () => {
    if (!persistenceConfigured) {
      setAutofillNote('Configure Supabase to use knowledge autofill.')
      return
    }
    setAutofilling(true)
    setAutofillNote('')
    try {
      const result = await autofillFromKnowledge(quote.items || [], columns)
      if (result.unavailable) {
        setAutofillNote('Knowledge base unavailable.')
        return
      }
      // Knowledge can fill a Rate, so the Amount that hangs off it must follow.
      update(['items'], recalcAllRows(result.items, columns))
      const n = result.fills?.length || 0
      setAutofillNote(n ? `Filled ${n} row${n === 1 ? '' : 's'} from knowledge base.` : 'No confident matches in the knowledge base.')
    } catch (e) {
      setAutofillNote(e.message || 'Autofill failed')
    } finally {
      setAutofilling(false)
    }
  }

  const onDescriptionBlur = async (rowIndex) => {
    updateQuote(q => {
      const cols = q.columns || columns
      const items = Array.isArray(q.items) ? [...q.items] : []
      if (!items[rowIndex]) return q
      const filled = fillSuggestedOnItems([items[rowIndex]], cols, catalogProducts)[0]
      if (filled === items[rowIndex]) return q
      items[rowIndex] = recalcRow(filled, cols)
      return { ...q, items }
    })
    if (!persistenceConfigured) return
    const item = quote.items?.[rowIndex]
    if (!item) return
    try {
      const result = await autofillFromKnowledge([item], columns)
      if (result.unavailable || !result.fills?.length) return
      update(['items', rowIndex], recalcRow(result.items[0], columns))
    } catch {
      /* silent on blur */
    }
  }

  /** Every row missing HSN/GST data, one lookup at a time. */
  const fetchHsnGstBulk = async () => {
    if (hsnBulkRunning) return
    if (!persistenceConfigured) {
      setHsnNote('Configure Supabase to use HSN/GST lookup.')
      return
    }
    const nextColumns = ensureHsnGstColumns(columns)
    if (nextColumns !== columns) {
      onColumnsChange?.(nextColumns)
      update(['columns'], nextColumns)
    }
    const hsnCol = nextColumns.find(c => !isNestedColumn(c) && !isImageColumn(c) && (/hsn|sac/i.test(c.id) || /hsn|sac/i.test(c.label)))
    const percentTaxCols = nextColumns.filter(c => columnType(c) === 'tax' && isNestedColumn(c))
    const items = quote.items || []
    const pending = items
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => {
        const desc = String(item.description || item[nextColumns[0]?.id] || '').split('\n')[0].trim()
        const hasHsn = hsnCol && String(item[hsnCol.id] || '').trim()
        const missingTaxRate = percentTaxCols.some(col => !String(item?.[rateKey(col)] || '').trim())
        return desc && (!hasHsn || missingTaxRate)
      })
    if (!pending.length) {
      setHsnNote('Every row already has an HSN code.')
      return
    }
    setHsnBulkRunning(true)
    setHsnBulkProgress({ done: 0, total: pending.length })
    let filled = 0
    for (const { item, i } of pending) {
      const desc = String(item.description || item[nextColumns[0]?.id] || '').split('\n')[0].trim()
      try {
        const result = await lookupHsnGst({ item, columns: nextColumns, description: desc })
        if (!result.unavailable) {
          let nextItem = result.item || item
          if (hsnCol && nextItem[hsnCol.id]) {
            const maxDigits = getHsnDigits(hsnCol) === '8' ? 8 : 4
            const digits = String(nextItem[hsnCol.id]).replace(/\D/g, '').slice(0, maxDigits)
            if (digits) nextItem = { ...nextItem, [hsnCol.id]: digits }
          }
          update(['items', i], recalcRow(nextItem, nextColumns))
          filled++
        }
      } catch {
        /* one bad row shouldn't stop the rest of the batch */
      }
      setHsnBulkProgress(p => ({ done: (p?.done || 0) + 1, total: pending.length }))
    }
    setHsnBulkRunning(false)
    setHsnBulkProgress(null)
    setHsnNote(`Fetched HSN/GST for ${filled} of ${pending.length} row${pending.length === 1 ? '' : 's'} missing it.`)
  }

  useEffect(() => {
    if (!persistenceConfigured || hsnBulkRunning) return
    const hsnCol = columns.find(c => columnType(c) === 'hsn' || (!isNestedColumn(c) && !isImageColumn(c) && (/hsn|sac/i.test(c.id) || /hsn|sac/i.test(c.label))))
    if (!hsnCol) return
    const percentTaxCols = columns.filter(c => columnType(c) === 'tax' && isNestedColumn(c))
    const missing = (quote.items || [])
      .map((item, i) => {
        const desc = String(item?.description || item?.[columns[0]?.id] || '').split('\n')[0].trim()
        const hasHsn = String(item?.[hsnCol.id] || '').trim()
        const missingTaxRate = percentTaxCols.some(col => !String(item?.[rateKey(col)] || '').trim())
        return desc && (!hasHsn || missingTaxRate) ? `${i}:${desc}` : null
      })
      .filter(Boolean)
    if (!missing.length) return
    const signature = `${profile?.hsnCodeFormat || '4'}::${columns.map(c => `${c.id}:${columnType(c)}:${columnMode(c)}:${getHsnDigits(c)}`).join('|')}::${missing.join('|')}`
    if (autoHsnSignatureRef.current === signature) return
    autoHsnSignatureRef.current = signature
    fetchHsnGstBulk()
  }, [columns, quote.items, persistenceConfigured, hsnBulkRunning, profile?.hsnCodeFormat])

  // "+ Column" in the dock: same five typed columns as the full manager, added
  // right from the bottom bar — no scrolling up to reach them.
  const quickAddColumnFromDock = (option, extras = {}) => {
    const taken = new Set(columns.map(c => c.label.toLowerCase()))
    let label = option.defaultLabel
    let n = 2
    while (taken.has(label.toLowerCase())) label = `${option.defaultLabel} ${n++}`
    addColumn(label, option.type, extras)
    setDockAddColumnOpen(false)
  }

  const submitDockNewColumn = () => {
    if (!dockNewColumnLabel.trim()) return
    addColumn(dockNewColumnLabel, dockNewColumnType, {
      openFormula: dockNewColumnType === 'formula' || dockWantFormula
    })
    setDockNewColumnLabel('')
    setDockWantFormula(false)
    setDockAddColumnOpen(false)
  }

  // Column headers stopped having any remove affordance once the old column
  // manager panel was removed — this brings it back as a hover-reveal button
  // on the header itself, using the same stable-id resolution + mutateColumns
  // pattern the rest of the column mutators already rely on.
  const removeColumn = (colId) => {
    if (formulaColId === colId) setFormulaColId(null)
    mutateColumns((cols, its) => {
      const nextColumns = cols.filter(c => c.id !== colId)
      const nextItems = its.map(item => {
        const next = { ...item }
        delete next[colId]
        delete next[`${colId}__rate`]
        delete next[`${colId}__amount`]
        delete next[`${colId}__src`]
        delete next[`${colId}__path`]
        return next
      })
      return { columns: nextColumns, items: nextItems }
    })
  }

  // Drag a column header onto another column's header to swap the two —
  // the simplest possible "replace this column with that one" gesture for
  // someone who has never used a spreadsheet's column-reorder before.
  const [dragColId, setDragColId] = useState(null)
  const [dropColId, setDropColId] = useState(null)
  const [editingColId, setEditingColId] = useState(null)
  const [editColLabel, setEditColLabel] = useState('')
  const skipRenameCommit = useRef(false)

  const startRenameColumn = (col) => {
    skipRenameCommit.current = false
    setEditingColId(col.id)
    setEditColLabel(col.label)
  }

  const cancelRenameColumn = () => {
    skipRenameCommit.current = true
    setEditingColId(null)
  }

  const commitRenameColumn = () => {
    if (skipRenameCommit.current) {
      skipRenameCommit.current = false
      return
    }
    const colId = editingColId
    const trimmed = editColLabel.trim()
    setEditingColId(null)
    if (!colId || !trimmed) return
    mutateColumns((cols) => {
      if (cols.some(c => c.id !== colId && c.label.toLowerCase() === trimmed.toLowerCase())) {
        return { columns: cols }
      }
      return { columns: cols.map(c => (c.id === colId ? { ...c, label: trimmed } : c)) }
    })
  }

  const swapColumns = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    mutateColumns((cols) => {
      const from = cols.findIndex(c => c.id === fromId)
      const to = cols.findIndex(c => c.id === toId)
      if (from === -1 || to === -1) return { columns: cols }
      const nextColumns = [...cols]
      ;[nextColumns[from], nextColumns[to]] = [nextColumns[to], nextColumns[from]]
      return { columns: nextColumns }
    })
  }

  // Drag a column's right edge to resize it, like a spreadsheet. Widths are
  // per-column (nested tax/discount columns get separate rate/amount widths)
  // and only override the default once the user actually drags. Geometry stays
  // on LAYOUT_FONT_PX so changing preview font size does not stretch the page.
  const [columnWidths, setColumnWidths] = useState({})
  const resizeStateRef = useRef(null)
  const imageFitRef = useRef({})
  const defaultColWidthForKey = (key) => {
    const col = columns.find(c => c.id === key || `${c.id}__rate` === key)
    return col ? defaultWidthForColumn(col, LAYOUT_FONT_PX) : Math.max(60, Math.round(110 * (LAYOUT_FONT_PX / 14)))
  }
  const getColWidthRaw = (key) => columnWidths[key] || defaultColWidthForKey(key)
  const fitImageColumn = (colId, rowIndex, contentWidth) => {
    const slot = `${colId}:${rowIndex}`
    if (contentWidth > 0) imageFitRef.current[slot] = contentWidth
    else delete imageFitRef.current[slot]
    const col = columns.find(c => c.id === colId)
    const floor = col ? defaultWidthForColumn(col, LAYOUT_FONT_PX) : 80
    let max = 0
    for (const [key, w] of Object.entries(imageFitRef.current)) {
      if (key.startsWith(`${colId}:`)) max = Math.max(max, Number(w) || 0)
    }
    const next = Math.max(floor, Math.ceil(max + 14))
    setColumnWidths(prev => (prev[colId] === next ? prev : { ...prev, [colId]: next }))
  }
  const beginColumnResize = (e, key) => {
    e.preventDefault()
    e.stopPropagation()
    resizeStateRef.current = { key, startX: e.clientX, startWidth: getColWidthRaw(key) }
    const onMove = (ev) => {
      const state = resizeStateRef.current
      if (!state) return
      const next = Math.max(48, state.startWidth + (ev.clientX - state.startX))
      setColumnWidths(prev => ({ ...prev, [state.key]: next }))
    }
    const onUp = () => {
      resizeStateRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const SR_NO_COL_WIDTH = minWidthForHeaderLabel('Sr. No.', 22)
  const ROW_ACTIONS_COL_WIDTH = 40
  const getColWidth = (key) => {
    const base = getColWidthRaw(key)
    const col = columns.find(c => c.id === key || `${c.id}__rate` === key)
    return Math.max(base, contentWidthForNumericColumn(col, items, LAYOUT_FONT_PX))
  }
  const tableTotalWidthPx = SR_NO_COL_WIDTH + ROW_ACTIONS_COL_WIDTH + columns.reduce((sum, col) => (
    sum + getColWidth(isNestedColumn(col) ? `${col.id}__rate` : col.id)
  ), 0)
  const paperWidthPx = A4_WIDTH_PX
  const tableFitZoom = Math.min(1, A4_PRINTABLE_PX / Math.max(1, tableTotalWidthPx - ROW_ACTIONS_COL_WIDTH))
  const tableFitsPaper = tableTotalWidthPx + 24 <= paperWidthPx
  // "Shrink font" only helps columns still at their default (font-scaled)
  // width — a column the user has manually dragged to a fixed pixel width no
  // longer shrinks with the font, so it's excluded from the estimate below.
  let a4FixedWidthPx = SR_NO_COL_WIDTH + ROW_ACTIONS_COL_WIDTH
  let a4ScalableUnits = 0
  for (const col of columns) {
    const keys = [isNestedColumn(col) ? `${col.id}__rate` : col.id]
    for (const key of keys) {
      if (columnWidths[key]) a4FixedWidthPx += columnWidths[key]
      else a4ScalableUnits += 1
    }
  }
  const overflowsA4 = paperWidthMode === 'a4' && tableTotalWidthPx > A4_PRINTABLE_PX
  const canShrinkToFitA4 = a4ScalableUnits > 0 && (A4_PRINTABLE_PX - a4FixedWidthPx) / a4ScalableUnits >= 8 * 14 / 120
  const suggestedFitFontPx = a4ScalableUnits > 0
    ? Math.max(8, Math.min(paperFontPx - 1, Math.floor(14 * (A4_PRINTABLE_PX - a4FixedWidthPx) / (a4ScalableUnits * 120))))
    : paperFontPx
  const ColumnResizeHandle = ({ colKey }) => (
    <span
      data-resize-handle="true"
      draggable={false}
      onMouseDown={(e) => beginColumnResize(e, colKey)}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize this column"
      aria-label="Drag to resize this column"
      className="qg-col-resizer no-print"
    />
  )

  const pagePlan = normalizeA4Pages(a4Pages, items.length)
  const customer = quote?.customer || {}
  // Structural packing only — never remasure on every keystroke (that was the typing lag).
  const layoutSignature = [
    items.length,
    columns.map(c => c.id).join('|'),
    paperFontPx,
    paperWidthPx,
    JSON.stringify(columnWidths),
    extraLines.length,
    profile?.headerImageUrl ? 'h' : '',
    profile?.footerImageUrl ? 'f' : '',
    profile?.footerFit ? JSON.stringify(normalizeFooterFit(profile.footerFit)) : '',
    profile?.standardTerms || '',
    paperStyle,
    hasAmount ? 'amt' : '',
    String(tableFitZoom),
    customer.shippingSame === false ? 'ship' : 'same'
  ].join('::')
  // Content height can change as text wraps — refresh packing after typing settles.
  const contentSignature = [
    items.map(it => `${String(it.description || '').length}:${Object.keys(it).length}`).join(','),
    (quote.notes || []).join('\n').length,
    Object.values(quote.terms || {}).map(v => (v == null ? '' : typeof v === 'string' ? v : String(v))).join('|').length,
    String(customer.location || '').length,
    String(customer.shippingLocation || '').length,
    String(quote.title || '').length,
    String(customer.company || '').length
  ].join('::')

  const runA4Pack = () => {
    const root = studioRef.current
    if (!root) return false
    const measured = measureA4Blocks(root)
    measured.rowHeights = Array.from({ length: items.length }, (_, i) => measured.rowHeights[i] || 36)
    const next = packA4Pages({
      rowCount: items.length,
      ...measured,
      totalsHeight: hasAmount ? measured.totalsHeight : 0
    })
    if (!pagesEqual(next, normalizeA4Pages(a4Pages, items.length))) {
      setA4Pages(next)
      return true
    }
    return false
  }

  useLayoutEffect(() => {
    if (runA4Pack()) return undefined
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => exportReadyRef.current?.())
    })
    return () => cancelAnimationFrame(frame)
  }, [layoutSignature, items.length, hasAmount, a4Pages])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (runA4Pack()) return
      exportReadyRef.current?.()
    }, 180)
    return () => window.clearTimeout(timer)
  }, [contentSignature, layoutSignature, items.length, hasAmount])

  const flashSave = (msg) => {
    setSaveFlash(msg)
    setTimeout(() => setSaveFlash(''), 2500)
  }

  // "Commands" menu — quick structural actions on the whole quotation, distinct
  // from per-row edits. Remove GST is a plain deletion; the other three write
  // sensible, deterministic defaults rather than calling AI, so they're free
  // and instant.
  const runCommandRemoveGst = () => {
    const taxCols = columns.filter(c => columnType(c) === 'tax')
    if (!taxCols.length) { flashSave('No GST/Tax column to remove.'); return }
    mutateColumns((cols, its) => {
      const removeIds = new Set(taxCols.map(c => c.id))
      const nextColumns = cols.filter(c => !removeIds.has(c.id))
      const nextItems = its.map(item => {
        const next = { ...item }
        for (const id of removeIds) {
          delete next[id]; delete next[`${id}__rate`]; delete next[`${id}__amount`]; delete next[`${id}__src`]
        }
        return next
      })
      return { columns: nextColumns, items: nextItems }
    })
    flashSave('GST/Tax column removed.')
    setCommandsOpen(false)
  }

  const runCommandAddSpecifications = () => {
    addColumn('Specification', 'text')
    flashSave('Added a Specification column.')
    setCommandsOpen(false)
  }

  const runCommandApplyCompanyTerms = () => {
    const merged = { ...quote.terms }
    let changed = false
    for (const [key, val] of Object.entries(defaultTerms)) {
      if (!String(merged[key] || '').trim()) { merged[key] = val; changed = true }
    }
    if (!changed) { flashSave('Commercial terms are already filled in.'); setCommandsOpen(false); return }
    update(['terms'], merged)
    flashSave('Filled in blank commercial terms with standard defaults.')
    setCommandsOpen(false)
  }

  const runCommandConvertToExportFormat = () => {
    mutateColumns((cols, its) => {
      const hsnCol = cols.find(c => !isNestedColumn(c) && !isImageColumn(c) && (/hsn|sac/i.test(c.id) || /hsn|sac/i.test(c.label)))
      let nextColumns = cols
      if (hsnCol) {
        nextColumns = cols.map(c => (c.id === hsnCol.id ? { ...c, label: 'HS Code' } : c))
      }
      const hasOrigin = nextColumns.some(c => /country.*origin|origin/i.test(c.label))
      if (!hasOrigin) {
        const col = makeTypedColumn('Country of Origin', 'text', nextColumns)
        nextColumns = [...nextColumns, col]
        return { columns: nextColumns, items: its.map(item => withColumnKeys(item, col)) }
      }
      return { columns: nextColumns }
    })
    const exportNote = 'Export shipment — confirm Incoterms, currency and country of origin before sending.'
    if (!(quote.notes || []).includes(exportNote)) {
      update(['notes'], [...(quote.notes || []), exportNote])
    }
    flashSave('Converted to export format — HS Code, Country of Origin, and an export note added.')
    setCommandsOpen(false)
  }

  return <main className="min-h-screen bg-[#F4F6FA] text-ink print:bg-white">
    <nav className="no-print sticky top-0 z-50 border-b border-sand bg-white/95 backdrop-blur">
      <div className="flex w-full items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onHome}
            title="Back to home"
            className="flex items-center gap-1.5 rounded-lg border border-sand px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span className="hidden sm:inline">Back</span>
          </button>
          <Brand onClick={onHome} />
        </div>
      </div>
    </nav>

  <div className="no-print mx-auto px-4 pt-4 sm:px-6" style={{ maxWidth: Math.max(900, paperWidthPx + 56) }}>
    <QuoteStudioToolbar
      docLabel={docLabel}
      paperStyle={paperStyle}
      onPaperStyleChange={setPaperStyle}
      paperFontPx={paperFontPx}
      onFontChange={setPaperFontPx}
      tableColorId={tableColorId}
      logoPalette={quote.logoPalette}
      logoUrl={profile?.logoUrl}
      logoColorBusy={logoColorBusy}
      logoColorNote={logoColorNote}
      onTableColorChange={setTableColor}
      onDetectFromLogo={() => detectColorsFromLogo()}
      saveFlash={saveFlash}
      saveStatusLabel={saveStatusLabel(saveStatus)}
      onSaveFlash={() => flashSave(saveStatusLabel(saveStatus))}
      onExport={handleExport}
      pdfBusy={pdfBusy}
    />

    {advancedOpen && (
      <div className="qg-advanced-panel">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onUndo} disabled={!canUndo} className="rounded-lg border border-sand px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Undo</button>
          <button type="button" onClick={onRedo} disabled={!canRedo} className="rounded-lg border border-sand px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Redo</button>
          <button type="button" onClick={onRetry} className="rounded-lg border border-sand px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Retry AI</button>
          <button type="button" disabled={autofilling} onClick={runAutofill} className="rounded-lg border border-sand px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">{autofilling ? 'Matching…' : 'Autofill rates'}</button>
          <button type="button" onClick={fetchHsnGstBulk} disabled={hsnBulkRunning} className="rounded-lg border border-sand px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
            {hsnBulkRunning ? `HSN ${hsnBulkProgress?.done ?? 0}/${hsnBulkProgress?.total ?? 0}` : 'Fetch all HSN'}
          </button>
          <button type="button" onClick={() => setRevisionsOpen(o => !o)} className="rounded-lg border border-sand px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">{revisionsOpen ? 'Hide versions' : 'Versions'}</button>
          {!isInvoice && (
            <button
              type="button"
              onClick={openInvoicePrompt}
              disabled={invoiceBusy || !persistenceConfigured}
              className="rounded-lg border border-sand px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Convert to invoice
            </button>
          )}
          <div className="flex items-center gap-0.5 rounded-xl bg-[#f0f2f6] p-1">
            <button type="button" onClick={() => setPaperWidthMode('a4')} className={`rounded-lg px-2 py-1 text-xs font-semibold ${paperWidthMode === 'a4' ? 'bg-white text-moss shadow-sm' : 'text-slate-500'}`}>A4</button>
            <button type="button" onClick={() => setPaperWidthMode('wide')} className={`rounded-lg px-2 py-1 text-xs font-semibold ${paperWidthMode === 'wide' ? 'bg-white text-moss shadow-sm' : 'text-slate-500'}`}>Wide</button>
          </div>
        </div>
        {(autofillNote || hsnNote) && <p className="mt-3 text-xs text-slate-500">{hsnNote || autofillNote}</p>}
        {pdfNote && <p className="mt-2 text-xs text-rose-600">{pdfNote}</p>}
        <div ref={revisionsPanelRef} className="mt-3">
          <RevisionsPanel
            quoteId={quoteId}
            currentRevision={quote.revision}
            persistenceConfigured={persistenceConfigured}
            onRestored={onRestored}
            onRevisionCreated={(next) => update(['revision'], next)}
            open={revisionsOpen}
            onToggle={() => setRevisionsOpen(o => !o)}
          />
        </div>
      </div>
    )}

    {overflowsA4 && advancedOpen && (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
        <span>⚠️ Table wider than A4 at {paperFontPx}px.</span>
        {canShrinkToFitA4 && (
          <button type="button" onClick={() => setPaperFontPx(suggestedFitFontPx)} className="ml-auto rounded-lg bg-black px-3 py-1 text-xs font-semibold text-white">
            Shrink to {suggestedFitFontPx}px
          </button>
        )}
      </div>
    )}
  </div>

    <div ref={studioRef}>
    <QuoteStudioCanvas
      themeId={paperStyle}
      tableAccent={chosenAccent}
      fontSizePx={paperFontPx}
      paperWidthPx={paperWidthPx}
      lockA4={true}
      runningHeader={{
        left: profile?.companyName?.trim() || 'Quotation',
        right: [quote.number, quote.date].filter(Boolean).join(' · ')
      }}
      runningFooter={{
        left: profile?.companyName?.trim() ? `For ${profile.companyName.trim()}` : 'QuoteGen',
        right: quote.number ? `Quotation ${quote.number}` : 'Continued'
      }}
    >
      {pagePlan.map((page, pageIndex) => (
      <section key={pageIndex} className="qg-page-section">
        {page.showHeader ? (
        <div data-qg-block="header">
        <QuotePaperHeader
        theme={paperTheme}
        profile={profile}
        quote={quote}
        update={update}
        docLabel={docLabel}
        isInvoice={isInvoice}
        onNumberCommit={commitQuoteNumberSeries}
      />
        </div>
        ) : null}
        {page.showMeta ? (
        <div data-qg-block="meta">
      <QuoteToSubjectBlock
        theme={paperTheme}
        quote={quote}
        update={update}
        gstMissing={gstMissing}
        gstFieldRef={gstFieldRef}
        isInvoice={isInvoice}
        onGstChange={() => setGstMissing(false)}
        clients={suggestClients}
        onPickClient={pickClient}
      />
        </div>
        ) : null}
      {(page.showHeader || page.rows.length > 0 || page.showTotals) ? (
      <div className="qg-paper-body">
        {page.showHeader && invoiceNote && !invoicePromptOpen && <p className={`no-print mb-4 rounded-lg px-3 py-2 text-sm ${gstMissing || /already|Enter the/i.test(invoiceNote) ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-moss'}`}>{invoiceNote}</p>}

        {(page.showHeader || page.rows.length > 0) ? (
        <>
        {page.showHeader ? (
          <div className="no-print mb-2 flex items-center justify-end">
            <div className="relative">
              <button
                ref={addColBtnRef}
                type="button"
                onClick={() => {
                  setFormulaColId(null)
                  setDockAddColumnOpen(o => !o)
                }}
                title="Add column"
                aria-label="Add column"
                aria-expanded={dockAddColumnOpen}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
                  dockAddColumnOpen
                    ? 'border-moss bg-moss text-white'
                    : 'border-sand bg-white text-moss hover:border-moss hover:bg-blue-50'
                }`}
              >
                <span className="text-sm leading-none" aria-hidden>+</span>
                Add column
              </button>
              <FloatingPop
                anchorRef={addColBtnRef}
                open={dockAddColumnOpen}
                onClose={() => setDockAddColumnOpen(false)}
                width={280}
                align="end"
                className="rounded-xl border border-sand bg-white p-1.5 text-left font-normal normal-case tracking-normal shadow-lg"
              >
                      <button
                        type="button"
                        onClick={() => {
                          const taken = new Set(columns.map(c => c.label.toLowerCase()))
                          let label = 'Calculated'
                          let n = 2
                          while (taken.has(label.toLowerCase())) label = `Calculated ${n++}`
                          addColumn(label, 'text', { openFormula: true })
                          setDockAddColumnOpen(false)
                        }}
                        className="mb-1 flex w-full items-center rounded-lg bg-blue-50 px-3 py-2 text-left text-[13px] font-semibold text-moss ring-1 ring-inset ring-[#c5daf5] transition hover:bg-[#dbeafe]"
                      >
                        Formula (fx)
                      </button>
                      {ADDABLE_COLUMN_TYPES.map(option => (
                        option.type === 'tax' || option.type === 'discount' ? (
                          <div key={option.type} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                            <span className="min-w-0 flex-1 text-left text-[13px] font-medium text-slate-700">{option.defaultLabel}</span>
                            <button
                              type="button"
                              onClick={() => quickAddColumnFromDock(option, { mode: 'amount' })}
                              className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-moss hover:bg-blue-50 hover:text-moss"
                            >
                              Amount
                            </button>
                            <button
                              type="button"
                              onClick={() => quickAddColumnFromDock(option, { mode: 'percent' })}
                              className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-moss hover:bg-blue-50 hover:text-moss"
                            >
                              Percentage
                            </button>
                          </div>
                        ) : option.type === 'hsn' ? (
                          <div key={option.type} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                            <span className="min-w-0 flex-1 text-left text-[13px] font-medium text-slate-700">{option.defaultLabel}</span>
                            <button
                              type="button"
                              onClick={() => quickAddColumnFromDock(option, { digits: '4' })}
                              className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-moss hover:bg-blue-50 hover:text-moss"
                            >
                              4 digits
                            </button>
                            <button
                              type="button"
                              onClick={() => quickAddColumnFromDock(option, { digits: '8' })}
                              className="shrink-0 rounded-full border border-sand bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-moss hover:bg-blue-50 hover:text-moss"
                            >
                              8 digits
                            </button>
                          </div>
                        ) : (
                          <button
                            key={option.type}
                            type="button"
                            onClick={() => quickAddColumnFromDock(option)}
                            className="mb-0.5 flex w-full items-center rounded-lg border border-transparent px-3 py-2 text-left text-[13px] font-medium text-slate-700 transition hover:border-sand hover:bg-slate-50"
                          >
                            {option.defaultLabel}
                          </button>
                        )
                      ))}
                      <div className="mt-1.5 border-t border-sand px-1.5 pb-1 pt-2">
                        <input
                          value={dockNewColumnLabel}
                          onChange={e => setDockNewColumnLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') submitDockNewColumn() }}
                          placeholder="Name"
                          className="mb-1.5 w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-moss"
                        />
                        <div className="flex items-center gap-1.5">
                          <select
                            value={dockNewColumnType}
                            onChange={e => {
                              const next = e.target.value
                              setDockNewColumnType(next)
                              if (next === 'formula') setDockWantFormula(true)
                              if (next === 'image' || next === 'attachment' || next === 'tax' || next === 'discount' || next === 'hsn') setDockWantFormula(false)
                            }}
                            aria-label="Column type"
                            className="min-w-0 flex-1 rounded-lg border border-sand bg-white px-2 py-1.5 text-[13px] text-slate-600 outline-none focus:border-moss"
                          >
                            <option value="text">Text</option>
                            <option value="formula">Formula</option>
                            <option value="image">Image</option>
                            <option value="attachment">File</option>
                            <option value="tax">Tax</option>
                            <option value="discount">Discount</option>
                            <option value="hsn">HSN</option>
                          </select>
                          <button
                            type="button"
                            onClick={submitDockNewColumn}
                            disabled={!dockNewColumnLabel.trim()}
                            className="rounded-lg bg-moss px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-[#1558b0] disabled:opacity-40"
                          >
                            Add
                          </button>
                        </div>
                        {dockNewColumnType !== 'image' && dockNewColumnType !== 'attachment' && dockNewColumnType !== 'tax' && dockNewColumnType !== 'discount' && dockNewColumnType !== 'hsn' && (
                          <label className="mt-1.5 flex cursor-pointer items-start gap-1.5 text-left">
                            <input
                              type="checkbox"
                              checked={dockWantFormula || dockNewColumnType === 'formula'}
                              onChange={e => setDockWantFormula(e.target.checked)}
                              className="mt-0.5"
                            />
                            <span className="text-[11px] leading-snug text-slate-600">Calculate with a formula (Amount also has fx for a custom override)</span>
                          </label>
                        )}
                        {(dockNewColumnType === 'tax' || dockNewColumnType === 'discount') && (
                          <div className="mt-1.5 flex gap-1.5">
                            {[
                              ['percent', '%'],
                              ['amount', '₹']
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setDockSpecialMode(value)}
                                className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${dockSpecialMode === value ? 'border-moss bg-blue-50 text-moss' : 'border-sand bg-white text-slate-600 hover:border-moss hover:bg-blue-50'}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                        {dockNewColumnType === 'hsn' && (
                          <div className="mt-1.5 flex gap-1.5">
                            {[
                              ['4', '4 digit'],
                              ['8', '8 digit']
                            ].map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setDockHsnDigits(value)}
                                className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${dockHsnDigits === value ? 'border-moss bg-blue-50 text-moss' : 'border-sand bg-white text-slate-600 hover:border-moss hover:bg-blue-50'}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
              </FloatingPop>
            </div>
          </div>
        ) : null}
        <div className="quote-items-scroll overflow-x-auto" style={{ overflow: 'hidden' }}>
          <div data-qg-table-zoom={tableFitZoom} style={tableFitZoom < 1 ? { zoom: tableFitZoom, width: tableTotalWidthPx } : undefined}>
          <table className="quote-items-table qg-studio-table text-left" style={{ tableLayout: 'fixed', width: `${tableTotalWidthPx}px`, minWidth: `${tableTotalWidthPx}px`, maxWidth: 'none', fontSize: `${paperFontPx}px` }}>
            <colgroup>
              <col style={{ width: `${SR_NO_COL_WIDTH}px` }} />
              {columns.map(col => (
                    <col key={col.id} style={{ width: `${getColWidth(isNestedColumn(col) ? `${col.id}__rate` : col.id)}px` }} />
                  ))}
              <col style={{ width: `${ROW_ACTIONS_COL_WIDTH}px` }} />
            </colgroup>
            <thead data-qg-block="thead">
              <tr className="border-y uppercase tracking-wide" style={{ borderColor: 'var(--qg-table-border, #d2e3fc)' }}>
                <th className="qg-cell-compact p-3">Sr. No.</th>
                {columns.map(col => (
                    <th
                      key={col.id}
                      draggable={editingColId !== col.id}
                      onDragStart={(e) => { if (e.target.closest?.('[data-resize-handle]')) { e.preventDefault(); return }; setDragColId(col.id) }}
                      onDragOver={(e) => { e.preventDefault(); setDropColId(col.id) }}
                      onDragLeave={() => setDropColId(prev => (prev === col.id ? null : prev))}
                      onDrop={(e) => { e.preventDefault(); swapColumns(dragColId, col.id); setDragColId(null); setDropColId(null) }}
                      onDragEnd={() => { setDragColId(null); setDropColId(null) }}
                      title={`${col.label} — click to rename, drag to swap`}
                      className={`group relative cursor-grab p-3 active:cursor-grabbing ${isCompactColumn(col) ? 'qg-cell-compact' : ''} ${isHighlightColumn(col) ? 'qg-highlight' : ''} ${col.id === 'amount' || isNestedColumn(col) || isFormulaColumn(col) ? 'text-right' : ''} ${dragColId === col.id ? 'opacity-40' : ''} ${dropColId === col.id && dragColId !== col.id ? 'bg-blue-50 ring-2 ring-inset ring-moss' : ''} ${formulaColId === col.id ? 'z-20' : ''}`}
                    >
                      <span className="inline-flex max-w-full flex-wrap items-center gap-0.5">
                      <span className="no-print mr-1 text-slate-300">⠿</span>
                      <QuoteColumnName
                        col={col}
                        editing={editingColId === col.id}
                        draft={editColLabel}
                        onStart={() => startRenameColumn(col)}
                        onChange={setEditColLabel}
                        onCommit={commitRenameColumn}
                        onCancel={cancelRenameColumn}
                      />
                      {isNestedColumn(col) && <span className="ml-1 font-semibold normal-case text-slate-400">%</span>}
                      {canHaveFormula(col, columns) && (
                        <button
                          type="button"
                          draggable={false}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); setFormulaColId(formulaColId === col.id ? null : col.id) }}
                          title={isFormulaColumn(col) ? formulaSentence(col.formula?.tokens, columns) : (col.id === 'amount' ? 'Custom formula on Amount (optional)' : 'Set a formula')}
                          className={`qg-col-fx no-print ml-1 inline-flex h-5 shrink-0 items-center justify-center rounded px-1.5 text-[9px] font-bold normal-case tracking-normal ${isFormulaColumn(col) ? 'bg-blue-50 text-moss' : 'text-moss/70 hover:bg-blue-50 hover:text-moss'}`}
                        >
                          fx
                        </button>
                      )}
                      <button
                        type="button"
                        draggable={false}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); removeColumn(col.id) }}
                        title={`Remove ${col.label}`}
                        className="qg-col-remove no-print ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold leading-none opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        ×
                      </button>
                      </span>
                      {formulaColId === col.id && page.showHeader && (
                        <FormulaGuide
                          col={col}
                          columns={columns}
                          onSave={(formula) => saveColumnFormula(col.id, formula)}
                          onClose={() => setFormulaColId(null)}
                        />
                      )}
                      <ColumnResizeHandle colKey={isNestedColumn(col) ? `${col.id}__rate` : col.id} />
                    </th>
                  ))}
                <th className="no-print w-0 p-0" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {page.rows.map((i) => {
                const item = items[i]
                if (!item) return null
                return (
                <tr
                  key={i}
                  data-qg-row={i}
                  className={`group/row border-b border-sand align-top ${dragRowIndex === i ? 'opacity-40' : ''} ${dropRowIndex === i && dragRowIndex !== i ? 'bg-blue-50' : ''}`}
                >
                  <td
                    draggable
                    onDragStart={() => setDragRowIndex(i)}
                    onDragOver={(e) => { e.preventDefault(); setDropRowIndex(i) }}
                    onDragLeave={() => setDropRowIndex(prev => (prev === i ? null : prev))}
                    onDrop={(e) => { e.preventDefault(); moveItem(dragRowIndex, i); setDragRowIndex(null); setDropRowIndex(null) }}
                    onDragEnd={() => { setDragRowIndex(null); setDropRowIndex(null) }}
                    title="Drag to reorder this row"
                    className={`qg-cell-compact relative cursor-grab p-3 text-slate-400 active:cursor-grabbing`}
                  >
                    <span className="no-print mr-1 text-slate-300">⠿</span>
                    {i + 1}
                    <button
                      type="button"
                      draggable={false}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); removeItem(i) }}
                      title="Remove this row"
                      className="no-print absolute right-0 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-rose-50 text-[11px] font-bold text-rose-500 hover:bg-rose-100 group-hover/row:flex"
                    >
                      ×
                    </button>
                  </td>
                  {columns.map(col => isNestedColumn(col)
                    ? <NestedTableCells key={col.id} col={col} item={item} rowIndex={i} updateItem={updateItem} />
                    : (
                      <QuoteTableCell
                        key={col.id}
                        col={col}
                        columns={columns}
                        item={item}
                        rowIndex={i}
                        updateItem={updateItem}
                        onDescriptionBlur={onDescriptionBlur}
                        onImageChange={setImageCell}
                        onAttachmentChange={setAttachmentCell}
                        onFitColumn={fitImageColumn}
                        onRevertAmount={revertAmount}
                        onAmountBlur={refreshAmount}
                        products={suggestProducts}
                        onApplyProduct={applyProductSuggestion}
                      />
                    ))}
                  <td className="no-print p-1 align-top" />
                </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
        </>
        ) : null}
        {page.rows.length > 0 && !pagePlan.slice(pageIndex + 1).some(p => p.rows.length) ? (
        <button onClick={addItem} className="no-print mt-3 text-sm font-semibold text-moss">+ Add line item</button>
        ) : null}
        {page.showTotals && hasAmount && (
          <div className="qg-totals-card" data-qg-block="totals">
            <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>{money(quoteTotals.subtotal)}</span></div>
            {quoteTotals.perColumn.filter(entry => entry.type === 'discount').map(entry => (
              <div key={entry.id} className="mt-1 flex justify-between text-sm text-rose-600">
                <span>Less: {entry.label}</span><span>− {money(entry.amount)}</span>
              </div>
            ))}
            {quoteTotals.discountTotal > 0 && (
              <div className="mt-1 flex justify-between border-t border-dashed border-sand pt-1 text-sm text-slate-500">
                <span>Taxable value</span><span>{money(quoteTotals.taxableTotal)}</span>
              </div>
            )}
            {quoteTotals.perColumn.filter(entry => entry.type === 'tax').map(entry => (
              <div key={entry.id} className="mt-1 flex justify-between text-sm text-slate-500">
                <span>Add: {entry.label}</span><span>{money(entry.amount)}</span>
              </div>
            ))}
            <TotalsExtraLines
              lines={extraLines}
              base={quoteTotals.extraBase ?? (quoteTotals.taxableTotal + quoteTotals.taxTotal)}
              columns={columns}
              items={items}
              onAdd={addExtraLine}
              onUpdate={updateExtraLine}
              onRemove={removeExtraLine}
            />
            <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold" style={{ borderColor: 'var(--qg-accent)' }}><span>Total</span><span>{money(quoteTotals.grandTotal)}</span></div>
            {!hasNested && <p className="mt-1 text-right text-xs text-slate-400">Taxes extra as applicable</p>}
          </div>
        )}
      </div>
      ) : null}
      {page.showClosing ? (
      <div data-qg-block="closing">
      <div className={`qg-paper-body${profile?.footerImageUrl ? ' qg-paper-body--flush-footer' : ''}`}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <section>
            <RichTextField
              singleLine
              className="qg-section-heading qg-rich-heading"
              style={{ color: 'var(--qg-accent)' }}
              value={quote.fields?.standardTermsTitle || 'Standard terms'}
              onChange={v => update(['fields', 'standardTermsTitle'], v)}
              placeholder="Standard terms"
            />
            <RichTextField
              multiline
              className="mt-1 min-h-[4.5rem] text-sm leading-relaxed"
              style={{ color: 'var(--qg-muted)' }}
              value={quote.fields?.standardTerms ?? profile?.standardTerms ?? ''}
              onChange={v => update(['fields', 'standardTerms'], v)}
              placeholder="Standard terms for this quotation — click to edit. Use the toolbar for bold, italic, colour…"
            />
          </section>
          <section>
            <RichTextField
              singleLine
              className="qg-section-heading qg-rich-heading"
              style={{ color: 'var(--qg-accent)' }}
              value={quote.fields?.notesTitle || 'Notes'}
              onChange={v => update(['fields', 'notesTitle'], v)}
              placeholder="Notes"
            />
            <RichTextField
              multiline
              className="mt-1 min-h-24 text-sm leading-6"
              value={(quote.notes || []).join('\n')}
              onChange={v => updateList('notes', plainTextFromMaybeHtml(v))}
              placeholder="Add notes, one per line"
            />
          </section>
        </div>
        <hr className="qg-section-rule" />
        <section>
          <RichTextField
            singleLine
            className="qg-section-heading qg-rich-heading"
            style={{ color: 'var(--qg-accent)' }}
            value={quote.fields?.commercialTitle || 'Commercial terms'}
            onChange={v => update(['fields', 'commercialTitle'], v)}
            placeholder="Commercial terms"
          />
          <div className="grid grid-cols-1 gap-x-8 gap-y-0 sm:grid-cols-2">
            {Object.entries({ ...defaultTerms, ...quote.terms }).map(([key, val]) => (
              <div key={key} className="flex gap-2 border-b border-dashed py-2 text-sm" style={{ borderColor: 'var(--qg-table-border)' }}>
                <span className="w-28 shrink-0 capitalize" style={{ color: 'var(--qg-muted)' }}>{key}</span>
                <TermField value={val} onChange={v => update(['terms', key], v)} />
              </div>
            ))}
          </div>
        </section>
        <footer className="mt-8 qg-signatory-block">
          {profile?.bankName || profile?.bankAccountNo || profile?.bankQrUrl ? (
            <>
              <hr className="qg-section-rule" />
              <CompanyBankDetails profile={profile} className="mb-8" />
            </>
          ) : null}
          <hr className="qg-section-rule" />
          <div className="flex justify-end pb-1">
            <div className="w-52 text-center">
              <div className="h-14" />
              <div className="pt-2" style={{ borderTop: '1.5px solid var(--qg-muted, #5c6879)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--qg-text)' }}>Authorized Signatory</p>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--qg-muted)' }}>For {profile?.companyName?.trim() || 'Your Company'}</p>
              </div>
            </div>
          </div>
          {visibleFooterText(profile?.footerText) && !profile?.footerImageUrl ? (
            <PageEndBand>
              <CompanyFooter profile={profile} />
            </PageEndBand>
          ) : null}
        </footer>
      </div>
      {profile?.footerImageUrl ? (
        <CompanyFooter
          profile={profile}
          editable={Boolean(onFooterFitChange)}
          onFitChange={onFooterFitChange}
        />
      ) : null}
      </div>
      ) : null}
      </section>
      ))}
    </QuoteStudioCanvas>
    </div>

    <QuoteStudioFooterBar onExport={handleExport} pdfBusy={pdfBusy} onHome={onHome} />

    {advancedOpen && (
      <div className="no-print qg-commands-fab fixed bottom-24 right-4 z-30">
        <div className="relative">
          <button
            type="button"
            onClick={() => setCommandsOpen(o => !o)}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg"
          >
            ✨ Commands
          </button>
          {commandsOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-64 rounded-2xl border border-sand bg-white p-2 shadow-soft">
              <button type="button" onClick={() => { fetchHsnGstBulk(); setCommandsOpen(false) }} disabled={hsnBulkRunning} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-blue-50 disabled:opacity-50">
                <span className="text-sm font-medium text-slate-700">Fetch HSN for every row</span>
              </button>
              <button type="button" onClick={runCommandRemoveGst} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-blue-50">
                <span className="text-sm font-medium text-slate-700">Remove GST column</span>
              </button>
              <button type="button" onClick={runCommandAddSpecifications} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-blue-50">
                <span className="text-sm font-medium text-slate-700">Add Specifications</span>
              </button>
              <button type="button" onClick={runCommandApplyCompanyTerms} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-blue-50">
                <span className="text-sm font-medium text-slate-700">Apply company terms</span>
              </button>
              <button type="button" onClick={runCommandConvertToExportFormat} className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-blue-50">
                <span className="text-sm font-medium text-slate-700">Export format (HS Code)</span>
              </button>
              {!isInvoice && (
                <button
                  type="button"
                  disabled={invoiceBusy || !persistenceConfigured}
                  onClick={() => { setCommandsOpen(false); openInvoicePrompt() }}
                  className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-blue-50 disabled:opacity-50"
                >
                  <span className="text-sm font-medium text-slate-700">Convert to invoice</span>
                  <span className="text-[11px] text-slate-400">Raise a sales invoice from this quotation</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )}

    {invoicePromptOpen && !isInvoice && (
      <div className="no-print fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setInvoicePromptOpen(false)}>
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
          <p className="text-sm font-semibold text-slate-700">Create {invoiceKindLabel.toLowerCase()}</p>
          <input
            autoFocus
            value={invoiceNumber}
            onChange={e => setInvoiceNumber(e.target.value)}
            placeholder="Invoice number"
            className="mt-3 w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-moss"
          />
          <div className="mt-4 flex gap-2">
            <button type="button" disabled={invoiceBusy} onClick={handleConvertToInvoice} className="rounded-xl bg-moss px-4 py-2 text-sm font-semibold text-white">{invoiceBusy ? 'Creating…' : 'Create'}</button>
            <button type="button" onClick={() => setInvoicePromptOpen(false)} className="rounded-xl px-4 py-2 text-sm text-slate-500">Cancel</button>
          </div>
          {invoiceNote && <p className="mt-3 text-sm text-rose-600">{invoiceNote}</p>}
        </div>
      </div>
    )}
  </main>
}

/** A commercial-terms value: rich inline edit (bold/italic/colour) that never
 *  crashes if a non-string slipped into quote.terms. */
function plainTextFromMaybeHtml(value) {
  const raw = value == null ? '' : typeof value === 'string' ? value : String(value)
  if (!raw) return ''
  if (!/<\/?[a-z][\s\S]*>/i.test(raw)) return raw
  if (typeof document === 'undefined') return raw.replace(/<[^>]+>/g, '')
  const el = document.createElement('div')
  el.innerHTML = raw
  return (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ')
}

function termText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Objects in terms used to white-screen React — coerce safely.
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function TermField({ value, onChange }) {
  return (
    <RichTextField
      multiline
      className="min-w-0 flex-1 text-sm leading-6"
      value={termText(value)}
      onChange={onChange}
      placeholder="Click to edit"
    />
  )
}

function Input({ label, value, onChange, bare = false, inputRef = null }) { return <label className={`block ${bare ? 'mb-1' : ''}`}><span className={bare ? 'sr-only' : 'mb-1.5 block text-sm font-medium text-slate-700'}>{label}</span><input ref={inputRef} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={label} className={bare ? 'w-full bg-transparent py-1 text-sm outline-none placeholder:text-slate-400' : 'w-full rounded-xl border border-sand bg-white px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50'}/></label> }
function Brand({ onClick }) {
  return (
    <button type="button" onClick={onClick} title="Go to Home" className={`flex items-center gap-2 ${onClick ? 'cursor-pointer' : ''}`}>
      <BrandMark size={32} />
      <span className="font-semibold tracking-tight">QuoteGen</span>
    </button>
  )
}

/* ------------------------------------------------------------------------
 * Workspace shell — dashboard nav + pages shown when no quotation is open.
 * Visual language matches the "QuoteGen Redesign" handoff exactly (colors,
 * spacing, copy). The quotation editor itself (QuoteEditor / UploadedTemplateQuote)
 * is untouched — this only replaces the surrounding home/landing chrome.
 * ------------------------------------------------------------------------ */

const WS_ICONS = {
  home: 'M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  book: 'M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z',
  building: 'M4 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15M15 11h4a1 1 0 0 1 1 1v9M8 9h3M8 13h3M8 17h3',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6M17 7.2a3 3 0 0 1 0 5.6M21 20v-1a4 4 0 0 0-3-3.8',
  user: 'M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  card: 'M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10.5h20M6 15h4',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  panelHide: 'M15 18l-6-6 6-6'
}

function WsIcon({ path, size = 20, strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

function WsSearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#79859A" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </svg>
  )
}

function initialsFromEmail(email) {
  const local = String(email || '').split('@')[0]
  const parts = local.split(/[._-]+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2)
  return letters.toUpperCase()
}

function formatWsDate(raw) {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const wsPrimaryBtn = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 56, padding: '0 24px', border: 0, borderRadius: 14, background: '#1A73E8', color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer', boxShadow: '0 6px 16px rgba(29,99,237,.26)' }
const wsSecondaryBtn = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 56, padding: '0 24px', border: '1.5px solid #D5DDE9', borderRadius: 14, background: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer', color: '#2d3748' }

function WsSidebar({ view, onNav, onNewQuote, recentCount, authUserEmail, isMobile, mobileOpen, hidden, onClose, onHide }) {
  const mainNav = [
    { id: 'home', label: 'Home', icon: WS_ICONS.home },
    { id: 'list', label: 'Recent quotations', icon: WS_ICONS.list, badge: recentCount || null },
    { id: 'insights', label: 'Insights', icon: WS_ICONS.chart },
    { id: 'knowledge', label: 'Knowledge', icon: WS_ICONS.book }
  ]
  const setupNav = [
    { id: 'company', label: 'Company', icon: WS_ICONS.building },
    { id: 'team', label: 'Team', icon: WS_ICONS.users },
    { id: 'account', label: 'Account', icon: WS_ICONS.user },
    { id: 'billing', label: 'Billing', icon: WS_ICONS.card }
  ]
  // On mobile the fixed 262px rail would eat almost the whole screen, so it
  // becomes an off-canvas drawer instead: unmounted when closed, an overlay
  // with a dismiss backdrop when open. Desktop keeps the original sticky rail.
  if ((isMobile && !mobileOpen) || hidden) return null
  const asideStyle = isMobile
    ? { width: 262, flex: '0 0 262px', background: '#fff', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, left: 0, height: '100vh', overflow: 'auto', zIndex: 101, boxShadow: '2px 0 24px rgba(20,42,34,.18)' }
    : { width: 262, flex: '0 0 262px', background: '#fff', borderRight: '1px solid #e8edf3', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }
  return (
    <>
    {isMobile && mobileOpen && (
      <div onClick={onClose} className="no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,20,.4)', zIndex: 100 }} />
    )}
    <aside className="no-print" style={asideStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '18px 10px 12px 8px' }}>
        <button
          onClick={() => { onNav('home'); onClose?.() }}
          title="Go to Home"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 10px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0 }}
        >
          <BrandMark size={34} />
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Quote<span style={{ color: '#1A73E8' }}>Gen</span></div>
            <div style={{ fontSize: 12, color: '#7A8699' }}>Your AI quotation employee</div>
          </div>
        </button>
        {!isMobile && (
          <button
            type="button"
            onClick={onHide}
            aria-label="Hide sidebar"
            title="Hide sidebar"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, flex: '0 0 34px', marginTop: 4, border: '1.5px solid #D5DDE9', borderRadius: 10, background: '#fff', color: '#5C6879', cursor: 'pointer' }}
          >
            <WsIcon path={WS_ICONS.panelHide} size={16} strokeWidth={2.4} />
          </button>
        )}
      </div>

      <div style={{ padding: '0 16px 14px' }}>
        <button onClick={onNewQuote} style={{ ...wsPrimaryBtn, width: '100%' }}>
          <WsIcon path={WS_ICONS.plus} strokeWidth={2.6} />
          Make a new quote
        </button>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 12px' }}>
        {mainNav.map(n => (
          <button
            key={n.id}
            onClick={() => onNav(n.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', minHeight: 50, padding: '0 14px', border: 0, borderRadius: 12, fontSize: 16, fontWeight: 650, cursor: 'pointer', textAlign: 'left', background: view === n.id ? '#E7EEFB' : 'transparent', color: view === n.id ? '#1A73E8' : '#3D4859' }}
          >
            <span style={{ display: 'flex', width: 22, height: 22, flex: '0 0 22px' }}><WsIcon path={n.icon} /></span>
            <span style={{ flex: 1 }}>{n.label}</span>
            {n.badge ? (
              <span style={{ minWidth: 26, height: 24, padding: '0 8px', borderRadius: 12, background: '#E7EEFB', color: '#1A73E8', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n.badge}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div style={{ padding: '16px 26px 8px', fontSize: 12, fontWeight: 800, letterSpacing: '.12em', color: '#8A94A6' }}>SET UP ONCE</div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '0 12px 12px' }}>
        {setupNav.map(n => (
          <button
            key={n.id}
            onClick={() => onNav(n.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', minHeight: 46, padding: '0 14px', border: 0, borderRadius: 12, fontSize: 15.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left', background: view === n.id ? '#E7EEFB' : 'transparent', color: view === n.id ? '#1A73E8' : '#3D4859' }}
          >
            <span style={{ display: 'flex', width: 20, height: 20, flex: '0 0 20px' }}><WsIcon path={n.icon} size={18} /></span>
            {n.label}
          </button>
        ))}
      </nav>

      <div style={{ marginTop: 'auto', padding: '14px 16px 18px', borderTop: '1px solid #EDF1F7' }}>
        <button onClick={() => onNav('account')} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '6px 4px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 12 }}>
          <div style={{ width: 38, height: 38, flex: '0 0 38px', borderRadius: '50%', background: '#E7EEFB', color: '#1A73E8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14 }}>{initialsFromEmail(authUserEmail)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{authUserEmail}</div>
            <div style={{ fontSize: 13, color: '#7A8699' }}>Account and sign out</div>
          </div>
        </button>
      </div>
    </aside>
    </>
  )
}

function WsHeader({ title, hint, showBack, onBack, isMobile, showMenu, onMenu }) {
  return (
    <header className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isMobile ? '0 14px' : '0 30px', minHeight: 70, background: 'rgba(255,255,255,.86)', backdropFilter: 'blur(20px) saturate(180%)', borderBottom: '1px solid #e8edf3', position: 'sticky', top: 0, zIndex: 30 }}>
      {showMenu && (
        <button onClick={onMenu} aria-label="Show sidebar" title="Show sidebar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, flex: '0 0 42px', border: '1.5px solid #D5DDE9', borderRadius: 11, background: '#fff', cursor: 'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {hint && !isMobile && <div style={{ fontSize: 14, color: '#6B7688', marginTop: 1 }}>{hint}</div>}
      </div>
      {showBack && (
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46, padding: isMobile ? '0 12px' : '0 18px', border: '1.5px solid #D5DDE9', borderRadius: 12, background: '#fff', fontSize: 15.5, fontWeight: 700, cursor: 'pointer', flex: '0 0 auto' }}>
          <WsIcon path={WS_ICONS.back} size={18} strokeWidth={2.4} />
          {!isMobile && 'Back'}
        </button>
      )}
    </header>
  )
}

function WsQuoteCard({ q, onOpen, onClone }) {
  const tag = q.docType === 'invoice' ? { label: 'COMPLETED', bg: '#e8f2ec', fg: '#2d6a4f' } : { label: 'DRAFT', bg: '#f0f3f8', fg: '#4C5768' }
  const clientName = q.customer?.company || q.customer?.name || 'No customer set'
  return (
    <div style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, letterSpacing: '.04em', background: tag.bg, color: tag.fg }}>{tag.label}</span>
        <span style={{ fontSize: 13.5, color: '#8A94A6', marginLeft: 'auto' }}>{formatWsDate(q.date || q.updatedAt)}</span>
      </div>
      <div>
        <div style={{ fontSize: 16.5, fontWeight: 600, lineHeight: 1.25 }}>{clientName}</div>
        <div style={{ fontSize: 14, color: '#6B7688', marginTop: 4, lineHeight: 1.45 }}>{q.title || q.number}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 12, borderTop: '1px solid #EDF1F7' }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{q.total ? money(q.total) : 'Not priced yet'}</span>
        <span style={{ fontSize: 14, color: '#8A94A6' }}>{q.itemCount} item{q.itemCount === 1 ? '' : 's'}</span>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => onOpen(q.id)} style={{ flex: 1, minHeight: 44, border: 0, borderRadius: 12, background: '#1A73E8', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>Open</button>
        <button onClick={() => onClone(q.id)} style={{ flex: 1, minHeight: 44, border: '1.5px solid #D5DDE9', borderRadius: 12, background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: '#2d3748' }}>Make a copy</button>
      </div>
    </div>
  )
}

function wsStatValueStyle(value, { fontSize = 28, fontWeight = 700, letterSpacing = '-0.02em' } = {}) {
  const n = String(value || '').replace(/\s/g, '').length
  const size = n > 20 ? Math.max(15, fontSize - 12) : n > 16 ? Math.max(17, fontSize - 8) : n > 12 ? Math.max(20, fontSize - 4) : fontSize
  return {
    fontSize: size,
    fontWeight,
    letterSpacing,
    marginTop: 6,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    maxWidth: '100%',
    minWidth: 0
  }
}

function WsHome({ greetingWord, greetingName, stats, recent, topClients, onOpen, onClone, onOpenCompany, onNav, onNewQuote }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <section style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 20, padding: '30px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <BrandMark size={44} />
          <div style={{ fontSize: 16, color: '#5C6879', fontWeight: 600 }}>{greetingWord}, {greetingName}</div>
        </div>
        <h1 style={{ margin: '0 0 10px', fontSize: 29, lineHeight: 1.15, letterSpacing: '-0.02em', fontWeight: 600 }}><span style={{ color: '#1A73E8' }}>Paste the enquiry.</span> Check the rates. <span style={{ color: '#1A73E8' }}>Send the quotation.</span></h1>
        <p style={{ margin: '0 0 6px', fontSize: 17, lineHeight: 1.55, color: '#4C5768', maxWidth: '64ch' }}>Email, WhatsApp message, phone notes, a PDF or a catalogue.</p>
        <p style={{ margin: '0 0 22px', fontSize: 17, lineHeight: 1.55, color: '#4C5768' }}>Quotegen does the magic.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <button onClick={onNewQuote} style={wsPrimaryBtn}>
            <WsIcon path={WS_ICONS.plus} strokeWidth={2.6} />
            Make a new quote
          </button>
          <button onClick={() => onNav('list')} style={wsSecondaryBtn}>Open Recent quotations</button>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 16 }}>
        {stats.map(s => (
          <button key={s.label} onClick={s.go} style={{ textAlign: 'left', background: '#fff', border: '1px solid #e8edf3', borderRadius: 16, padding: '20px 22px', cursor: 'pointer', overflow: 'hidden', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: '#6B7688' }}>{s.label}</div>
            <div style={wsStatValueStyle(s.value)}>{s.value}</div>
            <div style={{ fontSize: 14, color: '#8A94A6', marginTop: 2 }}>{s.sub}</div>
          </button>
        ))}
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>Carry on where you left off</h2>
          <button onClick={() => onNav('list')} style={{ border: 0, background: 'none', color: '#1A73E8', fontSize: 16, fontWeight: 700, cursor: 'pointer', minHeight: 44, padding: '0 6px', whiteSpace: 'nowrap', flexShrink: 0 }}>See all</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(310px,1fr))', gap: 16 }}>
          {recent.length === 0 && <div style={{ color: '#8A94A6', fontSize: 15 }}>No quotations yet — make your first one above.</div>}
          {recent.map(q => <WsQuoteCard key={q.id} q={q} onOpen={onOpen} onClone={onClone} />)}
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>Top clients</h2>
          <button onClick={() => onNav('list')} style={{ border: 0, background: 'none', color: '#1A73E8', fontSize: 16, fontWeight: 700, cursor: 'pointer', minHeight: 44, padding: '0 6px', whiteSpace: 'nowrap', flexShrink: 0 }}>See all</button>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 20, padding: 26 }}>
          {topClients.length === 0 && <div style={{ color: '#8A94A6', fontSize: 15 }}>No priced quotations yet — make your first one above.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {topClients.map((c, i) => (
              <button
                key={c.name}
                onClick={() => onOpenCompany(c.name)}
                style={{ display: 'flex', alignItems: 'center', gap: 16, border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                <div style={{ width: 34, height: 34, flex: '0 0 34px', borderRadius: 10, background: '#F1F5FC', color: '#1A73E8', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#2d3748' }}>{c.name}</div>
                  <div style={{ height: 10, borderRadius: 6, background: '#edf1f8', marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 6, background: '#1A73E8', width: `${c.pct}%` }} />
                  </div>
                </div>
                <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{money(c.value)}</div>
                  <div style={{ fontSize: 13.5, color: '#8A94A6' }}>{c.count} quotation{c.count === 1 ? '' : 's'}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function LayoutChoicePreview({ kind = 'default' }) {
  if (kind === 'upload') {
    return (
      <div style={{ background: '#f8fafc', padding: '14px 14px 8px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{
          background: '#fff',
          borderRadius: 8,
          height: 108,
          boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="12" y2="17" />
          </svg>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: '0.08em' }}>WORD / EXCEL</div>
        </div>
      </div>
    )
  }

  const t = PAPER_THEMES.corporate
  return (
    <div style={{ background: t.pageBg, padding: '14px 14px 8px', borderBottom: `1px solid ${t.tableBorder}` }}>
      <div style={{
        background: t.paperBg,
        borderRadius: 8,
        overflow: 'hidden',
        height: 108,
        position: 'relative',
        boxShadow: '0 1px 6px rgba(0,0,0,0.10)'
      }}>
        <div style={{ background: t.accent, height: 22 }} />
        <div style={{ margin: '10px 10px 0', height: 5, borderRadius: 3, background: t.accent, width: '55%', opacity: 0.75 }} />
        <div style={{ margin: '5px 10px 0', height: 3, borderRadius: 3, background: t.tableBorder, width: '40%' }} />
        <div style={{ margin: '12px 10px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[0.92, 0.74, 0.84, 0.62].map((w, i) => (
            <div key={i} style={{ height: 3, borderRadius: 2, background: t.tableBorder, width: `${w * 100}%`, opacity: 0.85 }} />
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: 10, right: 10, height: 4, borderRadius: 2, background: t.accent, width: 40, opacity: 0.65 }} />
      </div>
    </div>
  )
}

function WsNew({ enquiry, setEnquiry, onGenerate, onManual, onUploadLayout, initialStep = 1, loading, error, detailsOpen, setDetailsOpen, customer, changeCustomer, columns, setColumns, savedLayouts = [], activeLayoutId = '', persistenceConfigured, onSavedProfile, uploadTemplates, selectedTemplateId, setSelectedTemplateId, paperStyle, setPaperStyle, isMobile }) {
  const [step, setStep] = React.useState(initialStep)
  const [layoutChoice, setLayoutChoice] = React.useState(selectedTemplateId ? 'upload' : 'default') // 'default' | 'upload'
  const [keepMode, setKeepMode] = React.useState('save') // 'once' | 'save'
  const [layoutName, setLayoutName] = React.useState('')
  const [selectedSavedId, setSelectedSavedId] = React.useState(activeLayoutId || '')
  const [layoutSaving, setLayoutSaving] = React.useState(false)
  const [layoutNote, setLayoutNote] = React.useState('')
  const [baselineKey, setBaselineKey] = React.useState(() => columnLayoutKey(columns))
  const appliedSavedRef = React.useRef(false)
  const customerFields = [['name', 'Customer name'], ['company', 'Company name'], ['gst', 'GST number'], ['location', 'Delivery location']]
  const [ingestBusy, setIngestBusy] = React.useState(false)
  const [ingestNote, setIngestNote] = React.useState('')
  const [voiceState, setVoiceState] = React.useState('idle')
  const attachRef = React.useRef(null)
  const recognitionRef = React.useRef(null)
  const voiceBaseRef = React.useRef('')
  const canProceed = enquiry.trim().length > 0
  const layoutChanged = columnLayoutKey(columns) !== baselineKey
  const companySavedLayouts = savedLayouts.filter(l => l.source !== 'quote')

  React.useEffect(() => () => {
    try { recognitionRef.current?.stop?.() } catch { /* ignore */ }
  }, [])

  const ingestAttachedFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setIngestBusy(true)
    setIngestNote(`Reading ${files.length} file${files.length === 1 ? '' : 's'}…`)
    try {
      const result = await ingestEnquiryFiles(files)
      setEnquiry((prev) => [String(prev || '').trim(), result.text].filter(Boolean).join('\n\n'))
      const names = (result.files || []).map(f => f.name).join(', ')
      const fail = (result.failed || []).length
      setIngestNote(
        fail
          ? `Added text from ${names || 'files'}. ${fail} file${fail === 1 ? '' : 's'} could not be read.`
          : `Added text from ${names}. Generate as usual — it uses the same extraction engine.`
      )
    } catch (err) {
      setIngestNote(err?.message || 'Could not read those files.')
    } finally {
      setIngestBusy(false)
      if (attachRef.current) attachRef.current.value = ''
    }
  }

  const toggleVoice = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setIngestNote('Voice works in Chrome or Edge on this device.')
      return
    }
    if (recognitionRef.current && voiceState !== 'idle') {
      try { recognitionRef.current.stop() } catch { /* ignore */ }
      return
    }
    const rec = new SpeechRecognition()
    rec.lang = 'en-IN'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    voiceBaseRef.current = String(enquiry || '').trim()
    rec.onstart = () => setVoiceState('listening')
    rec.onerror = (event) => {
      setVoiceState('idle')
      recognitionRef.current = null
      if (event?.error === 'not-allowed') setIngestNote('Microphone permission is needed for voice notes.')
      else if (event?.error !== 'aborted') setIngestNote('Voice note stopped. You can type or attach a file instead.')
    }
    rec.onend = () => {
      setVoiceState('idle')
      recognitionRef.current = null
    }
    rec.onresult = (event) => {
      let finalChunk = ''
      let interim = ''
      for (let i = 0; i < event.results.length; i++) {
        const piece = event.results[i][0]?.transcript || ''
        if (event.results[i].isFinal) finalChunk += `${piece} `
        else interim += piece
      }
      const spoken = `${finalChunk}${interim}`.replace(/\s+/g, ' ').trim()
      const base = voiceBaseRef.current
      setEnquiry(base && spoken ? `${base}\n\n${spoken}` : (spoken || base))
    }
    recognitionRef.current = rec
    setIngestNote('Listening… tap Speak it again when you are done.')
    try { rec.start() } catch (err) {
      setIngestNote(err?.message || 'Could not start the microphone.')
      recognitionRef.current = null
    }
  }

  React.useEffect(() => {
    if (activeLayoutId) setSelectedSavedId(activeLayoutId)
  }, [activeLayoutId])

  React.useEffect(() => {
    if (step !== 2 || appliedSavedRef.current || !savedLayouts.length || selectedTemplateId) return
    const preferred = savedLayouts.find(l => l.id === (selectedSavedId || activeLayoutId)) || savedLayouts[0]
    if (!preferred?.columns?.length) return
    appliedSavedRef.current = true
    setSelectedSavedId(preferred.id)
    const next = preferred.columns.map(c => ({ ...c }))
    setColumns(next)
    if (preferred.source !== 'quote') setLayoutName(preferred.name)
    setBaselineKey(columnLayoutKey(next))
  }, [step, savedLayouts, selectedSavedId, activeLayoutId, selectedTemplateId, setColumns])

  const persistCurrentLayout = async () => {
    const name = layoutName.trim()
    if (!name) {
      setLayoutNote('Give this layout a name to save it for next time.')
      return false
    }
    if (!persistenceConfigured) {
      setLayoutNote('Connect company setup first to save layouts for later.')
      return false
    }
    setLayoutSaving(true)
    setLayoutNote('')
    try {
      const savedColumns = normalizeColumnList(columns)
      const existing = companySavedLayouts.find(l => l.name.toLowerCase() === name.toLowerCase())
      const id = (existing && !String(existing.id).startsWith('used_') ? existing.id : null) || `cl_${Date.now()}`
      const nextLayouts = existing
        ? companySavedLayouts.map(l => (l.id === existing.id ? { id, name, columns: savedColumns } : l))
        : [...companySavedLayouts, { id, name, columns: savedColumns }]
      const result = await saveCompanyProfile({
        columnLayout: savedColumns,
        columnLayouts: nextLayouts
          .filter(l => l.source !== 'quote' && !String(l.id).startsWith('used_'))
          .map(l => ({ id: l.id, name: l.name, columns: l.columns })),
        activeColumnLayoutId: id,
        defaultUploadTemplateId: null
      })
      if (result.unavailable) {
        setLayoutNote(SUPABASE_SETUP_HINT)
        return false
      }
      onSavedProfile?.(result.profile)
      setSelectedSavedId(id)
      setBaselineKey(columnLayoutKey(savedColumns))
      setLayoutNote(`Saved “${name}” — it will show in the list above.`)
      return true
    } catch (e) {
      setLayoutNote(e.message || 'Could not save this column layout.')
      return false
    } finally {
      setLayoutSaving(false)
    }
  }

  const applySavedLayout = (id) => {
    setSelectedSavedId(id)
    setLayoutNote('')
    if (!id) return
    const layout = savedLayouts.find(l => l.id === id)
    if (layout?.columns?.length) {
      const next = layout.columns.map(c => ({ ...c }))
      setColumns(next)
      if (layout.source !== 'quote') setLayoutName(layout.name)
      setBaselineKey(columnLayoutKey(next))
    }
  }

  const continueWithLayout = async (action) => {
    if (layoutChoice === 'default' && layoutChanged && keepMode === 'save' && layoutName.trim()) {
      const ok = await persistCurrentLayout()
      if (!ok) return
    }
    await action?.()
  }

  // Keep layoutChoice in sync with selectedTemplateId
  React.useEffect(() => {
    if (selectedTemplateId) setLayoutChoice('upload')
  }, [selectedTemplateId])

  if (step === 2) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <button onClick={() => setStep(1)} style={{ border: '1.5px solid #D5DDE9', borderRadius: 10, background: '#fff', padding: '8px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#3D4859' }}>← Back</button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#1a202c' }}>How should the quotation look?</div>
            <div style={{ fontSize: 14, color: '#718096', marginTop: 2 }}>
              {canProceed ? 'Pick one — you can switch later too.' : 'Pick a layout, then we’ll open a blank quotation in it.'}
            </div>
          </div>
        </div>

        {/* 2 big option cards */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
          {/* Option 1: QuoteGen default */}
          <button
            type="button"
            onClick={() => { setLayoutChoice('default'); setSelectedTemplateId('') }}
            style={{
              border: `2px solid ${layoutChoice === 'default' ? '#1A73E8' : '#e2e8f0'}`,
              borderRadius: 18,
              background: layoutChoice === 'default' ? '#f0f5ff' : '#fff',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              overflow: 'hidden',
              boxShadow: layoutChoice === 'default' ? '0 0 0 3px rgba(26,115,232,0.12)' : '0 1px 4px rgba(0,0,0,0.06)',
              transition: 'all .15s',
            }}
          >
            <LayoutChoicePreview kind="default" />
            <div style={{ padding: '14px 18px 18px' }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#1a202c' }}>QuoteGen layout</div>
              <div style={{ fontSize: 13, color: '#718096', marginTop: 4, lineHeight: 1.5 }}>Clean, professional design. Choose which columns to include.</div>
            </div>
          </button>

          {/* Option 2: Your own file */}
          <button
            type="button"
            onClick={() => setLayoutChoice('upload')}
            style={{
              border: `2px solid ${layoutChoice === 'upload' ? '#1A73E8' : '#e2e8f0'}`,
              borderRadius: 18,
              background: layoutChoice === 'upload' ? '#f0f5ff' : '#fff',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              overflow: 'hidden',
              boxShadow: layoutChoice === 'upload' ? '0 0 0 3px rgba(26,115,232,0.12)' : '0 1px 4px rgba(0,0,0,0.06)',
              transition: 'all .15s',
            }}
          >
            <LayoutChoicePreview kind="upload" />
            <div style={{ padding: '14px 18px 18px' }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#1a202c' }}>Your own file</div>
              <div style={{ fontSize: 13, color: '#718096', marginTop: 4, lineHeight: 1.5 }}>Upload a Word or Excel file. Same layout, just editable.</div>
            </div>
          </button>
        </div>

        {/* Sub-options depending on choice */}
        {layoutChoice === 'default' && (
          <div style={{ marginTop: 20, border: '1.5px solid #e8edf3', borderRadius: 14, padding: 18, background: '#fff' }}>
            <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#3D4859', marginBottom: 6 }}>Saved column layouts</label>
                <select
                  value={selectedSavedId}
                  onChange={e => applySavedLayout(e.target.value)}
                  className={SELECT_FIELD_CLASS}
                >
                  <option value="">{savedLayouts.length ? 'Choose a saved layout' : 'No saved layouts yet'}</option>
                  {savedLayouts.map(layout => (
                    <option key={layout.id} value={layout.id}>{layout.name}</option>
                  ))}
                </select>
                <p style={{ marginTop: 6, fontSize: 12.5, color: '#94a3b8' }}>
                  {savedLayouts.length
                    ? 'Same layouts as Generate — pick one you already use, then fill the rows yourself.'
                    : 'Save a layout below and it will appear here for next time.'}
                </p>
              </div>

            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#3D4859', marginBottom: 12 }}>
              {savedLayouts.length > 0 ? 'Or set up columns' : 'Columns to include'}
            </div>
            <ColumnBuilder columns={columns} setColumns={setColumns} />

            {layoutChanged && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#3D4859', marginBottom: 8 }}>Keep this layout?</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  ['save', 'Save for future'],
                  ['once', 'Just this quotation']
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setKeepMode(value); setLayoutNote('') }}
                    style={{
                      border: `1.5px solid ${keepMode === value ? '#1A73E8' : '#e2e8f0'}`,
                      background: keepMode === value ? '#f0f5ff' : '#fff',
                      color: keepMode === value ? '#1A73E8' : '#3D4859',
                      borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {keepMode === 'save' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  <input
                    value={layoutName}
                    onChange={e => setLayoutName(e.target.value)}
                    placeholder="e.g. Industrial flanges"
                    style={{ flex: 1, minWidth: 180, minHeight: 42, padding: '0 12px', border: '1.5px solid #D5DDE9', borderRadius: 10, fontSize: 14, background: '#fff' }}
                  />
                  <button
                    type="button"
                    disabled={layoutSaving || !layoutName.trim()}
                    onClick={persistCurrentLayout}
                    style={{ ...wsSecondaryBtn, minHeight: 42, fontSize: 14, opacity: (layoutSaving || !layoutName.trim()) ? 0.5 : 1 }}
                  >
                    {layoutSaving ? 'Saving…' : 'Save layout'}
                  </button>
                </div>
              )}
              {layoutNote && (
                <p style={{ marginTop: 8, fontSize: 13, color: /saved/i.test(layoutNote) ? '#1A73E8' : '#B03A3A' }}>{layoutNote}</p>
              )}
            </div>
            )}
          </div>
        )}

        {layoutChoice === 'upload' && (
          <div style={{ marginTop: 20, border: '1.5px solid #e8edf3', borderRadius: 14, padding: 18, background: '#fff' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#3D4859', marginBottom: 12 }}>Pick your uploaded file</div>
            {uploadTemplates.length === 0 ? (
              <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 12px' }}>No files uploaded yet. Add a Word or Excel quotation you already use.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {uploadTemplates.map(tpl => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(tpl.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      border: `1.5px solid ${selectedTemplateId === tpl.id ? '#1A73E8' : '#e2e8f0'}`,
                      borderRadius: 10, background: selectedTemplateId === tpl.id ? '#f0f5ff' : '#fff',
                      padding: '10px 14px', cursor: 'pointer', textAlign: 'left', transition: 'all .12s'
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={selectedTemplateId === tpl.id ? '#1A73E8' : '#94a3b8'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#1a202c' }}>{tpl.name}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>{tpl.type?.toUpperCase()}</div>
                    </div>
                    {selectedTemplateId === tpl.id && <span style={{ color: '#1A73E8', fontWeight: 800, fontSize: 16 }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={onUploadLayout}
              style={{
                marginTop: 12, width: '100%', minHeight: 46,
                border: '1.5px dashed #1A73E8', borderRadius: 10, background: '#f8fbff',
                color: '#1A73E8', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Upload a new Word or Excel file
            </button>
          </div>
        )}

        {/* Optional customer details */}
        <button onClick={() => setDetailsOpen(!detailsOpen)} style={{ marginTop: 18, border: 0, background: 'none', color: '#1A73E8', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
          {detailsOpen ? 'Hide customer details ↑' : '+ Add customer details (optional)'}
        </button>
        {detailsOpen && (
          <div style={{ marginTop: 12, border: '1.5px solid #e8edf3', borderRadius: 14, padding: 18, background: '#FBFCFE' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
              {customerFields.map(([key, label]) => (
                <label key={key} style={{ display: 'block' }}>
                  <span style={{ marginBottom: 6, display: 'block', fontSize: 13, fontWeight: 700, color: '#3D4859' }}>{label}</span>
                  <input value={customer[key] || ''} onChange={e => changeCustomer(key, e.target.value)} placeholder={label} style={{ width: '100%', minHeight: 44, padding: '0 12px', border: '1.5px solid #D5DDE9', borderRadius: 10, fontSize: 14.5, background: '#fff' }} />
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <p style={{ marginTop: 14, borderRadius: 10, background: '#FDF2F2', padding: '10px 14px', fontSize: 14.5, color: '#B03A3A' }}>{error}</p>}

        <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {canProceed ? (
            <button
              disabled={loading || layoutSaving || (layoutChoice === 'upload' && !selectedTemplateId && uploadTemplates.length > 0)}
              onClick={() => continueWithLayout(onGenerate)}
              style={{ ...wsPrimaryBtn, opacity: (loading || layoutSaving || (layoutChoice === 'upload' && !selectedTemplateId && uploadTemplates.length > 0)) ? 0.5 : 1, fontSize: 17, padding: '0 32px', minHeight: 52 }}
            >
              {loading ? 'Understanding enquiry…' : 'Generate quotation →'}
            </button>
          ) : null}
          <button
            onClick={() => continueWithLayout(onManual)}
            disabled={loading || layoutSaving || (layoutChoice === 'upload' && !selectedTemplateId && uploadTemplates.length > 0)}
            style={{
              ...(canProceed ? wsSecondaryBtn : wsPrimaryBtn),
              minHeight: 52,
              fontSize: canProceed ? undefined : 17,
              padding: canProceed ? '0 28px' : '0 32px',
              whiteSpace: 'nowrap',
              minWidth: canProceed ? 210 : undefined,
              opacity: (loading || layoutSaving || (layoutChoice === 'upload' && !selectedTemplateId && uploadTemplates.length > 0)) ? 0.5 : 1
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {canProceed ? 'Fill it in myself' : (loading ? 'Opening…' : 'Open blank quotation →')}
          </button>
        </div>
      </div>
    )
  }

  // Step 1 — just the enquiry box
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 20, padding: '32px 34px' }}>
        <label htmlFor="ws-enq" style={{ display: 'block', fontSize: 21, fontWeight: 800, marginBottom: 6, color: '#1a202c' }}>
          Paste the client's enquiry
        </label>
        <div style={{ fontSize: 15.5, color: '#6B7688', marginBottom: 16 }}>
          A full email, one WhatsApp line, or your own notes from a phone call — all of it works.
        </div>
        <textarea
          id="ws-enq"
          value={enquiry}
          onChange={e => setEnquiry(e.target.value)}
          placeholder="Example: Need 20 nos MS angle 50×50×6, 12 nos ball bearing 6205, delivery to Rajkot before 20th."
          style={{ width: '100%', minHeight: 220, padding: 18, border: '1.5px solid #D5DDE9', borderRadius: 14, fontSize: 17, lineHeight: 1.6, resize: 'vertical', background: '#FBFCFE', boxSizing: 'border-box' }}
          autoFocus
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
          <button
            disabled={!canProceed}
            onClick={() => setStep(2)}
            style={{ ...wsPrimaryBtn, opacity: canProceed ? 1 : 0.45, fontSize: 16, padding: '0 28px', minHeight: 52 }}
          >
            Next →
          </button>
          <button onClick={() => attachRef.current?.click()} disabled={ingestBusy} style={{ ...wsSecondaryBtn, minHeight: 52, opacity: ingestBusy ? 0.55 : 1 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            {ingestBusy ? 'Reading…' : 'Attach files or photos'}
          </button>
          <input
            ref={attachRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,application/pdf,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
            className="sr-only"
            style={{ display: 'none' }}
            onChange={e => ingestAttachedFiles(e.target.files)}
          />
          <button onClick={toggleVoice} style={{ ...wsSecondaryBtn, minHeight: 52, background: voiceState === 'listening' ? '#E7EEFB' : '#fff', borderColor: voiceState === 'listening' ? '#1A73E8' : '#D5DDE9' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            {voiceState === 'listening' ? 'Listening… tap to stop' : 'Speak it'}
          </button>
          <button onClick={() => setStep(2)} style={{ ...wsSecondaryBtn, minHeight: 52, padding: '0 28px', whiteSpace: 'nowrap', minWidth: 210 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Fill it in myself
          </button>
        </div>
        {ingestNote ? (
          <div style={{ marginTop: 10, fontSize: 13.5, color: '#4A5568', lineHeight: 1.45 }}>{ingestNote}</div>
        ) : (
          <div style={{ marginTop: 8, fontSize: 13.5, color: '#94a3b8' }}>
            Tip: attach a PDF, Word, Excel, or a photo of a handwritten list — OCR fills the box, then Generate uses the same engine as paste.
          </div>
        )}
      </div>
    </div>
  )
}

function WsList({ quotations, query, setQuery, tab, setTab, onOpen, onClone }) {
  const tabs = [['all', 'All'], ['draft', 'Drafts'], ['completed', 'Completed']]
  const matches = (q) => {
    if (tab === 'draft' && q.docType === 'invoice') return false
    if (tab === 'completed' && q.docType !== 'invoice') return false
    const hay = `${q.customer?.company || ''} ${q.customer?.name || ''} ${q.title || ''} ${q.number || ''}`.toLowerCase()
    return hay.includes(query.toLowerCase())
  }
  const filtered = quotations.filter(matches)

  // One row per company instead of per quotation — a company with 20
  // quotations used to push everything else off the page; now it's one row
  // that expands to show its quotations, same as "top clients" on Home.
  const groups = new Map()
  for (const q of filtered) {
    const name = q.customer?.company || q.customer?.name || 'No customer set'
    const g = groups.get(name) || { name, items: [], value: 0, latest: '' }
    g.items.push(q)
    g.value += q.total || 0
    const d = q.date || q.updatedAt || ''
    if (d > g.latest) g.latest = d
    groups.set(name, g)
  }
  const companies = [...groups.values()].sort((a, b) => (b.latest > a.latest ? 1 : b.latest < a.latest ? -1 : 0))

  // Single-company search results (e.g. arriving from "See all" on a Home
  // client row) don't need the extra click to expand what's already the one match.
  const [expanded, setExpanded] = useState(null)
  const isOpen = (name) => expanded === name || companies.length === 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by company or heading" style={{ width: '100%', minHeight: 54, padding: '0 16px 0 46px', border: '1.5px solid #D5DDE9', borderRadius: 14, fontSize: 16.5, background: '#fff' }} />
          <span style={{ position: 'absolute', left: 15, top: 15 }}><WsSearchIcon /></span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ minHeight: 54, padding: '0 20px', borderRadius: 14, fontSize: 16, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${tab === id ? '#1A73E8' : '#D5DDE9'}`, background: tab === id ? '#1A73E8' : '#fff', color: tab === id ? '#fff' : '#3D4859' }}>{label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {companies.map(g => {
          const open = isOpen(g.name)
          return (
            <div key={g.name} style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 18, overflow: 'hidden' }}>
              <button
                onClick={() => setExpanded(open ? null : g.name)}
                style={{ display: 'flex', width: '100%', flexWrap: 'wrap', alignItems: 'center', gap: 18, padding: '18px 22px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ width: 46, height: 46, flex: '0 0 46px', borderRadius: 12, background: '#E7EEFB', color: '#1A73E8', fontSize: 19, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{g.name.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 16.5, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                  <div style={{ fontSize: 14.5, color: '#6B7688', marginTop: 3 }}>{g.items.length} quotation{g.items.length === 1 ? '' : 's'}</div>
                </div>
                <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                  <div style={{ fontSize: 17, fontWeight: 800 }}>{g.value ? money(g.value) : 'Not priced yet'}</div>
                  <div style={{ fontSize: 14, color: '#8A94A6', marginTop: 3 }}>{formatWsDate(g.latest)}</div>
                </div>
                <span style={{ flex: '0 0 auto', color: '#8A94A6', fontSize: 20, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>⌄</span>
              </button>
              {open && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14, padding: '0 22px 22px' }}>
                  {g.items.map(q => <WsQuoteCard key={q.id} q={q} onOpen={onOpen} onClone={onClone} />)}
                </div>
              )}
            </div>
          )
        })}
        {companies.length === 0 && (
          <div style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 18, padding: '56px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 750 }}>Nothing here yet</div>
            <div style={{ fontSize: 16, color: '#6B7688', marginTop: 6 }}>Make a draft and it is saved here on its own.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function WsInsights({ stats, topClients }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
        {stats.map(c => (
          <div key={c.label} style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 16, padding: 22, overflow: 'hidden', minWidth: 0, boxSizing: 'border-box' }}>
            <div style={{ fontSize: 15, fontWeight: 650, color: '#6B7688' }}>{c.label}</div>
            <div style={wsStatValueStyle(c.value, { fontSize: 29, fontWeight: 800, letterSpacing: '-0.025em' })}>{c.value}</div>
            <div style={{ fontSize: 14, color: '#8A94A6', marginTop: 3 }}>{c.sub}</div>
          </div>
        ))}
      </section>
      <section style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 20, padding: 26 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Top clients by value quoted</div>
        <div style={{ fontSize: 15, color: '#6B7688', margin: '4px 0 18px' }}>Based on the quotations in your workspace.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {topClients.length === 0 && <div style={{ color: '#8A94A6', fontSize: 15 }}>No priced quotations yet.</div>}
          {topClients.map((c, i) => (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 34, height: 34, flex: '0 0 34px', borderRadius: 10, background: '#F1F5FC', color: '#1A73E8', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ height: 10, borderRadius: 6, background: '#edf1f8', marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 6, background: '#1A73E8', width: `${c.pct}%` }} />
                </div>
              </div>
              <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{money(c.value)}</div>
                <div style={{ fontSize: 13.5, color: '#8A94A6' }}>{c.count} quotation{c.count === 1 ? '' : 's'}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function WsAccountSettings({ email, onSignOut }) {
  return (
    <div style={{ maxWidth: 880 }}>
      <section style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 20, padding: 26, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 17, fontWeight: 750 }}>Signed in as</div>
          <div style={{ fontSize: 15, color: '#6B7688', marginTop: 4 }}>{email}</div>
        </div>
        <button onClick={onSignOut} style={{ minHeight: 54, padding: '0 24px', border: '1.5px solid #E7CFCF', borderRadius: 13, background: '#fff', color: '#B03A3A', fontSize: 16.5, fontWeight: 700, cursor: 'pointer' }}>Sign out</button>
      </section>
    </div>
  )
}

function WsTeamComingSoon() {
  const avatars = [
    { initials: 'A', bg: '#1A73E8', delay: '0s' },
    { initials: 'B', bg: '#22B37A', delay: '.15s' },
    { initials: 'C', bg: '#F0A020', delay: '.3s' },
    { initials: 'D', bg: '#8A5CF6', delay: '.45s' }
  ]
  return (
    <div style={{ maxWidth: 720 }}>
      <section style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #EEF4FF 0%, #F7FAFF 55%, #F1FBF6 100%)',
        border: '1px solid #DCE6F8',
        borderRadius: 24,
        padding: '40px 32px',
        textAlign: 'center'
      }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(circle, #C9DAFB 1.5px, transparent 1.5px)',
          backgroundSize: '26px 26px', opacity: 0.5
        }} />

        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 22 }}>
          {avatars.map((a, i) => (
            <div
              key={i}
              className="animate-bounce"
              style={{
                width: 52, height: 52, borderRadius: '50%', background: a.bg, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 18, boxShadow: '0 8px 18px rgba(29,99,237,.18)',
                animationDelay: a.delay, animationDuration: '1.8s'
              }}
            >
              {a.initials}
            </div>
          ))}
        </div>

        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: '#fff', border: '1px solid #DCE6F8', marginBottom: 16 }}>
          <span style={{ position: 'relative', display: 'flex', width: 9, height: 9 }}>
            <span className="animate-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#1A73E8', opacity: 0.6 }} />
            <span style={{ position: 'relative', width: 9, height: 9, borderRadius: '50%', background: '#1A73E8' }} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#1A73E8', letterSpacing: '.03em' }}>COMING SOON</span>
        </div>

        <h2 style={{ position: 'relative', margin: '0 0 10px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: '#2d3748' }}>Your whole team, one workspace</h2>
        <p style={{ position: 'relative', margin: '0 auto', maxWidth: '48ch', fontSize: 16, lineHeight: 1.6, color: '#4C5768' }}>
          Add staff, assign quotations to them, and see who's working on what — all shared under your company account. Right now every quotation belongs to just you.
        </p>
      </section>
    </div>
  )
}

const BILLING_PLANS = [
  {
    key: 'starter', name: 'Starter', tagline: 'For solo founders getting started',
    monthly: 399, yearly: 3990, quotations: 50, grace: 5, seats: 1,
    features: ['No watermark', 'All export formats', 'Email + WhatsApp send', 'Inline editing']
  },
  {
    key: 'growth', name: 'Growth', tagline: 'Best value for growing businesses', popular: true,
    monthly: 799, yearly: 7990, quotations: 125, grace: 10, seats: 3,
    features: ['Everything in Starter', 'Shared clients & products', 'Priority processing']
  },
  {
    key: 'business', name: 'Business', tagline: 'For established SMBs with teams',
    monthly: 1599, yearly: 15990, quotations: 300, grace: 20, seats: 5,
    features: ['Everything in Growth', 'Custom PDF branding', 'Approval workflows']
  },
  {
    key: 'pro', name: 'Pro', tagline: 'For high-volume sales teams',
    monthly: 2999, yearly: 29990, quotations: 750, grace: 50, seats: 10,
    features: ['Everything in Business', 'Custom domain for quote links']
  },
  {
    key: 'enterprise', name: 'Enterprise', tagline: 'For larger organizations',
    monthly: 4999, yearly: 49990, quotations: 1500, grace: 100, seats: 25,
    features: ['Everything in Pro']
  },
  {
    key: 'scale', name: 'Scale', tagline: 'For enterprises operating at scale',
    monthly: 8999, yearly: 89990, quotations: 5000, grace: 200, seats: null,
    features: ['Everything in Enterprise']
  }
]

const BILLING_TOPUPS = [
  { label: '+25 Quotations', quotations: 25, price: 199 },
  { label: '+100 Quotations', quotations: 100, price: 499 },
  { label: '+250 Quotations', quotations: 250, price: 999 }
]

function WsBilling() {
  const [period, setPeriod] = useState('monthly')
  const [notice, setNotice] = useState('')

  const notConnected = (what) => setNotice(`${what} isn't connected yet — PhonePe checkout needs to be wired up on the backend first. Contact us to upgrade manually in the meantime.`)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: '#fff', border: '1px solid #e8edf3', borderRadius: 20, padding: '22px 26px' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 750 }}>Quotations balance</div>
          <div style={{ fontSize: 14.5, color: '#6B7688', marginTop: 4 }}>1 quotation = 1 generation. Edits, conversions & re-exports are free.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: '#1A73E8' }}>—</span>
          <span style={{ fontSize: 15, color: '#8A94A6' }}>usage tracking isn't connected yet</span>
        </div>
      </section>

      <section style={{ textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>Pick a plan that grows with you</h1>
        <p style={{ margin: '0 0 20px', fontSize: 16, color: '#6B7688' }}>Less than the profit on a single quotation. Upgrade or downgrade anytime.</p>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 999, background: '#f0f3f8', border: '1px solid #e8edf3' }}>
          {[['monthly', 'Monthly', null], ['yearly', 'Yearly', '2 months free']].map(([id, label, badge]) => (
            <button
              key={id}
              onClick={() => setPeriod(id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, padding: '0 18px', borderRadius: 999, border: 0, cursor: 'pointer', fontSize: 15, fontWeight: 700, background: period === id ? '#fff' : 'transparent', color: period === id ? '#2d3748' : '#6B7688', boxShadow: period === id ? '0 1px 3px rgba(0,0,0,.08)' : 'none' }}
            >
              {label}
              {badge && <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 800, background: '#E7EEFB', color: '#1A73E8' }}>{badge}</span>}
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 18 }}>
        {BILLING_PLANS.map(p => {
          const price = period === 'monthly' ? p.monthly : p.yearly
          const perMonth = period === 'monthly' ? p.monthly : Math.round(p.yearly / 12)
          const perQuotation = (perMonth / p.quotations).toFixed(2)
          return (
            <div
              key={p.key}
              style={{
                position: 'relative', background: '#fff', borderRadius: 20, padding: 24,
                border: p.popular ? '2px solid #1A73E8' : '1px solid #e8edf3',
                boxShadow: p.popular ? '0 12px 28px rgba(29,99,237,.12)' : 'none',
                display: 'flex', flexDirection: 'column'
              }}
            >
              {p.popular && (
                <span style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', padding: '5px 14px', borderRadius: 999, background: '#1A73E8', color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '.03em' }}>Most Popular</span>
              )}
              <div style={{ fontSize: 18, fontWeight: 800 }}>{p.name}</div>
              <div style={{ fontSize: 13.5, color: '#8A94A6', marginTop: 3, minHeight: 34 }}>{p.tagline}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 14 }}>
                <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>{money(price).replace('.00', '')}</span>
                <span style={{ fontSize: 14, color: '#8A94A6' }}>/{period === 'monthly' ? 'mo' : 'yr'}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#8A94A6', marginTop: 2 }}>~₹{perQuotation} per quotation</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18, flex: 1 }}>
                <PlanCheck>{p.quotations.toLocaleString('en-IN')} quotations / mo <span style={{ color: '#8A94A6', fontWeight: 500 }}>(+{p.grace} grace)</span></PlanCheck>
                {p.features.map(f => <PlanCheck key={f}>{f}</PlanCheck>)}
              </div>
              <button
                onClick={() => notConnected(`Subscribing to ${p.name}`)}
                style={{ marginTop: 20, minHeight: 46, borderRadius: 12, border: p.popular ? 0 : '1.5px solid #D5DDE9', background: p.popular ? '#1A73E8' : '#fff', color: p.popular ? '#fff' : '#2d3748', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
              >
                Subscribe {period === 'monthly' ? 'monthly' : 'yearly'}
              </button>
            </div>
          )
        })}
      </section>

      {notice && (
        <p style={{ textAlign: 'center', fontSize: 14, color: '#B03A3A', background: '#FDF2F2', border: '1px solid #E7CFCF', borderRadius: 12, padding: '12px 16px' }}>{notice}</p>
      )}
      <p style={{ textAlign: 'center', fontSize: 13.5, color: '#8A94A6', margin: 0 }}>Secure payment by PhonePe. Cancel anytime.</p>

      <section style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 800, color: '#1A73E8' }}>+ Need more quotations this month?</h2>
        <p style={{ margin: '0 0 18px', fontSize: 14.5, color: '#6B7688' }}>One-time top-ups. Never expire while your subscription is active.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, maxWidth: 720, margin: '0 auto' }}>
          {BILLING_TOPUPS.map(t => (
            <div key={t.label} style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 16, padding: 20, textAlign: 'left' }}>
              <div style={{ fontSize: 15.5, fontWeight: 750 }}>{t.label}</div>
              <div style={{ fontSize: 13.5, color: '#8A94A6', marginTop: 2 }}>+{t.quotations} quotations</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 10 }}>{money(t.price).replace('.00', '')}</div>
              <button
                onClick={() => notConnected(`Buying ${t.label}`)}
                style={{ marginTop: 12, width: '100%', minHeight: 42, borderRadius: 10, border: '1.5px solid #D5DDE9', background: '#fff', color: '#2d3748', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}
              >
                Buy now
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>Recent payments</h2>
        <div style={{ background: '#fff', border: '1px solid #e8edf3', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: '#3D4859' }}>No payments yet</div>
          <div style={{ fontSize: 14, color: '#8A94A6', marginTop: 4 }}>Subscribe to a plan or buy a top-up and it'll show up here.</div>
        </div>
      </section>
    </div>
  )
}

function PlanCheck({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, lineHeight: 1.4, color: '#3D4859' }}>
      <span style={{ flex: '0 0 auto', color: '#1A73E8', fontWeight: 800 }}>✓</span>
      <span>{children}</span>
    </div>
  )
}

function WsComingSoon({ title, body }) {
  return (
    <div style={{ maxWidth: 720 }}>
      <section style={{ background: '#f5f8fc', border: '1px solid #DCE6F8', borderRadius: 20, padding: 26 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 16, lineHeight: 1.6, color: '#3D4859', marginTop: 8 }}>{body}</div>
      </section>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
