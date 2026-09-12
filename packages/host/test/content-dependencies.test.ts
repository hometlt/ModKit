import { describe, expect, it } from 'vitest'
import type { ContentDependencyResolution, ContentSources } from '@modkit/vfs/content-sources'
import { createReadOnlyContentDependencyWorkspace } from '../src/content-dependencies.js'

const encoder = new TextEncoder()
const files = new Map([
  ['cache/base/Base.SC2Data/GameData/Units.xml', encoder.encode('<Base/>')],
  ['cache/base/Base.SC2Data/GameData/Effects.xml', encoder.encode('<Effect/>')],
  ['cache/override/Base.SC2Data/GameData/Units.xml', encoder.encode('<Override/>')],
])

function contentSources(): ContentSources {
  return {
    async snapshot() { return { label: 'test', regions: [], connections: [], roots: [] } },
    async connect() {}, async disconnect() {}, async search() { return [] }, async add() {},
    async remove() {}, async refresh() {},
    async list(_sourceId, path) {
      const prefix = path === '' ? '' : `${path}/`
      return [...files.entries()].flatMap(([file, bytes]) => {
        if (!file.startsWith(prefix)) return []
        const tail = file.slice(prefix.length)
        if (tail.includes('/')) return []
        return [{ path: file, name: tail, directory: false, size: bytes.byteLength }]
      })
    },
    async read(_sourceId, path, maximum) {
      const bytes = files.get(path)
      if (bytes === undefined) throw new RangeError('missing')
      if (bytes.byteLength > maximum) throw new RangeError('limit')
      return bytes.slice()
    },
    dispose() {},
  }
}

const resolution: ContentDependencyResolution = {
  schemaVersion: 1,
  gameId: 'example/game',
  complete: true,
  mounts: [
    { dependencyId: 'base', order: 0, sourceId: 'cache', sourcePath: 'cache/base',
      displayName: 'Base', kind: 'content-archive', fingerprint: 'content-hash.sha256:base' },
    { dependencyId: 'override', order: 1, sourceId: 'cache', sourcePath: 'cache/override',
      displayName: 'Override', kind: 'content-archive', fingerprint: 'content-hash.sha256:override' },
  ],
  dependencies: [],
  diagnostics: [],
}

describe('read-only content dependency workspace', () => {
  it('preserves semantic load order and resolves files through overlay precedence', async () => {
    const prepared = createReadOnlyContentDependencyWorkspace({
      contentSources: contentSources(), resolution, workspaceId: 'replay:test',
    })
    try {
      expect(prepared.workspace.loadOrder.map(root => root.displayName)).toEqual(['Base', 'Override'])
      expect(prepared.workspace.logicalRoots?.map(root => root.displayName)).toEqual(['Override', 'Base'])
      expect(prepared.workspace.activeRootId).toBe('content-dependency:override')
      expect(prepared.workspace.loadOrder.map(root => root.sourcePath)).toEqual([
        'content-dependencies/0', 'content-dependencies/1',
      ])
      expect(JSON.stringify(prepared.workspace)).not.toContain('cache/base')
      const units = await prepared.resources.resolve({
        id: 'units', logicalId: 'content-dependencies/1/Base.SC2Data/GameData/Units.xml', role: 'buffer',
        scopes: ['workspace-dependency-layer'],
      })
      expect(units.state).toBe('resolved')
      if (units.state === 'resolved' && units.lease.value.kind === 'bytes') {
        expect(new TextDecoder().decode(await units.lease.value.read(0n, 64))).toBe('<Override/>')
        await units.lease.release()
      }
      const effects = await prepared.resources.resolve({
        id: 'effects', logicalId: 'content-dependencies/0/Base.SC2Data/GameData/Effects.xml', role: 'buffer',
        scopes: ['workspace-dependency-layer'],
      })
      expect(effects.state).toBe('resolved')
      if (effects.state === 'resolved' && effects.lease.value.kind === 'bytes') {
        expect(new TextDecoder().decode(await effects.lease.value.read(0n, 64))).toBe('<Effect/>')
        await effects.lease.release()
      }
    } finally {
      await prepared.dispose()
    }
  })

  it('reports an absent dependency file through the normal resource outcome', async () => {
    const prepared = createReadOnlyContentDependencyWorkspace({
      contentSources: contentSources(), resolution, workspaceId: 'replay:test',
    })
    try {
      const result = await prepared.resources.resolve({
        id: 'missing', logicalId: 'content-dependencies/1/Base.SC2Data/GameData/Missing.xml', role: 'buffer',
        scopes: ['workspace-dependency-layer'],
      })
      expect(result).toMatchObject({ state: 'unresolved', reason: 'not-found' })
    } finally {
      await prepared.dispose()
    }
  })
})
