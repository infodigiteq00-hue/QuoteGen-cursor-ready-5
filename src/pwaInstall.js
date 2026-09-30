const OPEN_EVENT = 'qg-pwa-open'
const INSTALLED_EVENT = 'qg-pwa-installed'

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

export function openPwaInstall() {
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
    window.dispatchEvent(new Event(INSTALLED_EVENT))
  })
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
