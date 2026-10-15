import {describe,it,expect} from 'vitest'
import type {MapLatticeOverview} from '@modkit/sdk/maps'
import {parseUvwProfile,serializeUvwProfile,createUvwWorldSceneSource,materializeWorldToUvw,type UvwProfileDocument} from '../src/world/index.js'

const overview:MapLatticeOverview={provenance:{method:'fixture',quality:'authored',complete:true},
  raster:{columns:2,rows:2,origin:[0,1],columnStep:[0.5,0],rowStep:[0,-0.5],
    elevation:[[[1,0],[1,1]],[[2,1]]],palette:[{value:0,color:[0,0,0]},{value:1,color:[255,255,255]}],
    movementProfile:'fixture/ground',blocked:[[[2,0]],[[1,1],[1,0]]],
  },lines:[{role:'cliff',points:[[0,0.5],[1,0.5]],closed:false}],markers:[{
    id:'resource',role:'resource',point:[0.5,0.5],outline:[[0,0],[1,0],[1,1]],color:[255,200,0],opacity:1,
    resourceKind:'fixture-scoped',resourceVariant:'rich',resourceState:'reduced',
  }],playableArea:[[0,0],[1,0],[1,1],[0,1]],
}
const document:UvwProfileDocument={uv:{format:'UVW',version:'1.0',status:'profile'},connections:[],spaces:[{
  id:'main',topology:'heightfield',basis:{handedness:'right',upAxis:'y',forwardAxis:'+z',unit:'meter'},
  bounds:{min:[0,0,0],max:[1,1,1]},layers:[{id:'ground',kind:'heightfield',columns:2,rows:2,cellSize:1,origin:[0,0,0],samples:[[0,0],[1,1]],latticeOverview:overview}],
}]}
describe('UVW semantic lattice overview',()=>{
 it('validates and canonically preserves semantic fields without converting them to an image',()=>{
  const parsed=parseUvwProfile(serializeUvwProfile(document))
  expect(parsed.spaces[0]?.layers[0]).toHaveProperty('latticeOverview',overview)
 })
 it('reopens as layer metadata and survives the canonical materializer',async()=>{
  const source=createUvwWorldSceneSource(document,{snapshotId:'overview-roundtrip'})
  const page=await source.page({facet:'layers',limit:32})
  expect(page.items.find(item=>item.facet==='layers'&&item.kind==='terrain')).toHaveProperty('latticeOverview',overview)
  const result=await materializeWorldToUvw(source,{maxPageItems:32,maxTerrainItems:32,maxOutputBytes:2_000_000,maxFacetItems:32})
  expect(result.state).toBe('materialized')
  if(result.state!=='materialized')throw new Error(JSON.stringify(result.refusals))
  expect(result.document.spaces[0]?.layers[0]).toHaveProperty('latticeOverview',overview)
 })
 it('refuses corrupted row coverage and sample-budget overflow instead of dropping annotations',()=>{
  const corrupt=JSON.parse(JSON.stringify(document))
  corrupt.spaces[0].layers[0].latticeOverview.raster.elevation[0]=[[3,0]]
  expect(()=>parseUvwProfile(new TextEncoder().encode(JSON.stringify(corrupt)))).toThrow('lattice overview')
  expect(()=>parseUvwProfile(serializeUvwProfile(document),{maxSamples:7})).toThrow()
 })
})
