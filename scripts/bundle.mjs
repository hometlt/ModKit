#!/usr/bin/env node
// Single-file production dist (owner authorisation 2026-08-14, BRIEF-12 §6 follow-up).
//
// Why this exists: on the reference machine a cold ESM import costs ~2 ms per file, so a
// nine-module package costs ~19 ms before executing a line of its own logic — a synthetic
// nine-module fixture of the same size profile measured *more* than `core`. Collapsing each
// published entry into one file removes that per-file tax without touching the source.
//
// Constraints held (owner instructions 3-4):
//   * TypeScript sources stay modular — this step runs after `tsc`, over its output;
//   * core / sdk / vfs / host stay separate packages, and cross-package imports stay
//     EXTERNAL, so each package is still independently versioned and never duplicates a
//     sibling's module state;
//   * the `exports` map and the `.d.ts` API are untouched: every entry keeps its path, so a
//     consumer (and the benchmark) imports the same specifier as before and gets the bundle;
//   * `testkit` is dev-only and is deliberately NOT bundled;
//   * the CLI is bundled as a self-contained application (its own package's code inlined,
//     lab packages left external so the tarball proof still exercises real resolution).
//
// Determinism: esbuild with fixed options, no minification, no timestamps, LF endings, and
// `--check` re-runs the build into a temp dir and compares hashes.

import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = fileURLToPath(new URL('..', import.meta.url))
const check = process.argv.includes('--check')

/** Packages whose published entries collapse to one file each. testkit is dev-only. */
const BUNDLED_PACKAGES = ['core', 'sdk', 'vfs', 'host']

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Every `exports` target of a package, as { entrySrc, outFile } pairs. */
function entriesOf(pkgDir) {
  const manifest = readJson(join(pkgDir, 'package.json'))
  const out = []
  const walk = value => {
    if (typeof value === 'string') {
      if (value.endsWith('.js')) out.push(value)
      return
    }
    if (value && typeof value === 'object') for (const v of Object.values(value)) walk(v)
  }
  walk(manifest.exports)
  return [...new Set(out)].map(distPath => {
    // ./dist/subjects/index.js -> src/subjects/index.ts
    const relDist = distPath.replace(/^\.\//, '')
    const srcPath = relDist.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts')
    return { srcPath: join(pkgDir, srcPath), outFile: join(pkgDir, relDist) }
  })
}

/** Bare specifiers stay external: sibling packages and real dependencies alike. */
const externalPlugin = {
  name: 'externalise-bare-specifiers',
  setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (args.kind === 'entry-point') return undefined
      const isRelative = args.path.startsWith('.') || args.path.startsWith('/')
      return isRelative ? undefined : { path: args.path, external: true }
    })
  },
}

async function bundleEntry(srcPath, outFile) {
  const result = await build({
    entryPoints: [srcPath],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    write: false,
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    plugins: [externalPlugin],
    logLevel: 'silent',
  })
  const file = result.outputFiles[0]
  if (!file) throw new Error(`esbuild produced nothing for ${srcPath}`)
  // Normalise line endings so the artifact is byte-identical across platforms.
  return Buffer.from(file.text.replace(/\r\n/g, '\n'), 'utf8')
}

/** Modular .js files that are no longer reachable once entries are bundled. */
function pruneUnreferenced(pkgDir, keep) {
  const distDir = join(pkgDir, 'dist')
  if (!existsSync(distDir)) return []
  const removed = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.js(\.map)?$/.test(entry.name)) continue // keep .d.ts and .d.ts.map
      const jsPath = path.replace(/\.map$/, '')
      if (keep.has(jsPath)) continue
      removed.push(relative(root, path).split(sep).join('/'))
      if (!check) rmSync(path)
    }
  }
  walk(distDir)
  return removed
}

const hashes = {}
let bundled = 0
let pruned = 0

for (const pkg of BUNDLED_PACKAGES) {
  const pkgDir = join(root, 'packages', pkg)
  const entries = entriesOf(pkgDir)
  const keep = new Set(entries.map(e => e.outFile))
  for (const { srcPath, outFile } of entries) {
    const contents = await bundleEntry(srcPath, outFile)
    hashes[relative(root, outFile).split(sep).join('/')] = createHash('sha256')
      .update(contents)
      .digest('hex')
    if (!check) writeFileSync(outFile, contents)
    bundled += 1
  }
  const removed = pruneUnreferenced(pkgDir, keep)
  pruned += removed.length
}

// The CLI is an application: its own modules are inlined, lab packages stay external so the
// external-extension proof still resolves them from the installed tarballs.
const cliMain = join(root, 'apps', 'modkit-cli', 'dist', 'main.js')
if (existsSync(join(root, 'apps', 'modkit-cli', 'src', 'main.ts'))) {
  const contents = await bundleEntry(join(root, 'apps', 'modkit-cli', 'src', 'main.ts'), cliMain)
  hashes['apps/modkit-cli/dist/main.js'] = createHash('sha256').update(contents).digest('hex')
  if (!check) writeFileSync(cliMain, contents)
  bundled += 1
}

const hashPath = join(root, 'scripts', 'bundle-hashes.json')
const rendered = `${JSON.stringify(hashes, null, 2)}\n`
if (check) {
  const previous = existsSync(hashPath) ? readFileSync(hashPath, 'utf8') : ''
  if (previous !== rendered) {
    console.error(
      'bundle --check: output differs from the recorded hashes.\n' +
        'Either the sources changed (run `pnpm bundle` and review) or the build is not deterministic.',
    )
    process.exit(1)
  }
  console.log(`bundle --check: ${Object.keys(hashes).length} entries byte-identical`)
} else {
  writeFileSync(hashPath, rendered, 'utf8')
  const sizes = Object.keys(hashes)
    .map(f => `${f} ${statSync(join(root, f)).size}b`)
    .join('\n  ')
  console.log(`bundled ${bundled} entries, pruned ${pruned} modular files:\n  ${sizes}`)
}
