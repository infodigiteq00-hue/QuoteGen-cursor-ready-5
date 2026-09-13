import JSZip from 'jszip'

function stripHtmlText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Walk filled HTML in document order — table cells and paragraphs. */
export function extractHtmlBlockTexts(filledHtml) {
  const blocks = []
  const re = /<(p|td|th|h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = re.exec(String(filledHtml || '')))) {
    blocks.push(stripHtmlText(m[2]))
  }
  return blocks
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function setParagraphOrCellText(inner, text) {
  const pPr = inner.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/i)?.[0] || ''
  const rPr = inner.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0] || ''
  const lines = String(text || '').split('\n')
  const runs = lines.map((line, i) => {
    const br = i > 0 ? '<w:br/>' : ''
    const safe = escapeXml(line)
    return `${br}<w:r>${rPr}<w:t xml:space="preserve">${safe}</w:t></w:r>`
  }).join('')
  return `${pPr}${runs || `<w:r>${rPr}<w:t xml:space="preserve"></w:t></w:r>`}`
}

function injectTextsIntoDocxXml(xml, texts) {
  let idx = 0
  return String(xml || '').replace(
    /(<w:tc\b[^>]*>)([\s\S]*?)(<\/w:tc>)|(<w:p\b[^>]*>)([\s\S]*?)(<\/w:p>)/g,
    (full, tcOpen, tcInner, tcClose, pOpen, pInner, pClose) => {
      if (idx >= texts.length) return full
      const text = texts[idx++]
      if (tcOpen) {
        return `${tcOpen}${setParagraphOrCellText(tcInner, text)}${tcClose}`
      }
      return `${pOpen}${setParagraphOrCellText(pInner, text)}${pClose}`
    }
  )
}

/** Patch original .docx XML with text blocks from filled HTML (same order as mammoth preview). */
export async function writeFilledWord(originalBuffer, filledHtml) {
  const zip = await JSZip.loadAsync(originalBuffer)
  const blocks = extractHtmlBlockTexts(filledHtml)
  const docFile = zip.file('word/document.xml')
  if (!docFile || !blocks.length) return Buffer.from(originalBuffer)
  const xml = await docFile.async('string')
  zip.file('word/document.xml', injectTextsIntoDocxXml(xml, blocks))
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }))
}
