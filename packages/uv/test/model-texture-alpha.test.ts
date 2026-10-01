import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmTextureAlpha, validateUvmDocument } from '../src/model/validation/index.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:texture-alpha',
  options: { assetId: 'fixture/texture-alpha', sourceFormat: 'json' },
} as never

// Emperor reads its 32-bit textures without their alpha, then keys magenta
const projection = (entries: readonly object[]) =>
  ({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: entries.length,
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
        materialId: 'hull',
      },
    ],
    materials: [{ id: 'hull', layers: [{ slot: 'diffuse', resourceId: 'hull.tga' }] }],
    resourceClosure: { mode: 'logical', entries },
  }) as never

type Document = {
  readonly extensionsUsed: readonly string[]
  readonly textures: readonly { readonly source: number; readonly extensions?: unknown }[]
}

describe('a texture whose stored alpha the game ignores', () => {
  const { document } = materializeUvmCore(
    projection([
      {
        role: 'texture',
        logicalId: 'hull.tga',
        ignoreStoredAlpha: true,
        colorKey: { color: [255, 0, 255] },
      },
      { role: 'texture', logicalId: 'glow.tga', ignoreStoredAlpha: true },
      { role: 'texture', logicalId: 'decal.tga' },
    ]),
    request,
  ) as unknown as { readonly document: Document }

  it('is written on its texture as UV_texture_alpha, beside a colour key, and declared', () => {
    expect(document.textures).toEqual([
      {
        source: 0,
        extensions: {
          UV_texture_alpha: { ignoreStoredAlpha: true },
          UV_texture_color_key: { color: [255, 0, 255] },
        },
      },
      { source: 1, extensions: { UV_texture_alpha: { ignoreStoredAlpha: true } } },
      { source: 2 },
    ])
    expect(document.extensionsUsed).toContain('UV_texture_alpha')
    expect(() => validateUvmDocument(document as never)).not.toThrow()
    expect([...readUvmTextureAlpha(document as never)]).toEqual([
      [0, true],
      [1, true],
    ])
  })

  it('is refused undeclared, and stated as anything but true by a publisher', () => {
    const undeclared = {
      ...document,
      extensionsUsed: document.extensionsUsed.filter(name => name !== 'UV_texture_alpha'),
    }
    expect(() => validateUvmDocument(undeclared as never)).toThrow(/UV_texture_alpha/u)
    expect(() =>
      materializeUvmCore(
        projection([{ role: 'texture', logicalId: 'hull.tga', ignoreStoredAlpha: false }]),
        request,
      ),
    ).toThrow(/ignoreStoredAlpha/u)
  })
})
