#!/usr/bin/env node
// Stage M audit tool (HANDOFF_SC2_CORE_RESTRUCTURE_CONTINUATION §13, "Этап M").
//
// Builds a regex-based import/reference graph across all six repos (core + five
// extension repos). Relative imports resolve within their own repo; bare `@modkit/*`
// (and other internal-package) specifiers resolve through the owning package's
// package.json `exports`/`main`/`module` map, wherever that package lives (extensions
// consume core packages from vendored tarballs, but the source paths inside the tarball
// mirror modkit-core's own src, so name+subpath resolution against modkit-core's package
// tree is the right target).
//
// Reports, per repo:
//   - files with zero inbound references anywhere in the six repos (candidate: unreferenced)
//   - package entry points whose package name has zero bare-specifier hits anywhere
//     (candidate: dead package)
//   - scratch-*.mjs files (always listed)
//
// Deliberately simple: one regex pass per file, no TS type-checker, no bundler. Good
// enough for an audit whose output is a human-reviewed candidate list, not an automated
// deleter.
//
// Usage: node scripts/audit/unused-code.mjs [--json out.json]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const REPOS = [
  'modkit-core',
  'modkit-extensions-blizzard',
  'modkit-extensions-ea',
  'modkit-extensions-other',
  'modkit-extensions-annihilation',
  'modkit-extensions-warzone',
]

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'dist-app', 'artifacts', 'vendor', '.git', 'coverage',
  '.cache', '.turbo', '.vite', '.pnpm-store', '.tmp', 'cache', 'snapshots',
])
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const RESOLVE_EXT = ['', '.d.ts', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']
const INDEX_SUFFIXES = RESOLVE_EXT.filter(e => e).map(e => `/index${e}`)

const TEST_PATH_RE = /(^|\/)(test|tests|__tests__|test-e2e)\//
const TEST_NAME_RE = /\.(test|spec)\.[cm]?[tj]sx?$/
const CONFIG_NAME_RE =
  /^(vitest|vite|tsconfig|jest|eslint|rollup|webpack|babel)[^/]*\.(json|[cm]?[tj]s)$/
const SCRATCH_RE = /^scratch-.*\.mjs$/

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      walk(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
}

const toPosix = p => p.split(sep).join('/')

const SPEC_RES = [
  /\bimport\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\.resolve\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\/\/\/\s*<reference\s+path=["']([^"']+)["']/g,
]

function extractJsSpecifiers(text) {
  const specs = []
  for (const re of SPEC_RES) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) specs.push(m[1])
  }
  return specs
}

// Manifest-ish JSON (contributions/*.json, codec.json, provider.json, tsconfig): pull
// path-shaped string values so those declared references count as edges too.
const PATH_KEYS = new Set([
  'entry', 'entrypoint', 'module', 'main', 'types', 'path', 'file', 'target', 'source',
  'codec', 'provider', 'extends', 'bin',
])
function extractManifestSpecifiers(json) {
  const specs = []
  function walkValue(v, keyHint) {
    if (typeof v === 'string') {
      if (keyHint && PATH_KEYS.has(keyHint)) specs.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) walkValue(item, keyHint)
      return
    }
    if (v && typeof v === 'object') {
      // Once inside a path-bearing map (e.g. `bin: { name: "./path" }`), every leaf is a
      // path regardless of its own key name, so keep propagating the map's own hint.
      const childHint = keyHint && PATH_KEYS.has(keyHint) ? keyHint : undefined
      for (const [k, val] of Object.entries(v)) walkValue(val, childHint ?? k)
    }
  }
  walkValue(json, undefined)
  return specs
}

function resolveAgainstFileSet(candidateBaseNoExt, fileSet) {
  for (const ext of RESOLVE_EXT) {
    const candidate = candidateBaseNoExt + ext
    if (fileSet.has(candidate)) return candidate
  }
  for (const idx of INDEX_SUFFIXES) {
    const candidate = candidateBaseNoExt + idx
    if (fileSet.has(candidate)) return candidate
  }
  // Packages/apps publish `dist/**` or `dist-app/**` (compiled, excluded from the scan)
  // mirroring source 1:1 — most commonly tsc outDir=dist, rootDir=src (packages/apps), but
  // some repos build with rootDir=. so `dist/X` mirrors repo-root `X` directly (no `src/`
  // indirection) — a package.json/manifest path into a build output dir resolves to its
  // source twin either way.
  const buildDirMatch = /(^|\/)(dist-app|dist)(\/|$)/.exec(candidateBaseNoExt)
  if (buildDirMatch) {
    const srcBase = candidateBaseNoExt.replace(buildDirMatch[0], `${buildDirMatch[1]}src${buildDirMatch[3]}`)
    const rootBase = candidateBaseNoExt.replace(buildDirMatch[0], buildDirMatch[1])
    return (
      (srcBase !== candidateBaseNoExt && resolveAgainstFileSet(srcBase, fileSet)) ||
      (rootBase !== candidateBaseNoExt && resolveAgainstFileSet(rootBase, fileSet)) ||
      undefined
    )
  }
  return undefined
}

/**
 * Contribution manifests split into a `contributions/`/`schemas/` subfolder declare paths
 * relative to that subfolder's PARENT (the codec/extension root), not to the manifest file
 * itself — e.g. `native-text/contributions/codec-json.json`'s `entrypoint` is relative to
 * `native-text/`. A manifest that sits directly in its codec dir (`codecs/x/codec.json`)
 * keeps the ordinary dirname-relative base.
 */
function manifestBaseDir(rel) {
  const parts = rel.split('/')
  const parentDirName = parts[parts.length - 2]
  if (parentDirName === 'contributions' || parentDirName === 'schemas') return parts.slice(0, -2).join('/')
  return dirname(rel)
}

/** Manifest path fields resolve against a few plausible bases; first hit wins. */
function resolveManifestSpec(rel, spec, fileSet) {
  if (spec.startsWith('/')) return resolveAgainstFileSet(stripKnownExt(toPosix(spec.slice(1))), fileSet)
  if (!spec.startsWith('.')) return undefined
  const bases = [manifestBaseDir(rel), '', dirname(rel)]
  for (const base of bases) {
    const candidate = stripKnownExt(toPosix(join(base, spec)))
    const resolved = resolveAgainstFileSet(candidate, fileSet)
    if (resolved) return resolved
  }
  return undefined
}

function resolveRelative(fromRel, spec, fileSet) {
  // NodeNext/ESM strict-TS sources commonly import './foo.js' for a source file that is
  // actually './foo.ts' — strip a known extension before re-trying the extension ladder.
  if (spec.startsWith('/')) return resolveAgainstFileSet(stripKnownExt(toPosix(spec.slice(1))), fileSet)
  if (!spec.startsWith('.')) return undefined
  const base = stripKnownExt(toPosix(join(dirname(fromRel), spec)))
  return resolveAgainstFileSet(base, fileSet)
}

const KNOWN_EXT_RE = /\.(d\.ts|ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/
function stripKnownExt(p) {
  return p.replace(KNOWN_EXT_RE, '')
}

/** Follows one exports-map value down to a single path string (picks import/default/require). */
function pickConditionValue(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    return pickConditionValue(v.import ?? v.default ?? v.require ?? v.types ?? Object.values(v)[0])
  }
  return undefined
}

/** subpath is '.' for the package root or './xxx' for a deep import, matching exports-map key style. */
function resolveExportsSubpath(pkg, subpath) {
  const { exports: exp, main, module: mod } = pkg
  if (exp) {
    if (typeof exp === 'string') return subpath === '.' ? exp : undefined
    if (typeof exp === 'object') {
      if (Object.prototype.hasOwnProperty.call(exp, subpath)) {
        const v = pickConditionValue(exp[subpath])
        if (v) return v
      }
      for (const [key, value] of Object.entries(exp)) {
        if (!key.includes('*')) continue
        const re = new RegExp('^' + key.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*)') + '$')
        const m = re.exec(subpath)
        if (m) {
          const target = pickConditionValue(value)
          if (target) return target.replace('*', m[1])
        }
      }
    }
  }
  if (subpath === '.' && (main || mod)) return main || mod
  if (subpath !== '.') return subpath // fall back to literal relative path under the package dir
  return undefined
}

function classifyPathBucket(relPosix) {
  const base = relPosix.split('/').pop()
  if (SCRATCH_RE.test(base)) return 'scratch'
  if (!SOURCE_EXT.has(extname(base))) return 'non-code'
  // Ambient .d.ts (declare module/global, or third-party shims) are picked up by tsc via
  // tsconfig `include`, not by any import statement — an import-graph false-positive class.
  if (base.endsWith('.d.ts')) return 'ambient-types'
  if (TEST_PATH_RE.test(relPosix) || TEST_NAME_RE.test(relPosix)) return 'test'
  if (CONFIG_NAME_RE.test(base)) return 'config'
  return 'source'
}

async function main() {
  const repos = {} // repo -> { relFiles, fileSet, texts: Map<rel,string>, fileMeta }
  const packages = new Map() // name -> { repo, dir, pkg (raw json) }

  for (const repo of REPOS) {
    const repoRoot = join(WORKSPACE_ROOT, repo)
    try {
      if (!statSync(repoRoot).isDirectory()) continue
    } catch {
      continue
    }
    const files = []
    walk(repoRoot, files)
    const relFiles = files.map(f => toPosix(relative(repoRoot, f)))
    const fileSet = new Set(relFiles)
    const texts = new Map()
    const fileMeta = new Map()
    const scratch = []

    for (let i = 0; i < files.length; i += 1) {
      const rel = relFiles[i]
      const bucket = classifyPathBucket(rel)
      fileMeta.set(rel, bucket)
      if (bucket === 'scratch') scratch.push(rel)
      const ext = extname(rel)
      const isPkgJson = rel.split('/').pop() === 'package.json'
      if (!SOURCE_EXT.has(ext) && ext !== '.json') continue
      let text
      try {
        text = readFileSync(files[i], 'utf8')
      } catch {
        continue
      }
      if (text.length > 2_000_000) continue
      texts.set(rel, text)
      if (isPkgJson) {
        try {
          const json = JSON.parse(text)
          if (typeof json.name === 'string') {
            packages.set(json.name, { repo, dir: dirname(rel) === '.' ? '' : dirname(rel), pkg: json })
          }
        } catch {
          /* ignore unparseable package.json */
        }
      }
    }
    repos[repo] = { relFiles, fileSet, texts, fileMeta, scratch }
  }

  const packageNamesByLength = [...packages.keys()].sort((a, b) => b.length - a.length)
  const referenced = {} // repo -> Set(rel)
  const packageUsage = new Map([...packages.keys()].map(n => [n, 0]))
  for (const repo of REPOS) referenced[repo] = new Set()

  function markReferenced(targetRepo, rel) {
    if (repos[targetRepo]?.fileSet.has(rel)) referenced[targetRepo].add(rel)
  }

  function resolveBareSpecifier(spec) {
    const name = packageNamesByLength.find(n => spec === n || spec.startsWith(n + '/'))
    if (!name) return
    packageUsage.set(name, packageUsage.get(name) + 1)
    const info = packages.get(name)
    const subpath = spec === name ? '.' : './' + spec.slice(name.length + 1)
    const target = resolveExportsSubpath(info.pkg, subpath)
    if (!target) return
    const baseNoExt = toPosix(join(info.dir, stripKnownExt(target)))
    const resolved = resolveAgainstFileSet(baseNoExt, repos[info.repo].fileSet)
    if (resolved) markReferenced(info.repo, resolved)
  }

  for (const repo of REPOS) {
    const data = repos[repo]
    if (!data) continue
    for (const [rel, text] of data.texts) {
      const ext = extname(rel)
      const base = rel.split('/').pop()
      let specs = []
      let isManifestJson = false
      if (SOURCE_EXT.has(ext)) {
        specs = extractJsSpecifiers(text)
      } else if (ext === '.json' && base !== 'package.json') {
        isManifestJson = true
        try {
          specs = extractManifestSpecifiers(JSON.parse(text))
        } catch {
          continue
        }
      } else if (base === 'package.json') {
        try {
          const json = JSON.parse(text)
          specs = extractManifestSpecifiers(json)
          if (json.scripts) {
            for (const cmd of Object.values(json.scripts)) {
              if (typeof cmd !== 'string') continue
              for (const tok of cmd.split(/\s+/)) {
                if (!/\.(mjs|cjs|js|ts)$/.test(tok)) continue
                // Script command paths are relative to the package dir by convention
                // (e.g. "node scripts/foo.mjs"), not a bare package specifier.
                specs.push(tok.startsWith('.') || tok.startsWith('/') ? tok : `./${tok}`)
              }
            }
          }
        } catch {
          continue
        }
      }
      for (const spec of specs) {
        if (spec.startsWith('.') || spec.startsWith('/')) {
          const resolved = isManifestJson
            ? resolveManifestSpec(rel, spec, data.fileSet)
            : resolveRelative(rel, spec, data.fileSet)
          if (resolved) referenced[repo].add(resolved)
        } else {
          resolveBareSpecifier(spec)
        }
      }
    }
  }

  const report = {}
  for (const repo of REPOS) {
    const data = repos[repo]
    if (!data) continue
    const unreferenced = data.relFiles.filter(
      rel => data.fileMeta.get(rel) === 'source' && !referenced[repo].has(rel),
    )
    const deadPackageEntries = []
    for (const [name, info] of packages) {
      if (info.repo !== repo) continue
      // Only library packages (packages/<pkg>) are meant to be consumed by name from
      // elsewhere; apps, examples, extensions and test fixtures are run/discovered by
      // path instead, so an absent bare-specifier hit says nothing about their liveness.
      if (!info.dir.startsWith('packages/')) continue
      if (/\/(test|tests|fixtures|__tests__)(\/|$)/.test(info.dir)) continue
      if ((packageUsage.get(name) ?? 0) === 0) {
        const rootTarget = resolveExportsSubpath(info.pkg, '.')
        const entryFile = rootTarget
          ? resolveAgainstFileSet(toPosix(join(info.dir, stripKnownExt(rootTarget))), data.fileSet)
          : undefined
        deadPackageEntries.push({ name, dir: info.dir, entryFile })
      }
    }
    report[repo] = {
      totalFiles: data.relFiles.length,
      sourceFiles: data.relFiles.filter(r => data.fileMeta.get(r) === 'source').length,
      unreferencedCount: unreferenced.length,
      unreferenced,
      scratch: data.scratch,
      deadPackageEntries,
    }
  }

  const jsonArgIdx = process.argv.indexOf('--json')
  if (jsonArgIdx !== -1) {
    const outPath = process.argv[jsonArgIdx + 1]
    const fs = await import('node:fs/promises')
    await fs.writeFile(outPath, JSON.stringify(report, null, 2))
    console.log(`wrote ${outPath}`)
  } else {
    console.log(JSON.stringify(report, null, 2))
  }
}

main()
