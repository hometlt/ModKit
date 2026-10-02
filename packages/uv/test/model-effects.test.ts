import { expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:effects',
  options: { assetId: 'fixture/torch', sourceFormat: 'mdx' },
} as never

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const projection = (effects?: unknown) =>
  ({
    info: {
      scenes: 1,
      nodes: 2,
      meshes: 1,
      primitives: 1,
      materials: 2,
      textures: 0,
      animations: 0,
      geometryAccess: 'decoded' as const,
    },
    nodes: [
      { id: 'torch', childIds: ['flame'], meshIds: ['mesh'], transform: identity },
      { id: 'flame', childIds: [], meshIds: [], transform: identity },
    ],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles' as const,
        materialId: 'wood',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    materials: [
      { id: 'wood', layers: [] },
      { id: 'fire', layers: [] },
    ],
    ...(effects === undefined ? {} : { effects }),
  }) as never

interface Written {
  readonly document: {
    readonly extensionsUsed: readonly string[]
    readonly extensions: Record<string, unknown>
    readonly nodes: readonly { readonly mesh?: number }[]
    readonly materials: readonly { readonly name?: string }[]
  }
}

it("writes a model's emitters as UV_game_effects with the document's node and material indices", () => {
  const written = materializeUvmCore(
    projection({
      profile: 'mdx',
      particles: [{ name: 'Fire', nodeId: 'flame', materialId: 'fire', emissionRate: 12 }],
      forces: [{ name: 'Updraft', nodeId: 'flame', type: 'wind' }],
    }),
    request,
  ) as unknown as Written
  const effects = written.document.extensions['UV_game_effects'] as {
    readonly profile: string
    readonly particles: readonly {
      name: string
      node: number
      material: number
      emissionRate: number
    }[]
    readonly forces: readonly { name: string; node: number }[]
  }
  expect(written.document.extensionsUsed).toContain('UV_game_effects')
  expect(effects.profile).toBe('mdx')
  const [fire] = effects.particles
  expect(fire).toMatchObject({ name: 'Fire', emissionRate: 12 })
  expect(fire).not.toHaveProperty('nodeId')
  // the flame node carries no mesh; the fire material is the second
  expect(written.document.nodes[fire!.node]?.mesh).toBeUndefined()
  expect(written.document.materials[fire!.material]?.name ?? 'fire').toBe('fire')
  expect(effects.forces[0]).toEqual({ name: 'Updraft', type: 'wind', node: fire!.node })
  expect(
    (materializeUvmCore(projection(), request) as unknown as Written).document.extensionsUsed,
  ).not.toContain('UV_game_effects')
})

it('refuses emitters naming nothing written, an index of their own, or a raw record', () => {
  for (const effects of [
    { particles: [{ name: 'Fire', nodeId: 'nowhere', materialId: 'fire' }] },
    { particles: [{ name: 'Fire', nodeId: 'flame', materialId: 'stone' }] },
    { particles: [{ name: 'Fire', nodeId: 'flame', materialId: 'fire', node: 1 }] },
    { forces: [{ name: 'Wind', nodeId: 'flame', materialId: 'fire' }] },
    { ribbons: [{ nodeId: 'flame', materialId: 'fire' }] },
  ])
    expect(() => materializeUvmCore(projection(effects), request)).toThrow(TypeError)
  expect(() =>
    materializeUvmCore(
      {
        ...(projection() as object),
        gameExtensions: { UV_game_effects: { particles: [] } },
      } as never,
      request,
    ),
  ).toThrow(TypeError)
})
