/* QuoteGen PWA — keeps the home-screen shortcut installable. API traffic is never cached. */
const CACHE = 'qg-pwa-v1'
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icons/pwa-192.png', '/icons/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(PRECACHE)
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api')) return

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req)
      if (fresh.ok && req.mode === 'navigate') {
        const cache = await caches.open(CACHE)
        cache.put('/index.html', fresh.clone())
      }
      return fresh
    } catch {
      if (req.mode === 'navigate') {
        const shell = await caches.match('/index.html')
        if (shell) return shell
      }
      const cached = await caches.match(req)
      if (cached) return cached
      throw new Error('offline')
    }
  })())
})
