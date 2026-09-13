/**
 * Original .docx / .xlsx bytes for uploaded layouts.
 * Prefer Supabase Storage + upload_files when configured; fall back to local disk.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { getDataDir } from './runtimeFs.js'
import { getSupabase, isSupabaseConfigured } from './db.js'

const BUCKET = 'upload-templates'

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

function mapMetaRow(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id || null,
    fileName: row.file_name || 'upload.bin',
    mimeType: row.mime_type || 'application/octet-stream',
    kind: row.kind || 'word',
    size: row.size ?? null,
    storagePath: row.storage_path || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  }
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

function saveLocal(buffer, { id, fileName, mimeType, kind, userId }) {
  const fileId = id || newUploadFileId()
  fs.writeFileSync(binPath(fileId), buffer)
  const meta = {
    id: fileId,
    userId: userId || null,
    fileName: fileName || 'upload.bin',
    mimeType: mimeType || 'application/octet-stream',
    kind: kind || 'word',
    size: buffer.length,
    createdAt: new Date().toISOString()
  }
  fs.writeFileSync(metaPath(fileId), JSON.stringify(meta, null, 2))
  return fileId
}

async function ensureBucket(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) throw error
  const existing = (buckets || []).find(b => b.id === BUCKET || b.name === BUCKET)
  if (existing) {
    if (existing.public !== false) {
      await supabase.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: 26214400 }).catch(() => {})
    }
    return
  }
  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 26214400
  })
  if (createError && !/already exists|duplicate/i.test(createError.message || '')) throw createError
}

/** Persist the original uploaded .docx / .xlsx bytes — layout fidelity comes from this file. */
export async function saveUploadFile(buffer, { fileName, mimeType, kind, userId } = {}) {
  const id = newUploadFileId()
  const meta = {
    fileName: fileName || 'upload.bin',
    mimeType: mimeType || 'application/octet-stream',
    kind: kind === 'excel' ? 'excel' : 'word'
  }

  // When Supabase is configured, always store there (never grow local disk).
  if (isSupabaseConfigured()) {
    if (!userId) {
      const err = new Error('Sign in to upload layouts.')
      err.status = 401
      err.code = 'UNAUTHENTICATED'
      throw err
    }
    const supabase = getSupabase()
    await ensureBucket(supabase)
    const storagePath = `${userId}/${id}.bin`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: meta.mimeType,
        upsert: true,
        cacheControl: '0'
      })
    if (upErr) {
      const err = new Error(upErr.message || 'Could not upload file to storage.')
      err.status = 502
      err.code = 'STORAGE_UPLOAD_FAILED'
      throw err
    }
    const { error: dbErr } = await supabase.from('upload_files').insert({
      id,
      user_id: userId,
      file_name: meta.fileName,
      mime_type: meta.mimeType,
      kind: meta.kind,
      size: buffer.length,
      storage_path: storagePath
    })
    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
      const err = new Error(dbErr.message || 'Could not save upload metadata.')
      err.status = 502
      err.code = 'UPLOAD_META_FAILED'
      throw err
    }
    console.info('[upload-files] saved to supabase', { id, userId, bytes: buffer.length })
    return id
  }

  return saveLocal(buffer, { id, ...meta, userId })
}

export async function readUploadFileMeta(id) {
  if (!id) return null
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('upload_files')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (!error && data) return mapMetaRow(data)
    } catch (error) {
      console.warn('[upload-files] supabase meta read failed', error?.message || error)
    }
  }
  return readLocalMeta(id)
}

export async function readUploadFileBuffer(id) {
  if (!id) return null
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabase()
      const { data: row, error } = await supabase
        .from('upload_files')
        .select('storage_path')
        .eq('id', id)
        .maybeSingle()
      if (!error && row?.storage_path) {
        const { data, error: dlErr } = await supabase.storage.from(BUCKET).download(row.storage_path)
        if (!dlErr && data) return Buffer.from(await data.arrayBuffer())
      }
    } catch (error) {
      console.warn('[upload-files] supabase buffer read failed', error?.message || error)
    }
  }
  return readLocalBuffer(id)
}

export async function updateUploadFile(id, buffer, { fileName } = {}) {
  if (!id || !buffer) return false
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()
    const { data: row, error } = await supabase
      .from('upload_files')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (row?.storage_path) {
      await ensureBucket(supabase)
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(row.storage_path, buffer, {
          contentType: row.mime_type || 'application/octet-stream',
          upsert: true,
          cacheControl: '0'
        })
      if (upErr) throw upErr
      const patch = { size: buffer.length, updated_at: new Date().toISOString() }
      if (fileName) patch.file_name = fileName
      const { error: dbErr } = await supabase.from('upload_files').update(patch).eq('id', id)
      if (dbErr) throw dbErr
      return true
    }
    // Not in Supabase — may be a legacy local file.
  }

  if (!readLocalMeta(id)) return false
  fs.writeFileSync(binPath(id), buffer)
  if (fileName) {
    const meta = readLocalMeta(id)
    meta.fileName = fileName
    meta.size = buffer.length
    meta.updatedAt = new Date().toISOString()
    fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2))
  }
  return true
}

export async function deleteUploadFile(id) {
  if (!id) return
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabase()
      const { data: row } = await supabase
        .from('upload_files')
        .select('storage_path')
        .eq('id', id)
        .maybeSingle()
      if (row?.storage_path) {
        await supabase.storage.from(BUCKET).remove([row.storage_path]).catch(() => {})
      }
      await supabase.from('upload_files').delete().eq('id', id)
    } catch (error) {
      console.warn('[upload-files] supabase delete failed', error?.message || error)
    }
  }
  try {
    if (fs.existsSync(binPath(id))) fs.unlinkSync(binPath(id))
    if (fs.existsSync(metaPath(id))) fs.unlinkSync(metaPath(id))
  } catch { /* ignore */ }
}

export async function copyUploadFile(id, userId) {
  const buf = await readUploadFileBuffer(id)
  const meta = await readUploadFileMeta(id)
  if (!buf || !meta) return null
  return saveUploadFile(buf, {
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    kind: meta.kind,
    userId: userId || meta.userId
  })
}
