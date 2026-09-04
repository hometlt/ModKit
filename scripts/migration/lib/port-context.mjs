import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, requirementsFor } from './port-state.mjs'

export const coreRoot = fileURLToPath(new URL('../../..', import.meta.url))
export const workspaceRoot = path.dirname(coreRoot.replace(/[\\/]$/u, ''))
export const stateRoot = path.join(coreRoot, 'migration/codec-port')
export async function portContext({ discoverRepositories = false } = {}) {
  const inventory = await readJson(path.join(coreRoot, 'migration/generated/source-inventory.json'))
  const audit = await readJson(path.join(stateRoot, 'sc2-audit.json'))
  const authored = await readJson(path.join(stateRoot, 'authored.json'))
  const requirements = requirementsFor(inventory, audit.rows, authored.entries)
  const units = inventory.units.filter(unit => unit.kind === 'codec-manifest')
  if (units.length !== 206 || Object.keys(audit.rows).length !== 12)
    throw new Error('frozen inventory must contain 206 legacy codecs and 12 SC2 audits')
  const repositories = []
  if (discoverRepositories) {
    const { externalRepositoryRoot } = await import('./external-extension-roots.mjs')
    repositories.push(
      { id: 'core', directory: coreRoot },
      ...['blizzard', 'warzone', 'ea', 'spring', 'other'].map(id => ({
        id,
        directory: externalRepositoryRoot(workspaceRoot, id),
      })),
    )
  }
  return {
    inventory,
    audits: audit.rows,
    authored: authored.entries,
    requirements,
    units,
    repositories,
  }
}
