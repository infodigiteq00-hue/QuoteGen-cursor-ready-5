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
const shortDemo = /^\/(?:d|demo)\/\d+$/.test(path)
const adsPath = path === '/metaadslanding' || path === '/meta-ads-landing' || path === '/metaadslanding2' || path === '/trial-verify'
const quotationPay = /^\/quotation\/demo\d+\/paymentpage\d+$/i.test(path)
const demoPath = path === '/demo' || path === '/payment-status' || path === '/set-password' || /^\/pay\/[0-9a-f-]{36}$/i.test(path) || quotationPay || demoLink || shortDemo || (path === '/' && needsPassword())
const guestPath = path === '/'
  || path === '/signin' || path === '/login' || path === '/sign-in'
  || path === '/privacy' || path === '/privacy-policy'
  || path === '/terms' || path === '/terms-of-service' || path === '/terms-and-conditions'
  || path === '/refund' || path === '/refund-policy' || path === '/cancellation'
  || path === '/contact' || path === '/contact-us'

function hasAuthHash() {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return false
  const params = new URLSearchParams(hash)
  return params.has('access_token') || params.has('error_code') || params.get('type') === 'recovery'
}

function hasStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) || ''
      if (!/^sb-.+-auth-token$/.test(key)) continue
      if (String(localStorage.getItem(key) || '').includes('access_token')) return true
    }
  } catch { /* private mode */ }
  return false
}

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
  } else if ((guestPath || hasAuthHash()) && !hasStoredSession()) {
    const { mountPublicShell } = await import('./publicShell.jsx')
    mountPublicShell()
  } else {
    const { mountQuoteGenApp } = await import('./main.jsx')
    mountQuoteGenApp()
  }
}

bootApp().catch((error) => {
  console.error('QuoteGen failed to start', error)
})
