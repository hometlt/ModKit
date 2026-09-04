#!/usr/bin/env node
import path from 'node:path'
import { builtinModules } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPinnedSource, sha256 } from './lib/legacy-oracle.mjs'
import { importsOf, rewriteSource } from './lib/mk2-copy.mjs'
import {
  assertM3TestDestination,
  canonicalM3Destination,
  isM3TestOwnedSource,
  modelCompatibility,
  modelMath,
  triggerTmpTest,
} from './lib/sc2-m3-destinations.mjs'
import {
  parseSc2M3RefreezeArgs,
  SC2_M3_REFREEZE_PIN,
  SC2_M3_SELECTOR_VERSION,
  sc2M3FamilyPlanDigest,
} from './lib/sc2-m3-refreeze.mjs'

const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url))
const declarationPath = path.join(workspaceRoot, 'modkit-core/migration/mk2-copy/sc2.json')
const oracleRoot = path.join(workspaceRoot, 'references/modkitmk2')
const reportPath = path.join(
  workspaceRoot,
  'artifacts/legacy-parity-sc2/m3/implementation/refreeze-inventory.json',
)
const pinRelative = SC2_M3_REFREEZE_PIN
const pinPath = path.join(workspaceRoot, pinRelative)
const { writePin, admitReady } = parseSc2M3RefreezeArgs(process.argv.slice(2))
const modelSupportAdapterPath = 'modkit-core/packages/codec-kit/src/legacy-model-support.ts'
const modelAssetsSupportAdapterPath =
  'modkit-core/packages/codec-kit/src/legacy-model-assets-support.ts'
const sc2SupportAdapterPath = 'modkit-core/packages/codec-kit/src/legacy-sc2-support.ts'
const vfsNodeTestAdapterPath =
  'modkit-extensions-blizzard/starcraft2/test/mk2/support/vfs-node.ts'
const algorithmDispositions = new Map([
  [
    'extensions/blizzard/starcraft-2/codecs/sc2-map/src/image/png.ts',
    {
      symbol: 'crc32#0',
      kind: 'copied-unwired-copy',
      reason:
        'Exact pinned SC2 map PNG CRC implementation remains staged outside the normal StarCraft II production graph.',
      exit: 'canonicalize-before-activation',
    },
  ],
  [
    'packages/scripts-processing/src/trigger-store/store.ts',
    {
      symbol: 'XMLReader.parseXML#0',
      kind: 'copied-unwired-copy',
      reason:
        'Exact pinned public XMLReader delegate is staged outside the normal StarCraft II production graph; this is not an XML parser implementation.',
      exit: 'classify-delegate-before-activation',
    },
  ],
])
const processingPackages = [
  'data-processing',
  'documents-processing',
  'layouts-processing',
  'localization-processing',
  'maps-processing',
  'mods-processing',
  'replays-processing',
  'scripts-processing',
]
const semanticRegistryDomains = new Map([
  ['documents-processing', 'documents'],
  ['layouts-processing', 'layouts'],
  ['localization-processing', 'localization'],
  ['maps-processing', 'maps'],
  ['mods-processing', 'mods'],
  ['replays-processing', 'replays'],
  ['scripts-processing', 'scripts'],
])
const layoutTestSupportFiles = new Set([
  'packages/layouts-processing/bundled-schema.d.ts',
  'packages/layouts-processing/bundled-schema.js',
  'packages/layouts-processing/generated/sc2layout-schema-data.json',
  'packages/layouts-processing/scripts/sc2-layout-core/compile-schema.ts',
  'packages/layouts-processing/src/sc2-layout-core/schema/registry.ts',
])
const vfsTestSupportFiles = new Set([
  'packages/vfs/src/core/directory.ts',
  'packages/vfs/src/core/mount.ts',
  'packages/vfs/src/core/path.ts',
  'packages/vfs/src/core/provider.ts',
  'packages/vfs/src/core/random-access.ts',
  'packages/vfs/src/core/resolver.ts',
  'packages/vfs/src/core/source.ts',
  'packages/vfs/src/providers/file/index.ts',
  'packages/vfs/src/providers/file/node.ts',
])
const corePackageRewrites = new Map([
  ['@modkitx/assets', '@modkit/codec-kit/legacy/assets'],
  ['@modkitx/core', '@modkit/codec-kit/legacy/core'],
  ['@modkitx/entity-cards', '@modkit/codec-kit/legacy/entity-cards'],
  ['@modkitx/games', '@modkit/codec-kit/legacy/games'],
  ['@modkitx/language-contracts', '@modkit/codec-kit/legacy/language-contracts'],
  ['@modkitx/runtime', '@modkit/codec-kit/legacy/runtime'],
  ['@modkitx/semantic', '@modkit/codec-kit/legacy/semantic'],
  ['@modkitx/vfs', '@modkit/codec-kit/legacy/vfs'],
  ['@modkitx/world', '@modkit/codec-kit/legacy/world'],
  ['@modkitx/xml', '@modkit/codec-kit/legacy/xml'],
])

const typeOnlyRewrites = new Map([
  [
    'packages/layouts-processing/src/sc2-layout-core/index.ts',
    [
      {
        kind: 'export-type',
        from: `export { SC2Layout } from './types.js';`,
        to: `export { type SC2Layout } from './types.js';`,
        count: 1,
      },
      {
        kind: 'export-type',
        from: `export { ExpressionParser, PathSelector, PropertyBindExpr, SelectorFragment, SelHandleKind, SyntaxKind } from './parser/expressions.js';`,
        to: `export { ExpressionParser, type PathSelector, type PropertyBindExpr, type SelectorFragment, SelHandleKind, SyntaxKind } from './parser/expressions.js';`,
        count: 1,
      },
    ],
  ],
  [
    'packages/layouts-processing/src/sc2-layout-core/types.ts',
    [
      {
        kind: 'export-type',
        from: `export {
    XMLNodeKind,
    XMLAttr,
    TokenType,
    ScannerState,
    DiagnosticCategory,
    DiagnosticReport,
    CharacterCodes,
    createScanner,
    buildLineMap,
    findFirst,
    binarySearch,
} from '@modkitx/xml/positional';`,
        to: `export {
    XMLNodeKind,
    type XMLAttr,
    TokenType,
    ScannerState,
    DiagnosticCategory,
    type DiagnosticReport,
    CharacterCodes,
    createScanner,
    buildLineMap,
    findFirst,
    binarySearch,
} from '@modkitx/xml/positional';`,
        count: 1,
      },
    ],
  ],
  [
    'packages/xml/src/positional/index.ts',
    [
      {
        kind: 'export-type',
        from: `export {
  XMLNodeKind,
  XMLNode,
  XMLDocument,
  XMLElement,
  XMLAttr,
  TokenType,
  ScannerState,
  Scanner,
  DiagnosticCategory,
  DiagnosticReport,
} from './types.js'`,
        to: `export {
  XMLNodeKind,
  XMLNode,
  XMLDocument,
  XMLElement,
  type XMLAttr,
  TokenType,
  ScannerState,
  type Scanner,
  DiagnosticCategory,
  type DiagnosticReport,
} from './types.js'`,
        count: 1,
      },
      {
        kind: 'export-type',
        from: `export { ParserHooks, parse } from './parser.js'`,
        to: `export { type ParserHooks, parse } from './parser.js'`,
        count: 1,
      },
    ],
  ],
  [
    'packages/xml/src/positional/parser.ts',
    [
      {
        kind: 'import-type',
        from: `import {
  TokenType,
  ScannerState,
  XMLElement,
  DiagnosticReport,
  DiagnosticCategory,
  XMLDocument,
  XMLNode,
  XMLNodeKind,
} from './types.js'`,
        to: `import {
  TokenType,
  ScannerState,
  XMLElement,
  type DiagnosticReport,
  DiagnosticCategory,
  XMLDocument,
  XMLNode,
  XMLNodeKind,
} from './types.js'`,
        count: 1,
      },
    ],
  ],
  [
    'packages/xml/src/positional/scanner.ts',
    [
      {
        kind: 'import-type',
        from: `import { TokenType, ScannerState, Scanner, DiagnosticReport, DiagnosticCategory } from './types.js'`,
        to: `import { TokenType, ScannerState, type Scanner, type DiagnosticReport, DiagnosticCategory } from './types.js'`,
        count: 1,
      },
    ],
  ],
])

function modelSupportReplacement(file, specifier) {
  if (file.startsWith('packages/models-processing/src/core/') && specifier === '../index.js')
    return modelSupportAdapterPath
  if (
    file.startsWith('packages/models-processing/src/core/') &&
    (specifier === '@modkitx/assets' || specifier === '@modkitx/assets/profiles/image-texture')
  )
    return modelAssetsSupportAdapterPath
  if (
    file.startsWith('packages/models-processing/test/core/') &&
    specifier === '../../src/index.js'
  )
    return modelSupportAdapterPath
  return null
}

function semanticRegistryReplacement(file, specifier) {
  const match = file.match(/^packages\/([^/]+)\/(?:src|test)\//u)
  if (!match) return null
  const domain = semanticRegistryDomains.get(match[1])
  if (!domain) return null
  const registry = `packages/${match[1]}/src/registry.ts`
  return sourceCandidates(file, specifier).includes(registry)
    ? `@modkit/codec-kit/legacy/semantic/${domain}`
    : null
}

function sc2SupportReplacement(file, specifier) {
  if (specifier === '@modkitx/core/errors' && vfsTestSupportFiles.has(file))
    return '@modkit/codec-kit/legacy/core'
  if (
    specifier === '@modkitx/core' &&
    (file === 'packages/layouts-processing/src/sc2-layout-core/index.ts' ||
      file === 'packages/layouts-processing/src/sc2-layout-core/index/store.ts' ||
      file === 'packages/mods-processing/src/metadata-cache.ts')
  )
    return '@modkit/codec-kit/legacy/sc2-support'
  if (
    specifier === '@modkitx/vfs' &&
    file === 'packages/mods-processing/src/sc2-mod-core/types.ts'
  )
    return '@modkit/codec-kit/legacy/sc2-support'
  return null
}

function included(file) {
  if (file.endsWith('/.npmignore')) return false
  if (file.includes('/games/heroes-of-the-storm/')) return false
  if (
    file.startsWith('extensions/blizzard/starcraft-2/codecs/') ||
    file.startsWith('extensions/blizzard/starcraft-2/src/language/') ||
    file.startsWith('extensions/blizzard/starcraft-2/src/document-coverage/') ||
    file.startsWith('extensions/blizzard/starcraft-2/games/starcraft-2/') ||
    file.startsWith('packages/xml/src/') ||
    file.startsWith('packages/xml/test/')
  )
    return true
  if (layoutTestSupportFiles.has(file)) return true
  if (file === 'packages/core/src/events.ts' || vfsTestSupportFiles.has(file)) return true
  for (const packageName of processingPackages) {
    const prefix = `packages/${packageName}/`
    if (!file.startsWith(prefix)) continue
    if (!file.startsWith(`${prefix}src/`) && !file.startsWith(`${prefix}test/`)) return false
    if (packageName !== 'data-processing' && /\/(?:generated|registry)(?:\/|\.ts$)/u.test(file))
      return false
    return true
  }
  if (file.startsWith('packages/models-processing/src/core/')) {
    const name = path.posix.basename(file)
    return modelCompatibility.has(name) || modelMath.has(name) || name === 'embedded-vfs.ts'
  }
  if (file.startsWith('packages/models-processing/test/core/')) return true
  if (
    file === 'packages/rendering-3d/src/scene.ts' ||
    file.startsWith('packages/rendering-3d/src/scene-core/')
  )
    return true
  if (file.startsWith('packages/archives-processing/src/'))
    return (
      !file.includes('/generated/') &&
      file !== 'packages/archives-processing/src/registry.ts' &&
      !file.startsWith('packages/archives-processing/src/lib/compression/') &&
      !file.startsWith('packages/archives-processing/src/lib/crypto/')
    )
  return file.startsWith('packages/archives-processing/test/')
}

function sourceCandidates(importer, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
  return [
    ...new Set([
      base
        .replace(/\.mjs$/u, '.mts')
        .replace(/\.cjs$/u, '.cts')
        .replace(/\.js$/u, '.ts'),
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.d.ts`,
      `${base}/index.ts`,
      `${base}/index.d.ts`,
      base.replace(/\.js$/u, '.d.ts'),
    ]),
  ]
}

function relocatedSpecifier(importer, target, original) {
  let relative = path.posix.relative(path.posix.dirname(importer), target)
  if (!relative.startsWith('.')) relative = `./${relative}`
  if (original.endsWith('.js')) relative = relative.replace(/\.ts$/u, '.js')
  else if (!/\.[cm]?[jt]sx?$/u.test(original)) {
    relative = relative.replace(/\.(?:d\.)?ts$/u, '')
    relative = relative.replace(/\/index$/u, '')
  }
  return relative
}

function packageRoot(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
}

async function externalDependency(specifier, baseDependencies) {
  const old = baseDependencies.find(row => row.specifier === specifier)
  if (old) return old
  const builtin = specifier.replace(/^node:/u, '')
  if (builtinModules.includes(builtin))
    return {
      specifier,
      kind: 'node-builtin',
      reason: 'Pinned M3 compatibility source imports this Node builtin.',
    }
  const packageName = packageRoot(specifier)
  for (const repository of ['modkit-extensions-blizzard', 'modkit-core']) {
    const manifest = path.join(
      workspaceRoot,
      repository,
      'node_modules',
      packageName,
      'package.json',
    )
    try {
      const parsed = JSON.parse(await readFile(manifest, 'utf8'))
      return {
        specifier,
        package: parsed.name,
        manifest: path.relative(workspaceRoot, manifest).replaceAll('\\', '/'),
        version: parsed.version,
        reason: 'Installed dependency imported by the pinned M3 family compatibility copy.',
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return null
}

async function bindDependencyManifest(dependency) {
  if (dependency.kind === 'node-builtin') return { ...dependency }
  const bytes = await readFile(path.join(workspaceRoot, dependency.manifest))
  return { ...dependency, manifestSha256: sha256(bytes) }
}

const original = JSON.parse(await readFile(declarationPath, 'utf8'))
const source = await createPinnedSource({
  repoRoot: oracleRoot,
  commit: original.oracleCommit,
  observeWorkingTree: false,
})
const selected = source.listFiles().filter(included)
source.prefetch(selected)
const selectedSet = new Set(selected)
const acceptedSources = new Set(original.scopes['sc2-bank'].requiredSources)
for (const prefix of original.scopes['sc2-bank'].sourcePrefixes ?? [])
  for (const file of source.listFiles())
    if (file.startsWith(`${prefix}/`)) acceptedSources.add(file)
const accepted = original.copies.filter(row => acceptedSources.has(row.source))
const acceptedBySource = new Map(accepted.map(row => [row.source, row]))
const allDestinations = new Map(accepted.map(row => [row.source, row.destination]))
const legacyPlannedBySource = new Map((original.plannedCopies ?? []).map(row => [row.source, row]))
for (const file of selected)
  allDestinations.set(file, acceptedBySource.get(file)?.destination ?? canonicalM3Destination(file))
for (const file of selected.filter(row => row.startsWith('extensions/blizzard/starcraft-2/'))) {
  const planned = legacyPlannedBySource.get(file)
  if (planned && file !== triggerTmpTest && canonicalM3Destination(file) !== planned.destination)
    throw new Error(`Extension destination differs from canonical plan: ${file}`)
}
for (const file of selected) assertM3TestDestination(file, allDestinations.get(file))
const imports = new Map()
for (const file of selected) {
  if (!/\.[cm]?[jt]sx?$/u.test(file)) continue
  const text = (await source.read(file)).bytes.toString('utf8')
  imports.set(file, importsOf(text, file))
}

const baseDependencies = original.scopes['sc2-bank'].dependencies ?? []
const dependencies = new Map(baseDependencies.map(row => [row.specifier, row]))
const dispositions = new Map()
const addDisposition = (file, item, reason, destinationSpecifier) => {
  const token = item.specifier ?? `expression:${item.expression}`
  const key = `${file}\0${token}`
  const existing = dispositions.get(key)
  if (existing) existing.count++
  else
    dispositions.set(key, {
      source: file,
      ...(item.specifier ? { specifier: item.specifier } : { expression: item.expression }),
      ...(destinationSpecifier && destinationSpecifier !== item.specifier
        ? { destinationSpecifier }
        : {}),
      kind: 'copied-unwired',
      count: 1,
      reason,
    })
}
const rows = [...accepted]
for (const file of selected) {
  if (acceptedBySource.has(file)) continue
  const pinned = await source.read(file)
  const destinationPath = allDestinations.get(file)
  const rewrites = [...(typeOnlyRewrites.get(file) ?? [])]
  for (const item of imports.get(file) ?? []) {
    if (!item.specifier) {
      addDisposition(
        file,
        item,
        'Computed loading is retained only in the isolated compatibility copy until its C1 owner gate.',
      )
      continue
    }
    const specifier = item.specifier
    const modelReplacement = modelSupportReplacement(file, specifier)
    if (modelReplacement) {
      let relocated = path.posix.relative(path.posix.dirname(destinationPath), modelReplacement)
      if (!relocated.startsWith('.')) relocated = `./${relocated}`
      relocated = relocated.replace(/\.ts$/u, '.js')
      rewrites.push({
        from: item.literal,
        to: `${item.literal[0]}${relocated}${item.literal[0]}`,
        count: 1,
      })
      continue
    }
    const semanticReplacement = semanticRegistryReplacement(file, specifier)
    if (semanticReplacement) {
      rewrites.push({
        from: item.literal,
        to: `${item.literal[0]}${semanticReplacement}${item.literal[0]}`,
        count: 1,
      })
      const dependency = await externalDependency(semanticReplacement, baseDependencies)
      if (!dependency) throw new Error(`Missing semantic registry dependency: ${semanticReplacement}`)
      dependencies.set(semanticReplacement, dependency)
      addDisposition(
        file,
        item,
        'The excluded legacy package registry is replaced by the accepted domain-neutral semantic registry copy.',
        semanticReplacement,
      )
      continue
    }
    const supportReplacement = sc2SupportReplacement(file, specifier)
    if (supportReplacement) {
      rewrites.push({
        from: item.literal,
        to: `${item.literal[0]}${supportReplacement}${item.literal[0]}`,
        count: 1,
      })
      const dependency = await externalDependency(supportReplacement, baseDependencies)
      if (!dependency) throw new Error(`Missing SC2 support dependency: ${supportReplacement}`)
      dependencies.set(supportReplacement, dependency)
      continue
    }
    if (specifier.startsWith('.')) {
      const target = sourceCandidates(file, specifier).find(candidate => source.has(candidate))
      if (!target) {
        addDisposition(
          file,
          item,
          'Pinned source contains an unresolved legacy-relative edge retained only as copied-unwired evidence.',
        )
        continue
      }
      if (!selectedSet.has(target) && !acceptedBySource.has(target)) {
        addDisposition(
          file,
          item,
          'Relative dependency belongs to a later owner milestone; this source remains copied-unwired.',
        )
        continue
      }
      const relocated = relocatedSpecifier(destinationPath, allDestinations.get(target), specifier)
      if (relocated !== specifier)
        rewrites.push({
          from: item.literal,
          to: `${item.literal[0]}${relocated}${item.literal[0]}`,
          count: 1,
        })
      const sourceCodec = file.match(/^extensions\/blizzard\/starcraft-2\/codecs\/([^/]+)\//u)?.[1]
      const targetCodec = target.match(
        /^extensions\/blizzard\/starcraft-2\/codecs\/([^/]+)\//u,
      )?.[1]
      if (sourceCodec && targetCodec && sourceCodec !== targetCodec)
        addDisposition(
          file,
          item,
          'Pinned cross-codec edge is preserved only in the isolated tree and is forbidden from production.',
          relocated,
        )
      continue
    }
    const replacement = corePackageRewrites.get(specifier)
    if (replacement) {
      rewrites.push({
        from: item.literal,
        to: `${item.literal[0]}${replacement}${item.literal[0]}`,
        count: 1,
      })
      const dependency = await externalDependency(replacement, baseDependencies)
      if (!dependency) throw new Error(`Missing canonical core dependency: ${replacement}`)
      dependencies.set(replacement, dependency)
      continue
    }
    if (specifier.startsWith('@modkitx/')) {
      addDisposition(
        file,
        item,
        'Legacy package edge remains copied-unwired until its owner-specific C1 adapter is admitted.',
      )
      continue
    }
    const dependency = await externalDependency(specifier, baseDependencies)
    if (dependency) dependencies.set(specifier, dependency)
    else
      addDisposition(
        file,
        item,
        'Optional or unavailable legacy dependency is retained only in the isolated compatibility copy.',
      )
  }
  const deduplicated = []
  for (const rewrite of rewrites) {
    const existing = deduplicated.find(row => row.from === rewrite.from && row.to === rewrite.to)
    if (existing) existing.count += rewrite.count
    else deduplicated.push(rewrite)
  }
  const originalText = pinned.bytes.toString('utf8')
  const rewritten = rewriteSource(originalText, deduplicated, file).text
  const destinationBytes = deduplicated.length ? Buffer.from(rewritten) : pinned.bytes
  rows.push({
    source: file,
    destination: destinationPath,
    sha256Mk2: pinned.sha256,
    sha256Mk3: sha256(destinationBytes),
    rewrites: deduplicated,
    ...(algorithmDispositions.has(file)
      ? { algorithmDisposition: algorithmDispositions.get(file) }
      : {}),
  })
}

for (const sourcePath of algorithmDispositions.keys())
  if (rows.filter(row => row.source === sourcePath && row.algorithmDisposition).length !== 1)
    throw new Error(`Missing or duplicate algorithm disposition row: ${sourcePath}`)

rows.sort((a, b) => a.source.localeCompare(b.source))
const requiredSources = [
  ...new Set([...original.scopes['m1-libs'].requiredSources, ...selected]),
].sort()
const family = {
  status: admitReady ? 'ready' : 'pending-m3',
  copiedAt: '2026-09-04',
  selectorVersion: SC2_M3_SELECTOR_VERSION,
  refreezePin: pinRelative,
  requiredSources,
  provenance: 'modkit-extensions-blizzard/starcraft2/MK2-FAMILY-PROVENANCE.json',
  adapters: [
    ...original.scopes['sc2-bank'].adapters,
    {
      destination: modelSupportAdapterPath,
      replacesSources: ['packages/models-processing/src/index.ts'],
      reason:
        'Narrow M3 support barrel for renderer-neutral model contracts and admitted pure helpers; no concrete codec, renderer, registry, or embedded-resource activation.',
      sha256: sha256(await readFile(path.join(workspaceRoot, modelSupportAdapterPath))),
    },
    {
      destination: modelAssetsSupportAdapterPath,
      reason:
        'Narrow M3 import seam recomposing accepted neutral asset contracts for the copied model registry; no codec activation.',
      sha256: sha256(await readFile(path.join(workspaceRoot, modelAssetsSupportAdapterPath))),
    },
    {
      destination: sc2SupportAdapterPath,
      reason:
        'Narrow shared compatibility surface for legacy SC2 layout events/logging and the type-only mod VFS contract; no host or codec activation.',
      sha256: sha256(await readFile(path.join(workspaceRoot, sc2SupportAdapterPath))),
    },
    {
      destination: vfsNodeTestAdapterPath,
      reason:
        'Test-only barrel over the exact pinned file VFS closure required by the admitted mods-processing suites.',
      sha256: sha256(await readFile(path.join(workspaceRoot, vfsNodeTestAdapterPath))),
    },
  ],
  dependencies: (await Promise.all([...dependencies.values()].map(bindDependencyManifest))).sort(
    (a, b) => a.specifier.localeCompare(b.specifier),
  ),
  dynamicImports: original.scopes['sc2-bank'].dynamicImports,
  importDispositions: [...dispositions.values()].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      (a.specifier ?? a.expression).localeCompare(b.specifier ?? b.expression),
  ),
  note: 'M3 family is staged copied-unwired; only support-library projects are admitted to compilation.',
}
const declaration = {
  ...original,
  scopes: {
    ...original.scopes,
    'm1-libs': { ...original.scopes['m1-libs'], acceptancePin: 'sc2-m1-libs-2026-09-04' },
    'sc2-bank': { ...original.scopes['sc2-bank'], acceptancePin: 'sc2-bank-2026-09-04' },
    family,
  },
  copies: rows,
}
delete declaration.plannedCopies
if (selected.some(file => file.includes('/games/heroes-of-the-storm/')))
  throw new Error('Heroes of the Storm leaked into M3')
if (new Set(rows.map(row => row.destination.toLowerCase())).size !== rows.length)
  throw new Error('Destination collision in M3 refreeze')
const pin = {
  schemaVersion: 1,
  family: declaration.family,
  scope: 'family',
  oracleCommit: declaration.oracleCommit,
  selectorVersion: SC2_M3_SELECTOR_VERSION,
  planDigest: sc2M3FamilyPlanDigest(declaration, 'family', rows),
}
if (writePin) await writeFile(pinPath, `${JSON.stringify(pin, null, 2)}\n`)
else {
  const acceptedPin = JSON.parse(await readFile(pinPath, 'utf8'))
  if (JSON.stringify(acceptedPin) !== JSON.stringify(pin))
    throw new Error('Refreeze output differs from the tracked M3 plan pin; review with --write-pin')
}
await writeFile(declarationPath, `${JSON.stringify(declaration, null, 2)}\n`)
const groups = Object.fromEntries(
  [...new Set(selected.map(file => file.split('/').slice(0, 2).join('/')))]
    .sort()
    .map(group => [group, selected.filter(file => file.startsWith(`${group}/`)).length]),
)
const destinationOwners = Object.fromEntries(
  [
    'modkit-core/packages/codec-kit/',
    'modkit-extensions-blizzard/starcraft2/',
    'modkit-extensions-blizzard/models/',
  ].map(prefix => [prefix, rows.filter(row => row.destination.startsWith(prefix)).length]),
)
const testFiles = selected.filter(isM3TestOwnedSource)
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      oracleCommit: original.oracleCommit,
      acceptedCopiesReused: accepted.length,
      selectedFiles: selected.length,
      declaredCopies: rows.length,
      importDispositions: family.importDispositions.length,
      dependencies: family.dependencies.length,
      testFiles: testFiles.length,
      destinationOwners,
      groups,
    },
    null,
    2,
  )}\n`,
)
console.log(JSON.stringify({ files: rows.length, selected: selected.length, report: reportPath }))
