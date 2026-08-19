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
import { cpSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const dist = join(appRoot, 'dist-app')

mkdirSync(dist, { recursive: true })

const rendererBuild = await build({
  entryPoints: [join(appRoot, 'src', 'renderer.ts')],
  outfile: join(dist, 'renderer.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  absWorkingDir: repoRoot,
  // Monaco ships an icon font and stylesheets. The CSS is extracted to a sibling file the page
  // links, which is what lets the editor render under `style-src 'self'` instead of injecting.
  loader: { '.ttf': 'dataurl', '.css': 'css' },
  metafile: true,
  logLevel: 'warning',
})

const codecInputs = Object.keys(rendererBuild.metafile.inputs).filter(input =>
  /(?:^|\/)extensions\/.*\/src\/(?:codecs|families|formats)\//u.test(input.replaceAll('\\', '/')),
)
if (codecInputs.length > 0) {
  console.error(
    `Electron renderer imports codec implementation modules:\n${codecInputs
      .toSorted()
      .map(input => `  ${input}`)
      .join('\n')}`,
  )
  process.exit(1)
}

// Monaco runs its language services in workers and asks the host for them through
// `MonacoEnvironment`. Bundled separately because a worker is its own entry point.
const monacoRoot = resolve(
  repoRoot,
  'extensions/common/ui-monaco/node_modules/monaco-editor/esm/vs',
)
const workerEntries = {
  'editor.worker': join(monacoRoot, 'editor', 'editor.worker.js'),
  'json.worker': join(monacoRoot, 'language', 'json', 'json.worker.js'),
}
for (const [name, path] of Object.entries(workerEntries)) {
  if (!existsSync(path)) {
    console.error(`missing Monaco worker entry for ${name}: ${path}`)
    process.exit(1)
  }
}
await build({
  entryPoints: workerEntries,
  outdir: dist,
  bundle: true,
  format: 'iife',
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
// Installable themes ship as plain stylesheets: token overrides under their own
// `[data-mk-theme]` selector, no component code. Every theme under assets/themes is copied beside
// the app as theme-<id>.css and linked; a theme only applies once its id is stamped on <html>.
// Self-hosted fonts (assets/fonts, OFL) travel with them: theme @font-face rules point at ./fonts/.
const themesRoot = join(repoRoot, 'assets', 'themes')
const themeIds = readdirSync(themesRoot)
  .filter(id => existsSync(join(themesRoot, id, 'theme.css')))
  .sort()
for (const id of themeIds) cpSync(join(themesRoot, id, 'theme.css'), join(dist, `theme-${id}.css`))
cpSync(join(repoRoot, 'assets', 'fonts'), join(dist, 'fonts'), { recursive: true })
const themeLinks = themeIds
  .map(id => `    <link rel="stylesheet" href="./theme-${id}.css" />`)
  .join('\n')

// The renderer runs from file://, so its CSP is declared in the document itself.
writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en" data-mk-theme="modkit-dark" data-mk-density="compact">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:;"
    />
    <title>Modkit MK3</title>
    <link rel="stylesheet" href="./modkit-ui.css" />
    <!-- Monaco CSS, extracted by esbuild so it loads from self rather than being injected. -->
    <link rel="stylesheet" href="./renderer.css" />
${themeLinks}
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
      /* Shell: body fills, footer is a fixed strip — the VS Code status bar arrangement. */
      .modkit-shell {
        display: flex;
        height: 100%;
        flex-direction: column;
        min-height: 0;
      }
      .modkit-body {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
      }
      .modkit-body > * {
        flex: 1 1 auto;
        min-width: 0;
      }
      .modkit-footer {
        display: flex;
        flex: 0 0 auto;
        gap: 12px;
        align-items: center;
        padding: 2px 12px;
        border-top: 1px solid var(--mk-color-border);
        background: var(--mk-color-raised);
        font-size: var(--mk-font-size-xs);
      }
      .modkit-footer .muted {
        color: var(--mk-color-fg-muted);
      }
      .modkit-footer.bad {
        color: var(--mk-status-error);
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
