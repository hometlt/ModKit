import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

import {
  READY_APP_EXTENSIONS,
  extensionDirectory,
  extensionLocation,
} from '../app-extension-sets.mjs'
import { extensionArtifactDigest } from '../lib/extension-artifact-digest.mjs'
import { externalRepositoryDescriptor } from '../lib/external-extension-roots.mjs'

const RELEASE_ID = 'modkitx-mk3-focused-local-rc'
const REQUIRED_PROFILE_IDS = Object.freeze([
  'common-documents',
  'headless-mod-ci',
  'sc2-mod-studio',
  'universal-asset-explorer',
  'warzone-2100-studio',
])
const DEFERRED_PATH_PREFIXES = Object.freeze(['extensions/ea/', 'extensions/opensource/spring/'])
const GENERATED_NAMES = Object.freeze([
  'LICENSE-NOTICES.txt',
  'release-manifest.json',
  'sbom.cdx.json',
])
const INSTALL_GUIDE_NAME = 'INSTALL.md'
const DEFAULT_SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules'])
const WORKSPACE_SCAN_SKIPPED_DIRECTORY_NAMES = new Set([
  ...DEFAULT_SKIPPED_DIRECTORY_NAMES,
  'coverage',
  'dist',
  'dist-app',
  'fixtures',
  'test',
])
const APP_PACKAGE_PATHS = Object.freeze([
  'apps/automation-host',
  'apps/electron',
  'apps/cli',
  'apps/vscode',
  'apps/server',
  'apps/web',
])
const APP_PAYLOADS = Object.freeze({
  'apps/automation-host': Object.freeze(['dist']),
  'apps/electron': Object.freeze(['dist', 'dist-app', 'electron', 'generated', 'media']),
  'apps/cli': Object.freeze(['dist']),
  'apps/vscode': Object.freeze([
    'bundled-contributes.v1.json',
    'contributes.generated.json',
    'dist-app',
    'generated',
    'media',
    'publication-artifact.v1.json',
  ]),
  'apps/server': Object.freeze(['dist']),
  'apps/web': Object.freeze(['dist', 'dist-app', 'generated', 'public']),
})

function slash(value) {
  return value.split(sep).join('/')
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, sorted(value[key])]),
    )
  }
  return value
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(sorted(value), null, 2)}\n`, 'utf8')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assertSafeRelativePath(path, label = 'path') {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError(`${label} must be a safe non-empty POSIX relative path: ${String(path)}`)
  }
  return path
}

function pathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function addFile(entries, archivePath, sourcePath) {
  const normalized = assertSafeRelativePath(slash(archivePath), 'archive path')
  const stat = lstatSync(sourcePath)
  if (stat.isSymbolicLink()) throw new Error(`release input is a symbolic link: ${sourcePath}`)
  if (!stat.isFile()) throw new Error(`release input is not a regular file: ${sourcePath}`)
  const bytes = readFileSync(sourcePath)
  const previous = entries.get(normalized)
  if (previous !== undefined && !previous.equals(bytes)) {
    throw new Error(`release archive path has conflicting bytes: ${normalized}`)
  }
  entries.set(normalized, bytes)
}

function walkFiles(sourceRoot, archiveRoot, entries, options = {}) {
  if (!existsSync(sourceRoot)) {
    if (options.required === false) return
    throw new Error(`release input is missing: ${sourceRoot}`)
  }
  const rootStat = lstatSync(sourceRoot)
  if (rootStat.isSymbolicLink())
    throw new Error(`release input root is a symbolic link: ${sourceRoot}`)
  if (rootStat.isFile()) {
    addFile(entries, archiveRoot, sourceRoot)
    return
  }
  if (!rootStat.isDirectory()) throw new Error(`release input is not a directory: ${sourceRoot}`)
  const skippedDirectories = options.skippedDirectories ?? DEFAULT_SKIPPED_DIRECTORY_NAMES
  const walk = (current, relativePath) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, 'en'),
    )) {
      if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue
      const source = join(current, entry.name)
      const child = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`
      if (entry.isSymbolicLink()) throw new Error(`release input is a symbolic link: ${source}`)
      if (entry.isDirectory()) walk(source, child)
      else if (entry.isFile()) addFile(entries, `${archiveRoot}/${child}`, source)
      else throw new Error(`release input is not a regular file: ${source}`)
    }
  }
  walk(sourceRoot, '')
}

function extensionFiles(repoRoot, extensionPath) {
  const entries = new Map()
  walkFiles(join(repoRoot, extensionPath), extensionPath, entries)
  return entries
}

function writeTarString(header, value, offset, length) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length > length) throw new Error(`tar header value is too long: ${value}`)
  bytes.copy(header, offset)
}

function writeTarOctal(header, value, offset, length) {
  const octal = value.toString(8)
  if (octal.length > length - 1) throw new Error(`tar header number is too large: ${value}`)
  writeTarString(header, octal.padStart(length - 1, '0'), offset, length - 1)
  header[offset + length - 1] = 0
}

function tarPathFields(path) {
  if (Buffer.byteLength(path, 'utf8') <= 100) return { name: path, prefix: '' }
  const separators = [...path.matchAll(/\//gu)].map(match => match.index ?? -1).reverse()
  for (const index of separators) {
    const prefix = path.slice(0, index)
    const name = path.slice(index + 1)
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix }
    }
  }
  throw new Error(`release archive path cannot be represented by ustar: ${path}`)
}

/** A deterministic POSIX ustar archive: sorted paths, fixed modes/owners/mtime, no host metadata. */
export function deterministicTar(files) {
  const parts = []
  const names = [...files.keys()].sort()
  for (const path of names) {
    assertSafeRelativePath(path, 'tar entry')
    const bytes = files.get(path)
    if (!Buffer.isBuffer(bytes)) throw new TypeError(`tar entry is not a Buffer: ${path}`)
    const { name, prefix } = tarPathFields(path)
    const header = Buffer.alloc(512)
    writeTarString(header, name, 0, 100)
    writeTarOctal(header, 0o644, 100, 8)
    writeTarOctal(header, 0, 108, 8)
    writeTarOctal(header, 0, 116, 8)
    writeTarOctal(header, bytes.length, 124, 12)
    writeTarOctal(header, 0, 136, 12)
    header.fill(0x20, 148, 156)
    header[156] = '0'.charCodeAt(0)
    writeTarString(header, 'ustar\0', 257, 6)
    writeTarString(header, '00', 263, 2)
    writeTarString(header, prefix, 345, 155)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    const checksumOctal = checksum.toString(8).padStart(6, '0')
    writeTarString(header, checksumOctal, 148, 6)
    header[154] = 0
    header[155] = 0x20
    parts.push(header, bytes)
    const padding = (512 - (bytes.length % 512)) % 512
    if (padding > 0) parts.push(Buffer.alloc(padding))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

/** Exact `loadExtensionDirectory` artifact identity, without importing the host implementation. */
export function canonicalExtensionDigest(repoRoot, extensionRoot) {
  const root = assertSafeRelativePath(slash(extensionRoot), 'extension root')
  return extensionArtifactDigest(join(resolve(repoRoot), ...root.split('/')))
}

function workspacePackageIndex(repoRoot) {
  const index = new Map()
  const packagePaths = []
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name, 'en'),
    )) {
      if (entry.isDirectory() && WORKSPACE_SCAN_SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name === 'package.json') packagePaths.push(path)
    }
  }
  for (const root of ['apps', 'extensions', 'packages']) {
    const absolute = join(repoRoot, root)
    if (existsSync(absolute)) walk(absolute)
  }
  for (const packagePath of packagePaths) {
    const metadata = readJson(packagePath)
    if (typeof metadata.name !== 'string' || metadata.name.length === 0) continue
    const previous = index.get(metadata.name)
    if (previous !== undefined) {
      throw new Error(
        `duplicate workspace package name ${metadata.name}: ${previous}, ${packagePath}`,
      )
    }
    index.set(metadata.name, dirname(packagePath))
  }
  return index
}

function contributionOwners(repoRoot, packageIndex) {
  const owners = new Map()
  for (const packageRoot of packageIndex.values()) {
    const metadata = readJson(join(packageRoot, 'package.json'))
    const patterns = metadata.modkit?.contributionManifests
    if (!Array.isArray(patterns)) continue
    const manifests = []
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || !pattern.startsWith('./')) {
        throw new Error(
          `unsupported contribution manifest path in ${packageRoot}: ${String(pattern)}`,
        )
      }
      if (pattern.endsWith('/*.json')) {
        const directory = join(packageRoot, pattern.slice(2, -'/*.json'.length))
        if (!existsSync(directory)) continue
        manifests.push(
          ...readdirSync(directory)
            .filter(name => name.endsWith('.json'))
            .sort()
            .map(name => join(directory, name)),
        )
      } else if (pattern.includes('*')) {
        throw new Error(`unsupported contribution manifest glob in ${packageRoot}: ${pattern}`)
      } else {
        const manifest = join(packageRoot, pattern.slice(2))
        if (existsSync(manifest)) manifests.push(manifest)
      }
    }
    for (const manifestPath of manifests) {
      const manifest = readJson(manifestPath)
      if (typeof manifest.id !== 'string' || manifest.id.length === 0) continue
      if (owners.has(manifest.id)) {
        throw new Error(`duplicate contribution id in release inputs: ${manifest.id}`)
      }
      owners.set(manifest.id, slash(relative(repoRoot, packageRoot)))
    }
  }
  return owners
}

function resolveProfileRoots(repoRoot, profile, packageIndex, owners) {
  const roots = new Set()
  for (const family of profile.extensionFamilies ?? []) {
    if (READY_APP_EXTENSIONS[family] === undefined) {
      throw new Error(`release profile ${profile.id} names unknown extension family ${family}`)
    }
    const location = extensionLocation(family)
    if (location.kind === 'internal') {
      roots.add(`extensions/${extensionDirectory(family).join('/')}`)
    }
  }
  const externalPublishers = new Set(
    (profile.extensionFamilies ?? [])
      .map(family => extensionLocation(family))
      .filter(location => location.kind === 'external')
      .map(location => externalRepositoryDescriptor(location.repository).publisher),
  )
  for (const contributionId of profile.serviceProviders ?? []) {
    const owner = owners.get(contributionId)
    if (owner === undefined) {
      if ([...externalPublishers].some(publisher => contributionId.startsWith(`${publisher}/`))) {
        continue
      }
      throw new Error(`release profile ${profile.id} has no owner for ${contributionId}`)
    }
    roots.add(owner)
  }
  for (const root of roots) {
    const metadata = readJson(join(repoRoot, root, 'package.json'))
    if (!packageIndex.has(metadata.name))
      throw new Error(`release extension is not indexed: ${root}`)
  }
  return [...roots].sort()
}

function externalProfileExtensions(profile) {
  return (profile.extensionFamilies ?? [])
    .map(family => ({ family, location: extensionLocation(family) }))
    .filter(item => item.location.kind === 'external')
    .map(({ family, location }) => {
      const repository = externalRepositoryDescriptor(location.repository)
      const extension = READY_APP_EXTENSIONS[family]
      return {
        coordinate: extension.coordinate,
        environment: repository.environment,
        family,
        path: location.path.join('/'),
        repository: location.repository,
        sibling: repository.sibling,
      }
    })
    .sort((left, right) => left.family.localeCompare(right.family, 'en'))
}

function releaseComposition(repoRoot) {
  const profilesPath = join(repoRoot, 'migration', 'product-profiles.json')
  const vscodeCatalogPath = join(repoRoot, 'apps', 'vscode', 'generated', 'bundled-catalog.json')
  const profiles = readJson(profilesPath)
  const vscodeCatalog = readJson(vscodeCatalogPath)
  if (profiles.schemaVersion !== 'product-profiles-1' || !Array.isArray(profiles.presets)) {
    throw new TypeError('release composition requires product-profiles-1')
  }
  if (vscodeCatalog.schemaVersion !== 1 || !Array.isArray(vscodeCatalog.roots)) {
    throw new TypeError('release composition requires the generated VS Code bundled catalog v1')
  }
  const active = profiles.presets
    .filter(profile => profile.introducedInClosure === 'mk3-ga' && profile.status === 'available')
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const activeIds = active.map(profile => profile.id)
  if (JSON.stringify(activeIds) !== JSON.stringify(REQUIRED_PROFILE_IDS)) {
    throw new Error(
      `focused RC profile set drifted: expected ${REQUIRED_PROFILE_IDS.join(', ')}, found ${activeIds.join(', ')}`,
    )
  }
  const byId = new Map(active.map(profile => [profile.id, profile]))
  const packageIndex = workspacePackageIndex(repoRoot)
  const owners = contributionOwners(repoRoot, packageIndex)
  const commonRoots = vscodeCatalog.roots.map(root => `extensions/${root.directory}`).sort()
  const commonRootSet = new Set(commonRoots)
  const gameProfiles = ['sc2-mod-studio', 'warzone-2100-studio'].map(id => {
    const profile = byId.get(id)
    if (profile === undefined) throw new Error(`required release profile is missing: ${id}`)
    const roots = resolveProfileRoots(repoRoot, profile, packageIndex, owners).filter(
      root => !commonRootSet.has(root),
    )
    return { id, roots, externalExtensions: externalProfileExtensions(profile) }
  })
  const selectedRoots = [...commonRoots, ...gameProfiles.flatMap(profile => profile.roots)]
  for (const root of selectedRoots) {
    if (DEFERRED_PATH_PREFIXES.some(prefix => `${root}/`.startsWith(prefix))) {
      throw new Error(`deferred C&C or Spring extension entered the focused RC: ${root}`)
    }
  }
  const deferredProfiles = profiles.presets
    .filter(profile => profile.introducedInClosure === 'mk3-deferred-games')
    .map(profile => profile.id)
    .sort()
  const applicationVersions = [
    ...new Set(
      APP_PACKAGE_PATHS.map(path => readJson(join(repoRoot, path, 'package.json')).version),
    ),
  ]
  if (
    applicationVersions.length !== 1 ||
    typeof applicationVersions[0] !== 'string' ||
    applicationVersions[0].length === 0
  ) {
    throw new Error(
      `focused RC application versions must agree: ${applicationVersions.map(String).sort().join(', ')}`,
    )
  }
  return {
    activeProfiles: activeIds,
    commonRoots,
    gameProfiles,
    deferredProfiles,
    packageIndex,
    releaseVersion: applicationVersions[0],
    catalogSources: [
      'apps/electron/generated/bundled-catalog.cjs',
      'apps/vscode/generated/bundled-catalog.json',
      'apps/web/generated/extension-catalog.js',
      'migration/product-profiles.json',
      'scripts/app-extension-sets.mjs',
      'scripts/bundle-hashes.json',
    ],
  }
}

function mergeEntries(target, additions) {
  for (const [path, bytes] of additions) {
    const previous = target.get(path)
    if (previous !== undefined && !previous.equals(bytes)) {
      throw new Error(`release artifact path has conflicting bytes: ${path}`)
    }
    target.set(path, bytes)
  }
}

function commonArtifact(repoRoot, composition) {
  const entries = new Map()
  for (const root of composition.commonRoots) mergeEntries(entries, extensionFiles(repoRoot, root))
  return entries
}

function addWorkspaceRuntimePackages(repoRoot, entries, composition) {
  const selectedExtensionRoots = new Set([
    ...composition.commonRoots,
    ...composition.gameProfiles.flatMap(profile => profile.roots),
  ])
  const packageIndex = composition.packageIndex
  const pendingRoots = [
    ...selectedExtensionRoots,
    ...APP_PACKAGE_PATHS,
    'packages/core',
    'packages/host',
    'packages/sdk',
    'packages/ui',
    'packages/vfs',
  ]
  const visited = new Set()
  while (pendingRoots.length > 0) {
    const packageRoot = pendingRoots.shift()
    if (visited.has(packageRoot)) continue
    visited.add(packageRoot)
    const packagePath = join(repoRoot, packageRoot, 'package.json')
    if (!existsSync(packagePath)) continue
    const metadata = readJson(packagePath)
    for (const dependency of dependencyNames(metadata)) {
      const dependencyRoot = packageIndex.get(dependency)
      if (dependencyRoot !== undefined) {
        pendingRoots.push(slash(relative(repoRoot, dependencyRoot)))
      }
    }
    if (
      selectedExtensionRoots.has(packageRoot) ||
      APP_PACKAGE_PATHS.includes(packageRoot) ||
      /^packages\/(?:core|host|sdk|ui|vfs)$/u.test(packageRoot)
    ) {
      continue
    }
    addFile(entries, `${packageRoot}/package.json`, packagePath)
    const payloads = Array.isArray(metadata.files)
      ? metadata.files
      : ['src', 'dist', 'schemas', 'contributions']
    for (const payload of payloads) {
      if (typeof payload !== 'string' || payload.length === 0 || /[*?]/u.test(payload)) {
        throw new Error(`unsupported package files entry in ${packageRoot}: ${String(payload)}`)
      }
      walkFiles(join(repoRoot, packageRoot, payload), `${packageRoot}/${slash(payload)}`, entries, {
        required: false,
      })
    }
  }
}

function platformArtifact(repoRoot, composition) {
  const entries = new Map()
  const bundleHashesPath = join(repoRoot, 'scripts', 'bundle-hashes.json')
  const bundleHashes = readJson(bundleHashesPath)
  for (const [entry, expected] of Object.entries(bundleHashes).sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  )) {
    assertSafeRelativePath(entry, 'bundle entry')
    const source = join(repoRoot, entry)
    if (!existsSync(source)) throw new Error(`bundled release entry is missing: ${entry}`)
    const bytes = readFileSync(source)
    const actual = sha256(bytes)
    if (actual !== expected) {
      throw new Error(
        `bundled release entry drifted: ${entry} expected ${expected}, found ${actual}`,
      )
    }
    entries.set(entry, bytes)
    const owner = entry.split('/').slice(0, 2).join('/')
    const packagePath = join(repoRoot, owner, 'package.json')
    if (existsSync(packagePath)) addFile(entries, `${owner}/package.json`, packagePath)
  }
  for (const appPath of APP_PACKAGE_PATHS) {
    const packagePath = join(repoRoot, appPath, 'package.json')
    if (!existsSync(packagePath))
      throw new Error(`application package metadata is missing: ${appPath}`)
    addFile(entries, `${appPath}/package.json`, packagePath)
    for (const payload of APP_PAYLOADS[appPath]) {
      walkFiles(join(repoRoot, appPath, payload), `${appPath}/${payload}`, entries, {
        required: false,
      })
    }
  }
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'migration/product-profiles.json',
    'scripts/app-extension-sets.mjs',
    'scripts/bundle-hashes.json',
  ]) {
    addFile(entries, path, join(repoRoot, path))
  }
  for (const path of composition.catalogSources) {
    addFile(entries, path, join(repoRoot, path))
  }
  addWorkspaceRuntimePackages(repoRoot, entries, composition)
  return entries
}

function extensionCatalogEntry(repoRoot, root, existingCatalog) {
  const packageMetadata = readJson(join(repoRoot, root, 'package.json'))
  const known = Object.entries(READY_APP_EXTENSIONS).find(
    ([name, entry]) => `extensions/${(entry.path ?? ['common', name]).join('/')}` === root,
  )?.[1]
  const catalog = existingCatalog?.get(root)
  const actualDigest = canonicalExtensionDigest(repoRoot, root)
  if (catalog !== undefined && catalog.digest !== actualDigest) {
    throw new Error(
      `generated extension catalog digest is stale for ${root}: expected ${catalog.digest}, found ${actualDigest}`,
    )
  }
  const coordinate = packageMetadata.modkit
    ? `${packageMetadata.modkit.publisher}/${packageMetadata.modkit.id}`
    : (known?.coordinate ?? packageMetadata.name)
  const contributions = [...(known?.contributions ?? [])].sort()
  if (
    catalog !== undefined &&
    (catalog.coordinate !== coordinate ||
      JSON.stringify(catalog.contributions ?? []) !== JSON.stringify(contributions))
  ) {
    throw new Error(`generated extension catalog identity is stale for ${root}`)
  }
  return {
    coordinate,
    contributions,
    root,
    sourceDigest: actualDigest,
  }
}

function normalizeLicense(metadata, sourceLabel) {
  const declared = metadata.license
  if (typeof declared === 'string' && declared.trim() !== '') return declared.trim()
  if (Array.isArray(metadata.licenses)) {
    const values = metadata.licenses
      .map(item => (typeof item === 'string' ? item : item?.type))
      .filter(item => typeof item === 'string' && item.trim() !== '')
    if (values.length > 0) return values.join(' OR ')
  }
  if (
    metadata.private === true &&
    (sourceLabel === 'package.json' || sourceLabel.startsWith('apps/'))
  ) {
    return 'NOASSERTION'
  }
  throw new Error(`release component has no declared license: ${sourceLabel}`)
}

function packageRef(metadata) {
  let name
  if (metadata.name.startsWith('@')) {
    const separator = metadata.name.indexOf('/')
    if (separator === -1) throw new Error(`invalid scoped package name: ${metadata.name}`)
    name = `%40${encodeURIComponent(metadata.name.slice(1, separator))}/${encodeURIComponent(metadata.name.slice(separator + 1))}`
  } else {
    name = encodeURIComponent(metadata.name)
  }
  return `pkg:npm/${name}@${encodeURIComponent(metadata.version)}`
}

function nearestPackageJson(dependency, from, repoRoot) {
  let current = existsSync(from) ? realpathSync(resolve(from)) : resolve(from)
  const boundary = resolve(repoRoot)
  while (pathInside(boundary, current)) {
    const candidate = join(current, 'node_modules', ...dependency.split('/'), 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

function normalizeNoticeText(value) {
  return value
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

function licenseText(packageRoot) {
  const names = readdirSync(packageRoot).sort()
  const selected = names.find(name => /^(?:licen[cs]e|copying|notice)(?:\.|$)/iu.test(name))
  if (selected === undefined) return undefined
  const path = join(packageRoot, selected)
  if (!statSync(path).isFile()) return undefined
  const bytes = readFileSync(path)
  if (bytes.length > 1024 * 1024) throw new Error(`license notice is unexpectedly large: ${path}`)
  return normalizeNoticeText(bytes.toString('utf8'))
}

function componentSeeds(repoRoot, artifacts) {
  const seeds = new Map()
  for (const artifact of artifacts) {
    for (const [path, bytes] of artifact.entries) {
      if (!path.endsWith('/package.json') && path !== 'package.json') continue
      let metadata
      try {
        metadata = JSON.parse(bytes.toString('utf8'))
      } catch {
        throw new Error(`release artifact contains malformed package metadata: ${path}`)
      }
      if (
        typeof metadata.name !== 'string' ||
        metadata.name.length === 0 ||
        typeof metadata.version !== 'string' ||
        metadata.version.length === 0
      ) {
        continue
      }
      const sourcePath = join(repoRoot, path)
      const sourceRoot = existsSync(sourcePath) ? dirname(sourcePath) : undefined
      const key = `${metadata.name}@${metadata.version}`
      const seed = seeds.get(key) ?? {
        metadata,
        sourceLabel: path,
        sourceRoot,
        artifacts: new Set(),
      }
      seed.artifacts.add(artifact.id)
      seeds.set(key, seed)
    }
  }
  return seeds
}

function dependencyNames(metadata) {
  return [
    ...new Set([
      ...Object.keys(metadata.dependencies ?? {}),
      ...Object.keys(metadata.optionalDependencies ?? {}),
      ...Object.keys(metadata.peerDependencies ?? {}),
    ]),
  ].sort()
}

/** Generate a deterministic CycloneDX SBOM and a complete package-license notice index. */
export function buildLicenseDocuments({ repoRoot, artifacts, releaseVersion }) {
  const packageIndex = workspacePackageIndex(repoRoot)
  const pending = [...componentSeeds(repoRoot, artifacts).values()]
  const components = new Map()
  const dependencies = new Map()
  while (pending.length > 0) {
    const seed = pending.shift()
    const metadata = seed.metadata
    const ref = packageRef(metadata)
    const license = normalizeLicense(metadata, seed.sourceLabel)
    const previous = components.get(ref)
    if (previous !== undefined) {
      for (const artifact of seed.artifacts) previous.artifacts.add(artifact)
      continue
    }
    const component = {
      artifacts: new Set(seed.artifacts),
      license,
      metadata,
      ref,
      sourceLabel: seed.sourceLabel,
      sourceRoot: seed.sourceRoot,
    }
    components.set(ref, component)
    const dependsOn = []
    for (const dependency of dependencyNames(metadata)) {
      let packagePath
      const workspaceRoot = packageIndex.get(dependency)
      if (workspaceRoot !== undefined) packagePath = join(workspaceRoot, 'package.json')
      else if (seed.sourceRoot !== undefined) {
        packagePath = nearestPackageJson(dependency, seed.sourceRoot, repoRoot)
      }
      if (packagePath === undefined) {
        const optional =
          Object.hasOwn(metadata.optionalDependencies ?? {}, dependency) ||
          metadata.peerDependenciesMeta?.[dependency]?.optional === true
        if (optional) continue
        throw new Error(
          `release SBOM cannot resolve dependency ${dependency} from ${seed.sourceLabel}`,
        )
      }
      const dependencyMetadata = readJson(packagePath)
      if (
        typeof dependencyMetadata.name !== 'string' ||
        typeof dependencyMetadata.version !== 'string'
      ) {
        throw new Error(`release dependency has invalid package metadata: ${packagePath}`)
      }
      const dependencyRef = packageRef(dependencyMetadata)
      dependsOn.push(dependencyRef)
      pending.push({
        metadata: dependencyMetadata,
        sourceLabel:
          workspaceRoot === undefined
            ? `npm:${dependencyMetadata.name}`
            : slash(relative(repoRoot, packagePath)),
        sourceRoot: dirname(packagePath),
        artifacts: new Set(seed.artifacts),
      })
    }
    dependencies.set(ref, [...new Set(dependsOn)].sort())
  }
  const componentRows = [...components.values()]
    .sort((left, right) => left.ref.localeCompare(right.ref, 'en'))
    .map(component => ({
      'bom-ref': component.ref,
      licenses: [
        component.license === 'MIT' ||
        component.license === 'GPL-2.0-only' ||
        component.license === 'GPL-2.0-or-later'
          ? { license: { id: component.license } }
          : { license: { name: component.license } },
      ],
      name: component.metadata.name,
      properties: [
        { name: 'modkitx:artifacts', value: [...component.artifacts].sort().join(',') },
        { name: 'modkitx:metadata-source', value: component.sourceLabel },
      ],
      purl: component.ref,
      type: component.metadata.private === true ? 'application' : 'library',
      version: component.metadata.version,
    }))
  const dependencyRows = [...dependencies.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([ref, dependsOn]) => ({ ref, dependsOn }))
  const sbom = {
    bomFormat: 'CycloneDX',
    components: componentRows,
    dependencies: dependencyRows,
    metadata: {
      component: {
        'bom-ref': `urn:modkitx:${RELEASE_ID}:${releaseVersion}`,
        name: RELEASE_ID,
        type: 'application',
        version: releaseVersion,
      },
      tools: [{ vendor: 'ModkitX', name: 'scripts/release/rc.mjs' }],
    },
    specVersion: '1.5',
    version: 1,
  }
  const notices = [
    'MODKIT MK3 LOCAL RC LICENSE NOTICES',
    '',
    'Generated from the package metadata used by the focused local RC.',
    'NOASSERTION denotes a private first-party application shell with no published license.',
    '',
  ]
  for (const component of [...components.values()].sort((left, right) =>
    left.ref.localeCompare(right.ref, 'en'),
  )) {
    notices.push(`${component.metadata.name}@${component.metadata.version}`)
    notices.push(`License: ${component.license}`)
    notices.push(`Metadata: ${component.sourceLabel}`)
    const text = component.sourceRoot === undefined ? undefined : licenseText(component.sourceRoot)
    if (text !== undefined) {
      notices.push('', text)
    }
    notices.push('', '---', '')
  }
  const embeddedNotices = new Map()
  for (const artifact of artifacts) {
    for (const [path, bytes] of artifact.entries) {
      if (!/(?:^|\/)(?:licen[cs]e|copying|notice|ofl)(?:\.|$)/iu.test(path)) continue
      const digest = sha256(bytes)
      const record = embeddedNotices.get(digest) ?? { bytes, locations: [] }
      record.locations.push(`${artifact.id}:${path}`)
      embeddedNotices.set(digest, record)
    }
  }
  if (embeddedNotices.size > 0) {
    notices.push('LICENSE DOCUMENTS EMBEDDED IN RC ARTIFACTS', '', '---', '')
    for (const [digest, record] of [...embeddedNotices].sort(([left], [right]) =>
      left.localeCompare(right, 'en'),
    )) {
      notices.push(`SHA-256: ${digest}`)
      notices.push(`Locations: ${record.locations.sort().join(', ')}`, '')
      notices.push(normalizeNoticeText(record.bytes.toString('utf8')), '', '---', '')
    }
  }
  return {
    sbomBytes: jsonBytes(sbom),
    noticeBytes: Buffer.from(`${notices.join('\n').trimEnd()}\n`, 'utf8'),
  }
}

function catalogDigests(repoRoot, paths) {
  return paths
    .map(path => {
      const bytes = readFileSync(join(repoRoot, path))
      return { path, sha256: `sha256:${sha256(bytes)}` }
    })
    .sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function artifactDescriptor(artifact, bytes, catalog) {
  return {
    catalog,
    file: artifact.file,
    id: artifact.id,
    kind: artifact.kind,
    sha256: `sha256:${sha256(bytes)}`,
    size: bytes.length,
  }
}

function artifactDefinitions(repoRoot, composition) {
  const vscodeCatalog = readJson(
    join(repoRoot, 'apps', 'vscode', 'generated', 'bundled-catalog.json'),
  )
  const existingCatalog = new Map(
    vscodeCatalog.roots.map(root => [`extensions/${root.directory}`, root]),
  )
  const common = {
    id: 'common',
    file: 'artifacts/modkitx-common.tar',
    kind: 'common-extension-bundle',
    entries: commonArtifact(repoRoot, composition),
    catalog: composition.commonRoots.map(root =>
      extensionCatalogEntry(repoRoot, root, existingCatalog),
    ),
  }
  return [
    {
      id: 'platform',
      file: 'artifacts/modkitx-platform.tar',
      kind: 'application-and-package-bundle',
      entries: platformArtifact(repoRoot, composition),
      catalog: [],
    },
    common,
  ]
}

function signingKey(path, repoRoot) {
  const resolved = resolve(path)
  if (!existsSync(resolved)) throw new Error(`Ed25519 signing key is missing: ${resolved}`)
  const real = realpathSync(resolved)
  if (pathInside(repoRoot, real)) {
    throw new Error('Ed25519 private key must be passed from outside the repository')
  }
  const key = createPrivateKey(readFileSync(real))
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError(`release signing key must be Ed25519, found ${key.asymmetricKeyType}`)
  }
  return key
}

function publicKeyFingerprint(key) {
  const der = key.export({ type: 'spki', format: 'der' })
  return `sha256:${sha256(der)}`
}

function signatureDocument(manifestBytes, privateKey) {
  const publicKey = createPublicKey(privateKey)
  return {
    algorithm: 'Ed25519',
    manifestSha256: `sha256:${sha256(manifestBytes)}`,
    publicKeySpkiSha256: publicKeyFingerprint(publicKey),
    schemaVersion: 'release-signature-1',
    signature: sign(null, manifestBytes, privateKey).toString('base64'),
    signedFile: 'release-manifest.json',
  }
}

function assertOutputAbsent(outDir) {
  if (existsSync(outDir)) throw new Error(`release output must be a fresh path: ${outDir}`)
}

function writeAtomically(outDir, files) {
  assertOutputAbsent(outDir)
  const parent = dirname(outDir)
  mkdirSync(parent, { recursive: true })
  const temporary = join(
    parent,
    `.modkitx-rc-${process.pid}-${createHash('sha256').update(outDir).digest('hex').slice(0, 12)}`,
  )
  if (existsSync(temporary))
    throw new Error(`temporary release output already exists: ${temporary}`)
  mkdirSync(temporary, { recursive: true })
  try {
    for (const [path, bytes] of [...files.entries()].sort(([left], [right]) =>
      left.localeCompare(right, 'en'),
    )) {
      const target = join(temporary, ...assertSafeRelativePath(path).split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
    }
    renameSync(temporary, outDir)
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
}

/** Build one fresh local RC directory. Private signing material is never written or embedded. */
export function buildRc({ repoRoot, outDir, signingKeyPath } = {}) {
  const root = resolve(repoRoot ?? process.cwd())
  const output = resolve(outDir)
  const composition = releaseComposition(root)
  const definitions = artifactDefinitions(root, composition)
  const artifactBytes = new Map(
    definitions.map(artifact => [artifact.file, deterministicTar(artifact.entries)]),
  )
  const { sbomBytes, noticeBytes } = buildLicenseDocuments({
    repoRoot: root,
    artifacts: definitions,
    releaseVersion: composition.releaseVersion,
  })
  const installGuideBytes = readFileSync(join(root, 'scripts', 'release', INSTALL_GUIDE_NAME))
  const manifest = {
    $comment:
      'Generated internal release descriptor. It records an existing product-profile/catalog composition; it is not an SDK, extension-manifest, or installer ABI.',
    artifacts: definitions.map(artifact =>
      artifactDescriptor(artifact, artifactBytes.get(artifact.file), artifact.catalog),
    ),
    composition: {
      activeProfiles: composition.activeProfiles,
      catalogSources: catalogDigests(root, composition.catalogSources),
      closure: 'mk3-ga',
      commonExtensionRoots: composition.commonRoots,
      deferredProfiles: composition.deferredProfiles,
      gameExtensionFamilies: composition.gameProfiles,
      source: 'migration/product-profiles.json',
    },
    licenseNotices: {
      file: 'LICENSE-NOTICES.txt',
      sha256: `sha256:${sha256(noticeBytes)}`,
    },
    release: {
      authenticode: false,
      channel: 'local-rc',
      id: RELEASE_ID,
      installation: {
        cleanMachineInstaller: true,
        instructions: {
          file: INSTALL_GUIDE_NAME,
          sha256: `sha256:${sha256(installGuideBytes)}`,
        },
        kind: 'verified-versioned-local-store',
        remainder: null,
      },
      publicRelease: false,
      version: composition.releaseVersion,
    },
    sbom: {
      file: 'sbom.cdx.json',
      format: 'CycloneDX-1.5',
      sha256: `sha256:${sha256(sbomBytes)}`,
    },
    schemaVersion: 'release-manifest-1',
    signing: {
      algorithm: 'Ed25519',
      detachedFile: 'release-signature.json',
      keySource: 'explicit-local-path-outside-repository',
      scope: 'release-manifest.json only; no Authenticode and no public release publishing',
    },
  }
  const manifestBytes = jsonBytes(manifest)
  const files = new Map([
    ...artifactBytes,
    [INSTALL_GUIDE_NAME, installGuideBytes],
    ['LICENSE-NOTICES.txt', noticeBytes],
    ['release-manifest.json', manifestBytes],
    ['sbom.cdx.json', sbomBytes],
  ])
  let signature
  if (signingKeyPath !== undefined) {
    signature = signatureDocument(manifestBytes, signingKey(signingKeyPath, root))
    files.set('release-signature.json', jsonBytes(signature))
  }
  writeAtomically(output, files)
  return { manifest, signature, files: [...files.keys()].sort() }
}

function verifyDigestFile(outDir, record, label) {
  const path = assertSafeRelativePath(record.file, `${label} file`)
  const absolute = join(outDir, ...path.split('/'))
  if (!existsSync(absolute)) throw new Error(`${label} is missing: ${path}`)
  const bytes = readFileSync(absolute)
  const actual = `sha256:${sha256(bytes)}`
  if (actual !== record.sha256) {
    throw new Error(
      `${label} digest mismatch for ${path}: expected ${record.sha256}, found ${actual}`,
    )
  }
  if (record.size !== undefined && bytes.length !== record.size) {
    throw new Error(
      `${label} size mismatch for ${path}: expected ${record.size}, found ${bytes.length}`,
    )
  }
}

/** Verify every manifest digest and the detached signature with an explicitly supplied public key. */
export function verifyRc({ outDir, publicKeyPath, requireSignature = true }) {
  const output = resolve(outDir)
  const manifestPath = join(output, 'release-manifest.json')
  if (!existsSync(manifestPath)) throw new Error('release manifest is missing')
  const manifestBytes = readFileSync(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifest.schemaVersion !== 'release-manifest-1' || !Array.isArray(manifest.artifacts)) {
    throw new TypeError('unsupported release manifest')
  }
  if (manifest.release?.publicRelease !== false || manifest.release?.authenticode !== false) {
    throw new Error('local RC manifest must not claim public release or Authenticode')
  }
  for (const artifact of manifest.artifacts) verifyDigestFile(output, artifact, 'release artifact')
  verifyDigestFile(output, manifest.sbom, 'SBOM')
  verifyDigestFile(output, manifest.licenseNotices, 'license notices')
  verifyDigestFile(output, manifest.release.installation.instructions, 'installation guide')
  const signaturePath = join(output, 'release-signature.json')
  if (!existsSync(signaturePath)) {
    if (requireSignature) throw new Error('detached Ed25519 release signature is missing')
    return { state: 'verified-unsigned', artifactCount: manifest.artifacts.length }
  }
  if (publicKeyPath === undefined)
    throw new Error('verification requires an explicit public key path')
  const signature = readJson(signaturePath)
  if (
    signature.schemaVersion !== 'release-signature-1' ||
    signature.algorithm !== 'Ed25519' ||
    signature.signedFile !== 'release-manifest.json'
  ) {
    throw new TypeError('unsupported release signature descriptor')
  }
  const publicKey = createPublicKey(readFileSync(resolve(publicKeyPath)))
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError(`release public key must be Ed25519, found ${publicKey.asymmetricKeyType}`)
  }
  if (signature.publicKeySpkiSha256 !== publicKeyFingerprint(publicKey)) {
    throw new Error('release public key fingerprint does not match the signature descriptor')
  }
  const digest = `sha256:${sha256(manifestBytes)}`
  if (signature.manifestSha256 !== digest)
    throw new Error('signed release manifest digest mismatch')
  const signatureBytes = Buffer.from(signature.signature, 'base64')
  if (!verify(null, manifestBytes, publicKey, signatureBytes)) {
    throw new Error('detached Ed25519 release signature is invalid')
  }
  return { state: 'verified-signed', artifactCount: manifest.artifacts.length }
}

function filesUnderDirectory(root) {
  const files = new Map()
  walkFiles(root, 'root', files)
  return new Map([...files].map(([path, bytes]) => [path.slice('root/'.length), bytes]))
}

function compareOutputs(left, right) {
  const leftFiles = filesUnderDirectory(left)
  const rightFiles = filesUnderDirectory(right)
  const names = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort()
  return names.filter(name => {
    const leftBytes = leftFiles.get(name)
    const rightBytes = rightFiles.get(name)
    return leftBytes === undefined || rightBytes === undefined || !leftBytes.equals(rightBytes)
  })
}

/** Two fresh unsigned builds plus the committed descriptor/SBOM/notices ratchet. */
export function checkRc({ repoRoot, generatedDir } = {}) {
  const root = resolve(repoRoot ?? process.cwd())
  const generated = resolve(generatedDir ?? join(root, 'scripts', 'release', 'generated'))
  const scratch = join(
    tmpdir(),
    `modkitx-rc-check-${process.pid}-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`,
  )
  if (existsSync(scratch)) throw new Error(`release check scratch already exists: ${scratch}`)
  mkdirSync(scratch, { recursive: true })
  try {
    const left = join(scratch, 'a')
    const right = join(scratch, 'b')
    buildRc({ repoRoot: root, outDir: left })
    buildRc({ repoRoot: root, outDir: right })
    const drift = compareOutputs(left, right)
    if (drift.length > 0) {
      throw new Error(`unsigned RC builds are not byte-identical: ${drift.join(', ')}`)
    }
    for (const name of GENERATED_NAMES) {
      const expected = join(generated, name)
      if (!existsSync(expected)) throw new Error(`generated release ratchet is missing: ${name}`)
      if (!readFileSync(expected).equals(readFileSync(join(left, name)))) {
        throw new Error(`generated release ratchet is stale: ${name}`)
      }
    }
    return { state: 'checked', fileCount: filesUnderDirectory(left).size }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Refresh only small reviewed metadata; archive payloads remain local build outputs. */
export function emitRcMetadata({ repoRoot, generatedDir } = {}) {
  const root = resolve(repoRoot ?? process.cwd())
  const generated = resolve(generatedDir ?? join(root, 'scripts', 'release', 'generated'))
  const scratch = join(
    tmpdir(),
    `modkitx-rc-emit-${process.pid}-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`,
  )
  buildRc({ repoRoot: root, outDir: scratch })
  try {
    mkdirSync(generated, { recursive: true })
    for (const name of GENERATED_NAMES) {
      writeFileSync(join(generated, name), readFileSync(join(scratch, name)))
    }
    return { state: 'emitted', count: GENERATED_NAMES.length }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
