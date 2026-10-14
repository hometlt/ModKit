import { describe, expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { materializeUvmCore } from '../../uv/src/model/materializer.js'
import { readUvmContainer, writeUvmContainer } from '../../uv/src/model/container.js'
import { validateUvmDocument } from '../../uv/src/model/validation/index.js'
import { readUvmFacets } from '../../scene/src/uvm/facets.js'
import { uvmMaterialBlendEffect, uvmMaterialShader } from '../../scene/src/uvm/materials.js'

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
  it('are written as glTF and UV_game_material state and read back unchanged', () => {
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
    // Fixed state is universal even when the publisher has no shader identity.
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
    expect(second!['extensions']).toEqual({
      UV_game_material: { depthWrite: true, sortPriority: 2 },
    })
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
    expect(refs[1]).not.toHaveProperty('shader')
  })

  it.each([false, true])(
    'roundtrips encoded external canonical state without native extras (shader=%s)',
    withShader => {
      const { document, binary } = materializeUvmCore(
        projection([
          {
            alphaMode: 'blend',
            blendMode: 'additive',
            depthWrite: true,
            priority: 7,
            ...(withShader
              ? { shader: { id: 'example.shader', parameters: { nativeValue: 3 } } }
              : {}),
          },
        ]),
        request,
      )
      delete document.materials[0]!.extras
      const external = readUvmContainer(
        writeUvmContainer({
          format: 'glb',
          document: document as unknown as JsonObject,
          binary,
          extraChunks: [],
        }),
      )
      const json = external.document
      expect(() =>
        validateUvmDocument(json, { binaryByteLength: external.binary.byteLength }),
      ).not.toThrow()
      const material = readUvmFacets(json, external.binary, {
        maxScalarBytes: 1_000_000,
      }).materialRefs[0]!
      expect(material).toMatchObject({
        alphaMode: 'blend',
        blendMode: 'additive',
        depthWrite: true,
        priority: 7,
      })
      if (withShader)
        expect(material.shader).toEqual({ id: 'example.shader', parameters: { nativeValue: 3 } })
      else expect(material).not.toHaveProperty('shader')
      // This fixture's primitive binds material "0"; the reader assigns its own artifact id.
      const second = materializeUvmCore(projection([{ ...material, id: '0' }]), request)
      const secondDocument = readUvmContainer(second.bytes).document as unknown as typeof document
      expect(secondDocument.materials[0]?.extensions?.UV_game_material).toEqual(
        document.materials[0]?.extensions?.UV_game_material,
      )
      expect(
        uvmMaterialBlendEffect(document.materials[0] as never, () => ({
          wrapU: 'repeat',
          wrapV: 'repeat',
        })),
      ).toMatchObject({ blend: 'additive-one-one', depthWrite: true })
    },
  )

  it('preserves native extras precedence over canonical state', () => {
    const { document, binary } = materializeUvmCore(
      projection([
        {
          blendMode: 'add-signed',
          depthWrite: false,
          priority: 1.5,
        },
      ]),
      request,
    )
    document.materials[0]!.extensions = {
      UV_game_material: { blendMode: 'additive', depthWrite: true, sortPriority: 7 },
    }
    const json = document as unknown as JsonObject
    expect(() => validateUvmDocument(json, { binaryByteLength: binary.byteLength })).not.toThrow()
    expect(
      readUvmFacets(json, binary, { maxScalarBytes: 1_000_000 }).materialRefs[0],
    ).toMatchObject({ blendMode: 'add-signed', depthWrite: false, priority: 1.5 })
  })

  it('keeps the existing neutral layer program when fixed state has no shader', () => {
    const material = {
      extras: {
        modkit: {
          material: {
            version: 1,
            fields: {
              layers: [{ slot: 'diffuse', resourceId: 'native/body.dds' }],
            },
          },
        },
      },
    }
    const original = uvmMaterialShader(material)
    expect(original).toBeDefined()
    expect(
      uvmMaterialShader({
        ...material,
        extensions: {
          UV_game_material: { depthWrite: false },
        },
      }),
    ).toEqual(original)
    expect(
      uvmMaterialShader({
        extensions: {
          UV_game_material: { depthWrite: false },
        },
      }),
    ).toBeUndefined()
    const shader = { shader: 'example.shader', params: { nativeValue: 3 } }
    const merged = uvmMaterialShader({ ...material, extensions: { UV_game_material: shader } })
    expect(merged).toMatchObject({ id: 'example.shader', parameters: { nativeValue: 3 } })
    expect(merged?.parameters['renderModel']).toEqual(original?.parameters['renderModel'])
    const params = {
      nativeValue: 3,
      renderModel: { layers: [{ label: 'custom', path: 'custom.dds' }] },
    }
    expect(
      uvmMaterialShader({
        ...material,
        extensions: {
          UV_game_material: { shader: 'example.shader', params },
        },
      })?.parameters,
    ).toEqual(params)
  })

  it.each(['', null, undefined])('refuses an explicitly malformed render shader: %s', shader => {
    expect(() =>
      uvmMaterialShader({
        extensions: {
          UV_game_material: { depthWrite: false, shader },
        },
      } as never),
    ).toThrow(/shader must be a nonempty string/u)
    const { document, binary } = materializeUvmCore(projection([{}]), request)
    document.materials[0]!.extensions = { UV_game_material: { depthWrite: false, shader } } as never
    expect(() =>
      readUvmFacets(document as unknown as JsonObject, binary, { maxScalarBytes: 1_000_000 }),
    ).toThrow(/shader identity must be a nonempty string/u)
  })

  it('refuses a malformed extension object in the direct material readers', () => {
    const { document, binary } = materializeUvmCore(projection([{}]), request)
    document.materials[0]!.extensions = { UV_game_material: null } as never
    expect(() => uvmMaterialShader(document.materials[0] as unknown as JsonObject)).toThrow(
      /game material must be an object/u,
    )
    expect(() =>
      readUvmFacets(document as unknown as JsonObject, binary, { maxScalarBytes: 1_000_000 }),
    ).toThrow(/game material must be an object/u)
  })

  it('writes a team-colour layer without a texture as a whole mask and reads it back (П9)', () => {
    const side = { layers: [{ slot: 'teamColor', blend: 'multiply' }] }
    const { document, binary } = materializeUvmCore(projection([side]), request)
    const json = document as unknown as JsonObject
    expect(() => validateUvmDocument(json, { binaryByteLength: binary.byteLength })).not.toThrow()
    expect(document.extensionsUsed).toContain('UV_game_material_team_color')
    expect(
      (document.materials?.[0] as unknown as { extensions: Record<string, unknown> }).extensions[
        'UV_game_material_team_color'
      ],
    ).toEqual({ maskSource: 'whole', targets: ['baseColor'], blend: 'multiply' })
    expect(
      readUvmFacets(json, binary, { maxScalarBytes: 1_000_000 }).materialRefs[0]?.layers,
    ).toEqual([{ slot: 'teamColor', blend: 'multiply' }])
  })

  it('carries metallic and roughness factors through UVM, silence as the rough dielectric', () => {
    const metal = { metallicFactor: 1, roughnessFactor: 0.25 }
    const { document, binary } = materializeUvmCore(projection([metal, {}]), request)
    const json = document as unknown as JsonObject
    const [first, second] = document.materials as unknown as {
      pbrMetallicRoughness: Record<string, unknown>
    }[]
    expect(first!.pbrMetallicRoughness).toMatchObject({ metallicFactor: 1, roughnessFactor: 0.25 })
    expect(second!.pbrMetallicRoughness).toMatchObject({ metallicFactor: 0, roughnessFactor: 1 })
    const refs = readUvmFacets(json, binary, { maxScalarBytes: 1_000_000 }).materialRefs
    expect(refs[0]).toMatchObject(metal)
    expect(refs[1]).not.toHaveProperty('metallicFactor')
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
