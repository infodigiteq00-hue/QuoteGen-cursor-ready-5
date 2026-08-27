import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getDataDir } from './runtimeFs.js'

function filesDir() {
  const dir = path.join(getDataDir(), 'upload-files')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function metaPath(id) {
  return path.join(filesDir(), `${id}.json`)
}

function binPath(id) {
  return path.join(filesDir(), `${id}.bin`)
}

export function newUploadFileId() {
  return `uf_${randomBytes(12).toString('hex')}`
}

/** Persist the original uploaded .docx / .xlsx bytes — layout fidelity comes from this file. */
export function saveUploadFile(buffer, { fileName, mimeType, kind }) {
  const id = newUploadFileId()
  fs.writeFileSync(binPath(id), buffer)
  fs.writeFileSync(metaPath(id), JSON.stringify({
    id,
    fileName: fileName || 'upload.bin',
    mimeType: mimeType || 'application/octet-stream',
    kind: kind || 'word',
    size: buffer.length,
    createdAt: new Date().toISOString()
  }, null, 2))
  return id
}

export function readUploadFileMeta(id) {
  const p = metaPath(id)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

export function readUploadFileBuffer(id) {
  const p = binPath(id)
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p)
}

export function updateUploadFile(id, buffer, { fileName } = {}) {
  if (!readUploadFileMeta(id)) return false
  fs.writeFileSync(binPath(id), buffer)
  if (fileName) {
    const meta = readUploadFileMeta(id)
    meta.fileName = fileName
    meta.size = buffer.length
    meta.updatedAt = new Date().toISOString()
    fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2))
  }
  return true
}

export function deleteUploadFile(id) {
  try {
    if (fs.existsSync(binPath(id))) fs.unlinkSync(binPath(id))
    if (fs.existsSync(metaPath(id))) fs.unlinkSync(metaPath(id))
  } catch { /* ignore */ }
}

export function copyUploadFile(id) {
  const buf = readUploadFileBuffer(id)
  const meta = readUploadFileMeta(id)
  if (!buf || !meta) return null
  return saveUploadFile(buf, {
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    kind: meta.kind
  })
}
