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
  const archiveRows = audit.archiveRows ?? {}
  const audits = { ...audit.rows, ...archiveRows }
  const requirements = requirementsFor(inventory, audits, authored.entries)
  const units = inventory.units.filter(unit => unit.kind === 'codec-manifest')
  if (
    units.length !== 206 ||
    Object.keys(audit.rows).length !== 12 ||
    Object.keys(archiveRows).sort().join(',') !== 'casc,mpq'
  )
    throw new Error(
      'frozen inventory must contain 206 legacy codecs, 12 SC2 audits and MPQ/CASC shared audits',
    )
  const repositories = []
  if (discoverRepositories) {
    const { externalRepositoryDescriptor, externalRepositoryRoot } =
      await import('./external-extension-roots.mjs')
    repositories.push(
      { id: 'core', directory: coreRoot, workspaceRelativeRoot: path.basename(coreRoot) },
      ...[
        'blizzard', 'warzone', 'ea', 'spring', 'other', 'realitypump',
        'petroglyph', 'relic', 'gas-powered', 'unity', 'ensemble', 'unreal', 'rad', 'facefx', 'wwise', 'fmod', 'empire-earth', 'ps1', 'flash', 'documents',
      ].map(id => {
        const descriptor = externalRepositoryDescriptor(id, workspaceRoot)
        return {
          id,
          directory: externalRepositoryRoot(workspaceRoot, id),
          workspaceRelativeRoot: path.relative(
            workspaceRoot,
            path.resolve(workspaceRoot, descriptor.uri),
          ),
        }
      }),
    )
  }
  return {
    inventory,
    audits,
    authored: authored.entries,
    requirements,
    units,
    repositories,
  }
}
