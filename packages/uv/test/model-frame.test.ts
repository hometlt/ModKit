import { describe, expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { validateUvmDocument } from '../src/model/validation/index.js'
import { readUvmContainer, writeUvmContainer } from '../src/model/container.js'
import { removeUvmFrameWrappers, uvmSceneFrameMatrix } from '../src/model/frame.js'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = (options: object = {}) =>
  ({
    scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
    profile: 'UVM/core@1.0',
    subjectRevision: 'provider-token:frame',
    options: { assetId: 'fixture/frame', sourceFormat: 'm3', ...options },
  }) as never

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
// a render material that places its texture by world position (UV source 5), and one that does not
const projected = {
  id: 'projected',
  layers: [],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: { layers: { diffuse: { texturePath: 'decal', uvSource: 5 } } },
      },
    },
  },
}
const plain = {
  id: 'plain',
  layers: [],
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: { layers: { diffuse: { texturePath: 'skin', uvSource: 0 } } },
      },
    },
  },
}
const projection = (extra: object = {}, upAxis?: '+z', handedness?: 'left') =>
  ({
    info: {
      scenes: 1,
      nodes: 3,
      meshes: 1,
      primitives: 1,
      materials: 2,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded' as const,
      ...(upAxis === undefined ? {} : { upAxis }),
      ...(handedness === undefined ? {} : { handedness }),
    },
    nodes: [
      { id: 'body', childIds: ['tip', 'tail'], meshIds: ['mesh'], transform: identity },
      { id: 'tip', childIds: [], meshIds: [], transform: identity },
      { id: 'tail', childIds: [], meshIds: [], transform: identity },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles' as const,
        materialId: 'projected',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    materials: [projected, plain],
    ...extra,
  }) as never

interface Document {
  readonly nodes: readonly { readonly name?: string }[]
  readonly scenes: readonly { readonly nodes: readonly number[] }[]
  readonly accessors: readonly {
    readonly type: string
    readonly componentType: number
    readonly count: number
  }[]
  readonly extensionsUsed: readonly string[]
  readonly extensions: Record<string, unknown>
  readonly materials: readonly {
    readonly extensions?: {
      readonly UV_game_material?: {
        readonly params: { readonly renderModel: { readonly worldToMaterial?: number[] } }
      }
    }
  }[]
}
const documentOf = (written: unknown) => (written as { document: Document }).document
const materialIndex = (written: unknown, id: string) =>
  (written as { bindings: { materials: Record<string, number> } }).bindings.materials[id]!
const worldToMaterial = (document: Document, index: number) =>
  document.materials[index]?.extensions?.UV_game_material?.params.renderModel.worldToMaterial
const close = (actual: readonly number[] | undefined, expected: readonly number[]) => {
  expect(actual).toHaveLength(16)
  actual!.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 12))
}

const ribbon = (endpoints: object[]) => ({
  effects: {
    profile: 'm3',
    ribbons: [{ name: 'Trail', nodeId: 'body', materialId: 'plain', splineEndpoints: endpoints }],
  },
})
const endpoint = (extra: object) => ({
  emissionOffset: [0, 0, 0],
  emissionVector: [0, 0, 1],
  velocity: 1,
  velocityBaseFactor: 1,
  velocityEndFactor: 1,
  yaw: 0,
  pitch: 0,
  ...extra,
})

describe('effects records below the entry', () => {
  it("names a spline endpoint's bone by the document's node index", () => {
    const written = materializeUvmCore(
      projection(ribbon([endpoint({ nodeId: 'tip' }), endpoint({ nodeId: 'tail' })])),
      request(),
    )
    const document = documentOf(written)
    const effects = document.extensions['UV_game_effects'] as {
      readonly ribbons: readonly { readonly splineEndpoints: readonly { node: number }[] }[]
    }
    const bindings = (written as unknown as { bindings: { nodes: Record<string, number> } })
      .bindings.nodes
    expect(effects.ribbons[0]!.splineEndpoints.map(item => item.node)).toEqual([
      bindings['tip'],
      bindings['tail'],
    ])
    expect(JSON.stringify(effects)).not.toContain('nodeId')
  })

  it('refuses a nested id that names nothing, or a nested index of its own', () => {
    expect(() =>
      materializeUvmCore(projection(ribbon([endpoint({ nodeId: 'nowhere' })])), request()),
    ).toThrow(/unknown node nowhere/)
    expect(() =>
      materializeUvmCore(projection(ribbon([endpoint({ node: 1 })])), request()),
    ).toThrow(/by index, not by id/)
  })

  it("writes a particle emitter's emission meshes to accessors", () => {
    const written = materializeUvmCore(
      projection({
        effects: {
          particles: [
            {
              name: 'Sparks',
              nodeId: 'body',
              materialId: 'plain',
              emitShape: 'mesh',
              emitShapeMeshes: [{ positions: [0, 0, 0, 2, 0, 0, 0, 2, 0], indices: [0, 1, 2] }],
            },
          ],
        },
      }),
      request(),
    )
    const document = documentOf(written)
    const [mesh] = (
      document.extensions['UV_game_effects'] as {
        readonly particles: readonly {
          readonly emitShapeMeshes: readonly { positions: number; indices: number }[]
        }[]
      }
    ).particles[0]!.emitShapeMeshes
    expect(document.accessors[mesh!.positions]).toMatchObject({
      type: 'VEC3',
      componentType: 5126,
      count: 3,
    })
    expect(document.accessors[mesh!.indices]).toMatchObject({
      type: 'SCALAR',
      componentType: 5125,
      count: 3,
    })
    expect(() =>
      materializeUvmCore(
        projection({
          effects: {
            particles: [
              {
                name: 'Sparks',
                nodeId: 'body',
                materialId: 'plain',
                emitShapeMeshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 3] }],
              },
            ],
          },
        }),
        request(),
      ),
    ).toThrow(/triangle indices within its positions/)
  })
})

describe('the frame around the scene', () => {
  const frame = { metersPerSourceUnit: 0.5, upAxis: '+z' as const, handedness: 'left' as const }

  it("folds the wrappers into a world-projected material's worldToMaterial only", () => {
    const written = materializeUvmCore(
      projection({}, '+z', 'left'),
      request({ units: { metersPerSourceUnit: 0.5 } }),
    )
    const document = documentOf(written)
    expect(document.nodes.slice(-3).map(node => node.name)).toEqual([
      'uv:handedness',
      'uv:up-axis',
      'uv:units',
    ])
    // world → material: undo the frame, then the material's own (identity) frame
    const matrix = uvmSceneFrameMatrix(frame)
    const point = [0.25, -0.5, 2]
    const world = [0, 1, 2].map(
      row =>
        matrix[row]! * point[0]! +
        matrix[4 + row]! * point[1]! +
        matrix[8 + row]! * point[2]! +
        matrix[12 + row]!,
    )
    const folded = worldToMaterial(document, materialIndex(written, 'projected'))!
    const back = [0, 1, 2].map(
      row =>
        folded[row]! * world[0]! +
        folded[4 + row]! * world[1]! +
        folded[8 + row]! * world[2]! +
        folded[12 + row]!,
    )
    back.forEach((value, index) => expect(value).toBeCloseTo(point[index]!, 12))
    expect(worldToMaterial(document, materialIndex(written, 'plain'))).toBeUndefined()
  })

  it('takes the wrappers off for a writer and gives the material its source frame back', () => {
    const written = materializeUvmCore(
      projection({}, '+z', 'left'),
      request({ units: { metersPerSourceUnit: 0.5, sourceUnit: 'inch' } }),
    )
    const framed = documentOf(written)
    const { container, frame: removed } = removeUvmFrameWrappers(readUvmContainer(written.bytes))
    const document = container.document as unknown as Document
    expect(removed).toMatchObject({
      ...frame,
      units: { metersPerSourceUnit: 0.5, sourceUnit: 'inch' },
    })
    expect(document.nodes).toHaveLength(framed.nodes.length - 3)
    expect(document.nodes.some(node => node.name?.startsWith('uv:'))).toBe(false)
    expect(document.scenes[0]!.nodes).toEqual([0])
    expect(document.extensions['UV_units']).toBeUndefined()
    expect(document.extensionsUsed).not.toContain('UV_units')
    close(worldToMaterial(document, materialIndex(written, 'projected')), identity)
  })

  it('returns a document without wrappers as it is and refuses a changed wrapper', () => {
    const bare = readUvmContainer(materializeUvmCore(projection(), request()).bytes)
    expect(removeUvmFrameWrappers(bare).container).toBe(bare)
    const framed = readUvmContainer(materializeUvmCore(projection({}, '+z'), request()).bytes)
    const nodes = framed.document['nodes'] as Record<string, unknown>[]
    const changed = {
      ...framed,
      document: {
        ...framed.document,
        nodes: [...nodes.slice(0, -1), { ...nodes.at(-1), translation: [1, 0, 0] }],
      },
    }
    expect(() => removeUvmFrameWrappers(changed as never)).toThrow(
      /more than the materializer writes/,
    )
  })
})

describe('lights, effects and cameras in the source frame', () => {
  const lamp = { type: 'point', direction: [0, 0, -1], position: [0, 0, 2], color: [1, 1, 1] }
  const sparks = { particles: [{ name: 'Sparks', nodeId: 'body', materialId: 'plain' }] }
  const lens = { type: 'perspective', perspective: { yfov: 0.8, znear: 0.1, zfar: 100 } }
  const spaceOf = (document: Document, name: string) =>
    (document.extensions[name] as { spaceNode?: number }).spaceNode
  const nodeIndex = (written: unknown, id: string) =>
    (written as { bindings: { nodes: Record<string, number> } }).bindings.nodes[id]!
  type WithCameras = Document & {
    readonly nodes: readonly { readonly camera?: number }[]
    readonly cameras?: readonly unknown[]
  }

  it('names the innermost frame node the space of effects, and of lights without a node', () => {
    for (const [upAxis, handedness, innermost] of [
      ['+z', undefined, 'uv:up-axis'],
      ['+z', 'left', 'uv:handedness'],
      [undefined, undefined, 'uv:units'],
    ] as const) {
      const document = documentOf(
        materializeUvmCore(
          projection({ effects: sparks, lights: { lights: [lamp] } }, upAxis, handedness),
          request({ units: { metersPerSourceUnit: 0.5 } }),
        ),
      )
      expect(document.nodes[spaceOf(document, 'UV_game_effects')!]!.name).toBe(innermost)
      expect(document.nodes[spaceOf(document, 'UV_scene_lights')!]!.name).toBe(innermost)
    }
    // a scene the materializer does not frame: effects are in the document's own frame
    const bare = documentOf(materializeUvmCore(projection({ effects: sparks }), request()))
    expect(spaceOf(bare, 'UV_game_effects')).toBeUndefined()
    expect(() => materializeUvmCore(projection({ lights: { lights: [lamp] } }), request())).toThrow(
      /no frame node/,
    )
  })

  it('takes the source-frame space off with the wrappers and refuses a space on an outer one', () => {
    const written = materializeUvmCore(
      projection({ effects: sparks, lights: { lights: [lamp] } }, '+z'),
      request({ units: { metersPerSourceUnit: 0.5 } }),
    )
    const framed = readUvmContainer(written.bytes)
    const document = removeUvmFrameWrappers(framed).container.document as unknown as Document
    expect(document.extensions['UV_game_effects']).not.toHaveProperty('spaceNode')
    expect(document.extensions['UV_scene_lights']).toEqual({ version: 1, lights: [lamp] })
    // the outer wrapper scales without turning: a space no source frame names
    const nodes = framed.document['nodes'] as unknown[]
    const extensions = framed.document['extensions'] as Record<string, Record<string, unknown>>
    const outer = {
      ...framed,
      document: {
        ...framed.document,
        extensions: {
          ...extensions,
          UV_game_effects: { ...extensions['UV_game_effects'], spaceNode: nodes.length - 1 },
        },
      },
    }
    expect(() => removeUvmFrameWrappers(outer as never)).toThrow(
      /spaceNode names a frame node of the materializer/,
    )
  })

  it('writes a camera on its node, before the frame nodes a writer takes off', () => {
    const written = materializeUvmCore(
      projection(
        {
          cameras: [
            {
              nodeId: 'tip',
              camera: { ...lens, name: 'Portrait' },
              sequenceAnimation: { yfov: [] },
            },
          ],
        },
        '+z',
      ),
      request(),
    )
    const document = documentOf(written) as WithCameras
    const tip = nodeIndex(written, 'tip')
    expect(document.nodes[tip]!.camera).toBe(0)
    expect(document.cameras).toEqual([
      {
        ...lens,
        name: 'Portrait',
        extensions: { UV_scene_camera: { version: 1, sequenceAnimation: { yfov: [] } } },
      },
    ])
    expect(document.extensionsUsed).toContain('UV_scene_camera')
    const unwrapped = removeUvmFrameWrappers(readUvmContainer(written.bytes)).container
      .document as unknown as WithCameras
    expect(unwrapped.nodes[tip]!.camera).toBe(0)
    const still = documentOf(
      materializeUvmCore(projection({ cameras: [{ nodeId: 'tip', camera: lens }] }), request()),
    )
    expect(still.extensionsUsed).not.toContain('UV_scene_camera')
  })

  it('refuses a camera the scene would refuse', () => {
    for (const cameras of [
      [{ nodeId: 'nowhere', camera: lens }],
      [
        { nodeId: 'tip', camera: lens },
        { nodeId: 'tip', camera: lens },
      ],
      [{ nodeId: 'tip', camera: { ...lens, perspective: { yfov: 0, znear: 0.1 } } }],
      [{ nodeId: 'tip', camera: { ...lens, perspective: { yfov: 1, znear: 1, zfar: 0.5 } } }],
      [
        {
          nodeId: 'tip',
          camera: { type: 'orthographic', orthographic: { xmag: 0, ymag: 1, znear: 0, zfar: 1 } },
        },
      ],
      [{ nodeId: 'tip', camera: lens, sequenceAnimation: { focus: [] } }],
      [{ nodeId: 'tip', camera: { ...lens, extras: {} } }],
    ])
      expect(() => materializeUvmCore(projection({ cameras }), request())).toThrow(TypeError)
    expect(() =>
      materializeUvmCore(
        projection({ cameras: [{ nodeId: 'tip', camera: lens }] }, '+z', 'left'),
        request(),
      ),
    ).toThrow(/reflected/)
  })
})


describe('portable camera v1 document admission', () => {
  const track = (extra: JsonObject = {}): JsonObject => ({
    sequenceIndex: 7,
    track: { lineType: 1, globalSeqId: null, keys: [
      { frame: 0, vector: [0.5] }, { frame: 1, vector: [1] },
    ] },
    ...extra,
  })
  const cameraOf = (document: JsonObject): JsonObject => {
    const cameras = document['cameras']
    if (!Array.isArray(cameras)) throw new TypeError('fixture cameras missing')
    const camera = cameras[0]
    if (camera === null || typeof camera !== 'object' || Array.isArray(camera))
      throw new TypeError('fixture camera missing')
    return camera as JsonObject
  }
  const fixture = () => {
    const written = materializeUvmCore(projection({ cameras: [{
      nodeId: 'tip',
      camera: { type: 'perspective', perspective: { yfov: 1, znear: 0.1, zfar: 10 } },
      sequenceAnimation: { yfov: [track()] },
    }] }), request())
    return { written, opened: readUvmContainer(written.bytes) }
  }
  const extension = (document: JsonObject, value: JsonObject | null): JsonObject => ({
    ...document, cameras: [{ ...cameraOf(document), extensions: { UV_scene_camera: value } }],
  })
  it('validates actual materializer bytes and reopens local, concurrent and numeric-id lens tracks unchanged', () => {
    const { written, opened } = fixture(), original = written.bytes.slice()
    for (const extra of [{}, { concurrent: true, wrapSeconds: 2 }, {
      track: { lineType: 1, globalSeqId: 4, keys: [{ frame: 0, vector: [0.7] }] },
    }, { track: { lineType: 2, globalSeqId: null, keys: [
      { frame: 0, vector: [1], outTan: [20] }, { frame: 1, vector: [1], inTan: [-20] },
    ] } }]) {
      const document = extension(opened.document, { version: 1, sequenceAnimation: { yfov: [track(extra)] } })
      const before = structuredClone(document)
      const bytes = writeUvmContainer({ ...opened, document }), reopened = readUvmContainer(bytes)
      expect(() => validateUvmDocument(reopened.document, { binaryByteLength: reopened.binary.byteLength })).not.toThrow()
      expect(reopened.document).toEqual(document)
      expect(document).toEqual(before)
      expect(writeUvmContainer(reopened)).toEqual(bytes)
    }
    expect(written.bytes).toEqual(original)
    expect(() => validateUvmDocument(extension(opened.document, { version: 1, sequenceAnimation: {} }))).not.toThrow()
    const { extensions: _extensions, ...legacyCamera } = cameraOf(opened.document)
    expect(() => validateUvmDocument({ ...opened.document, cameras: [legacyCamera] })).not.toThrow()
  })
  const invalid: readonly [string, JsonObject | null][] = [
    ['unknown version without tracks', { version: 2 }],
    ['unknown version with tracks', { version: 2, sequenceAnimation: {} }],
    ['required animation absent', { version: 1 }],
    ['null extension', null],
    ['unknown extension field', { version: 1, sequenceAnimation: {}, unknownProbe: true }],
    ['null animation', { version: 1, sequenceAnimation: null }],
    ['unknown lens property', { version: 1, sequenceAnimation: { xmag: [] } }],
    ['absent far-plane default', { version: 1, sequenceAnimation: { zfar: [track()] } }],
    ['vector width', { version: 1, sequenceAnimation: { yfov: [track({ track: {
      lineType: 1, globalSeqId: null, keys: [{ frame: 0, vector: [0.5, 1] }],
    } })] } }],
    ['missing explicit global id', { version: 1, sequenceAnimation: { yfov: [track({ track: {
      lineType: 1, keys: [{ frame: 0, vector: [0.5] }],
    } })] } }],
    ['zero key angle', { version: 1, sequenceAnimation: { yfov: [track({ track: {
      lineType: 1, globalSeqId: null, keys: [{ frame: 0, vector: [0] }],
    } })] } }],
    ['pi key angle', { version: 1, sequenceAnimation: { yfov: [track({ track: {
      lineType: 1, globalSeqId: null, keys: [{ frame: 0, vector: [Math.PI] }],
    } })] } }],
  ]
  for (const [label, value] of invalid) it(`refuses ${label} after GLB reopen`, () => {
    const { opened, written } = fixture(), original = written.bytes.slice()
    let document = extension(opened.document, value)
    if (label === 'absent far-plane default') document = {
      ...document, cameras: [{ ...cameraOf(document), perspective: { yfov: 1, znear: 0.1 } }],
    }
    const before = structuredClone(document), bytes = writeUvmContainer({ ...opened, document })
    const reopened = readUvmContainer(bytes)
    expect(() => validateUvmDocument(reopened.document, { binaryByteLength: reopened.binary.byteLength })).toThrow()
    expect(document).toEqual(before)
    expect(written.bytes).toEqual(original)
  })
  it('checks undeclared, nonselected and orthographic camera extensions and static lens domains', () => {
    const { opened } = fixture(), camera = cameraOf(opened.document)
    const bad = { ...camera, extensions: { UV_scene_camera: { version: 2 } } }
    for (const document of [
      { ...opened.document, extensionsUsed: ['UV_asset', 'UV_provenance'] },
      { ...opened.document, cameras: [camera, bad] },
      { ...opened.document, cameras: [{ ...camera, type: 'orthographic' }] },
      ...[{ yfov: 0, znear: 1, zfar: 10 }, { yfov: Math.PI, znear: 1, zfar: 10 },
        { yfov: 1, znear: 0, zfar: 10 }, { yfov: 1, znear: 10, zfar: 10 },
        { yfov: 1, znear: 1, zfar: 1e100 }].map(perspective => ({
          ...opened.document, cameras: [{ ...camera, perspective }],
        })),
    ]) expect(() => validateUvmDocument(document)).toThrow()
  })
})
