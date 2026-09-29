import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:gltf-slots',
  options: { assetId: 'fixture/gltf-slots', sourceFormat: 'json' },
} as never

const images = ['armcom_1.dds', 'armcom_normal.dds', 'armcom_glow.dds', 'armcom_team.dds']
const projection = {
  info: {
    scenes: 1,
    nodes: 1,
    meshes: 1,
    primitives: 1,
    materials: 1,
    textures: images.length,
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
      materialId: '0',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: Uint32Array.from([0, 1, 2]),
    },
  ],
  materials: [
    {
      id: '0',
      layers: [
        { slot: 'Diffuse', resourceId: 'armcom_1.dds' },
        { slot: 'normal', resourceId: 'armcom_normal.dds' },
        { slot: 'emissive', resourceId: 'armcom_glow.dds', uvSource: 1 },
        { slot: 'teamColor', resourceId: 'armcom_team.dds', colorChannels: 8 },
        { slot: 'specular', resourceId: 'armcom_normal.dds' },
      ],
    },
  ],
  resourceClosure: {
    mode: 'logical',
    entries: images.map(logicalId => ({ role: 'image', logicalId })),
  },
} as never

describe('material layers in the glTF slots', () => {
  it('are written where a glTF-only consumer reads them, team colour as its UVM extension', () => {
    const { document } = materializeUvmCore(projection, request) as unknown as {
      readonly document: {
        readonly materials: readonly Record<string, unknown>[]
        readonly extensionsUsed: readonly string[]
      }
    }
    expect(document.extensionsUsed).toContain('UV_game_material_team_color')
    const material = document.materials[0]!
    expect(material['pbrMetallicRoughness']).toMatchObject({ baseColorTexture: { index: 0 } })
    expect(material['normalTexture']).toEqual({ index: 1 })
    expect(material['emissiveTexture']).toEqual({ index: 2, texCoord: 1 })
    expect(material['emissiveFactor']).toEqual([1, 1, 1])
    expect(
      (material['extensions'] as Record<string, unknown>)['UV_game_material_team_color'],
    ).toEqual({
      maskSource: 'texture',
      maskTexture: { index: 3, channel: 'a' },
      targets: ['baseColor'],
      blend: 'multiply',
    })
  })

  it('mixes the team colour in as the publisher says it does', () => {
    // Recoil S3O: mix(diffuse.rgb, team, diffuse.a) — a lerp by the mask, not a multiply
    const source = projection as unknown as { materials: { layers: Record<string, unknown>[] }[] }
    const lerped = {
      ...source,
      materials: [
        {
          ...source.materials[0],
          layers: source.materials[0]!.layers.map(layer =>
            layer['slot'] === 'teamColor' ? { ...layer, blend: 'lerp' } : layer,
          ),
        },
      ],
    } as never
    const { document } = materializeUvmCore(lerped, request) as unknown as {
      readonly document: { readonly materials: readonly Record<string, unknown>[] }
    }
    expect(
      (document.materials[0]!['extensions'] as Record<string, Record<string, unknown>>)[
        'UV_game_material_team_color'
      ]!['blend'],
    ).toBe('lerp')
  })

  it('writes a primitive with a zero-length normal without normals or tangents, and says so', () => {
    const source = projection as unknown as { primitives: Record<string, unknown>[] }
    const flat = {
      ...source,
      primitives: [
        {
          ...source.primitives[0],
          normals: Float32Array.from([0, 0, 1, 0, 0, 0, 0, 0, 1]),
          tangents: Float32Array.from([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
        },
      ],
    } as never
    const materialized = materializeUvmCore(flat, request) as unknown as {
      readonly document: {
        readonly meshes: readonly {
          primitives: readonly { attributes: Record<string, number> }[]
        }[]
      }
      readonly receipt: { readonly diff: readonly { path?: string; change: string }[] }
    }
    const attributes = materialized.document.meshes[0]!.primitives[0]!.attributes
    expect(attributes['POSITION']).toBeDefined()
    expect(attributes['NORMAL']).toBeUndefined()
    expect(attributes['TANGENT']).toBeUndefined()
    expect(
      materialized.receipt.diff
        .filter(entry => entry.change === 'absent-in-artifact')
        .map(entry => entry.path),
    ).toEqual(
      expect.arrayContaining(['/primitives/triangle/NORMAL', '/primitives/triangle/TANGENT']),
    )
  })
})
