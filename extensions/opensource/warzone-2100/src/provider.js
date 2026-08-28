import { execFile } from 'node:child_process'
import { open, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { GAME_INSTALLATION_DISCOVERY_CONTRACT } from '@modkitx-x3/sdk/games'
import {
  collectWarzoneInstallationCandidates,
  normalizeWarzoneInstallationPath,
  parseAppModelPackageKeys,
  parseRegistryValue,
  parseSteamInstallDirectory,
  parseSteamLibraryPaths,
} from './installation-candidates.js'

const execFileAsync = promisify(execFile)
const DISCOVERY_ID = 'org.modkitx.opensource.warzone2100'
const GAME_ID = 'org.modkitx/warzone-2100'
const DISPLAY_NAME = 'Warzone 2100'
const MAXIMUM_CANDIDATES = 128
const MAXIMUM_STEAM_LIBRARIES = 32
const MAXIMUM_APP_MODEL_PACKAGES = 16
const REGISTRY_TIMEOUT_MS = 2_000
const REGISTRY_MAX_BUFFER_BYTES = 256 * 1024
const APP_MODEL_MAX_BUFFER_BYTES = 1024 * 1024
const STEAM_LIBRARY_MAX_BYTES = 1024 * 1024
const STEAM_MANIFEST_MAX_BYTES = 256 * 1024
const APP_MODEL_PACKAGE_PREFIX = '48148WZ2100Project.Warzone2100forWindows'
const APP_MODEL_PACKAGES_KEY =
  'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages'
const STEAM_APP_ID = '1241950'
const UNINSTALL_KEYS = Object.freeze(
  ['HKLM\\SOFTWARE', 'HKLM\\SOFTWARE\\WOW6432Node', 'HKCU\\SOFTWARE'].flatMap(root =>
    ['Warzone 2100', 'warzone2100'].map(
      name => `${root}\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${name}`,
    ),
  ),
)

async function pathKind(path, expected) {
  try {
    const value = await stat(path)
    return expected === 'file' ? value.isFile() : value.isDirectory()
  } catch {
    return false
  }
}

async function readBounded(path, maximumBytes, encoding) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maximumBytes + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > maximumBytes) throw new RangeError(`${path} exceeds ${maximumBytes} bytes`)
    const value = buffer.subarray(0, bytesRead)
    return encoding === undefined ? value : value.toString(encoding)
  } finally {
    await handle.close()
  }
}

async function readPrefix(path, length) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function registryQuery(arguments_, maximumBytes, signal) {
  signal?.throwIfAborted()
  try {
    const { stdout } = await execFileAsync('reg.exe', arguments_, {
      encoding: 'utf8',
      maxBuffer: maximumBytes,
      timeout: REGISTRY_TIMEOUT_MS,
      windowsHide: true,
      ...(signal === undefined ? {} : { signal }),
    })
    return stdout
  } catch {
    signal?.throwIfAborted()
    return undefined
  }
}

function appModelVersion(packageFullName) {
  const prefix = `${APP_MODEL_PACKAGE_PREFIX}_`
  if (!packageFullName.startsWith(prefix)) return undefined
  const version = packageFullName.slice(prefix.length).split('_')[0]
  return /^\d+(?:\.\d+){3}$/u.test(version ?? '') ? version : undefined
}

async function appModelCandidates(signal) {
  if (process.platform !== 'win32') return []
  const listing = await registryQuery(
    ['query', APP_MODEL_PACKAGES_KEY, '/f', APP_MODEL_PACKAGE_PREFIX, '/k'],
    APP_MODEL_MAX_BUFFER_BYTES,
    signal,
  )
  if (listing === undefined) return []
  const candidates = []
  for (const entry of parseAppModelPackageKeys(
    listing,
    APP_MODEL_PACKAGE_PREFIX,
    MAXIMUM_APP_MODEL_PACKAGES,
  )) {
    signal?.throwIfAborted()
    const value = await registryQuery(
      ['query', entry.key, '/v', 'PackageRootFolder'],
      REGISTRY_MAX_BUFFER_BYTES,
      signal,
    )
    const path = value === undefined ? undefined : parseRegistryValue(value, 'PackageRootFolder')
    if (path !== undefined) {
      candidates.push(
        Object.freeze({
          path,
          storeAppId: entry.packageFullName,
          ...(appModelVersion(entry.packageFullName) === undefined
            ? {}
            : { version: appModelVersion(entry.packageFullName) }),
        }),
      )
    }
  }
  return candidates
}

async function uninstallCandidates(signal) {
  if (process.platform !== 'win32') return []
  const candidates = []
  for (const key of UNINSTALL_KEYS) {
    signal?.throwIfAborted()
    const value = await registryQuery(
      ['query', key, '/v', 'InstallLocation'],
      REGISTRY_MAX_BUFFER_BYTES,
      signal,
    )
    const path = value === undefined ? undefined : parseRegistryValue(value, 'InstallLocation')
    if (path !== undefined) candidates.push(path)
  }
  return candidates
}

function steamRoots() {
  const home = homedir()
  if (process.platform === 'win32') {
    return [process.env['ProgramFiles(x86)'], process.env['ProgramFiles']].flatMap(base =>
      typeof base === 'string' && base.trim().length > 0 ? [join(base.trim(), 'Steam')] : [],
    )
  }
  if (process.platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'Steam')]
  }
  if (process.platform === 'linux') {
    return [
      join(home, '.steam', 'steam'),
      join(home, '.local', 'share', 'Steam'),
      join(home, '.var', 'app', 'com.valvesoftware.Steam', '.steam', 'steam'),
    ]
  }
  return []
}

async function steamCandidates(signal) {
  const libraries = []
  const seen = new Set()
  const remember = value => {
    const normalized = normalizeWarzoneInstallationPath(value)
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
    if (seen.has(key) || libraries.length >= MAXIMUM_STEAM_LIBRARIES) return
    seen.add(key)
    libraries.push(normalized)
  }
  for (const root of steamRoots()) {
    signal?.throwIfAborted()
    remember(root)
    try {
      const text = await readBounded(
        join(root, 'steamapps', 'libraryfolders.vdf'),
        STEAM_LIBRARY_MAX_BYTES,
        'utf8',
      )
      for (const path of parseSteamLibraryPaths(text, MAXIMUM_STEAM_LIBRARIES)) remember(path)
    } catch {
      // A missing Steam root or manifest is an ordinary absent source.
    }
  }
  const candidates = []
  for (const library of libraries) {
    signal?.throwIfAborted()
    const manifestPath = join(library, 'steamapps', `appmanifest_${STEAM_APP_ID}.acf`)
    try {
      const text = await readBounded(manifestPath, STEAM_MANIFEST_MAX_BYTES, 'utf8')
      const installDirectory = parseSteamInstallDirectory(text)
      if (installDirectory !== undefined) {
        candidates.push(
          Object.freeze({
            path: join(library, 'steamapps', 'common', installDirectory),
            manifestPath,
            storeAppId: STEAM_APP_ID,
          }),
        )
      }
    } catch {
      // A missing or oversized app manifest cannot nominate an installation.
    }
  }
  return candidates
}

export function defaultWarzoneInstallationPaths(platform = process.platform, home = homedir()) {
  if (platform === 'win32') {
    return [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].flatMap(base =>
      typeof base === 'string' && base.trim().length > 0
        ? [join(base.trim(), 'Warzone 2100'), join(base.trim(), 'warzone2100')]
        : [],
    )
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Warzone 2100.app/Contents/Resources',
      join(home, 'Applications', 'Warzone 2100.app', 'Contents', 'Resources'),
    ]
  }
  if (platform === 'linux') {
    return [
      '/usr/share/games/warzone2100',
      '/usr/share/warzone2100',
      '/usr/local/share/games/warzone2100',
      '/usr/local/share/warzone2100',
      '/snap/warzone2100/current/usr/share/games/warzone2100',
      '/snap/warzone2100/current/usr/share/warzone2100',
      '/var/lib/flatpak/app/net.wz2100.wz2100/current/active/files/share/warzone2100',
      join(
        home,
        '.local',
        'share',
        'flatpak',
        'app',
        'net.wz2100.wz2100',
        'current',
        'active',
        'files',
        'share',
        'warzone2100',
      ),
    ]
  }
  return []
}

async function archiveMagic(path) {
  try {
    const value = await readPrefix(path, 4)
    return value.length === 4 && value.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  } catch {
    return false
  }
}

async function contentLayout(root) {
  const nested = join(root, 'data', 'base.wz')
  if (await pathKind(nested, 'file'))
    return Object.freeze({ contentRoot: join(root, 'data'), base: nested })
  const direct = join(root, 'base.wz')
  return Object.freeze({ contentRoot: root, base: direct })
}

async function probeCandidate(candidateValue, signal) {
  signal?.throwIfAborted()
  const root = candidateValue.path
  const layout = await contentLayout(root)
  const baseFound = await pathKind(layout.base, 'file')
  const baseMagic = baseFound && (await archiveMagic(layout.base))
  const optionalArchives = ['mp.wz', 'sequences.wz']
  const evidence = [
    Object.freeze({ kind: 'warzone-base-archive', path: layout.base, found: baseFound }),
    Object.freeze({
      kind: 'warzone-base-zip-signature',
      path: layout.base,
      found: baseMagic,
      detail: baseFound ? (baseMagic ? 'PK0304' : 'unexpected signature') : 'archive absent',
    }),
  ]
  for (const name of optionalArchives) {
    signal?.throwIfAborted()
    const path = join(layout.contentRoot, name)
    evidence.push(
      Object.freeze({
        kind: `warzone-${name.slice(0, -3)}-archive`,
        path,
        found: await pathKind(path, 'file'),
      }),
    )
  }
  return Object.freeze({
    candidate: candidateValue,
    normalizedPath: normalizeWarzoneInstallationPath(root),
    confirmed: baseFound && baseMagic,
    ...(candidateValue.version === undefined ? {} : { version: candidateValue.version }),
    evidence: Object.freeze(evidence),
  })
}

function validatedLimit(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAXIMUM_CANDIDATES) {
    throw new TypeError(
      `maxCandidates must be a positive safe integer no greater than ${MAXIMUM_CANDIDATES}`,
    )
  }
  return value
}

async function collectCandidates(request, limit) {
  const explicit = collectWarzoneInstallationCandidates(
    {
      configuredPaths: request.configuredPaths,
      environmentPath: process.env['MODKITX_WARZONE_ROOT'],
      appModelPaths: [],
      registryPaths: [],
      steamPaths: [],
      defaultPaths: [],
      platform: process.platform,
    },
    limit,
  )
  if (explicit.candidates.length >= limit) {
    return Object.freeze({ ...explicit, truncated: true })
  }
  return collectWarzoneInstallationCandidates(
    {
      configuredPaths: request.configuredPaths,
      environmentPath: process.env['MODKITX_WARZONE_ROOT'],
      appModelPaths: await appModelCandidates(request.signal),
      registryPaths: await uninstallCandidates(request.signal),
      steamPaths: await steamCandidates(request.signal),
      defaultPaths: defaultWarzoneInstallationPaths(),
      platform: process.platform,
    },
    limit,
  )
}

export async function discoverWarzone2100Installations(request) {
  request.signal?.throwIfAborted()
  if (request.gameId !== GAME_ID) {
    throw new TypeError(`Warzone 2100 discovery cannot inspect ${request.gameId}`)
  }
  const limit = validatedLimit(request.maxCandidates)
  const collected = await collectCandidates(request, limit)
  const probes = []
  for (const entry of collected.candidates) {
    request.signal?.throwIfAborted()
    probes.push(await probeCandidate(entry, request.signal))
  }
  const installations = probes.flatMap((probe, index) =>
    probe.confirmed
      ? [
          Object.freeze({
            gameId: GAME_ID,
            displayName: DISPLAY_NAME,
            installPath: probe.candidate.path,
            normalizedPath: probe.normalizedPath,
            origins: collected.candidateOrigins[index] ?? Object.freeze([probe.candidate.origin]),
            ...(probe.version === undefined ? {} : { version: probe.version }),
            evidence: probe.evidence,
          }),
        ]
      : [],
  )
  const diagnostics = []
  if (collected.truncated) {
    diagnostics.push(
      Object.freeze({
        severity: 'warning',
        code: 'opensource.warzone2100/candidates-truncated',
        message: `candidate discovery was truncated at ${limit}`,
      }),
    )
  }
  if (installations.length === 0) {
    diagnostics.push(
      Object.freeze({
        severity: 'information',
        code: 'opensource.warzone2100/installation-not-found',
        message: 'no candidate contained a confirmed Warzone 2100 installation',
      }),
    )
  }
  return Object.freeze({
    gameId: GAME_ID,
    complete: !collected.truncated,
    probes: Object.freeze(probes),
    installations: Object.freeze(installations),
    diagnostics: Object.freeze(diagnostics),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([GAME_INSTALLATION_DISCOVERY_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== GAME_INSTALLATION_DISCOVERY_CONTRACT || selection.major !== 1) {
    throw new TypeError(
      `unsupported game-installation selection ${selection.contract}@${selection.major}`,
    )
  }
  return Object.freeze({
    value: Object.freeze({
      contract: GAME_INSTALLATION_DISCOVERY_CONTRACT,
      discoveryId: DISCOVERY_ID,
      gameIds: Object.freeze([GAME_ID]),
      origins: Object.freeze(['configured-path', 'default-directory', 'registry', 'steam']),
      discover: discoverWarzone2100Installations,
    }),
    release: async () => undefined,
  })
}
