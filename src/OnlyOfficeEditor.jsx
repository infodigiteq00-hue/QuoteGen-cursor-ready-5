import React, { useEffect, useState } from 'react'
import { DocumentEditor } from '@onlyoffice/document-editor-react'

async function readApiResponse(response) {
  const text = await response.text()
  if (!text) throw new Error('Server returned an empty response.')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Server returned an invalid response.')
  }
}

/** Full-fidelity in-browser Word/Excel editor via OnlyOffice Document Server. */
export default function OnlyOfficeEditor({ fileId, mode = 'edit', height = 'calc(100vh - 180px)' }) {
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    fetch(`/api/office/config/${encodeURIComponent(fileId)}?mode=${mode}`)
      .then(readApiResponse)
      .then((data) => {
        if (!cancelled) setPayload(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Could not start document editor.')
      })
    return () => { cancelled = true }
  }, [fileId, mode])

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    )
  }

  if (!payload?.documentServerUrl || !payload?.config) {
    return <p className="text-sm text-slate-500">Starting document editor…</p>
  }

  return (
    <div className="onlyoffice-editor-wrap" style={{ height, minHeight: 480 }}>
      <DocumentEditor
        id={`onlyoffice-${fileId}`}
        documentServerUrl={payload.documentServerUrl}
        config={payload.config}
        width="100%"
        height="100%"
      />
    </div>
  )
}
