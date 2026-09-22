import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
  decodeBaselineJpeg,
  decodeBaselineJpegPlanes,
} from '../dist/raster/jpeg.js'

/**
 * The repository-local mdx-m3-viewer reference ships a JPEG-compressed BLP1 texture. Its embedded
 * JPEG is a four-component stream — blue, green, red and an alpha mask — which is exactly the case
 * this decoder must hand back as planes rather than guess a colour model for.
 */
const blpPath = new URL(
  '../../../../references/mdx-m3-viewer/clients/example/resources/Textures/SmileyGW.blp',
  import.meta.url,
)

function blpJpegStream(): Uint8Array {
  const bytes = new Uint8Array(readFileSync(blpPath))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'BLP1')
  assert.equal(view.getUint32(4, true), 0, 'the fixture must be a JPEG-compressed BLP1')
  const headerSize = view.getUint32(156, true)
  const header = bytes.subarray(160, 160 + headerSize)
  const offset = view.getUint32(28, true)
  const size = view.getUint32(92, true)
  const payload = bytes.subarray(offset, offset + size)
  const stream = new Uint8Array(header.byteLength + payload.byteLength)
  stream.set(header, 0)
  stream.set(payload, header.byteLength)
  return stream
}

describe('baseline JPEG decoding', () => {
  it('decodes a four-component stream into planes without naming a colour model', () => {
    const decoded = decodeBaselineJpegPlanes(blpJpegStream(), { maxBytes: 16 * 1024 * 1024 })
    assert.equal(decoded.width, 256)
    assert.equal(decoded.height, 256)
    assert.equal(decoded.planes.length, 4)
    assert.equal(decoded.adobeTransform, undefined)
    for (const plane of decoded.planes) assert.equal(plane.samples.length, 256 * 256)

    // Read the planes in the order the container defines — BLP1 writes blue, green, red, alpha.
    const [blue, green, red, alpha] = decoded.planes.map(plane => plane.samples)
    const at = (x: number, y: number) => y * 256 + x
    // The cheek is yellow: high red, strong green, little blue. Read in the container's order
    // this is a face; read in any other order it is not, which is what makes this a real check.
    const cheek = at(40, 150)
    assert.ok((red?.[cheek] ?? 0) > 200, 'cheek red')
    assert.ok((green?.[cheek] ?? 0) > 150, 'cheek green')
    assert.ok((blue?.[cheek] ?? 255) < 80, 'cheek blue')
    // The fourth plane is an opacity mask: opaque over the face, clear outside it.
    assert.ok((alpha?.[cheek] ?? 0) > 200, 'mask is opaque over the face')
    assert.ok((alpha?.[at(2, 2)] ?? 255) < 60, 'mask is clear in the corner')
  })

  it('refuses to invent a channel order for a four-component stream', () => {
    assert.throws(
      () => decodeBaselineJpeg(blpJpegStream(), { maxBytes: 16 * 1024 * 1024 }),
      /no portable channel order/u,
    )
  })

  it('refuses a payload that is not a baseline sequential frame', () => {
    const stream = blpJpegStream()
    // Turn the SOF0 marker into SOF2, which is progressive.
    for (let index = 0; index + 1 < stream.length; index += 1)
      if (stream[index] === 0xff && stream[index + 1] === 0xc0) {
        stream[index + 1] = 0xc2
        break
      }
    assert.throws(
      () => decodeBaselineJpegPlanes(stream, { maxBytes: 16 * 1024 * 1024 }),
      /progressive/u,
    )
  })

  it('charges the caller budget before decoding', () => {
    assert.throws(
      () => decodeBaselineJpegPlanes(blpJpegStream(), { maxBytes: 16 }),
      /exceeds the caller budget/u,
    )
  })
})
