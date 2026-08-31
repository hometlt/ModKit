import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { normalizeVfsPath } from '@modkit/vfs'

import { createNodeExtensionVfs } from './providers-node.js'
import {
  ExtensionManagerError,
  normalizeExtensionLock,
  normalizeWorkspaceConfiguration,
} from './schema.js'
import { openRepositorySource, readMountBytes } from './vfs.js'

const CONFIG_NAME = 'modkit.workspace.json'
const SOURCE_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i
const IGNORED_TREE_NAMES = new Set(['.git', 'node_modules'])

function fail(code, message, context, cause) {
  throw new ExtensionManagerError(code, message, context, cause)
}

function parseJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (cause) {
    fail('extension-manager/json-invalid', `${label} «${path}» is not valid JSON`, { path }, cause)
  }
}

function sourceValue(source, environment) {
  const override = source.environment === undefined ? undefined : environment[source.environment]
  return override === undefined || override.trim() === '' ? source.uri : override.trim()
}

function asSourceUri(value, configurationPath) {
  if (SOURCE_SCHEME.test(value) && !WINDOWS_DRIVE.test(value)) return new URL(value).href
  const path = isAbsolute(value) ? resolve(value) : resolve(dirname(configurationPath), value)
  return pathToFileURL(path).href
}

function inside(root, candidate) {
  const offset = relative(root, candidate)
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))
}

function safeRelativePath(value, label, allowEmpty = false) {
  if (typeof value !== 'string') fail('extension-manager/path-invalid', `${label} must be text`)
  const normalized = normalizeVfsPath(value === '.' ? '' : value)
  if (!allowEmpty && normalized === '') {
    fail('extension-manager/path-invalid', `${label} may not be empty`)
  }
  if (WINDOWS_DRIVE.test(value) || value.startsWith('/') || value.startsWith('\\')) {
    fail('extension-manager/path-invalid', `${label} must be relative`, {
      path: value,
    })
  }
  return normalized
}

function selectedProfile(configuration, requested) {
  const name = requested ?? configuration.activeProfile
  return name === undefined ? undefined : configuration.profiles[name]
}

function matchesSelection(id, patterns) {
  if (patterns === undefined || patterns.length === 0) return true
  return patterns.some(pattern => {
    if (pattern === '*') return true
    if (pattern.endsWith('*')) return id.startsWith(pattern.slice(0, -1))
    return id === pattern
  })
}

function defaultCacheRoot(environment) {
  const local = environment.LOCALAPPDATA
  if (local !== undefined && local.trim() !== '') return resolve(local, 'Modkit', 'extensions')
  const xdg = environment.XDG_CACHE_HOME
  if (xdg !== undefined && xdg.trim() !== '') return resolve(xdg, 'modkit', 'extensions')
  return resolve(homedir(), '.cache', 'modkit', 'extensions')
}

async function filesInTree(root, current = root, output = []) {
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (IGNORED_TREE_NAMES.has(entry.name)) continue
    const path = join(current, entry.name)
    if (entry.isSymbolicLink()) {
      fail('extension-manager/artifact-link-refused', 'extension trees may not contain links', {
        path,
      })
    }
    if (entry.isDirectory()) await filesInTree(root, path, output)
    else if (entry.isFile()) output.push(path)
    else
      fail('extension-manager/artifact-node-refused', 'unsupported extension tree node', { path })
  }
  return output
}

async function digestTree(root) {
  const hash = createHash('sha256')
  const files = await filesInTree(root)
  for (const path of files) {
    const name = relative(root, path).split(sep).join('/')
    const bytes = await readFile(path)
    hash.update(String(Buffer.byteLength(name)))
    hash.update(':')
    hash.update(name)
    hash.update(':')
    hash.update(String(bytes.byteLength))
    hash.update(':')
    hash.update(bytes)
  }
  return hash.digest('hex')
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
      { root },
      cause,
    )
  }
  const manifest = packageJson.modkit
  if (manifest === null || typeof manifest !== 'object') {
    fail(
      'extension-manager/extension-manifest-missing',
      `extension root «${root}» has no package.json#modkit`,
      { root },
    )
  }
  const id = `${manifest.publisher}/${manifest.id}`
  if (expectedId !== undefined && expectedId !== id) {
    fail(
      'extension-manager/extension-id-mismatch',
      `extension «${id}» does not match declared id «${expectedId}»`,
      { root, expectedId, actualId: id },
    )
  }
  if (typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
    fail('extension-manager/extension-version-missing', `extension «${id}» has no version`, {
      root,
    })
  }
  return Object.freeze({ id, version: packageJson.version })
}

async function copyMountTree(mount, remoteRoot, localRoot, limits, signal) {
  let entries = 0
  let bytes = 0
  const visit = async (remotePath, localPath) => {
    const node = await mount.stat(remotePath, signal)
    if (node === undefined) {
      fail(
        'extension-manager/artifact-path-missing',
        `VFS artifact path «${remotePath}» is missing`,
      )
    }
    entries += 1
    if (entries > limits.maxEntries) {
      fail('extension-manager/artifact-entry-limit', 'extension artifact has too many entries', {
        maxEntries: limits.maxEntries,
      })
    }
    if (node.kind === 'directory') {
      await mkdir(localPath, { recursive: true })
      for await (const child of mount.list(remotePath, signal)) {
        if (IGNORED_TREE_NAMES.has(child.name)) continue
        const relativeChild = safeRelativePath(
          remoteRoot === '' ? child.path : child.path.slice(remoteRoot.length + 1),
          'VFS child path',
        )
        const destination = resolve(localRoot, ...relativeChild.split('/'))
        if (!inside(localRoot, destination)) {
          fail(
            'extension-manager/path-escape',
            'VFS artifact path escapes its materialization root',
            {
              path: child.path,
            },
          )
        }
        await visit(child.path, destination)
      }
      return
    }
    const data = await readMountBytes(mount, remotePath, signal)
    bytes += data.byteLength
    if (bytes > limits.maxBytes) {
      fail('extension-manager/artifact-byte-limit', 'extension artifact is too large', {
        maxBytes: limits.maxBytes,
      })
    }
    await mkdir(dirname(localPath), { recursive: true })
    await writeFile(localPath, data, { flag: 'wx' })
  }
  await visit(remoteRoot, localRoot)
}

async function copyEmbeddedFiles(files, localRoot, limits) {
  const names = Object.keys(files).sort()
  if (names.length > limits.maxEntries) {
    fail('extension-manager/artifact-entry-limit', 'embedded extension has too many files')
  }
  let total = 0
  for (const name of names) {
    const normalized = safeRelativePath(name, 'embedded file path')
    const data = Buffer.from(files[name], 'base64')
    if (data.toString('base64').replace(/=+$/u, '') !== files[name].replace(/=+$/u, '')) {
      fail('extension-manager/base64-invalid', `embedded file «${name}» is not canonical base64`)
    }
    total += data.byteLength
    if (total > limits.maxBytes) {
      fail('extension-manager/artifact-byte-limit', 'embedded extension is too large')
    }
    const destination = resolve(localRoot, ...normalized.split('/'))
    if (!inside(localRoot, destination)) {
      fail('extension-manager/path-escape', 'embedded file escapes its materialization root', {
        path: name,
      })
    }
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, data, { flag: 'wx' })
  }
}

async function materializeExtension(source, opened, entry, options) {
  const cacheRoot = resolve(options.cacheRoot)
  const stagingRoot = resolve(cacheRoot, 'staging')
  const artifactsRoot = resolve(cacheRoot, 'artifacts')
  await mkdir(stagingRoot, { recursive: true })
  await mkdir(artifactsRoot, { recursive: true })
  const stage = resolve(stagingRoot, randomUUID())
  if (!inside(stagingRoot, stage)) fail('extension-manager/path-escape', 'invalid staging path')
  await mkdir(stage, { recursive: false })
  try {
    if (entry.files !== undefined) await copyEmbeddedFiles(entry.files, stage, options.limits)
    else {
      const remoteRoot = safeRelativePath(entry.path ?? '', 'extension path', true)
      await copyMountTree(opened.mount, remoteRoot, stage, options.limits, options.signal)
    }
    const identity = await packageIdentity(stage, entry.id)
    const digest = await digestTree(stage)
    const destination = resolve(artifactsRoot, digest)
    if (!inside(artifactsRoot, destination))
      fail('extension-manager/path-escape', 'invalid artifact path')
    if (existsSync(destination)) {
      const installedDigest = await digestTree(destination)
      if (installedDigest !== digest) {
        fail(
          'extension-manager/cache-corrupt',
          `cached artifact «${destination}» does not match its digest`,
          { destination, digest, installedDigest },
        )
      }
      await rm(stage, { recursive: true, force: true })
    } else await rename(stage, destination)
    return Object.freeze({
      path: destination,
      id: identity.id,
      version: identity.version,
      digest,
      source: source.id,
      protocol: opened.protocol,
      materialized: true,
    })
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

async function localExtension(source, sourceUri, entry) {
  const repositoryRoot = realpathSync(fileURLToPath(sourceUri))
  if (!statSync(repositoryRoot).isDirectory()) {
    fail(
      'extension-manager/repository-root-invalid',
      'file repository source must be a directory',
      {
        repositoryRoot,
      },
    )
  }
  const extensionPath = safeRelativePath(entry.path ?? '', 'extension path', true)
  const candidate = resolve(repositoryRoot, ...extensionPath.split('/').filter(Boolean))
  if (!inside(repositoryRoot, candidate)) {
    fail('extension-manager/path-escape', 'extension path escapes its repository', {
      repositoryRoot,
      path: entry.path,
    })
  }
  const root = realpathSync(candidate)
  if (!inside(repositoryRoot, root) || !statSync(root).isDirectory()) {
    fail('extension-manager/extension-root-invalid', 'extension root is not a confined directory', {
      root,
    })
  }
  const identity = await packageIdentity(root, entry.id)
  const digest = await digestTree(root)
  return Object.freeze({
    path: root,
    id: identity.id,
    version: identity.version,
    digest,
    source: source.id,
    protocol: 'file',
    materialized: false,
  })
}

function readLock(configuration, configurationPath, profile, options) {
  const configured = options.lockPath ?? configuration.lockFile
  const enforce = options.enforceLock ?? profile?.locked ?? false
  if (configured === undefined) {
    if (enforce) fail('extension-manager/lock-missing', 'the selected profile requires a lock file')
    return { enforce, path: undefined, lock: undefined }
  }
  const path = isAbsolute(configured)
    ? resolve(configured)
    : resolve(dirname(configurationPath), configured)
  if (!existsSync(path)) {
    if (enforce) fail('extension-manager/lock-missing', `required lock file «${path}» is missing`)
    return { enforce, path, lock: undefined }
  }
  return {
    enforce,
    path,
    lock: normalizeExtensionLock(parseJsonFile(path, 'extension lock')),
  }
}

function verifyLock(discovered, lockState) {
  if (lockState.lock === undefined) return
  const byId = new Map(lockState.lock.extensions.map(entry => [entry.id, entry]))
  for (const extension of discovered) {
    const locked = byId.get(extension.id)
    if (locked === undefined) {
      if (lockState.enforce) {
        fail('extension-manager/lock-entry-missing', `extension «${extension.id}» is not locked`)
      }
      continue
    }
    if (
      locked.source !== extension.source ||
      locked.version !== extension.version ||
      locked.digest !== extension.digest
    ) {
      fail('extension-manager/lock-mismatch', `extension «${extension.id}» differs from its lock`, {
        expected: locked,
        actual: extension,
      })
    }
  }
  if (lockState.enforce) {
    const ids = new Set(discovered.map(extension => extension.id))
    for (const locked of lockState.lock.extensions) {
      if (!ids.has(locked.id)) {
        fail(
          'extension-manager/locked-extension-missing',
          `locked extension «${locked.id}» is absent`,
        )
      }
    }
  }
}

export function findWorkspaceConfigurationSync(start = process.cwd(), environment = process.env) {
  const explicit = environment.MODKIT_EXTENSION_WORKSPACE
  if (explicit !== undefined && explicit.trim() !== '') {
    const path = resolve(explicit)
    if (!existsSync(path)) {
      fail('extension-manager/workspace-missing', `configured workspace «${path}» is missing`, {
        path,
      })
    }
    return path
  }
  let current = resolve(start)
  if (existsSync(current) && statSync(current).isFile()) current = dirname(current)
  for (;;) {
    const candidate = join(current, CONFIG_NAME)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  fail(
    'extension-manager/workspace-missing',
    `no ${CONFIG_NAME} exists at or above «${resolve(start)}»`,
    { start: resolve(start) },
  )
}

export function loadWorkspaceConfigurationSync(path) {
  const resolved = realpathSync(resolve(path))
  return Object.freeze({
    path: resolved,
    configuration: normalizeWorkspaceConfiguration(parseJsonFile(resolved, 'extension workspace')),
  })
}

export function resolveConfiguredRepositoryRootSync(
  workspaceRoot,
  sourceId,
  environment = process.env,
) {
  const loaded = loadWorkspaceConfigurationSync(
    findWorkspaceConfigurationSync(workspaceRoot, environment),
  )
  const source = loaded.configuration.sources.find(candidate => candidate.id === sourceId)
  if (source === undefined) {
    fail('extension-manager/source-missing', `workspace has no source «${sourceId}»`, { sourceId })
  }
  const uri = asSourceUri(sourceValue(source, environment), loaded.path)
  if (new URL(uri).protocol !== 'file:') {
    fail('extension-manager/source-not-local', `source «${sourceId}» is not a local repository`, {
      sourceId,
      uri,
    })
  }
  return realpathSync(fileURLToPath(uri))
}

export function configuredSourceDescriptorSync(workspaceRoot, sourceId, environment = process.env) {
  const loaded = loadWorkspaceConfigurationSync(
    findWorkspaceConfigurationSync(workspaceRoot, environment),
  )
  const source = loaded.configuration.sources.find(candidate => candidate.id === sourceId)
  if (source === undefined) {
    fail('extension-manager/source-missing', `workspace has no source «${sourceId}»`, { sourceId })
  }
  const root = resolveConfiguredRepositoryRootSync(workspaceRoot, sourceId, environment)
  return Object.freeze({
    ...source,
    root,
    sibling: basename(root),
  })
}

export function resolveLegacyExtensionDirectorySync(
  workspaceRoot,
  parts,
  environment = process.env,
) {
  const loaded = loadWorkspaceConfigurationSync(
    findWorkspaceConfigurationSync(workspaceRoot, environment),
  )
  const match = [...loaded.configuration.legacyPaths]
    .sort((left, right) => right.prefix.length - left.prefix.length)
    .find(entry => entry.prefix.every((part, index) => parts[index] === part))
  if (match === undefined) return resolve(workspaceRoot, 'extensions', ...parts)
  const root = resolveConfiguredRepositoryRootSync(workspaceRoot, match.source, environment)
  const strip = match.strip ?? match.prefix.length
  return resolve(root, ...parts.slice(strip))
}

export async function discoverNodeExtensionRoots(options = {}) {
  const environment = options.environment ?? process.env
  const loaded =
    options.configuration === undefined
      ? loadWorkspaceConfigurationSync(
          options.configurationPath ??
            findWorkspaceConfigurationSync(options.workspaceRoot ?? process.cwd(), environment),
        )
      : Object.freeze({
          path: resolve(options.configurationPath ?? join(process.cwd(), CONFIG_NAME)),
          configuration: normalizeWorkspaceConfiguration(options.configuration),
        })
  const profile = selectedProfile(loaded.configuration, options.profile)
  const selectedSources = loaded.configuration.sources.filter(
    source =>
      source.enabled && (profile?.sources === undefined || profile.sources.includes(source.id)),
  )
  const owned = options.vfs === undefined ? createNodeExtensionVfs(options.vfsOptions) : undefined
  const vfs = options.vfs?.vfs ?? options.vfs ?? owned.vfs
  const roots = []
  try {
    for (const source of selectedSources) {
      const uri = asSourceUri(sourceValue(source, environment), loaded.path)
      const resolvedSource = Object.freeze({ ...source, uri })
      const opened = await openRepositorySource(vfs, resolvedSource, options.signal)
      try {
        for (const entry of opened.manifest.extensions) {
          if (!entry.enabled) continue
          const extension =
            opened.protocol === 'file' && entry.files === undefined
              ? await localExtension(resolvedSource, uri, entry)
              : await materializeExtension(resolvedSource, opened, entry, {
                  cacheRoot: options.cacheRoot ?? defaultCacheRoot(environment),
                  limits: {
                    maxEntries: options.maxEntries ?? 20_000,
                    maxBytes: options.maxBytes ?? 512 * 1024 * 1024,
                  },
                  signal: options.signal,
                })
          if (matchesSelection(extension.id, profile?.extensions)) roots.push(extension)
        }
      } finally {
        await opened.mount.dispose()
      }
    }
    roots.sort((left, right) => left.id.localeCompare(right.id))
    const duplicate = roots.find((entry, index) => roots[index - 1]?.id === entry.id)
    if (duplicate !== undefined) {
      fail('extension-manager/extension-duplicate', `extension «${duplicate.id}» has two sources`)
    }
    const lockState = readLock(loaded.configuration, loaded.path, profile, options)
    verifyLock(roots, lockState)
    return Object.freeze({
      configurationPath: loaded.path,
      profile: options.profile ?? loaded.configuration.activeProfile,
      protocols: owned?.protocols ?? options.protocols ?? Object.freeze([]),
      lockPath: lockState.path,
      roots: Object.freeze(roots),
      hostRoots: Object.freeze(
        roots.map(root => Object.freeze({ root: root.path, expectedId: root.id })),
      ),
    })
  } finally {
    if (owned !== undefined) await owned.vfs.dispose()
  }
}

export function extensionLockDocument(discovery) {
  return Object.freeze({
    schemaVersion: 1,
    extensions: Object.freeze(
      discovery.roots.map(root =>
        Object.freeze({
          id: root.id,
          source: root.source,
          version: root.version,
          digest: root.digest,
        }),
      ),
    ),
  })
}

export async function writeExtensionLock(discovery, path = discovery.lockPath) {
  if (path === undefined) {
    fail('extension-manager/lock-path-missing', 'no lock path was configured')
  }
  const resolved = resolve(path)
  await mkdir(dirname(resolved), { recursive: true })
  await writeFile(
    resolved,
    `${JSON.stringify(extensionLockDocument(discovery), null, 2)}\n`,
    'utf8',
  )
  return resolved
}

export { createNodeExtensionVfs } from './providers-node.js'
export {
  createNodeArtifactAcquirer,
  createNodeArtifactStore,
  createNodeCatalogSource,
  createNodeEnablementStore,
  createNodeExtensionManager,
  verifyExtensionCatalogSignature,
} from './node-adapters.js'
export { discoverLocalExtensionCandidates } from './local-candidates.js'
export * from './index.js'
