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
// `--check` re-runs the build and compares hashes; `--out <path>` redirects the hash manifest.

import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = fileURLToPath(new URL('..', import.meta.url))
const check = process.argv.includes('--check')

/**
 * Where the hash manifest is read from / written to. Defaults to the tracked baseline.
 *
 * `--out <path>` exists so a *test* can ask this script the question "are two consecutive builds
 * byte-identical?" without the asking changing anything a human tracks. The determinism suite used
 * to run the default write mode twice and diff the tracked baseline it had just overwritten, which
 * made an ordinary `pnpm test` mutate a reviewed file — the answer was right and the method was
 * not. It changes nothing about the normal modes: no flag, same file, same semantics.
 */
const outIndex = process.argv.indexOf('--out')
if (outIndex !== -1 && process.argv[outIndex + 1] === undefined) {
  console.error('bundle: --out requires a path')
  process.exit(2)
}

/** Packages whose published entries collapse to one file each. testkit is dev-only. */
const BUNDLED_PACKAGES = ['core', 'sdk', 'vfs', 'host', 'ui']

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

/**
 * Bare specifiers stay external: sibling packages and real runtime dependencies alike.
 *
 * The generated validator entry is the deliberate exception. AJV's standalone emitter still
 * references its tiny `dist/runtime/*` helpers, even though it does not ship the compiler in the
 * generated program. Leaving those helpers external made the supposedly standalone validator
 * entry depend on the build workspace's AJV installation and broke consumers that installed the
 * bundled SDK without AJV. Inline the complete dependency closure for that one generated entry;
 * it has no sibling-package imports and the bundle test pins that it remains import-free.
 */
function externalPlugin({ selfContained = false } = {}) {
  return {
    name: 'externalise-bare-specifiers',
    setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'entry-point') return undefined
        const isRelative = args.path.startsWith('.') || args.path.startsWith('/')
        if (isRelative || selfContained) return undefined
        return { path: args.path, external: true }
      })
    },
  }
}

async function bundleEntry(srcPath, outFile) {
  const selfContained = outFile.endsWith(join('sdk', 'dist', 'manifest', 'validators.generated.js'))
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
    plugins: [externalPlugin({ selfContained })],
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
  // Pruning invalidates tsc's incremental view of dist: with the .tsbuildinfo left in place a later
  // `tsc -b` believes the modular files still exist and re-emits only changed ones, leaving a
  // modular index.js that imports pruned siblings. Dropping the build info makes the next `tsc -b`
  // re-emit the whole package (consistent modular dist), and `pnpm build` re-bundles on top.
  if (!check && removed.length > 0) {
    const buildInfo = join(pkgDir, 'tsconfig.tsbuildinfo')
    if (existsSync(buildInfo)) rmSync(buildInfo)
  }
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

const hashPath =
  outIndex === -1
    ? join(root, 'scripts', 'bundle-hashes.json')
    : resolve(root, process.argv[outIndex + 1])
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
