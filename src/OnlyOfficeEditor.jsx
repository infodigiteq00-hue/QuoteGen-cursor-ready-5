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
  const [editorError, setEditorError] = useState('')

  useEffect(() => {
    let cancelled = false
    setError('')
    setEditorError('')
    const boot = async () => {
      try {
        const statusRes = await fetch('/api/office/status')
        const status = await readApiResponse(statusRes)
        if (!statusRes.ok) throw new Error(status.error || 'Could not reach document server settings.')
        if (!status.enabled || !status.url) {
          throw new Error('OnlyOffice is not configured. Set ONLYOFFICE_URL in .env and restart the API.')
        }
        if (status.healthy === false) {
          throw new Error(
            'OnlyOffice Document Server is not running. Start it with: docker compose -f docker-compose.onlyoffice.yml up -d'
          )
        }
        const response = await fetch(`/api/office/config/${encodeURIComponent(fileId)}?mode=${mode}`)
        const data = await readApiResponse(response)
        if (!response.ok) throw new Error(data.error || 'Could not start document editor.')
        if (!cancelled) setPayload({ ...data, documentServerUrl: data.documentServerUrl || status.url })
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not start document editor.')
      }
    }
    boot()
    return () => { cancelled = true }
  }, [fileId, mode])

  const displayError = editorError || error

  if (displayError) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {displayError}
      </div>
    )
  }

  if (!payload?.documentServerUrl || !payload?.config) {
    return <p className="p-4 text-sm text-slate-500">Starting document editor…</p>
  }

  return (
    <div className="onlyoffice-editor-wrap" style={{ height, minHeight: 480 }}>
      <DocumentEditor
        id={`onlyoffice-${fileId}`}
        documentServerUrl={payload.documentServerUrl}
        config={payload.config}
        width="100%"
        height="100%"
        events_onError={(event) => {
          const msg = event?.data?.errorDescription || event?.data?.errorCode || 'Document editor error.'
          setEditorError(String(msg))
        }}
      />
    </div>
  )
}
