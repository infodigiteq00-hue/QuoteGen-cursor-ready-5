/**
 * Extract plain text from knowledge-base uploads (PDF, Word, Excel, CSV, text, images).
 * Best-effort OCR for images via tesseract.js when eng.traineddata is available.
 */
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const LOCAL_TESS_DATA = path.join(PROJECT_ROOT, 'eng.traineddata')

function tessWorkDir() {
  if (!process.env.VERCEL) return PROJECT_ROOT
  const dir = path.join(os.tmpdir(), 'quotegen-tess')
  mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, 'eng.traineddata')
  if (existsSync(LOCAL_TESS_DATA) && !existsSync(dest)) {
    copyFileSync(LOCAL_TESS_DATA, dest)
  }
  return dir
}

const MAX_TEXT_CHARS = 400_000

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

export function guessMime(filename, mimetype) {
  const ext = path.extname(filename || '').toLowerCase()
  if (mimetype && mimetype !== 'application/octet-stream') return mimetype
  return MIME_BY_EXT[ext] || mimetype || 'application/octet-stream'
}

export function detectKnowledgeKind(filename, mime) {
  const name = String(filename || '').toLowerCase()
  const m = String(mime || '').toLowerCase()
  if (name.endsWith('.pdf') || m.includes('pdf')) return 'pdf'
  if (name.endsWith('.docx') || m.includes('wordprocessingml')) return 'word'
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm') || m.includes('spreadsheetml') || m.includes('sheet.macroenabled')) return 'excel'
  if (name.endsWith('.csv') || m === 'text/csv' || m.includes('csv')) return 'csv'
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.json') || m.startsWith('text/') || m === 'application/json') return 'text'
  if (
    name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') ||
    name.endsWith('.webp') || name.endsWith('.gif') || name.endsWith('.bmp') ||
    name.endsWith('.tif') || name.endsWith('.tiff') || m.startsWith('image/')
  ) return 'image'
  if (name.endsWith('.doc') || m === 'application/msword') return 'legacy-word'
  if (name.endsWith('.xls') || m === 'application/vnd.ms-excel') return 'legacy-excel'
  return 'unknown'
}

function clampText(text) {
  const cleaned = String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (cleaned.length <= MAX_TEXT_CHARS) return cleaned
  return `${cleaned.slice(0, MAX_TEXT_CHARS)}\n\n…[truncated]`
}

async function extractPdf(buffer) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText()
    const text = clampText(result?.text || '')
    const pages = Array.isArray(result?.pages) ? result.pages.length : null
    return {
      text,
      meta: {
        extractor: 'pdf-parse',
        pages: pages ?? result?.total ?? null,
        charCount: text.length
      }
    }
  } finally {
    try { await parser.destroy?.() } catch { /* ignore */ }
  }
}

async function extractWord(buffer) {
  const result = await mammoth.extractRawText({ buffer })
  const text = clampText(result?.value || '')
  return {
    text,
    meta: {
      extractor: 'mammoth',
      warnings: (result?.messages || []).map(m => m.message).slice(0, 10),
      charCount: text.length
    }
  }
}

function cellToPlain(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(p => p.text || '').join('')
    if (value.text != null) return String(value.text)
    if (value.result != null) return String(value.result)
    if (value.formula != null) return String(value.result ?? '')
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (value.hyperlink && value.text) return String(value.text)
  }
  return String(value)
}

async function extractExcel(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const parts = []
  workbook.eachSheet((worksheet) => {
    parts.push(`## Sheet: ${worksheet.name}`)
    const rowCount = Math.min(worksheet.rowCount || 0, 5000)
    const colCount = Math.min(worksheet.columnCount || 0, 80)
    for (let r = 1; r <= rowCount; r++) {
      const row = worksheet.getRow(r)
      const cells = []
      for (let c = 1; c <= colCount; c++) {
        const plain = cellToPlain(row.getCell(c).value).trim()
        if (plain) cells.push(plain)
      }
      if (cells.length) parts.push(cells.join('\t'))
    }
  })
  const text = clampText(parts.join('\n'))
  return {
    text,
    meta: {
      extractor: 'exceljs',
      sheetCount: workbook.worksheets?.length || 0,
      charCount: text.length
    }
  }
}

function extractCsvOrText(buffer, kind) {
  let raw = buffer.toString('utf8')
  // Strip UTF-8 BOM
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const text = clampText(raw)
  return {
    text,
    meta: {
      extractor: kind === 'csv' ? 'csv-utf8' : 'text-utf8',
      charCount: text.length
    }
  }
}

async function extractImageOcr(buffer, mime) {
  const workDir = tessWorkDir()
  const trainedData = path.join(workDir, 'eng.traineddata')
  if (!existsSync(trainedData)) {
    const err = new Error('OCR is unavailable (eng.traineddata missing). Upload PDF/Word/Excel/CSV/text instead.')
    err.code = 'OCR_UNAVAILABLE'
    err.status = 400
    throw err
  }
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    langPath: workDir,
    cachePath: workDir,
    gzip: false,
    logger: () => {}
  })
  try {
    const { data } = await worker.recognize(buffer)
    const text = clampText(data?.text || '')
    return {
      text,
      meta: {
        extractor: 'tesseract.js',
        mime: mime || 'image',
        confidence: data?.confidence ?? null,
        charCount: text.length
      }
    }
  } finally {
    try { await worker.terminate() } catch { /* ignore */ }
  }
}

/**
 * @returns {{ text: string, kind: string, mime: string, meta: object }}
 */
export async function extractKnowledgeText(file) {
  const filename = file.originalname || file.filename || 'upload'
  const mime = guessMime(filename, file.mimetype)
  const kind = detectKnowledgeKind(filename, mime)
  const buffer = file.buffer

  if (!buffer?.length) {
    const err = new Error('Empty file.')
    err.status = 400
    err.code = 'VALIDATION_ERROR'
    throw err
  }

  if (kind === 'legacy-word' || kind === 'legacy-excel') {
    const err = new Error(
      kind === 'legacy-word'
        ? 'Legacy .doc is not supported. Save as .docx and re-upload.'
        : 'Legacy .xls is not supported. Save as .xlsx or .csv and re-upload.'
    )
    err.status = 400
    err.code = 'UNSUPPORTED_FORMAT'
    throw err
  }

  if (kind === 'unknown') {
    const err = new Error('Unsupported file type. Use PDF, Word (.docx), Excel (.xlsx), CSV, plain text, or a common image format.')
    err.status = 400
    err.code = 'UNSUPPORTED_FORMAT'
    throw err
  }

  let extracted
  if (kind === 'pdf') extracted = await extractPdf(buffer)
  else if (kind === 'word') extracted = await extractWord(buffer)
  else if (kind === 'excel') extracted = await extractExcel(buffer)
  else if (kind === 'csv' || kind === 'text') extracted = extractCsvOrText(buffer, kind)
  else if (kind === 'image') extracted = await extractImageOcr(buffer, mime)
  else {
    const err = new Error('Unsupported file type.')
    err.status = 400
    err.code = 'UNSUPPORTED_FORMAT'
    throw err
  }

  if (!extracted.text?.trim()) {
    const err = new Error('No text could be extracted from this file.')
    err.status = 422
    err.code = 'EMPTY_EXTRACTION'
    throw err
  }

  return {
    text: extracted.text,
    kind,
    mime,
    meta: {
      ...extracted.meta,
      originalName: filename,
      sizeBytes: buffer.length,
      kind
    }
  }
}

/**
 * Best-effort parse of product rows from extracted catalogue / quotation text.
 * Looks for lines with a description plus HSN and/or rate/price cues.
 */
export function extractProductCandidates(text, { limit = 40 } = {}) {
  const lines = String(text || '')
    .split(/\n+/)
    .map(l => l.replace(/\t+/g, ' | ').replace(/\s+/g, ' ').trim())
    .filter(l => l.length >= 6 && l.length <= 240)

  const out = []
  const seen = new Set()

  for (const line of lines) {
    if (/^(sheet|page|total|subtotal|grand|tax|invoice|quotation|bill|sr\.?|s\.?\s*no|description\b)/i.test(line)) continue

    const hsnMatch = line.match(/\b(?:hsn|sac)[:\s#-]*([0-9]{4,8})\b/i) ||
      line.match(/\b([0-9]{4,8})\b(?=.*\b(?:gst|igst|cgst|sgst)\b)/i)
    const gstMatch = line.match(/\b(?:gst|igst|tax)[:\s%]*([0-9]{1,2}(?:\.[0-9]+)?)\s*%?\b/i) ||
      line.match(/\b([0-9]{1,2}(?:\.[0-9]+)?)\s*%\s*(?:gst|igst)?\b/i)
    const rateMatch = line.match(/\b(?:rate|price|rs\.?|inr|₹)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{1,2})?)\b/i) ||
      line.match(/(?:^|[\s|,;|])([0-9]{2,7}(?:\.[0-9]{1,2})?)\s*(?:\/-|each|\/\s*(?:nos?|pcs?|kg|mtr|set))?$/i)

    // Tabular: Description | HSN | Rate | GST  (also CSV commas / tabs)
    const delimParts = (
      line.includes('|') ? line.split(/\s*\|\s*/)
        : line.includes('\t') ? line.split(/\t+/)
          : (line.split(',').length >= 3 ? line.split(',') : [line])
    ).map(p => p.trim()).filter(Boolean)

    let description = ''
    let hsn = hsnMatch?.[1] || ''
    let gst = gstMatch?.[1] || ''
    let rate = ''

    if (delimParts.length >= 2) {
      description = delimParts[0]
      const rest = delimParts.slice(1).map(p => p.replace(/%$/, ''))
      const numeric = rest.filter(p => /^\d+(?:\.\d{1,2})?$/.test(p))

      // Common catalogue shape: Description, HSN, Rate, GST
      if (numeric.length >= 3 && /^\d{4,8}$/.test(numeric[0])) {
        hsn = hsn || numeric[0]
        rate = numeric[1]
        gst = gst || numeric[2]
      } else if (numeric.length === 2 && /^\d{4,8}$/.test(numeric[0])) {
        hsn = hsn || numeric[0]
        const second = numeric[1]
        if (Number(second) <= 40) gst = gst || second
        else rate = second
      } else {
        const nums = []
        for (const part of numeric) {
          if (/^\d{4,8}$/.test(part)) {
            if (!hsn) hsn = part
            else nums.push(part)
          } else if (Number(part) <= 40 && Number(part) > 0 && String(part).length <= 2) {
            // Ambiguous small number — hold as candidate gst/rate
            nums.push(part)
          } else {
            nums.push(part)
          }
        }
        const keywordRate = line.match(/\b(?:rate|price|rs\.?|inr|₹)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{1,2})?)\b/i)?.[1]?.replace(/,/g, '') || ''
        if (keywordRate) rate = keywordRate
        const large = nums.find(n => Number(n) > 40)
        if (!rate && large) rate = large
        const smalls = nums.filter(n => Number(n) <= 40)
        if (!gst && smalls.length) gst = smalls[smalls.length - 1]
        if (!rate && smalls.length) rate = smalls[0]
      }

      const keywordRate = line.match(/\b(?:rate|price|rs\.?|inr|₹)\s*[:\-]?\s*([0-9]+(?:[.,][0-9]{1,2})?)\b/i)?.[1]?.replace(/,/g, '') || ''
      if (!rate && keywordRate) rate = keywordRate
    } else {
      rate = rateMatch?.[1]?.replace(/,/g, '') || ''
      description = line
        .replace(/\b(?:hsn|sac)[:\s#-]*[0-9]{4,8}\b/ig, '')
        .replace(/\b(?:gst|igst|tax)[:\s%]*[0-9]{1,2}(?:\.[0-9]+)?\s*%?\b/ig, '')
        .replace(/\b(?:rate|price|rs\.?|inr|₹)\s*[:\-]?\s*[0-9]+(?:[.,][0-9]{1,2})?\b/ig, '')
        .replace(/\s*\|\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    }

    description = description.replace(/^[\d.\-)\]\s]+/, '').replace(/[%|]+$/g, '').trim()
    if (description.length < 3 || description.length > 160) continue
    // Need at least HSN or a clear rate to avoid noise
    if (!hsn && !rate) continue

    const key = description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)

    out.push({
      key,
      description: description.replace(/\b\w/g, c => c),
      hsn: hsn || '',
      gst: gst || '',
      rate: rate || '',
      sourceLine: line.slice(0, 200)
    })
    if (out.length >= limit) break
  }

  return out.map(p => ({
    ...p,
    description: p.description
      .split(' ')
      .map(w => {
        if (/^[A-Z0-9./-]{2,}$/.test(w) && /[A-Z]/.test(w)) return w
        if (/^\d/.test(w)) return w
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      })
      .join(' ')
  }))
}
