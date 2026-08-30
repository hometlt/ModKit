import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  discoverAuthoredExtensionRoots,
  hasAuthoredExtensionContainer,
  toPosixPath,
} from './lib/authored-extension-roots.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const composition = JSON.parse(
  readFileSync(join(repoRoot, 'config', 'build-composition.json'), 'utf8'),
)

function contributionIds(root, metadata) {
  const ids = []
  for (const pattern of metadata.modkit.contributionManifests ?? []) {
    if (typeof pattern !== 'string' || !pattern.startsWith('./')) continue
    if (pattern.endsWith('/*.json')) {
      const directory = join(root, pattern.slice(2, -'/*.json'.length))
      if (!existsSync(directory)) continue
      for (const name of readdirSync(directory)
        .filter(name => name.endsWith('.json'))
        .sort()) {
        const manifest = JSON.parse(readFileSync(join(directory, name), 'utf8'))
        if (typeof manifest.id === 'string') ids.push(manifest.id)
      }
    } else if (!pattern.includes('*')) {
      const manifest = JSON.parse(readFileSync(join(root, pattern.slice(2)), 'utf8'))
      if (typeof manifest.id === 'string') ids.push(manifest.id)
    }
  }
  return Object.freeze(ids.sort())
}

const discovered = composition.bundledBaseRoots.flatMap(base => {
  const root = join(repoRoot, base)
  return hasAuthoredExtensionContainer(root) ? [root] : discoverAuthoredExtensionRoots(root)
})

export const READY_APP_EXTENSIONS = Object.freeze(
  Object.fromEntries(
    discovered
      .map(root => {
        const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
        const id = metadata.modkit?.id
        if (typeof id !== 'string' || typeof metadata.modkit?.publisher !== 'string') {
          throw new Error(`bundled extension has no package.json#modkit identity: ${root}`)
        }
        const relativePath = toPosixPath(relative(join(repoRoot, 'extensions'), root))
        return [
          id,
          Object.freeze({
            coordinate: `${metadata.modkit.publisher}/${id}`,
            contributions: contributionIds(root, metadata),
            path: Object.freeze(relativePath.split('/')),
          }),
        ]
      })
      .sort(([left], [right]) => left.localeCompare(right, 'en')),
  ),
)

export const APP_EXTENSION_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(composition.extensionSets).map(([name, ids]) => {
      for (const id of ids) {
        if (READY_APP_EXTENSIONS[id] === undefined) {
          throw new Error(`build composition set ${name} names unknown bundled extension ${id}`)
        }
      }
      return [name, Object.freeze([...ids])]
    }),
  ),
)

export function extensionDirectory(name) {
  const extension = READY_APP_EXTENSIONS[name]
  if (extension === undefined) throw new Error(`unknown bundled extension: ${name}`)
  return extension.path
}

export function extensionLocation(name) {
  return Object.freeze({ kind: 'internal', path: extensionDirectory(name) })
}

export function extensionSet(name) {
  const directories = APP_EXTENSION_SETS[name]
  if (directories === undefined) throw new Error(`unknown build composition set: ${name}`)
  return directories
}

export function expectedExtensionCoordinates(name) {
  return extensionSet(name)
    .map(directory => READY_APP_EXTENSIONS[directory].coordinate)
    .toSorted()
}

export function expectedContributionIds(name) {
  return extensionSet(name)
    .flatMap(directory => READY_APP_EXTENSIONS[directory].contributions)
    .toSorted()
}
