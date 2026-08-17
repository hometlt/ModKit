/**
 * Bundle the Electron renderer into `dist-app/`.
 *
 *   node scripts/build-app.mjs
 *
 * Main and preload are plain CommonJS in `electron/` and are not bundled: they are small, they must
 * stay readable during a security review, and bundling them would obscure exactly the code that
 * decides what the renderer is allowed to do.
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const dist = join(appRoot, 'dist-app')

mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [join(appRoot, 'src', 'renderer.ts')],
  outfile: join(dist, 'renderer.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
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

// The renderer runs from file://, so its CSP is declared in the document itself.
writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en" data-mk-theme="modkit-dark" data-mk-density="compact">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:;"
    />
    <title>Modkit MK3</title>
    <link rel="stylesheet" href="./modkit-ui.css" />
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
      }
      body {
        color: var(--mk-color-fg);
        background: var(--mk-color-bg);
        font-family: var(--mk-font-sans);
      }
      #root {
        height: 100vh;
        overflow: hidden;
      }
      .report {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px;
        font-size: var(--mk-font-size-sm);
      }
      .report p {
        margin: 0;
      }
      .ok {
        color: var(--mk-status-ok);
      }
      .bad {
        color: var(--mk-status-error);
        font-weight: var(--mk-font-weight-medium);
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./renderer.js"></script>
  </body>
</html>
`,
)

console.log(`built ${dist}`)
