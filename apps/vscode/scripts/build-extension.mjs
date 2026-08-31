/**
 * Bundle the VS Code extension into generated `dist-app/`.
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
 * `dist-app/` is deliberately not tracked: release and smoke build it from source, while `--check`
 * compares that generated output with two independent fresh builds.
 */
import { build } from 'esbuild'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const publicationInventoryPath = join(appRoot, 'publication-artifact.v1.json')
const publicationInventory = JSON.parse(readFileSync(publicationInventoryPath, 'utf8'))

if (
  publicationInventory.schemaVersion !== 1 ||
  publicationInventory.artifactKind !== 'deterministic-shell' ||
  !Array.isArray(publicationInventory.shellEntries) ||
  !Array.isArray(publicationInventory.packagedCodecRoots)
) {
  throw new TypeError('VS Code publication artifact inventory must be deterministic-shell v1')
}

function assertPublicationArtifact(output) {
  const shellEntries = [...publicationInventory.shellEntries].sort()
  const packagedCodecRoots = [...publicationInventory.packagedCodecRoots].sort()
  if (
    shellEntries.some(
      (entry, index) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        (index > 0 && entry === shellEntries[index - 1]),
    ) ||
    packagedCodecRoots.some(
      (entry, index) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        (index > 0 && entry === packagedCodecRoots[index - 1]),
    )
  ) {
    throw new TypeError('VS Code publication artifact entries must be unique non-empty strings')
  }
  const expectedEntries = [...shellEntries, ...packagedCodecRoots].sort()
  const actualEntries = readdirSync(output).sort()
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(
      `VS Code publication artifact inventory drifted: expected ${expectedEntries.join(', ')}, found ${actualEntries.join(', ')}`,
    )
  }
}

/*
 * Where the bundle lands.
 *
 * `--check` builds twice into throwaway directories and compares both results with the generated
 * `dist-app/`. This catches both source drift (the checkout was not rebuilt) and non-deterministic
 * output without keeping tens of thousands of generated lines under version control.
 */
const check = process.argv.includes('--check')
const outFlag = process.argv.indexOf('--out')
const generated = join(appRoot, 'dist-app')
if (check && outFlag > 0) {
  console.error('dist-app --check cannot be combined with --out')
  process.exit(1)
}
const dist = outFlag > 0 ? resolve(process.argv[outFlag + 1]) : generated

async function buildInto(output, syncManifest) {
  mkdirSync(output, { recursive: true })

  await build({
    entryPoints: [join(appRoot, 'src', 'extension.ts')],
    outfile: join(output, 'extension.cjs'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['node20'],
    // Prefer dependency ESM entry points. `jsonc-parser` publishes both an ESM `module` and an AMD/
    // CommonJS `main`; selecting the latter leaves its relative `require('./impl/format')` calls in
    // the single-file bundle, where those sibling files do not exist in an Extension Host.
    mainFields: ['module', 'main'],
    // Supplied by the VS Code runtime; bundling it would shadow the real API.
    external: ['vscode'],
    /*
     * No rewrite of `import.meta.url` here any more. The extension names the bootstrap it shipped
     * through `bootstrapUrl`, which the Node factories now thread through — a host saying where its
     * own file is, rather than a build making one expression mean something other than it says.
     */
    absWorkingDir: repoRoot,
    logLevel: 'warning',
    // `@modkitx-x3/host` keeps an ESM default that resolves its worker bootstrap through
    // `import.meta.url`. This CommonJS host always supplies the shipped bootstrap explicitly (see
    // `apps/vscode/src/extension.ts`), and the host has a named refusal if another CommonJS
    // consumer omits it. esbuild still warns while lowering that guarded fallback, so silence only
    // this expected diagnostic rather than hiding other build warnings.
    logOverride: { 'empty-import-meta': 'silent' },
  })

  const bootstrapEntry = join(repoRoot, 'packages', 'host', 'dist', 'node', 'worker-bootstrap.js')
  if (!existsSync(bootstrapEntry)) {
    console.error(
      `missing ${bootstrapEntry} — run pnpm build (tsc -b) before bundling the extension`,
    )
    process.exit(1)
  }
  // Its own self-contained ES module: a worker thread is its own entry point, and the bootstrap
  // verifies artifact bytes against the inventory's digests, so it must not be reached through a
  // bundle that could have rewritten it.
  await build({
    entryPoints: [bootstrapEntry],
    outfile: join(output, 'worker-bootstrap.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    absWorkingDir: repoRoot,
    logLevel: 'warning',
  })

  await build({
    entryPoints: [join(appRoot, 'src', 'webview.ts')],
    outfile: join(output, 'webview.js'),
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
  cpSync(stylesheet, join(output, 'modkit-ui.css'))

  // Shell chrome only: the shipped stylesheet has no layout for the `workbench` parts on purpose, so
  // the host places them. Everything else the page draws comes from `modkit-ui.css`.
  cpSync(join(appRoot, 'app.css'), join(output, 'app.css'))

  /*
   * The catalog is *named* by `generated/bundled-catalog.json` and not copied here, and the
   * distinction is deliberate.
   *
   * Copying the roots in looked right and was not: an extension root under `extensions`
   * reaches its SDK through `node_modules/@modkitx-x3`, a workspace link, and a copy without it is
   * a directory that looks like an extension and cannot run. The first build that did this turned
   * every bundled codec off — PNG, ANI and ASTC all fell back to hex in the smoke — which is a
   * worse failure than the one it was meant to fix, because the artifact looks complete.
   *
   * So what this slice fixes is the *silence*, not the packaging: the host now resolves the named
   * catalog and reports any root it cannot find, and activation fails loudly instead of composing
   * an empty inventory (block-9 receipt, defect 6). Making a packaged build carry runnable roots
   * needs a dependency decision — vendored `@modkitx-x3` per root, or codecs bundled the way the
   * PWA bundles its worker — and that belongs to whoever takes VS Code packaging (13D/14).
   */

  // ---------------------------------------------------------------- manifest
  // Only the real output owns the manifest: a check build must not write the package it is checking.
  if (syncManifest) {
    const manifestPath = join(appRoot, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const contributes = JSON.parse(
      readFileSync(join(appRoot, 'contributes.generated.json'), 'utf8'),
    )
    /*
     * Filesystem schemes are an activation point with no `contributes` entry of their own — a
     * provider is registered in code — so they are declared in the authority document rather than in
     * this script: a saved workspace holding a `modkit-container:` folder has to start this extension
     * before the Explorer can ask anything of it, and a scheme spelled in two places would drift.
     */
    const authority = JSON.parse(readFileSync(join(appRoot, 'bundled-contributes.v1.json'), 'utf8'))
    const fileSystemSchemes = [...(authority.fileSystemSchemes ?? [])].sort()

    const previous = JSON.stringify([
      manifest.contributes ?? null,
      manifest.activationEvents ?? null,
    ])
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
      ...fileSystemSchemes.map(scheme => `onFileSystem:${scheme}`),
    ]

    if (JSON.stringify([manifest.contributes, manifest.activationEvents]) !== previous) {
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      console.log(
        'manifest contributes and activation events synced from contributes.generated.json',
      )
    }
  }
  assertPublicationArtifact(output)
}

function differingFiles(left, right) {
  const names = [...new Set([...readdirSync(left), ...readdirSync(right)])].sort()
  return names.filter(name => {
    const leftBytes = existsSync(join(left, name)) ? readFileSync(join(left, name)) : undefined
    const rightBytes = existsSync(join(right, name)) ? readFileSync(join(right, name)) : undefined
    return leftBytes === undefined || rightBytes === undefined || !leftBytes.equals(rightBytes)
  })
}

if (!check) {
  await buildInto(dist, dist === generated)
  console.log(`built ${dist}`)
} else {
  if (!existsSync(generated)) {
    console.error('dist-app --check: generated dist-app is missing; run ext:build first')
    process.exit(1)
  }
  const freshA = mkdtempSync(join(tmpdir(), 'x3-dist-app-a-'))
  const freshB = mkdtempSync(join(tmpdir(), 'x3-dist-app-b-'))
  try {
    await buildInto(freshA, false)
    await buildInto(freshB, false)
    const nonDeterministic = differingFiles(freshA, freshB)
    const stale = differingFiles(freshA, generated)
    if (nonDeterministic.length > 0) {
      console.error(
        `dist-app --check: non-deterministic output in ${nonDeterministic.length} file(s): ` +
          nonDeterministic.join(', '),
      )
      process.exitCode = 1
    }
    if (stale.length > 0) {
      console.error(
        `dist-app --check: generated output is stale in ${stale.length} file(s): ${stale.join(', ')}`,
      )
      console.error('Run `pnpm --filter @modkitx-x3/modkit-vscode ext:build`.')
      process.exitCode = 1
    }
    if (process.exitCode !== 1) {
      console.log(
        `dist-app --check: ${readdirSync(freshA).length} generated file(s) are fresh and ` +
          'byte-deterministic across two clean builds',
      )
    }
  } finally {
    rmSync(freshA, { recursive: true, force: true })
    rmSync(freshB, { recursive: true, force: true })
  }
}
