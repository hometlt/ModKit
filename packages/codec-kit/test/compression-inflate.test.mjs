import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, deflateSync, gzipSync } from 'node:zlib'
import { loadInflateSync, loadPortableInflateSync } from '../dist/compression/inflate.js'

const text = new TextEncoder().encode('mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml '.repeat(2000))
const packed = {
  zlib: deflateSync(text),
  'deflate-raw': deflateRawSync(text),
  gzip: gzipSync(text),
}

for (const [label, load] of [
  ['native', loadInflateSync],
  ['portable', loadPortableInflateSync],
]) {
  test(`${label} inflate reads every format and stops at its bound`, async () => {
    for (const format of ['zlib', 'deflate-raw', 'gzip']) {
      const inflate = await load(format)
      assert.deepEqual(inflate(packed[format], text.length), text, format)
      assert.throws(
        () => inflate(packed[format], text.length - 1),
        error => error.code === 'codec-kit/compression-output-limit',
        format,
      )
    }
    const zlib = await load('zlib')
    assert.throws(() => zlib(new Uint8Array([0x78, 0x9c, 0xff, 0xff]), 64))
  })
}
