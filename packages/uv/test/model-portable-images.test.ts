import { describe, expect, it } from 'vitest'
import { packUvmGlb, readUvmContainer } from '../src/model/container.js'
import { embedPortableUvmImages } from '../src/model/portable.js'

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=',
    'base64',
  ),
)
const source = () =>
  packUvmGlb(
    {
      asset: { version: '2.0' },
      buffers: [{ byteLength: 0 }],
      images: [{ uri: 'textures/skin.png' }],
      textures: [{ source: 0 }],
    },
    new Uint8Array(),
  )

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
    const view = (output.document['bufferViews'] as Record<string, number>[])[0]!
    expect(output.format).toBe('glb')
    expect(image).toEqual({ bufferView: 0, mimeType: 'image/png' })
    expect([...output.binary.slice(view.byteOffset, view.byteOffset + view.byteLength)]).toEqual([
      ...png,
    ])
    expect((output.document['buffers'] as { byteLength: number }[])[0]!.byteLength).toBe(
      output.binary.byteLength,
    )
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
    const view = (output.document['bufferViews'] as Record<string, number>[])[0]!
    expect([...output.binary.slice(view.byteOffset, view.byteOffset + view.byteLength)]).toEqual([
      ...ktx2,
    ])
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
    expect(views[0]).toEqual({ buffer: 0, byteOffset: 0, byteLength: 4 })
    expect(views[1]!.byteOffset % 4).toBe(0)
    expect([...output.binary.slice(0, 4)]).toEqual([1, 2, 3, 4])
    expect([
      ...output.binary.slice(views[1]!.byteOffset, views[1]!.byteOffset + views[1]!.byteLength),
    ]).toEqual([...png])
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
