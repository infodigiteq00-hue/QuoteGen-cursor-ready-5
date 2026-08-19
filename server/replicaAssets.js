import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomBytes } from 'crypto'
import { PDFParse } from 'pdf-parse'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ASSETS_ROOT = path.join(__dirname, '..', 'data', 'template-assets')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function newAssetId() {
  return `rep_${randomBytes(6).toString('hex')}`
}

function dataUrlToBuffer(dataUrlOrBase64, mimeHint = '') {
  const raw = String(dataUrlOrBase64 || '')
  if (raw.startsWith('data:')) {
    const match = raw.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) throw new Error('Invalid image data URL')
    return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] }
  }
  return { buffer: Buffer.from(raw, 'base64'), mime: mimeHint || 'application/octet-stream' }
}

function extForMime(mime) {
  if (/png/i.test(mime)) return 'png'
  if (/webp/i.test(mime)) return 'webp'
  if (/gif/i.test(mime)) return 'gif'
  return 'jpg'
}

/** Save uploaded image as page-1 and return public page descriptors. */
export function saveImagePages(assetId, dataBase64, mimeType = 'image/png') {
  const dir = path.join(ASSETS_ROOT, assetId)
  ensureDir(dir)
  const { buffer, mime } = dataUrlToBuffer(dataBase64, mimeType)
  const ext = extForMime(mime || mimeType)
  const file = `page-1.${ext}`
  fs.writeFileSync(path.join(dir, file), buffer)
  return [{
    index: 0,
    src: `/api/template-assets/${assetId}/${file}`,
    mime: mime || mimeType
  }]
}

/** Render first pages of a PDF to PNG and save. */
export async function savePdfPages(assetId, dataBase64, maxPages = 2) {
  const dir = path.join(ASSETS_ROOT, assetId)
  ensureDir(dir)
  const buffer = Buffer.from(dataBase64, 'base64')
  const parser = new PDFParse({ data: buffer })
  try {
    const shot = await parser.getScreenshot({
      first: maxPages,
      desiredWidth: 1400,
      imageDataUrl: true
    })
    const pages = []
    const list = shot?.pages || shot?.screenshots || []
    for (let i = 0; i < list.length; i++) {
      const page = list[i]
      let imgBuf = null
      if (page.data && Buffer.isBuffer(page.data)) {
        imgBuf = page.data
      } else if (page.data instanceof Uint8Array) {
        imgBuf = Buffer.from(page.data)
      } else {
        const dataUrl = page.dataUrl || page.imageDataUrl || page.data_url
        if (dataUrl) imgBuf = dataUrlToBuffer(dataUrl).buffer
      }
      if (!imgBuf) continue
      const file = `page-${i + 1}.png`
      fs.writeFileSync(path.join(dir, file), imgBuf)
      pages.push({
        index: i,
        src: `/api/template-assets/${assetId}/${file}`,
        width: page.width || null,
        height: page.height || null,
        mime: 'image/png'
      })
    }
    if (!pages.length) throw new Error('PDF produced no page images')
    return pages
  } finally {
    await parser.destroy().catch(() => {})
  }
}

export function resolveAssetPath(assetId, fileName) {
  const safeId = String(assetId || '').replace(/[^a-zA-Z0-9_-]/g, '')
  const safeFile = String(fileName || '').replace(/[^a-zA-Z0-9._-]/g, '')
  if (!safeId || !safeFile) return null
  const full = path.join(ASSETS_ROOT, safeId, safeFile)
  if (!full.startsWith(ASSETS_ROOT)) return null
  if (!fs.existsSync(full)) return null
  return full
}
