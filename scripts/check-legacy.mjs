#!/usr/bin/env node
// Legacy-vocabulary gate (BRIEF-12 §3.5; lab decisions L7 + corrective pass 2026-08-13 in
// IMPLEMENTATION_NOTES.md).
//
// Scope (extended 2026-08-17, gap G-APP-1 in IMPLEMENTATION_NOTES): every package directory
// under <root>/packages/*, <root>/apps/*, <root>/examples/* and <root>/extensions/*/* —
// its {src,schemas,contributions} trees, a root-level contribution.manifest.json /
// modkit.extension.json, and its package.json (name, exports and full manifest text).
// Contribution manifests are wire documents, so they are scanned like schemas.
// Forbidden in new public code and schemas:
//   - AssetPlugin (legacy plugin API)
//   - `capability`/`capabilities` as a runtime type name or object/schema key — quoted or
//     unquoted (schemas live as TS consts, so unquoted keys count) — the final vocabulary
//     is traits / operations / offers / permissions / facilities (MK3/02 §1)
//   - `extension.json` as an authored form (only package.json#modkit or
//     modkit.extension.json exist)
//   - legacyCodecRoot
//   - marketplace / codec-host in package names or export subpaths (they are `host`
//     modules, not packages)
//   - the `@modkit/*` name scope is required for platform packages/apps only
//     (BRIEF-12 §7.1), except the deliberately ecosystem-stable
//     `@modkit/extension-manager`; extension/example package names follow MK3/27 §0.2 and are
//     free.
//
// Exclusions (§3.5: otherwise the negative-test of the old manifest is impossible):
//   - any path containing /fixtures/legacy/ (skipped entirely);
//   - files under some other /fixtures/ directory carrying the marker
//     @modkit-legacy-input-fixture in their first 400 bytes.
//   The marker is honored ONLY under a /fixtures/ path: a marker in ordinary public
//   source is itself a violation (rule marker-outside-fixtures), so the marker cannot be
//   used to exempt real code.
//
// Known blind spot (recorded, not hidden): "category-as-path" runtime identity cannot be
// caught by grep; it is enforced by S1 loader tests and review instead. Prose comments
// that legitimately need the word `capability:` before a colon should be rephrased —
// strictness over comment convenience is intentional.
//
// Usage: node scripts/check-legacy.mjs [--root <dir>] [--quiet]
// (--root exists so the committed regression suite can point the gate at fixture trees.)
//
// Zero dependencies; deterministic order; exit 1 on any finding.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const args = process.argv.slice(2)
const rootArgIndex = args.indexOf('--root')
const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = rootArgIndex === -1 ? defaultRoot : resolve(args[rootArgIndex + 1] ?? defaultRoot)
const quiet = args.includes('--quiet')

/**
 * Scan roots and how deep a package directory sits under each: `packages/<pkg>` and
 * `apps/<app>` are one level; `examples/<ext>` one level; `extensions/<group>/<ext>` two
 * (`images`). Only platform packages/apps must use the lab scope.
 */
const SCAN_ROOTS = [
  { name: 'packages', packageDepth: 1, requireLabScope: true },
  { name: 'apps', packageDepth: 1, requireLabScope: true },
  { name: 'examples', packageDepth: 1, requireLabScope: false },
  { name: 'extensions', packageDepth: 2, requireLabScope: false },
]
const SOURCE_DIR_NAMES = new Set(['src', 'schemas', 'contributions'])
/** Authored wire documents that may sit directly in a package root. */
const ROOT_MANIFEST_NAMES = new Set(['contribution.manifest.json', 'modkit.extension.json'])
const TEXT_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.json'])
const LEGACY_MARKER = '@modkit-legacy-input-fixture'
const LEGACY_PATH_SEGMENT = '/fixtures/legacy/'
const FIXTURES_SEGMENT = '/fixtures/'

const RULES = [
  {
    id: 'asset-plugin',
    re: /\bAssetPlugin\b/,
    why: 'legacy plugin API (BRIEF-12 §3.5)',
  },
  {
    id: 'capability-runtime-type',
    re: /\bCapability(?:Instance|Requirement|Descriptor|Id)\b|\bCAPABILITY_IDS\b/,
    why: 'capability as a runtime type; use traits/operations/offers/permissions/facilities (MK3/02 §1)',
  },
  {
    id: 'capability-key',
    re: /(^|[\s{,("'`[])["'`]?capabilit(?:y|ies)["'`]?\s*:/i,
    why: 'capability(-ies) as an object/schema key (quoted or unquoted) — legacy-only field name',
  },
  {
    id: 'authored-extension-json',
    re: /(?<!modkit\.)\bextension\.json\b/,
    why: 'extension.json as an authored form; only package.json#modkit / modkit.extension.json',
  },
  {
    id: 'legacy-codec-root',
    re: /\blegacyCodecRoot\b/,
    why: 'legacy codec root concept (BRIEF-12 §3.5)',
  },
]

const FORBIDDEN_PACKAGE_NAME = /(marketplace|codec-host)/
const PLATFORM_SCOPE_EXCEPTIONS = new Set(['@modkit/extension-manager'])

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(path, out)
    } else if (entry.isFile()) {
      out.push(path)
    }
  }
}

/**
 * Classifies a path relative to the scan root: the package manifest itself, a file inside
 * one of the scanned trees (`<pkg>/(src|schemas|contributions)/**`), an authored root
 * manifest, or nothing of interest.
 */
function classify(relPath, scanRoot) {
  const parts = relPath.split(sep)
  const packageDirDepth = 1 + scanRoot.packageDepth // scan root + package segments
  if (parts.length === packageDirDepth + 1 && parts[packageDirDepth] === 'package.json') {
    return 'package-json'
  }
  if (parts.length > packageDirDepth + 1 && SOURCE_DIR_NAMES.has(parts[packageDirDepth])) {
    return 'source'
  }
  if (parts.length === packageDirDepth + 1 && ROOT_MANIFEST_NAMES.has(parts[packageDirDepth])) {
    return 'root-manifest'
  }
  return undefined
}

function hasTextExtension(path) {
  const dot = path.lastIndexOf('.')
  return dot !== -1 && TEXT_EXTENSIONS.has(path.slice(dot))
}

function scanTextWithRules(text, relPosix, findings) {
  const lines = text.split('\n')
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i += 1) {
      if (rule.re.test(lines[i])) {
        findings.push({ file: relPosix, line: i + 1, rule: rule.id, why: rule.why })
      }
    }
  }
}

function collectExportPathStrings(exportsValue, out) {
  if (typeof exportsValue === 'string') {
    out.push(exportsValue)
    return
  }
  if (Array.isArray(exportsValue)) {
    for (const item of exportsValue) collectExportPathStrings(item, out)
    return
  }
  if (exportsValue && typeof exportsValue === 'object') {
    for (const [key, value] of Object.entries(exportsValue)) {
      out.push(key)
      collectExportPathStrings(value, out)
    }
  }
}

function checkPackageManifest(file, relPosix, findings, requireLabScope) {
  const text = readFileSync(file, 'utf8')
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    findings.push({
      file: relPosix,
      line: 1,
      rule: 'package-json-parse',
      why: 'unparseable package.json',
    })
    return 1
  }
  const name = typeof manifest.name === 'string' ? manifest.name : ''
  if (FORBIDDEN_PACKAGE_NAME.test(name)) {
    findings.push({
      file: relPosix,
      line: 1,
      rule: 'package-name',
      why: `forbidden package name «${name}» (host modules, not packages)`,
    })
  }
  if (
    requireLabScope &&
    name &&
    !name.startsWith('@modkit/') &&
    !PLATFORM_SCOPE_EXCEPTIONS.has(name)
  ) {
    findings.push({
      file: relPosix,
      line: 1,
      rule: 'package-name-scope',
      why: `lab packages must use @modkit/* (BRIEF-12 §7.1), got «${name}»`,
    })
  }
  const exportStrings = []
  collectExportPathStrings(manifest.exports, exportStrings)
  for (const value of exportStrings) {
    if (/capabilit/i.test(value) || FORBIDDEN_PACKAGE_NAME.test(value)) {
      findings.push({
        file: relPosix,
        line: 1,
        rule: 'exports-path',
        why: `forbidden vocabulary in exports entry «${value}»`,
      })
    }
  }
  // The full manifest text also goes through the generic rules (catches legacy field
  // names, extension.json references, etc. anywhere in the manifest).
  scanTextWithRules(text, relPosix, findings)
  return 1
}

const findings = []
let scannedFiles = 0

for (const scanRoot of SCAN_ROOTS) {
  const rootDir = join(root, scanRoot.name)
  let exists = false
  try {
    exists = statSync(rootDir).isDirectory()
  } catch {
    exists = false
  }
  if (!exists) continue

  const files = []
  walk(rootDir, files)

  for (const file of files) {
    const relPath = relative(root, file)
    const relPosix = relPath.split(sep).join('/')
    const kind = classify(relPath, scanRoot)

    if (kind === 'package-json') {
      scannedFiles += checkPackageManifest(file, relPosix, findings, scanRoot.requireLabScope)
      continue
    }

    if (kind === undefined) continue
    if (relPosix.includes(LEGACY_PATH_SEGMENT)) continue
    if (!hasTextExtension(file)) continue

    const text = readFileSync(file, 'utf8')
    const hasMarker = text.slice(0, 400).includes(LEGACY_MARKER)
    if (hasMarker) {
      if (relPosix.includes(FIXTURES_SEGMENT)) continue // honored only under fixtures/
      findings.push({
        file: relPosix,
        line: 1,
        rule: 'marker-outside-fixtures',
        why: `${LEGACY_MARKER} marker outside a fixtures/ directory — the marker cannot exempt public source`,
      })
      // fall through: the file stays fully scanned
    }
    scannedFiles += 1
    scanTextWithRules(text, relPosix, findings)
  }
}

if (findings.length > 0) {
  console.error(`legacy gate: ${findings.length} finding(s) in ${scannedFiles} scanned file(s):`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.why}`)
  }
  process.exit(1)
}

if (!quiet) console.log(`legacy gate: clean (${scannedFiles} file(s) scanned)`)
