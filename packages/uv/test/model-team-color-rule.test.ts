import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { validateUvmDocument } from '../src/model/validation/index.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:team-color-rule',
  options: { assetId: 'fixture/team-color-rule', sourceFormat: 'json' },
} as never

const projection = (layers: readonly object[]) =>
  ({
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
        materialId: 'hull',
      },
    ],
    materials: [{ id: 'hull', layers }],
    resourceClosure: {
      mode: 'logical',
      entries: [
        { role: 'texture', logicalId: 'hull.tga' },
        { role: 'texture', logicalId: 'houses.png' },
      ],
    },
  }) as never

type Written = {
  readonly document: {
    readonly materials: readonly { readonly extensions?: Record<string, unknown> }[]
  }
}
const teamOf = (layers: readonly object[]) => {
  const written = materializeUvmCore(projection(layers), request) as unknown as Written
  expect(() => validateUvmDocument(written.document as never)).not.toThrow()
  return written.document.materials[0]?.extensions?.['UV_game_material_team_color']
}

describe('a team colour rule the publisher states (Runtime 02.10)', () => {
  it('writes Emperor’s blue key over the base colour, with blend replace', () => {
    expect(
      teamOf([
        { slot: 'diffuse', resourceId: 'hull.tga' },
        { slot: 'teamColor', blend: 'replace', teamColor: { maskSource: 'channelKey' } },
      ]),
    ).toEqual({ maskSource: 'channelKey', targets: ['baseColor'], blend: 'replace' })
  })

  it('writes a house ramp: its index mask, range and exact shades', () => {
    const ramp = [
      [0.1, 0, 0],
      [0.5, 0, 0],
      [1, 0, 0],
    ]
    expect(
      teamOf([
        { slot: 'diffuse', resourceId: 'hull.tga' },
        {
          slot: 'teamColor',
          resourceId: 'houses.png',
          colorChannels: 1,
          blend: 'replace',
          teamColor: { maskSource: 'paletteRange', range: [80, 82], ramp },
        },
      ]),
    ).toEqual({
      maskSource: 'paletteRange',
      maskTexture: { index: 1, channel: 'r' },
      targets: ['baseColor'],
      blend: 'replace',
      range: [80, 82],
      ramp,
    })
  })

  it('writes the object tint as the colour and the mask colour as its tint', () => {
    expect(
      teamOf([
        {
          slot: 'teamColor',
          resourceId: 'houses.png',
          colorChannels: 8,
          blend: 'multiply',
          teamColor: { colorSource: 'object-tint', tint: 'mask-rgb', strength: 0.5 },
        },
      ]),
    ).toEqual({
      maskSource: 'texture',
      maskTexture: { index: 1, channel: 'a' },
      targets: ['baseColor'],
      blend: 'multiply',
      colorSource: 'object-tint',
      tint: 'mask-rgb',
      strength: 0.5,
    })
  })

  it('refuses a key or a ramp without blend replace, and a ramp short of its range', () => {
    expect(() =>
      materializeUvmCore(
        projection([
          { slot: 'diffuse', resourceId: 'hull.tga' },
          { slot: 'teamColor', teamColor: { maskSource: 'channelKey' } },
        ]),
        request,
      ),
    ).toThrow(/replace/u)
    expect(() =>
      materializeUvmCore(
        projection([
          {
            slot: 'teamColor',
            resourceId: 'houses.png',
            blend: 'replace',
            teamColor: { maskSource: 'paletteRange', range: [80, 82], ramp: [[1, 0, 0]] },
          },
        ]),
        request,
      ),
    ).toThrow(/ramp/u)
  })
})
