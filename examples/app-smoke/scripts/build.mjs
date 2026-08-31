/**
 * Build the application smoke page, then optionally serve it.
 *
 *   node scripts/build.mjs           build
 *   node scripts/build.mjs --serve   build and serve on 8731
 *
 * Served under the same strict `VIEWER_CSP` the untrusted viewers get: this page embeds no editor,
 * so there is nothing here that justifies the trusted-editor relaxation.
 */
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { cpSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const dist = join(appRoot, 'dist')

mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [join(appRoot, 'src', 'main.ts')],
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
    'missing packages/ui/styles/modkit-ui.css — run pnpm --filter @modkit/ui tokens:emit',
  )
  process.exit(1)
}
cpSync(stylesheet, join(dist, 'modkit-ui.css'))
cpSync(join(appRoot, 'smoke.css'), join(dist, 'smoke.css'))

const { VIEWER_CSP_TEXT } = await import('@modkit/ui/viewer')
writeFileSync(
  join(dist, 'index.html'),
  readFileSync(join(appRoot, 'index.html'), 'utf8').replace(
    '<html ',
    `<html data-mk-csp="${VIEWER_CSP_TEXT.replaceAll('"', '&quot;')}" `,
  ),
)
console.log(`built ${dist}`)

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
  const port = 8731
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
      'Content-Security-Policy': VIEWER_CSP_TEXT,
    })
    response.end(readFileSync(file))
  }).listen(port, () => console.log(`serving http://localhost:${port}`))
}

/*
 * Single-file build. The Browser pane only composites when it is displayed, so a screenshot is not
 * always available; an inlined page can be opened or rendered anywhere and still boots the real
 * composition root rather than showing a picture of one.
 */
if (process.argv.includes('--inline')) {
  const html = readFileSync(join(appRoot, 'index.html'), 'utf8')
    .replace(
      '<link rel="stylesheet" href="./modkit-ui.css" />',
      () => `<style>${readFileSync(stylesheet, 'utf8')}</style>`,
    )
    .replace(
      '<link rel="stylesheet" href="./smoke.css" />',
      () => `<style>${readFileSync(join(appRoot, 'smoke.css'), 'utf8')}</style>`,
    )
    .replace(
      '<script type="module" src="./main.js"></script>',
      () => `<script type="module">${readFileSync(join(dist, 'main.js'), 'utf8')}</script>`,
    )
  const out = join(dist, 'app-smoke.inline.html')
  writeFileSync(out, html)
  console.log(`inlined ${out} (${(html.length / 1024).toFixed(0)} KiB)`)
}
