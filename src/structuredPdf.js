/**
 * Instant client-side PDF — same data as Word/Excel, no html2canvas, no Chrome wait.
 * Images keep their natural aspect ratio (no squeeze).
 */
import { jsPDF } from 'jspdf'
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
import { A4_HEIGHT_MM, A4_WIDTH_MM } from './a4Pagination.js'

function quotationFileNameLocal(quote, ext = 'pdf') {
  const parts = [
    'Quotation',
    String(quote?.number || '').trim(),
    quote?.revision > 0 ? `Rev${quote.revision}` : '',
    String(quote?.customer?.company || quote?.customer?.name || '').trim()
  ].filter(Boolean)
  const base = parts.join('-')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110)
  return `${base || 'Quotation'}.${String(ext || 'pdf').replace(/^\./, '')}`
}

const MARGIN = 12
const PAGE_W = A4_WIDTH_MM
const PAGE_H = A4_HEIGHT_MM
const CONTENT_W = PAGE_W - MARGIN * 2

function money(n) {
  if (n == null || n === '') return ''
  const num = Number(n)
  if (!Number.isFinite(num)) return String(n)
  return `₹ ${formatIndianAmount(num)}`
}

function hexToRgb(hex) {
  const h = String(hex || '#1A73E8').replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0').slice(0, 6)
  const n = parseInt(full, 16)
  if (!Number.isFinite(n)) return [26, 115, 232]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function loadImage(url) {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const done = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        if (!canvas.width || !canvas.height) return resolve(null)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const dataUrl = canvas.toDataURL('image/png')
        resolve({
          dataUrl,
          width: canvas.width,
          height: canvas.height,
          format: 'PNG'
        })
      } catch {
        resolve(null)
      }
    }
    img.onload = done
    img.onerror = () => resolve(null)
    img.src = url
    if (img.complete && img.naturalWidth) done()
  })
}

/** Fit image into maxW×maxH box, preserving aspect ratio. */
function fitBox(natW, natH, maxW, maxH) {
  const w = Number(natW) || 1
  const h = Number(natH) || 1
  const scale = Math.min(maxW / w, maxH / h)
  return { w: w * scale, h: h * scale }
}

function exportColumns(columns) {
  const cols = []
  cols.push({ key: '_sr', label: 'Sr.', align: 'left', width: 0.07 })
  for (const col of columns || []) {
    if (isImageColumn(col) || isAttachmentColumn(col)) continue
    if (isNestedColumn(col)) {
      cols.push({ key: rateKey(col), label: `${col.label} %`, align: 'right', width: 0.09 })
      cols.push({ key: amountKey(col), label: `${col.label} ₹`, align: 'right', width: 0.11, money: true })
      continue
    }
    const id = col.id
    const wide = id === 'description' || /desc|item|particular/i.test(col.label || '')
    cols.push({
      key: id,
      label: col.label || id,
      align: id === 'quantity' || id === 'rate' || id === 'amount' || columnType(col) === 'hsn' ? 'right' : 'left',
      width: wide ? 0.28 : 0.1,
      money: id === 'rate' || id === 'amount'
    })
  }
  const sum = cols.reduce((n, c) => n + c.width, 0) || 1
  cols.forEach(c => { c.width = (c.width / sum) * CONTENT_W })
  return cols
}

function cellValue(item, col, rowIndex) {
  if (col.key === '_sr') return String(rowIndex + 1)
  const raw = item?.[col.key]
  if (raw == null || raw === '') return ''
  if (col.money) return money(raw)
  return String(raw)
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
  setTimeout(() => URL.revokeObjectURL(url), 8000)
}

/**
 * Instant PDF download from quotation data (same fields as Word/Excel).
 */
export async function downloadStructuredQuotationPdf({
  quote,
  profile,
  columns,
  totals,
  theme,
  docLabel,
  fileName
}) {
  const accent = theme?.accent || '#1A73E8'
  const headBg = theme?.tableHeadBg || '#061A3D'
  const muted = theme?.muted || '#718096'
  const text = theme?.text || '#2d3748'
  const [ar, ag, ab] = hexToRgb(accent)
  const [hr, hg, hb] = hexToRgb(headBg)
  const [mr, mg, mb] = hexToRgb(muted)
  const [tr, tg, tb] = hexToRgb(text)

  const items = recalcAllRows(quote?.items || [], columns)
  const customer = quote?.customer || {}
  const cols = exportColumns(columns)
  const name = fileName || quotationFileNameLocal(quote, 'pdf')

  const [logo, footer, headerBanner] = await Promise.all([
    loadImage(profile?.logoUrl),
    loadImage(profile?.footerImageUrl),
    loadImage(profile?.headerImageUrl)
  ])

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  let y = MARGIN

  const ensureSpace = (need) => {
    if (y + need <= PAGE_H - MARGIN - (footer ? 28 : 8)) return
    doc.addPage()
    y = MARGIN
  }

  if (headerBanner) {
    const box = fitBox(headerBanner.width, headerBanner.height, CONTENT_W, 28)
    doc.addImage(headerBanner.dataUrl, headerBanner.format, MARGIN, y, box.w, box.h, undefined, 'FAST')
    y += box.h + 4
  }

  // Header row: logo + company | QUOTATION meta
  const headerTop = y
  let leftY = y
  if (logo) {
    const box = fitBox(logo.width, logo.height, 28, 16)
    doc.addImage(logo.dataUrl, logo.format, MARGIN, leftY, box.w, box.h, undefined, 'FAST')
    leftY += box.h + 2
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(ar, ag, ab)
  doc.text(String(profile?.companyName || 'Your Company Name'), MARGIN, leftY + 5)
  leftY += 7
  if (profile?.headerText) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(mr, mg, mb)
    const lines = doc.splitTextToSize(String(profile.headerText), CONTENT_W * 0.55)
    doc.text(lines, MARGIN, leftY)
    leftY += lines.length * 3.5
  }

  let rightY = headerTop
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(ar, ag, ab)
  doc.text(String(docLabel || 'QUOTATION'), PAGE_W - MARGIN, rightY + 5, { align: 'right' })
  rightY += 10
  doc.setFontSize(8)
  const meta = [
    ['NO.', quote?.number || ''],
    ['DATE', quote?.date || ''],
    ['VALID TILL', quote?.fields?.validUntil || quote?.validUntil || '']
  ]
  for (const [label, value] of meta) {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ar, ag, ab)
    doc.text(label, PAGE_W - MARGIN, rightY, { align: 'right' })
    rightY += 3.5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(tr, tg, tb)
    doc.text(String(value || '—'), PAGE_W - MARGIN, rightY, { align: 'right' })
    rightY += 5
  }
  y = Math.max(leftY, rightY) + 4

  // TO / SUBJECT
  doc.setDrawColor(200, 210, 220)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 6
  const colMid = MARGIN + CONTENT_W * 0.55
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(ar, ag, ab)
  doc.text('TO', MARGIN, y)
  doc.text(customer.shippingSame === false ? 'SHIP TO' : 'SUBJECT', colMid + 4, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(tr, tg, tb)
  const toLines = [
    customer.company,
    customer.name,
    customer.location,
    customer.gst
  ].filter(Boolean).map(String)
  const subjectLines = customer.shippingSame === false
    ? [customer.shippingLocation].filter(Boolean).map(String)
    : [quote?.title].filter(Boolean).map(String)
  const toBlock = toLines.length ? toLines : ['']
  const subBlock = subjectLines.length ? subjectLines : ['']
  const blockH = Math.max(toBlock.length, subBlock.length) * 4
  doc.setFont('helvetica', 'bold')
  if (toBlock[0]) doc.text(toBlock[0], MARGIN, y)
  if (subBlock[0]) doc.text(subBlock[0], colMid + 4, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(mr, mg, mb)
  for (let i = 1; i < toBlock.length; i++) doc.text(toBlock[i], MARGIN, y + i * 4)
  for (let i = 1; i < subBlock.length; i++) doc.text(subBlock[i], colMid + 4, y + i * 4)
  y += blockH + 6
  doc.setDrawColor(200, 210, 220)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 6

  // Table header
  const rowH = 7
  ensureSpace(rowH + 10)
  doc.setFillColor(hr, hg, hb)
  doc.rect(MARGIN, y, CONTENT_W, rowH, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(255, 255, 255)
  let x = MARGIN
  for (const col of cols) {
    const label = String(col.label || '').toUpperCase()
    const tx = col.align === 'right' ? x + col.width - 1 : x + 1
    doc.text(label, tx, y + 4.5, col.align === 'right' ? { align: 'right' } : undefined)
    x += col.width
  }
  y += rowH

  // Rows
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const values = cols.map(c => cellValue(item, c, i))
    const wrapped = cols.map((c, ci) => doc.splitTextToSize(values[ci] || '—', c.width - 2))
    const lines = Math.max(1, ...wrapped.map(w => w.length))
    const h = Math.max(rowH, lines * 3.6 + 2)
    ensureSpace(h + 2)
    if (i % 2 === 1) {
      doc.setFillColor(247, 250, 253)
      doc.rect(MARGIN, y, CONTENT_W, h, 'F')
    }
    doc.setDrawColor(232, 237, 243)
    doc.rect(MARGIN, y, CONTENT_W, h, 'S')
    doc.setTextColor(tr, tg, tb)
    x = MARGIN
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci]
      const linesForCell = wrapped[ci]
      const tx = col.align === 'right' ? x + col.width - 1 : x + 1
      doc.text(linesForCell, tx, y + 4, col.align === 'right' ? { align: 'right' } : undefined)
      x += col.width
    }
    y += h
  }

  // Totals
  y += 4
  const totalLines = [
    ['Subtotal', totals?.subtotal],
    ...(totals?.perColumn || []).filter(e => e.type === 'discount').map(e => [`Less: ${e.label}`, e.amount]),
    totals?.discountTotal > 0 ? ['Taxable value', totals.taxableTotal] : null,
    ...(totals?.perColumn || []).filter(e => e.type === 'tax').map(e => [`Add: ${e.label}`, e.amount]),
    ...(quote?.extraLines || []).map(line => {
      const amt = extraLineResolvedAmount(line, totals?.extraBase)
      return [`${line.kind === 'add' ? 'Add' : 'Less'}: ${line.label || 'Extra'}`, line.kind === 'less' ? -Math.abs(amt) : amt]
    }),
    ['Total', totals?.grandTotal]
  ].filter(Boolean)
  ensureSpace(totalLines.length * 5 + 8)
  const boxW = 55
  const boxX = PAGE_W - MARGIN - boxW
  for (let i = 0; i < totalLines.length; i++) {
    const [label, amount] = totalLines[i]
    const last = i === totalLines.length - 1
    doc.setFont('helvetica', last ? 'bold' : 'normal')
    doc.setFontSize(last ? 10 : 8)
    doc.setTextColor(last ? tr : mr, last ? tg : mg, last ? tb : mb)
    doc.text(String(label), boxX, y)
    doc.text(money(amount), PAGE_W - MARGIN, y, { align: 'right' })
    y += last ? 6 : 4.5
  }

  // Signatory
  y += 10
  ensureSpace(24)
  doc.setDrawColor(mr, mg, mb)
  const sigX = PAGE_W - MARGIN - 45
  doc.line(sigX, y + 12, PAGE_W - MARGIN, y + 12)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(tr, tg, tb)
  doc.text('Authorized Signatory', sigX + 22.5, y + 16, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(mr, mg, mb)
  doc.text(`For ${profile?.companyName?.trim() || 'Your Company'}`, sigX + 22.5, y + 20, { align: 'center' })
  y += 24

  // Footer banner — bottom of last page, natural aspect ratio (never squeezed)
  if (footer) {
    const fit = normalizeFooterFit(profile?.footerFit)
    const maxW = CONTENT_W * (fit.width / 100)
    const maxH = Math.min(36, (fit.height / 1123) * PAGE_H * 1.1 || 28)
    const box = fitBox(footer.width, footer.height, maxW, maxH)
    const footerY = PAGE_H - MARGIN - box.h
    if (y > footerY - 4) {
      doc.addPage()
    }
    const fx = MARGIN + (CONTENT_W - box.w) / 2
    doc.addImage(footer.dataUrl, footer.format, fx, PAGE_H - MARGIN - box.h, box.w, box.h, undefined, 'FAST')
  }

  const blob = doc.output('blob')
  saveBlob(blob, name)
  return blob.size
}
