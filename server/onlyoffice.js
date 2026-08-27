import crypto from 'node:crypto'
import { readUploadFileBuffer, readUploadFileMeta, updateUploadFile } from './uploadFileStorage.js'

const OFFICE_SECRET = () => process.env.OFFICE_FILE_SECRET || process.env.ONLYOFFICE_JWT_SECRET || 'quotegen-dev-office'

export function officePublicBase(req) {
  if (process.env.PUBLIC_API_URL) return process.env.PUBLIC_API_URL.replace(/\/$/, '')
  const host = req.get('host') || 'localhost:3001'
  const proto = req.protocol || 'http'
  return `${proto}://${host}`
}

/** URL OnlyOffice Document Server uses to download the file (no session cookie). */
export function signedOfficeFileUrl(req, fileId, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec
  const sig = crypto.createHmac('sha256', OFFICE_SECRET()).update(`${fileId}:${exp}`).digest('hex')
  const base = officePublicBase(req)
  return `${base}/api/office/files/${encodeURIComponent(fileId)}?exp=${exp}&sig=${sig}`
}

export function verifyOfficeFileToken(fileId, exp, sig) {
  if (!fileId || !exp || !sig) return false
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false
  const expected = crypto.createHmac('sha256', OFFICE_SECRET()).update(`${fileId}:${exp}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(sig), 'hex'))
  } catch {
    return false
  }
}

export function onlyOfficeDocumentServerUrl() {
  return (process.env.ONLYOFFICE_URL || process.env.DOCUMENT_SERVER_URL || '').replace(/\/$/, '')
}

export function onlyOfficeEnabled() {
  return Boolean(onlyOfficeDocumentServerUrl())
}

export async function buildOnlyOfficeConfig(req, { fileId, fileName, kind, mode = 'edit', keySuffix = '' }) {
  const meta = await readUploadFileMeta(fileId)
  if (!meta) return null
  const ext = (fileName || meta.fileName || '').split('.').pop()?.toLowerCase()
  const fileType = kind === 'excel' ? (ext === 'xlsm' ? 'xlsm' : 'xlsx') : 'docx'
  const documentType = kind === 'excel' ? 'cell' : 'word'
  const key = crypto.createHash('sha1').update(`${fileId}:${meta.updatedAt || meta.createdAt}:${keySuffix}`).digest('hex')

  const base = officePublicBase(req)
  return {
    documentType,
    document: {
      fileType,
      key,
      title: fileName || meta.fileName || `layout.${fileType}`,
      url: signedOfficeFileUrl(req, fileId)
    },
    editorConfig: {
      mode,
      lang: 'en',
      callbackUrl: `${base}/api/office/callback?fileId=${encodeURIComponent(fileId)}`,
      customization: {
        autosave: true,
        forcesave: true,
        compactToolbar: false
      }
    }
  }
}

async function downloadOnlyOfficeSavedBody(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OnlyOffice download failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/** OnlyOffice routes — registered before session auth so Document Server can fetch/save. */
export function registerOnlyOfficeRoutes(app) {
  app.get('/api/office/files/:fileId', async (req, res) => {
    const { fileId } = req.params
    const { exp, sig } = req.query
    if (!verifyOfficeFileToken(fileId, exp, sig)) {
      return res.status(403).json({ error: 'Invalid or expired file token.' })
    }
    const meta = await readUploadFileMeta(fileId)
    const buf = await readUploadFileBuffer(fileId)
    if (!meta || !buf) return res.status(404).json({ error: 'File not found.' })
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${String(meta.fileName || 'file').replace(/"/g, '')}"`)
    res.send(buf)
  })

  app.post('/api/office/callback', async (req, res) => {
    try {
      const fileId = String(req.query.fileId || '')
      const body = req.body || {}
      const status = Number(body.status)
      // 2 = ready for save, 6 = forcesave
      if ((status === 2 || status === 6) && body.url && fileId) {
        const buf = await downloadOnlyOfficeSavedBody(body.url)
        await updateUploadFile(fileId, buf)
      }
      res.json({ error: 0 })
    } catch (error) {
      console.error('[onlyoffice] callback failed', error)
      res.json({ error: 1 })
    }
  })
}

export function registerOnlyOfficeAuthRoutes(app) {
  app.get('/api/office/status', (_req, res) => {
    res.json({ enabled: onlyOfficeEnabled(), url: onlyOfficeDocumentServerUrl() || null })
  })

  app.get('/api/office/config/:fileId', async (req, res) => {
    if (!onlyOfficeEnabled()) {
      return res.status(503).json({ error: 'OnlyOffice Document Server is not configured. Set ONLYOFFICE_URL.' })
    }
    const meta = await readUploadFileMeta(req.params.fileId)
    if (!meta) return res.status(404).json({ error: 'File not found.' })
    const config = await buildOnlyOfficeConfig(req, {
      fileId: req.params.fileId,
      fileName: meta.fileName,
      kind: meta.kind,
      mode: req.query.mode === 'view' ? 'view' : 'edit'
    })
    if (!config) return res.status(404).json({ error: 'File not found.' })
    res.json({
      documentServerUrl: onlyOfficeDocumentServerUrl(),
      config
    })
  })

  app.get('/api/upload-files/:fileId', async (req, res) => {
    const meta = await readUploadFileMeta(req.params.fileId)
    const buf = await readUploadFileBuffer(req.params.fileId)
    if (!meta || !buf) return res.status(404).json({ error: 'File not found.' })
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream')
    res.send(buf)
  })
}
