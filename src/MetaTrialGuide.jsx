import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ingestEnquiryFiles, uploadCompanyLogo, uploadCompanyBankQr, uploadCompanySignatory } from './quotePersistence.js'
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
  normalizeBillAdjustments,
  moveColumnInList,
  blankExtraLine,
  extraLineResolvedAmount,
  extraLineUnit
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

function autoGrowAddress(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, 24)}px`
}

function AutoGrowAddress({ value = '', onChange, placeholder, 'aria-label': ariaLabel, className = '' }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    autoGrowAddress(ref.current)
  }, [value])
  return (
    <textarea
      ref={ref}
      className={`meta-guide-draft-input meta-guide-draft-address ${className}`.trim()}
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => {
        onChange?.(e.target.value)
        autoGrowAddress(e.target)
      }}
    />
  )
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

/** Best-fit demo checkout packs — annual-first; monthly ≈ 1/10 of yearly. */
const DEMO_CHECKOUT_PACKS = {
  lite: {
    key: 'lite',
    name: 'Starter',
    yearly: 999,
    monthly: 99,
    quotations: 100,
    grace: 10,
    productYear: 'demo_lite_year',
    productMonth: 'demo_lite_month'
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    yearly: 2499,
    monthly: 249,
    quotations: 500,
    grace: 25,
    productYear: 'demo_growth_year',
    productMonth: 'demo_growth_month'
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    yearly: 3999,
    monthly: 399,
    quotations: 1000,
    grace: 100,
    productYear: 'demo_pro_year',
    productMonth: 'demo_pro_month'
  },
  business: {
    key: 'business',
    name: 'Business',
    yearly: 5999,
    monthly: 599,
    quotations: 2000,
    grace: 100,
    productYear: 'demo_business_year',
    productMonth: 'demo_business_month'
  },
  scale: {
    key: 'scale',
    name: 'Scale',
    yearly: 9999,
    monthly: 999,
    quotations: 5000,
    grace: 200,
    productYear: 'demo_scale_year',
    productMonth: 'demo_scale_month'
  }
}

const DEMO_COMMERCIAL_KEYS = ['validity', 'delivery', 'payment', 'taxes', 'freight']

function parseMonthlyQuotes(raw) {
  const n = parseInt(String(raw || '').replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function pickDemoCheckoutPack(monthlyQuotesRaw) {
  const n = parseMonthlyQuotes(monthlyQuotesRaw)
  if (n >= 501) return { kind: 'enterprise' }
  if (n >= 201) return { kind: 'pack', pack: DEMO_CHECKOUT_PACKS.scale }
  if (n >= 101) return { kind: 'pack', pack: DEMO_CHECKOUT_PACKS.business }
  if (n >= 51) return { kind: 'pack', pack: DEMO_CHECKOUT_PACKS.pro }
  if (n >= 26) return { kind: 'pack', pack: DEMO_CHECKOUT_PACKS.growth }
  return { kind: 'pack', pack: DEMO_CHECKOUT_PACKS.lite }
}

function resolveDemoCheckoutOffer(monthlyQuotesRaw, period = 'year') {
  const picked = pickDemoCheckoutPack(monthlyQuotesRaw)
  if (picked.kind === 'enterprise') {
    return {
      kind: 'enterprise',
      name: 'Enterprise',
      amount: null,
      period,
      periodSuffix: '',
      quotesLabel: 'Custom volume · 100+ quotations / month',
      graceLabel: '',
      cta: `Call ${SUPPORT_PHONE_LABEL}`,
      saveAnnual: null,
      payBody: null
    }
  }
  const pack = picked.pack
  const annual = period === 'year'
  const amount = annual ? pack.yearly : pack.monthly
  const saveAnnual = Math.max(0, pack.monthly * 12 - pack.yearly)
  return {
    kind: 'pack',
    packKey: pack.key,
    name: pack.name,
    amount,
    period: annual ? 'year' : 'month',
    periodSuffix: annual ? '/year' : '/month',
    quotesLabel: `${pack.quotations.toLocaleString('en-IN')}+ quotations / year`,
    graceLabel: `+${pack.grace} grace`,
    cta: annual ? 'Join annually' : 'Join monthly',
    saveAnnual,
    payBody: { product: annual ? pack.productYear : pack.productMonth }
  }
}

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
  const cols = columns || []
  const colCount = cols.length
  const dense = colCount >= 6
  const tight = colCount >= 8
  const sr = tight ? 28 : dense ? 32 : 36
  const printable = 718
  const minCol = tight ? 36 : dense ? 42 : 48
  const unitFloor = tight ? 44 : dense ? 56 : 72
  const raw = cols.map((col) => {
    if (isDescriptionColumn(col)) return tight ? 140 : dense ? 180 : 280
    if (col.id === 'unit' || /unit|uom/i.test(String(col.label || ''))) return unitFloor
    if (col.id === 'quantity' || /qty|quantity/i.test(String(col.label || ''))) return dense ? 52 : 72
    if (col.id === 'rate' || /rate|price/i.test(String(col.label || ''))) return dense ? 56 : 80
    if (col.id === 'amount' || /amount|total/i.test(String(col.label || ''))) return dense ? 64 : 96
    if (isImageColumn(col) || isAttachmentColumn(col)) return dense ? 44 : 64
    return dense ? 56 : 72
  })
  const budget = Math.max(240, printable - sr)
  const floorFor = (col) => {
    if (col && (col.id === 'unit' || /unit|uom/i.test(String(col.label || '')))) return unitFloor
    if (col && isDescriptionColumn(col)) return tight ? 96 : dense ? 120 : 160
    return minCol
  }
  const widths = raw.map((w, index) => Math.max(floorFor(cols[index]), w))
  let sum = widths.reduce((n, w) => n + w, 0) || 1
  if (sum > budget) {
    // Scale everything proportionally so all columns stay on the A4 page.
    const scale = budget / sum
    for (let i = 0; i < widths.length; i += 1) {
      widths[i] = Math.max(floorFor(cols[i]), Math.floor(widths[i] * scale))
    }
    sum = widths.reduce((n, w) => n + w, 0) || 1
    if (sum > budget) {
      // Still over: drop floors and force-fit.
      const force = budget / sum
      for (let i = 0; i < widths.length; i += 1) {
        widths[i] = Math.max(28, Math.floor(widths[i] * force))
      }
    }
  }
  const drift = budget - widths.reduce((n, w) => n + w, 0)
  if (widths.length) {
    const descIdx = cols.findIndex((c) => isDescriptionColumn(c))
    const padIdx = descIdx >= 0 ? descIdx : widths.length - 1
    widths[padIdx] += drift
  }
  return { sr, widths, dense, tight }
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

function TrialBillTotals({ totals, bill, theme, editable, onChange, extraLines = [], onExtraLinesChange = null }) {
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
  const lines = Array.isArray(extraLines) ? extraLines : []
  const setLines = (next) => onExtraLinesChange?.(next)
  const addLine = () => setLines([...lines, { ...blankExtraLine(), label: '', amount: '' }])
  const updateLine = (i, patch) => setLines(lines.map((row, index) => (index === i ? { ...row, ...patch } : row)))
  const removeLine = (i) => setLines(lines.filter((_, index) => index !== i))
  const extraBase = totals.extraBase ?? ((totals.taxableTotal || 0) + (totals.taxTotal || 0))
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
      {editable && onExtraLinesChange ? (
        <>
          {lines.map((line, i) => {
            const resolved = extraLineResolvedAmount(line, extraBase)
            const isLess = line.kind !== 'add'
            const isPercent = extraLineUnit(line) === 'percent'
            return (
              <div key={line.id || i} className="no-print mt-1.5 flex items-center gap-1" data-qg-ignore="1">
                <button type="button" onClick={() => removeLine(i)} title="Remove" className="w-4 shrink-0 text-left text-slate-300 hover:text-rose-500">×</button>
                <button type="button" title={isLess ? 'Subtract' : 'Add'} onClick={() => updateLine(i, { kind: isLess ? 'add' : 'less' })} className="w-5 shrink-0 text-sm text-slate-400">
                  {isLess ? '−' : '+'}
                </button>
                <input value={line.label || ''} onChange={(e) => updateLine(i, { label: e.target.value })} placeholder="Name" className="min-w-0 flex-1 bg-transparent py-0.5 text-[13px] outline-none" style={{ color: muted }} />
                <input value={line.amount ?? ''} onChange={(e) => updateLine(i, { amount: e.target.value })} placeholder="0" inputMode="decimal" className="w-14 bg-transparent py-0.5 text-right text-[13px] outline-none" style={{ color: muted }} />
                <button type="button" title={isPercent ? 'Percent' : 'Amount'} onClick={() => updateLine(i, { unit: isPercent ? 'amount' : 'percent' })} className="w-5 shrink-0 text-xs text-slate-400">
                  {isPercent ? '%' : '₹'}
                </button>
                <span className="w-14 shrink-0 text-right text-[12px]" style={{ color: muted }}>{isLess ? '− ' : ''}{money(resolved)}</span>
              </div>
            )
          })}
          <button type="button" onClick={addLine} className="no-print mt-1.5 text-[12px] font-normal text-slate-400 hover:text-[#1A73E8]" data-qg-ignore="1">
            + add line
          </button>
        </>
      ) : null}
      <div className="qg-totals-grand flex justify-between text-sm" style={{ borderColor: theme?.accent }}>
        <span>Total</span>
        <span>{money(totals.grandTotal)}</span>
      </div>
    </div>
  )
}

function blankRevealItem(columns) {
  const item = {}
  for (const col of columns || []) {
    if (isNestedColumn(col)) item[rateKey(col)] = ''
    else item[col.id] = ''
  }
  return item
}

function columnsLayoutSig(cols) {
  return JSON.stringify((cols || []).map((c) => ({ id: c.id, label: c.label, type: c.type || 'text' })))
}

function TrialThemedExport({
  quote,
  companyProfile = null,
  themeId = 'formal',
  captureReady = false,
  onUploadLogo = null,
  logoBusy = false,
  onLogoSizeChange = null,
  onRateChange = null,
  onCustomerChange = null,
  onBillChange = null,
  onCellChange = null,
  onAddRow = null,
  onRemoveRow = null,
  onRemoveColumn = null,
  onOpenAddColumn = null,
  onExtraLinesChange = null,
  onFieldsChange = null,
  onTermsChange = null,
  onNotesChange = null,
  onClarificationsChange = null,
  onBankChange = null,
  onColumnsChange = null,
  onUploadQr = null,
  qrBusy = false,
  onUploadSignatory = null,
  signatoryBusy = false,
  onRegenerate = null,
  canRegenerate = false,
  regenBusy = false,
  studioMode = false
}) {
  const columns = Array.isArray(quote?.columns) && quote.columns.length ? quote.columns : CORE_COLUMNS.map(({ locked, ...c }) => c)
  const items = Array.isArray(quote?.items) ? quote.items : []
  const bill = resolvedBill(quote?.billAdjustments)
  const totals = computeQuoteTotals(items, columns, quote?.extraLines, bill)
  const lockedColIds = new Set(CORE_COLUMNS.filter((c) => c.locked).map((c) => c.id))
  const [tableColOpen, setTableColOpen] = useState(false)
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
  const draftable = !captureReady && Boolean(onRateChange || onCustomerChange || onCellChange)
  const studio = studioMode && draftable && Boolean(onCellChange)
  const rateCol = findFieldColumn(columns, 'rate')
  const resolvedId = normalizePaperStyle(themeId)
  const chosenAccent = accentForTableColor(quote?.tableColorId, quote?.logoPalette, quote?.customAccent || quote?.tableAccent)
  const theme = resolvePaperTheme(resolvedId, chosenAccent)
  const baseColWidths = trialExportColWidths(columns)
  const [userColWidths, setUserColWidths] = useState({})
  const [dragColId, setDragColId] = useState(null)
  const [dropColId, setDropColId] = useState(null)
  const resizeStateRef = useRef(null)
  const columnsIdSig = columns.map((c) => c.id).join('|')
  useEffect(() => {
    setUserColWidths({})
  }, [columnsIdSig])

  const moveStudioColumns = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId || !onColumnsChange) return
    const from = columns.findIndex((c) => c.id === fromId)
    const to = columns.findIndex((c) => c.id === toId)
    if (from < 0 || to < 0) return
    onColumnsChange(moveColumnInList(columns, from, to))
  }

  const PRINTABLE_TABLE = 718
  const minColPx = 36
  const resolvedColWidths = (() => {
    const ids = columns.map((c) => c.id)
    const start = ids.map((id, i) => {
      const override = userColWidths[id]
      return Number.isFinite(override) ? override : baseColWidths.widths[i]
    })
    const budget = Math.max(240, PRINTABLE_TABLE - baseColWidths.sr)
    let sum = start.reduce((n, w) => n + w, 0) || 1
    const next = [...start]
    if (sum > budget) {
      const scale = budget / sum
      for (let i = 0; i < next.length; i += 1) next[i] = Math.max(minColPx, Math.floor(next[i] * scale))
      sum = next.reduce((n, w) => n + w, 0) || 1
    }
    const drift = budget - next.reduce((n, w) => n + w, 0)
    if (next.length) next[next.length - 1] = Math.max(minColPx, next[next.length - 1] + drift)
    return { sr: baseColWidths.sr, widths: next, dense: baseColWidths.dense, tight: baseColWidths.tight }
  })()

  const beginColumnResize = (e, colId) => {
    if (!studio) return
    e.preventDefault()
    e.stopPropagation()
    const ids = columns.map((c) => c.id)
    const index = ids.indexOf(colId)
    if (index < 0) return
    const budget = Math.max(240, PRINTABLE_TABLE - resolvedColWidths.sr)
    const startWidths = Object.fromEntries(ids.map((id, i) => [id, resolvedColWidths.widths[i]]))
    const rightKeys = ids.slice(index + 1)
    resizeStateRef.current = { key: colId, index, startX: e.clientX, startWidths, rightKeys, budget, ids }
    const onMove = (ev) => {
      const state = resizeStateRef.current
      if (!state) return
      const leftKeys = state.ids.slice(0, state.index)
      const leftSum = leftKeys.reduce((n, k) => n + state.startWidths[k], 0)
      const rightMin = state.rightKeys.length * minColPx
      const maxThis = Math.max(minColPx, state.budget - leftSum - rightMin)
      const nextThis = Math.min(maxThis, Math.max(minColPx, state.startWidths[state.key] + (ev.clientX - state.startX)))
      const remaining = Math.max(rightMin, state.budget - leftSum - nextThis)
      const rightStart = state.rightKeys.reduce((n, k) => n + state.startWidths[k], 0) || 1
      const next = {}
      state.ids.forEach((k) => { next[k] = state.startWidths[k] })
      next[state.key] = nextThis
      state.rightKeys.forEach((k) => {
        next[k] = Math.max(minColPx, Math.round(state.startWidths[k] * (remaining / rightStart)))
      })
      const absorb = state.rightKeys[state.rightKeys.length - 1] || state.key
      next[absorb] = Math.max(minColPx, next[absorb] + (state.budget - state.ids.reduce((n, k) => n + next[k], 0)))
      setUserColWidths(next)
    }
    const onUp = () => {
      resizeStateRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const colWidths = resolvedColWidths
  const rootRef = useRef(null)
  const [pages, setPages] = useState(() => defaultA4Pages(items.length))

  useLayoutEffect(() => {
    const measured = measureA4Blocks(rootRef.current)
    const next = packA4Pages({ rowCount: items.length, ...measured })
    setPages((prev) => (pagesEqual(prev, next) ? prev : next))
    return undefined
  }, [items, columns, companyName, headerText, logoUrl, title, terms, clientName, clientCompany, resolvedId, chosenAccent, profile?.logoWidth, profile?.logoHeight, quote?.notes, quote?.clarifications, quote?.terms, profile?.bankName, profile?.bankAccountNo, profile?.bankIfsc, userColWidths])

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

  const customer = quote?.customer || {}
  const shippingSame = customer.shippingSame !== false
  const subjectField = studio ? (
    <input
      className="meta-guide-draft-input"
      value={quote?.title || quote?.subject || ''}
      placeholder="Quotation subject — describe what this covers"
      aria-label="Subject"
      onChange={(e) => onFieldsChange?.({ title: e.target.value })}
    />
  ) : (
    <p>{title || 'Quotation'}</p>
  )
  const shipSameCheck = studio ? (
    <label className="no-print qg-ship-same-check meta-guide-ship-same" style={{ color: theme.muted }} data-qg-ignore="1">
      <input
        type="checkbox"
        checked={shippingSame}
        onChange={(e) => {
          const same = e.target.checked
          onCustomerChange?.({ shippingSame: same, ...(same ? { shippingLocation: '' } : {}) })
        }}
      />
      Shipping same as billing
    </label>
  ) : null
  const parties = (
    <div className="qg-to-subject-wrap qg-to-subject-wrap--formal" data-qg-block="meta">
      {shippingSame && (studio || title) ? (
        <h3 className="qg-formal-subject" style={{ color: theme.text }}>{subjectField}</h3>
      ) : null}
      <div className="qg-to-subject-section qg-formal-parties">
        <div className="qg-to-col">
          <p className="qg-section-chip" style={{ color: theme.accent }}>Quoted to</p>
          {studio || draftable ? (
            <div className="meta-guide-draft-client">
              {!shippingSame ? <p className="qg-address-sublabel" style={{ color: theme.muted }}>Billing address</p> : null}
              <input className="meta-guide-draft-input" value={customer.company || ''} placeholder="Customer company name" aria-label="Company" onChange={(e) => onCustomerChange?.({ company: e.target.value })} />
              <input className="meta-guide-draft-input" value={customer.name || ''} placeholder="Kind Attn — contact name" aria-label="Contact name" onChange={(e) => onCustomerChange?.({ name: e.target.value })} />
              {!shippingSame ? (
                <AutoGrowAddress
                  value={customer.location || ''}
                  placeholder="Billing address · City · State"
                  aria-label="Billing address"
                  onChange={(v) => onCustomerChange?.({ location: v })}
                />
              ) : null}
              {shipSameCheck}
            </div>
          ) : hasClient ? (
            <>
              {clientCompany ? <p className="font-semibold">{clientCompany}</p> : null}
              {clientName ? <p style={{ color: theme.muted }}>{clientName}</p> : null}
              {!shippingSame && clientLocation ? <p style={{ color: theme.muted, whiteSpace: 'pre-line' }}>{clientLocation}</p> : null}
              {shippingSame && clientGst ? <p style={{ color: theme.muted }}>GST {clientGst}</p> : null}
              {shippingSame && clientLocation ? <p style={{ color: theme.muted, whiteSpace: 'pre-line' }}>{clientLocation}</p> : null}
            </>
          ) : (
            <p style={{ color: theme.muted }}>—</p>
          )}
        </div>
        <div className="qg-subject-col">
          {studio && !shippingSame ? (
            <div className="meta-guide-draft-client">
              <p className="qg-section-chip" style={{ color: theme.accent }}>Ship to</p>
              <p className="qg-address-sublabel" style={{ color: theme.muted }}>Shipping address</p>
              <AutoGrowAddress
                value={customer.shippingLocation || ''}
                placeholder="Shipping address · City · State"
                aria-label="Shipping address"
                onChange={(v) => onCustomerChange?.({ shippingLocation: v, shippingSame: false })}
              />
              <input
                className="meta-guide-draft-input"
                value={customer.gst || ''}
                placeholder="GSTIN / Tax ID"
                aria-label="GSTIN"
                onChange={(e) => onCustomerChange?.({ gst: e.target.value })}
              />
            </div>
          ) : studio || draftable ? (
            <>
              <p className="qg-section-chip" style={{ color: theme.accent }}>Customer details</p>
              <input className="meta-guide-draft-input" value={customer.gst || ''} placeholder="GSTIN / Tax ID" aria-label="GSTIN" onChange={(e) => onCustomerChange?.({ gst: e.target.value })} />
              <AutoGrowAddress
                value={customer.location || ''}
                placeholder="Location · City, State"
                aria-label="Location"
                onChange={(v) => onCustomerChange?.({ location: v })}
              />
            </>
          ) : (
            <>
              <p className="qg-section-chip" style={{ color: theme.accent }}>Subject</p>
              <p>{title || 'Quotation'}</p>
            </>
          )}
        </div>
      </div>
      {studio && !shippingSame ? (
        <div className="qg-subject-below qg-formal-subject-below">
          <p className="qg-section-chip" style={{ color: theme.accent }}>Subject</p>
          {subjectField}
        </div>
      ) : null}
    </div>
  )

  const tableFor = (rowIndexes) => (
    <div className="meta-guide-studio-items">
      {studio ? (
        <div className="meta-guide-table-toolbar no-print" data-qg-ignore="1">
          <div className="meta-guide-table-toolbar-spacer" />
          <div className="relative">
            <button
              type="button"
              className={`meta-guide-table-addcol${tableColOpen ? ' is-on' : ''}`}
              aria-expanded={tableColOpen}
              onClick={() => {
                setTableColOpen((v) => !v)
                onOpenAddColumn?.()
              }}
            >
              <IconPlus /> Add column
            </button>
            {tableColOpen ? (
              <div className="meta-guide-table-addcol-panel">
                {OPTIONAL_PRESETS.map((p) => {
                  const on = columns.some((c) => c.id === p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`meta-guide-chip${on ? ' is-on' : ''}`}
                      onClick={() => {
                        if (on) onRemoveColumn?.(p.id)
                        else onColumnsChange?.([...columns, { id: p.id, label: p.label, type: p.type || 'text' }])
                      }}
                    >
                      {p.label}
                    </button>
                  )
                })}
                {NAMED_AMOUNT_COLUMN_PRESETS.map((p) => {
                  const on = columns.some((c) => c.id === p.id || c.id.startsWith(`${p.id}_`))
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`meta-guide-chip${on ? ' is-on' : ''}`}
                      onClick={() => {
                        if (on) {
                          onColumnsChange?.(columns.filter((c) => c.id !== p.id && !c.id.startsWith(`${p.id}_`)))
                        } else {
                          const col = buildNamedAmountColumn(p, columns)
                          if (col) onColumnsChange?.([...columns, col])
                        }
                      }}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <table
        className={`quote-items-table qg-studio-table text-left meta-guide-studio-table${colWidths.dense ? ' is-dense' : ''}${colWidths.tight ? ' is-tight' : ''}`}
        style={{ tableLayout: 'fixed', width: '100%', maxWidth: '100%', minWidth: 0 }}
      >
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
              <th
                key={col.id}
                draggable={studio && Boolean(onColumnsChange)}
                onDragStart={(e) => {
                  if (e.target.closest?.('[data-resize-handle]') || e.target.closest?.('[data-col-remove]')) {
                    e.preventDefault()
                    return
                  }
                  setDragColId(col.id)
                }}
                onDragOver={(e) => { e.preventDefault(); setDropColId(col.id) }}
                onDragLeave={() => setDropColId((prev) => (prev === col.id ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault()
                  moveStudioColumns(dragColId, col.id)
                  setDragColId(null)
                  setDropColId(null)
                }}
                onDragEnd={() => { setDragColId(null); setDropColId(null) }}
                title={studio ? `${col.label} — drag to move` : col.label}
                className={`meta-guide-th${previewColAlignRight(col, columns) ? ' is-right' : ''}${dragColId === col.id ? ' is-dragging' : ''}${dropColId === col.id && dragColId !== col.id ? ' is-drop' : ''}`}
              >
                <span className="meta-guide-th-inner">
                  <span className="meta-guide-th-label">{isNestedColumn(col) ? `${col.label} %` : col.label}</span>
                  {studio && onRemoveColumn && !lockedColIds.has(col.id) ? (
                    <button
                      type="button"
                      data-col-remove="true"
                      className="meta-guide-col-remove no-print"
                      title={`Remove ${col.label}`}
                      aria-label={`Remove ${col.label}`}
                      onClick={(e) => { e.stopPropagation(); onRemoveColumn(col.id) }}
                    >
                      ×
                    </button>
                  ) : null}
                </span>
                {studio ? (
                  <span
                    data-resize-handle="true"
                    draggable={false}
                    onMouseDown={(e) => beginColumnResize(e, col.id)}
                    onClick={(e) => e.stopPropagation()}
                    title="Drag to resize this column"
                    aria-label={`Resize ${col.label || 'column'}`}
                    className="qg-col-resizer no-print"
                  />
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIndexes.map((index) => {
            const item = items[index]
            return (
              <tr key={index} data-qg-row={index} className="meta-guide-studio-row">
                <td className="qg-cell-compact meta-guide-sr-cell">
                  {studio && onRemoveRow ? (
                    <button
                      type="button"
                      className="meta-guide-row-remove no-print"
                      title="Remove this row"
                      aria-label={`Delete row ${index + 1}`}
                      onClick={() => onRemoveRow(index)}
                    >
                      ×
                    </button>
                  ) : null}
                  <span>{index + 1}</span>
                </td>
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
                      {studio && !isImageColumn(col) && !isAttachmentColumn(col) ? (
                        <input
                          className={`meta-guide-draft-input${isRate || right ? ' is-rate' : ''}`}
                          inputMode={isRate || right ? 'decimal' : 'text'}
                          value={item?.[col.id] ?? ''}
                          placeholder={col.label || '—'}
                          aria-label={`${col.label || 'Cell'} row ${index + 1}`}
                          onChange={(e) => onCellChange?.(index, col.id, e.target.value)}
                        />
                      ) : draftable && isRate ? (
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
    </div>
  )

  const notesLines = Array.isArray(quote?.notes) ? quote.notes : []
  const notes = notesLines.map((n) => String(n || '').trim()).filter(Boolean)
  const clarificationLines = Array.isArray(quote?.clarifications) ? quote.clarifications : []
  const clarifications = clarificationLines.map((n) => String(n || '').trim()).filter(Boolean)
  const commercial = DEMO_COMMERCIAL_KEYS.map((key) => ({
    key,
    val: String(quote?.terms?.[key] || '').trim()
  }))
  const commercialVisible = studio ? commercial : commercial.filter((row) => row.val)
  const bankFields = [
    ['bankName', 'Bank Name', profile?.bankName],
    ['bankAccountName', 'Account Name', profile?.bankAccountName || (studio ? '' : companyName)],
    ['bankAccountNo', 'Account No', profile?.bankAccountNo],
    ['bankIfsc', 'IFSC / SWIFT', profile?.bankIfsc]
  ]
  const bankRows = bankFields
    .map(([key, label, value]) => [key, label, value])
    .filter(([, , value]) => studio || String(value || '').trim())

  const totalsBlock = (
    <TrialBillTotals
      totals={totals}
      bill={bill}
      theme={theme}
      editable={!captureReady && Boolean(onBillChange)}
      onChange={onBillChange}
      extraLines={quote?.extraLines}
      onExtraLinesChange={studio ? onExtraLinesChange : null}
    />
  )

  const closing = (
    <div data-qg-block="closing">
      <div className="qg-paper-body">
        <div className={`qg-closing-stack${(studio || notes.length) ? ' qg-closing-stack--side' : ''}`}>
          <section className="qg-closing-optional">
            <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Standard terms</p>
            {studio ? (
              <textarea
                className="meta-guide-draft-area"
                rows={4}
                value={quote?.fields?.standardTerms ?? profile?.standardTerms ?? ''}
                placeholder="Standard terms for this quotation"
                aria-label="Standard terms"
                onChange={(e) => onFieldsChange?.({ standardTerms: e.target.value })}
              />
            ) : (
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--qg-muted)', whiteSpace: 'pre-line' }}>
                {terms || '—'}
              </p>
            )}
          </section>
          {(studio || notes.length) ? (
            <section className="qg-closing-optional qg-closing-notes">
              <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Notes</p>
              {studio ? (
                <textarea
                  className="meta-guide-draft-area"
                  rows={4}
                  value={notesLines.join('\n')}
                  placeholder="Add notes, one per line"
                  aria-label="Notes"
                  onChange={(e) => onNotesChange?.(e.target.value)}
                />
              ) : (
                <div className="mt-1 text-sm leading-6" style={{ color: 'var(--qg-text)' }}>
                  {notes.map((line, i) => <p key={i}>{line}</p>)}
                </div>
              )}
            </section>
          ) : null}
        </div>
        {(studio || clarifications.length) ? (
          <section className="qg-closing-optional" style={{ marginTop: 14 }}>
            <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Clarifications</p>
            {studio ? (
              <textarea
                className="meta-guide-draft-area"
                rows={3}
                value={clarificationLines.join('\n')}
                placeholder="Clarifications, one per line"
                aria-label="Clarifications"
                onChange={(e) => onClarificationsChange?.(e.target.value)}
              />
            ) : (
              <div className="mt-1 text-sm leading-6" style={{ color: 'var(--qg-muted)' }}>
                {clarifications.map((line, i) => <p key={i}>{line}</p>)}
              </div>
            )}
          </section>
        ) : null}
        {(studio || commercialVisible.length) ? (
          <section style={{ marginTop: 16 }}>
            <p className="qg-section-heading qg-rich-heading" style={{ color: 'var(--qg-accent)' }}>Commercial terms</p>
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {commercialVisible.map((row) => (
                <div key={row.key} className="flex gap-2 border-b border-dashed py-2 text-sm" style={{ borderColor: 'var(--qg-table-border)' }}>
                  <span className="w-28 shrink-0 capitalize" style={{ color: 'var(--qg-muted)' }}>{row.key}</span>
                  {studio ? (
                    <input
                      className="meta-guide-draft-input"
                      value={row.val}
                      placeholder="—"
                      aria-label={`Commercial ${row.key}`}
                      onChange={(e) => onTermsChange?.({ [row.key]: e.target.value })}
                    />
                  ) : (
                    <span>{row.val}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <footer className="mt-8 qg-signatory-block">
          {(studio || bankRows.length || profile?.bankQrUrl) ? (
            <>
              <hr className="qg-section-rule" />
              <section className="mb-8">
                <h3 className="qg-section-heading mb-2 border-b pb-1.5 text-[11px]" style={{ borderColor: 'var(--qg-table-border, #e8edf3)' }}>Bank details</h3>
                {studio && onUploadQr && !profile?.bankQrUrl ? (
                  <button type="button" className="qg-paper-add-btn no-print mb-3" data-qg-ignore="1" onClick={onUploadQr} disabled={qrBusy}>
                    <span aria-hidden="true">+</span>
                    {qrBusy ? 'Adding…' : 'Add QR'}
                  </button>
                ) : null}
                <div className={`qg-bank-block${profile?.bankQrUrl ? ' qg-bank-block--with-qr' : ''}`}>
                  {profile?.bankQrUrl ? (
                    <div className="qg-bank-qr-col">
                      <img src={profile.bankQrUrl} alt="Payment QR" className="qg-bank-qr" />
                      <p className="qg-bank-qr-hint">Scan with any UPI payment app</p>
                      {studio && onUploadQr ? (
                        <button type="button" className="qg-paper-remove no-print" data-qg-ignore="1" onClick={onUploadQr} disabled={qrBusy}>
                          {qrBusy ? 'Uploading…' : 'Replace QR'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="text-sm leading-7 text-slate-700">
                    {studio ? (
                      bankFields.map(([key, label, value]) => (
                        <div key={key} className="meta-guide-bank-edit-row">
                          <span className="meta-guide-bank-edit-label">{label}</span>
                          <input
                            className="meta-guide-draft-input"
                            value={value || ''}
                            placeholder={label}
                            aria-label={label}
                            onChange={(e) => onBankChange?.({ [key]: e.target.value })}
                          />
                        </div>
                      ))
                    ) : (
                      bankRows.map(([, label, value]) => (
                        <p key={label}><span className="text-slate-600">{label}:</span> {value}</p>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </>
          ) : null}
          <hr className="qg-section-rule" />
          <div className="flex justify-end pb-1">
            <div className="w-52 text-center">
              <div className="qg-signatory-slot">
                {profile?.signatoryUrl ? (
                  <img src={profile.signatoryUrl} alt="Authorized signatory" className="meta-guide-signatory-img" />
                ) : studio && onUploadSignatory ? (
                  <button type="button" className="qg-paper-add-btn no-print" data-qg-ignore="1" disabled={signatoryBusy} onClick={onUploadSignatory}>
                    {signatoryBusy ? 'Adding…' : '+ Signature'}
                  </button>
                ) : (
                  <div className="h-14" />
                )}
              </div>
              <div className="pt-2" style={{ borderTop: '1.5px solid var(--qg-muted, #5c6879)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--qg-text)' }}>Authorized Signatory</p>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--qg-muted)' }}>For {companyName}</p>
                {studio && profile?.signatoryUrl && onUploadSignatory ? (
                  <button type="button" className="qg-paper-remove no-print" data-qg-ignore="1" disabled={signatoryBusy} onClick={onUploadSignatory}>
                    Replace signature
                  </button>
                ) : null}
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
                {studio && (onAddRow || onRegenerate) && page.rows.length > 0 && (page.showTotals || pageIndex === pagesToPaint.length - 1) ? (
                  <div className="meta-guide-studio-add-row" data-qg-ignore="1">
                    {onAddRow ? (
                      <button type="button" className="meta-guide-studio-add-row-btn" onClick={onAddRow}>
                        <IconPlus /> Add line item
                      </button>
                    ) : null}
                    {onRegenerate ? (
                      <button
                        type="button"
                        className={`meta-guide-studio-regen-btn${canRegenerate ? ' is-ready' : ''}`}
                        disabled={!canRegenerate || regenBusy}
                        title={canRegenerate ? 'Fill new columns from the same enquiry' : 'Change columns first, then regenerate'}
                        onClick={onRegenerate}
                      >
                        {regenBusy ? 'Regenerating…' : 'Regenerate'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
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

function TrialFormatCarousel({
  quote,
  companyProfile,
  themeId,
  onThemeChange,
  ready,
  onAddLogo,
  logoBusy,
  onReadingChange,
  onLogoSizeChange,
  onRateChange = null,
  onCustomerChange = null,
  onBillChange = null,
  onCellChange = null,
  onAddRow = null,
  onRemoveRow = null,
  onRemoveColumn = null,
  onOpenAddColumn = null,
  onExtraLinesChange = null,
  onFieldsChange = null,
  onTermsChange = null,
  onNotesChange = null,
  onClarificationsChange = null,
  onBankChange = null,
  onColumnsChange = null,
  onUploadQr = null,
  qrBusy = false,
  onUploadSignatory = null,
  signatoryBusy = false,
  onRegenerate = null,
  canRegenerate = false,
  regenBusy = false,
  studioMode = false,
  onDownloadPdf = null,
  downloadBusy = false
}) {
  const scrollerRef = useRef(null)
  const hintingRef = useRef(false)
  const slideScrollTopRef = useRef(0)
  const [hinting, setHinting] = useState(false)
  const [pdfBarVisible, setPdfBarVisible] = useState(false)
  const active = DEMO_PAPER_IDS.includes(themeId) ? themeId : 'formal'
  const activeIndex = Math.max(0, DEMO_PAPER_IDS.indexOf(active))
  const theme = PAPER_THEMES[active] || PAPER_THEMES.formal
  const lastIndex = DEMO_PAPER_IDS.length - 1

  const onSlideScroll = (e) => {
    const top = e.currentTarget.scrollTop || 0
    const prev = slideScrollTopRef.current
    const delta = top - prev
    slideScrollTopRef.current = top
    onReadingChange?.(top > 18)
    if (Math.abs(delta) < 4) return
    if (delta > 0 && top > 24) setPdfBarVisible(true)
    else if (delta < 0) setPdfBarVisible(false)
  }

  useEffect(() => {
    slideScrollTopRef.current = 0
    setPdfBarVisible(false)
  }, [themeId])

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
                  onSlideScroll(e)
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
                      onCellChange={id === active ? onCellChange : null}
                      onAddRow={id === active ? onAddRow : null}
                      onRemoveRow={id === active ? onRemoveRow : null}
                      onRemoveColumn={id === active ? onRemoveColumn : null}
                      onOpenAddColumn={id === active ? onOpenAddColumn : null}
                      onExtraLinesChange={id === active ? onExtraLinesChange : null}
                      onFieldsChange={id === active ? onFieldsChange : null}
                      onTermsChange={id === active ? onTermsChange : null}
                      onNotesChange={id === active ? onNotesChange : null}
                      onClarificationsChange={id === active ? onClarificationsChange : null}
                      onBankChange={id === active ? onBankChange : null}
                      onColumnsChange={id === active ? onColumnsChange : null}
                      onUploadQr={id === active ? onUploadQr : null}
                      qrBusy={qrBusy}
                      onUploadSignatory={id === active ? onUploadSignatory : null}
                      signatoryBusy={signatoryBusy}
                      onRegenerate={id === active ? onRegenerate : null}
                      canRegenerate={canRegenerate}
                      regenBusy={regenBusy}
                      studioMode={studioMode && id === active}
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
        {onDownloadPdf ? (
          <div className={`meta-guide-slide-pdf-bar${pdfBarVisible ? ' is-visible' : ''}`} aria-hidden={!pdfBarVisible}>
            <button
              type="button"
              className="meta-guide-primary meta-guide-pdf-cta"
              disabled={downloadBusy || !pdfBarVisible}
              tabIndex={pdfBarVisible ? 0 : -1}
              onClick={onDownloadPdf}
            >
              Download PDF
            </button>
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
  const [studioOpen, setStudioOpen] = useState(false)
  const [studioColsOpen, setStudioColsOpen] = useState(false)
  const [studioCustomLabel, setStudioCustomLabel] = useState('')
  const [tableTipOpen, setTableTipOpen] = useState(false)
  const [columnsBaseline, setColumnsBaseline] = useState('')
  const [regenBusy, setRegenBusy] = useState(false)
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
  const [qrBusy, setQrBusy] = useState(false)
  const [signatoryBusy, setSignatoryBusy] = useState(false)
  const [logoDragOver, setLogoDragOver] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const [addressOpen, setAddressOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [qrFailed, setQrFailed] = useState(false)
  const [offerStartedAt, setOfferStartedAt] = useState(readOfferStart)
  const [offerNow, setOfferNow] = useState(() => Date.now())
  const [seatsLeft, setSeatsLeft] = useState(() => readSeatsLeft() ?? SEAT_START)
  const [billPeriod, setBillPeriod] = useState('year')
  const offerLeftMs = offerStartedAt ? offerStartedAt + OFFER_MS - offerNow : OFFER_MS
  const offerLive = offerLeftMs > 0
  const storedLead = readMetaAdsLead() || {}
  const liveLead = usefulLead(trialLead) || {}
  const leadForOffer = {
    ...storedLead,
    ...liveLead,
    monthlyQuotes: liveLead.monthlyQuotes || storedLead.monthlyQuotes || ''
  }
  const checkoutOffer = resolveDemoCheckoutOffer(leadForOffer.monthlyQuotes, billPeriod)
  const payPrice = checkoutOffer.amount

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
    const stored = readMetaAdsLead() || {}
    const live = usefulLead(trialLead) || {}
    const lead = {
      ...stored,
      ...live,
      monthlyQuotes: live.monthlyQuotes || stored.monthlyQuotes || ''
    }
    const offer = resolveDemoCheckoutOffer(lead.monthlyQuotes, billPeriod)
    if (offer.kind === 'enterprise') {
      window.location.assign(`tel:${SUPPORT_PHONE_E164}`)
      return
    }
    if (onPreviewPay) {
      onPreviewPay()
      return
    }
    setPayError('')
    setPayBusy(true)
    trackPixel('InitiateCheckout', {
      value: offer.amount,
      currency: 'INR',
      num_items: 1,
      content_name: `QuoteGen ${offer.name} ${offer.period}`
    })
    try {
      const response = await fetch('/api/pay/phonepe/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...offer.payBody,
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
  const qrFileRef = useRef(null)
  const signatoryFileRef = useRef(null)
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

  const patchRevealCell = (rowIndex, colId, value) => {
    let nextItems = null
    setRevealQuote((q) => {
      if (!q) return q
      const cols = Array.isArray(q.columns) && q.columns.length
        ? q.columns
        : CORE_COLUMNS.map(({ locked, ...c }) => c)
      const items = (Array.isArray(q.items) ? q.items : []).map((item, index) => {
        if (index !== rowIndex) return item
        const next = { ...item, [colId]: value }
        Object.assign(next, amountEditPatch(next, cols, colId, value) || {})
        Object.assign(next, formulaEditPatch(next, cols, colId, value) || {})
        return recalcRow(next, cols, { editingKey: colId })
      })
      nextItems = items
      return { ...q, items }
    })
    if (nextItems) onPatchQuote?.({ items: nextItems })
  }

  const addRevealRow = () => {
    let nextItems = null
    setRevealQuote((q) => {
      if (!q) return q
      const cols = Array.isArray(q.columns) && q.columns.length
        ? q.columns
        : CORE_COLUMNS.map(({ locked, ...c }) => c)
      nextItems = [...(Array.isArray(q.items) ? q.items : []), blankRevealItem(cols)]
      return { ...q, items: nextItems }
    })
    if (nextItems) onPatchQuote?.({ items: nextItems })
  }

  const removeRevealRow = (rowIndex) => {
    let nextItems = null
    setRevealQuote((q) => {
      if (!q) return q
      nextItems = (Array.isArray(q.items) ? q.items : []).filter((_, i) => i !== rowIndex)
      if (!nextItems.length) {
        const cols = Array.isArray(q.columns) && q.columns.length ? q.columns : CORE_COLUMNS.map(({ locked, ...c }) => c)
        nextItems = [blankRevealItem(cols)]
      }
      return { ...q, items: nextItems }
    })
    if (nextItems) onPatchQuote?.({ items: nextItems })
  }

  const removeRevealColumn = (colId) => {
    if (CORE_COLUMNS.some((c) => c.id === colId && c.locked)) return
    const cols = studioRevealCols().filter((c) => c.id !== colId)
    patchRevealColumns(cols)
  }

  const patchRevealExtraLines = (extraLines) => {
    setRevealQuote((q) => (q ? { ...q, extraLines } : q))
    onPatchQuote?.({ extraLines })
  }

  const uploadQrFile = async (file) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      setLocalError('Use a PNG, JPG, WebP, GIF, or SVG for the QR.')
      return
    }
    setLocalError('')
    setQrBusy(true)
    const localUrl = URL.createObjectURL(file)
    try {
      const result = await uploadCompanyBankQr(file)
      if (result?.unavailable || !result?.profile) {
        applyGuideProfile({ ...(guideProfileRef.current || {}), bankQrUrl: localUrl })
        return
      }
      applyGuideProfile(result.profile)
    } catch (err) {
      applyGuideProfile({ ...(guideProfileRef.current || {}), bankQrUrl: localUrl })
      setLocalError(err?.message || 'Could not upload QR.')
    } finally {
      setQrBusy(false)
    }
  }

  const uploadSignatoryFile = async (file) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      setLocalError('Use a PNG, JPG, WebP, GIF, or SVG for the signature.')
      return
    }
    setLocalError('')
    setSignatoryBusy(true)
    const localUrl = URL.createObjectURL(file)
    try {
      const result = await uploadCompanySignatory(file)
      if (result?.unavailable || !result?.profile) {
        applyGuideProfile({ ...(guideProfileRef.current || {}), signatoryUrl: localUrl })
        return
      }
      applyGuideProfile(result.profile)
    } catch (err) {
      applyGuideProfile({ ...(guideProfileRef.current || {}), signatoryUrl: localUrl })
      setLocalError(err?.message || 'Could not upload signature.')
    } finally {
      setSignatoryBusy(false)
    }
  }

  const patchRevealColumns = (nextCols) => {
    const cols = Array.isArray(nextCols) && nextCols.length
      ? nextCols
      : CORE_COLUMNS.map(({ locked, ...c }) => c)
    let nextItems = null
    setRevealQuote((q) => {
      if (!q) return q
      nextItems = (Array.isArray(q.items) ? q.items : []).map((item) => {
        const next = { ...item }
        for (const col of cols) {
          if (next[col.id] === undefined) next[col.id] = ''
        }
        return next
      })
      return { ...q, columns: cols, items: nextItems }
    })
    setDraftColumns(cols)
    writePreferredColumns(cols)
    if (nextItems) onPatchQuote?.({ columns: cols, items: nextItems })
    else onPatchQuote?.({ columns: cols })
  }

  const studioRevealCols = () => (
    Array.isArray(revealQuote?.columns) && revealQuote.columns.length
      ? revealQuote.columns
      : draftColumns
  )

  const studioHasOptional = (id) => studioRevealCols().some((c) => c.id === id)
  const studioHasNamedAmount = (presetId) => studioRevealCols().some((c) => c.id === presetId || c.id.startsWith(`${presetId}_`))

  const studioToggleOptional = (preset) => {
    const cols = studioRevealCols()
    if (studioHasOptional(preset.id)) {
      patchRevealColumns(cols.filter((c) => c.id !== preset.id))
    } else {
      patchRevealColumns([...cols, { id: preset.id, label: preset.label, type: preset.type || 'text' }])
    }
  }

  const studioToggleNamedAmount = (preset) => {
    const cols = studioRevealCols()
    if (studioHasNamedAmount(preset.id)) {
      patchRevealColumns(cols.filter((c) => c.id !== preset.id && !c.id.startsWith(`${preset.id}_`)))
    } else {
      const col = buildNamedAmountColumn(preset, cols)
      if (col) patchRevealColumns([...cols, col])
    }
  }

  const studioAddCustom = () => {
    const label = studioCustomLabel.trim()
    if (!label) return
    const id = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}_${Date.now().toString(36).slice(-4)}`
    patchRevealColumns([...studioRevealCols(), { id, label, type: 'text' }])
    setStudioCustomLabel('')
  }

  const canRegenerateReveal = Boolean(revealQuote) && columnsLayoutSig(studioRevealCols()) !== columnsBaseline

  const dismissTableTip = (openAddColumn = false) => {
    try { sessionStorage.setItem('qg_table_tip_seen', '1') } catch { /* private mode */ }
    setTableTipOpen(false)
    if (openAddColumn) setStudioColsOpen(true)
  }

  const patchRevealBill = (nextBill) => {
    const bill = normalizeBillAdjustments(nextBill)
    setRevealQuote((q) => (q ? { ...q, billAdjustments: bill } : q))
    onPatchQuote?.({ billAdjustments: bill })
  }

  const patchRevealFields = (partial) => {
    let nextFields = null
    const title = partial.title != null ? partial.title : null
    setRevealQuote((q) => {
      if (!q) return q
      const { title: _t, ...fieldPartial } = partial
      nextFields = { ...(q.fields || {}), ...fieldPartial }
      const next = { ...q, fields: nextFields }
      if (title != null) {
        next.title = title
        next.subject = title
      }
      return next
    })
    if (partial.standardTerms != null) {
      applyGuideProfile({ ...(guideProfileRef.current || {}), standardTerms: partial.standardTerms })
    }
    const patch = {}
    if (nextFields) patch.fields = nextFields
    if (title != null) {
      patch.title = title
      patch.subject = title
    }
    if (Object.keys(patch).length) onPatchQuote?.(patch)
  }

  const patchRevealTerms = (partial) => {
    let nextTerms = null
    setRevealQuote((q) => {
      if (!q) return q
      nextTerms = { ...(q.terms || {}), ...partial }
      return { ...q, terms: nextTerms }
    })
    if (nextTerms) onPatchQuote?.({ terms: nextTerms })
  }

  const linesFromText = (text) => String(text || '').split('\n').map((l) => l.trimEnd())

  const patchRevealNotes = (text) => {
    const notes = linesFromText(text)
    setRevealQuote((q) => (q ? { ...q, notes } : q))
    onPatchQuote?.({ notes })
  }

  const patchRevealClarifications = (text) => {
    const clarifications = linesFromText(text)
    setRevealQuote((q) => (q ? { ...q, clarifications } : q))
    onPatchQuote?.({ clarifications })
  }

  const patchRevealBank = (partial) => {
    applyGuideProfile({ ...(guideProfileRef.current || {}), ...partial })
  }

  useEffect(() => {
    if (previewReading) setStudioOpen(true)
  }, [previewReading])

  useEffect(() => {
    if (!studioOpen || phase !== 'reveal' || !revealQuote) return undefined
    try {
      if (sessionStorage.getItem('qg_table_tip_seen') === '1') return undefined
    } catch { /* private mode */ }
    const timer = window.setTimeout(() => setTableTipOpen(true), 7000)
    return () => window.clearTimeout(timer)
  }, [studioOpen, phase, revealQuote?.number, revealQuote?.id])

  useEffect(() => {
    if (!tableTipOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') dismissTableTip(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tableTipOpen])

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

  const goToCheckout = () => {
    if (!revealQuote) return
    setLocalError('')
    const visibleId = normalizePaperStyle(visibleCarouselThemeId(paperStyle))
    commitPreferredPaperStyle(visibleId)
    setPhase('convert')
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
    setStudioOpen(false)
    setStudioColsOpen(false)
    setTableTipOpen(false)
    setColumnsBaseline('')
    setRevealQuote(null)
    setPhase('flow')
    setStep(1)
    setEnquiry?.('')
    onTryAnother?.()
  }

  const applyBuiltReveal = (built, { keepStudio = false } = {}) => {
    const lead = usefulLead(trialLead) || readMetaAdsLead()
    const seeded = companySeedFromLead(lead, {
      ...(built?.companyProfile || {}),
      ...(guideProfile || {})
    })
    setRevealQuote({ ...built, companyProfile: seeded.profile })
    setColumnsBaseline(columnsLayoutSig(built?.columns))
    setStudioColsOpen(false)
    if (!keepStudio) {
      setStudioOpen(false)
      setPreviewReading(false)
      setTableTipOpen(false)
    } else {
      setStudioOpen(true)
      setPreviewReading(true)
    }
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
    setStudioOpen(false)
    setStudioColsOpen(false)
    setTableTipOpen(false)
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
      applyBuiltReveal(built)
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

  const regenerateReveal = async () => {
    if (!canRegenerateReveal || regenBusy || atDemoCap) return
    const cols = studioRevealCols()
    if (!cols.length) {
      setLocalError('Keep at least one column.')
      return
    }
    setLocalError('')
    setDraftColumns(cols)
    setRegenBusy(true)
    setPhase('ceremony')
    setRevealReady(false)
    const gen = ++generateGenRef.current
    const started = Date.now()
    try {
      const built = await onGenerate?.(cols)
      if (gen !== generateGenRef.current) return
      const elapsed = Date.now() - started
      if (elapsed < CEREMONY_MIN_MS) await sleep(CEREMONY_MIN_MS - elapsed)
      if (gen !== generateGenRef.current) return
      if (!built) {
        setPhase('reveal')
        setRevealReady(true)
        setLocalError(error || 'Could not regenerate. Try again.')
        return
      }
      applyBuiltReveal(built, { keepStudio: true })
      if (gen !== generateGenRef.current) return
      setPhase('reveal')
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setRevealReady(true))
      })
    } catch (err) {
      if (gen !== generateGenRef.current) return
      setPhase('reveal')
      setRevealReady(true)
      setLocalError(err?.message || 'Could not regenerate. Try again.')
    } finally {
      setRegenBusy(false)
    }
  }

  const backFromReveal = () => {
    setPreviewReading(false)
    setStudioOpen(false)
    setStudioColsOpen(false)
    setTableTipOpen(false)
    setLocalError('')
    setPhase('flow')
    setStep(2)
  }

  if (phase === 'ceremony') {
    return <QuoteGenerateCeremony enquiry={enquiryPreview} columns={draftColumns} />
  }

  if (phase === 'reveal' && revealQuote) {
    return (
      <main className={`meta-guide meta-guide-reveal-page${revealReady ? ' is-ready' : ''}${previewReading || studioOpen ? ' is-reading' : ''}${studioOpen ? ' is-studio' : ''}`}>
        <DemoHowToVideo placement="top-right" appearAfterMs={6000} />
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

          {studioOpen ? (
            <div className="meta-guide-studio-bar" data-qg-ignore="1">
              <button
                type="button"
                className={`meta-guide-studio-chip${studioColsOpen ? ' is-on' : ''}`}
                aria-expanded={studioColsOpen}
                onClick={() => setStudioColsOpen((v) => !v)}
              >
                <IconPlus /> Add column
              </button>
              <button
                type="button"
                className="meta-guide-studio-chip"
                onClick={addRevealRow}
              >
                <IconPlus /> Add line item
              </button>
              <button
                type="button"
                className={`meta-guide-studio-chip is-regen${canRegenerateReveal ? ' is-ready' : ''}`}
                disabled={!canRegenerateReveal || regenBusy || atDemoCap}
                title={canRegenerateReveal ? 'Fill new columns from the same enquiry' : 'Change columns first, then regenerate'}
                onClick={() => { void regenerateReveal() }}
              >
                {regenBusy ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          ) : null}

          {studioOpen && studioColsOpen ? (
            <div className="meta-guide-studio-cols" data-qg-ignore="1">
              <p className="meta-guide-studio-cols-label">Optional columns</p>
              <div className="meta-guide-studio-cols-row">
                {OPTIONAL_PRESETS.map((p) => {
                  const on = studioHasOptional(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`meta-guide-chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => studioToggleOptional(p)}
                    >
                      {p.label}
                    </button>
                  )
                })}
                {NAMED_AMOUNT_COLUMN_PRESETS.map((p) => {
                  const on = studioHasNamedAmount(p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`meta-guide-chip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => studioToggleNamedAmount(p)}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
              <div className="meta-guide-studio-custom">
                <input
                  type="text"
                  value={studioCustomLabel}
                  onChange={(e) => setStudioCustomLabel(e.target.value)}
                  placeholder="Custom column name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      studioAddCustom()
                    }
                  }}
                />
                <button type="button" className="meta-guide-secondary" onClick={studioAddCustom} disabled={!studioCustomLabel.trim()}>
                  Add
                </button>
              </div>
            </div>
          ) : null}

          <div className={`meta-guide-reveal-frame${revealReady ? ' is-expand' : ''}${studioOpen ? ' is-studio' : ''}`}>
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
              onCellChange={studioOpen ? patchRevealCell : null}
              onAddRow={studioOpen ? addRevealRow : null}
              onRemoveRow={studioOpen ? removeRevealRow : null}
              onRemoveColumn={studioOpen ? removeRevealColumn : null}
              onOpenAddColumn={studioOpen ? () => setStudioColsOpen(true) : null}
              onExtraLinesChange={studioOpen ? patchRevealExtraLines : null}
              onFieldsChange={studioOpen ? patchRevealFields : null}
              onTermsChange={studioOpen ? patchRevealTerms : null}
              onNotesChange={studioOpen ? patchRevealNotes : null}
              onClarificationsChange={studioOpen ? patchRevealClarifications : null}
              onBankChange={studioOpen ? patchRevealBank : null}
              onColumnsChange={studioOpen ? patchRevealColumns : null}
              onUploadQr={studioOpen ? () => { if (!qrBusy) qrFileRef.current?.click() } : null}
              qrBusy={qrBusy}
              onUploadSignatory={studioOpen ? () => { if (!signatoryBusy) signatoryFileRef.current?.click() } : null}
              signatoryBusy={signatoryBusy}
              onRegenerate={studioOpen ? () => { void regenerateReveal() } : null}
              canRegenerate={canRegenerateReveal && !atDemoCap}
              regenBusy={regenBusy}
              studioMode={studioOpen}
              onDownloadPdf={goToCheckout}
              downloadBusy={logoBusy}
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
          <input
            ref={qrFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="meta-guide-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) uploadQrFile(file)
            }}
          />
          <input
            ref={signatoryFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="meta-guide-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) uploadSignatoryFile(file)
            }}
          />

          {showError ? <p className="meta-guide-error">{showError}</p> : null}

          <div className="meta-guide-unlock meta-guide-actions meta-guide-unlock--back-only">
            <button type="button" className="meta-guide-ghost" onClick={backFromReveal}>
              ← Back
            </button>
          </div>
        </div>

        {revealQuote ? (
          <div className="meta-guide-pdf-offscreen" aria-hidden="true">
            <TrialThemedExport key={paperStyle} quote={revealQuote} companyProfile={guideProfile} themeId={paperStyle} captureReady />
          </div>
        ) : null}

        {tableTipOpen ? (
          <div
            className="meta-guide-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meta-guide-table-tip-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) dismissTableTip(false)
            }}
          >
            <div className="meta-guide-modal" onMouseDown={(e) => e.stopPropagation()}>
              <p className="meta-guide-modal-kicker">Quick tip</p>
              <h2 id="meta-guide-table-tip-title">Is the table up to your liking?</h2>
              <p className="meta-guide-modal-lead">
                Use <strong>Add column</strong> and <strong>Add line item</strong> above the quotation.
                After you change the layout, tap <strong>Regenerate</strong> to fill those columns from the same enquiry.
              </p>
              <div className="meta-guide-modal-actions">
                <button type="button" className="meta-guide-secondary" onClick={() => dismissTableTip(false)}>
                  Got it
                </button>
                <button type="button" className="meta-guide-primary meta-guide-primary-inline" onClick={() => dismissTableTip(true)}>
                  Add a column
                </button>
              </div>
            </div>
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
    const offer = checkoutOffer
    const isEnterprise = offer.kind === 'enterprise'
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
              Subscribe to <span>download</span>
            </h1>
            <p className="meta-guide-convert-file">Pay once to unlock your PDF and keep creating quotations.</p>
          </div>

          <div className="meta-guide-convert-offer">
            {!isEnterprise ? (
              <div className="meta-guide-period-toggle" role="group" aria-label="Billing period">
                <button
                  type="button"
                  className={`meta-guide-period-btn${billPeriod === 'month' ? ' is-on' : ''}`}
                  aria-pressed={billPeriod === 'month'}
                  onClick={() => setBillPeriod('month')}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={`meta-guide-period-btn${billPeriod === 'year' ? ' is-on' : ''}`}
                  aria-pressed={billPeriod === 'year'}
                  onClick={() => setBillPeriod('year')}
                >
                  Annually
                  {offer.saveAnnual > 0 ? <em>Save ₹{offer.saveAnnual.toLocaleString('en-IN')}</em> : null}
                </button>
              </div>
            ) : null}

            <div className="meta-guide-offer is-live is-stacked" role="region" aria-label="Your package">
              <p className="meta-guide-offer-kicker">
                {isEnterprise ? 'Enterprise' : 'Special price'}
              </p>
              <p className="meta-guide-offer-price">
                {isEnterprise ? (
                  'Custom plan'
                ) : (
                  <>
                    ₹{offer.amount.toLocaleString('en-IN')}
                    <small>{offer.periodSuffix}</small>
                  </>
                )}
              </p>
              <p className="meta-guide-offer-foot">
                {isEnterprise ? (
                  <span className="meta-guide-offer-quotes">{offer.quotesLabel}</span>
                ) : (
                  <>
                    {billPeriod === 'year' && offer.saveAnnual > 0 ? (
                      <em className="meta-guide-offer-save">Save ₹{offer.saveAnnual.toLocaleString('en-IN')}/year</em>
                    ) : null}
                    <span className="meta-guide-offer-quotes">{offer.quotesLabel} · {offer.graceLabel}</span>
                  </>
                )}
              </p>
            </div>

            {!isEnterprise ? (
              <p className="meta-guide-seats" aria-live="polite">
                Only <strong><SeatOdometer value={seatsLeft} /></strong> / {SEAT_CAP} seats left at this price
              </p>
            ) : (
              <p className="meta-guide-seats">
                High volume? We’ll tailor seats, branding, and onboarding for your team.
              </p>
            )}

            <button
              type="button"
              className="meta-guide-primary meta-guide-convert-cta"
              onClick={openPay}
              disabled={payBusy}
            >
              {payBusy ? 'Opening PhonePe…' : offer.cta}
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

        {payOpen && !isEnterprise ? (
          <GuideModal
            className="is-pay"
            title="You’re in"
            onClose={() => setPayOpen(false)}
          >
            <p className="meta-guide-pay-lead">
              Join <strong>{offer.name}</strong> at <strong>₹{offer.amount.toLocaleString('en-IN')}{offer.periodSuffix}</strong>
              {' · '}{offer.quotesLabel} ({offer.graceLabel}).
            </p>
            <div className="meta-guide-pay-card">
              <p className="meta-guide-pay-kicker">Scan QR to pay</p>
              <p className="meta-guide-pay-amount">
                ₹{payPrice.toLocaleString('en-IN')}
                <small> {offer.periodSuffix}</small>
              </p>
              <p className="meta-guide-pay-note">{offer.quotesLabel} · {offer.graceLabel}</p>
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
        <DemoHowToVideo placement="top-right" appearAfterMs={6000} />
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
              onClick={goToCheckout}
            >
              Download PDF
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
