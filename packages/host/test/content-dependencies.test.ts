import { describe, expect, it } from 'vitest'
import type { ContentDependencyResolution, ContentSources } from '@modkit/vfs/content-sources'
import { createContentDependencyLanguageDocumentSource } from '../src/content-dependencies.js'
import { languageDocumentTextToken, languageWorkspaceContextToken } from '../src/language/context.js'

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

/** The same closure as mounts whose content no provider fingerprint names (folders on disk). */
const withoutFingerprints = (value: ContentDependencyResolution): ContentDependencyResolution => ({
  ...value,
  mounts: value.mounts.map(({ fingerprint: _fingerprint, ...mount }) => mount),
})

describe('content dependency language documents', () => {
  it('names a fingerprinted capture by its place instead of hashing its text, and hashes the rest', async () => {
    const request = {
      document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '' },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 10,
      signal: new AbortController().signal,
    }
    const routes = [{ languageId: 'sc2-data', extension: 'xml' }]
    // A listing with the folders between a mount and its files.
    const nested: ContentSources = {
      ...contentSources(),
      async list(_sourceId, path) {
        const prefix = `${path}/`
        const children = new Map<string, { path: string; name: string; directory: boolean; size?: number }>()
        for (const [file, bytes] of files) {
          if (!file.startsWith(prefix)) continue
          const [head, ...rest] = file.slice(prefix.length).split('/')
          const child = `${prefix}${head}`
          children.set(child, rest.length === 0
            ? { path: child, name: head!, directory: false, size: bytes.byteLength }
            : { path: child, name: head!, directory: true })
        }
        return [...children.values()]
      },
    }
    const fingerprinted = await createContentDependencyLanguageDocumentSource({
      contentSources: nested, resolution, routes,
    }).snapshot(request)
    expect(fingerprinted.documents.length).toBeGreaterThan(0)
    for (const document of fingerprinted.documents) {
      const path = document.uri.slice('content-source://cache/'.length)
      const mount = resolution.mounts.find(item => path.startsWith(`${item.sourcePath}/`))!
      expect(languageDocumentTextToken(document)).toBe(
        languageWorkspaceContextToken({ contentIdentity: JSON.stringify(['cache', mount.fingerprint, path]) }),
      )
    }
    const plain = await createContentDependencyLanguageDocumentSource({
      contentSources: nested, resolution: withoutFingerprints(resolution), routes,
    }).snapshot(request)
    expect(plain.documents.length).toBe(fingerprinted.documents.length)
    for (const document of plain.documents) {
      expect(languageDocumentTextToken(document)).toBe(languageWorkspaceContextToken(document.text))
    }
  })

  it('admits an edited open dependency by mount identity without reading its disk copy', async () => {
    const source = createContentDependencyLanguageDocumentSource({
      contentSources: {
        ...contentSources(),
        async list() {
          return [{ path: 'cache/base/units.xml', name: 'units.xml', directory: false }]
        },
        async read() {
          throw new Error('an open overlay must not be read from storage')
        },
      },
      resolution: { ...resolution, mounts: resolution.mounts.slice(0, 1) },
      routes: [{ languageId: 'sc2-data', extension: 'xml' }],
    })
    const open = {
      uri: 'content-source://cache/cache/base/units.xml',
      languageId: 'sc2-data',
      version: 2,
      text: '<Edited/>',
    }
    const foreign = { ...open, uri: 'content-source://cache/cache/other/units.xml' }
    const snapshot = await source.snapshot({
      document: open,
      workspaceDocuments: [open, foreign],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 0,
      signal: new AbortController().signal,
    })
    expect(snapshot.isComplete).toBe(true)
    expect(snapshot.scopeWorkspaceDocuments).toBe(true)
    expect(snapshot.documents).toEqual([])
    expect(snapshot.workspaceContext?.documentOrigins).toEqual([
      expect.objectContaining({
        uri: open.uri,
        logicalId: 'units.xml',
        precedence: 0,
        readOnly: true,
      }),
    ])
    const changed = await source.snapshot({
      document: { ...open, text: '<Changed/>' },
      workspaceDocuments: [foreign],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 0,
      signal: new AbortController().signal,
    })
    expect(changed.workspaceContext?.documentOrigins[0]?.sourceRevision).not.toBe(
      snapshot.workspaceContext?.documentOrigins[0]?.sourceRevision,
    )
  })

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
    // A fingerprint names the layers' bytes: a repeated snapshot answers with the same captures.
    const repeated = await language.snapshot(request)
    expect(repeated.documents[0]).toBe(result.documents[0])
    // Without one, every snapshot reads the bytes again and versions the document that changed.
    const unfingerprinted = createContentDependencyLanguageDocumentSource({
      contentSources: sources,
      resolution: withoutFingerprints(resolution),
      routes: [
        { languageId: 'sc2-data', extension: 'xml' },
        { languageId: 'plain-text', extension: 'txt' },
        { languageId: 'sc2-strings', extension: 'txt' },
      ],
    })
    const before = await unfingerprinted.snapshot(request)
    const changedPath = 'cache/base/Base.SC2Data/GameData/Units.xml'
    sourceFiles.set(changedPath, encoder.encode('<Changed/>'))
    const changed = await unfingerprinted.snapshot(request)
    expect(changed.documents[0]?.version).toBe((before.documents[0]?.version ?? 0) + 1)
    expect(changed.documents[0]?.text).toBe('<Changed/>')
    expect(changed.workspaceContext?.documentOrigins[0]?.sourceRevision).not.toBe(
      before.workspaceContext?.documentOrigins[0]?.sourceRevision,
    )
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

  it('lists and reads a fingerprinted layer once, and keeps no listing that failed', async () => {
    const paths = new Map([
      ['cache/base/a.dds', encoder.encode('texture')],
      ['cache/base/units.xml', encoder.encode('<Unit/>')],
      ['cache/base/api.json', encoder.encode('{}')],
      ['cache/override/b.dds', encoder.encode('texture')],
    ])
    let failing = true
    let listings = 0
    let reads = 0
    const source = createContentDependencyLanguageDocumentSource({
      contentSources: {
        ...contentSources(),
        async list(_sourceId, path) {
          listings += 1
          if (failing && path === 'cache/override')
            throw new Error('source temporarily unavailable')
          return [...paths.keys()]
            .filter(file => file.startsWith(`${path}/`))
            .map(file => ({
              path: file,
              name: file.slice(file.lastIndexOf('/') + 1),
              directory: false,
            }))
        },
        async read(_sourceId, path) {
          reads += 1
          return paths.get(path)!.slice()
        },
      },
      resolution,
      routes: [{ languageId: 'sc2-data', extension: 'xml' }],
    })
    const request = {
      document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '' },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      knowledgeFileNames: ['api.json'],
      maxDocuments: 8,
      signal: new AbortController().signal,
    }
    const indexOf = (result: Awaited<ReturnType<typeof source.snapshot>>) =>
      result.workspaceContext?.semanticInputs?.find(input => input.kind === 'content-path-index')!
    const knowledgeOf = (result: Awaited<ReturnType<typeof source.snapshot>>) =>
      result.workspaceContext?.semanticInputs?.filter(input => input.kind === 'language-knowledge')
    // The override layer fails to list: only the base layer's listing is kept.
    const partial = await source.snapshot(request)
    expect(partial.isComplete).toBe(false)
    expect(listings).toBe(2)
    failing = false
    const first = await source.snapshot(request)
    expect(first.isComplete).toBe(true)
    expect(listings).toBe(3)
    expect(reads).toBe(3)
    expect(indexOf(first).payload).toMatchObject({
      paths: ['a.dds', 'api.json', 'b.dds', 'units.xml'],
    })
    // Both listings are kept now; the document capture and the knowledge file answer unread.
    const repeated = await source.snapshot(request)
    expect(listings).toBe(3)
    expect(reads).toBe(4)
    expect(repeated.documents).toEqual(first.documents)
    expect(repeated.documents[0]).toBe(first.documents[0])
    expect(repeated.workspaceContext?.documentOrigins).toEqual(
      first.workspaceContext?.documentOrigins,
    )
    expect(indexOf(repeated)).toBe(indexOf(first))
    expect(knowledgeOf(repeated)).toEqual(knowledgeOf(first))
    expect(knowledgeOf(repeated)).toHaveLength(1)
  })

  it('reuses only a revalidated path capture and refreshes changed owners, failures and document bytes', async () => {
    const paths = new Map([
      ['cache/base/a.dds', encoder.encode('texture')],
      ['cache/base/units.xml', encoder.encode('<Unit/>')],
    ])
    let listingFailed = false
    let listings = 0
    let reads = 0
    // Folders on disk: no fingerprint names their content, so every snapshot lists and reads them.
    const source = createContentDependencyLanguageDocumentSource({
      contentSources: {
        ...contentSources(),
        async list(_sourceId, path) {
          listings += 1
          if (listingFailed) throw new Error('source temporarily unavailable')
          return [...paths.keys()]
            .filter(file => file.startsWith(`${path}/`))
            .map(file => ({
              path: file,
              name: file.slice(file.lastIndexOf('/') + 1),
              directory: false,
            }))
        },
        async read(_sourceId, path) {
          reads += 1
          return paths.get(path)!.slice()
        },
      },
      resolution: withoutFingerprints(resolution),
      routes: [{ languageId: 'sc2-data', extension: 'xml' }],
    })
    const request = {
      document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '' },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 8,
      signal: new AbortController().signal,
    }
    const indexOf = (result: Awaited<ReturnType<typeof source.snapshot>>) =>
      result.workspaceContext?.semanticInputs?.find(input => input.kind === 'content-path-index')!
    const first = await source.snapshot(request)
    const repeated = await source.snapshot(request)
    expect(indexOf(repeated)).toBe(indexOf(first))
    expect(listings).toBe(4)
    expect(reads).toBe(2)
    paths.set('cache/base/units.xml', encoder.encode('<Changed/>'))
    const changedDocument = await source.snapshot(request)
    expect(changedDocument.documents[0]?.text).toBe('<Changed/>')
    expect(changedDocument.documents[0]?.version).toBe(2)
    expect(indexOf(changedDocument)).toBe(indexOf(first))
    paths.set('cache/override/a.dds', encoder.encode('stronger texture'))
    const changedOwner = await source.snapshot(request)
    expect(indexOf(changedOwner).revision).not.toBe(indexOf(first).revision)
    expect(indexOf(changedOwner).payload).toMatchObject({
      paths: ['a.dds', 'units.xml'],
      layers: [1, 0],
    })
    paths.set('cache/base/b.dds', encoder.encode('new texture'))
    const addedPath = await source.snapshot(request)
    expect(indexOf(addedPath).payload).toMatchObject({ paths: ['a.dds', 'b.dds', 'units.xml'] })
    listingFailed = true
    const unavailable = await source.snapshot(request)
    expect(unavailable.isComplete).toBe(false)
    expect(indexOf(unavailable).payload).toMatchObject({ isComplete: false, paths: [] })
    listingFailed = false
    const recovered = await source.snapshot(request)
    // Unfingerprinted layers never make the snapshot complete; the path index is complete again.
    expect(indexOf(recovered).payload).toMatchObject({ isComplete: true })
    expect(indexOf(recovered).revision).toBe(indexOf(addedPath).revision)
    paths.delete('cache/base/b.dds')
    expect(indexOf(await source.snapshot(request)).revision).toBe(indexOf(changedOwner).revision)
  })

  it('does not retain an index beyond its allowance or trim its returned paths', async () => {
    const paths = Array.from({ length: 100 }, (_, index) => `cache/base/${index}.dds`)
    const source = createContentDependencyLanguageDocumentSource({
      contentSources: {
        ...contentSources(),
        async list(_sourceId, path) {
          return paths
            .filter(file => file.startsWith(`${path}/`))
            .map(file => ({
              path: file,
              name: file.slice(file.lastIndexOf('/') + 1),
              directory: false,
            }))
        },
      },
      resolution,
      routes: [{ languageId: 'sc2-data', extension: 'xml' }],
      maxDocumentBytes: 16,
      maxWorkspaceBytes: 16,
    })
    const request = {
      document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '' },
      workspaceDocuments: [],
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      maxDocuments: 8,
      signal: new AbortController().signal,
    }
    const indexOf = (result: Awaited<ReturnType<typeof source.snapshot>>) =>
      result.workspaceContext?.semanticInputs?.find(input => input.kind === 'content-path-index')!
    const first = await source.snapshot(request)
    const repeated = await source.snapshot(request)
    expect(first.isComplete).toBe(true)
    expect((indexOf(first).payload as { paths: readonly string[] }).paths).toHaveLength(100)
    expect(indexOf(repeated)).toEqual(indexOf(first))
    expect(indexOf(repeated)).not.toBe(indexOf(first))
  })

  it('answers a replay over the kept path index as a full replay does, open documents included', async () => {
    const paths = new Map([
      ['cache/base/units.xml', encoder.encode('<Units/>')],
      ['cache/base/effects.xml', encoder.encode('<Effects/>')],
      ['cache/base/Textures/a.dds', encoder.encode('texture')],
      ['cache/base/api.json', encoder.encode('{}')],
      ['cache/override/units.xml', encoder.encode('<Override/>')],
      ['cache/override/Textures/b.dds', encoder.encode('texture')],
    ])
    let reads = 0
    const source = createContentDependencyLanguageDocumentSource({
      contentSources: {
        ...contentSources(),
        async list(_sourceId, path) {
          const prefix = `${path}/`
          return [...paths.keys()].flatMap(file => {
            if (!file.startsWith(prefix)) return []
            const tail = file.slice(prefix.length)
            const slash = tail.indexOf('/')
            return slash < 0
              ? [{ path: file, name: tail, directory: false }]
              : [{ path: `${path}/${tail.slice(0, slash)}`, name: tail.slice(0, slash), directory: true }]
          }).filter((entry, at, all) => all.findIndex(other => other.path === entry.path) === at)
        },
        async read(_sourceId, path) {
          // the knowledge file is read on every snapshot, as before; count the documents
          if (path.endsWith('.xml')) reads += 1
          return paths.get(path)!.slice()
        },
      },
      resolution,
      routes: [{ languageId: 'sc2-data', extension: 'xml' }],
    })
    const open = { uri: 'content-source://cache/cache/base/effects.xml', languageId: 'sc2-data', version: 3, text: '<Edited/>' }
    const request = (documents: readonly (typeof open)[]) => ({
      document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '' },
      workspaceDocuments: documents,
      workspaceDocumentOrigins: [],
      workspaceLanguageIds: ['sc2-data'],
      knowledgeFileNames: ['api.json'],
      maxDocuments: 8,
      signal: new AbortController().signal,
    })
    const view = (result: Awaited<ReturnType<typeof source.snapshot>>) => ({
      complete: result.isComplete,
      documents: result.documents.map(document => [document.uri, document.text]),
      origins: result.workspaceContext?.documentOrigins,
      inputs: result.workspaceContext?.semanticInputs,
    })
    // Listed live, then the first replay of both kept listings, then replays over the kept index.
    const live = view(await source.snapshot(request([open])))
    const plain = view(await source.snapshot(request([])))
    expect(view(await source.snapshot(request([])))).toEqual(plain)
    const readsBefore = reads
    expect(view(await source.snapshot(request([open])))).toEqual(live)
    expect(view(await source.snapshot(request([])))).toEqual(plain)
    // The open document is not read; the plain snapshots' captures answer unread.
    expect(reads).toBe(readsBefore)
    expect(live.documents.map(([uri]) => uri)).not.toContain(open.uri)
    expect(live.origins?.find(origin => origin.uri === open.uri)?.logicalId).toBe('effects.xml')
  })

  it('keeps the captures a snapshot took when not all fit, and counts an ASCII text at its real size', async () => {
    // Ten documents of one fingerprinted layer; the allowance beside the kept listing, the path
    // index and its map (8112 - 3400 - 932 - 480 bytes) holds five two-byte texts, or all ten ASCII.
    const rereads = async (letter: string) => {
      const paths = new Map(
        [...'abcdefghij'].map(name => [
          `cache/base/${name}.xml`,
          encoder.encode(`<${name}>${letter.repeat(300)}</${name}>`),
        ]),
      )
      let reads = 0
      const source = createContentDependencyLanguageDocumentSource({
        contentSources: {
          ...contentSources(),
          async list(_sourceId, path) {
            return [...paths.keys()]
              .filter(file => file.startsWith(`${path}/`))
              .map(file => ({
                path: file,
                name: file.slice(file.lastIndexOf('/') + 1),
                directory: false,
              }))
          },
          async read(_sourceId, path) {
            reads += 1
            return paths.get(path)!.slice()
          },
        },
        resolution: { ...resolution, mounts: [resolution.mounts[0]!] },
        routes: [{ languageId: 'sc2-data', extension: 'xml' }],
        maxDocumentBytes: 1024,
        maxWorkspaceBytes: 8112,
      })
      const request = {
        document: { uri: 'file:///active.xml', languageId: 'sc2-data', version: 1, text: '' },
        workspaceDocuments: [],
        workspaceDocumentOrigins: [],
        workspaceLanguageIds: ['sc2-data'],
        maxDocuments: 16,
        signal: new AbortController().signal,
      }
      const first = await source.snapshot(request)
      expect(first.documents).toHaveLength(10)
      expect(reads).toBe(10)
      const repeated = await source.snapshot(request)
      expect(repeated.documents.map(document => document.text)).toEqual(
        first.documents.map(document => document.text),
      )
      return reads - 10
    }
    // Evicting the oldest capture for a newer one would reread all ten, each in turn.
    expect(await rereads('é')).toBe(5)
    expect(await rereads('e')).toBe(0)
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
