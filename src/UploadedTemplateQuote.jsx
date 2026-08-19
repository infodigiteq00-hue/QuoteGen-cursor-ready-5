import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  fillWordTemplate,
  fillExcelTemplate,
  splitDescription,
  inferTemplatePageWidth,
  splitExcelPrefixedValue
} from '../shared/templateMap.js'
import { lookupHsnGst, listQuotations, listProducts } from './quotePersistence.js'
import { downloadQuotationPdf, quotationFileName } from './pdfExport.js'
import { downloadFilledExcelSheets, downloadHtmlAsWord, downloadQuotationExcel, downloadQuotationWord } from './officeExport.js'
import { ExportMenu } from './QuoteStudio.jsx'
import { resolvePaperTheme, accentForTableColor } from './quotePaperThemes.js'
import { SuggestField } from './SuggestField.jsx'
import { applyProductToItem, clientsFromQuotations, matchClients, matchProducts, productsFromHistory } from './suggestCatalog.js'
import {
  amountKey,
  columnType,
  computeQuoteTotals,
  isImageColumn,
  isNestedColumn,
  nestedFieldInfo,
  rateKey,
  recalcRow,
  sourceKey
} from '../shared/quoteColumns.js'
import { attachSuggestedColumn, fillSuggestedOnItems, SUGGESTED_COLUMN_ID } from '../shared/productKeywords.js'

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

function DescriptionBlock({ value }) {
  const { primary, secondary } = splitDescription(value)
  if (!primary && !secondary) return <span className="text-slate-300">—</span>
  return (
    <div className="qg-desc-cell leading-snug">
      {primary ? <p className="m-0 text-[#17231f]">{primary}</p> : null}
      {secondary ? <p className="mt-1 whitespace-pre-line text-[11px] font-normal leading-relaxed text-slate-500">{secondary}</p> : null}
    </div>
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

function WordShellFields({
  edit,
  quote,
  suggestClients,
  suggestProducts,
  pickClient,
  applyProduct,
  setItemField,
  setCustomerField,
  update
}) {
  const itemIndex = Number.isInteger(edit.itemIndex) ? edit.itemIndex : null
  const field = edit.field
  const role = edit.role
  const custField = customerFieldFromRole(role)
  const fieldClass = 'w-full min-w-0 rounded-lg border border-sand bg-white px-2 py-1.5 text-sm'

  if (itemIndex != null && (field === 'description' || field === 'specification' || field === 'item')) {
    const key = field === 'specification' ? 'specification' : 'description'
    const value = quote.items?.[itemIndex]?.[key] || ''
    return (
      <>
        <SuggestField
          autoFocus
          multiline
          value={value}
          onChange={v => setItemField(itemIndex, key, v)}
          suggestions={productSuggestionItems(suggestProducts, quote.items?.[itemIndex]?.description)}
          onPick={item => applyProduct(itemIndex, item.product, key)}
          placeholder="Product"
          className={fieldClass}
        />
        <input
          aria-label="Our suggested"
          value={quote.items?.[itemIndex]?.[SUGGESTED_COLUMN_ID] || ''}
          onChange={e => setItemField(itemIndex, SUGGESTED_COLUMN_ID, e.target.value)}
          placeholder="Our suggested"
          className={`${fieldClass} mt-2`}
        />
      </>
    )
  }

  if (itemIndex != null && field && field !== '__sr__' && field !== 'sr') {
    return (
      <input
        autoFocus
        value={quote.items?.[itemIndex]?.[field] ?? ''}
        onChange={e => setItemField(itemIndex, field, e.target.value)}
        className={fieldClass}
      />
    )
  }

  if (role === 'customer_block') {
    const customer = quote.customer || {}
    return (
      <div className="space-y-2">
        <SuggestField
          autoFocus
          value={customer.company || ''}
          onChange={v => setCustomerField('company', v)}
          suggestions={clientSuggestionItems(suggestClients, customer.company, 'company')}
          onPick={item => pickClient(item.client)}
          placeholder="Customer company"
          className={fieldClass}
        />
        <SuggestField
          value={customer.name || ''}
          onChange={v => setCustomerField('name', v)}
          suggestions={clientSuggestionItems(suggestClients, customer.name, 'name')}
          onPick={item => pickClient(item.client)}
          placeholder="Kind Attn"
          className={fieldClass}
        />
        <SuggestField
          value={customer.location || ''}
          onChange={v => setCustomerField('location', v)}
          suggestions={clientSuggestionItems(suggestClients, customer.location, 'location')}
          onPick={item => pickClient(item.client)}
          placeholder="Address · City"
          className={fieldClass}
        />
        <SuggestField
          value={customer.gst || ''}
          onChange={v => setCustomerField('gst', v)}
          suggestions={clientSuggestionItems(suggestClients, customer.gst, 'gst')}
          onPick={item => pickClient(item.client)}
          placeholder="GSTIN"
          className={fieldClass}
        />
      </div>
    )
  }

  if (custField) {
    return (
      <SuggestField
        autoFocus
        value={quote.customer?.[custField] || ''}
        onChange={v => setCustomerField(custField, v)}
        suggestions={clientSuggestionItems(suggestClients, quote.customer?.[custField], custField)}
        onPick={item => pickClient(item.client)}
        placeholder={custField === 'gst' ? 'GSTIN' : custField}
        className={fieldClass}
      />
    )
  }

  if (role === 'quote_number') {
    return <input autoFocus value={quote.number || ''} onChange={e => update(['number'], e.target.value)} className={fieldClass} />
  }
  if (role === 'date') {
    return <input autoFocus value={quote.date || ''} onChange={e => update(['date'], e.target.value)} className={fieldClass} />
  }
  if (role === 'subject') {
    return <input autoFocus value={quote.title || ''} onChange={e => update(['title'], e.target.value)} className={fieldClass} />
  }
  if (role === 'valid_until') {
    return (
      <input
        autoFocus
        value={quote.fields?.validUntil || quote.validUntil || ''}
        onChange={e => update(['fields', 'validUntil'], e.target.value)}
        className={fieldClass}
      />
    )
  }
  if (role === 'notes') {
    return (
      <textarea
        autoFocus
        rows={3}
        value={(quote.notes || []).filter(Boolean).join('\n')}
        onChange={e => update(['notes'], e.target.value.split('\n'))}
        className={fieldClass}
      />
    )
  }
  return <p className="text-xs text-slate-500">This part of the layout is fixed.</p>
}

function ensureHsnGstColumnsLocal(columns) {
  const next = Array.isArray(columns) ? [...columns] : []
  const hasHsn = next.some(c => /hsn|sac/i.test(String(c.id)) || /hsn|sac/i.test(String(c.label)))
  const toAdd = []
  if (!hasHsn) toAdd.push({ id: uniqueIdLocal('HSN Code', [...next, ...toAdd]), label: 'HSN Code' })
  if (!toAdd.length) return columns
  const unitIdx = next.findIndex(c => c.id === 'unit')
  const qtyIdx = next.findIndex(c => c.id === 'quantity')
  const idx = unitIdx >= 0 ? unitIdx : (qtyIdx >= 0 ? qtyIdx : next.length)
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
  const pageWidthPx = inferTemplatePageWidth(
    type,
    type === 'word' ? template.content?.html : template.content?.sheets,
    design
  )
  const editorRef = useRef(null)
  const [hsnFetching, setHsnFetching] = useState(null)
  const [hsnNote, setHsnNote] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const [historyQuotes, setHistoryQuotes] = useState([])
  const [catalogProducts, setCatalogProducts] = useState([])
  const suggestedFillSigRef = useRef('')
  const [shellEdit, setShellEdit] = useState(null)
  const profile = companyProfile || quote.companyProfile || null
  const paperTheme = resolvePaperTheme(quote.paperStyle || 'corporate', accentForTableColor(quote.tableColorId || 'blue', quote.logoPalette))
  const docLabel = (quote.docType || quote.doc_type) === 'invoice' ? 'TAX INVOICE' : 'QUOTATION'

  // Uploaded layouts keep their own Total/GST/Discount rows verbatim, so the
  // real figures are computed here and filled into those rows.
  const totals = useMemo(() => computeQuoteTotals(quote.items || [], columns), [quote.items, columns])
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

  const wordHtml = useMemo(() => {
    if (type !== 'word') return ''
    return fillWordTemplate(template.content?.html || '', quote, columns, design, totals)
  }, [type, template, quote, columns, design, totals])

  const excelSheets = useMemo(() => {
    if (type !== 'excel') return []
    return fillExcelTemplate(template.content?.sheets || [], quote, columns, design, totals)
  }, [type, template, quote, columns, design, totals])

  useEffect(() => {
    if (type !== 'word' || !editorRef.current) return
    editorRef.current.innerHTML = wordHtml
  }, [type, wordHtml])

  const onWordShellClick = (e) => {
    const node = e.target.closest?.('[data-qg-field],[data-slot]')
    if (!node || node.getAttribute('data-slot') === 'total' || node.getAttribute('data-slot') === 'temp_value') {
      setShellEdit(null)
      return
    }
    e.preventDefault()
    const field = node.getAttribute('data-qg-field')
    const itemRaw = node.getAttribute('data-qg-item')
    const role = node.getAttribute('data-slot')
    if (field === '__sr__' || field === 'sr') {
      setShellEdit(null)
      return
    }
    const rect = node.getBoundingClientRect()
    const width = Math.min(Math.max(rect.width, 260), Math.max(280, window.innerWidth - 24))
    let left = rect.left
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12
    if (left < 12) left = 12
    setShellEdit({
      field,
      itemIndex: itemRaw != null && itemRaw !== '' ? Number(itemRaw) : null,
      role,
      top: Math.min(rect.bottom + 6, window.innerHeight - 160),
      left,
      width
    })
  }

  useEffect(() => {
    if (!shellEdit) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setShellEdit(null) }
    const onDown = (e) => {
      if (e.target.closest?.('.upload-shell-pop')) return
      if (editorRef.current?.contains(e.target)) return
      setShellEdit(null)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [shellEdit])

  const handleExport = async (kind) => {
    setPdfBusy(true)
    setPdfNote('')
    try {
      if (kind === 'word') {
        if (type === 'word') {
          downloadHtmlAsWord(wordHtml, quotationFileName(quote, 'doc'))
        } else {
          downloadQuotationWord({ quote, profile, columns, totals, theme: paperTheme, docLabel })
        }
        return
      }
      if (kind === 'excel') {
        if (type === 'excel') await downloadFilledExcelSheets(excelSheets, quote)
        else await downloadQuotationExcel({ quote, profile, columns, totals, theme: paperTheme, docLabel })
        return
      }
      await downloadQuotationPdf(quotationFileName(quote, 'pdf'))
    } catch (error) {
      if (kind === 'pdf' || !kind) {
        setPdfNote(`Could not build the PDF — ${error.message}. Opening the browser print dialog instead; choose "Save as PDF" there.`)
        window.print()
      } else {
        setPdfNote(`Could not export ${kind === 'word' ? 'Word' : 'Excel'} — ${error.message}.`)
      }
    } finally {
      setPdfBusy(false)
    }
  }

  const sheetIndex = template.content?.activeSheet || 0
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

  const lineItemQuickEdit = (
    <div className="no-print mt-4 rounded-xl border border-sand bg-white p-4 text-sm">
      <p className="mb-2 font-semibold">Quick edits (source data)</p>
      <input
        value={quote.title || ''}
        onChange={e => update(['title'], e.target.value)}
        className="mb-2 w-full rounded-lg border border-sand px-3 py-2"
        placeholder="Subject / title"
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <SuggestField
          value={quote.customer?.name || ''}
          onChange={v => setCustomerField('name', v)}
          suggestions={clientSuggestionItems(suggestClients, quote.customer?.name, 'name')}
          onPick={item => pickClient(item.client)}
          placeholder="Customer"
          className="w-full rounded-lg border border-sand px-3 py-2"
        />
        <SuggestField
          value={quote.customer?.company || ''}
          onChange={v => setCustomerField('company', v)}
          suggestions={clientSuggestionItems(suggestClients, quote.customer?.company, 'company')}
          onPick={item => pickClient(item.client)}
          placeholder="Company"
          className="w-full rounded-lg border border-sand px-3 py-2"
        />
      </div>
      {(nestedColumns.length > 0 || imageColumns.length > 0) && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          This uploaded layout keeps its own table structure, so typed columns degrade:
          {nestedColumns.length > 0 && ' nested tax/discount columns fill a single matching cell with the calculated amount (no merged Rate/Amount header)'}
          {nestedColumns.length > 0 && imageColumns.length > 0 && ', and'}
          {imageColumns.length > 0 && ' image columns only appear where the layout has a matching header (Word layouts only)'}
          . Switch to the QuoteGen default layout for the full nested header and inline images.
        </p>
      )}
      {(quote.items || []).length > 0 && (
        <div className="space-y-2 border-t border-sand pt-3">
          <p className="text-xs font-medium text-slate-600">Line items — Fetch HSN/GST</p>
          {(quote.items || []).map((item, i) => {
            const desc = String(item.description || '').split('\n')[0].trim() || `Item ${i + 1}`
            const hsn = item.hsnCode || item.hsn || ''
            const gst = item['gst%'] || item.gstPercent || item.gst || item.tax || ''
            return (
              <div key={i} className="rounded-lg bg-[#f7f9f7] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={desc}>{i + 1}. {desc}</span>
                  {(hsn || gst) && (
                    <span className="text-[10px] text-slate-500">
                      {hsn ? `HSN ${hsn}` : ''}{hsn && gst ? ' · ' : ''}{gst ? `GST ${gst}%` : ''}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={hsnFetching === i}
                    onClick={() => fetchHsnGstForRow(i)}
                    className="rounded border border-sand bg-white px-2 py-1 text-[10px] font-semibold text-moss hover:bg-blue-50 disabled:opacity-50"
                  >
                    {hsnFetching === i ? '…' : 'Fetch HSN/GST'}
                  </button>
                </div>
                {nestedColumns.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3 border-t border-sand pt-2">
                    {nestedColumns.map(col => (
                      <label key={col.id} className="flex items-center gap-1 text-[10px] text-slate-500">
                        <span className="font-semibold uppercase tracking-wide">
                          {col.label}{columnType(col) === 'discount' ? ' −' : ' +'}
                        </span>
                        <input
                          value={item[rateKey(col)] ?? ''}
                          onChange={e => updateNestedCell(i, rateKey(col), e.target.value)}
                          placeholder="%"
                          aria-label={`${col.label} rate % for item ${i + 1}`}
                          className="w-14 rounded border border-sand px-1.5 py-1 text-right text-[11px] outline-none focus:border-moss"
                        />
                        <input
                          value={item[amountKey(col)] ?? ''}
                          onChange={e => updateNestedCell(i, amountKey(col), e.target.value)}
                          placeholder="amount"
                          aria-label={`${col.label} amount for item ${i + 1}`}
                          className="w-20 rounded border border-sand px-1.5 py-1 text-right text-[11px] outline-none focus:border-moss"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {hsnNote && <p className="text-xs text-slate-500">{hsnNote}</p>}
        </div>
      )}
    </div>
  )

  return (
    <main className="min-h-screen text-ink print:bg-white" style={{ background: design.pageBg || '#edf1ed' }}>
      <nav className="no-print sticky top-0 z-10 border-b border-sand bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3 sm:px-7">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onHome} title="Go to Home" className={`flex items-center gap-2 ${onHome ? 'cursor-pointer' : ''}`}>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-moss font-bold text-white">Q</div>
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
          <p className="text-xs text-slate-500">Click a client, product, or figure — same suggestions as QuoteGen, in “{template.name}”.</p>
        </div>
        <span className="text-xs text-slate-500">{saveStatusLabel(saveStatus)}</span>
      </div>

      {type === 'word' ? (
        <section className="mx-auto overflow-x-auto p-3 pb-12 sm:p-7" style={{ width: 'fit-content', maxWidth: '100%' }}>
          <article
            className="upload-word-page shadow-soft print:shadow-none"
            style={{
              background: design.paperBg || '#fff',
              width: pageWidthPx,
              maxWidth: 'none',
              '--upload-page-width': `${pageWidthPx}px`
            }}
          >
            <div
              ref={editorRef}
              className="upload-word-editor outline-none"
              onClick={onWordShellClick}
            />
            {shellEdit && typeof document !== 'undefined' ? createPortal(
              <div
                className="qg-formula-pop upload-shell-pop no-print rounded-xl border border-sand bg-white p-3 shadow-soft"
                style={{ top: shellEdit.top, left: shellEdit.left, width: shellEdit.width }}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              >
                <WordShellFields
                  edit={shellEdit}
                  quote={quote}
                  suggestClients={suggestClients}
                  suggestProducts={suggestProducts}
                  pickClient={pickClient}
                  applyProduct={applyProduct}
                  setItemField={setItemField}
                  setCustomerField={setCustomerField}
                  update={update}
                />
              </div>,
              document.body
            ) : null}
          </article>
          {lineItemQuickEdit}
        </section>
      ) : (
        <section className="overflow-auto p-3 pb-12 sm:p-5">
          {sheet ? (
            <div
              className="inline-block min-w-full rounded-lg shadow-soft"
              style={{ background: design.paperBg || '#fff', minWidth: pageWidthPx }}
            >
              <table className="upload-excel-table border-collapse">
                <colgroup>
                  <col style={{ width: 40 }} />
                  {sheet.columns.map((col) => (
                    <col key={col.index} style={{ width: col.widthPx }} />
                  ))}
                </colgroup>
                <tbody>
                  {sheet.rows.map((row, ri) => (
                    <tr key={row.index} style={{ height: row.heightPx }}>
                      <th className="upload-excel-rowhead">{row.index}</th>
                      {row.cells.map((cell, ci) => {
                        const fieldId = cell.fieldId || null
                        const itemIndex = Number.isInteger(cell.itemIndex) ? cell.itemIndex : null
                        const isDesc = fieldId === 'description' || fieldId === 'specification' || fieldId === 'item'
                        const custField = customerFieldFromRole(cell.role)
                        const prefix = cell.labelPrefix || ''
                        const rawValue = prefix && String(cell.value || '').startsWith(prefix)
                          ? String(cell.value).slice(prefix.length)
                          : (cell.value || '')
                        return (
                          <td
                            key={`${row.index}-${cell.col}`}
                            rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                            colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                            style={{ ...styleToCss(cell.style), minWidth: sheet.columns[cell.col - 1]?.widthPx || 80, height: row.heightPx, verticalAlign: isDesc ? 'top' : undefined }}
                            className="upload-excel-cell"
                          >
                            {itemIndex != null && isDesc ? (
                              <div className="no-print px-1 py-0.5">
                                <SuggestField
                                  multiline
                                  value={quote.items?.[itemIndex]?.[fieldId] || ''}
                                  onChange={v => setItemField(itemIndex, fieldId === 'specification' ? 'specification' : 'description', v)}
                                  suggestions={productSuggestionItems(suggestProducts, quote.items?.[itemIndex]?.[fieldId] || quote.items?.[itemIndex]?.description)}
                                  onPick={item => applyProduct(itemIndex, item.product, fieldId === 'specification' ? 'specification' : 'description')}
                                  placeholder="Product"
                                  className="w-full min-w-0 bg-transparent px-1 py-0.5 text-sm"
                                />
                                <input
                                  aria-label="Our suggested"
                                  value={quote.items?.[itemIndex]?.[SUGGESTED_COLUMN_ID] || ''}
                                  onChange={e => setItemField(itemIndex, SUGGESTED_COLUMN_ID, e.target.value)}
                                  placeholder="Our suggested"
                                  className="mt-0.5 w-full min-w-0 bg-transparent px-1 py-0.5 text-[11px] text-slate-600 outline-none"
                                />
                              </div>
                            ) : itemIndex != null && fieldId && fieldId !== '__sr__' && fieldId !== 'sr' ? (
                              <input
                                value={quote.items?.[itemIndex]?.[fieldId] ?? rawValue}
                                onChange={e => setItemField(itemIndex, fieldId, e.target.value)}
                                className="no-print w-full bg-transparent px-1.5 py-0.5 outline-none"
                              />
                            ) : custField ? (
                              <div className="no-print flex items-center gap-1 px-1">
                                {prefix ? <span className="shrink-0 text-slate-500">{prefix}</span> : null}
                                <SuggestField
                                  value={quote.customer?.[custField] || ''}
                                  onChange={v => setCustomerField(custField, v)}
                                  suggestions={clientSuggestionItems(suggestClients, quote.customer?.[custField], custField)}
                                  onPick={item => pickClient(item.client)}
                                  placeholder={custField}
                                  className="w-full min-w-0 bg-transparent px-1 py-0.5 text-sm"
                                />
                              </div>
                            ) : cell.role === 'quote_number' ? (
                              <input value={quote.number || ''} onChange={e => update(['number'], e.target.value)} className="no-print w-full bg-transparent px-1.5 py-0.5 outline-none" />
                            ) : cell.role === 'date' ? (
                              <input value={quote.date || ''} onChange={e => update(['date'], e.target.value)} className="no-print w-full bg-transparent px-1.5 py-0.5 outline-none" />
                            ) : cell.role === 'valid_until' ? (
                              <input
                                value={quote.fields?.validUntil || quote.validUntil || ''}
                                onChange={e => update(['fields', 'validUntil'], e.target.value)}
                                className="no-print w-full bg-transparent px-1.5 py-0.5 outline-none"
                              />
                            ) : cell.role === 'subject' ? (
                              <input value={quote.title || ''} onChange={e => update(['title'], e.target.value)} className="no-print w-full bg-transparent px-1.5 py-0.5 outline-none" />
                            ) : isDesc
                              ? <div className="px-1.5 py-1"><DescriptionBlock value={cell.value} /></div>
                              : <div className="upload-excel-input" style={{ padding: '2px 6px' }}>{cell.value}</div>}
                            {(itemIndex != null || custField || cell.role === 'quote_number' || cell.role === 'date' || cell.role === 'valid_until' || cell.role === 'subject') && (
                              <div className="hidden print:block px-1.5 py-1">{cell.value}</div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-8 text-center text-slate-500">Template has no sheets.</p>
          )}
          {total > 0 && (
            <p className="no-print mt-3 text-sm text-slate-500">Computed total from enquiry items: ₹ {total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          )}
          <div className="mx-auto max-w-[900px]">{lineItemQuickEdit}</div>
        </section>
      )}
    </main>
  )
}
