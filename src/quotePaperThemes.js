/** Visual themes for the default QuoteGen quotation paper (not uploaded templates). */

export const DEFAULT_ACCENT = '#1A73E8'
export const DEFAULT_PAPER_STYLE = 'formal'
export const PAPER_STYLE_STORAGE_KEY = 'qg-paper-style'

function tableTintFromAccent(accent) {
  return {
    accent,
    accentSoft: mixHex(accent, '#ffffff', 0.94),
    labelColor: accent,
    tableHeadBg: accent,
    tableHeadText: readableTextOn(accent),
    tableStripeBg: mixHex(accent, '#ffffff', 0.96),
    tableBorder: mixHex(accent, '#e8edf3', 0.78),
    dropBorder: mixHex(accent, '#e8edf3', 0.88),
    dropBg: '#ffffff',
    tableAccent: accent
  }
}

export const PAPER_THEMES = {
  corporate: {
    id: 'corporate',
    label: 'Corporate clean',
    hint: 'Crisp white paper, quiet slate-blue — professional B2B',
    themeClass: 'qg-theme-corporate',
    pageBg: '#eef0f5',
    paperBg: '#ffffff',
    text: '#2d3748',
    muted: '#718096',
    metaBarBg: '#f7f9fc',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    titleFont: 'Outfit, "Avenir Next", "Segoe UI", Inter, sans-serif',
    ...tableTintFromAccent(DEFAULT_ACCENT)
  },
  formal: {
    id: 'formal',
    label: 'Formal quotation',
    hint: 'Letterhead layout — classic quote with billing, notes & bank',
    themeClass: 'qg-theme-formal',
    pageBg: '#e7edf5',
    paperBg: '#ffffff',
    text: '#1e293b',
    muted: '#64748b',
    metaBarBg: '#f7f9fc',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    titleFont: 'Outfit, "Avenir Next", "Segoe UI", Inter, sans-serif',
    ...tableTintFromAccent(DEFAULT_ACCENT)
  },
  executive: {
    id: 'executive',
    label: 'Executive proposal',
    hint: 'Boardroom-grade — headline value, key facts strip & client sign-off',
    themeClass: 'qg-theme-executive',
    pageBg: '#e6e9f0',
    paperBg: '#ffffff',
    text: '#0b1220',
    muted: '#667085',
    metaBarBg: '#f8fafc',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    titleFont: 'Outfit, "Avenir Next", "Segoe UI", Inter, sans-serif',
    ...tableTintFromAccent(DEFAULT_ACCENT)
  },
  modern: {
    id: 'modern',
    label: 'Modern studio',
    hint: 'Bento cards, soft hero panel & light totals — fresh product-style design',
    themeClass: 'qg-theme-modern',
    pageBg: '#eceff5',
    paperBg: '#ffffff',
    text: '#101828',
    muted: '#667085',
    metaBarBg: '#f7f8fa',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    titleFont: 'Outfit, "Avenir Next", "Segoe UI", Inter, sans-serif',
    ...tableTintFromAccent(DEFAULT_ACCENT)
  },
  atelier: {
    id: 'atelier',
    label: 'Atelier folio',
    hint: 'Swiss folio — Archivo type, hairline grid & a left ink rail',
    themeClass: 'qg-theme-atelier',
    pageBg: '#e4e2dc',
    paperBg: '#fbfaf6',
    text: '#161410',
    muted: '#6b655c',
    metaBarBg: '#f4f1ea',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    titleFont: 'Archivo, "Avenir Next", Inter, sans-serif',
    ...tableTintFromAccent(DEFAULT_ACCENT)
  },
  brief: {
    id: 'brief',
    label: 'Board brief',
    hint: 'Compact letterhead, dense type — serious, space-saving, high impact',
    themeClass: 'qg-theme-brief',
    pageBg: '#e8ecf2',
    paperBg: '#ffffff',
    text: '#1a2332',
    muted: '#5d6b7c',
    metaBarBg: '#f4f6f8',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    titleFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
    ...tableTintFromAccent(DEFAULT_ACCENT)
  }
}

export function isPaperStyleId(id) {
  return Boolean(id && PAPER_THEMES[id])
}

/** Retired ids (e.g. warm invoice) map onto a live theme so old quotes still open. */
export function normalizePaperStyle(id) {
  if (id === 'warm') return DEFAULT_PAPER_STYLE
  return isPaperStyleId(id) ? id : DEFAULT_PAPER_STYLE
}

export function peekPreferredPaperStyle() {
  try {
    const stored = localStorage.getItem(PAPER_STYLE_STORAGE_KEY)
    return isPaperStyleId(stored) ? stored : null
  } catch { /* private mode */ }
  return null
}

export function readPreferredPaperStyle() {
  return peekPreferredPaperStyle() || DEFAULT_PAPER_STYLE
}

export function writePreferredPaperStyle(id) {
  const next = isPaperStyleId(id) ? id : DEFAULT_PAPER_STYLE
  try { localStorage.setItem(PAPER_STYLE_STORAGE_KEY, next) } catch { /* ignore */ }
  return next
}

export function resolvePaperTheme(id, tableAccent) {
  const base = PAPER_THEMES[normalizePaperStyle(id)] || PAPER_THEMES.formal
  const chosen = /^#[0-9a-f]{6}$/i.test(tableAccent) ? tableAccent : DEFAULT_ACCENT
  const tint = tableTintFromAccent(chosen)
  const resolved = {
    ...base,
    ...tint,
    accent: chosen,
    labelColor: chosen,
    tableAccent: chosen
  }
  if (base.id === 'formal') {
    resolved.tableStripeBg = '#ffffff'
    resolved.tableBorder = '#e8edf3'
  }
  if (base.id === 'executive') {
    resolved.accentInk = mixHex(chosen, '#0b1220', 0.38)
    resolved.accentOn = readableTextOn(chosen)
    resolved.tableHeadBg = mixHex(chosen, '#ffffff', 0.9)
    resolved.tableHeadText = mixHex(chosen, '#0b1220', 0.45)
    resolved.tableStripeBg = '#ffffff'
    resolved.tableBorder = '#e7eaf0'
    resolved.accentSoft = mixHex(chosen, '#ffffff', 0.95)
  }
  if (base.id === 'modern') {
    resolved.accentInk = mixHex(chosen, '#101828', 0.35)
    resolved.accentOn = readableTextOn(chosen)
    resolved.accentSoft = mixHex(chosen, '#ffffff', 0.93)
    resolved.tableHeadBg = '#f2f4f7'
    resolved.tableHeadText = '#475467'
    resolved.tableStripeBg = '#ffffff'
    resolved.tableBorder = '#eaecf0'
  }
  if (base.id === 'atelier') {
    resolved.accentInk = mixHex(chosen, '#161410', 0.42)
    resolved.accentOn = readableTextOn(chosen)
    resolved.accentSoft = mixHex(chosen, '#fbfaf6', 0.9)
    resolved.tableHeadBg = 'transparent'
    resolved.tableHeadText = mixHex(chosen, '#161410', 0.28)
    resolved.tableStripeBg = '#fbfaf6'
    resolved.tableBorder = '#e4e0d6'
  }
  if (base.id === 'brief') {
    resolved.accentInk = mixHex(chosen, '#1a2332', 0.28)
    resolved.accentOn = readableTextOn(chosen)
    resolved.accentSoft = mixHex(chosen, '#ffffff', 0.92)
    resolved.tableHeadBg = chosen
    resolved.tableHeadText = readableTextOn(chosen)
    resolved.tableStripeBg = '#ffffff'
    resolved.tableBorder = '#e6eaef'
  }
  return resolved
}

export function accentForTableColor(id, palette, customHex) {
  if (id === 'custom') return normalizeAccentHex(customHex)
  if (id === 'logo-primary' && palette?.primary) return palette.primary
  if (id === 'logo-secondary' && palette?.secondary) return palette.secondary
  return DEFAULT_ACCENT
}

export function normalizeAccentHex(hex, fallback = DEFAULT_ACCENT) {
  const raw = String(hex || '').trim()
  const short = raw.match(/^#?([0-9a-f]{3})$/i)
  if (short) {
    const [a, b, c] = short[1]
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase()
  }
  const full = raw.match(/^#?([0-9a-f]{6})$/i)
  if (full) return `#${full[1]}`.toUpperCase()
  return fallback
}

export function tableColorSwatches(palette) {
  const swatches = [{ id: 'blue', label: 'Blue', caption: 'Default accent', hex: DEFAULT_ACCENT }]
  if (palette?.primary) {
    swatches.push({ id: 'logo-primary', label: 'Primary', caption: 'From your logo', hex: palette.primary })
  }
  if (palette?.secondary && palette.secondary.toLowerCase() !== palette.primary?.toLowerCase()) {
    swatches.push({ id: 'logo-secondary', label: 'Secondary', caption: 'From your logo', hex: palette.secondary })
  }
  return swatches
}

export function defaultValidUntil(days = 15) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function parseHex(hex) {
  const h = String(hex || '').replace('#', '')
  if (h.length !== 6) return { r: 26, g: 115, b: 232 }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  }
}

function toHex({ r, g, b }) {
  const n = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${n(r)}${n(g)}${n(b)}`
}

/** White on mid/dark brand colours, near-black only on light ones (yellow, lime, pastel). */
export function readableTextOn(bg) {
  const { r, g, b } = parseHex(bg)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness >= 165 ? '#111827' : '#ffffff'
}

export function mixHex(a, b, t) {
  const A = parseHex(a)
  const B = parseHex(b)
  return toHex({
    r: A.r + (B.r - A.r) * t,
    g: A.g + (B.g - A.g) * t,
    b: A.b + (B.b - A.b) * t
  })
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

function rgbToHue(r, g, b) {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  if (d < 0.0001) return 0
  let h = 0
  if (max === R) h = ((G - B) / d) % 6
  else if (max === G) h = (B - R) / d + 2
  else h = (R - G) / d + 4
  h *= 60
  if (h < 0) h += 360
  return h
}

/**
 * Sample a logo and return the two strongest brand colours,
 * skipping near-white / near-black / transparent pixels.
 */
export async function extractImagePalette(url) {
  if (!url) return null
  const img = await new Promise((resolve, reject) => {
    const image = new Image()
    if (!/^data:|^blob:/i.test(url)) image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read the logo colours.'))
    image.src = url
  })
  const size = 72
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  const buckets = new Map()
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 180) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max > 246 && min > 232) continue
    if (max < 28) continue
    const key = `${r >> 4},${g >> 4},${b >> 4}`
    const prev = buckets.get(key)
    if (prev) {
      prev.n += 1
      prev.r += r
      prev.g += g
      prev.b += b
    } else {
      buckets.set(key, { n: 1, r, g, b })
    }
  }
  const ranked = [...buckets.values()]
    .map(c => ({
      n: c.n,
      r: c.r / c.n,
      g: c.g / c.n,
      b: c.b / c.n,
      hex: toHex({ r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }),
      hue: rgbToHue(c.r / c.n, c.g / c.n, c.b / c.n)
    }))
    .sort((a, b) => b.n - a.n)
  if (!ranked.length) return null
  const primary = ranked[0]
  const secondary = ranked.find(c => hueDistance(c.hue, primary.hue) > 28 && c.n > ranked[0].n * 0.12) || ranked[1]
  return {
    primary: primary.hex,
    secondary: secondary?.hex || mixHex(primary.hex, '#0f172a', 0.28)
  }
}
