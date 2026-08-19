/*
 * Offline shell for the PWA.
 *
 * Two tiers, because the build emits two kinds of name. The app shell has stable names, so it is
 * precached at install and the app starts with no network at all. Everything else the app serves —
 * hashed code-split chunks, the attested extension artifacts the module worker fetches and verifies,
 * theme stylesheets, fonts — is cached the first time it is used, which is what makes a format the
 * user has already opened openable again offline.
 *
 * Extension artifacts are cached like any other same-origin GET, and that is safe: the browser
 * worker backend re-verifies every file's bytes against the catalog's digests before it becomes
 * evaluable, so a cached copy is trusted no further than a freshly fetched one.
 */
const CACHE = 'modkit-mk3-shell-v2'

/** Names the build always emits; a miss here is a broken build, so `addAll` may fail loudly. */
const SHELL = [
  './',
  './index.html',
  './main.js',
  './app.css',
  './modkit-ui.css',
  './manifest.webmanifest',
  './worker-entry.js',
  './vendor/core/index.js',
  './vendor/sdk/index.js',
  './vendor/codec-kit/index.js',
  './vendor/codec-kit/text/index.js',
  './favicon-32.png',
  './icon-192.png',
  './icon-512.png',
]

/**
 * Names that depend on what is installed beside the app: a theme directory, a font subset, a
 * sample. Added one by one so a theme that was not built cannot fail the whole installation.
 */
const OPTIONAL = [
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './theme-sc2.css',
  './theme-nexus-forge.css',
  './theme-nexus-dominion.css',
  './fonts/saira/saira-latin.woff2',
  './fonts/saira/saira-latin-ext.woff2',
  './fonts/jetbrains-mono/jetbrains-mono-latin.woff2',
  './fonts/jetbrains-mono/jetbrains-mono-latin-ext.woff2',
  './samples/sample.csv',
  './samples/sample.ini',
  './samples/sample.md',
  './samples/sample.svg',
  './samples/sample.zip',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      await cache.addAll(SHELL)
      await Promise.allSettled(OPTIONAL.map(path => cache.add(path)))
      await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin)
    return
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached !== undefined) return cached
      return fetch(event.request).then(response => {
        // Only a complete same-origin answer is worth keeping; an error page is not a cache entry.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)))
        }
        return response
      })
    }),
  )
})
