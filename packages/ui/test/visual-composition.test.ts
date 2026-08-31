import { describe, expect, it } from 'vitest'
import {
  defineMixedVisualWorkspace,
  revisionId,
  type Lease,
  type ModelSceneSource,
  type ViewerSources,
  type VisualAssetPolicy,
  type VisualCoordinateFrame,
  type VisualTransformReceipt,
} from '@modkit/sdk'
import type {
  WorldSceneInfo,
  WorldScenePage,
  WorldScenePageRequest,
  WorldSceneSource,
} from '@modkit/sdk/maps'
import {
  drawMixedVisualWorkspace,
  loadMixedVisualStage,
  transformVisualPrimitive,
} from '@modkit/ui/composition'

const worldRevision = revisionId('content-hash.sha256:world')
const modelRevision = revisionId('content-hash.sha256:model')
const worldFrame: VisualCoordinateFrame = {
  coordinateSpaceId: 'uvw-canonical',
  basis: {
    handedness: 'right',
    upAxis: 'y',
    forwardAxis: '+z',
    unit: 'meter',
    unitsPerCell: 1,
  },
  origin: [0, 0, 0],
}
const receipt: VisualTransformReceipt = {
  schemaVersion: 1,
  source: {
    coordinateSpaceId: 'model-native',
    basis: {
      handedness: 'left',
      upAxis: 'z',
      forwardAxis: '+y',
      unit: 'source-unit',
      sourceUnit: 'asset-unit',
    },
    origin: [1, 2, 3],
  },
  target: worldFrame,
  axes: {
    x: { sourceAxis: 'x', direction: 1 },
    y: { sourceAxis: 'z', direction: 1 },
    z: { sourceAxis: 'y', direction: 1 },
  },
  scale: [2, 3, 4],
  translation: [10, 20, 30],
  evidence: { kind: 'owner-declared', reference: 'test placement' },
}

function policy(uri: string, revision: ReturnType<typeof revisionId>): VisualAssetPolicy {
  return {
    provenance: {
      sourceIdentity: `${uri}#root`,
      subject: { subjectUri: uri, revision },
      originUri: uri,
    },
    license: { state: 'declared', expression: 'LicenseRef-Local-Game-Asset' },
    redistribution: { state: 'restricted', reason: 'local view only' },
  }
}

function workspace() {
  const worldUri = 'subject://family-a/world'
  const modelUri = 'subject://family-b/model'
  return defineMixedVisualWorkspace({
    workspaceId: 'ui-proof',
    workspaceUri: 'workspace://ui-proof',
    workspaceRevision: revisionId('content-hash.sha256:workspace'),
    worldFrame,
    world: {
      sourceId: 'world-source',
      originGroup: 'family-a',
      role: 'world-base',
      subject: { subjectUri: worldUri, revision: worldRevision },
    },
    model: {
      sourceId: 'model-source',
      originGroup: 'family-b',
      role: 'model-overlay',
      subject: { subjectUri: modelUri, revision: modelRevision },
    },
    objects: [
      {
        objectId: 'world-root',
        sourceId: 'world-source',
        role: 'world-base',
        resourceIds: [],
        ...policy(worldUri, worldRevision),
      },
      {
        objectId: 'model-root',
        sourceId: 'model-source',
        role: 'model-overlay',
        resourceIds: [],
        ...policy(modelUri, modelRevision),
      },
    ],
    resources: [],
    overlayPlacements: [{ placementId: 'overlay', objectId: 'model-root', transform: receipt }],
  })
}

const uvwTransform = {
  schemaVersion: 1 as const,
  snapshotId: 'snapshot',
  sourceCoordinateSpaceId: 'map-native',
  targetCoordinateSpaceId: 'uvw-canonical' as const,
  basis: worldFrame.basis,
  axes: {
    x: { sourceAxis: 'x' as const, scale: 1, offset: 0 },
    y: { sourceAxis: 'z' as const, scale: 1, offset: 0 },
    z: { sourceAxis: 'y' as const, scale: -1, offset: 0 },
  },
  heightfield: {
    columns: 1,
    rows: 1,
    cellSize: 1,
    origin: [0, 0, 0] as const,
    sourceRowOrder: 'reverse' as const,
  },
  bounds: {
    coordinateSpaceId: 'uvw-canonical' as const,
    minimum: { x: 0, y: 0, z: 0 },
    maximum: { x: 1, y: 1, z: 1 },
  },
  proof: {
    kind: 'adapter-qualification' as const,
    method: 'official-reference-differential' as const,
    oracle: 'fixture',
    corpus: 'fixture',
    sourceDigests: { fixture: `sha256:${'a'.repeat(64)}` as const },
    tupleCount: 1,
    comparison: 'ieee-754-binary64-exact' as const,
    nativeTupleDigest: `sha256:${'b'.repeat(64)}` as const,
    canonicalTupleDigest: `sha256:${'c'.repeat(64)}` as const,
  },
}

const layer = {
  facet: 'layers' as const,
  id: 'terrain-layer',
  layerId: 'terrain-layer',
  kind: 'terrain' as const,
  state: 'available' as const,
  itemCount: 1,
  lods: ['exact'],
}

const worldInfo: WorldSceneInfo = {
  contract: 'common.view/world-scene-source',
  major: 1,
  maturity: 'publisher-candidate',
  snapshotId: 'snapshot',
  mapId: 'world',
  coordinateSpaces: [],
  crossSpaceTransforms: [],
  bounds: [],
  uvwTransform,
  facets: [
    {
      facet: 'terrain',
      layerId: 'terrain-layer',
      state: 'available',
      itemCount: 1,
      lods: ['exact'],
    },
  ],
  provenance: [],
  unknownFacets: [],
  lossPolicy: 'explicit-partial',
  complete: true,
}

const worldSource: WorldSceneSource = {
  contract: 'common.view/world-scene-source',
  major: 1,
  snapshotId: 'snapshot',
  info: () => Promise.resolve(worldInfo),
  page(request: WorldScenePageRequest): Promise<WorldScenePage> {
    return Promise.resolve(
      request.facet === 'layers'
        ? { snapshotId: 'snapshot', facet: 'layers', state: 'available', items: [layer] }
        : {
            snapshotId: 'snapshot',
            facet: 'terrain',
            state: 'available',
            items: [
              {
                facet: 'terrain',
                id: 'terrain:0',
                layerId: 'terrain-layer',
                coordinateSpaceId: 'height-grid',
                lod: 'exact',
                x: 0,
                y: 0,
                heightBase: 0,
                heightAdjustment: 0,
                mask: 0,
                uvwPosition: { x: 0, y: 0, z: 0 },
              },
            ],
          },
    )
  },
}

const modelSource: ModelSceneSource = {
  info: () =>
    Promise.resolve({
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded',
    }),
  nodes: () => Promise.resolve({ items: [] }),
  meshes: () => Promise.resolve({ items: [{ id: 'mesh', primitiveIds: ['primitive'] }] }),
  primitive: () =>
    Promise.resolve({
      id: 'primitive',
      topology: 'lines',
      positions: new Float32Array([1, 2, 3, 2, 2, 3]),
      indices: new Uint32Array([0, 1]),
    }),
}

function lease<T>(value: T): Lease<T> {
  return { value, release: () => Promise.resolve() }
}

describe('shared mixed visual viewer pipeline', () => {
  it('applies only the explicit axes, origin, scale and translation receipt', () => {
    const primitive = transformVisualPrimitive(
      {
        id: 'primitive',
        topology: 'points',
        positions: new Float32Array([1, 2, 3, 2, 4, 6]),
        normals: new Float32Array([1, 0, 0, 0, 1, 0]),
      },
      receipt,
    )
    expect([...primitive.positions]).toEqual([10, 20, 30, 12, 29, 38])
    expect([...(primitive.normals ?? [])]).toEqual([1, 0, 0, 0, 0, 1])
    expect(primitive.bounds).toEqual({ min: [10, 20, 30], max: [12, 29, 38] })
  })

  it('opens shared world/model bindings and produces a visual-only render snapshot', async () => {
    const selected = workspace()
    const slot = selected.presentation.slots[0]
    if (slot === undefined) throw new Error('fixture mixed visual slot is missing')
    const opened: string[] = []
    const sources: ViewerSources = {
      get(binding) {
        opened.push(binding.contract)
        return Promise.resolve(
          binding.contract === 'common.view/world-scene-source'
            ? lease(worldSource)
            : binding.contract === 'common.view/model-scene-source'
              ? lease(modelSource)
              : undefined,
        ) as never
      },
      getUnknown: () => Promise.resolve(undefined),
    }
    const retained: Lease<unknown>[] = []
    const snapshot = await loadMixedVisualStage(sources, slot, {
      lease(value) {
        retained.push(value)
        return value
      },
    })
    expect(opened.sort()).toEqual([
      'common.view/model-scene-source',
      'common.view/world-scene-source',
    ])
    expect(retained).toHaveLength(2)
    expect(snapshot.workspace.compatibility).toMatchObject({
      mode: 'visual-only',
      runtimeCompatible: false,
      nativeExportable: false,
    })
    const overlay = snapshot.overlays[0]
    if (overlay === undefined) throw new Error('fixture rendered overlay is missing')
    expect([...overlay.primitive.positions]).toEqual([10, 20, 30, 12, 20, 30])

    const calls: string[] = []
    const context = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      clearRect: () => calls.push('clear'),
      fillRect: () => calls.push('terrain'),
      beginPath: () => calls.push('begin'),
      arc: () => calls.push('object'),
      fill: () => calls.push('fill'),
      moveTo: () => calls.push('move'),
      lineTo: () => calls.push('line'),
      stroke: () => calls.push('stroke'),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement
    drawMixedVisualWorkspace(canvas, snapshot)
    expect([canvas.width, canvas.height]).toEqual([720, 480])
    expect(calls).toEqual(['clear', 'terrain', 'begin', 'move', 'line', 'stroke'])
  })

  it('refuses a world without a validated canonical transform', async () => {
    const selected = workspace()
    const slot = selected.presentation.slots[0]
    if (slot === undefined) throw new Error('fixture mixed visual slot is missing')
    const badWorld = {
      ...worldSource,
      info: () => Promise.resolve({ ...worldInfo, uvwTransform: undefined }),
    }
    const sources: ViewerSources = {
      get(binding) {
        return Promise.resolve(
          binding.contract === 'common.view/world-scene-source'
            ? lease(badWorld)
            : lease(modelSource),
        ) as never
      },
      getUnknown: () => Promise.resolve(undefined),
    }
    await expect(loadMixedVisualStage(sources, slot, { lease: value => value })).rejects.toThrow(
      /requires a validated map-to-UVW transform/u,
    )
  })
})
