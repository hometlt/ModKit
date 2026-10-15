import { test } from 'vitest'
import assert from 'node:assert/strict'
import { projectLatticeOverview, validateLatticeOverview } from '../src/maps/lattice-overview.js'

const fixture=()=>({provenance:{method:'fixture',quality:'authored',complete:true},raster:{
  columns:3,rows:2,origin:[10,20],columnStep:[2,0],rowStep:[0,-3],
  elevation:[[[2,0],[1,10]],[[1,2],[2,4]]],palette:[{value:0,color:[0,0,0]},{value:10,color:[255,255,255]}],
},lines:[{role:'cliff',points:[[10,20],[12,17]],closed:false}],markers:[{
  id:'resource',role:'resource',point:[11,19],outline:[[10,20],[12,20],[12,17]],color:[0,255,0],opacity:1,
  resourceKind:'fixture-resource',resourceVariant:'rich',resourceState:'reduced',
}],playableArea:[[10,20],[16,20],[16,14]]})

test('semantic overview keeps unknown masks, scoped rich resource data and immutable copied geometry',()=>{
 const source=fixture(),result=validateLatticeOverview(source)
 assert.deepEqual(result,source)
 assert.equal(result.raster.blocked,undefined)
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.markers[0].outline[0]))
 source.raster.origin[0]=99
 assert.equal(result.raster.origin[0],10)
 const clear=fixture();clear.raster.noBuild=[[[3,0]],[[3,0]]]
 assert.deepEqual(validateLatticeOverview(clear).raster.noBuild,clear.raster.noBuild)
})

test('projection transforms geometry and sample basis once, preserving palette/masks and avoiding input mutation',()=>{
 const source=fixture()
 const projected=projectLatticeOverview(source,([x,y])=>[100+3*x,200-2*y])
 assert.deepEqual(projected.raster.origin,[130,160])
 assert.deepEqual(projected.raster.columnStep,[6,0])
 assert.deepEqual(projected.raster.rowStep,[0,6])
 assert.deepEqual(projected.markers[0].point,[133,162])
 assert.deepEqual(projected.raster.elevation,source.raster.elevation)
 assert.deepEqual(source.raster.origin,[10,20])
 assert.throws(()=>projectLatticeOverview(source,()=>[0,0]),/Degenerate/)
})

test('malformed rows, masks, palettes, frames, duplicates and unknown fields are refused before raster allocation',()=>{
 for(const mutate of [
  v=>{v.extra=true},v=>{v.raster.elevation[0]=[[4,0]]},v=>{v.raster.elevation[0]=[[2,0]]},
  v=>{v.raster.elevation[0]=[[0,0],[3,1]]},v=>{v.raster.elevation[0]=[[3,Infinity]]},
  v=>{v.raster.palette[1].value=0},v=>{v.raster.palette[0].color[0]=256},
  v=>{v.raster.rowStep=[4,0]},v=>{v.markers.push(v.markers[0])},
  v=>{v.raster.blocked=[[[3,0]],[[3,0]]]},v=>{v.raster.movementProfile='ground';v.raster.blocked=[[[3,2]],[[3,0]]]},
  v=>{v.markers[0].resourceVariant='guessed'},v=>{v.markers[0].opacity=2},
 ]){const v=fixture();mutate(v);assert.throws(()=>validateLatticeOverview(v))}
})

test('limits and abort reject rather than returning a partial semantic overview',()=>{
 assert.throws(()=>validateLatticeOverview(fixture(),{maxSamples:5}),/budget/)
 assert.throws(()=>validateLatticeOverview(fixture(),{maxRuns:3}),/budget/)
 assert.throws(()=>validateLatticeOverview(fixture(),{maxVertices:4}),/budget/)
 const controller=new AbortController();controller.abort(new Error('cancelled'))
 assert.throws(()=>validateLatticeOverview(fixture(),{signal:controller.signal}),/cancelled/)
})
