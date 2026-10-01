#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

import { extensionArtifactDigest } from '../../../scripts/lib/extension-artifact-digest.mjs'
import { verifyOfflineReleaseDirectory } from './offline-release.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const workspaceRoot = resolve(repoRoot, '..')
const policyPath = join(appRoot, 'format-smoke-policy.v1.json')
const bundledCatalogPath = join(appRoot, 'generated', 'bundled-catalog.json')
const releaseRoot = join(repoRoot, 'packages', 'extension-manager', 'generated', 'offline-release')
const releaseDescriptorPath = join(releaseRoot, 'release.v1.json')
const outputPath = join(appRoot, 'generated', 'format-smoke.v1.json')
const check = process.argv.includes('--check')

const REQUIRED_CASES = Object.freeze([
  Object.freeze({ id: 'image-dds', family: 'images', formats: Object.freeze(['dds']) }),
  Object.freeze({ id: 'image-png', family: 'images', formats: Object.freeze(['png']) }),
  Object.freeze({ id: 'image-tga', family: 'images', formats: Object.freeze(['tga']) }),
  Object.freeze({ id: 'image-jpeg', family: 'images', formats: Object.freeze(['jpeg']) }),
  Object.freeze({ id: 'document-odt', family: 'document-data', formats: Object.freeze(['odt']) }),
  Object.freeze({ id: 'data-xml', family: 'document-data', formats: Object.freeze(['xml']) }),
  Object.freeze({ id: 'archive-zip', family: 'archives', formats: Object.freeze(['zip']) }),
  Object.freeze({
    id: 'archive-warzone-wz',
    family: 'archives',
    formats: Object.freeze(['warzone-wz']),
  }),
  Object.freeze({
    id: 'archive-mpq',
    family: 'archives',
    formats: Object.freeze(['sc2-map']),
  }),
  Object.freeze({
    id: 'casc-dds',
    family: 'archives-images',
    formats: Object.freeze(['casc', 'dds']),
  }),
  Object.freeze({ id: 'audio-wav', family: 'audio', formats: Object.freeze(['casc', 'wav']) }),
  Object.freeze({ id: 'audio-ogg', family: 'audio', formats: Object.freeze(['casc', 'ogg']) }),
  Object.freeze({ id: 'model-m3', family: 'models', formats: Object.freeze(['casc', 'm3']) }),
  Object.freeze({
    id: 'model-warzone-pie',
    family: 'models',
    formats: Object.freeze(['warzone-wz', 'warzone-pie']),
  }),
])
const SHA256 = /^[a-f0-9]{64}$/u
const HOST_REFUSAL = Object.freeze({
  code: 'x3.host/facility-unavailable',
  facility: 'filesystem.read-random',
})

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const canonical = value => `${JSON.stringify(value, null, 2)}\n`

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value, keys, label) {
  if (
    !record(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    throw new TypeError(`${label} must have exactly ${keys.join(', ')}`)
  }
}

function safeRelativePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`${label} must be a safe POSIX relative path`)
  }
  return value
}

function validateCorpus(corpus, label) {
  if (!record(corpus) || typeof corpus.kind !== 'string') {
    throw new TypeError(`${label} corpus must be an object with a kind`)
  }
  if (corpus.kind === 'named-exclusion') {
    exactKeys(corpus, ['kind', 'reason'], `${label} named exclusion`)
    if (typeof corpus.reason !== 'string' || corpus.reason.trim() === '') {
      throw new TypeError(`${label} named exclusion needs a reason`)
    }
    return Object.freeze({ kind: corpus.kind, reason: corpus.reason })
  }
  const hasContainer = corpus.kind === 'warzone-wz-entry'
  exactKeys(
    corpus,
    hasContainer
      ? ['bytes', 'container', 'kind', 'path', 'sha256']
      : ['bytes', 'kind', 'path', 'sha256'],
    label,
  )
  if (
    ![
      'workspace-reference',
      'warzone-install-file',
      'sc2-install-file',
      'sc2-casc-entry',
      'warzone-wz-entry',
    ].includes(corpus.kind)
  ) {
    throw new TypeError(`${label} has an unsupported corpus kind ${corpus.kind}`)
  }
  const path = safeRelativePath(corpus.path, `${label} corpus.path`)
  if (hasContainer) safeRelativePath(corpus.container, `${label} corpus.container`)
  if (!Number.isSafeInteger(corpus.bytes) || corpus.bytes < 1 || !SHA256.test(corpus.sha256)) {
    throw new TypeError(`${label} corpus bytes/sha256 are invalid`)
  }
  if (corpus.kind === 'workspace-reference') {
    const source = join(workspaceRoot, ...path.split('/'))
    if (!existsSync(source) || !lstatSync(source).isFile()) {
      throw new Error(`${label} workspace corpus is unavailable: ${path}`)
    }
    const bytes = readFileSync(source)
    if (
      bytes.byteLength !== corpus.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== corpus.sha256
    ) {
      throw new Error(`${label} workspace corpus integrity drift: ${path}`)
    }
  }
  return Object.freeze({ ...corpus })
}

function validatePwa(value, label) {
  if (!record(value) || typeof value.kind !== 'string')
    throw new TypeError(`${label} pwa is invalid`)
  if (value.kind === 'browser-subset') {
    exactKeys(value, ['kind'], `${label} browser subset`)
    return Object.freeze({ kind: value.kind })
  }
  exactKeys(value, ['code', 'facility', 'kind'], `${label} host refusal`)
  if (
    value.kind !== 'host-facility-refusal' ||
    value.code !== HOST_REFUSAL.code ||
    value.facility !== HOST_REFUSAL.facility
  ) {
    throw new TypeError(`${label} host refusal must name the typed filesystem facility refusal`)
  }
  return Object.freeze({ code: value.code, facility: value.facility, kind: value.kind })
}

function extensionCoordinate(packageJson, label) {
  const publisher = packageJson?.modkit?.publisher
  const id = packageJson?.modkit?.id
  if (typeof publisher !== 'string' || typeof id !== 'string') {
    throw new TypeError(`${label} has no package.json#modkit identity`)
  }
  return `${publisher}/${id}`
}

function addContribution(target, extensionId, document, label) {
  if (document?.contract?.id !== 'modkit/codec-contribution' || document.contract.major !== 1) {
    return
  }
  if (typeof document.id !== 'string' || !Array.isArray(document?.spec?.formatRefs)) {
    throw new TypeError(`${label} is not a codec contribution v1`)
  }
  if (target.has(document.id)) throw new TypeError(`duplicate contribution id ${document.id}`)
  target.set(document.id, Object.freeze({ extensionId, manifest: document }))
}

function commonContributions(target, bundledCatalog) {
  if (
    bundledCatalog?.schemaVersion !== 1 ||
    !Array.isArray(bundledCatalog.roots) ||
    bundledCatalog.roots.length === 0 ||
    bundledCatalog.rootCount !== bundledCatalog.roots.length
  ) {
    // every root the catalog pins, however many: the java root (29.09) made it eleven
    throw new TypeError('format smoke requires the whole Common bundled catalog')
  }
  for (const root of bundledCatalog.roots) {
    if (
      !record(root) ||
      typeof root.directory !== 'string' ||
      typeof root.coordinate !== 'string' ||
      typeof root.digest !== 'string'
    ) {
      throw new TypeError('Common bundled catalog has an invalid root record')
    }
    const extensionRoot = join(repoRoot, 'extensions', root.directory)
    if (!existsSync(extensionRoot) || !lstatSync(extensionRoot).isDirectory()) {
      throw new Error(`Common physical root is unavailable: ${root.directory}`)
    }
    if (extensionArtifactDigest(extensionRoot) !== root.digest) {
      throw new Error(`Common physical root digest drift: ${root.directory}`)
    }
    const packageJson = readJson(join(extensionRoot, 'package.json'))
    const extensionId = extensionCoordinate(packageJson, root.directory)
    if (extensionId !== root.coordinate) {
      throw new TypeError(`Common identity drift: ${root.coordinate} != ${extensionId}`)
    }
    for (const name of readdirSync(join(extensionRoot, 'contributions')).sort()) {
      if (!name.endsWith('.json')) continue
      addContribution(
        target,
        extensionId,
        readJson(join(extensionRoot, 'contributions', name)),
        `${extensionId}/${name}`,
      )
    }
  }
}

function portableContributions(target, artifactPath, declaredExtensions) {
  const portable = readJson(artifactPath)
  if (portable?.schemaVersion !== 1 || !Array.isArray(portable.extensions)) {
    throw new TypeError(`${artifactPath} is not a portable repository v1`)
  }
  const actual = portable.extensions.map(extension => extension.id).sort()
  const expected = [...declaredExtensions].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`portable root inventory drift in ${artifactPath}`)
  }
  for (const extension of portable.extensions) {
    const packageBytes = Buffer.from(extension.files?.['package.json'] ?? '', 'base64')
    const extensionId = extensionCoordinate(
      JSON.parse(packageBytes.toString('utf8')),
      `${extension.id}/package.json`,
    )
    if (extensionId !== extension.id) {
      throw new TypeError(`portable identity drift: ${extension.id} != ${extensionId}`)
    }
    for (const [path, encoded] of Object.entries(extension.files).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (!/^contributions\/[^/]+\.json$/u.test(path)) continue
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.toString('base64') !== encoded) {
        throw new TypeError(`${extensionId}/${path} is not canonical base64`)
      }
      addContribution(
        target,
        extensionId,
        JSON.parse(bytes.toString('utf8')),
        `${extensionId}/${path}`,
      )
    }
  }
}

function routeStep(formatId, contributions) {
  const matches = [...contributions.values()].filter(item =>
    item.manifest.spec.formatRefs.some(reference => reference.formatId === formatId),
  )
  if (matches.length !== 1) {
    throw new TypeError(
      `format ${formatId} resolves to ${matches.length} codec contributions, expected exactly one`,
    )
  }
  const selected = matches[0]
  const environments = [
    ...new Set(selected.manifest.runtimeVariants.flatMap(variant => variant.target.environments)),
  ].sort()
  return Object.freeze({
    formatId,
    extensionId: selected.extensionId,
    contributionId: selected.manifest.id,
    roles: Object.freeze([...selected.manifest.spec.roles].sort()),
    sourceTopology: selected.manifest.spec.sourceTopology,
    dataSources: Object.freeze(
      selected.manifest.spec.publishesDataSources.map(source => source.contract).sort(),
    ),
    runtimeEnvironments: Object.freeze(environments),
  })
}

const policyBytes = readFileSync(policyPath)
const policy = JSON.parse(policyBytes.toString('utf8'))
const bundledBytes = readFileSync(bundledCatalogPath)
const bundledCatalog = JSON.parse(bundledBytes.toString('utf8'))
if (policy?.schemaVersion !== 1 || !Array.isArray(policy.cases)) {
  throw new TypeError('format smoke policy must be schemaVersion 1 with cases')
}
if (
  JSON.stringify(policy.cases.map(entry => entry.id)) !==
  JSON.stringify(REQUIRED_CASES.map(entry => entry.id))
) {
  throw new TypeError('format smoke policy must contain the exact Wave 1B required case inventory')
}
for (const [index, requirement] of REQUIRED_CASES.entries()) {
  const input = policy.cases[index]
  if (
    input?.family !== requirement.family ||
    JSON.stringify(input.formatIds) !== JSON.stringify(requirement.formats)
  ) {
    throw new TypeError(`format smoke required route drift: ${requirement.id}`)
  }
}
const verifiedRelease = verifyOfflineReleaseDirectory(releaseRoot)
const descriptorBytes = readFileSync(releaseDescriptorPath)
const descriptor = JSON.parse(descriptorBytes.toString('utf8'))

const contributions = new Map()
commonContributions(contributions, bundledCatalog)
for (const packageEntry of descriptor.packages) {
  const artifactPath = join(releaseRoot, packageEntry.file)
  const bytes = readFileSync(artifactPath)
  if (digest(bytes) !== packageEntry.sha256 || bytes.byteLength !== packageEntry.bytes) {
    throw new Error(`managed artifact integrity drift for ${packageEntry.id}`)
  }
  portableContributions(contributions, artifactPath, packageEntry.extensions)
}

const ids = new Set()
const cases = policy.cases.map(input => {
  if (typeof input.id !== 'string' || ids.has(input.id)) {
    throw new TypeError(`format smoke case id is invalid or duplicated: ${String(input.id)}`)
  }
  ids.add(input.id)
  if (!Array.isArray(input.formatIds) || input.formatIds.length === 0) {
    throw new TypeError(`format smoke case ${input.id} has no format ids`)
  }
  if (
    typeof input.family !== 'string' ||
    input.family.trim() === '' ||
    typeof input.stage !== 'string'
  ) {
    throw new TypeError(`format smoke case ${input.id} has invalid family/stage`)
  }
  const corpus = validateCorpus(input.corpus, input.id)
  const pwa = validatePwa(input.pwa, input.id)
  if (corpus.kind === 'named-exclusion') {
    throw new TypeError(`Wave 1C requires a real corpus for ${input.id}`)
  }
  const route = input.formatIds.map(formatId => routeStep(formatId, contributions))
  const browserCompatible = route.every(step => step.runtimeEnvironments.includes('browser-worker'))
  const nodeCompatible = route.every(step => step.runtimeEnvironments.includes('node'))
  if (!nodeCompatible) throw new TypeError(`${input.id} is not available to installed Node hosts`)
  if (pwa.kind === 'browser-subset' && !browserCompatible) {
    throw new TypeError(`${input.id} claims the browser subset without browser-worker variants`)
  }
  return Object.freeze({
    id: input.id,
    family: input.family,
    formats: Object.freeze([...input.formatIds]),
    route: Object.freeze(route),
    stage: input.stage,
    corpus,
    runtime: Object.freeze({
      vscode: 'open',
      electron: 'open',
      pwa,
      browserWorkerVariantsPresent: browserCompatible,
    }),
  })
})

const externalRoots = descriptor.packages.flatMap(packageEntry => packageEntry.extensions)
const document = Object.freeze({
  $comment:
    'Generated by scripts/emit-format-smoke.mjs from format ids plus the exact Common/signed package inventories. Do not hand-edit.',
  kind: 'x3.ga-recovery/format-family-smoke',
  schemaVersion: 1,
  generatedFrom: Object.freeze({
    policy: Object.freeze({ file: 'format-smoke-policy.v1.json', sha256: digest(policyBytes) }),
    bundledCatalog: Object.freeze({
      file: 'generated/bundled-catalog.json',
      sha256: digest(bundledBytes),
      provenance: 'checkout-physical-roots-verified-by-host-artifact-digest',
      roots: Object.freeze(
        bundledCatalog.roots
          .map(root => Object.freeze({ coordinate: root.coordinate, digest: root.digest }))
          .sort((left, right) => left.coordinate.localeCompare(right.coordinate)),
      ),
    }),
    offlineRelease: Object.freeze({
      descriptorSha256: digest(descriptorBytes),
      catalogSha256: verifiedRelease.catalog.sha256,
      catalogSignature: Object.freeze({
        algorithm: verifiedRelease.catalog.signature.algorithm,
        keyId: verifiedRelease.catalog.signature.keyId,
        verified: true,
      }),
      packageIds: descriptor.packages.map(packageEntry => packageEntry.id).sort(),
      roots: externalRoots.sort(),
    }),
    codecContributionCount: contributions.size,
  }),
  cases: Object.freeze(cases),
  namedExclusions: Object.freeze(
    cases
      .filter(entry => entry.corpus.kind === 'named-exclusion')
      .map(entry => Object.freeze({ id: entry.id, reason: entry.corpus.reason })),
  ),
})
const prettierOptions = (await resolveConfig(outputPath)) ?? {}
const next = await format(canonical(document), { ...prettierOptions, filepath: outputPath })

if (check) {
  const current = readFileSync(outputPath, 'utf8')
  if (current !== next) {
    console.error('generated format-family smoke is stale; run format-smoke:emit')
    process.exitCode = 1
  } else {
    console.log(`format-family smoke: ${cases.length} cases, generated inventory is current`)
  }
} else {
  writeFileSync(outputPath, next)
  console.log(`format-family smoke: emitted ${cases.length} inventory-derived cases`)
}
