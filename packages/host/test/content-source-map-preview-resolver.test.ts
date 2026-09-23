import { describe, expect, it, vi } from 'vitest'
import { CONTAINER_EXTRACT_OPERATION_ID } from '@modkit/core'
import {
  resolveModWorkspaceGraph,
  revisionId,
  type JsonValue,
  type OperationOutput,
} from '@modkit/sdk'
import type { ContentSourceEntry, ContentSources } from '@modkit/vfs/content-sources'
import { assembleSubjectDescriptor, createAssetSession } from '../src/index.js'
import type {
  MapPreviewResourcePlanResolver,
  ResolveMapPreviewResourcePlanRequest,
} from '../src/maps/index.js'
import { createContentSourceMapPreviewResourcePlanResolver } from '../src/node/content-source-map-preview-resolver.js'
import { resolvedDescriptorWire } from './fixtures/descriptor.js'

const GAME_ID = 'example/game'
const bytes = (text: string) => new TextEncoder().encode(text)
const DEPENDENCIES = { schemaVersion: 1, gameId: GAME_ID, complete: true, dependencies: [] }

/** An opened map: its own namespace, extraction, and (optionally) the dependency operation. */
async function mapSession(files: ReadonlyMap<string, Uint8Array>, dependencies = true) {
  const namespaceRelease = vi.fn(async () => undefined)
  const paths = [...files.keys()].sort()
  const namespace = Object.freeze({
    async list(prefix: string, page: { readonly cursor?: string; readonly limit: number }) {
      const matching = paths.filter(path => path.toLowerCase().startsWith(prefix.toLowerCase()))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      return Object.freeze({
        items: matching.slice(start, start + page.limit).map(path => Object.freeze({
          id: path, path, name: path.split('/').at(-1)!, kind: 'file' as const,
          size: BigInt(files.get(path)!.byteLength), revision: revisionId(`provider-token:${encodeURIComponent(`map-${path}`)}`),
        })),
        ...(start + page.limit < matching.length ? { nextCursor: String(start + page.limit) } : {}),
      })
    },
    async openEntry(entryId: string) {
      return { value: Object.freeze({ id: entryId, uri: `memory://map/${entryId}` }), release: async () => undefined }
    },
  })
  const operations = [
    { id: CONTAINER_EXTRACT_OPERATION_ID, handlerId: 'extract', state: 'available' as const, mutatesSource: false },
    ...(dependencies
      ? [{ id: 'content.resolve-dependencies', handlerId: 'resolve-dependencies', state: 'available' as const, mutatesSource: false }]
      : []),
  ]
  const wire = resolvedDescriptorWire(operations)
  const descriptor = await assembleSubjectDescriptor({
    ...wire,
    subjectUri: 'memory://maps/demo.map',
    revision: revisionId('provider-token:demo-map'),
    dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
  })
  const handlers = new Map<string, (input: JsonValue) => Promise<OperationOutput>>([
    ['extract', async input => ({ kind: 'bytes', value: files.get((input as { entryId: string }).entryId)! })],
    ['resolve-dependencies', async () => ({ kind: 'json', value: { contentDependencies: DEPENDENCIES } })],
  ])
  const managed = createAssetSession({
    revision: descriptor.revision,
    descriptor,
    operationDeclarations: operations.map(operation => ({ ...operation, outputKinds: ['json', 'bytes'] })),
    permissionGrant: { id: 'fixture-session', classes: [] },
    handlers,
    async openDataSource() {
      return { value: namespace, release: namespaceRelease } as never
    },
    release: [],
  })
  return { session: managed.session, namespaceRelease }
}

/** A catalogue with a CASC-like and a folder-like source, each a tree of immediate children. */
function contentSources(trees: Readonly<Record<string, Readonly<Record<string, string>>>>) {
  const resolveDependencies = vi.fn(async () => ({
    schemaVersion: 1 as const, gameId: GAME_ID, complete: true,
    // Dependency first, as the provider numbers them; `Mods/Extra.Pkg` is found beneath `mp`.
    mounts: [
      { dependencyId: 'installation:mods/base.pkg', order: 0, sourceId: 'casc', sourcePath: 'Mods/Base.Pkg', displayName: 'Base.Pkg', kind: 'installation-mod' },
      { dependencyId: 'installation:mods/extra.pkg', order: 1, sourceId: 'disk', sourcePath: 'Mods/Extra.Pkg', displayName: 'Extra.Pkg', kind: 'installation-mod' },
      { dependencyId: 'installation:mods/mp.pkg', order: 2, sourceId: 'disk', sourcePath: 'Mods/MP.Pkg', displayName: 'MP.Pkg', kind: 'installation-mod' },
    ],
    dependencies: [], diagnostics: [],
  }))
  const list = async (sourceId: string, path: string): Promise<readonly ContentSourceEntry[]> => {
    const files = Object.keys(trees[sourceId] ?? {})
    const prefix = path === '' ? '' : `${path.toLowerCase()}/`
    const children = new Map<string, ContentSourceEntry>()
    for (const file of files.filter(item => item.toLowerCase().startsWith(prefix))) {
      const tail = file.slice(prefix.length), slash = tail.indexOf('/')
      const name = slash === -1 ? tail : tail.slice(0, slash)
      children.set(name, { path: path === '' ? name : `${path}/${name}`, name, directory: slash !== -1 })
    }
    if (path !== '' && children.size === 0) throw new Error(`${sourceId} has no ${path}`)
    return [...children.values()]
  }
  const read = vi.fn(async (sourceId: string, path: string) => {
    const text = Object.entries(trees[sourceId] ?? {}).find(([file]) => file.toLowerCase() === path.toLowerCase())?.[1]
    if (text === undefined) throw new Error(`${sourceId} has no ${path}`)
    return bytes(text)
  })
  return { resolveDependencies, read, sources: { resolveDependencies, list, read } as unknown as ContentSources }
}

function request(original: Awaited<ReturnType<typeof mapSession>>['session'], roots = ['mp', 'base']) {
  const workspace = resolveModWorkspaceGraph({
    workspaceId: 'fixture-preview', gameId: GAME_ID, activeRootId: 'map',
    sources: [{ sourceId: 'opened', kind: 'archive', location: 'fixture:map' }],
    roots: [
      { rootId: 'base', sourceId: 'opened', sourcePath: 'mods/base.pkg', displayName: 'Base', kind: 'package', dependencies: [] },
      { rootId: 'mp', sourceId: 'opened', sourcePath: 'mods/mp.pkg', displayName: 'MP', kind: 'package',
        dependencies: [{ targetRootId: 'base', ref: 'base', required: true, provenance: 'implicit' }] },
      { rootId: 'lost', sourceId: 'opened', sourcePath: 'mods/lost.pkg', displayName: 'Lost', kind: 'package', dependencies: [] },
      { rootId: 'map', sourceId: 'opened', sourcePath: 'opened/demo.map', displayName: 'Demo', kind: 'map',
        dependencies: roots.map(rootId => ({ targetRootId: rootId, ref: rootId, required: true, provenance: 'declared' as const })) },
    ].filter(root => root.rootId === 'map' || roots.includes(root.rootId) || root.rootId === 'base'),
    maxRoots: 4, maxDepth: 3,
  })
  return {
    plan: {
      schemaVersion: 1, strategy: 'host-resolved', resolverId: 'fixture/any',
      subjectNamespaceRoots: [{ rootId: 'map', namespacePrefix: '' }],
      roots: roots.concat(roots.includes('base') ? [] : ['base']).map(rootId => ({ rootId, locator: {} })),
    },
    subject: {
      schemaVersion: 1, subjectUri: 'memory://maps/demo.map', revision: 'provider-token:demo-map',
      formatId: 'fixture/map', traits: [], dataSources: [], operations: [], namespace: { state: 'complete', entries: [] },
    },
    workspace, original,
    services: {} as ResolveMapPreviewResourcePlanRequest['services'],
    grant: { id: 'fixture-resolver', classes: ['read-source'] },
    budgets: { maxInputBytes: 1n << 26n, maxDepth: 64, maxNodes: 100_000, maxScalarBytes: 1 << 24, maxDiagnostics: 100 },
  } as unknown as ResolveMapPreviewResourcePlanRequest
}

async function text(origin: Extract<Awaited<ReturnType<MapPreviewResourcePlanResolver['resolve']>>, { state: 'resolved' }>['origin'], logicalId: string) {
  const lease = await origin.open(logicalId)
  try {
    if (lease.value.kind !== 'bytes') throw new Error(`${logicalId} is not bytes`)
    return new TextDecoder().decode(await lease.value.read(0n, 1024))
  } finally { await lease.release() }
}

// The first case pays the host's cold module load, which alone nears the 5 s default under load.
describe('content-source map preview resources', { timeout: 30_000 }, () => {
  it('reads every layer through the mounts the map\'s own dependency closure resolved to', async () => {
    const original = await mapSession(new Map([['Assets/Textures/Shared.dds', bytes('map')]]))
    const catalogue = contentSources({
      casc: {
        'mods/base.pkg/assets/textures/shared.dds': 'base',
        'mods/base.pkg/assets/textures/base-only.dds': 'base-only',
        'mods/base.pkg/gamedata/units.xml': '<Catalog/>',
        'mods/base.pkg/gamedatax/other.xml': '<Other/>',
      },
      disk: {
        'Mods/MP.Pkg/Assets/Textures/Base-Only.dds': 'mp-override',
        'Mods/Extra.Pkg/Assets/Models/Extra.m3': 'extra',
      },
    })
    const resolver = createContentSourceMapPreviewResourcePlanResolver({ contentSources: async () => catalogue.sources })
    const result = await resolver.resolve(request(original.session))
    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved') throw new Error(JSON.stringify(result.diagnostics))
    expect(catalogue.resolveDependencies).toHaveBeenCalledWith(DEPENDENCIES)

    // Strongest first: the map, then MP over Base; a layer found beneath MP still serves its assets.
    expect(await text(result.origin, 'Assets/Textures/Shared.dds')).toBe('map')
    expect(await text(result.origin, 'Assets/Textures/Base-Only.dds')).toBe('mp-override')
    expect(await text(result.origin, 'Assets/Models/Extra.m3')).toBe('extra')
    // A qualified path keeps its root, so a catalog reads Base's own GameData.
    expect(await text(result.origin, 'mods/base.pkg/gamedata/units.xml')).toBe('<Catalog/>')
    expect(await text(result.origin, 'mods/base.pkg/assets/textures/shared.dds')).toBe('base')
    // A directory prefix lists that directory, not a sibling that merely shares its name.
    const listed: string[] = []
    for await (const entry of result.origin.enumerate('workspace-dependency-layer', { prefix: 'mods/base.pkg/gamedata/' })) {
      listed.push(entry.logicalId)
    }
    expect(listed).toEqual(['mods/base.pkg/gamedata/units.xml'])

    await result.release()
    await result.release()
    expect(original.namespaceRelease).toHaveBeenCalledOnce()
  })

  it('names a workspace root no source holds and keeps the rest', async () => {
    const original = await mapSession(new Map())
    const catalogue = contentSources({ casc: { 'mods/base.pkg/a.txt': 'a' }, disk: {} })
    const resolver = createContentSourceMapPreviewResourcePlanResolver({ contentSources: async () => catalogue.sources })
    const result = await resolver.resolve(request(original.session, ['lost', 'base']))
    expect(result.state).toBe('resolved')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning', code: 'x3.host/map-preview-content-dependency-unmounted',
    }))
    if (result.state === 'resolved') {
      expect(await text(result.origin, 'a.txt')).toBe('a')
      await result.release()
    }
  })

  it('leaves a subject without the dependency operation, or without a catalogue, to the fallback', async () => {
    const fallback = { resolve: vi.fn(async () => ({ state: 'unresolved' as const, diagnostics: [] })) }
    const plain = await mapSession(new Map(), false)
    const catalogue = contentSources({})
    await createContentSourceMapPreviewResourcePlanResolver({ contentSources: async () => catalogue.sources, fallback })
      .resolve(request(plain.session))
    expect(catalogue.resolveDependencies).not.toHaveBeenCalled()
    const declaring = await mapSession(new Map())
    await createContentSourceMapPreviewResourcePlanResolver({ contentSources: async () => undefined, fallback })
      .resolve(request(declaring.session))
    // Sources with no installation mount none of the layers: a bare map is worse than the fallback.
    const unconfigured = {
      resolveDependencies: async () => ({ schemaVersion: 1, gameId: GAME_ID, complete: false, mounts: [], dependencies: [], diagnostics: [] }),
    } as unknown as ContentSources
    const bare = await createContentSourceMapPreviewResourcePlanResolver({ contentSources: async () => unconfigured, fallback })
      .resolve(request((await mapSession(new Map())).session))
    expect(bare.diagnostics).toContainEqual(expect.objectContaining({ code: 'x3.host/map-preview-content-sources-empty' }))
    expect(fallback.resolve).toHaveBeenCalledTimes(3)
  })
})
