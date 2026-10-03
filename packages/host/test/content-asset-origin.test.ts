import { describe, expect, it, vi } from 'vitest'
import type {
  ContentSources,
  ModContext,
  ModContextLayer,
  ModContextRequest,
} from '@modkit/vfs/content-sources'
import { createContentAssetOrigin } from '../src/content-dependency-operations.js'

// content-dependency-operations.test.ts is pinned by ledger evidence; new cases live here.

function sources(extra: Partial<ContentSources> = {}): ContentSources {
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
    async list() {
      return []
    },
    async read() {
      return new Uint8Array()
    },
    async dispose() {},
    ...extra,
  }
}

const core: ModContextLayer = {
  id: 'l0',
  displayName: 'Core',
  sourceId: 'casc',
  sourcePath: 'Mods/Core',
  role: 'dependency',
  provenance: 'implicit',
}

const context = (request: ModContextRequest): ModContext =>
  ({
    schemaVersion: 1,
    gameId: 'example/game',
    contextId: 'context',
    layers: [
      core,
      {
        id: 'primary',
        displayName: 'subject',
        sourceId: 'host',
        sourcePath: String(request.target),
        role: 'primary',
        provenance: 'opened',
      },
    ],
    unresolved: [],
    diagnostics: [],
    files: async () => ({ items: [] }),
    read: async () => new Uint8Array(),
    locate: async () => undefined,
    dispose: async () => {},
  }) as unknown as ModContext

describe('the resources of the mod a subject belongs to, for an ordinary open', () => {
  it('allows a bounded root enumeration without allowing an empty file identity', async () => {
    const origin = createContentAssetOrigin({
      contentSources: sources({
        async openModContext(request) {
          return context(request)
        },
        async files(_sourceId, path, query) {
          expect(path).toBe('Mods/Core')
          if (query.cursor === undefined)
            return {
              items: [{ path: 'Mods/Core/def/ai/monster.def', size: 4 }],
              nextCursor: 'second',
            }
          return { items: [{ path: 'Mods/Core/materials/a.mtr', size: 2 }] }
        },
        async list(_sourceId, path) {
          if (path === 'Mods/Core')
            return [
              { path: 'Mods/Core/monster.def', name: 'monster.def', directory: false, size: 4 },
            ]
          return []
        },
      }),
      target: 'C:/Games/monster.md5mesh',
    })
    const found: string[] = []
    for await (const entry of origin.enumerate('workspace-dependency-layer', { prefix: '' }))
      found.push(entry.logicalId)
    expect(found).toEqual([
      'content-dependencies/0/def/ai/monster.def',
      'content-dependencies/0/materials/a.mtr',
    ])
    await expect(origin.open('')).rejects.toThrow(/names nothing/)
  })
  it('opens the mod only when a codec first asks, once, and lists a layer folder', async () => {
    const openModContext = vi.fn(async (request: ModContextRequest) => context(request))
    const listed: string[] = []
    const diagnostics: unknown[] = []
    const origin = createContentAssetOrigin({
      contentSources: sources({
        openModContext,
        async list(sourceId, path) {
          listed.push(`${sourceId}:${path}`)
          return path === 'Mods/Core/tileset'
            ? [
                {
                  path: 'Mods/Core/tileset/jungle.cv5',
                  name: 'jungle.cv5',
                  directory: false,
                  size: 4,
                },
              ]
            : []
        },
      }),
      target: 'C:/Maps/Lost Temple.scm',
      baseMods: { '*': ['Mods/Void'] },
      onDiagnostic: item => diagnostics.push(item),
    })
    expect(origin.scopes).toEqual(['workspace-dependency-layer'])
    expect(openModContext).not.toHaveBeenCalled()
    const found: string[] = []
    for (const prefix of ['tileset/', 'tileset/j'])
      for await (const entry of origin.enumerate('workspace-dependency-layer', { prefix }))
        found.push(entry.logicalId)
    expect(found).toEqual(['tileset/jungle.cv5', 'tileset/jungle.cv5'])
    // a folder prefix lists that folder, not its parent
    expect(listed).toEqual(['casc:Mods/Core/tileset', 'casc:Mods/Core/tileset'])
    expect(openModContext).toHaveBeenCalledOnce()
    expect(openModContext.mock.calls[0]?.[0]).toEqual({
      schemaVersion: 1,
      target: 'C:/Maps/Lost Temple.scm',
      baseMods: ['Mods/Void'],
    })
    expect(diagnostics).toEqual([])
  })

  it('says why nothing came when the sources open no mod contexts', async () => {
    const diagnostics: unknown[] = []
    const origin = createContentAssetOrigin({
      contentSources: sources(),
      target: 'C:/Maps/Lost Temple.scm',
      onDiagnostic: item => diagnostics.push(item),
    })
    await expect(origin.open('tileset/jungle.cv5')).rejects.toThrow(/no mod layer holds/)
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'x3.host/mod-context-unavailable' }),
    ])
  })

  it('refuses repeated paging cursors and cancels before reading a page', async () => {
    const files = vi.fn(async () => ({ items: [], nextCursor: 'repeat' }))
    const origin = createContentAssetOrigin({
      contentSources: sources({
        async openModContext(request) {
          return context(request)
        },
        files,
      }),
      target: 'C:/Games/monster.md5mesh',
    })
    const collect = async (signal?: AbortSignal) => {
      for await (const _entry of origin.enumerate(
        'workspace-dependency-layer',
        { prefix: '' },
        signal,
      )) {
        // Exhaust the bounded namespace.
      }
    }
    await expect(collect()).rejects.toThrow('repeated a cursor')
    expect(files).toHaveBeenCalledTimes(2)
    const controller = new AbortController()
    controller.abort()
    await expect(collect(controller.signal)).rejects.toThrow()
    expect(files).toHaveBeenCalledTimes(2)
  })
})
