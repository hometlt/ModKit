/**
 * Build the PWA into `dist-app/`, then optionally serve it.
 *
 *   node scripts/build.mjs           build
 *   node scripts/build.mjs --serve   build and serve on 8732
 *
 * Output goes to `dist-app/`, not `dist/`: `dist/` is the package's compiled library surface that
 * other roots import, and overwriting it with a bundle would break them.
 */
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { deflateSync } from 'node:zlib'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const dist = join(appRoot, 'dist-app')

mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [join(appRoot, 'src', 'shell.ts')],
  outfile: join(dist, 'main.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120', 'firefox121', 'safari17'],
  absWorkingDir: repoRoot,
  logLevel: 'warning',
})

const stylesheet = join(repoRoot, 'packages', 'ui', 'styles', 'modkit-ui.css')
if (!existsSync(stylesheet)) {
  console.error(
    'missing packages/ui/styles/modkit-ui.css — run pnpm --filter @modkitx-x3/ui tokens:emit',
  )
  process.exit(1)
}
cpSync(stylesheet, join(dist, 'modkit-ui.css'))
cpSync(join(appRoot, 'index.html'), join(dist, 'index.html'))
cpSync(join(appRoot, 'app.css'), join(dist, 'app.css'))
cpSync(join(appRoot, 'public'), dist, { recursive: true })

// ---------------------------------------------------------------- icons
/**
 * Minimal PNG writer. A manifest with an empty `icons` array is valid JSON but not installable —
 * Chromium requires a 192px and a 512px icon before it will offer "Install". Generating them keeps
 * that requirement satisfied without adding an image dependency or committing binaries.
 */
function png(size, rgb) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < size; x += 1) {
      const offset = row + 1 + x * 4
      // A rounded-square badge: the brand colour inside, transparent outside.
      const half = size / 2
      const inset = size * 0.12
      const inside = Math.abs(x - half) < half - inset && Math.abs(y - half) < half - inset
      raw[offset] = rgb[0]
      raw[offset + 1] = rgb[1]
      raw[offset + 2] = rgb[2]
      raw[offset + 3] = inside ? 255 : 0
    }
  }

  const chunk = (type, body) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(body.length)
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typed) >>> 0)
    return Buffer.concat([length, typed, crc])
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return crc ^ 0xffffffff
}

const BRAND = [0, 120, 212]
for (const size of [192, 512]) {
  writeFileSync(join(dist, `icon-${size}.png`), png(size, BRAND))
}

// The shipped manifest declares no icons; the built one must, or the app is not installable.
const manifest = JSON.parse(readFileSync(join(appRoot, 'public', 'manifest.webmanifest'), 'utf8'))
manifest.icons = [192, 512].map(size => ({
  src: `./icon-${size}.png`,
  sizes: `${size}x${size}`,
  type: 'image/png',
  purpose: 'any',
}))
writeFileSync(join(dist, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(`built ${dist}`)

// ---------------------------------------------------------------- server
if (process.argv.includes('--serve')) {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
  }
  const port = 8732
  createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${port}`)
    const name = url.pathname === '/' ? '/index.html' : url.pathname
    const file = join(dist, name)
    if (!file.startsWith(dist) || !existsSync(file)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      // A service worker may only claim a scope at or below its own path.
      ...(name === '/service-worker.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    })
    response.end(readFileSync(file))
  }).listen(port, () => console.log(`serving http://localhost:${port}`))
}
