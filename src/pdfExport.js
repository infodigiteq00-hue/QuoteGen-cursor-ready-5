/**
 * "Download PDF" — save a real file instead of opening the print dialog.
 *
 * The quotation is already laid out correctly on screen, and the print
 * stylesheet already turns that layout into paper. So rather than re-drawing
 * the quotation into a canvas (which loses the nested tax/discount headers and
 * mangles page breaks), this snapshots the live document — with form values
 * baked in, stylesheets inlined and images embedded — and posts it to
 * /api/quotation-pdf, where a headless Chrome prints exactly the same thing.
 *
 * The request travels with the caller's bearer token (installAuthFetch patches
 * window.fetch for /api/ URLs), and it carries its own content, so the server
 * never has to look a quotation up by id.
 */

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
  })
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
    try {
      const response = await fetch(new URL(src, document.baseURI).href, { credentials: 'omit' })
      if (!response.ok) return
      image.setAttribute('src', await blobToDataUrl(await response.blob()))
    } catch {
      /* leave the URL in place; the renderer will try to fetch it */
    }
  }))
}

/** A self-contained copy of the current screen, ready to be printed as-is. */
export async function buildPrintableDocument() {
  const clone = document.documentElement.cloneNode(true)
  bakeFieldValues(document.documentElement, clone)

  const head = clone.querySelector('head') || clone.insertBefore(document.createElement('head'), clone.firstChild)
  const { css, unreadable } = collectStyles()

  clone.querySelectorAll('script, link[rel="modulepreload"], link[rel="preload"]').forEach(node => node.remove())
  clone.querySelectorAll('style').forEach(node => node.remove())
  clone.querySelectorAll('link[rel="stylesheet"]').forEach(node => {
    if (!unreadable.has(node.href)) node.remove()
  })

  const base = document.createElement('base')
  base.setAttribute('href', document.baseURI)
  head.insertBefore(base, head.firstChild)

  const style = document.createElement('style')
  style.textContent = css
  head.appendChild(style)

  await inlineImages(clone)
  return `<!doctype html>\n${clone.outerHTML}`
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

/** Render the current screen server-side and save it. Throws with a usable message. */
export async function downloadQuotationPdf(fileName) {
  const html = await buildPrintableDocument()
  const response = await fetch('/api/quotation-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, fileName })
  })

  if (!response.ok) {
    let message = `the PDF service returned ${response.status}`
    try {
      const body = await response.json()
      if (body?.error) message = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message)
  }

  const blob = await response.blob()
  if (!blob.size) throw new Error('the PDF came back empty')
  const type = (blob.type || response.headers.get('content-type') || '').toLowerCase()
  if (type && !type.includes('pdf')) {
    throw new Error('the server did not return a PDF file')
  }
  saveBlob(blob, fileName)
  return blob.size
}
