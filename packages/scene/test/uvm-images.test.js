import assert from 'node:assert/strict'
import { it } from 'node:test'
import { prepareUvmTextureImages, uvmImageTexels } from '../src/uvm/images.js'

it('captures each embedded image once and owns its bounded BIN slice', () => {
  const binary = Uint8Array.of(9, 10, 11, 12, 13)
  const document = {
    images: [{ bufferView: 0, mimeType: 'image/png' }],
    textures: [{ source: 0 }, { source: 0 }],
    bufferViews: [{ buffer: 0, byteOffset: 1, byteLength: 3 }],
  }
  const images = prepareUvmTextureImages(document, binary, [0, 1], 3)
  binary.fill(0)
  assert.equal(images[0].source, images[1].source)
  assert.deepEqual(images[0].source.bytes, Uint8Array.of(10, 11, 12))
  assert.throws(() => prepareUvmTextureImages(document, binary, [0], 2), /budget/)
  assert.throws(() => prepareUvmTextureImages(document, binary, [2], 3), /texture/)
  assert.throws(() => prepareUvmTextureImages(document, binary, [0], 3, AbortSignal.abort()))
})

it('decodes binary data URIs without text transcoding and bounds them before allocation', () => {
  for (const uri of ['data:image/png;base64,AP+A', 'data:image/png,%00%ff%80']) {
    const document = { textures: [{ source: 0 }], images: [{ uri }] }
    const [image] = prepareUvmTextureImages(document, new Uint8Array(), [0], 3)
    assert.deepEqual(image.source.bytes, Uint8Array.of(0, 255, 128))
    assert.equal(image.source.mediaType, 'image/png')
    assert.throws(() => prepareUvmTextureImages(document, new Uint8Array(), [0], 2), /budget/)
  }
  for (const uri of ['data:image/png;base64,!!==', 'data:image/png,%f', 'data:image/png,я']) {
    assert.throws(() =>
      prepareUvmTextureImages(
        { textures: [{ source: 0 }], images: [{ uri }] },
        new Uint8Array(),
        [0],
        20,
      ),
    )
  }
})

it('rejects ambiguous or external buffer views and leaves URI resolution with the host', () => {
  const document = { textures: [{ source: 0 }], images: [{ uri: 'textures/a%20b.dds' }] }
  const [image] = prepareUvmTextureImages(document, new Uint8Array(), [0], 0)
  assert.equal(image.source.kind, 'logical')
  assert.equal(image.source.requirement.logicalId, 'textures/a b.dds')
  for (const view of [
    { buffer: 1, byteLength: 1 },
    { buffer: 0, byteLength: 5 },
    { buffer: 0, byteOffset: -1, byteLength: 1 },
    { buffer: 0, byteLength: 1, byteStride: 4 },
  ]) {
    assert.throws(
      () =>
        prepareUvmTextureImages(
          { ...document, images: [{ bufferView: 0 }], bufferViews: [view] },
          new Uint8Array(4),
          [0],
          10,
        ),
      /bufferView/,
    )
  }
  assert.throws(
    () =>
      prepareUvmTextureImages(
        { ...document, images: [{ uri: 'a', bufferView: 0 }] },
        new Uint8Array(),
        [0],
        10,
      ),
    /exactly one/,
  )
  assert.throws(
    () =>
      prepareUvmTextureImages(
        { ...document, images: [{ uri: 'data:image/png;base64,AA==', mimeType: 'image/jpeg' }] },
        new Uint8Array(),
        [0],
        10,
      ),
    /disagree/,
  )
})

const decoded = () => ({
  state: 'decoded',
  diagnostics: [],
  info: { width: 1, height: 2, orientation: 'bottom-left', alphaMode: 'premultiplied' },
  region: {
    width: 1,
    height: 2,
    rowStride: 8,
    pixelFormat: 'rgba8',
    pixels: Uint8Array.of(7, 8, 9, 0, 88, 88, 88, 88, 64, 32, 16, 128),
  },
})
it('normalizes padded bottom-left premultiplied rows and owns the renderer pixels', () => {
  const input = decoded()
  const pixels = uvmImageTexels(input)
  input.region.pixels.fill(255)
  assert.deepEqual(pixels, Uint8Array.of(128, 64, 32, 128, 0, 0, 0, 0))
})

it('preserves material data channels independently of transparency while owning and orienting rows', () => {
  for (const alphaMode of ['unknown', 'premultiplied', 'straight', 'none']) {
    const input = decoded()
    input.info.alphaMode = alphaMode
    const pixels = uvmImageTexels(input, { channels: 'data' })
    input.region.pixels.fill(255)
    assert.deepEqual(pixels, Uint8Array.of(64, 32, 16, 128, 7, 8, 9, 0))
  }
  assert.throws(() => uvmImageTexels(decoded(), { channels: 'guess' }), /interpretation/)
  const input = decoded()
  input.info.orientation = 'unknown'
  assert.throws(() => uvmImageTexels(input, { channels: 'data' }), /orientation/)
  input.info.orientation = 'top-left'
  input.region.pixels = new Uint8Array(11)
  assert.throws(() => uvmImageTexels(input, { channels: 'data' }), /region/)
})

it('rejects incomplete regions and unknown raster conventions', () => {
  for (const mutate of [
    x => {
      x.info.orientation = 'unknown'
    },
    x => {
      x.info.alphaMode = 'unknown'
    },
    x => {
      x.region.rowStride = 3
    },
    x => {
      x.region.pixels = new Uint8Array(11)
    },
    x => {
      x.region.pixelFormat = 'rgb8'
    },
    x => {
      x.info.width = 0
    },
  ]) {
    const input = decoded()
    mutate(input)
    assert.throws(() => uvmImageTexels(input))
  }
})
