import { describe, expect, it } from 'vitest'
import { readUvmContainer } from '../src/model/container.js'
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
