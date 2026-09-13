import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { findFieldColumn, recalcAllRows } from '../shared/quoteColumns.js'
import {
  buildQuotationPayload,
  convertQuotationToInvoice,
  createQuotation,
  fetchCompanyProfile,
  getQuotation,
  peekInvoiceSeries,
  quotationToEditorState,
  updateQuotation
} from './quotePersistence.js'

const CONVERT_META = {
  'Proforma Invoice': {
    title: 'Convert to Proforma Invoice',
    docLabel: 'PROFORMA INVOICE',
    invoiceKind: 'proforma_invoice',
    numberLabel: 'PROFORMA NUMBER',
    numberHint: 'Next in your Proforma Invoice series — edit if you need a different number.',
    fallbackNumber: 'PI - 001',
    termsReset: 'Reset to standard Proforma Invoice terms',
    useInvoiceApi: false
  },
  'Tax Invoice': {
    title: 'Convert to Tax Invoice',
    docLabel: 'TAX INVOICE',
    invoiceKind: 'tax_invoice',
    numberLabel: 'INVOICE NUMBER',
    numberHint: 'Next in your Tax Invoice series — edit if you need a different number.',
    fallbackNumber: 'INV - 001',
    termsReset: 'Reset to standard Tax Invoice terms',
    useInvoiceApi: true
  },
  'Delivery Challan': {
    title: 'Convert to Delivery Challan',
    docLabel: 'DELIVERY CHALLAN',
    invoiceKind: null,
    numberLabel: 'CHALLAN NUMBER',
    numberHint: 'Next in your Delivery Challan series — edit if you need a different number.',
    fallbackNumber: 'DC - 001',
    termsReset: 'Reset to standard Delivery Challan terms',
    useInvoiceApi: false
  },
  'Purchase Order': {
    title: 'Convert to Purchase Order',
    docLabel: 'PURCHASE ORDER',
    invoiceKind: null,
    numberLabel: 'PO NUMBER',
    numberHint: 'Next in your Purchase Order series — edit if you need a different number.',
    fallbackNumber: 'PO - 001',
    termsReset: 'Reset to standard Purchase Order terms',
    useInvoiceApi: false
  }
}

function itemLabel(item, columns) {
  const descCol = findFieldColumn(columns, 'description')
    || columns.find((c) => /desc|item|product|particular/i.test(`${c.id} ${c.label}`))
  if (descCol) {
    const text = String(item?.[descCol.id] || '').trim()
    if (text) return text.split('\n')[0]
  }
  return String(item?.description || '').trim().split('\n')[0] || 'Item'
}

function itemQty(item, columns) {
  const qtyCol = findFieldColumn(columns, 'quantity')
  const raw = qtyCol ? item?.[qtyCol.id] : (item?.quantity ?? item?.qty)
  const n = Number(String(raw ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function termsTextFromQuote(quote, profile) {
  const fromFields = quote?.fields?.standardTerms
  if (fromFields) return String(fromFields)
  const fromTerms = quote?.terms
  if (typeof fromTerms === 'string') return fromTerms
  if (fromTerms && typeof fromTerms === 'object') {
    return String(fromTerms.body || fromTerms.text || fromTerms.standardTerms || '')
  }
  return String(profile?.standardTerms || '')
}

function WsConvertIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1A73E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 9H4l4-4" />
      <path d="M16 15h4l-4 4" />
      <path d="M4 9h16" />
      <path d="M20 15H4" />
    </svg>
  )
}

export default function WsConvertModal({ quoteId, convertType, onClose, onDone }) {
  const meta = CONVERT_META[convertType] || CONVERT_META['Tax Invoice']
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [docNumber, setDocNumber] = useState(meta.fallbackNumber)
  const [currency, setCurrency] = useState('INR')
  const [termsOpen, setTermsOpen] = useState(true)
  const [terms, setTerms] = useState('')
  const [defaultTerms, setDefaultTerms] = useState('')
  const [rows, setRows] = useState([])
  const [source, setSource] = useState(null)
  const [columns, setColumns] = useState([])
  const qtyColId = useMemo(() => findFieldColumn(columns, 'quantity')?.id || null, [columns])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const [quoteRes, profileRes] = await Promise.all([
          getQuotation(quoteId),
          fetchCompanyProfile().catch(() => ({ profile: null }))
        ])
        if (cancelled) return
        if (quoteRes.unavailable) {
          setError('Cloud save is not configured.')
          setLoading(false)
          return
        }
        const editor = quotationToEditorState(quoteRes.quotation)
        const cols = editor.columns || []
        const profile = profileRes.profile
        const initialTerms = termsTextFromQuote(editor, profile)
        setSource(editor)
        setColumns(cols)
        setDefaultTerms(initialTerms)
        setTerms(initialTerms)
        setRows((editor.items || []).map((item, index) => ({
          index,
          item,
          label: itemLabel(item, cols),
          qty: itemQty(item, cols),
          kept: true
        })))
        if (meta.useInvoiceApi) {
          try {
            const peek = await peekInvoiceSeries()
            if (!cancelled && !peek.unavailable && peek.peek?.number) {
              setDocNumber(peek.peek.number)
            }
          } catch {
            /* keep fallback */
          }
        } else {
          setDocNumber(meta.fallbackNumber)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load quotation')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [quoteId, convertType, meta.fallbackNumber, meta.useInvoiceApi])

  const keptCount = rows.filter((r) => r.kept).length
  const droppedCount = rows.length - keptCount

  const toggleRow = (index) => {
    setRows((prev) => prev.map((r) => (r.index === index ? { ...r, kept: !r.kept } : r)))
  }

  const setRowQty = (index, qty) => {
    const n = Number(String(qty).replace(/,/g, ''))
    setRows((prev) => prev.map((r) => (r.index === index ? { ...r, qty: Number.isFinite(n) ? n : 0 } : r)))
  }

  const selectAll = () => setRows((prev) => prev.map((r) => ({ ...r, kept: true })))
  const clearAll = () => setRows((prev) => prev.map((r) => ({ ...r, kept: false })))

  const buildNextItems = () => {
    const kept = rows.filter((r) => r.kept)
    const next = kept.map(({ item, qty }) => {
      const copy = { ...item }
      if (qtyColId) copy[qtyColId] = String(qty)
      else {
        copy.quantity = String(qty)
        copy.qty = String(qty)
      }
      return copy
    })
    return recalcAllRows(next, columns)
  }

  const handleConvert = async () => {
    if (!source || keptCount === 0) {
      setError('Select at least one line item to convert.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const nextItems = buildNextItems()
      const nextTerms = terms.trim()
      const docTitle = meta.docLabel || convertType
      const number = docNumber.trim()

      if (meta.useInvoiceApi) {
        const gst = String(source.customer?.gst || '').trim()
        if (!gst) {
          setError('Add the customer GST number on the quotation before raising a tax invoice.')
          setBusy(false)
          return
        }
        const result = await convertQuotationToInvoice(quoteId, {
          customerGst: gst,
          title: convertType,
          number
        })
        if (result.unavailable) throw new Error('Cloud save is not configured.')
        if (result.gstRequired) throw new Error(result.error || 'Customer GST is required.')
        if (result.numberInUse) throw new Error(result.error || 'That number is already used.')

        const editor = quotationToEditorState(result.invoice)
        const payload = buildQuotationPayload({
          ...editor,
          invoiceKind: meta.invoiceKind || editor.invoiceKind,
          items: nextItems,
          title: convertType,
          terms: { ...(editor.terms || {}), body: nextTerms },
          fields: { ...(editor.fields || {}), standardTerms: nextTerms, docTitle }
        }, {
          layoutRef: editor.layoutRef,
          uploadTemplateId: editor.uploadTemplateId
        })
        await updateQuotation(result.invoice.id, payload)
        onDone?.(result.invoice.id)
        onClose()
        return
      }

      const payload = buildQuotationPayload({
        ...source,
        items: nextItems,
        number,
        title: convertType,
        invoiceKind: meta.invoiceKind || source.invoiceKind || null,
        terms: { ...(source.terms || {}), body: nextTerms },
        fields: { ...(source.fields || {}), standardTerms: nextTerms, docTitle }
      }, {
        layoutRef: source.layoutRef,
        uploadTemplateId: source.uploadTemplateId
      })
      const created = await createQuotation(payload)
      if (created.unavailable) throw new Error('Cloud save is not configured.')
      onDone?.(created.quotation.id)
      onClose()
    } catch (e) {
      setError(e.message || 'Could not convert')
    } finally {
      setBusy(false)
    }
  }

  const fieldStyle = {
    width: '100%',
    minHeight: 48,
    padding: '0 14px',
    border: '1.5px solid #D5DDE9',
    borderRadius: 12,
    fontSize: 15,
    background: '#fff',
    color: '#0D1117'
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ws-convert-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(15,23,42,.42)',
        backdropFilter: 'blur(2px)'
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div style={{
        width: 'min(640px, 100%)',
        maxHeight: 'min(92vh, 860px)',
        overflow: 'auto',
        background: '#fff',
        borderRadius: 20,
        boxShadow: '0 28px 60px -24px rgba(20,35,80,.45)',
        border: '1px solid #E8EBF2'
      }}>
        <div style={{ padding: '22px 24px 0', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 auto', marginTop: 2 }}><WsConvertIcon /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="ws-convert-title" style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', color: '#0D1117' }}>{meta.title}</h2>
            <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.55, color: '#6B7688' }}>
              Confirm approved line items, quantities and rates. Terms, notes and other details are carried over — edit them on the new document if needed.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            style={{
              flex: '0 0 auto',
              width: 36,
              height: 36,
              border: '1.5px solid #D5DDE9',
              borderRadius: 999,
              background: '#fff',
              color: '#1A73E8',
              fontSize: 20,
              lineHeight: 1,
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '20px 24px 24px', display: 'grid', gap: 18 }}>
          {loading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: '#6B7688', fontSize: 15 }}>Loading line items…</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9AA4B5', marginBottom: 6 }}>{meta.numberLabel}</label>
                  <input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} style={fieldStyle} />
                  <p style={{ margin: '6px 0 0', fontSize: 12.5, color: '#9AA4B5', lineHeight: 1.4 }}>{meta.numberHint}</p>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#9AA4B5', marginBottom: 6 }}>CURRENCY</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ ...fieldStyle, appearance: 'auto' }}>
                    <option value="INR">₹ INR</option>
                  </select>
                </div>
              </div>

              <div style={{ border: '1px solid #E8EBF2', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #EEF1F7', flexWrap: 'wrap' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" strokeWidth="2.2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#0D1117' }}>Approved line items</span>
                  <span style={{ fontSize: 13.5, color: '#9AA4B5' }}>{keptCount}/{rows.length} kept · {droppedCount} dropped</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
                    <button type="button" onClick={selectAll} style={{ border: 0, background: 'none', color: '#1A73E8', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Select all</button>
                    <button type="button" onClick={clearAll} style={{ border: 0, background: 'none', color: '#1A73E8', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Clear</button>
                  </div>
                </div>
                <div style={{ display: 'grid' }}>
                  {rows.map((row) => (
                    <div key={row.index} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #F0F3F8' }}>
                      <button
                        type="button"
                        aria-label={row.kept ? 'Remove item' : 'Keep item'}
                        onClick={() => toggleRow(row.index)}
                        style={{
                          width: 28,
                          height: 28,
                          flex: '0 0 28px',
                          border: 0,
                          borderRadius: 999,
                          background: row.kept ? '#1A73E8' : '#fff',
                          color: row.kept ? '#fff' : '#C7D0E0',
                          boxShadow: row.kept ? 'none' : 'inset 0 0 0 1.5px #D5DDE9',
                          cursor: 'pointer',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 14,
                          fontWeight: 800
                        }}
                      >
                        {row.kept ? '✓' : ''}
                      </button>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, color: row.kept ? '#0D1117' : '#9AA4B5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={row.qty}
                        disabled={!row.kept}
                        onChange={(e) => setRowQty(row.index, e.target.value)}
                        style={{
                          width: 72,
                          minHeight: 40,
                          padding: '0 10px',
                          border: '1.5px solid #D5DDE9',
                          borderRadius: 10,
                          fontSize: 15,
                          textAlign: 'right',
                          background: row.kept ? '#fff' : '#F8FAFC',
                          color: '#0D1117'
                        }}
                      />
                    </div>
                  ))}
                  {rows.length === 0 && (
                    <div style={{ padding: '24px 16px', color: '#9AA4B5', fontSize: 14.5 }}>No line items on this quotation.</div>
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid #E8EBF2', borderRadius: 14, background: '#FAFBFE', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px' }}>
                  <span style={{ color: '#1A73E8', fontSize: 16 }}>✦</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0D1117' }}>Terms &amp; Conditions</div>
                    <div style={{ fontSize: 13, color: '#9AA4B5', marginTop: 2 }}>Using your company default terms</div>
                  </div>
                  <button type="button" onClick={() => setTermsOpen((o) => !o)} style={{ border: 0, background: 'none', color: '#6B7688', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                    {termsOpen ? 'Hide ⌃' : 'Show ⌄'}
                  </button>
                </div>
                {termsOpen && (
                  <div style={{ padding: '0 16px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                      <button type="button" onClick={() => setTerms(defaultTerms)} style={{ border: 0, background: 'none', color: '#1A73E8', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                        {meta.termsReset}
                      </button>
                    </div>
                    <textarea
                      value={terms}
                      onChange={(e) => setTerms(e.target.value)}
                      placeholder="Terms that will appear on the generated document…"
                      style={{
                        width: '100%',
                        minHeight: 120,
                        padding: '12px 14px',
                        border: '1.5px solid #D5DDE9',
                        borderRadius: 12,
                        fontSize: 14.5,
                        lineHeight: 1.55,
                        resize: 'vertical',
                        background: '#fff',
                        color: '#0D1117'
                      }}
                    />
                  </div>
                )}
              </div>

              {error && (
                <p style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', color: '#B42318', fontSize: 14 }}>{error}</p>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, paddingTop: 4 }}>
                <button type="button" disabled={busy} onClick={onClose} style={{ minHeight: 46, padding: '0 18px', border: 0, background: 'none', fontSize: 15, fontWeight: 700, color: '#3D4859', cursor: 'pointer' }}>Cancel</button>
                <button
                  type="button"
                  disabled={busy || keptCount === 0}
                  onClick={handleConvert}
                  style={{
                    minHeight: 46,
                    padding: '0 22px',
                    border: 0,
                    borderRadius: 12,
                    background: '#1A73E8',
                    color: '#fff',
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: keptCount === 0 ? 'not-allowed' : 'pointer',
                    opacity: keptCount === 0 ? 0.5 : 1
                  }}
                >
                  {busy ? 'Converting…' : `Convert · ${keptCount} item${keptCount === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
