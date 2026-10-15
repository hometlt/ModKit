import { describe, it, expect } from 'vitest'
import type { MapLatticeOverview, WorldSceneLayerItem } from '@modkit/sdk/maps'
import { latticeOverviewPixels } from '../src/world/lattice-overview.js'
import { createWorldLatticePlan } from '../src/world/lattice.js'

const fixture = (): MapLatticeOverview => ({
  provenance: { method: 'test', quality: 'derived', complete: false },
  raster: {
    columns: 2,
    rows: 1,
    origin: [0, 0],
    columnStep: [1, 0],
    rowStep: [0, 1],
    elevation: [
      [
        [1, 2],
        [1, 10],
      ],
    ],
    palette: [
      { value: 0, color: [0, 0, 0] },
      { value: 10, color: [255, 255, 255] },
    ],
  },
  lines: [],
  markers: [],
})
describe('neutral semantic lattice overview', () => {
  it('interpolates supplied scalar palettes and never interprets zero as water or native flags', () => {
    expect([...latticeOverviewPixels(fixture())]).toEqual([51, 51, 51, 255, 255, 255, 255, 255])
  })
  it('shows independently published masks and gives blocking priority over no-build', () => {
    const v = fixture()
    const pixels = latticeOverviewPixels({
      ...v,
      raster: {
        ...v.raster,
        movementProfile: 'fixture/ground',
        blocked: [
          [
            [1, 1],
            [1, 0],
          ],
        ],
        noBuild: [[[2, 1]]],
      },
    })
    expect([...pixels]).toEqual([28, 28, 28, 255, 204, 204, 204, 255])
    const vision = latticeOverviewPixels({ ...v, raster: { ...v.raster, vision: [[[2, 1]]] } })
    expect([...vision.slice(0, 4)]).toEqual([163, 141, 23, 255])
  })
  it('prefers explicitly published canonical geometry only in its selected space', () => {
    const layer: WorldSceneLayerItem = {
      facet: 'layers',
      id: 'ground',
      layerId: 'ground',
      kind: 'terrain',
      state: 'available',
      itemCount: 0,
      lods: ['exact'],
      spaceId: 'one',
      latticeOverview: fixture(),
    }
    expect(createWorldLatticePlan([layer], 'one', 'overview').publishedOverview).toEqual(fixture())
    expect(createWorldLatticePlan([layer], 'two', 'overview').publishedOverview).toBeUndefined()
    expect(createWorldLatticePlan([], undefined, 'overview').publishedOverview).toBeUndefined()
  })
  it('refuses malformed published rasters rather than silently falling back', () => {
    const v = fixture()
    expect(() =>
      latticeOverviewPixels({ ...v, raster: { ...v.raster, elevation: [[[3, 0]]] } }),
    ).toThrow('overflow')
  })
})
