/** Small helpers for quotation images. Kept out of the PDF exporter so the
 *  homepage does not download html2canvas and jsPDF. */

export function quotationFileName(quote, ext = 'pdf') {
  const parts = [
    'Quotation',
    String(quote?.number || '').trim(),
    quote?.revision > 0 ? `Rev${quote.revision}` : '',
    String(quote?.customer?.company || quote?.customer?.name || '').trim()
  ].filter(Boolean)
  const base = parts.join('-')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110)
  const suffix = String(ext || 'pdf').replace(/^\./, '')
  return `${base || 'Quotation'}.${suffix}`
}

export function storagePathFromUrl(src) {
  const text = String(src || '')
  if (!text || text.startsWith('data:') || text.startsWith('blob:')) return ''
  const fromApi = text.match(/[?&]path=([^&]+)/)
  if (fromApi && text.includes('/api/quote-assets/content')) {
    try { return decodeURIComponent(fromApi[1]) } catch { return fromApi[1] }
  }
  const fromBucket = text.match(/\/object\/(?:public|sign|authenticated)\/quote-assets\/((?:quote-images|quote-files)\/[^?#]+)/i)
    || text.match(/\/render\/image\/public\/quote-assets\/((?:quote-images|quote-files)\/[^?#]+)/i)
  if (fromBucket) {
    try { return decodeURIComponent(fromBucket[1]) } catch { return fromBucket[1] }
  }
  const bare = text.match(/((?:quote-images|quote-files)\/[A-Za-z0-9._\-/]+)/)
  return bare ? bare[1].replace(/\/+$/, '') : ''
}

export function quoteAssetSrc(url, path) {
  const text = String(url || '')
  if (text.startsWith('data:') || text.startsWith('blob:')) return text
  if (/^https?:\/\//i.test(text) && /quote-assets/i.test(text)) return text
  const key = String(path || '').trim() || storagePathFromUrl(url)
  if (key) return `/api/quote-assets/content?path=${encodeURIComponent(key)}`
  return text
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

export async function fetchAssetDataUrl(src) {
  const path = storagePathFromUrl(src)
  const attempts = []
  if (path) attempts.push(`/api/quote-assets/content?path=${encodeURIComponent(path)}`)
  if (src && !src.startsWith('data:') && !src.startsWith('/api/')) attempts.push(src)
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(4000)
    : undefined

  for (const url of attempts) {
    try {
      const href = url.startsWith('/') ? url : new URL(url, document.baseURI).href
      const response = await fetch(href, url.startsWith('/api/')
        ? { signal }
        : { credentials: 'omit', signal })
      if (!response.ok) continue
      const blob = await response.blob()
      if (!blob.size) continue
      return await blobToDataUrl(blob)
    } catch {
      /* try the next source */
    }
  }
  return null
}

export function onQuoteAssetImgError(event) {
  const image = event.currentTarget
  if (!image || image.dataset.qgAssetTried) return
  image.dataset.qgAssetTried = '1'
  const src = image.getAttribute('src') || ''
  fetchAssetDataUrl(src).then((dataUrl) => {
    if (dataUrl) image.src = dataUrl
  }).catch(() => {})
}
