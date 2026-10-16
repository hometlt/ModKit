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
  it('uses only the selected published traversal class and retains independent derived ramp provenance', () => {
    const ground = {facet:'layers',id:'ground',layerId:'ground',kind:'terrain',state:'available',itemCount:0,lods:['exact'],spaceId:'one',
      latticeRamps:{method:'gap',quality:'derived',polygons:[[[0,0],[1,0],[1,1]]]}}
    const layer = (id:string) => ({facet:'layers',id,layerId:id,kind:'traversal',state:'available',itemCount:1,lods:['exact'],spaceId:'one',
      traversal:{classId:id},grid:{columns:1,rows:1,cellSize:2,origin:[0,0,0],coordinateSpaceId:'uvw-canonical'}})
    const cell = (id:string,walkable:boolean) => ({facet:'traversal',id:id+'-cell',layerId:id,coordinateSpaceId:'uvw-canonical',lod:'exact',
      x:0,y:0,walkable,exits:0,uvwPosition:{x:1,y:0,z:1}})
    const items=[ground,layer('ground-movement'),cell('ground-movement',false),layer('hover'),cell('hover',true)] as unknown as import('@modkit/sdk/maps').WorldSceneItem[]
    const plan=createWorldLatticePlan(items,'one','overview','ground-movement')
    expect(plan.movement?.blocked).toEqual([[[0,0],[2,0],[2,2],[0,2]]])
    expect(plan.rampSources).toEqual([{method:'gap',quality:'derived'}])
    expect(plan.ramps).toEqual(ground.latticeRamps.polygons)
    expect(createWorldLatticePlan(items,'one','overview','hover').movement?.blocked).toEqual([])
    expect(createWorldLatticePlan(items,'one','overview','absent').movement).toBeUndefined()
  })
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
