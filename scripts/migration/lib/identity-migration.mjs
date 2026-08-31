import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'

export const IDENTITY_MIGRATION_SCHEMA_VERSION = 1

export const IDENTITY_MIGRATION_RULES = Object.freeze([
  Object.freeze({
    id: 'package-scope:modkitx-x3',
    family: 'package',
    kind: 'prefix',
    from: '@modkitx-x3/',
    to: '@modkit/',
  }),
  Object.freeze({
    id: 'package-scope:modkitx',
    family: 'package',
    kind: 'prefix',
    from: '@modkitx/',
    to: '@modkit/',
  }),
  Object.freeze({
    id: 'game-id:starcraft-2',
    family: 'qualified',
    kind: 'exact',
    from: 'org.modkitx/starcraft-2',
    to: 'blizzard/starcraft-2',
  }),
  Object.freeze({
    id: 'game-id:warzone-2100',
    family: 'qualified',
    kind: 'exact',
    from: 'org.modkitx/warzone-2100',
    to: 'wz2100project/warzone-2100',
  }),
  Object.freeze({
    id: 'vendor-extension:spring-recoil',
    family: 'qualified',
    kind: 'exact',
    from: 'org.modkitx.opensource/spring',
    to: 'spring/recoil',
  }),
  Object.freeze({
    id: 'vendor-extension:warzone-2100',
    family: 'qualified',
    kind: 'exact',
    from: 'org.modkitx.opensource/warzone-2100',
    to: 'wz2100project/warzone-2100',
  }),
  Object.freeze({
    id: 'vendor-publisher:blizzard',
    family: 'qualified',
    kind: 'prefix',
    from: 'org.modkitx.blizzard/',
    to: 'blizzard/',
  }),
  Object.freeze({
    id: 'vendor-publisher:ea',
    family: 'qualified',
    kind: 'prefix',
    from: 'org.modkitx.ea/',
    to: 'ea/',
  }),
  Object.freeze({
    id: 'builtin-id:slash',
    family: 'qualified',
    kind: 'prefix',
    from: 'org.modkitx/',
    to: 'modkit/',
  }),
  Object.freeze({
    id: 'builtin-id:dotted',
    family: 'qualified',
    kind: 'prefix',
    from: 'org.modkitx.',
    to: 'modkit.',
  }),
  Object.freeze({
    id: 'source-id:blizzard',
    family: 'source',
    kind: 'exact',
    from: 'org.modkitx.blizzard',
    to: 'blizzard',
  }),
  Object.freeze({
    id: 'source-id:ea',
    family: 'source',
    kind: 'exact',
    from: 'org.modkitx.ea',
    to: 'ea',
  }),
  Object.freeze({
    id: 'source-id:opensource',
    family: 'source',
    kind: 'exact',
    from: 'org.modkitx.opensource',
    to: 'opensource',
  }),
  Object.freeze({
    id: 'source-id:modkit',
    family: 'source',
    kind: 'exact',
    from: 'org.modkitx',
    to: 'modkit',
  }),
])

const QUALIFIED_ID =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/u
const PACKAGE_SPECIFIER = /^@modkitx(?:-x3)?\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._~/-]+)?$/u

const HISTORICAL_PATH_RULES = Object.freeze([
  Object.freeze({ segment: 'reports', reason: 'report/audit artifact' }),
  Object.freeze({ segment: 'vendor', reason: 'vendor snapshot' }),
  Object.freeze({ prefix: 'migration/history/', reason: 'historical migration record' }),
  Object.freeze({ prefix: 'migration/oracle/', reason: 'sealed legacy oracle' }),
  Object.freeze({ contains: '/fixtures/', reason: 'test fixture or legacy-input fixture' }),
])

const EXCLUDED_SCAN_DIRECTORIES = new Set([
  '.git',
  '.pnpm-store',
  '.tmp',
  'dist',
  'dist-app',
  'node_modules',
  'out',
])

const DEFAULT_DISCOVERY_NAMES = new Set([
  'modkit.extensions.lock.json',
  'modkit.extensions.full.lock.json',
  'modkit.settings.json',
  'settings.json',
  'bundled-catalog.json',
  'extension-catalog.json',
])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJson(value) {
  if (Array.isArray(value)) return value.map(item => cloneJson(item))
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]))
}

function pathText(path) {
  if (path.length === 0) return '$'
  let out = '$'
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment)) {
      out += `.${segment}`
    } else {
      out += `[${JSON.stringify(segment)}]`
    }
  }
  return out
}

function splitCoordinate(value) {
  const slash = value.indexOf('/')
  return slash === -1 ? undefined : [value.slice(0, slash), value.slice(slash + 1)]
}

function activeRulesFor(family) {
  return IDENTITY_MIGRATION_RULES.filter(rule => rule.family === family)
}

function applyRule(value, rule) {
  if (rule.kind === 'exact') return value === rule.from ? rule.to : undefined
  if (!value.startsWith(rule.from)) return undefined
  return `${rule.to}${value.slice(rule.from.length)}`
}

export function normalizeIdentifier(value, options = {}) {
  if (typeof value !== 'string') return Object.freeze({ value, changed: false })
  const family = options.family ?? 'qualified'
  for (const rule of activeRulesFor(family)) {
    const next = applyRule(value, rule)
    if (next === undefined) continue
    return Object.freeze({ value: next, changed: next !== value, rule: rule.id })
  }
  return Object.freeze({ value, changed: false })
}

export function isLegacyIdentifier(value) {
  return (
    typeof value === 'string' &&
    (value === 'org.modkitx' ||
      value.startsWith('@modkitx-x3/') ||
      value.startsWith('@modkitx/') ||
      value.startsWith('org.modkitx/') ||
      value.startsWith('org.modkitx.'))
  )
}

function containsLegacyIdentifier(value) {
  if (typeof value === 'string') return isLegacyIdentifier(value)
  if (Array.isArray(value)) return value.some(item => containsLegacyIdentifier(item))
  if (!isRecord(value)) return false
  return Object.values(value).some(item => containsLegacyIdentifier(item))
}

function recordChange(state, path, from, to, rule, family) {
  state.changes.push(Object.freeze({ path: pathText(path), from, to, rule, family }))
}

function recordSkippedReference(state, path, reason) {
  state.skippedReferences.push(Object.freeze({ path: pathText(path), reason }))
}

function recordCollision(state, path, target, sources, reason) {
  state.collisions.push(
    Object.freeze({
      path: pathText(path),
      target,
      sources: Object.freeze([...sources].sort()),
      reason,
    }),
  )
}

function migrateStringValue(state, container, key, path, family) {
  if (!isRecord(container) || typeof container[key] !== 'string') return
  const before = container[key]
  const result = normalizeIdentifier(before, { family })
  if (!result.changed) return
  container[key] = result.value
  recordChange(state, path, before, result.value, result.rule, family)
}

function migratePackageSpecifier(state, container, key, path) {
  if (!isRecord(container) || typeof container[key] !== 'string') return
  const before = container[key]
  if (!PACKAGE_SPECIFIER.test(before)) return
  const result = normalizeIdentifier(before, { family: 'package' })
  if (!result.changed) return
  container[key] = result.value
  recordChange(state, path, before, result.value, result.rule, 'package')
}

function arrayTargetCollisions(values, family) {
  const byTarget = new Map()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const target = normalizeIdentifier(value, { family }).value
    const originals = byTarget.get(target) ?? new Set()
    originals.add(value)
    byTarget.set(target, originals)
  }
  return [...byTarget]
    .filter(([, originals]) => originals.size > 1)
    .map(([target, originals]) => [target, [...originals]])
}

function migrateStringArray(state, container, key, path, family) {
  if (!isRecord(container) || !Array.isArray(container[key])) return
  const values = container[key]
  const collisions = arrayTargetCollisions(values, family)
  if (collisions.length > 0) {
    for (const [target, sources] of collisions) {
      recordCollision(state, path, target, sources, 'multiple identifiers normalize to one value')
    }
    return
  }
  const next = values.map((value, index) => {
    if (typeof value !== 'string') return value
    const result = normalizeIdentifier(value, { family })
    if (!result.changed) return value
    recordChange(state, [...path, index], value, result.value, result.rule, family)
    return result.value
  })
  container[key] = next
}

function migrateRecordKeys(state, container, key, path, family) {
  if (!isRecord(container) || !isRecord(container[key])) return
  const record = container[key]
  const mapped = []
  const byTarget = new Map()
  for (const [source, value] of Object.entries(record)) {
    const result = normalizeIdentifier(source, { family })
    const target = result.value
    const originals = byTarget.get(target) ?? new Set()
    originals.add(source)
    byTarget.set(target, originals)
    mapped.push([source, target, value, result])
  }
  const collisions = [...byTarget].filter(([, originals]) => originals.size > 1)
  if (collisions.length > 0) {
    for (const [target, sources] of collisions) {
      recordCollision(
        state,
        path,
        target,
        [...sources],
        'multiple object keys normalize to one key',
      )
    }
    return
  }
  const next = {}
  let changed = false
  for (const [source, target, value, result] of mapped) {
    next[target] = value
    if (source !== target) {
      changed = true
      recordChange(state, [...path, source], source, target, result.rule, family)
    }
  }
  if (changed) container[key] = next
}

function migratePublisherIdPair(state, record, path) {
  if (!isRecord(record) || typeof record.publisher !== 'string' || typeof record.id !== 'string') {
    return
  }
  const before = `${record.publisher}/${record.id}`
  if (!QUALIFIED_ID.test(before)) return
  const result = normalizeIdentifier(before, { family: 'qualified' })
  if (!result.changed) return
  const split = splitCoordinate(result.value)
  if (split === undefined) return
  record.publisher = split[0]
  record.id = split[1]
  recordChange(state, [...path, 'publisher'], before, result.value, result.rule, 'qualified')
}

function migrateExtensionSettings(state, document) {
  if (!Array.isArray(document.extensions)) return
  const idTargets = new Map()
  for (const item of document.extensions) {
    if (!isRecord(item) || typeof item.id !== 'string') continue
    const target = normalizeIdentifier(item.id, { family: 'qualified' }).value
    const originals = idTargets.get(target) ?? new Set()
    originals.add(item.id)
    idTargets.set(target, originals)
  }
  const collisions = [...idTargets].filter(([, originals]) => originals.size > 1)
  if (collisions.length > 0) {
    for (const [target, sources] of collisions) {
      recordCollision(
        state,
        ['extensions'],
        target,
        [...sources],
        'settings extension entries would share one id',
      )
    }
    return
  }
  for (const [index, item] of document.extensions.entries()) {
    if (!isRecord(item)) continue
    migrateStringValue(state, item, 'id', ['extensions', index, 'id'], 'qualified')
    migratePackageSpecifier(state, item, 'path', ['extensions', index, 'path'])
  }
}

function migrateSettingsDocument(state, document) {
  migrateExtensionSettings(state, document)
  migrateStringArray(state, document, 'disabledExtensions', ['disabledExtensions'], 'qualified')
  migrateStringArray(
    state,
    document,
    'disabledContributions',
    ['disabledContributions'],
    'qualified',
  )
  migrateRecordKeys(state, document, 'gameInstallations', ['gameInstallations'], 'qualified')
}

function lockEntryKey(entry) {
  if (!isRecord(entry)) return undefined
  const id =
    typeof entry.id === 'string'
      ? normalizeIdentifier(entry.id, { family: 'qualified' }).value
      : undefined
  const version = typeof entry.version === 'string' ? entry.version : undefined
  return id === undefined || version === undefined ? undefined : `${id}\u0000${version}`
}

function detectExtensionLockCollisions(state, entries) {
  const byTarget = new Map()
  for (const entry of entries) {
    const key = lockEntryKey(entry)
    if (key === undefined || !isRecord(entry) || typeof entry.id !== 'string') continue
    const originals = byTarget.get(key) ?? new Set()
    originals.add(entry.id)
    byTarget.set(key, originals)
  }
  for (const [key, sources] of byTarget) {
    if (sources.size <= 1) continue
    const [id, version] = key.split('\u0000')
    recordCollision(
      state,
      ['extensions'],
      `${id}@${version}`,
      [...sources],
      'extension lock entries would share one id/version',
    )
  }
}

function migrateExtensionLockDocument(state, document) {
  if (!Array.isArray(document.extensions)) return
  detectExtensionLockCollisions(state, document.extensions)
  if (state.collisions.length > 0) return
  for (const [index, entry] of document.extensions.entries()) {
    if (!isRecord(entry)) continue
    migrateStringValue(state, entry, 'id', ['extensions', index, 'id'], 'qualified')
    migrateStringValue(state, entry, 'source', ['extensions', index, 'source'], 'source')
  }
}

function migrateSelection(state, selection, path) {
  if (!isRecord(selection)) return
  migrateStringValue(state, selection, 'extension', [...path, 'extension'], 'qualified')
  migrateStringValue(state, selection, 'extensionId', [...path, 'extensionId'], 'qualified')
  migrateStringValue(state, selection, 'contributionId', [...path, 'contributionId'], 'qualified')
}

function detectPolicyLockCollisions(state, entries) {
  const byKey = new Map()
  for (const [index, raw] of entries.entries()) {
    if (!isRecord(raw)) continue
    const copy = cloneJson(raw)
    const nestedState = { changes: [], collisions: [], skippedReferences: [] }
    migratePolicyLockEntry(nestedState, copy, index)
    if (!isRecord(copy.key)) continue
    const key = JSON.stringify(copy.key)
    const rendered = JSON.stringify(copy)
    const prior = byKey.get(key)
    if (prior !== undefined && prior.rendered !== rendered) {
      recordCollision(
        state,
        ['entries'],
        key,
        [prior.index, index].map(String),
        'policy lock entries would share one key but select differently',
      )
    } else {
      byKey.set(key, { index, rendered })
    }
  }
}

function migratePolicyLockEntry(state, entry, index) {
  if (!isRecord(entry)) return
  const key = entry.key
  if (isRecord(key)) {
    migrateStringValue(state, key, 'contract', ['entries', index, 'key', 'contract'], 'qualified')
    migrateStringValue(state, key, 'operation', ['entries', index, 'key', 'operation'], 'qualified')
    for (const field of ['requiredOutputs', 'preferredOutputs']) {
      if (!Array.isArray(key[field])) continue
      for (const [outputIndex, output] of key[field].entries()) {
        if (!isRecord(output)) continue
        migrateStringValue(
          state,
          output,
          'id',
          ['entries', index, 'key', field, outputIndex, 'id'],
          'qualified',
        )
      }
    }
  }
  migrateSelection(state, entry.primary, ['entries', index, 'primary'])
  if (Array.isArray(entry.allowedFallbacks)) {
    for (const [fallbackIndex, fallback] of entry.allowedFallbacks.entries()) {
      migrateSelection(state, fallback, ['entries', index, 'allowedFallbacks', fallbackIndex])
    }
  }
}

function migratePolicyLockDocument(state, document) {
  if (!Array.isArray(document.entries)) return
  detectPolicyLockCollisions(state, document.entries)
  if (state.collisions.length > 0) return
  for (const [index, entry] of document.entries.entries()) {
    migratePolicyLockEntry(state, entry, index)
  }
}

function migrateCatalogRoot(state, root, path) {
  if (!isRecord(root)) return
  migrateStringValue(state, root, 'coordinate', [...path, 'coordinate'], 'qualified')
  migrateStringValue(state, root, 'extensionId', [...path, 'extensionId'], 'qualified')
  migrateStringValue(state, root, 'contributionId', [...path, 'contributionId'], 'qualified')
  migrateStringValue(state, root, 'contract', [...path, 'contract'], 'qualified')
  migrateStringValue(state, root, 'source', [...path, 'source'], 'source')
  migratePublisherIdPair(state, root, path)
  migrateStringArray(state, root, 'contributions', [...path, 'contributions'], 'qualified')
}

function migrateCatalogExtensionEntry(state, entry, path) {
  if (!isRecord(entry)) return
  const hasSealedArtifact =
    isRecord(entry.artifact) || isRecord(entry.containers) || Array.isArray(entry.documents)
  if (hasSealedArtifact) {
    for (const key of ['artifact', 'containers', 'documents', 'documentDigests', 'fileDigests']) {
      if (entry[key] !== undefined && containsLegacyIdentifier(entry[key])) {
        recordSkippedReference(state, [...path, key], 'sealed artifact snapshot')
      }
    }
  }
  migrateStringValue(state, entry, 'id', [...path, 'id'], 'qualified')
  migrateCatalogRoot(state, entry, path)
}

function migrateCatalogDocument(state, document) {
  if (Array.isArray(document.roots)) {
    for (const [index, root] of document.roots.entries()) {
      migrateCatalogRoot(state, root, ['roots', index])
    }
  }
  if (Array.isArray(document.extensions)) {
    for (const [index, entry] of document.extensions.entries()) {
      migrateCatalogExtensionEntry(state, entry, ['extensions', index])
    }
  }
}

export function migrateIdentityDocument(input, options = {}) {
  const documentKind = options.documentKind ?? 'catalog'
  const document = cloneJson(input)
  const state = {
    changes: [],
    collisions: [],
    skippedReferences: [],
  }
  if (!isRecord(document)) {
    return Object.freeze({
      schemaVersion: IDENTITY_MIGRATION_SCHEMA_VERSION,
      document,
      documentKind,
      changed: false,
      writable: true,
      changes: Object.freeze([]),
      collisions: Object.freeze([]),
      skippedReferences: Object.freeze([]),
    })
  }

  if (documentKind === 'settings') migrateSettingsDocument(state, document)
  else if (documentKind === 'extension-lock') migrateExtensionLockDocument(state, document)
  else if (documentKind === 'policy-lock') migratePolicyLockDocument(state, document)
  else if (documentKind === 'catalog') migrateCatalogDocument(state, document)
  else throw new Error(`unknown identity document kind: ${documentKind}`)

  return Object.freeze({
    schemaVersion: IDENTITY_MIGRATION_SCHEMA_VERSION,
    document,
    documentKind,
    changed: state.changes.length > 0,
    writable: state.collisions.length === 0,
    changes: Object.freeze(state.changes),
    collisions: Object.freeze(state.collisions),
    skippedReferences: Object.freeze(state.skippedReferences),
  })
}

export function parseIdentityJson(text, label = 'identity document') {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export function renderIdentityJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function toPosixRelative(path, root) {
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(path)
  const rel = relative(absoluteRoot, absolutePath).split(sep).join('/')
  return rel === '' ? basename(absolutePath) : rel
}

export function historicalIdentityPathReason(path, root = process.cwd()) {
  const rel = toPosixRelative(path, root)
  const normalized = rel.toLowerCase()
  const segments = normalized.split('/')
  const first = normalized.split('/')[0]
  for (const rule of HISTORICAL_PATH_RULES) {
    if (rule.segment !== undefined && (first === rule.segment || segments.includes(rule.segment))) {
      return rule.reason
    }
    if (rule.prefix !== undefined && normalized.startsWith(rule.prefix)) return rule.reason
    if (rule.contains !== undefined && normalized.includes(rule.contains)) return rule.reason
  }
  return undefined
}

export function classifyIdentityDocumentPath(path, options = {}) {
  const root = options.root ?? process.cwd()
  const forcedKind = options.documentKind
  const historicalReason = historicalIdentityPathReason(path, root)
  if (historicalReason !== undefined && options.forceHistorical !== true) {
    return Object.freeze({ status: 'skipped', reason: historicalReason })
  }
  if (forcedKind !== undefined)
    return Object.freeze({ status: 'recognized', documentKind: forcedKind })

  const name = basename(path)
  const lower = name.toLowerCase()
  if (lower === 'modkit.extensions.lock.json' || lower === 'modkit.extensions.full.lock.json') {
    return Object.freeze({ status: 'recognized', documentKind: 'extension-lock' })
  }
  if (lower === 'modkit.settings.json' || lower === 'settings.json') {
    return Object.freeze({ status: 'recognized', documentKind: 'settings' })
  }
  if (lower.endsWith('.policy-lock.json')) {
    return Object.freeze({ status: 'recognized', documentKind: 'policy-lock' })
  }
  if (lower === 'bundled-catalog.json' || lower === 'extension-catalog.json') {
    return Object.freeze({ status: 'recognized', documentKind: 'catalog' })
  }
  return Object.freeze({ status: 'skipped', reason: 'unrecognized identity document path' })
}

export function migrateIdentityFile(path, options = {}) {
  const root = options.root ?? process.cwd()
  const rel = toPosixRelative(path, root)
  const classification = classifyIdentityDocumentPath(path, options)
  if (classification.status === 'skipped') {
    return Object.freeze({
      schemaVersion: IDENTITY_MIGRATION_SCHEMA_VERSION,
      path: rel,
      status: 'skipped',
      reason: classification.reason,
      mode: options.write === true ? 'write' : 'audit',
      changes: Object.freeze([]),
      collisions: Object.freeze([]),
      skippedReferences: Object.freeze([]),
    })
  }

  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return Object.freeze({
      schemaVersion: IDENTITY_MIGRATION_SCHEMA_VERSION,
      path: rel,
      status: 'error',
      documentKind: classification.documentKind,
      reason: error instanceof Error ? error.message : String(error),
      mode: options.write === true ? 'write' : 'audit',
      changes: Object.freeze([]),
      collisions: Object.freeze([]),
      skippedReferences: Object.freeze([]),
    })
  }

  let parsed
  try {
    parsed = parseIdentityJson(text, rel)
  } catch (error) {
    return Object.freeze({
      schemaVersion: IDENTITY_MIGRATION_SCHEMA_VERSION,
      path: rel,
      status: 'error',
      documentKind: classification.documentKind,
      reason: error instanceof Error ? error.message : String(error),
      mode: options.write === true ? 'write' : 'audit',
      changes: Object.freeze([]),
      collisions: Object.freeze([]),
      skippedReferences: Object.freeze([]),
    })
  }

  const result = migrateIdentityDocument(parsed, { documentKind: classification.documentKind })
  const status =
    result.collisions.length > 0
      ? 'blocked'
      : result.changed
        ? options.write === true
          ? 'changed'
          : 'would-change'
        : 'unchanged'
  if (options.write === true && status === 'changed') {
    writeFileSync(path, renderIdentityJson(result.document), 'utf8')
  }
  return Object.freeze({
    schemaVersion: IDENTITY_MIGRATION_SCHEMA_VERSION,
    path: rel,
    status,
    documentKind: classification.documentKind,
    mode: options.write === true ? 'write' : 'audit',
    changes: result.changes,
    collisions: result.collisions,
    skippedReferences: result.skippedReferences,
  })
}

function discoverJsonFiles(root) {
  const out = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDED_SCAN_DIRECTORIES.has(entry.name)) walk(path)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.json')) out.push(path)
    }
  }
  walk(resolve(root))
  return out
}

export function discoverIdentityDocumentPaths(root = process.cwd()) {
  return discoverJsonFiles(root).filter(path => {
    if (!DEFAULT_DISCOVERY_NAMES.has(basename(path))) return false
    return classifyIdentityDocumentPath(path, { root }).status === 'recognized'
  })
}

export function identityMigrationReport(paths, options = {}) {
  const root = options.root ?? process.cwd()
  const files =
    paths === undefined || paths.length === 0
      ? discoverIdentityDocumentPaths(root)
      : paths.map(path => resolve(path))
  const results = files.map(path => migrateIdentityFile(path, options))
  return Object.freeze({
    schemaVersion: IDENTITY_MIGRATION_SCHEMA_VERSION,
    mode: options.write === true ? 'write' : 'audit',
    root: resolve(root),
    files: Object.freeze(results),
    summary: Object.freeze({
      changed: results.filter(result => result.status === 'changed').length,
      wouldChange: results.filter(result => result.status === 'would-change').length,
      unchanged: results.filter(result => result.status === 'unchanged').length,
      skipped: results.filter(result => result.status === 'skipped').length,
      blocked: results.filter(result => result.status === 'blocked').length,
      errors: results.filter(result => result.status === 'error').length,
      changes: results.reduce((sum, result) => sum + result.changes.length, 0),
      collisions: results.reduce((sum, result) => sum + result.collisions.length, 0),
      skippedReferences: results.reduce((sum, result) => sum + result.skippedReferences.length, 0),
    }),
  })
}

export function assertIdentityMigrationReportWritable(report) {
  const blocked = report.files.filter(file => file.status === 'blocked' || file.status === 'error')
  if (blocked.length > 0) {
    throw new Error(
      `identity migration blocked in ${blocked.length} file(s): ${blocked
        .map(file => file.path)
        .join(', ')}`,
    )
  }
}

export function existingIdentityDocumentPaths(paths) {
  return paths
    .map(path => resolve(path))
    .filter(path => existsSync(path) && statSync(path).isFile())
}

export function writeIdentityMigrationReport(path, report) {
  const target = resolve(path)
  writeFileSync(target, renderIdentityJson(report), 'utf8')
  return target
}

export function ensureIdentityMigrationReportDirectory(path) {
  return dirname(resolve(path))
}
