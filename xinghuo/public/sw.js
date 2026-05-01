/* 最小可安装 PWA：满足 Chromium「含 fetch 的 Service Worker」要求，请求仍走网络 */
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
