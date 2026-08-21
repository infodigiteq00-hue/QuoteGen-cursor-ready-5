import {
  amountKey,
  columnType,
  extraLineResolvedAmount,
  isAttachmentColumn,
  isImageColumn,
  isNestedColumn,
  rateKey,
  recalcAllRows
} from '../shared/quoteColumns.js'
import { formatIndianAmount } from '../shared/templateMap.js'
import { normalizeFooterFit } from '../shared/footerFit.js'
import { quotationFileName, capturePreviewCanvases } from './pdfExport.js'

function money(n) {
  if (n == null || n === '') return ''
  const num = Number(n)
  if (!Number.isFinite(num)) return String(n)
  return `₹ ${formatIndianAmount(num)}`
}

function cellText(item, col) {
  if (!col || !item) return ''
  if (isImageColumn(col)) return item[col.id] ? 'Image attached' : ''
  if (isAttachmentColumn(col)) return String(item[col.id] || '').trim()
  if (isNestedColumn(col)) return ''
  return String(item[col.id] ?? '').trim()
}

export function exportTableColumns(columns) {
  const cols = []
  cols.push({ key: '_sr', label: 'Sr. No.' })
  for (const col of columns || []) {
    if (isNestedColumn(col)) {
      cols.push({ key: rateKey(col), label: `${col.label} %`, align: 'right' })
      cols.push({ key: amountKey(col), label: `${col.label} Amt`, align: 'right', money: true })
      continue
    }
    const numeric = col.id === 'quantity' || col.id === 'rate' || col.id === 'amount' || columnType(col) === 'hsn'
    cols.push({
      key: col.id,
      label: col.label,
      align: col.id === 'amount' || col.id === 'rate' || col.id === 'quantity' ? 'right' : 'left',
      money: col.id === 'rate' || col.id === 'amount',
      media: isImageColumn(col) || isAttachmentColumn(col)
    })
    void numeric
  }
  return cols
}

function rowValues(item, columns, index) {
  const values = { _sr: String(index + 1) }
  for (const col of columns || []) {
    if (isNestedColumn(col)) {
      values[rateKey(col)] = String(item[rateKey(col)] ?? '')
      values[amountKey(col)] = String(item[amountKey(col)] ?? '')
      continue
    }
    values[col.id] = cellText(item, col)
  }
  return values
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Word (.doc HTML) that follows the live preview: accent captions, solid
 * header row, same fields. Opens cleanly in Word and Google Docs.
 */
export function downloadQuotationWord({ quote, profile, columns, totals, theme, docLabel }) {
  const accent = theme?.accent || '#1A73E8'
  const headBg = theme?.tableHeadBg || '#061A3D'
  const headText = theme?.tableHeadText || '#ffffff'
  const border = theme?.tableBorder || '#e8edf3'
  const stripe = theme?.tableStripeBg || '#f7fafd'
  const muted = theme?.muted || '#718096'
  const text = theme?.text || '#2d3748'
  const fontFamily = theme?.fontFamily || 'Inter, Calibri, Arial, sans-serif'
  const titleFont = theme?.titleFont || 'Outfit, Inter, Arial, sans-serif'
  const exportCols = exportTableColumns(columns)
  const items = recalcAllRows(quote?.items || [], columns)
  const customer = quote?.customer || {}
  const terms = quote?.terms || {}
  const notes = (quote?.notes || []).filter(Boolean)
  const headerText = String(profile?.headerText || '').trim()
  const logo = profile?.logoUrl
    ? `<img src="${escapeHtml(profile.logoUrl)}" alt="" style="max-height:64px;max-width:120px;" />`
    : ''
  const headerImage = profile?.headerImageUrl
    ? `<div style="margin:0 0 16px;"><img src="${escapeHtml(profile.headerImageUrl)}" alt="" style="width:100%;max-height:140px;object-fit:cover;" /></div>`
    : ''

  const headCells = exportCols.map(c =>
    `<th style="background:${headBg};color:${headText};font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:8px 10px;border:1px solid ${border};text-align:${c.align || 'left'};">${escapeHtml(c.label)}</th>`
  ).join('')

  const bodyRows = items.map((item, i) => {
    const values = rowValues(item, columns, i)
    return `<tr>${exportCols.map((c, ci) => {
      const raw = values[c.key] ?? ''
      const shown = c.money && raw !== '' ? money(raw) : raw
      return `<td style="padding:8px 10px;border:1px solid ${border};vertical-align:top;white-space:pre-wrap;text-align:${c.align || 'left'};${ci % 2 === 1 ? `background:${stripe};` : ''}">${escapeHtml(shown).replace(/\n/g, '<br/>')}</td>`
    }).join('')}</tr>`
  }).join('')

  const extraRows = (quote?.extraLines || []).map(line => {
    const amt = extraLineResolvedAmount(line, totals?.extraBase)
    const label = `${line.kind === 'add' ? 'Add' : 'Less'}: ${String(line.label || '').trim() || 'Extra'}`
    return [label, amt]
  })
  const totalRows = [
    ['Subtotal', totals?.subtotal],
    ...(totals?.perColumn || []).filter(e => e.type === 'discount').map(e => [`Less: ${e.label}`, e.amount]),
    totals?.discountTotal > 0 ? ['Taxable value', totals.taxableTotal] : null,
    ...(totals?.perColumn || []).filter(e => e.type === 'tax').map(e => [`Add: ${e.label}`, e.amount]),
    ...extraRows,
    ['Total', totals?.grandTotal]
  ].filter(Boolean).map(([label, amount], i, arr) => {
    const last = i === arr.length - 1
    return `<tr>
      <td style="padding:4px 0;color:${last ? text : muted};font-weight:${last ? 700 : 400};">${escapeHtml(label)}</td>
      <td style="padding:4px 0;text-align:right;font-weight:${last ? 700 : 400};">${money(amount)}</td>
    </tr>`
  }).join('')

  const footerFit = normalizeFooterFit(profile?.footerFit)
  const footerImage = profile?.footerImageUrl
    ? `<div style="margin:28px auto 0;width:${footerFit.width}%;height:${footerFit.height}px;overflow:hidden;position:relative;">
         <img src="${escapeHtml(profile.footerImageUrl)}" alt="" style="display:block;width:100%;height:100%;object-fit:cover;object-position:${footerFit.x}% ${footerFit.y}%;transform:scale(${footerFit.zoom / 100});transform-origin:${footerFit.x}% ${footerFit.y}%;" />
       </div>`
    : ''

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docLabel || 'QUOTATION')}</title>
<style>
  body { font-family: ${fontFamily}; color: ${text}; font-size: 12pt; background: ${theme?.paperBg || '#fff'}; }
</style>
</head>
<body>
  ${headerImage}
  <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
    <tr>
      <td style="vertical-align:top;">
        ${logo}
        <div style="font-size:18pt;font-weight:700;color:${accent};margin-top:6px;">${escapeHtml(profile?.companyName || 'Your Company Name')}</div>
        <div style="color:${muted};font-size:10pt;white-space:pre-line;">${escapeHtml(headerText)}</div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:18pt;font-weight:500;letter-spacing:.08em;color:${accent};font-family:${titleFont};">${escapeHtml(docLabel || 'QUOTATION')}</div>
        <div style="margin-top:10px;color:${accent};font-size:9pt;font-weight:700;">NO.</div>
        <div>${escapeHtml(quote?.number || '')}</div>
        <div style="margin-top:6px;color:${accent};font-size:9pt;font-weight:700;">DATE</div>
        <div>${escapeHtml(quote?.date || '')}</div>
        <div style="margin-top:6px;color:${accent};font-size:9pt;font-weight:700;">VALID TILL</div>
        <div>${escapeHtml(quote?.fields?.validUntil || quote?.validUntil || '')}</div>
      </td>
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;margin:16px 0 22px;border-top:1px solid ${border};border-bottom:1px solid ${border};">
    <tr>
      <td style="width:55%;padding:12px 16px 12px 0;vertical-align:top;">
        <div style="color:${accent};font-size:12pt;font-weight:700;letter-spacing:.12em;border-bottom:1.5px solid ${accent};display:inline-block;padding-bottom:3px;">TO</div>
        <div style="font-weight:700;margin-top:8px;">${escapeHtml(customer.company || '')}</div>
        <div style="color:${muted};">${escapeHtml(customer.name || '')}</div>
        <div style="color:${muted};">${escapeHtml(customer.location || '')}</div>
        <div style="color:${muted};">${escapeHtml(customer.gst || '')}</div>
      </td>
      <td style="padding:12px 0 12px 16px;vertical-align:top;border-left:1px solid ${border};">
        <div style="color:${accent};font-size:12pt;font-weight:700;letter-spacing:.12em;border-bottom:1.5px solid ${accent};display:inline-block;padding-bottom:3px;">SUBJECT</div>
        <div style="font-weight:700;margin-top:8px;">${escapeHtml(quote?.title || '')}</div>
      </td>
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;">
    <thead><tr>${headCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <table style="margin-left:auto;margin-top:16px;width:260px;border-collapse:collapse;">${totalRows}</table>
  <div style="margin-top:28px;">
    <div style="color:${accent};font-size:9pt;font-weight:800;letter-spacing:.1em;">STANDARD TERMS</div>
    <div style="color:${muted};white-space:pre-line;margin-top:6px;">${escapeHtml(profile?.standardTerms || '')}</div>
  </div>
  <div style="margin-top:18px;">
    <div style="color:${accent};font-size:9pt;font-weight:800;letter-spacing:.1em;">NOTES</div>
    <div style="margin-top:6px;">${notes.map(n => `<div>${escapeHtml(n)}</div>`).join('')}</div>
  </div>
  <div style="margin-top:18px;">
    <div style="color:${accent};font-size:9pt;font-weight:800;letter-spacing:.1em;">COMMERCIAL TERMS</div>
    ${Object.entries(terms).map(([k, v]) => `<div style="border-bottom:1px dashed ${border};padding:6px 0;"><span style="color:${muted};display:inline-block;width:140px;text-transform:capitalize;">${escapeHtml(k)}</span> ${escapeHtml(v)}</div>`).join('')}
  </div>
  ${bankRows(profile).length || profile?.bankQrUrl ? `<div style="margin-top:18px;">
    <div style="color:${accent};font-size:9pt;font-weight:800;letter-spacing:.1em;">BANK DETAILS</div>
    <table style="width:auto;border-collapse:collapse;margin-top:6px;">
      <tr>
        ${profile?.bankQrUrl ? `<td style="width:118px;padding-right:14px;vertical-align:top;text-align:center;border-right:1px solid ${border};">
          <img src="${escapeHtml(profile.bankQrUrl)}" alt="Payment QR" style="width:96px;height:96px;object-fit:contain;" />
          <div style="margin-top:6px;font-size:8pt;line-height:1.3;color:${muted};">Scan with any UPI payment app</div>
        </td>` : ''}
        <td style="vertical-align:top;${profile?.bankQrUrl ? 'padding-left:16px;' : ''}">
          ${bankRows(profile).map(([k, v]) => `<div style="padding:4px 0;"><span style="color:${muted};display:inline-block;width:140px;">${escapeHtml(k)}</span> ${escapeHtml(v)}</div>`).join('')}
        </td>
      </tr>
    </table>
  </div>` : ''}
  ${footerImage}
</body>
</html>`

  saveBlob(new Blob(['\ufeff', html], { type: 'application/msword' }), quotationFileName(quote, 'doc'))
}

function bankRows(profile) {
  return [
    ['Bank Name', profile?.bankName],
    ['Account Name', profile?.bankAccountName || profile?.companyName],
    ['Account No', profile?.bankAccountNo],
    ['IFSC / SWIFT', profile?.bankIfsc]
  ].filter(([, value]) => String(value || '').trim())
}

function rasterFromDataUrl(url) {
  const match = String(url || '').match(/^data:image\/(png|jpe?g);base64,(.+)$/i)
  if (!match) return null
  const kind = match[1].toLowerCase()
  return {
    extension: kind === 'jpg' || kind === 'jpeg' ? 'jpeg' : 'png',
    base64: match[2]
  }
}

export async function downloadPreviewAsWord(quote) {
  const { canvases } = await capturePreviewCanvases()
  if (!canvases.length) throw new Error('nothing on screen to export')
  const zipMod = await import('jszip')
  const JSZip = zipMod.default || zipMod
  const zip = new JSZip()
  const A4_CX = 7560310
  const A4_CY = 10656126
  const pageTwips = { w: 11906, h: 16838 }

  const mediaRels = canvases.map((_, i) => (
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.jpeg"/>`
  )).join('')

  const pageXml = canvases.map((_, i) => {
    const pageBreak = i < canvases.length - 1 ? '<w:r><w:br w:type="page"/></w:r>' : ''
    return `<w:p>
      <w:pPr>
        <w:spacing w:before="0" w:after="0" w:line="0" w:lineRule="exact"/>
        <w:ind w:left="0" w:right="0"/>
        <w:jc w:val="left"/>
        <w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>
      </w:pPr>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${A4_CX}" cy="${A4_CY}"/>
            <wp:effectExtent l="0" t="0" r="0" b="0"/>
            <wp:docPr id="${i + 1}" name="Page ${i + 1}"/>
            <wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:nvPicPr>
                    <pic:cNvPr id="${i}" name="image${i + 1}.jpeg"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="rId${i + 1}"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="${A4_CX}" cy="${A4_CY}"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
      ${pageBreak}
    </w:p>`
  }).join('')

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    ${pageXml}
    <w:sectPr>
      <w:pgSz w:w="${pageTwips.w}" w:h="${pageTwips.h}" w:orient="portrait"/>
      <w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`)
  zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${mediaRels}
</Relationships>`)
  const media = zip.folder('word').folder('media')
  canvases.forEach((canvas, i) => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95)
    const raster = rasterFromDataUrl(dataUrl)
    if (!raster) return
    media.file(`image${i + 1}.jpeg`, raster.base64, { base64: true })
  })

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  })
  saveBlob(blob, quotationFileName(quote, 'docx'))
}

export function downloadHtmlAsWord(html, fileName) {
  const wrapped = String(html || '').includes('<html')
    ? html
    : `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>${html || ''}</body></html>`
  saveBlob(new Blob(['\ufeff', wrapped], { type: 'application/msword' }), fileName)
}

export async function downloadPreviewAsExcel({ quote, profile, columns, totals, theme, docLabel }) {
  const { canvases } = await capturePreviewCanvases()
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'QuoteGen'
  const preview = wb.addWorksheet('Preview', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalDpi: 96,
      verticalDpi: 96,
      margins: { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 }
    }
  })
  preview.getColumn(1).width = 88
  const pageRowHeight = 760
  canvases.forEach((canvas, i) => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const raster = rasterFromDataUrl(dataUrl)
    if (!raster) return
    const imageId = wb.addImage({ base64: raster.base64, extension: raster.extension })
    const startRow = i * 52
    preview.addImage(imageId, {
      tl: { col: 0, row: startRow },
      ext: { width: 794, height: 1123 }
    })
    preview.getRow(startRow + 1).height = pageRowHeight
    if (i < canvases.length - 1) {
      try { preview.addPageBreak(startRow + 50) } catch { /* older exceljs */ }
    }
  })
  fillQuotationDataSheet(wb, { quote, profile, columns, totals, theme, docLabel, sheetName: 'Items' })
  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), quotationFileName(quote, 'xlsx'))
}

async function loadExcelJS() {
  const mod = await import('exceljs')
  return mod.default || mod
}

function fillQuotationDataSheet(wb, { quote, profile, columns, totals, theme, docLabel, sheetName }) {
  const accent = (theme?.accent || '#1A73E8').replace('#', '')
  const headBg = (theme?.tableHeadBg || '#061A3D').replace('#', '')
  const headText = (theme?.tableHeadText || '#ffffff').replace('#', '')
  const stripe = (theme?.tableStripeBg || '#f7fafd').replace('#', '')
  const sheet = wb.addWorksheet(sheetName || docLabel || 'Quotation', { views: [{ showGridLines: false }] })
  const exportCols = exportTableColumns(columns)
  const items = recalcAllRows(quote?.items || [], columns)
  const customer = quote?.customer || {}

  sheet.getColumn(1).width = 28
  sheet.getColumn(2).width = 42
  exportCols.forEach((_, i) => {
    sheet.getColumn(i + 1).width = i === 1 ? 36 : 16
  })

  let r = 1
  sheet.mergeCells(r, 1, r, Math.max(2, exportCols.length))
  sheet.getCell(r, 1).value = profile?.companyName || 'Your Company Name'
  sheet.getCell(r, 1).font = { name: 'Calibri', size: 16, bold: true, color: { argb: `FF${accent}` } }
  r += 1
  if (profile?.headerText) {
    sheet.mergeCells(r, 1, r, Math.max(2, exportCols.length))
    sheet.getCell(r, 1).value = String(profile.headerText)
    sheet.getCell(r, 1).font = { name: 'Calibri', size: 10, color: { argb: 'FF718096' } }
    sheet.getCell(r, 1).alignment = { wrapText: true }
    r += 1
  }
  r += 1
  sheet.getCell(r, 1).value = docLabel || 'QUOTATION'
  sheet.getCell(r, 1).font = { name: 'Calibri', size: 14, bold: true, color: { argb: `FF${accent}` } }
  sheet.getCell(r, 2).value = quote?.number || ''
  r += 1
  sheet.getCell(r, 1).value = 'Date'
  sheet.getCell(r, 1).font = { color: { argb: `FF${accent}` }, bold: true, size: 9 }
  sheet.getCell(r, 2).value = quote?.date || ''
  r += 1
  sheet.getCell(r, 1).value = 'Valid till'
  sheet.getCell(r, 1).font = { color: { argb: `FF${accent}` }, bold: true, size: 9 }
  sheet.getCell(r, 2).value = quote?.fields?.validUntil || quote?.validUntil || ''
  r += 2
  sheet.getCell(r, 1).value = 'TO'
  sheet.getCell(r, 1).font = { bold: true, color: { argb: `FF${accent}` }, size: 12 }
  sheet.getCell(r, 3).value = 'SUBJECT'
  sheet.getCell(r, 3).font = { bold: true, color: { argb: `FF${accent}` }, size: 12 }
  r += 1
  sheet.getCell(r, 1).value = customer.company || ''
  sheet.getCell(r, 1).font = { bold: true }
  sheet.mergeCells(r, 3, r, Math.max(3, exportCols.length))
  sheet.getCell(r, 3).value = quote?.title || ''
  sheet.getCell(r, 3).font = { bold: true }
  r += 1
  sheet.getCell(r, 1).value = [customer.name, customer.location, customer.gst].filter(Boolean).join('\n')
  sheet.getCell(r, 1).alignment = { wrapText: true }
  r += 2

  const headerRow = sheet.getRow(r)
  exportCols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.label
    cell.font = { bold: true, size: 9, color: { argb: `FF${headText}` } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headBg}` } }
    cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left' }
  })
  r += 1

  items.forEach((item, index) => {
    const values = rowValues(item, columns, index)
    const row = sheet.getRow(r)
    exportCols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      const raw = values[c.key] ?? ''
      if (c.money && raw !== '' && Number.isFinite(Number(raw))) cell.value = Number(raw)
      else cell.value = raw
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: c.align === 'right' ? 'right' : 'left' }
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${stripe}` } }
      if (c.money) cell.numFmt = '₹#,##0.00'
    })
    r += 1
  })

  r += 1
  const addTotal = (label, amount, bold) => {
    sheet.getCell(r, Math.max(1, exportCols.length - 1)).value = label
    sheet.getCell(r, Math.max(1, exportCols.length - 1)).font = { bold: !!bold, color: { argb: bold ? `FF${accent}` : 'FF718096' } }
    sheet.getCell(r, exportCols.length).value = Number(amount || 0)
    sheet.getCell(r, exportCols.length).numFmt = '₹#,##0.00'
    sheet.getCell(r, exportCols.length).font = { bold: !!bold }
    r += 1
  }
  addTotal('Subtotal', totals?.subtotal)
  for (const entry of (totals?.perColumn || []).filter(e => e.type === 'discount')) addTotal(`Less: ${entry.label}`, entry.amount)
  if (totals?.discountTotal > 0) addTotal('Taxable value', totals.taxableTotal)
  for (const entry of (totals?.perColumn || []).filter(e => e.type === 'tax')) addTotal(`Add: ${entry.label}`, entry.amount)
  for (const line of (quote?.extraLines || [])) {
    const amt = extraLineResolvedAmount(line, totals?.extraBase)
    addTotal(`${line.kind === 'add' ? 'Add' : 'Less'}: ${String(line.label || '').trim() || 'Extra'}`, amt)
  }
  addTotal('Total', totals?.grandTotal, true)

  r += 2
  sheet.getCell(r, 1).value = 'STANDARD TERMS'
  sheet.getCell(r, 1).font = { bold: true, color: { argb: `FF${accent}` }, size: 10 }
  r += 1
  sheet.mergeCells(r, 1, r, exportCols.length)
  sheet.getCell(r, 1).value = profile?.standardTerms || ''
  sheet.getCell(r, 1).alignment = { wrapText: true }
  r += 2
  sheet.getCell(r, 1).value = 'NOTES'
  sheet.getCell(r, 1).font = { bold: true, color: { argb: `FF${accent}` }, size: 10 }
  r += 1
  sheet.mergeCells(r, 1, r, exportCols.length)
  sheet.getCell(r, 1).value = (quote?.notes || []).filter(Boolean).join('\n')
  sheet.getCell(r, 1).alignment = { wrapText: true }

  const terms = quote?.terms || {}
  if (Object.keys(terms).length) {
    r += 2
    sheet.getCell(r, 1).value = 'COMMERCIAL TERMS'
    sheet.getCell(r, 1).font = { bold: true, color: { argb: `FF${accent}` }, size: 10 }
    r += 1
    for (const [k, v] of Object.entries(terms)) {
      sheet.getCell(r, 1).value = k
      sheet.getCell(r, 1).font = { color: { argb: 'FF718096' } }
      sheet.getCell(r, 2).value = v
      r += 1
    }
  }

  const banks = bankRows(profile)
  const qrImage = rasterFromDataUrl(profile?.bankQrUrl)
  if (banks.length || qrImage) {
    r += 1
    const headingRow = r
    sheet.getCell(r, 1).value = 'BANK DETAILS'
    sheet.getCell(r, 1).font = { bold: true, color: { argb: `FF${accent}` }, size: 10 }
    r += 1
    for (const [k, v] of banks) {
      sheet.getCell(r, qrImage ? 2 : 1).value = k
      sheet.getCell(r, qrImage ? 2 : 1).font = { color: { argb: 'FF718096' } }
      sheet.getCell(r, qrImage ? 3 : 2).value = v
      r += 1
    }
    if (qrImage) {
      const imageId = wb.addImage({ base64: qrImage.base64, extension: qrImage.extension })
      sheet.addImage(imageId, {
        tl: { col: 0, row: headingRow },
        ext: { width: 90, height: 90 }
      })
    }
  }
  return sheet
}

export async function downloadQuotationExcel({ quote, profile, columns, totals, theme, docLabel }) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'QuoteGen'
  fillQuotationDataSheet(wb, { quote, profile, columns, totals, theme, docLabel })
  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), quotationFileName(quote, 'xlsx'))
}

export async function downloadFilledExcelSheets(sheets, quote) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'QuoteGen'
  const list = Array.isArray(sheets) && sheets.length ? sheets : [{ name: 'Quotation', rows: [], columns: [] }]
  for (const src of list) {
    const sheet = wb.addWorksheet(String(src.name || 'Sheet').slice(0, 31) || 'Sheet')
    ;(src.columns || []).forEach((col, i) => {
      const widthPx = Number(col.widthPx) || 80
      sheet.getColumn(i + 1).width = Math.max(8, Math.round(widthPx / 7.2))
    })
    ;(src.rows || []).forEach((row, ri) => {
      const excelRow = sheet.getRow(ri + 1)
      if (row.heightPx) excelRow.height = Math.max(14, Math.round(Number(row.heightPx) * 0.75))
      ;(row.cells || []).forEach((cell, ci) => {
        const target = excelRow.getCell(cell.col || ci + 1)
        target.value = cell.value ?? ''
        target.alignment = { wrapText: true, vertical: 'top' }
        if (cell.rowSpan > 1 || cell.colSpan > 1) {
          const startCol = cell.col || ci + 1
          const endRow = ri + (cell.rowSpan || 1)
          const endCol = startCol + (cell.colSpan || 1) - 1
          try { sheet.mergeCells(ri + 1, startCol, endRow, endCol) } catch { /* overlapping merge from template */ }
        }
      })
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), quotationFileName(quote, 'xlsx'))
}
