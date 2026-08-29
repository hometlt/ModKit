import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  defineMixedVisualWorkspace,
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type CandidateWorldSceneSource,
  type Codec,
  type ContributionContext,
  type Lease,
  type ResourceBudget,
  type ViewerSources,
  type VisualAssetPolicy,
  type WorldSceneSource,
} from '@modkitx-x3/sdk'
import type {
  ResolvedMapWorkspaceAnalysisRequest,
  ResolvedMapWorkspaceSnapshot,
} from '@modkitx-x3/sdk/maps'
import { loadMixedVisualStage } from '@modkitx-x3/ui/composition'
import { createCandidateWorldSceneLease } from '../../../packages/host/src/maps/world-source.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { createCodec: createM3Codec } = (await import(
  pathToFileURL(join(repoRoot, '..', 'modkit-blizzard', 'models', 'src', 'm3', 'codec.js')).href
)) as { createCodec(context: ContributionContext): Codec }
const { analyzeWarzoneMapWorkspace } = (await import(
  pathToFileURL(join(repoRoot, '..', 'modkit-warzone', 'src', 'map-provider.js')).href
)) as {
  analyzeWarzoneMapWorkspace(
    request: ResolvedMapWorkspaceAnalysisRequest,
  ): Promise<ResolvedMapWorkspaceSnapshot>
}
const modelFixture = join(import.meta.dirname, 'fixtures', 'models', 'triangle.m3')
const worldRevision = revisionId('content-hash.sha256:warzone-map-mixed-visual')
const modelRevision = revisionId('content-hash.sha256:m3-mixed-visual')
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('mixed visual M3 fixture has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('mixed visual M3 fixture has no foreign service dependency')
    },
  },
}

function gameMap(): Uint8Array {
  const width = 2
  const height = 3
  const count = width * height
  const bytes = new Uint8Array(16 + count * 3 + 8 + 4)
  bytes.set(new TextEncoder().encode('map '), 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 10, true)
  view.setUint32(8, width, true)
  view.setUint32(12, height, true)
  let offset = 16
  for (let index = 0; index < count; index += 1) {
    view.setUint16(offset, 100 + index, true)
    view.setUint8(offset + 2, index + 1)
    offset += 3
  }
  view.setUint32(offset, 1, true)
  view.setUint32(offset + 4, 1, true)
  bytes.set([0, 0, width - 1, height - 1], offset + 8)
  return bytes
}

function modelInput(bytes: Uint8Array): AssetInput {
  const uri = 'memory://mixed-visual/triangle.m3'
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: modelRevision,
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
  return {
    originKind: 'single',
    bindings: [
      {
        sourceKind: 'candidate',
        bindingId: 'content',
        role: 'content',
        ownership: 'owned',
        source: source.ref,
        revision: modelRevision,
      },
    ],
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: modelRevision,
      bindings: [{ bindingId: 'content', revision: modelRevision }],
      compositionFingerprint: 'mixed-visual-m3',
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: () => Promise.resolve() }
    },
  }
}

function policy(uri: string, revision: ReturnType<typeof revisionId>): VisualAssetPolicy {
  return {
    provenance: {
      sourceIdentity: `${uri}#root`,
      subject: { subjectUri: uri, revision },
      originUri: uri,
    },
    license: { state: 'unknown', reason: 'original game asset terms are not inferred by Modkit' },
    redistribution: { state: 'restricted', reason: 'local visual test only' },
  }
}

function commonWorldLease(candidate: Lease<CandidateWorldSceneSource>): Lease<WorldSceneSource> {
  return {
    value: {
      contract: 'common.view/world-scene-source',
      major: 1,
      snapshotId: candidate.value.snapshotId,
      async info(signal) {
        const info = await candidate.value.info(signal)
        return { ...info, contract: 'common.view/world-scene-source' }
      },
      page: (request, signal) => candidate.value.page(request, signal),
    },
    release: () => candidate.release(),
  }
}

describe('priority-game mixed visual composition', () => {
  it('loads Warzone terrain and an M3 model through one visual-only shared pipeline', async () => {
    const snapshot = await analyzeWarzoneMapWorkspace({
      workspaceId: 'warzone-mixed-visual',
      gameId: 'org.modkitx/warzone-2100',
      mapId: 'multiplay/maps/mixed',
      documents: [{ path: 'multiplay/maps/mixed/game.map', bytes: gameMap() }],
      maxDocuments: 1,
      maxDocumentBytes: 1_000_000,
      maxTotalBytes: 1_000_000,
      maxObjects: 100,
      maxRegions: 100,
      maxTerrainCells: 1_000,
      maxTerrainSamples: 1_000,
      maxDepth: 32,
      snapshotId: 'warzone-mixed-snapshot',
      unresolvedRequirementIds: [],
      requiredRequirementIds: ['warzone-game-map'],
      maxDiagnostics: 100,
    })
    if (snapshot.uvwTransform === undefined) throw new Error('Warzone fixture has no UVW transform')
    const worldLease = commonWorldLease(createCandidateWorldSceneLease(snapshot, [], 1_024))
    const m3Session = await createM3Codec(context).open(
      modelInput(new Uint8Array(await readFile(modelFixture))),
      'inspect',
      budget,
    )
    const modelLease = await m3Session.dataSource('common.view/model-scene-source', 1)
    const worldUri = 'memory://mixed-visual/warzone-map'
    const modelUri = 'memory://mixed-visual/triangle.m3'
    const selected = defineMixedVisualWorkspace({
      workspaceId: 'warzone-terrain-m3-model',
      workspaceUri: 'workspace://mixed-visual/warzone-m3',
      workspaceRevision: revisionId('content-hash.sha256:warzone-m3-workspace'),
      worldFrame: {
        coordinateSpaceId: snapshot.uvwTransform.targetCoordinateSpaceId,
        basis: snapshot.uvwTransform.basis,
        origin: snapshot.uvwTransform.heightfield.origin,
      },
      world: {
        sourceId: 'warzone-world',
        originGroup: 'org.modkitx/warzone-2100',
        role: 'world-base',
        subject: { subjectUri: worldUri, revision: worldRevision },
      },
      model: {
        sourceId: 'starcraft-model',
        originGroup: 'org.modkitx/starcraft-2',
        role: 'model-overlay',
        subject: { subjectUri: modelUri, revision: modelRevision },
      },
      objects: [
        {
          objectId: 'warzone-terrain',
          sourceId: 'warzone-world',
          role: 'world-base',
          resourceIds: ['warzone-height-grid'],
          ...policy(worldUri, worldRevision),
        },
        {
          objectId: 'm3-model',
          sourceId: 'starcraft-model',
          role: 'model-overlay',
          resourceIds: ['m3-geometry'],
          ...policy(modelUri, modelRevision),
        },
      ],
      resources: [
        {
          resourceId: 'warzone-height-grid',
          sourceId: 'warzone-world',
          logicalId: 'multiplay/maps/mixed/game.map#terrain',
          ...policy(worldUri, worldRevision),
        },
        {
          resourceId: 'm3-geometry',
          sourceId: 'starcraft-model',
          logicalId: 'triangle.m3#geometry',
          ...policy(modelUri, modelRevision),
        },
      ],
      overlayPlacements: [
        {
          placementId: 'm3-on-warzone-terrain',
          objectId: 'm3-model',
          transform: {
            schemaVersion: 1,
            source: {
              coordinateSpaceId: 'm3-model-native',
              basis: {
                handedness: 'right',
                upAxis: 'y',
                forwardAxis: '-z',
                unit: 'source-unit',
                sourceUnit: 'm3-model-unit',
              },
              origin: [0, 0, 0],
            },
            target: {
              coordinateSpaceId: snapshot.uvwTransform.targetCoordinateSpaceId,
              basis: snapshot.uvwTransform.basis,
              origin: snapshot.uvwTransform.heightfield.origin,
            },
            axes: {
              x: { sourceAxis: 'x', direction: -1 },
              y: { sourceAxis: 'y', direction: 1 },
              z: { sourceAxis: 'z', direction: -1 },
            },
            scale: [64, 64, 64],
            translation: [64, 2, 128],
            evidence: {
              kind: 'owner-declared',
              reference: 'fixture-pinned M3-to-Warzone visual placement',
            },
          },
        },
      ],
    })
    const opened: string[] = []
    const sources: ViewerSources = {
      get(binding) {
        opened.push(binding.contract)
        return Promise.resolve(
          binding.contract === 'common.view/world-scene-source' ? worldLease : modelLease,
        ) as never
      },
      getUnknown: () => Promise.resolve(undefined),
    }
    const retained: Lease<unknown>[] = []
    const slot = selected.presentation.slots[0]
    if (slot === undefined) throw new Error('mixed visual presentation slot is missing')
    try {
      const rendered = await loadMixedVisualStage(sources, slot, {
        lease(value) {
          retained.push(value)
          return value
        },
      })
      expect(opened.sort()).toEqual([
        'common.view/model-scene-source',
        'common.view/world-scene-source',
      ])
      expect(rendered.world.info.mapId).toBe('multiplay/maps/mixed')
      expect(rendered.model.info).toMatchObject({ geometryAccess: 'decoded', primitives: 1 })
      expect(rendered.overlays).toHaveLength(1)
      expect(rendered.overlays[0]?.primitive.positions.length).toBeGreaterThan(0)
      expect(
        rendered.workspace.objects.map(object => object.provenance.subject.subjectUri),
      ).toEqual([worldUri, modelUri])
      expect(
        rendered.workspace.resources.every(resource => resource.license.state === 'unknown'),
      ).toBe(true)
      expect(rendered.workspace.compatibility).toMatchObject({
        mode: 'visual-only',
        definitionCompatible: false,
        runtimeCompatible: false,
        nativeExportable: false,
      })
      expect(JSON.stringify(rendered.workspace)).not.toContain(repoRoot)
    } finally {
      await Promise.all(retained.map(item => item.release()))
      await m3Session.dispose()
    }
  })
})
