import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ingestEnquiryFiles, uploadCompanyLogo } from './quotePersistence.js'
import { downloadQuotationPdf, quotationFileName } from './pdfExport.js'
import { QuoteStudioCanvas } from './QuoteStudio.jsx'
import { resolvePaperTheme } from './quotePaperThemes.js'
import { defaultA4Pages, measureA4Blocks, packA4Pages, pagesEqual } from './a4Pagination.js'
import { NAMED_AMOUNT_COLUMN_PRESETS, buildNamedAmountColumn, formulaEditPatch, isFormulaColumn } from '../shared/quoteFormulas.js'
import {
  amountEditPatch,
  computeQuoteTotals,
  findFieldColumn,
  highlightColor,
  isAttachmentColumn,
  isHighlightColumn,
  isImageColumn,
  isNestedColumn,
  rateKey,
  recalcRow,
  toNumber
} from '../shared/quoteColumns.js'
import { formatIndianAmount } from '../shared/templateMap.js'
import { companySeedFromLead, readMetaAdsLead, usefulLead } from './metaTrialLead.js'
import { trackPixel } from './metaPixel.js'
import './metaTrialGuide.css'

const ENQUIRY_FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,application/pdf,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain'

const CORE_COLUMNS = [
  { id: 'description', label: 'Description', type: 'text', locked: true },
  { id: 'unit', label: 'Unit', type: 'text', locked: true },
  { id: 'quantity', label: 'Quantity', type: 'text', locked: true },
  { id: 'rate', label: 'Rate', type: 'text', locked: true },
  { id: 'amount', label: 'Amount', type: 'text', locked: true }
]

const OPTIONAL_PRESETS = [
  { id: 'hsn', label: 'HSN / SAC', type: 'hsn' },
  { id: 'gst', label: 'GST', type: 'tax' },
  { id: 'discount', label: 'Discount', type: 'discount' },
  { id: 'image', label: 'Image', type: 'image' }
]

const CEREMONY_BEATS = [
  { id: 'read', stage: 'scan', title: 'Scanning the enquiry', detail: 'Reading every line of the client message…' },
  { id: 'extract', stage: 'lift', title: 'Pulling the details free', detail: 'Products, quantities, and rates lifting off the page…' },
  { id: 'map', stage: 'map', title: 'Slotting into your layout', detail: 'Each detail snapping into the columns you chose…' },
  { id: 'build', stage: 'forge', title: 'Forging the quotation', detail: 'Assembling a client-ready sheet — almost there…' }
]

const CEREMONY_SHARD_FALLBACKS = ['Qty', 'Rate', 'Item', 'Unit', '12', '1,250', 'Nos', 'Amount']

function ceremonyShards(enquiryText, columns) {
  const fromText = String(enquiryText || '')
    .replace(/[^\w\s.,%/₹$-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 18)
    .slice(0, 6)
  const fromCols = (Array.isArray(columns) ? columns : [])
    .map((c) => c.label)
    .filter(Boolean)
    .slice(0, 4)
  const mixed = [...fromText, ...fromCols, ...CEREMONY_SHARD_FALLBACKS]
  const seen = new Set()
  const out = []
  for (const raw of mixed) {
    const key = String(raw).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(String(raw).slice(0, 16))
    if (out.length >= 8) break
  }
  return out
}

function IconUpload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5" />
    </svg>
  )
}

function IconMail() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function IconPencil() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function placeholderFor(col) {
  const id = String(col?.id || '').toLowerCase()
  const label = String(col?.label || '').toLowerCase()
  const type = String(col?.type || '').toLowerCase()
  if (id === 'description' || /desc|particular|item/.test(label)) return 'Sample line item'
  if (id === 'unit' || /unit|uom/.test(label)) return 'Nos'
  if (id === 'quantity' || /qty|quantity/.test(label)) return '12'
  if (id === 'rate' || /rate|price/.test(label)) return '1,250'
  if (id === 'amount' || /amount|total/.test(label)) return '15,000'
  if (type === 'hsn' || /hsn|sac/.test(label)) return '8481'
  if (type === 'tax' || /gst|tax|cgst|sgst|igst/.test(label)) return '18%'
  if (type === 'discount' || /discount/.test(label)) return '5%'
  if (type === 'image' || /image|photo/.test(label)) return '—'
  return '—'
}

function money(n) {
  return `₹ ${formatIndianAmount(n)}`
}

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

  const parts = text.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 3) {
    return { primary: parts.slice(0, 2).join(', '), secondary: parts.slice(2).join(', ') }
  }
  if (parts.length === 2) {
    return { primary: parts[0], secondary: parts[1] }
  }

  return { primary: text, secondary: '' }
}

function isDescriptionColumn(col) {
  if (!col) return false
  if (col.id === 'description') return true
  return /^(description|enquiry|inquiry|particular)$/i.test(String(col.label || '').trim())
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
  if (isDescriptionColumn(col)) {
    const { primary, secondary } = splitDescription(item?.[col.id])
    if (!primary && !secondary) return '—'
    return (
      <div className="meta-guide-real-desc">
        {primary ? <p className="meta-guide-real-desc-title">{primary}</p> : null}
        {secondary ? <p className="meta-guide-real-desc-caption">{secondary}</p> : null}
      </div>
    )
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function LayoutPreviewTable({ columns, onRemove }) {
  const cols = Array.isArray(columns) ? columns : []
  return (
    <div className="meta-guide-table-wrap">
      <table className="meta-guide-table">
        <colgroup>
          <col style={{ width: '52px' }} />
          {cols.map((c) => (
            <col key={c.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Sr.</th>
            {cols.map((c) => {
              const locked = CORE_COLUMNS.some((x) => x.id === c.id && x.locked)
              return (
                <th key={c.id} scope="col">
                  <span className="meta-guide-th-inner">
                    <span>{c.label}</span>
                    {!locked && onRemove && (
                      <button
                        type="button"
                        className="meta-guide-col-remove"
                        onClick={() => onRemove(c.id)}
                        aria-label={`Remove ${c.label}`}
                      >
                        ×
                      </button>
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          <tr className="is-placeholder">
            <td>1</td>
            {cols.map((c) => (
              <td key={c.id}>{placeholderFor(c)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Same tabular look as Company settings live preview — filled with real quote rows. */
function RealQuotePreviewTable({
  quote,
  companyProfile = null,
  maxRows = null,
  showTerms = false,
  editableRates = false,
  onRateChange,
  onUploadLogo,
  onAddAddress,
  logoBusy = false,
  hasAddress = false
}) {
  const columns = Array.isArray(quote?.columns) && quote.columns.length ? quote.columns : CORE_COLUMNS.map(({ locked, ...c }) => c)
  const allItems = Array.isArray(quote?.items) ? quote.items : []
  const items = maxRows != null ? allItems.slice(0, maxRows) : allItems
  const totals = computeQuoteTotals(allItems, columns, quote?.extraLines)
  const amountCol = findFieldColumn(columns, 'amount')
  const rateCol = findFieldColumn(columns, 'rate')
  const profile = companyProfile || quote?.companyProfile || null
  const companyName = String(profile?.companyName || '').trim()
  const headerText = String(profile?.headerText || '').trim()
  const logoUrl = String(profile?.logoUrl || '').trim()
  const terms = String(profile?.standardTerms || '').trim()
  const clientName = String(quote?.customer?.name || '').trim()
  const clientCompany = String(quote?.customer?.company || '').trim()
  const clientGst = String(quote?.customer?.gst || '').trim()
  const clientLocation = String(quote?.customer?.location || '').trim()
  const hasClient = Boolean(clientName || clientCompany || clientGst || clientLocation)
  const hasCompany = Boolean(companyName || logoUrl)
  const quoteMetaLabel = [
    quote?.number ? `Quotation ${quote.number}` : 'Quotation',
    quote?.date || ''
  ].filter(Boolean).join(' · ')
  const canEditLetterhead = Boolean(onUploadLogo || onAddAddress)

  const quotedToBody = hasClient ? (
    <div className="meta-guide-real-quoted-to-body">
      {clientName ? <p>{clientName}</p> : null}
      {clientCompany ? <p className={clientName ? 'meta-guide-real-preview-muted' : ''}>{clientCompany}</p> : null}
      {clientGst ? <p className="meta-guide-real-preview-muted">GST {clientGst}</p> : null}
      {clientLocation ? <p className="meta-guide-real-preview-muted">{clientLocation}</p> : null}
    </div>
  ) : (
    <p className="meta-guide-real-quoted-placeholder">Client details after sign up</p>
  )

  const letterhead = (
    <div className="meta-guide-real-letterhead">
      {onUploadLogo ? (
        <button
          type="button"
          className={`meta-guide-logo-slot${logoUrl ? ' has-logo' : ''}${logoBusy ? ' is-busy' : ''}`}
          onClick={onUploadLogo}
          disabled={logoBusy}
          aria-label={logoUrl ? 'Replace company logo' : 'Upload company logo'}
        >
          {logoUrl ? (
            <img src={logoUrl} alt="" className="meta-guide-real-logo" />
          ) : (
            <>
              <span className="meta-guide-logo-slot-icon" aria-hidden="true"><IconPlus /></span>
              <span>Logo</span>
            </>
          )}
        </button>
      ) : logoUrl ? (
        <img src={logoUrl} alt="" className="meta-guide-real-logo" />
      ) : null}
      <div className="meta-guide-real-letterhead-text">
        {companyName ? (
          <div className="meta-guide-real-preview-brand">{companyName}</div>
        ) : (
          <div className="meta-guide-real-preview-brand">QuoteGen</div>
        )}
        {headerText ? <div className="meta-guide-real-preview-header-text">{headerText}</div> : null}
        {onAddAddress ? (
          <button
            type="button"
            className="meta-guide-letterhead-btn"
            onClick={onAddAddress}
            aria-label={hasAddress ? 'Edit address' : 'Add address'}
            title={hasAddress ? 'Edit address' : 'Add address'}
          >
            <IconPencil />
          </button>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className="meta-guide-real-preview">
      <div className={`meta-guide-real-preview-meta${hasCompany || canEditLetterhead ? ' has-company' : ''}`}>
        <div className="meta-guide-real-preview-from">
          {hasCompany || canEditLetterhead ? (
            letterhead
          ) : (
            <>
              <div className="meta-guide-real-preview-brand">QuoteGen</div>
              <div className="meta-guide-real-preview-sub">{quoteMetaLabel}</div>
            </>
          )}
        </div>
        <div className="meta-guide-real-preview-aside">
          {hasCompany || canEditLetterhead ? (
            <div className="meta-guide-real-preview-quote-meta">
              <p className="meta-guide-real-preview-kicker">Quotation</p>
              {quote?.number ? <p className="meta-guide-real-preview-quote-no">{quote.number}</p> : null}
              {quote?.date ? <p className="meta-guide-real-preview-muted">{quote.date}</p> : null}
            </div>
          ) : (
            <div className="meta-guide-real-preview-client">
              <p className="meta-guide-real-preview-kicker">Quoted to</p>
              {quotedToBody}
            </div>
          )}
        </div>
      </div>

      {(hasCompany || canEditLetterhead) && (
        <div className="meta-guide-real-quoted-to">
          <p className="meta-guide-real-preview-kicker">Quoted to</p>
          {quotedToBody}
        </div>
      )}

      <table className="meta-guide-real-table">
        <thead>
          <tr>
            <th className="is-sr">Sr.</th>
            {columns.map((col) => {
              const right = previewColAlignRight(col, columns)
              const highlight = isHighlightColumn(col) ? { backgroundColor: highlightColor(col) } : undefined
              if (isNestedColumn(col)) {
                return (
                  <th key={col.id} className="is-right" style={highlight}>
                    {col.label} %
                  </th>
                )
              }
              return (
                <th key={col.id} className={right ? 'is-right' : ''} style={highlight}>
                  {col.label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="is-empty">No line items yet</td>
            </tr>
          ) : items.map((item, index) => (
            <tr key={index}>
              <td className="is-sr">{index + 1}</td>
              {columns.map((col) => {
                const highlight = isHighlightColumn(col) ? { backgroundColor: highlightColor(col) } : undefined
                if (isNestedColumn(col)) {
                  const rate = item[rateKey(col)]
                  return (
                    <td key={col.id} className="is-right is-muted" style={highlight}>
                      {rate ? `${rate}%` : '—'}
                    </td>
                  )
                }
                const right = previewColAlignRight(col, columns)
                const isAmount = col.id === amountCol?.id
                const isRate = col.id === rateCol?.id
                return (
                  <td
                    key={col.id}
                    className={`${right ? 'is-right' : ''} ${isAmount ? 'is-amount' : right ? 'is-muted' : ''}`}
                    style={highlight}
                  >
                    {isImageColumn(col) ? (
                      <span className="meta-guide-real-img-ph" />
                    ) : isAttachmentColumn(col) ? (
                      <span className="is-muted">File</span>
                    ) : editableRates && isRate ? (
                      <label className="meta-guide-rate-field">
                        <span>₹</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="meta-guide-rate-input"
                          value={item?.[col.id] ?? ''}
                          placeholder="0"
                          aria-label={`Rate for row ${index + 1}`}
                          onChange={(e) => onRateChange?.(index, e.target.value)}
                        />
                      </label>
                    ) : formatPreviewCell(item, col, columns)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="meta-guide-real-totals">
        <div className="meta-guide-real-totals-row">
          <span>Subtotal</span>
          <span>{money(totals.subtotal ?? totals.grandTotal)}</span>
        </div>
        <div className="meta-guide-real-totals-row is-total">
          <span>Total</span>
          <span>{money(totals.grandTotal)}</span>
        </div>
      </div>

      {showTerms && terms ? (
        <div className="meta-guide-real-terms">
          <p className="meta-guide-real-preview-kicker">Standard terms</p>
          <p className="meta-guide-real-terms-body">{terms}</p>
        </div>
      ) : null}
    </div>
  )
}

/** Logged-in quotation look — A4 letterhead document for the final dark-bg reveal. */
function FinalQuoteDocument({ quote, companyProfile = null }) {
  const columns = Array.isArray(quote?.columns) && quote.columns.length ? quote.columns : CORE_COLUMNS.map(({ locked, ...c }) => c)
  const items = Array.isArray(quote?.items) ? quote.items : []
  const totals = computeQuoteTotals(items, columns, quote?.extraLines)
  const amountCol = findFieldColumn(columns, 'amount')
  const profile = companyProfile || quote?.companyProfile || null
  const companyName = String(profile?.companyName || '').trim() || 'Your Company Name'
  const headerText = String(profile?.headerText || '').trim()
  const logoUrl = String(profile?.logoUrl || '').trim()
  const terms = String(profile?.standardTerms || '').trim()
  const title = String(quote?.title || quote?.subject || '').trim()
  const clientName = String(quote?.customer?.name || '').trim()
  const clientCompany = String(quote?.customer?.company || '').trim()
  const clientGst = String(quote?.customer?.gst || '').trim()
  const clientLocation = String(quote?.customer?.location || '').trim()
  const initial = companyName.charAt(0).toUpperCase() || 'Q'

  return (
    <article className="meta-guide-doc">
      <header className="meta-guide-doc-header">
        <div className="meta-guide-doc-letterhead">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="meta-guide-doc-logo" />
          ) : (
            <span className="meta-guide-doc-mark" aria-hidden="true">{initial}</span>
          )}
          <div className="meta-guide-doc-letterhead-text">
            <h2>{companyName}</h2>
            {headerText ? <p>{headerText}</p> : null}
          </div>
        </div>
        <div className="meta-guide-doc-meta">
          <p className="meta-guide-doc-meta-title">QUOTATION</p>
          <p className="meta-guide-doc-meta-line">
            {quote?.number || 'QG-XXXX'}
            {quote?.date ? <> &nbsp;|&nbsp; {quote.date}</> : null}
          </p>
        </div>
      </header>

      <div className="meta-guide-doc-body">
        {title ? <h3 className="meta-guide-doc-subject">{title}</h3> : null}

        <div className="meta-guide-doc-parties">
          <div>
            <p className="meta-guide-doc-kicker">Quoted to</p>
            {clientName || clientCompany ? (
              <>
                {clientName ? <p className="meta-guide-doc-strong">{clientName}</p> : null}
                {clientCompany ? <p className="meta-guide-doc-muted">{clientCompany}</p> : null}
              </>
            ) : (
              <p className="meta-guide-doc-muted">Client details after sign up</p>
            )}
          </div>
          <div>
            <p className="meta-guide-doc-kicker">Customer details</p>
            {clientGst ? <p className="meta-guide-doc-strong">GST {clientGst}</p> : <p className="meta-guide-doc-muted">GST —</p>}
            {clientLocation ? <p className="meta-guide-doc-muted">{clientLocation}</p> : <p className="meta-guide-doc-muted">Location —</p>}
          </div>
        </div>

        <table className="meta-guide-doc-table">
          <thead>
            <tr>
              <th className="is-sr">Sr.</th>
              {columns.map((col) => {
                const right = previewColAlignRight(col, columns)
                const highlight = isHighlightColumn(col) ? { backgroundColor: highlightColor(col) } : undefined
                if (isNestedColumn(col)) {
                  return (
                    <th key={col.id} className="is-right" style={highlight}>
                      {col.label} %
                    </th>
                  )
                }
                return (
                  <th key={col.id} className={right ? 'is-right' : ''} style={highlight}>
                    {col.label}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="is-empty">No line items yet</td>
              </tr>
            ) : items.map((item, index) => (
              <tr key={index}>
                <td className="is-sr">{index + 1}</td>
                {columns.map((col) => {
                  const highlight = isHighlightColumn(col) ? { backgroundColor: highlightColor(col) } : undefined
                  if (isNestedColumn(col)) {
                    const rate = item[rateKey(col)]
                    return (
                      <td key={col.id} className="is-right is-muted" style={highlight}>
                        {rate ? `${rate}%` : '—'}
                      </td>
                    )
                  }
                  const right = previewColAlignRight(col, columns)
                  const isAmount = col.id === amountCol?.id
                  return (
                    <td
                      key={col.id}
                      className={`${right ? 'is-right' : ''} ${isAmount ? 'is-amount' : right ? 'is-muted' : ''}`}
                      style={highlight}
                    >
                      {isImageColumn(col) ? (
                        <span className="meta-guide-real-img-ph" />
                      ) : isAttachmentColumn(col) ? (
                        <span className="is-muted">File</span>
                      ) : formatPreviewCell(item, col, columns)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="meta-guide-doc-totals">
          <div className="meta-guide-doc-totals-row">
            <span>Subtotal</span>
            <span>{money(totals.subtotal ?? totals.grandTotal)}</span>
          </div>
          <div className="meta-guide-doc-totals-row is-total">
            <span>Total</span>
            <span>{money(totals.grandTotal)}</span>
          </div>
          <p className="meta-guide-doc-totals-note">Taxes extra as applicable</p>
        </div>

        <section className="meta-guide-doc-terms">
          <h4>Standard terms</h4>
          {terms ? (
            <p>{terms}</p>
          ) : (
            <p className="meta-guide-doc-muted">Standard terms for this quotation</p>
          )}
        </section>

        <div className="meta-guide-doc-sign">
          <div>
            <div className="meta-guide-doc-sign-space" />
            <p className="meta-guide-doc-strong">Authorized Signatory</p>
            <p className="meta-guide-doc-muted">For {companyName}</p>
          </div>
        </div>
      </div>
    </article>
  )
}

function GuideModal({ title, onClose, children, className = '' }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="meta-guide-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meta-guide-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div className={`meta-guide-modal ${className}`.trim()}>
        <div className="meta-guide-modal-head">
          <h2 id="meta-guide-modal-title">{title}</h2>
          <button type="button" className="meta-guide-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const PHONEPE_QR_SRC = '/phonepe-qr.png'
const JOIN_PRICE = 199
const REGULAR_PRICE = 699
const JOIN_QUOTES = 20
const OFFER_MS = 10 * 60 * 1000
const OFFER_STARTED_KEY = 'qg_join_offer_started'

function readOfferStart() {
  try {
    const at = Number(localStorage.getItem(OFFER_STARTED_KEY))
    return Number.isFinite(at) && at > 0 ? at : null
  } catch {
    return null
  }
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function trialExportColWidths(columns) {
  const sr = 36
  const widths = (columns || []).map((col) => {
    if (isDescriptionColumn(col)) return 0
    if (col.id === 'unit' || /unit|uom/i.test(String(col.label || ''))) return 52
    if (col.id === 'quantity' || /qty|quantity/i.test(String(col.label || ''))) return 70
    if (col.id === 'rate' || /rate|price/i.test(String(col.label || ''))) return 78
    if (col.id === 'amount' || /amount|total/i.test(String(col.label || ''))) return 88
    return 72
  })
  const printable = 718
  const used = sr + widths.reduce((sum, w) => sum + w, 0)
  const descIdx = (columns || []).findIndex(isDescriptionColumn)
  if (descIdx >= 0) widths[descIdx] = Math.max(260, printable - used)
  return { sr, widths }
}

function TrialFormalExport({ quote, companyProfile = null }) {
  const columns = Array.isArray(quote?.columns) && quote.columns.length ? quote.columns : CORE_COLUMNS.map(({ locked, ...c }) => c)
  const items = Array.isArray(quote?.items) ? quote.items : []
  const totals = computeQuoteTotals(items, columns, quote?.extraLines)
  const profile = companyProfile || quote?.companyProfile || null
  const companyName = String(profile?.companyName || '').trim() || 'Your Company Name'
  const headerText = String(profile?.headerText || '').trim()
  const logoUrl = String(profile?.logoUrl || '').trim()
  const terms = String(profile?.standardTerms || '').trim()
  const title = String(quote?.title || quote?.subject || '').trim()
  const clientName = String(quote?.customer?.name || '').trim()
  const clientCompany = String(quote?.customer?.company || '').trim()
  const clientGst = String(quote?.customer?.gst || '').trim()
  const clientLocation = String(quote?.customer?.location || '').trim()
  const hasClient = Boolean(clientName || clientCompany || clientGst || clientLocation)
  const theme = resolvePaperTheme('formal')
  const initial = companyName.charAt(0).toUpperCase() || 'Q'
  const colWidths = trialExportColWidths(columns)
  const rootRef = useRef(null)
  const [pages, setPages] = useState(() => defaultA4Pages(items.length))

  useLayoutEffect(() => {
    const measured = measureA4Blocks(rootRef.current)
    const next = packA4Pages({ rowCount: items.length, ...measured })
    setPages((prev) => (pagesEqual(prev, next) ? prev : next))
  }, [items, columns, companyName, headerText, logoUrl, title, terms, clientName, clientCompany])

  const letterhead = (
    <header className="qg-paper-header qg-paper-header--formal" data-qg-block="header">
      <div className="qg-formal-letterhead">
        <div className="qg-letterhead qg-letterhead--formal">
          <div className="qg-letterhead-mark" style={{ width: 46 }}>
            {logoUrl ? (
              <img src={logoUrl} alt="" style={{ width: '100%', maxHeight: 46, objectFit: 'contain', display: 'block' }} />
            ) : (
              <div className="qg-letterhead-initial" style={{ width: 46, height: 46, background: theme.accent, fontSize: 18 }}>
                {initial}
              </div>
            )}
          </div>
          <div className="qg-letterhead-text">
            <p className="qg-letterhead-name" style={{ color: theme.text }}>{companyName}</p>
            {headerText ? (
              <p className="qg-letterhead-address" style={{ color: theme.muted, whiteSpace: 'pre-line' }}>{headerText}</p>
            ) : null}
          </div>
        </div>
        <div className="qg-formal-docmeta">
          <p className="qg-doc-title" style={{ color: theme.accent, fontFamily: theme.titleFont }}>QUOTATION</p>
          <div className="qg-formal-docmeta-no">{quote?.number || 'QG-XXXX'}</div>
          <div className="qg-formal-docmeta-date">{quote?.date || ''}</div>
        </div>
      </div>
    </header>
  )

  const parties = (
    <div className="qg-to-subject-wrap qg-to-subject-wrap--formal" data-qg-block="meta">
      {title ? <h3 className="qg-formal-subject" style={{ color: theme.text }}>{title}</h3> : null}
      <div className="qg-to-subject-section qg-formal-parties">
        <div className="qg-to-col">
          <p className="qg-section-chip" style={{ color: theme.accent }}>Quoted to</p>
          {hasClient ? (
            <>
              {clientName ? <p className="font-semibold">{clientName}</p> : null}
              {clientCompany ? <p style={{ color: theme.muted }}>{clientCompany}</p> : null}
              {clientGst ? <p style={{ color: theme.muted }}>GST {clientGst}</p> : null}
              {clientLocation ? <p style={{ color: theme.muted }}>{clientLocation}</p> : null}
            </>
          ) : (
            <p style={{ color: theme.muted }}>—</p>
          )}
        </div>
        <div className="qg-subject-col">
          <p className="qg-section-chip" style={{ color: theme.accent }}>Subject</p>
          <p>{title || 'Quotation'}</p>
        </div>
      </div>
    </div>
  )

  const tableFor = (rowIndexes) => (
    <table className="quote-items-table qg-studio-table text-left" style={{ tableLayout: 'fixed', width: '100%' }}>
      <colgroup>
        <col style={{ width: `${colWidths.sr}px` }} />
        {columns.map((col, i) => (
          <col key={col.id} style={{ width: `${colWidths.widths[i]}px` }} />
        ))}
      </colgroup>
      <thead data-qg-block="thead">
        <tr>
          <th className="qg-cell-compact">Sr.</th>
          {columns.map((col) => (
            <th key={col.id} className={previewColAlignRight(col, columns) ? 'is-right' : ''}>
              {isNestedColumn(col) ? `${col.label} %` : col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowIndexes.map((index) => {
          const item = items[index]
          return (
            <tr key={index} data-qg-row={index}>
              <td className="qg-cell-compact">{index + 1}</td>
              {columns.map((col) => {
                if (isNestedColumn(col)) {
                  const rate = item?.[rateKey(col)]
                  return <td key={col.id} className="is-right">{rate ? `${rate}%` : '—'}</td>
                }
                const right = previewColAlignRight(col, columns)
                const desc = isDescriptionColumn(col)
                return (
                  <td key={col.id} className={`${right ? 'is-right' : ''}${desc ? ' description-cell' : ''}`}>
                    {isImageColumn(col) || isAttachmentColumn(col)
                      ? ''
                      : formatPreviewCell(item, col, columns)}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  const totalsBlock = (
    <div className="qg-totals-card" data-qg-block="totals" style={{ marginLeft: 'auto', marginTop: 16, maxWidth: 240 }}>
      <div className="flex justify-between text-sm" style={{ color: theme.muted }}>
        <span>Subtotal</span>
        <span>{money(totals.subtotal ?? totals.grandTotal)}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>Total</span>
        <span>{money(totals.grandTotal)}</span>
      </div>
    </div>
  )

  const closing = (
    <div data-qg-block="closing">
      <section className="qg-closing-optional" style={{ marginTop: 18 }}>
        <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Standard terms</p>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--qg-muted)' }}>
          {terms || 'Standard terms for this quotation'}
        </p>
      </section>
      <footer className="mt-8 qg-signatory-block">
        <hr className="qg-section-rule" />
        <div className="flex justify-end pb-1">
          <div className="w-52 text-center">
            <div className="h-14" />
            <div className="pt-2" style={{ borderTop: '1.5px solid var(--qg-muted, #5c6879)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--qg-text)' }}>Authorized Signatory</p>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--qg-muted)' }}>For {companyName}</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )

  return (
    <div ref={rootRef} data-qg-trial-ready="1">
      <QuoteStudioCanvas
        themeId="formal"
        tableAccent={theme.accent}
        fontSizePx={14}
        lockA4
        watermarkUrl={logoUrl || null}
        watermarkEnabled={Boolean(logoUrl)}
        runningHeader={{
          left: companyName,
          right: [quote?.number, quote?.date].filter(Boolean).join(' · ')
        }}
        runningFooter={{
          left: `For ${companyName}`,
          right: quote?.number ? `Quotation ${quote.number}` : 'Quotation'
        }}
      >
        {pages.map((page, pageIndex) => (
          <section key={pageIndex} className="qg-page-section">
            {page.showHeader ? letterhead : null}
            {page.showMeta ? parties : null}
            {(page.rows.length > 0 || page.showTotals) ? (
              <div className="qg-paper-body">
                {page.rows.length > 0 ? tableFor(page.rows) : null}
                {page.showTotals ? totalsBlock : null}
              </div>
            ) : null}
            {page.showClosing ? closing : null}
          </section>
        ))}
      </QuoteStudioCanvas>
    </div>
  )
}
/**
 * Meta ads guided first quote — OTP-style full screen (no dashboard chrome).
 * Step 1: paste / upload enquiry. Step 2: prefer columns. Then ceremony → reveal.
 */
export default function MetaTrialGuide({
  enquiry,
  setEnquiry,
  columns,
  onGenerate,
  loading = false,
  error = '',
  onEnterEditor,
  onBack,
  companyProfile = null,
  trialLead = null,
  onSaveCompany,
  onPatchQuote,
  onCompanyProfileSaved
}) {
  const initialSeed = companySeedFromLead(usefulLead(trialLead) || readMetaAdsLead(), companyProfile)
  const [step, setStep] = useState(1)
  const [phase, setPhase] = useState('flow') // flow | ceremony | reveal | client | company | final
  const [ceremonyBeat, setCeremonyBeat] = useState(0)
  const [revealQuote, setRevealQuote] = useState(null)
  const [revealReady, setRevealReady] = useState(false)
  const [guideProfile, setGuideProfile] = useState(() => initialSeed.profile)
  const [clientDone, setClientDone] = useState(false)
  const [companyDone, setCompanyDone] = useState(() => Boolean(String(initialSeed.draft.companyName || '').trim()))
  const [companySavedThisSession, setCompanySavedThisSession] = useState(false)
  const [unlockFromFinalBack, setUnlockFromFinalBack] = useState(false)
  const [clientDraft, setClientDraft] = useState({ name: '', company: '', gst: '', location: '' })
  const [companyDraft, setCompanyDraft] = useState(() => initialSeed.draft)
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(() => companyProfile?.logoUrl || null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoDragOver, setLogoDragOver] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [addressOpen, setAddressOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [qrFailed, setQrFailed] = useState(false)
  const [offerStartedAt, setOfferStartedAt] = useState(readOfferStart)
  const [offerNow, setOfferNow] = useState(() => Date.now())
  const offerLeftMs = offerStartedAt ? offerStartedAt + OFFER_MS - offerNow : OFFER_MS
  const offerLive = offerLeftMs > 0
  const payPrice = offerLive ? JOIN_PRICE : REGULAR_PRICE

  useEffect(() => {
    if (phase !== 'convert' || offerStartedAt) return
    const at = Date.now()
    try { localStorage.setItem(OFFER_STARTED_KEY, String(at)) } catch { /* private mode */ }
    setOfferStartedAt(at)
    setOfferNow(at)
  }, [phase, offerStartedAt])

  useEffect(() => {
    if (!offerStartedAt || !offerLive) return undefined
    const t = setInterval(() => setOfferNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [offerStartedAt, offerLive])

  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState('')

  const openPay = async () => {
    if (payBusy) return
    setPayError('')
    setPayBusy(true)
    trackPixel('InitiateCheckout', { value: payPrice, currency: 'INR', num_items: 1, content_name: 'QuoteGen monthly' })
    const lead = usefulLead(trialLead) || readMetaAdsLead() || {}
    try {
      const response = await fetch('/api/pay/phonepe/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerStartedAt,
          name: lead.name || '',
          company: lead.company || '',
          phone: lead.phone || '',
          email: lead.email || ''
        })
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data?.redirectUrl) {
        window.location.assign(data.redirectUrl)
        return
      }
      if (data?.code === 'PHONEPE_NOT_CONFIGURED') {
        setQrFailed(false)
        setPayOpen(true)
      } else {
        setPayError(data?.error || 'Could not open PhonePe. Please try again.')
      }
    } catch {
      setPayError('Could not open PhonePe. Check your connection and try again.')
    }
    setPayBusy(false)
  }
  const [pdfBusy, setPdfBusy] = useState(false)
  const [ingestBusy, setIngestBusy] = useState(false)
  const [ingestNote, setIngestNote] = useState('')
  const [attached, setAttached] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [draftColumns, setDraftColumns] = useState(() => (
    Array.isArray(columns) && columns.length ? columns : CORE_COLUMNS.map(({ locked, ...c }) => c)
  ))
  const [customLabel, setCustomLabel] = useState('')
  const [showAddMore, setShowAddMore] = useState(false)
  const fileRef = useRef(null)
  const logoFileRef = useRef(null)
  const enquiryScrollRef = useRef(null)

  const canNext = String(enquiry || '').trim().length > 0 || attached.length > 0
  const showError = localError || error
  const enquiryPreview = String(enquiry || '').trim()

  useEffect(() => {
    const lead = usefulLead(trialLead) || readMetaAdsLead()
    const seeded = companySeedFromLead(lead, companyProfile)
    setGuideProfile((prev) => {
      if (prev?.companyName && prev?.headerText) return prev
      return seeded.profile || prev
    })
    setCompanyDraft((prev) => ({
      companyName: prev.companyName || seeded.draft.companyName,
      headerText: prev.headerText || seeded.draft.headerText,
      phone: prev.phone || seeded.draft.phone,
      email: prev.email || seeded.draft.email,
      standardTerms: prev.standardTerms || seeded.draft.standardTerms
    }))
    if (companyProfile?.logoUrl) setLogoPreviewUrl((prev) => prev || companyProfile.logoUrl)
    if (String(seeded.draft.companyName || '').trim()) setCompanyDone(true)
  }, [companyProfile, trialLead])

  const applyGuideProfile = (nextProfile) => {
    if (!nextProfile) return
    setGuideProfile(nextProfile)
    setRevealQuote((q) => (q ? { ...q, companyProfile: nextProfile } : q))
    onPatchQuote?.({ companyProfile: nextProfile })
    onCompanyProfileSaved?.(nextProfile)
    if (nextProfile.logoUrl) setLogoPreviewUrl(nextProfile.logoUrl)
  }

  const patchRevealCustomer = (customer) => {
    setRevealQuote((q) => (q ? { ...q, customer: { ...(q.customer || {}), ...customer } } : q))
    onPatchQuote?.({ customer })
  }

  const patchRevealRate = (rowIndex, value) => {
    let nextItems = null
    setRevealQuote((q) => {
      if (!q) return q
      const cols = Array.isArray(q.columns) && q.columns.length
        ? q.columns
        : CORE_COLUMNS.map(({ locked, ...c }) => c)
      const rateCol = findFieldColumn(cols, 'rate')
      if (!rateCol) return q
      const items = (Array.isArray(q.items) ? q.items : []).map((item, index) => {
        if (index !== rowIndex) return item
        const key = rateCol.id
        const next = { ...item, [key]: value }
        Object.assign(next, amountEditPatch(next, cols, key, value) || {})
        Object.assign(next, formulaEditPatch(next, cols, key, value) || {})
        return recalcRow(next, cols, { editingKey: key })
      })
      nextItems = items
      return { ...q, items }
    })
    if (nextItems) onPatchQuote?.({ items: nextItems })
  }

  const downloadFormalPdf = async () => {
    if (!revealQuote || pdfBusy) return
    setLocalError('')
    setPdfBusy(true)
    onPatchQuote?.({ paperStyle: 'formal' })
    try {
      for (let i = 0; i < 36; i += 1) {
        const papers = document.querySelectorAll('[data-qg-trial-ready="1"] .qg-studio-paper')
        if (papers.length >= 1) break
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await downloadQuotationPdf(quotationFileName(revealQuote, 'pdf'))
      setPhase('convert')
    } catch (err) {
      setLocalError(err?.message || 'Could not download the PDF. Try again.')
    } finally {
      setPdfBusy(false)
    }
  }

  const uploadLogoFile = async (file) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      setLocalError('Use a PNG, JPG, WebP, GIF, or SVG logo.')
      return
    }
    setLocalError('')
    setLogoBusy(true)
    const localUrl = URL.createObjectURL(file)
    setLogoPreviewUrl(localUrl)
    try {
      const result = await uploadCompanyLogo(file)
      if (result?.unavailable) {
        // Keep local preview for this session; persistence can catch up later.
        applyGuideProfile({ ...(guideProfile || {}), logoUrl: localUrl })
        return
      }
      if (result?.profile) {
        applyGuideProfile(result.profile)
        return
      }
      applyGuideProfile({ ...(guideProfile || {}), logoUrl: localUrl })
    } catch (err) {
      setLocalError(err?.message || 'Could not upload logo.')
      setLogoPreviewUrl(guideProfile?.logoUrl || null)
    } finally {
      setLogoBusy(false)
    }
  }

  const saveClientDetails = () => {
    const name = clientDraft.name.trim()
    const company = clientDraft.company.trim()
    if (!name && !company) {
      setLocalError('Add a contact name or company.')
      return
    }
    setLocalError('')
    const customer = {
      name,
      company,
      gst: clientDraft.gst.trim(),
      location: clientDraft.location.trim(),
      shippingSame: true,
      shippingLocation: ''
    }
    patchRevealCustomer(customer)
    setClientDone(true)
    setPhase(companyDone ? 'final' : 'reveal')
  }

  const persistCompany = async () => {
    const companyName = companyDraft.companyName.trim() || String(guideProfile?.companyName || '').trim()
    if (!companyName) {
      setLocalError('Add your company name first.')
      return null
    }
    setLocalError('')
    setSetupBusy(true)
    try {
      const phone = companyDraft.phone.trim()
      const email = companyDraft.email.trim()
      const headerLines = [
        companyDraft.headerText.trim(),
        [phone, email].filter(Boolean).join(' · ')
      ].filter(Boolean)
      const payload = {
        companyName,
        headerText: headerLines.join('\n'),
        standardTerms: companyDraft.standardTerms.trim()
      }
      let saved = null
      if (onSaveCompany) {
        saved = await onSaveCompany(payload)
      }
      const nextProfile = {
        ...(guideProfile || {}),
        ...payload,
        ...(saved || {}),
        logoUrl: saved?.logoUrl || logoPreviewUrl || guideProfile?.logoUrl || null
      }
      applyGuideProfile(nextProfile)
      setCompanyDone(true)
      return nextProfile
    } catch (err) {
      setLocalError(err?.message || 'Could not save company details.')
      return null
    } finally {
      setSetupBusy(false)
    }
  }

  const saveAddressDetails = async () => {
    const saved = await persistCompany()
    if (saved) setAddressOpen(false)
  }

  const saveCompanyDetails = async () => {
    const saved = await persistCompany()
    if (!saved) return
    setCompanySavedThisSession(true)
    setUnlockFromFinalBack(false)
    setPhase('final')
  }

  // After company details are saved, always stay on final preview unless the user
  // explicitly hits Back from that screen (unlockFromFinalBack).
  useEffect(() => {
    if (!companySavedThisSession || unlockFromFinalBack) return
    if (phase === 'reveal') setPhase('final')
  }, [companySavedThisSession, unlockFromFinalBack, phase])

  useEffect(() => {
    if (phase !== 'ceremony') return undefined
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      return undefined
    }
    let raf = 0
    let cancelled = false
    let direction = 1
    let last = 0
    const speed = 32 // px / sec — slow scan through the enquiry

    const tick = (now) => {
      if (cancelled) return
      const el = enquiryScrollRef.current
      if (!el) {
        raf = requestAnimationFrame(tick)
        return
      }
      if (!last) last = now
      const max = Math.max(0, el.scrollHeight - el.clientHeight)
      if (max > 0) {
        const dt = Math.min(50, now - last) / 1000
        last = now
        let next = el.scrollTop + direction * speed * dt
        if (next >= max - 0.5) {
          next = max
          direction = -1
        } else if (next <= 0.5) {
          next = 0
          direction = 1
        }
        el.scrollTop = next
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [phase, enquiryPreview])

  const ingestFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f?.size > 0)
    if (!files.length) return
    setIngestBusy(true)
    setLocalError('')
    setIngestNote(`Reading ${files.length} file${files.length === 1 ? '' : 's'}…`)
    try {
      const result = await ingestEnquiryFiles(files)
      if (!String(result.text || '').trim()) {
        throw new Error('No text could be read. Try a clearer PDF, Word/Excel, or photo.')
      }
      setEnquiry((prev) => [String(prev || '').trim(), result.text].filter(Boolean).join('\n\n'))
      setAttached((prev) => {
        const seen = new Set(prev.map((p) => `${p.name}|${p.chars || 0}`))
        const next = [...prev]
        for (const f of result.files || []) {
          const key = `${f.name}|${f.chars || 0}`
          if (!seen.has(key)) {
            seen.add(key)
            next.push(f)
          }
        }
        return next
      })
      setIngestNote('Text added from your files. Edit below if needed, then continue.')
    } catch (err) {
      setIngestNote('')
      setLocalError(err?.message || 'Could not read those files.')
    } finally {
      setIngestBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const hasOptional = (id) => draftColumns.some((c) => c.id === id)
  const hasNamedAmount = (presetId) => draftColumns.some((c) => c.id === presetId || c.id.startsWith(`${presetId}_`))

  const insertBeforeAmount = (prev, col) => {
    const next = [...prev]
    const amountIdx = next.findIndex((c) => c.id === 'amount')
    const insertAt = amountIdx >= 0 ? amountIdx : next.length
    next.splice(insertAt, 0, col)
    return next
  }

  const toggleOptional = (preset) => {
    setDraftColumns((prev) => {
      if (prev.some((c) => c.id === preset.id)) {
        return prev.filter((c) => c.id !== preset.id)
      }
      return insertBeforeAmount(prev, { id: preset.id, label: preset.label, type: preset.type })
    })
  }

  const toggleNamedAmount = (preset) => {
    setDraftColumns((prev) => {
      if (prev.some((c) => c.id === preset.id || c.id.startsWith(`${preset.id}_`))) {
        return prev.filter((c) => c.id !== preset.id && !c.id.startsWith(`${preset.id}_`))
      }
      const col = buildNamedAmountColumn(preset, prev)
      if (!col) return prev
      return insertBeforeAmount(prev, col)
    })
  }

  const removeColumn = (id) => {
    if (CORE_COLUMNS.some((c) => c.id === id && c.locked)) return
    setDraftColumns((prev) => prev.filter((c) => c.id !== id))
  }

  const addCustom = () => {
    const label = customLabel.trim()
    if (!label) return
    const id = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}_${Date.now().toString(36).slice(-4)}`
    setDraftColumns((prev) => [...prev, { id, label, type: 'text' }])
    setCustomLabel('')
  }

  useEffect(() => {
    if (phase !== 'ceremony') return undefined
    let cancelled = false
    let beat = 0
    setCeremonyBeat(0)
    const timer = setInterval(() => {
      if (cancelled) return
      beat += 1
      if (beat >= CEREMONY_BEATS.length) {
        clearInterval(timer)
        return
      }
      setCeremonyBeat(beat)
    }, 1050)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [phase])

  const goGenerate = async () => {
    setLocalError('')
    if (!draftColumns.length) {
      setLocalError('Keep at least one column.')
      return
    }
    setPhase('ceremony')
    setRevealReady(false)
    setRevealQuote(null)
    const started = Date.now()
    try {
      const built = await onGenerate?.(draftColumns)
      const elapsed = Date.now() - started
      const minShow = 4400
      if (elapsed < minShow) await sleep(minShow - elapsed)
      if (!built) {
        setPhase('flow')
        setStep(2)
        setLocalError(error || 'Could not create the quotation. Please try again.')
        return
      }
      const lead = usefulLead(trialLead) || readMetaAdsLead()
      const seeded = companySeedFromLead(lead, {
        ...(built?.companyProfile || {}),
        ...(guideProfile || {})
      })
      setRevealQuote({ ...built, companyProfile: seeded.profile })
      const cust = built?.customer || {}
      if (String(cust.name || '').trim() || String(cust.company || '').trim()) {
        setClientDone(true)
        setClientDraft({
          name: cust.name || '',
          company: cust.company || '',
          gst: cust.gst || '',
          location: cust.location || ''
        })
      }
      if (seeded.profile) setGuideProfile(seeded.profile)
      setCompanyDraft((prev) => ({
        companyName: prev.companyName || seeded.draft.companyName,
        headerText: prev.headerText || seeded.draft.headerText,
        phone: prev.phone || seeded.draft.phone,
        email: prev.email || seeded.draft.email,
        standardTerms: prev.standardTerms || seeded.draft.standardTerms
      }))
      setPhase('reveal')
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setRevealReady(true))
      })
    } catch (err) {
      setPhase('flow')
      setStep(2)
      setLocalError(err?.message || 'Could not create the quotation. Please try again.')
    }
  }

  if (phase === 'ceremony') {
    const beat = CEREMONY_BEATS[Math.min(ceremonyBeat, CEREMONY_BEATS.length - 1)]
    const stage = beat.stage
    const shards = ceremonyShards(enquiryPreview, draftColumns)
    const previewLines = (enquiryPreview || 'Your enquiry').split(/\n/)
    return (
      <main className={`meta-guide meta-guide-ceremony is-${stage}`}>
        <div className="meta-guide-ceremony-aura" aria-hidden="true">
          <span className="meta-guide-ceremony-orb meta-guide-ceremony-orb-a" />
          <span className="meta-guide-ceremony-orb meta-guide-ceremony-orb-b" />
          <span className="meta-guide-ceremony-orb meta-guide-ceremony-orb-c" />
          <div className="meta-guide-ceremony-stars">
            {Array.from({ length: 18 }, (_, i) => (
              <span key={i} className={`meta-guide-ceremony-star s${i + 1}`} />
            ))}
          </div>
        </div>

        <div className="meta-guide-ceremony-shell">
          <p className="meta-guide-step">QuoteGen at work</p>
          <h1 className="meta-guide-title meta-guide-ceremony-title" key={beat.id}>
            {beat.title}
          </h1>
          <p className="meta-guide-lead meta-guide-ceremony-detail" key={`d-${beat.id}`}>
            {beat.detail}
          </p>

          <div className="meta-guide-alchemy" aria-hidden="true">
            <div className="meta-guide-alchemy-enquiry">
              <div className="meta-guide-alchemy-enquiry-label"><IconMail /> Enquiry</div>
              <div className="meta-guide-alchemy-enquiry-body" ref={enquiryScrollRef}>
                {previewLines.length ? previewLines.map((line, i) => (
                  <p key={i}>{line || '\u00a0'}</p>
                )) : <p>—</p>}
              </div>
              <span className="meta-guide-alchemy-scan" />
              <span className="meta-guide-alchemy-glow" />
            </div>

            <div className="meta-guide-alchemy-stream">
              {shards.map((label, i) => (
                <span
                  key={`${label}-${i}`}
                  className={`meta-guide-alchemy-shard shard-${i}${ceremonyBeat >= 1 ? ' is-lift' : ''}${ceremonyBeat >= 2 ? ' is-fly' : ''}`}
                  style={{ '--i': i }}
                >
                  {label}
                </span>
              ))}
              <span className="meta-guide-alchemy-beam" />
            </div>

            <div className="meta-guide-alchemy-layout">
              <div className="meta-guide-alchemy-cols">
                {draftColumns.map((c, i) => (
                  <span
                    key={c.id}
                    className={`meta-guide-alchemy-col${ceremonyBeat >= 2 ? ' is-catch' : ''}${ceremonyBeat >= 3 ? ' is-fuse' : ''}`}
                    style={{ '--i': i }}
                  >
                    {c.label}
                  </span>
                ))}
              </div>
              <div className={`meta-guide-alchemy-sheet${ceremonyBeat >= 3 ? ' is-forge' : ''}`}>
                <span className="meta-guide-alchemy-sheet-bar" />
                <span className="meta-guide-alchemy-sheet-bar" />
                <span className="meta-guide-alchemy-sheet-bar" />
                <span className="meta-guide-alchemy-burst" />
              </div>
            </div>
          </div>

          <div className="meta-guide-ceremony-progress" aria-hidden="true">
            {CEREMONY_BEATS.map((b, i) => (
              <span key={b.id} className={`meta-guide-ceremony-dot${i <= ceremonyBeat ? ' is-on' : ''}${i === ceremonyBeat ? ' is-active' : ''}`} />
            ))}
          </div>
        </div>
      </main>
    )
  }

  if (phase === 'reveal' && revealQuote) {
    return (
      <main className={`meta-guide meta-guide-reveal-page${revealReady ? ' is-ready' : ''}`}>
        <div className="meta-guide-reveal-shell">
          <p className="meta-guide-step">Ta-da</p>
          <h1 className="meta-guide-title">
            Quotation <span>unlocked</span>
          </h1>

          <div className={`meta-guide-reveal-frame${revealReady ? ' is-expand' : ''}`}>
            <div className="meta-guide-reveal-sheet is-scrollable">
              <div className="meta-guide-reveal-sheet-scroll">
                <RealQuotePreviewTable
                  quote={revealQuote}
                  companyProfile={guideProfile}
                  editableRates
                  onRateChange={patchRevealRate}
                  logoBusy={logoBusy}
                  hasAddress={Boolean(companyDraft.headerText.trim())}
                  onUploadLogo={() => { if (!logoBusy) logoFileRef.current?.click() }}
                  onAddAddress={() => { setLocalError(''); setAddressOpen(true) }}
                />
              </div>
            </div>
          </div>
          <input
            ref={logoFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="meta-guide-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) uploadLogoFile(file)
            }}
          />

          {showError ? <p className="meta-guide-error">{showError}</p> : null}

          <div className="meta-guide-unlock">
            <button
              type="button"
              className="meta-guide-primary"
              disabled={pdfBusy || logoBusy}
              onClick={() => { void downloadFormalPdf() }}
            >
              {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
            </button>
          </div>
        </div>

        {revealQuote ? (
          <div className="meta-guide-pdf-offscreen" aria-hidden="true">
            <TrialFormalExport quote={revealQuote} companyProfile={guideProfile} />
          </div>
        ) : null}

        {addressOpen ? (
          <GuideModal
            title={companyDraft.headerText.trim() ? 'Edit address' : 'Add address'}
            onClose={() => { if (!setupBusy) setAddressOpen(false) }}
          >
            <p className="meta-guide-modal-lead">
              Street, city, and state for your letterhead. Phone and email stay as they are.
            </p>
            <label className="meta-guide-field">
              <span>Address</span>
              <textarea
                value={companyDraft.headerText}
                onChange={(e) => setCompanyDraft((d) => ({ ...d, headerText: e.target.value }))}
                placeholder="Street, city, state"
                rows={3}
                autoFocus
              />
            </label>
            {showError ? <p className="meta-guide-error">{showError}</p> : null}
            <div className="meta-guide-modal-actions">
              <button type="button" className="meta-guide-secondary" onClick={() => setAddressOpen(false)} disabled={setupBusy}>
                Cancel
              </button>
              <button type="button" className="meta-guide-primary meta-guide-primary-inline" onClick={() => { void saveAddressDetails() }} disabled={setupBusy}>
                {setupBusy ? 'Saving…' : 'Save address'}
              </button>
            </div>
          </GuideModal>
        ) : null}

        {addressOpen ? (
          <GuideModal
            title={companyDraft.headerText.trim() ? 'Edit address' : 'Add address'}
            onClose={() => { if (!setupBusy) setAddressOpen(false) }}
          >
            <p className="meta-guide-modal-lead">
              Street, city, and state for your letterhead. Phone and email stay as they are.
            </p>
            <label className="meta-guide-field">
              <span>Address</span>
              <textarea
                value={companyDraft.headerText}
                onChange={(e) => setCompanyDraft((d) => ({ ...d, headerText: e.target.value }))}
                placeholder="Street, city, state"
                rows={3}
                autoFocus
              />
            </label>
            {showError ? <p className="meta-guide-error">{showError}</p> : null}
            <div className="meta-guide-modal-actions">
              <button type="button" className="meta-guide-secondary" onClick={() => setAddressOpen(false)} disabled={setupBusy}>
                Cancel
              </button>
              <button type="button" className="meta-guide-primary meta-guide-primary-inline" onClick={() => { void saveAddressDetails() }} disabled={setupBusy}>
                {setupBusy ? 'Saving…' : 'Save address'}
              </button>
            </div>
          </GuideModal>
        ) : null}
      </main>
    )
  }

  if (phase === 'convert' && revealQuote) {
    return (
      <main className="meta-guide meta-guide-convert-page">
        <div className="meta-guide-convert-burst" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} className={`meta-guide-confetti c${i + 1}`} />
          ))}
        </div>
        <div className="meta-guide-convert-shell">
          <div className="meta-guide-convert-done">
            <div className="meta-guide-convert-check" aria-hidden="true">
              <svg viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="32" />
                <path d="M22 37.5 32 47.5 51 26.5" />
              </svg>
            </div>
            <p className="meta-guide-step">Welcome to QuoteGen</p>
            <h1 className="meta-guide-title">
              Downloaded <span>successfully</span>
            </h1>
            <p className="meta-guide-convert-file">Your quotation PDF is in Downloads.</p>
          </div>

          <div className="meta-guide-convert-offer">
            <p className="meta-guide-convert-hook">Liked what you see?</p>
            <p className="meta-guide-convert-promise">
              Join the QuoteGen club and enter the future of smart quotation making.
            </p>
            <p className="meta-guide-convert-meta">No more manual work — just paste, verify and send.</p>
            {offerLive ? (
              <div className="meta-guide-offer is-live" role="timer" aria-live="off">
                <span className="meta-guide-offer-label">
                  Special price <s>₹{REGULAR_PRICE}</s> ₹{JOIN_PRICE}/month — ends in
                </span>
                <span className="meta-guide-offer-clock">{formatCountdown(offerLeftMs)}</span>
              </div>
            ) : (
              <div className="meta-guide-offer is-ended">
                <span className="meta-guide-offer-label">The ₹{JOIN_PRICE} offer has ended</span>
              </div>
            )}
            <button
              type="button"
              className="meta-guide-primary meta-guide-convert-cta"
              onClick={openPay}
              disabled={payBusy}
            >
              {payBusy ? 'Opening PhonePe…' : 'Join QuoteGen Now'}
            </button>
            {payError ? <p className="meta-guide-convert-error" role="alert">{payError}</p> : null}
          </div>
        </div>

        {payOpen ? (
          <GuideModal
            className="is-pay"
            title="You’re in"
            onClose={() => setPayOpen(false)}
          >
            <p className="meta-guide-pay-lead">
              {offerLive
                ? <>Join now and pay just <strong>₹{JOIN_PRICE}/month</strong>. When the timer hits zero, the price goes up to ₹{REGULAR_PRICE}/month.</>
                : <>QuoteGen is ₹{REGULAR_PRICE}/month for {JOIN_QUOTES} quotations. Pay as you go for more.</>}
            </p>
            <div className="meta-guide-pay-card">
              <p className="meta-guide-pay-kicker">Scan QR to pay</p>
              <p className="meta-guide-pay-amount">
                {offerLive && <s className="meta-guide-pay-was">₹{REGULAR_PRICE}</s>}
                ₹{payPrice}
                <small> /month</small>
              </p>
              <p className="meta-guide-pay-note">{JOIN_QUOTES} quotations / month · pay as you go for more</p>
              <div className="meta-guide-pay-qr">
                {!qrFailed ? (
                  <img
                    src={PHONEPE_QR_SRC}
                    alt={`PhonePe QR code to pay ₹${payPrice}`}
                    onError={() => setQrFailed(true)}
                  />
                ) : (
                  <div className="meta-guide-pay-qr-fallback">
                    <strong>PhonePe QR</strong>
                    <span>Scan with PhonePe to pay ₹{payPrice}</span>
                  </div>
                )}
              </div>
            </div>
            <button type="button" className="meta-guide-secondary meta-guide-pay-close" onClick={() => setPayOpen(false)}>
              Close
            </button>
          </GuideModal>
        ) : null}
      </main>
    )
  }

  if (phase === 'client' && revealQuote) {
    return (
      <main className="meta-guide meta-guide-reveal-page">
        <div className="meta-guide-reveal-shell meta-guide-setup-shell">
          <p className="meta-guide-step">Almost there · Client</p>
          <h1 className="meta-guide-title">
            Add <span>client details</span>
          </h1>
          <p className="meta-guide-lead">
            Who is this quotation for? You can refine later in the editor.
          </p>

          <div className="meta-guide-card meta-guide-setup-card">
            <label className="meta-guide-field">
              <span>Contact name</span>
              <input
                value={clientDraft.name}
                onChange={(e) => setClientDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Asha Mehta"
                autoFocus
              />
            </label>
            <label className="meta-guide-field">
              <span>Company</span>
              <input
                value={clientDraft.company}
                onChange={(e) => setClientDraft((d) => ({ ...d, company: e.target.value }))}
                placeholder="e.g. Acme Industries Pvt Ltd"
              />
            </label>
            <label className="meta-guide-field">
              <span>GSTIN <em>optional</em></span>
              <input
                value={clientDraft.gst}
                onChange={(e) => setClientDraft((d) => ({ ...d, gst: e.target.value }))}
                placeholder="27AABCU9603R1ZM"
              />
            </label>
            <label className="meta-guide-field">
              <span>Location <em>optional</em></span>
              <input
                value={clientDraft.location}
                onChange={(e) => setClientDraft((d) => ({ ...d, location: e.target.value }))}
                placeholder="Mumbai, Maharashtra"
              />
            </label>
          </div>

          {showError ? <p className="meta-guide-error">{showError}</p> : null}

          <div className="meta-guide-dual-actions">
            <button type="button" className="meta-guide-secondary" onClick={() => { setLocalError(''); setPhase('reveal') }}>
              Back
            </button>
            <button type="button" className="meta-guide-primary meta-guide-primary-inline" onClick={saveClientDetails}>
              Save client details
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (phase === 'company' && revealQuote) {
    return (
      <main className="meta-guide meta-guide-reveal-page">
        <div className="meta-guide-reveal-shell meta-guide-setup-shell">
          <p className="meta-guide-step">Almost there · Company</p>
          <h1 className="meta-guide-title">
            Setup your <span>company details</span>
          </h1>
          <p className="meta-guide-lead">
            Letterhead basics for this quotation — bank details can wait for the editor.
          </p>

          <div className="meta-guide-card meta-guide-setup-card">
            <label className="meta-guide-field">
              <span>Company name</span>
              <input
                value={companyDraft.companyName}
                onChange={(e) => setCompanyDraft((d) => ({ ...d, companyName: e.target.value }))}
                placeholder="Your company name"
                autoFocus
              />
            </label>
            <label className="meta-guide-field">
              <span>Address / tagline <em>optional</em></span>
              <textarea
                value={companyDraft.headerText}
                onChange={(e) => setCompanyDraft((d) => ({ ...d, headerText: e.target.value }))}
                placeholder="Street, city, state"
                rows={2}
              />
            </label>
            <div className="meta-guide-field-row">
              <label className="meta-guide-field">
                <span>Phone <em>optional</em></span>
                <input
                  value={companyDraft.phone}
                  onChange={(e) => setCompanyDraft((d) => ({ ...d, phone: e.target.value }))}
                  placeholder="+91 00000 00000"
                />
              </label>
              <label className="meta-guide-field">
                <span>Email <em>optional</em></span>
                <input
                  type="email"
                  value={companyDraft.email}
                  onChange={(e) => setCompanyDraft((d) => ({ ...d, email: e.target.value }))}
                  placeholder="sales@company.com"
                />
              </label>
            </div>
            <label className="meta-guide-field">
              <span>Standard terms <em>optional</em></span>
              <textarea
                value={companyDraft.standardTerms}
                onChange={(e) => setCompanyDraft((d) => ({ ...d, standardTerms: e.target.value }))}
                placeholder="Validity, payment, delivery…"
                rows={3}
              />
            </label>
            <div className="meta-guide-field">
              <span>Company logo <em>optional</em></span>
              <input
                ref={logoFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                className="meta-guide-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) uploadLogoFile(file)
                }}
              />
              <div
                className={`meta-guide-logo-drop${logoDragOver ? ' is-drag' : ''}${logoPreviewUrl ? ' has-logo' : ''}`}
                onDragOver={(e) => { e.preventDefault(); if (!logoBusy) setLogoDragOver(true) }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  if (!e.currentTarget.contains(e.relatedTarget)) setLogoDragOver(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setLogoDragOver(false)
                  const file = e.dataTransfer?.files?.[0]
                  if (!logoBusy && file) uploadLogoFile(file)
                }}
                onClick={() => { if (!logoBusy) logoFileRef.current?.click() }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    logoFileRef.current?.click()
                  }
                }}
              >
                {logoPreviewUrl ? (
                  <>
                    <img src={logoPreviewUrl} alt="Company logo preview" className="meta-guide-logo-preview" />
                    <div className="meta-guide-logo-drop-copy">
                      <strong>{logoBusy ? 'Uploading…' : 'Logo ready'}</strong>
                      <span>Drop a new file or click to replace</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="meta-guide-logo-drop-icon" aria-hidden="true"><IconUpload /></span>
                    <div className="meta-guide-logo-drop-copy">
                      <strong>{logoBusy ? 'Uploading…' : 'Drag & drop your logo'}</strong>
                      <span>or click to upload · PNG, JPG, WebP, SVG</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {showError ? <p className="meta-guide-error">{showError}</p> : null}

          <div className="meta-guide-dual-actions">
            <button type="button" className="meta-guide-secondary" onClick={() => { setLocalError(''); setUnlockFromFinalBack(true); setPhase('reveal') }} disabled={setupBusy || logoBusy}>
              Back
            </button>
            <button type="button" className="meta-guide-primary meta-guide-primary-inline" onClick={() => { void saveCompanyDetails() }} disabled={setupBusy || logoBusy}>
              {setupBusy ? 'Saving…' : 'Save company details'}
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (phase === 'final' && revealQuote) {
    return (
      <main className="meta-guide meta-guide-reveal-page meta-guide-final-page is-ready">
        <div className="meta-guide-reveal-shell meta-guide-final-shell">
          <p className="meta-guide-step">Final preview</p>
          <h1 className="meta-guide-title">
            Ready to <span>send</span>
          </h1>

          <div className="meta-guide-reveal-frame is-expand meta-guide-final-frame">
            <div className="meta-guide-final-scroll">
              <FinalQuoteDocument
                quote={revealQuote}
                companyProfile={guideProfile}
              />
            </div>
          </div>

          <p className="meta-guide-setup-nudge">
            You are all set — just final touches and your personalised quotation will be ready in a minute for life.
          </p>

          <div className="meta-guide-dual-actions">
            <button type="button" className="meta-guide-secondary" onClick={() => { setUnlockFromFinalBack(true); setPhase('reveal') }}>
              Back
            </button>
            <button
              type="button"
              className="meta-guide-primary meta-guide-primary-inline"
              onClick={() => onEnterEditor?.()}
            >
              Continue to edit &amp; export
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="meta-guide">
      <div className="meta-guide-shell">
        <p className="meta-guide-step">Step {step} of 2</p>
        {step === 1 ? (
          <>
            <h1 className="meta-guide-title">
              Paste or upload the <span>enquiry</span>
            </h1>
            <p className="meta-guide-lead">
              Use a real client message — WhatsApp text, email, PDF, or a photo of the RFQ. No sample text.
            </p>

            <div
              className={`meta-guide-card${dragOver ? ' is-drag' : ''}`}
              onDragOver={(e) => { e.preventDefault(); if (!ingestBusy) setDragOver(true) }}
              onDragLeave={(e) => {
                e.preventDefault()
                if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                if (!ingestBusy && e.dataTransfer?.files?.length) ingestFiles(e.dataTransfer.files)
              }}
            >
              <div className="meta-guide-card-head">
                <span className="meta-guide-card-label"><IconMail /> Enquiry</span>
              </div>
              <textarea
                className="meta-guide-textarea"
                value={enquiry}
                onChange={(e) => setEnquiry(e.target.value)}
                placeholder="Copy-paste the inquiry email or WhatsApp message here…"
                rows={10}
              />

              <div className="meta-guide-or" role="separator" aria-label="or">
                <span>or</span>
              </div>

              <button
                type="button"
                className="meta-guide-upload-btn"
                disabled={ingestBusy}
                onClick={() => fileRef.current?.click()}
              >
                <IconUpload />
                {ingestBusy ? 'Reading…' : 'Upload image or doc'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={ENQUIRY_FILE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  ingestFiles(e.target.files)
                  e.target.value = ''
                }}
              />

              {(ingestNote || attached.length > 0) && (
                <div className="meta-guide-attach-meta">
                  {ingestNote && <p>{ingestNote}</p>}
                  {attached.length > 0 && (
                    <ul>
                      {attached.map((f) => (
                        <li key={`${f.name}-${f.chars}`}>{f.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {showError && <p className="meta-guide-error">{showError}</p>}

            <div className="meta-guide-actions">
              {onBack && (
                <button type="button" className="meta-guide-ghost" disabled={ingestBusy} onClick={onBack}>
                  ← Back
                </button>
              )}
              <button
                type="button"
                className={`meta-guide-primary${!canNext || ingestBusy ? ' is-idle' : ''}`}
                disabled={!canNext || ingestBusy}
                onClick={() => { setLocalError(''); setStep(2) }}
              >
                Continue
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="meta-guide-title">
              Which <span>columns</span> do you usually want?
            </h1>
            <p className="meta-guide-lead">
              This is your default quotation layout. You can add more columns if you need them.
            </p>

            <div className="meta-guide-card meta-guide-card-cols">
              <LayoutPreviewTable
                columns={draftColumns}
                onRemove={removeColumn}
              />
            </div>

            {!showAddMore ? (
              <button
                type="button"
                className="meta-guide-add-more"
                onClick={() => setShowAddMore(true)}
              >
                + Add more columns
              </button>
            ) : (
              <div className="meta-guide-card meta-guide-add-panel">
                <div className="meta-guide-add-panel-head">
                  <p className="meta-guide-section-label">Add more columns</p>
                  <button
                    type="button"
                    className="meta-guide-add-done"
                    onClick={() => setShowAddMore(false)}
                  >
                    Done
                  </button>
                </div>
                <div className="meta-guide-chips meta-guide-chips-row">
                  {OPTIONAL_PRESETS.map((p) => {
                    const on = hasOptional(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`meta-guide-chip is-toggle${on ? ' is-on' : ''}`}
                        onClick={() => toggleOptional(p)}
                        disabled={on}
                      >
                        + {p.label}
                      </button>
                    )
                  })}
                  {NAMED_AMOUNT_COLUMN_PRESETS.map((p) => {
                    const on = hasNamedAmount(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        title={p.hint}
                        className={`meta-guide-chip is-toggle${on ? ' is-on' : ''}`}
                        onClick={() => toggleNamedAmount(p)}
                        disabled={on}
                      >
                        + {p.label}
                      </button>
                    )
                  })}
                </div>
                <div className="meta-guide-custom-row">
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder="Custom column name"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
                  />
                  <button type="button" onClick={addCustom} disabled={!customLabel.trim()}>Add</button>
                </div>
              </div>
            )}

            {showError && <p className="meta-guide-error">{showError}</p>}

            <div className="meta-guide-actions">
              <button type="button" className="meta-guide-ghost" disabled={loading} onClick={() => setStep(1)}>
                ← Back
              </button>
              <button type="button" className="meta-guide-primary" disabled={loading} onClick={goGenerate}>
                {loading ? 'Creating quotation…' : 'Create quotation'}
                {!loading && <span aria-hidden="true">→</span>}
              </button>
            </div>
            <p className="meta-guide-fine">
              Next we’ll map your enquiry into this layout — then open the full quotation.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
