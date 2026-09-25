import test from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, deflateSync } from 'node:zlib'
import {
  COMPRESSION_OUTPUT_LIMIT,
  adler32,
  createAdler32,
  decompressBounded,
} from '../dist/compression/index.js'

test('Adler-32 one-shot and incremental forms share the standard checksum', () => {
  const bytes = new TextEncoder().encode('Wikipedia')
  assert.equal(adler32(bytes), 0x11e60398)
  const incremental = createAdler32()
  incremental.update(bytes.subarray(0, 4))
  incremental.update(bytes.subarray(4))
  assert.equal(incremental.digest(), 0x11e60398)
})

test('bounded decompression supports wrapped and raw DEFLATE and reports decoded work', async () => {
  const source = new TextEncoder().encode('bounded portable decompression '.repeat(128))
  for (const [format, payload] of [
    ['deflate', deflateSync(source)],
    ['deflate-raw', deflateRawSync(source)],
  ]) {
    let decodedBytes = 0
    const output = await decompressBounded(payload, format, {
      maxOutputBytes: source.byteLength,
      onChunk: bytes => {
        decodedBytes += bytes
      },
    })
    assert.deepEqual(output, source)
    assert.equal(decodedBytes, source.byteLength)
  }
})

test('bounded decompression cancels its stream on the exact output ceiling', async () => {
  const source = new TextEncoder().encode('limit'.repeat(1_000))
  await assert.rejects(
    () => decompressBounded(deflateSync(source), 'deflate', { maxOutputBytes: 32 }),
    error => error instanceof RangeError && error.code === COMPRESSION_OUTPUT_LIMIT,
  )
  const controller = new AbortController()
  controller.abort(new DOMException('cancelled', 'AbortError'))
  await assert.rejects(
    () =>
      decompressBounded(deflateSync(source), 'deflate', {
        maxOutputBytes: source.byteLength,
        signal: controller.signal,
      }),
    error => error?.name === 'AbortError',
  )
})

// Where the realm has node:zlib the native path answers; it must answer as the stream decoder.
async function streamOutcome(payload, format) {
  try {
    const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream(format))
    return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()) }
  } catch (error) {
    return { code: error.code }
  }
}

test('bounded decompression answers malformed streams as DecompressionStream does', async () => {
  const source = new TextEncoder().encode('mods/core.sc2mod/base.sc2data/gamedata/unitdata.xml '.repeat(64))
  const { gzipSync } = await import('node:zlib')
  const packed = { deflate: deflateSync(source), 'deflate-raw': deflateRawSync(source), gzip: gzipSync(source) }
  const cases = {
    'a whole stream': bytes => bytes,
    'junk after the end': bytes => new Uint8Array([...bytes, 1, 2, 3, 4, 5, 6, 7, 8]),
    'zeros after the end': bytes => new Uint8Array([...bytes, 0, 0, 0, 0]),
    'a second stream after the end': bytes => new Uint8Array([...bytes, ...bytes]),
    'a truncated stream': bytes => bytes.subarray(0, bytes.length - 6),
    'nothing': () => new Uint8Array(0),
  }
  for (const [format, whole] of Object.entries(packed)) {
    for (const [label, make] of Object.entries(cases)) {
      const payload = make(whole)
      const expected = await streamOutcome(payload, format)
      let actual
      try {
        actual = { bytes: await decompressBounded(payload, format, { maxOutputBytes: 1 << 20 }) }
      } catch (error) {
        actual = { code: error.code }
      }
      const where = `${format}, ${label}`
      if (expected.bytes === undefined) {
        assert.equal(actual.bytes, undefined, `${where}: the stream decoder refuses it`)
        assert.equal(actual.code, expected.code, where)
      } else {
        assert.deepEqual(actual.bytes, expected.bytes, where)
      }
    }
  }
})

test('bounded decompression hands back bytes that own their buffer, and counts them once', async () => {
  const small = new TextEncoder().encode('small')
  const large = new Uint8Array(200_000).map((_, index) => index % 7)
  for (const source of [small, large]) {
    const chunks = []
    const output = await decompressBounded(deflateSync(source), 'deflate', {
      maxOutputBytes: source.byteLength,
      onChunk: bytes => chunks.push(bytes),
    })
    assert.deepEqual(output, source)
    assert.equal(output.byteOffset, 0)
    assert.equal(output.byteLength, output.buffer.byteLength)
    assert.equal(chunks.reduce((total, bytes) => total + bytes, 0), source.byteLength)
  }
  const custom = new Error('too large for this archive')
  await assert.rejects(
    () => decompressBounded(deflateSync(large), 'deflate', { maxOutputBytes: 1000, outputLimitError: () => custom }),
    error => error === custom,
  )
})
