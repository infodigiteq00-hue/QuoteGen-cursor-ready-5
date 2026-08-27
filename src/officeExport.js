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
import { A4_HEIGHT_PX, A4_WIDTH_PX } from './a4Pagination.js'

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
export function buildQuotationWordHtml({ quote, profile, columns, totals, theme, docLabel }) {
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
    ? `<img src="${escapeHtml(profile.logoUrl)}" alt="" style="max-height:64px;max-width:120px;width:auto;height:auto;object-fit:contain;" />`
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
    ? `<div style="margin:28px auto 0;width:${footerFit.width}%;text-align:center;">
         <img src="${escapeHtml(profile.footerImageUrl)}" alt="" style="display:inline-block;max-width:100%;max-height:${Math.min(160, footerFit.height)}px;width:auto;height:auto;object-fit:contain;" />
       </div>`
    : ''

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docLabel || 'QUOTATION')}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
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
        <div style="color:${muted};font-size:8pt;margin-top:4px;">${customer.shippingSame === false ? 'Billing address' : 'Billing &amp; shipping address'}</div>
        <div style="font-weight:700;margin-top:8px;">${escapeHtml(customer.company || '')}</div>
        <div style="color:${muted};">${escapeHtml(customer.name || '')}</div>
        <div style="color:${muted};">${escapeHtml(customer.location || '')}</div>
        <div style="color:${muted};">${escapeHtml(customer.gst || '')}</div>
      </td>
      <td style="padding:12px 0 12px 16px;vertical-align:top;border-left:1px solid ${border};">
        ${customer.shippingSame === false ? `
        <div style="color:${accent};font-size:12pt;font-weight:700;letter-spacing:.12em;border-bottom:1.5px solid ${accent};display:inline-block;padding-bottom:3px;">SHIP TO</div>
        <div style="color:${muted};font-size:8pt;margin-top:4px;">Shipping address</div>
        <div style="font-weight:700;margin-top:8px;">${escapeHtml(customer.shippingLocation || '')}</div>
        ` : `
        <div style="color:${accent};font-size:12pt;font-weight:700;letter-spacing:.12em;border-bottom:1.5px solid ${accent};display:inline-block;padding-bottom:3px;">SUBJECT</div>
        <div style="font-weight:700;margin-top:8px;">${escapeHtml(quote?.title || '')}</div>
        `}
      </td>
    </tr>
    ${customer.shippingSame === false ? `
    <tr>
      <td colspan="2" style="padding:12px 0 12px 0;vertical-align:top;border-top:1px dashed ${border};">
        <div style="color:${accent};font-size:12pt;font-weight:700;letter-spacing:.12em;border-bottom:1.5px solid ${accent};display:inline-block;padding-bottom:3px;">SUBJECT</div>
        <div style="font-weight:700;margin-top:8px;">${escapeHtml(quote?.title || '')}</div>
      </td>
    </tr>` : ''}
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
}

export function downloadQuotationWord(opts) {
  const html = buildQuotationWordHtml(opts)
  saveBlob(new Blob(['\ufeff', html], { type: 'application/msword' }), quotationFileName(opts?.quote, 'doc'))
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
  const match = String(url || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i)
  if (!match) return null
  const kind = match[1].toLowerCase()
  return {
    extension: kind === 'jpg' || kind === 'jpeg' ? 'jpeg' : kind === 'webp' ? 'png' : 'png',
    base64: match[2]
  }
}

/** Fetch logo/banner URLs (incl. /api/quote-assets) into Excel-ready base64. */
async function fetchRaster(url) {
  if (!url) return null
  const inline = rasterFromDataUrl(url)
  if (inline) return inline
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    const parsed = rasterFromDataUrl(dataUrl)
    if (parsed) return parsed
    // ExcelJS prefers png/jpeg — convert odd types via canvas when possible.
    if (typeof document !== 'undefined' && dataUrl.startsWith('data:image/')) {
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = dataUrl
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width || 1
      canvas.height = img.naturalHeight || img.height || 1
      canvas.getContext('2d').drawImage(img, 0, 0)
      return rasterFromDataUrl(canvas.toDataURL('image/png'))
    }
    return null
  } catch {
    return null
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

/** 210mm × 297mm in EMUs — same full-bleed A4 as the Word page images. */
const A4_EMU_CX = Math.round(210 / 25.4 * 914400)
const A4_EMU_CY = Math.round(297 / 25.4 * 914400)
const A4_ROW_PT = 297 / 25.4 * 72
const A4_COL_WIDTH = (A4_WIDTH_PX - 5) / 7
/** Excel/WPS max row height is 409pt; A4 is ~842pt so one page needs several rows. */
const EXCEL_MAX_ROW_PT = 409
const ROWS_PER_PAGE = Math.ceil(A4_ROW_PT / EXCEL_MAX_ROW_PT)
const PAGE_ROW_PT = A4_ROW_PT / ROWS_PER_PAGE

function rasterizeA4Jpeg(source) {
  const width = A4_WIDTH_PX * 2
  const height = A4_HEIGHT_PX * 2
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  const sw = Math.max(1, source?.width || 0)
  const sh = Math.max(1, source?.height || 0)
  const a4Ratio = width / height
  const srcRatio = sw / sh
  const sameAspect = Math.abs(srcRatio - a4Ratio) / a4Ratio < 0.02
  const scale = sameAspect
    ? Math.max(width / sw, height / sh)
    : Math.min(width / sw, height / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.imageSmoothingEnabled = true
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh)
  return rasterFromDataUrl(out.toDataURL('image/jpeg', 0.95))
}

function excelPicXml(i, pageCount) {
  const name = pageCount === 1 ? 'Quotation' : `Page ${i + 1}`
  const fromRow = i * ROWS_PER_PAGE
  return `<xdr:oneCellAnchor>
      <xdr:from>
        <xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff>
        <xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>
      </xdr:from>
      <xdr:ext cx="${A4_EMU_CX}" cy="${A4_EMU_CY}"/>
      <xdr:pic>
        <xdr:nvPicPr>
          <xdr:cNvPr id="${i + 2}" name="${name}"/>
          <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
        </xdr:nvPicPr>
        <xdr:blipFill>
          <a:blip r:embed="rId${i + 1}"/>
          <a:stretch><a:fillRect/></a:stretch>
        </xdr:blipFill>
        <xdr:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="${A4_EMU_CX}" cy="${A4_EMU_CY}"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </xdr:spPr>
      </xdr:pic>
      <xdr:clientData/>
    </xdr:oneCellAnchor>`
}

function excelPageRowsXml(pageCount) {
  const rows = []
  for (let i = 0; i < pageCount * ROWS_PER_PAGE; i += 1) {
    const r = i + 1
    rows.push(
      `<row r="${r}" ht="${PAGE_ROW_PT}" customHeight="1"><c r="A${r}" t="inlineStr"><is><t xml:space="preserve"> </t></is></c></row>`
    )
  }
  return rows.join('')
}

/**
 * Excel = live A4 preview pages (same layout, spacing, and page count as on screen).
 * Built like Word page images: exact A4 EMUs, no spreadsheet grid to the right.
 * PDF remains the Chrome print path (untouched).
 */
export async function downloadPreviewAsExcel({ quote }) {
  document.documentElement.classList.add('qg-a4-export')
  let canvases = []
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    ;({ canvases } = await capturePreviewCanvases({ scale: 2 }))
  } finally {
    document.documentElement.classList.remove('qg-a4-export')
  }
  if (!canvases.length) throw new Error('nothing on screen to export')

  const zipMod = await import('jszip')
  const JSZip = zipMod.default || zipMod
  const zip = new JSZip()
  const pageCount = canvases.length
  const rasters = canvases.map(rasterizeA4Jpeg)
  if (rasters.some(r => !r)) throw new Error('nothing on screen to export')
  const lastRow = pageCount * ROWS_PER_PAGE

  const rowsXml = excelPageRowsXml(pageCount)
  const breaksXml = pageCount > 1
    ? `<rowBreaks count="${pageCount - 1}" manualBreakCount="${pageCount - 1}">${
      Array.from({ length: pageCount - 1 }, (_, i) => (
        `<brk id="${(i + 1) * ROWS_PER_PAGE}" max="16383" man="1"/>`
      )).join('')
    }</rowBreaks>`
    : ''
  const drawingRels = rasters.map((_, i) => (
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.jpeg"/>`
  )).join('')
  const picsXml = rasters.map((_, i) => excelPicXml(i, pageCount)).join('')

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`)
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`)
  zip.folder('xl').file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Quotation" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`)
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`)
  zip.folder('xl').file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`)
  zip.folder('xl').folder('worksheets').file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:A${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0" showGridLines="0" showRowColHeaders="0" view="normal" zoomScale="70" zoomScaleNormal="70"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15" defaultColWidth="0"/>
  <cols>
    <col min="1" max="1" width="${A4_COL_WIDTH}" customWidth="1"/>
    <col min="2" max="16384" width="0" customWidth="1" hidden="1"/>
  </cols>
  <sheetData>${rowsXml}</sheetData>
  <pageMargins left="0" right="0" top="0" bottom="0" header="0" footer="0"/>
  <pageSetup paperSize="9" orientation="portrait" scale="100" usePrinterDefaults="0"/>
  <drawing r:id="rId1"/>
  ${breaksXml}
</worksheet>`)
  zip.folder('xl').folder('worksheets').folder('_rels').file('sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`)
  zip.folder('xl').folder('drawings').file('drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${picsXml}
</xdr:wsDr>`)
  zip.folder('xl').folder('drawings').folder('_rels').file('drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${drawingRels}
</Relationships>`)
  const media = zip.folder('xl').folder('media')
  rasters.forEach((raster, i) => {
    media.file(`image${i + 1}.jpeg`, raster.base64, { base64: true })
  })

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  })
  saveBlob(blob, quotationFileName(quote, 'xlsx'))
}

async function loadExcelJS() {
  const mod = await import('exceljs')
  return mod.default || mod
}

async function fillQuotationDataSheet(wb, { quote, profile, columns, totals, theme, docLabel, sheetName }) {
  const accent = (theme?.accent || '#1A73E8').replace('#', '')
  const headBg = (theme?.tableHeadBg || '#061A3D').replace('#', '')
  const headText = (theme?.tableHeadText || '#ffffff').replace('#', '')
  const stripe = (theme?.tableStripeBg || '#f7fafd').replace('#', '')
  const sheet = wb.addWorksheet(sheetName || docLabel || 'Quotation', { views: [{ showGridLines: false }] })
  const exportCols = exportTableColumns(columns)
  const items = recalcAllRows(quote?.items || [], columns)
  const customer = quote?.customer || {}
  const colCount = Math.max(2, exportCols.length)

  exportCols.forEach((c, i) => {
    const key = c.key
    let width = 14
    if (key === '_sr') width = 8
    else if (key === 'description') width = 42
    else if (key === 'quantity' || key === 'uom' || key === 'hsn') width = 10
    else if (c.money || key === 'rate' || key === 'amount') width = 14
    sheet.getColumn(i + 1).width = width
  })

  const logo = await fetchRaster(profile?.logoUrl || profile?.headerImageUrl)
  const footerImg = await fetchRaster(profile?.footerImageUrl)
  let r = 1

  if (logo) {
    const imageId = wb.addImage({ base64: logo.base64, extension: logo.extension })
    const logoH = profile?.headerImageUrl && !profile?.logoUrl ? 90 : 48
    const logoW = profile?.headerImageUrl && !profile?.logoUrl ? 420 : Math.min(140, Number(profile?.logoWidth) || 96)
    sheet.getRow(r).height = logoH * 0.75
    sheet.addImage(imageId, {
      tl: { col: 0, row: r - 1 },
      ext: { width: logoW, height: logoH },
      editAs: 'oneCell'
    })
    r += 2
  }

  sheet.mergeCells(r, 1, r, colCount)
  sheet.getCell(r, 1).value = profile?.companyName || 'Your Company Name'
  sheet.getCell(r, 1).font = { name: 'Calibri', size: 16, bold: true, color: { argb: `FF${accent}` } }
  r += 1
  if (profile?.headerText) {
    sheet.mergeCells(r, 1, r, colCount)
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
  const shipSeparate = customer.shippingSame === false
  sheet.getCell(r, 3).value = shipSeparate ? 'SHIP TO' : 'SUBJECT'
  sheet.getCell(r, 3).font = { bold: true, color: { argb: `FF${accent}` }, size: 12 }
  r += 1
  sheet.getCell(r, 1).value = shipSeparate ? 'Billing address' : 'Billing & shipping address'
  sheet.getCell(r, 1).font = { size: 8, color: { argb: 'FF718096' } }
  if (shipSeparate) {
    sheet.getCell(r, 3).value = 'Shipping address'
    sheet.getCell(r, 3).font = { size: 8, color: { argb: 'FF718096' } }
  }
  r += 1
  sheet.getCell(r, 1).value = customer.company || ''
  sheet.getCell(r, 1).font = { bold: true }
  sheet.mergeCells(r, 3, r, colCount)
  sheet.getCell(r, 3).value = shipSeparate ? (customer.shippingLocation || '') : (quote?.title || '')
  sheet.getCell(r, 3).font = { bold: true }
  r += 1
  sheet.getCell(r, 1).value = [customer.name, customer.location, customer.gst].filter(Boolean).join('\n')
  sheet.getCell(r, 1).alignment = { wrapText: true }
  if (shipSeparate) {
    r += 1
    sheet.getCell(r, 1).value = 'SUBJECT'
    sheet.getCell(r, 1).font = { bold: true, color: { argb: `FF${accent}` }, size: 12 }
    r += 1
    sheet.mergeCells(r, 1, r, colCount)
    sheet.getCell(r, 1).value = quote?.title || ''
    sheet.getCell(r, 1).font = { bold: true }
  }
  r += 2

  const headerRow = sheet.getRow(r)
  exportCols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = c.label
    cell.font = { bold: true, size: 9, color: { argb: `FF${headText}` } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${headBg}` } }
    cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left', vertical: 'middle' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD7DEE8' } },
      left: { style: 'thin', color: { argb: 'FFD7DEE8' } },
      bottom: { style: 'thin', color: { argb: 'FFD7DEE8' } },
      right: { style: 'thin', color: { argb: 'FFD7DEE8' } }
    }
  })
  r += 1

  items.forEach((item, index) => {
    const values = rowValues(item, columns, index)
    const row = sheet.getRow(r)
    exportCols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      const raw = values[c.key] ?? ''
      if (c.money && raw !== '' && Number.isFinite(Number(raw))) cell.value = Number(raw)
      else if ((c.key === 'quantity' || c.key === 'rate') && raw !== '' && Number.isFinite(Number(raw))) cell.value = Number(raw)
      else cell.value = raw
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: c.align === 'right' ? 'right' : 'left' }
      if (index % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${stripe}` } }
      if (c.money) cell.numFmt = '₹#,##0.00'
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE8EDF3' } },
        left: { style: 'thin', color: { argb: 'FFE8EDF3' } },
        bottom: { style: 'thin', color: { argb: 'FFE8EDF3' } },
        right: { style: 'thin', color: { argb: 'FFE8EDF3' } }
      }
    })
    r += 1
  })

  r += 1
  const labelCol = Math.max(1, exportCols.length - 1)
  const valueCol = exportCols.length
  const addTotal = (label, amount, bold) => {
    sheet.getCell(r, labelCol).value = label
    sheet.getCell(r, labelCol).font = { bold: !!bold, color: { argb: bold ? `FF${accent}` : 'FF718096' } }
    sheet.getCell(r, valueCol).value = Number(amount || 0)
    sheet.getCell(r, valueCol).numFmt = '₹#,##0.00'
    sheet.getCell(r, valueCol).font = { bold: !!bold }
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
  sheet.mergeCells(r, 1, r, colCount)
  sheet.getCell(r, 1).value = profile?.standardTerms || ''
  sheet.getCell(r, 1).alignment = { wrapText: true }
  r += 2
  sheet.getCell(r, 1).value = 'NOTES'
  sheet.getCell(r, 1).font = { bold: true, color: { argb: `FF${accent}` }, size: 10 }
  r += 1
  sheet.mergeCells(r, 1, r, colCount)
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
  const qrImage = await fetchRaster(profile?.bankQrUrl)
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

  if (footerImg) {
    r += 2
    const fit = normalizeFooterFit(profile?.footerFit)
    const footerH = Math.min(120, Number(fit.height) || 90)
    sheet.getRow(r).height = footerH * 0.75
    const imageId = wb.addImage({ base64: footerImg.base64, extension: footerImg.extension })
    sheet.addImage(imageId, {
      tl: { col: 0, row: r - 1 },
      ext: { width: Math.round(620 * ((Number(fit.width) || 100) / 100)), height: footerH },
      editAs: 'oneCell'
    })
  }
  return sheet
}

/** Excel export: preview-accurate A4 pages (PDF path unchanged). */
export async function downloadQuotationExcel(opts) {
  return downloadPreviewAsExcel(opts)
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

