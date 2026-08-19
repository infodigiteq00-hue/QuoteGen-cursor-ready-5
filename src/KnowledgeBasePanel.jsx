import React, { useEffect, useRef, useState } from 'react'
import {
  deleteKnowledgeDocument,
  getKnowledgeDocument,
  listKnowledgeDocuments,
  listProducts,
  saveProduct,
  SUPABASE_SETUP_HINT,
  uploadKnowledgeDocuments
} from './quotePersistence.js'

const ACCEPT =
  '.pdf,.docx,.xlsx,.xlsm,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,' +
  'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,image/*'

function formatBytes(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function KnowledgeBasePanel({
  open,
  onToggle,
  persistenceConfigured,
  onUnavailable
}) {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [viewing, setViewing] = useState(null)
  const [viewLoading, setViewLoading] = useState(false)
  const fileRef = useRef(null)
  const [products, setProducts] = useState([])
  const [keywordDrafts, setKeywordDrafts] = useState({})
  const [keywordSaving, setKeywordSaving] = useState('')
  const [keywordFilter, setKeywordFilter] = useState('')

  const refreshProducts = async () => {
    if (!persistenceConfigured) {
      setProducts([])
      return
    }
    try {
      const result = await listProducts()
      if (result.unavailable) {
        onUnavailable?.()
        setProducts([])
        return
      }
      const list = result.products || []
      setProducts(list)
      setKeywordDrafts(Object.fromEntries(list.map(p => [p.key, p.keywords || ''])))
    } catch (e) {
      setError(e.message || 'Could not load products')
    }
  }

  const refresh = async () => {
    if (!persistenceConfigured) {
      setDocuments([])
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await listKnowledgeDocuments()
      if (result.unavailable) {
        onUnavailable?.()
        setDocuments([])
        return
      }
      setDocuments(result.documents)
    } catch (e) {
      setError(e.message || 'Could not load knowledge base')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open || persistenceConfigured) {
      refresh()
      refreshProducts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, persistenceConfigured])

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    setError('')
    setMessage('')
    try {
      const result = await uploadKnowledgeDocuments(files)
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      const okCount = result.documents?.length || 0
      const failCount = result.failed?.length || 0
      const parts = [`Saved ${okCount} file${okCount === 1 ? '' : 's'}.`]
      if (result.productsUpserted) parts.push(`Learned ${result.productsUpserted} product row${result.productsUpserted === 1 ? '' : 's'}.`)
      if (failCount) parts.push(`${failCount} failed.`)
      setMessage(parts.join(' '))
      if (failCount) {
        setError(result.failed.map(f => `${f.filename}: ${f.error}`).join(' · '))
      }
      await refresh()
      await refreshProducts()
    } catch (err) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id, filename) => {
    if (!window.confirm(`Remove “${filename}” from the knowledge base?`)) return
    setError('')
    try {
      const result = await deleteKnowledgeDocument(id)
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      setDocuments(prev => prev.filter(d => d.id !== id))
      if (viewing?.id === id) setViewing(null)
      setMessage('Document removed.')
    } catch (e) {
      setError(e.message || 'Could not delete')
    }
  }

  const handleView = async (id) => {
    setViewLoading(true)
    setError('')
    try {
      const result = await getKnowledgeDocument(id)
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      setViewing(result.document)
    } catch (e) {
      setError(e.message || 'Could not open document')
    } finally {
      setViewLoading(false)
    }
  }

  const handleSaveKeywords = async (product) => {
    setKeywordSaving(product.key)
    setError('')
    setMessage('')
    try {
      const result = await saveProduct({
        key: product.key,
        description: product.description,
        hsn: product.hsn,
        gst: product.gst,
        rate: product.rate,
        keywords: keywordDrafts[product.key] ?? product.keywords ?? ''
      })
      if (result.unavailable) {
        onUnavailable?.()
        setError(SUPABASE_SETUP_HINT)
        return
      }
      const saved = result.product
      setProducts(prev => prev.map(p => (p.key === product.key ? { ...p, ...saved, keywords: saved?.keywords ?? keywordDrafts[product.key] } : p)))
      if (saved?.keywords != null) {
        setKeywordDrafts(d => ({ ...d, [product.key]: saved.keywords }))
      }
      setMessage(`Saved keywords for ${product.description || product.key}.`)
    } catch (e) {
      setError(e.message || 'Could not save keywords')
    } finally {
      setKeywordSaving('')
    }
  }

  return (
    <div className="mb-5 rounded-3xl border border-sand bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Knowledge base</h2>
          <p className="mt-1 text-xs text-slate-500">
            Upload catalogues, bills, or old quotations. Add local names for products so enquiry slang matches your catalogue.
          </p>
        </div>
        <button type="button" onClick={onToggle} className="text-sm font-medium text-moss">
          {open ? 'Hide knowledge base' : 'Manage knowledge base'}
        </button>
      </div>

      {!persistenceConfigured && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{SUPABASE_SETUP_HINT}</p>
      )}

      {persistenceConfigured && !open && (
        <p className="mt-3 text-sm text-slate-500">
          {loading ? 'Loading…' : `${documents.length} document${documents.length === 1 ? '' : 's'} remembered`}
          {documents.length ? ' — open to upload, preview, or delete.' : ' — open to upload your first file.'}
        </p>
      )}

      {open && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-sand bg-[#f7f9f7] p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">Product keywords</p>
                <p className="mt-1 text-xs text-slate-500">
                  Comma-separated local names. Example: if the catalogue item is “blades”, add <span className="font-medium">plates, bags</span>. Enquiry wording stays as written; Our suggested shows the standard name.
                </p>
              </div>
              <input
                type="search"
                value={keywordFilter}
                onChange={e => setKeywordFilter(e.target.value)}
                placeholder="Find a product"
                className="w-full max-w-[220px] rounded-lg border border-sand bg-white px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-50"
              />
            </div>
            {!products.length ? (
              <p className="mt-3 text-sm text-slate-400">No saved products yet. Quote an item or upload a catalogue first.</p>
            ) : (
              <ul className="mt-3 max-h-72 divide-y divide-sand overflow-auto rounded-xl border border-sand bg-white">
                {products
                  .filter(p => {
                    const q = keywordFilter.trim().toLowerCase()
                    if (!q) return true
                    return [p.description, p.key, p.keywords, keywordDrafts[p.key]].join(' ').toLowerCase().includes(q)
                  })
                  .map(p => (
                    <li key={p.key} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                      <div className="min-w-0 sm:w-44">
                        <p className="truncate text-sm font-medium text-slate-800">{p.description || p.key}</p>
                        {p.hsn ? <p className="text-[11px] text-slate-400">HSN {p.hsn}</p> : null}
                      </div>
                      <input
                        value={keywordDrafts[p.key] ?? p.keywords ?? ''}
                        onChange={e => setKeywordDrafts(d => ({ ...d, [p.key]: e.target.value }))}
                        placeholder="plates, bags, local name"
                        className="min-w-0 flex-1 rounded-lg border border-sand px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-50"
                      />
                      <button
                        type="button"
                        disabled={keywordSaving === p.key}
                        onClick={() => handleSaveKeywords(p)}
                        className="shrink-0 rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
                      >
                        {keywordSaving === p.key ? 'Saving…' : 'Save'}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-dashed border-sand bg-[#f7f9f7] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-700">Upload files</p>
                <p className="mt-1 text-xs text-slate-500">
                  PDF, Word (.docx), Excel (.xlsx), CSV, plain text, or images (OCR). Multiple files OK · max 20&nbsp;MB each.
                </p>
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={handleUpload}
                  disabled={!persistenceConfigured || uploading}
                />
                <button
                  type="button"
                  disabled={!persistenceConfigured || uploading}
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white hover:bg-[#1558b0] disabled:opacity-50"
                >
                  {uploading ? 'Extracting…' : 'Upload files'}
                </button>
              </div>
            </div>
          </div>

          {message && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-moss">{message}</p>}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Stored documents</p>
            <button type="button" onClick={refresh} disabled={loading} className="text-xs font-medium text-moss hover:underline disabled:opacity-50">
              Refresh
            </button>
          </div>

          {loading && !documents.length ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : !documents.length ? (
            <p className="text-sm text-slate-400">No documents yet.</p>
          ) : (
            <ul className="divide-y divide-sand rounded-2xl border border-sand">
              {documents.map(doc => (
                <li key={doc.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{doc.filename}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {(doc.mime || 'file').split(';')[0]}
                      {doc.charCount != null ? ` · ${doc.charCount.toLocaleString()} chars` : ''}
                      {doc.metadata?.productCount ? ` · ${doc.metadata.productCount} products spotted` : ''}
                      {doc.createdAt ? ` · ${new Date(doc.createdAt).toLocaleString()}` : ''}
                    </p>
                    {doc.snippet && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{doc.snippet}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleView(doc.id)}
                      disabled={viewLoading}
                      className="rounded-lg border border-sand bg-white px-2.5 py-1 text-xs font-semibold text-moss hover:bg-blue-50"
                    >
                      View text
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id, doc.filename)}
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {viewing && (
            <div className="rounded-2xl border border-sand bg-[#fbfcfb] p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-700">{viewing.filename}</p>
                <button type="button" onClick={() => setViewing(null)} className="text-xs text-slate-400 hover:text-slate-600">Close</button>
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs leading-relaxed text-slate-600 ring-1 ring-sand">
                {viewing.extractedText || viewing.snippet || '(empty)'}
              </pre>
              {viewing.metadata?.sizeBytes ? (
                <p className="mt-2 text-[11px] text-slate-400">Source size {formatBytes(viewing.metadata.sizeBytes)}</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
