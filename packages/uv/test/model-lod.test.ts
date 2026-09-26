import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmContainer } from '../src/model/container.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:lod',
  options: { assetId: 'fixture/lod', sourceFormat: 'test' },
} as never
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const triangle = (id: string) => ({
  id,
  topology: 'triangles',
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: Uint32Array.from([0, 1, 2]),
})
const projection = (lods: object[], nested = false) =>
  ({
    info: {
      scenes: 1,
      nodes: 3,
      meshes: 2,
      primitives: 2,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded',
    },
    nodes: [
      { id: 'high', childIds: nested ? ['low'] : [], meshIds: ['m0'], transform: identity },
      { id: 'low', childIds: [], meshIds: ['m1'], transform: identity },
      { id: 'turret', childIds: [], meshIds: [], transform: identity },
    ],
    meshes: [
      { id: 'm0', primitiveIds: ['p0'] },
      { id: 'm1', primitiveIds: ['p1'] },
    ],
    primitives: [triangle('p0'), triangle('p1')],
    lods,
  }) as never

interface Written {
  readonly bytes: Uint8Array
  readonly document: {
    readonly scenes: { nodes: number[] }[]
    readonly nodes: {
      name?: string
      children?: number[]
      extensions?: Record<string, { ids: number[] }>
    }[]
    readonly extensionsUsed: string[]
    readonly extensions: Record<string, unknown>
  }
}

describe('discrete LOD in UVM', () => {
  it('groups each level under a node, names the lower groups in MSFT_lod and keeps others drawn', () => {
    const written = materializeUvmCore(
      projection([
        { id: 'near', order: 0, nodeIds: ['high'], screenCoverage: 0.5 },
        { id: 'far', order: 1, nodeIds: ['low'], screenCoverage: 0.1 },
      ]),
      request,
    ) as unknown as Written
    const { nodes, scenes } = written.document
    const base = nodes.findIndex(node => node.name === 'uv:lod-0')
    const lower = nodes.findIndex(node => node.name === 'uv:lod-1')
    expect(scenes[0]!.nodes).toContain(base)
    expect(scenes[0]!.nodes).not.toContain(lower)
    expect(scenes[0]!.nodes).toContain(2) // the turret belongs to no level
    expect(nodes[base]!.extensions!['MSFT_lod']).toEqual({ ids: [lower] })
    expect(written.document.extensionsUsed).toEqual(
      expect.arrayContaining(['MSFT_lod', 'MODKITX_lod_selection']),
    )
    expect(written.document.extensions['MODKITX_lod_selection']).toEqual({
      policy: 'screen-coverage',
      levels: [
        { node: base, screenCoverage: 0.5 },
        { node: lower, screenCoverage: 0.1 },
      ],
    })
    expect(() => readUvmContainer(written.bytes)).not.toThrow()
  })

  it('refuses a nested level node, a node in two levels, and a single level', () => {
    const near = { id: 'near', order: 0, nodeIds: ['high'] }
    expect(() =>
      materializeUvmCore(
        projection([near, { id: 'far', order: 1, nodeIds: ['low'] }], true),
        request,
      ),
    ).toThrow(/not a scene root/u)
    expect(() =>
      materializeUvmCore(projection([near, { id: 'far', order: 1, nodeIds: ['high'] }]), request),
    ).toThrow(/two LOD levels/u)
    expect(() => materializeUvmCore(projection([near]), request)).toThrow(/at least two levels/u)
  })
})
