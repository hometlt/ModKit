


import { revisionId, type ArtifactByteSource, type AssetInput, type ContributionContext, type ResourceBudget } from '@modkit/sdk'


import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  WorldScenePageRequest,
  WorldSceneItem,
} from '@modkit/sdk/maps'
import {
  createUvwWorldSceneSource,
  materializeWorldToUvw,
  parseUvwProfile,
  serializeUvwProfile,
} from '../src/world/index.js'

const snapshotId = 'measured-world-revision'
const layerId = 'native:terrain'
const items: readonly WorldSceneItem[] = Object.freeze([
  terrain(0, 0, 0, 0),
  terrain(1, 0, 1, 0),
  terrain(0, 1, 2, -1),
  terrain(1, 1, 3, -1),
])

function terrain(x: number, y: number, height: number, z: number): WorldSceneItem {
  return Object.freeze({
    facet: 'terrain',
    id: `${String(x)}:${String(y)}`,
    layerId,
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x,
    y,
    heightBase: height,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: Object.freeze({ x, y: height, z }),
  })
}

const info: CandidateWorldSceneInfo = Object.freeze({
  contract: 'example.publisher/world-source',
  major: 1,
  maturity: 'publisher-candidate',
  snapshotId,
  mapId: 'measured-world',
  coordinateSpaces: Object.freeze([
    Object.freeze({
      id: 'uvw-canonical',
      horizontalAxes: Object.freeze(['x', 'z'] as const),
      verticalAxis: 'y',
      handedness: 'right',
      linearUnit: 'example-game-unit',
      rotationUnit: 'radian',
      origin: 'measured',
    }),
  ]),
  crossSpaceTransforms: Object.freeze([
    Object.freeze({ from: 'map-native', to: 'uvw-canonical', state: 'known' }),
  ]),
  bounds: Object.freeze([
    Object.freeze({
      facet: 'terrain',
      coordinateSpaceId: 'uvw-canonical',
      x: Object.freeze({ state: 'known', minimum: 0, maximum: 1 }),
      y: Object.freeze({ state: 'known', minimum: 0, maximum: 3 }),
      z: Object.freeze({ state: 'known', minimum: -1, maximum: 0 }),
    }),
  ]),
  uvwTransform: Object.freeze({
    schemaVersion: 1,
    snapshotId,
    sourceCoordinateSpaceId: 'map-native',
    targetCoordinateSpaceId: 'uvw-canonical',
    basis: Object.freeze({
      handedness: 'right',
      upAxis: 'y',
      forwardAxis: '+z',
      unit: 'source-unit',
      sourceUnit: 'example-game-unit',
      unitsPerCell: 1,
    }),
    axes: Object.freeze({
      x: Object.freeze({ sourceAxis: 'x', scale: 1, offset: 0 }),
      y: Object.freeze({ sourceAxis: 'z', scale: 1, offset: 0 }),
      z: Object.freeze({ sourceAxis: 'y', scale: -1, offset: 0 }),
    }),
    heightfield: Object.freeze({
      columns: 2,
      rows: 2,
      cellSize: 1,
      origin: Object.freeze([0, 0, -1] as const),
      sourceRowOrder: 'reverse',
    }),
    bounds: Object.freeze({
      coordinateSpaceId: 'uvw-canonical',
      minimum: Object.freeze({ x: 0, y: 0, z: -1 }),
      maximum: Object.freeze({ x: 1, y: 3, z: 0 }),
    }),
    proof: Object.freeze({
      kind: 'adapter-qualification',
      method: 'sealed-legacy-differential',
      oracle: 'fixture',
      corpus: '2x2',
      sourceDigests: Object.freeze({ input: `sha256:${'1'.repeat(64)}` as const }),
      tupleCount: 4,
      comparison: 'ieee-754-binary64-exact',
      nativeTupleDigest: `sha256:${'2'.repeat(64)}` as const,
      canonicalTupleDigest: `sha256:${'3'.repeat(64)}` as const,
    }),
  }),
  facets: Object.freeze([
    Object.freeze({
      facet: 'terrain',
      layerId,
      state: 'available',
      itemCount: 4,
      lods: Object.freeze(['exact']),
    }),
  ]),
  provenance: Object.freeze([]),
  unknownFacets: Object.freeze(['water']),
  lossPolicy: 'explicit-partial',
  complete: true,
})

function source(pageSize: number, sourceInfo = info): CandidateWorldSceneSource {
  return Object.freeze({
    contract: 'example.publisher/world-source',
    major: 1,
    snapshotId,
    info: () => Promise.resolve(sourceInfo),
    page: (request: WorldScenePageRequest) => {
      const offset = request.cursor === undefined ? 0 : Number(request.cursor)
      const selected = items.slice(offset, offset + pageSize)
      const next = offset + selected.length
      return Promise.resolve(
        Object.freeze({
          snapshotId,
          facet: request.facet,
          state: 'available' as const,
          items: selected,
          ...(next < items.length ? { nextCursor: String(next) } : {}),
        }),
      )
    },
  })
}

const options = Object.freeze({ maxPageItems: 4, maxTerrainItems: 4, maxOutputBytes: 64_000 })


import {expect,it} from 'vitest'
import {waterBoundaryProblem} from '../src/world/water-boundary.js'
import {materializeWorldToUvpMap,openUvpMapBundle,type UvwProfileDocument} from '../src/world/index.js'
const shapes=[undefined,[[0,0],[1,0],[0,1]],[[0,0],[1,0],[1,0.5],[0.5,0.5],[0.5,1],[0,1]]] as const
function waterSource(points:readonly (readonly[number,number])[]|undefined,canonical=true):CandidateWorldSceneSource{
 const sourceInfo:CandidateWorldSceneInfo={...info,unknownFacets:[],facets:[...info.facets,{facet:'water',layerId:'native:water',state:'available',itemCount:1,lods:['exact']}]}
 const terrainSource=source(4,sourceInfo)
 const zone={facet:'water' as const,id:'zone:blue',layerId:'native:water',coordinateSpaceId:'map-native' as const,zoneId:1,templateId:'blue',
  minimum:{x:0,y:0},maximum:{x:1,y:1},elevation:1,uvwMinimum:{x:0,z:-1},uvwMaximum:{x:1,z:0},uvwElevation:1,materialId:'pool_blue',
  ...(points===undefined?{}:{polygon:points.map(([x,y])=>({x,y})),...(canonical?{uvwPolygon:points.map(([x,y])=>({x,z:y===0?0:-y}))}:{})})}
 return {...terrainSource,page:async request=>{
  if(request.facet==='layers')return {snapshotId,facet:'layers',state:'available',items:[{facet:'layers',id:'native:water',layerId:'native:water',kind:'water',state:'available',itemCount:1,lods:['exact'],waterMaterials:[{materialId:'pool_blue',color:[0,0,1,1]}]}]}
  if(request.facet==='water')return {snapshotId,facet:'water',state:'available',items:[zone]}
  return terrainSource.page(request)
 }}
}
const opts={...options,maxPageItems:32,maxTerrainItems:32,maxFacetItems:64,maxOutputBytes:1<<20,packageId:'test/water-boundary',packageVersion:'1.0.0',maxTextureBytes:1024,maxMediaBytes:1024}
for(const [index,points] of shapes.entries())it(`water boundary ${index}: exact ordered data survives UVW and detached UVP`,async()=>{
 const native=waterSource(points),result=await materializeWorldToUvw(native,opts)
 if(result.state!=='materialized')throw new Error(JSON.stringify(result.refusals))
 const zone=result.document.spaces[0]!.layers.find(layer=>layer.kind==='water')!.zones[0]!
 expect(zone.polygon).toEqual(points?.map(([x,y])=>[x,y===0?0:-y]))
 expect(result.lostFields.filter(field=>field.path==='world.water.polygon'||field.path==='world.water.uvwPolygon')).toHaveLength(0)
 const packed=await materializeWorldToUvpMap(native,opts)
 if(packed.state!=='materialized')throw new Error(JSON.stringify(packed.refusals))
 const reopened=await openUvpMapBundle(new Map([...packed.entries].map(([path,bytes])=>[path,bytes.slice()])),{snapshotId:'detached-boundary'})
 const again=await materializeWorldToUvw(reopened.source,opts)
 if(again.state!=='materialized')throw new Error(JSON.stringify(again.refusals))
 expect(again.document).toEqual(packed.document)
 const facet=(await reopened.source.info()).facets.find(facet=>facet.facet==='water')!
 const page=await reopened.source.page({facet:'water',layerId:facet.layerId,limit:32})
 const item=page.items[0]!
 expect(item.facet).toBe('water')
 if(item.facet==='water')expect(item.uvwPolygon?.map(point=>[point.x,point.z])).toEqual(zone.polygon)
})
it('candidate refuses native-only boundary without guessing its canonical frame',async()=>{
 const result=await materializeWorldToUvw(waterSource(shapes[1],false),opts)
 expect(result.state).toBe('refused')
})
it('triangle and concave shapes no longer collapse into identical rectangular bytes',async()=>{
 const bytes=[]
 for(const points of shapes){const result=await materializeWorldToUvw(waterSource(points),opts);if(result.state!=='materialized')throw new Error('refused');bytes.push(new TextDecoder().decode(result.bytes))}
 expect(new Set(bytes).size).toBe(3)
})
it('field admission rejects missing vertices and out-of-bounds vertices',async()=>{
 const result=await materializeWorldToUvw(waterSource(shapes[1]),opts)
 if(result.state!=='materialized')throw new Error('refused')
 for(const polygon of [[],[[0,0],[1,0]],[[0,0],[2,0],[0,-1]]]){
  const document={...result.document,spaces:result.document.spaces.map(space=>({...space,layers:space.layers.map(layer=>layer.kind==='water'?{...layer,zones:layer.zones.map(zone=>({...zone,polygon}))}:layer)}))}
  expect(()=>serializeUvwProfile(document as UvwProfileDocument)).toThrow()
 }
})

it('refuses an oversized boundary before visiting its untrusted vertices',async()=>{
 const result=await materializeWorldToUvw(waterSource(shapes[1]),opts)
 if(result.state!=='materialized')throw new Error('refused')
 const polygon=new Array(4097)
 Object.defineProperty(polygon,0,{get(){throw new Error('oversized vertex was read')}})
 const document={...result.document,spaces:result.document.spaces.map(space=>({...space,layers:space.layers.map(layer=>layer.kind==='water'?{...layer,zones:layer.zones.map(zone=>({...zone,polygon}))}:layer)}))}
 expect(()=>serializeUvwProfile(document)).toThrow(/3\.\.4096/)
})

it('serializer refuses a boundary that is not a simple ring with area', async () => {
  const result = await materializeWorldToUvw(waterSource(shapes[1]), opts)
  if (result.state !== 'materialized') throw new Error('refused')
  for (const polygon of [
    [[0, 0], [1, -1], [1, 0], [0, -0.5]],
    [[0, 0], [1, 0], [0.5, -0.5], [1, -1], [0, -1], [0.5, -0.5]],
    [[0, 0], [0.5, -0.5], [1, -1]],
    [[0, 0], [1, 0], [0, -1], [0, 0]],
    [[0, 0], [1, 0], [0.5, 0], [0.5, -1]],
  ]) {
    const document = { ...result.document, spaces: result.document.spaces.map(space => ({ ...space, layers: space.layers.map(layer => layer.kind === 'water' ? { ...layer, zones: layer.zones.map(zone => ({ ...zone, polygon })) } : layer) })) }
    expect(() => serializeUvwProfile(document as UvwProfileDocument), JSON.stringify(polygon)).toThrow()
  }
})

it('measures area relative to the first vertex and refuses arithmetic that leaves finite precision', () => {
  // area 0.5 far from the origin: an absolute shoelace sum rounds it away
  expect(waterBoundaryProblem([[1e9, 1e9], [1e9 + 1, 1e9], [1e9, 1e9 + 1]], [0, 0], [2e9, 2e9])).toBeUndefined()
  // finite coordinates whose products overflow
  expect(waterBoundaryProblem([[-1e308, -1e308], [1e308, -1e308], [-1e308, 1e308]], [-1e308, -1e308], [1e308, 1e308]))
    .toMatch(/finite precision/)
  // a collinear step forward is allowed, a step back folds the ring
  expect(waterBoundaryProblem([[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]], [0, 0], [2, 2])).toBeUndefined()
  expect(waterBoundaryProblem([[0, 0], [2, 0], [1, 0], [1, 2]], [0, 0], [2, 2])).toMatch(/folds back/)
})
