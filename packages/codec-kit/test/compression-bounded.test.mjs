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
