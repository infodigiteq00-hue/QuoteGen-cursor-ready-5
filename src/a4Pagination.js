/** A4 at 96dpi — 210mm × 297mm. Shared by preview, PDF, Word, and Excel. */
export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297
export const A4_WIDTH_PX = 794
export const A4_HEIGHT_PX = 1123

/** Keep body content clear of the sheet run header/footer chrome. */
export const A4_CONTENT_TOP_MARGIN = 10
/** Packer reserve under last content — enough to clear the run-footer, not a half-empty sheet. */
export const A4_CONTENT_BOTTOM_MARGIN = 28
/** If closing almost fits, absorb this much overflow instead of a near-empty page. */
export const A4_CLOSING_SQUEEZE_PX = 72
/** If the subtotal is only a little too tall, shrink it instead of opening a sparse next page. */
const A4_TOTALS_SQUEEZE_PX = 110
const A4_TOTALS_MIN_FIT = 0.8
/** Under this many products, never drag 2–3 rows onto the subtotal page. */
const A4_SHORT_QUOTE_ROWS = 8
/** Gap above the pinned sheet footer after totals/closing. */
const A4_FOOTER_GAP = 22
/** Inflated totals (flex-grown empty page) must not force a totals-only sheet. */
const A4_TOTALS_HEIGHT_CAP = 260

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function pagesEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || [])
}

export function defaultA4Pages(rowCount) {
  const rows = Array.from({ length: Math.max(0, rowCount) }, (_, i) => i)
  return [
    { showHeader: true, showMeta: true, rows, showTotals: true, showClosing: false },
    { showHeader: false, showMeta: false, rows: [], showTotals: false, showClosing: true }
  ]
}

function pageRecord(page, count) {
  return {
    showHeader: !!page.showHeader,
    showMeta: !!page.showMeta,
    rows: (page.rows || []).filter(i => i >= 0 && i < count),
    showTotals: !!page.showTotals,
    showClosing: !!page.showClosing,
    totalsFit: page.showTotals && Number(page.totalsFit) > 0 && Number(page.totalsFit) < 1
      ? Number(page.totalsFit)
      : 1
  }
}

/** If a saved plan is missing rows (item added/removed), fall back to one measuring pass. */
export function normalizeA4Pages(plan, rowCount) {
  const count = Math.max(0, rowCount)
  const pages = Array.isArray(plan) ? plan : []
  const rows = pages.flatMap(page => (page?.rows || []).filter(i => i >= 0 && i < count))
  const unique = new Set(rows)
  if (unique.size !== count) {
    const missing = []
    for (let i = 0; i < count; i += 1) if (!unique.has(i)) missing.push(i)
    const appended = missing.length > 0 && missing[0] === unique.size && pages.length > 0
    if (appended) {
      const next = pages.map(page => pageRecord(page, count))
      let host = 0
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].rows.length) { host = i; break }
      }
      next[host] = { ...next[host], rows: [...next[host].rows, ...missing] }
      return next
    }
    return defaultA4Pages(count)
  }
  return pages.map(page => pageRecord(page, count))
}

function boxExtras(el) {
  if (!el) return 0
  const s = getComputedStyle(el)
  return ['marginTop', 'marginBottom', 'borderTopWidth', 'borderBottomWidth']
    .reduce((sum, key) => sum + (parseFloat(s[key]) || 0), 0)
}

function verticalPadding(el) {
  if (!el) return 0
  const s = getComputedStyle(el)
  return (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0)
}

/** CSS zoom on the table fit wrapper (not the responsive paper-frame zoom). */
function tableZoomOf(el) {
  const wrap = el?.closest?.('[data-qg-table-zoom]')
  if (!wrap) return 1
  const z = parseFloat(wrap.getAttribute('data-qg-table-zoom') || wrap.style.zoom) || 1
  return Number.isFinite(z) && z > 0.05 ? z : 1
}

/**
 * Height in the paper's unzoomed layout space.
 * Prefer offsetHeight × table-zoom — getBoundingClientRect / frame-zoom is unstable when
 * the studio frame is responsively zoomed (narrow preview), and stretched rows then feed
 * a packing loop that leaves half-empty pages.
 */
function localHeight(el) {
  if (!el) return 0
  const layout = el.offsetHeight || 0
  if (!layout) return 0
  return layout * tableZoomOf(el)
}

/**
 * Inner plate budget for one A4 sheet.
 * Must use the paper's fixed box, never the plate's content height: overflow:visible
 * plus flex min-height:auto stretches the plate past 297mm, so packing thinks the
 * whole quotation fits on page 1 and the footer paints over page 2.
 */
function plateUsableHeight(paper, plate) {
  const paperH = paper?.clientHeight || A4_HEIGHT_PX
  const runHeader = paper?.querySelector('.qg-sheet-run-header')
  const runFooter = paper?.querySelector('.qg-sheet-run-footer')
  const section = plate?.querySelector?.('.qg-page-section')
  const chrome = localHeight(runHeader) + localHeight(runFooter)
    + boxExtras(plate)
    + verticalPadding(plate)
    + verticalPadding(section)
    + A4_CONTENT_TOP_MARGIN
    + A4_CONTENT_BOTTOM_MARGIN
  if (paperH > chrome + 80) return paperH - chrome
  return Math.max(200, A4_HEIGHT_PX - 88 - A4_CONTENT_BOTTOM_MARGIN)
}

/** Never pack more than one A4 sheet, even if a measurement came back inflated. */
function sheetBudget(value, fallback) {
  return Math.max(80, Math.min(num(value, fallback), A4_HEIGHT_PX - 8 - A4_CONTENT_BOTTOM_MARGIN))
}

export function measureA4Blocks(root) {
  const fallbackFirst = A4_HEIGHT_PX - 88 - A4_CONTENT_BOTTOM_MARGIN
  const fallbackContinued = A4_HEIGHT_PX - 124 - A4_CONTENT_BOTTOM_MARGIN
  if (!root) {
    return {
      headerHeight: 0,
      metaHeight: 0,
      theadHeight: 0,
      totalsHeight: 0,
      closingHeight: 0,
      bodyPadY: 44,
      rowHeights: [],
      firstUsable: fallbackFirst,
      continuedUsable: fallbackContinued
    }
  }
  const papers = Array.from(root.querySelectorAll('.qg-studio-paper'))
  const zoomed = []
  root.querySelectorAll('[data-qg-block="totals"]').forEach((node) => {
    zoomed.push([node, node.style.zoom])
    node.style.zoom = ''
  })
  const restoreZoom = () => {
    zoomed.forEach(([node, zoom]) => { node.style.zoom = zoom })
  }
  const firstPaper = papers[0]
  const continuedPaper = papers.slice(1).find(Boolean)
  const heightOf = (selector) => {
    const el = root.querySelector(selector)
    return el ? localHeight(el) : 0
  }
  const firstPlate = firstPaper?.querySelector('.qg-paper-plate')
  const continuedPlate = continuedPaper?.querySelector('.qg-paper-plate')
  const bodyPadY = verticalPadding(root.querySelector('.qg-paper-body')) || 44
  const firstUsable = plateUsableHeight(firstPaper, firstPlate) || fallbackFirst
  const continuedUsable = plateUsableHeight(continuedPaper, continuedPlate)
    || Math.max(200, firstUsable - 36)
  // Cap stretched/inflated rows so one tall measure cannot empty every following page.
  const rowCap = Math.max(120, Math.min(sheetBudget(continuedUsable, fallbackContinued) * 0.42, 400))
  const rowHeights = []
  root.querySelectorAll('[data-qg-row]').forEach((node) => {
    const i = Number(node.getAttribute('data-qg-row'))
    if (!Number.isInteger(i) || i < 0) return
    const h = localHeight(node)
    rowHeights[i] = Math.max(1, Math.min(h || 36, rowCap))
  })
  const closingEl = root.querySelector('[data-qg-block="closing"]')
  const closingBody = closingEl?.querySelector('.qg-paper-body')
  const closingFooter = closingEl?.querySelector('.qg-footer-image-wrap')
  // Inner content only — the closing block is flex-grown to fill the last sheet,
  // so measuring the wrapper would look like a whole extra page and never share.
  const closingInner = (closingBody || closingFooter)
    ? localHeight(closingBody) + localHeight(closingFooter) + boxExtras(closingEl)
    : closingEl
      ? Array.from(closingEl.children).reduce((sum, node) => sum + localHeight(node), 0) + boxExtras(closingEl)
      : 0
  const closingHeight = Math.max(closingInner, 0)
  restoreZoom()
  return {
    headerHeight: heightOf('[data-qg-block="header"]'),
    metaHeight: heightOf('[data-qg-block="meta"]'),
    theadHeight: heightOf('[data-qg-block="thead"]'),
    totalsHeight: Math.min(heightOf('[data-qg-block="totals"]'), A4_TOTALS_HEIGHT_CAP),
    closingHeight,
    bodyPadY,
    rowHeights,
    firstUsable,
    continuedUsable
  }
}

/**
 * Pack quotation blocks into A4 sheets. Rows stay whole (never split mid-row).
 * Header + TO/SUBJECT stay on page 1; the table header repeats on item pages.
 * Closing may "squeeze" onto the last items page when only a little short.
 */
export function packA4Pages({
  rowCount,
  rowHeights = [],
  headerHeight = 0,
  metaHeight = 0,
  theadHeight = 0,
  totalsHeight = 0,
  closingHeight = 0,
  bodyPadY = 44,
  firstUsable = A4_HEIGHT_PX - 88,
  continuedUsable = A4_HEIGHT_PX - 124
}) {
  const count = Math.max(0, Number(rowCount) || 0)
  const remaining = Array.from({ length: count }, (_, i) => i)
  const pad = Math.max(0, num(bodyPadY, 44))
  const firstBudget = sheetBudget(firstUsable, A4_HEIGHT_PX - 88)
  const continuedBudget = sheetBudget(continuedUsable, A4_HEIGHT_PX - 124)
  const rowCap = Math.max(120, Math.min(continuedBudget * 0.42, 400))
  const heightOf = (i) => Math.max(1, Math.min(num(rowHeights[i], 36), rowCap))

  const takeRows = (budget) => {
    const chunk = []
    let used = 0
    while (remaining.length) {
      const h = heightOf(remaining[0])
      if (chunk.length && used + h > budget) break
      chunk.push(remaining.shift())
      used += h
      if (h > budget && chunk.length === 1) break
    }
    return { chunk, used }
  }

  const pages = []
  const firstChrome = headerHeight + metaHeight + theadHeight + pad
  const first = takeRows(firstBudget - firstChrome)
  pages.push({
    showHeader: true,
    showMeta: true,
    rows: first.chunk,
    showTotals: false,
    showClosing: false
  })

  while (remaining.length) {
    const next = takeRows(continuedBudget - theadHeight - pad)
    if (!next.chunk.length) {
      pages.push({
        showHeader: false,
        showMeta: false,
        rows: [remaining.shift()],
        showTotals: false,
        showClosing: false
      })
      continue
    }
    pages.push({
      showHeader: false,
      showMeta: false,
      rows: next.chunk,
      showTotals: false,
      showClosing: false
    })
  }

  const usedOn = (page) => {
    const chrome = (page.showHeader ? headerHeight + metaHeight : 0)
      + (page.rows.length ? theadHeight : 0)
      + ((page.rows.length || page.showTotals) ? pad : 0)
    const rows = page.rows.reduce((sum, i) => sum + heightOf(i), 0)
    return chrome + rows
  }

  const budgetOf = (page) => (page.showHeader ? firstBudget : continuedBudget)
  const leftoverOf = (page) => budgetOf(page) - usedOn(page) - A4_FOOTER_GAP
  const totals = Math.min(Math.max(0, num(totalsHeight)), A4_TOTALS_HEIGHT_CAP)
  const closing = Math.max(0, num(closingHeight))

  const lastItems = () => pages[pages.length - 1]

  const continuedFits = (rowIds, fit = 1) => {
    const rowsH = rowIds.reduce((sum, i) => sum + heightOf(i), 0)
    const chrome = (rowIds.length ? theadHeight : 0) + pad + A4_FOOTER_GAP
    return chrome + rowsH + totals * fit <= continuedBudget + 1
  }

  const placeTotals = (page, room) => {
    if (room >= totals) {
      page.showTotals = true
      page.totalsFit = 1
      return true
    }
    const fit = room > 0 ? room / totals : 0
    if (totals - room <= A4_TOTALS_SQUEEZE_PX && fit >= A4_TOTALS_MIN_FIT) {
      page.showTotals = true
      page.totalsFit = Math.round(fit * 1000) / 1000
      return true
    }
    return false
  }

  if (totals > 0 && count > 0) {
    const last = lastItems()
    const room = leftoverOf(last)
    if (!(last.rows.length > 0 && placeTotals(last, room))) {
      // Keep the earlier page full. Move the fewest trailing rows that let the
      // subtotal sit above the footer. A short quote moves one, then two only
      // if one row still leaves the subtotal cut off.
      const maxMove = Math.min(count < A4_SHORT_QUOTE_ROWS ? 2 : 4, last.rows.length)
      let move = 0
      let moveFit = 1
      for (let n = 1; n <= maxMove; n += 1) {
        const tail = last.rows.slice(-n)
        if (continuedFits(tail, 1)) {
          move = n
          moveFit = 1
          break
        }
        const rowsH = tail.reduce((sum, i) => sum + heightOf(i), 0)
        const chrome = theadHeight + pad + A4_FOOTER_GAP
        const nextRoom = continuedBudget - chrome - rowsH
        const fit = nextRoom > 0 ? nextRoom / totals : 0
        if (totals - nextRoom <= A4_TOTALS_SQUEEZE_PX && fit >= A4_TOTALS_MIN_FIT) {
          move = n
          moveFit = Math.round(fit * 1000) / 1000
          break
        }
      }
      if (!move) {
        pages.push({
          showHeader: false,
          showMeta: false,
          rows: [],
          showTotals: true,
          showClosing: false,
          totalsFit: 1
        })
      } else {
        const tail = last.rows.splice(last.rows.length - move, move)
        pages.push({
          showHeader: false,
          showMeta: false,
          rows: tail,
          showTotals: true,
          showClosing: false,
          totalsFit: moveFit
        })
      }
    }
  }

  const last = lastItems()
  const leftover = leftoverOf(last)
  const fittedTotals = last.showTotals ? totals * (Number(last.totalsFit) > 0 ? Number(last.totalsFit) : 1) : 0
  const closeLeft = leftover - fittedTotals
  const closeShort = Math.max(0, closing - closeLeft)
  const canSqueezeClose = closing > 0
    && closeShort > 0
    && closeShort <= A4_CLOSING_SQUEEZE_PX
    && closeLeft + A4_CLOSING_SQUEEZE_PX >= closing

  if (closing > 0) {
    if (closeLeft >= closing || canSqueezeClose) {
      last.showClosing = true
    } else {
      pages.push({ showHeader: false, showMeta: false, rows: [], showTotals: false, showClosing: true })
    }
  }

  return pages.filter(page => page.showHeader || page.rows.length || page.showTotals || page.showClosing)
}
