import { createHash, createPublicKey, verify as verifyEd25519Signature } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extensionCatalogSigningBytes,
  parseExtensionCatalog,
} from '../../../packages/extension-manager/dist/catalog.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')

export const offlineReleaseSource = join(
  repoRoot,
  'packages',
  'extension-manager',
  'generated',
  'offline-release',
)
export const offlineReleaseDescriptor = 'release.v1.json'
export const offlineReleaseCatalog = 'catalog.v1.json'
export const expectedOfflineReleasePackages = 2
export const expectedOfflineReleaseRoots = 9

const SHA256 = /^sha256:[0-9a-f]{64}$/u
const PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const ROOT_ID = PACKAGE_ID
const SAFE_RELATIVE = /^(?!\.?$)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)(?!.*\\)(?!\/)[^\0]+$/u

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value, keys, label) {
  if (!record(value)) throw new TypeError(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${label} has unexpected fields: ${actual.join(', ')}`)
  }
}

function safeRelativePath(value, label) {
  if (typeof value !== 'string' || !SAFE_RELATIVE.test(value)) {
    throw new TypeError(`${label} must be a confined relative path`)
  }
  return value
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function fileReader(root) {
  if (!existsSync(root)) {
    throw new Error(`offline managed release is missing: ${root}`)
  }
  const rootStat = lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`offline managed release root must be a physical directory: ${root}`)
  }
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolute = join(directory, entry.name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) {
        throw new Error(`offline managed release contains a link: ${absolute}`)
      }
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        files.push(
          absolute
            .slice(root.length + 1)
            .split(sep)
            .join('/'),
        )
      } else throw new Error(`offline managed release contains an unsupported node: ${absolute}`)
    }
  }
  visit(root)
  return Object.freeze({
    label: root,
    files: () => Object.freeze([...files].sort()),
    readBytes: relativePath => readFileSync(join(root, ...relativePath.split('/'))),
  })
}

function jsonFromBytes(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (cause) {
    throw new Error(`${label} is not valid JSON`, { cause })
  }
}

function normalizeSignature(value, label) {
  exactKeys(value, ['algorithm', 'keyId', 'value'], label)
  if (value.algorithm !== 'Ed25519') throw new TypeError(`${label}.algorithm must be Ed25519`)
  if (typeof value.keyId !== 'string' || value.keyId.trim() === '') {
    throw new TypeError(`${label}.keyId must be non-empty`)
  }
  if (
    typeof value.value !== 'string' ||
    Buffer.from(value.value, 'base64').toString('base64') !== value.value
  ) {
    throw new TypeError(`${label}.value must be canonical base64`)
  }
  return Object.freeze({ algorithm: 'Ed25519', keyId: value.keyId, value: value.value })
}

function normalizeDescriptor(value) {
  exactKeys(
    value,
    ['$comment', 'catalog', 'generatedAt', 'packages', 'releaseId', 'schemaVersion', 'signing'],
    'offline release descriptor',
  )
  if (value.releaseId !== 'modkit/ga-recovery-wave1b') {
    throw new TypeError('offline release descriptor releaseId must be modkit/ga-recovery-wave1b')
  }
  if (value.schemaVersion !== 1)
    throw new TypeError('offline release descriptor schemaVersion must be 1')
  exactKeys(value.catalog, ['bytes', 'file', 'sha256'], 'offline release catalog descriptor')
  if (value.catalog.file !== offlineReleaseCatalog) {
    throw new TypeError(`offline release catalog file must be ${offlineReleaseCatalog}`)
  }
  if (!Number.isSafeInteger(value.catalog.bytes) || value.catalog.bytes < 1) {
    throw new TypeError('offline release catalog bytes must be a positive safe integer')
  }
  if (typeof value.catalog.sha256 !== 'string' || !SHA256.test(value.catalog.sha256)) {
    throw new TypeError('offline release catalog sha256 must be sha256:<64 lowercase hex>')
  }
  exactKeys(
    value.signing,
    ['algorithm', 'keyId', 'keySource', 'publicKeyPem'],
    'offline release signing descriptor',
  )
  if (value.signing.algorithm !== 'Ed25519') {
    throw new TypeError('offline release signing algorithm must be Ed25519')
  }
  if (typeof value.signing.keyId !== 'string' || value.signing.keyId.trim() === '') {
    throw new TypeError('offline release signing keyId must be non-empty')
  }
  if (typeof value.signing.publicKeyPem !== 'string') {
    throw new TypeError('offline release signing publicKeyPem must be PEM text')
  }
  const key = createPublicKey(value.signing.publicKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('offline release signing publicKeyPem must be Ed25519')
  }
  if (!Array.isArray(value.packages) || value.packages.length !== expectedOfflineReleasePackages) {
    throw new TypeError(
      `offline release must contain exactly ${expectedOfflineReleasePackages} packages`,
    )
  }
  const packages = value.packages.map((item, index) => {
    exactKeys(
      item,
      ['bytes', 'extensions', 'file', 'id', 'sha256', 'version'],
      `offline release package[${index}]`,
    )
    if (typeof item.id !== 'string' || !PACKAGE_ID.test(item.id)) {
      throw new TypeError(`offline release package[${index}].id must be a package id`)
    }
    if (typeof item.version !== 'string' || item.version.trim() === '') {
      throw new TypeError(`offline release package[${index}].version must be non-empty`)
    }
    if (!Array.isArray(item.extensions) || item.extensions.length === 0) {
      throw new TypeError(`offline release package[${index}].extensions must be non-empty`)
    }
    const roots = item.extensions.map((root, rootIndex) => {
      if (typeof root !== 'string' || !ROOT_ID.test(root)) {
        throw new TypeError(
          `offline release package[${index}].extensions[${rootIndex}] must be a root id`,
        )
      }
      return root
    })
    const artifactPath = safeRelativePath(item.file, `offline release package[${index}].file`)
    if (artifactPath.includes('/')) {
      throw new TypeError(`offline release package[${index}].file must be a top-level file`)
    }
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1) {
      throw new TypeError(`offline release package[${index}].bytes must be positive`)
    }
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) {
      throw new TypeError(
        `offline release package[${index}].sha256 must be sha256:<64 lowercase hex>`,
      )
    }
    return Object.freeze({
      id: item.id,
      version: item.version,
      roots: Object.freeze([...roots]),
      artifact: Object.freeze({
        path: artifactPath,
        bytes: item.bytes,
        sha256: item.sha256,
      }),
    })
  })
  return Object.freeze({
    catalog: Object.freeze({
      path: offlineReleaseCatalog,
      bytes: value.catalog.bytes,
      sha256: value.catalog.sha256,
      publicKey: Object.freeze({
        keyId: value.signing.keyId,
        spkiPem: value.signing.publicKeyPem,
      }),
    }),
    packages: Object.freeze(packages),
  })
}

function assertUnique(values, label) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains a duplicate: ${value}`)
    seen.add(value)
  }
}

function versionForPackage(item) {
  if (!Array.isArray(item.versions) || item.versions.length !== 1) {
    throw new Error(`offline release package ${item.id} must contain exactly one version`)
  }
  return item.versions[0]
}

export function verifyOfflineReleaseInventory(reader) {
  const files = [...reader.files()].sort()
  if (!files.includes(offlineReleaseDescriptor)) {
    throw new Error(`offline managed release is missing ${offlineReleaseDescriptor}`)
  }
  if (!files.includes(offlineReleaseCatalog)) {
    throw new Error(`offline managed release is missing ${offlineReleaseCatalog}`)
  }
  const descriptor = normalizeDescriptor(
    jsonFromBytes(reader.readBytes(offlineReleaseDescriptor), offlineReleaseDescriptor),
  )
  const catalogBytes = Buffer.from(reader.readBytes(offlineReleaseCatalog))
  if (catalogBytes.byteLength !== descriptor.catalog.bytes) {
    throw new Error('offline release catalog byte length does not match descriptor')
  }
  if (sha256(catalogBytes) !== descriptor.catalog.sha256) {
    throw new Error('offline release catalog sha256 does not match descriptor')
  }
  const catalog = parseExtensionCatalog(jsonFromBytes(catalogBytes, offlineReleaseCatalog))
  const catalogSignature = normalizeSignature(
    catalog.signature,
    'offline release catalog signature',
  )
  if (catalogSignature.keyId !== descriptor.catalog.publicKey.keyId) {
    throw new Error('offline release catalog signature keyId does not match descriptor signing key')
  }
  const signatureOk = verifyEd25519Signature(
    null,
    extensionCatalogSigningBytes(catalog),
    createPublicKey(descriptor.catalog.publicKey.spkiPem),
    Buffer.from(catalogSignature.value, 'base64'),
  )
  if (!signatureOk) throw new Error('offline release catalog signature failed Ed25519 verification')
  if (catalog.packages.length !== expectedOfflineReleasePackages) {
    throw new Error(
      `offline release catalog must contain exactly ${expectedOfflineReleasePackages} packages`,
    )
  }
  const descriptorPackages = new Map(descriptor.packages.map(item => [item.id, item]))
  assertUnique(
    descriptor.packages.map(item => item.id),
    'offline release descriptor packages',
  )
  const catalogPackageIds = catalog.packages.map(item => item.id).sort()
  if (JSON.stringify(catalogPackageIds) !== JSON.stringify([...descriptorPackages.keys()].sort())) {
    throw new Error('offline release descriptor packages do not match catalog packages')
  }
  const roots = []
  const artifactPaths = []
  for (const catalogPackage of catalog.packages) {
    const descriptorPackage = descriptorPackages.get(catalogPackage.id)
    const version = versionForPackage(catalogPackage)
    const catalogRoots = [...version.extensions].sort()
    if (JSON.stringify(catalogRoots) !== JSON.stringify([...descriptorPackage.roots].sort())) {
      throw new Error(`offline release roots do not match catalog for ${catalogPackage.id}`)
    }
    roots.push(...version.extensions)
    if (version.source.kind !== 'bundle') {
      throw new Error(`offline release package ${catalogPackage.id} must use a bundle source`)
    }
    if (version.source.trust?.mode !== 'signed') {
      throw new Error(`offline release package ${catalogPackage.id} must use signed source trust`)
    }
    if (version.version !== descriptorPackage.version) {
      throw new Error(
        `offline release package version does not match descriptor for ${catalogPackage.id}`,
      )
    }
    if (version.source.uri !== `./${descriptorPackage.artifact.path}`) {
      throw new Error(
        `offline release artifact uri does not match descriptor for ${catalogPackage.id}`,
      )
    }
    if (version.source.bytes !== descriptorPackage.artifact.bytes) {
      throw new Error(
        `offline release artifact byte length does not match catalog for ${catalogPackage.id}`,
      )
    }
    if (version.source.integrity !== descriptorPackage.artifact.sha256) {
      throw new Error(
        `offline release artifact sha256 does not match catalog for ${catalogPackage.id}`,
      )
    }
    artifactPaths.push(descriptorPackage.artifact.path)
    const artifactBytes = Buffer.from(reader.readBytes(descriptorPackage.artifact.path))
    if (artifactBytes.byteLength !== descriptorPackage.artifact.bytes) {
      throw new Error(
        `offline release artifact byte length does not match descriptor for ${catalogPackage.id}`,
      )
    }
    if (sha256(artifactBytes) !== descriptorPackage.artifact.sha256) {
      throw new Error(
        `offline release artifact sha256 does not match descriptor for ${catalogPackage.id}`,
      )
    }
  }
  assertUnique(roots, 'offline release roots')
  if (roots.length !== expectedOfflineReleaseRoots) {
    throw new Error(`offline release must contain exactly ${expectedOfflineReleaseRoots} roots`)
  }
  assertUnique(artifactPaths, 'offline release artifacts')
  const expectedFiles = [offlineReleaseCatalog, offlineReleaseDescriptor, ...artifactPaths].sort()
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `offline release inventory drifted: expected ${expectedFiles.join(', ')}, found ${files.join(', ')}`,
    )
  }
  return Object.freeze({
    packages: expectedOfflineReleasePackages,
    roots: expectedOfflineReleaseRoots,
    catalog: Object.freeze({
      path: offlineReleaseCatalog,
      sha256: descriptor.catalog.sha256,
      bytes: descriptor.catalog.bytes,
      signature: catalogSignature,
      publicKey: descriptor.catalog.publicKey,
    }),
    files: Object.freeze(expectedFiles),
  })
}

export function verifyOfflineReleaseDirectory(root) {
  return verifyOfflineReleaseInventory(fileReader(root))
}
