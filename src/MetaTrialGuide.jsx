import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ingestEnquiryFiles, uploadCompanyLogo } from './quotePersistence.js'
import { downloadQuotationPdf, quotationFileName } from './pdfExport.js'
import { QuotePaperHeader, QuoteStudioCanvas } from './QuoteStudio.jsx'
import { PAPER_THEMES, normalizePaperStyle, readPreferredPaperStyle, resolvePaperTheme, writePreferredPaperStyle, extractImagePalette, accentForTableColor, normalizeAccentHex, tableColorSwatches } from './quotePaperThemes.js'
import { peekPreferredColumns, writePreferredColumns } from './quoteLayoutPrefs.js'
import QuoteGenerateCeremony, { CEREMONY_MIN_MS } from './QuoteGenerateCeremony.jsx'
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
  toNumber,
  normalizeBillAdjustments
} from '../shared/quoteColumns.js'
import { formatIndianAmount } from '../shared/templateMap.js'
import { companySeedFromLead, readMetaAdsLead, usefulLead, readMetaGuideProgress, writeMetaGuideProgress } from './metaTrialLead.js'
import { whatsAppPasteReplacement } from '../shared/enquiryText.js'
import { trackPixel } from './metaPixel.js'
import DemoHowToVideo from './DemoHowToVideo.jsx'
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

function IconChevron({ dir = 'left' }) {
  const d = dir === 'right' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
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

const MANUAL_DISCOUNT_KEY = 'qg_show_manual_discount'

function writeShowManualDiscount(show) {
  try { localStorage.setItem(MANUAL_DISCOUNT_KEY, show ? '1' : '0') } catch { /* ignore */ }
}

function resolvedBill(raw) {
  const bill = normalizeBillAdjustments(raw)
  const showDiscount = bill.showDiscount === true || (bill.showDiscount !== false && Boolean(String(bill.discountValue || '').trim()))
  return { ...bill, showDiscount }
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

function previewColAlignRight() {
  return false
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
    <>
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
    <p className="meta-guide-table-hint">Swipe the table sideways to see every column</p>
    </>
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
  const totals = computeQuoteTotals(allItems, columns, quote?.extraLines, quote?.billAdjustments)
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
  const totals = computeQuoteTotals(items, columns, quote?.extraLines, quote?.billAdjustments)
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
          {totals.summaryDiscount?.hidden ? null : totals.summaryDiscount?.fromColumn ? (totals.perColumn || []).filter((entry) => entry.type === 'discount').map((entry) => (
            <div key={entry.id} className="meta-guide-doc-totals-row">
              <span>Less: {entry.label}</span>
              <span>{money(entry.amount)}</span>
            </div>
          )) : (
            <div className="meta-guide-doc-totals-row">
              <span>{totals.summaryDiscount?.label || 'Less: Discount'}</span>
              <span>{money(totals.summaryDiscount?.amount)}</span>
            </div>
          )}
          {(totals.discountTotal || 0) > 0 ? (
            <div className="meta-guide-doc-totals-row">
              <span>Taxable value</span>
              <span>{money(totals.taxableTotal)}</span>
            </div>
          ) : null}
          {totals.summaryTax?.fromColumn ? (totals.perColumn || []).filter((entry) => entry.type === 'tax').map((entry) => (
            <div key={entry.id} className="meta-guide-doc-totals-row">
              <span>Add: {entry.label}</span>
              <span>{money(entry.amount)}</span>
            </div>
          )) : (
            <div className="meta-guide-doc-totals-row">
              <span>{totals.summaryTax?.label || 'Add: Tax'}</span>
              <span>{money(totals.summaryTax?.amount)}</span>
            </div>
          )}
          <div className="meta-guide-doc-totals-row is-total">
            <span>Total</span>
            <span>{money(totals.grandTotal)}</span>
          </div>
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
const JOIN_PRICE = 399
const REGULAR_PRICE = 799
const JOIN_SAVE = REGULAR_PRICE - JOIN_PRICE
const JOIN_QUOTES = 50
const OFFER_MS = 10 * 60 * 1000
const OFFER_STARTED_KEY = 'qg_join_offer_started_v2'
const SEAT_CAP = 100
const SEAT_START = 52
const SEAT_INTRO_END = 45
const SEAT_FLOOR = 11
const SEATS_KEY = 'qg_trial_seats_left_v3'
const SEATS_INTRO_KEY = 'qg_trial_seats_intro_v3'
const SUPPORT_PHONE_E164 = '+919067610118'
const SUPPORT_PHONE_LABEL = '+91 90676 10118'

function writeSeatsLeft(n) {
  try { sessionStorage.setItem(SEATS_KEY, String(n)) } catch { /* private mode */ }
}

function writeSeatsIntroDone() {
  try { sessionStorage.setItem(SEATS_INTRO_KEY, '1') } catch { /* private mode */ }
}

function readSeatsIntroDone() {
  try { return sessionStorage.getItem(SEATS_INTRO_KEY) === '1' } catch { return false }
}

function readSeatsLeft() {
  try {
    const n = Number(sessionStorage.getItem(SEATS_KEY))
    if (Number.isFinite(n) && n >= SEAT_FLOOR && n <= SEAT_START) return Math.round(n)
  } catch { /* private mode */ }
  return null
}

function randomSeatWaitMs() {
  return 1000 + Math.floor(Math.random() * 2000)
}

function randomIntroDelays(steps) {
  if (steps <= 0) return []
  const full = 13200 + Math.floor(Math.random() * 1600)
  const total = Math.round(full * (steps / (SEAT_START - SEAT_INTRO_END)))
  const weights = Array.from({ length: steps }, () => 0.45 + Math.random() * 1.15)
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const delays = weights.map((w) => Math.round((w / sum) * total))
  delays[delays.length - 1] += total - delays.reduce((a, b) => a + b, 0)
  return delays
}

function SeatOdometer({ value }) {
  const [shown, setShown] = useState(value)
  const [outgoing, setOutgoing] = useState(null)
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

  useEffect(() => {
    if (value === shown) return undefined
    if (reduceMotion) {
      setOutgoing(null)
      setShown(value)
      return undefined
    }
    setOutgoing(shown)
    setShown(value)
    const t = window.setTimeout(() => setOutgoing(null), 400)
    return () => window.clearTimeout(t)
  }, [value, shown, reduceMotion])

  return (
    <span className="meta-guide-odo">
      <span className="meta-guide-odo-view">
        {outgoing != null ? <span className="meta-guide-odo-digit is-out">{outgoing}</span> : null}
        <span className={`meta-guide-odo-digit${outgoing != null ? ' is-in' : ''}`}>{shown}</span>
      </span>
    </span>
  )
}

function readOfferStart() {
  try {
    const at = Number(sessionStorage.getItem(OFFER_STARTED_KEY))
    if (!Number.isFinite(at) || at <= 0) return null
    if (at + OFFER_MS <= Date.now()) return null
    return at
  } catch {
    return null
  }
}

function writeOfferStart(at) {
  try { sessionStorage.setItem(OFFER_STARTED_KEY, String(at)) } catch { /* private mode */ }
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function trialExportColWidths(columns) {
  const sr = 36
  const printable = 718
  const minCol = 48
  const raw = (columns || []).map((col) => {
    if (isDescriptionColumn(col)) return 320
    if (col.id === 'unit' || /unit|uom/i.test(String(col.label || ''))) return 96
    if (col.id === 'quantity' || /qty|quantity/i.test(String(col.label || ''))) return 72
    if (col.id === 'rate' || /rate|price/i.test(String(col.label || ''))) return 96
    if (col.id === 'amount' || /amount|total/i.test(String(col.label || ''))) return 112
    return 72
  })
  const budget = Math.max(240, printable - sr)
  const widths = raw.map((w, index) => {
    const col = columns[index]
    const floor = col && (col.id === 'unit' || /unit|uom/i.test(String(col.label || ''))) ? 96 : minCol
    return Math.max(floor, w)
  })
  let sum = widths.reduce((n, w) => n + w, 0) || 1
  if (sum > budget) {
    const flexible = widths.map((w, index) => {
      const col = columns[index]
      const floor = col && (col.id === 'unit' || /unit|uom/i.test(String(col.label || ''))) ? 96 : minCol
      return w > floor ? index : -1
    }).filter((index) => index >= 0)
    const locked = widths.reduce((n, w, index) => n + (flexible.includes(index) ? 0 : w), 0)
    const flexSum = flexible.reduce((n, index) => n + widths[index], 0) || 1
    const flexBudget = budget - locked
    if (flexible.length && flexBudget > 0) {
      const scale = flexBudget / flexSum
      flexible.forEach((index) => {
        const col = columns[index]
        const floor = col && (col.id === 'unit' || /unit|uom/i.test(String(col.label || ''))) ? 96 : minCol
        widths[index] = Math.max(floor, Math.round(widths[index] * scale))
      })
    }
  }
  const drift = budget - widths.reduce((n, w) => n + w, 0)
  if (widths.length) widths[widths.length - 1] += drift
  return { sr, widths }
}

const DEMO_PAPER_IDS = ['formal', 'concise', 'executive', 'modern', 'atelier', 'brief', 'corporate']
const FORMAT_HINT_KEY = 'qg_trial_format_hint_v2'

function noopUpdate() {}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
}

function animateScrollLeft(el, to, duration) {
  const from = el.scrollLeft
  const dist = to - from
  if (Math.abs(dist) < 1) {
    el.scrollLeft = to
    return Promise.resolve()
  }
  const start = performance.now()
  return new Promise((resolve) => {
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      el.scrollLeft = from + dist * easeInOut(t)
      if (t < 1) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
}

function centerScrollLeft(scroller, index) {
  const slide = scroller?.children?.[index]
  if (!slide) return 0
  return Math.max(0, slide.offsetLeft - (scroller.clientWidth - slide.offsetWidth) / 2)
}

function visibleCarouselThemeId(fallback) {
  const track = document.querySelector('.meta-guide-format-track')
  if (!track?.children?.length) return fallback
  const mid = track.scrollLeft + track.clientWidth / 2
  let best = 0
  let bestDist = Infinity
  Array.from(track.children).forEach((slide, i) => {
    const center = slide.offsetLeft + slide.offsetWidth / 2
    const dist = Math.abs(center - mid)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  })
  return DEMO_PAPER_IDS[best] || fallback
}

function TrialBillTotals({ totals, bill, theme, editable, onChange }) {
  const muted = theme?.muted || '#667085'
  const set = (patch) => onChange?.({ ...bill, ...patch })
  const hideDiscount = () => {
    writeShowManualDiscount(false)
    set({ showDiscount: false, discountValue: '' })
  }
  const restoreDiscount = () => {
    writeShowManualDiscount(true)
    set({ showDiscount: true })
  }
  return (
    <div className="qg-totals-card" data-qg-block="totals" style={{ marginLeft: 'auto', marginTop: 16, maxWidth: 320 }}>
      <div className="flex justify-between text-sm" style={{ color: muted }}>
        <span>Subtotal</span>
        <span>{money(totals.subtotal ?? totals.grandTotal)}</span>
      </div>
      {totals.summaryDiscount?.fromColumn ? (totals.perColumn || []).filter((entry) => entry.type === 'discount').map((entry) => (
        <div key={entry.id} className="mt-1 flex justify-between text-sm text-rose-600">
          <span>Less: {entry.label}</span>
          <span>− {money(entry.amount)}</span>
        </div>
      )) : totals.summaryDiscount?.hidden ? (
        editable ? (
          <button type="button" onClick={restoreDiscount} className="no-print mt-1 text-left text-[12px] font-normal text-slate-400 hover:text-moss">
            + discount
          </button>
        ) : null
      ) : (
        <div className="mt-1 flex justify-between text-sm text-rose-600">
          <span className="flex min-w-0 items-center gap-1">
            {editable ? (
              <button type="button" onClick={hideDiscount} title="Remove discount" className="no-print w-4 shrink-0 text-left text-slate-300 hover:text-rose-500">×</button>
            ) : null}
            <span>
              Less: Discount
              {bill.discountUnit === 'percent' && String(bill.discountValue || '').trim() ? (
                <span className={editable ? 'print-only-cell' : undefined} style={editable ? { display: 'none' } : undefined}>{` (${bill.discountValue}%)`}</span>
              ) : null}
            </span>
            {editable ? (
              <>
                <input
                  value={bill.discountValue}
                  onChange={(e) => set({ discountValue: e.target.value.replace(/[^\d.]/g, ''), showDiscount: true })}
                  placeholder="0"
                  inputMode="decimal"
                  aria-label="Discount"
                  className="no-print w-12 bg-transparent text-right text-[13px] text-rose-600 outline-none"
                />
                <button
                  type="button"
                  title={bill.discountUnit === 'percent' ? 'Percent of subtotal' : 'Flat rupee amount'}
                  onClick={() => set({ discountUnit: bill.discountUnit === 'percent' ? 'amount' : 'percent', showDiscount: true })}
                  className="no-print w-5 text-xs text-rose-400"
                >
                  {bill.discountUnit === 'percent' ? '%' : '₹'}
                </button>
              </>
            ) : null}
          </span>
          <span>− {money(totals.summaryDiscount?.amount)}</span>
        </div>
      )}
      {(totals.discountTotal || 0) > 0 ? (
        <div className="mt-1 flex justify-between border-t border-dashed pt-1 text-sm" style={{ color: muted, borderColor: 'var(--qg-table-border, #e2e8f0)' }}>
          <span>Taxable value</span>
          <span>{money(totals.taxableTotal)}</span>
        </div>
      ) : null}
      {totals.summaryTax?.fromColumn ? (totals.perColumn || []).filter((entry) => entry.type === 'tax').map((entry) => (
        <div key={entry.id} className="mt-1 flex justify-between text-sm" style={{ color: muted }}>
          <span>Add: {entry.label}</span>
          <span>{money(entry.amount)}</span>
        </div>
      )) : (
        <div className="mt-1 flex justify-between text-sm" style={{ color: muted }}>
          <span className="flex min-w-0 items-center gap-1">
            <span>
              Add: Tax
              {String(bill.taxPercent || '').trim() ? (
                <span className={editable ? 'print-only-cell' : undefined} style={editable ? { display: 'none' } : undefined}>{` (${bill.taxPercent}%)`}</span>
              ) : null}
            </span>
            {editable ? (
              <>
                <input
                  value={bill.taxPercent}
                  onChange={(e) => set({ taxPercent: e.target.value.replace(/[^\d.]/g, '') })}
                  placeholder="0"
                  inputMode="decimal"
                  aria-label="Tax percent"
                  className="no-print w-12 bg-transparent text-right text-[13px] outline-none"
                  style={{ color: muted }}
                />
                <span className="no-print text-xs">%</span>
              </>
            ) : null}
          </span>
          <span>{money(totals.summaryTax?.amount)}</span>
        </div>
      )}
      <div className="qg-totals-grand flex justify-between text-sm" style={{ borderColor: theme?.accent }}>
        <span>Total</span>
        <span>{money(totals.grandTotal)}</span>
      </div>
    </div>
  )
}

function TrialThemedExport({ quote, companyProfile = null, themeId = 'formal', captureReady = false, onUploadLogo = null, logoBusy = false, onLogoSizeChange = null, onRateChange = null, onCustomerChange = null, onBillChange = null }) {
  const columns = Array.isArray(quote?.columns) && quote.columns.length ? quote.columns : CORE_COLUMNS.map(({ locked, ...c }) => c)
  const items = Array.isArray(quote?.items) ? quote.items : []
  const bill = resolvedBill(quote?.billAdjustments)
  const totals = computeQuoteTotals(items, columns, quote?.extraLines, bill)
  const profile = companyProfile || quote?.companyProfile || null
  const companyName = String(profile?.companyName || '').trim() || 'Your Company Name'
  const headerText = String(profile?.headerText || '').trim()
  const logoUrl = String(profile?.logoUrl || '').trim()
  const terms = String(quote?.fields?.standardTerms || profile?.standardTerms || '').trim()
  const title = String(quote?.title || quote?.subject || '').trim()
  const clientName = String(quote?.customer?.name || '').trim()
  const clientCompany = String(quote?.customer?.company || '').trim()
  const clientGst = String(quote?.customer?.gst || '').trim()
  const clientLocation = String(quote?.customer?.location || '').trim()
  const hasClient = Boolean(clientName || clientCompany || clientGst || clientLocation)
  const draftable = !captureReady && Boolean(onRateChange || onCustomerChange)
  const rateCol = findFieldColumn(columns, 'rate')
  const resolvedId = normalizePaperStyle(themeId)
  const chosenAccent = accentForTableColor(quote?.tableColorId, quote?.logoPalette, quote?.customAccent || quote?.tableAccent)
  const theme = resolvePaperTheme(resolvedId, chosenAccent)
  const colWidths = trialExportColWidths(columns)
  const rootRef = useRef(null)
  const [pages, setPages] = useState(() => defaultA4Pages(items.length))

  useLayoutEffect(() => {
    const measured = measureA4Blocks(rootRef.current)
    const next = packA4Pages({ rowCount: items.length, ...measured })
    setPages((prev) => (pagesEqual(prev, next) ? prev : next))
    return undefined
  }, [items, columns, companyName, headerText, logoUrl, title, terms, clientName, clientCompany, resolvedId, chosenAccent, profile?.logoWidth, profile?.logoHeight])

  const letterhead = (
    <div data-qg-block="header">
      <QuotePaperHeader
        theme={theme}
        profile={profile}
        quote={quote || {}}
        update={noopUpdate}
        docLabel="QUOTATION"
        grandTotal={money(totals.grandTotal)}
        onUploadLogo={onUploadLogo}
        logoBusy={logoBusy}
        onLogoSizeChange={captureReady ? null : onLogoSizeChange}
      />
    </div>
  )

  const parties = (
    <div className="qg-to-subject-wrap qg-to-subject-wrap--formal" data-qg-block="meta">
      {title ? <h3 className="qg-formal-subject" style={{ color: theme.text }}>{title}</h3> : null}
      <div className="qg-to-subject-section qg-formal-parties">
        <div className="qg-to-col">
          <p className="qg-section-chip" style={{ color: theme.accent }}>Quoted to</p>
          {draftable ? (
            <div className="meta-guide-draft-client">
              {[
                ['name', 'Contact name'],
                ['company', 'Company'],
                ['gst', 'GSTIN'],
                ['location', 'Location']
              ].map(([key, placeholder]) => (
                <input
                  key={key}
                  className="meta-guide-draft-input"
                  value={quote?.customer?.[key] || ''}
                  placeholder={placeholder}
                  aria-label={placeholder}
                  onChange={(e) => onCustomerChange?.({ [key]: e.target.value })}
                />
              ))}
            </div>
          ) : hasClient ? (
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
                const isRate = Boolean(rateCol && col.id === rateCol.id)
                return (
                  <td key={col.id} className={`${right ? 'is-right qg-cell-compact' : ''}${desc ? ' description-cell' : ''}`}>
                    {draftable && isRate ? (
                      <input
                        className="meta-guide-draft-input is-rate"
                        inputMode="decimal"
                        value={item?.[col.id] ?? ''}
                        placeholder="Rate"
                        aria-label={`Rate for row ${index + 1}`}
                        onChange={(e) => onRateChange?.(index, e.target.value)}
                      />
                    ) : isImageColumn(col) || isAttachmentColumn(col)
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

  const notes = (Array.isArray(quote?.notes) ? quote.notes : []).map((n) => String(n || '').trim()).filter(Boolean)
  const clarifications = (Array.isArray(quote?.clarifications) ? quote.clarifications : []).map((n) => String(n || '').trim()).filter(Boolean)
  const commercial = ['validity', 'delivery', 'payment', 'taxes', 'freight']
    .map((key) => ({ key, val: String(quote?.terms?.[key] || '').trim() }))
    .filter((row) => row.val)
  const bankRows = [
    ['Bank Name', profile?.bankName],
    ['Account Name', profile?.bankAccountName || companyName],
    ['Account No', profile?.bankAccountNo],
    ['IFSC / SWIFT', profile?.bankIfsc]
  ].filter(([, value]) => String(value || '').trim())

  const totalsBlock = (
    <TrialBillTotals
      totals={totals}
      bill={bill}
      theme={theme}
      editable={!captureReady && Boolean(onBillChange)}
      onChange={onBillChange}
    />
  )

  const closing = (
    <div data-qg-block="closing">
      <div className="qg-paper-body">
        <div className={`qg-closing-stack${notes.length ? ' qg-closing-stack--side' : ''}`}>
          <section className="qg-closing-optional">
            <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Standard terms</p>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--qg-muted)', whiteSpace: 'pre-line' }}>
              {terms || '—'}
            </p>
          </section>
          {notes.length ? (
            <section className="qg-closing-optional qg-closing-notes">
              <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Notes</p>
              <div className="mt-1 text-sm leading-6" style={{ color: 'var(--qg-text)' }}>
                {notes.map((line, i) => <p key={i}>{line}</p>)}
              </div>
            </section>
          ) : null}
        </div>
        {clarifications.length ? (
          <section className="qg-closing-optional" style={{ marginTop: 14 }}>
            <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Clarifications</p>
            <div className="mt-1 text-sm leading-6" style={{ color: 'var(--qg-muted)' }}>
              {clarifications.map((line, i) => <p key={i}>{line}</p>)}
            </div>
          </section>
        ) : null}
        {commercial.length ? (
          <section style={{ marginTop: 16 }}>
            <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Commercial terms</p>
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {commercial.map((row) => (
                <div key={row.key} className="flex gap-2 border-b border-dashed py-2 text-sm" style={{ borderColor: 'var(--qg-table-border)' }}>
                  <span className="w-28 shrink-0 capitalize" style={{ color: 'var(--qg-muted)' }}>{row.key}</span>
                  <span>{row.val}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <footer className="mt-8 qg-signatory-block">
          {bankRows.length || profile?.bankQrUrl ? (
            <>
              <hr className="qg-section-rule" />
              <section className="mb-8">
                <h3 className="qg-section-heading mb-2 border-b pb-1.5 text-[11px]" style={{ borderColor: 'var(--qg-table-border, #e8edf3)' }}>Bank details</h3>
                <div className={`qg-bank-block${profile?.bankQrUrl ? ' qg-bank-block--with-qr' : ''}`}>
                  {profile?.bankQrUrl ? (
                    <div className="qg-bank-qr-col">
                      <img src={profile.bankQrUrl} alt="Payment QR" className="qg-bank-qr" />
                    </div>
                  ) : null}
                  <div className="text-sm leading-7 text-slate-700">
                    {bankRows.map(([label, value]) => (
                      <p key={label}><span className="text-slate-600">{label}:</span> {value}</p>
                    ))}
                  </div>
                </div>
              </section>
            </>
          ) : null}
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
    </div>
  )

  const pagesToPaint = pages

  return (
    <div
      ref={rootRef}
      data-qg-theme={resolvedId}
      {...(captureReady ? { 'data-qg-trial-ready': '1' } : { 'data-qg-preview': '1' })}
    >
      <QuoteStudioCanvas
        themeId={resolvedId}
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
        {pagesToPaint.map((page, pageIndex) => (
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

function ScaledQuotePaper({ children }) {
  const outerRef = useRef(null)
  const innerRef = useRef(null)
  const [scale, setScale] = useState(0.42)
  const [naturalH, setNaturalH] = useState(1123)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner || typeof ResizeObserver === 'undefined') return undefined
    const apply = () => {
      const w = outer.clientWidth
      if (w > 40) setScale(Math.min(1, w / 794))
      const h = inner.scrollHeight || inner.offsetHeight || 0
      if (h > 80) setNaturalH(h)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(outer)
    ro.observe(inner)
    const later = window.setTimeout(apply, 120)
    return () => {
      ro.disconnect()
      window.clearTimeout(later)
    }
  }, [])

  return (
    <div ref={outerRef} className="meta-guide-scaled" style={{ height: naturalH * scale, '--qg-preview-scale': scale }}>
      <div
        ref={innerRef}
        className="meta-guide-scaled-inner"
        style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          width: 794,
          marginLeft: -397,
          transform: `scale(${scale})`,
          transformOrigin: 'top center'
        }}
      >
        {children}
      </div>
    </div>
  )
}

function TrialFormatCarousel({ quote, companyProfile, themeId, onThemeChange, ready, onAddLogo, logoBusy, onReadingChange, onLogoSizeChange, onRateChange = null, onCustomerChange = null, onBillChange = null }) {
  const scrollerRef = useRef(null)
  const hintingRef = useRef(false)
  const [hinting, setHinting] = useState(false)
  const active = DEMO_PAPER_IDS.includes(themeId) ? themeId : 'formal'
  const activeIndex = Math.max(0, DEMO_PAPER_IDS.indexOf(active))
  const theme = PAPER_THEMES[active] || PAPER_THEMES.formal
  const lastIndex = DEMO_PAPER_IDS.length - 1

  const goTo = (index, behavior = 'smooth') => {
    const el = scrollerRef.current
    if (!el) return
    const clamped = Math.max(0, Math.min(lastIndex, index))
    const left = centerScrollLeft(el, clamped)
    if (behavior === 'instant') el.scrollLeft = left
    else el.scrollTo({ left, behavior: 'smooth' })
    const id = DEMO_PAPER_IDS[clamped]
    if (id && id !== themeId) onThemeChange(id)
    onReadingChange?.(false)
  }

  const syncFromScroll = () => {
    if (hintingRef.current) return
    const el = scrollerRef.current
    if (!el) return
    const mid = el.scrollLeft + el.clientWidth / 2
    let best = 0
    let bestDist = Infinity
    Array.from(el.children).forEach((slide, i) => {
      const center = slide.offsetLeft + slide.offsetWidth / 2
      const dist = Math.abs(center - mid)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    const id = DEMO_PAPER_IDS[best]
    if (id && id !== themeId) onThemeChange(id)
  }

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !ready) return undefined
    let cancelled = false
    const run = async () => {
      goTo(Math.max(0, DEMO_PAPER_IDS.indexOf(themeId)), 'instant')
      let played = false
      try { played = sessionStorage.getItem(FORMAT_HINT_KEY) === '1' } catch { /* ignore */ }
      if (played || DEMO_PAPER_IDS.length < 2) return
      hintingRef.current = true
      setHinting(true)
      await sleep(480)
      if (cancelled) return
      await animateScrollLeft(el, centerScrollLeft(el, 1), 560)
      await sleep(380)
      if (cancelled) return
      await animateScrollLeft(el, centerScrollLeft(el, 0), 600)
      try { sessionStorage.setItem(FORMAT_HINT_KEY, '1') } catch { /* ignore */ }
      hintingRef.current = false
      setHinting(false)
      onThemeChange('formal')
    }
    run()
    return () => {
      cancelled = true
      hintingRef.current = false
      setHinting(false)
    }
  }, [ready])

  useEffect(() => {
    const onKey = (e) => {
      if (hintingRef.current) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goTo(activeIndex + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goTo(activeIndex - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, themeId])

  return (
    <div className="meta-guide-format">
      <div className="meta-guide-format-stage">
        <button
          type="button"
          className="meta-guide-format-arrow is-prev"
          aria-label="Previous quotation format"
          disabled={hinting || activeIndex <= 0}
          onClick={() => goTo(activeIndex - 1)}
        >
          <IconChevron dir="left" />
        </button>
        <div
          ref={scrollerRef}
          className="meta-guide-format-track"
          onScroll={syncFromScroll}
        >
          {DEMO_PAPER_IDS.map((id, index) => {
            const live = hinting
              ? index <= 1
              : Math.abs(index - activeIndex) <= 1
            return (
              <div
                key={id}
                className={`meta-guide-format-slide${id === active ? ' is-active' : ''}`}
                aria-hidden={id !== active}
                aria-label={PAPER_THEMES[id]?.label || id}
                onScroll={(e) => {
                  if (id !== active) return
                  onReadingChange?.((e.currentTarget.scrollTop || 0) > 18)
                }}
              >
                {live ? (
                  <ScaledQuotePaper>
                    <TrialThemedExport
                      quote={quote}
                      companyProfile={companyProfile}
                      themeId={id}
                      onUploadLogo={onAddLogo}
                      logoBusy={logoBusy}
                      onLogoSizeChange={onLogoSizeChange}
                      onRateChange={id === active ? onRateChange : null}
                      onCustomerChange={id === active ? onCustomerChange : null}
                      onBillChange={id === active ? onBillChange : null}
                    />
                  </ScaledQuotePaper>
                ) : (
                  <div className="meta-guide-format-ph" style={{ background: PAPER_THEMES[id]?.pageBg || '#eef0f5' }}>
                    <span>{PAPER_THEMES[id]?.label}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <button
          type="button"
          className="meta-guide-format-arrow is-next"
          aria-label="Next quotation format"
          disabled={hinting || activeIndex >= lastIndex}
          onClick={() => goTo(activeIndex + 1)}
        >
          <IconChevron dir="right" />
        </button>
        {hinting ? (
          <div className="meta-guide-format-hint" aria-hidden="true">
            <span className="meta-guide-format-hint-arrow is-left"><IconChevron dir="left" /></span>
            <span className="meta-guide-format-hint-copy">Swipe</span>
            <span className="meta-guide-format-hint-arrow is-right"><IconChevron dir="right" /></span>
          </div>
        ) : null}
      </div>
      <p className="meta-guide-format-name">{theme.label}</p>
      <p className="meta-guide-format-kicker">Scroll to read every page — arrows or swipe for another design</p>
      <div className="meta-guide-format-dots" role="tablist" aria-label="Quotation formats">
        {DEMO_PAPER_IDS.map((id, index) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={id === active ? 'is-on' : ''}
            aria-label={PAPER_THEMES[id]?.label || id}
            aria-selected={id === active}
            disabled={hinting}
            onClick={() => goTo(index)}
          />
        ))}
      </div>
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
  onSignIn,
  onTryAnother,
  demoQuotesUsed = 0,
  demoQuoteCap = 10,
  companyProfile = null,
  trialLead = null,
  onSaveCompany,
  onPatchQuote,
  onCompanyProfileSaved,
  onPreviewPay
}) {
  const initialSeed = companySeedFromLead(usefulLead(trialLead) || readMetaAdsLead(), companyProfile)
  const savedProgress = readMetaGuideProgress()
  const [step, setStep] = useState(() => (savedProgress?.step === 2 ? 2 : 1))
  const [phase, setPhase] = useState(() => (savedProgress?.phase === 'convert' ? 'convert' : 'flow'))
  const [revealQuote, setRevealQuote] = useState(null)
  const [revealReady, setRevealReady] = useState(false)
  const [previewReading, setPreviewReading] = useState(false)
  const [paperStyle, setPaperStyle] = useState(() => readPreferredPaperStyle())
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
  const [seatsLeft, setSeatsLeft] = useState(() => readSeatsLeft() ?? SEAT_START)
  const offerLeftMs = offerStartedAt ? offerStartedAt + OFFER_MS - offerNow : OFFER_MS
  const offerLive = offerLeftMs > 0
  const payPrice = offerLive ? JOIN_PRICE : REGULAR_PRICE

  useEffect(() => {
    writeMetaGuideProgress({ phase, step })
  }, [phase, step])

  useEffect(() => {
    if (phase !== 'convert') return
    const existing = readOfferStart()
    if (existing) {
      if (!offerStartedAt) {
        setOfferStartedAt(existing)
        setOfferNow(Date.now())
      }
      return
    }
    const at = Date.now()
    writeOfferStart(at)
    setOfferStartedAt(at)
    setOfferNow(at)
  }, [phase, offerStartedAt])

  useEffect(() => {
    if (!offerStartedAt || !offerLive) return undefined
    const t = setInterval(() => setOfferNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [offerStartedAt, offerLive])

  useEffect(() => {
    if (phase !== 'convert' || !offerLive) return undefined
    let cancelled = false
    let timer = 0
    const wait = (ms) => new Promise((resolve) => {
      timer = window.setTimeout(resolve, ms)
    })
    const dropTo = (n) => {
      const next = Math.max(SEAT_FLOOR, n)
      writeSeatsLeft(next)
      setSeatsLeft(next)
    }
    const scheduleTick = (delayMs) => {
      timer = window.setTimeout(() => {
        if (cancelled) return
        setSeatsLeft((cur) => {
          const next = Math.max(SEAT_FLOOR, cur - 1)
          writeSeatsLeft(next)
          return next
        })
        scheduleTick(randomSeatWaitMs())
      }, delayMs)
    }
    const run = async () => {
      const stored = readSeatsLeft()
      const introDone = readSeatsIntroDone() || (stored != null && stored <= SEAT_INTRO_END)
      const reduceMotion = typeof window !== 'undefined'
        && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

      if (introDone) {
        dropTo(stored ?? SEAT_INTRO_END)
        if (cancelled) return
        scheduleTick(randomSeatWaitMs())
        return
      }

      const from = stored != null && stored <= SEAT_START && stored > SEAT_INTRO_END
        ? stored
        : SEAT_START
      dropTo(from)
      const remaining = from - SEAT_INTRO_END
      if (remaining <= 0) {
        writeSeatsIntroDone()
        if (cancelled) return
        scheduleTick(randomSeatWaitMs())
        return
      }
      if (reduceMotion) {
        dropTo(SEAT_INTRO_END)
        writeSeatsIntroDone()
        if (cancelled) return
        scheduleTick(randomSeatWaitMs())
        return
      }
      const delays = randomIntroDelays(remaining)
      for (let i = 0; i < delays.length; i += 1) {
        if (cancelled) return
        await wait(delays[i])
        if (cancelled) return
        dropTo(from - 1 - i)
      }
      if (cancelled) return
      writeSeatsIntroDone()
      scheduleTick(randomSeatWaitMs())
    }
    run()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase, offerLive])

  const [payBusy, setPayBusy] = useState(false)
  const [payError, setPayError] = useState('')

  const openPay = async () => {
    if (payBusy) return
    if (onPreviewPay) {
      onPreviewPay()
      return
    }
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
  const [draftColumns, setDraftColumns] = useState(() => {
    const stored = peekPreferredColumns()
    if (stored?.length) return stored
    return Array.isArray(columns) && columns.length ? columns : CORE_COLUMNS.map(({ locked, ...c }) => c)
  })
  const [customLabel, setCustomLabel] = useState('')
  const [showAddMore, setShowAddMore] = useState(false)
  useEffect(() => {
    if (Array.isArray(draftColumns) && draftColumns.length) writePreferredColumns(draftColumns)
  }, [draftColumns])
  const fileRef = useRef(null)
  const logoFileRef = useRef(null)
  const generateGenRef = useRef(0)
  const logoSizeTimerRef = useRef(0)
  const guideProfileRef = useRef(guideProfile)
  guideProfileRef.current = guideProfile

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

  const applyLogoSize = ({ logoWidth, logoHeight }) => {
    const next = { ...(guideProfileRef.current || {}), logoWidth, logoHeight }
    applyGuideProfile(next)
    window.clearTimeout(logoSizeTimerRef.current)
    logoSizeTimerRef.current = window.setTimeout(() => {
      onSaveCompany?.({ logoWidth, logoHeight })
    }, 400)
  }

  const applyTableColor = (id, hex) => {
    const palette = revealQuote?.logoPalette || null
    const tableColorId = id || 'blue'
    const customAccent = tableColorId === 'custom'
      ? normalizeAccentHex(hex, revealQuote?.customAccent || revealQuote?.tableAccent)
      : (revealQuote?.customAccent || null)
    const tableAccent = accentForTableColor(tableColorId, palette, customAccent)
    setRevealQuote((q) => (q ? { ...q, tableColorId, tableAccent, customAccent: customAccent || q.customAccent || null, logoPalette: palette } : q))
    onPatchQuote?.({ tableColorId, tableAccent, customAccent: customAccent || revealQuote?.customAccent || null, logoPalette: palette })
  }

  const matchColoursFromLogo = async (url) => {
    if (!url) return
    try {
      const palette = await extractImagePalette(url)
      if (!palette?.primary) return
      const tableColorId = 'logo-primary'
      const tableAccent = palette.primary
      setRevealQuote((q) => (q ? { ...q, logoPalette: palette, tableColorId, tableAccent } : q))
      onPatchQuote?.({ logoPalette: palette, tableColorId, tableAccent })
    } catch {
      /* keep default accent */
    }
  }

  useEffect(() => {
    const url = String(guideProfile?.logoUrl || '').trim()
    if (phase !== 'reveal' || !url || revealQuote?.logoPalette?.primary) return undefined
    void matchColoursFromLogo(url)
    return undefined
  }, [phase, guideProfile?.logoUrl, revealQuote?.logoPalette?.primary])

  const patchRevealCustomer = (customer) => {
    setRevealQuote((q) => (q ? { ...q, customer: { ...(q.customer || {}), ...customer } } : q))
    setClientDraft((d) => ({
      ...d,
      ...(customer.name != null ? { name: customer.name } : {}),
      ...(customer.company != null ? { company: customer.company } : {}),
      ...(customer.gst != null ? { gst: customer.gst } : {}),
      ...(customer.location != null ? { location: customer.location } : {})
    }))
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

  const patchRevealBill = (nextBill) => {
    const bill = normalizeBillAdjustments(nextBill)
    setRevealQuote((q) => (q ? { ...q, billAdjustments: bill } : q))
    onPatchQuote?.({ billAdjustments: bill })
  }

  const applyPaperStyle = (id) => {
    const next = normalizePaperStyle(id)
    setPaperStyle(next)
    writePreferredPaperStyle(next)
    onPatchQuote?.({ paperStyle: next })
    setRevealQuote((q) => (q ? { ...q, paperStyle: next } : q))
  }

  const commitPreferredPaperStyle = (id) => {
    const next = normalizePaperStyle(id)
    applyPaperStyle(next)
    onSaveCompany?.({ paperStyle: next })
    return next
  }

  const downloadFormalPdf = async () => {
    if (!revealQuote || pdfBusy) return
    setLocalError('')
    setPdfBusy(true)
    const visibleId = normalizePaperStyle(visibleCarouselThemeId(paperStyle))
    commitPreferredPaperStyle(visibleId)
    try {
      const need = (Array.isArray(revealQuote?.items) && revealQuote.items.length > 10) ? 2 : 1
      for (let i = 0; i < 60; i += 1) {
        const root = document.querySelector('.meta-guide-format-slide.is-active [data-qg-preview="1"]')
          || document.querySelector('[data-qg-trial-ready="1"]')
        const themeOk = root?.getAttribute('data-qg-theme') === visibleId
        const papers = root?.querySelectorAll('.qg-studio-paper') || []
        if (themeOk && papers.length >= need) break
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      await sleep(80)
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
      const result = await uploadCompanyLogo(file, { logoWidth: 72 })
      if (result?.unavailable) {
        applyGuideProfile({ ...(guideProfile || {}), logoUrl: localUrl })
        await matchColoursFromLogo(localUrl)
        return
      }
      if (result?.profile) {
        applyGuideProfile(result.profile)
        await matchColoursFromLogo(result.profile.logoUrl || localUrl)
        return
      }
      applyGuideProfile({ ...(guideProfile || {}), logoUrl: localUrl })
      await matchColoursFromLogo(localUrl)
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
        standardTerms: companyDraft.standardTerms.trim(),
        paperStyle: normalizePaperStyle(paperStyle)
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

  const quotesUsed = Number(demoQuotesUsed) || 0
  const atDemoCap = quotesUsed >= demoQuoteCap

  const tryAnotherEnquiry = () => {
    if (atDemoCap) return
    setLocalError('')
    setPreviewReading(false)
    setRevealQuote(null)
    setPhase('flow')
    setStep(1)
    setEnquiry?.('')
    onTryAnother?.()
  }

  const goGenerate = async () => {
    setLocalError('')
    if (atDemoCap) {
      setLocalError('You have used all 10 demo quotations. Join QuoteGen to continue.')
      return
    }
    if (!draftColumns.length) {
      setLocalError('Keep at least one column.')
      return
    }
    setPhase('ceremony')
    setRevealReady(false)
    setPreviewReading(false)
    setRevealQuote(null)
    const gen = ++generateGenRef.current
    const started = Date.now()
    try {
      const built = await onGenerate?.(draftColumns)
      if (gen !== generateGenRef.current) return
      const elapsed = Date.now() - started
      if (elapsed < CEREMONY_MIN_MS) await sleep(CEREMONY_MIN_MS - elapsed)
      if (gen !== generateGenRef.current) return
      if (!built) {
        setPhase('flow')
        setStep(2)
        const raw = error || 'Could not create the quotation. Please try again.'
        setLocalError(/429|credits|Retry shortly|timed out|TimeoutError/i.test(String(raw))
          ? 'The generator is busy. Tap Create quotation again — your enquiry is still here.'
          : raw)
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
      if (gen !== generateGenRef.current) return
      setPhase('reveal')
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setRevealReady(true))
      })
    } catch (err) {
      if (gen !== generateGenRef.current) return
      setPhase('flow')
      setStep(2)
      setLocalError(err?.message || 'Could not create the quotation. Please try again.')
    }
  }

  const backFromReveal = () => {
    setPreviewReading(false)
    setLocalError('')
    setPhase('flow')
    setStep(2)
  }

  if (phase === 'ceremony') {
    return <QuoteGenerateCeremony enquiry={enquiryPreview} columns={draftColumns} />
  }

  if (phase === 'reveal' && revealQuote) {
    return (
      <main className={`meta-guide meta-guide-reveal-page${revealReady ? ' is-ready' : ''}${previewReading ? ' is-reading' : ''}`}>
        <DemoHowToVideo placement="top-right" />
        <div className="meta-guide-reveal-shell">
          <p className="meta-guide-step">Ta-da</p>
          <h1 className="meta-guide-title">
            Quotation <span>unlocked</span>
          </h1>

          {String(guideProfile?.logoUrl || '').trim() ? (
            <div className="meta-guide-color-row">
              <span>Colour</span>
              <div className="meta-guide-color-swatches">
                {tableColorSwatches(revealQuote?.logoPalette).map((swatch) => (
                  <button
                    key={swatch.id}
                    type="button"
                    title={swatch.caption || swatch.label}
                    aria-label={swatch.label}
                    aria-pressed={(revealQuote?.tableColorId || 'blue') === swatch.id}
                    className={`meta-guide-color-swatch${(revealQuote?.tableColorId || 'blue') === swatch.id ? ' is-on' : ''}`}
                    style={{ background: swatch.hex }}
                    onClick={() => applyTableColor(swatch.id)}
                  />
                ))}
                {String(guideProfile?.logoUrl || '').trim() ? (
                  <em className="meta-guide-color-or">or</em>
                ) : null}
                <input
                  id="meta-guide-custom-color"
                  type="color"
                  className="meta-guide-color-custom-input"
                  value={normalizeAccentHex(revealQuote?.customAccent || revealQuote?.tableAccent).toLowerCase()}
                  aria-label="Custom colour"
                  onChange={(e) => applyTableColor('custom', e.target.value)}
                />
                <label
                  htmlFor="meta-guide-custom-color"
                  className={`meta-guide-color-custom${(revealQuote?.tableColorId || 'blue') === 'custom' ? ' is-on' : ''}`}
                  title="Pick any colour"
                  onClick={() => {
                    if ((revealQuote?.tableColorId || 'blue') !== 'custom') {
                      applyTableColor('custom', revealQuote?.customAccent || revealQuote?.tableAccent)
                    }
                  }}
                >
                  Custom
                </label>
              </div>
              <em>Matched from your logo — tap to change</em>
            </div>
          ) : null}

          <div className={`meta-guide-reveal-frame${revealReady ? ' is-expand' : ''}`}>
            <TrialFormatCarousel
              quote={revealQuote}
              companyProfile={guideProfile}
              themeId={paperStyle}
              onThemeChange={applyPaperStyle}
              ready={revealReady}
              onAddLogo={() => { if (!logoBusy) logoFileRef.current?.click() }}
              logoBusy={logoBusy}
              onReadingChange={setPreviewReading}
              onLogoSizeChange={applyLogoSize}
              onRateChange={patchRevealRate}
              onCustomerChange={patchRevealCustomer}
              onBillChange={patchRevealBill}
            />
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

          <div className="meta-guide-unlock meta-guide-actions">
            <button type="button" className="meta-guide-ghost" onClick={backFromReveal}>
              ← Back
            </button>
            <button
              type="button"
              className="meta-guide-primary meta-guide-pdf-cta"
              disabled={pdfBusy || logoBusy}
              onClick={() => { void downloadFormalPdf() }}
            >
              {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
            </button>
          </div>
        </div>

        {revealQuote ? (
          <div className="meta-guide-pdf-offscreen" aria-hidden="true">
            <TrialThemedExport key={paperStyle} quote={revealQuote} companyProfile={guideProfile} themeId={paperStyle} captureReady />
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

  if (phase === 'convert') {
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
              Join QuoteGen.
            </p>
            <p className="meta-guide-convert-meta">Just paste, verify and send.</p>
            {offerLive ? (
              <>
                <div className="meta-guide-offer is-live" role="timer" aria-live="off">
                  <p className="meta-guide-offer-row">
                    Special price <s>₹{REGULAR_PRICE}</s> ₹{JOIN_PRICE}/month
                  </p>
                  <p className="meta-guide-offer-row is-end">
                    <em className="meta-guide-offer-save">Save ₹{JOIN_SAVE}/month</em>
                    <span className="meta-guide-offer-ends">ends in</span>
                    <span className="meta-guide-offer-clock">{formatCountdown(offerLeftMs)}</span>
                  </p>
                </div>
                <p className="meta-guide-seats" aria-live="polite">
                  Only <strong><SeatOdometer value={seatsLeft} /></strong> / {SEAT_CAP} seats left at this price
                </p>
              </>
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
            {atDemoCap ? (
              <p className="meta-guide-convert-error">You’ve used all {demoQuoteCap} demo quotations. Join QuoteGen to continue.</p>
            ) : (
              <button type="button" className="meta-guide-convert-again" onClick={tryAnotherEnquiry}>
                Try another enquiry
                {quotesUsed > 0 ? ` · ${demoQuoteCap - quotesUsed} left` : ''}
              </button>
            )}
            {payError ? <p className="meta-guide-convert-error" role="alert">{payError}</p> : null}
            <p className="meta-guide-convert-support">
              Got doubts?{' '}
              <a href={`tel:${SUPPORT_PHONE_E164}`}>Call {SUPPORT_PHONE_LABEL}</a>
            </p>
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
                ? <>Join now and pay just <strong>₹{JOIN_PRICE}/month</strong> — save <strong>₹{JOIN_SAVE}/month</strong> vs ₹{REGULAR_PRICE}. When the timer hits zero, the price goes up. Only {seatsLeft} of {SEAT_CAP} seats left.</>
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
              <p className="meta-guide-pay-note">
                <a href="/refund">Refund policy</a>
                {' · '}
                <a href="/terms">Terms</a>
              </p>
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
            <p className="meta-guide-convert-support is-modal">
              Got doubts?{' '}
              <a href={`tel:${SUPPORT_PHONE_E164}`}>Call {SUPPORT_PHONE_LABEL}</a>
            </p>
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
        <DemoHowToVideo placement="top-right" />
        <div className="meta-guide-reveal-shell meta-guide-final-shell">
          <p className="meta-guide-step">Final preview</p>
          <h1 className="meta-guide-title">
            Ready to <span>send</span>
          </h1>

          <div className="meta-guide-reveal-frame is-expand meta-guide-final-frame">
            <div className="meta-guide-final-scroll">
              <ScaledQuotePaper>
                <TrialThemedExport
                  quote={revealQuote}
                  companyProfile={guideProfile}
                  themeId={paperStyle}
                  onLogoSizeChange={applyLogoSize}
                />
              </ScaledQuotePaper>
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
              className="meta-guide-primary meta-guide-primary-inline meta-guide-pdf-cta"
              onClick={() => { void downloadFormalPdf() }}
              disabled={pdfBusy}
            >
              {pdfBusy ? 'Downloading…' : 'Download PDF'}
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="meta-guide meta-guide-flow">
      <div className="meta-guide-shell">
        <div className="meta-guide-flow-body">
          <div className="meta-guide-top">
            <p className="meta-guide-step">Step {step} of 2</p>
            {onSignIn ? (
              <button type="button" className="meta-guide-signin" onClick={onSignIn}>Sign in</button>
            ) : null}
          </div>
          {step === 1 ? (
            <>
              <h1 className="meta-guide-title">
                Paste or upload any of <span>your client's enquiry</span>
              </h1>
              <p className="meta-guide-lead">
                WhatsApp text, email, PDF, or a photo of the RFQ.
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
                  onPaste={(e) => {
                    const pasted = e.clipboardData?.getData('text/plain') || ''
                    const next = whatsAppPasteReplacement(enquiry, e.currentTarget.selectionStart, e.currentTarget.selectionEnd, pasted)
                    if (next == null) return
                    e.preventDefault()
                    setEnquiry(next)
                  }}
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
            </>
          )}
        </div>

        <div className="meta-guide-flow-foot">
          <div className="meta-guide-actions">
            {step === 1 && !onBack ? (
              <span className="meta-guide-ghost meta-guide-ghost-slot" aria-hidden="true" />
            ) : (
              <button
                type="button"
                className="meta-guide-ghost"
                disabled={step === 1 ? ingestBusy : loading}
                onClick={step === 1 ? onBack : () => setStep(1)}
              >
                ← Back
              </button>
            )}
            {step === 1 ? (
              <button
                type="button"
                className={`meta-guide-primary${!canNext || ingestBusy ? ' is-idle' : ''}`}
                disabled={!canNext || ingestBusy}
                onClick={() => { setLocalError(''); setStep(2) }}
              >
                Continue
                <span aria-hidden="true">→</span>
              </button>
            ) : (
              <button type="button" className="meta-guide-primary" disabled={loading || atDemoCap} onClick={atDemoCap ? openPay : goGenerate}>
                {loading ? 'Creating quotation…' : atDemoCap ? 'Join QuoteGen Now' : 'Create quotation'}
                {!loading && !atDemoCap && <span aria-hidden="true">→</span>}
              </button>
            )}
          </div>
          <p className={`meta-guide-fine${step === 1 ? ' is-slot' : ''}`}>
            {step === 1 ? '\u00a0' : atDemoCap ? 'You’ve used all 10 demo quotations. Join QuoteGen to continue.' : 'Next we’ll map your enquiry into this layout — then open the full quotation.'}
          </p>
        </div>
      </div>
    </main>
  )
}
