import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  fillWordTemplate,
  fillExcelTemplate,
  inferTemplatePageWidth,
  templatePaperStyle,
  contrastTextForBackground,
  applyReadableTextOnFilledHtml,
  learnExcelPlacements,
  snapshotExcelSheetsFromDom,
  placementsEqual,
  visibleRowCells,
  excelColLetter,
  excelLineItemRange,
  detectExcelTableRegions,
  insertExcelRow,
  removeExcelRow,
  insertExcelColumn,
  removeExcelColumn,
  shiftLayoutEditsForRowChange,
  shiftLayoutEditsForColChange,
  shiftPlacementsForRowChange,
  shiftPlacementsForColChange,
  scrubTransientExcelShell,
  findExtraLineInsertIndex,
  insertWordLineItemColumn,
  removeWordLineItemColumn,
  mapHeadersToFields,
  pickLineItemsTable
} from '../shared/templateMap.js'
import { splitWordHtmlPages, joinWordHtmlPages } from '../shared/uploadWordPages.js'
import { lookupHsnGst, listQuotations, listProducts } from './quotePersistence.js'
import { downloadQuotationPdf, quotationFileName } from './pdfExport.js'
import { downloadFilledExcelSheets, downloadHtmlAsWord, downloadQuotationExcel, downloadQuotationWord } from './officeExport.js'
import { ExportMenu } from './QuoteStudio.jsx'
import BrandMark from './BrandMark.jsx'
import { resolvePaperTheme, accentForTableColor } from './quotePaperThemes.js'
import { SuggestField } from './SuggestField.jsx'
import FormulaGuide from './FormulaGuide.jsx'
import { applyProductToItem, clientsFromQuotations, matchClients, matchProducts, productsFromHistory } from './suggestCatalog.js'
import {
  amountKey,
  blankExtraLine,
  blankItemFor,
  columnType,
  computeQuoteTotals,
  extraLineResolvedAmount,
  extraLineUnit,
  isImageColumn,
  isNestedColumn,
  nestedFieldInfo,
  rateKey,
  recalcRow,
  sourceKey
} from '../shared/quoteColumns.js'
import {
  canHaveFormula,
  formulaForAddedColumn,
  formulaSentence,
  isFormulaColumn
} from '../shared/quoteFormulas.js'
import { attachSuggestedColumn, fillSuggestedOnItems, SUGGESTED_COLUMN_ENABLED, withoutSuggestedColumns } from '../shared/productKeywords.js'

function styleToCss(style = {}) {
  const css = {}
  if (style.fontFamily) css.fontFamily = `'${style.fontFamily}', Calibri, Arial, sans-serif`
  if (style.fontSize) css.fontSize = `${style.fontSize}pt`
  if (style.fontWeight) css.fontWeight = style.fontWeight
  if (style.fontStyle) css.fontStyle = style.fontStyle
  if (style.textDecoration) css.textDecoration = style.textDecoration
  if (style.color) css.color = style.color
  if (style.backgroundColor) css.backgroundColor = style.backgroundColor
  if (style.textAlign) css.textAlign = style.textAlign
  if (style.verticalAlign) css.verticalAlign = style.verticalAlign
  if (style.wrapText) css.whiteSpace = 'pre-wrap'
  if (style.borderTop) css.borderTop = style.borderTop
  if (style.borderRight) css.borderRight = style.borderRight
  if (style.borderBottom) css.borderBottom = style.borderBottom
  if (style.borderLeft) css.borderLeft = style.borderLeft
  return css
}

function cellStyleWithContrast(style = {}) {
  const css = styleToCss(style)
  if (css.backgroundColor) {
    css.color = contrastTextForBackground(css.backgroundColor)
  }
  return css
}

function layoutCellKey(sheetIndex, rowIndex, col) {
  return `${sheetIndex}:${rowIndex}:${col}`
}

/** Undo accidental "Rohan MehtaRohan Mehta" doubling from earlier fill bugs. */
function undoubleText(text) {
  const t = String(text ?? '')
  const n = t.length
  if (n >= 4 && n % 2 === 0) {
    const half = t.slice(0, n / 2)
    if (half && half === t.slice(n / 2)) return half
  }
  return t
}

function ExcelInlineCell({
  cell,
  row,
  sheetIndex,
  quote,
  suggestClients,
  suggestProducts,
  pickClient,
  applyProduct,
  setItemField,
  setCustomerField,
  update,
  setLayoutEdit
}) {
  const prefix = cell.labelPrefix || ''
  const rawStored = undoubleText(String(cell.value ?? ''))
  const rawValue = prefix && rawStored.startsWith(prefix)
    ? rawStored.slice(prefix.length)
    : rawStored
  const fieldId = cell.fieldId || null
  const itemIndex = Number.isInteger(cell.itemIndex) ? cell.itemIndex : null
  const custField = customerFieldFromRole(cell.role)
  const layoutKey = layoutCellKey(sheetIndex, row.index, cell.col)
  const inputClass = 'upload-excel-input qg-inline-field'
  const edits = quote.fields?.layoutEdits || {}
  const hasLayoutEdit = Object.prototype.hasOwnProperty.call(edits, layoutKey)

  let value = hasLayoutEdit ? undoubleText(edits[layoutKey]) : rawValue
  let onChange = (v) => setLayoutEdit(layoutKey, v)
  let multiline = /\n/.test(String(value || '')) || String(value || '').length > 80
  let suggest = null

  if (cell.formula) {
    return (
      <input
        value={hasLayoutEdit ? undoubleText(edits[layoutKey]) : rawValue}
        onChange={(e) => setLayoutEdit(layoutKey, e.target.value)}
        className={inputClass}
        title={`=${cell.formula}`}
        data-qg-cell-key={layoutKey}
      />
    )
  }

  const syncRole = (role, v) => {
    setLayoutEdit(layoutKey, v)
    if (role === 'quote_number') update(['number'], v)
    else if (role === 'date') update(['date'], v)
    else if (role === 'valid_until') update(['fields', 'validUntil'], v)
    else if (role === 'subject') update(['title'], v)
    else if (role === 'notes') update(['notes'], String(v).split('\n'))
    else if (custField) setCustomerField(custField, v)
  }

  // User override always wins — they may have moved data off an auto-mapped cell.
  if (!hasLayoutEdit) {
    if (itemIndex != null && fieldId && fieldId !== '__sr__' && fieldId !== 'sr') {
      const isDesc = fieldId === 'description' || fieldId === 'specification' || fieldId === 'item'
      if (isDesc) {
        value = undoubleText(quote.items?.[itemIndex]?.[fieldId === 'specification' ? 'specification' : 'description'] ?? rawValue)
        onChange = (v) => {
          setLayoutEdit(layoutKey, v)
          setItemField(itemIndex, fieldId === 'specification' ? 'specification' : 'description', v)
        }
        multiline = true
        suggest = {
          items: productSuggestionItems(suggestProducts, quote.items?.[itemIndex]?.description),
          onPick: (item) => applyProduct(itemIndex, item.product, fieldId === 'specification' ? 'specification' : 'description')
        }
      } else {
        value = undoubleText(quote.items?.[itemIndex]?.[fieldId] ?? rawValue)
        onChange = (v) => {
          setLayoutEdit(layoutKey, v)
          setItemField(itemIndex, fieldId, v)
        }
      }
    } else if (custField) {
      value = undoubleText(quote.customer?.[custField] ?? rawValue)
      onChange = (v) => syncRole(cell.role, v)
      suggest = {
        items: clientSuggestionItems(suggestClients, quote.customer?.[custField], custField),
        onPick: (item) => pickClient(item.client)
      }
    } else if (cell.role === 'quote_number') {
      value = undoubleText(quote.number ?? rawValue)
      onChange = (v) => syncRole('quote_number', v)
    } else if (cell.role === 'date') {
      value = undoubleText(quote.date ?? rawValue)
      onChange = (v) => syncRole('date', v)
    } else if (cell.role === 'valid_until') {
      value = undoubleText(quote.fields?.validUntil || quote.validUntil || rawValue)
      onChange = (v) => syncRole('valid_until', v)
    } else if (cell.role === 'subject') {
      value = undoubleText(quote.title ?? rawValue)
      onChange = (v) => syncRole('subject', v)
    } else if (cell.role === 'notes') {
      value = undoubleText((quote.notes || []).filter(Boolean).join('\n') || rawValue)
      onChange = (v) => syncRole('notes', v)
      multiline = true
    }
  } else if (custField || ['quote_number', 'date', 'valid_until', 'subject', 'notes'].includes(cell.role)) {
    onChange = (v) => syncRole(cell.role === 'notes' ? 'notes' : cell.role, v)
    if (cell.role === 'notes') multiline = true
  } else if (itemIndex != null && fieldId && fieldId !== '__sr__' && fieldId !== 'sr') {
    onChange = (v) => {
      setLayoutEdit(layoutKey, v)
      setItemField(itemIndex, fieldId === 'specification' ? 'specification' : fieldId === 'item' ? 'description' : fieldId, v)
    }
  }

  const printValue = prefix ? `${prefix}${value}` : value

  if (multiline && suggest) {
    return (
      <div className="px-1 py-0.5">
        {prefix ? <span className="mr-1 shrink-0 opacity-80">{prefix}</span> : null}
        <SuggestField
          multiline
          value={value}
          onChange={onChange}
          suggestions={suggest.items}
          onPick={suggest.onPick}
          placeholder="Product"
          className={`${inputClass} w-full min-w-0 px-1 py-0.5 text-sm`}
          cellKey={layoutKey}
        />
      </div>
    )
  }

  if (suggest) {
    return (
      <div className="flex items-center gap-1 px-1">
        {prefix ? <span className="shrink-0 opacity-80">{prefix}</span> : null}
        <SuggestField
          value={value}
          onChange={onChange}
          suggestions={suggest.items}
          onPick={suggest.onPick}
          placeholder={custField || 'Edit'}
          className={`${inputClass} w-full min-w-0 px-1 py-0.5 text-sm`}
          cellKey={layoutKey}
        />
      </div>
    )
  }

  if (multiline) {
    return (
      <>
        {prefix ? <span className="px-1.5 pt-1 block text-[10px] opacity-70">{prefix}</span> : null}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={Math.max(2, String(value || '').split('\n').length)}
          className={`${inputClass} resize-none`}
          data-qg-cell-key={layoutKey}
        />
      </>
    )
  }

  if (prefix) {
    return (
      <div className="flex items-center gap-1 px-1">
        <span className="shrink-0 opacity-80">{prefix}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          data-qg-cell-key={layoutKey}
        />
      </div>
    )
  }

  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
      aria-label={printValue || 'Edit cell'}
      data-qg-cell-key={layoutKey}
    />
  )
}

function money(n) {
  return `₹ ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function isLayoutTotalRow(node) {
  const text = String(node?.innerText || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length > 120) return false
  if (/grand\s*total|net\s*(amount|total|payable)|total\s*amount/i.test(text)) return true
  return /^(sub\s*)?total\b/i.test(text) && /[\d,]/.test(text)
}

function findLayoutTotalRow(root) {
  const rows = Array.from(root?.querySelectorAll?.('tr') || [])
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isLayoutTotalRow(rows[i])) return rows[i]
  }
  return null
}

function LayoutTotalsExtraLines({ lines, base, grandTotal, showGrandTotal = true, onAdd, onUpdate, onRemove }) {
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
    <div className="upload-layout-extras no-print" contentEditable={false} suppressContentEditableWarning>
      {(lines || []).map((line, i) => {
        const resolved = extraLineResolvedAmount(line, base)
        const isLess = line.kind !== 'add'
        const isPercent = extraLineUnit(line) === 'percent'
        return (
          <div key={line.id || i} className="mt-1.5 flex items-center gap-1">
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
              placeholder="Name (Freight, Discount…)"
              className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] text-slate-600 outline-none placeholder:text-slate-300"
            />
            <input
              value={line.amount ?? ''}
              onChange={e => onUpdate(i, { amount: e.target.value })}
              placeholder="0"
              inputMode="decimal"
              className="w-16 bg-transparent py-0.5 text-right text-[13px] text-slate-600 outline-none placeholder:text-slate-300"
            />
            <button
              type="button"
              title={isPercent ? 'Percent of total' : 'Rupee amount'}
              onClick={() => onUpdate(i, { unit: isPercent ? 'amount' : 'percent' })}
              className="w-5 shrink-0 text-xs text-slate-400 hover:text-slate-600"
            >
              {isPercent ? '%' : '₹'}
            </button>
            <span className="w-20 text-right text-[12px] text-slate-500">{money(resolved)}</span>
            <button type="button" onClick={() => onRemove(i)} title="Remove" className="w-4 shrink-0 text-slate-300 hover:text-rose-500">×</button>
          </div>
        )
      })}
      <div className="mt-2 flex flex-col items-end gap-1">
        {showGrandTotal && grandTotal != null ? (
          <p className="text-sm font-semibold text-slate-700">Total {money(grandTotal)}</p>
        ) : null}
        <button type="button" onClick={add} className="text-[12px] text-slate-400 hover:text-moss">
          + add line
        </button>
      </div>
    </div>
  )
}

function TableRegionToolbar({ region, colSpan = 2, onAddRow, onAddColumn, onAddFormulaColumn, onAddLineItem }) {
  const label = region.kind === 'line_items' ? 'Line items table' : 'Table'
  return (
    <tr className="no-print upload-excel-region-toolbar">
      <td colSpan={colSpan}>
        <div className="flex flex-wrap items-center gap-2 px-2 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-moss">{label}</span>
          <button type="button" className="upload-excel-region-btn" onClick={() => onAddRow(region)}>
            + Add row
          </button>
          <button type="button" className="upload-excel-region-btn" onClick={() => onAddColumn(region)}>
            + Add column
          </button>
          <button type="button" className="upload-excel-region-btn upload-excel-region-btn--fx" onClick={() => onAddFormulaColumn(region)}>
            fx Formula column
          </button>
          {region.kind === 'line_items' ? (
            <button type="button" className="upload-excel-region-btn" onClick={() => onAddLineItem(region)}>
              + Add line item
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function saveStatusLabel(status) {
  if (status === 'saving') return 'Saving to cloud…'
  if (status === 'saved') return 'Saved to cloud'
  if (status === 'unavailable') return 'Local only — configure Supabase to autosave'
  if (status === 'error') return 'Could not save — will retry on next edit'
  return 'Changes save when you edit'
}

function slugifyLocal(label) {
  const base = label.trim().toLowerCase()
    .replace(/[^a-z0-9%]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9%]/g, '')
    .replace(/^./, c => c.toLowerCase())
  return base || 'column'
}

function uniqueIdLocal(label, existing) {
  let id = slugifyLocal(label)
  let n = 2
  while (existing.some(c => c.id === id)) { id = `${slugifyLocal(label)}${n++}` }
  return id
}

function clientSuggestionItems(clients, query, field) {
  return matchClients(clients, query, field).map(c => ({
    id: `${c.company}|${c.gst}|${c.name}`,
    title: c.company || c.name || c.gst,
    meta: [c.name && c.company ? c.name : '', c.gst, c.location].filter(Boolean).join(' · '),
    client: c
  }))
}

function productSuggestionItems(products, query) {
  return matchProducts(products, query).map(p => ({
    id: `${p.description}|${p.hsn}|${p.rate}`,
    title: p.description || p.hsn || 'Product',
    meta: [p.hsn, p.unit, p.rate !== '' ? `₹ ${p.rate}` : ''].filter(Boolean).join(' · '),
    product: p
  }))
}

function customerFieldFromRole(role) {
  if (role === 'customer_name') return 'name'
  if (role === 'customer_gst') return 'gst'
  if (role === 'customer_location') return 'location'
  if (role === 'customer_company' || role === 'customer_block') return 'company'
  return null
}

function ensureHsnGstColumnsLocal(columns) {
  const next = Array.isArray(columns) ? [...columns] : []
  const hasHsn = next.some(c => /hsn|sac/i.test(String(c.id)) || /hsn|sac/i.test(String(c.label)))
  const toAdd = []
  if (!hasHsn) toAdd.push({ id: uniqueIdLocal('HSN Code', [...next, ...toAdd]), label: 'HSN Code', type: 'hsn', digits: '4' })
  if (!toAdd.length) return columns
  // Match native quote placement: HSN before qty/rate.
  const qtyIdx = next.findIndex(c => c.id === 'quantity' || /qty|quantity/i.test(`${c.id} ${c.label}`))
  const rateIdx = next.findIndex(c => c.id === 'rate' || /^rate$/i.test(c.label || ''))
  const candidates = [qtyIdx, rateIdx].filter(i => i >= 0)
  const idx = candidates.length ? Math.min(...candidates) : (() => {
    const unitIdx = next.findIndex(c => c.id === 'unit')
    return unitIdx >= 0 ? unitIdx : next.length
  })()
  next.splice(idx, 0, ...toAdd)
  return next
}

export default function UploadedTemplateQuote({
  template,
  quote,
  columns,
  total,
  onNew,
  onHome,
  onRetry,
  update,
  saveStatus = 'idle',
  companyProfile,
  persistenceConfigured = false,
  onColumnsChange
}) {
  const design = template.design || {}
  const type = template.type
  const pageRefs = useRef([])
  const [hsnFetching, setHsnFetching] = useState(null)
  const [hsnNote, setHsnNote] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const [historyQuotes, setHistoryQuotes] = useState([])
  const [catalogProducts, setCatalogProducts] = useState([])
  const [placements, setPlacements] = useState(() => template.mapping?.placements || {})
  const [placementNote, setPlacementNote] = useState('')
  const [baseSheets, setBaseSheets] = useState(() => structuredClone(template.content?.sheets || []))
  const [wordHtmlBase, setWordHtmlBase] = useState(() => template.content?.html || '')
  const [structureNote, setStructureNote] = useState('')
  const [structureBusy, setStructureBusy] = useState(false)
  const [structureDirty, setStructureDirty] = useState(false)
  const [formulaColId, setFormulaColId] = useState(null)
  const suggestedFillSigRef = useRef('')
  const rememberingRef = useRef(false)
  const structureSavingRef = useRef(false)
  const wordStructRef = useRef({ addRowAfterItem: () => {}, addColAfter: () => {} })
  const profile = companyProfile || quote.companyProfile || null
  const paperTheme = resolvePaperTheme(quote.paperStyle || 'corporate', accentForTableColor(quote.tableColorId || 'blue', quote.logoPalette))
  const docLabel = (quote.docType || quote.doc_type) === 'invoice' ? 'TAX INVOICE' : 'QUOTATION'

  // Uploaded layouts keep their own Total/GST/Discount rows verbatim, so the
  // real figures are computed here and filled into those rows — same engine as
  // the original QuoteGen layout (formulas + extra lines below subtotal).
  const totals = useMemo(
    () => computeQuoteTotals(quote.items || [], columns, quote.extraLines),
    [quote.items, columns, quote.extraLines]
  )
  const suggestClients = useMemo(() => clientsFromQuotations(historyQuotes, quote.customer), [historyQuotes, quote.customer])
  const suggestProducts = useMemo(
    () => productsFromHistory(historyQuotes, catalogProducts, quote.items),
    [historyQuotes, catalogProducts, quote.items]
  )

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
  }, [])

  useEffect(() => {
    if (!SUGGESTED_COLUMN_ENABLED) {
      const nextColumns = withoutSuggestedColumns(columns)
      if (nextColumns.length !== columns.length) {
        onColumnsChange?.(nextColumns)
        update(['columns'], nextColumns)
      }
      return
    }
    if (!catalogProducts.length) return
    const sig = catalogProducts.map(p => p.key || p.description).join(',')
    if (suggestedFillSigRef.current === sig) return
    suggestedFillSigRef.current = sig
    const attached = attachSuggestedColumn(columns, quote.items || [])
    const filled = fillSuggestedOnItems(attached.items, attached.columns, catalogProducts)
    if (attached.columns !== columns) {
      onColumnsChange?.(attached.columns)
      update(['columns'], attached.columns)
    }
    if (filled.some((it, i) => it !== (quote.items || [])[i])) update(['items'], filled)
  }, [catalogProducts])

  const pickClient = (client) => {
    if (!client) return
    update(['customer'], {
      ...(quote.customer || {}),
      company: client.company || quote.customer?.company || '',
      name: client.name || quote.customer?.name || '',
      gst: client.gst || quote.customer?.gst || '',
      location: client.location || quote.customer?.location || ''
    })
  }

  const applyProduct = (rowIndex, product, typedColId) => {
    const current = quote.items?.[rowIndex] || {}
    update(['items', rowIndex], recalcRow(applyProductToItem(current, columns, product, typedColId), columns))
  }

  const setItemField = (rowIndex, field, value) => {
    const current = quote.items?.[rowIndex] || {}
    update(['items', rowIndex], recalcRow({ ...current, [field]: value }, columns, { editingKey: field }))
  }

  const setCustomerField = (field, value) => {
    update(['customer', field], value)
  }

  const setLayoutEdit = (key, value) => {
    update(['fields', 'layoutEdits'], { ...(quote.fields?.layoutEdits || {}), [key]: value })
  }

  useEffect(() => {
    setPlacements(template.mapping?.placements || {})
  }, [template.id, template.mapping?.placements])

  useEffect(() => {
    setBaseSheets(structuredClone(template.content?.sheets || []))
    setWordHtmlBase(template.content?.html || '')
    setStructureDirty(false)
    setStructureNote('')
  }, [template.id])

  const excelSheets = useMemo(() => {
    if (type !== 'excel') return []
    return fillExcelTemplate(baseSheets, quote, columns, design, totals, { placements })
    // layoutEdits must NOT be a dependency — refilling on every keystroke invented
    // ghost cells in merge gaps and doubled field text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    type,
    baseSheets,
    columns,
    design,
    totals,
    placements,
    quote.number,
    quote.date,
    quote.title,
    quote.customer,
    quote.items,
    quote.notes,
    quote.fields?.validUntil,
    quote.validUntil
  ])

  const sheetIndex = template.content?.activeSheet || 0
  const pageWidthPx = useMemo(() => {
    if (type === 'excel') {
      const live = excelSheets[sheetIndex] || excelSheets[0] || baseSheets[sheetIndex] || baseSheets[0]
      return inferTemplatePageWidth('excel', live ? [live] : [], design)
    }
    return inferTemplatePageWidth('word', wordHtmlBase || template.content?.html, design)
  }, [type, excelSheets, sheetIndex, baseSheets, design, wordHtmlBase, template.content?.html])

  const rememberPlacements = async (snapshotSheets) => {
    if (type !== 'excel' || !template?.id || rememberingRef.current) return null
    const layoutEdits = quote.fields?.layoutEdits || {}
    const snapshot = snapshotSheets || snapshotExcelSheetsFromDom(excelSheets)
    const learned = learnExcelPlacements(snapshot, quote, layoutEdits, placements)
    if (placementsEqual(learned, placements)) return null
    rememberingRef.current = true
    try {
      const res = await fetch(`/api/upload-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping: { placements: learned } })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Could not remember layout placements.')
      }
      setPlacements(learned)
      setPlacementNote('Layout memory updated — future quotes will fill the corrected cells.')
      return learned
    } catch (error) {
      console.warn('[upload-layout] remember failed', error)
      setPlacementNote(error.message || 'Could not save layout memory.')
      return null
    } finally {
      rememberingRef.current = false
    }
  }

  const saveStructureToTemplate = async (sheetsOverride) => {
    if (!template?.id || structureSavingRef.current) return false
    structureSavingRef.current = true
    setStructureBusy(true)
    try {
      const payload = type === 'excel'
        ? {
          content: {
            sheets: scrubTransientExcelShell(sheetsOverride || snapshotExcelSheetsFromDom(excelSheets)),
            activeSheet: sheetIndex
          },
          mapping: { placements }
        }
        : {
          content: {
            html: wordHtmlBase,
            pages: splitWordHtmlPages(wordHtmlBase)
          }
        }
      const res = await fetch(`/api/upload-templates/${template.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Could not save table structure.')
      }
      if (type === 'excel') {
        const snap = payload.content.sheets
        setBaseSheets(structuredClone(snap))
      }
      setStructureDirty(false)
      setStructureNote('Table structure saved on this template — future quotes will use it.')
      return true
    } catch (error) {
      console.warn('[upload-layout] structure save failed', error)
      setStructureNote(error.message || 'Could not save table structure.')
      return false
    } finally {
      structureSavingRef.current = false
      setStructureBusy(false)
    }
  }

  const emptyQuoteItem = () => blankItemFor(columns || [])

  const handleWordAddRowAfterItem = (itemIndex) => {
    const items = [...(quote.items || [])]
    const at = Math.max(-1, Number(itemIndex))
    items.splice(Math.min(at + 1, items.length), 0, emptyQuoteItem())
    update(['items'], items)
  }

  const handleWordRemoveRow = (itemIndex) => {
    const items = [...(quote.items || [])]
    if (items.length <= 1) return
    const at = Math.max(0, Number(itemIndex))
    if (at >= items.length) return
    items.splice(at, 1)
    update(['items'], items)
  }

  const handleWordAddColumnAfter = (colIndex) => {
    const label = `Column ${(columns || []).length + 1}`
    const nextHtml = insertWordLineItemColumn(wordHtmlBase || template.content?.html || '', colIndex, { label })
    if (nextHtml === (wordHtmlBase || template.content?.html || '')) return
    setWordHtmlBase(nextHtml)
    setStructureDirty(true)
    setStructureNote('Column added — click “Save structure” to keep it for future quotes on this template.')
    const col = { id: uniqueIdLocal(label, columns || []), label, type: 'text' }
    const nextColumns = [...(columns || []), col]
    onColumnsChange?.(nextColumns)
    update(['columns'], nextColumns)
    update(['items'], (quote.items || []).map(item => recalcRow({ ...item }, nextColumns)))
  }

  const handleWordRemoveColumn = (colIndex) => {
    const html = wordHtmlBase || template.content?.html || ''
    const picked = pickLineItemsTable(html)
    if (!picked || (picked.headers || []).length <= 1) return
    const fieldIds = mapHeadersToFields(picked.headers, columns || [])
    const fieldId = fieldIds[colIndex]
    const nextHtml = removeWordLineItemColumn(html, colIndex)
    if (nextHtml === html) return
    setWordHtmlBase(nextHtml)
    setStructureDirty(true)
    setStructureNote('Column removed — click “Save structure” to keep it for future quotes on this template.')
    if (fieldId && fieldId !== '__sr__' && fieldId !== 'sr') {
      const nextColumns = (columns || []).filter(c => c.id !== fieldId)
      onColumnsChange?.(nextColumns)
      update(['columns'], nextColumns)
      update(['items'], (quote.items || []).map(item => {
        const next = { ...item }
        delete next[fieldId]
        return recalcRow(next, nextColumns)
      }))
    }
  }

  wordStructRef.current = {
    addRowAfterItem: handleWordAddRowAfterItem,
    removeRow: handleWordRemoveRow,
    addColAfter: handleWordAddColumnAfter,
    removeCol: handleWordRemoveColumn
  }

  const wireWordStructureHits = (editorEl) => {
    if (!editorEl) return
    editorEl.querySelectorAll('.qg-struct-hit').forEach((node) => node.remove())
    const table = editorEl.querySelector('table:has([data-qg-item])') || Array.from(editorEl.querySelectorAll('table')).find(t => t.querySelector('[data-qg-item]'))
    if (!table) return
    table.classList.add('qg-struct-table')
    const itemCount = (quote.items || []).length
    Array.from(table.rows || []).forEach((tr) => {
      const itemCell = tr.querySelector('[data-qg-item]')
      if (!itemCell) return
      const itemIdx = Number(itemCell.getAttribute('data-qg-item'))
      if (!Number.isInteger(itemIdx)) return
      const first = tr.cells[0] || itemCell
      if (getComputedStyle(first).position === 'static') first.style.position = 'relative'
      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'qg-struct-hit qg-struct-hit-row no-print'
      add.textContent = '+'
      add.title = 'Add row below'
      add.setAttribute('contenteditable', 'false')
      add.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
      add.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        wordStructRef.current.addRowAfterItem(itemIdx)
      })
      first.appendChild(add)
      if (itemCount > 1) {
        const del = document.createElement('button')
        del.type = 'button'
        del.className = 'qg-struct-hit qg-struct-hit-row-remove no-print'
        del.textContent = '×'
        del.title = 'Remove this row'
        del.setAttribute('contenteditable', 'false')
        del.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
        del.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          wordStructRef.current.removeRow(itemIdx)
        })
        first.appendChild(del)
      }
    })
    const rows = Array.from(table.rows || [])
    const firstItemAt = rows.findIndex(tr => tr.querySelector('[data-qg-item]'))
    const headerRow = firstItemAt > 0 ? rows[firstItemAt - 1] : rows[0]
    if (headerRow) {
      headerRow.classList.add('qg-struct-header-row')
      const cellCount = headerRow.cells.length
      Array.from(headerRow.cells || []).forEach((cell, ci) => {
        cell.classList.add('qg-struct-header-cell')
        if (getComputedStyle(cell).position === 'static') cell.style.position = 'relative'
        const add = document.createElement('button')
        add.type = 'button'
        add.className = 'qg-struct-hit qg-struct-hit-col no-print'
        add.textContent = '+'
        add.title = 'Add column after'
        add.setAttribute('contenteditable', 'false')
        add.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
        add.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          wordStructRef.current.addColAfter(ci)
        })
        cell.appendChild(add)
        if (cellCount > 1) {
          const del = document.createElement('button')
          del.type = 'button'
          del.className = 'qg-struct-hit qg-struct-hit-col-remove no-print'
          del.textContent = '×'
          del.title = 'Remove this column'
          del.setAttribute('contenteditable', 'false')
          del.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
          del.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            wordStructRef.current.removeCol(ci)
          })
          cell.appendChild(del)
        }
      })
    }
    const itemRows = rows.filter(tr => tr.querySelector('[data-qg-item]'))
    itemRows.forEach((tr, i) => {
      const textLen = String(tr.innerText || '').replace(/\u00a0/g, ' ').trim().length
      if (textLen > 12) {
        tr.style.minHeight = ''
        Array.from(tr.cells || []).forEach((c) => { c.style.minHeight = '' })
        return
      }
      const prevH = itemRows[i - 1]?.getBoundingClientRect().height || 0
      const target = Math.max(36, Math.round(prevH || 36))
      if (tr.getBoundingClientRect().height + 1 < target) {
        tr.style.minHeight = `${target}px`
        Array.from(tr.cells || []).forEach((c) => { c.style.minHeight = `${Math.max(28, target - 6)}px` })
      }
    })
  }

  const applyStructureSheets = (nextSheets, nextPlacements, nextEdits) => {
    setBaseSheets(nextSheets)
    setPlacements(nextPlacements)
    setStructureDirty(true)
    if (nextEdits) update(['fields', 'layoutEdits'], nextEdits)
    setStructureNote('Table changed — click “Save structure” to keep it for future quotes on this template.')
  }

  const handleAddRow = (afterRi) => {
    const si = sheetIndex
    const next = structuredClone(baseSheets)
    const sheet = next[si]
    if (!sheet) return
    const range = excelLineItemRange(sheet)
    const inItems = range && afterRi >= range.headerRowIndex && afterRi < range.end
    insertExcelRow(sheet, afterRi, { asLineItem: Boolean(inItems) })
    const edits = shiftLayoutEditsForRowChange(quote.fields?.layoutEdits || {}, si, afterRi, 1)
    const nextPlacements = shiftPlacementsForRowChange(placements, si, afterRi, 1)
    if (inItems) {
      const items = [...(quote.items || [])]
      const insertAt = Math.max(0, afterRi - range.headerRowIndex)
      items.splice(Math.min(insertAt, items.length), 0, emptyQuoteItem())
      update(['items'], items)
    }
    applyStructureSheets(next, nextPlacements, edits)
  }

  const handleAddRowInRegion = (region) => {
    handleAddRow(region.endRi)
  }

  const handleAddLineItemInRegion = (region) => {
    const live = baseSheets[sheetIndex]
    const range = excelLineItemRange(live)
    const afterRi = range ? Math.max(range.start, range.end - 1) : region.endRi
    handleAddRow(afterRi)
  }

  const handleRemoveRow = (ri) => {
    const si = sheetIndex
    const next = structuredClone(baseSheets)
    const sheet = next[si]
    if (!sheet || (sheet.rows || []).length <= 1) return
    const range = excelLineItemRange(sheet)
    const inItems = range && ri >= range.start && ri < range.end
    removeExcelRow(sheet, ri)
    const edits = shiftLayoutEditsForRowChange(quote.fields?.layoutEdits || {}, si, ri, -1)
    const nextPlacements = shiftPlacementsForRowChange(placements, si, ri, -1)
    if (inItems) {
      const items = [...(quote.items || [])]
      const itemAt = ri - range.start
      if (itemAt >= 0 && itemAt < items.length && items.length > 1) {
        items.splice(itemAt, 1)
        update(['items'], items)
      }
    }
    applyStructureSheets(next, nextPlacements, edits)
  }

  const handleAddColumn = (afterCol) => {
    const si = sheetIndex
    const next = structuredClone(baseSheets)
    const sheet = next[si]
    if (!sheet) return
    insertExcelColumn(sheet, afterCol)
    const edits = shiftLayoutEditsForColChange(quote.fields?.layoutEdits || {}, si, afterCol, 1)
    const nextPlacements = shiftPlacementsForColChange(placements, si, afterCol, 1)
    applyStructureSheets(next, nextPlacements, edits)
  }

  const handleAddColumnInRegion = (region) => {
    handleAddColumn(region.maxCol)
  }

  const handleAddFormulaColumn = (region) => {
    const si = sheetIndex
    const next = structuredClone(baseSheets)
    const sheet = next[si]
    if (!sheet) return
    const afterCol = region.maxCol
    insertExcelColumn(sheet, afterCol)
    const newColNum = afterCol + 1
    const label = 'Calculated'
    const col = {
      id: uniqueIdLocal(label, columns || []),
      label,
      type: 'text',
      calculated: true
    }
    if (canHaveFormula(col, [...(columns || []), col])) {
      const formula = formulaForAddedColumn(col, [...(columns || []), col], { guessTokens: true })
      if (formula) col.formula = formula
    }
    const headerRow = sheet.rows?.[region.headerRi]
    const headerCell = headerRow?.cells?.find(c => Number(c.col) === newColNum)
    if (headerCell) {
      headerCell.value = label
      headerCell.role = 'content'
    }
    // Tag line-item cells with the new field so fill maps immediately
    const range = excelLineItemRange(sheet)
    if (range) {
      for (let ri = range.start; ri < range.end; ri++) {
        const cell = sheet.rows[ri]?.cells?.find(c => Number(c.col) === newColNum)
        if (cell) {
          cell.fieldId = col.id
          cell.role = 'line_item'
        }
      }
    }
    const edits = shiftLayoutEditsForColChange(quote.fields?.layoutEdits || {}, si, afterCol, 1)
    const nextPlacements = shiftPlacementsForColChange(placements, si, afterCol, 1)
    const nextColumns = [...(columns || []), col]
    onColumnsChange?.(nextColumns)
    update(['columns'], nextColumns)
    const nextItems = (quote.items || []).map(item => recalcRow({ ...item }, nextColumns))
    update(['items'], nextItems)
    applyStructureSheets(next, nextPlacements, edits)
    setFormulaColId(col.id)
  }

  const saveColumnFormula = (colId, formula) => {
    const nextColumns = (columns || []).map((c) => {
      if (c.id !== colId) return c
      const next = { ...c }
      if (formula) {
        next.formula = formula
        const amountCol = (columns || []).find(x => String(x?.id || '').toLowerCase() === 'amount')
          || (columns || []).find(x => /amount/i.test(String(x?.label || '')))
        if (!amountCol || c.id !== amountCol.id) next.calculated = true
      } else {
        delete next.formula
      }
      return next
    })
    onColumnsChange?.(nextColumns)
    update(['columns'], nextColumns)
    const nextItems = (quote.items || []).map(item => recalcRow({ ...item }, nextColumns))
    update(['items'], nextItems)
    setFormulaColId(null)
  }

  const handleRemoveColumn = (col) => {
    const si = sheetIndex
    const next = structuredClone(baseSheets)
    const sheet = next[si]
    if (!sheet || (sheet.columns || []).length <= 1) return
    removeExcelColumn(sheet, col)
    const edits = shiftLayoutEditsForColChange(quote.fields?.layoutEdits || {}, si, col, -1)
    const nextPlacements = shiftPlacementsForColChange(placements, si, col, -1)
    applyStructureSheets(next, nextPlacements, edits)
  }

  const extraLines = Array.isArray(quote.extraLines) ? quote.extraLines : []
  const setExtraLines = (next) => update(['extraLines'], next)
  const addExtraLine = (line) => {
    const entry = line || blankExtraLine()
    setExtraLines([...extraLines, entry])
    // Mirror a labeled row into the layout before Grand Total so it shows on-screen
    const si = sheetIndex
    const next = structuredClone(baseSheets)
    const sheet = next[si]
    if (sheet) {
      const insertAt = findExtraLineInsertIndex(sheet)
      const afterRi = Math.max(-1, insertAt - 1)
      insertExcelRow(sheet, afterRi, { asLineItem: false })
      const row = sheet.rows[afterRi + 1]
      if (row?.cells?.length) {
        const labelCell = row.cells[0]
        const amountCell = row.cells[row.cells.length - 1]
        if (labelCell) {
          labelCell.value = entry.label || 'Extra'
          labelCell.role = 'extra_line'
        }
        if (amountCell && amountCell !== labelCell) {
          amountCell.value = ''
          amountCell.role = 'extra_line'
        }
      }
      const edits = shiftLayoutEditsForRowChange(quote.fields?.layoutEdits || {}, si, afterRi, 1)
      const nextPlacements = shiftPlacementsForRowChange(placements, si, afterRi, 1)
      applyStructureSheets(next, nextPlacements, edits)
    }
  }
  const updateExtraLine = (i, patch) => {
    const next = extraLines.map((row, index) => (index === i ? { ...row, ...patch } : row))
    setExtraLines(next)
    // Keep label text in the mirrored sheet row in sync when possible
    if (patch.label != null) {
      const si = sheetIndex
      const sheets = structuredClone(baseSheets)
      const sheet = sheets[si]
      const want = String(extraLines[i]?.label || '').trim().toLowerCase()
      if (sheet && want) {
        for (const row of sheet.rows || []) {
          const cell = (row.cells || []).find(c => c.role === 'extra_line' && String(c.value || '').trim().toLowerCase() === want)
          if (cell) {
            cell.value = patch.label
            setBaseSheets(sheets)
            setStructureDirty(true)
            break
          }
        }
      }
    }
  }
  const removeExtraLine = (i) => setExtraLines(extraLines.filter((_, index) => index !== i))

  const syncWordPageFromDom = (pageIndex) => {
    const el = pageRefs.current[pageIndex]
    if (!el) return
    el.querySelectorAll('[data-qg-field][data-qg-item]').forEach((node) => {
      const itemIndex = Number(node.getAttribute('data-qg-item'))
      const field = node.getAttribute('data-qg-field')
      if (!Number.isInteger(itemIndex) || !field || field === '__sr__' || field === 'sr') return
      const text = node.innerText.replace(/\u00a0/g, ' ').trim()
      const key = field === 'specification' ? 'specification' : (field === 'description' || field === 'item' ? 'description' : field)
      const current = quote.items?.[itemIndex]?.[key] ?? ''
      if (String(current) !== text) setItemField(itemIndex, key, text)
    })
    el.querySelectorAll('[data-slot]').forEach((node) => {
      const role = node.getAttribute('data-slot')
      if (!role || role === 'total' || role === 'temp_value' || role === 'line_cell' || role === 'line_items') return
      const text = node.innerText.replace(/\u00a0/g, ' ').trim()
      if (role === 'quote_number' && text !== String(quote.number || '')) update(['number'], text)
      else if (role === 'date' && text !== String(quote.date || '')) update(['date'], text)
      else if (role === 'subject' && text !== String(quote.title || '')) update(['title'], text)
      else if (role === 'valid_until') {
        const cur = quote.fields?.validUntil || quote.validUntil || ''
        if (text !== String(cur)) update(['fields', 'validUntil'], text)
      } else if (role === 'customer_name' && text !== String(quote.customer?.name || '')) setCustomerField('name', text)
      else if (role === 'customer_company' && text !== String(quote.customer?.company || '')) setCustomerField('company', text)
      else if (role === 'customer_gst' && text !== String(quote.customer?.gst || '')) setCustomerField('gst', text)
      else if (role === 'customer_location' && text !== String(quote.customer?.location || '')) setCustomerField('location', text)
      else if (role === 'notes' && text !== (quote.notes || []).filter(Boolean).join('\n')) update(['notes'], text.split('\n'))
    })
  }

  const wordPages = useMemo(() => {
    if (type !== 'word') return []
    const filled = applyReadableTextOnFilledHtml(
      fillWordTemplate(wordHtmlBase || template.content?.html || '', quote, columns, design, totals)
    )
    return splitWordHtmlPages(filled)
  }, [type, wordHtmlBase, template, quote, columns, design, totals])

  const extrasPageIndex = useMemo(() => {
    if (!wordPages.length) return 0
    for (let i = wordPages.length - 1; i >= 0; i--) {
      if (/grand\s*total|data-qg-extra|data-qg-item/i.test(wordPages[i])) return i
    }
    return wordPages.length - 1
  }, [wordPages])
  const [extrasMount, setExtrasMount] = useState(null)
  const [extrasAnchored, setExtrasAnchored] = useState(false)

  const hasNativeFile = Boolean(template.content?.fileId)

  const hydrateWordPages = (force = false) => {
    if (type !== 'word') {
      setExtrasMount(null)
      setExtrasAnchored(false)
      return
    }
    let mount = null
    let anchored = false
    let skippedFocused = false
    wordPages.forEach((html, i) => {
      const el = pageRefs.current[i]
      if (!el) return
      // Don't wipe the DOM while the user is typing in this page — that was
      // duplicating text and spawning extra boxes mid-edit.
      if (!force && el.contains(document.activeElement)) {
        skippedFocused = true
        return
      }
      el.innerHTML = html
      el.setAttribute('contenteditable', 'true')
      el.classList.add('qg-layout-editable-root')
      el.querySelectorAll('[data-qg-field],[data-slot]').forEach((node) => {
        const role = node.getAttribute('data-slot')
        if (role === 'total' || role === 'temp_value') return
        node.classList.add('qg-layout-editable')
      })
      if (i === extrasPageIndex) {
        mount = document.createElement('div')
        mount.className = 'upload-layout-extras-mount no-print'
        mount.setAttribute('contenteditable', 'false')
        const totalRow = findLayoutTotalRow(el)
        if (totalRow?.parentNode) {
          anchored = true
          const wrap = document.createElement('tr')
          wrap.className = 'upload-layout-extras-row no-print'
          wrap.setAttribute('contenteditable', 'false')
          const cell = document.createElement('td')
          cell.colSpan = Math.max(1, totalRow.children.length)
          cell.className = 'upload-layout-extras-cell'
          cell.appendChild(mount)
          wrap.appendChild(cell)
          totalRow.insertAdjacentElement('afterend', wrap)
        } else {
          const table = el.querySelector('table:has([data-qg-item]), table:has([data-qg-extra])')
            || el.querySelector('table')
          if (table?.parentNode) table.after(mount)
          else el.appendChild(mount)
        }
      }
      wireWordStructureHits(el)
    })
    if (!skippedFocused) {
      setExtrasMount(mount)
      setExtrasAnchored(anchored)
    }
  }

  useEffect(() => {
    hydrateWordPages(false)
  }, [type, wordPages, extrasPageIndex])

  const onWordEditorBlur = (pageIndex) => {
    syncWordPageFromDom(pageIndex)
  }

  useEffect(() => {
    if (saveStatus !== 'saved') return undefined
    const t = window.setTimeout(() => { rememberPlacements() }, 400)
    return () => window.clearTimeout(t)
  }, [saveStatus])

  const flushFocusedEdits = () => {
    const active = document.activeElement
    if (active?.blur && typeof active.blur === 'function') active.blur()
  }

  const waitForDomFlush = () => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })

  const handleExport = async (kind) => {
    setPdfBusy(true)
    setPdfNote('')
    try {
      flushFocusedEdits()
      hydrateWordPages(true)
      await waitForDomFlush()

      if (kind === 'word') {
        if (type === 'word') {
          wordPages.forEach((_, i) => syncWordPageFromDom(i))
          const html = joinWordHtmlPages(pageRefs.current.map(el => el?.innerHTML || ''))
          downloadHtmlAsWord(html, quotationFileName(quote, 'doc'))
        } else {
          downloadQuotationWord({ quote, profile, columns, totals, theme: paperTheme, docLabel })
        }
        return
      }
      if (kind === 'excel') {
        if (type === 'excel') {
          const sheetsOut = snapshotExcelSheetsFromDom(excelSheets)
          await downloadFilledExcelSheets(sheetsOut, quote)
          void rememberPlacements(sheetsOut)
          if (structureDirty) void saveStructureToTemplate(scrubTransientExcelShell(sheetsOut))
        } else {
          await downloadQuotationExcel({ quote, profile, columns, totals, theme: paperTheme, docLabel })
        }
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

  const sheet = excelSheets[sheetIndex] || excelSheets[0]

  const nestedColumns = (columns || []).filter(isNestedColumn)
  const imageColumns = (columns || []).filter(isImageColumn)

  const updateNestedCell = (rowIndex, key, value) => {
    const current = quote.items?.[rowIndex] || {}
    const next = { ...current, [key]: value }
    const nested = nestedFieldInfo(columns, key)
    if (nested) next[sourceKey(nested.col)] = nested.part
    update(['items', rowIndex], recalcRow(next, columns, { editingKey: key }))
  }

  const fetchHsnGstForRow = async (rowIndex) => {
    const item = quote.items?.[rowIndex]
    if (!item) return
    const desc = String(item.description || item[columns[0]?.id] || '').split('\n')[0].trim()
    if (!desc) {
      setHsnNote('Add a description on this row before fetching HSN/GST.')
      return
    }
    if (!persistenceConfigured) {
      setHsnNote('Configure Supabase to use HSN/GST lookup.')
      return
    }
    setHsnFetching(rowIndex)
    setHsnNote('')
    try {
      const nextColumns = ensureHsnGstColumnsLocal(columns)
      if (nextColumns !== columns) {
        onColumnsChange?.(nextColumns)
        update(['columns'], nextColumns)
      }
      const result = await lookupHsnGst({ item, columns: nextColumns, description: desc })
      if (result.unavailable) {
        setHsnNote(result.error || 'HSN/GST lookup unavailable.')
        return
      }
      update(['items', rowIndex], recalcRow(result.item || item, nextColumns))
      setHsnNote(`Row ${rowIndex + 1}: HSN ${result.hsn}${result.gst ? ` · GST ${result.gst}%` : ''} filled.`)
    } catch (e) {
      setHsnNote(e.message || 'HSN/GST lookup failed')
    } finally {
      setHsnFetching(null)
    }
  }

  return (
    <main className="min-h-screen text-ink print:bg-white" style={{ background: design.pageBg || '#edf1ed' }}>
      <nav className="no-print sticky top-0 z-30 border-b border-sand bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3 sm:px-7">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onHome} title="Go to Home" className={`flex items-center gap-2 ${onHome ? 'cursor-pointer' : ''}`}>
              <BrandMark size={32} />
              <span className="font-semibold tracking-tight">QuoteGen</span>
            </button>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-moss">{template.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onNew} className="hidden rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 sm:block">New quotation</button>
            <button onClick={onRetry} className="rounded-lg border border-sand px-3 py-2 text-sm font-medium text-moss">↻ Retry AI</button>
            <ExportMenu onExport={handleExport} busy={pdfBusy} label="Export" variant="header" />
          </div>
        </div>
        {pdfNote && <p className="mx-auto max-w-[1440px] px-4 pb-3 text-xs text-rose-600 sm:px-7">{pdfNote}</p>}
      </nav>

      <div className="no-print mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-7">
        <div>
          <p className="text-sm font-semibold">Draft in your uploaded layout</p>
          <p className="text-xs text-slate-500">
            Edit any cell (headers, placeholders, or data). After you move a field and save/export, we remember where it belongs for next time.
          </p>
          {placementNote && <p className="mt-1 text-xs text-moss">{placementNote}</p>}
          {hasNativeFile && (
            <p className="mt-1 text-xs text-slate-400">
              Template file is stored in original format; quote fields fill the mapped preview below.
            </p>
          )}
        </div>
        <span className="text-xs text-slate-500">{saveStatusLabel(saveStatus)}</span>
      </div>

      {type === 'word' ? (
        <section className="upload-layout-scroll mx-auto overflow-x-auto p-3 pb-12 sm:p-7" style={{ width: '100%', maxWidth: '100%' }}>
          <div className="no-print mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-moss/30 bg-[#eef5ff] px-3 py-2 text-sm text-slate-700" style={{ width: Math.min(pageWidthPx, 900), maxWidth: '100%' }}>
            <span className="font-semibold text-moss">Edit table</span>
            <span className="text-xs text-slate-500">Hover a row or column edge — + to insert, × to remove.</span>
            <button
              type="button"
              disabled={!structureDirty || structureBusy || !template?.id}
              className="ml-auto rounded bg-moss px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
              onClick={() => saveStructureToTemplate()}
            >
              {structureBusy ? 'Saving…' : 'Save structure to template'}
            </button>
            {structureNote ? <span className="basis-full text-[11px] text-slate-500">{structureNote}</span> : null}
          </div>
          <div className="upload-word-stack" style={{ width: pageWidthPx, minWidth: pageWidthPx }}>
            {wordPages.map((_, pageIndex) => (
              <div key={pageIndex} className="upload-word-stack-item">
                {wordPages.length > 1 && (
                  <div className="upload-word-page-label">Page {pageIndex + 1} of {wordPages.length}</div>
                )}
                <article
                  className="upload-word-page shadow-soft print:shadow-none"
                  style={{
                    ...templatePaperStyle(design, pageWidthPx),
                    ...(Number(design.pageHeightPx) > 0 ? { minHeight: `${Math.round(design.pageHeightPx)}px` } : {})
                  }}
                >
                  <div
                    ref={(el) => { pageRefs.current[pageIndex] = el }}
                    className="upload-word-editor outline-none qg-layout-editable-root"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={() => onWordEditorBlur(pageIndex)}
                  />
                </article>
              </div>
            ))}
          </div>
          {extrasMount
            ? createPortal(
              <LayoutTotalsExtraLines
                lines={extraLines}
                base={totals.extraBase ?? (totals.taxableTotal + totals.taxTotal)}
                grandTotal={totals.grandTotal}
                showGrandTotal={!extrasAnchored}
                onAdd={addExtraLine}
                onUpdate={updateExtraLine}
                onRemove={removeExtraLine}
              />,
              extrasMount
            )
            : null}
        </section>
      ) : (
        <section className="upload-layout-scroll overflow-x-auto p-3 pb-12 sm:p-5" style={{ width: '100%', maxWidth: '100%' }}>
          {sheet ? (
            <>
            <div className="no-print mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-moss/30 bg-[#eef5ff] px-3 py-2 text-sm text-slate-700" style={{ width: Math.min(pageWidthPx, 900), maxWidth: '100%' }}>
              <span className="font-semibold text-moss">Edit tables</span>
              <span className="text-xs text-slate-500">Hover between rows or columns — + to insert, × to remove.</span>
              <button
                type="button"
                disabled={!structureDirty || structureBusy || !template?.id}
                className="ml-auto rounded bg-moss px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
                onClick={() => saveStructureToTemplate()}
              >
                {structureBusy ? 'Saving…' : 'Save structure to template'}
              </button>
              {structureNote ? <span className="basis-full text-[11px] text-slate-500">{structureNote}</span> : null}
            </div>
            <div
              className="upload-excel-paper rounded-lg shadow-soft bg-white"
              style={{
                width: pageWidthPx,
                minWidth: pageWidthPx,
                maxWidth: 'none',
                overflow: 'visible',
                boxSizing: 'border-box'
              }}
            >
              <table className="upload-excel-table border-collapse" style={{ width: '100%', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 56 }} />
                  {sheet.columns.map((col) => (
                    <col key={col.index} style={{ width: col.widthPx }} />
                  ))}
                </colgroup>
                <thead className="no-print">
                  <tr>
                    <th className="upload-excel-corner" />
                    {sheet.columns.map((col) => {
                      const mapped = columns?.find(c => {
                        const headerCell = sheet.rows?.[sheet._headerRowIndex]?.cells?.find(cell => Number(cell.col) === Number(col.index))
                        return headerCell && (
                          String(headerCell.value || '').trim().toLowerCase() === String(c.label || '').trim().toLowerCase()
                          || c.id === headerCell.fieldId
                        )
                      })
                      return (
                        <th key={col.index} className="upload-excel-colhead upload-excel-struct-head relative">
                          <div className="flex flex-col items-center gap-0.5 py-0.5">
                            <span>{excelColLetter(col.index)}</span>
                            {mapped && canHaveFormula(mapped, columns) ? (
                              <button
                                type="button"
                                title={isFormulaColumn(mapped) ? formulaSentence(mapped.formula?.tokens, columns) : 'Set a formula'}
                                className={`rounded px-1 text-[9px] font-bold ${isFormulaColumn(mapped) ? 'bg-blue-50 text-moss' : 'text-moss/80 hover:bg-blue-50'}`}
                                onClick={() => setFormulaColId(formulaColId === mapped.id ? null : mapped.id)}
                              >
                                fx
                              </button>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            title={`Add column after ${excelColLetter(col.index)}`}
                            className="qg-struct-hit qg-struct-hit-col"
                            onClick={() => handleAddColumn(col.index)}
                          >
                            +
                          </button>
                          {(sheet.columns || []).length > 1 ? (
                            <button
                              type="button"
                              title={`Remove column ${excelColLetter(col.index)}`}
                              className="qg-struct-hit qg-struct-hit-col-remove"
                              onClick={() => handleRemoveColumn(col.index)}
                            >
                              ×
                            </button>
                          ) : null}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const regions = detectExcelTableRegions(sheet)
                    const endMap = new Map(regions.map(r => [r.endRi, r]))
                    const tableColSpan = 1 + (sheet.columns?.length || 1)
                    const nodes = []
                    sheet.rows.forEach((row, ri) => {
                      nodes.push(
                        <tr key={`r-${row.index}`} className="qg-struct-row" style={{ height: row.heightPx }}>
                          <th className="upload-excel-rowhead upload-excel-struct-head relative">
                            <div className="flex flex-col items-center gap-0.5 py-0.5">
                              <span>{row.index}</span>
                            </div>
                            {(sheet.rows || []).length > 1 ? (
                              <button
                                type="button"
                                title="Remove this row"
                                className="qg-struct-hit qg-struct-hit-row-remove"
                                onClick={() => handleRemoveRow(ri)}
                              >
                                ×
                              </button>
                            ) : null}
                          </th>
                          {visibleRowCells(row).map((cell) => {
                            const isDesc = cell.fieldId === 'description' || cell.fieldId === 'specification' || cell.fieldId === 'item'
                            return (
                              <td
                                key={`${row.index}-${cell.col}`}
                                rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                                colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                                style={{
                                  ...cellStyleWithContrast(cell.style),
                                  height: row.heightPx,
                                  verticalAlign: isDesc ? 'top' : undefined,
                                  overflow: 'hidden'
                                }}
                                className={`upload-excel-cell${cell.style?.hasOwnBorder ? '' : ' upload-excel-cell--grid'}`}
                              >
                                <ExcelInlineCell
                                  cell={cell}
                                  row={row}
                                  sheetIndex={sheetIndex}
                                  quote={quote}
                                  suggestClients={suggestClients}
                                  suggestProducts={suggestProducts}
                                  pickClient={pickClient}
                                  applyProduct={applyProduct}
                                  setItemField={setItemField}
                                  setCustomerField={setCustomerField}
                                  update={update}
                                  setLayoutEdit={setLayoutEdit}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      )
                      nodes.push(
                        <tr key={`gap-r-${row.index}`} className="no-print qg-struct-gap-row">
                          <td colSpan={tableColSpan}>
                            <button
                              type="button"
                              className="qg-struct-hit qg-struct-hit-row"
                              title="Add row below"
                              onClick={() => handleAddRow(ri)}
                            >
                              +
                            </button>
                          </td>
                        </tr>
                      )
                      const region = endMap.get(ri)
                      if (region) {
                        nodes.push(
                          <TableRegionToolbar
                            key={`tb-${region.id}`}
                            region={region}
                            colSpan={tableColSpan}
                            onAddRow={handleAddRowInRegion}
                            onAddColumn={handleAddColumnInRegion}
                            onAddFormulaColumn={handleAddFormulaColumn}
                            onAddLineItem={handleAddLineItemInRegion}
                          />
                        )
                        if (region.kind === 'line_items') {
                          nodes.push(
                            <tr key={`ex-${region.id}`} className="no-print">
                              <td colSpan={tableColSpan} className="bg-white px-2 pb-3 pt-1">
                                <LayoutTotalsExtraLines
                                  lines={extraLines}
                                  base={totals.extraBase ?? (totals.taxableTotal + totals.taxTotal)}
                                  grandTotal={totals.grandTotal}
                                  onAdd={addExtraLine}
                                  onUpdate={updateExtraLine}
                                  onRemove={removeExtraLine}
                                />
                              </td>
                            </tr>
                          )
                        }
                      }
                    })
                    if (!regions.length) {
                      nodes.push(
                        <TableRegionToolbar
                          key="tb-fallback"
                          region={{ id: 'all', startRi: 0, endRi: (sheet.rows?.length || 1) - 1, headerRi: 0, kind: 'generic', maxCol: sheet.columns?.length || 1 }}
                          colSpan={tableColSpan}
                          onAddRow={handleAddRowInRegion}
                          onAddColumn={handleAddColumnInRegion}
                          onAddFormulaColumn={handleAddFormulaColumn}
                          onAddLineItem={handleAddLineItemInRegion}
                        />
                      )
                    }
                    return nodes
                  })()}
                </tbody>
              </table>
              {formulaColId ? (
                <FormulaGuide
                  col={(columns || []).find(c => c.id === formulaColId)}
                  columns={columns}
                  onSave={(formula) => saveColumnFormula(formulaColId, formula)}
                  onClose={() => setFormulaColId(null)}
                />
              ) : null}
            </div>
            </>
          ) : (
            <p className="p-8 text-center text-slate-500">Template has no sheets.</p>
          )}
          {total > 0 && (
            <p className="no-print mt-3 text-sm text-slate-500">Computed total from enquiry items: ₹ {total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          )}
        </section>
      )}
    </main>
  )
}
