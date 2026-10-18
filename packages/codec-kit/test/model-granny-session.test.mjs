/** Native offsets without synthetic descriptors; only the curve uses its embedded type tree. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGrannyPackedReader, readGrannyVariant } from '../dist/model/granny.js'

const limits = { maxBytes: 4096, maxNodes: 100, maxDepth: 8 }
/** Handwritten unaligned pointer/count fields, UTF-8, one embedded scalar schema and transform. */
function fixture() {
  const bytes = new Uint8Array(1024), view = new DataView(bytes.buffer)
  view.setBigUint64(1, 64n, true)
  view.setUint32(9, 2, true); view.setBigUint64(13, 96n, true)
  bytes.set(new TextEncoder().encode('naïve\0'), 64)
  view.setFloat32(96, 1.25, true); view.setFloat32(100, -2.5, true)
  view.setUint32(128, 7, true)
  for (let i = 0; i < 16; i++) view.setFloat32(132 + i * 4, i + 0.25, true)
  view.setUint32(256, 10, true); view.setBigUint64(260, 400n, true)
  bytes.set(new TextEncoder().encode('Real32\0'), 400)
  return bytes
}

test('one packed session shares native primitives, transform semantics and variant identity', () => {
  const bytes = fixture(), reader = createGrannyPackedReader(bytes, 'packed-le64', limits)
  assert.equal(reader.pointer(1), 64); assert.equal(reader.pointer(32), null)
  assert.equal(reader.string(1), 'naïve'); assert.equal(reader.string(32), null)
  assert.deepEqual(reader.array(9, 13, 4), [96, 100])
  assert.deepEqual(reader.floats(96, 2), [1.25, -2.5])
  const transform = reader.transform(128)
  assert.equal(transform.flags, 7)
  assert.deepEqual(transform.position, [0.25, 1.25, 2.25])
  assert.deepEqual(transform.orientation, [3.25, 4.25, 5.25, 6.25])
  assert.deepEqual(transform.scaleShear, Array.from({length:9}, (_,i)=>i+7.25))
  const value = reader.variant(256, 96)
  assert.equal(value.Real32, 1.25)
  assert.equal(reader.variant(256, 96), value)
})

test('owned input and limits cannot change between public session reads; budgets accumulate', () => {
  const bytes = fixture(), mutable = {...limits, maxNodes:3}
  const reader = createGrannyPackedReader(bytes, 'packed-le64', mutable)
  bytes.fill(0); mutable.maxNodes = 10000; mutable.maxBytes = 1 << 30
  assert.equal(reader.string(1), 'naïve')
  assert.equal(reader.pointer(1), 64); assert.equal(reader.pointer(1), 64)
  assert.throws(()=>reader.pointer(1), /node budget/)
  const buffer=Buffer.from(fixture())
  const fromBuffer=createGrannyPackedReader(buffer,'packed-le64',limits)
  buffer.fill(0)
  assert.equal(fromBuffer.string(1),'naïve')
  const outputBudget = createGrannyPackedReader(fixture(), 'packed-le64', {...limits,maxBytes:1024})
  for (let i=0; i<5; i++) outputBudget.transform(128)
  assert.throws(()=>outputBudget.transform(128), /materialized/)
})

test('direct fields refuse malformed pointers, UTF-8, extents, counts and nonfinite values', () => {
  const read = bytes => createGrannyPackedReader(bytes, 'packed-le64', limits)
  for (const offset of [-1, 0.5, NaN, 1017, Number.MAX_SAFE_INTEGER])
    assert.throws(()=>read(fixture()).pointer(offset))
  for (const encoded of [1025n, 1n<<63n, 0xffffffffffffffffn]) {
    const bytes = fixture(); new DataView(bytes.buffer).setBigUint64(1, encoded, true)
    assert.throws(()=>read(bytes).pointer(1))
  }
  const badText=fixture(); badText[64]=0xff; assert.throws(()=>read(badText).string(1))
  const unterminated=fixture(); unterminated.fill(65,64); assert.throws(()=>read(unterminated).string(1))
  for(const count of [-1, 1.5, 1000]) assert.throws(()=>read(fixture()).floats(96,count))
  assert.throws(()=>read(fixture()).array(9,13,0))
  assert.throws(()=>read(fixture()).array(9,13,1000))
  const badCount=fixture(); new DataView(badCount.buffer).setInt32(9,-1,true)
  assert.throws(()=>read(badCount).array(9,13,4))
  const absent=fixture(); new DataView(absent.buffer).setBigUint64(13,0n,true)
  assert.throws(()=>read(absent).array(9,13,4))
  new DataView(absent.buffer).setInt32(9,0,true)
  assert.deepEqual(read(absent).array(9,13,4),[])
  const nonfinite=fixture(); new DataView(nonfinite.buffer).setFloat32(96,Infinity,true)
  assert.throws(()=>read(nonfinite).floats(96,1))
  assert.throws(()=>read(fixture()).transform(1000))
  const small=createGrannyPackedReader(fixture(),'packed-le64',{...limits,maxNodes:2})
  assert.throws(()=>small.floats(96,2), /count/)
})

test('cancellation after session creation applies to both primitive and variant reads', () => {
  const controller=new AbortController()
  const reader=createGrannyPackedReader(fixture(),'packed-le64',limits,controller.signal)
  controller.abort()
  assert.throws(()=>reader.pointer(1),{name:'AbortError'})
  assert.throws(()=>reader.variant(256,96),{name:'AbortError'})
})

test('persistent views are immutable, while standalone variants retain their mutable contract', () => {
  const reader=createGrannyPackedReader(fixture(),'packed-le64',limits)
  const result=reader.variant(256,96)
  assert.throws(()=>{result.Real32=NaN},{name:'TypeError'})
  assert.equal(reader.variant(256,96).Real32,1.25)
  const transform=reader.transform(128)
  assert.throws(()=>{transform.position[0]=NaN},{name:'TypeError'})
  assert.throws(()=>{transform.flags=999},{name:'TypeError'})
  const array=reader.array(9,13,4)
  assert.throws(()=>{array.push(1024)},{name:'TypeError'})
  const mutable=readGrannyVariant(fixture(),256,96,'packed-le64',limits)
  mutable.Real32=2.5
  assert.equal(mutable.Real32,2.5)
  for(const length of [0,2]) {
    const bytes=fixture(),view=new DataView(bytes.buffer)
    view.setUint32(256,3,true);view.setBigUint64(268,512n,true)
    view.setUint32(512,10,true);view.setBigUint64(516,400n,true)
    view.setUint32(640,length,true);view.setBigUint64(644,length?96n:0n,true)
    const session=createGrannyPackedReader(bytes,'packed-le64',limits)
    const value=session.variant(256,640)
    assert.throws(()=>{value.Real32.push(NaN)},{name:'TypeError'})
    assert.equal(session.variant(256,640),value)
    assert.deepEqual(value.Real32,length?[1.25,-2.5]:[])
  }
})

test('a failed read closes the session instead of reusing a partial cached type', () => {
  const bytes=fixture();new DataView(bytes.buffer).setUint32(256,99,true)
  const reader=createGrannyPackedReader(bytes,'packed-le64',limits)
  assert.throws(()=>reader.variant(256,96), /Unsupported/)
  assert.throws(()=>reader.variant(256,96), /closed/)
  assert.throws(()=>reader.pointer(1), /closed/)
})

test('legacy tight-budget null-reference arrays retain their pre-factory accounting', () => {
  const bytes=fixture(), view=new DataView(bytes.buffer)
  view.setUint32(256,4,true)
  view.setBigUint64(268,512n,true)
  view.setUint32(512,10,true);view.setBigUint64(516,400n,true)
  view.setUint32(640,2,true);view.setBigUint64(644,700n,true)
  const result=readGrannyVariant(bytes,256,640,'packed-le64',{...limits,maxNodes:6})
  assert.deepEqual(result.Real32,[null,null])
})
