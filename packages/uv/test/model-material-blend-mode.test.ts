import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:blend-mode',
  options: { assetId: 'fixture/blend-mode', sourceFormat: 'json' },
} as never

const projection = (blendMode: string) =>
  ({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded' as const,
    },
    nodes: [
      {
        id: 'cone',
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
        materialId: 'light',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    materials: [
      {
        id: 'light',
        blendMode,
        alphaMode: 'blend',
        shader: { id: 'DefaultW3D.fx', parameters: { BlendMode: 2 } },
      },
    ],
  }) as never

interface Written {
  readonly document: {
    readonly materials: readonly {
      readonly extensions?: { readonly UV_game_material?: Record<string, unknown> }
      readonly extras?: { readonly modkit?: { readonly material?: { readonly fields?: unknown } } }
    }[]
  }
}

describe('a material blend equation', () => {
  it('is written as UV_game_material.blendMode when the extension names it', () => {
    const written = materializeUvmCore(projection('additive'), request) as unknown as Written
    const material = written.document.materials[0]!
    expect(material.extensions?.UV_game_material).toMatchObject({
      shader: 'DefaultW3D.fx',
      blendMode: 'additive',
      params: { BlendMode: 2 },
    })
    // the publisher-native field keeps its place in the material's own envelope
    expect(material.extras?.modkit?.material?.fields).toMatchObject({ blendMode: 'additive' })
  })

  it('stays only in the envelope when the extension has no such equation', () => {
    const written = materializeUvmCore(projection('add-alpha'), request) as unknown as Written
    const material = written.document.materials[0]!
    expect(material.extensions?.UV_game_material).not.toHaveProperty('blendMode')
    expect(material.extras?.modkit?.material?.fields).toMatchObject({ blendMode: 'add-alpha' })
  })
})
