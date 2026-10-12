import { expect, it } from 'vitest'
import { terrainCellHeight, terrainCellSplit, TERRAIN_SPLIT_AC, TERRAIN_SPLIT_BD } from '../src/maps/terrain.js'

it('retains diagonal ties and interpolates both sides of either diagonal', () => {
  expect(terrainCellSplit([0, 1, 2, 3])).toBe(TERRAIN_SPLIT_AC)
  expect(terrainCellHeight([0, 1, 2, 3], 0.75, 0.25)).toBe(1)
  expect(terrainCellHeight([0, 1, 2, 3], 0.25, 0.75)).toBe(2)
  expect(terrainCellSplit([0, 2, 8, 2])).toBe(TERRAIN_SPLIT_BD)
  expect(terrainCellHeight([0, 2, 8, 2], 0.25, 0.25)).toBe(1)
  expect(terrainCellHeight([0, 2, 8, 2], 0.75, 0.75)).toBe(5)
})

it('places a shoreline anchor on its flat triangle instead of a bilinear depression', () => {
  expect(terrainCellHeight([270, 130, 270, 270], 0.51025390625, 0.5807373046875)).toBe(270)
})

it('preserves the first single-corner upper-layer override', () => {
  const heights = [0, 1, 2, 1] as const
  const layers = [{}, { cornerAlpha: [1, 0, 0, 0] as const }, { cornerAlpha: [0, 1, 0, 0] as const }]
  expect(terrainCellSplit(heights, layers)).toBe(TERRAIN_SPLIT_BD)
  expect(terrainCellHeight(heights, 0.5, 0.6, layers)).toBeCloseTo(1.1)
})

it('does not let texture coverage pull a shoreline triangle down', () => {
  const heights = [270, 130, 270, 270] as const
  const layers = [{}, { cornerAlpha: [0, 0, 1, 0] as const }]
  expect(terrainCellSplit(heights, layers)).toBe(TERRAIN_SPLIT_AC)
  expect(terrainCellHeight(heights, 0.690478515625, 0.7609375, layers)).toBe(270)
})
