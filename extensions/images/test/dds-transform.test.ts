/**
 * `edit.content` on a DDS: the ported pixel transforms, reachable at last.
 *
 * `ops/raster-ops.js` came across with MK2's decoder and was imported by nothing. MK2 reached those
 * six operations from VS Code commands, so in MK3 they belong behind a codec operation instead —
 * the app, the editor and a script then reach the same code, rather than one host owning a
 * capability the others cannot have.
 *
 * What is pinned here is the part a caller depends on: that a transform actually changes the pixels
 * it claims to, that the result is a readable DDS again, and that a request the transform cannot
 * honour is refused by name rather than producing a quietly wrong texture.
 */
import { describe, expect, it } from 'vitest'
import { openImageCodec } from './codec-session.js'
import { encodeDds } from '../src/dds/encode.js'
import type { RasterImageSource } from '@modkit/sdk'

/** A solid RGBA image, the simplest input whose transform is checkable by eye. */
function solid(width: number, height: number, rgba: readonly number[]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index += 1) pixels.set(rgba, index * 4)
  return encodeDds({ width, height, pixels }, { format: 'rgba8' })
}

async function transform(bytes: Uint8Array, request: Record<string, unknown>) {
  const session = (await openImageCodec('dds/codec.js', bytes)) as never as {
    operations(): { invoke(id: string, input: unknown): Promise<unknown> }
    dispose(): Promise<void>
  }
  try {
    const result = (await session.operations().invoke('transform', request)) as {
      state?: string
      reason?: string
      output?: { plan?: { edits?: readonly { payload?: { bytes?: unknown } }[] } }
    }
    if (result.state === 'rejected') throw new Error(`refused: ${String(result.reason)}`)
    const payload = result.output?.plan?.edits?.[0]?.payload?.bytes
    return ArrayBuffer.isView(payload)
      ? (payload as Uint8Array)
      : Uint8Array.from(Object.values(payload as Record<string, number>))
  } finally {
    await session.dispose()
  }
}

async function firstPixel(bytes: Uint8Array): Promise<readonly number[]> {
  const session = await openImageCodec('dds/codec.js', bytes)
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  const raster = lease.value as RasterImageSource
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
    maxBytes: 4_000_000,
  })
  if (region === undefined) throw new Error('DDS raster exposes no readRegion')
  return [info.width, info.height, ...region.pixels.subarray(0, 4)]
}

describe('DDS pixel transforms', () => {
  it('resizes the surface and writes a DDS that reads back at the new size', async () => {
    const written = await transform(solid(8, 8, [10, 20, 30, 255]), {
      transform: 'resize',
      width: 4,
      height: 4,
    })
    const [width, height, r, g, b, a] = await firstPixel(written)
    expect([width, height]).toEqual([4, 4])
    // A solid image stays that colour through any correct resample.
    expect([r, g, b, a]).toEqual([10, 20, 30, 255])
  })

  it('makes the keyed colour transparent and leaves the others alone', async () => {
    const written = await transform(solid(4, 4, [255, 0, 0, 255]), {
      transform: 'color-key',
      target: { r: 255, g: 0, b: 0 },
    })
    const [, , , , , alpha] = await firstPixel(written)
    expect(alpha).toBe(0)
  })

  it('rounds the alpha corners without touching the middle', async () => {
    const written = await transform(solid(16, 16, [200, 200, 200, 255]), {
      transform: 'rounded-alpha',
      radius: 4,
    })
    const [, , , , , corner] = await firstPixel(written)
    // The top-left texel is inside the rounded corner, so its alpha is cut.
    expect(corner).toBeLessThan(255)
  })

  it('replaces the pixels with a painted image, cropped size included', async () => {
    const painted = new Uint8Array(2 * 1 * 4).fill(200)
    const text = btoa(String.fromCharCode(...painted))
    const bytes = await transform(solid(4, 4, [1, 2, 3, 255]), {
      transform: 'replace',
      image: { width: 2, height: 1, pixels: text },
    })
    expect(await firstPixel(bytes)).toEqual([2, 1, 200, 200, 200, 200])
  })

  /*
   * The refusals matter more than the successes. Each of these produces a plausible-looking texture
   * if it is allowed through, and a modder discovers the mistake in the game rather than in the tool.
   */
  it('refuses a transform it does not have', async () => {
    await expect(transform(solid(4, 4, [1, 2, 3, 255]), { transform: 'sharpen' })).rejects.toThrow(
      /must be one of/u,
    )
  })

  it('refuses a button icon that is not square', async () => {
    await expect(
      transform(solid(8, 4, [1, 2, 3, 255]), { transform: 'button-icon' }),
    ).rejects.toThrow(/square image, got 8 x 4/u)
  })

  it('refuses a specular combine with no second image, and with a mismatched one', async () => {
    await expect(
      transform(solid(4, 4, [1, 2, 3, 255]), { transform: 'combine-normal-specular' }),
    ).rejects.toThrow(/requires a specular image/u)
    await expect(
      transform(solid(4, 4, [1, 2, 3, 255]), {
        transform: 'combine-normal-specular',
        specular: { width: 2, height: 2, pixels: [...new Uint8Array(2 * 2 * 4)] },
      }),
    ).rejects.toThrow(/same size/u)
  })

  it('refuses a resize to a size that is not a positive whole number', async () => {
    await expect(
      transform(solid(4, 4, [1, 2, 3, 255]), { transform: 'resize', width: 0, height: 4 }),
    ).rejects.toThrow(/positive integer/u)
  })
})
