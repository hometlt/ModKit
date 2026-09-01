/*
 * Offline shell for the PWA.
 *
 * Two tiers, because the build emits two kinds of name. The app shell has stable names, so it is
 * precached at install and the app starts with no network at all. Everything else the app serves —
 * hashed code-split chunks, the attested extension artifacts the module worker fetches and verifies,
 * theme stylesheets, fonts — is cached the first time it is used, which is what makes a format the
 * user has already opened openable again offline.
 *
 * The extension manager owns separate content-addressed package and signed-catalog caches. Shell
 * upgrades preserve those caches; the browser worker still re-verifies package/file digests before
 * any cached extension becomes evaluable.
 */
const SHELL_CACHE_PREFIX = 'modkit-mk3-shell-'
const CACHE = `${SHELL_CACHE_PREFIX}v3`

/** Names the build always emits; a miss here is a broken build, so `addAll` may fail loudly. */
const SHELL = [
  './',
  './index.html',
  './main.js',
  // the embed entry is a stable build output too; a page that embedded a viewer once works offline
  './embed.js',
  './app.css',
  './modkit-ui.css',
  './manifest.webmanifest',
  './format-smoke.v1.json',
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
  // MODKIT_APP_THEME_CACHE
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
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith(SHELL_CACHE_PREFIX) && key !== CACHE)
            .map(key => caches.delete(key)),
        ),
      )
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
