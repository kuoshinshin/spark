/* PWA + 弱网：静态资源缓存，API 仍走网络 */
const CACHE_STATIC = 'spark-static-v1'

const isStaticAsset = (url) => {
  const path = url.pathname
  return (
    path.startsWith('/assets/')
    || /\.(?:js|css|png|jpg|jpeg|gif|webp|svg|woff2?|ico)$/i.test(path)
  )
}

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_STATIC).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) {
          cache.put(request, response.clone())
        }
        return response
      })
    )
    return
  }

  event.respondWith(fetch(request))
})
