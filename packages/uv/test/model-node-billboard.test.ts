import { describe, expect, it } from 'vitest'
import type { ModelNode } from '@modkit/sdk'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmBillboards } from '../../scene/src/uvm/billboards.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:node-billboard',
  options: { assetId: 'fixture/node-billboard', sourceFormat: 'mdx' },
} as never

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const s = Math.SQRT1_2

function projection(card: Partial<ModelNode>) {
  return {
    info: {
      scenes: 1,
      nodes: 2,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded' as const,
    },
    nodes: [
      { id: 'root', childIds: ['card'], meshIds: ['mesh'], transform: IDENTITY },
      { id: 'card', childIds: [], meshIds: [], transform: IDENTITY, ...card },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles' as const,
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
  } as never
}

interface Written {
  readonly document: {
    readonly nodes: readonly { name?: string; extensions?: Record<string, unknown> }[]
    readonly extensionsUsed: readonly string[]
  }
}

describe('a node that faces the camera', () => {
  it('is written as UV_node_billboard, the constraint the scene reads back', () => {
    // Warcraft III's basis (mdx-m3-viewer mdx/node.ts): rotateY(-π/2), then rotateX(-π/2).
    const basisRotations = [
      [0, -s, 0, s],
      [-s, 0, 0, s],
    ] as const
    const written = materializeUvmCore(
      projection({ billboard: { mode: 'inverse-camera', basisRotations } }),
      request,
    ) as unknown as Written
    expect(written.document.extensionsUsed).toContain('UV_node_billboard')
    const card = written.document.nodes.find(node => node.extensions?.['UV_node_billboard'] !== undefined)
    expect(card?.extensions?.['UV_node_billboard']).toEqual({
      schemaVersion: 1,
      mode: 'inverse-camera',
      basisRotations: basisRotations.map(rotation => [...rotation]),
    })
    const constraints = readUvmBillboards(written.document as never, 100_000)
    expect(constraints).toHaveLength(1)
    expect(constraints[0]).toMatchObject({ mode: 'inverse-camera' })
  })

  it('writes a rigid position-facing node and states nothing for a model without one', () => {
    const facing = materializeUvmCore(
      projection({ billboard: { mode: 'face-camera', rotationAxes: 'z', pivot: [0, 0, 1] } }),
      request,
    ) as unknown as Written
    expect(facing.document.nodes.map(node => node.extensions?.['UV_node_billboard']).filter(Boolean)).toEqual([
      { schemaVersion: 1, mode: 'face-camera', rotationAxes: 'z', pivot: [0, 0, 1] },
    ])
    const plain = materializeUvmCore(projection({}), request) as unknown as Written
    expect(plain.document.extensionsUsed).not.toContain('UV_node_billboard')
  })

  it('writes an aim billboard (a StarCraft II BBSC record) and reads it back', () => {
    const written = materializeUvmCore(
      projection({ billboard: { mode: 'aim', aim: 'eye', lock: 'frame-z', correction: [0, 0, s, s] } }),
      request,
    ) as unknown as Written
    const card = written.document.nodes.find(node => node.extensions?.['UV_node_billboard'] !== undefined)
    expect(card?.extensions?.['UV_node_billboard']).toEqual({
      schemaVersion: 1,
      mode: 'aim',
      aim: 'eye',
      lock: 'frame-z',
      correction: [0, 0, s, s],
    })
    expect(readUvmBillboards(written.document as never, 100_000)[0]).toMatchObject({ mode: 'aim', lock: 'frame-z' })
  })

  it('refuses a basis that is not a rotation', () => {
    expect(() =>
      materializeUvmCore(
        projection({ billboard: { mode: 'inverse-camera', basisRotations: [[0, 0, 0, 0]] } }),
        request,
      ),
    ).toThrow(/nonzero quaternion/)
  })
})
