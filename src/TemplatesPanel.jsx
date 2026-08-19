import React, { useRef, useState } from 'react'
import { QuotePaper } from './QuoteLayout.jsx'
import { EditableDocSheet, ensureEditableDoc, hasEditableDoc } from './EditableDocSheet.jsx'
import { hasExactReplica, ReplicaCanvas } from './ReplicaCanvas.jsx'

const PRESET_COLUMN_OPTIONS = [
  'Material Grade', 'Size', 'Thickness', 'Drawing No.', 'Delivery Period',
  'Brand', 'Remarks', 'GST %', 'HSN Code', 'Weight'
]

function slugify(label) {
  const base = label.trim().toLowerCase()
    .replace(/[^a-z0-9%]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9%]/g, '')
    .replace(/^./, c => c.toLowerCase())
  return base || 'column'
}

function uniqueId(label, existing) {
  let id = slugify(label)
  let n = 2
  while (existing.some(c => c.id === id)) { id = `${slugify(label)}${n++}` }
  return id
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function TemplatesPanel({
  templates,
  selectedTemplateId,
  onSelect,
  onRefresh,
  onEdit,
  onError
}) {
  const fileRef = useRef(null)
  const [pasteText, setPasteText] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const analyzePayload = async (payload) => {
    setAnalyzing(true)
    onError?.('')
    try {
      const response = await fetch('/api/templates/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not read that quotation.')
      onEdit(data.template, { isNew: true })
    } catch (e) {
      const msg = e.message === 'Failed to fetch'
        ? 'Cannot reach the API server. Run npm run dev and refresh this page.'
        : (e.message || 'Could not analyse quotation layout.')
      onError?.(msg)
    } finally {
      setAnalyzing(false)
    }
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 12 * 1024 * 1024) {
      onError?.('Please upload a file under 12 MB.')
      return
    }
    const dataBase64 = await fileToBase64(file)
    await analyzePayload({
      fileName: file.name,
      mimeType: file.type,
      dataBase64,
      name: file.name
    })
  }

  const onPasteAnalyze = async () => {
    if (!pasteText.trim()) {
      onError?.('Paste text from a past quotation first.')
      return
    }
    await analyzePayload({ text: pasteText, name: 'Pasted layout' })
  }

  const remove = async (id, e) => {
    e.stopPropagation()
    if (!confirm('Delete this quotation layout?')) return
    try {
      const response = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not delete template.')
      if (selectedTemplateId === id) onSelect(null)
      onRefresh()
    } catch (err) {
      onError?.(err.message)
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-moss/20 bg-[#eef6f3] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Your quotation layouts</p>
          <p className="mt-0.5 text-xs text-slate-600">Upload a past quote — we convert it to an editable shell: keep company/T&Cs/bank, clear enquiry-specific data.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPaste(v => !v)}
            className="rounded-lg border border-sand bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white"
          >
            Paste text
          </button>
          <button
            type="button"
            disabled={analyzing}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1558b0] disabled:opacity-60"
          >
            {analyzing ? 'Reading layout…' : 'Upload past quote'}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,image/*,.txt" className="hidden" onChange={onFile} />
        </div>
      </div>

      {showPaste && (
        <div className="mb-3 rounded-xl border border-sand bg-white p-3">
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Paste text copied from an old quotation / Excel / email…"
            className="min-h-28 w-full resize-y rounded-lg border border-sand p-3 text-sm outline-none focus:border-moss focus:ring-2 focus:ring-blue-50"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={analyzing}
              onClick={onPasteAnalyze}
              className="rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Analyse pasted quote
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`shrink-0 rounded-xl border px-3 py-2 text-left text-sm transition ${
            !selectedTemplateId
              ? 'border-moss bg-blue-50 ring-2 ring-blue-50'
              : 'border-sand bg-white hover:border-moss/40'
          }`}
        >
          <p className="font-semibold text-slate-800">Default QuoteGen</p>
          <p className="text-[11px] text-slate-500">Built-in layout</p>
        </button>
        {templates.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={`group relative shrink-0 rounded-xl border px-3 py-2 text-left text-sm transition ${
              selectedTemplateId === t.id
                ? 'border-moss bg-blue-50 ring-2 ring-blue-50'
                : 'border-sand bg-white hover:border-moss/40'
            }`}
          >
            <p className="pr-10 font-semibold text-slate-800">{t.name}</p>
            <p className="text-[11px] text-slate-500">{t.columns?.length || 0} columns</p>
            <span
              className="absolute right-1.5 top-1.5 flex gap-0.5 opacity-0 transition group-hover:opacity-100"
            >
              <span
                role="button"
                tabIndex={0}
                title="Edit layout"
                onClick={(e) => { e.stopPropagation(); onEdit(t, { isNew: false }) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onEdit(t, { isNew: false }) } }}
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-moss hover:bg-blue-100"
              >
                Edit
              </span>
              <span
                role="button"
                tabIndex={0}
                title="Delete"
                onClick={(e) => remove(t.id, e)}
                onKeyDown={(e) => { if (e.key === 'Enter') remove(t.id, e) }}
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-500 hover:bg-rose-50"
              >
                ×
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function TemplateEditor({ template, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ensureEditableDoc(structuredClone(template)))
  const [saving, setSaving] = useState(false)
  const [beautifying, setBeautifying] = useState(false)
  const [error, setError] = useState('')
  const [customCol, setCustomCol] = useState('')
  const [previewQuote, setPreviewQuote] = useState(() => ({
    title: '',
    number: '',
    date: '',
    customer: { name: '', company: '', gst: '', location: '' },
    items: [],
    notes: [],
    clarifications: [],
    terms: template.defaultTerms || {},
    fields: {}
  }))

  const useDoc = hasEditableDoc(draft)
  const isExact = !useDoc && hasExactReplica(draft)

  const applyDoc = (nextDoc) => {
    setDraft(prev => {
      const permanent = nextDoc.permanent || {}
      const cols = nextDoc.table?.columns?.length ? nextDoc.table.columns : prev.columns
      return {
        ...prev,
        doc: nextDoc,
        columns: cols,
        company: {
          ...(prev.company || {}),
          name: permanent.companyName || prev.company?.name || '',
          address: permanent.companyDetails || prev.company?.address || '',
          phone: permanent.phone || prev.company?.phone || '',
          email: permanent.email || prev.company?.email || ''
        },
        layout: {
          ...(prev.layout || {}),
          accent: nextDoc.accent || prev.layout?.accent,
          titleLabel: permanent.docTitle || prev.layout?.titleLabel
        }
      }
    })
  }

  const addColumn = (label) => {
    const trimmed = label.trim()
    if (!trimmed) return
    const cols = draft.columns || []
    if (cols.some(c => c.label.toLowerCase() === trimmed.toLowerCase())) return
    const nextCol = { id: uniqueId(trimmed, cols), label: trimmed }
    const nextColumns = [...cols, nextCol]
    setDraft(prev => ({
      ...prev,
      columns: nextColumns,
      doc: prev.doc ? {
        ...prev.doc,
        table: { ...(prev.doc.table || {}), columns: nextColumns }
      } : prev.doc
    }))
    setCustomCol('')
  }

  const removeColumn = (index) => {
    if ((draft.columns || []).length <= 1) return
    const nextColumns = draft.columns.filter((_, i) => i !== index)
    setDraft(prev => ({
      ...prev,
      columns: nextColumns,
      doc: prev.doc ? {
        ...prev.doc,
        table: { ...(prev.doc.table || {}), columns: nextColumns }
      } : prev.doc
    }))
  }

  const beautify = async () => {
    setBeautifying(true)
    setError('')
    try {
      const response = await fetch('/api/templates/beautify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: draft })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not beautify layout.')
      setDraft({
        ...data.template,
        lookSummary: data.template.lookSummary || 'Cleaner editable layout.'
      })
    } catch (e) {
      setError(e.message === 'Failed to fetch'
        ? 'Cannot reach the API server. Refresh and retry.'
        : (e.message || 'Could not beautify layout.'))
    } finally {
      setBeautifying(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...draft,
        confirmed: true,
        columns: draft.doc?.table?.columns?.length ? draft.doc.table.columns : draft.columns
      }
      let response = await fetch(`/api/templates/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (response.status === 404) {
        response = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not save layout.')
      onSaved(data.template)
    } catch (e) {
      setError(e.message || 'Could not save layout.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#e8ece8] text-ink">
      <nav className="sticky top-0 z-10 border-b border-sand bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-moss">Editable recreation</p>
            <input
              value={draft.name || ''}
              onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
              className="mt-0.5 w-full max-w-md bg-transparent text-lg font-semibold outline-none"
              placeholder="Layout name"
            />
            <p className="truncate text-sm text-slate-500">
              {draft.lookSummary || 'Company, T&Cs, bank and footer stay. Enquiry-specific fields use placeholders.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-sand px-4 py-2 text-sm font-medium text-slate-600">Cancel</button>
            <button
              type="button"
              disabled={beautifying || saving}
              onClick={beautify}
              className="rounded-lg border border-moss px-4 py-2 text-sm font-semibold text-moss hover:bg-blue-50 disabled:opacity-60"
            >
              {beautifying ? 'Working…' : '✦ Suggest cleaner look'}
            </button>
            <button type="button" disabled={saving || beautifying} onClick={save} className="rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? 'Saving…' : 'Save layout'}
            </button>
          </div>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-3 py-6 sm:px-6">
        {error ? <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

        {useDoc ? (
          <EditableDocSheet
            template={draft}
            quote={previewQuote}
            onChange={setPreviewQuote}
            onDocChange={applyDoc}
            editable
            shellPreview
          />
        ) : isExact ? (
          <ReplicaCanvas
            template={draft}
            quote={previewQuote}
            onQuoteChange={setPreviewQuote}
            editable={false}
            shellPreview
          />
        ) : (
          <QuotePaper
            template={draft}
            quote={previewQuote}
            columns={draft.columns}
            total={0}
            editable={false}
            compact
          />
        )}

        {useDoc ? (
          <div className="mt-4 rounded-xl border border-sand bg-white p-4">
            <p className="mb-2 text-sm font-semibold text-slate-700">Add / remove table columns</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {(draft.columns || []).map((col, i) => (
                <span key={col.id} className="inline-flex items-center gap-1 rounded-lg border border-sand bg-slate-50 px-2 py-1 text-xs text-slate-700">
                  {col.label}
                  <button type="button" onClick={() => removeColumn(i)} className="text-rose-500">×</button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLUMN_OPTIONS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => addColumn(option)}
                  disabled={(draft.columns || []).some(c => c.label.toLowerCase() === option.toLowerCase())}
                  className="rounded-full border border-sand bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 disabled:opacity-40"
                >
                  + {option}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={customCol}
                onChange={e => setCustomCol(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addColumn(customCol) }}
                placeholder="Custom column"
                className="min-w-0 flex-1 rounded-lg border border-sand px-3 py-2 text-sm outline-none focus:border-moss"
              />
              <button type="button" onClick={() => addColumn(customCol)} className="rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white">Add</button>
            </div>
          </div>
        ) : null}

        <p className="mt-4 text-center text-xs text-slate-500">
          Edit fields directly in the document. Placeholders mark where enquiry data will fill in later.
        </p>
      </section>
    </main>
  )
}
