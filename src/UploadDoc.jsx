import React, { useEffect, useRef, useState } from 'react'
import {
  mapHeaderToField,
  scrubTransientWordShell,
  scrubTransientExcelShell,
  inferTemplatePageWidth
} from '../shared/templateMap.js'

async function readApiResponse(response) {
  const text = await response.text()
  if (!text) throw new Error('Server returned an empty response. Keep npm run dev running.')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Server returned an invalid response. Please retry.')
  }
}

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

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-moss font-bold text-white">Q</div>
      <span className="font-semibold tracking-tight">QuoteGen</span>
      <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 sm:inline">Upload Doc</span>
    </div>
  )
}

function colLetter(n) {
  let s = ''
  let num = n
  while (num > 0) {
    const rem = (num - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    num = Math.floor((num - 1) / 26)
  }
  return s
}

function parseRef(ref) {
  const m = String(ref).toUpperCase().match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col, row: Number(m[2]) }
}

function cellMap(sheet) {
  const map = new Map()
  for (const row of sheet.rows) {
    for (const cell of row.cells) {
      map.set(`${row.index}:${cell.col}`, cell)
    }
  }
  return map
}

function numericValue(raw) {
  if (raw == null || raw === '') return 0
  const n = Number(String(raw).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function evalSimpleFormula(formula, sheet) {
  const f = String(formula || '').trim().replace(/^\s*=/, '')
  const map = cellMap(sheet)

  let m = f.match(/^(SUM|AVERAGE|PRODUCT)\(([^)]+)\)$/i)
  if (m) {
    const parts = m[2].split(',').map(s => s.trim())
    const values = []
    for (const part of parts) {
      if (part.includes(':')) {
        const [a, b] = part.split(':')
        const start = parseRef(a)
        const end = parseRef(b)
        if (!start || !end) continue
        for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
          for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
            values.push(numericValue(map.get(`${r}:${c}`)?.value))
          }
        }
      } else {
        const ref = parseRef(part)
        if (ref) values.push(numericValue(map.get(`${ref.row}:${ref.col}`)?.value))
        else values.push(numericValue(part))
      }
    }
    const op = m[1].toUpperCase()
    if (op === 'SUM') return String(values.reduce((a, b) => a + b, 0))
    if (op === 'PRODUCT') return String(values.reduce((a, b) => a * b, 1))
    if (op === 'AVERAGE') return values.length ? String(values.reduce((a, b) => a + b, 0) / values.length) : '0'
  }

  m = f.match(/^([A-Z]+\d+)\s*([*+\-/])\s*([A-Z]+\d+)$/i)
  if (m) {
    const a = numericValue(map.get(`${parseRef(m[1]).row}:${parseRef(m[1]).col}`)?.value)
    const b = numericValue(map.get(`${parseRef(m[3]).row}:${parseRef(m[3]).col}`)?.value)
    const ops = { '+': a + b, '-': a - b, '*': a * b, '/': b ? a / b : 0 }
    return String(ops[m[2]] ?? '')
  }

  // Keep cached display if we can't evaluate
  return null
}

function recalculateSheet(sheet) {
  const next = structuredClone(sheet)
  for (let pass = 0; pass < 3; pass++) {
    for (const row of next.rows) {
      for (const cell of row.cells) {
        if (!cell.formula) continue
        const result = evalSimpleFormula(cell.formula, next)
        if (result != null) cell.value = result
      }
    }
  }
  return next
}

function DesignBar({ design, onChange, onSaveTemplate, saving }) {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 border-t border-sand px-4 py-2 sm:px-6">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Design</span>
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        Accent (headers)
        <input type="color" value={design.accent || '#1A73E8'} onChange={e => onChange({ ...design, accent: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-sand bg-white" />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        Paper
        <input type="color" value={design.paperBg || '#ffffff'} onChange={e => onChange({ ...design, paperBg: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-sand bg-white" />
      </label>
      {design.pageBg != null && (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          Canvas
          <input type="color" value={design.pageBg || '#e8ece8'} onChange={e => onChange({ ...design, pageBg: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-sand bg-white" />
        </label>
      )}
      {design.headerBg !== undefined && (
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          Header tint
          <input type="color" value={design.headerBg || '#f7f9f7'} onChange={e => onChange({ ...design, headerBg: e.target.value })} className="h-7 w-8 cursor-pointer rounded border border-sand bg-white" />
        </label>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={onSaveTemplate}
        className="ml-auto rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1558b0] disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save as template'}
      </button>
    </div>
  )
}

function SaveTemplateModal({ open, defaultName, onClose, onConfirm, saving, error }) {
  const [name, setName] = useState(defaultName || '')
  useEffect(() => { if (open) setName(defaultName || '') }, [open, defaultName])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-soft">
        <h3 className="text-lg font-semibold">Save as quotation template</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          We keep the permanent shell (logo, letterhead, terms, formulas, layout) and clear temporary sample data
          (line items, quote number, dates) so future enquiries can fill this layout.
        </p>
        <label className="mt-4 block text-sm font-medium">Template name</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-moss focus:ring-4 focus:ring-blue-50"
          placeholder="e.g. Acme letterhead quote"
        />
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            disabled={saving || !name.trim()}
            onClick={() => onConfirm(name.trim())}
            className="rounded-lg bg-moss px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UploadDoc({ onBack, suggestedName = '' }) {
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [doc, setDoc] = useState(null)
  const [templates, setTemplates] = useState([])
  const inputRef = useRef(null)

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/upload-templates')
      const data = await readApiResponse(res)
      if (res.ok) setTemplates(data.templates || [])
    } catch { /* ignore list errors on landing */ }
  }

  useEffect(() => { loadTemplates() }, [])

  const handleFile = async (file) => {
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.docx') && !name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
      setError('This phase supports Word (.docx) and Excel (.xlsx) only.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/upload-doc', { method: 'POST', body: form })
      const data = await readApiResponse(response)
      if (!response.ok) throw new Error(data.error || 'Upload failed')
      if (data.type === 'word') {
        data.html = scrubTransientWordShell(data.html || '')
      } else if (data.type === 'excel') {
        data.sheets = scrubTransientExcelShell(data.sheets || [])
      }
      setDoc(data)
    } catch (e) {
      setError(
        e.message === 'Failed to fetch'
          ? 'Cannot reach the API server. Run npm run dev and keep that terminal open.'
          : e.message || 'Could not open this file.'
      )
    } finally {
      setLoading(false)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  const sharedSave = async (name, payload) => {
    const response = await fetch('/api/upload-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...payload })
    })
    const data = await readApiResponse(response)
    if (!response.ok) throw new Error(data.error || 'Save failed')
    await loadTemplates()
    return data
  }

  if (doc?.type === 'word') {
    return (
      <WordEditor
        doc={doc}
        suggestedName={suggestedName}
        onBack={() => setDoc(null)}
        onHome={onBack}
        onChange={(next) => setDoc(next)}
        onSaved={async (tpl) => { await loadTemplates(); setDoc(null); onBack(tpl) }}
        saveTemplate={sharedSave}
      />
    )
  }

  if (doc?.type === 'excel') {
    return (
      <ExcelEditor
        doc={doc}
        suggestedName={suggestedName}
        onBack={() => setDoc(null)}
        onHome={onBack}
        onChange={(next) => setDoc(next)}
        onSaved={async (tpl) => { await loadTemplates(); setDoc(null); onBack(tpl) }}
        saveTemplate={sharedSave}
      />
    )
  }

  return (
    <main className="min-h-screen bg-mist text-ink">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <Brand />
        <button onClick={onBack} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-white">← Back to quotations</button>
      </nav>

      <section className="mx-auto max-w-2xl px-5 pb-16 pt-6 sm:px-8">
        <div className="mb-8 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-moss">Upload Doc</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Open a document.<br />
            <span className="text-moss">Edit it here.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600">
            Upload Word or Excel. Layout stays yours — then save it as a template for future quotations.
          </p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-3xl border-2 border-dashed bg-white p-10 text-center shadow-soft transition ${dragging ? 'border-moss bg-blue-50/40' : 'border-sand'}`}
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f7f9f7] text-2xl text-moss">↑</div>
          <p className="font-semibold">{loading ? 'Converting…' : 'Drop your file here'}</p>
          <p className="mt-1 text-sm text-slate-500">.docx or .xlsx · up to 25 MB</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => inputRef.current?.click()}
            className="mt-6 rounded-xl bg-moss px-5 py-3 text-sm font-semibold text-white hover:bg-[#1558b0] disabled:opacity-60"
          >
            {loading ? 'Opening…' : 'Choose file'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".docx,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>

        {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        {templates.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Saved layouts</h2>
            <ul className="space-y-2">
              {templates.map(t => (
                <li key={t.id} className="flex items-center justify-between rounded-xl border border-sand bg-white px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-slate-400">{t.type.toUpperCase()} · {t.sourceFileName || 'uploaded'}</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-moss">Ready for quotes</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-400">Pick a saved layout on the quotation home screen when generating.</p>
          </div>
        )}
      </section>
    </main>
  )
}

function useSaveFlow(doc, saveTemplate, buildPayload, onSaved) {
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const confirm = async (name) => {
    setSaving(true)
    setError('')
    try {
      const data = await saveTemplate(name, buildPayload())
      setModal(false)
      onSaved?.(data?.template || data?.full || data)
    } catch (e) {
      setError(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return { modal, setModal, saving, error, confirm }
}

function WordEditor({ doc, suggestedName = '', onBack, onHome, onChange, saveTemplate, onSaved }) {
  const editorRef = useRef(null)
  const design = doc.design || { accent: '#1A73E8', paperBg: '#ffffff', pageBg: '#e8ece8' }
  const pageWidthPx = inferTemplatePageWidth('word', doc.html, design)
  const save = useSaveFlow(
    doc,
    saveTemplate,
    () => ({
      type: 'word',
      sourceFileName: doc.fileName,
      html: editorRef.current?.innerHTML || doc.html,
      design
    }),
    onSaved
  )

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = doc.html
  }, [doc.fileName])

  const sync = () => {
    if (editorRef.current) onChange({ ...doc, html: editorRef.current.innerHTML })
  }

  const exec = (cmd, value = null) => {
    document.execCommand(cmd, false, value)
    editorRef.current?.focus()
    sync()
  }

  const applyAccentToSelection = () => {
    document.execCommand('foreColor', false, design.accent)
    sync()
  }

  const updateDesign = (d) => {
    const html = editorRef.current?.innerHTML || doc.html
    onChange({ ...doc, html, design: d })
  }

  return (
    <main className="min-h-screen text-ink" style={{ background: design.pageBg || '#e8ece8' }}>
      <nav className="sticky top-0 z-10 border-b border-sand bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <Brand />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onBack} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Upload another</button>
            <button onClick={onHome} className="rounded-lg border border-sand px-3 py-2 text-sm font-medium text-moss">Quotations</button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1100px] flex-wrap items-center gap-1 border-t border-sand px-4 py-2 sm:px-6">
          <ToolbarBtn label="B" title="Bold" className="font-bold" onClick={() => exec('bold')} />
          <ToolbarBtn label="I" title="Italic" className="italic" onClick={() => exec('italic')} />
          <ToolbarBtn label="U" title="Underline" className="underline" onClick={() => exec('underline')} />
          <span className="mx-1 h-5 w-px bg-sand" />
          <ToolbarBtn label="• List" onClick={() => exec('insertUnorderedList')} />
          <ToolbarBtn label="1. List" onClick={() => exec('insertOrderedList')} />
          <span className="mx-1 h-5 w-px bg-sand" />
          <ToolbarBtn label="Accent text" onClick={applyAccentToSelection} />
          <span className="ml-auto text-xs text-slate-400">{doc.fileName}</span>
        </div>
        <DesignBar
          design={design}
          onChange={updateDesign}
          onSaveTemplate={() => save.setModal(true)}
          saving={save.saving}
        />
      </nav>

      <div className="mx-auto overflow-x-auto px-3 py-6 sm:px-6" style={{ width: 'fit-content', maxWidth: '100%' }}>
        {doc.warnings?.length > 0 && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Opened with minor conversion notes ({doc.warnings.length}). Image sizes locked to Word display size.
          </p>
        )}
        <article
          className="upload-word-page shadow-soft"
          style={{
            background: design.paperBg || '#fff',
            borderTop: `3px solid ${design.accent || '#1A73E8'}`,
            width: pageWidthPx,
            maxWidth: 'none',
            '--upload-page-width': `${pageWidthPx}px`
          }}
        >
          <div
            ref={editorRef}
            className="upload-word-editor outline-none"
            contentEditable
            suppressContentEditableWarning
            onInput={sync}
            onBlur={sync}
          />
        </article>
      </div>

      <SaveTemplateModal
        open={save.modal}
        defaultName={suggestedName || (doc.fileName || 'Word layout').replace(/\.docx$/i, '')}
        onClose={() => save.setModal(false)}
        onConfirm={save.confirm}
        saving={save.saving}
        error={save.error}
      />
    </main>
  )
}

function ToolbarBtn({ label, onClick, title, className = '' }) {
  return (
    <button
      type="button"
      title={title || label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 ${className}`}
    >
      {label}
    </button>
  )
}

function ExcelEditor({ doc, suggestedName = '', onBack, onHome, onChange, saveTemplate, onSaved }) {
  const [sheetIndex, setSheetIndex] = useState(0)
  const design = doc.design || { accent: '#1A73E8', paperBg: '#ffffff', headerBg: '#f7f9f7' }
  const sheet = doc.sheets[sheetIndex] || doc.sheets[0]

  const save = useSaveFlow(
    doc,
    saveTemplate,
    () => ({
      type: 'excel',
      sourceFileName: doc.fileName,
      sheets: doc.sheets,
      activeSheet: sheetIndex,
      design
    }),
    onSaved
  )

  const updateDesign = (d) => {
    onChange({ ...doc, design: d })
  }

  const updateCell = (rowIndex, cellIndex, value) => {
    let sheets = structuredClone(doc.sheets)
    const cell = sheets[sheetIndex].rows[rowIndex].cells[cellIndex]
    if (String(value).trim().startsWith('=')) {
      cell.formula = String(value).trim().replace(/^\s*=/, '')
    } else {
      cell.value = value
      cell.formula = null
    }
    sheets[sheetIndex] = recalculateSheet(sheets[sheetIndex])
    onChange({ ...doc, sheets })
  }

  if (!sheet) {
    return (
      <main className="min-h-screen bg-mist p-8 text-center">
        <p>No sheets found in this workbook.</p>
        <button onClick={onBack} className="mt-4 text-moss">Upload another</button>
      </main>
    )
  }

  const hf = sheet.headerFooter || {}
  const headerText = hf.oddHeader || hf.firstHeader || ''
  const footerText = hf.oddFooter || hf.firstFooter || ''

  return (
    <main className="min-h-screen text-ink" style={{ background: '#dce3dc' }}>
      <nav className="sticky top-0 z-10 border-b border-sand bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <Brand />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onBack} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Upload another</button>
            <button onClick={onHome} className="rounded-lg border border-sand px-3 py-2 text-sm font-medium text-moss">Quotations</button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 overflow-x-auto border-t border-sand px-4 py-2 sm:px-6">
          {doc.sheets.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              onClick={() => setSheetIndex(i)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${i === sheetIndex ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              style={i === sheetIndex ? { background: design.accent || '#1A73E8' } : undefined}
            >
              {s.name}
            </button>
          ))}
          <span className="ml-auto shrink-0 text-xs text-slate-400">{doc.fileName}</span>
        </div>
        <DesignBar
          design={{ ...design, headerBg: design.headerBg || design.accent || '#f7f9f7', pageBg: undefined }}
          onChange={updateDesign}
          onSaveTemplate={() => save.setModal(true)}
          saving={save.saving}
        />
      </nav>

      <div className="overflow-auto p-3 sm:p-5">
        {(headerText || footerText) && (
          <div className="mb-3 max-w-3xl rounded-lg border border-sand bg-white/80 px-3 py-2 text-xs text-slate-600">
            {headerText && <p><span className="font-semibold text-slate-500">Header:</span> {headerText}</p>}
            {footerText && <p className="mt-1"><span className="font-semibold text-slate-500">Footer:</span> {footerText}</p>}
          </div>
        )}

        <div className="relative inline-block min-w-full rounded-lg shadow-soft" style={{ background: design.paperBg || '#fff' }}>
          {sheet.images?.map((img) => (
            <img
              key={img.id}
              src={img.src}
              alt=""
              className="upload-excel-float-img pointer-events-none absolute z-[1] object-contain"
              style={{
                left: 40 + (img.fromCol * 64) + (img.colOff ? img.colOff / 10000 : 0),
                top: 24 + (img.fromRow * 22) + (img.rowOff ? img.rowOff / 10000 : 0),
                width: Math.max(40, (img.toCol - img.fromCol + 1) * 64),
                height: Math.max(24, (img.toRow - img.fromRow + 1) * 22)
              }}
            />
          ))}
          <table className="upload-excel-table border-collapse">
            <colgroup>
              <col style={{ width: 40 }} />
              {sheet.columns.map((col) => (
                <col key={col.index} style={{ width: col.widthPx }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="upload-excel-corner" style={{ background: design.headerBg || '#f3f4f3' }} />
                {sheet.columns.map((col) => (
                  <th key={col.index} className="upload-excel-colhead" style={{ background: design.headerBg || '#f3f4f3' }}>
                    {colLetter(col.index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, ri) => (
                <tr key={row.index} style={{ height: row.heightPx }}>
                  <th className="upload-excel-rowhead" style={{ background: design.headerBg || '#f3f4f3' }}>{row.index}</th>
                  {row.cells.map((cell, ci) => {
                    const css = styleToCss(cell.style)
                    return (
                      <td
                        key={`${row.index}-${cell.col}`}
                        rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                        colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                        title={cell.formula ? `=${cell.formula}` : undefined}
                        style={{
                          ...css,
                          minWidth: sheet.columns[cell.col - 1]?.widthPx || 80,
                          height: row.heightPx
                        }}
                        className="upload-excel-cell"
                      >
                        <input
                          value={cell.value}
                          onChange={(e) => updateCell(ri, ci, e.target.value)}
                          className="upload-excel-input"
                          style={{
                            fontFamily: css.fontFamily,
                            fontSize: css.fontSize,
                            fontWeight: css.fontWeight,
                            fontStyle: css.fontStyle,
                            textDecoration: css.textDecoration,
                            color: css.color,
                            textAlign: css.textAlign || 'left'
                          }}
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">Formulas are preserved (hover a cell to see them). Simple SUM / AVERAGE / PRODUCT recalculate when you edit.</p>
      </div>

      <SaveTemplateModal
        open={save.modal}
        defaultName={suggestedName || (doc.fileName || 'Excel layout').replace(/\.xlsx?$/i, '')}
        onClose={() => save.setModal(false)}
        onConfirm={save.confirm}
        saving={save.saving}
        error={save.error}
      />
    </main>
  )
}
