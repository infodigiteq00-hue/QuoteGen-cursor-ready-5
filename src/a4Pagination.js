/** A4 at 96dpi — 210mm × 297mm. Shared by preview, PDF, Word, and Excel. */
export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297
export const A4_WIDTH_PX = 794
export const A4_HEIGHT_PX = 1123

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

/** Map an element's on-screen height into the paper's local pixel space (includes table zoom). */
function localHeight(el, paper) {
  if (!el) return 0
  const raw = el.offsetHeight || 0
  if (!paper) return raw
  const paperBox = paper.getBoundingClientRect()
  const paperLocal = paper.clientHeight || A4_HEIGHT_PX
  const scale = paperBox.height / paperLocal
  if (!Number.isFinite(scale) || scale < 0.05) return raw
  return el.getBoundingClientRect().height / scale
}

/** Usable plate height in local pixels so packing fills the A4 sheet. */
function plateUsableHeight(paper, plate) {
  const paperH = paper?.clientHeight || A4_HEIGHT_PX
  const runHeader = paper?.querySelector('.qg-sheet-run-header')
  const runFooter = paper?.querySelector('.qg-sheet-run-footer')
  const chrome = localHeight(runHeader, paper) + localHeight(runFooter, paper) + boxExtras(plate)
  const fromPaper = paperH - chrome
  const fromPlate = localHeight(plate, paper)
  return Math.max(fromPlate, fromPaper, 200)
}

export function measureA4Blocks(root) {
  const fallbackFirst = A4_HEIGHT_PX - 88
  const fallbackContinued = A4_HEIGHT_PX - 124
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
  const paperOf = (el) => el?.closest?.('.qg-studio-paper') || firstPaper
  const heightOf = (selector) => {
    const el = root.querySelector(selector)
    return el ? localHeight(el, paperOf(el)) : 0
  }
  const rowHeights = []
  root.querySelectorAll('[data-qg-row]').forEach((node) => {
    const i = Number(node.getAttribute('data-qg-row'))
    if (Number.isInteger(i) && i >= 0) rowHeights[i] = localHeight(node, paperOf(node))
  })
  const firstPlate = firstPaper?.querySelector('.qg-paper-plate')
  const continuedPlate = continuedPaper?.querySelector('.qg-paper-plate')
  const bodyPadY = verticalPadding(root.querySelector('.qg-paper-body')) || 44
  const firstUsable = plateUsableHeight(firstPaper, firstPlate) || fallbackFirst
  return {
    headerHeight: heightOf('[data-qg-block="header"]'),
    metaHeight: heightOf('[data-qg-block="meta"]'),
    theadHeight: heightOf('[data-qg-block="thead"]'),
    totalsHeight: heightOf('[data-qg-block="totals"]'),
    closingHeight: heightOf('[data-qg-block="closing"]'),
    bodyPadY,
    rowHeights,
    firstUsable,
    continuedUsable: plateUsableHeight(continuedPaper, continuedPlate)
      || Math.max(200, firstUsable - 36)
  }
}

/**
 * Pack quotation blocks into A4 sheets. Rows stay whole (never split mid-row).
 * Header + TO/SUBJECT stay on page 1; the table header repeats on item pages.
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
  const heightOf = (i) => Math.max(1, num(rowHeights[i], 36))
  const pad = Math.max(0, num(bodyPadY, 44))
  const firstBudget = Math.max(80, num(firstUsable, A4_HEIGHT_PX - 88))
  const continuedBudget = Math.max(80, num(continuedUsable, A4_HEIGHT_PX - 124))

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
  const leftover = lastBudget - usedOn(last) - 8
  const totals = Math.max(0, totalsHeight)
  const closing = Math.max(0, closingHeight)

  if (leftover >= totals + closing) {
    last.showTotals = totals > 0
    last.showClosing = closing > 0
  } else if (leftover >= totals && totals > 0) {
    last.showTotals = true
    if (closing > 0) {
      pages.push({ showHeader: false, showMeta: false, rows: [], showTotals: false, showClosing: true })
    }
  } else {
    if (totals + closing <= continuedBudget) {
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
