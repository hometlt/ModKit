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
  /*
   * No rewrite of `import.meta.url` here any more. The extension names the bootstrap it shipped
   * through `bootstrapUrl`, which the Node factories now thread through — a host saying where its
   * own file is, rather than a build making one expression mean something other than it says.
   */
  absWorkingDir: repoRoot,
  logLevel: 'warning',
})

const bootstrapEntry = join(repoRoot, 'packages', 'host', 'dist', 'node', 'worker-bootstrap.js')
if (!existsSync(bootstrapEntry)) {
  console.error(`missing ${bootstrapEntry} — run pnpm build (tsc -b) before bundling the extension`)
  process.exit(1)
}
// Its own self-contained ES module: a worker thread is its own entry point, and the bootstrap
// verifies artifact bytes against the inventory's digests, so it must not be reached through a
// bundle that could have rewritten it.
await build({
  entryPoints: [bootstrapEntry],
  outfile: join(dist, 'worker-bootstrap.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
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

// Shell chrome only: the shipped stylesheet has no layout for the `workbench` parts on purpose, so
// the host places them. Everything else the page draws comes from `modkit-ui.css`.
cpSync(join(appRoot, 'app.css'), join(dist, 'app.css'))

// ---------------------------------------------------------------- manifest
const manifestPath = join(appRoot, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const contributes = JSON.parse(readFileSync(join(appRoot, 'contributes.generated.json'), 'utf8'))

const previous = JSON.stringify([manifest.contributes ?? null, manifest.activationEvents ?? null])
manifest.contributes = contributes
// Every command and every custom editor in the generated catalog is an activation point; VS Code
// 1.75+ infers the commands, but a custom editor still has to be declared or the provider is never
// registered and "Reopen Editor With… → Modkit Asset Preview" opens an editor nothing resolves.
manifest.activationEvents = [
  ...contributes.commands.map(command => `onCommand:${command.command}`),
  ...contributes.customEditors.map(editor => `onCustomEditor:${editor.viewType}`),
  // The tree views are the other way in: opening the Modkit container has to start the host.
  ...Object.values(contributes.views)
    .flat()
    .map(view => `onView:${view.id}`),
]

if (JSON.stringify([manifest.contributes, manifest.activationEvents]) !== previous) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log('manifest contributes and activation events synced from contributes.generated.json')
}

console.log(`built ${dist}`)
