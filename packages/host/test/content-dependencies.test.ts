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
    const result = await language.snapshot({
      document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '' },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 10,
      signal: new AbortController().signal,
    })
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
    const result = await language.snapshot({
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
    })
    expect(result.isComplete).toBe(false)
    expect(result.workspaceContext).toMatchObject({
      semanticComplete: false,
      documentOrigins: [
        { logicalId: 'Base.SC2Data/GameData/Units.xml', precedence: 0, readOnly: true },
        { logicalId: 'Base.SC2Data/GameData/Units.xml', precedence: 1, readOnly: true },
      ],
    })
    expect(
      result.workspaceContext?.semanticInputs?.find(input => input.kind === 'content-path-index'),
    ).toMatchObject({
      payload: {
        schemaVersion: 1,
        isComplete: true,
        paths: expect.arrayContaining(['Base.SC2Data/Assets/Textures/Marine.dds']),
      },
    })
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
})
