/** Visual themes for the default QuoteGen quotation paper (not uploaded templates). */

export const DEFAULT_ACCENT = '#1A73E8'

function tableTintFromAccent(accent) {
  return {
    accent,
    accentSoft: mixHex(accent, '#ffffff', 0.94),
    labelColor: accent,
    tableHeadBg: accent,
    tableHeadText: '#ffffff',
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
    pageBg: '#eef0f5',
    paperBg: '#ffffff',
    text: '#2d3748',
    muted: '#718096',
    metaBarBg: '#f7f9fc',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    titleFont: 'Outfit, "Avenir Next", "Segoe UI", Inter, sans-serif',
    ...tableTintFromAccent(DEFAULT_ACCENT)
  },
  warm: {
    id: 'warm',
    label: 'Warm invoice',
    hint: 'Ivory paper, stone headings — understated and trustworthy',
    pageBg: '#ede9e1',
    paperBg: '#faf8f3',
    text: '#3a3020',
    muted: '#7a6e5e',
    metaBarBg: '#f2ede0',
    fontFamily: 'Georgia, "Times New Roman", serif',
    titleFont: 'Outfit, "Avenir Next", "Segoe UI", Inter, sans-serif',
    ...tableTintFromAccent(DEFAULT_ACCENT)
  }
}

export function resolvePaperTheme(id, tableAccent) {
  const base = PAPER_THEMES[id] || PAPER_THEMES.corporate
  const chosen = /^#[0-9a-f]{6}$/i.test(tableAccent) ? tableAccent : DEFAULT_ACCENT
  const tint = tableTintFromAccent(chosen)
  return {
    ...base,
    ...tint,
    accent: chosen,
    labelColor: chosen,
    tableAccent: chosen
  }
}

export function accentForTableColor(id, palette) {
  if (id === 'logo-primary' && palette?.primary) return palette.primary
  if (id === 'logo-secondary' && palette?.secondary) return palette.secondary
  return DEFAULT_ACCENT
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
