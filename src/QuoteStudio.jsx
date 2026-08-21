import React from 'react'
import { onQuoteAssetImgError } from './pdfExport.js'
import { resolvePaperTheme, PAPER_THEMES, tableColorSwatches } from './quotePaperThemes.js'
import { SuggestField } from './SuggestField.jsx'
import { matchClients } from './suggestCatalog.js'
import { A4_HEIGHT_MM, A4_HEIGHT_PX, A4_WIDTH_MM, A4_WIDTH_PX } from './a4Pagination.js'

function pxToMm(px) {
  return Math.round((Number(px) || A4_WIDTH_PX) * 25.4 / 96)
}

/* ─── Minimal editable inline field ─────────────────────────────────────── */
function formatDdMmYyyy(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function DateField({ value, onChange, placeholder = 'DD/MM/YYYY', right, style }) {
  const ref = React.useRef(null)
  const className = [
    'qg-inline-field',
    right ? 'qg-inline-field--right' : '',
    'qg-inline-field--mono'
  ].filter(Boolean).join(' ')

  const handleChange = (e) => {
    const el = e.target
    const caret = el.selectionStart ?? el.value.length
    const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length
    const formatted = formatDdMmYyyy(el.value)
    onChange(formatted)
    requestAnimationFrame(() => {
      const input = ref.current
      if (!input) return
      let seen = 0
      let pos = formatted.length
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) seen++
        if (seen >= digitsBefore) {
          pos = i + 1
          break
        }
      }
      if (digitsBefore === 0) pos = 0
      input.setSelectionRange(pos, pos)
    })
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={10}
      value={value || ''}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
      style={style}
      aria-label="Valid till date"
    />
  )
}

function InlineField({ value, onChange, onBlur, placeholder, bold, large, right, mono, multiline, style }) {
  const base = [
    'qg-inline-field',
    bold ? 'qg-inline-field--bold' : '',
    large ? 'qg-inline-field--large' : '',
    right ? 'qg-inline-field--right' : '',
    mono ? 'qg-inline-field--mono' : '',
  ].filter(Boolean).join(' ')

  if (multiline) {
    return (
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onBlur?.(e.target.value)}
        placeholder={placeholder || ''}
        rows={2}
        className={base}
        style={style}
      />
    )
  }
  return (
    <input
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      onBlur={e => onBlur?.(e.target.value)}
      placeholder={placeholder || ''}
      className={base}
      style={style}
    />
  )
}

/* ─── Company letterhead block (text + logo, no header image) ────────────── */
function CompanyLetterheadBlock({ profile, theme }) {
  const name = profile?.companyName?.trim() || 'Your Company Name'
  const headerText = profile?.headerText?.trim() || ''
  const logoUrl = profile?.logoUrl
  const width = Math.max(36, Math.min(120, Number(profile?.logoWidth) || 64))
  const height = profile?.logoHeight != null
    ? Math.max(36, Math.min(120, Number(profile.logoHeight) || 64))
    : null
  const initial = name.charAt(0).toUpperCase() || 'Q'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {/* Logo — fixed width, center-aligned with text block */}
      <div style={{ flexShrink: 0, width }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${name} logo`}
            onError={onQuoteAssetImgError}
            style={{ width: '100%', height: height || 'auto', maxHeight: height || 80, objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: Math.min(width, 56),
              height: Math.min(height || width, 56),
              background: theme.accent,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: Math.min(width, 56) * 0.40,
            }}
          >
            {initial}
          </div>
        )}
      </div>
      {/* Text block */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: '1.26em', lineHeight: 1.25, color: theme.accent }}>
          {name}
        </p>
        {headerText ? (
          <p style={{ margin: '4px 0 0', fontSize: '0.8em', lineHeight: 1.5, color: theme.muted, whiteSpace: 'pre-line' }}>
            {headerText}
          </p>
        ) : (
          <p style={{ margin: '4px 0 0', fontSize: '0.8em', color: theme.muted }}>
            Your address · City, State · PIN
          </p>
        )}
      </div>
    </div>
  )
}

/* ─── Meta pill row: No. / Date / Valid till ─────────────────────────────── */
function MetaRow({ label, children, theme }) {
  return (
    <div className="qg-meta-row" style={{ borderColor: theme.tableBorder }}>
      <span className="qg-meta-label" style={{ color: theme.accent }}>{label}</span>
      <span className="qg-meta-value" style={{ color: theme.text }}>{children}</span>
    </div>
  )
}

/* ─── Paper header — handles BOTH cases cleanly ─────────────────────────── */
export function QuotePaperHeader({ theme, profile, quote, update, docLabel, isInvoice, onNumberCommit }) {
  const fields = quote?.fields || {}
  const validUntil = fields.validUntil || quote.validUntil || ''
  const hasHeaderImage = Boolean(profile?.headerImageUrl)
  const numberField = (
    <InlineField
      value={quote.number || ''}
      onChange={v => update(['number'], v)}
      onBlur={v => onNumberCommit?.(v)}
      right
      mono
      placeholder="QG-XXXX"
    />
  )

  /* When a header image is uploaded it spans the full paper width at the top.
     The QUOTATION title + meta block then sits INSIDE the paper, below the image,
     as a clean horizontal strip — never floating outside the paper boundary. */
  if (hasHeaderImage) {
    return (
      <header>
        {/* Full-width header image — no padding, bleeds to edges */}
        <div className="qg-header-image-wrap">
          <img
            src={profile.headerImageUrl}
            alt={`${profile?.companyName || 'Company'} header`}
            className="qg-header-image"
            onError={onQuoteAssetImgError}
          />
        </div>
        {/* Title + meta strip beneath the image, inside the paper */}
        <div className="qg-doc-meta-strip" style={{ borderColor: theme.tableBorder, background: theme.metaBarBg }}>
          <p className="qg-doc-title" style={{ color: theme.accent, fontFamily: theme.titleFont }}>{docLabel}</p>
          <div className="qg-meta-table">
            <MetaRow label="No." theme={theme}>
              {numberField}
            </MetaRow>
            <MetaRow label="Date" theme={theme}>
              <InlineField value={quote.date || ''} onChange={v => update(['date'], v)} right placeholder="DD MMM YYYY" />
            </MetaRow>
            <MetaRow label="Valid till" theme={theme}>
              <DateField
                value={validUntil}
                onChange={v => update(['fields'], { ...fields, validUntil: v })}
                right
                placeholder="DD/MM/YYYY"
              />
            </MetaRow>
          </div>
        </div>
      </header>
    )
  }

  /* No header image — classic two-column letterhead layout */
  return (
    <header className="qg-paper-header" style={{ borderBottomColor: theme.tableBorder }}>
      <div className="qg-header-two-col">
        <CompanyLetterheadBlock profile={profile} theme={theme} />
        <div className="qg-header-right">
          <p className="qg-doc-title" style={{ color: theme.accent, fontFamily: theme.titleFont }}>{docLabel}</p>
          <div className="qg-meta-table qg-meta-table--right" style={{ marginTop: 12 }}>
            <MetaRow label="No." theme={theme}>
              {numberField}
            </MetaRow>
            <MetaRow label="Date" theme={theme}>
              <InlineField value={quote.date || ''} onChange={v => update(['date'], v)} right placeholder="DD MMM YYYY" />
            </MetaRow>
            <MetaRow label="Valid till" theme={theme}>
              <DateField
                value={validUntil}
                onChange={v => update(['fields'], { ...fields, validUntil: v })}
                right
                placeholder="DD/MM/YYYY"
              />
            </MetaRow>
          </div>
        </div>
      </div>
    </header>
  )
}

/* ─── TO / SUBJECT section ───────────────────────────────────────────────── */
export function QuoteToSubjectBlock({ theme, quote, update, gstMissing, gstFieldRef, isInvoice, onGstChange, clients, onPickClient }) {
  const customer = quote.customer || {}
  const clientItems = (field) => matchClients(clients, customer[field], field).map(c => ({
    id: `${c.company}|${c.gst}|${c.name}`,
    title: c.company || c.name || c.gst,
    meta: [c.name && c.company ? c.name : '', c.gst, c.location].filter(Boolean).join(' · '),
    client: c
  }))

  return (
    <div className="qg-to-subject-section" style={{ borderBottomColor: theme.tableBorder }}>
      {/* TO block */}
      <div className="qg-to-col">
        <p className="qg-section-chip" style={{ color: theme.accent }}>TO</p>
        <SuggestField
          value={customer.company || ''}
          onChange={v => update(['customer', 'company'], v)}
          onPick={item => onPickClient?.(item.client)}
          suggestions={clientItems('company')}
          placeholder="Customer company name"
          bold
          large
          style={{ color: theme.text }}
        />
        <SuggestField
          value={customer.name || ''}
          onChange={v => update(['customer', 'name'], v)}
          onPick={item => onPickClient?.(item.client)}
          suggestions={clientItems('name')}
          placeholder="Kind Attn — contact name"
          style={{ color: theme.muted, marginTop: 4 }}
        />
        <SuggestField
          value={customer.location || ''}
          onChange={v => update(['customer', 'location'], v)}
          onPick={item => onPickClient?.(item.client)}
          suggestions={clientItems('location')}
          placeholder="Address · City · State"
          style={{ color: theme.muted, marginTop: 4 }}
        />
        <div style={gstMissing ? { marginTop: 4, outline: '2px solid #f87171', borderRadius: 6 } : { marginTop: 4 }}>
          <SuggestField
            inputRef={gstFieldRef}
            value={customer.gst || ''}
            onChange={v => { onGstChange?.(); update(['customer', 'gst'], v) }}
            onPick={item => onPickClient?.(item.client)}
            suggestions={clientItems('gst')}
            placeholder={isInvoice ? 'GSTIN (required)' : 'GSTIN / Tax ID'}
            style={{ color: theme.muted }}
          />
        </div>
      </div>

      {/* Vertical divider */}
      <div className="qg-col-divider" style={{ background: theme.tableBorder }} />

      {/* SUBJECT block */}
      <div className="qg-subject-col">
        <p className="qg-section-chip" style={{ color: theme.accent }}>SUBJECT</p>
        <InlineField
          value={quote.title || ''}
          onChange={v => update(['title'], v)}
          placeholder="Quotation subject — describe what this covers"
          bold
          large
          style={{ color: theme.text }}
        />
      </div>
    </div>
  )
}

function SheetRunHeader({ left, right }) {
  return (
    <div className="qg-sheet-run-header no-print">
      <strong>{left || ''}</strong>
      <span>{right || ''}</span>
    </div>
  )
}

function SheetRunFooter({ left, right, page, pageCount }) {
  return (
    <div className="qg-sheet-run-footer no-print">
      <span>{left || ''}</span>
      <span>
        {right || ''}
        {right ? ' · ' : ''}
        Page {page} of {pageCount}
      </span>
    </div>
  )
}

/* ─── Studio canvas wrapper ──────────────────────────────────────────────── */
export function QuoteStudioCanvas({
  themeId,
  tableAccent,
  children,
  fontSizePx,
  paperWidthPx = 840,
  runningHeader,
  runningFooter,
  lockA4 = false
}) {
  const theme = resolvePaperTheme(themeId, tableAccent)
  const pages = React.Children.toArray(children).filter(Boolean)
  const pageCount = Math.max(1, pages.length)
  const width = lockA4
    ? A4_WIDTH_PX
    : Math.max(840, Math.round(Number(paperWidthPx) || 840))
  const pageWidthMm = lockA4 ? A4_WIDTH_MM : pxToMm(width)
  const pageHeightMm = A4_HEIGHT_MM
  /* Named size only — never add the `landscape` keyword. Chrome's print
     path treats that keyword as "rotate the sheet", which is what made
     quotation PDFs come out on their side. `page-orientation: upright`
     stops Linux Chromium from applying the same rotation when the sheet
     is wider than it is tall. */
  const pageSize = `${pageWidthMm}mm ${pageHeightMm}mm`
  const themeTokens = {
    '--qg-accent': theme.accent,
    '--qg-accent-soft': theme.accentSoft,
    '--qg-muted': theme.muted,
    '--qg-table-head-bg': theme.tableHeadBg,
    '--qg-table-head-text': theme.tableHeadText,
    '--qg-table-stripe': theme.tableStripeBg,
    '--qg-table-border': theme.tableBorder,
    '--qg-table-accent': theme.tableAccent || theme.tableHeadText,
    '--qg-drop-border': theme.dropBorder,
    '--qg-drop-bg': theme.dropBg,
    '--qg-text': theme.text
  }
  const paperVars = {
    background: theme.paperBg,
    color: theme.text,
    fontFamily: theme.fontFamily,
    fontSize: `${fontSizePx}px`,
    minHeight: A4_HEIGHT_PX,
    ...(lockA4 ? {
      width,
      height: A4_HEIGHT_PX,
      maxHeight: A4_HEIGHT_PX
    } : {}),
    ...themeTokens
  }

  return (
    <div className="qg-studio-canvas" style={{ background: theme.pageBg, '--qg-paper-width': `${width}px`, ...themeTokens }}>
      <style>{`@page { size: ${pageSize}; margin: 0; page-orientation: upright; }
@page qg-studio { size: ${pageSize}; margin: 0; page-orientation: upright; }
@media print {
  @page { size: ${pageSize}; margin: 0; page-orientation: upright; }
  @page qg-studio { size: ${pageSize}; margin: 0; page-orientation: upright; }
}`}</style>
      <div className="qg-print-run-header">
        <span>{runningHeader?.left || ''}</span>
        <span>{runningHeader?.right || ''}</span>
      </div>
      <div className="qg-print-run-footer">
        <span>{runningFooter?.left || ''}</span>
        <span>{runningFooter?.right || ''}{runningFooter?.right ? ' · ' : ''}Page <span className="qg-print-page-num" /></span>
      </div>
      <div className="qg-studio-paper-frame" style={{ width }}>
        {pages.map((page, i) => (
          <article
            key={i}
            className={`qg-studio-paper quote-paper ${i === 0 ? 'qg-studio-paper--first' : 'qg-studio-paper--continued'}`}
            style={paperVars}
            aria-label={`Page ${i + 1} of ${pageCount}`}
          >
            {i > 0 ? (
              <SheetRunHeader left={runningHeader?.left} right={runningHeader?.right} />
            ) : null}
            <div className="qg-paper-plate">
              {page}
            </div>
            <SheetRunFooter
              left={runningFooter?.left}
              right={runningFooter?.right}
              page={i + 1}
              pageCount={pageCount}
            />
          </article>
        ))}
      </div>
    </div>
  )
}

/* ─── Studio toolbar ─────────────────────────────────────────────────────── */
export function ExportMenu({ onExport, busy, label = 'Export', variant = 'primary' }) {
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef(null)

  React.useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const formats = [
    { id: 'pdf', name: 'PDF', hint: 'A4 pages — same layout as the preview' },
    { id: 'word', name: 'Word', hint: '.doc — A4, same layout as the preview' },
    { id: 'excel', name: 'Excel', hint: '.xlsx — A4, same layout as the preview' }
  ]

  const buttonClass = variant === 'footer'
    ? 'qg-ready-export-btn'
    : variant === 'header'
      ? 'rounded-lg bg-[#1A73E8] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1558b0] disabled:opacity-60'
      : 'rounded-xl bg-[#1A73E8] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1558b0] disabled:opacity-60'
  return (
    <div className="qg-export" ref={wrapRef}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(o => !o)}
        className={buttonClass}
      >
        {busy ? 'Preparing…' : `${label} ▾`}
      </button>
      {open ? (
        <div className="qg-export-list no-print" role="menu">
          {formats.map(f => (
            <button
              key={f.id}
              type="button"
              role="menuitem"
              className="qg-export-item"
              onClick={() => { setOpen(false); onExport?.(f.id) }}
            >
              <span className="qg-export-item-name">{f.name}</span>
              <span className="qg-export-item-hint">{f.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const FONT_SIZE_MIN = 11
const FONT_SIZE_MAX = 18

function clampFontSize(value, fallback) {
  const n = parseInt(String(value).trim(), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, n))
}

export function QuoteStudioToolbar({
  paperStyle, onPaperStyleChange,
  paperFontPx, onFontChange,
  tableColorId, logoPalette, logoUrl, logoColorBusy,
  onTableColorChange, onDetectFromLogo,
  saveFlash, saveStatusLabel,
  onSaveFlash,
  onExport, pdfBusy
}) {
  const swatches = tableColorSwatches(logoPalette)
  const [fontDraft, setFontDraft] = React.useState(String(paperFontPx))
  React.useEffect(() => { setFontDraft(String(paperFontPx)) }, [paperFontPx])

  const commitFontSize = (raw) => {
    const next = clampFontSize(raw, paperFontPx)
    onFontChange(next)
    setFontDraft(String(next))
  }
  return (
    <div className="qg-studio-toolbar no-print">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Live preview</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{saveFlash || saveStatusLabel}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {Object.values(PAPER_THEMES).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPaperStyleChange(t.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${paperStyle === t.id ? 'bg-[#1A73E8] text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="qg-table-theme">
          <span className="qg-table-theme-label">Colour</span>
          <div className="qg-table-theme-swatches">
            {swatches.map(s => (
              <button
                key={s.id}
                type="button"
                title={s.label}
                aria-label={`${s.label} table colour`}
                aria-pressed={tableColorId === s.id}
                onClick={() => onTableColorChange(s.id)}
                className={`qg-table-swatch ${tableColorId === s.id ? 'qg-table-swatch--on' : ''}`}
                style={{ background: s.hex }}
              />
            ))}
            {logoUrl ? (
              <button
                type="button"
                onClick={onDetectFromLogo}
                disabled={logoColorBusy}
                className="qg-table-theme-from-logo"
              >
                {logoColorBusy ? 'Reading…' : 'From logo'}
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>Font</span>
          <input
            type="number"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontDraft}
            onChange={e => {
              const raw = e.target.value
              setFontDraft(raw)
              if (raw === '') return
              const n = Number(raw)
              if (Number.isFinite(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX) onFontChange(n)
            }}
            onBlur={() => commitFontSize(fontDraft)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className="w-12 rounded-lg border border-slate-200 px-2 py-1 text-center text-xs outline-none focus:border-[#1A73E8]"
            aria-label="Paper font size"
          />
          <span>px</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSaveFlash}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Save
        </button>
        <ExportMenu onExport={onExport} busy={pdfBusy} label="Export" variant="header" />
      </div>
    </div>
  )
}

/* ─── Footer bar (Ready to export) ──────────────────────────────────────── */
export function QuoteStudioFooterBar({ onExport, pdfBusy, onHome }) {
  const [visible, setVisible] = React.useState(false)
  const lastY = React.useRef(typeof window !== 'undefined' ? window.scrollY : 0)

  React.useEffect(() => {
    const show = () => setVisible(true)
    const hideIfTop = (y) => {
      if (y <= 8) setVisible(false)
    }
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0
      if (y > lastY.current + 1) show()
      hideIfTop(y)
      lastY.current = y
    }
    const onWheel = (e) => {
      if (e.deltaY > 4) show()
    }
    lastY.current = window.scrollY || 0
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', onWheel)
      document.body.classList.remove('qg-export-dock-on')
    }
  }, [])

  React.useEffect(() => {
    document.body.classList.toggle('qg-export-dock-on', visible)
    return () => document.body.classList.remove('qg-export-dock-on')
  }, [visible])

  return (
    <>
      <div className="qg-studio-footer-slot no-print" aria-hidden="true" />
      <div className={`qg-studio-footer no-print ${visible ? 'qg-studio-footer--show' : ''}`}>
        <button type="button" onClick={onHome} className="text-sm font-medium text-slate-500 hover:text-slate-700">
          ← Back to home
        </button>
        <ExportMenu onExport={onExport} busy={pdfBusy} label="Ready to export" variant="footer" />
      </div>
    </>
  )
}

/* ─── Layout picker cards (Step 1) ──────────────────────────────────────── */
export function LayoutStyleCards({ value, onChange, uploadTemplates, selectedTemplateId, onSelectTemplate }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Built-in themes — big visual cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {Object.values(PAPER_THEMES).map(t => {
          const active = !selectedTemplateId && value === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => { onChange(t.id); onSelectTemplate('') }}
              style={{
                border: `2px solid ${active ? '#1A73E8' : '#e2e8f0'}`,
                borderRadius: 16,
                background: active ? '#f0f5ff' : '#fff',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
                overflow: 'hidden',
                boxShadow: active ? '0 0 0 3px rgba(26,115,232,0.15)' : '0 1px 4px rgba(0,0,0,0.06)',
                transition: 'all .15s',
              }}
            >
              {/* Paper preview thumbnail */}
              <div style={{ background: t.pageBg, padding: '10px 10px 6px', borderBottom: `1px solid ${t.tableBorder}` }}>
                <div style={{ background: t.paperBg, borderRadius: 6, overflow: 'hidden', height: 90, position: 'relative', boxShadow: '0 1px 6px rgba(0,0,0,0.10)' }}>
                  {/* Header bar */}
                  <div style={{ background: t.tableHeadBg, height: 18, borderBottom: `1px solid ${t.tableBorder}` }} />
                  {/* Fake letterhead line */}
                  <div style={{ margin: '7px 8px 0', height: 4, borderRadius: 3, background: t.accent, width: '55%', opacity: 0.7 }} />
                  <div style={{ margin: '4px 8px 0', height: 2.5, borderRadius: 3, background: t.tableBorder, width: '40%' }} />
                  {/* Fake table rows */}
                  <div style={{ margin: '8px 8px 0', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {[0.9, 0.7, 0.8, 0.65].map((w, i) => (
                      <div key={i} style={{ height: 2, borderRadius: 2, background: t.tableBorder, width: `${w * 100}%`, opacity: 0.8 }} />
                    ))}
                  </div>
                  {/* Total line accent */}
                  <div style={{ position: 'absolute', bottom: 8, right: 8, height: 3, borderRadius: 2, background: t.accent, width: 32, opacity: 0.6 }} />
                </div>
              </div>
              <div style={{ padding: '10px 12px 12px' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: '#1a202c' }}>{t.label}</div>
                <div style={{ fontSize: 11.5, color: '#718096', marginTop: 3, lineHeight: 1.4 }}>{t.hint}</div>
              </div>
            </button>
          )
        })}

        {/* Uploaded template cards */}
        {(uploadTemplates || []).map(tpl => {
          const active = selectedTemplateId === tpl.id
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onSelectTemplate(tpl.id)}
              style={{
                border: `2px solid ${active ? '#1A73E8' : '#e2e8f0'}`,
                borderRadius: 16,
                background: active ? '#f0f5ff' : '#fff',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
                overflow: 'hidden',
                boxShadow: active ? '0 0 0 3px rgba(26,115,232,0.15)' : '0 1px 4px rgba(0,0,0,0.06)',
                transition: 'all .15s',
              }}
            >
              {/* Generic uploaded doc thumbnail */}
              <div style={{ background: '#f8fafc', padding: '10px 10px 6px', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ background: '#fff', borderRadius: 6, height: 90, position: 'relative', boxShadow: '0 1px 6px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  {/* Doc icon */}
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={active ? '#1A73E8' : '#94a3b8'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="8" y1="13" x2="16" y2="13"/>
                    <line x1="8" y1="17" x2="12" y2="17"/>
                  </svg>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.05em' }}>
                    {tpl.type?.toUpperCase() || 'DOC'}
                  </div>
                </div>
              </div>
              <div style={{ padding: '10px 12px 12px' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#1a202c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tpl.name}</div>
                <div style={{ fontSize: 11.5, color: '#718096', marginTop: 3 }}>Your custom layout</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
