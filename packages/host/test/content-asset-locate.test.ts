import { expect, it } from 'vitest'
import type { ContentSources, ModContext } from '@modkit/vfs/content-sources'
import { createContentAssetOrigin } from '../src/content-dependency-operations.js'

const ICON = Uint8Array.of(1, 2, 3)

/** A context whose game keeps assets under `Base.SC2Assets`, which only its `locate` knows. */
function sources(log: string[]): ContentSources {
  const context: ModContext = {
    schemaVersion: 1,
    gameId: 'example/game',
    contextId: 'liberty-chain',
    layers: [
      {
        id: 'liberty',
        displayName: 'Liberty',
        sourceId: 'casc',
        sourcePath: 'mods/liberty.sc2mod',
        role: 'dependency',
        provenance: 'implicit',
        kind: 'package',
      },
    ],
    unresolved: [],
    diagnostics: [],
    files: async () => ({ items: [] }),
    async read(layerId, path) {
      log.push(`read ${layerId}:${path}`)
      if (path !== 'Base.SC2Assets/Assets/Textures/btn-marine.dds') throw new RangeError(path)
      return ICON
    },
    async locate(path) {
      log.push(`locate ${path}`)
      return path.toLowerCase() === 'assets/textures/btn-marine.dds'
        ? { layerId: 'liberty', path: 'Base.SC2Assets/Assets/Textures/btn-marine.dds' }
        : undefined
    },
    async dispose() {
      log.push('dispose')
    },
  }
  return {
    async snapshot() {
      return { label: 'cdn', regions: [], connections: [], roots: [] }
    },
    async connect() {},
    async disconnect() {},
    async search() {
      return []
    },
    async add() {},
    async remove() {},
    async refresh() {},
    async list() {
      return []
    },
    async read() {
      throw new RangeError('not listed')
    },
    async openModContext() {
      return context
    },
    dispose() {},
  }
}

it("finds an asset in the game's spelling where the mod context places it", async () => {
  const log: string[] = []
  const origin = createContentAssetOrigin({
    contentSources: sources(log),
    target: 'C:/maps/a.SC2Map',
  })
  const entries = []
  for await (const entry of origin.enumerate('workspace-dependency-layer', {
    prefix: 'Assets/Textures/btn-marine.dds',
  }))
    entries.push(entry.logicalId)
  expect(entries).toEqual(['Assets/Textures/btn-marine.dds'])
  const lease = await origin.open('Assets/Textures/btn-marine.dds')
  expect([...(await lease.value.read(0n, 3))]).toEqual([...ICON])
  expect(lease.value.ref.uri).toBe(
    'content-source://casc/mods/liberty.sc2mod/Base.SC2Assets/Assets/Textures/btn-marine.dds',
  )
  // a path nobody places stays absent, asked once
  for await (const entry of origin.enumerate('workspace-dependency-layer', {
    prefix: 'nothing.dds',
  }))
    entries.push(entry.logicalId)
  for await (const entry of origin.enumerate('workspace-dependency-layer', {
    prefix: 'nothing.dds',
  }))
    entries.push(entry.logicalId)
  expect(entries).toHaveLength(1)
  expect(log.filter(line => line.startsWith('locate'))).toEqual([
    'locate Assets/Textures/btn-marine.dds',
    'locate nothing.dds',
  ])
})
