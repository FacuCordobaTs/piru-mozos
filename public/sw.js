const CACHE = 'piru-mozos-v3'
const APP_SHELL = ['/', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await Promise.all(APP_SHELL.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' })
      if (response.ok) await cache.put(url, response)
    }))
  }))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('piru-mozos-') && key !== CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]))
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  // Las navegaciones siempre consultan la red para descubrir el HTML del último
  // deploy. El shell cacheado queda únicamente como respaldo offline.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/manifest.webmanifest') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: 'no-store' })
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(event.request.mode === 'navigate' ? '/' : event.request, response.clone())
        }
        return response
      } catch {
        return (await caches.match(event.request)) || (await caches.match('/')) || Response.error()
      }
    })())
    return
  }

  // Los assets de Vite llevan hash en el nombre: pueden conservarse sin impedir
  // actualizaciones, porque cada build publica URLs nuevas.
  event.respondWith((async () => {
    const cached = await caches.match(event.request)
    if (cached) return cached
    const response = await fetch(event.request)
    if (response.ok) {
      const cache = await caches.open(CACHE)
      await cache.put(event.request, response.clone())
    }
    return response
  })())
})
