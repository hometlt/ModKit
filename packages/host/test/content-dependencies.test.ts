import { describe, expect, it } from 'vitest'
import type { ContentDependencyResolution, ContentSources } from '@modkit/vfs/content-sources'
import {
  analyzeReadOnlyContentDependencies,
  createContentDependencyLanguageDocumentSource,
  createReadOnlyContentDependencyWorkspace,
} from '../src/content-dependencies.js'

const encoder = new TextEncoder()
const files = new Map([
  ['cache/base/Base.SC2Data/GameData/Units.xml', encoder.encode('<Base/>')],
  ['cache/base/Base.SC2Data/GameData/Effects.xml', encoder.encode('<Effect/>')],
  ['cache/override/Base.SC2Data/GameData/Units.xml', encoder.encode('<Override/>')],
])

function contentSources(): ContentSources {
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
    {
      dependencyId: 'base',
      order: 0,
      sourceId: 'cache',
      sourcePath: 'cache/base',
      displayName: 'Base',
      kind: 'content-archive',
      fingerprint: 'content-hash.sha256:base',
    },
    {
      dependencyId: 'override',
      order: 1,
      sourceId: 'cache',
      sourcePath: 'cache/override',
      displayName: 'Override',
      kind: 'content-archive',
      fingerprint: 'content-hash.sha256:override',
    },
  ],
  dependencies: [],
  diagnostics: [],
}

describe('read-only content dependency workspace', () => {
  it('projects packed or loose content sources into bounded language dependency documents', async () => {
    const sourceFiles = new Map([
      ['cache/base/Base.SC2Data/GameData/Units.xml', encoder.encode('<Base/>')],
      ['cache/base/Base.SC2Data/GameData/readme.txt', encoder.encode('ambiguous')],
      ['cache/override/Base.SC2Data/GameData/Units.xml', encoder.encode('<Override/>')],
    ])
    const directories = new Set([
      'cache/base',
      'cache/base/Base.SC2Data',
      'cache/base/Base.SC2Data/GameData',
      'cache/override',
      'cache/override/Base.SC2Data',
      'cache/override/Base.SC2Data/GameData',
    ])
    const sources: ContentSources = {
      ...contentSources(),
      async list(_sourceId, path) {
        const prefix = `${path}/`
        const children = new Map<string, { path: string; directory: boolean; size?: number }>()
        for (const directory of directories) {
          if (!directory.startsWith(prefix)) continue
          const tail = directory.slice(prefix.length)
          if (tail !== '' && !tail.includes('/'))
            children.set(directory, { path: directory, directory: true })
        }
        for (const [file, bytes] of sourceFiles) {
          if (!file.startsWith(prefix)) continue
          const tail = file.slice(prefix.length)
          if (!tail.includes('/'))
            children.set(file, { path: file, directory: false, size: bytes.byteLength })
        }
        return [...children.values()].map(entry => ({
          ...entry,
          name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
        }))
      },
      async read(_sourceId, path, maximum) {
        const bytes = sourceFiles.get(path)
        if (bytes === undefined || bytes.byteLength > maximum) throw new RangeError('unavailable')
        return bytes.slice()
      },
    }
    const language = createContentDependencyLanguageDocumentSource({
      contentSources: sources,
      resolution,
      routes: [
        { languageId: 'sc2-data', extension: 'xml' },
        { languageId: 'plain-text', extension: 'txt' },
        { languageId: 'sc2-strings', extension: 'txt' },
      ],
    })
    const result = await language.snapshot({
      document: {
        uri: 'file:///active.xml',
        languageId: 'sc2-data',
        version: 7,
        text: '<Active/>',
      },
      workspaceDocuments: [],
      workspaceLanguageIds: ['sc2-data', 'sc2-strings'],
      maxDocuments: 8,
      signal: new AbortController().signal,
    })
    expect(result.isComplete).toBe(false)
    expect(
      result.documents.map(document => [document.uri, document.languageId, document.text]),
    ).toEqual([
      [
        'content-source://cache/content-dependencies/0/Base.SC2Data/GameData/Units.xml',
        'sc2-data',
        '<Base/>',
      ],
      [
        'content-source://cache/content-dependencies/1/Base.SC2Data/GameData/Units.xml',
        'sc2-data',
        '<Override/>',
      ],
    ])
  })

  it('preserves semantic load order and resolves files through overlay precedence', async () => {
    const prepared = createReadOnlyContentDependencyWorkspace({
      contentSources: contentSources(),
      resolution,
      workspaceId: 'replay:test',
    })
    try {
      expect(prepared.workspace.loadOrder.map(root => root.displayName)).toEqual([
        'Base',
        'Override',
      ])
      expect(prepared.workspace.logicalRoots?.map(root => root.displayName)).toEqual([
        'Override',
        'Base',
      ])
      expect(prepared.workspace.activeRootId).toBe('content-dependency:override')
      expect(prepared.workspace.loadOrder.map(root => root.sourcePath)).toEqual([
        'content-dependencies/0',
        'content-dependencies/1',
      ])
      expect(JSON.stringify(prepared.workspace)).not.toContain('cache/base')
      const units = await prepared.resources.resolve({
        id: 'units',
        logicalId: 'content-dependencies/1/Base.SC2Data/GameData/Units.xml',
        role: 'buffer',
        scopes: ['workspace-dependency-layer'],
      })
      expect(units.state).toBe('resolved')
      if (units.state === 'resolved' && units.lease.value.kind === 'bytes') {
        expect(new TextDecoder().decode(await units.lease.value.read(0n, 64))).toBe('<Override/>')
        await units.lease.release()
      }
      const effects = await prepared.resources.resolve({
        id: 'effects',
        logicalId: 'content-dependencies/0/Base.SC2Data/GameData/Effects.xml',
        role: 'buffer',
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
      contentSources: contentSources(),
      resolution,
      workspaceId: 'replay:test',
    })
    try {
      const result = await prepared.resources.resolve({
        id: 'missing',
        logicalId: 'content-dependencies/1/Base.SC2Data/GameData/Missing.xml',
        role: 'buffer',
        scopes: ['workspace-dependency-layer'],
      })
      expect(result).toMatchObject({ state: 'unresolved', reason: 'not-found' })
    } finally {
      await prepared.dispose()
    }
  })

  it('returns a typed outcome when dependency resolution is unavailable or incomplete', async () => {
    const common = {
      services: {} as never,
      grant: {} as never,
      budgets: {} as never,
      dependencies: {
        schemaVersion: 1 as const,
        gameId: 'example/game',
        complete: true,
        dependencies: [],
      },
      workspaceId: 'replay:test',
      locales: ['enUS'],
      queries: [],
      limits: {
        maxRequirements: 1,
        maxDocumentBytes: 1,
        maxTextBytes: 1,
        maxEntities: 1,
        maxDepth: 1,
        maxPageSize: 1,
      },
    }
    await expect(
      analyzeReadOnlyContentDependencies({
        ...common,
        contentSources: contentSources(),
      }),
    ).resolves.toMatchObject({
      state: 'unresolved',
      diagnostics: [
        {
          code: 'x3.host/content-dependency-resolver-unavailable',
        },
      ],
    })
    await expect(
      analyzeReadOnlyContentDependencies({
        ...common,
        contentSources: {
          ...contentSources(),
          async resolveDependencies() {
            return {
              ...resolution,
              complete: false,
              mounts: [],
              diagnostics: [
                {
                  severity: 'error',
                  code: 'example/missing',
                  message: 'missing dependency',
                },
              ],
            }
          },
        },
      }),
    ).resolves.toMatchObject({ state: 'unresolved', diagnostics: [{ code: 'example/missing' }] })
  })
})
