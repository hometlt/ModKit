import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { externalRepositoryRoot } from '../migration/lib/external-extension-roots.mjs'

export const OWNER_REPOSITORIES = Object.freeze([
  Object.freeze({ id: 'core', repository: 'modkit-core' }),
  Object.freeze({ id: 'blizzard', repository: 'modkit-extensions-blizzard' }),
  Object.freeze({ id: 'ea', repository: 'modkit-extensions-ea' }),
  Object.freeze({ id: 'other', repository: 'modkit-extensions-other' }),
  Object.freeze({ id: 'empire-earth', repository: 'modkit-extensions-empire-earth' }),
  Object.freeze({ id: 'ps1', repository: 'modkit-extensions-ps1' }),
  Object.freeze({ id: 'flash', repository: 'modkit-extensions-flash' }),
  Object.freeze({ id: 'documents', repository: 'modkit-extensions-documents' }),
  Object.freeze({ id: 'frostgiant', repository: 'modkit-extensions-frostgiant' }),
  Object.freeze({ id: 'spring', repository: 'modkit-extensions-annihilation' }),
  Object.freeze({ id: 'warzone', repository: 'modkit-extensions-warzone' }),
])

const LEGACY_EXTENSION_PREFIXES = Object.freeze([
  Object.freeze({
    prefix: 'extensions/common/data/plain-text',
    owner: 'core',
    strip: 4,
    prepend: ['packages', 'host', 'native-text'],
  }),
  Object.freeze({
    prefix: 'extensions/common/data/text-delimited',
    owner: 'core',
    strip: 4,
    prepend: ['extensions', 'data'],
  }),
  Object.freeze({ prefix: 'extensions/blizzard/', owner: 'blizzard', strip: 2 }),
  Object.freeze({ prefix: 'extensions/ea/', owner: 'ea', strip: 2 }),
  Object.freeze({
    prefix: 'extensions/opensource/spring',
    owner: 'spring',
    strip: 3,
    prepend: ['extensions', 'spring-recoil'],
  }),
  Object.freeze({ prefix: 'extensions/opensource/warzone-2100', owner: 'warzone', strip: 3 }),
  Object.freeze({ prefix: 'extensions/ps1', owner: 'ps1', strip: 1, prepend: ['extensions'] }),
  Object.freeze({ prefix: 'extensions/stainless-steel-studios-empire-earth', owner: 'empire-earth', strip: 1, prepend: ['extensions'] }),
  Object.freeze({ prefix: 'extensions/adobe-flash/', owner: 'flash', strip: 1, prepend: ['extensions'] }),
  Object.freeze({ prefix: 'extensions/uncommon-documents/', owner: 'documents', strip: 1, prepend: ['extensions'] }),
  Object.freeze({ prefix: 'extensions/frost-giant-stormgate/', owner: 'frostgiant', strip: 1, prepend: ['extensions'] }),
  Object.freeze({ prefix: 'extensions/common/', owner: 'core', strip: 2, prepend: ['extensions'] }),
])

function git(root, arguments_, run = spawnSync) {
  const result = run('git', ['-C', root, ...arguments_], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(' ')} failed for ${root}: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

export function repositoryRoots(coreRoot, environment = process.env) {
  return Object.freeze({
    core: resolve(coreRoot),
    blizzard: externalRepositoryRoot(coreRoot, 'blizzard', environment),
    ea: externalRepositoryRoot(coreRoot, 'ea', environment),
    other: externalRepositoryRoot(coreRoot, 'other', environment),
    'empire-earth': externalRepositoryRoot(coreRoot, 'empire-earth', environment),
    ps1: externalRepositoryRoot(coreRoot, 'ps1', environment),
    flash: externalRepositoryRoot(coreRoot, 'flash', environment),
    documents: externalRepositoryRoot(coreRoot, 'documents', environment),
    frostgiant: externalRepositoryRoot(coreRoot, 'frostgiant', environment),
    spring: externalRepositoryRoot(coreRoot, 'spring', environment),
    warzone: externalRepositoryRoot(coreRoot, 'warzone', environment),
  })
}

export function resolveLegacyExtension(coreRoot, legacyPath, environment = process.env) {
  const portable = legacyPath.replaceAll('\\', '/')
  const match = LEGACY_EXTENSION_PREFIXES.find(
    entry => portable === entry.prefix.replace(/\/$/u, '') || portable.startsWith(entry.prefix),
  )
  if (match === undefined) return resolve(coreRoot, portable)
  const roots = repositoryRoots(coreRoot, environment)
  const tail = portable.split('/').slice(match.strip)
  return resolve(roots[match.owner], ...(match.prepend ?? []), ...tail)
}

export function ownerOfLegacyExtension(legacyPath) {
  const portable = legacyPath.replaceAll('\\', '/')
  return (
    LEGACY_EXTENSION_PREFIXES.find(
      entry => portable === entry.prefix.replace(/\/$/u, '') || portable.startsWith(entry.prefix),
    )?.owner ?? 'core'
  )
}

/** Translate the sealed MK2 publisher namespace into the installed X3 contribution namespace. */
export function currentContributionId(legacyContributionId) {
  const match = /^org\.modkitx(?:\.([^/]+))?\/(.+)$/u.exec(legacyContributionId)
  if (match === null) throw new TypeError(`invalid legacy contribution id ${legacyContributionId}`)
  return `${match[1] ?? 'modkit'}/${match[2]}`
}

export function currentRepositoryBindings(coreRoot, options = {}) {
  const roots = repositoryRoots(coreRoot, options.environment)
  return OWNER_REPOSITORIES.map(owner => {
    const root = roots[owner.id]
    if (!existsSync(root)) throw new Error(`owner repository is missing: ${root}`)
    const commit = git(root, ['rev-parse', 'HEAD'], options.run)
    const dirty = git(root, ['status', '--porcelain'], options.run)
    if (dirty !== '') {
      throw new Error(
        `owner repository ${owner.repository} has tracked changes; parity must bind committed code`,
      )
    }
    return Object.freeze({ id: owner.id, repository: owner.repository, commit })
  })
}
