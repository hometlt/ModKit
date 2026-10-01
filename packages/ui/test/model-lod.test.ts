import type { ModelMesh, ModelNode } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { modelLodPrimitives } from '../src/model/source.js'

const node = (id: string, meshIds: string[], childIds: string[] = []): ModelNode =>
  ({ id, meshIds, childIds }) as unknown as ModelNode

describe('modelLodPrimitives', () => {
  it('reads each level from its nodes and their children, most detailed first', () => {
    const nodes = [
      node('far', ['mesh-far']),
      // a level node whose children carry the geometry; the cycle back to itself must not loop
      node('near', [], ['near-body', 'near']),
      node('near-body', ['mesh-near']),
      node('empty', []),
    ]
    const meshes = [
      { id: 'mesh-near', primitiveIds: ['p-near-1', 'p-near-2'] },
      { id: 'mesh-far', primitiveIds: ['p-far'] },
    ] as unknown as ModelMesh[]
    const levels = modelLodPrimitives(
      [
        { id: 'lod-1', order: 1, nodeIds: ['far'] },
        { id: 'lod-0', order: 0, nodeIds: ['near'] },
        // reaches no geometry, so there is nothing to switch to
        { id: 'lod-2', order: 2, nodeIds: ['empty', 'missing'] },
      ],
      { nodes, meshes },
    )
    expect(levels.map(level => [level.id, [...level.primitiveIds].sort()])).toEqual([
      ['lod-0', ['p-near-1', 'p-near-2']],
      ['lod-1', ['p-far']],
    ])
  })
})
