/** How a company footer banner sits in the page footer box. */

export const DEFAULT_FOOTER_FIT = {
  height: 140,
  width: 100,
  zoom: 100,
  x: 50,
  y: 50
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

export function normalizeFooterFit(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const num = (value, min, max, fallback) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.round(clamp(n, min, max))
  }
  return {
    height: num(src.height, 48, 280, DEFAULT_FOOTER_FIT.height),
    width: num(src.width, 50, 100, DEFAULT_FOOTER_FIT.width),
    zoom: num(src.zoom, 70, 200, DEFAULT_FOOTER_FIT.zoom),
    x: num(src.x, 0, 100, DEFAULT_FOOTER_FIT.x),
    y: num(src.y, 0, 100, DEFAULT_FOOTER_FIT.y)
  }
}

export function footerFitCssVars(raw) {
  const fit = normalizeFooterFit(raw)
  return {
    '--qg-footer-h': `${fit.height}px`,
    '--qg-footer-w': `${fit.width}%`,
    '--qg-footer-zoom': String(fit.zoom / 100),
    '--qg-footer-x': `${fit.x}%`,
    '--qg-footer-y': `${fit.y}%`
  }
}

export function patchFooterFit(current, patch) {
  return normalizeFooterFit({ ...normalizeFooterFit(current), ...(patch || {}) })
}
