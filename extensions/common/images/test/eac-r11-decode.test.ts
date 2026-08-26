/**
 * Independent EAC fixtures derived from Khronos Data Format Specification 1.4 §22.5–22.6.
 * No encoder output or decoder round-trip is used: each block pins the base/table/multiplier and
 * one repeated selector, so its exact 11-bit reconstruction follows directly from the formula.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { type RasterImageSource } from '@modkitx-x3/sdk'
import { proves } from '@modkitx-x3/testkit'
import { imageTestBudget, openImageCodec } from './codec-session.js'

function repeatSelector(selector: number): Uint8Array {
  let packed = 0n
  for (let index = 0; index < 16; index += 1) packed = (packed << 3n) | BigInt(selector)
  return Uint8Array.from({ length: 6 }, (_value, index) =>
    Number((packed >> BigInt(40 - index * 8)) & 0xffn),
  )
}

function channel(base: number, multiplier: number, table: number, selector: number): Uint8Array {
  return Uint8Array.from([base, (multiplier << 4) | table, ...repeatSelector(selector)])
}

function pkm(identifier: number, payload: Uint8Array, width = 4, height = 4): Uint8Array {
  const bytes = new Uint8Array(16 + payload.byteLength)
  bytes.set(new TextEncoder().encode('PKM 20'))
  const view = new DataView(bytes.buffer)
  view.setUint16(6, identifier, false)
  view.setUint16(8, 4, false)
  view.setUint16(10, 4, false)
  view.setUint16(12, width, false)
  view.setUint16(14, height, false)
  bytes.set(payload, 16)
  return bytes
}

async function rasterOf(bytes: Uint8Array, maxScalarBytes = imageTestBudget.maxScalarBytes) {
  const session = await openImageCodec('pkm/codec.js', bytes, {
    ...imageTestBudget,
    maxScalarBytes,
  })
  const lease = await session.dataSource('common.view/raster-image-source', 1)
  return { session, lease, raster: lease.value as RasterImageSource }
}

async function region(raster: RasterImageSource, width = 4, height = 4, signal?: AbortSignal) {
  if (raster.readRegion === undefined) throw new Error('EAC raster source has no region reader')
  return raster.readRegion(
    { x: 0, y: 0, width, height, maxBytes: width * height * 4, pixelFormat: 'rgba8' },
    signal,
  )
}

describe('GPU remainder unsigned EAC R11/RG11 decode', () => {
  it('decodes the specification R11 multiplier example into the sampled R view', async () => {
    // base=103, table=13, selector=3→modifier -10, multiplier=2:
    // clamp(103*8 + 4 - 10*2*8) = 668; replicate 11→16 and take high byte = 83.
    const bytes = pkm(4, channel(103, 2, 13, 3))
    expect(bytes.byteLength).toBe(24)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'bd3d015b64e40e6a5760bf80c5dbec57f4dd9949d9687fb610def69e0e9ca69a',
    )
    const { session, lease, raster } = await rasterOf(bytes)
    expect(await raster.info()).toMatchObject({ channels: 1, bitDepth: 11, decodedAccess: true })
    expect([...(await region(raster)).pixels]).toEqual(
      Array.from({ length: 16 }, () => [83, 0, 0, 255]).flat(),
    )
    proves({
      contributionId: 'org.modkitx/pkm',
      operation: 'read',
      note: 'Khronos unsigned EAC R11 formula publishes the exact sampled R projection',
    })
    await lease.release()
    await session.dispose()
  })

  it('decodes independent R and G blocks and the multiplier-zero rule', async () => {
    const red = channel(103, 0, 13, 3) // 103*8 + 4 - 10 = 818 → 102
    const green = channel(129, 0, 13, 3) // 129*8 + 4 - 10 = 1026 → 128
    const bytes = pkm(5, Uint8Array.from([...red, ...green]), 1, 1)
    const { session, lease, raster } = await rasterOf(bytes)
    expect(await raster.info()).toMatchObject({ channels: 2, bitDepth: 11, decodedAccess: true })
    expect([...(await region(raster, 1, 1)).pixels]).toEqual([102, 128, 0, 255])
    proves({
      contributionId: 'org.modkitx/pkm',
      operation: 'read',
      note: 'Khronos unsigned EAC RG11 decodes two ordered blocks and multiplier zero as one eighth',
    })
    await lease.release()
    await session.dispose()
  })

  it('keeps signed EAC compressed-only and fails budgets/cancellation closed', async () => {
    const signed = pkm(6, channel(65, 2, 13, 3))
    const signedOpened = await rasterOf(signed)
    expect(await signedOpened.raster.info()).toMatchObject({ bitDepth: 11, decodedAccess: false })
    expect(signedOpened.raster.readRegion).toBeUndefined()
    await signedOpened.lease.release()
    await signedOpened.session.dispose()

    const unsigned = pkm(4, channel(103, 2, 13, 3))
    await expect(rasterOf(unsigned, 63)).rejects.toThrow(/scalar budget/u)
    const narrow = pkm(4, channel(103, 2, 13, 3), 1, 1)
    // The logical crop is four bytes, but decoding its one 4x4 block allocates 64 RGBA bytes.
    await expect(rasterOf(narrow, 63)).rejects.toThrow(/scalar budget/u)
    const opened = await rasterOf(unsigned)
    const controller = new AbortController()
    controller.abort()
    await expect(region(opened.raster, 4, 4, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    proves({
      contributionId: 'org.modkitx/pkm',
      operation: 'validate',
      note: 'signed EAC remains named and unsigned EAC budgets and cancellation fail closed',
    })
    await opened.lease.release()
    await opened.session.dispose()
  })
})
