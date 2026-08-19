import React from 'react'

const DEFAULT_TERMS = {
  validity: '15 days',
  delivery: 'To be confirmed',
  payment: 'To be confirmed',
  taxes: 'Extra as applicable',
  freight: 'To be confirmed'
}

export function resolveLayout(template) {
  const layout = template?.layout || {}
  const visual = layout.visual || layout
  return {
    lookFamily: visual.lookFamily || layout.lookFamily || 'classic-print',
    pageBg: visual.pageBg || layout.pageBg || '#edf1ed',
    paperBg: visual.paperBg || layout.paperBg || '#ffffff',
    textColor: visual.textColor || layout.textColor || '#17231f',
    mutedColor: visual.mutedColor || layout.mutedColor || '#64748b',
    accent: visual.accent || layout.accent || '#1D63ED',
    accentSoft: visual.accentSoft || layout.accentSoft || '#eef6f3',
    fontFamily: visual.fontFamily || layout.fontFamily || 'Inter, ui-sans-serif, system-ui, sans-serif',
    titleLabel: layout.titleLabel || 'QUOTATION',
    showSrNo: layout.showSrNo !== false,
    quotedToTitle: layout.quotedToTitle || 'Quoted to',
    customerDetailsTitle: layout.customerDetailsTitle || 'Customer details',
    notesTitle: layout.notesTitle || 'Notes',
    clarificationsTitle: layout.clarificationsTitle || 'Clarifications required',
    termsTitle: layout.termsTitle || 'Commercial terms',
    header: {
      variant: visual.header?.variant || (layout.headerStyle === 'banner' ? 'banner' : layout.headerStyle === 'compact' ? 'letterhead' : 'split'),
      bg: visual.header?.bg || '#ffffff',
      textColor: visual.header?.textColor || '#17231f',
      borderBottom: visual.header?.borderBottom || `2px solid ${visual.accent || layout.accent || '#1D63ED'}`,
      showLogoMark: visual.header?.showLogoMark !== false,
      titleAlign: visual.header?.titleAlign || 'right'
    },
    customer: {
      variant: visual.customer?.variant || 'two-column-soft',
      bg: visual.customer?.bg || '#f7f9f7',
      border: visual.customer?.border || 'none',
      radius: visual.customer?.radius || '12px'
    },
    table: {
      variant: visual.table?.variant || 'horizontal',
      headerBg: visual.table?.headerBg || '#f7f9f7',
      headerColor: visual.table?.headerColor || '#64748b',
      headerUppercase: visual.table?.headerUppercase !== false,
      borderColor: visual.table?.borderColor || '#e8ede8',
      density: visual.table?.density || layout.tableDensity || 'comfortable'
    },
    totals: {
      variant: visual.totals?.variant || 'right-simple',
      show: visual.totals?.show !== false && layout.showTotal !== false
    },
    notes: {
      variant: visual.notes?.variant || 'two-col',
      show: visual.notes?.show !== false && layout.showNotes !== false,
      showClarifications: visual.notes?.showClarifications !== false && layout.showClarifications !== false
    },
    terms: {
      variant: visual.terms?.variant || 'dashed-rows',
      show: visual.terms?.show !== false && layout.showTerms !== false
    },
    signatory: {
      align: visual.signatory?.align || 'right',
      show: visual.signatory?.show !== false,
      label: visual.signatory?.label || layout.footerSignatory || 'Authorized Signatory'
    }
  }
}

function familyTweaks(lookFamily, L) {
  // Ensure families diverge even if AI misses some fields
  if (lookFamily === 'excel-grid') {
    return {
      ...L,
      fontFamily: L.fontFamily.includes('Arial') || L.fontFamily.includes('Calibri') ? L.fontFamily : 'Arial, Helvetica, sans-serif',
      table: { ...L.table, variant: L.table.variant === 'horizontal' ? 'full-grid' : L.table.variant, density: 'compact' },
      customer: { ...L.customer, variant: L.customer.variant === 'two-column-soft' ? 'boxed-grid' : L.customer.variant, radius: '0px' },
      header: { ...L.header, showLogoMark: false, variant: L.header.variant === 'banner' ? 'topbar' : L.header.variant }
    }
  }
  if (lookFamily === 'letterhead') {
    return {
      ...L,
      fontFamily: /Georgia|Times|serif/i.test(L.fontFamily) ? L.fontFamily : 'Georgia, "Times New Roman", serif',
      header: { ...L.header, variant: 'letterhead', showLogoMark: true },
      customer: { ...L.customer, variant: 'underline' },
      table: { ...L.table, variant: 'horizontal' }
    }
  }
  if (lookFamily === 'modern-card') {
    return {
      ...L,
      customer: { ...L.customer, variant: 'single-card', radius: '16px' },
      table: { ...L.table, variant: 'open' },
      totals: { ...L.totals, variant: 'right-box' },
      header: { ...L.header, variant: 'split' }
    }
  }
  if (lookFamily === 'dense-industrial') {
    return {
      ...L,
      table: { ...L.table, variant: 'full-grid', density: 'compact' },
      notes: { ...L.notes, variant: 'stacked' },
      terms: { ...L.terms, variant: 'compact-grid' },
      header: { ...L.header, variant: 'topbar' }
    }
  }
  if (lookFamily === 'centered-formal') {
    return {
      ...L,
      header: { ...L.header, variant: 'centered', titleAlign: 'center' },
      customer: { ...L.customer, variant: 'plain-lines' },
      terms: { ...L.terms, variant: 'boxed-list' }
    }
  }
  return L
}

/**
 * Full quotation paper renderer driven by template visual layout.
 * editable=false for mini previews in the template editor.
 */
export function QuotePaper({
  template,
  quote,
  columns,
  total = 0,
  update,
  updateItem,
  updateList,
  addItem,
  removeItem,
  DescriptionCell,
  Input,
  editable = true,
  compact = false
}) {
  const company = template?.company || {
    name: 'Your Company Name',
    address: 'Your address · City, State · PIN',
    phone: '+91 00000 00000',
    email: 'sales@yourcompany.com'
  }
  let L = familyTweaks(resolveLayout(template).lookFamily, resolveLayout(template))
  const pad = compact ? 'p-4' : (L.table.density === 'compact' ? 'p-4 sm:p-6' : 'p-6 sm:p-10')
  const cellPad = L.table.density === 'compact' ? 'px-2 py-1.5' : 'p-3'
  const hasAmount = columns.some(c => c.id === 'amount')
  const termsMap = { ...DEFAULT_TERMS, ...(template?.defaultTerms || {}), ...(quote?.terms || {}) }
  const items = quote?.items?.length ? quote.items : [{ description: 'Sample line item', quantity: '10', unit: 'Nos', rate: '', amount: '' }]
  const safeItems = items.map(item => {
    const row = { ...item }
    for (const col of columns) if (row[col.id] == null) row[col.id] = col.id === 'description' ? 'Sample product' : '—'
    return row
  })

  const tableBorder = L.table.variant === 'full-grid'
    ? { borderCollapse: 'collapse' }
    : {}
  const cellBorder = L.table.variant === 'full-grid'
    ? { border: `1px solid ${L.table.borderColor}` }
    : L.table.variant === 'open'
      ? { borderBottom: 'none' }
      : { borderBottom: `1px solid ${L.table.borderColor}` }

  const renderHeader = () => {
    const v = L.header.variant
    const titleBlock = (
      <div style={{ textAlign: L.header.titleAlign === 'left' ? 'left' : L.header.titleAlign === 'center' ? 'center' : 'right' }}>
        <p className={`${compact ? 'text-lg' : 'text-2xl'} font-semibold tracking-tight`} style={{ color: v === 'banner' || v === 'topbar' ? '#fff' : L.accent }}>
          {L.titleLabel}
        </p>
        <p className="mt-1 text-sm" style={{ color: v === 'banner' || v === 'topbar' ? 'rgba(255,255,255,0.85)' : L.mutedColor }}>
          {quote?.number || 'QG-XXXX'} &nbsp;|&nbsp; {quote?.date || 'Date'}
        </p>
      </div>
    )
    const companyBlock = (
      <div className="flex gap-3">
        {L.header.showLogoMark && (
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold"
            style={{
              backgroundColor: v === 'banner' || v === 'topbar' ? 'rgba(255,255,255,0.2)' : L.accent,
              color: '#fff'
            }}
          >
            {(company.name || 'Q').trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h2 className={`${compact ? 'text-base' : 'text-lg'} font-semibold`} style={{ color: v === 'banner' || v === 'topbar' ? '#fff' : L.textColor }}>
            {company.name}
          </h2>
          <p className="mt-1 text-sm" style={{ color: v === 'banner' || v === 'topbar' ? 'rgba(255,255,255,0.8)' : L.mutedColor }}>{company.address}</p>
          <p className="text-sm" style={{ color: v === 'banner' || v === 'topbar' ? 'rgba(255,255,255,0.8)' : L.mutedColor }}>
            {[company.phone, company.email].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
    )

    if (v === 'centered') {
      return (
        <header className={pad} style={{ background: L.header.bg, borderBottom: L.header.borderBottom, textAlign: 'center' }}>
          <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
            {companyBlock}
            {titleBlock}
          </div>
        </header>
      )
    }
    if (v === 'banner' || v === 'topbar') {
      return (
        <header className={pad} style={{ background: L.accent, color: '#fff' }}>
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            {companyBlock}
            {titleBlock}
          </div>
        </header>
      )
    }
    if (v === 'letterhead') {
      return (
        <header className={pad} style={{ background: L.header.bg, borderBottom: L.header.borderBottom }}>
          <div className="mb-4 text-center">
            <h2 className="text-xl font-semibold tracking-wide" style={{ color: L.accent }}>{company.name}</h2>
            <p className="mt-1 text-xs" style={{ color: L.mutedColor }}>{company.address}</p>
            <p className="text-xs" style={{ color: L.mutedColor }}>{[company.phone, company.email].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex items-end justify-between border-t pt-3" style={{ borderColor: L.table.borderColor }}>
            <p className="text-lg font-semibold" style={{ color: L.textColor }}>{L.titleLabel}</p>
            <p className="text-sm" style={{ color: L.mutedColor }}>{quote?.number || 'QG-XXXX'} | {quote?.date || 'Date'}</p>
          </div>
        </header>
      )
    }
    // split (default)
    return (
      <header className={pad} style={{ background: L.header.bg, borderBottom: L.header.borderBottom }}>
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          {companyBlock}
          {titleBlock}
        </div>
      </header>
    )
  }

  const renderCustomer = () => {
    const fields = [
      ['name', 'Contact', quote?.customer?.name],
      ['company', 'Company', quote?.customer?.company],
      ['gst', 'GST number', quote?.customer?.gst],
      ['location', 'Delivery location', quote?.customer?.location]
    ]
    const fieldInput = (key, label, value) => (
      editable && Input
        ? <Input label={label} value={value || ''} onChange={v => update(['customer', key], v)} bare />
        : <p className="text-sm" style={{ color: L.textColor }}>{value || '—'}</p>
    )

    if (L.customer.variant === 'underline') {
      return (
        <div className="mb-6 space-y-2">
          {fields.map(([key, label, value]) => (
            <div key={key} className="flex gap-3 border-b py-1.5 text-sm" style={{ borderColor: L.table.borderColor }}>
              <span className="w-36 shrink-0" style={{ color: L.mutedColor }}>{label}</span>
              <div className="flex-1">{fieldInput(key, label, value)}</div>
            </div>
          ))}
        </div>
      )
    }
    if (L.customer.variant === 'plain-lines') {
      return (
        <div className="mb-6 grid gap-2 sm:grid-cols-2">
          {fields.map(([key, label, value]) => (
            <div key={key} className="text-sm">
              <span style={{ color: L.mutedColor }}>{label}: </span>
              {editable && Input
                ? <input value={value || ''} onChange={e => update(['customer', key], e.target.value)} className="bg-transparent outline-none" style={{ color: L.textColor }} placeholder={label} />
                : <span style={{ color: L.textColor }}>{value || '—'}</span>}
            </div>
          ))}
        </div>
      )
    }
    if (L.customer.variant === 'single-card') {
      return (
        <div className="mb-6 p-4" style={{ background: L.customer.bg, border: L.customer.border, borderRadius: L.customer.radius }}>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: L.accent }}>{L.quotedToTitle}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map(([key, label, value]) => <div key={key}>{fieldInput(key, label, value)}</div>)}
          </div>
        </div>
      )
    }
    if (L.customer.variant === 'boxed-grid') {
      return (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2" style={{ border: L.customer.border || `1px solid ${L.table.borderColor}` }}>
          <div className="p-4" style={{ background: L.customer.bg, borderRight: `1px solid ${L.table.borderColor}` }}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: L.accent }}>{L.quotedToTitle}</p>
            {fieldInput('name', 'Contact', quote?.customer?.name)}
            {fieldInput('company', 'Company', quote?.customer?.company)}
          </div>
          <div className="p-4" style={{ background: L.paperBg }}>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: L.accent }}>{L.customerDetailsTitle}</p>
            {fieldInput('gst', 'GST number', quote?.customer?.gst)}
            {fieldInput('location', 'Delivery location', quote?.customer?.location)}
          </div>
        </div>
      )
    }
    // two-column-soft
    return (
      <div className="mb-6 grid grid-cols-1 gap-5 p-5 sm:grid-cols-2" style={{ background: L.customer.bg, border: L.customer.border, borderRadius: L.customer.radius }}>
        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: L.accent }}>{L.quotedToTitle}</p>
          {fieldInput('name', 'Contact', quote?.customer?.name)}
          {fieldInput('company', 'Company', quote?.customer?.company)}
        </div>
        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider" style={{ color: L.accent }}>{L.customerDetailsTitle}</p>
          {fieldInput('gst', 'GST number', quote?.customer?.gst)}
          {fieldInput('location', 'Delivery location', quote?.customer?.location)}
        </div>
      </div>
    )
  }

  const thStyle = {
    ...cellBorder,
    background: L.table.headerBg,
    color: L.table.headerColor,
    textTransform: L.table.headerUppercase ? 'uppercase' : 'none',
    letterSpacing: L.table.headerUppercase ? '0.04em' : 'normal',
    fontSize: '11px',
    fontWeight: 600
  }

  return (
    <article
      className={`quote-paper ${compact ? '' : 'shadow-soft print:shadow-none'}`}
      style={{
        background: L.paperBg,
        color: L.textColor,
        fontFamily: L.fontFamily,
        minHeight: compact ? 0 : undefined
      }}
    >
      {renderHeader()}
      <div className={pad}>
        {editable ? (
          <input
            value={quote?.title || ''}
            onChange={e => update(['title'], e.target.value)}
            className="mb-6 w-full border-b border-transparent bg-transparent pb-1 text-xl font-semibold outline-none"
            style={{ color: L.textColor }}
          />
        ) : (
          <p className="mb-5 text-base font-semibold">{quote?.title || 'Quotation title'}</p>
        )}

        {renderCustomer()}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" style={{ minWidth: `${100 + columns.length * 100}px`, ...tableBorder }}>
            <thead>
              <tr>
                {L.showSrNo && <th className={cellPad} style={thStyle}>Sr.</th>}
                {columns.map(col => (
                  <th key={col.id} className={`${cellPad} ${col.id === 'amount' ? 'text-right' : ''}`} style={thStyle}>{col.label}</th>
                ))}
                {editable && <th className="no-print w-9" style={thStyle}></th>}
              </tr>
            </thead>
            <tbody>
              {safeItems.map((item, i) => (
                <tr
                  key={i}
                  className="align-top"
                  style={L.table.variant === 'striped' && i % 2 ? { background: L.accentSoft } : undefined}
                >
                  {L.showSrNo && <td className={cellPad} style={{ ...cellBorder, color: L.mutedColor }}>{i + 1}</td>}
                  {columns.map(col => (
                    <td key={col.id} className={cellPad} style={cellBorder}>
                      {editable && updateItem ? (
                        col.id === 'description' && DescriptionCell
                          ? <DescriptionCell value={item[col.id]} onChange={v => updateItem(i, col.id, v)} label={col.label} />
                          : (
                            <input
                              value={item[col.id] ?? ''}
                              onChange={e => updateItem(i, col.id, e.target.value)}
                              className={`w-full bg-transparent outline-none ${col.id === 'amount' ? 'text-right font-medium' : ''}`}
                              placeholder="—"
                            />
                          )
                      ) : (
                        <span className={col.id === 'amount' ? 'block text-right' : ''}>{item[col.id] || '—'}</span>
                      )}
                    </td>
                  ))}
                  {editable && removeItem && (
                    <td className="no-print" style={cellBorder}>
                      <button onClick={() => removeItem(i)} className="mt-1 rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editable && addItem && (
          <button onClick={addItem} className="no-print mt-3 text-sm font-semibold" style={{ color: L.accent }}>+ Add line item</button>
        )}

        {hasAmount && L.totals.show && (
          <div
            className={`ml-auto mt-5 w-full max-w-sm pt-3 ${L.totals.variant === 'right-box' ? 'rounded-xl border p-4' : ''} ${L.totals.variant === 'full-bar' ? 'max-w-none rounded-lg px-4 py-3' : ''}`}
            style={{
              borderColor: L.accent,
              borderTopWidth: L.totals.variant === 'right-simple' ? 2 : undefined,
              borderTopStyle: L.totals.variant === 'right-simple' ? 'solid' : undefined,
              background: L.totals.variant === 'full-bar' ? L.accentSoft : undefined
            }}
          >
            <div className="flex justify-between text-sm" style={{ color: L.mutedColor }}>
              <span>Subtotal</span>
              <span>₹ {Number(total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="mt-2 flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span>₹ {Number(total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        )}

        {(L.notes.show || L.notes.showClarifications) && (
          <div className={`mt-8 grid gap-6 ${L.notes.variant === 'two-col' && L.notes.show && L.notes.showClarifications ? 'sm:grid-cols-2' : ''}`}>
            {L.notes.show && (
              <section className={L.notes.variant === 'boxed' ? 'rounded-xl border p-3' : ''} style={{ borderColor: L.table.borderColor }}>
                <h3 className="mb-2 border-b pb-2 text-sm font-bold uppercase tracking-wider" style={{ color: L.accent, borderColor: L.table.borderColor }}>{L.notesTitle}</h3>
                {editable && updateList ? (
                  <textarea value={(quote?.notes || []).join('\n')} onChange={e => updateList('notes', e.target.value)} className="min-h-20 w-full resize-none bg-transparent p-1 text-sm outline-none" placeholder="Add notes, one per line" />
                ) : (
                  <ul className="space-y-1 text-sm" style={{ color: L.mutedColor }}>
                    {(quote?.notes?.length ? quote.notes : ['Sample note']).map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
              </section>
            )}
            {L.notes.showClarifications && (
              <section className={L.notes.variant === 'boxed' ? 'rounded-xl border p-3' : ''} style={{ borderColor: '#f59e0b33' }}>
                <h3 className="mb-2 border-b pb-2 text-sm font-bold uppercase tracking-wider text-amber-700" style={{ borderColor: L.table.borderColor }}>{L.clarificationsTitle}</h3>
                {editable && updateList ? (
                  <textarea value={(quote?.clarifications || []).join('\n')} onChange={e => updateList('clarifications', e.target.value)} className="min-h-20 w-full resize-none bg-transparent p-1 text-sm outline-none" placeholder="Add clarifications, one per line" />
                ) : (
                  <p className="text-sm text-amber-800/70">Pending clarifications appear here</p>
                )}
              </section>
            )}
          </div>
        )}

        {L.terms.show && (
          <section className={`mt-8 ${L.terms.variant === 'boxed-list' ? 'rounded-xl border p-4' : ''}`} style={{ borderColor: L.table.borderColor }}>
            <h3 className="mb-3 border-b pb-2 text-sm font-bold uppercase tracking-wider" style={{ color: L.accent, borderColor: L.table.borderColor }}>{L.termsTitle}</h3>
            <div className={`grid gap-x-8 gap-y-2 ${L.terms.variant === 'compact-grid' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
              {Object.entries(termsMap).map(([key, val]) => (
                <div
                  key={key}
                  className={`flex text-sm ${L.terms.variant === 'dashed-rows' ? 'border-b border-dashed py-2' : 'py-1'}`}
                  style={{ borderColor: L.table.borderColor }}
                >
                  <span className="w-28 capitalize" style={{ color: L.mutedColor }}>{key}</span>
                  {editable && update ? (
                    <input value={val || ''} onChange={e => update(['terms', key], e.target.value)} className="flex-1 bg-transparent outline-none" />
                  ) : (
                    <span className="flex-1">{val || '—'}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {L.signatory.show && (
          <footer className={`mt-14 flex ${L.signatory.align === 'left' ? 'justify-start' : 'justify-end'}`}>
            <div className="w-52 text-center">
              <div className="h-12"></div>
              <div className="border-t pt-2 text-xs font-semibold" style={{ borderColor: L.mutedColor, color: L.mutedColor }}>
                {L.signatory.label}
              </div>
            </div>
          </footer>
        )}
      </div>
    </article>
  )
}
