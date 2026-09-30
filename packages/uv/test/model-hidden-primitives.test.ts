import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'
import { validateUvmDocument } from '../src/model/validation/index.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:hidden-primitives',
  options: { assetId: 'fixture/hidden-primitives', sourceFormat: 'json' },
} as never

const triangle = (id: string, hidden?: true) => ({
  id,
  topology: 'triangles' as const,
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: Uint32Array.from([0, 1, 2]),
  ...(hidden === undefined ? {} : { hidden }),
})

// A unit body, a `#` helper box the game never draws, and a leech overlay shown in one clip.
const base = {
  info: {
    scenes: 1,
    nodes: 3,
    meshes: 3,
    primitives: 3,
    materials: 0,
    textures: 0,
    animations: 0,
    geometryAccess: 'decoded' as const,
  },
  nodes: ['body', 'helper', 'leech'].map((id, index) => ({
    id,
    childIds: index === 0 ? ['helper', 'leech'] : [],
    meshIds: [`${id}-mesh`],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  })),
  meshes: ['body', 'helper', 'leech'].map(id => ({ id: `${id}-mesh`, primitiveIds: [id] })),
  primitives: [triangle('body'), triangle('helper', true), triangle('leech', true)],
}

type Document = {
  readonly extensionsUsed: readonly string[]
  readonly extensions: { readonly UV_game_variants?: { readonly visibility: unknown } }
  readonly animations?: readonly {
    readonly channels: readonly { readonly target: Record<string, unknown> }[]
  }[]
}

describe('a primitive the game draws only when a clip shows it', () => {
  it('is stored with visibility 0, and without a clip no pointer extension is declared', () => {
    const { document } = materializeUvmCore(base as never, request) as unknown as {
      readonly document: Document
    }
    expect(document.extensions.UV_game_variants?.visibility).toEqual([
      { mesh: 1, primitive: 0, value: 0 },
      { mesh: 2, primitive: 0, value: 0 },
    ])
    expect(document.extensionsUsed).toContain('UV_game_variants')
    expect(document.extensionsUsed).not.toContain('KHR_animation_pointer')
    expect(() => validateUvmDocument(document as never)).not.toThrow()
  })

  it('keeps its stored 0 when a clip shows it, and the clip animates that record', () => {
    const projection = {
      ...base,
      info: { ...base.info, animations: 1 },
      animations: [
        {
          id: 'leeched',
          name: 'Leeched',
          kind: 'animation',
          provenance: 'direct',
          frames: 2,
          channels: [
            {
              target: 'leech',
              kind: 'visibility',
              firstFrame: 0,
              lastFrame: 1,
              interpolation: 'step',
              samples: [{ frame: 0, timeSeconds: 0, value: [1] }],
            },
          ],
        },
      ],
    }
    const { document } = materializeUvmCore(projection as never, request) as unknown as {
      readonly document: Document
    }
    expect(document.extensions.UV_game_variants?.visibility).toEqual([
      { mesh: 1, primitive: 0, value: 0 },
      { mesh: 2, primitive: 0, value: 0 },
    ])
    expect(document.extensionsUsed).toContain('KHR_animation_pointer')
    expect(document.animations?.[0]?.channels[0]?.target).toMatchObject({
      path: 'pointer',
      extensions: {
        KHR_animation_pointer: { pointer: '/extensions/UV_game_variants/visibility/1/value' },
      },
    })
    expect(() => validateUvmDocument(document as never)).not.toThrow()
  })
})
