import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:texture-filter',
  options: { assetId: 'fixture/texture-filter', sourceFormat: 'json' },
} as never

const projection = {
  info: {
    scenes: 1,
    nodes: 1,
    meshes: 1,
    primitives: 1,
    materials: 0,
    textures: 2,
    animations: 0,
    geometryAccess: 'decoded' as const,
  },
  nodes: [
    {
      id: 'block',
      childIds: [],
      meshIds: ['mesh'],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    },
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
  resourceClosure: {
    mode: 'logical',
    entries: [
      { role: 'image', logicalId: 'textures/block/stone.png', filter: 'nearest' },
      { role: 'image', logicalId: 'textures/gui/title.png' },
    ],
  },
} as never

describe('a texture filter stated by the publisher', () => {
  it('is written as the glTF sampler of that texture only', () => {
    const { document } = materializeUvmCore(projection, request) as unknown as {
      readonly document: {
        readonly textures: readonly { source: number; sampler?: number }[]
        readonly samplers?: readonly Record<string, number>[]
      }
    }
    expect(document.textures).toEqual([{ source: 0, sampler: 0 }, { source: 1 }])
    expect(document.samplers).toEqual([{ magFilter: 9728, minFilter: 9728 }])
  })
})
