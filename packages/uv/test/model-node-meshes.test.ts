import { expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { validateUvmDocument } from '../src/model/validation/index.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:node-meshes',
  options: { assetId: 'fixture/node-meshes', sourceFormat: 'json' },
} as never

const triangle = (id: string) => ({
  id,
  topology: 'triangles' as const,
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: Uint32Array.from([0, 1, 2]),
})

// A voxel body of three sections that one node owns (Westwood VXL before ea b537491).
const ids = ['hull', 'turret', 'barrel']
const projection = {
  info: {
    scenes: 1,
    nodes: 1,
    meshes: 3,
    primitives: 3,
    materials: 0,
    textures: 0,
    animations: 0,
    geometryAccess: 'decoded' as const,
  },
  nodes: [
    {
      id: 'body',
      meshIds: ids.map(id => `${id}-mesh`),
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1],
    },
  ],
  meshes: ids.map(id => ({ id: `${id}-mesh`, primitiveIds: [id] })),
  primitives: ids.map(triangle),
}

it('writes every mesh of a node: the first on it, the others on identity children', () => {
  const result = materializeUvmCore(projection as never, request) as unknown as {
    readonly document: {
      readonly nodes: readonly Record<string, unknown>[]
      readonly scenes: readonly { readonly nodes: readonly number[] }[]
    }
    readonly receipt: unknown
  }
  const { nodes, scenes } = result.document
  // meshes are written in id order: barrel 0, hull 1, turret 2
  expect(nodes[0]).toMatchObject({
    mesh: 1,
    children: [1, 2],
    matrix: projection.nodes[0]!.transform,
  })
  expect(nodes.slice(1)).toEqual([{ mesh: 2 }, { mesh: 0 }])
  expect(scenes[0]!.nodes).toEqual([0])
  expect(JSON.stringify(result.receipt)).not.toContain('meshIds')
  expect(() => validateUvmDocument(result.document as never)).not.toThrow()
})
