#!/usr/bin/env node
// Layer-1 generated source inventory (PLAN_MODKIT_MK3_FINAL_RU.md §3.2, блок 10 работы 2–3).
//
// Reads the SEALED legacy oracle described by migration/oracle/legacy-oracle.lock.json and emits
// migration/generated/source-inventory.json — one accounting unit per legacy source row, with a
// stable hierarchical `sourceUnitId`, a source path relative to a named root, and the extracted
// fields the plan's §3.2 table asks for.
//
// Sealed state (never recomputed here, only enumerated):
//   index snapshot            git -C <legacyRoot> ls-files -z
//   minus worktree deletions  paths that no longer exist on disk (the 1029 ` D`/`MD`/`AD` rows of
//                             migration/oracle/legacy-oracle.pre-lock.status.txt)
//   plus sealed untracked     migration/oracle/legacy-oracle.pre-lock.untracked.txt (15 files)
// The legacy worktree IS the sealed state, so file contents are read from disk.
//
// Roots are named, never absolute: `legacy` and `docs` resolve through the uncommitted
// migration/oracle/local/legacy-environment.local.json (fallbacks
// ../references/modkitmk2 and ../references/modkit-docs).
//
// Determinism: no timestamps, no counters, no UUIDs inside the artifact. Freshness is proved by
// re-running the generator (`--check`), not by a recorded date.
//
// Usage:
//   node scripts/migration/emit-inventory.mjs            # write artifact + refresh lock.inventory
//   node scripts/migration/emit-inventory.mjs --check    # regenerate in memory and compare bytes

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { normalizeIdentifier } from './lib/identity-migration.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const lockPath = path.join(repoRoot, 'migration/oracle/legacy-oracle.lock.json')
const localDescriptorPath = path.join(
  repoRoot,
  'migration/oracle/local/legacy-environment.local.json',
)
const untrackedListPath = path.join(
  repoRoot,
  'migration/oracle/legacy-oracle.pre-lock.untracked.txt',
)
const artifactPath = path.join(repoRoot, 'migration/generated/source-inventory.json')
const check = process.argv.includes('--check')

/** Subtrees of the oracle lock this generator must never touch (owner-confirmed hashes). */
const FROZEN_LOCK_SECTIONS = [
  'schemaVersion',
  'legacy',
  'toolchain',
  'reproduction',
  'corpusEnvironment',
  'corpusDescriptors',
  'x3AtLock',
  'ownerConfirmation',
]

/** Control totals the first baseline must explain (plan §3.2 + блок 10 работа 3). */
const CONTROL_TOTALS = {
  codecManifests: 206,
  gameManifests: 31,
  manifestsTotal: 237,
  vscodeCommands: 64,
  vscodeCustomEditors: 11,
  vscodeLanguages: 8,
}

const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const sortedUnique = values => [...new Set(values ?? [])].sort(compareUtf8)
const slash = value => value.split(path.sep).join('/')
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const shortHash = value => sha256(Buffer.from(value, 'utf8')).slice(0, 8)

function fail(message) {
  console.error(`migration:${check ? 'check' : 'emit'}: ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------------------------
// Roots

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * A machine without the sealed oracle cannot regenerate the inventory. Plan block 10 exit gate:
 * such a run shows a visible `environment-required` state instead of a hidden skip — and instead of
 * a false ratchet failure. Emitting without the oracle is still an error.
 */
function environmentRequired(reason) {
  if (!check) fail(`environment-required — ${reason}`)
  console.log(
    `migration:check: environment-required — ${reason}; the source inventory was not re-verified on this machine`,
  )
  process.exit(0)
}

function resolveRoots() {
  let descriptor = {}
  if (existsSync(localDescriptorPath)) descriptor = readJson(localDescriptorPath)
  const legacy = path.resolve(
    repoRoot,
    descriptor.legacyRoot ?? path.join(repoRoot, '..', 'references', 'modkitmk2'),
  )
  const docs = path.resolve(
    repoRoot,
    descriptor.docsRoot ?? path.join(repoRoot, '..', 'references', 'modkit-docs'),
  )
  if (!existsSync(path.join(legacy, '.git'))) {
    environmentRequired(
      'sealed legacy oracle root is unavailable; set legacyRoot in migration/oracle/local/legacy-environment.local.json',
    )
  }
  if (!existsSync(path.join(docs, 'uv'))) {
    environmentRequired(
      'UV/Multiverse docs root is unavailable; set docsRoot in migration/oracle/local/legacy-environment.local.json',
    )
  }
  return { legacy, docs }
}

const roots = resolveRoots()
const lock = readJson(lockPath)

function legacyFile(relative) {
  return path.join(roots.legacy, relative)
}

function readLegacyJson(relative) {
  const normalizeLegacyValue = value => {
    if (Array.isArray(value)) return value.map(normalizeLegacyValue)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalizeLegacyValue(item)]),
      )
    }
    if (typeof value !== 'string') return value
    let normalized = value
    for (const family of ['package', 'qualified', 'source']) {
      normalized = normalizeIdentifier(normalized, { family }).value
    }
    return normalized
  }
  return normalizeLegacyValue(JSON.parse(readFileSync(legacyFile(relative), 'utf8')))
}

// ---------------------------------------------------------------------------------------------
// Sealed file set

function sealedLegacyFiles() {
  const indexed = execFileSync('git', ['-C', roots.legacy, 'ls-files', '-z'], {
    maxBuffer: 1 << 30,
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(slash)
  const present = indexed.filter(relative => existsSync(legacyFile(relative)))
  const untracked = readFileSync(untrackedListPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const marker = line.indexOf(' *')
      return marker === -1 ? line : line.slice(marker + 2)
    })
    .map(slash)
    .filter(relative => existsSync(legacyFile(relative)))
  return {
    tracked: present.sort(compareUtf8),
    untracked: untracked.sort(compareUtf8),
    indexedCount: indexed.length,
    worktreeDeletedCount: indexed.length - present.length,
  }
}

/**
 * The docs root is not a git repository, so the UV/Multiverse tree is walked directly. Only `uv/`
 * is in scope: the rest of the docs root is owner-authored prose with no inventory unit.
 */
function docsFiles() {
  const scope = path.join(roots.docs, 'uv')
  if (!existsSync(scope)) return []
  const found = []
  const walk = directory => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.name !== '.git' && entry.name !== 'node_modules')
      .sort((left, right) => compareUtf8(left.name, right.name))
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile()) found.push(slash(path.relative(roots.docs, absolute)))
    }
  }
  walk(scope)
  return found.sort(compareUtf8)
}

// ---------------------------------------------------------------------------------------------
// Unit collection

const units = []

function addUnit(unit) {
  units.push(unit)
}

// --- 1/2. codec and game manifests -------------------------------------------------------------

function matchSummary(match) {
  if (!match || typeof match !== 'object') return {}
  const summary = {}
  if (Array.isArray(match.extensions)) summary.extensions = sortedUnique(match.extensions)
  if (Array.isArray(match.pathGlobs)) summary.pathGlobs = sortedUnique(match.pathGlobs)
  if (Array.isArray(match.parentArtifacts))
    summary.parentArtifacts = sortedUnique(match.parentArtifacts)
  if (Array.isArray(match.magic)) summary.magicSignatures = match.magic.length
  if (Array.isArray(match.fileNames)) summary.fileNames = sortedUnique(match.fileNames)
  return summary
}

function runtimeSummary(variants) {
  return (variants ?? []).map(variant => {
    const entry = { id: variant.id }
    if (variant.availability !== undefined) entry.availability = variant.availability
    entry.environments = sortedUnique(variant.environments)
    entry.operatingSystems = sortedUnique(variant.operatingSystems)
    entry.architectures = sortedUnique(variant.architectures)
    if (variant.capabilities !== undefined) entry.capabilities = sortedUnique(variant.capabilities)
    if (variant.operations !== undefined) entry.operations = sortedUnique(variant.operations)
    entry.entrypoints = sortedUnique(Object.keys(variant.entrypoints ?? {}))
    return entry
  })
}

/** Legacy manifest v1 carries representations inside each declared trait. */
function traitSummary(traits) {
  return (traits ?? [])
    .map(trait => ({
      id: trait.id,
      representations: sortedUnique(trait.representations),
      state: trait.state ?? null,
    }))
    .sort((left, right) => compareUtf8(left.id, right.id))
}

/** `dependencies` is an object of relation → [{ id, range }], not a flat list. */
function dependencySummary(dependencies) {
  const summary = {}
  for (const relation of sortedUnique(Object.keys(dependencies ?? {}))) {
    summary[relation] = sortedUnique((dependencies[relation] ?? []).map(entry => entry.id))
  }
  return summary
}

function featureGroupSummary(groups) {
  const features = sortedUnique(Object.keys(groups ?? {}))
  const required = []
  const suggested = []
  for (const name of features) {
    const group = groups[name] ?? {}
    for (const entry of group.requires ?? []) required.push(entry.id)
    for (const entry of group.suggests ?? []) suggested.push(entry.id)
  }
  return { features, required: sortedUnique(required), suggested: sortedUnique(suggested) }
}

function collectCodecManifests(files) {
  const paths = files.filter(file => file.endsWith('/codec.manifest.json'))
  for (const relative of paths) {
    const manifest = readLegacyJson(relative)
    const manifestId = `${manifest.publisher}/${manifest.id}`
    const groups = featureGroupSummary(manifest.featureGroups)
    const traits = traitSummary(manifest.traits)
    addUnit({
      sourceUnitId: `legacy/codec-manifest/${manifestId}`,
      kind: 'codec-manifest',
      sourceRoot: 'legacy',
      path: relative,
      depth: 'resolved',
      extracted: {
        manifestId,
        id: manifest.id,
        publisher: manifest.publisher,
        version: manifest.version,
        contractVersion: manifest.contractVersion,
        kind: manifest.kind,
        status: manifest.status,
        displayName: manifest.displayName,
        operations: sortedUnique(manifest.operations),
        representations: sortedUnique(traits.flatMap(trait => trait.representations)),
        traits,
        capabilities: sortedUnique(manifest.capabilities),
        runtimes: runtimeSummary(manifest.runtimeVariants),
        sourceKinds: sortedUnique(manifest.sourceKinds),
        match: matchSummary(manifest.match),
        languages: sortedUnique((manifest.languages ?? []).map(entry => entry.id ?? entry)),
        companions: sortedUnique((manifest.companions ?? []).map(entry => entry.id ?? entry)),
        standards: sortedUnique(manifest.standards),
        testedGames: sortedUnique(manifest.testedGames),
        dependencies: dependencySummary(manifest.dependencies),
        featureGroups: groups.features,
        referenceCount: (manifest.references ?? []).length,
        limitationCount: (manifest.limitations ?? []).length,
      },
    })
  }
  return paths.length
}

function collectGameManifests(files) {
  const paths = files.filter(file => file.endsWith('/game.manifest.json'))
  for (const relative of paths) {
    const manifest = readLegacyJson(relative)
    const manifestId = `${manifest.publisher}/${manifest.id}`
    const groups = featureGroupSummary(manifest.featureGroups)
    addUnit({
      sourceUnitId: `legacy/game-manifest/${manifestId}`,
      kind: 'game-manifest',
      sourceRoot: 'legacy',
      path: relative,
      depth: 'resolved',
      extracted: {
        manifestId,
        gameId: manifest.id,
        publisher: manifest.publisher,
        version: manifest.version,
        status: manifest.status,
        displayName: manifest.displayName,
        discovery: {
          sourceKinds: sortedUnique(manifest.sourceKinds),
          match: matchSummary(manifest.match),
          runtimes: runtimeSummary(manifest.runtimeVariants),
        },
        formats: { required: groups.required, suggested: groups.suggested },
        features: groups.features,
        tested: sortedUnique(manifest.testedGames),
        capabilities: sortedUnique(manifest.capabilities),
        operations: sortedUnique(manifest.operations),
        limitationCount: (manifest.limitations ?? []).length,
      },
    })
  }
  return paths.length
}

// --- 3. package exports ------------------------------------------------------------------------

const RE_STAR_NS = /export\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s*['"]([^'"]+)['"]/g
const RE_STAR = /export\s+\*\s+from\s*['"]([^'"]+)['"]/g
const RE_EXPORT_LIST = /export\s+(?:type\s+)?\{([^}]*)\}/g
const RE_DECLARATION =
  /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g

function addSpecifier(specifier, symbols) {
  const text = specifier.trim()
  if (!text) return
  const aliased = /(?:^|\s)as\s+([A-Za-z0-9_$]+)$/.exec(text)
  const name = aliased ? aliased[1] : text.replace(/^type\s+/, '').trim()
  if (/^[A-Za-z0-9_$]+$/.test(name) && name !== 'default') symbols.add(name)
}

function resolveModule(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ''))
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function extractSymbols(entryFile) {
  const symbols = new Set()
  const unresolved = new Set()
  const visited = new Set()
  const queue = [entryFile]
  while (queue.length > 0) {
    const file = queue.shift()
    if (visited.has(file)) continue
    visited.add(file)
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      unresolved.add(slash(path.relative(roots.legacy, file)))
      continue
    }
    let matched
    RE_STAR_NS.lastIndex = 0
    while ((matched = RE_STAR_NS.exec(source)) !== null) symbols.add(matched[1])
    const namespaced = source.replace(RE_STAR_NS, '')
    RE_EXPORT_LIST.lastIndex = 0
    while ((matched = RE_EXPORT_LIST.exec(namespaced)) !== null) {
      for (const specifier of matched[1].split(',')) addSpecifier(specifier, symbols)
    }
    RE_DECLARATION.lastIndex = 0
    while ((matched = RE_DECLARATION.exec(namespaced)) !== null) symbols.add(matched[1])
    RE_STAR.lastIndex = 0
    while ((matched = RE_STAR.exec(namespaced)) !== null) {
      const specifier = matched[1]
      if (!specifier.startsWith('.')) {
        unresolved.add(specifier)
        continue
      }
      const target = resolveModule(file, specifier)
      if (target === undefined) unresolved.add(specifier)
      else queue.push(target)
    }
  }
  return { symbols: [...symbols].sort(compareUtf8), unresolved: [...unresolved].sort(compareUtf8) }
}

function conditionTarget(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  return value.import ?? value.default ?? value.require ?? value.types
}

function resolveEntrySource(packageDir, target) {
  const trimmed = target
    .replace(/^\.\//, '')
    .replace(/^dist\//, '')
    .replace(/\.d\.ts$/, '')
    .replace(/\.js$/, '')
  const bases = [trimmed, trimmed.replace(/^src\//, '')]
  const candidates = []
  for (const base of bases) {
    candidates.push(`src/${base}.ts`, `src/${base}/index.ts`, `${base}.ts`, `${base}/index.ts`)
  }
  for (const candidate of candidates) {
    const absolute = path.join(packageDir, candidate)
    if (existsSync(absolute)) return absolute
  }
  return undefined
}

/** Package manifests that describe publishable legacy surface (workspace roots, not fixtures). */
function packageManifestPaths(files) {
  return files.filter(
    file =>
      /^packages\/[^/]+\/package\.json$/.test(file) ||
      /^apps\/[^/]+\/package\.json$/.test(file) ||
      /^apps\/rts\/[^/]+\/package\.json$/.test(file),
  )
}

const packageIndex = new Map()

function collectPackageExports(files) {
  for (const relative of packageManifestPaths(files)) {
    const manifest = readLegacyJson(relative)
    const packageDir = path.dirname(legacyFile(relative))
    packageIndex.set(manifest.name, { manifestPath: relative, packageDir, manifest })
    const exportsField = manifest.exports
    if (!exportsField || typeof exportsField !== 'object') continue
    for (const [subpath, value] of Object.entries(exportsField)) {
      const target = conditionTarget(value)
      const conditions =
        typeof value === 'string' ? ['default'] : sortedUnique(Object.keys(value ?? {}))
      const unit = {
        sourceUnitId: `legacy/package-export/${manifest.name}#${subpath}`,
        kind: 'package-export',
        sourceRoot: 'legacy',
        path: relative,
        depth: 'shallow',
        extracted: {
          packageName: manifest.name,
          subpath,
          conditions,
          target: target ?? null,
          entrySource: null,
          symbols: [],
          symbolCount: 0,
          unresolvedReexports: [],
        },
      }
      if (subpath.includes('*') || target === undefined) {
        unit.extracted.resolution = subpath.includes('*') ? 'wildcard-subpath' : 'no-target'
        addUnit(unit)
        continue
      }
      if (!/\.(js|ts)$/.test(target)) {
        unit.extracted.resolution = 'non-module-asset'
        addUnit(unit)
        continue
      }
      const entry = resolveEntrySource(packageDir, target)
      if (entry === undefined) {
        unit.extracted.resolution = 'source-not-found'
        addUnit(unit)
        continue
      }
      const { symbols, unresolved } = extractSymbols(entry)
      unit.extracted.entrySource = slash(path.relative(roots.legacy, entry))
      unit.extracted.symbols = symbols
      unit.extracted.symbolCount = symbols.length
      unit.extracted.unresolvedReexports = unresolved
      unit.extracted.resolution = 'source-parsed'
      unit.depth = unresolved.length === 0 ? 'resolved' : 'shallow'
      addUnit(unit)
    }
  }
}

// --- 4. VS Code contributions ------------------------------------------------------------------

const VSCODE_MANIFEST = 'apps/modkit-vscode/package.json'
const NAMED_VSCODE_BUCKETS = new Set([
  'commands',
  'customEditors',
  'languages',
  'views',
  'menus',
  'configuration',
])

function collectVsCodeContributions() {
  const manifest = readLegacyJson(VSCODE_MANIFEST)
  const contributes = manifest.contributes ?? {}
  const counts = {
    commands: 0,
    customEditors: 0,
    languages: 0,
    views: 0,
    menus: 0,
    configuration: 0,
  }

  for (const command of contributes.commands ?? []) {
    counts.commands += 1
    addUnit({
      sourceUnitId: `legacy/vscode/command/${command.command}`,
      kind: 'vscode-command',
      sourceRoot: 'legacy',
      path: VSCODE_MANIFEST,
      depth: 'resolved',
      extracted: {
        command: command.command,
        title: command.title ?? null,
        category: command.category ?? null,
        icon: typeof command.icon === 'string' ? command.icon : command.icon ? 'themed' : null,
        enablement: command.enablement ?? null,
      },
    })
  }

  for (const editor of contributes.customEditors ?? []) {
    counts.customEditors += 1
    addUnit({
      sourceUnitId: `legacy/vscode/custom-editor/${editor.viewType}`,
      kind: 'vscode-custom-editor',
      sourceRoot: 'legacy',
      path: VSCODE_MANIFEST,
      depth: 'resolved',
      extracted: {
        viewType: editor.viewType,
        displayName: editor.displayName ?? null,
        priority: editor.priority ?? null,
        selectors: sortedUnique((editor.selector ?? []).map(entry => entry.filenamePattern ?? '*')),
      },
    })
  }

  for (const language of contributes.languages ?? []) {
    counts.languages += 1
    addUnit({
      sourceUnitId: `legacy/vscode/language/${language.id}`,
      kind: 'vscode-language',
      sourceRoot: 'legacy',
      path: VSCODE_MANIFEST,
      depth: 'resolved',
      extracted: {
        id: language.id,
        aliases: sortedUnique(language.aliases),
        extensions: sortedUnique(language.extensions),
        filenames: sortedUnique(language.filenames),
        configuration: language.configuration ?? null,
      },
    })
  }

  for (const [container, views] of Object.entries(contributes.views ?? {})) {
    for (const view of views) {
      counts.views += 1
      addUnit({
        sourceUnitId: `legacy/vscode/view/${container}/${view.id}`,
        kind: 'vscode-view',
        sourceRoot: 'legacy',
        path: VSCODE_MANIFEST,
        depth: 'resolved',
        extracted: {
          container,
          id: view.id,
          name: view.name ?? null,
          type: view.type ?? null,
          when: view.when ?? null,
        },
      })
    }
  }

  // Menu items carry no declared id; (menu, command) repeats for different `when` clauses, so the
  // duplicated keys — and only those — take a content-derived suffix. Pure function of the input.
  const menuKeyCounts = new Map()
  for (const [menu, items] of Object.entries(contributes.menus ?? {})) {
    for (const item of items) {
      const key = `${menu}/${item.command ?? item.submenu ?? 'unnamed'}`
      menuKeyCounts.set(key, (menuKeyCounts.get(key) ?? 0) + 1)
    }
  }
  for (const [menu, items] of Object.entries(contributes.menus ?? {})) {
    for (const item of items) {
      counts.menus += 1
      const key = `${menu}/${item.command ?? item.submenu ?? 'unnamed'}`
      const suffix = menuKeyCounts.get(key) > 1 ? `~${shortHash(JSON.stringify(item))}` : ''
      addUnit({
        sourceUnitId: `legacy/vscode/menu/${key}${suffix}`,
        kind: 'vscode-menu-item',
        sourceRoot: 'legacy',
        path: VSCODE_MANIFEST,
        depth: 'resolved',
        extracted: {
          menu,
          command: item.command ?? null,
          submenu: item.submenu ?? null,
          group: item.group ?? null,
          when: item.when ?? null,
        },
      })
    }
  }

  const sections = Array.isArray(contributes.configuration)
    ? contributes.configuration
    : contributes.configuration
      ? [contributes.configuration]
      : []
  for (const section of sections) {
    for (const [key, property] of Object.entries(section.properties ?? {})) {
      counts.configuration += 1
      addUnit({
        sourceUnitId: `legacy/vscode/configuration/${key}`,
        kind: 'vscode-configuration-property',
        sourceRoot: 'legacy',
        path: VSCODE_MANIFEST,
        depth: 'resolved',
        extracted: {
          key,
          section: section.title ?? null,
          type: Array.isArray(property.type) ? property.type.join('|') : (property.type ?? null),
          scope: property.scope ?? null,
          hasDefault: property.default !== undefined,
          enumValues: Array.isArray(property.enum) ? sortedUnique(property.enum.map(String)) : [],
        },
      })
    }
  }

  for (const [bucket, value] of Object.entries(contributes)) {
    if (NAMED_VSCODE_BUCKETS.has(bucket)) continue
    const entries = Array.isArray(value)
      ? value.map((entry, index) => [
          entry.id ?? entry.language ?? entry.type ?? entry.view ?? String(index),
          entry,
        ])
      : Object.entries(value ?? {})
    for (const [key, entry] of entries) {
      addUnit({
        sourceUnitId: `legacy/vscode/contribution/${bucket}/${key}`,
        kind: 'vscode-contribution',
        sourceRoot: 'legacy',
        path: VSCODE_MANIFEST,
        depth: 'shallow',
        extracted: {
          contributionType: bucket,
          key: String(key),
          label:
            typeof entry === 'object' && entry !== null
              ? (entry.label ?? entry.title ?? entry.description ?? null)
              : null,
        },
      })
    }
  }

  return counts
}

// --- 5. CLI ------------------------------------------------------------------------------------

const CLI_CATALOG = 'apps/modkit-cli/src/commands/catalog.ts'
const CLI_ENTRY = 'apps/modkit-cli/src/cli.ts'

/**
 * The legacy CLI contract is a plain `as const` data literal, so the array is sliced out and read
 * as data. Anything but data characters aborts instead of guessing.
 */
function readCliCatalog() {
  const source = readFileSync(legacyFile(CLI_CATALOG), 'utf8')
  const start = source.indexOf('[', source.indexOf('MODKIT_COMMANDS'))
  if (start === -1) fail(`${CLI_CATALOG}: MODKIT_COMMANDS array literal not found`)
  let depth = 0
  let end = -1
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === '[' || character === '{') depth += 1
    else if (character === ']' || character === '}') {
      depth -= 1
      if (depth === 0) {
        end = index + 1
        break
      }
    }
  }
  if (end === -1) fail(`${CLI_CATALOG}: MODKIT_COMMANDS array literal is unbalanced`)
  const literal = source.slice(start, end)
  if (/[`(]|=>|\bfunction\b|\bimport\b|\brequire\b/.test(literal)) {
    fail(`${CLI_CATALOG}: command catalog is no longer a plain data literal; extend the generator`)
  }
  return JSON.parse(
    literal
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([A-Za-z0-9_$]+)\s*:/g, '$1"$2":')
      .replace(/,(\s*[}\]])/g, '$1'),
  )
}

function collectCliCommands() {
  const commands = readCliCatalog()
  for (const command of commands) {
    const options = (command.options ?? []).map(option => ({
      name: option.name,
      kind: option.kind ?? null,
      values: sortedUnique(option.values),
    }))
    const positional = (command.arguments ?? []).map(argument => ({
      name: argument.name,
      required: argument.required === true,
      variadic: argument.variadic === true,
      values: sortedUnique(argument.values),
    }))
    addUnit({
      sourceUnitId: `legacy/cli/modkit/${command.id}`,
      kind: 'cli-command',
      sourceRoot: 'legacy',
      path: CLI_CATALOG,
      depth: 'resolved',
      extracted: {
        binary: 'modkit',
        command: command.id,
        title: command.title ?? null,
        arguments: positional,
        options,
        entry: CLI_ENTRY,
        outputContract: options.some(option => option.name === 'format')
          ? (options.find(option => option.name === 'format')?.values ?? [])
          : [],
      },
    })
    const actions = positional[0]?.values ?? []
    for (const action of actions) {
      addUnit({
        sourceUnitId: `legacy/cli/modkit/${command.id}/${action}`,
        kind: 'cli-subcommand',
        sourceRoot: 'legacy',
        path: CLI_CATALOG,
        depth: 'resolved',
        extracted: {
          binary: 'modkit',
          command: command.id,
          action,
          argumentName: positional[0]?.name ?? null,
        },
      })
    }
  }
  return commands.length
}

// --- 6. apps -----------------------------------------------------------------------------------

const APP_HOSTS = {
  '@modkit/model-viewer': 'browser-app',
  '@modkit/cli': 'node-cli',
  'vscode-modkit': 'vscode-extension',
  '@modkit/rts-client': 'browser-app',
  '@modkit/rts-server': 'node-server',
  '@modkit/rts-shared': 'shared-library',
}

function collectApps(files) {
  const manifests = files.filter(
    file =>
      /^apps\/[^/]+\/package\.json$/.test(file) || /^apps\/rts\/[^/]+\/package\.json$/.test(file),
  )
  for (const relative of manifests) {
    const manifest = readLegacyJson(relative)
    const appDir = path.posix.dirname(relative)
    const htmlEntries = files.filter(
      file => file.startsWith(`${appDir}/`) && file.endsWith('.html') && !file.includes('/test'),
    )
    addUnit({
      sourceUnitId: `legacy/app/${manifest.name}`,
      kind: 'app',
      sourceRoot: 'legacy',
      path: relative,
      depth: 'shallow',
      extracted: {
        packageName: manifest.name,
        host: APP_HOSTS[manifest.name] ?? 'unclassified',
        private: manifest.private === true,
        main: manifest.main ?? null,
        exportSubpaths: sortedUnique(Object.keys(manifest.exports ?? {})),
        binaries: sortedUnique(
          typeof manifest.bin === 'string' ? [manifest.name] : Object.keys(manifest.bin ?? {}),
        ),
        scripts: sortedUnique(Object.keys(manifest.scripts ?? {})),
        contributesVsCode: manifest.contributes !== undefined,
      },
    })
    for (const entry of htmlEntries) {
      addUnit({
        sourceUnitId: `legacy/app/${manifest.name}/route/${path.posix.basename(entry)}`,
        kind: 'app-route',
        sourceRoot: 'legacy',
        path: entry,
        depth: 'shallow',
        extracted: {
          packageName: manifest.name,
          routeKind: 'html-entry-point',
          document: path.posix.basename(entry),
        },
      })
    }
  }
  return manifests.length
}

// --- 7. scripts and workspace operations -------------------------------------------------------

const SCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.mjs', '.cjs', '.js', '.sh', '.ps1'])
const SCRIPT_ROLE_RULES = [
  [/bench|benchmark|soak|perf/, 'benchmark'],
  [/(^|[-/])(check|validate|audit|verify)|boundar|conformance/, 'validator'],
  [/generate|codegen|gen-|emit|prebuild|materialize|collect|inventory/, 'generator'],
  [/convert|extract|export|render|compare|diff|roundtrip|repack/, 'converter'],
  [/harness|smoke|probe|demo|preview|browser-launch|capture/, 'harness'],
  [/release|sync|update|enrich|rename|rebuild|prepare|clean/, 'release-operation'],
]

function scriptRole(name) {
  for (const [pattern, role] of SCRIPT_ROLE_RULES) {
    if (pattern.test(name)) return role
  }
  return 'tool'
}

function collectScriptTools(files) {
  const scripts = files.filter(
    file => file.startsWith('scripts/') && SCRIPT_EXTENSIONS.has(path.posix.extname(file)),
  )
  for (const relative of scripts) {
    const name = relative.slice('scripts/'.length)
    addUnit({
      sourceUnitId: `legacy/script/${name}`,
      kind: 'script-tool',
      sourceRoot: 'legacy',
      path: relative,
      depth: 'shallow',
      extracted: {
        name,
        role: scriptRole(name),
        language: path.posix.extname(relative).slice(1),
      },
    })
  }
  return scripts.length
}

function collectWorkspaceScripts() {
  const manifest = readLegacyJson('package.json')
  const entries = Object.entries(manifest.scripts ?? {})
  for (const [name, command] of entries) {
    const family = name.includes(':') ? name.slice(0, name.indexOf(':')) : name
    addUnit({
      sourceUnitId: `legacy/workspace-script/${name}`,
      kind: 'workspace-script',
      sourceRoot: 'legacy',
      path: 'package.json',
      depth: 'resolved',
      extracted: {
        name,
        family,
        role: scriptRole(name),
        command,
      },
    })
  }
  return entries.length
}

// --- 8. runtime / RTS capabilities --------------------------------------------------------------

const RUNTIME_SURFACES = [
  { domain: 'session', packageName: '@modkit/rts-shared', subpath: '.' },
  { domain: 'session', packageName: '@modkit/rts-shared', subpath: './session' },
  { domain: 'network', packageName: '@modkit/rts-shared', subpath: './net' },
  { domain: 'network', packageName: '@modkit/rts-shared', subpath: './protocol' },
  { domain: 'server', packageName: '@modkit/rts-server', subpath: '.' },
  { domain: 'server', packageName: '@modkit/rts-server', subpath: './internet' },
  { domain: 'simulation', packageName: '@modkit/world', subpath: '.' },
  { domain: 'runtime-registry', packageName: '@modkit/runtime', subpath: '.' },
  { domain: 'replay', packageName: '@modkit/replays-processing', subpath: '.' },
  { domain: 'replay', packageName: '@modkit/replays-processing', subpath: './operations' },
  { domain: 'save', packageName: '@modkit/saves-processing', subpath: '.' },
]

const SC2_RUNTIME_CODEC = 'extensions/blizzard/starcraft-2/codecs/sc2-runtime/codec.manifest.json'

function collectRuntimeCapabilities() {
  const byId = new Map(units.map(unit => [unit.sourceUnitId, unit]))
  let collected = 0
  for (const surface of RUNTIME_SURFACES) {
    const exportUnit = byId.get(`legacy/package-export/${surface.packageName}#${surface.subpath}`)
    if (exportUnit === undefined) {
      fail(
        `runtime surface ${surface.packageName}${surface.subpath} has no package-export unit; the legacy oracle moved`,
      )
    }
    collected += 1
    addUnit({
      sourceUnitId: `legacy/runtime/${surface.domain}/${surface.packageName}#${surface.subpath}`,
      kind: 'runtime-capability',
      sourceRoot: 'legacy',
      path: exportUnit.extracted.entrySource ?? exportUnit.path,
      // Exported symbols are evidence of surface, not proof of a user capability; block 10's
      // semantic registry is what turns these into capability rows.
      depth: 'shallow',
      extracted: {
        domain: surface.domain,
        packageName: surface.packageName,
        subpath: surface.subpath,
        exportUnitId: exportUnit.sourceUnitId,
        symbolCount: exportUnit.extracted.symbolCount,
        symbols: exportUnit.extracted.symbols,
      },
    })
  }
  const runtimeCodec = byId.get('legacy/codec-manifest/modkit/sc2-runtime')
  if (runtimeCodec !== undefined) {
    collected += 1
    addUnit({
      sourceUnitId: 'legacy/runtime/simulation/modkit/sc2-runtime',
      kind: 'runtime-capability',
      sourceRoot: 'legacy',
      path: SC2_RUNTIME_CODEC,
      depth: 'shallow',
      extracted: {
        domain: 'simulation',
        packageName: 'modkit/sc2-runtime',
        subpath: '.',
        exportUnitId: runtimeCodec.sourceUnitId,
        symbolCount: 0,
        symbols: [],
      },
    })
  }
  return collected
}

// --- 9. Multiverse / UV -------------------------------------------------------------------------

const UV_DOC_PREFIX = 'uv/'

function multiverseFamily(relative) {
  const rest = relative.slice(UV_DOC_PREFIX.length)
  if (!rest.startsWith('multiverse/')) return 'uv-root'
  const segments = rest.slice('multiverse/'.length).split('/')
  return segments.length > 1 ? segments[0] : 'foundation'
}

function multiverseKind(relative) {
  const base = path.posix.basename(relative)
  const stem = base.replace(/\.[^.]+$/, '')
  if (/(^|\/)schema\//.test(relative) && base.endsWith('.json')) return 'multiverse-schema'
  if (base.startsWith('SPEC_') && base.endsWith('.md')) return 'multiverse-specification'
  if (/(^|\/)examples\//.test(relative)) {
    if (base.endsWith('.md')) return 'multiverse-document'
    return /proof/i.test(stem) ? 'multiverse-proof' : 'multiverse-fixture'
  }
  if (base.endsWith('.md')) return 'multiverse-document'
  if (base.endsWith('.json')) return 'multiverse-fixture'
  return 'multiverse-asset'
}

function collectMultiverseDocs(files) {
  const selected = files.filter(file => file.startsWith(UV_DOC_PREFIX))
  const counts = {}
  for (const relative of selected) {
    const kind = multiverseKind(relative)
    counts[kind] = (counts[kind] ?? 0) + 1
    const family = multiverseFamily(relative)
    const rest = relative.slice(UV_DOC_PREFIX.length)
    addUnit({
      sourceUnitId: `docs/uv/${kind.replace('multiverse-', '')}/${rest}`,
      kind,
      sourceRoot: 'docs',
      path: relative,
      depth: 'shallow',
      extracted: {
        family,
        artifact: path.posix.basename(relative),
        // Path-derived only: prose edits inside a spec must not move the inventory.
        format: path.posix.extname(relative).slice(1),
      },
    })
  }
  return counts
}

const MULTIVERSE_TOOL_ROLES = [
  [/validate/, 'validator'],
  [/proof|artifact/, 'writer'],
  [/benchmark|bench/, 'benchmark'],
  [/boundar|check/, 'validator'],
]

function collectMultiverseTools(files) {
  const selected = files.filter(
    file =>
      SCRIPT_EXTENSIONS.has(path.posix.extname(file)) &&
      /(multiverse|world-v0|uv[mwdtspregyaifv]\b)/i.test(path.posix.basename(file)) &&
      !file.includes('.spec.') &&
      !file.includes('/test/'),
  )
  for (const relative of selected) {
    const base = path.posix.basename(relative)
    const role = MULTIVERSE_TOOL_ROLES.find(([pattern]) => pattern.test(base))?.[1] ?? 'application'
    addUnit({
      sourceUnitId: `legacy/multiverse-tool/${relative}`,
      kind: 'multiverse-tool',
      sourceRoot: 'legacy',
      path: relative,
      depth: 'shallow',
      extracted: { artifact: base, role },
    })
  }
  return selected.length
}

// ---------------------------------------------------------------------------------------------
// Build

const sealed = sealedLegacyFiles()
const legacyFiles = [...sealed.tracked, ...sealed.untracked].sort(compareUtf8)
const docs = docsFiles()

const codecCount = collectCodecManifests(legacyFiles)
const gameCount = collectGameManifests(legacyFiles)
collectPackageExports(legacyFiles)
const vscodeCounts = collectVsCodeContributions()
collectCliCommands()
collectApps(legacyFiles)
collectScriptTools(legacyFiles)
collectWorkspaceScripts()
collectRuntimeCapabilities()
collectMultiverseDocs(docs)
collectMultiverseTools(legacyFiles)

// --- control totals ----------------------------------------------------------------------------

const problems = []
if (codecCount !== CONTROL_TOTALS.codecManifests) {
  problems.push(`codec manifests: ${codecCount}, control total ${CONTROL_TOTALS.codecManifests}`)
}
if (gameCount !== CONTROL_TOTALS.gameManifests) {
  problems.push(`game manifests: ${gameCount}, control total ${CONTROL_TOTALS.gameManifests}`)
}
if (codecCount + gameCount !== CONTROL_TOTALS.manifestsTotal) {
  problems.push(
    `manifests total: ${codecCount + gameCount}, control total ${CONTROL_TOTALS.manifestsTotal}`,
  )
}
if (vscodeCounts.commands !== CONTROL_TOTALS.vscodeCommands) {
  problems.push(
    `VS Code commands: ${vscodeCounts.commands}, control total ${CONTROL_TOTALS.vscodeCommands}`,
  )
}
if (vscodeCounts.customEditors !== CONTROL_TOTALS.vscodeCustomEditors) {
  problems.push(
    `VS Code custom editors: ${vscodeCounts.customEditors}, control total ${CONTROL_TOTALS.vscodeCustomEditors}`,
  )
}
if (vscodeCounts.languages !== CONTROL_TOTALS.vscodeLanguages) {
  problems.push(
    `VS Code languages: ${vscodeCounts.languages}, control total ${CONTROL_TOTALS.vscodeLanguages}`,
  )
}
if (problems.length > 0) {
  fail(
    `source unit control totals not explained — STOP, do not adjust the totals:\n  ${problems.join('\n  ')}`,
  )
}

const seenIds = new Set()
for (const unit of units) {
  if (seenIds.has(unit.sourceUnitId)) fail(`duplicate sourceUnitId ${unit.sourceUnitId}`)
  seenIds.add(unit.sourceUnitId)
}

units.sort(
  (left, right) =>
    compareUtf8(left.kind, right.kind) || compareUtf8(left.sourceUnitId, right.sourceUnitId),
)

const byKind = {}
for (const unit of units) byKind[unit.kind] = (byKind[unit.kind] ?? 0) + 1
const byRoot = {}
for (const unit of units) byRoot[unit.sourceRoot] = (byRoot[unit.sourceRoot] ?? 0) + 1
const byDepth = {}
for (const unit of units) byDepth[unit.depth] = (byDepth[unit.depth] ?? 0) + 1

const inventoryDocument = {
  $comment:
    'Generated by scripts/migration/emit-inventory.mjs (pnpm migration:emit). Do not edit by hand. Layer-1 source inventory of the sealed legacy oracle: PLAN_MODKIT_MK3_FINAL_RU.md §3.2, блок 10 работы 2–3. Deliberately timestamp-free: freshness is proved by re-running the generator (pnpm migration:check), not by a recorded date.',
  schemaVersion: 'source-inventory-1',
  generator: 'scripts/migration/emit-inventory.mjs',
  oracleLock: 'migration/oracle/legacy-oracle.lock.json',
  oracle: {
    legacyHeadCommit: lock.legacy.headCommit,
    sealedIndexEntries: sealed.indexedCount,
    sealedWorktreeDeletions: sealed.worktreeDeletedCount,
    sealedTrackedFiles: sealed.tracked.length,
    sealedUntrackedFiles: sealed.untracked.length,
    sealedFiles: sealed.tracked.length + sealed.untracked.length,
  },
  roots: {
    legacy: 'environment-descriptor:legacyRoot',
    docs: 'environment-descriptor:docsRoot',
  },
  fieldNotes: {
    representations:
      'codec-manifest.v1 declares representations inside each trait (`traits[].representations`). Each codec unit keeps the per-trait detail and the flattened union; nothing is invented for a manifest that declares no traits.',
    packageExportSymbols:
      'Symbols come from a static read of the exported entry module and its relative `export *` chain. `unresolvedReexports` lists cross-package or unresolvable re-exports; such units stay depth: shallow.',
    runtimeCapability:
      'Runtime/RTS units mirror exported surface, not proven user capability; every one is depth: shallow until the semantic registry assigns obligation and evidence.',
    multiverse:
      'UV/Multiverse units are path-derived only (family, artifact, format) so that prose edits inside a specification do not move the inventory.',
    cliDepth:
      'The legacy CLI contract is a static `as const` catalog, so commands, positional arguments, option kinds and enumerated values are fully extracted (depth: resolved).',
  },
  controlTotals: CONTROL_TOTALS,
  counts: {
    total: units.length,
    byKind: Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => compareUtf8(a, b))),
    bySourceRoot: Object.fromEntries(Object.entries(byRoot).sort(([a], [b]) => compareUtf8(a, b))),
    byDepth: Object.fromEntries(Object.entries(byDepth).sort(([a], [b]) => compareUtf8(a, b))),
  },
  units,
}

// ---------------------------------------------------------------------------------------------
// Render, compare, write

const prettierOptions = await resolveConfig(artifactPath)
const rendered = await format(JSON.stringify(inventoryDocument), {
  ...prettierOptions,
  parser: 'json',
})
const renderedSha256 = sha256(Buffer.from(rendered, 'utf8'))

const inventorySection = {
  $comment:
    'Owned by scripts/migration/emit-inventory.mjs; refreshed by pnpm migration:emit and verified by pnpm migration:check. The legacy hashes above are never recomputed by this generator.',
  artifact: 'migration/generated/source-inventory.json',
  artifactSha256: renderedSha256,
  sealedState: inventoryDocument.oracle,
  commands: {
    emit: 'pnpm migration:emit',
    check: 'pnpm migration:check',
    enumerateSealedTracked: 'git -C <legacyRoot> ls-files -z',
    filterSealedTracked:
      'keep only index paths that still exist in the legacy worktree (drops the worktree deletions recorded in migration/oracle/legacy-oracle.pre-lock.status.txt)',
    enumerateSealedUntracked:
      'read migration/oracle/legacy-oracle.pre-lock.untracked.txt (sha256 *path lines)',
    enumerateDocs:
      'walk <docsRoot>/uv recursively (the docs root is not a git repository); sort paths in UTF-8 byte order',
  },
  patterns: {
    'codec-manifest': 'legacy **/codec.manifest.json',
    'game-manifest': 'legacy **/game.manifest.json',
    'package-export':
      'legacy packages/*/package.json, apps/*/package.json, apps/rts/*/package.json → exports',
    'vscode-*': 'legacy apps/modkit-vscode/package.json → contributes',
    'cli-*': 'legacy apps/modkit-cli/src/commands/catalog.ts → MODKIT_COMMANDS',
    'app, app-route':
      'legacy apps/*/package.json, apps/rts/*/package.json + their *.html entry points',
    'script-tool': 'legacy scripts/**/*.{ts,mts,mjs,cjs,js,sh,ps1}',
    'workspace-script': 'legacy package.json → scripts',
    'runtime-capability':
      'legacy rts-shared/rts-server/world/runtime/replays/saves exports + sc2-runtime codec',
    'multiverse-*':
      'docs uv/** (specs, schema, examples, proofs) + legacy multiverse/world-v0 tools',
  },
  controlTotals: CONTROL_TOTALS,
  counts: inventoryDocument.counts,
}

const lockText = await readFile(lockPath, 'utf8')
const lockDocument = JSON.parse(lockText)
const frozenBefore = JSON.stringify(
  Object.fromEntries(FROZEN_LOCK_SECTIONS.map(key => [key, lockDocument[key]])),
)
lockDocument.inventory = inventorySection
const frozenAfter = JSON.stringify(
  Object.fromEntries(FROZEN_LOCK_SECTIONS.map(key => [key, lockDocument[key]])),
)
if (frozenBefore !== frozenAfter) fail('oracle lock frozen sections changed; refusing to write')
const lockPrettierOptions = await resolveConfig(lockPath)
const renderedLock = await format(JSON.stringify(lockDocument), {
  ...lockPrettierOptions,
  parser: 'json',
})

if (check) {
  let existing = ''
  try {
    existing = await readFile(artifactPath, 'utf8')
  } catch {
    fail('migration/generated/source-inventory.json is missing; run pnpm migration:emit')
  }
  if (existing !== rendered) {
    fail(
      'migration/generated/source-inventory.json is stale or non-deterministic; run pnpm migration:emit',
    )
  }
  if (lockText !== renderedLock) {
    fail(
      'migration/oracle/legacy-oracle.lock.json inventory section is stale; run pnpm migration:emit',
    )
  }
  const lockCounts = JSON.stringify(lock.inventory?.counts ?? null)
  if (lockCounts !== JSON.stringify(inventoryDocument.counts)) {
    fail('oracle lock inventory counters do not match the generated inventory')
  }
  if (lock.inventory?.artifactSha256 !== renderedSha256) {
    fail('oracle lock inventory artifactSha256 does not match the generated inventory')
  }
  console.log(
    `migration:check: ${units.length} source units up to date (${codecCount} codec + ${gameCount} game manifests = ${codecCount + gameCount}; VS Code ${vscodeCounts.commands}/${vscodeCounts.customEditors}/${vscodeCounts.languages} commands/editors/languages)`,
  )
} else {
  await mkdir(path.dirname(artifactPath), { recursive: true })
  await writeFile(artifactPath, rendered, 'utf8')
  await writeFile(lockPath, renderedLock, 'utf8')
  console.log(
    `migration:emit: wrote ${units.length} source units across ${Object.keys(byKind).length} kinds (${codecCount} codec + ${gameCount} game manifests = ${codecCount + gameCount})`,
  )
}
