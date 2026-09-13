import React, { useEffect, useRef, useState } from 'react'
import NativeDocumentEditor from './NativeDocumentEditor.jsx'

async function readApiResponse(response) {
  const text = await response.text()
  if (!text) throw new Error('Server returned an empty response. Keep npm run dev running.')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Server returned an invalid response.')
  }
}

/**
 * Plain Word/Excel editor — upload a file and keep editing it as-is.
 * No quotation mapping, no layout reconstruction.
 */
export default function OpenEditor({ onBack }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doc, setDoc] = useState(null)
  const [officeEnabled, setOfficeEnabled] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    fetch('/api/office/status')
      .then(readApiResponse)
      .then(d => setOfficeEnabled(Boolean(d.enabled)))
      .catch(() => setOfficeEnabled(false))
  }, [])

  const openFile = async (file) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/open-editor', { method: 'POST', body: form })
      const data = await readApiResponse(response)
      if (!response.ok) throw new Error(data.error || 'Upload failed.')
      if (typeof data.officeEnabled === 'boolean') setOfficeEnabled(data.officeEnabled)
      setDoc({
        fileId: data.fileId,
        fileName: data.fileName,
        type: data.kind,
        mimeType: data.mimeType
      })
    } catch (e) {
      setError(e.message || 'Could not open this file.')
      setDoc(null)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f7fb]">
      <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ← Back
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">
              {doc?.fileName || 'Open editor'}
            </p>
            <p className="text-xs text-slate-500">
              Upload Word or Excel — open as-is and keep editing. No remapping.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".docx,.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => openFile(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-[#1A73E8] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1558b0] disabled:opacity-60"
          >
            {busy ? 'Opening…' : (doc ? 'Open another file' : 'Upload Word / Excel')}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        {officeEnabled === false ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-semibold">Full edit mode needs OnlyOffice Document Server</p>
            <p className="mt-1 text-amber-900/90">
              Without it, Word opens as a faithful preview (not editable) and Excel cannot open.
              Install Docker, run{' '}
              <code className="rounded bg-white/80 px-1">docker compose -f docker-compose.onlyoffice.yml up -d</code>,
              then set <code className="rounded bg-white/80 px-1">ONLYOFFICE_URL=http://localhost:8080</code> and{' '}
              <code className="rounded bg-white/80 px-1">PUBLIC_API_URL=http://host.docker.internal:3001</code> in{' '}
              <code className="rounded bg-white/80 px-1">.env</code> and restart the API.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {!doc ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              openFile(e.dataTransfer.files?.[0])
            }}
            className={`flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white px-6 py-20 text-center disabled:opacity-60 ${
              dragOver ? 'border-[#1A73E8] bg-[#f8fbff]' : 'border-slate-300 hover:border-[#1A73E8] hover:bg-[#f8fbff]'
            }`}
          >
            <span className="text-lg font-bold text-slate-800">
              {busy ? 'Uploading…' : 'Drop in a .docx or .xlsx'}
            </span>
            <span className="max-w-md text-sm text-slate-500">
              We open your file exactly as it is — formulas, columns, and layout stay intact. No quotation rebuild.
            </span>
          </button>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {officeEnabled === false && doc.type === 'word' ? (
              <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
                Preview only — start OnlyOffice for full Word editing and save.
              </p>
            ) : null}
            <NativeDocumentEditor
              doc={doc}
              height="calc(100vh - 140px)"
              excelFallback={
                <div className="px-6 py-10 text-sm text-slate-600">
                  <p className="font-semibold text-slate-800">Excel editing needs OnlyOffice.</p>
                  <p className="mt-2">
                    That keeps formulas and sheet layout the same as desktop Excel. Start the document server
                    (`docker compose -f docker-compose.onlyoffice.yml up -d`), set{' '}
                    <code className="rounded bg-slate-100 px-1">ONLYOFFICE_URL</code> in{' '}
                    <code className="rounded bg-slate-100 px-1">.env</code>, restart the API, then reopen this file.
                  </p>
                </div>
              }
            />
          </div>
        )}
      </div>
    </main>
  )
}
