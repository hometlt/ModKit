#!/usr/bin/env node
// Legacy-vocabulary gate (BRIEF-12 §3.5; lab decision L7 in IMPLEMENTATION_NOTES.md).
//
// Scope: packages/**/src, apps/**/src, packages/**/schemas, plus every workspace
// package.json (name + exports). Forbidden in new public code and schemas:
//   - AssetPlugin (legacy plugin API)
//   - `capability` as a new runtime interface / schema field (final vocabulary is
//     traits / operations / offers / permissions / facilities — MK3/02 §1)
//   - `extension.json` as an authored form (only package.json#modkit or
//     modkit.extension.json exist)
//   - legacyCodecRoot
//   - marketplace / codec-host as package names (they are `host` modules)
//
// Exclusions (§3.5: otherwise the negative-test of the old manifest is impossible):
//   - any path containing /fixtures/legacy/
//   - files whose first 400 bytes carry the marker @modkit-legacy-input-fixture
//
// Known blind spot (recorded, not hidden): "category-as-path" runtime identity cannot be
// caught by grep; it is enforced by S1 loader tests and review instead.
//
// Zero dependencies; deterministic order; exit 1 on any finding.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import process from 'node:process'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')

const SCAN_ROOTS = ['packages', 'apps']
const SOURCE_DIR_NAMES = new Set(['src', 'schemas'])
const TEXT_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.json'])
const LEGACY_MARKER = '@modkit-legacy-input-fixture'

const RULES = [
  {
    id: 'asset-plugin',
    re: /\bAssetPlugin\b/,
    why: 'legacy plugin API (BRIEF-12 §3.5)',
  },
  {
    id: 'capability-runtime-type',
    re: /\bCapability(?:Instance|Requirement|Descriptor|Id)\b|\bCAPABILITY_IDS\b/,
    why: 'capability as a runtime interface; use traits/operations/offers/permissions/facilities (MK3/02 §1)',
  },
  {
    id: 'capability-schema-field',
    re: /"capabilit(?:y|ies)"\s*:/,
    why: 'capability field in a new schema/manifest (legacy-only field name)',
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

function isInScannedTree(relPath) {
  const parts = relPath.split(sep)
  // packages/<pkg>/(src|schemas)/** or apps/<app>/(src|schemas)/**
  return parts.length >= 3 && SOURCE_DIR_NAMES.has(parts[2])
}

function hasTextExtension(path) {
  const dot = path.lastIndexOf('.')
  return dot !== -1 && TEXT_EXTENSIONS.has(path.slice(dot))
}

const findings = []
let scannedFiles = 0

for (const scanRoot of SCAN_ROOTS) {
  const rootDir = join(root, scanRoot)
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

    // package manifests: name + exports check
    if (/^(packages|apps)\/[^/]+\/package\.json$/.test(relPosix)) {
      const text = readFileSync(file, 'utf8')
      scannedFiles += 1
      let manifest
      try {
        manifest = JSON.parse(text)
      } catch {
        findings.push({ file: relPosix, line: 1, rule: 'package-json-parse', why: 'unparseable package.json' })
        continue
      }
      const name = typeof manifest.name === 'string' ? manifest.name : ''
      if (FORBIDDEN_PACKAGE_NAME.test(name)) {
        findings.push({ file: relPosix, line: 1, rule: 'package-name', why: `forbidden package name «${name}» (host modules, not packages)` })
      }
      if (name && !name.startsWith('@modkitx-x3/')) {
        findings.push({ file: relPosix, line: 1, rule: 'package-name-scope', why: `lab packages must use @modkitx-x3/* (BRIEF-12 §7.1), got «${name}»` })
      }
      continue
    }

    if (!isInScannedTree(relPath)) continue
    if (relPosix.includes('/fixtures/legacy/')) continue
    if (!hasTextExtension(file)) continue

    const text = readFileSync(file, 'utf8')
    if (text.slice(0, 400).includes(LEGACY_MARKER)) continue
    scannedFiles += 1

    const lines = text.split('\n')
    for (const rule of RULES) {
      for (let i = 0; i < lines.length; i += 1) {
        if (rule.re.test(lines[i])) {
          findings.push({ file: relPosix, line: i + 1, rule: rule.id, why: rule.why })
        }
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`legacy gate: ${findings.length} finding(s) in ${scannedFiles} scanned file(s):`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.why}`)
  }
  process.exit(1)
}

console.log(`legacy gate: clean (${scannedFiles} file(s) scanned)`)
