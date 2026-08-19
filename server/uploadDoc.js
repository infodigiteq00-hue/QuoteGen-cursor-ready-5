import multer from 'multer'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { inferTemplatePageWidth } from '../shared/templateMap.js'
import { registerUploadTemplateRoutes } from './uploadTemplates.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = (file.originalname || '').toLowerCase()
    const ok =
      name.endsWith('.docx') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xlsm') ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel.sheet.macroEnabled.12'
    if (ok) cb(null, true)
    else cb(new Error('Only Word (.docx) and Excel (.xlsx) files are supported in this phase.'))
  }
})

function argbToCss(argb) {
  if (!argb) return null
  const hex = String(argb).replace(/^#/, '')
  if (hex.length === 8) {
    const a = parseInt(hex.slice(0, 2), 16) / 255
    const r = parseInt(hex.slice(2, 4), 16)
    const g = parseInt(hex.slice(4, 6), 16)
    const b = parseInt(hex.slice(6, 8), 16)
    if (a >= 0.99) return `#${hex.slice(2)}`
    return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`
  }
  if (hex.length === 6) return `#${hex}`
  return null
}

function excelColor(color) {
  if (!color) return null
  if (color.argb) return argbToCss(color.argb)
  return null
}

function borderSide(side) {
  if (!side || side.style === 'none' || !side.style) return null
  const color = excelColor(side.color) || '#000000'
  const width =
    side.style === 'thin' || side.style === 'hair' ? '1px'
      : side.style === 'medium' ? '2px'
        : side.style === 'thick' ? '3px'
          : side.style === 'double' ? '3px'
            : '1px'
  const style = side.style === 'double' ? 'double' : side.style === 'dotted' ? 'dotted' : side.style === 'dashed' ? 'dashed' : 'solid'
  return `${width} ${style} ${color}`
}

function parseCellPayload(value) {
  if (value == null || value === '') {
    return { value: '', formula: null, display: '' }
  }
  if (typeof value === 'object') {
    if (value.formula != null) {
      const result = value.result != null ? String(value.result) : ''
      return {
        value: result,
        formula: String(value.formula).replace(/^\s*=/, ''),
        display: result
      }
    }
    if (value.richText) {
      const text = value.richText.map(p => p.text || '').join('')
      return { value: text, formula: null, display: text }
    }
    if (value.text != null) {
      const text = String(value.text)
      return { value: text, formula: null, display: text }
    }
    if (value instanceof Date) {
      const text = value.toLocaleDateString('en-IN')
      return { value: text, formula: null, display: text }
    }
    if (value.hyperlink && value.text) {
      const text = String(value.text)
      return { value: text, formula: null, display: text }
    }
  }
  if (typeof value === 'boolean') {
    const text = value ? 'TRUE' : 'FALSE'
    return { value: text, formula: null, display: text }
  }
  if (typeof value === 'number') {
    const text = String(value)
    return { value: text, formula: null, display: text }
  }
  const text = String(value)
  return { value: text, formula: null, display: text }
}

function extractCellStyle(cell) {
  const font = cell.font || {}
  const fill = cell.fill || {}
  const alignment = cell.alignment || {}
  const border = cell.border || {}

  const bg =
    fill.type === 'pattern' && fill.pattern !== 'none'
      ? excelColor(fill.fgColor) || excelColor(fill.bgColor)
      : null

  return {
    fontFamily: font.name || null,
    fontSize: font.size || null,
    fontWeight: font.bold ? 'bold' : null,
    fontStyle: font.italic ? 'italic' : null,
    textDecoration: font.underline ? 'underline' : font.strike ? 'line-through' : null,
    color: excelColor(font.color),
    backgroundColor: bg,
    textAlign: alignment.horizontal || null,
    verticalAlign: alignment.vertical || null,
    wrapText: Boolean(alignment.wrapText),
    borderTop: borderSide(border.top),
    borderRight: borderSide(border.right),
    borderBottom: borderSide(border.bottom),
    borderLeft: borderSide(border.left),
    numFmt: cell.numFmt || null
  }
}

function buildMergeMap(worksheet) {
  const map = new Map()
  const skip = new Set()
  const merges = worksheet._merges ? Object.values(worksheet._merges) : []
  for (const merge of merges) {
    const { top, left, bottom, right } = merge.model || merge
    if (top == null || left == null) continue
    map.set(`${top}:${left}`, {
      rowSpan: bottom - top + 1,
      colSpan: right - left + 1
    })
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        if (r === top && c === left) continue
        skip.add(`${r}:${c}`)
      }
    }
  }
  return { map, skip }
}

function emuToPx(emu) {
  const n = Number(emu)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.max(1, Math.round(n / 9525))
}

/** Read Word-drawn image sizes (display size in doc, not raw file pixels). */
async function extractDocxImageSizes(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) return []
  const xml = await docFile.async('string')
  const sizes = []

  // DrawingML extents in document order (matches mammoth image order for most docs)
  for (const m of xml.matchAll(/<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/g)) {
    sizes.push({ widthPx: emuToPx(m[1]), heightPx: emuToPx(m[2]) })
  }
  for (const m of xml.matchAll(/<wp:extent\b[^>]*\bcy="(\d+)"[^>]*\bcx="(\d+)"/g)) {
    // already covered if both attrs present in either order — skip duplicates when first regex caught them
    if (!xml.includes(`cx="${m[2]}"`) || sizes.length) continue
  }

  // VML fallback (older Word docs)
  if (!sizes.length) {
    for (const m of xml.matchAll(/style="[^"]*width\s*:\s*([\d.]+)(pt|in|cm|mm|px)[^"]*height\s*:\s*([\d.]+)(pt|in|cm|mm|px)/gi)) {
      sizes.push({
        widthPx: cssLengthToPx(m[1], m[2]),
        heightPx: cssLengthToPx(m[3], m[4])
      })
    }
  }

  return sizes.filter(s => s.widthPx && s.heightPx)
}

function cssLengthToPx(value, unit) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const u = String(unit).toLowerCase()
  if (u === 'px') return Math.round(n)
  if (u === 'pt') return Math.round(n * (96 / 72))
  if (u === 'in') return Math.round(n * 96)
  if (u === 'cm') return Math.round(n * (96 / 2.54))
  if (u === 'mm') return Math.round(n * (96 / 25.4))
  return Math.round(n)
}

function extractHeaderFooter(worksheet) {
  const hf = worksheet.headerFooter || {}
  return {
    oddHeader: hf.oddHeader || '',
    oddFooter: hf.oddFooter || '',
    evenHeader: hf.evenHeader || '',
    evenFooter: hf.evenFooter || '',
    firstHeader: hf.firstHeader || '',
    firstFooter: hf.firstFooter || ''
  }
}

function extractSheetImages(workbook, worksheet) {
  const images = []
  try {
    const list = typeof worksheet.getImages === 'function' ? worksheet.getImages() : []
    for (const img of list) {
      const media = workbook.getImage?.(img.imageId)
      if (!media?.buffer) continue
      const mime = media.extension === 'jpeg' || media.extension === 'jpg'
        ? 'image/jpeg'
        : media.extension === 'gif'
          ? 'image/gif'
          : 'image/png'
      const base64 = Buffer.from(media.buffer).toString('base64')
      const range = img.range || {}
      const tl = range.tl || {}
      const br = range.br || {}
      images.push({
        id: `img_${img.imageId}`,
        src: `data:${mime};base64,${base64}`,
        fromCol: Number(tl.nativeCol ?? tl.col ?? 0),
        fromRow: Number(tl.nativeRow ?? tl.row ?? 0),
        toCol: Number(br.nativeCol ?? br.col ?? tl.nativeCol ?? 0),
        toRow: Number(br.nativeRow ?? br.row ?? tl.nativeRow ?? 0),
        colOff: Number(tl.nativeColOff ?? 0),
        rowOff: Number(tl.nativeRowOff ?? 0)
      })
    }
  } catch (e) {
    console.warn('[upload-doc] excel images skipped', e?.message)
  }
  return images
}

async function parseExcel(buffer, fileName) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const sheets = []
  workbook.eachSheet((worksheet) => {
    const { map: mergeMap, skip } = buildMergeMap(worksheet)
    const rowCount = Math.max(worksheet.rowCount || 0, 1)
    const colCount = Math.max(worksheet.columnCount || 0, 1)

    const columns = []
    for (let c = 1; c <= colCount; c++) {
      const col = worksheet.getColumn(c)
      columns.push({
        index: c,
        widthPx: Math.round((col.width || 10) * 8.5)
      })
    }

    const rows = []
    for (let r = 1; r <= rowCount; r++) {
      const row = worksheet.getRow(r)
      const cells = []
      for (let c = 1; c <= colCount; c++) {
        const key = `${r}:${c}`
        if (skip.has(key)) continue
        const cell = row.getCell(c)
        const merge = mergeMap.get(key)
        const payload = parseCellPayload(cell.value)
        const style = extractCellStyle(cell)
        if (!style.fontWeight && Array.isArray(cell.value?.richText) && cell.value.richText.some(p => p.font?.bold)) {
          style.fontWeight = 'bold'
        }
        cells.push({
          col: c,
          value: payload.display,
          formula: payload.formula,
          style,
          rowSpan: merge?.rowSpan || 1,
          colSpan: merge?.colSpan || 1,
          role: 'content'
        })
      }
      rows.push({
        index: r,
        heightPx: row.height ? Math.round(row.height * 1.33) : 22,
        cells
      })
    }

    sheets.push({
      name: worksheet.name,
      columns,
      rows,
      headerFooter: extractHeaderFooter(worksheet),
      images: extractSheetImages(workbook, worksheet)
    })
  })

  return {
    type: 'excel',
    fileName,
    sheets,
    design: {
      accent: null,
      headerBg: null,
      paperBg: '#ffffff',
      pageWidthPx: inferTemplatePageWidth('excel', sheets, {})
    }
  }
}

async function parseWord(buffer, fileName) {
  const sizeQueue = await extractDocxImageSizes(buffer)
  let imageIndex = 0

  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1.doc-title:fresh",
        "p[style-name='Subtitle'] => h2.doc-subtitle:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "r[style-name='Strong'] => strong",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote.doc-intense:fresh"
      ],
      convertImage: mammoth.images.imgElement((image) =>
        image.read('base64').then((imageBuffer) => {
          const size = sizeQueue[imageIndex++] || null
          const attrs = {
            src: `data:${image.contentType};base64,${imageBuffer}`,
            style: 'max-width:100%;height:auto;'
          }
          if (size?.widthPx) {
            attrs.width = String(size.widthPx)
            attrs.style = `width:${size.widthPx}px;height:auto;max-width:100%;`
          }
          if (size?.heightPx && size?.widthPx) {
            // Keep Word display proportions; height auto after width lock avoids stretch
            attrs['data-word-h'] = String(size.heightPx)
          }
          return attrs
        })
      )
    }
  )

  const html = result.value || '<p></p>'
  return {
    type: 'word',
    fileName,
    html,
    warnings: (result.messages || []).map(m => m.message).slice(0, 20),
    design: {
      accent: null,
      pageBg: '#ffffff',
      paperBg: '#ffffff',
      pageWidthPx: inferTemplatePageWidth('word', html, {})
    }
  }
}

function detectKind(file) {
  const name = (file.originalname || '').toLowerCase()
  if (name.endsWith('.docx')) return 'word'
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return 'excel'
  if (file.mimetype?.includes('wordprocessingml')) return 'word'
  if (file.mimetype?.includes('spreadsheetml') || file.mimetype?.includes('sheet.macroEnabled')) return 'excel'
  return null
}

export function registerUploadDocRoutes(app) {
  registerUploadTemplateRoutes(app)

  app.post('/api/upload-doc', (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed.' })
      }
      try {
        if (!req.file) return res.status(400).json({ error: 'Please choose a Word or Excel file.' })
        const kind = detectKind(req.file)
        if (!kind) {
          return res.status(400).json({ error: 'Only Word (.docx) and Excel (.xlsx) are supported right now.' })
        }

        const fileName = req.file.originalname
        const doc =
          kind === 'word'
            ? await parseWord(req.file.buffer, fileName)
            : await parseExcel(req.file.buffer, fileName)

        res.json(doc)
      } catch (error) {
        console.error('[upload-doc] parse failed', error)
        res.status(500).json({
          error: error?.message || 'Could not convert this document. Try another .docx or .xlsx file.'
        })
      }
    })
  })
}
