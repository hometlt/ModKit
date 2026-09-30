import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { uvmImageLogicalId, uvmImageUri } from '../src/model/container.js'
import { readUvmTextureColorKeys, validateUvmDocument } from '../src/model/validation/index.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:texture-color-key',
  options: { assetId: 'fixture/texture-color-key', sourceFormat: 'json' },
} as never

// Emperor spells its textures with flag characters, `%` among them: `!%shel` is a real name.
const projection = {
  info: {
    scenes: 1,
    nodes: 1,
    meshes: 1,
    primitives: 1,
    materials: 1,
    textures: 2,
    animations: 0,
    geometryAccess: 'decoded' as const,
  },
  nodes: [
    {
      id: 'hull',
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
      materialId: 'girder',
    },
  ],
  materials: [{ id: 'girder', layers: [{ slot: 'diffuse', resourceId: '!%shel' }] }],
  resourceClosure: {
    mode: 'logical',
    entries: [
      { role: 'texture', logicalId: '!%shel', colorKey: { color: [255, 0, 255] } },
      { role: 'texture', logicalId: '=HK_girder 128.tga' },
    ],
  },
} as never

type Document = {
  readonly extensionsUsed: readonly string[]
  readonly images: readonly { readonly uri: string }[]
  readonly textures: readonly { readonly source: number; readonly extensions?: unknown }[]
  readonly materials: readonly {
    readonly pbrMetallicRoughness: { readonly baseColorTexture?: { readonly index: number } }
  }[]
}

describe('a colour key the publisher states for a texture', () => {
  const { document } = materializeUvmCore(projection, request) as unknown as {
    readonly document: Document
  }

  it('is written on that texture as UV_texture_color_key and declared', () => {
    expect(document.textures).toEqual([
      { source: 0, extensions: { UV_texture_color_key: { color: [255, 0, 255] } } },
      { source: 1 },
    ])
    expect(document.extensionsUsed).toContain('UV_texture_color_key')
    expect(() => validateUvmDocument(document as never)).not.toThrow()
    expect([...readUvmTextureColorKeys(document as never)]).toEqual([
      [0, { color: [255, 0, 255], tolerance: 0 }],
    ])
  })

  it('writes names that are not URI references as percent-encoded uris and joins them by name', () => {
    expect(document.images.map(image => image.uri)).toEqual(['!%25shel', '=HK_girder%20128.tga'])
    expect(document.images.map(image => uvmImageLogicalId(image.uri))).toEqual([
      '!%shel',
      '=HK_girder 128.tga',
    ])
    // the material layer that names `!%shel` still finds its image
    expect(document.materials[0]?.pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 })
  })

  it('leaves a name that already is a URI reference as it was', () => {
    for (const name of ['textures/block/stone.png', '=At_Hk_patch_high0000_256.tga', '@!dustp'])
      expect(uvmImageUri(name)).toBe(name)
    expect(uvmImageUri('#M61 Isles/test.CPT')).toBe('%23M61%20Isles/test.CPT')
    // a uri written before names were encoded may hold a bare `%`: it names itself
    expect(uvmImageLogicalId('!%shel')).toBe('!%shel')
  })

  it('refuses a key that is not three stored 8-bit channels', () => {
    const invalid = {
      ...(projection as object),
      resourceClosure: {
        mode: 'logical',
        entries: [
          { role: 'texture', logicalId: '!%shel', colorKey: { color: [1, 0, 0.5] } },
          { role: 'texture', logicalId: '=HK_girder 128.tga' },
        ],
      },
    }
    expect(() => materializeUvmCore(invalid as never, request)).toThrow(/colour key/u)
  })

  it('is refused by validation when a texture states it without declaring it', () => {
    const undeclared = {
      ...document,
      extensionsUsed: document.extensionsUsed.filter(name => name !== 'UV_texture_color_key'),
    }
    expect(() => validateUvmDocument(undeclared as never)).toThrow(/UV_texture_color_key/u)
  })
})
