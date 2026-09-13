/**
 * Pack on-screen blocks into A4 slices without cutting a row, totals, or sign-off
 * in half. Used by PDF / Word / Excel preview export for studio and uploaded layouts.
 */

function num(n, fallback = 0) {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function naiveSlices(height, pageH, minTail) {
  const H = Math.max(80, pageH)
  const total = Math.max(0, height)
  if (total <= H) return [{ y: 0, h: Math.max(1, total || H) }]
  const slices = []
  let y = 0
  while (y < total - 2) {
    const h = Math.min(H, total - y)
    if (h < minTail && slices.length) break
    slices.push({ y, h })
    y += h
  }
  return slices.length ? slices : [{ y: 0, h: H }]
}

function normalizeBlocks(blocks) {
  return (blocks || [])
    .map(b => ({
      top: num(b.top),
      bottom: num(b.bottom),
      kind: b.kind || 'row',
      keepWithNext: !!b.keepWithNext
    }))
    .filter(b => b.bottom > b.top + 1)
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom)
}

function clusterBlocks(items) {
  const groups = []
  for (let i = 0; i < items.length;) {
    let j = i
    let bottom = items[i].bottom
    while (items[j].keepWithNext && j + 1 < items.length) {
      j += 1
      bottom = Math.max(bottom, items[j].bottom)
    }
    groups.push({ top: items[i].top, bottom, from: i, to: j })
    i = j + 1
  }
  return groups
}

function keepClosingTogether(items, pageH) {
  let lastItem = -1
  items.forEach((b, i) => { if (b.kind === 'item') lastItem = i })
  if (lastItem < 0 || lastItem >= items.length - 1) return items
  const closeTop = items[lastItem + 1].top
  const closeBottom = items[items.length - 1].bottom
  if (closeBottom - closeTop <= pageH * 0.9) {
    for (let i = lastItem + 1; i < items.length - 1; i++) items[i].keepWithNext = true
  }
  return items
}

/**
 * @param {{top:number,bottom:number,kind?:string,keepWithNext?:boolean}[]} blocks
 * @param {number} pageH  page height in the same px space as block tops
 * @returns {{y:number,h:number}[]}
 */
export function packExportSlices(blocks, pageH, opts = {}) {
  const H = Math.max(80, num(pageH, 0))
  const pad = num(opts.pad, 12)
  const minTail = num(opts.minTail, 28)
  const items = keepClosingTogether(normalizeBlocks(blocks), H)
  if (!items.length) return naiveSlices(num(opts.contentHeight, H), H, minTail)

  const groups = clusterBlocks(items)
  const slices = []
  let start = Math.min(0, groups[0].top)

  const flush = (end) => {
    const h = end - start
    if (h < minTail && slices.length) {
      start = end
      return
    }
    slices.push({ y: start, h: Math.min(H, Math.max(1, h)) })
    start = end
  }

  for (const g of groups) {
    if (g.bottom - start > H && g.top - start > 20) flush(g.top)
    while (g.bottom - start > H) flush(start + H)
  }

  const contentEnd = groups[groups.length - 1].bottom + pad
  if (contentEnd - start > minTail) flush(contentEnd)
  return slices.length ? slices : [{ y: 0, h: H }]
}
