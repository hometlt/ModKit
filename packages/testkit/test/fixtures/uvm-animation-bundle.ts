import { uint64 } from '@modkit/core'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { createHostTopology, type JsonObject, type ResourceBudget } from '@modkit/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createHostComposition,
  createHostServiceResolver,
  createExecutionBackendRegistry,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
} from '@modkit/host'
import { rendering3d } from '../../../scene/src/module.js'
import { appendUvmAccessors } from '../../../uv/src/model/accessor-write.js'
import {
  writeUvmContainer,
  readUvmContainer,
  type UvmContainer,
} from '../../../uv/src/model/container.js'
import { materialProgramCases } from './scene-material-program.js'
import { materializeUvmAnimationMaterialTargets } from '../../../uv/src/model/animation-clips.js'

export const animationBudget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}
export const animationRenderRequest = {
  schemaVersion: 1,
  viewport: { width: 32, height: 32 },
  camera: { viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.5, -0.5, 0, 1] },
  materialContext: { ambient: [0, 0, 0, 0] },
  rendererId: 'modkit.headless',
}
export function needed<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing animation fixture value')
  return value
}
export function record(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('fixture object missing')
  return value as JsonObject
}
export function records(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) throw new Error('fixture array missing')
  return value.map(record)
}
function json(value: unknown): JsonObject {
  return record(snapshotJson(value, { maxDepth: 64, maxNodes: 100000, maxBytes: 10000000 }))
}
export function animationFixtureBase(): UvmContainer {
  const material = needed(materialProgramCases().find(item => item.name === 'channel-1')).material
  const diffuse = needed(material.layers.diffuse)
  const appended = appendUvmAccessors(
    {
      format: 'glb',
      binary: new Uint8Array(),
      extraChunks: [{ type: 0x12345678, bytes: Uint8Array.of(4, 3, 2, 1) }],
      document: json({
        asset: {
          version: '2.0',
          extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } },
        },
        buffers: [{ byteLength: 0 }],
        extensionsUsed: [
          'UV_asset',
          'UV_provenance',
          'UV_game_animation_clips',
          'UV_game_material',
        ],
        extensions: {
          UV_asset: { id: 'fixture/animation-base', class: 'prop' },
          UV_provenance: {
            source: { format: 'fixture' },
            importer: { id: 'fixture', version: '1' },
          },
          UV_game_animation_clips: {
            clips: [{ id: 'base-empty', name: 'Base', durationSeconds: 1, sourceSequenceIndex: 0 }],
          },
        },
        extras: { retained: { base: ['opaque', 17] } },
        nodes: [{ name: 'unmapped' }, { name: 'target', mesh: 0 }],
        scenes: [{ nodes: [0, 1] }],
        scene: 0,
        materials: [
          {
            doubleSided: true,
            extensions: {
              UV_game_material: {
                shader: 'modkit.render-material.v1',
                params: {
                  renderModel: {
                    version: 1,
                    standard: {
                      ...material,
                      twoSided: true,
                      unshaded: true,
                      layers: { diffuse: { ...diffuse, constantColor: { value: [1, 0, 0, 1] } } },
                    },
                  },
                },
              },
            },
          },
        ],
      }),
    },
    [
      { type: 'VEC3', values: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) },
      { type: 'VEC3', values: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1) },
      { type: 'VEC2', values: Float32Array.of(0, 0, 1, 0, 0, 1) },
    ],
  )
  return readUvmContainer(
    writeUvmContainer({
      ...appended.container,
      document: {
        ...appended.container.document,
        meshes: [
          {
            primitives: [
              {
                attributes: {
                  POSITION: needed(appended.accessors[0]),
                  NORMAL: needed(appended.accessors[1]),
                  TEXCOORD_0: needed(appended.accessors[2]),
                },
                material: 0,
              },
            ],
          },
        ],
      },
    }),
  )
}
export function animationFixtureBundle(includeTrs = false): UvmContainer {
  const base = animationFixtureBase()
  const appended = appendUvmAccessors(base, [
    { type: 'SCALAR', values: Float32Array.of(0, 1) },
    { type: 'SCALAR', values: Float32Array.of(1, 0) },
    { type: 'VEC3', values: Float32Array.of(0, 0, 0, 1, 2, 3) },
  ])
  const material = needed(records(base.document['materials'])[0])
  const game = record(record(material['extensions'])['UV_game_material'])
  const params = record(game['params']),
    model = record(params['renderModel']),
    standard = record(model['standard'])
  const layers = record(standard['layers']),
    diffuse = record(layers['diffuse'])
  const time = needed(appended.accessors[0]),
    visibility = needed(appended.accessors[1]),
    translation = needed(appended.accessors[2])
  return readUvmContainer(
    writeUvmContainer({
      ...appended.container,
      document: {
        ...appended.container.document,
        extras: { sourcePrivate: { retained: [19, 'all metadata'] } },
        extensionsUsed: [
          'UV_asset',
          'UV_provenance',
          'UV_game_material',
          'UV_game_animation_clips',
          'UV_game_variants',
          'KHR_animation_pointer',
        ],
        extensions: {
          ...record(base.document['extensions']),
          UV_asset: { id: 'fixture/animation-bundle', class: 'animation' },
          UV_game_variants: { visibility: [{ mesh: 0, primitive: 0, value: 1 }] },
          UV_game_animation_clips: {
            clips: [
              {
                id: 'visibility',
                sourceId: 'native-visibility',
                name: 'Visibility',
                durationSeconds: 1,
                sourceSequenceIndex: 10,
                animation: 0,
                frames: 2,
              },
              {
                id: 'material-only',
                sourceId: 'native-material',
                name: 'Material',
                durationSeconds: 1,
                sourceSequenceIndex: 11,
              },
              { id: 'truly-empty', name: 'Empty', durationSeconds: 3, sourceSequenceIndex: 12 },
            ],
          },
        },
        materials: [
          {
            ...material,
            extensions: {
              UV_game_material: {
                ...game,
                params: {
                  ...params,
                  renderModel: {
                    ...model,
                    standard: {
                      ...standard,
                      layers: {
                        ...layers,
                        diffuse: {
                          ...diffuse,
                          constantColor: {
                            value: [1, 0, 0, 1],
                            sequenceTracks: [
                              {
                                sequenceIndex: 11,
                                track: {
                                  lineType: 1,
                                  globalSeqId: null,
                                  keys: [
                                    { frame: 0, vector: [1, 0, 0, 1] },
                                    { frame: 1, vector: [0, 1, 0, 1] },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
        animations: [
          {
            name: 'Visibility',
            extras: { uv: { sourceSequenceIndex: 10 } },
            samplers: [
              { input: time, output: visibility, interpolation: 'STEP' },
              ...(includeTrs
                ? [{ input: time, output: translation, interpolation: 'LINEAR' }]
                : []),
            ],
            channels: [
              {
                sampler: 0,
                target: {
                  path: 'pointer',
                  extensions: {
                    KHR_animation_pointer: {
                      pointer: '/extensions/UV_game_variants/visibility/0/value',
                    },
                  },
                },
              },
              ...(includeTrs ? [{ sampler: 1, target: { node: 0, path: 'translation' } }] : []),
            ],
          },
        ],
      },
    }),
  )
}
export function animationFixtureInactiveBundle(): UvmContainer {
  const source = animationFixtureBundle()
  const material = needed(records(source.document['materials'])[0])
  const shader = record(record(material['extensions'])['UV_game_material'])
  const materialTargets = materializeUvmAnimationMaterialTargets([
    {
      id: 'inactive-material',
      shader: {
        id: 'modkit.render-material.v1',
        parameters: record(shader['params']),
      },
    },
  ])
  const extensions = record(source.document['extensions'])
  const catalog = record(extensions['UV_game_animation_clips'])
  // These fields are deliberately absent: material slots do not manufacture renderable objects.
  const document = Object.fromEntries(
    Object.entries(source.document).filter(
      ([key]) => !['animations', 'materials', 'meshes', 'nodes', 'scenes', 'scene'].includes(key),
    ),
  )
  return readUvmContainer(
    writeUvmContainer({
      ...source,
      document: json({
        ...document,
        extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_animation_clips'],
        extensions: {
          UV_asset: extensions['UV_asset'],
          UV_provenance: extensions['UV_provenance'],
          UV_game_animation_clips: {
            ...catalog,
            clips: records(catalog['clips']).filter(clip => clip['animation'] === undefined),
            materialTargets,
          },
        },
      }),
    }),
  )
}
export async function animationFixtureServices() {
  const linked = linkedExtensionInputs([rendering3d])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  const realmId = 'modkit.test/uvm-animation-attachment'
  const composition = await createHostComposition({
    realmId,
    executionBackends,
    extensions: linked.inputs,
    topology: createHostTopology({
      schemaVersion: 1,
      topologyId: realmId,
      realms: [
        {
          schemaVersion: 1,
          realmId,
          revision: '1',
          target: { environment: 'node', operatingSystem: 'linux', architecture: 'x64' },
          facilities: [],
          budgets: {
            maxConcurrentTasks: 2,
            maxWorkerCount: 0,
            maxResidentBytes: uint64('134217728'),
            maxTransferBytes: uint64('16777216'),
            defaultDeadlineMs: 10000,
          },
          policy: { id: 'modkit.test/animation-policy', revision: '1' },
        },
      ],
      links: [],
    }),
  })
  const definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
  return createHostServiceResolver({
    ...composition,
    definitions,
    grant: { id: 'animation-render', classes: [] },
    budgets: animationBudget,
  })
}
