const OPEN_EVENT = 'qg-pwa-open'
const INSTALLED_EVENT = 'qg-pwa-installed'
const SAVED_KEY = 'qg_pwa_saved'

let deferredPrompt = null
let listening = false

function ua() {
  return String(navigator.userAgent || '')
}

export function isPwaInstalled() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  if (window.matchMedia?.('(display-mode: window-controls-overlay)').matches) return true
  if (window.navigator.standalone === true) return true
  return false
}

export function markPwaSaved() {
  try { localStorage.setItem(SAVED_KEY, '1') } catch { /* ignore */ }
}

export function isPwaSaved() {
  if (isPwaInstalled()) return true
  try { return localStorage.getItem(SAVED_KEY) === '1' } catch { return false }
}

export async function rememberInstalledPwa() {
  if (isPwaInstalled()) {
    markPwaSaved()
    return true
  }
  if (typeof navigator.getInstalledRelatedApps !== 'function') return isPwaSaved()
  try {
    const apps = await navigator.getInstalledRelatedApps()
    if (Array.isArray(apps) && apps.length > 0) {
      markPwaSaved()
      window.dispatchEvent(new Event(INSTALLED_EVENT))
      return true
    }
  } catch { /* ignore */ }
  return isPwaSaved()
}

export function pwaMode() {
  if (isPwaInstalled()) return 'installed'
  const agent = ua()
  const ios = /iphone|ipad|ipod/i.test(agent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios) {
    const safari = /safari/i.test(agent) && !/crios|fxios|edgios|opt/i.test(agent)
    const inApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|Twitter|LinkedInApp|Pinterest|Snapchat|TikTok|musical_ly/i.test(agent)
    if (inApp || !safari) return 'ios-other'
    return 'ios-safari'
  }
  if (deferredPrompt) return 'prompt'
  if (/android/i.test(agent)) return 'android'
  return 'desktop'
}

export async function openPwaInstall() {
  if (deferredPrompt) {
    await promptPwaInstall()
    return
  }
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

export function onPwaInstallOpen(handler) {
  window.addEventListener(OPEN_EVENT, handler)
  return () => window.removeEventListener(OPEN_EVENT, handler)
}

export function onPwaInstalled(handler) {
  window.addEventListener(INSTALLED_EVENT, handler)
  window.addEventListener('appinstalled', handler)
  return () => {
    window.removeEventListener(INSTALLED_EVENT, handler)
    window.removeEventListener('appinstalled', handler)
  }
}

export async function promptPwaInstall() {
  if (!deferredPrompt) return { outcome: 'unavailable' }
  const prompt = deferredPrompt
  deferredPrompt = null
  prompt.prompt()
  const choice = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }))
  if (choice?.outcome === 'accepted') {
    markPwaSaved()
    window.dispatchEvent(new Event(INSTALLED_EVENT))
  }
  return choice || { outcome: 'dismissed' }
}

export function registerPwa() {
  if (listening) return
  listening = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event
    window.dispatchEvent(new Event('qg-pwa-ready'))
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    markPwaSaved()
    window.dispatchEvent(new Event(INSTALLED_EVENT))
  })
  if (isPwaInstalled()) markPwaSaved()
  rememberInstalledPwa()
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
