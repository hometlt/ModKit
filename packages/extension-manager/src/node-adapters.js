import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createExtensionManagerClient } from './client.js'
import {
  extensionCatalogSigningBytes,
  parseExtensionCatalog,
  snapshotExtensionPresentation,
} from './catalog.js'
import { createNodeExtensionVfs } from './providers-node.js'
import { ExtensionManagerError, normalizeRepositoryManifest } from './schema.js'
import { openRepositorySource, readMountBytes } from './vfs.js'

const CATALOG_STATE = 'catalog.v1.json'
const ARTIFACT_STATE = 'packages.v1.json'
const ENABLEMENT_STATE = 'enablement.v1.json'
const SHA256_INTEGRITY = /^sha256:[0-9a-f]{64}$/u
const PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const SAFE_ARTIFACT_KEY = /^[0-9a-f]{64}$/u
const HTTP_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_ARTIFACT_REDIRECTS = 5
const SOURCE_SCHEME = /^[a-z][a-z0-9+.-]*:/iu
const WINDOWS_DRIVE = /^[a-z]:[\\/]/iu
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu
const textDecoder = new TextDecoder('utf-8', { fatal: true })

function fail(code, message, context = {}, cause) {
  throw new ExtensionManagerError(code, message, context, cause)
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('extension-manager/state-invalid', `${label} has unexpected or missing fields`, {
      actual,
      expected: wanted,
    })
  }
}

function positiveSafeInteger(value, fallback, label) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    fail('extension-manager/options-invalid', `${label} must be a positive safe integer`, {
      value: resolved,
    })
  }
  return resolved
}

function privateRoot(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    fail('extension-manager/private-root-invalid', 'private root must be an absolute path', {
      root: value,
    })
  }
  return resolve(value)
}

function inside(root, candidate) {
  const offset = relative(root, candidate)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
}

function confined(root, ...parts) {
  const candidate = resolve(root, ...parts)
  if (!inside(root, candidate)) {
    fail('extension-manager/path-escape', 'path escapes the private extension root', {
      root,
      candidate,
    })
  }
  return candidate
}

function safeRelativePath(value, label, allowEmpty = false) {
  if (typeof value !== 'string') {
    fail('extension-manager/path-invalid', `${label} must be text`)
  }
  if (WINDOWS_DRIVE.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    fail('extension-manager/path-invalid', `${label} must be relative`, { path: value })
  }
  const parts = value.replaceAll('\\', '/').split('/')
  const normalized = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      fail('extension-manager/path-invalid', `${label} may not contain parent traversal`, {
        path: value,
      })
    }
    if (
      part.includes('\0') ||
      part.includes(':') ||
      part.endsWith('.') ||
      part.endsWith(' ') ||
      WINDOWS_RESERVED.test(part)
    ) {
      fail('extension-manager/path-invalid', `${label} is not a portable relative path`, {
        path: value,
        segment: part,
      })
    }
    normalized.push(part)
  }
  const result = normalized.join('/')
  if (!allowEmpty && result === '') {
    fail('extension-manager/path-invalid', `${label} may not be empty`, { path: value })
  }
  return result
}

function statePath(root, name) {
  return confined(root, name)
}

function assertRegularFile(path, label) {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    fail('extension-manager/state-node-refused', `${label} must be a regular file`, { path })
  }
}

function assertRegularTree(root, current = root) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = confined(root, relative(root, join(current, entry.name)))
    if (entry.isSymbolicLink()) {
      fail('extension-manager/artifact-link-refused', 'managed artifacts may not contain links', {
        path,
      })
    }
    if (entry.isDirectory()) assertRegularTree(root, path)
    else if (!entry.isFile()) {
      fail(
        'extension-manager/artifact-node-refused',
        'managed artifacts may contain only regular files and directories',
        { path },
      )
    }
  }
}

async function regularTreeDigest(root, limits) {
  assertRegularTree(root)
  const hash = createHash('sha256')
  let entries = 0
  let bytes = 0
  const visit = async current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = confined(root, relative(root, join(current, entry.name)))
      const name = relative(root, path).split(sep).join('/')
      entries += 1
      if (entries > limits.maxEntries) {
        fail('extension-manager/artifact-entry-limit', 'artifact tree has too many entries', {
          root,
          maxEntries: limits.maxEntries,
        })
      }
      if (entry.isDirectory()) {
        hash.update(`d:${Buffer.byteLength(name)}:${name}:`)
        await visit(path)
        continue
      }
      const size = statSync(path).size
      bytes += size
      if (bytes > limits.maxMaterializedBytes) {
        fail('extension-manager/artifact-byte-limit', 'artifact tree exceeds its byte limit', {
          root,
          maxMaterializedBytes: limits.maxMaterializedBytes,
        })
      }
      const content = await readFile(path)
      hash.update(`f:${Buffer.byteLength(name)}:${name}:${content.byteLength}:`)
      hash.update(content)
    }
  }
  await visit(root)
  return hash.digest('hex')
}

function existingRealRoot(root) {
  if (!existsSync(root)) return undefined
  const real = realpathSync(root)
  if (!statSync(real).isDirectory()) {
    fail('extension-manager/private-root-invalid', 'private root must be a directory', { root })
  }
  return real
}

async function writableRealRoot(root) {
  await mkdir(root, { recursive: true })
  return existingRealRoot(root)
}

async function privateDirectory(root, name) {
  const path = confined(root, name)
  await mkdir(path, { recursive: true })
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail('extension-manager/artifact-link-refused', 'private artifact directory is not regular', {
      path,
    })
  }
  const real = realpathSync(path)
  if (!inside(root, real)) {
    fail('extension-manager/path-escape', 'private artifact directory escapes its root', {
      root,
      path: real,
    })
  }
  return real
}

async function readPrivateJson(root, name) {
  const realRoot = existingRealRoot(root)
  if (realRoot === undefined) return undefined
  const path = statePath(realRoot, name)
  if (!existsSync(path)) return undefined
  assertRegularFile(path, name)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (cause) {
    fail('extension-manager/state-invalid', `${name} is not valid JSON`, { path }, cause)
  }
}

async function atomicJson(root, name, value) {
  const realRoot = await writableRealRoot(root)
  const path = statePath(realRoot, name)
  const temp = statePath(realRoot, `.${name}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temp, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, path)
  } catch (cause) {
    await handle?.close().catch(() => undefined)
    await rm(temp, { force: true }).catch(() => undefined)
    fail(
      'extension-manager/state-write-failed',
      `could not atomically write ${name}`,
      { path },
      cause,
    )
  }
}

function serialized() {
  let tail = Promise.resolve()
  return task => {
    const result = tail.then(task, task)
    tail = result.catch(() => undefined)
    return result
  }
}

function trustedKey(keys, keyId) {
  if (keys instanceof Map) return keys.get(keyId)
  if (record(keys)) return keys[keyId]
  return undefined
}

/** Verify a catalog using its Ed25519 key id and app-injected public-key allowlist. */
export function verifyExtensionCatalogSignature(catalogValue, trustedPublicKeys = {}) {
  const catalog = parseExtensionCatalog(catalogValue)
  const signature = catalog.signature
  if (signature === undefined) return false
  const material = trustedKey(trustedPublicKeys, signature.keyId)
  if (material === undefined) return false
  let key
  try {
    key = createPublicKey(material)
  } catch (cause) {
    fail(
      'extension-manager/trusted-key-invalid',
      `trusted public key «${signature.keyId}» is invalid`,
      { keyId: signature.keyId },
      cause,
    )
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    fail(
      'extension-manager/trusted-key-invalid',
      `trusted public key «${signature.keyId}» is not Ed25519`,
      { keyId: signature.keyId, type: key.asymmetricKeyType },
    )
  }
  try {
    return verifySignature(
      null,
      extensionCatalogSigningBytes(catalog),
      key,
      Buffer.from(signature.value, 'base64'),
    )
  } catch {
    return false
  }
}

function catalogLocation(value, baseDirectory = process.cwd()) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('extension-manager/catalog-source-invalid', 'catalog source must be non-empty text')
  }
  const source = value.trim()
  if (SOURCE_SCHEME.test(source) && !WINDOWS_DRIVE.test(source)) {
    let url
    try {
      url = new URL(source)
    } catch (cause) {
      fail(
        'extension-manager/catalog-source-invalid',
        'catalog source is not a valid URL',
        {
          source,
        },
        cause,
      )
    }
    if (!['file:', 'http:', 'https:'].includes(url.protocol)) {
      fail(
        'extension-manager/catalog-source-invalid',
        'Node catalog source supports only file, http and https',
        { source, protocol: url.protocol },
      )
    }
    return url.href
  }
  const path = isAbsolute(source) ? resolve(source) : resolve(baseDirectory, source)
  return pathToFileURL(path).href
}

async function fileBytes(path, maxBytes, label) {
  let info
  try {
    info = lstatSync(path)
  } catch (cause) {
    fail('extension-manager/source-unreadable', `${label} is unreadable`, { path }, cause)
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    fail('extension-manager/source-unreadable', `${label} must be a regular file`, { path })
  }
  if (info.size > maxBytes) {
    fail('extension-manager/byte-limit', `${label} exceeds the byte limit`, {
      path,
      bytes: info.size,
      maxBytes,
    })
  }
  const chunks = []
  let total = 0
  for await (const chunk of createReadStream(path)) {
    total += chunk.byteLength
    if (total > maxBytes) {
      fail('extension-manager/byte-limit', `${label} exceeds the byte limit`, {
        path,
        bytes: total,
        maxBytes,
      })
    }
    chunks.push(chunk)
  }
  return new Uint8Array(Buffer.concat(chunks, total))
}

async function fetchBytes(url, fetchImpl, maxBytes, signal, label, redirectPolicy) {
  if (typeof redirectPolicy !== 'function') {
    fail(
      'extension-manager/artifact-origin-policy-invalid',
      `${label} HTTP reads require an explicit origin policy`,
    )
  }
  let response
  let responseUrl = url
  const request = async (target, redirect) => {
    try {
      return await fetchImpl(target, { signal, redirect })
    } catch (cause) {
      fail('extension-manager/source-unreadable', `${label} request failed`, { url: target }, cause)
    }
  }
  let redirects = 0
  for (;;) {
    redirectPolicy(responseUrl)
    response = await request(responseUrl, 'manual')
    if (!HTTP_REDIRECT_STATUSES.has(response?.status)) break
    const location = response.headers?.get?.('location')
    if (typeof location !== 'string' || location.length === 0) {
      fail(
        'extension-manager/artifact-redirect-refused',
        `${label} redirect has no Location header`,
        { url: responseUrl, status: response.status },
      )
    }
    if (redirects >= MAX_ARTIFACT_REDIRECTS) {
      fail(
        'extension-manager/artifact-redirect-refused',
        `${label} redirect chain exceeds the bounded hop limit`,
        { url: responseUrl, maxRedirects: MAX_ARTIFACT_REDIRECTS },
      )
    }
    let next
    try {
      next = new URL(location, responseUrl)
    } catch (cause) {
      fail(
        'extension-manager/artifact-redirect-refused',
        `${label} redirect Location is invalid`,
        { url: responseUrl, location },
        cause,
      )
    }
    if (!['http:', 'https:'].includes(next.protocol)) {
      fail(
        'extension-manager/artifact-redirect-refused',
        `${label} redirects may target only HTTP(S)`,
        { url: responseUrl, location: next.href },
      )
    }
    await response.body?.cancel?.().catch?.(() => undefined)
    // Check before following so no request is ever issued to a disallowed redirect target.
    redirectPolicy(next.href)
    responseUrl = next.href
    redirects += 1
  }
  if (response?.redirected === true) {
    fail(
      'extension-manager/artifact-redirect-refused',
      `${label} fetch followed a redirect outside the manual redirect policy`,
      { url: responseUrl },
    )
  }
  if (typeof response?.url === 'string' && response.url.length > 0) {
    redirectPolicy(response.url)
    if (new URL(response.url).href !== new URL(responseUrl).href) {
      fail(
        'extension-manager/artifact-redirect-refused',
        `${label} fetch returned an uncontrolled final URL`,
        { requested: responseUrl, actual: response.url },
      )
    }
  }
  if (!response?.ok) {
    fail('extension-manager/source-unreadable', `${label} request returned an error`, {
      url: responseUrl,
      status: response?.status,
    })
  }
  const declared = response.headers?.get?.('content-length')
  if (declared !== null && declared !== undefined) {
    const size = Number(declared)
    if (Number.isSafeInteger(size) && size > maxBytes) {
      fail('extension-manager/byte-limit', `${label} exceeds the byte limit`, {
        url: responseUrl,
        bytes: size,
        maxBytes,
      })
    }
  }
  if (response.body === null || response.body === undefined) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      fail('extension-manager/byte-limit', `${label} exceeds the byte limit`, {
        url: responseUrl,
        bytes: bytes.byteLength,
        maxBytes,
      })
    }
    return bytes
  }
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    total += bytes.byteLength
    if (total > maxBytes) {
      await response.body.cancel?.().catch?.(() => undefined)
      fail('extension-manager/byte-limit', `${label} exceeds the byte limit`, {
        url: responseUrl,
        bytes: total,
        maxBytes,
      })
    }
    chunks.push(bytes)
  }
  return new Uint8Array(Buffer.concat(chunks, total))
}

function jsonBytes(bytes, label) {
  try {
    return JSON.parse(textDecoder.decode(bytes))
  } catch (cause) {
    fail('extension-manager/json-invalid', `${label} is not valid UTF-8 JSON`, {}, cause)
  }
}

function validateCatalogState(value) {
  if (!record(value)) fail('extension-manager/state-invalid', 'catalog cache must be an object')
  exactKeys(value, ['schemaVersion', 'source', 'catalog'], 'catalog cache')
  if (value.schemaVersion !== 1 || typeof value.source !== 'string') {
    fail('extension-manager/state-invalid', 'catalog cache schema is malformed')
  }
  return Object.freeze({
    schemaVersion: 1,
    source: value.source,
    catalog: parseExtensionCatalog(value.catalog),
  })
}

/** Cached reads never contact the catalog. Only refresh performs file or HTTP acquisition. */
export function createNodeCatalogSource(options = {}) {
  const root = privateRoot(options.root)
  const source = catalogLocation(options.source, options.baseDirectory)
  const trustedPublicKeys = options.trustedPublicKeys ?? {}
  const maxBytes = positiveSafeInteger(options.maxBytes, 8 * 1024 * 1024, 'maxBytes')
  const fetchImpl = options.fetch ?? globalThis.fetch
  const write = serialized()

  const resultOf = state =>
    Object.freeze({
      catalog: state.catalog,
      source: state.source,
      signatureVerified: verifyExtensionCatalogSignature(state.catalog, trustedPublicKeys),
    })

  return Object.freeze({
    async cached() {
      const value = await readPrivateJson(root, CATALOG_STATE)
      if (value === undefined) return undefined
      const state = validateCatalogState(value)
      return state.source === source ? resultOf(state) : undefined
    },
    refresh(signal) {
      return write(async () => {
        const url = new URL(source)
        let bytes
        if (url.protocol === 'file:') {
          bytes = await fileBytes(fileURLToPath(url), maxBytes, 'catalog')
        } else {
          if (typeof fetchImpl !== 'function') {
            fail('extension-manager/fetch-missing', 'HTTP catalog refresh requires fetch')
          }
          bytes = await fetchBytes(source, fetchImpl, maxBytes, signal, 'catalog', target =>
            requireAllowedArtifactOrigin(target, options.allowedOrigins),
          )
        }
        const catalog = parseExtensionCatalog(jsonBytes(bytes, 'catalog'))
        const state = Object.freeze({ schemaVersion: 1, source, catalog })
        await atomicJson(root, CATALOG_STATE, state)
        return resultOf(state)
      })
    },
  })
}

function localRepositoryUri(candidate) {
  const uri = candidate.source.uri
  if (SOURCE_SCHEME.test(uri) && !WINDOWS_DRIVE.test(uri)) {
    const url = new URL(uri)
    if (url.protocol !== 'file:') {
      fail(
        'extension-manager/linked-source-invalid',
        'linked development repositories must use local file paths',
        { uri },
      )
    }
    return url.href
  }
  let base
  try {
    base = new URL(candidate.catalogSource)
  } catch {
    base = pathToFileURL(resolve(candidate.catalogSource))
  }
  if (base.protocol !== 'file:') {
    fail(
      'extension-manager/linked-source-invalid',
      'relative linked repositories require a local file catalog',
      { uri, catalogSource: candidate.catalogSource },
    )
  }
  return new URL(uri, base).href
}

function localArtifactUri(candidate) {
  const uri = candidate.source.uri
  if (SOURCE_SCHEME.test(uri) && !WINDOWS_DRIVE.test(uri)) return new URL(uri).href
  return localRepositoryUri(candidate)
}

function extensionRoot(repositoryRoot, entry, expectedId) {
  if (entry.path === undefined) {
    fail(
      'extension-manager/linked-source-invalid',
      `linked extension «${expectedId}» must declare a repository path`,
      { expectedId },
    )
  }
  const relativePath = safeRelativePath(entry.path, `repository path for ${expectedId}`, true)
  const lexical = confined(repositoryRoot, relativePath)
  if (!existsSync(lexical)) {
    fail('extension-manager/artifact-path-missing', `linked extension «${expectedId}» is missing`, {
      expectedId,
      path: lexical,
    })
  }
  const info = lstatSync(lexical)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail(
      'extension-manager/artifact-link-refused',
      `linked extension «${expectedId}» must be a regular directory`,
      { expectedId, path: lexical },
    )
  }
  const real = realpathSync(lexical)
  if (!inside(repositoryRoot, real)) {
    fail(
      'extension-manager/path-escape',
      `linked extension «${expectedId}» escapes its repository`,
      { expectedId, repositoryRoot, root: real },
    )
  }
  assertRegularTree(real)
  return Object.freeze({ root: real, expectedId })
}

async function packageIdentity(root, expectedId) {
  const path = join(root, 'package.json')
  let packageJson
  try {
    packageJson = JSON.parse(await readFile(path, 'utf8'))
  } catch (cause) {
    fail(
      'extension-manager/extension-package-invalid',
      `extension root «${root}» has no valid package.json`,
      { root, expectedId },
      cause,
    )
  }
  const manifest = packageJson?.modkit
  const actualId =
    record(manifest) && typeof manifest.publisher === 'string' && typeof manifest.id === 'string'
      ? `${manifest.publisher}/${manifest.id}`
      : undefined
  if (actualId !== expectedId) {
    fail(
      'extension-manager/extension-id-mismatch',
      `extension root does not match declared id «${expectedId}»`,
      { root, expectedId, actualId },
    )
  }
}

function exactRepositoryRoots(manifest, expectedIds, repositoryRoot) {
  const entries = new Map()
  for (const entry of manifest.extensions) {
    if (entry.id === undefined || !entry.enabled) continue
    entries.set(entry.id, entry)
  }
  const actualIds = [...entries.keys()].sort()
  const expected = [...expectedIds].sort()
  if (
    actualIds.length !== expected.length ||
    actualIds.some((id, index) => id !== expected[index])
  ) {
    fail(
      'extension-manager/repository-package-mismatch',
      'repository roots do not exactly match the catalog package',
      { actualIds, expectedIds: expected },
    )
  }
  return expectedIds.map(id => extensionRoot(repositoryRoot, entries.get(id), id))
}

async function linkedArtifact(candidate, vfs) {
  if (
    candidate.remote ||
    candidate.source.kind !== 'repository' ||
    candidate.source.trust.mode !== 'local-user'
  ) {
    return undefined
  }
  const uri = localRepositoryUri(candidate)
  const repositoryPath = fileURLToPath(uri)
  if (!existsSync(repositoryPath)) {
    fail('extension-manager/source-unreadable', 'linked repository is missing', {
      path: repositoryPath,
    })
  }
  const repositoryInfo = lstatSync(repositoryPath)
  if (repositoryInfo.isSymbolicLink() || !repositoryInfo.isDirectory()) {
    fail(
      'extension-manager/artifact-link-refused',
      'linked repository must be a regular directory',
      { path: repositoryPath },
    )
  }
  const repositoryRoot = realpathSync(repositoryPath)
  const descriptorPath = confined(repositoryRoot, 'modkit.repository.json')
  if (!existsSync(descriptorPath)) {
    fail('extension-manager/source-unreadable', 'linked repository manifest is missing', {
      path: descriptorPath,
    })
  }
  assertRegularFile(descriptorPath, 'linked repository manifest')
  const opened = await openRepositorySource(
    vfs,
    Object.freeze({ id: candidate.id, uri, enabled: true }),
  )
  try {
    const roots = exactRepositoryRoots(opened.manifest, candidate.extensions, repositoryRoot)
    for (const root of roots) await packageIdentity(root.root, root.expectedId)
    return Object.freeze({
      kind: 'linked-repository',
      repositoryRoot,
      roots: Object.freeze(roots),
    })
  } finally {
    await opened.mount.dispose()
  }
}

async function vfsBytes(vfs, uri, maxBytes, signal) {
  const mount = await vfs.openMount(uri, { signal })
  try {
    const bytes = await readMountBytes(mount, '', signal)
    if (bytes.byteLength > maxBytes) {
      fail('extension-manager/byte-limit', 'artifact exceeds the byte limit', {
        uri,
        bytes: bytes.byteLength,
        maxBytes,
      })
    }
    return bytes
  } finally {
    await mount.dispose()
  }
}

function requireAllowedArtifactOrigin(uri, configured) {
  const values = configured ?? []
  if (!Array.isArray(values) || values.length > 128) {
    fail(
      'extension-manager/artifact-origin-policy-invalid',
      'artifact allowed origins must be a bounded list',
    )
  }
  const allowed = new Set()
  for (const value of values) {
    try {
      const parsed = new URL(value)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('not HTTP(S)')
      allowed.add(parsed.origin)
    } catch {
      fail(
        'extension-manager/artifact-origin-policy-invalid',
        'artifact allowed origins contain an invalid HTTP(S) URL',
        { value },
      )
    }
  }
  const origin = new URL(uri).origin
  if (!allowed.has(origin)) {
    fail(
      'extension-manager/artifact-origin-refused',
      'remote artifact origin is not in the application allowlist',
      { origin },
    )
  }
}

/** Acquire immutable bytes, or an explicit local-user linked repository descriptor. */
export function createNodeArtifactAcquirer(options = {}) {
  const maxBytes = positiveSafeInteger(options.maxBytes, 256 * 1024 * 1024, 'maxBytes')
  const fetchImpl = options.fetch ?? globalThis.fetch
  const owned =
    options.vfs === undefined
      ? createNodeExtensionVfs({
          ...(options.vfsOptions ?? {}),
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          limits: {
            ...(options.vfsOptions?.limits ?? {}),
            maxFileBytes: BigInt(maxBytes),
            maxReadBytes: BigInt(maxBytes),
            maxStreamBytes: BigInt(maxBytes),
          },
        })
      : undefined
  const vfs = options.vfs?.vfs ?? options.vfs ?? owned.vfs

  return Object.freeze({
    async acquire(candidate, signal) {
      const linked = await linkedArtifact(candidate, vfs)
      if (linked !== undefined) return Object.freeze({ artifact: linked })
      if (candidate.remote && !candidate.trusted) {
        fail(
          'extension-manager/remote-artifact-refused',
          'remote artifacts require a trusted signed catalog',
          { id: candidate.id, uri: candidate.source.uri },
        )
      }
      const uri = localArtifactUri(candidate)
      let protocol
      try {
        protocol = new URL(uri).protocol
      } catch {
        protocol = 'file:'
      }
      let bytes
      if (protocol === 'http:' || protocol === 'https:') {
        // Artifact URLs come from catalog data, not directly from the app setting. They must pass
        // an app-owned origin policy even after the catalog signature and digest have been checked;
        // otherwise a signed catalog becomes an SSRF allowlist bypass.
        if (typeof fetchImpl !== 'function') {
          fail('extension-manager/fetch-missing', 'HTTP artifact acquisition requires fetch')
        }
        bytes = await fetchBytes(uri, fetchImpl, maxBytes, signal, 'artifact', target =>
          requireAllowedArtifactOrigin(target, options.vfsOptions?.allowedOrigins),
        )
      } else if (['file:', 'memory:', 'browser-file:', 'rapid+file:'].includes(protocol)) {
        bytes = await vfsBytes(vfs, uri, maxBytes, signal)
      } else {
        fail('extension-manager/artifact-protocol-refused', 'artifact protocol is not supported', {
          uri,
          protocol,
        })
      }
      if (candidate.source.bytes !== undefined && candidate.source.bytes !== bytes.byteLength) {
        fail(
          'extension-manager/artifact-size-mismatch',
          'artifact byte length does not match catalog',
          {
            id: candidate.id,
            expected: candidate.source.bytes,
            actual: bytes.byteLength,
          },
        )
      }
      const integrity = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
      if (candidate.remote && !SHA256_INTEGRITY.test(candidate.source.integrity ?? '')) {
        fail(
          'extension-manager/remote-artifact-refused',
          'remote artifacts require sha256 integrity metadata',
          { id: candidate.id, uri },
        )
      }
      if (candidate.source.integrity !== undefined && candidate.source.integrity !== integrity) {
        fail('extension-manager/integrity-mismatch', 'artifact bytes do not match catalog sha256', {
          id: candidate.id,
          expected: candidate.source.integrity,
          actual: integrity,
        })
      }
      return Object.freeze({
        artifact: Object.freeze({ kind: 'portable-repository', bytes }),
        integrity,
      })
    },
    async dispose() {
      await owned?.vfs.dispose()
    },
  })
}

function validateRootState(root, storage, value, packageId) {
  if (!record(value)) fail('extension-manager/state-invalid', 'installed root must be an object')
  exactKeys(value, ['root', 'expectedId'], 'installed root')
  if (typeof value.root !== 'string' || !PACKAGE_ID.test(value.expectedId)) {
    fail('extension-manager/state-invalid', 'installed root is malformed', { packageId })
  }
  if (storage === 'managed') {
    const name = safeRelativePath(value.root, 'managed installed root')
    const path = confined(root, name)
    if (!existsSync(path)) {
      fail('extension-manager/state-invalid', 'managed installed root is missing', {
        packageId,
        path,
      })
    }
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isDirectory() || !inside(root, realpathSync(path))) {
      fail('extension-manager/artifact-link-refused', 'managed root is not confined', {
        packageId,
        path,
      })
    }
    assertRegularTree(path)
    return Object.freeze({ root: path, expectedId: value.expectedId })
  }
  if (!isAbsolute(value.root)) {
    fail('extension-manager/state-invalid', 'linked installed roots must be absolute', {
      packageId,
    })
  }
  const path = resolve(value.root)
  if (!existsSync(path)) {
    fail('extension-manager/state-invalid', 'linked installed root is missing', {
      packageId,
      path,
    })
  }
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail('extension-manager/artifact-link-refused', 'linked installed root is not a directory', {
      packageId,
      path,
    })
  }
  return Object.freeze({ root: realpathSync(path), expectedId: value.expectedId })
}

function validateArtifactPackage(root, value) {
  if (!record(value)) fail('extension-manager/state-invalid', 'installed package must be an object')
  exactKeys(
    value,
    [
      'id',
      'version',
      'displayName',
      'publisher',
      'source',
      'trusted',
      ...(value.presentation === undefined ? [] : ['presentation']),
      'storage',
      'artifactKey',
      'roots',
    ],
    'installed package',
  )
  if (
    !PACKAGE_ID.test(value.id) ||
    typeof value.version !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.publisher !== 'string' ||
    typeof value.source !== 'string' ||
    typeof value.trusted !== 'boolean' ||
    !['managed', 'linked'].includes(value.storage) ||
    !Array.isArray(value.roots) ||
    value.roots.length === 0
  ) {
    fail('extension-manager/state-invalid', 'installed package is malformed')
  }
  if (
    (value.storage === 'managed' && !SAFE_ARTIFACT_KEY.test(value.artifactKey)) ||
    (value.storage === 'linked' && value.artifactKey !== null)
  ) {
    fail('extension-manager/state-invalid', 'installed package storage key is malformed', {
      id: value.id,
    })
  }
  const expectedIds = new Set()
  const roots = value.roots.map((item, index) => {
    if (
      value.storage === 'managed' &&
      safeRelativePath(item?.root, 'managed installed root') !==
        `artifacts/${value.artifactKey}/roots/${index}`
    ) {
      fail(
        'extension-manager/state-invalid',
        'managed installed root does not match artifact key',
        {
          id: value.id,
          index,
        },
      )
    }
    const installedRoot = validateRootState(root, value.storage, item, value.id)
    if (expectedIds.has(installedRoot.expectedId)) {
      fail('extension-manager/state-invalid', 'installed package has duplicate roots', {
        id: value.id,
        expectedId: installedRoot.expectedId,
      })
    }
    expectedIds.add(installedRoot.expectedId)
    return installedRoot
  })
  const presentation =
    value.presentation === undefined
      ? undefined
      : snapshotExtensionPresentation(value.presentation, 'installed package.presentation')
  return Object.freeze({
    id: value.id,
    version: value.version,
    displayName: value.displayName,
    publisher: value.publisher,
    source: value.source,
    trusted: value.trusted,
    ...(presentation === undefined ? {} : { presentation }),
    roots: Object.freeze(roots),
  })
}

function validateArtifactState(root, value) {
  if (!record(value)) fail('extension-manager/state-invalid', 'package state must be an object')
  exactKeys(value, ['schemaVersion', 'packages'], 'package state')
  if (value.schemaVersion !== 1 || !Array.isArray(value.packages)) {
    fail('extension-manager/state-invalid', 'package state schema is malformed')
  }
  const ids = new Set()
  for (const item of value.packages) {
    if (!record(item) || typeof item.id !== 'string' || ids.has(item.id)) {
      fail('extension-manager/state-invalid', 'package state contains duplicate or invalid ids')
    }
    ids.add(item.id)
  }
  return value
}

async function artifactState(root) {
  const value = await readPrivateJson(root, ARTIFACT_STATE)
  return value === undefined
    ? Object.freeze({ schemaVersion: 1, packages: Object.freeze([]) })
    : validateArtifactState(existingRealRoot(root), value)
}

function installedOf(root, value) {
  return validateArtifactPackage(root, value)
}

function decodeEmbedded(encoded, label) {
  if (typeof encoded !== 'string' || !BASE64.test(encoded)) {
    fail('extension-manager/artifact-base64-invalid', `${label} is not canonical base64`)
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) {
    fail('extension-manager/artifact-base64-invalid', `${label} is not canonical base64`)
  }
  return bytes
}

function portableManifest(artifact, entry) {
  if (!record(artifact) || artifact.kind !== 'portable-repository') {
    fail('extension-manager/artifact-invalid', 'artifact must be a portable repository')
  }
  if (!(artifact.bytes instanceof Uint8Array)) {
    fail('extension-manager/artifact-invalid', 'portable repository bytes are missing')
  }
  const manifest = normalizeRepositoryManifest(jsonBytes(artifact.bytes, 'portable repository'))
  const entries = new Map()
  for (const item of manifest.extensions) {
    if (item.id === undefined || !item.enabled) continue
    entries.set(item.id, item)
  }
  const expected = [...entry.extensions].sort()
  const actual = [...entries.keys()].sort()
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    fail(
      'extension-manager/repository-package-mismatch',
      'portable repository roots do not exactly match the catalog package',
      { id: entry.id, actual, expected },
    )
  }
  for (const id of expected) {
    if (entries.get(id).files === undefined) {
      fail(
        'extension-manager/remote-path-only-refused',
        `portable repository root «${id}» must embed its files`,
        { id: entry.id, expectedId: id },
      )
    }
  }
  return { manifest, entries }
}

async function materializePortable(root, request, limits) {
  const { entry, artifact } = request
  const { entries } = portableManifest(artifact, entry)
  if (!SHA256_INTEGRITY.test(request.integrity ?? '')) {
    fail(
      'extension-manager/integrity-missing',
      'portable repository installation requires verified sha256 integrity',
      { id: entry.id },
    )
  }
  const actualIntegrity = `sha256:${createHash('sha256').update(artifact.bytes).digest('hex')}`
  if (actualIntegrity !== request.integrity) {
    fail(
      'extension-manager/integrity-mismatch',
      'portable repository bytes changed after acquisition',
      {
        id: entry.id,
        expected: request.integrity,
        actual: actualIntegrity,
      },
    )
  }
  const artifactKey = createHash('sha256')
    .update(`${entry.id}\0${entry.version}\0${actualIntegrity}`)
    .digest('hex')
  const realRoot = await writableRealRoot(root)
  const artifactsRoot = await privateDirectory(realRoot, 'artifacts')
  const stagingRoot = await privateDirectory(realRoot, '.staging')
  const destination = confined(artifactsRoot, artifactKey)
  const stage = confined(stagingRoot, randomUUID())
  const roots = []
  let fileCount = 0
  let materializedBytes = 0
  try {
    for (const [index, expectedId] of entry.extensions.entries()) {
      const rootPath = confined(stage, 'roots', String(index))
      await mkdir(rootPath, { recursive: true })
      const names = new Set()
      for (const [name, encoded] of Object.entries(entries.get(expectedId).files)) {
        const safeName = safeRelativePath(name, `embedded file for ${expectedId}`)
        if (names.has(safeName)) {
          fail(
            'extension-manager/artifact-path-duplicate',
            'portable repository has duplicate paths',
            {
              expectedId,
              path: safeName,
            },
          )
        }
        names.add(safeName)
        fileCount += 1
        if (fileCount > limits.maxEntries) {
          fail('extension-manager/artifact-entry-limit', 'portable repository has too many files', {
            maxEntries: limits.maxEntries,
          })
        }
        const bytes = decodeEmbedded(encoded, `embedded file ${expectedId}/${safeName}`)
        materializedBytes += bytes.byteLength
        if (materializedBytes > limits.maxMaterializedBytes) {
          fail('extension-manager/artifact-byte-limit', 'portable repository is too large', {
            maxMaterializedBytes: limits.maxMaterializedBytes,
          })
        }
        const path = confined(rootPath, safeName)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
      }
      await packageIdentity(rootPath, expectedId)
      roots.push(
        Object.freeze({
          root: relative(realRoot, rootPath).split(sep).join('/'),
          expectedId,
        }),
      )
    }
    const treeDigest = await regularTreeDigest(stage, limits)
    if (existsSync(destination)) {
      const info = lstatSync(destination)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        fail(
          'extension-manager/artifact-destination-conflict',
          'immutable artifact destination is not a directory',
          { destination },
        )
      }
      const existingDigest = await regularTreeDigest(destination, limits)
      if (existingDigest !== treeDigest) {
        fail(
          'extension-manager/artifact-destination-conflict',
          'immutable artifact destination does not match the verified staged tree',
          { destination, expectedTreeDigest: treeDigest, actualTreeDigest: existingDigest },
        )
      }
      for (const [index, expectedId] of entry.extensions.entries()) {
        await packageIdentity(confined(destination, 'roots', String(index)), expectedId)
      }
      await rm(stage, { recursive: true, force: true })
    } else {
      await rename(stage, destination)
    }
    return Object.freeze({
      storage: 'managed',
      artifactKey,
      roots: Object.freeze(
        roots.map(item =>
          Object.freeze({
            root: item.root.replace(
              `.staging/${stage.split(sep).at(-1)}`,
              `artifacts/${artifactKey}`,
            ),
            expectedId: item.expectedId,
          }),
        ),
      ),
    })
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function linkedStorage(artifact, entry) {
  if (!record(artifact) || artifact.kind !== 'linked-repository') return undefined
  if (entry.remote || entry.source.trust.mode !== 'local-user') {
    fail(
      'extension-manager/linked-source-invalid',
      'linked repositories are allowed only for explicit local-user sources',
      { id: entry.id },
    )
  }
  if (!Array.isArray(artifact.roots) || artifact.roots.length === 0) {
    fail('extension-manager/artifact-invalid', 'linked repository has no roots', { id: entry.id })
  }
  if (typeof artifact.repositoryRoot !== 'string' || !isAbsolute(artifact.repositoryRoot)) {
    fail('extension-manager/artifact-invalid', 'linked repository root must be an absolute path', {
      id: entry.id,
    })
  }
  const repositoryPath = resolve(artifact.repositoryRoot)
  const repositoryInfo = lstatSync(repositoryPath)
  if (repositoryInfo.isSymbolicLink() || !repositoryInfo.isDirectory()) {
    fail(
      'extension-manager/artifact-link-refused',
      'linked repository root must be a regular directory',
      { id: entry.id, repositoryRoot: repositoryPath },
    )
  }
  const repositoryRoot = realpathSync(repositoryPath)
  const expected = [...entry.extensions].sort()
  const actual = artifact.roots.map(item => item.expectedId).sort()
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    fail('extension-manager/repository-package-mismatch', 'linked roots do not match catalog', {
      id: entry.id,
      actual,
      expected,
    })
  }
  const roots = []
  for (const item of artifact.roots) {
    if (!record(item) || typeof item.root !== 'string' || !isAbsolute(item.root)) {
      fail('extension-manager/artifact-invalid', 'linked root must be an absolute path', {
        id: entry.id,
      })
    }
    const path = resolve(item.root)
    const info = lstatSync(path)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      fail('extension-manager/artifact-link-refused', 'linked root must be a regular directory', {
        id: entry.id,
        path,
      })
    }
    const real = realpathSync(path)
    if (!inside(repositoryRoot, real)) {
      fail('extension-manager/path-escape', 'linked root escapes its repository', {
        id: entry.id,
        repositoryRoot,
        root: real,
      })
    }
    assertRegularTree(real)
    await packageIdentity(real, item.expectedId)
    roots.push(Object.freeze({ root: real, expectedId: item.expectedId }))
  }
  return Object.freeze({
    storage: 'linked',
    artifactKey: null,
    roots: Object.freeze(roots),
  })
}

function storedPackage(request, storage) {
  return Object.freeze({
    id: request.entry.id,
    version: request.entry.version,
    displayName: request.entry.displayName,
    publisher: request.entry.publisher,
    source: request.entry.source.uri,
    trusted: request.entry.trusted,
    ...(request.entry.presentation === undefined
      ? {}
      : { presentation: request.entry.presentation }),
    storage: storage.storage,
    artifactKey: storage.artifactKey,
    roots: storage.roots,
  })
}

/** Private-root package store. Managed roots are always materialized from embedded regular files. */
export function createNodeArtifactStore(options = {}) {
  const root = privateRoot(options.root)
  const limits = Object.freeze({
    maxEntries: positiveSafeInteger(options.maxEntries, 20_000, 'maxEntries'),
    maxMaterializedBytes: positiveSafeInteger(
      options.maxMaterializedBytes,
      512 * 1024 * 1024,
      'maxMaterializedBytes',
    ),
  })
  const write = serialized()

  const list = async () => {
    const state = await artifactState(root)
    const realRoot = existingRealRoot(root)
    if (state.packages.length === 0) return Object.freeze([])
    return Object.freeze(state.packages.map(item => installedOf(realRoot, item)))
  }

  return Object.freeze({
    list,
    install(request) {
      return write(async () => {
        if (!record(request) || !record(request.entry)) {
          fail('extension-manager/artifact-invalid', 'artifact install request is malformed')
        }
        let storage = await linkedStorage(request.artifact, request.entry)
        storage ??= await materializePortable(root, request, limits)
        const nextPackage = storedPackage(request, storage)
        const before = await artifactState(root)
        const packages = [
          ...before.packages.filter(item => item.id !== request.entry.id),
          nextPackage,
        ].sort((left, right) => left.id.localeCompare(right.id))
        await atomicJson(root, ARTIFACT_STATE, { schemaVersion: 1, packages })
        // Previous immutable artifacts intentionally survive update. Content-addressed artifacts
        // stay available for crash recovery and a later explicit garbage-collection pass; apps do
        // not project managed roots into their settings or own an artifact rollback protocol.
        return installedOf(existingRealRoot(root), nextPackage)
      })
    },
    remove(id) {
      return write(async () => {
        const before = await artifactState(root)
        const previous = before.packages.find(item => item.id === id)
        if (previous === undefined) return
        const packages = before.packages.filter(item => item.id !== id)
        await atomicJson(root, ARTIFACT_STATE, { schemaVersion: 1, packages })
        if (previous.storage === 'managed' && SAFE_ARTIFACT_KEY.test(previous.artifactKey)) {
          const realRoot = existingRealRoot(root)
          await rm(confined(realRoot, 'artifacts', previous.artifactKey), {
            recursive: true,
            force: true,
          }).catch(() => undefined)
        }
      })
    },
  })
}

function validateEnablementState(value) {
  if (!record(value)) fail('extension-manager/state-invalid', 'enablement state must be an object')
  exactKeys(value, ['schemaVersion', 'entries'], 'enablement state')
  if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    fail('extension-manager/state-invalid', 'enablement state schema is malformed')
  }
  const ids = new Set()
  for (const entry of value.entries) {
    if (!record(entry))
      fail('extension-manager/state-invalid', 'enablement entry must be an object')
    exactKeys(entry, ['id', 'enabled'], 'enablement entry')
    if (!PACKAGE_ID.test(entry.id) || typeof entry.enabled !== 'boolean' || ids.has(entry.id)) {
      fail('extension-manager/state-invalid', 'enablement entry is malformed')
    }
    ids.add(entry.id)
  }
  return Object.freeze({
    schemaVersion: 1,
    entries: Object.freeze(
      value.entries.map(entry => Object.freeze({ id: entry.id, enabled: entry.enabled })),
    ),
  })
}

async function enablementState(root) {
  const value = await readPrivateJson(root, ENABLEMENT_STATE)
  return value === undefined
    ? Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) })
    : validateEnablementState(value)
}

/** Atomic JSON enablement map. Reads are inert and do not create the private root. */
export function createNodeEnablementStore(options = {}) {
  const root = privateRoot(options.root)
  const write = serialized()
  return Object.freeze({
    async list() {
      return (await enablementState(root)).entries
    },
    setEnabled(id, enabled) {
      return write(async () => {
        if (!PACKAGE_ID.test(id) || typeof enabled !== 'boolean') {
          fail('extension-manager/enablement-invalid', 'enablement update is malformed', {
            id,
            enabled,
          })
        }
        const before = await enablementState(root)
        const entries = [
          ...before.entries.filter(entry => entry.id !== id),
          Object.freeze({ id, enabled }),
        ].sort((left, right) => left.id.localeCompare(right.id))
        await atomicJson(root, ENABLEMENT_STATE, { schemaVersion: 1, entries })
      })
    },
    remove(id) {
      return write(async () => {
        const before = await enablementState(root)
        const entries = before.entries.filter(entry => entry.id !== id)
        if (entries.length === before.entries.length) return
        await atomicJson(root, ENABLEMENT_STATE, { schemaVersion: 1, entries })
      })
    },
  })
}

/** Node composition for VS Code/Electron. It never imports Host and exposes enabled roots directly. */
export function createNodeExtensionManager(options = {}) {
  const root = privateRoot(options.root)
  const catalogSource =
    options.catalogSource ??
    createNodeCatalogSource({
      root,
      source: options.catalog,
      ...(options.baseDirectory === undefined ? {} : { baseDirectory: options.baseDirectory }),
      ...(options.trustedPublicKeys === undefined
        ? {}
        : { trustedPublicKeys: options.trustedPublicKeys }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      allowedOrigins: options.vfsOptions?.allowedOrigins ?? [],
      ...(options.maxCatalogBytes === undefined ? {} : { maxBytes: options.maxCatalogBytes }),
    })
  const artifactAcquirer =
    options.artifactAcquirer ??
    createNodeArtifactAcquirer({
      ...(options.vfs === undefined ? {} : { vfs: options.vfs }),
      ...(options.vfsOptions === undefined ? {} : { vfsOptions: options.vfsOptions }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.maxArtifactBytes === undefined ? {} : { maxBytes: options.maxArtifactBytes }),
    })
  const artifactStore =
    options.artifactStore ??
    createNodeArtifactStore({
      root,
      ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
      ...(options.maxMaterializedBytes === undefined
        ? {}
        : { maxMaterializedBytes: options.maxMaterializedBytes }),
    })
  const enablementStore = options.enablementStore ?? createNodeEnablementStore({ root })
  const client = createExtensionManagerClient({
    catalogSource,
    artifactAcquirer,
    artifactStore,
    enablementStore,
    ...(options.channels === undefined ? {} : { channels: options.channels }),
  })
  return Object.freeze({
    client,
    catalogSource,
    artifactAcquirer,
    artifactStore,
    enablementStore,
    snapshot: () => client.snapshot(),
    refresh: () => client.refresh(),
    install: (id, version) => client.install(id, version),
    update: id => client.update(id),
    remove: id => client.remove(id),
    setEnabled: (id, enabled) => client.setEnabled(id, enabled),
    async installedRoots() {
      const [packages, enablement] = await Promise.all([
        artifactStore.list(),
        enablementStore.list(),
      ])
      const enabled = new Map(enablement.map(entry => [entry.id, entry.enabled]))
      return Object.freeze(
        packages
          .filter(entry => enabled.get(entry.id) === true)
          .flatMap(entry => entry.roots)
          .map(entry => {
            if (typeof entry.root !== 'string' || !isAbsolute(entry.root)) {
              fail(
                'extension-manager/artifact-store-invalid',
                'Node installed roots must be absolute filesystem paths',
                { root: entry.root, expectedId: entry.expectedId },
              )
            }
            return Object.freeze({ root: resolve(entry.root), expectedId: entry.expectedId })
          }),
      )
    },
    async dispose() {
      await artifactAcquirer.dispose?.()
    },
  })
}
