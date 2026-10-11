import { describe, expect, it } from 'vitest'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

const polygon = [
  [0.25, 0],
  [0.75, 0],
  [0.75, 1],
  [0.25, 1],
] as const
function plan(clipPolygon: readonly (readonly [number, number])[]) {
  const texture = { id: 't', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
  return createWorldWebGlPlan({
    items: [
      ...[
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([x, y], index) => ({
        facet: 'terrain' as const,
        id: `v${index}`,
        layerId: 'terrain',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x: x!,
        y: y!,
        heightBase: index === 2 ? 4 : 0,
        heightAdjustment: 0,
        mask: 0,
        uvwPosition: { x: x!, y: index === 2 ? 4 : 0, z: y! },
      })),
      {
        facet: 'terrain-materials',
        id: 'cell',
        layerId: 'materials',
        coordinateSpaceId: 'height-grid',
        lod: 'exact',
        x: 0,
        y: 0,
        textureIndex: 0,
        layers: [
          { materialId: 'ground', tile: { column: 0, row: 0 } },
          {
            materialId: 'road',
            tile: { column: 0, row: 0 },
            cornerUv: [
              [2, 3],
              [4, 3],
              [4, 5],
              [2, 5],
            ],
            cornerAlpha: [0, 1, 1, 0],
            clipPolygon,
          },
        ],
      },
    ],
    terrainMaterials: [
      { materialId: 'ground', baseColorResourceId: 't' },
      { materialId: 'road', baseColorResourceId: 't' },
    ],
    terrainTextures: new Map([['t', texture]]),
  })
}

describe('clipped terrain overlay', () => {
  it.each([{ clip: polygon }, { clip: [...polygon].reverse() }])(
    'clips either winding and interpolates triangle varyings',
    ({ clip }) => {
      const batch = plan(clip).terrainDecalTriangles[0]!
      let area = 0
      for (let i = 0; i < batch.positions.length; i += 9) {
        const p = batch.positions
        area +=
          Math.abs(
            (p[i + 3]! - p[i]!) * (p[i + 8]! - p[i + 2]!) -
              (p[i + 6]! - p[i]!) * (p[i + 5]! - p[i + 2]!),
          ) / 2
      }
      expect(area).toBeCloseTo(0.5)
      for (let i = 0; i < batch.positions.length / 3; i += 1) {
        const x = batch.positions[i * 3]!,
          z = batch.positions[i * 3 + 2]!
        expect(x).toBeGreaterThanOrEqual(0.25)
        expect(x).toBeLessThanOrEqual(0.75)
        expect(batch.textureCoordinates[i * 2]).toBeCloseTo(2 + 2 * x)
        expect(batch.textureCoordinates[i * 2 + 1]).toBeCloseTo(3 + 2 * z)
        expect(batch.colors[i * 4]).toBeCloseTo(x)
      }
    },
  )
  it('rejects concave, self-intersecting and zero-area boundaries', () => {
    for (const invalid of [
      [
        [0, 0],
        [1, 0],
        [0.25, 0.25],
        [0, 1],
      ],
      [
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 0],
      ],
      [
        [0, 0],
        [0.5, 0],
        [1, 0],
      ],
    ])
      expect(() => plan(invalid as [number, number][])).toThrow(/polygon/)
  })
})
