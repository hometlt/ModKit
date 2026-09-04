#!/usr/bin/env node
import path from 'node:path'
import { builtinModules } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPinnedSource, sha256 } from './lib/legacy-oracle.mjs'
import { importsOf, rewriteSource } from './lib/mk2-copy.mjs'

const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url))
const declarationPath = path.join(workspaceRoot, 'modkit-core/migration/mk2-copy/sc2.json')
const oracleRoot = path.join(workspaceRoot, 'references/modkitmk2')
const reportPath = path.join(
  workspaceRoot,
  'artifacts/legacy-parity-sc2/m3/implementation/refreeze-inventory.json',
)
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
const modelCompatibility = new Set([
  'animation.ts',
  'material.ts',
  'render-contracts.ts',
  'codec.ts',
  'format-detection.ts',
  'registry-detectors.ts',
  'texture-codec.ts',
  'preview-textures.ts',
  'texture-cache.ts',
])
const modelMath = new Set([
  'animation-controller.ts',
  'color-remap.ts',
  'effects-sim.ts',
  'humanoid.ts',
  'sequence-pose.ts',
  'standard-material-glsl.ts',
  'transport.ts',
  'westwood-bind-pose.ts',
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

function destination(source) {
  const extensionPrefix = 'extensions/blizzard/starcraft-2/'
  if (source.startsWith(`${extensionPrefix}codecs/m3/`))
    return `modkit-extensions-blizzard/models/src/lib/mk2/m3/${source.slice(
      `${extensionPrefix}codecs/m3/`.length,
    )}`
  if (source.startsWith(extensionPrefix)) {
    const relative = source.slice(extensionPrefix.length)
    if (/^(?:codecs\/[^/]+|games\/starcraft-2)\/test\//u.test(relative))
      return `modkit-extensions-blizzard/starcraft2/test/mk2/${relative}`
    if (relative.startsWith('src/') && relative.includes('/test/'))
      return `modkit-extensions-blizzard/starcraft2/test/mk2/${relative}`
    return `modkit-extensions-blizzard/starcraft2/src/lib/mk2/${relative}`
  }
  if (source.startsWith('packages/xml/src/'))
    return `modkit-core/packages/codec-kit/src/legacy/xml/${source.slice('packages/xml/src/'.length)}`
  if (source.startsWith('packages/xml/test/'))
    return `modkit-core/packages/codec-kit/test/mk2/xml/${source.slice('packages/xml/test/'.length)}`
  if (source.startsWith('packages/models-processing/src/core/')) {
    const name = source.slice('packages/models-processing/src/core/'.length)
    if (modelCompatibility.has(name))
      return `modkit-core/packages/codec-kit/src/legacy/models/${name}`
    if (modelMath.has(name)) return `modkit-core/packages/codec-kit/src/model-math/${name}`
    return `modkit-core/packages/codec-kit/src/embedded/${name}`
  }
  if (source.startsWith('packages/models-processing/test/core/'))
    return `modkit-core/packages/codec-kit/test/mk2/models-core/${source.slice(
      'packages/models-processing/test/core/'.length,
    )}`
  const match = source.match(/^packages\/([^/]+)\/(src|test)\/(.+)$/u)
  if (!match) throw new Error(`No M3 destination: ${source}`)
  const [, packageName, kind, relative] = match
  const root =
    kind === 'src'
      ? 'modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages'
      : 'modkit-extensions-blizzard/starcraft2/test/mk2/packages'
  return `${root}/${packageName}/${kind}/${relative}`
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

const original = JSON.parse(await readFile(declarationPath, 'utf8'))
const source = await createPinnedSource({ repoRoot: oracleRoot, commit: original.oracleCommit })
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
const plannedBySource = new Map(
  [...(original.plannedCopies ?? []), ...original.copies].map(row => [row.source, row]),
)
for (const file of selected)
  allDestinations.set(
    file,
    acceptedBySource.get(file)?.destination ??
      plannedBySource.get(file)?.destination ??
      destination(file),
  )
for (const file of selected.filter(row => row.startsWith('extensions/blizzard/starcraft-2/'))) {
  const planned = plannedBySource.get(file)
  if (!planned) throw new Error(`Missing canonical extension destination: ${file}`)
  if (allDestinations.get(file) !== planned.destination)
    throw new Error(`Extension destination differs from canonical plan: ${file}`)
  if (
    (/(?:^|\/)test\//u.test(file) ||
      /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(file) ||
      /(?:^|\/)fixtures\//u.test(file)) &&
    allDestinations.get(file).includes('/src/lib/mk2/')
  )
    throw new Error(`Test-owned extension blob placed under src/lib/mk2: ${file}`)
}
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
  const rewrites = []
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
  })
}

rows.sort((a, b) => a.source.localeCompare(b.source))
const requiredSources = [
  ...new Set([...original.scopes['m1-libs'].requiredSources, ...selected]),
].sort()
const family = {
  status: 'pending-m3',
  copiedAt: '2026-09-04',
  requiredSources,
  provenance: 'modkit-extensions-blizzard/starcraft2/MK2-FAMILY-PROVENANCE.json',
  adapters: original.scopes['sc2-bank'].adapters,
  dependencies: [...dependencies.values()].sort((a, b) => a.specifier.localeCompare(b.specifier)),
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
const testFiles = selected.filter(
  file => /(?:^|\/)test\//u.test(file) || /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(file),
)
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
