/**
 * Image and attachment cells for typed quotation columns.
 * Uploads go to the public `quote-assets` bucket; inline data URLs are the fallback
 * so cells keep working when Storage is unavailable (same shape as the logo flow).
 */
import multer from 'multer'
import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'

const QUOTE_ASSET_BUCKET = 'quote-assets'
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_INLINE_BYTES = 400 * 1024

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
const FILE_MIMES = [
  ...IMAGE_MIMES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream'
]
const FILE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip'
])

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES }
})

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES }
})

async function ensureQuoteAssetBucket(supabase) {
  const options = {
    public: true,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: FILE_MIMES
  }
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) throw error
  const exists = (buckets || []).some(b => b.name === QUOTE_ASSET_BUCKET || b.id === QUOTE_ASSET_BUCKET)
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(QUOTE_ASSET_BUCKET, options)
    if (createError && !/already exists|duplicate/i.test(createError.message || '')) throw createError
    return
  }
  try {
    await supabase.storage.updateBucket(QUOTE_ASSET_BUCKET, options)
  } catch {
    /* older buckets still accept uploads through the service role */
  }
}

function extensionForImage(mime) {
  if (mime.includes('svg')) return 'svg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  return 'jpg'
}

function extensionFromName(name, fallback = 'bin') {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = match?.[1] || ''
  return FILE_EXTS.has(ext) ? ext : fallback
}

function isAllowedFile(file) {
  const mime = String(file.mimetype || '').toLowerCase()
  const ext = extensionFromName(file.originalname || file.name, '')
  if (FILE_EXTS.has(ext)) return true
  if (IMAGE_MIMES.includes(mime)) return true
  if (FILE_MIMES.includes(mime) && mime !== 'application/octet-stream') return true
  return false
}

function dataUrlFromBuffer(buffer, mime) {
  return `data:${mime || 'application/octet-stream'};base64,${buffer.toString('base64')}`
}

function ownAssetPath(userId, path) {
  return path.startsWith(`quote-images/${userId}/`) || path.startsWith(`quote-files/${userId}/`)
}

function inlineOrFail(res, file, requestId, kind) {
  if (file.buffer.length > MAX_INLINE_BYTES) {
    return res.status(502).json({
      error: `Could not store the ${kind} in Supabase Storage, and it is too large to embed inline (400 KB max). Try a smaller file.`,
      code: 'STORAGE_ERROR',
      requestId
    })
  }
  return res.json({
    url: dataUrlFromBuffer(file.buffer, file.mimetype),
    path: null,
    storage: 'inline',
    requestId
  })
}

export function registerQuoteAssetRoutes(app) {
  app.post('/api/quote-assets/image', (req, res) => {
    const requestId = `qa-img-${Date.now()}`
    imageUpload.single('image')(req, res, async (err) => {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? 'Image must be under 4 MB.'
          : (err.message || 'Image upload failed')
        return res.status(400).json({ error: message, code: 'VALIDATION_ERROR', requestId })
      }

      const file = req.file
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'image file is required.', code: 'VALIDATION_ERROR', requestId })
      }
      const mime = String(file.mimetype || '')
      const name = String(file.originalname || file.name || '')
      const looksImage = /^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i.test(mime)
        || /\.(png|jpe?g|webp|gif|svg)$/i.test(name)
      if (!looksImage) {
        return res.status(400).json({ error: 'File must be an image (png, jpg, webp, gif, or svg).', code: 'VALIDATION_ERROR', requestId })
      }
      const contentType = /^image\//i.test(mime) ? mime : `image/${extensionForImage(mime || name)}`

      if (!isSupabaseConfigured()) return inlineOrFail(res, file, requestId, 'image')

      try {
        const supabase = getSupabase()
        await ensureQuoteAssetBucket(supabase)
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const path = `quote-images/${req.userId}/${unique}.${extensionForImage(contentType)}`
        const { error: upErr } = await supabase.storage
          .from(QUOTE_ASSET_BUCKET)
          .upload(path, file.buffer, { contentType, upsert: true })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from(QUOTE_ASSET_BUCKET).getPublicUrl(path)
        if (!pub?.publicUrl) throw new Error('Storage did not return a public URL')
        res.json({ url: pub.publicUrl, path, storage: 'supabase', requestId })
      } catch (storageError) {
        console.warn(`[${requestId}] quote image storage failed, embedding inline`, storageError?.message || storageError)
        inlineOrFail(res, file, requestId, 'image')
      }
    })
  })

  app.post('/api/quote-assets/file', (req, res) => {
    const requestId = `qa-file-${Date.now()}`
    fileUpload.single('file')(req, res, async (err) => {
      if (err) {
        const message = err.code === 'LIMIT_FILE_SIZE'
          ? 'File must be under 8 MB.'
          : (err.message || 'File upload failed')
        return res.status(400).json({ error: message, code: 'VALIDATION_ERROR', requestId })
      }

      const file = req.file
      if (!file?.buffer?.length) {
        return res.status(400).json({ error: 'A file is required.', code: 'VALIDATION_ERROR', requestId })
      }
      if (!isAllowedFile(file)) {
        return res.status(400).json({
          error: 'Use a PDF, Word, Excel, PowerPoint, text, zip, or image file.',
          code: 'VALIDATION_ERROR',
          requestId
        })
      }

      const mime = String(file.mimetype || 'application/octet-stream')
      const ext = extensionFromName(file.originalname || file.name, extensionForImage(mime))

      if (!isSupabaseConfigured()) return inlineOrFail(res, file, requestId, 'file')

      try {
        const supabase = getSupabase()
        await ensureQuoteAssetBucket(supabase)
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const path = `quote-files/${req.userId}/${unique}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(QUOTE_ASSET_BUCKET)
          .upload(path, file.buffer, { contentType: mime, upsert: true })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from(QUOTE_ASSET_BUCKET).getPublicUrl(path)
        if (!pub?.publicUrl) throw new Error('Storage did not return a public URL')
        res.json({ url: pub.publicUrl, path, storage: 'supabase', requestId })
      } catch (storageError) {
        console.warn(`[${requestId}] quote file storage failed, embedding inline`, storageError?.message || storageError)
        inlineOrFail(res, file, requestId, 'file')
      }
    })
  })

  app.delete('/api/quote-assets/image', async (req, res) => {
    const requestId = `qa-img-del-${Date.now()}`
    const path = String(req.query.path || '').trim()
    if (!path) return res.json({ ok: true, removed: false })
    if (!isSupabaseConfigured()) return res.json({ ok: true, removed: false })
    if (!ownAssetPath(req.userId, path)) {
      return res.status(403).json({ error: 'Not your file.', code: 'FORBIDDEN', requestId })
    }
    try {
      const supabase = getSupabase()
      const { error } = await supabase.storage.from(QUOTE_ASSET_BUCKET).remove([path])
      if (error) throw error
      res.json({ ok: true, removed: true })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })
}
