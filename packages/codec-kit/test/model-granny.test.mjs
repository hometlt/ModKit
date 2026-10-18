/** Self-authored Granny fixture: real header/CRC/relocations, no proprietary game bytes. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readGranny, sampleGrannyCurve } from '../dist/model/granny.js'
import { decompressOodle1 } from '../dist/compression/oodle1.js'
import { crc32 } from '../dist/checksum/index.js'

function fixture() {
  const bytes = new Uint8Array(228), v = new DataView(bytes.buffer)
  bytes.set([0xb8,0x67,0xb0,0xca,0xf8,0x6d,0xb1,0x0f,0x84,0x72,0x8c,0x7e,0x5e,0x19,0,0x1e])
  for (const [at, value] of [[16,132],[32,6],[36,228],[44,56],[48,1],[64,80],
    [92,144],[96,84],[100,84],[104,4],[108,84],[112,84],[116,132],[120,1],[124,144],
    [132,4],[136,0],[140,64],[144,10]]) v.setUint32(at,value,true)
  bytes.set(new TextEncoder().encode('Value\0'),208)
  v.setFloat32(224,42.5,true)
  v.setUint32(40,crc32(bytes.subarray(88)),true)
  return bytes
}
const limits = { maxBytes: 1<<20, maxNodes: 1000, maxDepth: 16 }
test('Granny embedded type, section-relative name relocation and object scalar',()=>{
  assert.equal(readGranny(fixture(),limits).Value,42.5)
  assert.equal(readGranny(fixture(),{...limits,maxTextBytes:5}).Value,42.5)
  assert.throws(()=>readGranny(fixture(),{...limits,maxTextBytes:4}),/text budget/)
})

test('container section and relocation charges remain in the graph node budget',()=>{
  assert.throws(()=>readGranny(fixture(),{...limits,maxNodes:4}),/node budget/)
  assert.equal(readGranny(fixture(),{...limits,maxNodes:6}).Value,42.5)
})
test('Granny refuses CRC, section range, missing pointer, nonfinite and budgets',()=>{
  const bad=fixture();bad[224]^=1
  assert.throws(()=>readGranny(bad,limits),/CRC/)
  for(const [at,value]of [[140,999],[144,99],[224,0x7fc00000]]){
    const bytes=fixture(),view=new DataView(bytes.buffer);view.setUint32(at,value,true);view.setUint32(40,crc32(bytes.subarray(88)),true)
    assert.throws(()=>readGranny(bytes,limits))
  }
  assert.throws(()=>readGranny(fixture(),{...limits,maxBytes:227}))
  assert.throws(()=>readGranny(fixture(),{...limits,maxNodes:1}))
  assert.throws(()=>readGranny(fixture(),limits,AbortSignal.abort()),{name:'AbortError'})
})
test('Oodle1 three streams have independent coders and bounded shared input',()=>{
  const bytes=new Uint8Array(68),view=new DataView(bytes.buffer)
  for(let i=0;i<3;i++){view.setUint32(i*12,1,true);view.setUint32(i*12+4,1,true);view.setUint32(i*12+8,0x01010101,true)}
  assert.deepEqual(decompressOodle1(bytes,3,1,2,1<<20),new Uint8Array(3))
  assert.throws(()=>decompressOodle1(bytes,4,1,2,3),/budget/)
  assert.throws(()=>decompressOodle1(bytes.subarray(0,37),100,50,50,1<<20),/truncated/)
  assert.throws(()=>decompressOodle1(bytes,3,2,1,3))
  assert.throws(()=>decompressOodle1(bytes,3,1,2,3,AbortSignal.abort()),{name:'AbortError'})
})
test('Oodle1 adaptive models have a pre-allocation ceiling even for a huge declared window',()=>{
  const bytes=new Uint8Array(68),view=new DataView(bytes.buffer)
  for(let i=0;i<3;i++){view.setUint32(i*12,0xfffffe01,true);view.setUint32(i*12+4,1,true)}
  assert.equal(decompressOodle1(bytes,0,0,0,0).length,0)
  assert.throws(()=>decompressOodle1(bytes,1,1,1,1024),/workspace budget/)
})
test('Granny curve validates knots/width and exact constant/linear endpoints',()=>{
  assert.deepEqual(sampleGrannyCurve({degree:1,knots:[0,2],controls:[0,2,4,6],dimension:2},1),[2,4])
  assert.deepEqual(sampleGrannyCurve({degree:0,knots:[0],controls:[3],dimension:1},10),[3])
  assert.throws(()=>sampleGrannyCurve({degree:1,knots:[2,0],controls:[0,1],dimension:1},1))
  assert.throws(()=>sampleGrannyCurve({degree:1,knots:[0,1],controls:[0],dimension:1},1))
})
