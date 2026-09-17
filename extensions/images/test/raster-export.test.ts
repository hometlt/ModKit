/**
 * `export.convert` on DDS and PNG: MK2's DDS file commands (`apps/modkit-vscode/src/dds-commands.ts`)
 * as codec exports — export PNG, DXT5 → DXT1, SC2 button icon, PNG icon → DDS — so every host's
 * `subject.convert` reaches them. Fixtures are generated in memory.
 */
import { describe, expect, it } from 'vitest'
import type { RasterImageSource } from '@modkit/sdk'
import { openImageCodec } from './codec-session.js'
import { encodeDds } from '../src/dds/encode.js'
import { encodePng } from '../src/writers/png-encoder.js'

function rgba(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) pixels.set(pixel(x, y), (y * width + x) * 4)
  return { width, height, pixels }
}

type Session = Awaited<ReturnType<typeof openImageCodec>> & {
  operations(): { invoke(id: string, input: unknown): Promise<Record<string, unknown>> }
}

async function convert(entry: string, bytes: Uint8Array, handler: string, request: unknown) {
  const session = (await openImageCodec(entry, bytes)) as Session
  try {
    const result = await session.operations().invoke(handler, request)
    if (result['state'] !== 'ok') throw new Error(`refused: ${String(result['reason'])}`)
    const output = result['output'] as { kind: string; value: Uint8Array }
    expect(output.kind).toBe('bytes')
    return Uint8Array.from(output.value)
  } finally {
    await session.dispose()
  }
}

/** Decode any image bytes back through its own codec: `[width, height, ...first pixel]` + format. */
async function readBack(entry: string, bytes: Uint8Array) {
  const session = (await openImageCodec(entry, bytes)) as Session
  try {
    const descriptor = (await session.descriptor()) as unknown as {
      metadata: { id: string; entries: { key: string; value: unknown }[] }[]
    }
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    const raster = lease.value as RasterImageSource
    const info = await raster.info()
    const region = await raster.readRegion!({
      x: 0,
      y: 0,
      width: info.width,
      height: info.height,
      pixelFormat: 'rgba8',
      maxBytes: 4_000_000,
    })
    const encoding = descriptor.metadata
      .flatMap(group => group.entries)
      .find(entry => entry.key === 'encoding')?.value
    await lease.release()
    return { width: info.width, height: info.height, pixels: region.pixels, encoding }
  } finally {
    await session.dispose()
  }
}

const opaque = rgba(8, 8, (x, y) => [x * 30, y * 30, 100, 255])
const soft = rgba(8, 8, () => [10, 20, 30, 128])

describe('DDS export.convert', () => {
  it('exports the base mip as a PNG that decodes to the same pixels', async () => {
    const dds = encodeDds(opaque, { format: 'rgba8' })
    const png = await convert('dds/codec.js', dds, 'convert', { target: 'png' })
    const back = await readBack('png/codec.js', png)
    expect([back.width, back.height]).toEqual([8, 8])
    expect([...back.pixels]).toEqual([...opaque.pixels])
  })

  it('recompresses a binary-alpha DXT5 texture as DXT1', async () => {
    const binary = rgba(4, 4, x => (x < 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
    const dds = encodeDds(binary, { format: 'dxt5' })
    const dxt1 = await convert('dds/codec.js', dds, 'convert', { target: 'dds', format: 'dxt1' })
    expect(dxt1.byteLength).toBeLessThan(dds.byteLength)
    const back = await readBack('dds/codec.js', dxt1)
    expect(back.encoding).toMatch(/DXT1|BC1/u)
    expect([...back.pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255])
  })

  it('refuses DXT1 for partial alpha and names the texel', async () => {
    const dds = encodeDds(soft, { format: 'dxt5' })
    await expect(
      convert('dds/codec.js', dds, 'convert', { target: 'dds', format: 'dxt1' }),
    ).rejects.toThrow(/binary alpha; pixel 0,0 has alpha/u)
  })

  it('prepares an SC2 button icon as DXT5 with a transparent frame', async () => {
    const dds = encodeDds(
      rgba(64, 64, () => [200, 100, 50, 255]),
      { format: 'rgba8' },
    )
    const icon = await convert('dds/codec.js', dds, 'convert', {
      target: 'dds',
      transform: 'button-icon',
    })
    const back = await readBack('dds/codec.js', icon)
    expect(back.encoding).toMatch(/DXT5|BC3/u)
    expect([back.width, back.height]).toEqual([64, 64])
    expect(back.pixels[3]).toBe(0) // the frame corner
    expect(back.pixels[(32 * 64 + 32) * 4 + 3]).toBe(255) // the art
  })

  it('refuses a button icon larger than 256', async () => {
    const dds = encodeDds(
      rgba(260, 260, () => [1, 2, 3, 255]),
      { format: 'rgba8' },
    )
    await expect(
      convert('dds/codec.js', dds, 'convert', { target: 'dds', transform: 'button-icon' }),
    ).rejects.toThrow(/no larger than 256/u)
  })

  it('refuses an unknown target by name', async () => {
    const dds = encodeDds(opaque, { format: 'rgba8' })
    await expect(convert('dds/codec.js', dds, 'convert', { target: 'gif' })).rejects.toThrow(
      /png, dds, rgba8/u,
    )
  })
})

describe('PNG export.convert', () => {
  it('converts a PNG icon to DXT5 DDS', async () => {
    const png = await encodePng(16, 16, rgba(16, 16, () => [9, 8, 7, 255]).pixels)
    const dds = await convert('png/codec.js', png, 'convert-rgba8', { target: 'dds', icon: true })
    const back = await readBack('dds/codec.js', dds)
    expect(back.encoding).toMatch(/DXT5|BC3/u)
    expect([back.width, back.height]).toEqual([16, 16])
  })

  it('keeps the MK2 icon rule: square and smaller than 256', async () => {
    const png = await encodePng(16, 8, rgba(16, 8, () => [9, 8, 7, 255]).pixels)
    await expect(
      convert('png/codec.js', png, 'convert-rgba8', { target: 'dds', icon: true }),
    ).rejects.toThrow(/square icon, got 16 x 8/u)
  })

  it('still returns raw RGBA8', async () => {
    const png = await encodePng(8, 8, opaque.pixels)
    const pixels = await convert('png/codec.js', png, 'convert-rgba8', { target: 'rgba8' })
    expect([...pixels]).toEqual([...opaque.pixels])
  })
})

describe('DDS edit.content forms', () => {
  it('publishes one generic edit-panel form per transform, and the button-icon form plans an edit', async () => {
    const { editOffer } = await import('@modkit/ui/field-editor')
    const dds = encodeDds(rgba(32, 32, () => [50, 60, 70, 255]), { format: 'rgba8' })
    const session = (await openImageCodec('dds/codec.js', dds)) as Session
    try {
      const descriptor = (await session.descriptor()) as never
      const offer = editOffer(descriptor, { editable: true })
      expect(offer.unsupported).toEqual([])
      expect(offer.forms.map(form => form.id)).toEqual([
        'dds-button-icon',
        'dds-recompress',
        'dds-resize',
        'dds-color-key',
        'dds-rounded-alpha',
        'dds-normal-map',
      ])
      const button = offer.forms[0]!
      const input = button.build(new Map())
      expect(input).toEqual({
        transform: 'button-icon',
        format: 'dxt5',
        options: { framePercent: 5 / 128 },
      })
      const result = await session.operations().invoke(button.handlerId, input)
      const plan = (result['output'] as { plan: { edits: { payload: { bytes: Uint8Array } }[] } })
        .plan
      const back = await readBack('dds/codec.js', Uint8Array.from(plan.edits[0]!.payload.bytes))
      expect(back.encoding).toMatch(/DXT5|BC3/u)
      expect(back.pixels[3]).toBe(0)
    } finally {
      await session.dispose()
    }
  })
})
