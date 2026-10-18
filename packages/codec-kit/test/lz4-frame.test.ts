/** Standard synthetic LZ4 frame checks; no proprietary fixtures or duplicate decoder. */
import { describe, it, expect } from 'vitest'
import { decodeLz4Frame, lz4FrameInfo, decodeLz4Block } from '../src/compression/lz4.js'
import { xxHash32 } from '../src/checksum/xxhash32.js'

/** Frame fixture encoder for stored payloads and explicitly supplied raw LZ4 test blocks. */
function frame(blocks: readonly { bytes: Uint8Array; stored: boolean }[], output: Uint8Array, independent = false): Uint8Array {
  const header = new Uint8Array(15), h = new DataView(header.buffer)
  h.setUint32(0, 0x184d2204, true); header[4] = 0x5c | (independent ? 32 : 0); header[5] = 0x40
  h.setBigUint64(6, BigInt(output.length), true); header[14] = (xxHash32(header.subarray(4,14)) >>> 8) & 255
  const bytes = new Uint8Array(15 + blocks.reduce((n,b)=>n+8+b.bytes.length,0) + 8), view = new DataView(bytes.buffer)
  bytes.set(header); let cursor = 15
  for(const block of blocks) {
    view.setUint32(cursor, (block.bytes.length | (block.stored ? 0x80000000 : 0)) >>> 0, true); cursor += 4
    bytes.set(block.bytes,cursor); cursor += block.bytes.length
    view.setUint32(cursor,xxHash32(block.bytes),true);cursor += 4
  }
  view.setUint32(cursor,0,true);view.setUint32(cursor+4,xxHash32(output),true)
  return bytes
}
const text = (value: string) => new TextEncoder().encode(value)
describe('LZ4 frames',()=>{
  it('decodes stored blocks with all checksums and declared size',()=>{
    const data=text('one bounded stored frame'), encoded=frame([{bytes:data,stored:true}],data,true)
    expect(lz4FrameInfo(encoded.subarray(0,15),1024)).toMatchObject({contentSize:data.length,maxBlockBytes:65536,independent:true})
    expect(decodeLz4Frame(encoded,1024)).toEqual(data)
  })
  it('shares the exact block decoder and uses prior block history for linked matches',()=>{
    const first=text('hello'), second=new Uint8Array([0,5,0,0x50,...text('world')]), output=text('hellohellworld')
    expect(decodeLz4Frame(frame([{bytes:first,stored:true},{bytes:second,stored:false}],output),1024)).toEqual(output)
    expect(()=>decodeLz4Frame(frame([{bytes:first,stored:true},{bytes:second,stored:false}],output,true),1024)).toThrow(/offset/)
    expect(()=>decodeLz4Block(new Uint8Array([0x50,...first]),6)).toThrow(/declared/)
  })
  it('refuses corrupt checksums, truncated blocks, trailing data and output budget exhaustion',()=>{
    const data=text('checksum'), encoded=frame([{bytes:data,stored:true}],data)
    expect(()=>decodeLz4Frame(encoded,data.length-1)).toThrow(/budget/)
    for(const index of [14,19,encoded.length-1]){const bad=encoded.slice();bad[index]^=1;expect(()=>decodeLz4Frame(bad,1024)).toThrow(/checksum/)}
    expect(()=>decodeLz4Frame(encoded.subarray(0,-3),1024)).toThrow(/truncated/)
    expect(()=>decodeLz4Frame(new Uint8Array([...encoded,0]),1024)).toThrow(/trailing/)
  })
})
