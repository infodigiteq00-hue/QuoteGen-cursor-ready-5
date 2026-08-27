import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getDataDir } from './runtimeFs.js'
import { getSupabase, isSupabaseConfigured } from './db.js'

export const UPLOAD_FILE_BUCKET = 'upload-templates'
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MISSING_SCHEMA = /relation|does not exist|schema cache|PGRST20[24]|42P01|42703|Could not find the table/i

let bucketReady = false

function isMissingSchema(error) {
  return MISSING_SCHEMA.test(String(error?.message || error?.code || ''))
}

function supabaseOrNull() {
  if (!isSupabaseConfigured()) return null
  try {
    return getSupabase()
  } catch {
    return null
  }
}

async function ensureUploadBucket(supabase) {
  if (bucketReady) return
  const options = { public: false, fileSizeLimit: MAX_FILE_BYTES }
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) throw error
  const exists = (buckets || []).some(b => b.name === UPLOAD_FILE_BUCKET || b.id === UPLOAD_FILE_BUCKET)
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(UPLOAD_FILE_BUCKET, options)
    if (createError && !/already exists|duplicate/i.test(createError.message || '')) throw createError
  }
  bucketReady = true
}

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

function readLocalMeta(id) {
  const p = metaPath(id)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function readLocalBuffer(id) {
  const p = binPath(id)
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p)
}

function writeLocalFile(id, buffer, meta) {
  fs.writeFileSync(binPath(id), buffer)
  fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2))
}

function mapFileRow(row) {
  if (!row) return null
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    kind: row.kind,
    size: row.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: row.user_id,
    storagePath: row.storage_path
  }
}

export function newUploadFileId() {
  return `uf_${randomBytes(12).toString('hex')}`
}

async function saveFileToSupabase(id, buffer, meta) {
  const supabase = supabaseOrNull()
  if (!supabase || !meta.userId) return false
  try {
    await ensureUploadBucket(supabase)
    const storagePath = meta.storagePath || `${meta.userId}/${id}`
    const { error: upErr } = await supabase.storage
      .from(UPLOAD_FILE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: meta.mimeType || 'application/octet-stream',
        upsert: true
      })
    if (upErr) throw upErr
    const { error } = await supabase.from('upload_files').upsert({
      id,
      user_id: meta.userId,
      file_name: meta.fileName || 'upload.bin',
      mime_type: meta.mimeType || 'application/octet-stream',
      kind: meta.kind || 'word',
      size: buffer.length,
      storage_path: storagePath,
      created_at: meta.createdAt || new Date().toISOString(),
      updated_at: meta.updatedAt || meta.createdAt || new Date().toISOString()
    }, { onConflict: 'id' })
    if (error) {
      if (isMissingSchema(error)) return false
      throw error
    }
    return true
  } catch (error) {
    if (isMissingSchema(error)) return false
    console.warn('[upload-files] supabase save failed, using local disk', error?.message || error)
    return false
  }
}

/** Persist the original uploaded .docx / .xlsx bytes — layout fidelity comes from this file. */
export async function saveUploadFile(buffer, { fileName, mimeType, kind, userId } = {}) {
  const id = newUploadFileId()
  const meta = {
    id,
    fileName: fileName || 'upload.bin',
    mimeType: mimeType || 'application/octet-stream',
    kind: kind || 'word',
    size: buffer.length,
    createdAt: new Date().toISOString(),
    userId: userId || null
  }
  if (await saveFileToSupabase(id, buffer, meta)) return id
  writeLocalFile(id, buffer, meta)
  return id
}

export async function readUploadFileMeta(id) {
  if (!id) return null
  const supabase = supabaseOrNull()
  if (supabase) {
    try {
      const { data, error } = await supabase.from('upload_files').select('*').eq('id', id).maybeSingle()
      if (!error && data) return mapFileRow(data)
      if (error && !isMissingSchema(error)) {
        console.warn('[upload-files] supabase meta read failed', error.message)
      }
    } catch (error) {
      console.warn('[upload-files] supabase meta read failed', error?.message || error)
    }
  }
  return readLocalMeta(id)
}

export async function readUploadFileBuffer(id) {
  if (!id) return null
  const meta = await readUploadFileMeta(id)
  const supabase = supabaseOrNull()
  if (supabase && meta?.storagePath) {
    try {
      const { data, error } = await supabase.storage.from(UPLOAD_FILE_BUCKET).download(meta.storagePath)
      if (!error && data) return Buffer.from(await data.arrayBuffer())
    } catch (error) {
      console.warn('[upload-files] supabase download failed', error?.message || error)
    }
  }
  return readLocalBuffer(id)
}

export async function updateUploadFile(id, buffer, { fileName } = {}) {
  const meta = await readUploadFileMeta(id)
  if (!meta) return false

  const supabase = supabaseOrNull()
  if (supabase && meta.storagePath) {
    try {
      await ensureUploadBucket(supabase)
      const { error: upErr } = await supabase.storage
        .from(UPLOAD_FILE_BUCKET)
        .upload(meta.storagePath, buffer, {
          contentType: meta.mimeType || 'application/octet-stream',
          upsert: true
        })
      if (upErr) throw upErr
      if (fileName) {
        const { error } = await supabase.from('upload_files').update({
          file_name: fileName,
          size: buffer.length,
          updated_at: new Date().toISOString()
        }).eq('id', id)
        if (error && !isMissingSchema(error)) throw error
      }
      return true
    } catch (error) {
      if (!isMissingSchema(error)) {
        console.warn('[upload-files] supabase update failed', error?.message || error)
      }
    }
  }

  fs.writeFileSync(binPath(id), buffer)
  if (fileName) {
    const next = { ...meta, fileName, size: buffer.length, updatedAt: new Date().toISOString() }
    fs.writeFileSync(metaPath(id), JSON.stringify(next, null, 2))
  }
  return true
}

export async function deleteUploadFile(id) {
  const meta = await readUploadFileMeta(id)
  const supabase = supabaseOrNull()
  if (supabase && meta?.storagePath) {
    try {
      await supabase.storage.from(UPLOAD_FILE_BUCKET).remove([meta.storagePath])
      await supabase.from('upload_files').delete().eq('id', id)
    } catch { /* ignore */ }
  }
  try {
    if (fs.existsSync(binPath(id))) fs.unlinkSync(binPath(id))
    if (fs.existsSync(metaPath(id))) fs.unlinkSync(metaPath(id))
  } catch { /* ignore */ }
}

export async function copyUploadFile(id) {
  const buf = await readUploadFileBuffer(id)
  const meta = await readUploadFileMeta(id)
  if (!buf || !meta) return null
  return saveUploadFile(buf, {
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    kind: meta.kind,
    userId: meta.userId
  })
}

/** Copy a leftover local-disk file into Supabase so the other environment can read it. */
export async function migrateLocalFileToSupabase(id, userId) {
  if (!id || !userId) return null
  const existing = await readUploadFileMeta(id)
  if (existing?.storagePath) return existing
  const localMeta = readLocalMeta(id)
  const buf = readLocalBuffer(id)
  if (!localMeta || !buf) return existing || null
  const owner = localMeta.userId || userId
  const meta = {
    ...localMeta,
    userId: owner,
    storagePath: `${owner}/${id}`
  }
  const ok = await saveFileToSupabase(id, buf, meta)
  return ok ? { ...meta, id } : (existing || localMeta)
}
