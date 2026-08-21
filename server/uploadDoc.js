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

const OFFICE_THEME = [
  '000000', 'FFFFFF', '1F497D', 'EEECE1',
  '4F81BD', 'C0504D', '9BBB59', '8064A2',
  '4BACC6', 'F79646', '0000FF', '800080'
]

const INDEXED_COLORS = {
  0: '000000', 1: 'FFFFFF', 2: 'FF0000', 3: '00FF00', 4: '0000FF',
  5: 'FFFF00', 6: 'FF00FF', 7: '00FFFF', 8: '000000', 9: 'FFFFFF',
  10: 'FF0000', 11: '00FF00', 12: '0000FF', 13: 'FFFF00', 14: 'FF00FF',
  15: '00FFFF', 16: '800000', 17: '008000', 18: '000080', 19: '808000',
  20: '800080', 21: '008080', 22: 'C0C0C0', 23: '808080',
  64: '000000', 65: 'FFFFFF'
}

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

function applyTint(hex, tint) {
  const raw = String(hex || '').replace(/^#/, '')
  if (raw.length < 6 || !Number.isFinite(Number(tint)) || Number(tint) === 0) {
    return raw.length >= 6 ? `#${raw.slice(0, 6)}` : null
  }
  const t = Number(tint)
  const parts = [0, 2, 4].map(i => parseInt(raw.slice(i, i + 2), 16))
  const next = parts.map(c => {
    const n = t < 0 ? c * (1 + t) : c * (1 - t) + 255 * t
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  })
  return `#${next.join('')}`
}

function parseWorkbookTheme(workbook) {
  const xml = workbook?._themes?.theme1 || workbook?.model?.themes?.theme1 || ''
  if (!xml) return OFFICE_THEME.slice()
  const scheme = String(xml).match(/<a:clrScheme\b[^>]*>([\s\S]*?)<\/a:clrScheme>/i)?.[1] || ''
  const colors = []
  for (const m of scheme.matchAll(/<a:(?:sysClr|srgbClr)\b[^>]*(?:lastClr|val)="([0-9A-Fa-f]{6})"/g)) {
    colors.push(m[1].toUpperCase())
  }
  return colors.length >= 12 ? colors.slice(0, 12) : OFFICE_THEME.slice()
}

function excelColor(color, theme = OFFICE_THEME) {
  if (!color) return null
  if (color.argb) return argbToCss(color.argb)
  if (color.theme != null) {
    const hex = theme[Number(color.theme)] || OFFICE_THEME[Number(color.theme)] || '000000'
    return applyTint(hex, color.tint || 0)
  }
  if (color.indexed != null) {
    const hex = INDEXED_COLORS[Number(color.indexed)]
    return hex ? `#${hex}` : null
  }
  return null
}

function borderSide(side, theme) {
  if (!side || side.style === 'none' || !side.style) return null
  const color = excelColor(side.color, theme) || '#000000'
  const width =
    side.style === 'thin' || side.style === 'hair' ? '1px'
      : side.style === 'medium' ? '2px'
        : side.style === 'thick' ? '3px'
          : side.style === 'double' ? '3px'
            : '1px'
  const style = side.style === 'double' ? 'double' : side.style === 'dotted' ? 'dotted' : side.style === 'dashed' ? 'dashed' : 'solid'
  return `${width} ${style} ${color}`
}

function looksLikeDateFmt(fmt) {
  const f = String(fmt || '').toLowerCase()
  if (!f || f === 'general') return false
  const stripped = f.replace(/\[[^\]]*\]/g, '')
  if (/#|0\.00|0,/.test(stripped) && !/[ymd]/i.test(stripped)) return false
  return /(?:yy|m{1,5}|d{1,2}|h{1,2}|s{1,2})/.test(stripped)
}

function excelSerialToDate(n) {
  const epoch = Date.UTC(1899, 11, 30)
  return new Date(epoch + Number(n) * 86400000)
}

function formatExcelNumber(n, fmt) {
  const f = String(fmt || '')
  if (/0\.00|#,##0\.00|\[\$/.test(f) || /₹|rs\.?/i.test(f)) {
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (/,##0/.test(f)) return Number(n).toLocaleString('en-IN')
  if (/%/.test(f)) return `${Number(n) * 100}`
  return String(n)
}

function parseCellPayload(value, numFmt) {
  if (value == null || value === '') {
    return { value: '', formula: null, display: '' }
  }
  if (typeof value === 'object') {
    if (value.formula != null) {
      const result = value.result
      const display = result instanceof Date
        ? result.toLocaleDateString('en-IN')
        : result != null ? String(result) : ''
      return {
        value: display,
        formula: String(value.formula).replace(/^\s*=/, ''),
        display
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
    if (looksLikeDateFmt(numFmt) && value > 20000 && value < 80000) {
      const text = excelSerialToDate(value).toLocaleDateString('en-IN')
      return { value: text, formula: null, display: text }
    }
    const text = formatExcelNumber(value, numFmt)
    return { value: text, formula: null, display: text }
  }
  const text = String(value)
  return { value: text, formula: null, display: text }
}

function extractCellStyle(cell, theme) {
  const font = cell.font || {}
  const fill = cell.fill || {}
  const alignment = cell.alignment || {}
  const border = cell.border || {}

  const bg =
    fill.type === 'pattern' && fill.pattern !== 'none'
      ? excelColor(fill.fgColor, theme) || excelColor(fill.bgColor, theme)
      : null

  const borderTop = borderSide(border.top, theme)
  const borderRight = borderSide(border.right, theme)
  const borderBottom = borderSide(border.bottom, theme)
  const borderLeft = borderSide(border.left, theme)

  return {
    fontFamily: font.name || null,
    fontSize: font.size || null,
    fontWeight: font.bold ? 'bold' : null,
    fontStyle: font.italic ? 'italic' : null,
    textDecoration: font.underline ? 'underline' : font.strike ? 'line-through' : null,
    color: excelColor(font.color, theme),
    backgroundColor: bg,
    textAlign: alignment.horizontal || null,
    verticalAlign: alignment.vertical || null,
    wrapText: Boolean(alignment.wrapText),
    borderTop,
    borderRight,
    borderBottom,
    borderLeft,
    hasOwnBorder: Boolean(borderTop || borderRight || borderBottom || borderLeft),
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

function extractImageSizesFromXml(xml) {
  const sizes = []
  for (const m of String(xml || '').matchAll(/<wp:extent\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/g)) {
    sizes.push({ widthPx: emuToPx(m[1]), heightPx: emuToPx(m[2]) })
  }
  if (!sizes.length) {
    for (const m of String(xml || '').matchAll(/style="[^"]*width\s*:\s*([\d.]+)(pt|in|cm|mm|px)[^"]*height\s*:\s*([\d.]+)(pt|in|cm|mm|px)/gi)) {
      sizes.push({
        widthPx: cssLengthToPx(m[1], m[2]),
        heightPx: cssLengthToPx(m[3], m[4])
      })
    }
  }
  return sizes.filter(s => s.widthPx && s.heightPx)
}

/** Read Word-drawn image sizes (display size in doc, not raw file pixels). */
async function extractDocxImageSizes(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) return []
  return extractImageSizesFromXml(await docFile.async('string'))
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

function twipsToPx(twips) {
  const n = Number(twips)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.max(1, Math.round(n * 96 / 1440))
}

function xmlAttr(tag, name) {
  const re = new RegExp(`(?:${name}|w:${name})="([^"]*)"`, 'i')
  return String(tag || '').match(re)?.[1] || ''
}

function matchClose(xml, start, tag) {
  const openRe = new RegExp(`<${tag}\\b`, 'g')
  const closeRe = new RegExp(`</${tag}>`, 'g')
  openRe.lastIndex = start
  const first = openRe.exec(xml)
  if (!first || first.index !== start) return -1
  let depth = 1
  let i = start + first[0].length
  while (depth > 0 && i < xml.length) {
    openRe.lastIndex = i
    closeRe.lastIndex = i
    const nextOpen = openRe.exec(xml)
    const nextClose = closeRe.exec(xml)
    if (!nextClose) return -1
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++
      i = nextOpen.index + nextOpen[0].length
    } else {
      depth--
      i = nextClose.index + nextClose[0].length
      if (depth === 0) return i
    }
  }
  return -1
}

function collectBlocks(xml, tag) {
  const blocks = []
  const openRe = new RegExp(`<${tag}\\b`, 'g')
  let m
  while ((m = openRe.exec(xml))) {
    const end = matchClose(xml, m.index, tag)
    if (end < 0) break
    blocks.push(xml.slice(m.index, end))
    openRe.lastIndex = m.index + tag.length + 1
  }
  return blocks
}

function parseWordBorder(el) {
  if (!el) return null
  const val = xmlAttr(el, 'val')
  if (!val || val === 'nil' || val === 'none') return 'none'
  const sz = Number(xmlAttr(el, 'sz') || 4)
  const px = Math.max(1, Math.round((sz / 8) * (96 / 72)))
  const colorRaw = xmlAttr(el, 'color') || '000000'
  const color = !colorRaw || colorRaw.toLowerCase() === 'auto' ? '#000000' : `#${colorRaw.replace(/^#/, '')}`
  const style = val === 'dashed' ? 'dashed' : val === 'dotted' ? 'dotted' : val === 'double' ? 'double' : 'solid'
  return `${px}px ${style} ${color}`
}

function wordWidthPx(el) {
  if (!el) return null
  const type = xmlAttr(el, 'type')
  const w = xmlAttr(el, 'w')
  if (type === 'pct') return null
  return twipsToPx(w)
}

function parseWordTableSpec(tblXml) {
  const tblW = tblXml.match(/<w:tblW\b[^>]*\/?>/)?.[0]
  const cells = []
  let hasBorders = false
  const open = tblXml.match(/^<w:tbl\b[^>]*>/)?.[0] || ''
  let flat = tblXml.slice(open.length)
  for (const nested of collectBlocks(flat, 'w:tbl')) {
    flat = flat.replace(nested, '')
  }
  const trBlocks = collectBlocks(open + flat, 'w:tr')
  for (const tr of trBlocks) {
    for (const tc of collectBlocks(tr, 'w:tc')) {
      const innerTbl = collectBlocks(tc, 'w:tbl')
      const own = innerTbl.length ? tc.slice(0, tc.indexOf(innerTbl[0])) : tc
      const tcW = own.match(/<w:tcW\b[^>]*\/?>/)?.[0]
      const shd = own.match(/<w:shd\b[^>]*\/?>/)?.[0]
      const fill = shd ? xmlAttr(shd, 'fill') : ''
      const cell = {
        widthPx: wordWidthPx(tcW),
        background: fill && fill.toLowerCase() !== 'auto' ? `#${fill.replace(/^#/, '')}` : null
      }
      for (const side of ['top', 'left', 'bottom', 'right']) {
        const el = own.match(new RegExp(`<w:${side}\\b[^>]*\/?>`))?.[0]
        const css = parseWordBorder(el)
        if (css && css !== 'none') {
          cell[side] = css
          hasBorders = true
        }
      }
      cells.push(cell)
    }
  }
  return { widthPx: wordWidthPx(tblW), hasBorders, cells }
}

function extractWordTableSpecs(xml) {
  return collectBlocks(xml, 'w:tbl').map(parseWordTableSpec)
}

function findTableEnd(html, start) {
  let depth = 0
  const re = /<\/?table\b[^>]*>/gi
  re.lastIndex = start
  let m
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0) return m.index + m[0].length
    } else depth++
  }
  return html.length
}

function mergeStyleAttr(attrs, extra) {
  if (!extra) return attrs
  if (/style="/i.test(attrs)) {
    return attrs.replace(/style="([^"]*)"/i, (_, s) => `style="${s};${extra}"`)
  }
  return `${attrs} style="${extra}"`
}

function applyWordTableSpecs(html, specs) {
  if (!specs?.length) return html
  let specIndex = 0

  function styleDirectCells(inner, spec) {
    if (!spec) return inner
    const held = []
    const withoutNested = String(inner).replace(/<table\b[\s\S]*?<\/table>/gi, (t) => {
      held.push(t)
      return `<!--QGTBL:${held.length - 1}-->`
    })
    let ci = 0
    const styled = withoutNested.replace(/<t([dh])(\b[^>]*)>/gi, (full, tag, attrs) => {
      const cell = spec.cells[ci++]
      if (!cell) return full
      const bits = []
      if (cell.widthPx) bits.push(`width:${cell.widthPx}px`)
      if (cell.background) bits.push(`background-color:${cell.background}`)
      if (cell.top) bits.push(`border-top:${cell.top}`)
      if (cell.right) bits.push(`border-right:${cell.right}`)
      if (cell.bottom) bits.push(`border-bottom:${cell.bottom}`)
      if (cell.left) bits.push(`border-left:${cell.left}`)
      if (!bits.length) return full
      return `<t${tag}${mergeStyleAttr(attrs, bits.join(';'))}>`
    })
    return styled.replace(/<!--QGTBL:(\d+)-->/g, (_, i) => held[Number(i)] || '')
  }

  function transform(fragment) {
    let out = ''
    let i = 0
    const src = String(fragment || '')
    while (i < src.length) {
      const start = src.toLowerCase().indexOf('<table', i)
      if (start < 0) {
        out += src.slice(i)
        break
      }
      if (!/^<table\b/i.test(src.slice(start))) {
        out += src.slice(i, start + 6)
        i = start + 6
        continue
      }
      out += src.slice(i, start)
      const close = findTableEnd(src, start)
      const openEnd = src.indexOf('>', start) + 1
      const open = src.slice(start, openEnd)
      const inner = src.slice(openEnd, close).replace(/<\/table>\s*$/i, '')
      const spec = specs[specIndex++] || null
      const nestedDone = transform(inner)
      const styled = styleDirectCells(nestedDone, spec)
      let nextOpen = open
      if (spec?.widthPx && !/width:/i.test(open)) {
        nextOpen = nextOpen.replace(/^<table\b/i, `<table style="width:${spec.widthPx}px;border-collapse:collapse"`)
      }
      if (spec && !/data-qg-borders=/i.test(nextOpen)) {
        nextOpen = nextOpen.replace(/^<table\b/i, `<table data-qg-borders="${spec.hasBorders ? '1' : '0'}"`)
      }
      out += `${nextOpen}${styled}</table>`
      i = close
    }
    return out
  }

  return transform(html)
}

function extractSectPr(xml) {
  const sect = String(xml || '').match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/i)?.[0] || ''
  const pgSz = sect.match(/<w:pgSz\b[^>]*\/?>/)?.[0] || ''
  const pgMar = sect.match(/<w:pgMar\b[^>]*\/?>/)?.[0] || ''
  return {
    pageWidthPx: twipsToPx(xmlAttr(pgSz, 'w')) || null,
    pageHeightPx: twipsToPx(xmlAttr(pgSz, 'h')) || null,
    marginTopPx: twipsToPx(xmlAttr(pgMar, 'top')) || null,
    marginRightPx: twipsToPx(xmlAttr(pgMar, 'right')) || null,
    marginBottomPx: twipsToPx(xmlAttr(pgMar, 'bottom')) || null,
    marginLeftPx: twipsToPx(xmlAttr(pgMar, 'left')) || null,
    headerRefs: [...sect.matchAll(/<w:headerReference\b[^>]*>/gi)].map(m => ({
      type: xmlAttr(m[0], 'type'),
      rId: xmlAttr(m[0], 'id') || m[0].match(/r:id="([^"]+)"/)?.[1]
    })),
    footerRefs: [...sect.matchAll(/<w:footerReference\b[^>]*>/gi)].map(m => ({
      type: xmlAttr(m[0], 'type'),
      rId: xmlAttr(m[0], 'id') || m[0].match(/r:id="([^"]+)"/)?.[1]
    }))
  }
}

function parseRels(xml) {
  const map = {}
  for (const m of String(xml || '').matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="([^"]+)"/g)) {
    const id = m[1] || m[4]
    const target = m[2] || m[3]
    if (id && target) map[id] = target.replace(/^\.\.\//, '')
  }
  return map
}

function wrapPartAsDocument(xml) {
  const open = xml.match(/<w:(hdr|ftr)\b([^>]*)>/i)
  const attrs = open?.[2] || 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const inner = xml
    .replace(/^[\s\S]*?<w:(?:hdr|ftr)\b[^>]*>/i, '')
    .replace(/<\/w:(?:hdr|ftr)>\s*$/i, '')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${attrs}><w:body>${inner}</w:body></w:document>`
}

async function convertDocxPartToHtml(zip, partPath, mammothOptions) {
  const file = zip.file(partPath)
  if (!file) return ''
  try {
    const xml = await file.async('string')
    const clone = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }))
    clone.file('word/document.xml', wrapPartAsDocument(xml))
    const relName = `word/_rels/${partPath.replace(/^word\//, '')}.rels`
    const rels = zip.file(relName)
    if (rels) clone.file('word/_rels/document.xml.rels', await rels.async('string'))
    const buffer = await clone.generateAsync({ type: 'nodebuffer' })
    const partOptions = {
      ...mammothOptions,
      convertImage: mammothImageHandler(extractImageSizesFromXml(xml))
    }
    const result = await mammoth.convertToHtml({ buffer }, partOptions)
    return result.value || ''
  } catch (error) {
    console.warn('[upload-doc] header/footer skipped', partPath, error?.message)
    return ''
  }
}

function wrapPermanent(html, kind) {
  const body = String(html || '').trim()
  if (!body) return ''
  return `<div data-qg-permanent="${kind}" class="upload-word-${kind}">${body}</div>`
}

async function extractWordChrome(zip, docXml, mammothOptions) {
  const sect = extractSectPr(docXml)
  let rels = {}
  const relFile = zip.file('word/_rels/document.xml.rels')
  if (relFile) rels = parseRels(await relFile.async('string'))

  const pick = (refs, fallbackPrefix) => {
    const preferred = refs.find(r => r.type === 'default') || refs[0]
    if (preferred?.rId && rels[preferred.rId]) {
      const target = rels[preferred.rId]
      return target.startsWith('word/') ? target : `word/${target.replace(/^\/?word\//, '')}`
    }
    const names = Object.keys(zip.files).filter(n => n.startsWith(`word/${fallbackPrefix}`) && n.endsWith('.xml'))
    return names.sort()[0] || ''
  }

  const headerPath = pick(sect.headerRefs, 'header')
  const footerPath = pick(sect.footerRefs, 'footer')
  const headerHtml = headerPath ? await convertDocxPartToHtml(zip, headerPath, mammothOptions) : ''
  const footerHtml = footerPath ? await convertDocxPartToHtml(zip, footerPath, mammothOptions) : ''
  return {
    headerHtml: wrapPermanent(headerHtml, 'header'),
    footerHtml: wrapPermanent(footerHtml, 'footer'),
    page: sect
  }
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

function positionSheetImages(columns, rows, images) {
  return (images || []).map((img) => {
    let left = 0
    for (let c = 0; c < img.fromCol; c++) left += columns[c]?.widthPx || 64
    left += emuToPx(img.colOff) || 0
    let top = 0
    for (let r = 0; r < img.fromRow; r++) top += rows[r]?.heightPx || 22
    top += emuToPx(img.rowOff) || 0
    let width = 0
    for (let c = img.fromCol; c <= img.toCol; c++) width += columns[c]?.widthPx || 64
    let height = 0
    for (let r = img.fromRow; r <= img.toRow; r++) height += rows[r]?.heightPx || 22
    return {
      ...img,
      leftPx: left,
      topPx: top,
      widthPx: Math.max(24, width || 64),
      heightPx: Math.max(16, height || 22)
    }
  })
}

async function parseExcel(buffer, fileName) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const theme = parseWorkbookTheme(workbook)

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
        const payload = parseCellPayload(cell.value, cell.numFmt)
        const style = extractCellStyle(cell, theme)
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
      images: positionSheetImages(columns, rows, extractSheetImages(workbook, worksheet))
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

const WORD_STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => h2.doc-subtitle:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "r[style-name='Strong'] => strong",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote.doc-intense:fresh"
]

function mammothImageHandler(sizeQueue) {
  let imageIndex = 0
  return mammoth.images.imgElement((image) =>
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
        attrs['data-word-h'] = String(size.heightPx)
      }
      return attrs
    })
  )
}

async function parseWord(buffer, fileName) {
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.file('word/document.xml')
  const docXml = docFile ? await docFile.async('string') : ''
  const sizeQueue = await extractDocxImageSizes(buffer)
  const mammothOptions = {
    styleMap: WORD_STYLE_MAP,
    convertImage: mammothImageHandler(sizeQueue)
  }

  const result = await mammoth.convertToHtml({ buffer }, mammothOptions)
  let html = result.value || '<p></p>'
  const tableSpecs = docXml ? extractWordTableSpecs(docXml) : []
  html = applyWordTableSpecs(html, tableSpecs)

  let headerHtml = ''
  let footerHtml = ''
  let page = {}
  try {
    const chrome = await extractWordChrome(zip, docXml, { styleMap: WORD_STYLE_MAP })
    headerHtml = chrome.headerHtml
    footerHtml = chrome.footerHtml
    page = chrome.page || {}
  } catch (error) {
    console.warn('[upload-doc] word chrome skipped', error?.message)
  }

  html = `${headerHtml}${html}${footerHtml}` || '<p></p>'
  const design = {
    accent: null,
    pageBg: '#ffffff',
    paperBg: '#ffffff',
    pageWidthPx: page.pageWidthPx || inferTemplatePageWidth('word', html, {}),
    pageHeightPx: page.pageHeightPx || null,
    marginTopPx: page.marginTopPx || null,
    marginRightPx: page.marginRightPx || null,
    marginBottomPx: page.marginBottomPx || null,
    marginLeftPx: page.marginLeftPx || null
  }

  return {
    type: 'word',
    fileName,
    html,
    warnings: (result.messages || []).map(m => m.message).slice(0, 20),
    design
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
