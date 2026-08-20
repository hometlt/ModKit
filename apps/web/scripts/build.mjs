/**
 * Build the PWA into `dist-app/`, then optionally serve it.
 *
 *   node scripts/build.mjs                     build
 *   node scripts/build.mjs --serve             build and serve on 8732
 *   node scripts/build.mjs --serve --port 8744 build and serve on another port
 *   node scripts/build.mjs --out <dir>         build somewhere else than dist-app/
 *
 * Output goes to `dist-app/`, not `dist/`: `dist/` is the package's compiled library surface that
 * other roots import, and overwriting it with a bundle would break them.
 *
 * `--out` exists so a test can build the real thing into a scratch directory and serve it, without
 * touching the committed `dist-app` (which is rebuilt and committed deliberately, not as a side
 * effect of running the suite). Everything else about the build is identical.
 */
import { build } from 'esbuild'
import { createServer } from 'node:http'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const outIndex = process.argv.indexOf('--out')
const requestedOut = outIndex === -1 ? undefined : process.argv[outIndex + 1]
if (outIndex !== -1 && (requestedOut === undefined || requestedOut.startsWith('--'))) {
  console.error('--out needs a directory')
  process.exit(1)
}
const dist = requestedOut === undefined ? join(appRoot, 'dist-app') : resolve(requestedOut)

// A clean output every time: hashed chunks and copied artifacts of a previous build must not
// linger next to the current ones (a stale chunk is unreachable but still served).
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

/*
 * Two page entries in one graph. `main.js` is the PWA shell; `embed.js` is the custom-element
 * entry a third-party page loads with a single script tag (`src/embed.ts`). They are built
 * together, with splitting on, so everything both of them use — the ui viewers, the host, the
 * generated catalog — lands in a shared chunk and an embedding page that also happens to open the
 * app downloads it once. Splitting is what makes them one deployment rather than two bundles that
 * merely sit in the same folder.
 */
await build({
  entryPoints: {
    main: join(appRoot, 'src', 'shell.ts'),
    embed: join(appRoot, 'src', 'embed.ts'),
  },
  outdir: dist,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120', 'firefox121', 'safari17'],
  chunkNames: 'chunks/[name]-[hash]',
  absWorkingDir: repoRoot,
  logLevel: 'warning',
})

// ---------------------------------------------------------------- worker runtime (S6)
/*
 * The extension worker runtime: the host's browser worker entry plus the vendor modules a codec
 * may import inside the worker (`WEB_WORKER_MODULE_MAP` in src/subjects.ts). One esbuild graph
 * with code splitting, so `@modkitx-x3/core` and `@modkitx-x3/sdk` are a single instance shared
 * by the entry and every vendor (an `instanceof ModkitError` in the worker sees one class). Bare
 * dependencies of extensions outside this map are not served — the catalog emitter lists such
 * extensions as excluded with the reason instead of shipping them broken.
 */
await build({
  entryPoints: {
    'worker-entry': join(repoRoot, 'packages', 'host', 'dist', 'browser', 'worker-entry.js'),
    'vendor/codec-kit/index': join(
      repoRoot,
      'extensions',
      '_shared',
      'codec-kit',
      'src',
      'index.js',
    ),
    'vendor/codec-kit/text/index': join(
      repoRoot,
      'extensions',
      '_shared',
      'codec-kit',
      'src',
      'text',
      'index.js',
    ),
    'vendor/core/index': join(repoRoot, 'packages', 'core', 'dist', 'index.js'),
    'vendor/sdk/index': join(repoRoot, 'packages', 'sdk', 'dist', 'index.js'),
  },
  outdir: dist,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120', 'firefox121', 'safari17'],
  chunkNames: 'chunks/[name]-[hash]',
  absWorkingDir: repoRoot,
  logLevel: 'warning',
})

/*
 * The bundled extensions the catalog attests, served byte for byte under `extensions/<name>/`:
 * exactly the inventoried files (the catalog's `files`), copied from the source tree. The
 * per-file digests in the catalog are what the worker backend verifies against at load, so a
 * file that is not in the catalog is not served here either.
 */
const { WEB_EXTENSION_CATALOG } = await import(
  pathToFileURL(join(appRoot, 'generated', 'extension-catalog.js')).href
)
for (const entry of WEB_EXTENSION_CATALOG.extensions) {
  const sourceRoot = join(repoRoot, entry.source)
  const targetRoot = join(dist, entry.artifactRoot)
  for (const file of entry.files) {
    const target = join(targetRoot, file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(sourceRoot, file), target)
  }
}

const stylesheet = join(repoRoot, 'packages', 'ui', 'styles', 'modkit-ui.css')
if (!existsSync(stylesheet)) {
  console.error(
    'missing packages/ui/styles/modkit-ui.css — run pnpm --filter @modkitx-x3/ui tokens:emit',
  )
  process.exit(1)
}
cpSync(stylesheet, join(dist, 'modkit-ui.css'))
// Installable themes (assets/themes/<id>/theme.css) and the self-hosted fonts they reference ship
// beside the app; the page links every theme and applies one by stamping data-mk-theme.
const themesRoot = join(repoRoot, 'assets', 'themes')
const themeIds = readdirSync(themesRoot)
  .filter(id => existsSync(join(themesRoot, id, 'theme.css')))
  .sort()
for (const id of themeIds) cpSync(join(themesRoot, id, 'theme.css'), join(dist, `theme-${id}.css`))
cpSync(join(repoRoot, 'assets', 'fonts'), join(dist, 'fonts'), { recursive: true })
const indexHtml = readFileSync(join(appRoot, 'index.html'), 'utf8').replace(
  '<link rel="stylesheet" href="./app.css" />',
  `<link rel="stylesheet" href="./app.css" />
${themeIds.map(id => `    <link rel="stylesheet" href="./theme-${id}.css" />`).join('\n')}`,
)
writeFileSync(join(dist, 'index.html'), indexHtml)
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
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.mjs': 'text/javascript',
    '.svg': 'image/svg+xml',
    '.csv': 'text/csv',
    '.ini': 'text/plain',
    '.txt': 'text/plain',
    '.woff2': 'font/woff2',
  }
  // `--port <n>`: two checkouts of this lab can be served side by side without fighting over 8732.
  const portIndex = process.argv.indexOf('--port')
  const requested = portIndex === -1 ? undefined : Number(process.argv[portIndex + 1])
  if (
    requested !== undefined &&
    (!Number.isSafeInteger(requested) || requested < 1 || requested > 65_535)
  ) {
    console.error(`invalid --port ${process.argv[portIndex + 1]}`)
    process.exit(1)
  }
  const port = requested ?? 8732
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
