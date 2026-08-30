#!/usr/bin/env node

/**
 * Build and serve the real PWA for an interactive debug session.
 *
 * The old launcher rendered a composition inventory into a small diagnostic workbench. That was
 * useful for inspecting realms, but it was not the PWA: it had no explorer, file picker, viewers
 * or editing path. A VS Code launch named `PWA (Chrome)` must open the product shell users test.
 */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const dist = join(root, 'apps', 'web', 'dist-app')

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

const setName = option('set', process.env['MODKIT_EXTENSION_SET'] ?? 'full-codecs')
const portText = option('port', process.env['MODKIT_PWA_PORT'] ?? '4173')
const port = Number(portText)
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`invalid PWA debug port: ${portText}`)
}

console.log(`debug-pwa: starting product build (requested set ${setName})`)
execFileSync(process.execPath, [join(root, 'apps', 'web', 'scripts', 'build.mjs')], {
  cwd: root,
  stdio: 'inherit',
})

const types = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
})

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
  const target = normalize(join(dist, relative))
  if ((!target.startsWith(dist + sep) && target !== dist) || !existsSync(target)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
    return
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': types[extname(target)] ?? 'application/octet-stream',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    ...(relative === '/service-worker.js' ? { 'service-worker-allowed': '/' } : {}),
    'x-content-type-options': 'nosniff',
  })
  response.end(readFileSync(target))
})

server.on('error', error => {
  console.error(`debug-pwa: ${error.message}`)
  process.exitCode = 1
})
server.listen(port, '127.0.0.1', () => {
  console.log(
    `debug-pwa: ready http://127.0.0.1:${port}/ requested-set=${setName} catalog=build-time`,
  )
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)))
}
