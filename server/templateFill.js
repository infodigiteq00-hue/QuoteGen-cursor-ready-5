import { computeQuoteTotals } from '../shared/quoteColumns.js'
import {
  fillWordTemplate,
  fillExcelTemplate,
  applyPlacementRolesToSheets,
  scrubTransientExcelShell,
  buildExcelCellMap
} from '../shared/templateMap.js'
import {
  readUploadFileBuffer,
  copyUploadFile,
  updateUploadFile
} from './uploadFileStorage.js'
import { parseWord, parseExcel } from './uploadDoc.js'
import { writeFilledExcel, fillNativeExcel } from './writeFilledExcel.js'
import { writeFilledWord } from './writeFilledWord.js'

function cellMapIsUsable(cellMap) {
  if (!cellMap) return false
  if (Object.keys(cellMap.placements || {}).length) return true
  return (cellMap.lineItems || []).some(b => (b.columns || []).length)
}

/** Build excelCellMap from the live file each fill — so mapping fixes apply without re-upload. */
async function resolveExcelCellMap(template, buf, columns) {
  let sheets = template.content?.sheets
  if (!sheets?.length) {
    try {
      sheets = (await parseExcel(buf, template.sourceFileName)).sheets || []
    } catch {
      sheets = []
    }
  }
  if (!sheets?.length) return template.mapping?.excelCellMap || null

  let working = structuredClone(sheets)
  const placements = template.mapping?.placements
  if (placements && Object.keys(placements).length) {
    working = applyPlacementRolesToSheets(working, placements)
  }

  const cleaned = scrubTransientExcelShell(working)
  const cellMap = buildExcelCellMap(cleaned, columns?.length ? columns : (template.mapping?.columns || []))
  if (!cellMapIsUsable(cellMap)) return template.mapping?.excelCellMap || null
  return cellMap
}

function filledFileName(template, quote) {
  const base = String(template.sourceFileName || template.name || 'quotation')
    .replace(/\.(docx|xlsx|xlsm)$/i, '')
  const num = String(quote?.number || '').trim().replace(/[^\w.-]+/g, '_')
  const ext = template.type === 'excel' ? '.xlsx' : '.docx'
  return num ? `${base}-${num}${ext}` : `${base}-filled${ext}`
}

/**
 * Fill the native template file with quote data. Returns a working copy file id
 * (original template file is never modified).
 */
export async function fillTemplateForQuote({
  template,
  quote,
  columns,
  userId,
  filledFileId = null
}) {
  const sourceId = template?.content?.fileId
  if (!sourceId) {
    const err = new Error('This layout has no original file. Re-upload and save the template again.')
    err.status = 400
    throw err
  }

  const buf = await readUploadFileBuffer(sourceId)
  if (!buf?.length) {
    const err = new Error('Original layout file not found. Re-upload the template.')
    err.status = 404
    throw err
  }

  const cols = columns?.length ? columns : (template.mapping?.columns || [])
  const totals = computeQuoteTotals(quote?.items || [], cols, quote?.extraLines)
  const design = template.design || {}

  let outBuf
  if (template.type === 'excel') {
    const cellMap = await resolveExcelCellMap(template, buf, cols)
    const placements = cellMap?.placements || template.mapping?.placements || {}
    if (cellMapIsUsable(cellMap)) {
      outBuf = await fillNativeExcel(buf, cellMap, quote, cols, totals)
    } else {
      let sheets = template.content?.sheets?.length
        ? structuredClone(template.content.sheets)
        : (await parseExcel(buf, template.sourceFileName)).sheets
      sheets = fillExcelTemplate(sheets, quote, cols, design, totals, { placements })
      outBuf = await writeFilledExcel(buf, sheets)
    }
  } else {
    let html = String(template.content?.html || '')
    if (!html.trim()) {
      html = (await parseWord(buf, template.sourceFileName)).html || ''
    }
    const filledHtml = fillWordTemplate(html, quote, cols, design, totals)
    outBuf = await writeFilledWord(buf, filledHtml)
  }

  let targetId = filledFileId
  if (!targetId) {
    targetId = await copyUploadFile(sourceId, userId)
    if (!targetId) {
      const err = new Error('Could not create a working copy of the layout file.')
      err.status = 502
      throw err
    }
  }

  await updateUploadFile(targetId, outBuf, {
    fileName: filledFileName(template, quote)
  })

  return {
    filledFileId: targetId,
    mimeType: template.type === 'excel'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
}
