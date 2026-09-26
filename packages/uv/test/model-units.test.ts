import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = (units?: unknown) =>
  ({
    scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
    profile: 'UVM/core@1.0',
    subjectRevision: 'provider-token:units',
    options: {
      assetId: 'fixture/units',
      sourceFormat: 's3o',
      ...(units === undefined ? {} : { units }),
    },
  }) as never

const projection = {
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
  nodes: [
    {
      id: 'body',
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
} as never

interface Written {
  readonly document: {
    readonly extensionsUsed: readonly string[]
    readonly extensions: Record<string, unknown>
    readonly scenes: readonly { nodes: readonly number[] }[]
    readonly nodes: readonly Record<string, unknown>[]
  }
}

describe('source units of a materialized model', () => {
  it('scales the scene under one node and records UV_units', () => {
    const written = materializeUvmCore(
      projection,
      request({ sourceUnit: 'spring-elmo', metersPerSourceUnit: 0.125, footprintCells: [2, 2] }),
    ) as unknown as Written
    const root = written.document.scenes[0]!.nodes[0]!
    expect(written.document.nodes[root]).toEqual({
      name: 'uv:units',
      scale: [0.125, 0.125, 0.125],
      children: [0],
    })
    expect(written.document.extensionsUsed).toContain('UV_units')
    expect(written.document.extensions['UV_units']).toEqual({
      sourceUnit: 'spring-elmo',
      metersPerSourceUnit: 0.125,
      footprintCells: [2, 2],
    })
  })

  it('adds no node at metre scale and nothing without units; refuses a bad factor', () => {
    const metres = materializeUvmCore(
      projection,
      request({ metersPerSourceUnit: 1 }),
    ) as unknown as Written
    expect(metres.document.scenes[0]!.nodes).toEqual([0])
    expect(metres.document.extensions['UV_units']).toEqual({ metersPerSourceUnit: 1 })
    const plain = materializeUvmCore(projection, request()) as unknown as Written
    expect(plain.document.extensionsUsed).not.toContain('UV_units')
    expect(() => materializeUvmCore(projection, request({ metersPerSourceUnit: 0 }))).toThrow(
      /metersPerSourceUnit/u,
    )
  })

  it('turns a +z-up source to +y-up with one rotation node inside the units node', () => {
    const zUp = {
      ...(projection as unknown as { info: object }),
      info: { ...(projection as unknown as { info: object }).info, upAxis: '+z' },
    } as never
    const written = materializeUvmCore(
      zUp,
      request({ metersPerSourceUnit: 0.5 }),
    ) as unknown as Written
    const root = written.document.nodes[written.document.scenes[0]!.nodes[0]!]!
    expect(root['name']).toBe('uv:units')
    const turn = written.document.nodes[(root['children'] as number[])[0]!]!
    expect(turn).toEqual({
      name: 'uv:up-axis',
      rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      children: [0],
    })
    const plain = materializeUvmCore(projection, request()) as unknown as Written
    expect(plain.document.nodes.some(node => node['name'] === 'uv:up-axis')).toBe(false)
  })
})
