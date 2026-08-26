/**
 * Bounded ASTC depth: only the mandatory 2D LDR void-extent constant-colour mode.
 *
 * The expected channels are derived independently from Khronos Data Format Specification 1.4,
 * §§23.9.3, 23.18 and 23.22: bits 8..0 identify void extent, bit 9 selects LDR, bits 10..11
 * are reserved ones, RGBA are little-endian UNORM16 at bits 64..127, and decode_unorm8 takes
 * each component's high byte.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { proves } from '@modkitx-x3/testkit'
import { type RasterImageSource } from '@modkitx-x3/sdk'
import { imageTestBudget, openImageCodec, repoRoot } from './codec-session.js'

const fixturePath = join(
  repoRoot,
  'packages',
  'testkit',
  'test',
  'fixtures',
  'mk2-synthetic',
  'minimal.astc',
)
const PAYLOAD = 16

async function open(bytes: Uint8Array, maxScalarBytes = imageTestBudget.maxScalarBytes) {
  return openImageCodec('astc/codec.js', bytes, { ...imageTestBudget, maxScalarBytes })
}

async function rasterOf(session: Awaited<ReturnType<typeof open>>) {
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  return { lease, raster: lease.value as RasterImageSource }
}

async function readRegion(
  raster: RasterImageSource,
  request: { x: number; y: number; width: number; height: number; maxBytes: number },
  signal?: AbortSignal,
) {
  if (raster.readRegion === undefined) throw new Error('ASTC raster source has no region reader')
  return raster.readRegion({ ...request, pixelFormat: 'rgba8' }, signal)
}

describe('IMAGE_GPU_DEPTH ASTC LDR void-extent decode', () => {
  it('decodes the pinned 4x4 block to the exact opaque-blue RGBA image', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    expect([...bytes.subarray(PAYLOAD)]).toEqual([
      0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
      0xff,
    ])
    const session = await open(bytes)
    const descriptor = await session.descriptor()
    expect(descriptor.dataSources.map(item => item.contract)).toContain(
      'common.view/raster-image-source',
    )
    const { lease, raster } = await rasterOf(session)
    expect(await raster.info()).toMatchObject({
      width: 4,
      height: 4,
      depth: 1,
      decodedAccess: true,
      colorSpace: 'unknown',
    })
    const region = await readRegion(raster, { x: 0, y: 0, width: 4, height: 4, maxBytes: 64 })
    expect([...region.pixels]).toEqual(Array.from({ length: 16 }, () => [0, 0, 255, 255]).flat())

    proves({
      contributionId: 'org.modkitx/astc',
      operation: 'read',
      note: 'pinned legal 2D LDR void-extent block decoded to exact rgba8',
    })

    await lease.release()
    await session.dispose()
  })

  it('uses the high byte of each little-endian UNORM16 channel', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    bytes.set([0x34, 0x12, 0xcd, 0xab, 0x01, 0x00, 0xff, 0x7f], PAYLOAD + 8)
    const session = await open(bytes)
    const { lease, raster } = await rasterOf(session)
    const region = await readRegion(raster, { x: 1, y: 2, width: 2, height: 1, maxBytes: 8 })
    expect([...region.pixels]).toEqual([0x12, 0xab, 0x00, 0x7f, 0x12, 0xab, 0x00, 0x7f])
    await lease.release()
    await session.dispose()
  })

  it.each([
    ['ordinary ASTC block mode', (bytes: Uint8Array) => (bytes[PAYLOAD] = 0)],
    ['HDR void extent', (bytes: Uint8Array) => (bytes[PAYLOAD + 1] |= 0x02)],
    [
      'void extent with a cleared reserved bit',
      (bytes: Uint8Array) => (bytes[PAYLOAD + 1] &= 0xfb),
    ],
  ])('keeps %s compressed-only', async (_label, mutate) => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    mutate(bytes)
    const session = await open(bytes)
    const { lease, raster } = await rasterOf(session)
    expect(await raster.info()).toMatchObject({ decodedAccess: false })
    expect(raster.readRegion).toBeUndefined()
    await lease.release()
    await session.dispose()
  })

  it('checks the scalar budget before exposing decoded pixels', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    await expect(open(bytes, 63)).rejects.toThrow(/scalar budget/u)
  })

  it('checks region budgets and cancellation without allocating a result', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const session = await open(bytes)
    const { lease, raster } = await rasterOf(session)
    await expect(
      readRegion(raster, { x: 0, y: 0, width: 4, height: 4, maxBytes: 63 }),
    ).rejects.toThrow(/maxBytes budget/u)
    const controller = new AbortController()
    controller.abort()
    await expect(
      readRegion(raster, { x: 0, y: 0, width: 4, height: 4, maxBytes: 64 }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await lease.release()
    await session.dispose()
  })
})
