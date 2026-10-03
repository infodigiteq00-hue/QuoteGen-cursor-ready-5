import { initMetaPixel } from './metaPixel.js'
import { registerPwa } from './pwaInstall.js'

initMetaPixel()
registerPwa()

function pathName() {
  return String(window.location.pathname || '/').replace(/\/+$/, '') || '/'
}

function needsPassword() {
  try { return sessionStorage.getItem('qg_needs_password') === '1' } catch { return false }
}

const path = pathName()
const demoLink = path === '/' && new URLSearchParams(window.location.search).get('try') === '1'
const adsPath = path === '/metaadslanding' || path === '/meta-ads-landing' || path === '/trial-verify'
const demoPath = path === '/demo' || path === '/payment-status' || path === '/set-password' || demoLink || (path === '/' && needsPassword())

window.__QG_BOOT_OWNER = 'boot'

if (demoLink) {
  window.history.replaceState({}, '', '/demo')
}

async function bootApp() {
  if (adsPath) {
    const { mountAdsShell } = await import('./adsShell.jsx')
    mountAdsShell()
  } else if (demoPath || needsPassword()) {
    if (path === '/' && needsPassword()) window.history.replaceState({}, '', '/set-password')
    const { mountDemoShell } = await import('./demoShell.jsx')
    mountDemoShell()
  } else {
    const { mountQuoteGenApp } = await import('./main.jsx')
    mountQuoteGenApp()
  }
}

bootApp().catch((error) => {
  console.error('QuoteGen failed to start', error)
})
