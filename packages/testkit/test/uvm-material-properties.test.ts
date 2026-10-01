import { describe, expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { materializeUvmCore } from '../../uv/src/model/materializer.js'
import { validateUvmDocument } from '../../uv/src/model/validation/index.js'
import { readUvmFacets } from '../../scene/src/uvm/facets.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:material-properties',
  options: { assetId: 'fixture/material-properties', sourceFormat: 'json' },
} as never

function projection(materials: readonly Record<string, unknown>[]) {
  return {
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: materials.length,
      materials: materials.length,
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
    meshes: [{ id: 'mesh', primitiveIds: materials.map((_, index) => `triangle-${index}`) }],
    primitives: materials.map((_, index) => ({
      id: `triangle-${index}`,
      topology: 'triangles' as const,
      materialId: String(index),
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: Uint32Array.from([0, 1, 2]),
    })),
    materials: materials.map((material, index) => ({ id: String(index), ...material })),
  } as never
}

describe('publisher material properties', () => {
  it('are written as glTF and UV_game_material state them and read back unchanged', () => {
    const effect = {
      doubleSided: true,
      depthWrite: false,
      baseColorFactor: [1, 0.25, 0, 0.5],
      emissiveFactor: [0.5, 0.1, 0],
      unlit: true,
      priority: 17,
      alphaMode: 'blend',
      shader: { id: 'sage.default-w3d', parameters: { ColorEmissive: [1, 0.25, 0] } },
    }
    // without a game material, depth write and order stay the publisher's own fields
    const plain = { depthWrite: true, priority: 2, baseColorFactor: [0, 0, 1, 1] }
    const { document, binary } = materializeUvmCore(projection([effect, plain]), request)
    const json = document as unknown as JsonObject
    expect(() => validateUvmDocument(json, { binaryByteLength: binary.byteLength })).not.toThrow()
    expect(document.extensionsUsed).toContain('KHR_materials_unlit')
    const [first, second] = document.materials as unknown as Record<string, unknown>[]
    expect(first).toMatchObject({
      doubleSided: true,
      emissiveFactor: [0.5, 0.1, 0],
      pbrMetallicRoughness: { baseColorFactor: [1, 0.25, 0, 0.5] },
      extensions: {
        KHR_materials_unlit: {},
        UV_game_material: { shader: 'sage.default-w3d', depthWrite: false, sortPriority: 17 },
      },
    })
    expect(second!['extensions']).toBeUndefined()
    expect(second!['doubleSided']).toBeUndefined()
    const refs = readUvmFacets(json, binary, { maxScalarBytes: 1_000_000 }).materialRefs
    expect(refs[0]).toMatchObject({
      doubleSided: true,
      depthWrite: false,
      baseColorFactor: [1, 0.25, 0, 0.5],
      emissiveFactor: [0.5, 0.1, 0],
      unlit: true,
      priority: 17,
    })
    expect(refs[1]).toMatchObject({ depthWrite: true, priority: 2, baseColorFactor: [0, 0, 1, 1] })
    expect(refs[1]).not.toHaveProperty('unlit')
  })

  it('writes a team-colour layer without a texture as a whole mask and reads it back (П9)', () => {
    const side = { layers: [{ slot: 'teamColor', blend: 'multiply' }] }
    const { document, binary } = materializeUvmCore(projection([side]), request)
    const json = document as unknown as JsonObject
    expect(() => validateUvmDocument(json, { binaryByteLength: binary.byteLength })).not.toThrow()
    expect(document.extensionsUsed).toContain('UV_game_material_team_color')
    expect(
      (document.materials[0] as unknown as { extensions: Record<string, unknown> }).extensions[
        'UV_game_material_team_color'
      ],
    ).toEqual({ maskSource: 'whole', targets: ['baseColor'], blend: 'multiply' })
    expect(
      readUvmFacets(json, binary, { maxScalarBytes: 1_000_000 }).materialRefs[0]?.layers,
    ).toEqual([{ slot: 'teamColor', blend: 'multiply' }])
  })

  it('refuses a colour factor outside glTF 0..1', () => {
    expect(() => materializeUvmCore(projection([{ emissiveFactor: [3, 0, 0] }]), request)).toThrow(
      /emissiveFactor must be 3 finite components in 0\.\.1/u,
    )
    expect(() => materializeUvmCore(projection([{ baseColorFactor: [1, 1, 1] }]), request)).toThrow(
      /baseColorFactor must be 4 finite components/u,
    )
  })
})
