import React, { useEffect, useState } from 'react'
import DocxPreview from './DocxPreview.jsx'
import OnlyOfficeEditor from './OnlyOfficeEditor.jsx'

async function readApiResponse(response) {
  const text = await response.text()
  if (!text) throw new Error('Server returned an empty response.')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Server returned an invalid response.')
  }
}

/**
 * Renders the uploaded file with a real document engine — not reconstructed HTML.
 * OnlyOffice = edit Word/Excel with full layout. docx-preview = exact Word view fallback.
 */
export default function NativeDocumentEditor({
  doc,
  excelFallback = null,
  height = 'calc(100vh - 180px)'
}) {
  const [office, setOffice] = useState(null)
  const [officeHealthy, setOfficeHealthy] = useState(true)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    fetch('/api/office/status')
      .then(readApiResponse)
      .then(d => {
        setOffice(Boolean(d.enabled))
        setOfficeHealthy(d.healthy !== false)
      })
      .catch((e) => {
        setOffice(false)
        setOfficeHealthy(false)
        setStatusError(e.message || 'Could not reach document server.')
      })
  }, [])

  if (office === null) {
    return <p className="text-sm text-slate-500">Loading document…</p>
  }

  if (office && doc.fileId && officeHealthy) {
    return <OnlyOfficeEditor fileId={doc.fileId} height={height} />
  }

  if (office && doc.fileId && !officeHealthy) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        OnlyOffice Document Server is not reachable. Start it with{' '}
        <code className="rounded bg-white/80 px-1">docker compose -f docker-compose.onlyoffice.yml up -d</code>
        {statusError ? <p className="mt-2 text-amber-800">{statusError}</p> : null}
      </div>
    )
  }

  if (doc.type === 'word' && doc.fileId) {
    return <DocxPreview fileId={doc.fileId} />
  }

  if (excelFallback) return excelFallback

  return (
    <div className="rounded-xl border border-sand bg-white px-4 py-6 text-sm text-slate-600">
      Could not open this document in the native editor. Try re-uploading the file, or start OnlyOffice.
    </div>
  )
}
