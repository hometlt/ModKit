import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import { contractId } from '@modkit/core'
import {
  buildInventory,
  createHostContributionContractRegistry,
  offersFromInventory,
} from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type ModelSceneSource,
  type ModelMaterialSource,
  type ModelSkeletonSource,
  type ModelAnimationSource,
  type ProviderRequest,
  type ResourceBudget,
} from '@modkit/sdk'
import { runMinimalHost } from '@modkit/testkit'
import { materializeUvmCore, packUvmGlb } from '../../uv/src/model/materializer.js'
import type { ModelProjection } from '../../uv/src/model/materializer.js'
import { createModelSkeletonNodes, createModelPoseSampler } from '@modkit/codec-kit/model/skeleton'
import { loadUvTools } from '@modkit/testkit'
import { drainModelProjection } from '@modkit/testkit'
import { createModelMaterialSource, createModelSceneSource } from '@modkit/codec-kit'
import { createProvider as createUvmMaterializer } from '../../uv/src/model/provider.js'
import { readUvmContainer, writeUvmContainer } from '../../uv/src/model/container.js'
import {
  animationFixtureBundle,
  animationFixtureInactiveBundle,
} from './fixtures/uvm-animation-bundle.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const modelsDir = join(repoRoot, 'extensions', 'models')
const uvmEntrypoint = join(modelsDir, 'src', 'uvm', 'codec.js')
const m3UvmFixture = join(here, 'fixtures', 'uvm', 'm3-triangle.uvm.glb.b64')
const loadedUvmCodec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href))

beforeAll(async () => {
  // First descriptor construction loads shared validation infrastructure. Keep cold host setup
  // outside each semantic assertion's unchanged five-second limit.
  const session = await loadedUvmCodec
    .createCodec(context)
    .open(inputFor(byteSource(minimalUvm())), 'full', budget)
  await session.dispose()
})

it('recognizes a named UVM with its profile beyond the probe and still validates the full profile', async () => {
  const codec = loadedUvmCodec.createCodec(context)
  const base = readUvmContainer(minimalUvm())
  const bytes = packUvmGlb(
    { extras: { future: 'x'.repeat(70_000) }, ...base.document },
    base.binary,
  )
  const source = byteSource(bytes)
  const plan = {
    kind: 'bytes' as const,
    ranges: [{ from: 'start' as const, length: 65536 }],
    maxBytes: 65536,
  }
  const detected = await codec.probe({ source, plan })
  expect(detected).toMatchObject({
    confidence: 0.98,
    evidence: [{ kind: 'extension', note: 'uvm-named-partial-glb' }],
  })
  const session = await codec.open(inputFor(source), 'full', budget)
  try {
    expect(await session.descriptor()).toMatchObject({ identity: { codecId: 'modkit/model-uvm' } })
  } finally {
    await session.dispose()
  }
  const unnamed = { ...source, ref: { ...source.ref, uri: 'memory://fixture/model.glb' } }
  expect((await codec.probe({ source: unnamed, plan })).confidence).toBe(0.01)
  const invalid = byteSource(
    packUvmGlb(
      { extras: { future: 'x'.repeat(70_000) }, ...base.document, asset: { version: '2.0' } },
      base.binary,
    ),
  )
  expect((await codec.probe({ source: invalid, plan })).confidence).toBe(0.98)
  await expect(codec.open(inputFor(invalid), 'full', budget)).rejects.toThrow('asset.extras')
})

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const request: ProviderRequest = {
  contract: {
    contract: contractId('common.model/scene-metadata'),
    major: 1,
    range: '*',
  },
  target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
  pin: {
    providerId: 'modkit/model-uvm',
    runtimeVariant: 'trusted-node',
    offerId: 'uvm-scene',
  },
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('UVM core codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('UVM core codec has no foreign service dependency')
    },
  },
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let cursor = 0
  for (const part of parts) {
    result.set(part, cursor)
    cursor += part.byteLength
  }
  return result
}

function le32(value: number): Uint8Array {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, true)
  return result
}

function pad4(bytes: Uint8Array, fill: number): Uint8Array {
  const result = new Uint8Array((bytes.byteLength + 3) & ~3)
  result.fill(fill)
  result.set(bytes)
  return result
}

function glbChunk(type: number, payload: Uint8Array): Uint8Array {
  return concat(le32(payload.byteLength), le32(type), payload)
}

function minimalUvm(
  binaryPadding = 0,
  collision = false,
  collisionSize: readonly [number, number, number] = [2, 3, 4],
  teamColorOperation?: string,
  materialSnapshotVersion?: number,
  effects = false,
  pointerTarget = '/extensions/UV_game_effects/particles/0/emissionRate',
  effectLineType: number | undefined = 2,
  effectScope: string | undefined = 'global',
  effectGlobalSeqId: number | null | undefined = 4,
): Uint8Array {
  const binary = new Uint8Array((effects ? 112 : 80) + binaryPadding)
  const view = new DataView(binary.buffer)
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]
  const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1]
  positions.forEach((value, index) => view.setFloat32(index * 4, value, true))
  normals.forEach((value, index) => view.setFloat32(36 + index * 4, value, true))
  ;[0, 1, 2].forEach((value, index) => view.setUint16(72 + index * 2, value, true))
  if (effects) {
    view.setFloat32(80, 0, true)
    view.setFloat32(84, 1, true)
    ;[0, 8, 4, 4, 16, 0].forEach((value, index) => view.setFloat32(88 + index * 4, value, true))
  }
  const materialExtensions = {
    ...(teamColorOperation === undefined
      ? {}
      : {
          UV_game_material_team_color: {
            maskSource: 'whole',
            targets: ['baseColor'],
            blend: 'multiply',
            extras: {
              renderModel: { target: 'team-color', operation: teamColorOperation },
            },
          },
        }),
    ...(materialSnapshotVersion === undefined
      ? {}
      : {
          UV_game_material: {
            shader: 'modkit.render-material.v1',
            params: {
              renderModel: {
                version: materialSnapshotVersion,
                standard: { layers: {}, blendMode: 0 },
              },
            },
          },
        }),
  }
  const document = {
    asset: {
      version: '2.0',
      generator: 'modkit UVM convergence fixture',
      extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } },
    },
    extensionsUsed: [
      'UV_asset',
      'UV_provenance',
      ...(collision ? ['UV_game_collision'] : []),
      ...(teamColorOperation === undefined ? [] : ['UV_game_material_team_color']),
      ...(materialSnapshotVersion === undefined ? [] : ['UV_game_material']),
      ...(effects ? ['UV_game_effects', 'KHR_animation_pointer'] : []),
    ],
    extensions: {
      UV_asset: { id: 'corpus/a2-a3-triangle', class: 'prop', coreRenderable: true },
      UV_provenance: {
        source: { format: 'obj', file: 'triangle.obj' },
        importer: { id: 'modkit/uvm-writer', version: '0.1.0' },
        lost: [],
      },
      ...(effects
        ? {
            UV_game_effects: {
              profile: 'common',
              trackTimeUnit: 'seconds',
              particles: [
                {
                  name: 'Smoke',
                  node: 0,
                  material: 0,
                  emitShape: 'sphere',
                  emissionRate: 8,
                  lifeSpan: 1,
                  speed: 2,
                  gravity: -1,
                  orientationMode: 'billboard',
                  maxParticles: 64,
                },
              ],
              ribbons: [],
              forces: [],
              warps: [],
              projectors: [],
            },
          }
        : {}),
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'Triangle',
        mesh: 0,
        ...(collision
          ? {
              extensions: {
                UV_game_collision: {
                  shapes: [{ kind: 'box', size: collisionSize, collisionMask: 3 }],
                },
              },
            }
          : {}),
      },
    ],
    meshes: [
      {
        name: 'Triangle Mesh',
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'UVM Default',
        ...(Object.keys(materialExtensions).length > 0 ? { extensions: materialExtensions } : {}),
      },
    ],
    ...(effects
      ? {
          animations: [
            {
              name: 'Effect animation',
              samplers: [{ input: 3, output: 4, interpolation: 'CUBICSPLINE' }],
              extras: {
                uv: {
                  ...(effectScope === undefined ? {} : { effectTrackScope: effectScope }),
                  ...(effectGlobalSeqId === undefined ? {} : { globalSeqId: effectGlobalSeqId }),
                },
              },
              channels: [
                {
                  sampler: 0,
                  extras: {
                    uv: {
                      ...(effectLineType === undefined ? {} : { sourceLineType: effectLineType }),
                    },
                  },
                  target: {
                    path: 'pointer',
                    extensions: { KHR_animation_pointer: { pointer: pointerTarget } },
                  },
                },
              ],
            },
          ],
        }
      : {}),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      ...(effects
        ? [
            { bufferView: 3, componentType: 5126, count: 2, type: 'SCALAR' },
            { bufferView: 4, componentType: 5126, count: 6, type: 'SCALAR' },
          ]
        : []),
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
      ...(effects
        ? [
            { buffer: 0, byteOffset: 80, byteLength: 8 },
            { buffer: 0, byteOffset: 88, byteLength: 24 },
          ]
        : []),
    ],
    buffers: [{ byteLength: binary.byteLength }],
  }
  const json = pad4(new TextEncoder().encode(JSON.stringify(document)), 0x20)
  const jsonChunk = glbChunk(0x4e4f534a, json)
  const binaryChunk = glbChunk(0x004e4942, binary)
  const length = 12 + jsonChunk.byteLength + binaryChunk.byteLength
  return concat(le32(0x46546c67), le32(2), le32(length), jsonChunk, binaryChunk)
}

function byteSource(bytes: Uint8Array, label = 'triangle'): ArtifactByteSource {
  const uri = `memory://uvm-convergence/${label}.uvm.glb`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:uvm-a2-a3-${label}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('cancelled')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source: ArtifactByteSource): AssetInput {
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
      compositionFingerprint: 'uvm-a2-a3-triangle',
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function readBase64Fixture(path: string): Promise<Uint8Array> {
  const encoded = (await readFile(path, 'utf8')).replace(/\s+/g, '')
  return new Uint8Array(Buffer.from(encoded, 'base64'))
}

function asCodecModule(value: Record<string, unknown>): {
  readonly createCodec: (context: ContributionContext) => Codec
} {
  if (typeof value['createCodec'] !== 'function') {
    throw new TypeError('activated UVM contribution does not export createCodec')
  }
  return value as { readonly createCodec: (context: ContributionContext) => Codec }
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('required fixture value is absent')
  return value
}

function rigProjection(): ModelProjection {
  const matrix = (x: number, y: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1]
  const skeleton = [
    {
      partId: 'native',
      boneIndex: 42,
      parentBoneIndex: null,
      boneName: 'Root',
      provenance: 'direct' as const,
      hierarchyId: 'native-rig',
      nodeId: 'node-2',
      inverseBindMatrix: matrix(-3, 0),
      localPose: {
        translation: [3, 0, 0] as const,
        rotation: [0, 0, 0, 1] as const,
        scale: [1, 1, 1] as const,
      },
    },
    {
      partId: 'native',
      boneIndex: 9,
      parentBoneIndex: 42,
      boneName: null,
      provenance: 'direct' as const,
      hierarchyId: 'native-rig',
      nodeId: 'node-1',
      inverseBindMatrix: matrix(-3, -2),
      localPose: {
        translation: [0, 2, 0] as const,
        rotation: [0, 0, 0, 1] as const,
        scale: [1, 1, 1] as const,
      },
    },
  ]
  return {
    info: {
      scenes: 1,
      nodes: 3,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 1,
      geometryAccess: 'decoded',
    },
    nodes: [
      { id: 'node-0', childIds: [], meshIds: ['mesh-0'], transform: matrix(0, 0) },
      ...createModelSkeletonNodes(skeleton, 'native-rig'),
    ],
    meshes: [{ id: 'mesh-0', primitiveIds: ['mesh-0-primitive-0'] }],
    primitives: [
      {
        id: 'mesh-0-primitive-0',
        topology: 'triangles',
        hierarchyId: 'native-rig',
        positions: new Float32Array([3, 2, 0, 4, 2, 0, 3, 3, 0]),
        boneIndices: new Uint32Array([9, 42, 9, 42, 9, 42, 9, 42, 9, 42, 9, 42]),
        boneWeights: new Float32Array([0.75, 0.25, 0, 0, 0.75, 0.25, 0, 0, 0.75, 0.25, 0, 0]),
      },
    ],
    skeleton,
    animations: [
      {
        id: 'native-walk',
        name: 'Walk',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        durationSeconds: 2,
        looping: false,
        hierarchyId: 'native-rig',
        channels: [
          {
            target: 'node-2',
            kind: 'translation',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'linear',
            samples: [
              { frame: 0, timeSeconds: 0, value: [3, 0, 0] },
              { frame: 1, timeSeconds: 1, value: [5, 0, 0] },
            ],
          },
          {
            target: 'node-1',
            kind: 'rotation',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'spherical-linear',
            concurrent: true,
            wrapSeconds: 0.5,
            samples: [
              { frame: 0, timeSeconds: 0, value: [0, 0, 0, 1] },
              { frame: 1, timeSeconds: 1, value: [0, 0, 1, 0] },
            ],
          },
          {
            target: 'node-1',
            kind: 'scale',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'step',
            samples: [
              { frame: 0, timeSeconds: 0, value: [1, 1, 1] },
              { frame: 1, timeSeconds: 1, value: [2, 2, 2] },
            ],
          },
        ],
      },
    ],
  }
}

const rigRequest = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: revisionId('provider-token:uvm-rig'),
  options: { assetId: 'fixture/rig', sourceFormat: 'facets' },
}

describe('UVM convergence through A-2 inventory and A-3 sessions', () => {
  it.each([
    ['catalog-only', animationFixtureInactiveBundle, 0, 2],
    ['mixed linked and channel-less', animationFixtureBundle, 1, 3],
  ] as const)(
    'publishes consistent selectable animation counts and traits for %s UVM',
    async (_name, fixture, rawCount, clipCount) => {
      const container = fixture()
      const raw = container.document['animations']
      expect(Array.isArray(raw) ? raw.length : 0).toBe(rawCount)
      const bytes = writeUvmContainer(container)
      const session = await loadedUvmCodec
        .createCodec(context)
        .open(inputFor(byteSource(bytes)), 'full', budget)
      try {
        const descriptor = await session.descriptor()
        expect(descriptor.traits).toContainEqual(
          expect.objectContaining({
            id: 'model.animations',
            parameters: { count: clipCount },
          }),
        )
        const scene = await session.dataSource('common.view/model-scene-source', 1)
        try {
          const animation = await session.dataSource('common.view/model-animation-source', 1)
          try {
            const info = await (scene.value as ModelSceneSource).info()
            const clips = await (animation.value as ModelAnimationSource).clips({ limit: 10 })
            expect(info.animations).toBe(clipCount)
            expect(clips.items).toHaveLength(clipCount)
            expect(clips.items.map(clip => clip.sequenceIndex)).toEqual(
              rawCount === 0 ? [11, 12] : [10, 11, 12],
            )
            expect(clips.items.filter(clip => clip.channels.length === 0)).toHaveLength(2)
            expect(writeUvmContainer(container)).toEqual(bytes)
          } finally {
            await animation.release()
          }
        } finally {
          await scene.release()
        }
      } finally {
        await session.dispose()
      }
    },
  )
  it('preserves skin matrices and sampled motion across materialize and ordinary UVM reopen', async () => {
    const projection = rigProjection()
    const written = materializeUvmCore(projection, rigRequest)
    expect(written.document.skins).toHaveLength(1)
    expect(required(written.document.skins)[0]).toMatchObject({ joints: [1, 2], skeleton: 2 })
    expect(required(written.document.nodes[0]).skin).toBe(0)
    expect(required(written.document.nodes[1]).name).toBeUndefined()
    expect(written.document.animations).toHaveLength(1)
    expect(materializeUvmCore(projection, rigRequest).bytes).toEqual(written.bytes)
    const validator = (await import(
      pathToFileURL(
        join(
          repoRoot,
          '..',
          'references',
          'modkitmk2',
          'node_modules',
          '.pnpm',
          'gltf-validator@2.0.0-dev.3.10',
          'node_modules',
          'gltf-validator',
          'module.mjs',
        ),
      ).href
    )) as {
      validateBytes(
        bytes: Uint8Array,
        options: { uri: string },
      ): Promise<{ issues: { numErrors: number; messages: unknown[] } }>
    }
    const validation = await validator.validateBytes(written.bytes, { uri: 'rig.uvm.glb' })
    expect(validation.issues.numErrors, JSON.stringify(validation.issues.messages)).toBe(0)
    const codec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href)).createCodec(
      context,
    )
    const session = await codec.open(inputFor(byteSource(written.bytes)), 'full', budget)
    try {
      const scene = await session.dataSource('common.view/model-scene-source', 1)
      const skeleton = await session.dataSource('common.view/model-skeleton-source', 1)
      const animation = await session.dataSource('common.view/model-animation-source', 1)
      try {
        const restored = await drainModelProjection(scene.value as ModelSceneSource, {
          skeletonSource: skeleton.value as ModelSkeletonSource,
          animationSource: animation.value as ModelAnimationSource,
        })
        expect(restored.skeleton).toHaveLength(2)
        const restoredSkeleton = required(restored.skeleton)
        const restoredClip = required(required(restored.animations)[0])
        const sourceClip = required(required(projection.animations)[0])
        const restoredPrimitive = required(required(restored.primitives)[0])
        const sourcePrimitive = required(required(projection.primitives)[0])
        expect(required(restoredSkeleton[0]).boneName).toBeNull()
        expect(restoredClip).toMatchObject({
          name: 'Walk',
          durationSeconds: 2,
          looping: false,
        })
        expect(restoredClip.channels).toEqual(sourceClip.channels)
        expect(restoredPrimitive.boneIndices).toEqual(
          new Uint32Array([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]),
        )
        expect(restoredPrimitive.boneWeights).toEqual(sourcePrimitive.boneWeights)
        const native = createModelPoseSampler({
          bindings: required(projection.skeleton),
          hierarchyId: 'native-rig',
          clip: sourceClip,
        })
        const artifact = createModelPoseSampler({
          bindings: restoredSkeleton,
          hierarchyId: 'skin-0',
          clip: restoredClip,
        })
        for (const time of [-1, 0, 0.25, 0.5, 0.75, 1, 2.25]) {
          const matrices = (sample: ReturnType<typeof native.sample>) =>
            sample.bones.map(({ nodeId, worldMatrix, skinningMatrix }) => ({
              nodeId,
              worldMatrix,
              skinningMatrix,
            }))
          expect(matrices(artifact.sample(time)), `pose at ${time}`).toEqual(
            matrices(native.sample(time)),
          )
        }
        const rewritten = materializeUvmCore(restored, rigRequest)
        expect(rewritten.document.skins).toEqual(written.document.skins)
        expect(rewritten.binary).toEqual(written.binary)
      } finally {
        await scene.release()
        await skeleton.release()
        await animation.release()
      }
    } finally {
      await session.dispose()
    }
  })

  it('refuses ambiguous rigs and reports unsupported animation instead of guessing', () => {
    const projection = rigProjection()
    const withoutInverse = required(projection.skeleton).map(bone => {
      const result = { ...bone }
      delete result.inverseBindMatrix
      return result
    })
    expect(() =>
      materializeUvmCore({ ...projection, skeleton: withoutInverse }, rigRequest),
    ).toThrow('inverse bind')
    const sourcePrimitive = required(required(projection.primitives)[0])
    const badJoint = { ...sourcePrimitive, boneIndices: new Uint32Array(12).fill(99) }
    expect(() => materializeUvmCore({ ...projection, primitives: [badJoint] }, rigRequest)).toThrow(
      'unknown joint',
    )
    const badWeights = { ...sourcePrimitive, boneWeights: new Float32Array(12) }
    expect(() =>
      materializeUvmCore({ ...projection, primitives: [badWeights] }, rigRequest),
    ).toThrow('sum to one')
    const missingParent = required(projection.skeleton).map(bone =>
      bone.boneIndex === 9 ? { ...bone, parentBoneIndex: 999 } : bone,
    )
    expect(() =>
      materializeUvmCore({ ...projection, skeleton: missingParent }, rigRequest),
    ).toThrow('parent')
    const clip = required(required(projection.animations)[0])
    const result = materializeUvmCore(
      {
        ...projection,
        animations: [
          {
            ...clip,
            channels: [
              ...clip.channels,
              { target: 'node-1', kind: 'visibility', firstFrame: 0, lastFrame: 0 },
            ],
          },
        ],
      },
      rigRequest,
    )
    expect(result.document.animations).toHaveLength(1)
    expect(result.receipt.lostFacetIds).toContain('common.view/model-animation-source@1')
    expect(result.receipt.diff).toContainEqual(
      expect.objectContaining({
        path: '/animations/native-walk/channels/3',
        note: 'visibility channel has no explicit primitive target or scalar sampling semantics',
      }),
    )
  })

  it('groups independent skin roots without adding bones and normalizes glTF directions with receipts', async () => {
    const source = rigProjection()
    const skeleton = required(source.skeleton).map(bone => ({ ...bone, parentBoneIndex: null }))
    const normals = new Float32Array([0, 0, 2, 0, 0, 2, 0, 0, 2])
    const tangents = new Float32Array([
      0.003, 0.003, 0.003, 1, 0.003, 0.003, 0.003, 1, 0.003, 0.003, 0.003, 1,
    ])
    const projection = {
      ...source,
      skeleton,
      nodes: [
        required(required(source.nodes)[0]),
        ...createModelSkeletonNodes(skeleton, 'native-rig'),
      ],
      primitives: [{ ...required(required(source.primitives)[0]), normals, tangents }],
    }
    const written = materializeUvmCore(projection, rigRequest)
    const writtenSkin = required(required(written.document.skins)[0])
    expect(writtenSkin.joints).toEqual([1, 2])
    expect(writtenSkin.skeleton).toBe(3)
    expect(written.document.nodes[3]).toEqual({ children: [1, 2] })
    expect(required(written.document.scenes[0]).nodes).toEqual([0, 3])
    expect(written.receipt.diff).toContainEqual(
      expect.objectContaining({ change: 'absent-in-live', path: '/nodes/node-3' }),
    )
    expect(
      written.receipt.diff.filter(item => item.note?.includes('directions normalized')),
    ).toHaveLength(2)
    expect(normals[2]).toBe(2)
    const codec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href)).createCodec(
      context,
    )
    const session = await codec.open(inputFor(byteSource(written.bytes)), 'full', budget)
    try {
      const scene = await session.dataSource('common.view/model-scene-source', 1)
      const bones = await session.dataSource('common.view/model-skeleton-source', 1)
      const clips = await session.dataSource('common.view/model-animation-source', 1)
      try {
        const restored = await drainModelProjection(scene.value as ModelSceneSource, {
          skeletonSource: bones.value as ModelSkeletonSource,
          animationSource: clips.value as ModelAnimationSource,
        })
        expect(required(restored.skeleton).map(bone => bone.parentBoneIndex)).toEqual([null, null])
        const restoredPrimitive = required(required(restored.primitives)[0])
        expect(restoredPrimitive.normals).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]))
        expect(Math.hypot(...required(restoredPrimitive.tangents).slice(0, 3))).toBeCloseTo(1, 6)
        const second = materializeUvmCore(restored, rigRequest)
        expect(second.document.nodes).toEqual(written.document.nodes)
        expect(second.document.skins).toEqual(written.document.skins)
        expect(second.binary).toEqual(written.binary)
      } finally {
        await scene.release()
        await bones.release()
        await clips.release()
      }
    } finally {
      await session.dispose()
    }
  })

  it('refuses malformed skin and animation accessors and aggregate scalar budget overflow', async () => {
    const written = materializeUvmCore(rigProjection(), rigRequest)
    const codec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href)).createCodec(
      context,
    )
    const invalid = [
      { ...written.document, skins: [{ joints: [1, 1], inverseBindMatrices: 0 }] },
      { ...written.document, skins: [{ joints: [999], inverseBindMatrices: 0 }] },
      { ...written.document, skins: [{ joints: [1, 2], inverseBindMatrices: 1 }] },
      { ...written.document, skins: [{ joints: [1, 2], inverseBindMatrices: 0, skeleton: 0 }] },
      {
        ...written.document,
        nodes: written.document.nodes.map((node, index) =>
          index === 2 ? { ...node, children: [] } : node,
        ),
      },
    ]
    for (const document of invalid)
      await expect(
        codec.open(inputFor(byteSource(packUvmGlb(document, written.binary))), 'full', budget),
      ).rejects.toThrow(/UVM/u)
    const samplers = required(required(written.document.animations)[0])['samplers'] as {
      input: number
      output: number
    }[]
    const timeAccessor = required(written.document.accessors[required(samplers[0]).input])
    const duplicateTime = written.binary.slice()
    new DataView(duplicateTime.buffer).setFloat32(
      required(written.document.bufferViews[timeAccessor.bufferView]).byteOffset + 4,
      0,
      true,
    )
    await expect(
      codec.open(inputFor(byteSource(packUvmGlb(written.document, duplicateTime))), 'full', budget),
    ).rejects.toThrow('strictly increasing')
    const rotationAccessor = required(written.document.accessors[required(samplers[1]).output])
    const badRotation = written.binary.slice()
    const rotationOffset = required(
      written.document.bufferViews[rotationAccessor.bufferView],
    ).byteOffset
    badRotation.fill(0, rotationOffset, rotationOffset + 16)
    await expect(
      codec.open(inputFor(byteSource(packUvmGlb(written.document, badRotation))), 'full', budget),
    ).rejects.toThrow('quaternion')
    await expect(
      codec.open(inputFor(byteSource(written.bytes)), 'full', { ...budget, maxScalarBytes: 200 }),
    ).rejects.toThrow(/budget|maxScalarBytes/u)
  })

  it('reads a cubic-spline clip with its tangents without a catalog or a rest-pose label', async () => {
    const written = materializeUvmCore(rigProjection(), rigRequest)
    const document = structuredClone(written.document)
    // Exercise timeline inference from raw glTF samplers, without the source clip's declared duration.
    delete document.extensions.UV_game_animation_clips
    document.extensionsUsed = document.extensionsUsed.filter(
      extension => extension !== 'UV_game_animation_clips',
    )
    expect(document.extensions.UV_game_animation_clips).toBeUndefined()
    const samplers = required(required(document.animations)[0])['samplers'] as { input: number }[]
    const sampler = required(samplers[0])
    const cubic = new Float32Array(18)
    cubic.set([3, 0, 0], 3)
    cubic.set([5, 0, 0], 12)
    const binary = concat(written.binary, new Uint8Array(cubic.buffer))
    const output = document.accessors.length
    document.accessors.push({
      bufferView: document.bufferViews.length,
      componentType: 5126,
      count: 6,
      type: 'VEC3',
    })
    document.bufferViews.push({
      buffer: 0,
      byteOffset: written.binary.length,
      byteLength: cubic.byteLength,
    })
    required(document.buffers[0]).byteLength = binary.length
    document.animations = [
      {
        name: 'Cubic motion',
        samplers: [{ input: sampler.input, output, interpolation: 'CUBICSPLINE' }],
        channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }],
      },
    ]
    const codec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href)).createCodec(
      context,
    )
    const session = await codec.open(
      inputFor(byteSource(packUvmGlb(document, binary))),
      'full',
      budget,
    )
    try {
      const animation = await session.dataSource('common.view/model-animation-source', 1)
      try {
        expect(
          (await (animation.value as ModelAnimationSource).clips({ limit: 1 })).items[0],
        ).toMatchObject({
          kind: 'animation',
          frames: 2,
          durationSeconds: 1,
          channels: [
            {
              kind: 'translation',
              target: 'node-2',
              interpolation: 'cubic-spline',
              samples: [
                { frame: 0, value: [3, 0, 0], inTangent: [0, 0, 0], outTangent: [0, 0, 0] },
                { frame: 1, value: [5, 0, 0], inTangent: [0, 0, 0], outTangent: [0, 0, 0] },
              ],
            },
          ],
        })
      } finally {
        await animation.release()
      }
    } finally {
      await session.dispose()
    }
  })

  it('retains local TRS and hierarchy on open and materialize/reopen', async () => {
    const tools = await loadUvTools(repoRoot)
    const unpacked = tools.uvmCore.unpackGlb(minimalUvm())
    const document = unpacked.document as { nodes: object[]; scenes: object[] }
    document.nodes = [
      { mesh: 0, translation: [10, 20, 30], children: [1] },
      { rotation: [0, 0, 1, 0], scale: [2, 3, 4], children: [2] },
      {},
    ]
    document.scenes = [{ nodes: [0] }]
    const codec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href)).createCodec(
      context,
    )
    const read = async (bytes: Uint8Array) => {
      const session = await codec.open(inputFor(byteSource(bytes, 'node-trs')), 'full', budget)
      try {
        const lease = await session.dataSource('common.view/model-scene-source', 1)
        try {
          return await drainModelProjection(lease.value as ModelSceneSource)
        } finally {
          await lease.release()
        }
      } finally {
        await session.dispose()
      }
    }
    const projection = await read(packUvmGlb(document, unpacked.binary))
    expect(projection.nodes).toMatchObject([
      {
        id: 'node-0',
        childIds: ['node-1'],
        meshIds: ['mesh-0'],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1],
      },
      {
        id: 'node-1',
        childIds: ['node-2'],
        transform: [-2, 0, 0, 0, 0, -3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1],
      },
      { id: 'node-2', childIds: [], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    ])
    const written = materializeUvmCore(projection, {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: revisionId('provider-token:uvm-trs'),
      options: { assetId: 'fixture/uvm-trs', sourceFormat: 'uvm' },
    })
    tools.uvmCore.assertUvmCore(written.document)
    expect((await read(written.bytes)).nodes).toEqual(projection.nodes)
  })

  it.each([
    { matrix: [1, 2, 3] },
    { translation: [1, 2] },
    { translation: null },
    { rotation: [0, 0, 0, 0] },
    { scale: ['1', 1, 1] },
    { scale: [1e100, 1, 1] },
    { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], translation: [0, 0, 0] },
  ])('refuses an invalid node transform without replacing it with identity: %j', async node => {
    const tools = await loadUvTools(repoRoot)
    const unpacked = tools.uvmCore.unpackGlb(minimalUvm())
    const document = unpacked.document as { nodes: object[] }
    document.nodes = [{ mesh: 0, ...node }]
    const codec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href)).createCodec(
      context,
    )
    await expect(
      codec.open(inputFor(byteSource(packUvmGlb(document, unpacked.binary))), 'full', budget),
    ).rejects.toThrow(/UVM node/u)
  })

  it('exports complete material facets through the provider and reopens shader and native metadata', async () => {
    const primitive = {
      id: 'mesh-0-primitive-0',
      topology: 'triangles' as const,
      materialId: 'material-0',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    }
    const scene = createModelSceneSource({
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 3,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'node-0',
          childIds: [],
          meshIds: ['mesh-0'],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      ],
      meshes: [{ id: 'mesh-0', primitiveIds: [primitive.id] }],
      primitives: [primitive],
    })
    const standard = {
      blendMode: 2,
      layers: {
        diffuse: {
          texturePath: 'Assets/Unit.dds',
          uvSource: 2,
          uvOffset: {
            value: [0, 0],
            sequenceTracks: [
              {
                sequenceIndex: 1,
                concurrent: true,
                wrapSeconds: 1.5,
                track: {
                  lineType: 1,
                  globalSeqId: null,
                  keys: [
                    { frame: 0, vector: [0, 0] },
                    { frame: 1.5, vector: [1, 0] },
                  ],
                },
              },
            ],
          },
        },
      },
    }
    const materials = [
      {
        id: 'material-0',
        name: 'Unit',
        type: 'standard',
        blendMode: 'additive',
        priority: 3,
        nativeFlags: 9,
        flagNames: ['two-sided'],
        libraryId: 'shared',
        layers: [
          {
            slot: 'diffuse',
            resourceId: 'Assets/Unit.dds',
            uvSource: 2,
            colorChannels: 1,
            nativeFlags: 12,
            flagNames: ['uv-wrap-x', 'uv-wrap-y'],
          },
        ],
        shader: {
          id: 'modkit.render-material.v1',
          parameters: { renderModel: { version: 1, standard } },
        },
      },
      {
        id: 'material-1',
        name: 'Unused composite',
        type: 'composite',
        shader: {
          id: 'modkit.render-material.v1',
          parameters: {
            renderModel: {
              version: 1,
              composite: {
                priority: 7,
                passes: [
                  { material: standard, alphaFactor: { value: 0.25 } },
                  { material: standard, alphaFactor: { value: 0.75 } },
                ],
              },
            },
          },
        },
      },
      {
        id: 'material-2',
        name: '',
        alphaMode: 'mask' as const,
        alphaCutoff: 0.375,
        shader: { id: 'example/custom.v3', parameters: { tint: [1, 0.5, 0] } },
      },
    ]
    const projection = await drainModelProjection(scene, {
      materialSource: createModelMaterialSource({ materials }),
    })
    expect(projection.materials).toHaveLength(3)
    const request = {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: revisionId('provider-token:material-roundtrip'),
      options: { assetId: 'fixture/materials', sourceFormat: 'm3' },
    }
    const provider = await createUvmMaterializer({ offerId: 'uvm-core-materializer-v1' })
    const written = await provider.value.materialize(projection, request)
    await expect(
      provider.value.materialize({ ...projection, materials: [] }, request),
    ).rejects.toThrow('count')
    await provider.release()
    const tools = await loadUvTools(repoRoot)
    tools.uvmCore.assertUvmCore(written.document)
    expect(written.document.materials).toHaveLength(3)
    expect(required(required(written.document.materials)[2])).toMatchObject({
      alphaMode: 'MASK',
      alphaCutoff: 0.375,
    })
    expect(written.document.extensionsUsed).toContain('UV_game_material')
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, item]) => [key, reverseKeys(item)]),
            )
          : value
    expect(
      materializeUvmCore(
        { ...projection, materials: reverseKeys([...materials].reverse()) as typeof materials },
        request,
      ).bytes,
    ).toEqual(written.bytes)
    const codec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href)).createCodec(
      context,
    )
    const session = await codec.open(inputFor(byteSource(written.bytes)), 'full', budget)
    try {
      const lease = await session.dataSource('common.view/model-material-source', 1)
      try {
        const restored = await (lease.value as ModelMaterialSource).materials({ limit: 10 })
        expect(restored.items).toEqual([
          { ...materials[0], contracts: ['UV_game_material/standard'] },
          { ...materials[1], contracts: ['UV_game_material/composite'] },
          materials[2],
        ])
        const frozenLayer = required(required(required(restored.items[0]).layers)[0])
        expect(() => {
          ;(frozenLayer as { uvSource: number }).uvSource = 8
        }).toThrow(TypeError)
      } finally {
        await lease.release()
      }
    } finally {
      await session.dispose()
    }
    expect(() =>
      materializeUvmCore(projection, request, {
        materialBudget: { maxDepth: 64, maxNodes: 100_000, maxBytes: 32 },
      }),
    ).toThrow('maxBytes')
    expect(() =>
      materializeUvmCore({ ...projection, materials: [required(materials[0])] }, request),
    ).toThrow('count')
    expect(() =>
      materializeUvmCore(
        {
          ...projection,
          materials: [required(materials[0]), required(materials[0]), required(materials[2])],
        },
        request,
      ),
    ).toThrow('duplicate')
    expect(() =>
      materializeUvmCore(
        { ...projection, primitives: [{ ...primitive, materialId: 'absent' }] },
        request,
      ),
    ).toThrow('undefined material')
    expect(() => materializeUvmCore(projection, request, { signal: AbortSignal.abort() })).toThrow(
      'cancelled',
    )
    for (const [label, fields] of [
      ['shadow', { shader: {} }],
      ['bad-layer', { layers: [{ slot: 5 }] }],
    ] as const) {
      const malformed = structuredClone(written.document)
      required(required(malformed.materials)[0]).extras = {
        modkit: { material: { version: 1, fields: fields as never } },
      }
      await expect(
        codec.open(
          inputFor(byteSource(packUvmGlb(malformed, written.binary), label)),
          'full',
          budget,
        ),
      ).rejects.toThrow()
    }
    const foreign = materializeUvmCore(
      {
        ...projection,
        primitives: [{ ...primitive, materialId: 'material-00' }],
        materials: materials.map((material, index) =>
          index === 0 ? { ...material, id: 'material-00' } : material,
        ),
      },
      request,
    )
    expect(foreign.receipt.diff).toContainEqual(
      expect.objectContaining({
        facetId: 'common.view/model-material-source@1',
        path: '/materials/*/id',
      }),
    )
  })

  it('materializes and reopens all UV sets, tangents and colors without changing vertex values', async () => {
    const primitive = {
      id: 'mesh-0-primitive-0',
      topology: 'triangles' as const,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      tangents: new Float32Array([1, 0, 0, -1, 1, 0, 0, 1, 1, 0, 0, -1]),
      colors: new Float32Array([1, 0.5, 0, 1, 0, 1, 0.5, 1, 0.5, 0, 1, 1]),
      textureCoordinates: new Float32Array([0, 0, 1, 0, 0, 1]),
      textureCoordinateSets: Array.from({ length: 5 }, (_, set) => ({
        set,
        coordinates: new Float32Array([0, 0, 1 + set / 8, 0, 0, 1 + set / 8]),
      })),
    }
    const projection = {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 0,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded' as const,
      },
      nodes: [
        {
          id: 'node-0',
          childIds: [],
          meshIds: ['mesh-0'],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      ],
      meshes: [{ id: 'mesh-0', primitiveIds: [primitive.id] }],
      primitives: [primitive],
    }
    const materialization = {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: revisionId('provider-token:vertex-attributes'),
      options: { assetId: 'fixture/vertex-attributes', sourceFormat: 'm3' },
    }
    const written = materializeUvmCore(projection, materialization)
    const tools = await loadUvTools(repoRoot)
    tools.uvmCore.assertUvmCore(written.document)
    expect(materializeUvmCore(projection, materialization).bytes).toEqual(written.bytes)
    // Input set ordering must not affect deterministic accessor/buffer order.
    expect(
      materializeUvmCore(
        {
          ...projection,
          primitives: [
            { ...primitive, textureCoordinateSets: [...primitive.textureCoordinateSets].reverse() },
          ],
        },
        materialization,
      ).bytes,
    ).toEqual(written.bytes)
    const codec = asCodecModule(await import(pathToFileURL(uvmEntrypoint).href)).createCodec(
      context,
    )
    await expect(
      codec.open(inputFor(byteSource(written.bytes)), 'full', { ...budget, maxScalarBytes: 150 }),
    ).rejects.toThrow(/exceeds maxScalarBytes/u)
    const session = await codec.open(inputFor(byteSource(written.bytes)), 'full', budget)
    try {
      const lease = await session.dataSource('common.view/model-scene-source', 1)
      try {
        const scene = lease.value as ModelSceneSource
        if (scene.primitive === undefined) throw new Error('fixture scene lacks primitive access')
        const restored = await scene.primitive(primitive.id, {
          maxBytes: budget.maxScalarBytes,
        })
        for (const key of [
          'positions',
          'indices',
          'normals',
          'tangents',
          'colors',
          'textureCoordinates',
          'textureCoordinateSets',
        ] as const)
          expect(restored[key]).toEqual(primitive[key])
      } finally {
        await lease.release()
      }
    } finally {
      await session.dispose()
    }
    expect(() =>
      materializeUvmCore(
        {
          ...projection,
          primitives: [
            { ...primitive, textureCoordinateSets: [required(primitive.textureCoordinateSets[4])] },
          ],
        },
        materialization,
      ),
    ).toThrow('consecutive')
    expect(() =>
      materializeUvmCore(
        { ...projection, primitives: [{ ...primitive, colors: new Float32Array(4) }] },
        materialization,
      ),
    ).toThrow('VEC4')
    expect(() =>
      materializeUvmCore(
        {
          ...projection,
          primitives: [{ ...primitive, textureCoordinates: new Float32Array(6).fill(9) }],
        },
        materialization,
      ),
    ).toThrow('conflicting UV')
    const skin = materializeUvmCore(
      {
        ...projection,
        primitives: [
          { ...primitive, boneIndices: new Uint32Array(12), boneWeights: new Float32Array(12) },
        ],
      },
      materialization,
    )
    expect(skin.receipt.diff).toContainEqual(
      expect.objectContaining({
        path: `/primitives/${primitive.id}/skin`,
        change: 'absent-in-artifact',
      }),
    )

    // glTF permits normalized integer UVs/colors and RGB colors with implicit alpha one.
    const document = structuredClone(written.document)
    const binary = written.binary.slice()
    const mesh = required(required(document.meshes)[0])
    const attributes = required(required(mesh.primitives)[0]).attributes
    const color = required(document.accessors[required(attributes['COLOR_0'])])
    const colorView = required(document.bufferViews[color.bufferView])
    Object.assign(color, { componentType: 5121, normalized: true, type: 'VEC3' })
    colorView.byteLength = 9
    binary.set([255, 128, 0, 0, 255, 128, 128, 0, 255], colorView.byteOffset)
    const uv = required(document.accessors[required(attributes['TEXCOORD_0'])])
    const uvView = required(document.bufferViews[uv.bufferView])
    Object.assign(uv, { componentType: 5123, normalized: true })
    uvView.byteLength = 12
    const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
    ;[0, 0, 65535, 0, 0, 65535].forEach((value, index) =>
      data.setUint16(uvView.byteOffset + index * 2, value, true),
    )
    const normalizedSession = await codec.open(
      inputFor(byteSource(packUvmGlb(document, binary))),
      'full',
      budget,
    )
    try {
      const lease = await normalizedSession.dataSource('common.view/model-scene-source', 1)
      try {
        const scene = lease.value as ModelSceneSource
        if (scene.primitive === undefined) throw new Error('fixture scene lacks primitive access')
        const restored = await scene.primitive(primitive.id, {
          maxBytes: budget.maxScalarBytes,
        })
        expect(restored.colors).toEqual(
          new Float32Array([1, 128 / 255, 0, 1, 0, 1, 128 / 255, 1, 128 / 255, 0, 1, 1]),
        )
        expect(restored.textureCoordinates).toEqual(primitive.textureCoordinates)
      } finally {
        await lease.release()
      }
    } finally {
      await normalizedSession.dispose()
    }
  })

  it('resolves, tickets and activates the isolated UVM contribution deterministically', async () => {
    const grant = { id: 'uvm-smoke-grant', classes: ['read-source'] as const }
    const inventory = await buildInventory(
      [await loadExtensionDirectory(modelsDir)],
      createHostContributionContractRegistry(),
    )
    expect(inventory.diagnostics).toEqual([])
    const uvmContribution = inventory.extensions
      .flatMap(extension => extension.contributions)
      .find(contribution => contribution.manifest?.id === 'modkit/model-uvm')
    expect(uvmContribution?.diagnostics).toEqual([])
    expect(uvmContribution).toMatchObject({ inventoryEligible: true, activationEligible: true })
    expect(
      offersFromInventory(inventory).find(offer => offer.providerId === 'modkit/model-uvm'),
    ).toMatchObject({
      providerId: 'modkit/model-uvm',
      provides: [
        {
          offerId: 'uvm-scene',
          contract: 'common.model/scene-metadata',
          major: 1,
          version: '1.0.0',
        },
      ],
    })
    const run = await runMinimalHost({
      extensionDirs: [modelsDir],
      extensionExecution: { origin: 'bundled', allowTrustedInProcess: true },
      request,
      grant,
    })
    expect(run.result.state).toBe('resolved')
    if (run.result.state !== 'resolved') throw new TypeError('UVM provider did not resolve')
    expect(run.result.selected.offer).toMatchObject({
      providerId: 'modkit/model-uvm',
      runtimeVariant: 'trusted-node',
      provides: [
        {
          offerId: 'uvm-scene',
          contract: 'common.model/scene-metadata',
          major: 1,
          version: '1.0.0',
        },
      ],
    })
    expect(run.activation.variant).toMatchObject({
      variantId: 'trusted-node',
      entrypoint: './src/uvm/codec.js',
      executionProfile: 'trusted-in-process',
    })
    expect(run.activation.effectiveGrant.classes).toEqual(['read-source'])
    expect(
      run.inventory.extensions[0]?.contributions.find(
        contribution => contribution.manifest?.id === 'modkit/model-uvm',
      ),
    ).toMatchObject({ inventoryEligible: true, activationEligible: true })

    const again = await runMinimalHost({
      extensionDirs: [modelsDir],
      extensionExecution: { origin: 'bundled', allowTrustedInProcess: true },
      request,
      grant,
    })
    expect(again.lockText).toBe(run.lockText)

    const codec = asCodecModule(run.activation.module).createCodec(context)
    const m3ConvertedUvm = await readBase64Fixture(m3UvmFixture)
    expect(createHash('sha256').update(m3ConvertedUvm).digest('hex')).toBe(
      '1a386db0f6ce5f9b7a00db4484b9cd795877ddd284d6f6b654c45520e93b277a',
    )
    const source = byteSource(m3ConvertedUvm)
    const largeSource = byteSource(minimalUvm(70_000))
    const largeDetection = await codec.probe({
      source: largeSource,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 65536 }], maxBytes: 65536 },
    })
    expect(largeDetection.confidence).toBe(0.995)
    const detection = await codec.probe({
      source,
      plan: { kind: 'bytes', ranges: [{ from: 'start', length: 65536 }], maxBytes: 65536 },
    })
    expect(detection).toMatchObject({
      codecId: 'modkit/model-uvm',
      confidence: 0.995,
      evidence: [{ kind: 'structure', note: 'uvm-core-1.0' }],
    })

    const session = await codec.open(inputFor(source), 'full', budget)
    const descriptor = await session.descriptor()
    expect(descriptor).toMatchObject({
      schemaVersion: 2,
      subjectUri: source.ref.uri,
      interpretation: 'codec',
      identity: {
        codecId: 'modkit/model-uvm',
        formatId: 'uvm',
        formatLabel: 'Universal Verse Model 1.0',
      },
      origin: { kind: 'single' },
      dataSources: expect.arrayContaining([
        { contract: 'common.view/model-scene-source', major: 1 },
      ]),
    })
    expect(descriptor.traits.map(trait => trait.id)).toEqual(
      expect.arrayContaining(['model.geometry', 'scene.objects', 'structure.hierarchy']),
    )

    const modelLease = await session.dataSource('common.view/model-scene-source', 1)
    const model = modelLease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      scenes: 1,
      nodes: 2,
      meshes: 1,
      primitives: 1,
      animations: 1,
      geometryAccess: 'decoded',
    })
    const primitive = await model.primitive?.('mesh-0-primitive-0', { maxBytes: 1024 })
    expect(primitive?.positions).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    expect(primitive?.normals).toHaveLength(9)
    expect(primitive?.normals?.[2]).toBeCloseTo(1, 4)
    expect(primitive?.normals?.[5]).toBeCloseTo(1, 4)
    expect(primitive?.normals?.[8]).toBeCloseTo(1, 4)
    expect(primitive?.indices).toEqual(new Uint32Array([0, 1, 2]))
    await modelLease.release()

    const materialLease = await session.dataSource('common.view/model-material-source', 1)
    try {
      const materialSource = materialLease.value as ModelMaterialSource
      const materials = await materialSource.materials({ limit: 100 })
      const jsonLength = new DataView(m3ConvertedUvm.buffer, m3ConvertedUvm.byteOffset).getUint32(
        12,
        true,
      )
      const document = JSON.parse(
        new TextDecoder().decode(m3ConvertedUvm.subarray(20, 20 + jsonLength)),
      )
      const expected = document.materials[0].extensions.UV_game_material
      expect(materials.items[0]?.shader).toEqual({
        id: expected.shader,
        parameters: expected.params,
      })
      expect(Object.isFrozen(materials.items[0]?.shader?.parameters['renderModel'])).toBe(true)
    } finally {
      await materialLease.release()
    }

    expect(await session.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'uvm',
          profile: 'core',
          assetId: 'corpus/m3-triangle',
          sourceFormat: 'm3',
          primitives: 1,
          collisionShapes: 0,
          advancedMaterialContracts: 1,
          advancedMaterialKinds: { standard: 1, composite: 0 },
          losses: [{ code: 'M3_TEXTURES_UNRESOLVED', severity: 'warning' }],
        },
      },
    })
    await session.dispose()

    const collisionSource = byteSource(minimalUvm(0, true), 'collision-triangle')
    const collisionSession = await codec.open(inputFor(collisionSource), 'full', budget)
    expect(await collisionSession.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'uvm',
          primitives: 1,
          collisionShapes: 1,
          collisionKinds: { box: 1 },
        },
      },
    })
    await collisionSession.dispose()

    const invalidCollision = byteSource(
      minimalUvm(0, true, [-1, 2, 3]),
      'invalid-collision-triangle',
    )
    await expect(codec.open(inputFor(invalidCollision), 'full', budget)).rejects.toThrow(
      'invalid box extents',
    )

    const teamColorSource = byteSource(
      minimalUvm(0, false, [2, 3, 4], 'hsv-shade'),
      'team-colour-triangle',
    )
    const teamColorSession = await codec.open(inputFor(teamColorSource), 'full', budget)
    expect(await teamColorSession.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          teamColorMaterials: 1,
          teamColorOperations: { 'hsv-shade': 1 },
        },
      },
    })
    await teamColorSession.dispose()

    const invalidTeamColor = byteSource(
      minimalUvm(0, false, [2, 3, 4], 'execute-shader'),
      'invalid-team-colour-triangle',
    )
    await expect(codec.open(inputFor(invalidTeamColor), 'full', budget)).rejects.toThrow(
      'invalid neutral remap metadata',
    )

    const invalidMaterial = byteSource(
      minimalUvm(0, false, [2, 3, 4], undefined, 2),
      'invalid-material-triangle',
    )
    await expect(codec.open(inputFor(invalidMaterial), 'full', budget)).rejects.toThrow(
      'unsupported version',
    )

    const effectSource = byteSource(
      minimalUvm(0, false, [2, 3, 4], undefined, undefined, true),
      'effect-triangle',
    )
    const effectSession = await codec.open(inputFor(effectSource), 'full', budget)
    expect(await effectSession.operations().invoke('inspect', null)).toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          effects: 1,
          effectProfile: 'common',
          effectKinds: { particles: 1, ribbons: 0, forces: 0, warps: 0, projectors: 0 },
          animatedEffectProperties: 1,
        },
      },
    })
    await effectSession.dispose()

    const unsafePointer = byteSource(
      minimalUvm(0, false, [2, 3, 4], undefined, undefined, true, '/buffers/0/byteLength'),
      'unsafe-effect-pointer',
    )
    await expect(codec.open(inputFor(unsafePointer), 'full', budget)).rejects.toThrow(
      'pointer target is unsafe or unresolved',
    )

    const mismatchedInterpolation = byteSource(
      minimalUvm(
        0,
        false,
        [2, 3, 4],
        undefined,
        undefined,
        true,
        '/extensions/UV_game_effects/particles/0/emissionRate',
        1,
      ),
      'mismatched-effect-interpolation',
    )
    await expect(codec.open(inputFor(mismatchedInterpolation), 'full', budget)).rejects.toThrow(
      'sourceLineType does not match interpolation',
    )

    const missingGlobalSequence = byteSource(
      minimalUvm(
        0,
        false,
        [2, 3, 4],
        undefined,
        undefined,
        true,
        '/extensions/UV_game_effects/particles/0/emissionRate',
        2,
        'global',
        null,
      ),
      'missing-effect-global-sequence',
    )
    await expect(codec.open(inputFor(missingGlobalSequence), 'full', budget)).rejects.toThrow(
      'globalSeqId is invalid or missing',
    )
  })

  it('keeps the UVM activation bundle free of sibling model codecs', async () => {
    const result = await build({
      absWorkingDir: repoRoot,
      entryPoints: [uvmEntrypoint],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      packages: 'external',
      write: false,
      metafile: true,
      logLevel: 'silent',
    })
    const inputs = Object.keys(result.metafile?.inputs ?? {}).map(path =>
      path.replaceAll('\\', '/'),
    )
    expect(inputs.some(path => path.includes('/obj/'))).toBe(false)
    expect(inputs.some(path => path.includes('/gltf/'))).toBe(false)
    expect(inputs).toContain('extensions/models/src/uvm/codec.js')
  })
})
