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
import { fetchAssetDataUrl, quotationFileName } from './quoteAssets.js'

export { onQuoteAssetImgError, quotationFileName, quoteAssetSrc, storagePathFromUrl } from './quoteAssets.js'

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
  copyComputedType(original, copy)
}

function copyComputedType(from, to) {
  if (!from || !to || from.nodeType !== 1 || to.nodeType !== 1) return
  if (typeof getComputedStyle !== 'function') return
  try {
    const st = getComputedStyle(from)
    if (!st || st.display === 'none' || st.visibility === 'hidden') return
    const set = (prop, value) => {
      if (value == null || value === '') return
      to.style.setProperty(prop, value, 'important')
    }
    set('font-family', st.fontFamily)
    set('font-size', st.fontSize)
    set('font-weight', st.fontWeight)
    set('font-style', st.fontStyle)
    set('letter-spacing', st.letterSpacing)
    set('line-height', st.lineHeight)
    set('color', st.color)
    set('text-align', st.textAlign)
    set('text-transform', st.textTransform)
    set('font-variant-numeric', st.fontVariantNumeric)
    set('font-feature-settings', st.fontFeatureSettings)
    set('font-kerning', st.fontKerning)
  } catch { /* computed style unavailable */ }
}

const SKIP_TYPE_TAGS = /^(SCRIPT|STYLE|LINK|IMG|SVG|CANVAS|VIDEO|PATH|BR|HR|COL|COLGROUP|SOURCE|META)$/i

/** Copy live preview type (size, weight, family, tracking) onto the export clone. */
function bakeLiveTypography(source, clone) {
  if (!source || !clone) return
  const walk = (from, to) => {
    if (!from || !to) return
    if (!SKIP_TYPE_TAGS.test(from.tagName || '')) copyComputedType(from, to)
    const fromKids = from.children
    const toKids = to.children
    const n = Math.min(fromKids.length, toKids.length)
    for (let i = 0; i < n; i += 1) walk(fromKids[i], toKids[i])
  }
  walk(source, clone)
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


async function inlineCssFontUrls(css) {
  const source = String(css || '')
  const found = [...source.matchAll(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/gi)]
  const unique = [...new Set(found.map((m) => m[2]))]
  if (!unique.length) return source
  const rewritten = await Promise.all(unique.map(async (url) => {
    try {
      const data = await fetchAssetDataUrl(url)
      return data ? [url, data] : null
    } catch {
      return null
    }
  }))
  let out = source
  for (const pair of rewritten) {
    if (!pair) continue
    out = out.split(pair[0]).join(pair[1])
  }
  return out
}

async function inlineGoogleFontFaces() {
  const hrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((link) => link.href)
    .filter((href) => /fonts\.googleapis\.com/i.test(href || ''))
  if (!hrefs.length) {
    hrefs.push('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700&display=swap')
  }
  const chunks = await Promise.all(hrefs.map(async (href) => {
    try {
      const response = await fetch(href, { mode: 'cors' })
      if (!response.ok) return ''
      return inlineCssFontUrls(await response.text())
    } catch {
      return ''
    }
  }))
  return chunks.filter(Boolean).join('\n')
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
  const source = exportSourceElement()
    || document.querySelector('main')
    || document.documentElement
  const clone = source.cloneNode(true)
  bakeFieldValues(source, clone)
  bakeLiveTypography(source, clone)

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
  link.rel = 'noopener'
  link.style.position = 'fixed'
  link.style.left = '-9999px'
  document.body.appendChild(link)
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 60_000)
}

function studioPapersForExport() {
  const trial = Array.from(document.querySelectorAll('[data-qg-trial-ready="1"] .qg-studio-paper'))
  if (trial.length) return trial
  const activeRoot = document.querySelector('.meta-guide-format-slide.is-active [data-qg-preview="1"]')
    || document.querySelector('.meta-guide-final-scroll [data-qg-preview="1"]')
  if (activeRoot) {
    const papers = Array.from(activeRoot.querySelectorAll('.qg-studio-paper'))
    if (papers.length) return papers
  }
  return Array.from(document.querySelectorAll('.qg-studio-paper')).filter(
    (el) => !el.closest('[data-qg-preview="1"]')
  )
}

/** Use the on-screen selected preview when present so the PDF matches what the user sees. */
function exportSourceElement() {
  const activePreview = document.querySelector('.meta-guide-format-slide.is-active [data-qg-preview="1"] .qg-studio-canvas')
    || document.querySelector('.meta-guide-final-scroll [data-qg-preview="1"] .qg-studio-canvas')
  if (activePreview) return activePreview
  const trialReady = document.querySelector('[data-qg-trial-ready="1"] .qg-studio-canvas')
  if (trialReady) return trialReady
  const editor = Array.from(document.querySelectorAll('.qg-studio-canvas')).find(
    (el) => !el.closest('[data-qg-preview="1"]') && !el.closest('.meta-guide-format-slide')
  )
  if (editor) return editor
  return document.querySelector('.qg-studio-canvas')
    || document.querySelector('article.upload-word-page')
    || document.querySelector('.upload-excel-paper')
    || document.querySelector('.upload-excel-table')?.closest('section, main, div')
}

function isPreviewMatchSource(source) {
  return Boolean(source?.closest?.('[data-qg-preview="1"], [data-qg-trial-ready="1"], .meta-guide-scaled'))
}

function captureTargets() {
  const papers = studioPapersForExport()
  if (papers.length) return papers
  const word = Array.from(document.querySelectorAll('.upload-word-page'))
  if (word.length) return word
  const excel = document.querySelector('.upload-excel-paper') || document.querySelector('.upload-excel-table')
  if (excel) return [excel.classList?.contains('upload-excel-paper') ? excel : (excel.closest('.upload-excel-paper') || excel.closest('section, main, article') || excel)]
  const canvas = exportSourceElement()
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
  const formal = Boolean(root.querySelector('.qg-theme-formal, [data-qg-theme="formal"], .qg-theme-executive, [data-qg-theme="executive"], .qg-theme-modern, [data-qg-theme="modern"], .qg-theme-atelier, [data-qg-theme="atelier"], .qg-theme-brief, [data-qg-theme="brief"], .qg-theme-concise, [data-qg-theme="concise"]'))
  const tokens = root.matches?.('[style*="--qg-table-head-bg"]') ? root : root.querySelector('[style*="--qg-table-head-bg"]')
  const headBg = tokens?.style.getPropertyValue('--qg-table-head-bg').trim() || ''
  const ink = tokens?.style.getPropertyValue('--qg-table-head-text').trim() || '#ffffff'
  root.querySelectorAll('.qg-col-title, .qg-col-title--capture').forEach((node) => {
    node.style.display = 'inline'
    node.style.visibility = 'visible'
    node.style.color = ink
    node.style.webkitTextFillColor = ink
    node.style.letterSpacing = '0'
    node.style.textTransform = 'uppercase'
    node.style.textShadow = formal ? 'none' : `0 0 0.3px ${ink}`
  })
  root.querySelectorAll('.quote-items-table thead th').forEach((th) => {
    th.style.color = ink
    th.style.webkitTextFillColor = ink
    th.style.letterSpacing = '0'
    th.style.visibility = 'visible'
    th.style.opacity = '1'
    th.style.webkitPrintColorAdjust = 'exact'
    th.style.printColorAdjust = 'exact'
    if (formal) {
      if (headBg) th.style.background = headBg
      th.style.textShadow = 'none'
    }
  })
}

function hideCaptureChrome(clonedRoot, { matchPreview = false } = {}) {
  clonedRoot.querySelectorAll(
    '.qg-image-resize, .qg-col-resizer, .qg-footer-handle, .qg-footer-edit-btn, .qg-footer-fit-bar, .qg-drop-zone, .qg-export-list, .qg-logo-resize, .qg-trial-logo-btn, .qg-paper-add-btn, .qg-paper-remove, .qg-header-meta-restore, .qg-header-meta-hide'
  ).forEach((node) => { node.remove() })
  clonedRoot.querySelectorAll('.no-print').forEach((node) => {
    if (!matchPreview && isSheetRun(node)) {
      node.style.display = 'flex'
      return
    }
    node.remove()
  })
  clonedRoot.querySelectorAll('.qg-letterhead-mark').forEach((mark) => {
    if (mark.querySelector('img[src]')) return
    const letterhead = mark.closest('.qg-letterhead')
    mark.remove()
    letterhead?.classList.add('qg-letterhead--nologo')
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
    span.className = `${node.className || ''} qg-pdf-field-text`.trim()
    span.textContent = text || placeholder
    span.style.cssText = node.style.cssText
    span.style.background = 'transparent'
    span.style.border = 'none'
    span.style.outline = 'none'
    span.style.boxShadow = 'none'
    span.style.overflow = 'visible'
    if (node.tagName === 'TEXTAREA' || text.includes('\n')) {
      span.style.display = 'block'
      span.style.width = '100%'
      span.style.whiteSpace = 'pre-wrap'
    } else if (!span.style.display) {
      span.style.display = 'inline-block'
    }
    if (!text) span.style.opacity = span.style.opacity || '0.55'
    node.replaceWith(span)
  })
}

function splitTopLevelArgs(s) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth += 1
    else if (c === ')') depth -= 1
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(s.slice(start).trim())
  return parts.filter(Boolean)
}

function parseCssColor(raw, vars) {
  const s = String(raw || '').trim()
  if (!s || /^transparent$/i.test(s)) return { r: 0, g: 0, b: 0, a: 0 }
  const varMatch = s.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\s*\)$/i)
  if (varMatch) return parseCssColor(vars[varMatch[1]] || varMatch[2] || '#1A73E8', vars)
  const hex = s.match(/^#([0-9a-f]{3,8})$/i)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a
    }
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)[%]?\s*,\s*([\d.]+)[%]?\s*,\s*([\d.]+)[%]?(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i)
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] != null ? (String(rgb[4]).endsWith('%') ? Number(rgb[4]) / 100 : Number(rgb[4])) : 1
    }
  }
  return null
}

function parseColorStop(raw, vars) {
  const s = String(raw || '').trim()
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%\s*$/)
  const colorRaw = pct ? s.slice(0, pct.index).trim() : s
  return { color: parseCssColor(colorRaw, vars), p: pct ? Number(pct[1]) / 100 : null }
}

function formatCssColor({ r, g, b, a }) {
  const rr = Math.max(0, Math.min(255, Math.round(r)))
  const gg = Math.max(0, Math.min(255, Math.round(g)))
  const bb = Math.max(0, Math.min(255, Math.round(b)))
  if (a >= 0.999) return `rgb(${rr}, ${gg}, ${bb})`
  if (a <= 0.001) return 'transparent'
  return `rgba(${rr}, ${gg}, ${bb}, ${Math.round(a * 1000) / 1000})`
}

function mixSrgbColors(c1, p1, c2, p2) {
  const a1 = c1.a * p1
  const a2 = c2.a * p2
  const a = a1 + a2
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (c1.r * a1 + c2.r * a2) / a,
    g: (c1.g * a1 + c2.g * a2) / a,
    b: (c1.b * a1 + c2.b * a2) / a,
    a
  }
}

function resolveColorMixCall(full, vars) {
  const open = full.indexOf('(')
  const inner = full.slice(open + 1, -1)
  const args = splitTopLevelArgs(inner)
  if (args.length < 3 || !/^in\s+/i.test(args[0])) return full
  const stop1 = parseColorStop(args[1], vars)
  const stop2 = parseColorStop(args[2], vars)
  if (!stop1.color || !stop2.color) return full
  let p1 = stop1.p
  let p2 = stop2.p
  if (p1 == null && p2 == null) {
    p1 = 0.5
    p2 = 0.5
  } else if (p1 == null) p1 = 1 - p2
  else if (p2 == null) p2 = 1 - p1
  const sum = p1 + p2
  if (sum <= 0) return 'transparent'
  p1 /= sum
  p2 /= sum
  return formatCssColor(mixSrgbColors(stop1.color, p1, stop2.color, p2))
}

function extractFunctionCall(css, at, nameLen) {
  let depth = 0
  let j = at + nameLen
  for (; j < css.length; j++) {
    if (css[j] === '(') depth += 1
    else if (css[j] === ')') {
      depth -= 1
      if (depth === 0) return css.slice(at, j + 1)
    }
  }
  return ''
}

function readCssVarsFrom(el) {
  const vars = { '--qg-accent': '#1A73E8' }
  if (!el || typeof getComputedStyle !== 'function') return vars
  try {
    const st = getComputedStyle(el)
    for (const name of ['--qg-accent', '--qg-accent-soft', '--qg-muted', '--qg-text', '--qg-table-head-bg', '--qg-table-border']) {
      const v = st.getPropertyValue(name).trim()
      if (v) vars[name] = v
    }
  } catch { /* detached */ }
  return vars
}

function stripUnsupportedCssFunctions(css, vars = {}) {
  const names = ['color-mix', 'oklch', 'oklab', 'lab', 'lch', 'light-dark']
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
      const call = extractFunctionCall(out, at, needle.length - 1)
      if (!call) {
        result += out.slice(at)
        break
      }
      if (name === 'color-mix') result += resolveColorMixCall(call, vars)
      else result += 'transparent'
      i = at + call.length
    }
    out = result
  }
  return out
}

/**
 * Browser @media print rules set sheets to height:auto and re-break tables —
 * that fights the live A4 pack. PDF export must keep the preview pages as-is.
 */
function stripPrintMediaBlocks(css) {
  const source = String(css || '')
  let out = ''
  let i = 0
  while (i < source.length) {
    const at = source.toLowerCase().indexOf('@media', i)
    if (at < 0) {
      out += source.slice(i)
      break
    }
    out += source.slice(i, at)
    const brace = source.indexOf('{', at)
    if (brace < 0) {
      out += source.slice(at)
      break
    }
    const prelude = source.slice(at, brace)
    let depth = 0
    let j = brace
    for (; j < source.length; j++) {
      if (source[j] === '{') depth++
      else if (source[j] === '}') {
        depth--
        if (depth === 0) {
          j++
          break
        }
      }
    }
    if (!/\bprint\b/i.test(prelude)) out += source.slice(at, j)
    i = j
  }
  return out
}

function neutralizeCloneCss(doc, vars = {}) {
  doc.querySelectorAll('style').forEach((style) => {
    style.textContent = stripUnsupportedCssFunctions(style.textContent, vars)
  })
  doc.querySelectorAll('[style]').forEach((el) => {
    const next = stripUnsupportedCssFunctions(el.getAttribute('style') || '', vars)
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
  const trialRoot = document.querySelector('[data-qg-trial-ready="1"]')
  const frames = Array.from((trialRoot || document).querySelectorAll('.qg-studio-paper-frame, .upload-word-page, .upload-excel-paper'))
  const studioPapers = trialRoot
    ? Array.from(trialRoot.querySelectorAll('.qg-studio-paper'))
    : Array.from(document.querySelectorAll('.qg-studio-paper'))
  const canvases = trialRoot
    ? Array.from(trialRoot.querySelectorAll('.qg-studio-canvas'))
    : Array.from(document.querySelectorAll('.qg-studio-canvas'))
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
    previous.push([el, 'transform', el.style.transform])
    previous.push([el, 'position', el.style.position])
    previous.push([el, 'left', el.style.left])
    previous.push([el, 'marginLeft', el.style.marginLeft])
    el.style.zoom = '1'
    el.style.width = `${A4_WIDTH_PX}px`
    el.style.transform = 'none'
    el.style.position = 'relative'
    el.style.left = 'auto'
    el.style.marginLeft = '0'
  })
  document.querySelectorAll('.qg-studio-fit').forEach((el) => {
    previous.push([el, 'height', el.style.height])
    el.style.height = 'auto'
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
  const source = exportSourceElement()
  if (!source) throw new Error('nothing on screen to export')
  const matchPreview = isPreviewMatchSource(source)
  const cssVars = readCssVarsFrom(source.querySelector('.qg-studio-paper') || source)
  try { await document.fonts.ready } catch { /* ignore */ }
  const clone = source.cloneNode(true)
  bakeFieldValues(source, clone)
  bakeLiveTypography(source, clone)
  hideCaptureChrome(clone, { matchPreview })
  await inlineImages(clone)
  const fontCss = await inlineGoogleFontFaces()
  const { css: rawCss } = collectStyles()
  // Drop @media print — it reflows sheets (height:auto) and breaks preview pagination.
  const css = stripPrintMediaBlocks(stripUnsupportedCssFunctions(rawCss, cssVars))
  const sheetRunCss = matchPreview
    ? `
    .qg-sheet-run-header,
    .qg-sheet-run-footer,
    .qg-print-run-header,
    .qg-print-run-footer,
    .qg-trial-logo-btn,
    .qg-paper-add-btn,
    .qg-paper-remove,
    .qg-header-meta-restore,
    .qg-header-meta-hide,
    .qg-logo-resize { display: none !important; }`
    : `
    .qg-sheet-run-header.no-print,
    .qg-sheet-run-footer.no-print { display: flex !important; }`
  const pageCss = `
    @page { size: 210mm 297mm; margin: 0; }
    @page qg-studio { size: 210mm 297mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; zoom: 1 !important; }
    .no-print { display: none !important; }
    ${sheetRunCss}
    .qg-col-title, .qg-col-title--capture { display: inline !important; }
    .qg-studio-canvas {
      padding: 0 !important;
      overflow: visible !important;
      background: #fff !important;
      container-type: normal !important;
      page: qg-studio;
    }
    .qg-studio-paper-frame {
      gap: 0 !important;
      width: 210mm !important;
      max-width: 210mm !important;
      zoom: 1 !important;
      transform: none !important;
    }
    .qg-studio-paper {
      width: 210mm !important;
      height: 297mm !important;
      min-height: 297mm !important;
      max-height: 297mm !important;
      overflow: hidden !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      page-break-after: always !important;
      break-after: page !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      display: flex !important;
      flex-direction: column !important;
      zoom: 1 !important;
      transform: none !important;
    }
    .qg-studio-paper:last-child { page-break-after: auto !important; break-after: auto !important; }
    .qg-paper-plate,
    .qg-page-section,
    [data-qg-block="closing"] {
      display: flex !important;
      flex-direction: column !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      overflow: hidden !important;
      height: auto !important;
    }
    [data-qg-block="closing"] > .qg-footer-image-wrap {
      margin-top: auto !important;
      margin-bottom: 10px !important;
      flex: 0 0 auto !important;
    }
    .qg-paper-plate {
      padding-bottom: 6px !important;
      box-sizing: border-box !important;
    }
    .qg-footer-image { object-fit: contain !important; width: 100% !important; height: 100% !important; }
    img { object-fit: contain !important; }
    .qg-letterhead-mark img {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      min-height: 0 !important;
    }
    .qg-letterhead--nologo .qg-letterhead-mark { display: none !important; width: 0 !important; }
    .qg-mod-hero,
    .qg-mod-hero::before,
    .qg-mod-hero::after,
    .qg-exec-rule,
    .qg-brief-bar {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .qg-col-title { color: inherit !important; white-space: nowrap !important; }
    .quote-items-table { page-break-inside: avoid !important; }
    .quote-items-table tr { page-break-inside: avoid !important; }
  `
  const baseHref = document.baseURI || ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<base href="${baseHref.replace(/"/g, '&quot;')}"/>
<style>${fontCss}\n${css}\n${pageCss}</style>
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
  // Live Railway + Chrome can need longer on big quotations; fail loudly instead of spinning forever.
  const timer = controller ? setTimeout(() => controller.abort(), 90000) : null
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
      throw new Error('PDF is taking too long on the live server. Hard-refresh and try again — if it keeps hanging, the Chromium render is stuck (usually network fonts/images).')
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (!response.ok) {
    let detail = ''
    let code = ''
    let requestId = ''
    let chromePath = ''
    try {
      const payload = await response.json()
      detail = payload?.error || payload?.message || ''
      code = payload?.code || ''
      requestId = payload?.requestId || ''
      chromePath = payload?.chromePath || ''
    } catch { /* ignore */ }

    let engineHint = ''
    try {
      const statusRes = await fetch('/api/quotation-pdf/status')
      const status = await statusRes.json().catch(() => ({}))
      if (status?.chromePath) chromePath = chromePath || status.chromePath
      else if (!chromePath) chromePath = '(none — sparticuz fallback or missing)'
    } catch { /* ignore */ }

    const parts = [
      detail || `PDF export failed (HTTP ${response.status})`,
      code ? `code=${code}` : '',
      requestId ? `id=${requestId}` : '',
      chromePath ? `chrome=${chromePath}` : ''
    ].filter(Boolean)

    if (code === 'CHROME_MISSING' || code === 'CHROME_SPAWN_FAILED') {
      const exhausted = /process threads|pthread_create|Resource temporarily unavailable/i.test(detail)
      const hint = exhausted
        ? 'live server ran out of Chrome process threads. Restart the Railway service, then try Download PDF again.'
        : 'live server could not start Chrome for PDF.'
      throw new Error(`${parts.join(' · ')} — ${hint}`)
    }
    throw new Error(parts.join(' · '))
  }

  const contentType = String(response.headers.get('content-type') || '')
  const blob = await response.blob()
  if (!blob?.size) throw new Error('the PDF came back empty')
  if (contentType.includes('json')) {
    throw new Error('PDF export returned an error payload instead of a file')
  }
  // Force a real PDF mime so the browser treats it as a downloadable file.
  const pdfBlob = blob.type === 'application/pdf'
    ? blob
    : new Blob([blob], { type: 'application/pdf' })
  saveBlob(pdfBlob, fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
  return pdfBlob.size
}
