import { ExtensionManagerError } from './schema.js'

const COORDINATE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/u
const INTEGRITY = /^sha256:[0-9a-f]{64}$/u
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
const CHANNELS = new Set(['stable', 'preview', 'development'])
const SOURCE_KINDS = new Set(['repository', 'bundle'])
const TRUST_MODES = new Set(['local-user', 'signed'])
const LOCAL_SOURCE_PROTOCOLS = new Set(['file:', 'memory:', 'browser-file:', 'rapid+file:'])
const textEncoder = new TextEncoder()

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepFreeze(value) {
  if (!record(value) && !Array.isArray(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function jsonClone(value) {
  if (Array.isArray(value)) return value.map(jsonClone)
  if (!record(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonClone(child)]))
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (!record(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, sortedJson(value[key])]),
  )
}

function issue(issues, path, message) {
  issues.push(Object.freeze({ path, message }))
}

function checkKeys(value, allowed, path, issues) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issue(issues, path === '' ? key : `${path}.${key}`, 'is not allowed')
  }
}

function nonEmptyText(value, path, issues) {
  if (typeof value !== 'string' || value.length === 0) {
    issue(issues, path, 'must be a non-empty string')
    return false
  }
  return true
}

function signature(value, path, issues) {
  if (!record(value)) {
    issue(issues, path, 'must be an object')
    return
  }
  checkKeys(value, new Set(['algorithm', 'keyId', 'value']), path, issues)
  if (value.algorithm !== 'Ed25519') issue(issues, `${path}.algorithm`, 'must be Ed25519')
  nonEmptyText(value.keyId, `${path}.keyId`, issues)
  if (!nonEmptyText(value.value, `${path}.value`, issues) || !BASE64.test(value.value)) {
    issue(issues, `${path}.value`, 'must be canonical base64')
  }
}

export function isRemoteCatalogUri(uri) {
  if (typeof uri !== 'string') return false
  if (uri.startsWith('//') || uri.startsWith('\\\\')) return true
  try {
    const parsed = new URL(uri)
    const protocol = parsed.protocol
    if (protocol === 'file:' || protocol === 'rapid+file:') {
      // Hosted and four-slash file/rapid+file URLs map to UNC/network locations on Node platforms,
      // not app-selected local-user paths. They must pass the remote signature/integrity policy.
      return parsed.host !== '' || parsed.pathname.startsWith('//')
    }
    return !LOCAL_SOURCE_PROTOCOLS.has(protocol)
  } catch {
    return false
  }
}

function source(value, path, issues) {
  if (!record(value)) {
    issue(issues, path, 'must be an object')
    return false
  }
  checkKeys(value, new Set(['kind', 'uri', 'integrity', 'bytes', 'trust']), path, issues)
  if (!SOURCE_KINDS.has(value.kind)) {
    issue(issues, `${path}.kind`, 'must be repository or bundle')
  }
  nonEmptyText(value.uri, `${path}.uri`, issues)
  if (value.integrity !== undefined && !INTEGRITY.test(value.integrity)) {
    issue(issues, `${path}.integrity`, 'must be sha256:<64 lowercase hex characters>')
  }
  if (value.bytes !== undefined && (!Number.isSafeInteger(value.bytes) || value.bytes < 0)) {
    issue(issues, `${path}.bytes`, 'must be a non-negative safe integer')
  }
  if (!record(value.trust)) {
    issue(issues, `${path}.trust`, 'must be an object')
  } else {
    checkKeys(value.trust, new Set(['mode', 'signature']), `${path}.trust`, issues)
    if (!TRUST_MODES.has(value.trust.mode)) {
      issue(issues, `${path}.trust.mode`, 'must be local-user or signed')
    }
    if (value.trust.signature !== undefined) {
      signature(value.trust.signature, `${path}.trust.signature`, issues)
    }
  }
  const remote = isRemoteCatalogUri(value.uri)
  if (remote && value.trust?.mode !== 'signed') {
    issue(issues, `${path}.trust.mode`, 'remote sources must use signed trust')
  }
  if (remote && !INTEGRITY.test(value.integrity ?? '')) {
    issue(issues, `${path}.integrity`, 'remote sources require sha256 integrity')
  }
  return remote
}

function catalogVersion(value, path, issues) {
  if (!record(value)) {
    issue(issues, path, 'must be an object')
    return false
  }
  checkKeys(
    value,
    new Set(['version', 'channel', 'source', 'extensions', 'hostApi', 'platforms']),
    path,
    issues,
  )
  if (typeof value.version !== 'string' || !SEMVER.test(value.version)) {
    issue(issues, `${path}.version`, 'must be a semantic version')
  }
  if (!CHANNELS.has(value.channel)) {
    issue(issues, `${path}.channel`, 'must be stable, preview or development')
  }
  const remote = source(value.source, `${path}.source`, issues)
  if (!Array.isArray(value.extensions) || value.extensions.length === 0) {
    issue(issues, `${path}.extensions`, 'must contain at least one extension coordinate')
  } else {
    const ids = new Set()
    value.extensions.forEach((id, index) => {
      const idPath = `${path}.extensions[${index}]`
      if (typeof id !== 'string' || !COORDINATE.test(id)) {
        issue(issues, idPath, 'must be a publisher/id coordinate')
      } else if (ids.has(id)) issue(issues, idPath, 'is duplicated')
      else ids.add(id)
    })
  }
  if (value.hostApi !== undefined) nonEmptyText(value.hostApi, `${path}.hostApi`, issues)
  if (value.platforms !== undefined) {
    if (!Array.isArray(value.platforms)) issue(issues, `${path}.platforms`, 'must be an array')
    else
      value.platforms.forEach((platform, index) =>
        nonEmptyText(platform, `${path}.platforms[${index}]`, issues),
      )
  }
  return remote
}

function catalogPackage(value, path, issues) {
  if (!record(value)) {
    issue(issues, path, 'must be an object')
    return false
  }
  checkKeys(
    value,
    new Set(['id', 'publisher', 'displayName', 'summary', 'license', 'homepage', 'versions']),
    path,
    issues,
  )
  if (typeof value.id !== 'string' || !COORDINATE.test(value.id)) {
    issue(issues, `${path}.id`, 'must be a publisher/id coordinate')
  }
  for (const field of ['publisher', 'displayName', 'summary']) {
    nonEmptyText(value[field], `${path}.${field}`, issues)
  }
  if (value.license !== undefined) nonEmptyText(value.license, `${path}.license`, issues)
  if (value.homepage !== undefined) {
    if (nonEmptyText(value.homepage, `${path}.homepage`, issues)) {
      try {
        const parsed = new URL(value.homepage)
        if (parsed.protocol === '') throw new Error('URI has no protocol')
      } catch {
        issue(issues, `${path}.homepage`, 'must be an absolute URI')
      }
    }
  }
  if (!Array.isArray(value.versions) || value.versions.length === 0) {
    issue(issues, `${path}.versions`, 'must contain at least one version')
    return false
  }
  const versions = new Set()
  let remote = false
  value.versions.forEach((version, index) => {
    const versionPath = `${path}.versions[${index}]`
    const versionRemote = catalogVersion(version, versionPath, issues)
    remote = versionRemote || remote
    if (record(version) && typeof version.version === 'string') {
      if (versions.has(version.version)) issue(issues, `${versionPath}.version`, 'is duplicated')
      else versions.add(version.version)
    }
  })
  return remote
}

export function validateExtensionCatalog(value) {
  const issues = []
  if (!record(value)) {
    issue(issues, 'catalog', 'must be an object')
    return Object.freeze(issues)
  }
  checkKeys(
    value,
    new Set(['$schema', 'schemaVersion', 'registryId', 'generatedAt', 'packages', 'signature']),
    '',
    issues,
  )
  if (value.$schema !== undefined) nonEmptyText(value.$schema, '$schema', issues)
  if (value.schemaVersion !== 1) issue(issues, 'schemaVersion', 'must be 1')
  if (typeof value.registryId !== 'string' || !COORDINATE.test(value.registryId)) {
    issue(issues, 'registryId', 'must be a publisher/id coordinate')
  }
  if (
    typeof value.generatedAt !== 'string' ||
    value.generatedAt.length === 0 ||
    !DATE_TIME.test(value.generatedAt) ||
    Number.isNaN(Date.parse(value.generatedAt))
  ) {
    issue(issues, 'generatedAt', 'must be an ISO date-time')
  }
  if (value.signature !== undefined) signature(value.signature, 'signature', issues)
  if (!Array.isArray(value.packages)) {
    issue(issues, 'packages', 'must be an array')
    return Object.freeze(issues)
  }
  const ids = new Set()
  let remote = false
  value.packages.forEach((item, index) => {
    const path = `packages[${index}]`
    const packageRemote = catalogPackage(item, path, issues)
    remote = packageRemote || remote
    if (record(item) && typeof item.id === 'string') {
      if (ids.has(item.id)) issue(issues, `${path}.id`, 'is duplicated')
      else ids.add(item.id)
    }
  })
  if (remote && !record(value.signature)) {
    issue(issues, 'signature', 'catalogs with remote sources must be signed')
  }
  return Object.freeze(issues)
}

export function parseExtensionCatalog(value) {
  const issues = validateExtensionCatalog(value)
  if (issues.length > 0) {
    throw new ExtensionManagerError(
      'extension-manager/catalog-invalid',
      `extension catalog is invalid (${issues[0].path}: ${issues[0].message})`,
      { issues },
    )
  }
  return deepFreeze(jsonClone(value))
}

/** Compact, recursively key-sorted UTF-8 bytes signed by the Modkit registry (without signature). */
export function extensionCatalogSigningBytes(value) {
  const issues = validateExtensionCatalog(value)
  const signingIssues = issues.filter(
    item =>
      item.path !== 'signature' || item.message !== 'catalogs with remote sources must be signed',
  )
  if (signingIssues.length > 0) {
    throw new ExtensionManagerError(
      'extension-manager/catalog-invalid',
      `extension catalog is invalid (${signingIssues[0].path}: ${signingIssues[0].message})`,
      { issues: signingIssues },
    )
  }
  const catalog = deepFreeze(jsonClone(value))
  const unsigned = Object.fromEntries(
    Object.entries(catalog).filter(([key]) => key !== 'signature'),
  )
  return textEncoder.encode(`${JSON.stringify(sortedJson(unsigned))}\n`)
}

function semverParts(value) {
  const match = SEMVER.exec(value)
  if (match === null) return undefined
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.'),
  }
}

export function compareCatalogVersions(left, right) {
  const leftParts = semverParts(left)
  const rightParts = semverParts(right)
  if (leftParts === undefined || rightParts === undefined) {
    throw new ExtensionManagerError(
      'extension-manager/version-invalid',
      'catalog version comparison requires semantic versions',
      { left, right },
    )
  }
  for (let index = 0; index < 3; index += 1) {
    if (leftParts.numbers[index] !== rightParts.numbers[index]) {
      return leftParts.numbers[index] < rightParts.numbers[index] ? -1 : 1
    }
  }
  if (leftParts.prerelease === undefined) return rightParts.prerelease === undefined ? 0 : 1
  if (rightParts.prerelease === undefined) return -1
  const length = Math.max(leftParts.prerelease.length, rightParts.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftId = leftParts.prerelease[index]
    const rightId = rightParts.prerelease[index]
    if (leftId === undefined) return -1
    if (rightId === undefined) return 1
    if (leftId === rightId) continue
    const leftNumeric = /^[0-9]+$/u.test(leftId)
    const rightNumeric = /^[0-9]+$/u.test(rightId)
    if (leftNumeric && rightNumeric) return Number(leftId) < Number(rightId) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftId < rightId ? -1 : 1
  }
  return 0
}
