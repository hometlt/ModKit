/**
 * Windows ANI first-frame raster depth.
 *
 * The synthetic fixture is a RIFF/ACON container whose `icon` chunk is a complete CUR carrying a
 * 32-bit DIB XOR plane and a separate 1-bit AND mask. The assertions below exercise the shipped
 * codec through its public session/data-source path; no private ANI timeline shape is introduced.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { proves } from '@modkitx-x3/testkit'
import { type RasterImageSource, type ResourceBudget } from '@modkitx-x3/sdk'
import { imageTestBudget as budget, openImageCodec, repoRoot } from './codec-session.js'

const fixturePath = join(
  repoRoot,
  'packages',
  'testkit',
  'test',
  'fixtures',
  'mk2-synthetic',
  'minimal.ani',
)

async function open(bytes: Uint8Array, resource = budget, signal?: AbortSignal) {
  return openImageCodec('ani/codec.js', bytes, resource as ResourceBudget, signal)
}

async function rasterOf(session: Awaited<ReturnType<typeof open>>) {
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  return { lease, raster: lease.value as RasterImageSource }
}

function u32le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function setU32le(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).setUint32(0, value, true)
}

function firstIconLayout(bytes: Uint8Array) {
  const iconTag = new TextEncoder().encode('icon')
  let chunk = -1
  for (let offset = 12; offset + 8 <= bytes.byteLength; offset += 1) {
    if (iconTag.every((value, index) => bytes[offset + index] === value)) {
      chunk = offset
      break
    }
  }
  if (chunk < 0) throw new TypeError('fixture has no icon chunk')
  const frame = chunk + 8
  const imageSizeField = frame + 6 + 8
  const imageOffsetField = frame + 6 + 12
  const dib = frame + u32le(bytes, imageOffsetField)
  const headerBytes = u32le(bytes, dib)
  const width = u32le(bytes, dib + 4)
  const xorRowBytes = Math.ceil((width * 32) / 32) * 4
  const mask = dib + headerBytes + xorRowBytes
  return { frame, imageSizeField, dib, mask }
}

const readFirstPixel = async (raster: RasterImageSource, signal?: AbortSignal) => {
  if (raster.readRegion === undefined) throw new Error('ANI raster source has no region reader')
  return raster.readRegion(
    { x: 0, y: 0, width: 1, height: 1, pixelFormat: 'rgba8', maxBytes: 4 },
    signal,
  )
}

describe('IMAGE_GPU_DEPTH Windows ANI raster decode', () => {
  it('opens the pinned 1x1 CUR/DIB frame and publishes its exact RGBA pixel', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const session = await open(bytes)
    const descriptor = await session.descriptor()
    expect(descriptor.dataSources.map(item => item.contract)).toContain(
      'common.view/raster-image-source',
    )
    const { lease, raster } = await rasterOf(session)
    expect(await raster.info()).toMatchObject({
      width: 1,
      height: 1,
      frames: 1,
      decodedAccess: true,
    })
    const region = await readFirstPixel(raster)
    expect([...region.pixels]).toEqual([128, 64, 32, 255])

    proves({
      contributionId: 'org.modkitx/ani',
      operation: 'read',
      note: 'first embedded CUR/DIB frame decoded to exact rgba8 through raster-image-source',
    })

    await lease.release()
    await session.dispose()
  })

  it('applies the CUR AND mask after the XOR colour plane', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const { mask } = firstIconLayout(bytes)
    bytes[mask] = 0x80
    const session = await open(bytes)
    const { lease, raster } = await rasterOf(session)
    expect([...(await readFirstPixel(raster)).pixels]).toEqual([128, 64, 32, 0])
    await lease.release()
    await session.dispose()
  })

  it('checks the scalar budget before exposing a decoded frame', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    await expect(open(bytes, { ...budget, maxScalarBytes: 3 })).rejects.toThrow(
      /maxScalarBytes budget/u,
    )
  })

  it('enforces the caller region budget', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const session = await open(bytes)
    const { lease, raster } = await rasterOf(session)
    if (raster.readRegion === undefined) throw new Error('ANI raster source has no region reader')
    await expect(
      raster.readRegion({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        pixelFormat: 'rgba8',
        maxBytes: 3,
      }),
    ).rejects.toThrow(/maxBytes budget/u)
    await lease.release()
    await session.dispose()
  })

  it('honours cancellation on decoded-region reads', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const session = await open(bytes)
    const { lease, raster } = await rasterOf(session)
    const controller = new AbortController()
    controller.abort()
    await expect(readFirstPixel(raster, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    await lease.release()
    await session.dispose()
  })

  it('rejects truncated and out-of-range embedded cursor payloads without leaking a path', async () => {
    const original = new Uint8Array(await readFile(fixturePath))
    await expect(open(original.slice(0, -1))).rejects.toThrow(/RIFF size/u)

    const malformed = original.slice()
    const malformedLayout = firstIconLayout(malformed)
    malformed[malformedLayout.frame + 2] = 3
    await expect(open(malformed)).rejects.toThrow(/no ICO\/CUR header/u)

    const truncatedDib = original.slice()
    const truncatedLayout = firstIconLayout(truncatedDib)
    setU32le(truncatedDib, truncatedLayout.imageSizeField, 43)
    await expect(open(truncatedDib)).rejects.toThrow(/DIB pixel data is truncated/u)

    const truncatedMask = original.slice()
    const truncatedMaskLayout = firstIconLayout(truncatedMask)
    setU32le(truncatedMask, truncatedMaskLayout.imageSizeField, 44)
    await expect(open(truncatedMask)).rejects.toThrow(/AND mask is truncated/u)

    const outside = original.slice()
    const { imageSizeField } = firstIconLayout(outside)
    setU32le(outside, imageSizeField, 0xffff_ffff)
    let message = ''
    try {
      await open(outside)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/points outside the source/u)
    expect(message).not.toMatch(/[A-Za-z]:[\\/]|file:\/\//u)
  })

  it('does not allocate for hostile DIB dimensions', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const { dib } = firstIconLayout(bytes)
    setU32le(bytes, dib + 4, 0x7fff_ffff)
    const session = await open(bytes)
    const { lease, raster } = await rasterOf(session)
    expect(await raster.info()).toMatchObject({ decodedAccess: false })
    expect(raster.readRegion).toBeUndefined()
    await lease.release()
    await session.dispose()
  })
})
