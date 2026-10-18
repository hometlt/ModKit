/** Handwritten native packed records: 44-byte members and unaligned u64 fields. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readGrannyVariant } from '../dist/model/granny.js'
const limits = { maxBytes: 1 << 20, maxNodes: 1000, maxDepth: 16 }
function fixture() {
  const bytes = new Uint8Array(1024), v = new DataView(bytes.buffer)
  const text = (at, value) => bytes.set(new TextEncoder().encode(value+'\0'),at)
  const member = (at, kind, name, tp = 0) => {
    v.setUint32(at,kind,true);v.setBigUint64(at+4,BigInt(name),true)
    v.setBigUint64(at+12,BigInt(tp),true)
  }
  for(const [i,kind,name] of [[0,2,'Ref'],[1,3,'Array'],[2,8,'Label'],[3,5,'Variant'],[4,4,'Refs'],[5,7,'Variants']]){
    text(780+i*20,name);member(32+i*44,kind,780+i*20,[2,3,4].includes(kind)?352:0)
  }
  member(352,10,920);text(920,'Real32')
  v.setBigUint64(512,640n,true)
  v.setUint32(520,2,true);v.setBigUint64(524,648n,true)
  v.setBigUint64(532,940n,true);text(940,'native')
  v.setBigUint64(540,352n,true);v.setBigUint64(548,640n,true)
  v.setUint32(556,2,true);v.setBigUint64(560,680n,true)
  v.setBigUint64(568,352n,true);v.setUint32(576,2,true);v.setBigUint64(580,648n,true)
  v.setFloat32(640,1.25,true);v.setFloat32(648,2.5,true);v.setFloat32(652,3.5,true)
  v.setBigUint64(680,640n,true);v.setBigUint64(688,648n,true)
  return bytes
}
const read = (bytes, options = limits) => readGrannyVariant(bytes,32,512,'packed-le64',options)
test('packed profile shares object identity, flat Real32 arrays, strings and variant references',()=>{
  const native=fixture(), model=read(native)
  assert.equal(Object.getPrototypeOf(model),null)
  assert.deepEqual(model.Array,[2.5,3.5]);assert.deepEqual(model.Variants,[2.5,3.5])
  assert.equal(model.Label,'native');assert.equal(model.Ref.Real32,1.25)
  assert.equal(model.Ref,model.Variant);assert.equal(model.Refs[0],model.Ref)
  const sliced=new Uint8Array(native.length+16);sliced.set(native,7)
  assert.deepEqual(read(sliced.subarray(7,7+native.length)),model)
  native.fill(0);assert.equal(model.Label,'native');assert.equal(model.Ref.Real32,1.25)
})
test('packed profile refuses unsafe pointers, nonfinite values, malformed text and budget overruns',()=>{
  for(const [at,value,width] of [[36,2n**60n,8],[512,1023n,8],[524,1020n,8],[520,1001n,4],[640,0x7fc00000n,4],[352,99n,4]]){
    const bytes=fixture(),v=new DataView(bytes.buffer)
    width===8?v.setBigUint64(at,value,true):v.setUint32(at,Number(value),true)
    assert.throws(()=>read(bytes))
  }
  const malformed=fixture();malformed[940]=0xff;assert.throws(()=>read(malformed))
  for(const options of [{...limits,maxBytes:1023},{...limits,maxNodes:5}]) assert.throws(()=>read(fixture(),options))
  const expanded=fixture();new DataView(expanded.buffer).setUint32(520,70,true)
  assert.throws(()=>read(expanded,{...limits,maxBytes:1024}),/materialized/)
  assert.throws(()=>readGrannyVariant(fixture(),32,512,'guess',limits))
  assert.throws(()=>readGrannyVariant(fixture(),32,512,'packed-le64',limits,AbortSignal.abort()),{name:'AbortError'})
})
test('packed explicit zero null semantics and cyclic/recursive-inline refusal',()=>{
  const bytes=fixture(),v=new DataView(bytes.buffer)
  v.setBigUint64(512,0n,true);v.setUint32(520,0,true);v.setBigUint64(524,0n,true)
  v.setBigUint64(532,0n,true);v.setBigUint64(540,0n,true);v.setBigUint64(548,0n,true)
  const model=read(bytes);assert.equal(model.Ref,null);assert.deepEqual(model.Array,[])
  assert.equal(model.Label,'');assert.equal(model.Variant,null)
  for(const kind of [1,2]){
    const bad=fixture(),w=new DataView(bad.buffer)
    w.setUint32(32,kind,true);w.setBigUint64(44,32n,true);w.setBigUint64(512,512n,true)
    assert.throws(()=>read(bad),/recursive inline|cyclic/)
  }
  const nonzero=fixture();new DataView(nonzero.buffer).setBigUint64(512,0xffffffffffffffffn,true)
  assert.throws(()=>read(nonzero),/pointer/)
  const deep=fixture(),w=new DataView(deep.buffer)
  w.setUint32(352,2,true);w.setBigUint64(364,32n,true);w.setBigUint64(640,512n,true)
  assert.throws(()=>read(deep,{...limits,maxDepth:1}),/depth/)
})
