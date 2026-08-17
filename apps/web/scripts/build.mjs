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
/*
 * Icons are generated from the brand SVG by `scripts/generate-icons.mjs` and live in `public/`, so
 * they are already copied above. Only the manifest needs assembling: the shipped file declares no
 * icons, and a manifest without a 192 and a 512 entry is not installable.
 *
 * Both purposes are declared. `any` is used wherever the icon is shown as-is; `maskable` is the
 * padded variant Android crops to its launcher shape, and offering only `any` there gets the mark
 * clipped.
 */
const manifest = JSON.parse(readFileSync(join(appRoot, 'public', 'manifest.webmanifest'), 'utf8'))
manifest.icons = [
  { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: './icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: './icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

for (const icon of manifest.icons) {
  const file = join(dist, icon.src.replace('./', ''))
  if (!existsSync(file)) {
    console.error(`missing ${icon.src} — run pnpm icons:emit`)
    process.exit(1)
  }
}

writeFileSync(
  join(dist, 'manifest.webmanifest'),
  `${JSON.stringify(manifest, null, 2)}
`,
)

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
