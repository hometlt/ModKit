import { describe, expect, it } from 'vitest'
import { openImageCodec } from './codec-session.js'
import type { RasterImageSource } from '@modkit/sdk'

/**
 * DDS subresource honesty (Wave 2B, anchor 2B-1).
 *
 * The manifest used to promise mip / array-layer / cubemap-face / volume-slice selection while the
 * decoder answered every request with "only the first image". These cases pin the opposite: every
 * subresource the header declares is reachable and carries its own pixels, and every coordinate the
 * header does NOT declare is refused by the name of the axis that was wrong.
 */

const DDSD_CAPS = 0x1
const DDSD_HEIGHT = 0x2
const DDSD_WIDTH = 0x4
const DDSD_PIXELFORMAT = 0x1000
const DDSD_MIPMAPCOUNT = 0x2_0000
const DDSD_DEPTH = 0x80_0000
const DDPF_FOURCC = 0x4
const DDPF_RGB = 0x40
const DDPF_ALPHAPIXELS = 0x1
const DDPF_LUMINANCE = 0x2_0000
const DDSCAPS2_CUBEMAP = 0x200
const DDSCAPS2_CUBEMAP_ALL_FACES = 0xfc00
const DDSCAPS2_VOLUME = 0x20_0000

interface DdsShape {
  readonly width: number
  readonly height: number
  readonly depth?: number
  readonly mipLevels?: number
  readonly layers?: number
  readonly cubemap?: boolean
  readonly volume?: boolean
  readonly dxgiFormat?: number
  readonly uncompressed?: boolean
  /** Legacy FourCC to stamp into the pixel format, when it is not DXT1. */
  readonly fourCc?: string
  /** Build a DDPF_LUMINANCE pixel format with the given bit count instead of a FourCC. */
  readonly luminanceBits?: number
}

/** RGB565 constants whose expanded RGBA values are unambiguous. */
const COLORS = {
  red: { packed: 0xf800, rgba: [255, 0, 0, 255] },
  green: { packed: 0x07e0, rgba: [0, 255, 0, 255] },
  blue: { packed: 0x001f, rgba: [0, 0, 255, 255] },
  white: { packed: 0xffff, rgba: [255, 255, 255, 255] },
  yellow: { packed: 0xffe0, rgba: [255, 255, 0, 255] },
  cyan: { packed: 0x07ff, rgba: [0, 255, 255, 255] },
  magenta: { packed: 0xf81f, rgba: [255, 0, 255, 255] },
  black: { packed: 0x0000, rgba: [0, 0, 0, 255] },
} as const

type ColorName = keyof typeof COLORS

/** One DXT1 block painted a single colour: both endpoints equal, every index 0. */
function solidDxt1Block(packed565: number): Uint8Array {
  const block = new Uint8Array(8)
  const view = new DataView(block.buffer)
  view.setUint16(0, packed565, true)
  view.setUint16(2, packed565, true)
  view.setUint32(4, 0, true)
  return block
}

function dxt1Surface(width: number, height: number, color: ColorName): Uint8Array {
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4)
  const surface = new Uint8Array(blocks * 8)
  const block = solidDxt1Block(COLORS[color].packed)
  for (let index = 0; index < blocks; index += 1) surface.set(block, index * 8)
  return surface
}

/** One B8G8R8A8 surface painted a single colour, matching the masks written into the header. */
function bgraSurface(width: number, height: number, color: ColorName): Uint8Array {
  const [r, g, b, a] = COLORS[color].rgba
  const surface = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    surface[index * 4] = b as number
    surface[index * 4 + 1] = g as number
    surface[index * 4 + 2] = r as number
    surface[index * 4 + 3] = a as number
  }
  return surface
}

function buildDds(shape: DdsShape, surfaces: readonly Uint8Array[]): Uint8Array {
  const headerBytes = shape.dxgiFormat === undefined ? 128 : 148
  const payload = surfaces.reduce((total, surface) => total + surface.byteLength, 0)
  const bytes = new Uint8Array(headerBytes + payload)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x2053_4444, true)
  view.setUint32(4, 124, true)
  view.setUint32(
    8,
    DDSD_CAPS |
      DDSD_HEIGHT |
      DDSD_WIDTH |
      DDSD_PIXELFORMAT |
      DDSD_MIPMAPCOUNT |
      (shape.volume === true ? DDSD_DEPTH : 0),
    true,
  )
  view.setUint32(12, shape.height, true)
  view.setUint32(16, shape.width, true)
  view.setUint32(24, shape.depth ?? 1, true)
  view.setUint32(28, shape.mipLevels ?? 1, true)
  view.setUint32(76, 32, true)
  if (shape.uncompressed === true) {
    view.setUint32(80, DDPF_RGB | DDPF_ALPHAPIXELS, true)
    view.setUint32(88, 32, true)
    view.setUint32(92, 0x00ff_0000, true)
    view.setUint32(96, 0x0000_ff00, true)
    view.setUint32(100, 0x0000_00ff, true)
    view.setUint32(104, 0xff00_0000, true)
  } else if (shape.luminanceBits !== undefined) {
    /* L8 or L8A8, exactly as SC2's UI gradients are stored. */
    view.setUint32(80, DDPF_LUMINANCE | (shape.luminanceBits === 16 ? DDPF_ALPHAPIXELS : 0), true)
    view.setUint32(88, shape.luminanceBits, true)
    view.setUint32(92, 0x0000_00ff, true)
    view.setUint32(104, shape.luminanceBits === 16 ? 0x0000_ff00 : 0, true)
  } else {
    view.setUint32(80, DDPF_FOURCC, true)
    const tag = shape.dxgiFormat === undefined ? (shape.fourCc ?? 'DXT1') : 'DX10'
    for (let index = 0; index < 4; index += 1) view.setUint8(84 + index, tag.charCodeAt(index))
  }
  view.setUint32(108, 0x1000, true)
  view.setUint32(
    112,
    (shape.cubemap === true ? DDSCAPS2_CUBEMAP | DDSCAPS2_CUBEMAP_ALL_FACES : 0) |
      (shape.volume === true ? DDSCAPS2_VOLUME : 0),
    true,
  )
  if (shape.dxgiFormat !== undefined) {
    view.setUint32(128, shape.dxgiFormat, true)
    view.setUint32(132, 3, true)
    view.setUint32(136, shape.cubemap === true ? 0x4 : 0, true)
    view.setUint32(140, shape.layers ?? 1, true)
  }
  let offset = headerBytes
  for (const surface of surfaces) {
    bytes.set(surface, offset)
    offset += surface.byteLength
  }
  return bytes
}

async function rasterOf(bytes: Uint8Array): Promise<RasterImageSource> {
  const session = await openImageCodec('dds/codec.js', bytes)
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  return lease.value as RasterImageSource
}

async function pixelAt(
  raster: RasterImageSource,
  request: {
    readonly width: number
    readonly height: number
    readonly mipLevel?: number
    readonly layer?: number
    readonly face?: number
    readonly slice?: number
  },
): Promise<readonly number[]> {
  const region = await raster.readRegion?.({
    x: 0,
    y: 0,
    width: request.width,
    height: request.height,
    frame: 0,
    mipLevel: request.mipLevel ?? 0,
    layer: request.layer ?? 0,
    face: request.face ?? 0,
    slice: request.slice ?? 0,
    pixelFormat: 'rgba8',
    maxBytes: 1_000_000,
  })
  if (region === undefined) throw new Error('DDS raster exposes no readRegion')
  expect(region.width).toBe(request.width)
  expect(region.height).toBe(request.height)
  return [...region.pixels.subarray(0, 4)]
}

describe('DDS subresource selection', () => {
  it('decodes every level of a mip chain, not only level zero', async () => {
    const levels: readonly ColorName[] = ['red', 'green', 'blue', 'white']
    const bytes = buildDds(
      { width: 8, height: 8, mipLevels: 4 },
      levels.map((color, level) => dxt1Surface(8 >> level, 8 >> level, color)),
    )
    const raster = await rasterOf(bytes)
    const info = await raster.info()
    expect(info.mipLevels).toBe(4)
    for (const [level, color] of levels.entries()) {
      const size = Math.max(1, 8 >> level)
      expect(await pixelAt(raster, { width: size, height: size, mipLevel: level })).toEqual(
        COLORS[color].rgba,
      )
    }
  })

  it('decodes every cubemap face', async () => {
    const faces: readonly ColorName[] = ['red', 'green', 'blue', 'white', 'yellow', 'cyan']
    const bytes = buildDds(
      { width: 4, height: 4, cubemap: true },
      faces.map(color => dxt1Surface(4, 4, color)),
    )
    const raster = await rasterOf(bytes)
    expect((await raster.info()).faces).toBe(6)
    for (const [face, color] of faces.entries()) {
      expect(await pixelAt(raster, { width: 4, height: 4, face })).toEqual(COLORS[color].rgba)
    }
  })

  it('decodes every array layer of a DX10 texture array', async () => {
    const layers: readonly ColorName[] = ['magenta', 'cyan', 'yellow']
    const bytes = buildDds(
      { width: 4, height: 4, layers: 3, dxgiFormat: 71 },
      layers.map(color => dxt1Surface(4, 4, color)),
    )
    const raster = await rasterOf(bytes)
    expect((await raster.info()).layers).toBe(3)
    for (const [layer, color] of layers.entries()) {
      expect(await pixelAt(raster, { width: 4, height: 4, layer })).toEqual(COLORS[color].rgba)
    }
  })

  it('decodes every depth slice of a volume texture', async () => {
    const slices: readonly ColorName[] = ['red', 'green', 'blue', 'black']
    const bytes = buildDds(
      { width: 4, height: 4, depth: 4, volume: true, uncompressed: true },
      slices.map(color => bgraSurface(4, 4, color)),
    )
    const raster = await rasterOf(bytes)
    expect((await raster.info()).depth).toBe(4)
    for (const [slice, color] of slices.entries()) {
      expect(await pixelAt(raster, { width: 4, height: 4, slice })).toEqual(COLORS[color].rgba)
    }
  })

  it('walks a cubemap mip chain: every face carries its own chain', async () => {
    const faces: readonly ColorName[] = ['red', 'green', 'blue', 'white', 'yellow', 'cyan']
    const surfaces: Uint8Array[] = []
    for (const color of faces) {
      surfaces.push(dxt1Surface(4, 4, color), dxt1Surface(2, 2, 'black'), dxt1Surface(1, 1, color))
    }
    const bytes = buildDds({ width: 4, height: 4, mipLevels: 3, cubemap: true }, surfaces)
    const raster = await rasterOf(bytes)
    for (const [face, color] of faces.entries()) {
      expect(await pixelAt(raster, { width: 4, height: 4, face, mipLevel: 0 })).toEqual(
        COLORS[color].rgba,
      )
      expect(await pixelAt(raster, { width: 2, height: 2, face, mipLevel: 1 })).toEqual(
        COLORS.black.rgba,
      )
      expect(await pixelAt(raster, { width: 1, height: 1, face, mipLevel: 2 })).toEqual(
        COLORS[color].rgba,
      )
    }
  })

  it('refuses each out-of-range axis by the name of that axis', async () => {
    const bytes = buildDds({ width: 4, height: 4 }, [dxt1Surface(4, 4, 'red')])
    const raster = await rasterOf(bytes)
    await expect(pixelAt(raster, { width: 4, height: 4, mipLevel: 1 })).rejects.toThrow(
      /mip level 1 is outside 0\.\.0/u,
    )
    await expect(pixelAt(raster, { width: 4, height: 4, layer: 1 })).rejects.toThrow(
      /array layer 1 is outside 0\.\.0/u,
    )
    await expect(pixelAt(raster, { width: 4, height: 4, face: 3 })).rejects.toThrow(
      /cubemap face 3 is outside 0\.\.0/u,
    )
    await expect(pixelAt(raster, { width: 4, height: 4, slice: 2 })).rejects.toThrow(
      /volume slice 2 is outside 0\.\.0/u,
    )
  })

  it('reports the subresource inventory in metadata instead of promising it', async () => {
    const surfaces: Uint8Array[] = []
    for (let face = 0; face < 6; face += 1) {
      surfaces.push(dxt1Surface(4, 4, 'red'), dxt1Surface(2, 2, 'red'), dxt1Surface(1, 1, 'red'))
    }
    const bytes = buildDds({ width: 4, height: 4, mipLevels: 3, cubemap: true }, surfaces)
    const session = await openImageCodec('dds/codec.js', bytes)
    const descriptor = (await session.descriptor()) as unknown as {
      readonly metadata?: readonly {
        readonly id: string
        readonly entries: readonly { readonly key: string; readonly value: unknown }[]
      }[]
    }
    const entries = new Map(
      (descriptor.metadata ?? [])
        .filter(group => group.id === 'dds-image')
        .flatMap(group => group.entries.map(entry => [entry.key, entry.value] as const)),
    )
    expect(entries.get('subresources')).toBe(18)
    expect(entries.get('faces')).toBe(6)
    expect(entries.get('mipLevels')).toBe(3)
    expect(entries.get('payloadBytes')).toBe(6 * (8 + 8 + 8))
  })
})

describe('DDS formats the decoder does not decode', () => {
  it.each([
    [79, 'BC4_TYPELESS'],
    [82, 'BC5_TYPELESS'],
    [95, 'BC6H_UF16'],
    [96, 'BC6H_SF16'],
    [98, 'BC7_UNORM'],
    [99, 'BC7_UNORM_SRGB'],
  ])('refuses DXGI %i by its name %s rather than claiming support', async (dxgi, name) => {
    const bytes = buildDds({ width: 4, height: 4, dxgiFormat: dxgi }, [new Uint8Array(16)])
    await expect(openImageCodec('dds/codec.js', bytes)).rejects.toThrow(
      new RegExp(`${name}\\) is recognised but this decoder produces no pixels`, 'u'),
    )
  })

  it('names an unknown FourCC instead of mis-sizing its payload', async () => {
    const bytes = buildDds({ width: 4, height: 4, fourCc: 'ZZZZ' }, [new Uint8Array(16)])
    await expect(openImageCodec('dds/codec.js', bytes)).rejects.toThrow(
      /DDS FourCC ZZZZ is not supported/u,
    )
  })
})

/**
 * Formats carried over from the legacy MK2 decoder
 * (`references/modkitmk2/extensions/common/images/codecs/dds/src/dds.ts`).
 *
 * Each of these appears in the real StarCraft II corpus and used to be refused: the BC5 case failed
 * as "pixel payload is truncated" because the unknown FourCC fell through to a byte count computed
 * from an undefined `dwRGBBitCount`, and the luminance case never opened at all. The expected values
 * below are what the legacy decoder produces for the same bytes.
 */
describe('DDS formats ported from the legacy decoder', () => {
  /** One BC4 block holding a single value: equal endpoints, every index 0. */
  function bc4Block(value: number): Uint8Array {
    const block = new Uint8Array(8)
    block[0] = value
    block[1] = value
    return block
  }

  function bc4Surface(width: number, height: number, value: number): Uint8Array {
    const blocks = Math.ceil(width / 4) * Math.ceil(height / 4)
    const surface = new Uint8Array(blocks * 8)
    for (let index = 0; index < blocks; index += 1) surface.set(bc4Block(value), index * 8)
    return surface
  }

  /** BC5 stores two BC4 channel blocks back to back: red then green. */
  function bc5Surface(width: number, height: number, red: number, green: number): Uint8Array {
    const blocks = Math.ceil(width / 4) * Math.ceil(height / 4)
    const surface = new Uint8Array(blocks * 16)
    for (let index = 0; index < blocks; index += 1) {
      surface.set(bc4Block(red), index * 16)
      surface.set(bc4Block(green), index * 16 + 8)
    }
    return surface
  }

  it.each([
    ['ATI1', 8],
    ['BC4U', 8],
  ])('decodes %s as one channel replicated across RGB', async (fourCc, blockBytes) => {
    const bytes = buildDds({ width: 4, height: 4, fourCc }, [bc4Surface(4, 4, 0x40)])
    expect(bytes.byteLength).toBe(128 + blockBytes)
    const raster = await rasterOf(bytes)
    expect(await pixelAt(raster, { width: 4, height: 4 })).toEqual([0x40, 0x40, 0x40, 255])
    expect((await raster.info()).channels).toBe(1)
    expect((await raster.info()).alphaMode).toBe('none')
  })

  it.each(['ATI2', 'BC5U'])('decodes %s as two channels, blue left at zero', async fourCc => {
    const bytes = buildDds({ width: 4, height: 4, fourCc }, [bc5Surface(4, 4, 0x30, 0x90)])
    const raster = await rasterOf(bytes)
    expect(await pixelAt(raster, { width: 4, height: 4 })).toEqual([0x30, 0x90, 0, 255])
    expect((await raster.info()).channels).toBe(2)
  })

  it('walks a BC5 mip chain, which mis-sized payloads could not reach', async () => {
    const bytes = buildDds({ width: 8, height: 8, mipLevels: 3, fourCc: 'ATI2' }, [
      bc5Surface(8, 8, 0x10, 0x20),
      bc5Surface(4, 4, 0x30, 0x40),
      bc5Surface(2, 2, 0x50, 0x60),
    ])
    const raster = await rasterOf(bytes)
    expect(await pixelAt(raster, { width: 8, height: 8, mipLevel: 0 })).toEqual([
      0x10, 0x20, 0, 255,
    ])
    expect(await pixelAt(raster, { width: 4, height: 4, mipLevel: 1 })).toEqual([
      0x30, 0x40, 0, 255,
    ])
    expect(await pixelAt(raster, { width: 2, height: 2, mipLevel: 2 })).toEqual([
      0x50, 0x60, 0, 255,
    ])
  })

  it('decodes an L8A8 luminance surface, replicating luminance across RGB', async () => {
    const surface = new Uint8Array(4 * 4 * 2)
    for (let index = 0; index < 16; index += 1) {
      surface[index * 2] = 0x7f
      surface[index * 2 + 1] = 0xc0
    }
    const bytes = buildDds({ width: 4, height: 4, luminanceBits: 16 }, [surface])
    const raster = await rasterOf(bytes)
    expect(await pixelAt(raster, { width: 4, height: 4 })).toEqual([0x7f, 0x7f, 0x7f, 0xc0])
    const info = await raster.info()
    expect(info.channels).toBe(2)
    expect(info.alphaMode).toBe('straight')
  })

  it('decodes an L8 luminance surface as opaque grey', async () => {
    const bytes = buildDds({ width: 4, height: 4, luminanceBits: 8 }, [
      new Uint8Array(16).fill(0x22),
    ])
    const raster = await rasterOf(bytes)
    expect(await pixelAt(raster, { width: 4, height: 4 })).toEqual([0x22, 0x22, 0x22, 255])
    expect((await raster.info()).channels).toBe(1)
  })

  it('expands 565 endpoints by bit replication, the way the GPU does', async () => {
    /* r5 = 3 replicates to 24; rational rounding would give 25 and drift from legacy and hardware. */
    const packed = 3 << 11
    const bytes = buildDds({ width: 4, height: 4 }, [
      (() => {
        const block = new Uint8Array(8)
        new DataView(block.buffer).setUint16(0, packed, true)
        new DataView(block.buffer).setUint16(2, packed, true)
        return block
      })(),
    ])
    const raster = await rasterOf(bytes)
    expect(await pixelAt(raster, { width: 4, height: 4 })).toEqual([24, 0, 0, 255])
  })
})
