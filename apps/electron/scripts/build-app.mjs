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
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  appThemeStylesheets,
  renderAppThemeDomData,
  resolveAppThemes,
} from '../../../scripts/lib/app-themes.mjs'
import {
  offlineReleaseSource,
  verifyOfflineReleaseDirectory,
} from '../../vscode/scripts/offline-release.mjs'
import { syncElectronFormatSmoke } from './sync-format-smoke.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const typescriptCli = require.resolve('typescript/bin/tsc')
const bundledExtensionDirectories = require('../generated/bundled-catalog.cjs')
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const outIndex = process.argv.indexOf('--out')
const requestedOut = outIndex === -1 ? undefined : process.argv[outIndex + 1]
if (outIndex !== -1 && (requestedOut === undefined || requestedOut.startsWith('--'))) {
  throw new TypeError('--out needs a directory')
}
const dist = requestedOut === undefined ? join(appRoot, 'dist-app') : resolve(requestedOut)
const appThemes = resolveAppThemes({ repositoryRoot: repoRoot })
const themeStylesheets = appThemeStylesheets(appThemes)
const packageResolveContexts = [
  join(appRoot, 'package.json'),
  ...bundledExtensionDirectories.map(directory =>
    join(repoRoot, 'extensions', directory, 'package.json'),
  ),
  ...readdirSync(join(repoRoot, 'packages'))
    .map(directory => join(repoRoot, 'packages', directory, 'package.json'))
    .filter(existsSync),
]
const runtimePackageSeeds = Object.freeze([
  '@modkit/code',
  '@modkit/codec-kit',
  '@modkit/core',
  '@modkit/extension-manager',
  '@modkit/host',
  '@modkit/scene',
  '@modkit/sdk',
  '@modkit/ui',
  '@modkit/uv',
  '@modkit/vfs',
  '@rgrove/parse-xml',
  'ajv',
  'es-module-lexer',
  'jsonc-parser',
  'monaco-editor',
  'smol-toml',
  'three',
  'yaml',
])

function assertRelativePackagePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.split(/[\\/]/u).includes('..')
  ) {
    throw new TypeError(`${label} must be a relative package path`)
  }
}

function assertNoLinks(target, label) {
  const stats = lstatSync(target)
  if (stats.isSymbolicLink()) {
    throw new Error(`${label} contains a filesystem link: ${target}`)
  }
  if (!stats.isDirectory()) return
  for (const entry of readdirSync(target)) {
    assertNoLinks(join(target, entry), label)
  }
}

function copyBundledExtensionRoot(directory, bundledExtensionRoot) {
  assertRelativePackagePath(directory, 'bundled extension directory')
  const source = join(repoRoot, 'extensions', directory)
  if (!existsSync(source)) {
    console.error(`missing bundled Electron extension root: extensions/${directory}`)
    process.exit(1)
  }
  const packageJsonPath = join(source, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const files = packageJson.files
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError(`extensions/${directory}/package.json must declare package files`)
  }
  const target = join(bundledExtensionRoot, directory)
  mkdirSync(target, { recursive: true })
  cpSync(packageJsonPath, join(target, 'package.json'))
  for (const file of files) {
    assertRelativePackagePath(file, `extensions/${directory} package file`)
    const fileSource = join(source, file)
    if (!existsSync(fileSource)) {
      throw new Error(`extensions/${directory}/package.json names missing file ${file}`)
    }
    cpSync(fileSource, join(target, file), { recursive: true })
  }
  assertNoLinks(target, `extensions/${directory}`)
}

function packageTarget(root, name) {
  const parts = name.startsWith('@') ? name.split('/') : [name]
  return join(root, ...parts)
}

function packageFileEntries(packageJson, packageRoot) {
  const declaredFiles =
    typeof packageJson.files === 'string'
      ? [packageJson.files]
      : Array.isArray(packageJson.files)
        ? packageJson.files
        : undefined
  if (declaredFiles !== undefined && declaredFiles.length > 0) return declaredFiles
  return readdirSync(packageRoot).filter(
    entry => !['node_modules', '.git', '.pnpm', '.turbo', 'coverage'].includes(entry),
  )
}

function normalizePackageFileEntry(value, label) {
  const text = String(value).replace(/\/+$/u, '')
  assertRelativePackagePath(text, label)
  return text
}

function resolvePackageRoot(name, issuer) {
  const contexts =
    issuer === undefined ? packageResolveContexts : [issuer, ...packageResolveContexts]
  for (const context of contexts) {
    const fromContext = createRequire(context)
    try {
      return dirname(fromContext.resolve(`${name}/package.json`))
    } catch {
      try {
        // Some packages do not export package.json. Resolve their default entry, then climb to the
        // matching package manifest.
        let current = dirname(fromContext.resolve(name))
        for (;;) {
          const manifest = join(current, 'package.json')
          if (existsSync(manifest)) {
            const packageJson = JSON.parse(readFileSync(manifest, 'utf8'))
            if (packageJson.name === name) return current
          }
          const parent = dirname(current)
          if (parent === current) break
          current = parent
        }
      } catch {
        // Try the next package context.
      }
    }
  }
  throw new Error(`unable to resolve runtime dependency ${name}`)
}

function copyPackageClosure(targetNodeModules) {
  const queue = runtimePackageSeeds.map(name => ({ name }))
  const copied = new Set()
  mkdirSync(targetNodeModules, { recursive: true })
  for (let index = 0; index < queue.length; index += 1) {
    const { name, issuer } = queue[index]
    if (copied.has(name)) continue
    copied.add(name)
    const source = resolvePackageRoot(name, issuer)
    const target = packageTarget(targetNodeModules, name)
    const packageJsonPath = join(source, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    if (packageJson.name !== name) {
      throw new Error(`resolved ${name} to package ${String(packageJson.name)}`)
    }
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(packageJsonPath, join(target, 'package.json'))
    const packageEntries = packageFileEntries(packageJson, source)
    const excluded = packageEntries
      .filter(file => typeof file === 'string' && file.startsWith('!'))
      .map(file => normalizePackageFileEntry(file.slice(1), `${name} package file exclusion`))
    for (const rawFile of packageEntries) {
      if (typeof rawFile === 'string' && rawFile.startsWith('!')) continue
      const file = normalizePackageFileEntry(rawFile, `${name} package file`)
      const fileSource = join(source, file)
      if (!existsSync(fileSource)) {
        throw new Error(`${name}/package.json names missing file ${file}`)
      }
      cpSync(fileSource, join(target, file), { recursive: true })
    }
    for (const file of excluded) {
      rmSync(join(target, file), { recursive: true, force: true })
    }
    for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
      if (!copied.has(dependency)) queue.push({ name: dependency, issuer: packageJsonPath })
    }
    assertNoLinks(target, name)
  }
  assertNoLinks(targetNodeModules, 'dist-app/node_modules')
}

// `dist-app/main-runtime` is production code loaded by Electron main.  Building only the renderer
// and copying whatever happened to be left in `apps/electron/dist` made a clean checkout fail (and
// made incremental builds silently ship stale main-runtime code).  Compile the package as part of
// the one official app build before staging any output.
execFileSync(process.execPath, [typescriptCli, '--project', join(appRoot, 'tsconfig.json')], {
  cwd: repoRoot,
  stdio: 'inherit',
})

rmSync(dist, { recursive: true, force: true })
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
const monacoRoot = resolve(repoRoot, 'packages/code/node_modules/monaco-editor/esm/vs')
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
    'missing packages/ui/styles/modkit-ui.css — run pnpm --filter @modkit/ui tokens:emit',
  )
  process.exit(1)
}
cpSync(stylesheet, join(dist, 'modkit-ui.css'))
// Themes are validated static inputs from the core manifest and optional
// MODKIT_APP_THEME_ROOTS manifests. The renderer only sees build-generated DOM data.
for (const theme of themeStylesheets) {
  cpSync(theme.sourcePath, join(dist, theme.stylesheet.slice('./'.length)))
}
cpSync(join(repoRoot, 'assets', 'fonts'), join(dist, 'fonts'), { recursive: true })
const bundledExtensionRoot = join(dist, 'extensions')
mkdirSync(bundledExtensionRoot, { recursive: true })
for (const directory of bundledExtensionDirectories) {
  copyBundledExtensionRoot(directory, bundledExtensionRoot)
}
mkdirSync(join(dist, 'main-runtime'), { recursive: true })
cpSync(join(appRoot, 'dist'), join(dist, 'main-runtime', 'dist'), { recursive: true })
copyPackageClosure(join(dist, 'node_modules'))
syncElectronFormatSmoke({ repoRoot, appRoot })
cpSync(join(appRoot, 'generated', 'format-smoke.v1.json'), join(dist, 'format-smoke.v1.json'))
verifyOfflineReleaseDirectory(offlineReleaseSource)
cpSync(offlineReleaseSource, join(dist, 'managed-packages'), { recursive: true })
verifyOfflineReleaseDirectory(join(dist, 'managed-packages'))
const themeLinks = themeStylesheets
  .map(theme => `    <link rel="stylesheet" href="${theme.stylesheet}" />`)
  .join('\n')

/*
 * The renderer runs from file://, so its CSP is declared in the document itself.
 *
 * `media-src 'self' blob:` and `blob:` in `img-src` are the two allowances `VIEWER_CSP` in
 * `packages/ui` already carries and this page was missing: the audio and video stages hand the
 * codec-owned encoded representation to the platform player as a blob, and the vector stage renders
 * the sanitised SVG document through an `<img>` blob URL. Without them `default-src 'none'` refuses
 * both and the stages mount into a permanently failed state. Nothing else is relaxed: no remote
 * origin, no `data:` media, no `connect-src`.
 */
writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en" data-mk-theme="modkit-dark" data-mk-density="compact">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; worker-src 'self' blob:;"
    />
    <title>Modkit MK3</title>
    <link rel="stylesheet" href="./modkit-ui.css" />
    <!-- Monaco CSS, extracted by esbuild so it loads from self rather than being injected. -->
    <link rel="stylesheet" href="./renderer.css" />
${themeLinks}
${renderAppThemeDomData(appThemes)}
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
