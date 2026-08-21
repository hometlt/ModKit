import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { GAME_INSTALLATION_DISCOVERY_CONTRACT } from '@modkitx-x3/sdk/games'

const execFileAsync = promisify(execFile)
const DISCOVERY_ID = 'org.modkitx.blizzard.starcraft2'
const GAME_ID = 'org.modkitx/starcraft-2'
const DISPLAY_NAME = 'StarCraft II'
const MAXIMUM_CANDIDATES = 128
const MARKER_DIRECTORIES = Object.freeze([
  ['casc-config-directory', 'SC2Data', 'config'],
  ['casc-data-directory', 'SC2Data', 'data'],
  ['casc-indices-directory', 'SC2Data', 'indices'],
])
const REGISTRY_KEYS = Object.freeze([
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\StarCraft II',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\StarCraft II',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\StarCraft II',
])

function normalizePath(value) {
  return resolve(value).replace(/\\/g, '/').replace(/\/+$/, '')
}

function candidateKey(candidate) {
  const path = normalizePath(candidate.path)
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function nonEmptyPath(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty path`)
  }
  return resolve(value.trim())
}

function candidate(origin, path) {
  return Object.freeze({ origin, displayName: DISPLAY_NAME, path: normalizePath(path) })
}

async function pathKind(path, expected) {
  try {
    const value = await stat(path)
    return expected === 'file' ? value.isFile() : value.isDirectory()
  } catch {
    return false
  }
}

async function registryCandidates() {
  if (process.platform !== 'win32') return []
  const candidates = []
  for (const key of REGISTRY_KEYS) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key, '/v', 'InstallLocation'], {
        windowsHide: true,
      })
      const match = /^\s*InstallLocation\s+REG_\w+\s+(.+)$/im.exec(stdout)
      if (match?.[1]) candidates.push(candidate('registry', match[1].trim()))
    } catch {
      // An absent registry view is normal and contributes no candidate.
    }
  }
  return candidates
}

function defaultCandidates() {
  if (process.platform === 'darwin') {
    return [candidate('default-directory', '/Applications/StarCraft II')]
  }
  if (process.platform !== 'win32') return []
  const roots = []
  for (const base of [process.env['ProgramFiles(x86)'], process.env['ProgramFiles']]) {
    if (base) roots.push(candidate('default-directory', join(base, 'StarCraft II')))
  }
  return roots
}

function parseBuildInformation(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/u)
    .filter(line => line.trim().length > 0)
  const header = lines[0]
  if (header === undefined) return undefined
  const names = header.split('|').map(field => field.split('!')[0]?.trim() ?? '')
  for (const line of lines.slice(1)) {
    const values = line.split('|')
    const fields = new Map(names.map((name, index) => [name, values[index] ?? '']))
    if (fields.get('Active') !== '1') continue
    return {
      version: fields.get('Version')?.trim() ?? '',
      buildName: fields.get('Build Name')?.trim() ?? '',
      buildUid: fields.get('Build UID')?.trim() ?? '',
      product: fields.get('Product')?.trim() ?? '',
      buildProduct: fields.get('Build Product')?.trim() ?? '',
      cdnPath: fields.get('CDN Path')?.trim() ?? '',
    }
  }
  return undefined
}

function matchesStarcraft2Build(build) {
  if (build === undefined) return false
  const product = build.product.toLowerCase()
  const buildProduct = build.buildProduct.toLowerCase().replace(/[^a-z0-9]/gu, '')
  const cdnPath = build.cdnPath.toLowerCase()
  return (
    product === 's2' ||
    product === 's2b' ||
    buildProduct === 'starcraft2' ||
    /(?:^|[/._-])sc?2(?:[/._-]|$)/u.test(cdnPath)
  )
}

async function probeCandidate(candidateValue, signal) {
  signal?.throwIfAborted()
  const root = candidateValue.path
  const buildInfoPath = join(root, '.build.info')
  const hasBuildInfo = await pathKind(buildInfoPath, 'file')
  let build
  if (hasBuildInfo) {
    try {
      build = parseBuildInformation(await readFile(buildInfoPath, 'utf8'))
    } catch {
      build = undefined
    }
  }
  const identityMatched = matchesStarcraft2Build(build)
  const evidence = [
    Object.freeze({ kind: 'casc-build-info-file', path: buildInfoPath, found: hasBuildInfo }),
    Object.freeze({
      kind: 'starcraft2-build-identity',
      path: buildInfoPath,
      found: identityMatched,
      ...(build === undefined
        ? { detail: 'no active build record' }
        : { detail: `product=${build.product || 'unknown'};cdn=${build.cdnPath || 'unknown'}` }),
    }),
  ]
  for (const [kind, ...segments] of MARKER_DIRECTORIES) {
    signal?.throwIfAborted()
    const path = join(root, ...segments)
    evidence.push(Object.freeze({ kind, path, found: await pathKind(path, 'directory') }))
  }
  const confirmed = evidence.every(entry => entry.found)
  return Object.freeze({
    candidate: candidateValue,
    normalizedPath: normalizePath(root),
    confirmed,
    ...(build?.version ? { version: build.version } : {}),
    ...(build?.buildName ? { buildName: build.buildName } : {}),
    ...(build?.buildUid ? { buildUid: build.buildUid } : {}),
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

function configuredCandidates(paths) {
  if (paths === undefined) return []
  if (!Array.isArray(paths)) throw new TypeError('configuredPaths must be an array when present')
  return paths.map((path, index) =>
    candidate('configured-path', nonEmptyPath(path, `configuredPaths[${index}]`)),
  )
}

async function collectCandidates(request, limit) {
  const discovered = [
    ...configuredCandidates(request.configuredPaths),
    ...(await registryCandidates()),
    ...defaultCandidates(),
  ]
  const priority = { 'configured-path': 0, registry: 1, 'default-directory': 2 }
  discovered.sort((left, right) => {
    const pathOrder = candidateKey(left).localeCompare(candidateKey(right))
    return pathOrder === 0 ? priority[left.origin] - priority[right.origin] : pathOrder
  })
  const unique = new Map()
  for (const entry of discovered) {
    const key = candidateKey(entry)
    if (!unique.has(key)) unique.set(key, entry)
  }
  return { candidates: [...unique.values()].slice(0, limit), truncated: unique.size > limit }
}

export async function discoverStarcraft2Installations(request) {
  request.signal?.throwIfAborted()
  if (request.gameId !== GAME_ID) {
    throw new TypeError(`StarCraft II discovery cannot inspect ${request.gameId}`)
  }
  const limit = validatedLimit(request.maxCandidates)
  const collected = await collectCandidates(request, limit)
  const probes = []
  for (const entry of collected.candidates) {
    request.signal?.throwIfAborted()
    probes.push(await probeCandidate(entry, request.signal))
  }
  const installations = probes.flatMap(probe =>
    probe.confirmed
      ? [
          Object.freeze({
            gameId: GAME_ID,
            displayName: DISPLAY_NAME,
            installPath: probe.candidate.path,
            normalizedPath: probe.normalizedPath,
            origins: Object.freeze([probe.candidate.origin]),
            ...(probe.version === undefined ? {} : { version: probe.version }),
            ...(probe.buildName === undefined ? {} : { buildName: probe.buildName }),
            ...(probe.buildUid === undefined ? {} : { buildUid: probe.buildUid }),
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
        code: 'blizzard.starcraft2/candidates-truncated',
        message: `candidate discovery was truncated at ${limit}`,
      }),
    )
  }
  if (installations.length === 0) {
    diagnostics.push(
      Object.freeze({
        severity: 'information',
        code: 'blizzard.starcraft2/installation-not-found',
        message: 'no candidate contained a confirmed StarCraft II installation',
      }),
    )
  }
  return Object.freeze({
    gameId: GAME_ID,
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
      origins: Object.freeze(['configured-path', 'default-directory', 'registry']),
      discover: discoverStarcraft2Installations,
    }),
    release: async () => undefined,
  })
}
