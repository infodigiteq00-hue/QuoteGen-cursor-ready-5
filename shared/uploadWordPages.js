/** Marker embedded in converted Word HTML — splits one long doc into separate pages. */
export const QG_PAGE_BREAK_HTML = '<!--QG_PAGE_BREAK-->'

/** Plain-text marker inserted into docx XML before mammoth runs. */
export const QG_PAGE_BREAK_TEXT = '[[QG_PAGE_BREAK]]'

const PAGE_MARKER_PARA = `<w:p><w:r><w:t xml:space="preserve">${QG_PAGE_BREAK_TEXT}</w:t></w:r></w:p>`

/** Insert page-break markers into WordprocessingML so mammoth preserves page boundaries. */
export function injectWordPageBreakMarkers(docXml) {
  let xml = String(docXml || '')
  if (!xml) return xml

  xml = xml.replace(
    /<w:br\b(?=[^>]*\bw:type="page"[^>]*)([^>]*)\/?>/gi,
    `</w:r></w:p>${PAGE_MARKER_PARA}<w:p><w:r>`
  )

  xml = xml.replace(
    /<w:lastRenderedPageBreak\b[^>]*\/?>/gi,
    `</w:r></w:p>${PAGE_MARKER_PARA}<w:p><w:r>`
  )

  xml = xml.replace(
    /<w:p\b([^>]*)>(\s*<w:pPr\b[\s\S]*?<\/w:pPr>)/gi,
    (full, attrs, pPr) => {
      if (!/<w:pageBreakBefore\b/i.test(pPr)) return full
      return `${PAGE_MARKER_PARA}<w:p${attrs}>${pPr}`
    }
  )

  return xml
}

export function normalizeWordPageBreaks(html) {
  let out = String(html || '')
  const escaped = QG_PAGE_BREAK_HTML.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  out = out.replace(new RegExp(QG_PAGE_BREAK_TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), QG_PAGE_BREAK_HTML)
  out = out.replace(new RegExp(`<p[^>]*>\\s*${escaped}\\s*</p>`, 'gi'), QG_PAGE_BREAK_HTML)
  out = out.replace(new RegExp(`<p[^>]*>\\s*<strong>\\s*${escaped}\\s*</strong>\\s*</p>`, 'gi'), QG_PAGE_BREAK_HTML)
  return out
}

/** Split converted HTML into separate pages. Single-page docs return one chunk. */
export function splitWordHtmlPages(html) {
  const normalized = normalizeWordPageBreaks(html)
  if (!normalized.includes(QG_PAGE_BREAK_HTML)) {
    const trimmed = normalized.trim()
    return trimmed ? [trimmed] : ['']
  }
  const parts = normalized
    .split(QG_PAGE_BREAK_HTML)
    .map(part => part.trim())
    .filter(Boolean)
  return parts.length ? parts : ['']
}

export function joinWordHtmlPages(pages) {
  return (pages || [])
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(QG_PAGE_BREAK_HTML)
}

export function wordPagesFromContent(content) {
  if (Array.isArray(content?.pages) && content.pages.length) return content.pages
  return splitWordHtmlPages(content?.html || '')
}

export function wordHtmlFromContent(content) {
  const pages = wordPagesFromContent(content)
  return pages.length > 1 ? joinWordHtmlPages(pages) : (pages[0] || content?.html || '')
}
