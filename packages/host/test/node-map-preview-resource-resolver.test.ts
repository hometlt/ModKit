import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTAINER_EXTRACT_OPERATION_ID } from '@modkit/core'
import {
  resolveModWorkspaceGraph,
  revisionId,
  type JsonValue,
  type OperationDecl,
  type OperationOutput,
} from '@modkit/sdk'
import type { GameInstallationDiscoveryResult } from '@modkit/sdk/games'
import type { MapPreviewResourcePlan } from '@modkit/sdk/maps'
import { assembleSubjectDescriptor, createAssetSession } from '../src/index.js'
import type { ResolveMapPreviewResourcePlanRequest } from '../src/maps/index.js'
import {
  createNodeMapPreviewResourcePlanResolver,
  NODE_GAME_INSTALLATION_ARCHIVE_MAP_PREVIEW_RESOLVER_ID,
} from '../src/node/map-preview-resource-resolver.js'
import type { SubjectServices } from '../src/subject-services.js'
import { resolvedDescriptorWire } from './fixtures/descriptor.js'

const mocks = vi.hoisted(() => ({ discover: vi.fn() }))
vi.mock('../src/games/index.js', () => ({ discoverGameInstallations: mocks.discover }))

const GAME_ID = 'example/game'
const temporaryRoots: string[] = []

afterEach(async () => {
  mocks.discover.mockReset()
  await Promise.all(
    temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

async function installationRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'modkit-preview-resolver-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'data'), { recursive: true })
  return root
}

function discovery(
  root: string,
  options: { readonly complete?: boolean; readonly secondRoot?: string } = {},
): GameInstallationDiscoveryResult {
  const installs = [root, ...(options.secondRoot === undefined ? [] : [options.secondRoot])]
  return Object.freeze({
    gameId: GAME_ID,
    complete: options.complete ?? true,
    probes: Object.freeze(
      installs.map(path =>
        Object.freeze({
          candidate: Object.freeze({
            origin: 'configured-path' as const,
            displayName: 'Fixture game',
            path,
          }),
          normalizedPath: path.replace(/\\/gu, '/'),
          confirmed: true,
          evidence: Object.freeze([Object.freeze({ kind: 'fixture-marker', path, found: true })]),
        }),
      ),
    ),
    installations: Object.freeze(
      installs.map(path =>
        Object.freeze({
          gameId: GAME_ID,
          displayName: 'Fixture game',
          installPath: path,
          normalizedPath: path.replace(/\\/gu, '/'),
          origins: Object.freeze(['configured-path'] as const),
          evidence: Object.freeze([Object.freeze({ kind: 'fixture-marker', path, found: true })]),
        }),
      ),
    ),
    diagnostics: Object.freeze([]),
  })
}

async function namespaceSession(subjectUri: string, files: ReadonlyMap<string, Uint8Array>) {
  const namespaceRelease = vi.fn(async () => undefined)
  const entryRelease = vi.fn(async () => undefined)
  const sessionRelease = vi.fn(async () => undefined)
  const paths = [...files.keys()].sort()
  const namespace = Object.freeze({
    async list(
      prefix: string,
      page: { readonly cursor?: string; readonly limit: number },
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted()
      const matching = paths.filter(path => path.toLowerCase().startsWith(prefix.toLowerCase()))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const selected = matching.slice(start, start + page.limit)
      const next = start + selected.length
      return Object.freeze({
        items: Object.freeze(
          selected.map(path =>
            Object.freeze({
              id: path,
              path,
              name: path.split('/').at(-1) ?? path,
              kind: 'file' as const,
              size: BigInt(files.get(path)?.byteLength ?? 0),
              revision: revisionId(`provider-token:${encodeURIComponent(`${subjectUri}:${path}`)}`),
            }),
          ),
        ),
        ...(next < matching.length ? { nextCursor: String(next) } : {}),
      })
    },
    openEntry(entryId: string, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (!files.has(entryId)) throw new RangeError(`unknown entry ${entryId}`)
      const uri = `${subjectUri}#${encodeURIComponent(entryId)}`
      return Promise.resolve({ value: Object.freeze({ id: uri, uri }), release: entryRelease })
    },
  })
  const wire = resolvedDescriptorWire([
    {
      id: CONTAINER_EXTRACT_OPERATION_ID,
      handlerId: 'extract',
      state: 'available',
      mutatesSource: false,
    },
  ])
  const descriptor = await assembleSubjectDescriptor({
    ...wire,
    subjectUri,
    revision: revisionId(`provider-token:${encodeURIComponent(subjectUri)}`),
    identity: { ...wire.identity, formatId: 'fixture/archive' },
    dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
  })
  const declarations: OperationDecl[] = descriptor.operations.map(operation => ({
    id: operation.id,
    handlerId: operation.handlerId,
    mutatesSource: false,
    outputKinds: ['bytes'],
  }))
  const handlers = new Map<string, (input: JsonValue) => Promise<OperationOutput>>([
    [
      'extract',
      async input => {
        const entryId =
          typeof input === 'object' && input !== null && !Array.isArray(input)
            ? (input as Readonly<Record<string, JsonValue>>)['entryId']
            : undefined
        if (typeof entryId !== 'string') throw new TypeError('entryId is required')
        const bytes = files.get(entryId)
        if (bytes === undefined) throw new RangeError(`unknown entry ${entryId}`)
        return { kind: 'bytes', value: bytes }
      },
    ],
  ])
  const managed = createAssetSession({
    revision: descriptor.revision,
    descriptor,
    operationDeclarations: declarations,
    permissionGrant: { id: 'fixture-session', classes: [] },
    handlers,
    async openDataSource(contract, major) {
      if (contract === 'common.view/namespace-entry-source' && major === 1) {
        return { value: namespace, release: namespaceRelease } as never
      }
      throw new RangeError(`no ${contract}@${String(major)}`)
    },
    release: [sessionRelease],
  })
  return { session: managed.session, namespaceRelease, entryRelease, sessionRelease }
}

/** With `high`, an add-on root between base and mp that mp depends on without requiring it. */
function workspace(high = false) {
  return resolveModWorkspaceGraph({
    workspaceId: 'fixture-preview',
    gameId: GAME_ID,
    activeRootId: 'map',
    sources: [
      { sourceId: 'base-source', kind: 'archive', location: 'fixture:base' },
      { sourceId: 'mp-source', kind: 'archive', location: 'fixture:mp' },
      { sourceId: 'map-source', kind: 'archive', location: 'fixture:map' },
    ],
    roots: [
      ...(high
        ? [
            {
              rootId: 'high',
              sourceId: 'base-source',
              sourcePath: 'terrain_overrides/high',
              displayName: 'High',
              kind: 'package',
              dependencies: [
                { targetRootId: 'base', ref: 'base', required: true, provenance: 'implicit' as const },
              ],
            },
          ]
        : []),
      {
        rootId: 'base',
        sourceId: 'base-source',
        sourcePath: 'base',
        displayName: 'Base',
        kind: 'package',
        dependencies: [],
      },
      {
        rootId: 'mp',
        sourceId: 'mp-source',
        sourcePath: 'mp',
        displayName: 'MP',
        kind: 'package',
        dependencies: [
          { targetRootId: 'base', ref: 'base', required: true, provenance: 'implicit' },
          ...(high
            ? [{ targetRootId: 'high', ref: 'high', required: false, provenance: 'implicit' as const }]
            : []),
        ],
      },
      {
        rootId: 'map',
        sourceId: 'map-source',
        sourcePath: 'multiplay/maps/demo',
        displayName: 'Demo',
        kind: 'map',
        dependencies: [{ targetRootId: 'mp', ref: 'mp', required: true, provenance: 'implicit' }],
      },
    ],
    maxRoots: high ? 4 : 3,
    maxDepth: 3,
  })
}

function locator(
  paths: readonly string[],
  openedSubjectPolicy: 'installation-only' | 'prefer-matching-opened-subject',
) {
  return {
    schemaVersion: 1,
    kind: 'game-installation-archive',
    gameId: GAME_ID,
    archiveRelativePaths: paths,
    openedSubjectPolicy,
  } as const
}

function plan(
  roots: readonly Readonly<{ rootId: string; locator: JsonValue; optional?: boolean }>[] = [
    { rootId: 'mp', locator: locator(['data/mp.wz', 'mp.wz'], 'prefer-matching-opened-subject') },
    { rootId: 'base', locator: locator(['data/base.wz', 'base.wz'], 'installation-only') },
  ],
  resolverId = NODE_GAME_INSTALLATION_ARCHIVE_MAP_PREVIEW_RESOLVER_ID,
): Extract<MapPreviewResourcePlan, { readonly strategy: 'host-resolved' }> {
  return {
    schemaVersion: 1,
    strategy: 'host-resolved',
    resolverId,
    subjectNamespaceRoots: [{ rootId: 'map', namespacePrefix: 'multiplay/maps/demo' }],
    roots,
  }
}

async function requestFixture(
  archivePlan: Extract<MapPreviewResourcePlan, { readonly strategy: 'host-resolved' }>,
  originalPath: string,
  original: Awaited<ReturnType<typeof namespaceSession>>['session'],
): Promise<ResolveMapPreviewResourcePlanRequest> {
  return {
    plan: archivePlan,
    subject: {
      schemaVersion: 1,
      subjectUri: pathToFileURL(originalPath).href,
      revision: String(original.revision),
      formatId: 'fixture/archive',
      traits: [],
      dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
      operations: [{ id: CONTAINER_EXTRACT_OPERATION_ID, state: 'available' }],
      namespace: { state: 'complete', entries: [] },
    },
    workspace: workspace(),
    original,
    services: {} as ResolveMapPreviewResourcePlanRequest['services'],
    grant: { id: 'fixture-resolver', classes: ['read-source'] },
    budgets: {
      maxInputBytes: 64n * 1024n * 1024n,
      maxDepth: 64,
      maxNodes: 100_000,
      maxScalarBytes: 16 * 1024 * 1024,
      maxDiagnostics: 100,
    },
  }
}

describe('Node game-installation map-preview resource resolver', () => {
  it('combines the opened map archive with exact installed archives and releases every lease once', async () => {
    const root = await installationRoot()
    const mpPath = join(root, 'data', 'mp.wz')
    const basePath = join(root, 'data', 'base.wz')
    await Promise.all([writeFile(mpPath, 'mp'), writeFile(basePath, 'base')])
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })

    const original = await namespaceSession(
      pathToFileURL(mpPath).href,
      new Map([['multiplay/maps/demo/game.map', new Uint8Array([1, 2, 3])]]),
    )
    const base = await namespaceSession(
      pathToFileURL(basePath).href,
      new Map([['stats/templates.json', new Uint8Array([4, 5])]]),
    )
    const open = vi.fn(async (request: Parameters<SubjectServices['open']>[0]) => {
      void request
      return { state: 'opened', session: base.session, diagnostics: [] }
    })
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open } as unknown as Pick<SubjectServices, 'open'>,
      configuredPaths: { [GAME_ID]: [root] },
      // the host's folder search reaches the provider too
      searchPaths: async gameId => (gameId === GAME_ID ? ['F:/GAMES/Warzone 2100'] : undefined),
    })
    const result = await resolver.resolve(await requestFixture(plan(), mpPath, original.session))

    expect(result.state).toBe('resolved')
    if (result.state !== 'resolved') throw new Error('fixture resource plan did not resolve')
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0]?.[0]).toMatchObject({ path: basePath, intent: 'inspect' })
    expect(mocks.discover.mock.calls[0]?.[0]).toMatchObject({
      gameId: GAME_ID,
      configuredPaths: [root],
      searchPaths: ['F:/GAMES/Warzone 2100'],
    })
    const logicalIds: string[] = []
    for await (const entry of result.origin.enumerate('workspace-dependency-layer', {
      prefix: '',
    })) {
      logicalIds.push(entry.logicalId)
    }
    // An unqualified enumeration is the game-logical overlay (8de22be0); qualified ids still open.
    expect(logicalIds).toEqual(['game.map', 'multiplay/maps/demo/game.map', 'stats/templates.json'])
    const source = await result.origin.open('base/stats/templates.json')
    if (source.value.kind !== 'bytes') throw new Error('template fixture did not open as bytes')
    expect(await source.value.read(0n, 16)).toEqual(new Uint8Array([4, 5]))
    await source.release()

    await result.release()
    await result.release()
    expect(original.namespaceRelease).toHaveBeenCalledOnce()
    expect(original.sessionRelease).not.toHaveBeenCalled()
    expect(base.namespaceRelease).toHaveBeenCalledOnce()
    expect(base.sessionRelease).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: 'unknown resolver id',
      resourcePlan: plan(undefined, 'example/unknown-resolver'),
      code: 'x3.host/map-preview-resource-resolver-unknown',
    },
    {
      name: 'path traversal',
      resourcePlan: plan([
        { rootId: 'mp', locator: locator(['../mp.wz'], 'installation-only') },
        { rootId: 'base', locator: locator(['data/base.wz'], 'installation-only') },
      ]),
      code: 'x3.host/map-preview-resource-locator-invalid',
    },
    {
      name: 'an absolute provider path',
      resourcePlan: plan([
        { rootId: 'mp', locator: locator(['/outside/mp.wz'], 'installation-only') },
        { rootId: 'base', locator: locator(['data/base.wz'], 'installation-only') },
      ]),
      code: 'x3.host/map-preview-resource-locator-invalid',
    },
    {
      name: 'an unknown locator kind',
      resourcePlan: plan([
        {
          rootId: 'mp',
          locator: { ...locator(['data/mp.wz'], 'installation-only'), kind: 'game-path' },
        },
        { rootId: 'base', locator: locator(['data/base.wz'], 'installation-only') },
      ]),
      code: 'x3.host/map-preview-resource-locator-invalid',
    },
    {
      name: 'an unknown locator field',
      resourcePlan: plan([
        {
          rootId: 'mp',
          locator: { ...locator(['data/mp.wz'], 'installation-only'), absolutePath: 'C:/outside' },
        },
        { rootId: 'base', locator: locator(['data/base.wz'], 'installation-only') },
      ]),
      code: 'x3.host/map-preview-resource-locator-invalid',
    },
    {
      name: 'duplicate archive alternatives',
      resourcePlan: plan([
        { rootId: 'mp', locator: locator(['data/mp.wz', 'data/mp.wz'], 'installation-only') },
        { rootId: 'base', locator: locator(['data/base.wz'], 'installation-only') },
      ]),
      code: 'x3.host/map-preview-resource-locator-invalid',
    },
  ])('refuses $name before discovery or archive opening', async ({ resourcePlan, code }) => {
    const root = await installationRoot()
    const originalPath = join(root, 'subject.wz')
    await writeFile(originalPath, 'subject')
    const original = await namespaceSession(pathToFileURL(originalPath).href, new Map())
    const open = vi.fn()
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open } as unknown as Pick<SubjectServices, 'open'>,
    })
    const result = await resolver.resolve(
      await requestFixture(resourcePlan, originalPath, original.session),
    )
    expect(result).toMatchObject({ state: 'unresolved', diagnostics: [{ code }] })
    expect(mocks.discover).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('leaves an optional root the installation lacks empty instead of failing the plan', async () => {
    const root = await installationRoot()
    const mpPath = join(root, 'data', 'mp.wz')
    const basePath = join(root, 'data', 'base.wz')
    await Promise.all([writeFile(mpPath, 'mp'), writeFile(basePath, 'base')])
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })
    const original = await namespaceSession(
      pathToFileURL(mpPath).href,
      new Map([['multiplay/maps/demo/game.map', new Uint8Array([1])]]),
    )
    const base = await namespaceSession(
      pathToFileURL(basePath).href,
      new Map([['stats/templates.json', new Uint8Array([4, 5])]]),
    )
    const open = vi.fn(async () => ({ state: 'opened', session: base.session, diagnostics: [] }))
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open } as unknown as Pick<SubjectServices, 'open'>,
      configuredPaths: { [GAME_ID]: [root] },
    })
    const roots = (optional: boolean) => [
      { rootId: 'mp', locator: locator(['data/mp.wz'], 'prefer-matching-opened-subject') },
      {
        rootId: 'high',
        locator: locator(['data/terrain_overrides/high.wz'], 'installation-only'),
        ...(optional ? { optional: true } : {}),
      },
      { rootId: 'base', locator: locator(['data/base.wz'], 'installation-only') },
    ]
    const request = async (optional: boolean) => ({
      ...(await requestFixture(plan(roots(optional)), mpPath, original.session)),
      workspace: workspace(true),
    })
    const result = await resolver.resolve(await request(true))
    if (result.state !== 'resolved') throw new Error(JSON.stringify(result.diagnostics))
    expect(result.diagnostics.map(item => item.code)).toContain(
      'x3.host/map-preview-optional-root-absent',
    )
    const source = await result.origin.open('base/stats/templates.json')
    if (source.value.kind !== 'bytes') throw new Error('template fixture did not open as bytes')
    expect(await source.value.read(0n, 16)).toEqual(new Uint8Array([4, 5]))
    await source.release()
    await result.release()
    // The same root, required, still fails the plan.
    expect(await resolver.resolve(await request(false))).toMatchObject({
      state: 'unresolved',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'x3.host/map-preview-installation-archive-missing' }),
      ]),
    })
  })

  it('reads an installation folder no codec opens as a plain folder', async () => {
    const root = await installationRoot()
    await mkdir(join(root, 'data', 'bin'), { recursive: true })
    await writeFile(join(root, 'data', 'bin', 'tileset.bin'), 'tiles')
    const mpPath = join(root, 'data', 'mp.wz')
    await writeFile(mpPath, 'mp')
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })
    const original = await namespaceSession(
      pathToFileURL(mpPath).href,
      new Map([['multiplay/maps/demo/game.map', new Uint8Array([1])]]),
    )
    const {
      buildInventory,
      createExecutionBackendRegistry,
      createHostContributionContractRegistry,
    } = await import('../src/index.js')
    const inventory = await buildInventory([], createHostContributionContractRegistry())
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: {
        open: vi.fn(),
        inventory,
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        executionBackends: createExecutionBackendRegistry([]),
      } as unknown as Pick<SubjectServices, 'open'>,
      configuredPaths: { [GAME_ID]: [root] },
    })
    const result = await resolver.resolve(
      await requestFixture(
        plan([
          { rootId: 'mp', locator: locator(['data/mp.wz'], 'prefer-matching-opened-subject') },
          { rootId: 'base', locator: locator(['data'], 'installation-only') },
        ]),
        mpPath,
        original.session,
      ),
    )
    if (result.state !== 'resolved') throw new Error(JSON.stringify(result.diagnostics))
    const source = await result.origin.open('base/bin/tileset.bin')
    if (source.value.kind !== 'bytes') throw new Error('not bytes')
    expect(new TextDecoder().decode(await source.value.read(0n, 16))).toBe('tiles')
    await source.release()
    await result.release()
  })

  it('reads the files beside a map opened from disk for a subject-siblings root (DN7)', async () => {
    const root = await installationRoot()
    const desktop = await mkdtemp(join(tmpdir(), 'modkit-preview-siblings-'))
    temporaryRoots.push(desktop)
    const mapPath = join(desktop, 'demo.map')
    await writeFile(mapPath, 'map')
    await writeFile(join(desktop, '_demo.mis'), 'mission')
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })
    const original = await namespaceSession(
      pathToFileURL(mapPath).href,
      new Map([['multiplay/maps/demo/game.map', new Uint8Array([1])]]),
    )
    const siblings = { schemaVersion: 1, kind: 'subject-siblings', gameId: GAME_ID } as const
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open: vi.fn() } as unknown as Pick<SubjectServices, 'open'>,
      configuredPaths: { [GAME_ID]: [root] },
    })
    const result = await resolver.resolve(
      await requestFixture(
        plan([
          { rootId: 'mp', locator: siblings },
          { rootId: 'base', locator: siblings },
        ]),
        mapPath,
        original.session,
      ),
    )
    if (result.state !== 'resolved') throw new Error(JSON.stringify(result.diagnostics))
    const source = await result.origin.open('base/_demo.mis')
    if (source.value.kind !== 'bytes') throw new Error('not bytes')
    expect(new TextDecoder().decode(await source.value.read(0n, 16))).toBe('mission')
    await source.release()
    await result.release()
  })

  it('asks the next root for a file whose folder the map folder has not (DN7)', async () => {
    const root = await installationRoot()
    const basePath = join(root, 'data', 'base.wz')
    await writeFile(basePath, 'base')
    const desktop = await mkdtemp(join(tmpdir(), 'modkit-preview-siblings-'))
    temporaryRoots.push(desktop)
    const mapPath = join(desktop, 'demo.map')
    await writeFile(mapPath, 'map')
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })
    const original = await namespaceSession(
      pathToFileURL(mapPath).href,
      new Map([['multiplay/maps/demo/game.map', new Uint8Array([1])]]),
    )
    const base = await namespaceSession(
      pathToFileURL(basePath).href,
      new Map([['data/bin/tiledata.bin', new Uint8Array([7])]]),
    )
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: {
        open: vi.fn(async () => ({ state: 'opened', session: base.session, diagnostics: [] })),
      } as unknown as Pick<SubjectServices, 'open'>,
      configuredPaths: { [GAME_ID]: [root] },
    })
    const result = await resolver.resolve(
      await requestFixture(
        plan([
          {
            rootId: 'mp',
            locator: { schemaVersion: 1, kind: 'subject-siblings', gameId: GAME_ID },
          },
          { rootId: 'base', locator: locator(['data/base.wz'], 'installation-only') },
        ]),
        mapPath,
        original.session,
      ),
    )
    if (result.state !== 'resolved') throw new Error(JSON.stringify(result.diagnostics))
    // the folder beside the map has no data/bin: no such file there, so the installation answers
    const source = await result.origin.open('data/bin/tiledata.bin')
    if (source.value.kind !== 'bytes') throw new Error('not bytes')
    expect([...(await source.value.read(0n, 1))]).toEqual([7])
    await source.release()
    await result.release()
  })

  it('keeps a released installation for its retention so the next pass reuses it', async () => {
    const root = await installationRoot()
    const mpPath = join(root, 'data', 'mp.wz')
    const basePath = join(root, 'data', 'base.wz')
    await Promise.all([writeFile(mpPath, 'mp'), writeFile(basePath, 'base')])
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })
    const first = await namespaceSession(pathToFileURL(mpPath).href, new Map())
    const second = await namespaceSession(pathToFileURL(mpPath).href, new Map())
    const base = await namespaceSession(pathToFileURL(basePath).href, new Map())
    const open = vi.fn(async () => ({ state: 'opened', session: base.session, diagnostics: [] }))
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 60_000,
      subjects: { open } as unknown as Pick<SubjectServices, 'open'>,
      configuredPaths: { [GAME_ID]: [root] },
    })

    // The warm pass and the mount pass of one map open are sequential: the first releases before
    // the second asks, so pure reference counting would index the installation twice.
    const one = await resolver.resolve(await requestFixture(plan(), mpPath, first.session))
    if (one.state !== 'resolved') throw new Error('first resolve failed')
    await one.release()
    expect(base.sessionRelease).not.toHaveBeenCalled()

    const two = await resolver.resolve(await requestFixture(plan(), mpPath, second.session))
    if (two.state !== 'resolved') throw new Error('second resolve failed')
    expect(open).toHaveBeenCalledOnce()
    await two.release()
  })

  it('opens an installed archive once across concurrent resolves and releases it last', async () => {
    const root = await installationRoot()
    const mpPath = join(root, 'data', 'mp.wz')
    const basePath = join(root, 'data', 'base.wz')
    await Promise.all([writeFile(mpPath, 'mp'), writeFile(basePath, 'base')])
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })
    const first = await namespaceSession(pathToFileURL(mpPath).href, new Map())
    const second = await namespaceSession(pathToFileURL(mpPath).href, new Map())
    const base = await namespaceSession(
      pathToFileURL(basePath).href,
      new Map([['stats/templates.json', new Uint8Array([4, 5])]]),
    )
    const open = vi.fn(async () => ({ state: 'opened', session: base.session, diagnostics: [] }))
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open } as unknown as Pick<SubjectServices, 'open'>,
      configuredPaths: { [GAME_ID]: [root] },
    })

    // Concurrent on purpose: the two passes of one map open overlap, so a cache that only holds
    // finished mounts never hits and the installation is indexed twice.
    const [one, two] = await Promise.all([
      resolver.resolve(await requestFixture(plan(), mpPath, first.session)),
      resolver.resolve(await requestFixture(plan(), mpPath, second.session)),
    ])
    if (one.state !== 'resolved' || two.state !== 'resolved') {
      throw new Error('fixture resource plan did not resolve twice')
    }
    // Opening and indexing an installation is the expensive half of a cold map preview.
    expect(open).toHaveBeenCalledOnce()

    await one.release()
    expect(base.sessionRelease).not.toHaveBeenCalled()
    await two.release()
    expect(base.sessionRelease).toHaveBeenCalledOnce()
    expect(base.namespaceRelease).toHaveBeenCalledOnce()
  })

  it('discovers the installation under its own grant when one is configured', async () => {
    const root = await installationRoot()
    const originalPath = join(root, 'subject.wz')
    await writeFile(originalPath, 'subject')
    const original = await namespaceSession(pathToFileURL(originalPath).href, new Map())
    const installationDiscoveryGrant = Object.freeze({
      id: 'fixture-discovery',
      classes: Object.freeze(['filesystem-read' as const]),
    })
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open: vi.fn() } as unknown as Pick<SubjectServices, 'open'>,
      installationDiscoveryGrant,
    })

    mocks.discover.mockResolvedValueOnce({
      state: 'discovered',
      result: discovery(root, { complete: false }),
      diagnostics: [],
    })
    await resolver.resolve(await requestFixture(plan(), originalPath, original.session))
    // The subject grant carries read-source only; discovery is a filesystem probe and would be
    // rejected with permission-required under it.
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({ grant: installationDiscoveryGrant }),
    )
  })

  it('refuses incomplete or ambiguous installation discovery', async () => {
    const root = await installationRoot()
    const second = await installationRoot()
    const originalPath = join(root, 'subject.wz')
    await writeFile(originalPath, 'subject')
    const original = await namespaceSession(pathToFileURL(originalPath).href, new Map())
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open: vi.fn() } as unknown as Pick<SubjectServices, 'open'>,
    })

    mocks.discover.mockResolvedValueOnce({
      state: 'discovered',
      result: discovery(root, { complete: false }),
      diagnostics: [],
    })
    const incomplete = await resolver.resolve(
      await requestFixture(plan(), originalPath, original.session),
    )
    expect(incomplete).toMatchObject({
      state: 'unresolved',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'x3.host/map-preview-installation-discovery-truncated' }),
      ]),
    })

    // a file outside both installations names neither
    const elsewhere = await installationRoot()
    const outsidePath = join(elsewhere, 'subject.wz')
    await writeFile(outsidePath, 'subject')
    const outside = await namespaceSession(pathToFileURL(outsidePath).href, new Map())
    mocks.discover.mockResolvedValueOnce({
      state: 'discovered',
      result: discovery(root, { secondRoot: second }),
      diagnostics: [],
    })
    const ambiguous = await resolver.resolve(
      await requestFixture(plan(), outsidePath, outside.session),
    )
    expect(ambiguous).toMatchObject({
      state: 'unresolved',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'x3.host/map-preview-installation-ambiguous' }),
      ]),
    })

    // a file inside one of them belongs to it: no ambiguity without a choice
    mocks.discover.mockResolvedValueOnce({
      state: 'discovered',
      result: discovery(root, { secondRoot: second }),
      diagnostics: [],
    })
    const containing = await resolver.resolve(
      await requestFixture(plan(), originalPath, original.session),
    )
    expect(
      (containing.diagnostics ?? []).some(
        item => item.code === 'x3.host/map-preview-installation-ambiguous',
      ),
    ).toBe(false)

    // The installation the user configured is their choice, not an ambiguity.
    const configuredResolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      configuredPaths: { [GAME_ID]: [root] },
      subjects: { open: vi.fn() } as unknown as Pick<SubjectServices, 'open'>,
    })
    mocks.discover.mockResolvedValueOnce({
      state: 'discovered',
      result: discovery(root, { secondRoot: second }),
      diagnostics: [],
    })
    const chosen = await configuredResolver.resolve(
      await requestFixture(plan(), originalPath, original.session),
    )
    expect(
      (chosen.diagnostics ?? []).some(
        item => item.code === 'x3.host/map-preview-installation-ambiguous',
      ),
    ).toBe(false)
  })

  it('refuses two existing exact archive alternatives', async () => {
    const root = await installationRoot()
    const directMp = join(root, 'mp.wz')
    const nestedMp = join(root, 'data', 'mp.wz')
    const basePath = join(root, 'data', 'base.wz')
    const originalPath = join(root, 'subject.wz')
    await Promise.all([
      writeFile(directMp, 'direct'),
      writeFile(nestedMp, 'nested'),
      writeFile(basePath, 'base'),
      writeFile(originalPath, 'subject'),
    ])
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })
    const original = await namespaceSession(pathToFileURL(originalPath).href, new Map())
    const open = vi.fn()
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open } as unknown as Pick<SubjectServices, 'open'>,
    })
    const result = await resolver.resolve(
      await requestFixture(plan(), originalPath, original.session),
    )
    expect(result).toMatchObject({
      state: 'unresolved',
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'x3.host/map-preview-installation-archive-ambiguous' }),
      ]),
    })
    expect(open).not.toHaveBeenCalled()
    expect(original.namespaceRelease).toHaveBeenCalledOnce()
  })

  it('releases the first opened archive when a later ordinary open fails', async () => {
    const root = await installationRoot()
    const mpPath = join(root, 'data', 'mp.wz')
    const basePath = join(root, 'data', 'base.wz')
    const originalPath = join(root, 'subject.wz')
    await Promise.all([
      writeFile(mpPath, 'mp'),
      writeFile(basePath, 'base'),
      writeFile(originalPath, 'subject'),
    ])
    mocks.discover.mockResolvedValue({
      state: 'discovered',
      result: discovery(root),
      diagnostics: [],
    })
    const original = await namespaceSession(pathToFileURL(originalPath).href, new Map())
    const mp = await namespaceSession(
      pathToFileURL(mpPath).href,
      new Map([['one', new Uint8Array([1])]]),
    )
    const open = vi
      .fn()
      .mockResolvedValueOnce({ state: 'opened', session: mp.session, diagnostics: [] })
      .mockResolvedValueOnce({ state: 'unresolved', diagnostics: [] })
    const resolver = createNodeMapPreviewResourcePlanResolver({
      installationRetentionMs: 0,
      subjects: { open } as unknown as Pick<SubjectServices, 'open'>,
    })
    const installationOnlyPlan = plan([
      { rootId: 'mp', locator: locator(['data/mp.wz'], 'installation-only') },
      { rootId: 'base', locator: locator(['data/base.wz'], 'installation-only') },
    ])
    const result = await resolver.resolve(
      await requestFixture(installationOnlyPlan, originalPath, original.session),
    )
    expect(result).toMatchObject({ state: 'unresolved' })
    expect(open).toHaveBeenCalledTimes(2)
    expect(original.namespaceRelease).toHaveBeenCalledOnce()
    expect(mp.namespaceRelease).toHaveBeenCalledOnce()
    expect(mp.sessionRelease).toHaveBeenCalledOnce()
  })
})
