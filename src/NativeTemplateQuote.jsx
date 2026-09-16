import React, { useEffect, useMemo, useRef, useState } from 'react'
import NativeDocumentEditor from './NativeDocumentEditor.jsx'
import BrandMark from './BrandMark.jsx'
import { ExportMenu, PreviewPdfButton } from './QuoteStudio.jsx'
import { SuggestField } from './SuggestField.jsx'
import { listQuotations, listProducts } from './quotePersistence.js'
import { quotationFileName } from './pdfExport.js'
import { downloadQuotationPdf } from './pdfExport.js'
import {
  applyProductToItem,
  clientsFromQuotations,
  matchClients,
  matchProducts,
  productsFromHistory
} from './suggestCatalog.js'
import {
  recalcRow,
  blankItemFor,
  amountKey,
  computeQuoteTotals
} from '../shared/quoteColumns.js'

async function readApiResponse(response) {
  const text = await response.text()
  if (!text) {
    if (!response.ok) {
      throw new Error(`Server error (${response.status}). Check that npm run dev is running and the API is on port 3001.`)
    }
    throw new Error('Server returned an empty response.')
  }
  try {
    return JSON.parse(text)
  } catch {
    if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
      throw new Error(
        response.ok
          ? 'Server returned a web page instead of data. Restart npm run dev and try again.'
          : `Server error (${response.status}). The layout fill may have timed out — retry in a moment.`
      )
    }
    throw new Error(`Server error (${response.status}): ${text.slice(0, 160)}`)
  }
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function saveStatusLabel(status) {
  if (status === 'saved') return 'Saved'
  if (status === 'saving') return 'Saving…'
  if (status === 'unavailable') return 'Cloud save off'
  return 'Unsaved'
}

function clientSuggestionItems(clients, query, field) {
  return matchClients(clients, query, field).map(c => ({
    id: c.id || `${c.company}|${c.name}`,
    title: field === 'company' ? (c.company || c.name) : (c.name || c.company),
    meta: [c.location, c.gst].filter(Boolean).join(' · '),
    client: c
  }))
}

function productSuggestionItems(products, query) {
  return matchProducts(products, query).slice(0, 12).map(p => ({
    id: `${p.description}|${p.hsn}`,
    title: p.description || p.hsn || 'Product',
    meta: [p.hsn, p.unit, p.rate !== '' ? `₹ ${p.rate}` : ''].filter(Boolean).join(' · '),
    product: p
  }))
}

/** Option A: native file view + server-side fill (same renderer as upload). */
export default function NativeTemplateQuote({
  template,
  quote,
  columns,
  total,
  onNew,
  onHome,
  onRetry,
  update,
  saveStatus = 'idle',
  persistenceConfigured = false,
  onColumnsChange
}) {
  const [filledFileId, setFilledFileId] = useState(null)
  const [fillBusy, setFillBusy] = useState(false)
  const [fillError, setFillError] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const [historyQuotes, setHistoryQuotes] = useState([])
  const [catalogProducts, setCatalogProducts] = useState([])
  const [editorKey, setEditorKey] = useState(0)
  const filledFileIdRef = useRef(null)
  const fillTimerRef = useRef(null)
  const fillSeqRef = useRef(0)
  const quoteRef = useRef(quote)
  const columnsRef = useRef(columns)
  quoteRef.current = quote
  columnsRef.current = columns

  const suggestClients = useMemo(
    () => clientsFromQuotations(historyQuotes, quote.customer),
    [historyQuotes, quote.customer]
  )
  const suggestProducts = useMemo(
    () => productsFromHistory(historyQuotes, catalogProducts, quote.items),
    [historyQuotes, catalogProducts, quote.items]
  )

  const totals = useMemo(
    () => computeQuoteTotals(quote.items || [], columns, quote.extraLines),
    [quote.items, columns, quote.extraLines]
  )

  // Stable fingerprint so autosave noise doesn't thrash OnlyOffice.
  const fillFingerprint = useMemo(() => JSON.stringify({
    customer: quote.customer || {},
    items: (quote.items || []).map(it => ({
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      rate: it.rate,
      amount: it.amount
    })),
    number: quote.number,
    extraLines: quote.extraLines || []
  }), [quote.customer, quote.items, quote.number, quote.extraLines])

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
    if (!template?.id || !template.content?.fileId) return undefined
    if (fillTimerRef.current) clearTimeout(fillTimerRef.current)
    const seq = ++fillSeqRef.current
    fillTimerRef.current = setTimeout(async () => {
      setFillBusy(true)
      setFillError('')
      try {
        const res = await fetch(`/api/upload-templates/${template.id}/fill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quote: quoteRef.current,
            columns: columnsRef.current,
            filledFileId: filledFileIdRef.current
          })
        })
        const data = await readApiResponse(res)
        if (!res.ok) throw new Error(data.error || 'Could not fill layout.')
        if (seq !== fillSeqRef.current) return
        filledFileIdRef.current = data.filledFileId
        setFilledFileId(data.filledFileId)
        // One remount after typing settles — not on every keystroke.
        setEditorKey(k => k + 1)
      } catch (e) {
        if (seq !== fillSeqRef.current) return
        setFillError(e.message || 'Could not update layout preview.')
      } finally {
        if (seq === fillSeqRef.current) setFillBusy(false)
      }
    }, 1200)
    return () => {
      if (fillTimerRef.current) clearTimeout(fillTimerRef.current)
    }
  }, [template.id, template.content?.fileId, fillFingerprint])

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

  const applyProduct = (rowIndex, product) => {
    const current = quote.items?.[rowIndex] || {}
    update(['items', rowIndex], recalcRow(applyProductToItem(current, columns, product), columns))
  }

  const setItemField = (rowIndex, field, value) => {
    const current = quote.items?.[rowIndex] || {}
    update(['items', rowIndex], recalcRow({ ...current, [field]: value }, columns, { editingKey: field }))
  }

  const addRow = () => {
    update(['items'], [...(quote.items || []), blankItemFor(columns)])
  }

  const removeRow = (i) => {
    const items = [...(quote.items || [])]
    if (items.length <= 1) return
    items.splice(i, 1)
    update(['items'], items)
  }

  const handleExport = async (kind) => {
    setPdfBusy(true)
    setPdfNote('')
    try {
      const fileId = filledFileId || template.content?.fileId
      if ((kind === 'word' || kind === 'excel') && fileId) {
        const res = await fetch(`/api/upload-files/${encodeURIComponent(fileId)}`)
        if (!res.ok) {
          const data = await readApiResponse(res).catch(() => ({}))
          throw new Error(data.error || 'Could not download filled file.')
        }
        const blob = await res.blob()
        const ext = template.type === 'excel' ? 'xlsx' : 'docx'
        saveBlob(blob, quotationFileName(quote, ext))
        return
      }
      if (kind === 'pdf') {
        await downloadQuotationPdf(quotationFileName(quote, 'pdf'))
        return
      }
      throw new Error('Export not available for this layout.')
    } catch (error) {
      setPdfNote(error.message || 'Export failed.')
    } finally {
      setPdfBusy(false)
    }
  }

  const displayFileId = filledFileId
  const doc = filledFileId ? {
    fileId: filledFileId,
    type: template.type,
    fileName: template.sourceFileName || `${template.name}.${template.type === 'excel' ? 'xlsx' : 'docx'}`
  } : null

  return (
    <main className="min-h-screen bg-[#e8ece8] text-ink">
      <nav className="no-print sticky top-0 z-30 border-b border-sand bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onHome} className="flex items-center gap-2">
              <BrandMark size={32} />
              <span className="font-semibold tracking-tight">QuoteGen</span>
            </button>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-moss">{template.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onNew} className="hidden rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 sm:block">New quotation</button>
            <button onClick={onRetry} className="rounded-lg border border-sand px-3 py-2 text-sm font-medium text-moss">↻ Retry AI</button>
            <PreviewPdfButton onExport={handleExport} busy={pdfBusy} variant="header" />
            <ExportMenu onExport={handleExport} busy={pdfBusy} label="Export" variant="header" />
          </div>
        </div>
        {pdfNote && <p className="mx-auto max-w-[1600px] px-4 pb-2 text-xs text-rose-600 sm:px-6">{pdfNote}</p>}
        {fillError && <p className="mx-auto max-w-[1600px] px-4 pb-2 text-xs text-amber-700 sm:px-6">{fillError}</p>}
      </nav>

      <div className="no-print mx-auto max-w-[1600px] border-b border-sand bg-white/80 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Your uploaded layout — filled in place</p>
            <p className="text-xs text-slate-500">
              Same document as when you uploaded. Edit details in the panel below; the file updates automatically.
            </p>
          </div>
          <span className="text-xs text-slate-500">
            {fillBusy ? 'Updating layout…' : saveStatusLabel(saveStatus)}
          </span>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1600px] flex-col gap-0 lg:flex-row">
        <aside className="no-print w-full shrink-0 border-b border-sand bg-white lg:w-[360px] lg:border-b-0 lg:border-r">
          <div className="max-h-[42vh] overflow-y-auto p-4 lg:max-h-[calc(100vh-200px)]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-moss">Customer</p>
            <div className="space-y-2">
              <SuggestField
                value={quote.customer?.company || ''}
                onChange={v => update(['customer', 'company'], v)}
                onPick={item => pickClient(item.client)}
                suggestions={clientSuggestionItems(suggestClients, quote.customer?.company, 'company')}
                placeholder="Company"
                className="w-full rounded border border-sand px-2 py-1.5 text-sm"
              />
              <SuggestField
                value={quote.customer?.name || ''}
                onChange={v => update(['customer', 'name'], v)}
                onPick={item => pickClient(item.client)}
                suggestions={clientSuggestionItems(suggestClients, quote.customer?.name, 'name')}
                placeholder="Contact name"
                className="w-full rounded border border-sand px-2 py-1.5 text-sm"
              />
              <SuggestField
                value={quote.customer?.location || ''}
                onChange={v => update(['customer', 'location'], v)}
                onPick={item => pickClient(item.client)}
                suggestions={clientSuggestionItems(suggestClients, quote.customer?.location, 'location')}
                placeholder="Location / address"
                className="w-full rounded border border-sand px-2 py-1.5 text-sm"
              />
              <SuggestField
                value={quote.customer?.gst || ''}
                onChange={v => update(['customer', 'gst'], v)}
                onPick={item => pickClient(item.client)}
                suggestions={clientSuggestionItems(suggestClients, quote.customer?.gst, 'gst')}
                placeholder="GSTIN"
                className="w-full rounded border border-sand px-2 py-1.5 text-sm"
              />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-moss">Line items</p>
              <button type="button" onClick={addRow} className="text-xs font-semibold text-moss hover:underline">+ Add row</button>
            </div>
            <div className="mt-2 space-y-3">
              {(quote.items || []).map((item, i) => {
                const descCol = columns?.find(c => c.id === 'description' || /description|particular/i.test(`${c.id} ${c.label}`))
                const descKey = descCol?.id || 'description'
                const qtyKey = columns?.find(c => c.id === 'quantity' || /qty|quantity/i.test(`${c.id} ${c.label}`))?.id || 'quantity'
                const rateKey = columns?.find(c => c.id === 'rate' || /^rate$/i.test(`${c.id} ${c.label}`))?.id || 'rate'
                return (
                  <div key={i} className="rounded-lg border border-sand bg-[#f7f9f7] p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400">#{i + 1}</span>
                      {(quote.items || []).length > 1 && (
                        <button type="button" onClick={() => removeRow(i)} className="text-[10px] text-rose-600 hover:underline">Remove</button>
                      )}
                    </div>
                    <SuggestField
                      multiline
                      value={item[descKey] || item.description || ''}
                      onChange={v => setItemField(i, descKey === 'description' ? 'description' : descKey, v)}
                      suggestions={productSuggestionItems(suggestProducts, item[descKey] || item.description)}
                      onPick={item => applyProduct(i, item.product)}
                      placeholder="Description"
                      className="mb-1 w-full rounded border border-sand px-2 py-1 text-sm"
                    />
                    <div className="grid grid-cols-3 gap-1">
                      <input
                        value={item[qtyKey] ?? ''}
                        onChange={e => setItemField(i, qtyKey, e.target.value)}
                        placeholder="Qty"
                        className="rounded border border-sand px-2 py-1 text-xs"
                      />
                      <input
                        value={item[rateKey] ?? ''}
                        onChange={e => setItemField(i, rateKey, e.target.value)}
                        placeholder="Rate"
                        className="rounded border border-sand px-2 py-1 text-xs"
                      />
                      <input
                        value={item[amountKey(columns)] ?? ''}
                        readOnly
                        placeholder="Amount"
                        className="rounded border border-sand bg-slate-50 px-2 py-1 text-xs text-slate-600"
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="mt-4 text-right text-sm font-semibold text-slate-700">
              Total: ₹ {Number(total ?? totals.grandTotal ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </aside>

        <section className="min-w-0 flex-1 p-3 sm:p-5">
          {fillBusy && !filledFileId && (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-sand bg-white px-6 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">Filling your layout with enquiry data…</p>
              <p className="mt-1 text-xs text-slate-500">Customer details, line items, and totals are written into your uploaded file.</p>
            </div>
          )}
          {!fillBusy && fillError && !filledFileId && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Could not fill this layout</p>
              <p className="mt-1">{fillError}</p>
            </div>
          )}
          {doc?.fileId ? (
            <NativeDocumentEditor
              key={`${doc.fileId}-${editorKey}`}
              doc={doc}
              height="calc(100vh - 220px)"
            />
          ) : !fillBusy && !fillError ? (
            <p className="text-sm text-rose-600">No layout file found for this template.</p>
          ) : null}
        </section>
      </div>
    </main>
  )
}
