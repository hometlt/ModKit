#!/usr/bin/env node
/**
 * The extension catalog the VS Code build ships, as data (block 13 work 3).
 *
 * Every other application already knows what it carries before it starts. Electron has
 * `apps/electron/generated/bundled-catalog.cjs`; the PWA has `apps/web/generated/extension-catalog.js`
 * with per-file digests, because it fetches its artifacts over HTTP and has to attest them. VS Code
 * was the exception: it *discovered* its catalog at activation by reading directories — first
 * `<extension>/extensions`, then `<extension>/dist-app/extensions`, then, in a checkout, the
 * repository's own `extensions/common`.
 *
 * Discovery made two things true that should not have been:
 *
 *  1. **A packaged build shipped no codecs and said nothing.** `ext:build` never copied any
 *     extension into `dist-app`, so outside a checkout the first two candidates did not exist and
 *     the third is a path that is not there either. The editor then composed with an empty catalog
 *     and opened every asset as hex — a working product, seemingly, that could read nothing. The
 *     block-9 smoke receipt recorded exactly this as its sixth defect.
 *  2. **What the build contained was whatever the disk happened to hold.** Adding a directory under
 *     `extensions/common` changed the product with no diff anywhere near the product, and removing
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
 *   node scripts/emit-vscode-catalog.mjs           # write apps/modkit-vscode/generated/…
 *   node scripts/emit-vscode-catalog.mjs --check   # compare, exit 1 on drift
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { READY_APP_EXTENSIONS } from './app-extension-sets.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = join(repoRoot, 'apps', 'modkit-vscode', 'generated')
const outputPath = join(outputDir, 'bundled-catalog.json')
const check = process.argv.includes('--check')

/**
 * The catalog directory the VS Code build ships from.
 *
 * `extensions/common` and nothing else, which is what it composes today. Whether the `ea/` catalogs
 * belong in the shipped profile is a §4.2 composition decision for the owner — the smoke adds them
 * through the product's own `modkit.extensions` setting, and the block-9 receipt names the
 * question — and when that decision is made it is made by editing this constant.
 */
const CATALOG_DIRECTORY = Object.freeze(['common'])

/** The product's own test for an extension root, so emitting cannot disagree with activation. */
function looksLikeExtensionDirectory(path) {
  if (existsSync(join(path, 'modkit.extension.json'))) return true
  try {
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    return typeof manifest === 'object' && manifest !== null && 'modkit' in manifest
  } catch {
    return false
  }
}

/** Every file under a directory, repository-relative and sorted, so a digest is order-free. */
function filesUnder(root) {
  const found = []
  const walk = current => {
    for (const name of readdirSync(current).sort()) {
      if (name === 'node_modules' || name === 'dist') continue
      const path = join(current, name)
      if (statSync(path).isDirectory()) walk(path)
      else found.push(path)
    }
  }
  walk(root)
  return found
}

/**
 * One hash per extension root: every file's repository-relative path and its bytes.
 *
 * Paths are folded in with the content because a rename is a change — a digest over contents alone
 * would call `codec-png.json` moved to `codec-pngx.json` the same catalog.
 */
function digestOf(root) {
  const hash = createHash('sha256')
  for (const file of filesUnder(root)) {
    hash.update(relative(repoRoot, file).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

const catalogRoot = join(repoRoot, 'extensions', ...CATALOG_DIRECTORY)
const roots = readdirSync(catalogRoot)
  .sort()
  .map(name => join(catalogRoot, name))
  .filter(path => statSync(path).isDirectory() && looksLikeExtensionDirectory(path))
  .map(absolute => {
    const name = relative(catalogRoot, absolute).replaceAll('\\', '/')
    const entry = READY_APP_EXTENSIONS[name]
    const declared = entry !== undefined
    return {
      name,
      // Relative to `extensions/`, so the same record resolves in a checkout and in `dist-app`.
      directory: [...CATALOG_DIRECTORY, name].join('/'),
      /*
       * `declared` is the conformance matrix's opinion, not this catalog's: a root the product
       * ships that `READY_APP_EXTENSIONS` does not know is shipped anyway, and saying so is more
       * useful than dropping it or inventing a table entry for it here.
       */
      declared,
      ...(declared ? { coordinate: entry.coordinate } : {}),
      ...(declared ? { contributions: [...entry.contributions].sort() } : {}),
      digest: digestOf(absolute),
    }
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
      'vscode catalog is stale: apps/modkit-vscode/generated/bundled-catalog.json\n' +
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
