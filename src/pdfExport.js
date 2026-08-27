/**
 * "Download PDF" — save a real file instead of opening the print dialog.
 *
 * Word and Excel already save a file in the browser. PDF does the same: it
 * captures the live quotation with html2canvas + jsPDF and downloads a .pdf.
 * Images that 400 on the public Supabase URL are fetched through
 * /api/quote-assets/content so a missing public URL cannot block the download.
 */

import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { A4_HEIGHT_MM, A4_HEIGHT_PX, A4_WIDTH_MM, A4_WIDTH_PX } from './a4Pagination.js'
import { packExportSlices } from './exportSlices.js'

/** e.g. Quotation-QTN-2026-0007-Acme-Industries.pdf */
export function quotationFileName(quote, ext = 'pdf') {
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
  const suffix = String(ext || 'pdf').replace(/^\./, '')
  return `${base || 'Quotation'}.${suffix}`
}

/**
 * React keeps input/textarea contents in the value *property*, which cloneNode
 * does not copy — without this every editable cell would print empty.
 */
function bakeFieldValues(source, clone) {
  const selector = 'input, textarea, select'
  const originals = source.querySelectorAll(selector)
  const copies = clone.querySelectorAll(selector)
  originals.forEach((original, i) => {
    const copy = copies[i]
    if (!copy) return
    bakeOneField(original, copy)
  })
}

function bakeOneField(original, copy = original) {
  if (original.tagName === 'TEXTAREA') {
    copy.textContent = original.value
  } else if (original.tagName === 'SELECT') {
    Array.from(copy.options).forEach((option, index) => {
      if (index === original.selectedIndex) option.setAttribute('selected', 'selected')
      else option.removeAttribute('selected')
    })
  } else if (original.type === 'checkbox' || original.type === 'radio') {
    if (original.checked) copy.setAttribute('checked', 'checked')
    else copy.removeAttribute('checked')
  } else {
    copy.setAttribute('value', original.value)
  }
}

function bakeClonedFields(root) {
  root.querySelectorAll('input, textarea, select').forEach((node) => bakeOneField(node))
}

/**
 * Flatten every stylesheet into one <style>. Works both in dev (Vite injects
 * <style> tags) and in a build (<link> to a hashed file), because the printed
 * copy is a standalone file that cannot resolve the app's URLs.
 * Returns the hrefs that could not be read so their <link> can be kept.
 */
function collectStyles() {
  const css = []
  const unreadable = new Set()
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null
    try {
      rules = sheet.cssRules
    } catch {
      if (sheet.href) unreadable.add(sheet.href)
      continue
    }
    if (!rules) continue
    css.push(Array.from(rules).map(rule => rule.cssText).join('\n'))
  }
  return { css: css.join('\n'), unreadable }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

/** Object key inside the quote-assets bucket, or '' if this is not a stored file. */
export function storagePathFromUrl(src) {
  const text = String(src || '')
  if (!text || text.startsWith('data:') || text.startsWith('blob:')) return ''
  const fromApi = text.match(/[?&]path=([^&]+)/)
  if (fromApi && text.includes('/api/quote-assets/content')) {
    try { return decodeURIComponent(fromApi[1]) } catch { return fromApi[1] }
  }
  const fromBucket = text.match(/\/object\/(?:public|sign|authenticated)\/quote-assets\/((?:quote-images|quote-files)\/[^?#]+)/i)
    || text.match(/\/render\/image\/public\/quote-assets\/((?:quote-images|quote-files)\/[^?#]+)/i)
  if (fromBucket) {
    try { return decodeURIComponent(fromBucket[1]) } catch { return fromBucket[1] }
  }
  const bare = text.match(/((?:quote-images|quote-files)\/[A-Za-z0-9._\-/]+)/)
  return bare ? bare[1].replace(/\/+$/, '') : ''
}

/** Prefer the logged-in proxy so a private/public-URL miss cannot blank the cell. */
export function quoteAssetSrc(url, path) {
  const key = String(path || '').trim() || storagePathFromUrl(url)
  if (key) return `/api/quote-assets/content?path=${encodeURIComponent(key)}`
  return String(url || '')
}

async function fetchAssetDataUrl(src) {
  const path = storagePathFromUrl(src)
  const attempts = []
  if (path) attempts.push(`/api/quote-assets/content?path=${encodeURIComponent(path)}`)
  if (src && !src.startsWith('data:') && !src.startsWith('/api/')) attempts.push(src)
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(4000)
    : undefined

  for (const url of attempts) {
    try {
      const href = url.startsWith('/') ? url : new URL(url, document.baseURI).href
      const response = await fetch(href, url.startsWith('/api/')
        ? { signal }
        : { credentials: 'omit', signal })
      if (!response.ok) continue
      const blob = await response.blob()
      if (!blob.size) continue
      return await blobToDataUrl(blob)
    } catch {
      /* try the next source */
    }
  }
  return null
}

/** If a public Storage URL 400s, swap the <img> onto the authenticated proxy. */
export function onQuoteAssetImgError(event) {
  const image = event.currentTarget
  if (!image || image.dataset.qgAssetTried) return
  image.dataset.qgAssetTried = '1'
  const src = image.getAttribute('src') || ''
  fetchAssetDataUrl(src).then((dataUrl) => {
    if (dataUrl) image.src = dataUrl
  }).catch(() => {})
}

/**
 * Embed logo and image-column pictures. They are usually Supabase Storage URLs;
 * inlining them means the renderer does not depend on network access, and a
 * failure here still leaves the original URL for Chrome to try.
 */
async function inlineImages(clone) {
  const images = Array.from(clone.querySelectorAll('img'))
  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute('src') || ''
    if (!src || src.startsWith('data:')) return
    const dataUrl = await fetchAssetDataUrl(src)
    if (dataUrl) image.setAttribute('src', dataUrl)
  }))
}

async function inlineLiveImages(roots) {
  const images = roots.flatMap((root) => Array.from(root.querySelectorAll('img')))
  const restore = []
  await Promise.all(images.map(async (image) => {
    const original = image.getAttribute('src') || ''
    if (!original || original.startsWith('data:')) return
    restore.push(() => {
      image.setAttribute('src', original)
      delete image.dataset.qgAssetTried
    })
    const dataUrl = await fetchAssetDataUrl(original)
    if (!dataUrl) return
    image.setAttribute('src', dataUrl)
    try { await image.decode() } catch { /* still paintable */ }
  }))
  return () => restore.forEach((fn) => { try { fn() } catch { /* node gone */ } })
}

/** A self-contained copy of the quotation sheet, ready to print as-is. */
export async function buildPrintableDocument() {
  const source = document.querySelector('.qg-studio-canvas')
    || document.querySelector('article.upload-word-page')
    || document.querySelector('.upload-excel-paper')
    || document.querySelector('.upload-excel-table')?.closest('section, main, div')
    || document.querySelector('main')
    || document.documentElement
  const clone = source.cloneNode(true)
  bakeFieldValues(source, clone)

  const { css } = collectStyles()
  await inlineImages(clone)

  const baseHref = document.baseURI || ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<base href="${baseHref.replace(/"/g, '&quot;')}"/>
<style>${css}</style>
</head>
<body>${clone.outerHTML}</body>
</html>`
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

function captureTargets() {
  const papers = Array.from(document.querySelectorAll('.qg-studio-paper'))
  if (papers.length) return papers
  const word = Array.from(document.querySelectorAll('.upload-word-page'))
  if (word.length) return word
  const excel = document.querySelector('.upload-excel-paper') || document.querySelector('.upload-excel-table')
  if (excel) return [excel.classList?.contains('upload-excel-paper') ? excel : (excel.closest('.upload-excel-paper') || excel.closest('section, main, article') || excel)]
  const canvas = document.querySelector('.qg-studio-canvas')
  return canvas ? [canvas] : []
}

function pxToMm(px) {
  return Math.max(1, (Number(px) || 1) * 25.4 / 96)
}

function isSheetRun(node) {
  return node.classList?.contains('qg-sheet-run-header') || node.classList?.contains('qg-sheet-run-footer')
}

/** html2canvas paints CSS zoom as stacked glyphs. Swap it for transform:scale
 *  and pull following content (totals) up with a negative margin so the unused
 *  layout space from transform does not push the totals box to the footer. */
function convertZoomToTransform(root) {
  root.querySelectorAll('[data-qg-table-zoom]').forEach((el) => {
    const z = parseFloat(el.getAttribute('data-qg-table-zoom') || el.style.zoom) || 1
    if (/scale\(/.test(el.style.transform || '')) return
    if (!(z > 0) || Math.abs(z - 1) < 0.005) {
      el.style.zoom = '1'
      return
    }
    const specified = parseFloat(el.style.width)
    el.style.zoom = '1'
    if (specified) el.style.width = `${specified}px`
    el.style.transform = `scale(${z})`
    el.style.transformOrigin = 'top left'
    el.style.display = 'block'
    void el.offsetWidth
    const fullW = el.offsetWidth || specified || 0
    const fullH = el.offsetHeight || el.scrollHeight || 0
    el.style.marginRight = `${Math.round(fullW * (z - 1))}px`
    el.style.marginBottom = `${Math.round(fullH * (z - 1))}px`
  })
  root.querySelectorAll('[data-qg-zoom-wrap]').forEach((wrap) => {
    const child = wrap.firstElementChild
    if (child) wrap.parentNode.insertBefore(child, wrap)
    wrap.remove()
  })
}

function revealTitles(root) {
  root.querySelectorAll('.qg-col-title, .qg-col-title--capture').forEach((node) => {
    node.style.display = 'inline'
    node.style.visibility = 'visible'
    node.style.color = '#ffffff'
    node.style.webkitTextFillColor = '#ffffff'
    node.style.letterSpacing = '0'
    node.style.textTransform = 'uppercase'
    node.style.textShadow = '0 0 0.3px #ffffff'
  })
  root.querySelectorAll('.quote-items-table thead th').forEach((th) => {
    th.style.color = '#ffffff'
    th.style.webkitTextFillColor = '#ffffff'
    th.style.letterSpacing = '0'
    th.style.visibility = 'visible'
    th.style.opacity = '1'
    th.style.webkitPrintColorAdjust = 'exact'
    th.style.printColorAdjust = 'exact'
  })
}

function hideCaptureChrome(clonedRoot) {
  clonedRoot.querySelectorAll(
    '.qg-image-resize, .qg-col-resizer, .qg-footer-handle, .qg-footer-edit-btn, .qg-footer-fit-bar, .qg-drop-zone, .qg-export-list'
  ).forEach((node) => { node.remove() })
  clonedRoot.querySelectorAll('.no-print').forEach((node) => {
    if (isSheetRun(node)) {
      node.style.display = 'flex'
      return
    }
    node.remove()
  })
  clonedRoot.querySelectorAll('.print-only-cell').forEach((node) => {
    node.style.display = 'block'
    node.style.visibility = 'visible'
    node.style.position = 'static'
    node.style.color = 'inherit'
  })
  clonedRoot.querySelectorAll('.quote-items-table').forEach((table) => {
    table.style.maxWidth = 'none'
  })
  clonedRoot.querySelectorAll('.quote-items-scroll').forEach((node) => {
    node.style.overflow = 'hidden'
  })
  clonedRoot.querySelectorAll('.qg-studio-paper').forEach((paper) => {
    paper.style.width = `${A4_WIDTH_PX}px`
    paper.style.maxWidth = `${A4_WIDTH_PX}px`
    paper.style.height = `${A4_HEIGHT_PX}px`
    paper.style.minHeight = `${A4_HEIGHT_PX}px`
    paper.style.maxHeight = `${A4_HEIGHT_PX}px`
    paper.style.overflow = 'hidden'
    paper.style.boxShadow = 'none'
    paper.style.borderRadius = '0'
  })
  clonedRoot.querySelectorAll('.qg-paper-plate').forEach((plate) => {
    plate.style.display = 'flex'
    plate.style.flexDirection = 'column'
    plate.style.flex = '1 1 auto'
    plate.style.minHeight = '0'
    plate.style.overflow = 'hidden'
  })
  clonedRoot.querySelectorAll('.qg-page-section, [data-qg-block="closing"]').forEach((node) => {
    node.style.display = 'flex'
    node.style.flexDirection = 'column'
    node.style.flex = '1 1 auto'
    node.style.minHeight = '0'
  })
  clonedRoot.querySelectorAll('.qg-footer-image-wrap').forEach((node) => {
    node.style.marginTop = 'auto'
    node.style.marginBottom = '0'
    node.style.flex = '0 0 auto'
  })
  clonedRoot.querySelectorAll('.qg-footer-image').forEach((img) => {
    img.style.objectFit = 'contain'
    img.style.width = '100%'
    img.style.height = '100%'
  })
  replaceFieldsWithText(clonedRoot)
  convertZoomToTransform(clonedRoot)
  revealTitles(clonedRoot)
}

/** html2canvas clips native <input>/<textarea> glyphs. Swap them for text nodes. */
function replaceFieldsWithText(root) {
  const doc = root.ownerDocument
  root.querySelectorAll('input, textarea').forEach((node) => {
    if (node.type === 'checkbox' || node.type === 'radio' || node.type === 'hidden' || node.type === 'file') return
    const parent = node.parentElement
    const hasPrintTwin = Array.from(parent?.children || []).some((child) => child.classList?.contains('print-only-cell'))
    if (hasPrintTwin) {
      node.remove()
      return
    }
    const text = node.value || ''
    const placeholder = node.getAttribute('placeholder') || ''
    const span = doc.createElement(node.tagName === 'TEXTAREA' || text.includes('\n') ? 'div' : 'span')
    span.className = 'qg-pdf-field-text'
    span.textContent = text || placeholder
    span.style.display = 'block'
    span.style.width = '100%'
    span.style.whiteSpace = text.includes('\n') ? 'pre-wrap' : 'normal'
    span.style.overflow = 'visible'
    span.style.background = 'transparent'
    span.style.border = 'none'
    span.style.letterSpacing = 'normal'
    if (!text) span.style.opacity = '0.55'
    node.replaceWith(span)
  })
}

function stripUnsupportedCssFunctions(css) {
  const names = ['color-mix', 'oklch', 'oklab', 'lab', 'lch', 'light-dark', 'color']
  let out = String(css || '')
  for (const name of names) {
    const needle = `${name}(`
    let i = 0
    let result = ''
    while (i < out.length) {
      const at = out.toLowerCase().indexOf(needle, i)
      if (at < 0) {
        result += out.slice(i)
        break
      }
      result += out.slice(i, at)
      let depth = 0
      let j = at + needle.length - 1
      for (; j < out.length; j++) {
        if (out[j] === '(') depth++
        else if (out[j] === ')') {
          depth--
          if (depth === 0) {
            j++
            break
          }
        }
      }
      result += 'transparent'
      i = j
    }
    out = result
  }
  return out
}

function neutralizeCloneCss(doc) {
  doc.querySelectorAll('style').forEach((style) => {
    style.textContent = stripUnsupportedCssFunctions(style.textContent)
  })
  doc.querySelectorAll('[style]').forEach((el) => {
    const next = stripUnsupportedCssFunctions(el.getAttribute('style') || '')
    if (next) el.setAttribute('style', next)
  })
}

function flattenCloneColors(doc, root) {
  const win = doc.defaultView
  if (!win || !root) return
  let ctx = null
  try { ctx = doc.createElement('canvas').getContext('2d') } catch { ctx = null }
  const toRgb = (value) => {
    if (!value || value === 'none' || value === 'transparent') return value
    if (/^rgba?\(/i.test(value) || /^#/.test(value)) return value
    if (!ctx) return '#111827'
    try {
      ctx.fillStyle = '#000000'
      ctx.fillStyle = value
      return ctx.fillStyle || '#111827'
    } catch {
      return '#111827'
    }
  }
  const props = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor']
  ;[root, ...root.querySelectorAll('*')].forEach((el) => {
    if (!el || el.nodeType !== 1) return
    const cs = win.getComputedStyle(el)
    for (const prop of props) {
      const rgb = toRgb(cs[prop])
      if (rgb && rgb !== 'none') el.style[prop] = rgb
    }
    el.style.boxShadow = 'none'
    el.style.textShadow = 'none'
    el.style.filter = 'none'
    el.style.backdropFilter = 'none'
  })
  revealTitles(root)
}

function copyComputedFonts(doc, cloned) {
  if (!cloned) return
  cloned.querySelectorAll('.qg-studio-paper, .qg-studio-table, .qg-inline-field, .qg-pdf-field-text, .print-only-cell, p, h1, h2, h3').forEach((el) => {
    try {
      const style = doc.defaultView?.getComputedStyle(el)
      if (!style) return
      if (style.fontFamily) el.style.fontFamily = style.fontFamily
      if (style.fontSize) el.style.fontSize = style.fontSize
      if (style.fontWeight) el.style.fontWeight = style.fontWeight
      if (style.lineHeight && style.lineHeight !== 'normal') el.style.lineHeight = style.lineHeight
    } catch { /* computed style unavailable on detached node */ }
  })
  revealTitles(cloned)
}

function prepareClone(doc, cloned) {
  const root = cloned || doc?.body
  if (root) {
    bakeClonedFields(root)
    hideCaptureChrome(root)
    flattenCloneColors(doc, root)
    copyComputedFonts(doc, root)
  }
  neutralizeCloneCss(doc)
}

function paperWidthPx(element) {
  const canvas = element.closest?.('.qg-studio-canvas')
  const fromVar = parseFloat(canvas ? getComputedStyle(canvas).getPropertyValue('--qg-paper-width') : '')
  if (fromVar > 100) return fromVar
  const fromAttr = parseFloat(element.style?.width || '')
  if (fromAttr > 100) return fromAttr
  return Math.max(element.offsetWidth || 0, A4_WIDTH_PX)
}

function withCaptureLayout() {
  const html = document.documentElement
  html.classList.add('qg-pdf-capture')
  const frames = Array.from(document.querySelectorAll('.qg-studio-paper-frame, .upload-word-page, .upload-excel-paper'))
  const studioPapers = Array.from(document.querySelectorAll('.qg-studio-paper'))
  const canvases = Array.from(document.querySelectorAll('.qg-studio-canvas'))
  const uploadPages = Array.from(document.querySelectorAll('.upload-word-page'))
  const excelPapers = Array.from(document.querySelectorAll('.upload-excel-paper'))
  const previous = []
  canvases.forEach((el) => {
    previous.push([el, 'cssText', el.style.cssText])
    el.style.setProperty('--qg-paper-width', `${A4_WIDTH_PX}px`)
  })
  frames.forEach((el) => {
    previous.push([el, 'zoom', el.style.zoom])
    previous.push([el, 'width', el.style.width])
    el.style.zoom = '1'
    el.style.width = `${A4_WIDTH_PX}px`
  })
  studioPapers.forEach((el) => {
    previous.push([el, 'minHeight', el.style.minHeight])
    previous.push([el, 'height', el.style.height])
    previous.push([el, 'maxHeight', el.style.maxHeight])
    previous.push([el, 'width', el.style.width])
    previous.push([el, 'minWidth', el.style.minWidth])
    previous.push([el, 'maxWidth', el.style.maxWidth])
    previous.push([el, 'overflow', el.style.overflow])
    // Exact A4 box — wrong width/height here is what squeezed logos & text in the PDF.
    el.style.width = `${A4_WIDTH_PX}px`
    el.style.minWidth = `${A4_WIDTH_PX}px`
    el.style.maxWidth = `${A4_WIDTH_PX}px`
    el.style.minHeight = `${A4_HEIGHT_PX}px`
    el.style.height = `${A4_HEIGHT_PX}px`
    el.style.maxHeight = `${A4_HEIGHT_PX}px`
    el.style.overflow = 'hidden'
    el.querySelectorAll('.qg-paper-plate, .qg-page-section, [data-qg-block="closing"]').forEach((node) => {
      previous.push([node, 'cssText', node.style.cssText])
      node.style.display = 'flex'
      node.style.flexDirection = 'column'
      node.style.flex = '1 1 auto'
      node.style.minHeight = '0'
      node.style.height = 'auto'
    })
    el.querySelectorAll('.qg-footer-image-wrap').forEach((node) => {
      previous.push([node, 'cssText', node.style.cssText])
      node.style.marginTop = 'auto'
      node.style.marginBottom = '0'
      node.style.flex = '0 0 auto'
    })
    el.querySelectorAll('.qg-footer-image').forEach((img) => {
      previous.push([img, 'cssText', img.style.cssText])
      img.style.objectFit = 'contain'
      img.style.width = '100%'
      img.style.height = '100%'
    })
  })
  uploadPages.forEach((el) => {
    previous.push([el, 'minHeight', el.style.minHeight])
    previous.push([el, 'height', el.style.height])
    previous.push([el, 'maxHeight', el.style.maxHeight])
    previous.push([el, 'overflow', el.style.overflow])
    previous.push([el, 'padding', el.style.padding])
    previous.push([el, 'width', el.style.width])
    previous.push([el, 'maxWidth', el.style.maxWidth])
    el.style.minHeight = '0'
    el.style.height = 'auto'
    el.style.maxHeight = 'none'
    el.style.overflow = 'visible'
    el.style.padding = '18px 20px 22px'
    const w = Math.max(el.offsetWidth || 0, parseFloat(el.style.width) || 0, A4_WIDTH_PX)
    el.style.width = `${w}px`
    el.style.maxWidth = `${w}px`
    el.querySelectorAll('.upload-word-editor').forEach((editor) => {
      previous.push([editor, 'minHeight', editor.style.minHeight])
      editor.style.minHeight = '0'
    })
  })
  excelPapers.forEach((el) => {
    previous.push([el, 'overflow', el.style.overflow])
    previous.push([el, 'height', el.style.height])
    previous.push([el, 'maxHeight', el.style.maxHeight])
    previous.push([el, 'width', el.style.width])
    previous.push([el, 'maxWidth', el.style.maxWidth])
    el.style.overflow = 'visible'
    el.style.height = 'auto'
    el.style.maxHeight = 'none'
    const w = Math.max(el.offsetWidth || 0, parseFloat(el.style.width) || 0)
    if (w > 0) {
      el.style.width = `${w}px`
      el.style.maxWidth = `${w}px`
    }
  })
  return () => {
    html.classList.remove('qg-pdf-capture')
    previous.forEach(([el, prop, value]) => {
      if (prop === 'cssText') {
        el.style.cssText = value
        return
      }
      el.style[prop] = value
    })
  }
}

async function rasterizeSheet(element, scale) {
  const studio = element.classList?.contains('qg-studio-paper')
  const width = studio
    ? A4_WIDTH_PX
    : Math.max(element.scrollWidth || 0, element.offsetWidth || 0, paperWidthPx(element), 1)
  const height = studio
    ? A4_HEIGHT_PX
    : Math.max(element.scrollHeight || 0, element.offsetHeight || 0, 1)
  return html2canvas(element, {
    scale,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    imageTimeout: 4000,
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    onclone: prepareClone,
    ignoreElements: (el) => {
      if (!el?.classList?.contains('no-print')) return false
      return !isSheetRun(el)
    }
  })
}

function collectExportBlocks(root) {
  if (!root) return []
  const rootBox = root.getBoundingClientRect()
  const rel = (el) => {
    const r = el.getBoundingClientRect()
    return {
      top: r.top - rootBox.top + (root.scrollTop || 0),
      bottom: r.bottom - rootBox.top + (root.scrollTop || 0)
    }
  }
  const blocks = []
  const seen = new Set()
  const add = (el, kind) => {
    if (!el || seen.has(el)) return
    if (el.closest?.('.no-print') && !isSheetRun(el) && !el.closest?.('.qg-sheet-run-header, .qg-sheet-run-footer')) return
    const r = rel(el)
    if (r.bottom - r.top < 2) return
    seen.add(el)
    const isItem = el.hasAttribute?.('data-qg-item') || !!el.querySelector?.('[data-qg-item]')
    const isClose = el.hasAttribute?.('data-qg-extra')
      || el.hasAttribute?.('data-qg-block')
      || el.closest?.('[data-qg-block], .qg-totals-card')
    blocks.push({ ...r, kind: isItem ? 'item' : (isClose ? 'close' : kind) })
  }

  root.querySelectorAll('tr').forEach((tr) => add(tr, 'row'))
  root.querySelectorAll('[data-qg-block], .qg-totals-card').forEach((el) => add(el, 'close'))
  const editor = root.querySelector('.upload-word-editor') || root
  Array.from(editor.children || []).forEach((child) => {
    if (child.tagName === 'TABLE' || child.classList?.contains('no-print')) return
    add(child, 'block')
  })
  return blocks.sort((a, b) => a.top - b.top || a.bottom - b.bottom)
}

function isSparseCapture(element, index, total) {
  if (total <= 1 || index === 0) return false
  if (element.classList?.contains('qg-studio-paper')) return false
  const text = String(element.innerText || '').replace(/\s+/g, ' ').trim()
  if (/authorized\s*sign|client\s*acceptance|bank\s*details|grand\s*total/i.test(text)) return false
  if (element.querySelector('[data-qg-item], [data-qg-extra], img')) return false
  return text.length < 80 && (element.scrollHeight || 0) < 220
}

function sliceCanvasToPages(canvas, slices, contentHeightPx) {
  const pageRatio = A4_HEIGHT_MM / A4_WIDTH_MM
  const pageHeightPx = Math.max(1, Math.round(canvas.width * pageRatio))
  const contentH = Math.max(1, Number(contentHeightPx) || canvas.height)
  const scale = canvas.height / contentH
  let cuts = Array.isArray(slices) ? slices.filter(s => (s?.h || 0) > 2) : null
  if (!cuts?.length) {
    if (canvas.height <= pageHeightPx * 1.08) return [canvas]
    cuts = []
    let y = 0
    while (y < canvas.height - 2) {
      const h = Math.min(pageHeightPx, canvas.height - y)
      if (h < pageHeightPx * 0.02 && cuts.length) break
      cuts.push({ y: y / scale, h: h / scale })
      y += pageHeightPx
    }
  }

  return cuts.map((slice) => {
    const y = Math.max(0, Math.round(slice.y * scale))
    const h = Math.max(1, Math.round(slice.h * scale))
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvas.width
    pageCanvas.height = pageHeightPx
    const ctx = pageCanvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
    const drawH = Math.min(h, pageHeightPx, Math.max(0, canvas.height - y))
    if (drawH > 0 && y < canvas.height) {
      ctx.drawImage(canvas, 0, y, canvas.width, drawH, 0, 0, canvas.width, drawH)
    }
    return pageCanvas
  })
}

/**
 * Map capture → exact A4 pixels.
 * Same aspect as A4 → fill the page (preview zero-to-zero).
 * Different aspect → fit without stretch (no squeezed logos/text).
 */
function canvasToA4Page(canvas) {
  const targetW = Math.max(1, Math.round(A4_WIDTH_PX * 2))
  const targetH = Math.max(1, Math.round(A4_HEIGHT_PX * 2))
  const out = document.createElement('canvas')
  out.width = targetW
  out.height = targetH
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetW, targetH)
  const sw = Math.max(1, canvas.width)
  const sh = Math.max(1, canvas.height)
  const a4Ratio = targetW / targetH
  const srcRatio = sw / sh
  const sameAspect = Math.abs(srcRatio - a4Ratio) / a4Ratio < 0.02
  const scale = sameAspect
    ? Math.max(targetW / sw, targetH / sh)
    : Math.min(targetW / sw, targetH / sh)
  const dw = sw * scale
  const dh = sh * scale
  const dx = (targetW - dw) / 2
  const dy = (targetH - dh) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, dx, dy, dw, dh)
  return out
}

function addCanvasToPdf(pdf, canvas) {
  const format = [A4_WIDTH_MM, A4_HEIGHT_MM]
  const orientation = 'portrait'
  const page = canvasToA4Page(canvas)
  const image = page.toDataURL('image/jpeg', 0.92)
  if (!pdf) {
    const doc = new jsPDF({ unit: 'mm', format, orientation, compress: true })
    doc.addImage(image, 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'FAST')
    return doc
  }
  pdf.addPage(format, orientation)
  pdf.addImage(image, 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'FAST')
  return pdf
}

async function rasterizeTargets(targets, { scale: scaleOpt } = {}) {
  const canvases = []
  const maxScale = Math.min(2.5, Math.max(1, Number(scaleOpt) || 1.5))
  for (let i = 0; i < targets.length; i++) {
    const element = targets[i]
    if (isSparseCapture(element, i, targets.length)) continue
    const width = Math.max(element.scrollWidth, element.offsetWidth, paperWidthPx(element), A4_WIDTH_PX, 1)
    const preferred = Math.min(maxScale, 1800 / width)
    const pageH = Math.max(element.offsetWidth || width, 1) * (A4_HEIGHT_MM / A4_WIDTH_MM)
    const studio = element.classList?.contains('qg-studio-paper')
    const blocks = studio ? [] : collectExportBlocks(element)
    const contentHeight = Math.max(
      element.scrollHeight || 0,
      element.offsetHeight || 0,
      blocks.reduce((n, b) => Math.max(n, b.bottom), 0),
      1
    )
    const slices = studio ? null : packExportSlices(blocks, pageH, { contentHeight })
    let canvas
    try {
      canvas = await rasterizeSheet(element, preferred)
    } catch {
      canvas = await rasterizeSheet(element, 1)
    }
    // Studio sheets are already locked to one A4 page — don't re-slice (that stretched logos).
    if (studio) canvases.push(canvas)
    else canvases.push(...sliceCanvasToPages(canvas, slices, contentHeight))
  }
  return canvases
}

/** Snapshot each on-screen A4 sheet. Used by Excel (and optional Word image packs). */
export async function capturePreviewCanvases(opts = {}) {
  const targets = captureTargets()
  if (!targets.length) throw new Error('nothing on screen to export')
  const restoreLayout = withCaptureLayout()
  const restoreImages = await inlineLiveImages(targets)
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  try {
    return {
      canvases: await rasterizeTargets(targets, opts),
      pageWidthMm: A4_WIDTH_MM,
      pageHeightMm: A4_HEIGHT_MM
    }
  } finally {
    restoreImages()
    restoreLayout()
  }
}

async function downloadFromScreen(fileName) {
  document.documentElement.classList.add('qg-a4-export')
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const { canvases } = await capturePreviewCanvases()
    let pdf = null
    for (const canvas of canvases) {
      pdf = addCanvasToPdf(pdf, canvas)
    }
    if (!pdf) throw new Error('the PDF came back empty')
    const blob = pdf.output('blob')
    if (!blob?.size) throw new Error('the PDF came back empty')
    saveBlob(blob, fileName)
    return blob.size
  } finally {
    document.documentElement.classList.remove('qg-a4-export')
  }
}

/** HTML of the live A4 preview, with fields baked and editor chrome removed. */
export async function buildPreviewExportHtml() {
  const source = document.querySelector('.qg-studio-canvas')
    || document.querySelector('article.upload-word-page')
    || document.querySelector('.upload-excel-paper')
    || document.querySelector('.upload-excel-table')?.closest('section, main, div')
  if (!source) throw new Error('nothing on screen to export')
  const clone = source.cloneNode(true)
  bakeFieldValues(source, clone)
  hideCaptureChrome(clone)
  await inlineImages(clone)
  const { css } = collectStyles()
  const pageCss = `
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .no-print { display: none !important; }
    .qg-col-title, .qg-col-title--capture { display: inline !important; }
    .qg-studio-canvas { padding: 0 !important; overflow: visible !important; background: #fff !important; }
    .qg-studio-paper-frame { gap: 0 !important; width: 210mm !important; max-width: 210mm !important; zoom: 1 !important; }
    .qg-studio-paper {
      width: 210mm !important;
      height: 297mm !important;
      min-height: 297mm !important;
      max-height: 297mm !important;
      overflow: hidden !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      page-break-after: always;
      break-after: page;
      display: flex !important;
      flex-direction: column !important;
    }
    .qg-studio-paper:last-child { page-break-after: auto; break-after: auto; }
    .qg-paper-plate,
    .qg-page-section,
    [data-qg-block="closing"] {
      display: flex !important;
      flex-direction: column !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
    [data-qg-block="closing"] > .qg-footer-image-wrap {
      margin-top: auto !important;
      margin-bottom: 0 !important;
      flex: 0 0 auto !important;
    }
    .qg-footer-image { object-fit: contain !important; width: 100% !important; height: 100% !important; }
    img { object-fit: contain !important; }
    .qg-sheet-run-header, .qg-sheet-run-footer { display: flex !important; }
    .qg-col-title { color: inherit !important; white-space: nowrap !important; }
  `
  const baseHref = document.baseURI || ''
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700&display=swap"/>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<base href="${baseHref.replace(/"/g, '&quot;')}"/>
<style>${css}\n${pageCss}</style>
</head>
<body>${clone.outerHTML}</body>
</html>`
}

/**
 * Real PDF via headless Chrome print (`/api/quotation-pdf`).
 * Vector text + real images — same idea as Print → Save as PDF.
 * No html2canvas screenshots (those pixelate when you zoom).
 */
export async function downloadQuotationPdf(fileNameOrOpts) {
  const fileName = String(
    typeof fileNameOrOpts === 'string'
      ? fileNameOrOpts
      : (fileNameOrOpts?.fileName || quotationFileName(fileNameOrOpts?.quote, 'pdf'))
  ).replace(/[\\/:*?"<>|]+/g, '-') || 'Quotation.pdf'

  document.documentElement.classList.add('qg-a4-export')
  let html
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    html = await buildPreviewExportHtml()
  } finally {
    document.documentElement.classList.remove('qg-a4-export')
  }
  if (!html?.trim()) throw new Error('nothing on screen to export')

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), 60000) : null
  let response
  try {
    response = await fetch('/api/quotation-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, fileName }),
      signal: controller?.signal
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('PDF export timed out — try again with fewer images')
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const payload = await response.json()
      detail = payload?.error || payload?.code || ''
    } catch { /* ignore */ }
    throw new Error(detail || `PDF export failed (${response.status})`)
  }

  const blob = await response.blob()
  if (!blob?.size) throw new Error('the PDF came back empty')
  saveBlob(blob, fileName)
  return blob.size
}
