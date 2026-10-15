import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertUvwProfile,createUvwGltfDocument,restoreUvwProfileDocument } from './uvw-profile.mjs'
import { materializeUvwGltfPages } from './uvw-gltf-pages.mjs'
import { packUvwExactPage } from './uvw-exact-page.ts'
const fixture=JSON.parse(await readFile(new URL('../world/fixtures/uvw-unlit.uvw.json',import.meta.url),'utf8'))
test('unlit HDR gain and inactive authored light settings survive inline and paged glTF metadata',()=>{
 assertUvwProfile(fixture)
 const inline=createUvwGltfDocument(fixture)
 assert.deepEqual(restoreUvwProfileDocument(inline),fixture)
 const paged=structuredClone(inline),ground=paged.extensions.UV_world_graph.spaces[0].layers[0],values=ground.samples.flat(),packed=packUvwExactPage('f64-le',values)
 paged.asset.extras.uv.profile='space-graph-paged';paged.buffers=[{uri:'../media/world.bin',byteLength:packed.bytes.length}];paged.bufferViews=[{buffer:0,byteOffset:0,byteLength:packed.bytes.length}]
 ground.samples={count:values.length,pages:[{start:0,bufferView:0,descriptor:packed.descriptor}]}
 assert.deepEqual(materializeUvwGltfPages(paged,[packed.bytes]),inline)
})
test('unlit defaults stay omitted and an inactive multiplier remains authored data in lit',()=>{
 for(const policy of [{},{model:'unlit'},{model:'lit',unlitColor:[0,1,4]}]){
  const source=structuredClone(fixture),lighting=source.spaces[0].layers[1]
  delete lighting.model;delete lighting.unlitColor;Object.assign(lighting,policy)
  assertUvwProfile(source);assert.deepEqual(restoreUvwProfileDocument(createUvwGltfDocument(source)),source)
 }
})
test('unlit validation refuses unknown models, negative or nonfinite gains and wrong vectors',()=>{
 for(const mutation of [light=>{light.model='none'},light=>{light.unlitColor=[-1,1,1]},light=>{light.unlitColor=[Infinity,1,1]},light=>{light.unlitColor=[1,1]}]){
  const source=structuredClone(fixture);mutation(source.spaces[0].layers[1]);assert.throws(()=>assertUvwProfile(source))
 }
})
