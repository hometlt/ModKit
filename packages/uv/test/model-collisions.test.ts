import { expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { validateUvmDocument } from '../src/model/validation/index.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:collisions',
  options: { assetId: 'fixture/crate', sourceFormat: 'mdx' },
} as never

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const projection = (collisions?: unknown) =>
  ({
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
    nodes: [{ id: 'body', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles' as const,
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    ...(collisions === undefined ? {} : { collisions }),
  }) as never

interface Written {
  readonly document: {
    readonly extensionsUsed: readonly string[]
    readonly extensions: Record<string, { readonly collision?: boolean }>
    readonly nodes: readonly {
      readonly children?: readonly number[]
      readonly extensions?: { readonly UV_game_collision?: Record<string, unknown> }
    }[]
    readonly accessors: readonly { readonly count: number; readonly type: string }[]
  }
}

const volume = (id: string, shape: object, extra: object = {}) => ({
  id,
  kind: (shape as { kind: string }).kind,
  origin: 'declared-volume',
  nodeId: 'body',
  shape,
  ...extra,
})

it('writes each declared volume as its own child of its node, hull vertices in accessors', () => {
  const written = materializeUvmCore(
    projection([
      volume('hit', { kind: 'box', size: [2, 1, 3] }, { role: 'hit' }),
      volume('hull', {
        kind: 'convex-hull',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      }),
      // a render mesh's role is the facet's, not a node of the document
      { id: 'skin', kind: 'mesh', origin: 'mesh-role', meshId: 'mesh' },
    ]),
    request,
  ) as unknown as Written
  const { nodes, accessors } = written.document
  expect(written.document.extensionsUsed).toContain('UV_game_collision')
  expect(written.document.extensions['UV_asset']?.collision).toBe(true)
  const children = nodes[0]!.children ?? []
  const collisions = children.map(index => nodes[index]!.extensions?.UV_game_collision)
  expect(collisions).toHaveLength(2)
  expect(collisions[0]).toEqual({
    role: 'hit',
    shapes: [{ kind: 'box', size: [2, 1, 3] }],
    extras: { modkit: { id: 'hit' } },
  })
  const hull = (collisions[1]!['shapes'] as { kind: string; positions: number }[])[0]!
  expect(hull.kind).toBe('convex-hull')
  expect(accessors[hull.positions]).toMatchObject({ count: 4, type: 'VEC3' })
  // the document is one the UVM validator admits, collisions included
  const binary = (written as unknown as { readonly binary: Uint8Array }).binary
  expect(() =>
    validateUvmDocument(written.document as never, { binaryByteLength: binary.length }),
  ).not.toThrow()
  const plain = materializeUvmCore(projection(), request) as unknown as Written
  expect(plain.document.extensionsUsed).not.toContain('UV_game_collision')
})

it('refuses volumes a reader would refuse', () => {
  for (const collisions of [
    [volume('a', { kind: 'box', size: [1, 1, 1] }, { nodeId: 'nowhere' })],
    [volume('a', { kind: 'box' })],
    [volume('a', { kind: 'sphere', radius: 0 })],
    [volume('a', { kind: 'capsule', radius: 1 })],
    [volume('a', { kind: 'plane', normal: [0, 0, 0] })],
    [
      volume('a', {
        kind: 'mesh',
        positions: Float32Array.from([0, 0, 0]),
        indices: Uint32Array.of(0, 1, 2),
      }),
    ],
    [volume('a', { kind: 'blob' })],
    [volume('a', { kind: 'box', size: [1, 1, 1] }, { role: 'decoration' })],
    [volume('a', { kind: 'box', size: [1, 1, 1] }), volume('a', { kind: 'sphere', radius: 1 })],
  ])
    expect(() => materializeUvmCore(projection(collisions), request)).toThrow(TypeError)
})
