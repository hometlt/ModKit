/**
 * Saving painted pixels back into the file's own format.
 *
 * Every writable raster codec answers the same `edit.content` request — `{ transform: 'replace',
 * image }` — with a plan that rewrites the file in its own format. What is pinned here is what the
 * fidelity evidence in the contributions cites: the pixels read back exactly through the same
 * codec, the claim is the one declared, and an icon keeps the sizes nobody edited.
 */
import { describe, expect, it } from 'vitest'
import type { RasterImageSource } from '@modkit/sdk'
import { openImageCodec } from './codec-session.js'
import { encodeDds } from '../src/dds/encode.js'
import { encodeIconDib as encodeDib, encodePng, encodeTga } from '@modkit/codec-kit/raster'

/** A 3 × 2 image with a distinct value in every channel of every pixel. */
const painted = {
  width: 3,
  height: 2,
  pixels: Uint8Array.from({ length: 24 }, (_, index) => (index * 11 + 7) % 256),
}
const solid = (width: number, height: number) => ({
  width,
  height,
  pixels: new Uint8Array(width * height * 4).fill(200),
})

/** A little-endian icon/cursor file with a DIB picture per image. */
function iconFile(
  type: 1 | 2,
  images: readonly { width: number; height: number; pixels: Uint8Array }[],
) {
  const payloads: Uint8Array[] = images.map(encodeDib)
  const out = new Uint8Array(
    6 + images.length * 16 + payloads.reduce((sum, item) => sum + item.length, 0),
  )
  const view = new DataView(out.buffer)
  view.setUint16(2, type, true)
  view.setUint16(4, images.length, true)
  let offset = 6 + images.length * 16
  images.forEach((image, index) => {
    const payload = payloads[index] as Uint8Array
    const position = 6 + index * 16
    out[position] = image.width
    out[position + 1] = image.height
    view.setUint16(position + 4, type === 2 ? 1 : 1, true)
    view.setUint16(position + 6, type === 2 ? 1 : 32, true)
    view.setUint32(position + 8, payload.length, true)
    view.setUint32(position + 12, offset, true)
    out.set(payload, offset)
    offset += payload.length
  })
  return out
}

interface Plan {
  readonly fidelity: { readonly roundTrip: string; readonly preservesUnknownData: boolean }
  readonly edits: readonly { readonly payload?: { readonly bytes?: unknown } }[]
}

async function replace(codec: string, bytes: Uint8Array) {
  const session = (await openImageCodec(codec, bytes)) as never as {
    operations(): { invoke(id: string, input: unknown): Promise<unknown> }
    dispose(): Promise<void>
  }
  try {
    const result = (await session.operations().invoke('transform', {
      transform: 'replace',
      image: { ...painted, pixels: Buffer.from(painted.pixels).toString('base64') },
    })) as { state?: string; reason?: string; output?: { plan?: Plan } }
    if (result.state === 'rejected') throw new Error(`refused: ${String(result.reason)}`)
    const plan = result.output?.plan as Plan
    const payload = plan.edits[0]?.payload?.bytes
    const written = ArrayBuffer.isView(payload)
      ? (payload as Uint8Array)
      : Uint8Array.from(Object.values(payload as Record<string, number>))
    return { plan, written }
  } finally {
    await session.dispose()
  }
}

async function readBack(codec: string, bytes: Uint8Array) {
  const session = await openImageCodec(codec, bytes)
  try {
    const raster = (await session.dataSource('common.view/raster-image-source', 1))
      .value as RasterImageSource
    const info = await raster.info()
    const region = await raster.readRegion?.({
      x: 0,
      y: 0,
      width: info.width,
      height: info.height,
      frame: 0,
      mipLevel: 0,
      layer: 0,
      face: 0,
      slice: 0,
      pixelFormat: 'rgba8',
      maxBytes: 1_000_000,
    })
    return { width: info.width, height: info.height, pixels: [...(region?.pixels ?? [])] }
  } finally {
    await session.dispose()
  }
}

const exact = { width: 3, height: 2, pixels: [...painted.pixels] }

describe('writing painted pixels back', () => {
  it('PNG: exact pixels, semantic, ancillary chunks not kept', async () => {
    const source = await encodePng(8, 8, solid(8, 8).pixels)
    const { plan, written } = await replace('png/codec.js', source)
    expect(plan.fidelity).toMatchObject({ roundTrip: 'semantic', preservesUnknownData: false })
    expect(await readBack('png/codec.js', written)).toEqual(exact)
  })

  it('TGA: exact pixels as 32-bit RGBA, semantic', async () => {
    const { plan, written } = await replace('tga/codec.js', encodeTga(solid(8, 8)))
    expect(plan.fidelity).toMatchObject({ roundTrip: 'semantic', preservesUnknownData: false })
    expect(await readBack('tga/codec.js', written)).toEqual(exact)
  })

  it('ICO: replaces the shown picture and keeps every other size byte for byte', async () => {
    const small = solid(4, 4)
    const source = iconFile(1, [small, solid(16, 16)])
    const { plan, written } = await replace('ico/codec.js', source)
    expect(plan.fidelity).toMatchObject({ roundTrip: 'semantic', preservesUnknownData: true })
    // The largest picture is the one shown; after the edit the 4 × 4 one is.
    const view = new DataView(written.buffer, written.byteOffset)
    expect(view.getUint16(4, true)).toBe(2)
    const keptOffset = view.getUint32(6 + 12, true)
    const keptSize = view.getUint32(6 + 8, true)
    expect([...written.subarray(keptOffset, keptOffset + keptSize)]).toEqual([...encodeDib(small)])
    expect([written[6 + 16], written[6 + 17]]).toEqual([3, 2])
  })

  it('ICO: a single picture reads back exactly', async () => {
    const { written } = await replace('ico/codec.js', iconFile(1, [solid(16, 16)]))
    expect(await readBack('ico/codec.js', written)).toEqual(exact)
  })

  it('CUR: keeps the hotspot inside the new size', async () => {
    const { written } = await replace('cur/codec.js', iconFile(2, [solid(16, 16)]))
    const view = new DataView(written.buffer, written.byteOffset)
    expect([view.getUint16(10, true), view.getUint16(12, true)]).toEqual([1, 1])
    expect(await readBack('cur/codec.js', written)).toEqual(exact)
  })

  it('DDS: re-encoded in the source encoding, declared lossy', async () => {
    const source = encodeDds(solid(8, 8), { format: 'rgba8' })
    const { plan, written } = await replace('dds/codec.js', source)
    expect(plan.fidelity).toMatchObject({ roundTrip: 'lossy', preservesUnknownData: false })
    expect(await readBack('dds/codec.js', written)).toEqual(exact)
  })
})
