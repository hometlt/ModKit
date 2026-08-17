/**
 * Bundle the VS Code extension into `dist-app/`.
 *
 *   node scripts/build-extension.mjs
 *
 * Two bundles with different rules:
 *   - `extension.cjs` runs in the extension host. VS Code loads extension entry points as
 *     CommonJS, and `vscode` is provided by the runtime, so it must stay external.
 *   - `webview.js` runs in the bridge realm. It is an ES module with no host access at all.
 *
 * The static `contributes` block is merged into the manifest from the generated catalog, which is
 * the deterministic artifact `contributes:check` guards. Nothing here authors contribution points.
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const dist = join(appRoot, 'dist-app')

mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [join(appRoot, 'src', 'extension.ts')],
  outfile: join(dist, 'extension.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node20'],
  // Supplied by the VS Code runtime; bundling it would shadow the real API.
  external: ['vscode'],
  absWorkingDir: repoRoot,
  logLevel: 'warning',
})

await build({
  entryPoints: [join(appRoot, 'src', 'webview.ts')],
  outfile: join(dist, 'webview.js'),
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

// ---------------------------------------------------------------- manifest
const manifestPath = join(appRoot, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const contributes = JSON.parse(readFileSync(join(appRoot, 'contributes.generated.json'), 'utf8'))

const previous = JSON.stringify(manifest.contributes ?? null)
manifest.contributes = contributes
// Every command in the generated catalog is an activation point; VS Code 1.75+ infers these, but
// declaring them keeps the extension loadable on older hosts too.
manifest.activationEvents = contributes.commands.map(command => `onCommand:${command.command}`)

if (JSON.stringify(manifest.contributes) !== previous) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log('manifest contributes synced from contributes.generated.json')
}

console.log(`built ${dist}`)
