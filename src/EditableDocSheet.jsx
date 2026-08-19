import React, { useMemo } from 'react'

const DYNAMIC_ROLES = new Set([
  'quote.number', 'quote.date', 'quote.validUntil',
  'customer.name', 'customer.company', 'customer.gst', 'customer.location',
  'title', 'subject', 'department', 'vendor', 'wo.number'
])

function isDynamicRole(role) {
  if (!role) return false
  if (DYNAMIC_ROLES.has(role)) return true
  if (/^customer\.|^quote\.|^wo\.|subject|department|vendor/i.test(role)) return true
  return false
}

function buildSampleRows(columns) {
  const descCol = columns.find(c => /desc|particular|material|name|work|item|staff/i.test(`${c.id}${c.label}`)) || columns[0]
  const qtyCol = columns.find(c => /qty|quantity|hrs/i.test(`${c.id}${c.label}`))
  const unitCol = columns.find(c => /^unit$|uom/i.test(`${c.id}${c.label}`))
  return [1, 2, 3].map((n) => {
    const row = Object.fromEntries(columns.map(c => [c.id, '']))
    if (descCol) row[descCol.id] = `Example product ${n}`
    if (qtyCol) row[qtyCol.id] = String(n * 5)
    if (unitCol) row[unitCol.id] = 'Nos'
    return row
  })
}

function FieldBox({ label, value, placeholder, onChange, editable, multiline }) {
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <label className="block">
      {label ? <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</span> : null}
      {editable ? (
        <Tag
          value={value ?? ''}
          placeholder={placeholder || ''}
          onChange={e => onChange(e.target.value)}
          rows={multiline ? 3 : undefined}
          className={`w-full border-b border-transparent bg-transparent text-sm outline-none placeholder:text-slate-400 hover:border-slate-200 focus:border-slate-300 ${multiline ? 'resize-y rounded border border-slate-200 px-2 py-1.5' : 'py-0.5'}`}
        />
      ) : (
        <p className={`text-sm ${!(value || '').trim() ? 'italic text-slate-400' : 'text-ink'}`}>
          {(value || '').trim() || placeholder || '—'}
        </p>
      )}
    </label>
  )
}

/**
 * True editable document recreation (not image overlays).
 * Permanent shell + dynamic placeholders as plain editable text.
 */
export function EditableDocSheet({
  template,
  quote,
  onChange,
  onDocChange,
  editable = true,
  shellPreview = false
}) {
  const doc = template?.doc || null
  const columns = doc?.table?.columns?.length
    ? doc.table.columns
    : (template?.columns || [])

  const hasLiveItems = Array.isArray(quote?.items) && quote.items.some(row =>
    columns.some(c => String(row?.[c.id] || '').trim())
  )

  const items = useMemo(() => {
    if (shellPreview || !hasLiveItems) return buildSampleRows(columns)
    return quote.items
  }, [shellPreview, hasLiveItems, quote?.items, columns])

  const showingSamples = shellPreview || !hasLiveItems
  const accent = doc?.accent || template?.layout?.accent || '#1D63ED'
  const fontFamily = doc?.fontFamily || 'Arial, Helvetica, sans-serif'

  const patchDoc = (mutator) => {
    if (!onDocChange || !doc) return
    const next = structuredClone(doc)
    mutator(next)
    onDocChange(next)
  }

  const setField = (role, value) => {
    // Shell confirm: keep permanent text on the template.doc model
    if (shellPreview && onDocChange && doc) {
      if (role === 'company.name') {
        patchDoc(d => { d.permanent.companyName = value })
      } else if (role === 'company.address') {
        patchDoc(d => { d.permanent.companyDetails = value })
      } else if (role === 'company.phone') {
        patchDoc(d => { d.permanent.phone = value })
      } else if (role === 'company.email') {
        patchDoc(d => { d.permanent.email = value })
      } else if (role === 'docTitle') {
        patchDoc(d => { d.permanent.docTitle = value })
      } else if (role === 'permanent.notes') {
        patchDoc(d => { d.permanent.notes = value })
      } else if (role === 'permanent.terms') {
        patchDoc(d => { d.permanent.terms = value })
      } else if (role === 'permanent.bank') {
        patchDoc(d => { d.permanent.bank = value })
      } else if (role === 'permanent.footer') {
        patchDoc(d => { d.permanent.footer = value })
      }
    }

    if (!onChange) return
    const next = structuredClone(quote || {})
    next.customer = next.customer || { name: '', company: '', gst: '', location: '' }
    next.fields = { ...(next.fields || {}), [role]: value }
    if (role === 'company.name') next.companyName = value
    else if (role === 'company.address') next.companyAddress = value
    else if (role === 'company.phone') next.companyPhone = value
    else if (role === 'company.email') next.companyEmail = value
    else if (role === 'customer.name') next.customer.name = value
    else if (role === 'customer.company') next.customer.company = value
    else if (role === 'customer.gst') next.customer.gst = value
    else if (role === 'customer.location') next.customer.location = value
    else if (role === 'title' || role === 'subject' || role === 'docTitle') next.title = value
    else if (role === 'quote.number') next.number = value
    else if (role === 'quote.date') next.date = value
    onChange(next)
  }

  const fieldValue = (role, fallback = '') => {
    if (quote?.fields?.[role] != null && quote.fields[role] !== '') return quote.fields[role]
    if (role === 'company.name') return quote?.companyName || template?.company?.name || fallback
    if (role === 'company.address') return quote?.companyAddress || template?.company?.address || fallback
    if (role === 'company.phone') return quote?.companyPhone || template?.company?.phone || fallback
    if (role === 'company.email') return quote?.companyEmail || template?.company?.email || fallback
    if (role === 'customer.name') return quote?.customer?.name || ''
    if (role === 'customer.company') return quote?.customer?.company || ''
    if (role === 'customer.gst') return quote?.customer?.gst || ''
    if (role === 'customer.location') return quote?.customer?.location || ''
    if (role === 'title' || role === 'subject' || role === 'docTitle') return quote?.title || (shellPreview ? '' : fallback)
    if (role === 'quote.number') return quote?.number || ''
    if (role === 'quote.date') return quote?.date || ''
    return quote?.fields?.[role] || (isDynamicRole(role) ? '' : fallback)
  }

  const updateItem = (i, colId, val) => {
    if (!onChange || showingSamples) return
    const nextItems = items.map((row, idx) => idx === i ? { ...row, [colId]: val } : row)
    onChange({ ...quote, items: nextItems })
  }

  if (!doc) {
    return (
      <div className="rounded-xl border border-dashed border-sand bg-white p-8 text-center text-sm text-slate-500">
        Upload a quotation to convert it into an editable document.
      </div>
    )
  }

  const permanent = doc.permanent || {}
  const dynamic = doc.dynamic || {}

  return (
    <article
      className="quote-paper mx-auto w-full max-w-4xl overflow-x-hidden bg-white shadow-soft"
      style={{ fontFamily, color: '#111' }}
    >
      {/* Header */}
      <header className="flex flex-col gap-4 border-b px-6 py-6 sm:flex-row sm:justify-between sm:px-8" style={{ borderColor: accent }}>
        <div className="min-w-0 flex-1 space-y-2">
          {doc.logoText ? (
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold text-white" style={{ background: accent }}>
              {String(doc.logoText).slice(0, 2).toUpperCase()}
            </div>
          ) : null}
          <FieldBox
            label="Company name"
            value={fieldValue('company.name', permanent.companyName || '')}
            onChange={v => setField('company.name', v)}
            editable={editable}
          />
          <FieldBox
            label="Company details / address"
            value={fieldValue('company.address', permanent.companyDetails || '')}
            onChange={v => setField('company.address', v)}
            editable={editable}
            multiline
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <FieldBox label="Phone" value={fieldValue('company.phone', permanent.phone || '')} onChange={v => setField('company.phone', v)} editable={editable} />
            <FieldBox label="Email" value={fieldValue('company.email', permanent.email || '')} onChange={v => setField('company.email', v)} editable={editable} />
          </div>
        </div>
        <div className="w-full space-y-2 sm:max-w-xs">
          <FieldBox
            label="Document title"
            value={fieldValue('docTitle', permanent.docTitle || 'QUOTATION')}
            onChange={v => setField('docTitle', v)}
            editable={editable}
          />
          <FieldBox
            label="Quote / WO number"
            value={fieldValue('quote.number')}
            placeholder={dynamic.quoteNumberPlaceholder || 'QG-XXXX'}
            onChange={v => setField('quote.number', v)}
            editable={editable && !shellPreview}
          />
          <FieldBox
            label="Date"
            value={fieldValue('quote.date')}
            placeholder={dynamic.datePlaceholder || 'DD/MM/YYYY'}
            onChange={v => setField('quote.date', v)}
            editable={editable && !shellPreview}
          />
        </div>
      </header>

      <div className="space-y-4 px-6 py-5 sm:px-8">
        <FieldBox
          label="Customer / To"
          value={fieldValue('customer.company')}
          placeholder={dynamic.customerPlaceholder || 'Customer company name'}
          onChange={v => setField('customer.company', v)}
          editable={editable && !shellPreview}
        />
        <FieldBox
          label="Subject / title"
          value={fieldValue('title')}
          placeholder={dynamic.subjectPlaceholder || 'Quotation for …'}
          onChange={v => setField('title', v)}
          editable={editable && !shellPreview}
        />

        {/* Line items table */}
        <div className="overflow-x-hidden rounded-md border border-slate-200">
          {showingSamples && (
            <p className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
              Sample line items — replaced by real enquiry products later
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] table-fixed border-collapse text-left text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="w-10 border border-slate-200 px-2 py-2 text-[11px] font-semibold">Sr</th>
                  {columns.map((col, colIdx) => (
                    <th key={col.id} className="border border-slate-200 px-2 py-2 text-[11px] font-semibold">
                      {editable && shellPreview && onDocChange ? (
                        <input
                          value={col.label}
                          onChange={e => {
                            const label = e.target.value
                            patchDoc(d => {
                              d.table = d.table || { columns: [] }
                              d.table.columns = (d.table.columns || columns).map((c, i) =>
                                i === colIdx ? { ...c, label } : c
                              )
                            })
                          }}
                          className="w-full bg-transparent text-[11px] font-semibold outline-none"
                        />
                      ) : col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className={showingSamples ? 'text-slate-500' : ''}>
                    <td className="border border-slate-200 px-2 py-1.5 text-slate-500">{i + 1}</td>
                    {columns.map(col => (
                      <td key={col.id} className="border border-slate-200 px-1 py-1 align-top">
                        {editable && !showingSamples ? (
                          <textarea
                            value={item[col.id] ?? ''}
                            onChange={e => updateItem(i, col.id, e.target.value)}
                            rows={2}
                            className="w-full resize-none bg-transparent text-sm outline-none"
                          />
                        ) : (
                          <span className={`text-sm ${showingSamples ? 'italic' : ''}`}>{item[col.id] || ''}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Permanent commercial blocks */}
        <FieldBox
          label="Notes / scope"
          value={fieldValue('permanent.notes', permanent.notes || '')}
          onChange={v => setField('permanent.notes', v)}
          editable={editable}
          multiline
        />
        <FieldBox
          label="Terms & conditions"
          value={fieldValue('permanent.terms', permanent.terms || '')}
          onChange={v => setField('permanent.terms', v)}
          editable={editable}
          multiline
        />
        <FieldBox
          label="Payment / bank details"
          value={fieldValue('permanent.bank', permanent.bank || '')}
          onChange={v => setField('permanent.bank', v)}
          editable={editable}
          multiline
        />
        <FieldBox
          label="Footer / contact"
          value={fieldValue('permanent.footer', permanent.footer || '')}
          onChange={v => setField('permanent.footer', v)}
          editable={editable}
          multiline
        />
      </div>
    </article>
  )
}

export function hasEditableDoc(template) {
  return Boolean(template?.doc?.permanent || template?.doc?.table)
}

/** Build a minimal editable doc from company/columns when an old template lacks one. */
export function ensureEditableDoc(template) {
  if (hasEditableDoc(template)) return template
  const company = template?.company || {}
  const columns = template?.columns || [
    { id: 'description', label: 'Description' },
    { id: 'quantity', label: 'Quantity' },
    { id: 'rate', label: 'Rate' },
    { id: 'amount', label: 'Amount' }
  ]
  return {
    ...template,
    layoutMode: 'editable-doc',
    doc: {
      accent: template?.layout?.accent || '#1D63ED',
      fontFamily: 'Arial, Helvetica, sans-serif',
      logoText: String(company.name || 'Q').slice(0, 2).toUpperCase(),
      permanent: {
        companyName: company.name || '',
        companyDetails: company.address || '',
        phone: company.phone || '',
        email: company.email || '',
        docTitle: template?.layout?.titleLabel || 'QUOTATION',
        notes: '',
        terms: Object.values(template?.defaultTerms || {}).filter(Boolean).join('\n'),
        bank: '',
        footer: [company.phone, company.email].filter(Boolean).join(' · ')
      },
      dynamic: {
        quoteNumberPlaceholder: 'QG-XXXX',
        datePlaceholder: 'DD/MM/YYYY',
        customerPlaceholder: 'Customer company name',
        subjectPlaceholder: 'Quotation for …'
      },
      table: { showSrNo: true, columns }
    }
  }
}
