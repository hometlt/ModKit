#!/usr/bin/env node
/**
 * The extension catalog the VS Code build ships, as data (block 13 work 3).
 *
 * Every other application already knows what it carries before it starts. Electron has
 * `apps/electron/generated/bundled-catalog.cjs`; the PWA has `apps/web/generated/extension-catalog.js`
 * with per-file digests, because it fetches its artifacts over HTTP and has to attest them. VS Code
 * was the exception: it *discovered* its catalog at activation by reading directories — first
 * `<extension>/extensions`, then `<extension>/dist-app/extensions`, then, in a checkout, the
 * repository's own `extensions` directory.
 *
 * Discovery made two things true that should not have been:
 *
 *  1. **A packaged build shipped no codecs and said nothing.** `ext:build` never copied any
 *     extension into `dist-app`, so outside a checkout the first two candidates did not exist and
 *     the third is a path that is not there either. The editor then composed with an empty catalog
 *     and opened every asset as hex — a working product, seemingly, that could read nothing. The
 *     block-9 smoke receipt recorded exactly this as its sixth defect.
 *  2. **What the build contained was whatever the disk happened to hold.** Adding a directory under
 *     `extensions` changed the product with no diff anywhere near the product, and removing
 *     one changed it back just as quietly.
 *
 * So the composition becomes a committed artifact and the drift becomes a check, which is the same
 * arrangement the other two applications have. The set itself is *not* decided here: it is
 * enumerated with the very predicate the product uses at activation
 * (`looksLikeExtensionDirectory` — a `modkit.extension.json`, or a `package.json` carrying a
 * `modkit` key), so emitting the catalog cannot quietly change what the app carries. Metadata is
 * enriched from `scripts/app-extension-sets.mjs` where that table knows the directory.
 *
 * One finding this made visible, recorded rather than silently repaired: `uv-materializer` is a
 * real extension root that VS Code has been loading all along, and `READY_APP_EXTENSIONS` — the
 * table `apps:check` matrixes against — does not list it. The catalog therefore carries it with
 * `declared: false`, which is the honest state: shipped by the product, unknown to the conformance
 * matrix. Adding it to that table changes the matrix and belongs to whoever owns it.
 *
 * Digests are per root rather than per file. The PWA needs a file-level manifest because it fetches
 * each artifact separately over a network it does not control; VS Code loads from a directory it
 * shipped, so the question a digest answers here is only "did this root change since the catalog
 * was emitted" — and one hash per root answers it in twenty lines instead of four thousand.
 *
 * Usage:
 *   node scripts/emit-vscode-catalog.mjs           # write apps/vscode/generated/…
 *   node scripts/emit-vscode-catalog.mjs --check   # compare, exit 1 on drift
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { extensionDirectory, READY_APP_EXTENSIONS } from './app-extension-sets.mjs'
import { authoredExtensionRootsRelativeTo } from './lib/authored-extension-roots.mjs'
import { extensionArtifactDigest } from './lib/extension-artifact-digest.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(repoRoot, 'apps', 'vscode', 'generated')
const outputPath = join(outputDir, 'bundled-catalog.json')
const check = process.argv.includes('--check')

/**
 * The catalog directory the VS Code build ships from.
 *
 * The direct extension roots under `extensions`, which is what the core product composes today.
 */
const CATALOG_DIRECTORIES = Object.freeze([Object.freeze([])])

/**
 * One canonical host artifact identity per extension root.
 *
 * The release descriptor, the generated catalog and `loadExtensionDirectory` must name the same
 * bytes with the same digest. The shared build helper duplicates the tiny host framing because this
 * check runs before a clean checkout has emitted `packages/host/dist`.
 */

const declaredByRelativePath = new Map(
  Object.keys(READY_APP_EXTENSIONS)
    .filter(name => READY_APP_EXTENSIONS[name].repository === undefined)
    .map(name => [extensionDirectory(name).join('/'), name]),
)
const roots = CATALOG_DIRECTORIES.flatMap(path => {
  const catalogRoot = join(repoRoot, 'extensions', ...path)
  const discovered = authoredExtensionRootsRelativeTo(catalogRoot)
  return discovered.map(({ directory: absolute, relativePath }) => {
    const physicalPath = [...path, ...(relativePath === '' ? [] : relativePath.split('/'))].join(
      '/',
    )
    const name = declaredByRelativePath.get(physicalPath) ?? physicalPath
    const entry = READY_APP_EXTENSIONS[name]
    const declared = entry !== undefined
    return {
      name,
      // Relative to `extensions/`, so the same record resolves in a checkout and in `dist-app`.
      directory: physicalPath,
      /*
       * `declared` is the conformance matrix's opinion, not this catalog's: a root the product
       * ships that `READY_APP_EXTENSIONS` does not know is shipped anyway, and saying so is more
       * useful than dropping it or inventing a table entry for it here.
       */
      declared,
      ...(declared ? { coordinate: entry.coordinate } : {}),
      ...(declared ? { contributions: [...entry.contributions].sort() } : {}),
      digest: extensionArtifactDigest(absolute),
    }
  })
})

const document = {
  $comment:
    'Generated by scripts/emit-vscode-catalog.mjs. The extension roots the VS Code build ships, ' +
    'enumerated with the same predicate the product uses at activation and enriched from ' +
    'scripts/app-extension-sets.mjs where that table knows the directory. `declared: false` means ' +
    'the product ships the root and the conformance matrix does not list it. Not hand-edited: run ' +
    '`pnpm catalogs:emit` after changing what the app carries.',
  schemaVersion: 1,
  rootCount: roots.length,
  contributionCount: roots.reduce((total, root) => total + (root.contributions?.length ?? 0), 0),
  undeclaredRoots: roots.filter(root => !root.declared).map(root => root.name),
  roots,
}

const rendered = await format(`${JSON.stringify(document, null, 2)}\n`, {
  ...(await resolveConfig(outputPath)),
  filepath: outputPath,
})

if (check) {
  let existing = ''
  try {
    existing = readFileSync(outputPath, 'utf8')
  } catch {
    // missing is drift, and the message below says which command fixes it
  }
  if (existing !== rendered) {
    process.stderr.write(
      'vscode catalog is stale: apps/vscode/generated/bundled-catalog.json\n' +
        '  run `pnpm catalogs:emit` and review the diff\n',
    )
    process.exit(1)
  }
  process.stdout.write(
    `vscode catalog: ${document.rootCount} bundled root(s), ` +
      `${document.contributionCount} contribution(s) unchanged\n`,
  )
} else {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(outputPath, rendered)
  process.stdout.write(
    `vscode catalog emitted: ${document.rootCount} root(s), ` +
      `${document.contributionCount} contribution(s)\n`,
  )
}
