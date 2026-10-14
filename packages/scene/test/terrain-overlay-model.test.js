import assert from 'node:assert/strict'
import { test } from 'node:test'
import { materializeTerrainOverlayModels } from '../src/world/terrain-overlay-model.js'
import { readUvmAccessor } from '@modkit/uv/model/accessor'
import { writeUvmContainer } from '@modkit/uv/model/container'
import { uvmTriangleAreaVector } from '../src/uvm/normals.js'

const options = {assetId:'surface',maxVerticesPerModel:3,maxModels:4,maxScalarBytes:1<<20}
const input = () => ({positions:Float32Array.of(0,0,0,0,1,1,1,0,0,1,0,0,0,1,1,1,1,1),
  textureCoordinates:Float32Array.of(0,0,0,1,1,0,1,0,0,1,1,1),
  coverage:Float32Array.of(1,.5,0,0,.5,1),texturePath:'media/surface.dds',priority:3})
const accessor=(c,semantic)=>readUvmAccessor(c.document,c.binary,
  c.document.meshes[0].primitives[0].attributes[semantic],{maxScalarBytes:1<<20},semantic).values

test('ordered overlay chunks preserve slope, UVs and coverage without mutating source',()=>{
  const source=input(),before=structuredClone(source),chunks=materializeTerrainOverlayModels(source,options).models
  assert.equal(chunks.length,2);assert.deepEqual(source,before)
  assert.deepEqual([...accessor(chunks[0],'POSITION')],[0,0,0,0,1,1,1,0,0])
  assert.deepEqual([...accessor(chunks[1],'TEXCOORD_0')],[1,0,0,1,1,1])
  assert.deepEqual([...accessor(chunks[0],'COLOR_0')],[1,1,1,1,1,1,1,.5,1,1,1,0])
  const standard=chunks[0].document.materials[0].extensions.UV_game_material.params.renderModel.standard
  assert.equal(standard.priority,3);assert.equal(standard.blendMode,1)
  assert.equal(standard.usesVertexAlpha,true);assert.equal(standard.usesVertexColor,false)
  assert.equal(standard.layers.alpha1.channels,2)
  assert.equal(standard.layers.diffuse.channels,0)
  assert.equal(standard.layers.alpha1.texturePath,source.texturePath)
  assert.deepEqual(chunks.map(c=>writeUvmContainer(c)),materializeTerrainOverlayModels(source,options).models.map(c=>writeUvmContainer(c)))
})

test('overlay frame changes positions and winding together, with unit normals',()=>{
  const c=materializeTerrainOverlayModels(input(),{...options,frame:[-2,0,0,0,0,2,0,0,0,0,2,0,3,4,5,1]}).models[0]
  assert.deepEqual([...accessor(c,'POSITION')],[3,4,5,3,6,7,1,4,5])
  const ids=readUvmAccessor(c.document,c.binary,c.document.meshes[0].primitives[0].indices,{maxScalarBytes:1<<20},'ids').values
  assert.deepEqual([...ids],[0,2,1])
  const n=accessor(c,'NORMAL');for(let i=0;i<n.length;i+=3)assert.ok(Math.abs(Math.hypot(...n.slice(i,i+3))-1)<1e-6)
})

test('malformed or over-budget overlay refuses without partial artifacts',()=>{
  assert.throws(()=>materializeTerrainOverlayModels({...input(),coverage:Float32Array.of(1)},options))
  const bad=input();bad.coverage[0]=NaN;assert.throws(()=>materializeTerrainOverlayModels(bad,options))
  assert.throws(()=>materializeTerrainOverlayModels({...input(),texturePath:'../outside.dds'},options))
  assert.throws(()=>materializeTerrainOverlayModels(input(),{...options,maxModels:1}),/budget/)
  assert.throws(()=>materializeTerrainOverlayModels(input(),{...options,maxScalarBytes:10}),/budget/)
  assert.throws(()=>materializeTerrainOverlayModels(input(),{...options,frame:new Array(16).fill(0)}))
})

test('explicit zero-area omission reports indices and keeps all drawable triangles',()=>{
  const source=input();source.positions.set([0,0,0,0,0,0,0,0,0],0)
  assert.throws(()=>materializeTerrainOverlayModels(source,options),/zero-area/)
  const result=materializeTerrainOverlayModels(source,{...options,degenerateTriangles:'omit-zero-area'})
  assert.deepEqual(result.omittedTriangleIndices,[0]);assert.equal(result.models.length,1)
  assert.deepEqual([...accessor(result.models[0],'TEXCOORD_0')],[1,0,0,1,1,1])
})

test('coverage-only layers retain an explicit alpha program and validate empty results',()=>{
  const c=materializeTerrainOverlayModels({...input(),textureAlpha:'ignore',priority:415},options).models[0]
  const standard=c.document.materials[0].extensions.UV_game_material.params.renderModel.standard
  assert.equal(standard.priority,415)
  assert.equal(standard.layers.diffuse.channels,0)
  assert.equal(standard.layers.alpha1.texturePath,null)
  assert.deepEqual(standard.layers.alpha1.constantColor.value,[1,1,1,1])
  const empty=input();empty.positions.fill(0)
  assert.throws(()=>materializeTerrainOverlayModels(empty,{...options,frame:new Array(16).fill(0),degenerateTriangles:'omit-zero-area'}))
  const result=materializeTerrainOverlayModels(empty,{...options,degenerateTriangles:'omit-zero-area'})
  assert.equal(result.models.length,0);assert.deepEqual(result.omittedTriangleIndices,[0,1])
  assert.throws(()=>uvmTriangleAreaVector([0,0,0,1],0,0,0),/complete positions/)
})

test('cancelled authoring refuses before producing artifacts',()=>{
  const controller=new AbortController();controller.abort(new Error('cancel surface'))
  assert.throws(()=>materializeTerrainOverlayModels(input(),options,controller.signal),/cancel surface/)
})
