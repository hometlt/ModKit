import { describe, expect, it } from 'vitest'
import type { ContentDependencyResolution, ContentSources } from '@modkit/vfs/content-sources'
import { createContentDependencyLanguageDocumentSource } from '../src/content-dependencies.js'

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

describe('content dependency language documents', () => {
  it('accepts provider-canonical casing beneath a case-insensitive dependency mount', async () => {
    const sources: ContentSources = {
      ...contentSources(),
      async list() {
        return [
          {
            path: 'mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml',
            name: 'unitdata.xml',
            directory: false,
            size: 10,
          },
        ]
      },
      async read() {
        return encoder.encode('<Catalog/>')
      },
    }
    const language = createContentDependencyLanguageDocumentSource({
      contentSources: sources,
      resolution: {
        schemaVersion: 1,
        gameId: 'blizzard/starcraft-2',
        complete: true,
        mounts: [
          {
            dependencyId: 'core',
            order: 0,
            sourceId: 'casc',
            sourcePath: 'Mods/Core.SC2Mod',
            displayName: 'Core.SC2Mod',
            kind: 'installation-mod',
            fingerprint: 'provider-token:core',
          },
        ],
        dependencies: [],
        diagnostics: [],
      },
      routes: [{ languageId: 'sc2-data', extension: 'xml' }],
    })
    const request = {
      document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '' },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 10,
      signal: new AbortController().signal,
    }
    const result = await language.snapshot(request)
    expect(result.documents).toHaveLength(1)
    expect(result.workspaceContext?.documentOrigins[0]?.logicalId).toBe(
      'base.sc2data/gamedata/unitdata.xml',
    )
  })

  it('projects packed or loose content sources into bounded language dependency documents', async () => {
    const sourceFiles = new Map([
      ['cache/base/Base.SC2Data/GameData/Units.xml', encoder.encode('<Base/>')],
      ['cache/base/Base.SC2Data/GameData/readme.txt', encoder.encode('ambiguous')],
      ['cache/base/Base.SC2Data/Assets/Textures/Marine.dds', new Uint8Array([1, 2, 3])],
      ['cache/override/Base.SC2Data/GameData/Units.xml', encoder.encode('<Override/>')],
    ])
    const directories = new Set([
      'cache/base',
      'cache/base/Base.SC2Data',
      'cache/base/Base.SC2Data/GameData',
      'cache/base/Base.SC2Data/Assets',
      'cache/base/Base.SC2Data/Assets/Textures',
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
    const request = {
      document: {
        uri: 'file:///active.xml',
        languageId: 'sc2-data',
        version: 7,
        text: '<Active/>',
      },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data', 'sc2-strings'],
      maxDocuments: 8,
      signal: new AbortController().signal,
    }
    const result = await language.snapshot(request)
    expect(result.isComplete).toBe(false)
    expect(result.workspaceContext).toMatchObject({
      semanticComplete: false,
      documentOrigins: [
        { logicalId: 'Base.SC2Data/GameData/Units.xml', precedence: 0, readOnly: true },
        { logicalId: 'Base.SC2Data/GameData/Units.xml', precedence: 1, readOnly: true },
      ],
    })
    const pathIndex = result.workspaceContext?.semanticInputs?.find(
      input => input.kind === 'content-path-index',
    )
    expect(pathIndex).toMatchObject({
      payload: {
        schemaVersion: 1,
        isComplete: true,
        paths: expect.arrayContaining(['Base.SC2Data/Assets/Textures/Marine.dds']),
      },
    })
    // Every layer's files are addressable, open or not: the closure names where each layer lives,
    // and the path index names the layer a path is read from — the strongest that lists it.
    const closure = result.workspaceContext?.semanticInputs?.find(
      input => input.kind === 'dependency-closure',
    )
    const layers = (
      closure?.payload as {
        layers: readonly { layerId: string; sourceId: string; sourcePath: string }[]
      }
    ).layers
    expect(layers.map(layer => [layer.sourceId, layer.sourcePath])).toEqual([
      ['cache', 'cache/base'],
      ['cache', 'cache/override'],
    ])
    expect(layers.map(layer => layer.layerId)).toEqual(
      result.workspaceContext?.documentOrigins.map(origin => origin.layerId),
    )
    const index = pathIndex?.payload as { paths: readonly string[]; layers: readonly number[] }
    const layerOf = (path: string) => index.layers[index.paths.indexOf(path)]
    expect(layerOf('Base.SC2Data/Assets/Textures/Marine.dds')).toBe(0)
    expect(layerOf('Base.SC2Data/GameData/Units.xml')).toBe(1)
    expect(
      result.documents.map(document => [document.uri, document.languageId, document.text]),
    ).toEqual([
      ['content-source://cache/cache/base/Base.SC2Data/GameData/Units.xml', 'sc2-data', '<Base/>'],
      [
        'content-source://cache/cache/override/Base.SC2Data/GameData/Units.xml',
        'sc2-data',
        '<Override/>',
      ],
    ])
    const repeated = await language.snapshot(request)
    const changedPath = 'cache/base/Base.SC2Data/GameData/Units.xml'
    sourceFiles.set(changedPath, encoder.encode('<Changed/>'))
    const changed = await language.snapshot(request)
    expect(changed.documents[0]?.version).toBe((result.documents[0]?.version ?? 0) + 1)
    expect(changed.documents[0]?.text).toBe('<Changed/>')
    expect(changed.workspaceContext?.documentOrigins[0]?.sourceRevision).not.toBe(
      result.workspaceContext?.documentOrigins[0]?.sourceRevision,
    )
    expect(repeated.documents[0]).toBe(result.documents[0])
  })

  it('revisions dependency fingerprints and load order and refuses completeness without fingerprints', async () => {
    const snapshot = async (value: ContentDependencyResolution) =>
      createContentDependencyLanguageDocumentSource({
        contentSources: contentSources(),
        resolution: value,
        routes: [{ languageId: 'sc2-data', extension: 'xml' }],
      }).snapshot({
        document: {
          uri: 'file:///active.xml',
          languageId: 'sc2-data',
          version: 1,
          text: '<Active/>',
        },
        workspaceDocuments: [],
        workspaceDocumentOrigins: [],
        workspaceLanguageIds: ['sc2-data'],
        maxDocuments: 8,
        signal: new AbortController().signal,
      })
    const initial = await snapshot(resolution)
    const fingerprintChanged = await snapshot({
      ...resolution,
      mounts: resolution.mounts.map(mount =>
        mount.dependencyId === 'base'
          ? { ...mount, fingerprint: 'content-hash.sha256:base-2' }
          : mount,
      ),
    })
    expect(fingerprintChanged.workspaceContext?.id).toBe(initial.workspaceContext?.id)
    expect(fingerprintChanged.workspaceContext?.revision).not.toBe(
      initial.workspaceContext?.revision,
    )

    const reordered = await snapshot({
      ...resolution,
      mounts: resolution.mounts.map(mount => ({
        ...mount,
        order: mount.order === 0 ? 1 : 0,
      })),
    })
    expect(reordered.workspaceContext?.id).not.toBe(initial.workspaceContext?.id)

    const missingFingerprint = await snapshot({
      ...resolution,
      mounts: resolution.mounts.map(({ fingerprint: _fingerprint, ...mount }) => mount),
    })
    expect(missingFingerprint.isComplete).toBe(false)
    expect(missingFingerprint.workspaceContext?.semanticComplete).toBe(false)
  })

  it("reads every layer's language files past a layer of textures, from the bulk listing", async () => {
    // a layer that is mostly textures, as Liberty is: only the workspace's language files count
    const textures = Array.from(
      { length: 40 },
      (_, at) => `cache/base/Base.SC2Assets/Textures/t${String(at)}.dds`,
    )
    const all = new Map<string, Uint8Array>([
      ...textures.map(path => [path, encoder.encode('DDS ')] as const),
      ['cache/base/Base.SC2Data/GameData/Units.xml', encoder.encode('<Base/>')],
      ['cache/override/Base.SC2Data/GameData/Units.xml', encoder.encode('<Override/>')],
    ])
    let walked = 0
    const sources: ContentSources = {
      ...contentSources(),
      async list() {
        walked += 1
        return []
      },
      async files(_sourceId, path, query) {
        const under = [...all.keys()].filter(file => file.startsWith(`${path}/`)).sort()
        const start = query.cursor === undefined ? 0 : Number(query.cursor)
        const end = Math.min(under.length, start + Math.min(query.limit, 16))
        return {
          items: under.slice(start, end).map(file => ({ path: file })),
          ...(end < under.length ? { nextCursor: String(end) } : {}),
        }
      },
      async read(_sourceId, path, maximum) {
        const bytes = all.get(path)
        if (bytes === undefined || bytes.byteLength > maximum) throw new RangeError('unavailable')
        return bytes.slice()
      },
    }
    const snapshot = (maxIndexedPaths?: number) =>
      createContentDependencyLanguageDocumentSource({
        contentSources: sources,
        resolution,
        routes: [{ languageId: 'sc2-data', extension: 'xml' }],
        maxEntries: 4,
        ...(maxIndexedPaths === undefined ? {} : { maxIndexedPaths }),
      }).snapshot({
        document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '<A/>' },
        workspaceDocuments: [],
        workspaceDocumentOrigins: [],
        workspaceLanguageIds: ['sc2-data'],
        maxDocuments: 8,
        signal: new AbortController().signal,
      })
    const pathIndex = (result: Awaited<ReturnType<typeof snapshot>>) =>
      result.workspaceContext?.semanticInputs?.find(input => input.kind === 'content-path-index')
        ?.payload as { readonly isComplete: boolean; readonly paths: readonly string[] }
    const full = await snapshot()
    expect(full.documents.map(document => document.text)).toEqual(['<Base/>', '<Override/>'])
    expect(full.isComplete).toBe(true)
    expect(walked).toBe(0)
    expect(pathIndex(full)).toMatchObject({ isComplete: true })
    expect(pathIndex(full).paths).toHaveLength(41)
    // past the path index's own bound, the index and the snapshot say they are incomplete
    const capped = await snapshot(10)
    expect(capped.isComplete).toBe(false)
    expect(pathIndex(capped).isComplete).toBe(false)
  })
})
