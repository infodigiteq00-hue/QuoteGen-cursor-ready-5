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

  useEffect(() => {
    fetch('/api/office/status')
      .then(readApiResponse)
      .then(d => setOffice(Boolean(d.enabled)))
      .catch(() => setOffice(false))
  }, [])

  if (office === null) {
    return <p className="text-sm text-slate-500">Loading document…</p>
  }

  if (office && doc.fileId) {
    return <OnlyOfficeEditor fileId={doc.fileId} height={height} />
  }

  if (doc.type === 'word' && doc.fileId) {
    return <DocxPreview fileId={doc.fileId} />
  }

  if (excelFallback) return excelFallback

  return null
}
