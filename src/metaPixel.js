const DEFAULT_PIXEL_ID = import.meta.env.PROD ? '1026625536503155' : ''
const PIXEL_ID = String(import.meta.env.VITE_META_PIXEL_ID || DEFAULT_PIXEL_ID).trim()
const FIRED_KEY = 'qg_pixel_fired'

let ready = false

export function initMetaPixel() {
  if (ready || !PIXEL_ID || typeof window === 'undefined') return
  ready = true
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', PIXEL_ID)
  window.fbq('track', 'PageView')
}

function firedOnce(key) {
  try {
    const fired = JSON.parse(localStorage.getItem(FIRED_KEY) || '{}')
    if (fired[key]) return true
    fired[key] = Date.now()
    localStorage.setItem(FIRED_KEY, JSON.stringify(fired))
  } catch { /* private mode */ }
  return false
}

/** Fire a standard event. Pass `once` to dedupe across reloads (e.g. an order id). */
export function trackPixel(event, params = {}, { once } = {}) {
  if (!PIXEL_ID || typeof window === 'undefined' || typeof window.fbq !== 'function') return
  if (once && firedOnce(`${event}:${once}`)) return
  window.fbq('track', event, params, once ? { eventID: `${event}-${once}` } : undefined)
}
