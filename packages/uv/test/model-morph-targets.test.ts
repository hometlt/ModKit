import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmContainer } from '../src/model/container.js'
import { readUvmAccessor } from '../src/model/accessor.js'
import { readUvmKeyTimes } from '../src/model/key-times.js'
import type { JsonObject, ModelAnimationChannel } from '@modkit/sdk'

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

  it('animates the weights of the node whose mesh carries the targets', () => {
    const base = projection({
      morphTargets: [{ name: 'Smile', positions: new Float32Array(9) }],
    }) as unknown as {
      info: object
    }
    const animated = {
      ...base,
      info: { ...base.info, animations: 1 },
      animations: [
        {
          id: 'talk',
          name: 'talk',
          kind: 'animation',
          provenance: 'direct',
          frames: 2,
          channels: [
            {
              target: 'face',
              kind: 'weights',
              firstFrame: 0,
              lastFrame: 1,
              interpolation: 'linear',
              samples: [
                { frame: 0, timeSeconds: 0, value: [0] },
                { frame: 1, timeSeconds: 0.5, value: [1] },
              ],
            },
          ],
        },
      ],
    } as never
    const written = materializeUvmCore(animated, request) as unknown as {
      document: {
        animations: { channels: { sampler: number; target: { node: number; path: string } }[] }[]
      }
    }
    expect(written.document.animations[0]!.channels[0]).toEqual({
      sampler: 0,
      target: { node: 0, path: 'weights' },
    })
  })

  it.each(['step', 'linear'] as const)(
    'preserves independent clocks and exact authored times in reopened %s weights',
    interpolation => {
      const base = projection({
        morphTargets: [{ positions: new Float32Array(9) }],
      }) as unknown as { info: object }
      const channel: ModelAnimationChannel = {
        target: 'face',
        kind: 'weights',
        firstFrame: 0,
        lastFrame: 1,
        interpolation,
        concurrent: true,
        wrapSeconds: 2,
        repeatCount: 3,
        samples: [
          { frame: 0, timeSeconds: 0.1, value: [0] },
          { frame: 1, timeSeconds: 0.9, value: [1] },
        ],
      }
      const animated = {
        ...base,
        info: { ...base.info, animations: 1 },
        animations: [
          {
            id: 'talk',
            name: 'talk',
            kind: 'animation',
            provenance: 'direct',
            frames: 2,
            channels: [channel],
          },
        ],
      }
      const before = structuredClone(animated)
      const written = materializeUvmCore(animated as never, request)
      const reopened = readUvmContainer(written.bytes)
      const animation = (reopened.document['animations'] as JsonObject[])[0]!
      const encoded = (animation['channels'] as JsonObject[])[0]!
      const metadata = (encoded['extras'] as JsonObject)['uv'] as JsonObject
      expect(metadata).toEqual({
        concurrent: true,
        wrapSeconds: 2,
        repeatCount: 3,
        keyTimes: { version: 1, seconds: [0.1, 0.9] },
      })
      const sampler = (animation['samplers'] as JsonObject[])[0]!
      expect(sampler['interpolation']).toBe(interpolation.toUpperCase())
      const budget = { maxScalarBytes: 1 << 20 }
      const input = readUvmAccessor(
        reopened.document,
        reopened.binary,
        sampler['input'],
        budget,
        'animation time',
      )
      expect([...input.values]).toEqual([Math.fround(0.1), Math.fround(0.9)])
      expect(
        readUvmKeyTimes(metadata['keyTimes'], {
          values: input.values,
          maxScalarBytes: budget.maxScalarBytes,
        }),
      ).toEqual([0.1, 0.9])
      expect([
        ...readUvmAccessor(
          reopened.document,
          reopened.binary,
          sampler['output'],
          budget,
          'animation weights',
        ).values,
      ]).toEqual([0, 1])
      expect(animated).toEqual(before)
    },
  )
})
