import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:morph',
  options: { assetId: 'fixture/morph', sourceFormat: 'test' },
} as never

const projection = (primitive: object, mesh: object = {}) =>
  ({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded',
    },
    nodes: [
      {
        id: 'face',
        childIds: [],
        meshIds: ['mesh'],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['tri'], ...mesh }],
    primitives: [
      {
        id: 'tri',
        topology: 'triangles',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
        ...primitive,
      },
    ],
  }) as never

interface Written {
  readonly document: {
    readonly meshes: readonly {
      weights?: number[]
      extras?: { targetNames: string[] }
      primitives: { targets?: Record<string, number>[] }[]
    }[]
    readonly accessors: readonly { count: number; type: string; min?: number[]; max?: number[] }[]
  }
}

describe('morph targets in UVM', () => {
  it('writes each target as glTF deltas with names and default weights', () => {
    const written = materializeUvmCore(
      projection(
        {
          morphTargets: [
            { name: 'Smile', positions: Float32Array.from([0, 0.5, 0, 0, 0, 0, 0, 0, 0]) },
          ],
        },
        { morphWeights: [0.25] },
      ),
      request,
    ) as unknown as Written
    const mesh = written.document.meshes[0]!
    expect(mesh.weights).toEqual([0.25])
    expect(mesh.extras).toEqual({ targetNames: ['Smile'] })
    const target = mesh.primitives[0]!.targets![0]!
    const accessor = written.document.accessors[target['POSITION']!]!
    expect([accessor.count, accessor.type, accessor.min, accessor.max]).toEqual([
      3,
      'VEC3',
      [0, 0, 0],
      [0, 0.5, 0],
    ])
  })

  it('defaults weights to zero and refuses mismatched deltas or weights', () => {
    const plain = materializeUvmCore(
      projection({ morphTargets: [{ positions: new Float32Array(9) }] }),
      request,
    ) as unknown as Written
    expect(plain.document.meshes[0]!.weights).toEqual([0])
    expect(plain.document.meshes[0]!.extras).toBeUndefined()
    expect(() =>
      materializeUvmCore(
        projection({ morphTargets: [{ positions: new Float32Array(6) }] }),
        request,
      ),
    ).toThrow(/VEC3 deltas/u)
    expect(() => materializeUvmCore(projection({}, { morphWeights: [1] }), request)).toThrow(
      /no morph targets/u,
    )
  })
})
