const CACHE = 'piru-mozos-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  // El app shell y el menú ya vistos siguen disponibles sin red. Las mutaciones
  // no se interceptan: un pedido sólo queda confirmado si el backend responde.
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (new URL(event.request.url).origin === self.location.origin && response.ok) {
      const copy = response.clone()
      void caches.open(CACHE).then((cache) => cache.put(event.request, copy))
    }
    return response
  })))
})
