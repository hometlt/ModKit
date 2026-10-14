import { describe, expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { packUvmGlb, readUvmContainer } from '../src/model/container.js'
import { embedPortableUvmImages } from '../src/model/portable.js'

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=',
    'base64',
  ),
)
const source = (image: JsonObject = { uri: 'textures/skin.png' }) =>
  packUvmGlb(
    {
      asset: { version: '2.0' },
      buffers: [{ byteLength: 0 }],
      images: [image],
      textures: [{ source: 0 }],
    },
    new Uint8Array(),
  )

function viewRange(view: Record<string, number> | undefined): { offset: number; length: number } {
  const offset = view?.['byteOffset']
  const length = view?.['byteLength']
  if (offset === undefined || length === undefined)
    throw new Error('missing image buffer view range')
  return { offset, length }
}

describe('portable UVM image closure', () => {
  it('embeds exact PNG bytes in GLB without external image URI', () => {
    const result = embedPortableUvmImages(source(), [
      {
        logicalId: 'textures/skin.png',
        mimeType: 'image/png',
        bytes: png,
      },
    ])
    expect(result.state).toBe('portable')
    if (result.state !== 'portable') return
    const output = readUvmContainer(result.bytes)
    const image = (output.document['images'] as Record<string, unknown>[])[0]!
    const { offset, length } = viewRange(
      (output.document['bufferViews'] as Record<string, number>[])[0],
    )
    expect(output.format).toBe('glb')
    expect(image).toEqual({ name: 'textures/skin.png', bufferView: 0, mimeType: 'image/png' })
    expect([...output.binary.slice(offset, offset + length)]).toEqual([...png])
    expect((output.document['buffers'] as { byteLength: number }[])[0]!.byteLength).toBe(
      output.binary.byteLength,
    )
  })

  it.each([
    ['textures/skin.png', 'textures/skin.png'],
    ['textures/skin%20one.png', 'textures/skin one.png'],
    ['textures/%D1%88%D0%BA%D1%83%D1%80%D0%B0.png', 'textures/шкура.png'],
    ['textures/skin%2520.png', 'textures/skin%20.png'],
    ['textures/skin%invalid.png', 'textures/skin%invalid.png'],
  ])('preserves decoded identity for unnamed and empty-name image %s', (uri, logicalId) => {
    for (const image of [{ uri }, { uri, name: '' }]) {
      const result = embedPortableUvmImages(source(image), [
        { logicalId, mimeType: 'image/png', bytes: png },
      ])
      expect(result.state).toBe('portable')
      if (result.state !== 'portable') throw new Error('expected portable image')
      expect(readUvmContainer(result.bytes).document['images']).toEqual([
        { name: logicalId, bufferView: 0, mimeType: 'image/png' },
      ])
    }
  })

  it.each(['authored name', ' ', 'skin%20.png'])(
    'preserves authored nonempty name literally: %s',
    name => {
      const result = embedPortableUvmImages(source({ uri: 'textures/skin.png', name }), [
        { logicalId: 'textures/skin.png', mimeType: 'image/png', bytes: png },
      ])
      expect(result.state).toBe('portable')
      if (result.state !== 'portable') throw new Error('expected portable image')
      expect(readUvmContainer(result.bytes).document['images']).toEqual([
        { name, bufferView: 0, mimeType: 'image/png' },
      ])
    },
  )

  it.each([{ name: null }, { name: 0 }, { name: false }, { name: [] }, { name: {} }])(
    'rejects nonstring name %j on a selected external image',
    ({ name }) => {
      const model = source({ uri: 'textures/skin.png', name })
      expect(() =>
        embedPortableUvmImages(model, [
          { logicalId: 'textures/skin.png', mimeType: 'image/png', bytes: png },
        ]),
      ).toThrow(TypeError)
      expect(embedPortableUvmImages(model, [])).toEqual({
        state: 'incomplete',
        missing: ['textures/skin.png'],
        unsupported: [],
      })
      expect(
        embedPortableUvmImages(model, [
          { logicalId: 'textures/skin.png', mimeType: 'image/png', bytes: new Uint8Array([1]) },
        ]),
      ).toEqual({ state: 'incomplete', missing: [], unsupported: ['textures/skin.png'] })
    },
  )

  it('leaves embedded and data URI image names unchanged', () => {
    const images = [
      { bufferView: 0, mimeType: 'image/png', name: null },
      { uri: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, name: '' },
    ]
    const model = packUvmGlb(
      {
        asset: { version: '2.0' },
        buffers: [{ byteLength: png.byteLength }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: png.byteLength }],
        images,
      },
      png,
    )
    const result = embedPortableUvmImages(model, [])
    expect(result.state).toBe('portable')
    if (result.state !== 'portable') throw new Error('expected portable image')
    expect(result.embeddedImages).toBe(0)
    expect(readUvmContainer(result.bytes).document['images']).toEqual(images)
  })

  it('refuses a portable claim when an image is missing or unsupported', () => {
    expect(embedPortableUvmImages(source(), [])).toEqual({
      state: 'incomplete',
      missing: ['textures/skin.png'],
      unsupported: [],
    })
    expect(
      embedPortableUvmImages(source(), [
        {
          logicalId: 'textures/skin.png',
          mimeType: 'image/ktx2',
          bytes: new Uint8Array(12),
        },
      ]),
    ).toEqual({ state: 'incomplete', missing: [], unsupported: ['textures/skin.png'] })
    expect(
      embedPortableUvmImages(source(), [
        {
          logicalId: 'textures/skin.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]),
    ).toEqual({ state: 'incomplete', missing: [], unsupported: ['textures/skin.png'] })
  })

  it('copies an already bound KTX2 image byte-for-byte without transcoding', () => {
    const ktx2 = Uint8Array.from([171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10, 1, 2, 3])
    const model = packUvmGlb(
      {
        asset: { version: '2.0' },
        buffers: [{ byteLength: 0 }],
        images: [{ uri: 'skin.ktx2', mimeType: 'image/ktx2' }],
        textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
        extensionsUsed: ['KHR_texture_basisu'],
        extensionsRequired: ['KHR_texture_basisu'],
      },
      new Uint8Array(),
    )
    const result = embedPortableUvmImages(model, [
      {
        logicalId: 'skin.ktx2',
        mimeType: 'image/ktx2',
        bytes: ktx2,
      },
    ])
    expect(result.state).toBe('portable')
    if (result.state !== 'portable') return
    const output = readUvmContainer(result.bytes)
    const { offset, length } = viewRange(
      (output.document['bufferViews'] as Record<string, number>[])[0],
    )
    expect([...output.binary.slice(offset, offset + length)]).toEqual([...ktx2])
  })

  it('retains existing binary views and aligns the new image view', () => {
    const model = packUvmGlb(
      {
        asset: { version: '2.0' },
        buffers: [{ byteLength: 4 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
        images: [{ uri: 'textures/skin.png' }],
      },
      Uint8Array.from([1, 2, 3, 4]),
    )
    const result = embedPortableUvmImages(model, [
      { logicalId: 'textures/skin.png', mimeType: 'image/png', bytes: png },
    ])
    expect(result.state).toBe('portable')
    if (result.state !== 'portable') return
    const output = readUvmContainer(result.bytes)
    const views = output.document['bufferViews'] as Record<string, number>[]
    const { offset, length } = viewRange(views[1])
    expect(views[0]).toEqual({ buffer: 0, byteOffset: 0, byteLength: 4 })
    expect(offset % 4).toBe(0)
    expect([...output.binary.slice(0, 4)]).toEqual([1, 2, 3, 4])
    expect([...output.binary.slice(offset, offset + length)]).toEqual([...png])
  })

  it('writes a GLB when there are no external images', () => {
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }))
    const result = embedPortableUvmImages(json, [])
    expect(result.state).toBe('portable')
    if (result.state === 'portable') expect(readUvmContainer(result.bytes).format).toBe('glb')
  })

  it('bounds the output and honours cancellation', () => {
    expect(() =>
      embedPortableUvmImages(source(), [
        {
          logicalId: 'textures/skin.png',
          mimeType: 'image/dds',
          bytes: png,
        } as never,
      ]),
    ).toThrow(TypeError)
    expect(() =>
      embedPortableUvmImages(
        source(),
        [
          {
            logicalId: 'textures/skin.png',
            mimeType: 'image/png',
            bytes: png,
          },
        ],
        { maxInputBytes: source().byteLength, maxJsonBytes: 1024, maxDepth: 32, maxNodes: 100 },
      ),
    ).toThrow(RangeError)
    expect(() => embedPortableUvmImages(source(), [], undefined, AbortSignal.abort())).toThrow()
  })
})
