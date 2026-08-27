import React, { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'

async function readApiResponse(response) {
  const text = await response.text()
  if (!text) throw new Error('Server returned an empty response.')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Server returned an invalid response.')
  }
}

/** Faithful Word layout — renders the original .docx, not converted HTML. */
export default function DocxPreview({ fileId, className = '' }) {
  const hostRef = useRef(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const res = await fetch(`/api/upload-files/${fileId}`)
        if (!res.ok) {
          const data = await readApiResponse(res).catch(() => ({}))
          throw new Error(data.error || 'Could not load document.')
        }
        const blob = await res.blob()
        if (cancelled || !hostRef.current) return
        hostRef.current.innerHTML = ''
        await renderAsync(blob, hostRef.current, null, {
          className: 'docx',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          useBase64URL: true
        })
      } catch (e) {
        if (!cancelled) setError(e.message || 'Preview failed.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [fileId])

  return (
    <div className={`docx-preview-shell ${className}`.trim()}>
      {loading && <p className="docx-preview-status">Opening your Word file…</p>}
      {error && <p className="docx-preview-error">{error}</p>}
      <div ref={hostRef} className="docx-preview-host" />
    </div>
  )
}
