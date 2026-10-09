import { expect, it } from 'vitest'
import { materializeUvmCore } from '../src/model/materializer.js'

/**
 * Baked particles (SPEC_UVM §13.4): batches name their material, tracks their clip by sequence,
 * and the offsets and sprites become accessors under the materializer's frame node.
 */
const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:baked',
  options: { assetId: 'fixture/fire', sourceFormat: 'mdx' },
} as never
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const sprite = (x: number) => [x, 0, 0, 0.5, 0.5, 0, 1, 0.5, 0, 1, 2, 0, 0, 1, 0, 0, 1]
const projection = (frames: number[], sprites: number[], clipId = 'birth') =>
  ({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: 0,
      animations: 1,
      geometryAccess: 'decoded' as const,
    },
    nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles' as const,
        materialId: 'fire',
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    materials: [{ id: 'fire', layers: [] }],
    animations: [
      {
        id: 'birth',
        name: 'Birth',
        kind: 'animation',
        provenance: 'direct',
        frames: 30,
        sequenceIndex: 3,
        channels: [],
      },
    ],
    bakedParticles: {
      frameRate: 15,
      batches: [{ name: 'Flame', materialId: 'fire', orientation: 'camera', atlas: [4, 4] }],
      tracks: [
        {
          clipId,
          batch: 0,
          loop: true,
          frames: Uint32Array.from(frames),
          sprites: Float32Array.from(sprites),
        },
      ],
    },
  }) as never

it('writes baked sprites as UV_game_baked_particles with accessors and the clip sequence', () => {
  const written = materializeUvmCore(
    projection([0, 1, 3], [...sprite(1), ...sprite(2), ...sprite(3)]),
    request,
  ) as unknown as {
    document: {
      extensionsUsed: string[]
      extensions: Record<string, unknown>
      accessors: { componentType: number; count: number }[]
    }
    bytes: Uint8Array
  }
  const { document } = written
  expect(document.extensionsUsed).toContain('UV_game_baked_particles')
  const baked = document.extensions['UV_game_baked_particles'] as {
    frameRate: number
    batches: { material: number; orientation: string; atlas: number[] }[]
    tracks: { sequence: number; batch: number; loop: boolean; frames: number; sprites: number }[]
  }
  expect(baked.frameRate).toBe(15)
  expect(baked.batches).toEqual([
    { name: 'Flame', material: 0, orientation: 'camera', atlas: [4, 4] },
  ])
  const [track] = baked.tracks
  expect(track).toMatchObject({ sequence: 3, batch: 0, loop: true })
  expect(document.accessors[track!.frames]).toMatchObject({ componentType: 5125, count: 3 })
  expect(document.accessors[track!.sprites]).toMatchObject({ componentType: 5126, count: 51 })
})

it('refuses offsets that do not reach the sprite count and clips it does not know', () => {
  expect(() =>
    materializeUvmCore(projection([0, 1], [...sprite(1), ...sprite(2)]), request),
  ).toThrow(/frame offsets/)
  expect(() => materializeUvmCore(projection([0, 1], sprite(1), 'stand'), request)).toThrow(
    /unknown clip/,
  )
})

it('writes the space node a projection names for its sprites', () => {
  const given = projection([0, 1], sprite(1)) as unknown as { bakedParticles: object }
  const written = materializeUvmCore(
    { ...given, bakedParticles: { ...given.bakedParticles, spaceNodeId: 'root' } } as never,
    request,
  ) as unknown as { document: { extensions: Record<string, { spaceNode?: number }> } }
  expect(written.document.extensions['UV_game_baked_particles']?.spaceNode).toBe(0)
})
