import { describe, expect, it } from 'vitest'
import { revisionId } from '@modkit/sdk'
import type {
  ContentSourceEntry,
  ContentSources,
  ModContext,
  ModContextLayer,
  ModContextRequest,
} from '@modkit/vfs/content-sources'
import { resolveContentAssetOrigins } from '../src/content-dependency-operations.js'
import { createResourceSession } from '../src/resource-session.js'

// content-dependency-operations.test.ts is pinned by the feature ledger; new cases live here.

/** Two dependency layers in one source; the stronger (later) one overrides a shared file. */
const files: Readonly<Record<string, string>> = {
  'Assets/Core/rbxassetid/123': 'core',
  'Assets/Core/rbxassetid/7': 'core-only',
  'Assets/Game/rbxassetid/123': 'game',
}

function sources(): ContentSources {
  const encoder = new TextEncoder()
  return {
    async snapshot() {
      return { label: 'test', regions: [], connections: [], roots: [] }
    },
    async connect() {},
    async disconnect() {},
    async search() {
      return []
    },
    async add() {},
    async remove() {},
    async refresh() {},
    async list(sourceId: string, path: string): Promise<readonly ContentSourceEntry[]> {
      if (sourceId !== 'assets') return []
      return Object.keys(files)
        .filter(file => file.slice(0, file.lastIndexOf('/')) === path)
        .map(file => ({ path: file, name: file.slice(file.lastIndexOf('/') + 1), directory: false, size: 4 }))
    },
    async read(sourceId: string, path: string) {
      const text = sourceId === 'assets' ? files[path] : undefined
      if (text === undefined) throw new RangeError(`no ${path}`)
      return encoder.encode(text)
    },
    async openModContext(request: ModContextRequest): Promise<ModContext> {
      const target = typeof request.target === 'string' ? request.target : request.target.path
      const layers: ModContextLayer[] = [
        { id: 'core', displayName: 'Core', sourceId: 'assets', sourcePath: 'Assets/Core', role: 'dependency', provenance: 'implicit' },
        { id: 'game', displayName: 'Game', sourceId: 'assets', sourcePath: 'Assets/Game', role: 'dependency', provenance: 'declared' },
        { id: 'primary', displayName: 'place', sourceId: 'host', sourcePath: target, role: 'primary', provenance: 'opened' },
      ]
      return {
        schemaVersion: 1,
        gameId: 'example/game',
        contextId: 'context',
        layers,
        unresolved: [],
        diagnostics: [],
        files: async () => ({ items: [] }),
        read: async () => new Uint8Array(),
        locate: async () => undefined,
        dispose: async () => {},
      }
    },
    async dispose() {},
  }
}

describe('subject resources by a path relative to the dependency layers', () => {
  it('resolves a layer-relative path through the overlay, strongest layer first', async () => {
    const { origins } = await resolveContentAssetOrigins({
      contentSources: sources(),
      subjects: [{ descriptor: { subjectUri: 'file:///C:/Work/Place.rbxl' } }],
    })
    expect(origins).toHaveLength(1)
    const session = createResourceSession({
      origin: origins[0]!,
      revision: revisionId('provider-token:content-dependency-asset-paths'),
    })
    const decoder = new TextDecoder()
    const read = async (logicalId: string) => {
      const result = await session.resolve({
        id: logicalId,
        logicalId,
        role: 'sidecar',
        scopes: ['workspace-dependency-layer'],
      })
      if (result.state !== 'resolved') return result.state
      const source = result.lease.value
      const bytes = source.kind === 'bytes' ? await source.read(0n, Number(source.size)) : new Uint8Array()
      await result.lease.release()
      return decoder.decode(bytes)
    }
    try {
      expect(await read('rbxassetid/123')).toBe('game')
      expect(await read('rbxassetid/7')).toBe('core-only')
      expect(await read('rbxassetid/999')).toBe('unresolved')
    } finally {
      await session.dispose()
    }
  })
})
