import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  defineMixedVisualWorkspace,
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type Lease,
  type ResourceBudget,
  type ViewerSources,
  type VisualAssetPolicy,
  type WorldSceneSource,
} from '@modkitx-x3/sdk'
import { loadMixedVisualStage } from '@modkitx-x3/ui/composition'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { createCodec: createGltfCodec } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'models', 'src', 'gltf', 'codec.js')).href
)) as { createCodec(context: ContributionContext): Codec }
const modelFixture = join(import.meta.dirname, 'fixtures', 'mk2-synthetic', 'minimal.gltf')
const worldRevision = revisionId('content-hash.sha256:neutral-world')
const modelRevision = revisionId('content-hash.sha256:neutral-model')
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
      throw new Error('mixed visual fixture has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('mixed visual fixture has no foreign service dependency')
    },
  },
}

function modelInput(bytes: Uint8Array): AssetInput {
  const uri = 'memory://mixed-visual/triangle.gltf'
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
      compositionFingerprint: 'mixed-visual-model',
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
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
    license: { state: 'unknown', reason: 'synthetic fixture' },
    redistribution: { state: 'allowed', basis: 'synthetic fixture', attributionRequired: false },
  }
}

function worldLease(): Lease<WorldSceneSource> {
  const snapshotId = 'neutral-world-snapshot'
  return {
    value: {
      contract: 'common.view/world-scene-source',
      major: 1,
      snapshotId,
      async info() {
        return {
          contract: 'common.view/world-scene-source',
          major: 1,
          maturity: 'publisher-candidate',
          snapshotId,
          mapId: 'synthetic-grid',
          coordinateSpaces: [],
          crossSpaceTransforms: [],
          bounds: [],
          uvwTransform: {
            schemaVersion: 1,
            snapshotId,
            sourceCoordinateSpaceId: 'fixture-native',
            targetCoordinateSpaceId: 'uvw-canonical',
            basis: {
              handedness: 'right',
              upAxis: 'y',
              forwardAxis: '-z',
              unit: 'source-unit',
              sourceUnit: 'fixture-unit',
            },
            axes: {
              x: { sourceAxis: 'x', scale: 1, offset: 0 },
              y: { sourceAxis: 'y', scale: 1, offset: 0 },
              z: { sourceAxis: 'z', scale: 1, offset: 0 },
            },
            heightfield: {
              columns: 2,
              rows: 2,
              cellSize: 1,
              origin: [0, 0, 0],
              sourceRowOrder: 'forward',
            },
            bounds: {
              coordinateSpaceId: 'uvw-canonical',
              minimum: { x: 0, y: 0, z: 0 },
              maximum: { x: 1, y: 1, z: 1 },
            },
            proof: {
              kind: 'adapter-qualification',
              method: 'official-reference-differential',
              oracle: 'synthetic fixture',
              corpus: 'synthetic fixture',
              sourceDigests: { fixture: `sha256:${'a'.repeat(64)}` },
              tupleCount: 3,
              comparison: 'ieee-754-binary64-exact',
              nativeTupleDigest: `sha256:${'b'.repeat(64)}`,
              canonicalTupleDigest: `sha256:${'c'.repeat(64)}`,
            },
          },
          facets: [
            {
              facet: 'terrain',
              layerId: 'terrain',
              state: 'available',
              itemCount: 3,
              lods: ['exact'],
            },
          ],
          provenance: [],
          unknownFacets: [],
          lossPolicy: 'explicit-partial',
          complete: true,
        }
      },
      async page(request) {
        return {
          snapshotId,
          facet: request.facet,
          state: request.facet === 'terrain' ? 'available' : 'unsupported',
          items:
            request.facet === 'terrain'
              ? [
                  {
                    facet: 'terrain',
                    id: 'a',
                    layerId: 'terrain',
                    coordinateSpaceId: 'neutral',
                    x: 0,
                    y: 0,
                    height: 0,
                    lod: 'exact',
                  },
                  {
                    facet: 'terrain',
                    id: 'b',
                    layerId: 'terrain',
                    coordinateSpaceId: 'neutral',
                    x: 1,
                    y: 0,
                    height: 0,
                    lod: 'exact',
                  },
                  {
                    facet: 'terrain',
                    id: 'c',
                    layerId: 'terrain',
                    coordinateSpaceId: 'neutral',
                    x: 0,
                    y: 1,
                    height: 0,
                    lod: 'exact',
                  },
                ]
              : [],
        } as never
      },
    },
    release: async () => undefined,
  }
}

describe('neutral mixed visual composition', () => {
  it('loads a synthetic world and common glTF through one visual-only pipeline', async () => {
    const modelSession = await createGltfCodec(context).open(
      modelInput(new Uint8Array(await readFile(modelFixture))),
      'inspect',
      budget,
    )
    const modelLease = await modelSession.dataSource('common.view/model-scene-source', 1)
    const world = worldLease()
    const worldUri = 'memory://mixed-visual/world'
    const modelUri = 'memory://mixed-visual/triangle.gltf'
    const selected = defineMixedVisualWorkspace({
      workspaceId: 'neutral-world-model',
      workspaceUri: 'workspace://mixed-visual/neutral',
      workspaceRevision: revisionId('content-hash.sha256:neutral-workspace'),
      worldFrame: {
        coordinateSpaceId: 'uvw-canonical',
        basis: {
          handedness: 'right',
          upAxis: 'y',
          forwardAxis: '-z',
          unit: 'source-unit',
          sourceUnit: 'fixture-unit',
        },
        origin: [0, 0, 0],
      },
      world: {
        sourceId: 'world',
        originGroup: 'org.example/world',
        role: 'world-base',
        subject: { subjectUri: worldUri, revision: worldRevision },
      },
      model: {
        sourceId: 'model',
        originGroup: 'org.example/model',
        role: 'model-overlay',
        subject: { subjectUri: modelUri, revision: modelRevision },
      },
      objects: [
        {
          objectId: 'terrain',
          sourceId: 'world',
          role: 'world-base',
          resourceIds: ['grid'],
          ...policy(worldUri, worldRevision),
        },
        {
          objectId: 'triangle',
          sourceId: 'model',
          role: 'model-overlay',
          resourceIds: ['geometry'],
          ...policy(modelUri, modelRevision),
        },
      ],
      resources: [
        {
          resourceId: 'grid',
          sourceId: 'world',
          logicalId: 'grid#terrain',
          ...policy(worldUri, worldRevision),
        },
        {
          resourceId: 'geometry',
          sourceId: 'model',
          logicalId: 'triangle.gltf#geometry',
          ...policy(modelUri, modelRevision),
        },
      ],
      overlayPlacements: [
        {
          placementId: 'triangle-on-grid',
          objectId: 'triangle',
          transform: {
            schemaVersion: 1,
            source: {
              coordinateSpaceId: 'model',
              basis: {
                handedness: 'right',
                upAxis: 'y',
                forwardAxis: '-z',
                unit: 'source-unit',
                sourceUnit: 'fixture-unit',
              },
              origin: [0, 0, 0],
            },
            target: {
              coordinateSpaceId: 'uvw-canonical',
              basis: {
                handedness: 'right',
                upAxis: 'y',
                forwardAxis: '-z',
                unit: 'source-unit',
                sourceUnit: 'fixture-unit',
              },
              origin: [0, 0, 0],
            },
            axes: {
              x: { sourceAxis: 'x', direction: 1 },
              y: { sourceAxis: 'y', direction: 1 },
              z: { sourceAxis: 'z', direction: 1 },
            },
            scale: [1, 1, 1],
            translation: [0, 0, 0],
            evidence: { kind: 'owner-declared', reference: 'synthetic identity placement' },
          },
        },
      ],
    })
    const opened: string[] = []
    const sources: ViewerSources = {
      get(binding) {
        opened.push(binding.contract)
        return Promise.resolve(
          binding.contract === 'common.view/world-scene-source' ? world : modelLease,
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
      expect(rendered.world.info.mapId).toBe('synthetic-grid')
      expect(rendered.model.info).toMatchObject({ geometryAccess: 'decoded', primitives: 1 })
      expect(rendered.overlays).toHaveLength(1)
      expect(rendered.workspace.compatibility).toMatchObject({
        mode: 'visual-only',
        definitionCompatible: false,
        runtimeCompatible: false,
        nativeExportable: false,
      })
      expect(JSON.stringify(rendered.workspace)).not.toContain(repoRoot)
    } finally {
      await Promise.all(retained.map(item => item.release()))
      await modelSession.dispose()
    }
  })
})
