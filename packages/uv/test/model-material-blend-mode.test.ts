import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { validateUvmDocument } from '../src/model/validation/index.js'

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

function materialProjection(material: Readonly<Record<string, unknown>>) {
  const base = projection('additive') as unknown as Record<string, unknown>
  return { ...base, materials: [{ id: 'light', ...material }] } as never
}

describe('a material blend equation', () => {
  it('is written as UV_game_material.blendMode when the extension names it', () => {
    // add-alpha (SrcAlpha, One) joined the extension's equations on 02.10 (Kane's Wrath)
    for (const blendMode of ['additive', 'add-alpha']) {
      const written = materializeUvmCore(projection(blendMode), request) as unknown as Written
      const material = written.document.materials[0]!
      expect(material.extensions?.UV_game_material).toMatchObject({
        shader: 'DefaultW3D.fx',
        blendMode,
        params: { BlendMode: 2 },
      })
      // the publisher-native field keeps its place in the material's own envelope
      expect(material.extras?.modkit?.material?.fields).toMatchObject({ blendMode })
    }
  })

  it('stays only in the envelope when the extension has no such equation', () => {
    const written = materializeUvmCore(projection('add-signed'), request) as unknown as Written
    const material = written.document.materials[0]!
    expect(material.extensions?.UV_game_material).not.toHaveProperty('blendMode')
    expect(material.extras?.modkit?.material?.fields).toMatchObject({ blendMode: 'add-signed' })
  })

  it.each([
    [{ blendMode: 'additive' }, { blendMode: 'additive' }],
    [{ depthWrite: false }, { depthWrite: false }],
    [{ priority: 0 }, { sortPriority: 0 }],
    [
      { blendMode: 'add-alpha', depthWrite: true, priority: -7 },
      { blendMode: 'add-alpha', depthWrite: true, sortPriority: -7 },
    ],
  ])('writes factual state without inventing a shader or defaults: %j', (source, expected) => {
    const { document, binary } = materializeUvmCore(
      materialProjection({ alphaMode: 'blend', ...source }),
      request,
    )
    expect(document.materials[0]?.extensions?.UV_game_material).toEqual(expected)
    expect(document.materials[0]?.alphaMode).toBe('BLEND')
    expect(document.extensionsUsed).toContain('UV_game_material')
    expect(() =>
      validateUvmDocument(document as never, { binaryByteLength: binary.byteLength }),
    ).not.toThrow()
  })

  it('does not create an empty extension for unrepresented native state', () => {
    const { document, binary } = materializeUvmCore(
      materialProjection({ blendMode: 'add-signed', priority: 1.5 }),
      request,
    )
    expect(document.materials[0]?.extensions?.UV_game_material).toBeUndefined()
    expect(document.extensionsUsed).not.toContain('UV_game_material')
    expect(document.materials[0]?.extras?.modkit.material.fields).toMatchObject({
      blendMode: 'add-signed',
      priority: 1.5,
    })
    expect(() =>
      validateUvmDocument(document as never, { binaryByteLength: binary.byteLength }),
    ).not.toThrow()
  })

  it.each([
    {},
    { params: {} },
    { blendMode: 'additive', params: {} },
    { blendMode: 'additive', layers: [] },
    { depthWrite: false, passes: [] },
    { priority: 7 },
    { sortPriority: 7, parameters: {} },
    { blendMode: 'add-signed' },
    { depthWrite: 1 },
    { depthWrite: null },
    { depthWrite: undefined },
    { sortPriority: 0.5 },
    { sortPriority: Infinity },
    { sortPriority: Number.MAX_SAFE_INTEGER + 1 },
    { shader: '', blendMode: 'additive' },
    { shader: null, blendMode: 'additive' },
    { shader: undefined, depthWrite: false },
  ])('refuses an unadmitted fixed-state packet: %j', extension => {
    const { document, binary } = materializeUvmCore(projection('additive'), request)
    document.materials[0]!.extensions!.UV_game_material = extension as never
    expect(() =>
      validateUvmDocument(document as never, { binaryByteLength: binary.byteLength }),
    ).toThrow(/UV_game_material/u)
  })

  it('keeps the existing shader parameters and requires the extension declaration', () => {
    const { document, binary } = materializeUvmCore(projection('additive'), request)
    expect(() =>
      validateUvmDocument(document as never, { binaryByteLength: binary.byteLength }),
    ).not.toThrow()
    expect(document.materials[0]?.extensions?.UV_game_material).toEqual({
      shader: 'DefaultW3D.fx',
      blendMode: 'additive',
      params: { BlendMode: 2 },
    })
    document.extensionsUsed = document.extensionsUsed.filter(name => name !== 'UV_game_material')
    expect(() =>
      validateUvmDocument(document as never, { binaryByteLength: binary.byteLength }),
    ).toThrow(/not declared/u)
  })
})
