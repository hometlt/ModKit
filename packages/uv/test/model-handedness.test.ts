import { expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { validateUvmDocument } from '../src/model/validation/index.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:handedness',
  options: { assetId: 'fixture/handedness', sourceFormat: 'json' },
} as never

const projection = (info: object) =>
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
      ...info,
    },
    nodes: [
      {
        id: 'body',
        childIds: [],
        meshIds: ['mesh'],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['tri'] }],
    primitives: [
      {
        id: 'tri',
        topology: 'triangles',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
  }) as never

type Written = {
  readonly document: {
    readonly scenes: readonly { readonly nodes: readonly number[] }[]
    readonly nodes: readonly Record<string, unknown>[]
  }
}
const root = (written: Written) => written.document.nodes[written.document.scenes[0]!.nodes[0]!]!

it('mirrors a left-handed y-up source in z with one node above the scene', () => {
  const written = materializeUvmCore(
    projection({ handedness: 'left' }),
    request,
  ) as unknown as Written
  expect(root(written)).toEqual({ name: 'uv:handedness', scale: [1, 1, -1], children: [0] })
  expect(() => validateUvmDocument(written.document as never)).not.toThrow()
})

it('mirrors a left-handed z-up source in y, inside the node that turns it upright', () => {
  const written = materializeUvmCore(
    projection({ handedness: 'left', upAxis: '+z' }),
    request,
  ) as unknown as Written
  const upright = root(written)
  expect(upright['name']).toBe('uv:up-axis')
  const mirror = written.document.nodes[(upright['children'] as number[])[0]!]!
  expect(mirror).toEqual({ name: 'uv:handedness', scale: [1, -1, 1], children: [0] })
})

it('adds no node for a right-handed source', () => {
  const written = materializeUvmCore(
    projection({ handedness: 'right' }),
    request,
  ) as unknown as Written
  expect(written.document.scenes[0]!.nodes).toEqual([0])
})
