import { describe, expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:game-extensions',
  options: { assetId: 'fixture/game-extensions', sourceFormat: 's3o' },
} as never

const projection = (gameExtensions?: unknown) =>
  ({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 0,
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
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles' as const,
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    ...(gameExtensions === undefined ? {} : { gameExtensions }),
  }) as never

interface Written {
  readonly document: {
    readonly extensionsUsed: readonly string[]
    readonly extensions: Record<string, unknown>
  }
}

describe('game records on the UVM root', () => {
  it('writes a UV_game_<id> record as given and declares it', () => {
    const spring = { radius: 24.5, height: 30, midPos: [0, 12, 0] }
    const written = materializeUvmCore(
      projection({ UV_game_spring: spring }),
      request,
    ) as unknown as Written
    expect(written.document.extensions.UV_game_spring).toEqual(spring)
    expect(written.document.extensionsUsed).toContain('UV_game_spring')
    const plain = materializeUvmCore(projection(), request) as unknown as Written
    expect(plain.document.extensionsUsed.some(name => name.startsWith('UV_game_spring'))).toBe(
      false,
    )
  })

  it('refuses other names, the materializer’s own records and values that are not JSON objects', () => {
    for (const records of [
      { UV_units: {} },
      { UV_game_Spring: {} },
      { UV_game_material: {} },
      { UV_game_spring: [1, 2] },
      { UV_game_spring: { radius: Number.NaN } },
      { UV_game_spring: { when: new Date(0) } },
    ])
      expect(() => materializeUvmCore(projection(records), request)).toThrow(TypeError)
  })
})
