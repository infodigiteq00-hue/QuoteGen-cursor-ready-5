import ExcelJS from 'exceljs'
import {
  quoteRoleValues,
  cellValueForField,
  resolveColumnForField,
  applyExtraLinesAndTotalsToSheet,
  isLineItemStopText
} from '../shared/templateMap.js'

/** Write filled sheet-model values back into the original workbook (keeps styles, images, formulas). */
export async function writeFilledExcel(originalBuffer, filledSheets) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(originalBuffer)

  ;(filledSheets || []).forEach((sheetModel, si) => {
    const ws = wb.worksheets[si]
    if (!ws || !sheetModel?.rows) return

    syncItemRowCount(ws, sheetModel)

    for (const row of sheetModel.rows) {
      const ri = Number(row.index)
      if (!Number.isFinite(ri) || ri < 1) continue
      for (const cell of row.cells || []) {
        const ci = Number(cell.col)
        if (!Number.isFinite(ci) || ci < 1) continue
        if (cell.formula) continue
        const ec = ws.getCell(ri, ci)
        if (cell.role === 'formula' && ec.formula) continue
        const next = cell.value ?? ''
        if (next === '' && cell.role === 'content') continue
        ec.value = next
      }
    }
  })

  return Buffer.from(await wb.xlsx.writeBuffer())
}

/**
 * Fill only locked coordinates from mapping.excelCellMap — no label guessing.
 */
export async function fillNativeExcel(originalBuffer, cellMap, quote, columns = [], totals = {}) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(originalBuffer)
  const roleValues = quoteRoleValues(quote)
  const items = quote.items || []
  const customer = quote.customer || {}

  for (const [role, loc] of Object.entries(cellMap?.placements || {})) {
    if (role === 'customer_block') continue
    if (roleValues[role] == null) continue
    const ws = wb.worksheets[Number(loc.sheet)]
    if (!ws) continue
    const ri = Number(loc.excelRow)
    const ci = Number(loc.col)
    if (!Number.isFinite(ri) || !Number.isFinite(ci)) continue
    const ec = ws.getCell(ri, ci)
    if (ec.formula) continue
    ec.value = `${loc.labelPrefix || ''}${roleValues[role]}`
  }

  const blockLoc = cellMap?.placements?.customer_block
  if (blockLoc) {
    const ws = wb.worksheets[Number(blockLoc.sheet)]
    const ri = Number(blockLoc.excelRow)
    const ci = Number(blockLoc.col)
    if (ws && Number.isFinite(ri) && Number.isFinite(ci)) {
      const ec = ws.getCell(ri, ci)
      if (!ec.formula) {
        const blockLines = [customer.company, customer.name, customer.location, customer.gst].filter(Boolean)
        ec.value = `${blockLoc.labelPrefix || ''}${blockLines.join('\n')}`
        ec.alignment = { ...(ec.alignment || {}), wrapText: true, vertical: 'top' }
      }
    }
  }
  // Always also fill under CUSTOMER / CLIENT / BILL TO / QUOTATION TO in the real
  // workbook — covers sparse maps and merged address boxes.
  fillCustomerUnderLabel(wb, customer)

  for (const block of cellMap?.lineItems || []) {
    const ws = wb.worksheets[Number(block.sheet)]
    if (!ws || !block.columns?.length) continue
    const startRow = Number(block.firstItemExcelRow)
    if (!Number.isFinite(startRow) || startRow < 1) continue

    const existing = countNativeItemRows(ws, startRow)
    syncNativeItemRows(ws, startRow, existing, items.length)

    const fieldIds = block.columns.map(c => c.fieldId)
    for (let i = 0; i < items.length; i++) {
      const rowNum = startRow + i
      for (const col of block.columns) {
        const ec = ws.getCell(rowNum, Number(col.col))
        // Respect the uploaded template: never overwrite formula cells, and never
        // overwrite Amount / GST / Total — those stay as the user's formulas or
        // values, scaled across rows via duplicateRow + retarget.
        if (cellHasFormula(ec)) continue
        if (!isExcelInputField(col.fieldId, columns)) continue
        const next = excelCellInputValue(items[i], col.fieldId, i, columns, fieldIds)
        if (next === '' && isNumericInputField(col.fieldId, columns)) continue
        ec.value = next
      }
    }

    // Drop cached formula results (template often stores Amount=0 after scrub)
    // so OnlyOffice recalculates row 1 the same way as the inserted rows.
    clearFormulaResults(ws, startRow, items.length)

    const oldItemEnd = startRow + Math.max(1, existing) - 1
    const newItemEnd = startRow + items.length - 1
    if (newItemEnd > oldItemEnd) {
      expandItemBlockFormulas(ws, startRow, oldItemEnd, newItemEnd)
    }

    const sheetModel = worksheetSliceToSheetModel(ws, Number(block.headerExcelRow) || startRow - 1)
    applyExtraLinesAndTotalsToSheet(sheetModel, totals)
    writeSheetModelToWorksheet(ws, sheetModel, startRow + items.length)
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Write company/name/location/gst under CUSTOMER / CLIENT / BILL TO / QUOTATION TO labels. */
export function fillCustomerUnderLabel(wb, customer = {}) {
  const lines = [customer.company, customer.name, customer.location, customer.gst]
    .map(v => String(v || '').trim())
    .filter(Boolean)
  if (!lines.length || !wb?.worksheets?.length) return 0
  const text = lines.join('\n')
  const companyHint = String(customer.company || '').trim().slice(0, 16).toLowerCase()
  const labelRe = /^(customer|client|to|bill\s*to|buyer|consignee|m\/?s\.?|(?:quotation|quote|sold|ship|invoice)\s*to)$/i
  let wrote = 0

  for (const ws of wb.worksheets) {
    const maxRow = Math.max(ws.rowCount || 0, 1)
    for (let rowNum = 1; rowNum <= maxRow; rowNum++) {
      const row = ws.getRow(rowNum)
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const label = cellText(cell).replace(/\s+/g, ' ').trim()
        if (!labelRe.test(label)) return
        // Prefer the cell directly under the label; also try the next column for
        // "CUSTOMER | value" side-by-side layouts.
        const candidates = [
          ws.getCell(rowNum + 1, colNum),
          ws.getCell(rowNum, colNum + 1),
          ws.getCell(rowNum + 1, colNum + 1)
        ]
        for (const target of candidates) {
          if (!target || cellHasFormula(target)) continue
          const existing = cellText(target).replace(/\s+/g, ' ').trim()
          if (companyHint && existing.toLowerCase().includes(companyHint)) {
            wrote++
            return
          }
          // Skip cells that already look like real non-customer content / headers
          if (existing && /^(description|qty|quantity|rate|amount|total|gst|uom|sr|particular)/i.test(existing)) continue
          if (existing && existing.length > 120) continue
          if (existing && labelRe.test(existing)) continue
          target.value = text
          target.alignment = { ...(target.alignment || {}), wrapText: true, vertical: 'top' }
          wrote++
          return
        }
      })
    }
  }
  return wrote
}

function cellText(cell) {
  if (!cell) return ''
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text)
    if (Array.isArray(v.richText)) return v.richText.map(p => p.text || '').join('')
    if (v.result != null) return String(v.result)
  }
  return String(v)
}

/**
 * ExcelJS stores image anchors as 0-based nativeRow (Excel row 1 → 0).
 * duplicateRow / spliceRows move cells but leave drawings behind — shift them manually.
 *
 * @param {import('exceljs').Worksheet} ws
 * @param {number} firstShiftedExcelRow 1-based Excel row of the first row that moved
 * @param {number} delta rows inserted (+) or removed (−)
 */
export function shiftWorksheetImages(ws, firstShiftedExcelRow, delta) {
  if (!ws || !delta || !Number.isFinite(firstShiftedExcelRow) || firstShiftedExcelRow < 1) return 0
  if (typeof ws.getImages !== 'function') return 0
  const threshold = firstShiftedExcelRow - 1 // 0-based
  let moved = 0
  for (const img of ws.getImages() || []) {
    const tl = img?.range?.tl
    const br = img?.range?.br
    let did = false
    if (tl && Number.isFinite(Number(tl.nativeRow)) && Number(tl.nativeRow) >= threshold) {
      tl.nativeRow = Number(tl.nativeRow) + delta
      did = true
    }
    if (br && Number.isFinite(Number(br.nativeRow)) && Number(br.nativeRow) >= threshold) {
      br.nativeRow = Number(br.nativeRow) + delta
      did = true
    }
    if (did) moved++
  }
  return moved
}

function countNativeItemRows(ws, startRow) {
  let count = 0
  for (let r = startRow; r <= (ws.rowCount || 0); r++) {
    const joined = rowText(ws, r)
    if (isNativeItemStopRow(joined, ws, r)) break
    count++
  }
  return Math.max(count, 1)
}

function isNativeItemStopRow(joined, ws, rowNum) {
  if (isLineItemStopText(joined)) return true
  const row = ws.getRow(rowNum)
  let hasFormula = false
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cell.formula) hasFormula = true
  })
  if (hasFormula && !/[0-9]/.test(joined.replace(/[^\d]/g, ''))) return true
  return false
}

function rowText(ws, rowNum) {
  const parts = []
  ws.getRow(rowNum).eachCell({ includeEmpty: false }, (cell) => {
    parts.push(String(cell.value?.text ?? cell.value ?? ''))
  })
  return parts.join(' ')
}

/**
 * ExcelJS duplicateRow copies formula text as-is (B2*C2 stays B2*C2 on every
 * new row). Retarget same-row relative refs so Amount / GST / Total work.
 */
export function retargetFormulaRows(formula, sourceRow, destRow) {
  if (!formula || sourceRow === destRow) return formula
  return String(formula).replace(/(\$?[A-Za-z]{1,3})(\$?)(\d+)/g, (full, col, rowAbs, rowNum) => {
    if (rowAbs === '$') return full
    if (Number(rowNum) !== Number(sourceRow)) return full
    return `${col}${destRow}`
  })
}

export function retargetRowFormulas(ws, templateRow, insertCount) {
  if (!ws || !insertCount || insertCount < 1) return 0
  let fixed = 0
  for (let i = 1; i <= insertCount; i++) {
    const destRow = templateRow + i
    const row = ws.getRow(destRow)
    row.eachCell({ includeEmpty: true }, (cell) => {
      const formula = cell.formula
      if (!formula) return
      const next = retargetFormulaRows(formula, templateRow, destRow)
      if (next === formula) return
      cell.value = { formula: next }
      fixed++
    })
  }
  return fixed
}

/** Strip cached formula results so the client recalculates (fixes first-row Amount=0). */
export function clearFormulaResults(ws, startRow, rowCount) {
  if (!ws || rowCount < 1) return 0
  let cleared = 0
  for (let r = startRow; r < startRow + rowCount; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      const formula = cell.formula
      if (!formula) return
      cell.value = { formula }
      cleared++
    })
  }
  return cleared
}

/**
 * After inserting item rows, widen totals formulas that only covered the old
 * one-row block (e.g. SUM(G21) / G21:G21 → G21:G23).
 */
export function expandItemBlockFormula(formula, itemStartRow, oldItemEndRow, newItemEndRow) {
  if (!formula || newItemEndRow <= oldItemEndRow) return formula
  let next = String(formula)

  // E21:E21 or E21:E22 → E21:E23 (range ends on old last item row)
  next = next.replace(
    /(\$?[A-Za-z]{1,3})(\$?)(\d+):(\$?[A-Za-z]{1,3})(\$?)(\d+)/g,
    (full, c1, a1, r1, c2, a2, r2) => {
      if (a1 === '$' || a2 === '$') return full
      const start = Number(r1)
      const end = Number(r2)
      if (end !== Number(oldItemEndRow)) return full
      if (start < itemStartRow || start > oldItemEndRow) return full
      return `${c1}${start}:${c2}${newItemEndRow}`
    }
  )

  // SUM(E21) → SUM(E21:E23) when it pointed at the sole template item row
  next = next.replace(
    /\bSUM\((\$?[A-Za-z]{1,3})(\$?)(\d+)\)/gi,
    (full, col, abs, rowNum) => {
      if (abs === '$') return full
      if (Number(rowNum) !== Number(oldItemEndRow)) return full
      if (Number(rowNum) < itemStartRow) return full
      return `SUM(${col}${itemStartRow}:${col}${newItemEndRow})`
    }
  )

  return next
}

export function expandItemBlockFormulas(ws, itemStartRow, oldItemEndRow, newItemEndRow) {
  if (!ws || newItemEndRow <= oldItemEndRow) return 0
  let fixed = 0
  const last = Math.max(ws.rowCount || 0, newItemEndRow + 40)
  for (let r = 1; r <= last; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      const formula = cell.formula
      if (!formula) return
      let next = expandItemBlockFormula(formula, itemStartRow, oldItemEndRow, newItemEndRow)
      // Totals row with a lone =G21 pointing at the old single item cell → SUM(G21:G23)
      if (r > newItemEndRow) {
        const bare = String(next).trim().match(/^(\$?[A-Za-z]{1,3})(\$?)(\d+)$/)
        if (bare && bare[2] !== '$' && Number(bare[3]) === Number(oldItemEndRow) && Number(bare[3]) >= itemStartRow) {
          next = `SUM(${bare[1]}${itemStartRow}:${bare[1]}${newItemEndRow})`
        }
      }
      if (next === formula) return
      cell.value = { formula: next }
      fixed++
    })
  }
  return fixed
}

/**
 * Only write enquiry inputs into the sheet. Amount / GST / Total (and tax-typed
 * columns) stay as the template authored them — formulas or static rates —
 * then scale across N item rows via duplicate + retarget.
 */
export function isExcelInputField(fieldId, columns = []) {
  const id = String(fieldId || '').toLowerCase()
  if (!id) return false
  const letters = id.replace(/[^a-z]/g, '')
  if (/^(amount|total|tax|gst|gstrate|taxamount|gstamount|discount|discountrate)$/.test(id)) return false
  if (/^(cgst|sgst|igst)/.test(id)) return false
  if (/^gst\d/.test(id) || letters === 'gst') return false
  const col = resolveColumnForField(fieldId, columns) || (columns || []).find(c => c?.id === fieldId)
  if (col && /^(tax|discount)$/i.test(String(col.type || ''))) return false
  if (col && /^(amount|total)$/i.test(String(col.id || ''))) return false
  return true
}

/** Prefer real numbers for qty/rate so Excel formulas don't #VALUE! on text. */
export function excelCellInputValue(item, fieldId, rowIndex, columns, fieldIds) {
  const raw = cellValueForField(item, fieldId, rowIndex, columns, fieldIds)
  if (raw === '' || raw == null) return ''
  if (!isNumericInputField(fieldId, columns)) return raw
  const cleaned = String(raw).replace(/[₹,\s]/g, '').replace(/%$/, '')
  if (cleaned === '' || Number.isNaN(Number(cleaned))) return raw
  return Number(cleaned)
}

export function isNumericInputField(fieldId, columns = []) {
  const id = String(fieldId || '')
  if (/^(quantity|qty|rate|price)$/i.test(id)) return true
  const col = (columns || []).find(c => c?.id === fieldId)
  return Boolean(col && /^(number|currency|percent|quantity|rate)$/i.test(String(col.type || '')))
}

function cellHasFormula(cell) {
  if (!cell) return false
  if (cell.formula) return true
  const v = cell.value
  return Boolean(v && typeof v === 'object' && (v.formula || v.sharedFormula))
}

function syncNativeItemRows(ws, startRow, existing, needed) {
  const safeExisting = Math.max(0, existing)
  const safeNeeded = Math.max(0, needed)
  if (safeNeeded > safeExisting && safeExisting > 0) {
    const templateRow = startRow + safeExisting - 1
    const insertCount = safeNeeded - safeExisting
    ws.duplicateRow(templateRow, insertCount, true)
    retargetRowFormulas(ws, templateRow, insertCount)
    // Rows after templateRow shift down; signature/images below follow.
    shiftWorksheetImages(ws, templateRow + 1, insertCount)
  } else if (safeNeeded < safeExisting && safeNeeded >= 0) {
    const removeAt = startRow + safeNeeded
    const removeCount = safeExisting - safeNeeded
    if (removeCount > 0) {
      ws.spliceRows(removeAt, removeCount)
      shiftWorksheetImages(ws, removeAt, -removeCount)
    }
  }
}

function worksheetSliceToSheetModel(ws, fromRow) {
  const rows = []
  for (let r = Math.max(1, fromRow); r <= (ws.rowCount || 0); r++) {
    const cells = []
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      cells.push({
        col: colNumber,
        value: cell.value?.text ?? cell.value ?? '',
        formula: cell.formula,
        role: 'content'
      })
    })
    rows.push({ index: r, cells })
  }
  return { rows }
}

function writeSheetModelToWorksheet(ws, sheetModel, fromRow) {
  for (const row of sheetModel.rows || []) {
    if (Number(row.index) < fromRow) continue
    for (const cell of row.cells || []) {
      const ec = ws.getCell(Number(row.index), Number(cell.col))
      if (ec.formula) continue
      if (cell.formula) continue
      const next = cell.value ?? ''
      if (next === '' && cell.role === 'content') continue
      ec.value = next
    }
  }
}

function syncItemRowCount(ws, sheetModel) {
  const headerRowIndex = Number.isInteger(sheetModel._headerRowIndex)
    ? sheetModel._headerRowIndex
    : findItemHeaderRowIndex(sheetModel)
  if (headerRowIndex < 0) return

  const start = Number.isInteger(sheetModel._itemStart) ? sheetModel._itemStart : headerRowIndex + 1
  let modelEnd = start
  for (let i = start; i < (sheetModel.rows || []).length; i++) {
    const row = sheetModel.rows[i]
    if (isItemStopRow(row)) break
    if (row.cells?.some(c => c.role === 'line_item' || Number.isInteger(c.itemIndex))) modelEnd = i + 1
  }
  const needed = Math.max(0, modelEnd - start)

  let wsEnd = start
  for (let r = start; r <= (ws.rowCount || 0); r++) {
    const row = sheetModel.rows[r - 1]
    if (row && isItemStopRow(row)) break
    wsEnd = r
  }
  const existing = Math.max(0, wsEnd - start + 1)

  if (needed > existing && existing > 0) {
    const templateRow = start + existing - 1
    const insertCount = needed - existing
    ws.duplicateRow(templateRow, insertCount, true)
    retargetRowFormulas(ws, templateRow, insertCount)
    shiftWorksheetImages(ws, templateRow + 1, insertCount)
  } else if (needed < existing && needed >= 0) {
    const removeAt = start + needed
    const removeCount = existing - needed
    if (removeCount > 0) {
      ws.spliceRows(removeAt, removeCount)
      shiftWorksheetImages(ws, removeAt, -removeCount)
    }
  }
}

function findItemHeaderRowIndex(sheet) {
  for (let i = 0; i < Math.min(sheet.rows?.length || 0, 80); i++) {
    const labels = (sheet.rows[i].cells || []).map(c => String(c.value || ''))
    if (lineItemHeaderScore(labels) >= 0) return i
  }
  return -1
}

function lineItemHeaderScore(labels) {
  const keys = ['description', 'particular', 'item', 'qty', 'quantity', 'rate', 'amount', 'unit', 'uom']
  const joined = labels.join(' ').toLowerCase()
  let score = 0
  for (const k of keys) if (joined.includes(k)) score++
  return score >= 2 ? score : -1
}

function isItemStopRow(row) {
  if (!row) return true
  const joined = (row.cells || []).map(c => c.value).join(' ').toLowerCase()
  if (/sub\s*total|grand\s*total|total amount|amount in words|bank details/.test(joined)) return true
  if ((row.cells || []).some(c => c.role === 'total' || c.role === 'formula') && !row.cells.some(c => c.role === 'line_item')) return true
  return false
}
