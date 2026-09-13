import {
  injectWordPageBreakMarkers,
  splitWordHtmlPages,
  joinWordHtmlPages,
  normalizeWordPageBreaks,
  QG_PAGE_BREAK_HTML,
  QG_PAGE_BREAK_TEXT
} from './uploadWordPages.js'

const failures = []
function assert(cond, msg) {
  if (!cond) failures.push(msg)
}

const single = '<p>Page one only</p>'
assert(splitWordHtmlPages(single).length === 1, 'single page stays one sheet')
assert(splitWordHtmlPages(single)[0].includes('Page one only'), 'single page content preserved')

const joined = `<p>Cover</p>${QG_PAGE_BREAK_HTML}<p>Commercial offer</p>`
const parts = splitWordHtmlPages(joined)
assert(parts.length === 2, `split into 2 pages, got ${parts.length}`)
assert(parts[0].includes('Cover'), 'page 1 content')
assert(parts[1].includes('Commercial offer'), 'page 2 content')
assert(joinWordHtmlPages(parts).includes(QG_PAGE_BREAK_HTML), 'join restores marker')

const mammothLike = `<p>${QG_PAGE_BREAK_TEXT}</p>`
const normalized = normalizeWordPageBreaks(mammothLike)
assert(normalized.includes(QG_PAGE_BREAK_HTML), 'mammoth marker normalized')
assert(!normalized.includes(QG_PAGE_BREAK_TEXT), 'plain marker removed')

const xml = injectWordPageBreakMarkers(`
<w:body>
  <w:p><w:r><w:t>First</w:t><w:br w:type="page"/></w:r></w:p>
  <w:p><w:r><w:t>Second</w:t></w:r></w:p>
</w:body>`)
assert(xml.includes(QG_PAGE_BREAK_TEXT), 'docx page break injected')

if (failures.length) {
  console.error(`FAILED ${failures.length}`)
  for (const f of failures) console.error(' -', f)
  process.exit(1)
}
console.log('uploadWordPages checks passed')
