import { resolve } from 'node:path'

const DISPLAY_NAME = 'Warzone 2100'

export function normalizeWarzoneInstallationPath(value) {
  return resolve(value).replace(/\\/gu, '/').replace(/\/+$/u, '')
}

function nonEmptyPath(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty path`)
  }
  if (value.includes('\0')) throw new TypeError(`${label} must not contain NUL`)
  return resolve(value.trim())
}

function candidate(origin, input, label) {
  const value = typeof input === 'string' ? { path: input } : input
  return {
    origin,
    displayName: DISPLAY_NAME,
    path: normalizeWarzoneInstallationPath(nonEmptyPath(value.path, label)),
    ...(value.storeAppId === undefined ? {} : { storeAppId: value.storeAppId }),
    ...(value.manifestPath === undefined ? {} : { manifestPath: value.manifestPath }),
    ...(value.version === undefined ? {} : { version: value.version }),
  }
}

function candidateKey(value, platform) {
  const path = normalizeWarzoneInstallationPath(value.path)
  return platform === 'win32' ? path.toLowerCase() : path
}

function configuredCandidates(paths) {
  if (paths === undefined) return []
  if (!Array.isArray(paths)) throw new TypeError('configuredPaths must be an array when present')
  return paths.map((path, index) => candidate('configured-path', path, `configuredPaths[${index}]`))
}

function sourceCandidates(values, origin, label) {
  return values.flatMap((value, index) => {
    const path = typeof value === 'string' ? value : value?.path
    return typeof path === 'string' && path.trim().length > 0
      ? [candidate(origin, value, `${label}[${index}]`)]
      : []
  })
}

/** Merge bounded sources in product precedence order without scanning the filesystem. */
export function collectWarzoneInstallationCandidates(
  {
    configuredPaths,
    environmentPath,
    appModelPaths,
    registryPaths,
    steamPaths,
    defaultPaths,
    platform,
  },
  limit,
) {
  const discovered = [
    ...configuredCandidates(configuredPaths),
    ...(typeof environmentPath === 'string' && environmentPath.trim().length > 0
      ? [candidate('configured-path', environmentPath, 'MODKITX_WARZONE_ROOT')]
      : []),
    ...sourceCandidates(appModelPaths, 'registry', 'appModelPaths'),
    ...sourceCandidates(registryPaths, 'registry', 'registryPaths'),
    ...sourceCandidates(steamPaths, 'steam', 'steamPaths'),
    ...sourceCandidates(defaultPaths, 'default-directory', 'defaultPaths'),
  ]
  const unique = new Map()
  for (const entry of discovered) {
    const key = candidateKey(entry, platform)
    const existing = unique.get(key)
    if (existing === undefined) {
      unique.set(key, { candidate: entry, origins: [entry.origin] })
    } else if (!existing.origins.includes(entry.origin)) {
      existing.origins.push(entry.origin)
    }
  }
  const selected = [...unique.values()].slice(0, limit)
  return Object.freeze({
    candidates: Object.freeze(selected.map(entry => Object.freeze(entry.candidate))),
    candidateOrigins: Object.freeze(selected.map(entry => Object.freeze([...entry.origins]))),
    truncated: unique.size > limit,
  })
}

export function parseAppModelPackageKeys(stdout, packagePrefix, maximumPackages = 16) {
  const matches = []
  const expectedPrefix = `${packagePrefix}_`
  for (const line of String(stdout).split(/\r?\n/gu)) {
    const path = line.trim()
    if (!/^HKEY_CURRENT_USER\\/iu.test(path)) continue
    const leaf = path.slice(path.lastIndexOf('\\') + 1)
    if (!leaf.startsWith(expectedPrefix)) continue
    if (matches.length >= maximumPackages) break
    matches.push(Object.freeze({ key: path, packageFullName: leaf }))
  }
  return Object.freeze(matches)
}

export function parseRegistryValue(stdout, valueName) {
  const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`^\\s*${escaped}\\s+REG_\\w+\\s+(.+)$`, 'imu').exec(String(stdout))
  return match?.[1]?.trim()
}

export function parseSteamLibraryPaths(text, maximumLibraries = 32) {
  const paths = []
  const seen = new Set()
  for (const match of String(text).matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/giu)) {
    const value = match[1]?.replace(/\\\\/gu, '\\').trim()
    if (!value || value.includes('\0')) continue
    const normalized = normalizeWarzoneInstallationPath(value)
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(normalized)
    if (paths.length >= maximumLibraries) break
  }
  return Object.freeze(paths)
}

export function parseSteamInstallDirectory(text) {
  const match = /"installdir"\s+"((?:\\.|[^"\\])*)"/iu.exec(String(text))
  const value = match?.[1]?.replace(/\\\\/gu, '\\').trim()
  if (!value || value === '.' || value === '..' || /[\\/]/u.test(value) || value.includes('\0')) {
    return undefined
  }
  return value
}
