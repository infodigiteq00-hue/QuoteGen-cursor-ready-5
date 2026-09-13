/** A4 at 96dpi — 210mm × 297mm. Shared by preview, PDF, Word, and Excel. */
export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297
export const A4_WIDTH_PX = 794
export const A4_HEIGHT_PX = 1123

/** Keep body content clear of the sheet run header/footer chrome. */
export const A4_CONTENT_TOP_MARGIN = 10
/** Packer reserve under last content — larger than CSS inset so signatory never clips the plate. */
export const A4_CONTENT_BOTTOM_MARGIN = 64
/** If closing almost fits, absorb this much overflow instead of a near-empty page. */
export const A4_CLOSING_SQUEEZE_PX = 48

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

/** If a saved plan is missing rows (item added/removed), fall back to one measuring pass. */
export function normalizeA4Pages(plan, rowCount) {
  const count = Math.max(0, rowCount)
  const pages = Array.isArray(plan) ? plan : []
  const rows = pages.flatMap(page => (page?.rows || []).filter(i => i >= 0 && i < count))
  const unique = new Set(rows)
  if (unique.size !== count) return defaultA4Pages(count)
  return pages.map(page => ({
    showHeader: !!page.showHeader,
    showMeta: !!page.showMeta,
    rows: (page.rows || []).filter(i => i >= 0 && i < count),
    showTotals: !!page.showTotals,
    showClosing: !!page.showClosing
  }))
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
  const closingHeight = closingEl
    ? Math.max(
      (closingBody || closingFooter)
        ? localHeight(closingBody) + localHeight(closingFooter) + boxExtras(closingEl)
        : localHeight(closingEl),
      0
    )
    : 0
  return {
    headerHeight: heightOf('[data-qg-block="header"]'),
    metaHeight: heightOf('[data-qg-block="meta"]'),
    theadHeight: heightOf('[data-qg-block="thead"]'),
    totalsHeight: heightOf('[data-qg-block="totals"]'),
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

  const last = pages[pages.length - 1]
  const lastBudget = last.showHeader ? firstBudget : continuedBudget
  // Keep a reserve so totals/closing never paint into the plate edge / run-footer.
  const footerReserve = 56
  const leftover = lastBudget - usedOn(last) - footerReserve
  const totals = Math.max(0, totalsHeight)
  const closing = Math.max(0, closingHeight)
  const needAll = totals + closing
  const shortfallAll = Math.max(0, needAll - leftover)
  const canSqueezeAll = needAll > 0
    && shortfallAll > 0
    && shortfallAll <= A4_CLOSING_SQUEEZE_PX
    && leftover + A4_CLOSING_SQUEEZE_PX >= needAll

  // Prefer sharing the last items page; squeeze a little rather than a near-empty sheet.
  if ((leftover >= needAll || canSqueezeAll) && needAll > 0) {
    last.showTotals = totals > 0
    last.showClosing = closing > 0
  } else if (leftover >= totals && totals > 0) {
    last.showTotals = true
    const closeLeft = leftover - totals
    const closeShort = Math.max(0, closing - closeLeft)
    if (closing > 0 && (closeLeft >= closing || closeShort <= A4_CLOSING_SQUEEZE_PX)) {
      last.showClosing = true
    } else if (closing > 0) {
      pages.push({ showHeader: false, showMeta: false, rows: [], showTotals: false, showClosing: true })
    }
  } else {
    if (totals + closing <= continuedBudget - footerReserve) {
      pages.push({
        showHeader: false,
        showMeta: false,
        rows: [],
        showTotals: totals > 0,
        showClosing: closing > 0
      })
    } else {
      if (totals > 0) {
        pages.push({ showHeader: false, showMeta: false, rows: [], showTotals: true, showClosing: false })
      }
      if (closing > 0) {
        pages.push({ showHeader: false, showMeta: false, rows: [], showTotals: false, showClosing: true })
      }
    }
  }

  return pages.filter(page => page.showHeader || page.rows.length || page.showTotals || page.showClosing)
}
