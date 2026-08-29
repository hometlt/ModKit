import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import {
  assembleSubjectDescriptor,
  presentationSemanticHash,
  resolveCommonPresentationPlan,
  resolveModelWorldPresentationPlan,
} from '@modkitx-x3/host'
import {
  revisionId,
  WORLD_SCENE_SOURCE_CONTRACT,
  type AnyDescriptor,
  type ArtifactByteSource,
  type AssetInput,
  type CandidateWorldSceneSource,
  type Codec,
  type ContributionContext,
  type KnownBindingRef,
  type ModelSceneSource,
  type PresentationSlot,
  type ResolvedMapWorkspaceSnapshot,
  type ResourceBudget,
  type TreeDataSource,
  type ViewerModule,
  type WorldScenePageRequest,
  type WorldSceneSource,
} from '@modkitx-x3/sdk'
import { drainModelProjection } from '@modkitx-x3/testkit'
import { createCodecPreview } from '@modkitx-x3/ui/explorer'
import { createWebPreviewStages, stageIdOf } from '../src/views.js'
import { STAGE_ORDER as VSCODE_STAGE_ORDER } from '../../modkit-vscode/src/view-policy.js'
import { createCandidateWorldSceneLease } from '../../../packages/host/src/maps/world-source.js'
import { resolvedDescriptorWire } from '../../../packages/host/test/fixtures/descriptor.js'
import { externalRepositoryRoot } from '../../../scripts/lib/external-extension-roots.mjs'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const blizzardRoot = externalRepositoryRoot(repositoryRoot, 'blizzard')
const warzoneRoot = externalRepositoryRoot(repositoryRoot, 'warzone')
const fixtures = [
  {
    ecosystem: 'StarCraft II',
    name: 'triangle.m3',
    path: join(repositoryRoot, 'packages', 'testkit', 'test', 'fixtures', 'models', 'triangle.m3'),
    codec: join(repositoryRoot, '..', 'modkit-blizzard', 'models', 'src', 'm3', 'codec.js'),
  },
  {
    ecosystem: 'Warzone 2100',
    name: 'minimal.warzone.pie',
    path: join(
      repositoryRoot,
      'packages',
      'testkit',
      'test',
      'fixtures',
      'mk2-synthetic',
      'minimal.warzone.pie',
    ),
    codec: join(warzoneRoot, 'src', 'warzone-pie', 'codec.js'),
  },
] as const

const budget: ResourceBudget = {
  maxInputBytes: 16_777_216n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('presentation fixtures have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('presentation fixtures have no foreign service dependency')
    },
  },
}

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://presentation/${name}`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:presentation-${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: `presentation-${name}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

async function codecFor(path: string): Promise<Codec> {
  const module = (await import(pathToFileURL(path).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

const scope = Object.freeze({ scopeId: 'presentation-model-scene-base-v1', version: '1.0.0' })
const worldScope = Object.freeze({
  scopeId: 'presentation-world-scene-source-v1',
  version: '1.0.0',
})

const encoder = new TextEncoder()

function sc2HeightMap(): Uint8Array {
  const bytes = new Uint8Array(32 + 4 * 6)
  bytes.set(encoder.encode('HMAP'))
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 101, true)
  view.setUint32(8, 2, true)
  view.setUint32(12, 2, true)
  for (let index = 0; index < 4; index += 1) {
    view.setUint16(32 + index * 6, 100 + index, true)
    view.setUint16(34 + index * 6, 10 + index, true)
    view.setUint16(36 + index * 6, index === 3 ? 0x9000 : 1, true)
  }
  return bytes
}

function sc2WorldRequest() {
  return {
    workspaceId: 'presentation-sc2-workspace',
    gameId: 'org.modkitx/starcraft-2',
    mapId: 'maps/presentation.SC2Map',
    documents: [
      {
        path: 'maps/presentation.SC2Map/Objects',
        bytes: encoder.encode(
          '<?xml version="1.0"?><PlacedObjects Version="27"><ObjectUnit Id="7" Position="1,2,3" Rotation="0.5" Scale="1,1,1" UnitType="Marine" Player="1"/></PlacedObjects>',
        ),
      },
      {
        path: 'maps/presentation.SC2Map/Regions',
        bytes: encoder.encode(
          '<?xml version="1.0"?><Regions><region id="2"><name value="Start"/><shape type="circle"><center value="1,2"/><radius value="3"/></shape></region></Regions>',
        ),
      },
      { path: 'maps/presentation.SC2Map/t3HeightMap', bytes: sc2HeightMap() },
    ],
    maxDocuments: 8,
    maxDocumentBytes: 1_000_000,
    maxTotalBytes: 4_000_000,
    maxObjects: 1_000,
    maxRegions: 1_000,
    maxTerrainCells: 100_000,
    maxTerrainSamples: 16,
    maxDepth: 32,
    maxDiagnostics: 100,
    snapshotId: 'presentation-sc2-world',
    unresolvedRequirementIds: [],
    requiredRequirementIds: ['map-objects', 'map-regions', 'map-terrain-height'],
  }
}

function warzoneWorldRequest(bytes: Uint8Array) {
  return {
    workspaceId: 'presentation-warzone-workspace',
    gameId: 'org.modkitx/warzone-2100',
    mapId: 'multiplay/maps/presentation',
    documents: [{ path: 'multiplay/maps/presentation/game.map', bytes }],
    maxDocuments: 8,
    maxDocumentBytes: 1_000_000,
    maxTotalBytes: 4_000_000,
    maxObjects: 1_000,
    maxRegions: 1_000,
    maxTerrainCells: 65_536,
    maxTerrainSamples: 65_536,
    maxDepth: 32,
    maxDiagnostics: 100,
    snapshotId: 'presentation-warzone-world',
    unresolvedRequirementIds: [],
    requiredRequirementIds: ['warzone-game-map'],
  }
}

async function analyzeWorld(
  modulePath: string,
  exportName: string,
  request: unknown,
): Promise<ResolvedMapWorkspaceSnapshot> {
  const module = (await import(pathToFileURL(modulePath).href)) as Readonly<Record<string, unknown>>
  const analyze = module[exportName]
  if (typeof analyze !== 'function') throw new TypeError(`${exportName} is not a function`)
  return (await analyze(request)) as ResolvedMapWorkspaceSnapshot
}

function commonWorldSource(candidate: CandidateWorldSceneSource): WorldSceneSource {
  return Object.freeze({
    contract: WORLD_SCENE_SOURCE_CONTRACT,
    major: 1,
    snapshotId: candidate.snapshotId,
    async info(signal?: AbortSignal) {
      const info = await candidate.info(signal)
      return Object.freeze({ ...info, contract: WORLD_SCENE_SOURCE_CONTRACT })
    },
    page(request: WorldScenePageRequest, signal?: AbortSignal) {
      return candidate.page(request, signal)
    },
  })
}

async function drainWorldProjection(source: WorldSceneSource) {
  const info = await source.info()
  const queries = [
    { facet: 'layers' },
    ...info.facets.map(facet => ({ facet: facet.facet, layerId: facet.layerId })),
  ]
  const facets = []
  for (const query of queries) {
    const items = []
    let cursor: string | undefined
    let state: 'available' | 'unavailable' | 'unsupported' = 'available'
    let reason: string | undefined
    do {
      const page = await source.page({
        ...query,
        ...(cursor === undefined ? {} : { cursor }),
        limit: 1,
      })
      state = page.state
      reason = page.reason
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor !== undefined)
    facets.push({ query, state, ...(reason === undefined ? {} : { reason }), items })
  }
  return { info, facets }
}

async function worldDescriptor(
  subjectUri: string,
  revision: string,
  formatId: string,
): Promise<AnyDescriptor> {
  const wire = resolvedDescriptorWire()
  return assembleSubjectDescriptor({
    ...wire,
    subjectUri,
    revision,
    identity: { ...wire.identity, formatId, formatLabel: formatId },
    dataSources: [{ contract: WORLD_SCENE_SOURCE_CONTRACT, major: 1 }],
  } as never)
}

describe('PWA / VS Code resolved presentation conformance', () => {
  it('keeps app-local surfaces without reviving a global stage rejected by the host plan', async () => {
    const name = 'minimal.odt'
    const bytes = new Uint8Array(
      await readFile(
        join(repositoryRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic', name),
      ),
    )
    const subject = await (
      await codecFor(
        join(repositoryRoot, 'extensions', 'common', 'documents', 'src', 'odt', 'codec.js'),
      )
    ).open(inputFor(name, bytes), 'full', budget)
    const descriptor = await subject.descriptor()
    if (descriptor.interpretation !== 'codec') throw new Error('ODT did not produce a descriptor')
    const resolved = await resolveCommonPresentationPlan(
      descriptor,
      {
        sessionId: 'bounded-global',
        providerId: 'org.modkitx/odt',
        variantId: 'portable',
      },
      {
        availableStageIds: ['code', 'tree'],
        // Monaco is catalogued for at most 8 MiB, so the host deliberately excludes it.
        sourceBytes: 9n * 1_024n * 1_024n,
      },
    )
    if (resolved === undefined) throw new Error('the bounded fixture has no presentation plan')
    expect(resolved.plan.slots.map(slot => slot.slotId)).toEqual(['tree'])

    const viewer: ViewerModule = {
      abiVersion: 1,
      async mount() {
        return { update: async () => undefined, unmount: async () => undefined }
      },
    }
    const preview = createCodecPreview({
      stages: [
        {
          id: 'code',
          label: 'Code',
          contract: 'common.view/text-data-source',
          trait: 'content.text',
          module: viewer,
        },
        {
          id: 'tree',
          label: 'Tree',
          contract: 'common.view/tree-data-source',
          module: viewer,
        },
        {
          id: 'metadata',
          label: 'Metadata',
          contract: 'common.view/byte-range-source',
          module: viewer,
          appLocal: true,
        },
        {
          id: 'text-editor',
          label: 'Text editor',
          contract: 'common.view/text-data-source',
          trait: 'content.text',
          module: viewer,
          editable: true,
          appLocal: true,
        },
      ],
      async openSession() {
        return {
          presentation: resolved.plan,
          descriptor: async () => descriptor as unknown as Record<string, unknown>,
          async dataSource() {
            return { value: {} }
          },
          async dispose() {
            return undefined
          },
        }
      },
      editorPorts: () => ({ edit: {}, commit: {}, payloads: {}, authorization: {} }),
    })
    const handle = await preview.open(
      { replaceChildren: () => undefined } as never,
      { id: 'large.txt', name: 'large.txt', directory: false },
      new Uint8Array(),
    )
    if (handle === undefined) throw new Error('the bounded fixture did not mount')
    expect(handle.views.map(view => view.id)).toEqual(['tree', 'metadata', 'text-editor'])
    expect(handle.activeView).toBe('tree')
    await handle.unmount()
    await subject.dispose()
  })

  it('opens one common ODT document from the same host plan in PWA, VS Code and headless without invoking a writer', async () => {
    const name = 'minimal.odt'
    const bytes = new Uint8Array(
      await readFile(
        join(repositoryRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic', name),
      ),
    )
    const session = await (
      await codecFor(
        join(repositoryRoot, 'extensions', 'common', 'documents', 'src', 'odt', 'codec.js'),
      )
    ).open(inputFor(name, bytes), 'full', budget)
    const descriptor = await session.descriptor()
    if (descriptor.interpretation !== 'codec') throw new Error('ODT did not produce a descriptor')
    const sourceLease = await session.dataSource('common.view/tree-data-source', 1)
    const source = sourceLease.value as TreeDataSource
    const pwaStageIds = createWebPreviewStages({ operationsFor: () => undefined }).map(stageIdOf)
    const plans = await Promise.all(
      [
        { host: 'pwa', stageIds: pwaStageIds },
        { host: 'vscode', stageIds: VSCODE_STAGE_ORDER },
        { host: 'headless', stageIds: pwaStageIds },
      ].map(async ({ host, stageIds }) => {
        const resolved = await resolveCommonPresentationPlan(
          descriptor,
          {
            sessionId: `${host}:${name}`,
            providerId: descriptor.identity.codecId,
            variantId: host,
          },
          { availableStageIds: stageIds },
        )
        if (resolved === undefined) throw new Error(`${host} has no ODT presentation plan`)
        return resolved.plan
      }),
    )
    const [pwaPlan, vscodePlan, headlessPlan] = plans
    if (pwaPlan === undefined || vscodePlan === undefined || headlessPlan === undefined) {
      throw new Error('all three ODT plans are required')
    }
    expect(pwaPlan).toEqual(vscodePlan)
    expect(vscodePlan).toEqual(headlessPlan)
    expect(pwaPlan.activeStage).toBe('tree')

    const writer = vi.fn()
    const roots: string[] = []
    const treeViewer: ViewerModule = {
      abiVersion: 1,
      async mount(args) {
        const binding = args.slot.bindings.find(item => {
          const ref = 'dataSource' in item ? item.dataSource : item
          return ref.contract === 'common.view/tree-data-source' && ref.major === 1
        })
        if (binding === undefined || 'dataSource' in binding) {
          throw new Error('host plan did not bind the common document tree')
        }
        const mounted = await args.sources.get(
          binding as KnownBindingRef<'common.view/tree-data-source', 1>,
        )
        if (mounted === undefined) throw new Error('document tree source is unavailable')
        roots.push((await (mounted.value as TreeDataSource).root()).id)
        await mounted.release()
        return { update: async () => undefined, unmount: async () => undefined }
      },
    }
    for (const { host, plan } of [
      { host: 'pwa', plan: pwaPlan },
      { host: 'vscode', plan: vscodePlan },
    ] as const) {
      const preview = createCodecPreview({
        stages: [
          {
            id: 'tree',
            label: 'Tree',
            contract: 'common.view/tree-data-source',
            module: treeViewer,
          },
        ],
        async openSession() {
          return {
            presentation: plan,
            descriptor: async () => descriptor as unknown as Record<string, unknown>,
            async dataSource(contract, major) {
              expect([contract, major]).toEqual(['common.view/tree-data-source', 1])
              return { value: source }
            },
            async operations() {
              return { invoke: writer } as never
            },
            async dispose() {
              return undefined
            },
          }
        },
      })
      const handle = await preview.open(
        { replaceChildren: () => undefined } as never,
        { id: `${host}:${name}`, name, directory: false },
        bytes,
      )
      if (handle === undefined) throw new Error(`${host} did not consume the ODT plan`)
      await handle.unmount()
    }
    expect(roots).toEqual(['root', 'root'])
    expect(writer).not.toHaveBeenCalled()
    await sourceLease.release()
    await session.dispose()
  }, 30_000)

  it.each(fixtures)(
    'keeps $ecosystem model semantics equal in PWA, VS Code and headless without a UV write',
    async fixture => {
      const bytes = new Uint8Array(await readFile(fixture.path))
      const session = await (
        await codecFor(fixture.codec)
      ).open(inputFor(fixture.name, bytes), 'full', budget)
      const descriptor = await session.descriptor()
      if (descriptor.interpretation !== 'codec') {
        throw new Error(`${fixture.name} did not produce a codec descriptor`)
      }
      const lease = await session.dataSource('common.view/model-scene-source', 1)
      const source = lease.value as ModelSceneSource
      const semantic = await drainModelProjection(source)
      const plans = await Promise.all(
        (['pwa', 'vscode', 'headless'] as const).map(async host => {
          const resolved = await resolveModelWorldPresentationPlan(descriptor, {
            sessionId: `${host}:${fixture.name}`,
            providerId: descriptor.identity.codecId,
            variantId: host,
          })
          if (resolved === undefined) throw new Error(`${fixture.name} has no model presentation`)
          return resolved.plan
        }),
      )
      const [pwaPlan, vscodePlan, headlessPlan] = plans
      if (pwaPlan === undefined || vscodePlan === undefined || headlessPlan === undefined) {
        throw new Error('all three presentation plans are required')
      }
      expect(pwaPlan).toEqual(vscodePlan)
      expect(vscodePlan).toEqual(headlessPlan)
      expect(pwaPlan.activeStage).toBe('model')

      const uvWriter = vi.fn()
      const seenSlots: PresentationSlot[] = []
      const hashes: string[] = []
      const viewer: ViewerModule = {
        abiVersion: 1,
        async mount(args) {
          seenSlots.push(args.slot)
          const binding = args.slot.bindings.find(item => {
            const ref = 'dataSource' in item ? item.dataSource : item
            return ref.contract === 'common.view/model-scene-source' && ref.major === 1
          })
          if (binding === undefined || 'dataSource' in binding) {
            throw new Error('host plan did not bind the common model source')
          }
          const mountedLease = await args.sources.get(
            binding as KnownBindingRef<'common.view/model-scene-source', 1>,
          )
          if (mountedLease === undefined) throw new Error('model source lease is unavailable')
          const mountedSemantic = await drainModelProjection(mountedLease.value as ModelSceneSource)
          hashes.push(
            (
              await presentationSemanticHash({
                scope,
                plan: hashes.length === 0 ? pwaPlan : vscodePlan,
                semantic: mountedSemantic,
              })
            ).hash,
          )
          await mountedLease.release()
          return { update: async () => undefined, unmount: async () => undefined }
        },
      }

      for (const { host, plan } of [
        { host: 'pwa', plan: pwaPlan },
        { host: 'vscode', plan: vscodePlan },
      ] as const) {
        const root = { replaceChildren: () => undefined }
        const preview = createCodecPreview({
          stages: [
            {
              id: 'model',
              label: 'Model',
              contract: 'common.view/model-scene-source',
              module: viewer,
            },
          ],
          async openSession() {
            return {
              presentation: plan,
              descriptor: async () => descriptor as unknown as Record<string, unknown>,
              async dataSource(contract, major) {
                expect([contract, major]).toEqual(['common.view/model-scene-source', 1])
                return { value: source }
              },
              async operations() {
                return { invoke: uvWriter } as never
              },
              async dispose() {
                return undefined
              },
            }
          },
        })
        const handle = await preview.open(
          root as never,
          { id: `${host}:${fixture.name}`, name: fixture.name, directory: false },
          bytes,
        )
        if (handle === undefined) throw new Error(`${host} did not consume the presentation plan`)
        await handle.unmount()
      }

      const headless = await presentationSemanticHash({ scope, plan: headlessPlan, semantic })
      expect(hashes).toEqual([headless.hash, headless.hash])
      expect(seenSlots).toHaveLength(2)
      expect(seenSlots.map(slot => slot.contributionId)).toEqual([
        'org.modkitx.ui/model-stage',
        'org.modkitx.ui/model-stage',
      ])
      expect(seenSlots.map(slot => slot.bindings[0]?.bindingId)).toEqual([
        'model-content',
        'model-content',
      ])
      expect(uvWriter).not.toHaveBeenCalled()

      await lease.release()
      await session.dispose()
    },
    30_000,
  )

  it.each([
    {
      ecosystem: 'StarCraft II',
      name: 'synthetic.SC2Map',
      subjectUri: 'memory://presentation/synthetic.SC2Map',
      revision: 'provider-token:presentation-sc2-map',
      formatId: 'sc2-map',
      async load() {
        return {
          bytes: encoder.encode('synthetic SC2Map workspace'),
          snapshot: await analyzeWorld(
            join(blizzardRoot, 'starcraft2-game', 'src', 'map-provider.js'),
            'analyzeStarcraft2MapWorkspace',
            sc2WorldRequest(),
          ),
        }
      },
    },
    {
      ecosystem: 'Warzone 2100',
      name: 'minimal.warzone.map',
      subjectUri: 'memory://presentation/minimal.warzone.map',
      revision: 'provider-token:presentation-warzone-map',
      formatId: 'warzone2100-map',
      async load() {
        const bytes = new Uint8Array(
          await readFile(
            join(
              repositoryRoot,
              'packages',
              'testkit',
              'test',
              'fixtures',
              'mk2-synthetic',
              'minimal.warzone.map',
            ),
          ),
        )
        return {
          bytes,
          snapshot: await analyzeWorld(
            join(warzoneRoot, 'src', 'map-provider.js'),
            'analyzeWarzoneMapWorkspace',
            warzoneWorldRequest(bytes),
          ),
        }
      },
    },
  ])(
    'keeps $ecosystem world semantics equal in PWA, VS Code and headless without a UV write',
    async fixture => {
      const loaded = await fixture.load()
      const candidateLease = createCandidateWorldSceneLease(loaded.snapshot, [], 64)
      const source = commonWorldSource(candidateLease.value)
      const descriptor = await worldDescriptor(
        fixture.subjectUri,
        fixture.revision,
        fixture.formatId,
      )
      if (descriptor.interpretation !== 'codec') {
        throw new Error(`${fixture.name} did not produce a codec descriptor`)
      }
      const semantic = await drainWorldProjection(source)
      const plans = await Promise.all(
        (['pwa', 'vscode', 'headless'] as const).map(async host => {
          const resolved = await resolveModelWorldPresentationPlan(descriptor, {
            sessionId: `${host}:${fixture.name}`,
            providerId: descriptor.identity.codecId,
            variantId: host,
          })
          if (resolved === undefined) throw new Error(`${fixture.name} has no world presentation`)
          return resolved.plan
        }),
      )
      const [pwaPlan, vscodePlan, headlessPlan] = plans
      if (pwaPlan === undefined || vscodePlan === undefined || headlessPlan === undefined) {
        throw new Error('all three world presentation plans are required')
      }
      expect(pwaPlan).toEqual(vscodePlan)
      expect(vscodePlan).toEqual(headlessPlan)
      expect(pwaPlan.activeStage).toBe('world')

      const uvWriter = vi.fn()
      const seenSlots: PresentationSlot[] = []
      const hashes: string[] = []
      const viewer: ViewerModule = {
        abiVersion: 1,
        async mount(args) {
          seenSlots.push(args.slot)
          const binding = args.slot.bindings.find(item => {
            const ref = 'dataSource' in item ? item.dataSource : item
            return ref.contract === WORLD_SCENE_SOURCE_CONTRACT && ref.major === 1
          })
          if (binding === undefined || 'dataSource' in binding) {
            throw new Error('host plan did not bind the common world source')
          }
          const mountedLease = await args.sources.get(
            binding as KnownBindingRef<'common.view/world-scene-source', 1>,
          )
          if (mountedLease === undefined) throw new Error('world source lease is unavailable')
          const mountedSemantic = await drainWorldProjection(mountedLease.value as WorldSceneSource)
          hashes.push(
            (
              await presentationSemanticHash({
                scope: worldScope,
                plan: hashes.length === 0 ? pwaPlan : vscodePlan,
                semantic: mountedSemantic,
              })
            ).hash,
          )
          await mountedLease.release()
          return { update: async () => undefined, unmount: async () => undefined }
        },
      }

      for (const { host, plan } of [
        { host: 'pwa', plan: pwaPlan },
        { host: 'vscode', plan: vscodePlan },
      ] as const) {
        const root = { replaceChildren: () => undefined }
        const preview = createCodecPreview({
          stages: [
            {
              id: 'world',
              label: 'World',
              contract: WORLD_SCENE_SOURCE_CONTRACT,
              module: viewer,
            },
          ],
          async openSession() {
            return {
              presentation: plan,
              descriptor: async () => descriptor as unknown as Record<string, unknown>,
              async dataSource(contract, major) {
                expect([contract, major]).toEqual([WORLD_SCENE_SOURCE_CONTRACT, 1])
                return { value: source }
              },
              async operations() {
                return { invoke: uvWriter } as never
              },
              async dispose() {
                return undefined
              },
            }
          },
        })
        const handle = await preview.open(
          root as never,
          { id: `${host}:${fixture.name}`, name: fixture.name, directory: false },
          loaded.bytes,
        )
        if (handle === undefined) throw new Error(`${host} did not consume the world plan`)
        await handle.unmount()
      }

      const headless = await presentationSemanticHash({
        scope: worldScope,
        plan: headlessPlan,
        semantic,
      })
      expect(hashes).toEqual([headless.hash, headless.hash])
      expect(seenSlots.map(slot => slot.contributionId)).toEqual([
        'org.modkitx.ui/world-stage',
        'org.modkitx.ui/world-stage',
      ])
      expect(seenSlots.map(slot => slot.bindings[0]?.bindingId)).toEqual([
        'world-content',
        'world-content',
      ])
      expect(uvWriter).not.toHaveBeenCalled()

      await candidateLease.release()
    },
    30_000,
  )

  it('keeps presentation routing generic in both UI hosts', () => {
    const pwa = readFileSync(new URL('../src/shell.ts', import.meta.url), 'utf8')
    const vscode = readFileSync(
      join(repositoryRoot, 'apps', 'modkit-vscode', 'src', 'host.ts'),
      'utf8',
    )
    for (const source of [pwa, vscode]) {
      expect(source).toContain('resolveCommonPresentationPlan')
      expect(source).not.toMatch(/if\s*\([^)]*(?:starcraft|warzone|\.m3|\.pie)/iu)
    }
  })
})
