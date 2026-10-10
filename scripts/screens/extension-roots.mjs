/** Every local extension root the screen tools load: all sibling extension repositories. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPOSITORIES = [
  'modkit-extensions-blizzard',
  'modkit-extensions-ea',
  'modkit-extensions-other',
  'modkit-extensions-annihilation',
  'modkit-extensions-warzone',
]

export function localExtensionRoots(coreRoot) {
  return REPOSITORIES.flatMap(name => {
    const root = resolve(coreRoot, '..', name)
    const manifest = resolve(root, 'modkit.repository.json')
    if (!existsSync(manifest)) return []
    const { extensions = [] } = JSON.parse(readFileSync(manifest, 'utf8'))
    return extensions.map(entry => resolve(root, entry.path))
  })
}
