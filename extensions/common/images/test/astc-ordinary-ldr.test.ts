/**
 * Independent ASTC blocks encoded and decoded by Arm astcenc 5.6.0 (Apache-2.0), then pinned as
 * immutable bytes and expected RGBA8. The decoder under test does not call astcenc.
 *
 * Tool archive SHA-256:
 *   25871b3f798005b11cfb2b369ee7911043d4d5e7bcde5b10cb8b51f81bf4a95d
 * Source image: apps/web/public/favicon-32.png, 2,727 bytes,
 *   sha256 176857e25236f89b686d78757b397386c5d1a1a1c50fb46c9a07130951745590
 * Command: astcenc-sse2.exe -cl favicon-32.png output.astc <footprint> -thorough
 * Each fixture is one selected block placed in a standalone matching-footprint ASTC container;
 * expected pixels come from astcenc-sse2.exe -dl fixture.astc fixture.bmp.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { type RasterImageSource } from '@modkitx-x3/sdk'
import { proves } from '@modkitx-x3/testkit'
import { imageTestBudget, openImageCodec } from './codec-session.js'

const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../gu)?.map(byte => parseInt(byte, 16)) ?? [])

const fixtures = [
  {
    name: '4x4 binary weights / direct RGBA endpoints',
    sha256: '76e9ef8f7fe11b5e362bb871c671383d4441bf5f248f126fe6b78de8f4c9af22',
    bytes: '13aba15c040401040000040000010000428001c400a401740072000003000000',
    rgba: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000062d23a39',
    width: 4,
    height: 4,
    mode: '0x42',
    endpointMode: 12,
    endpointRange: 255,
    dualPlane: false,
  },
  {
    name: '4x4 high-precision trit weights / direct RGB endpoints',
    sha256: '354004382c8c5e1a3874591bacbbf9f69f1400d082452033ff12c98fec63f1fd',
    bytes: '13aba15c04040104000004000001000043020303521913315e13051b0aaa35f0',
    rgba: '0f7e6dff044130ff149888ff0d7262ff075342ff044130ff139080ff09604fff0b6858ff044433ff064e3dff18aa9aff064e3dff0e7968ff0d7262ff095b4aff',
    width: 4,
    height: 4,
    mode: '0x243',
    endpointMode: 8,
    endpointRange: 63,
    dualPlane: false,
  },
  {
    name: '4x4 quint weights / dual-plane direct RGBA endpoints',
    sha256: '51157fd098f2bde612ee75a89e87fbc10944800ea1b50f1332be1b8b5f29d4d5',
    bytes: '13aba15c0404010400000400000100005284618841e47953b42cea0e5b7ff627',
    rgba: '33cc222226aa19c826aa19ff0c6608c826aa19c8198811ff0c6608ff004400220c6608ff198811ff0044009126aa19220c6608ff0c6608ff1988112226aa19c8',
    width: 4,
    height: 4,
    mode: '0x452',
    endpointMode: 12,
    endpointRange: 15,
    dualPlane: true,
  },
  {
    name: '4x4 high-precision quint weights / trit endpoints / dual-plane RGB+alpha',
    sha256: 'ec4ce413bbcc34c02754ce0b7274a09866a011a4da4bd3581da0baab1a35043a',
    bytes: '13aba15c040401040000040000010000cd47914384c11cdecb6eafdd1d4363e9',
    rgba: '074b07ff085308ff085a08ff096209ff0004000b042d04400537056e03260394085708af0857089c075007a4063f06ca0b6e0be5074e07f8053705ff032603ff',
    width: 4,
    height: 4,
    mode: '0x7cd',
    endpointMode: 10,
    endpointRange: 23,
    dualPlane: true,
  },
  {
    name: '6x6 infill / quint RGB endpoints',
    sha256: '148499319b3a31e3b8b38e0541e6a70954292cf4dd949501f2878a8df508c41e',
    bytes: '13aba15c060601060000060000010000630101ac3a7cadbeee9d5dccfd0c4800',
    rgba: '002713ff002713ff002713ff03402aff03402aff002713ff002713ff023b26ff0f9279ff0d846cff0a6d56ff0c7e66ff075842ff05503aff13ab91ff0a6f58ff08654eff0d826aff0d826aff05503aff11a389ff08654eff08654eff0d826aff0e886fff03402aff0f9279ff0a715aff0a715aff0e8e75ff075a44ff03402aff0f9279ff075a44ff075a44ff0b7760ff',
    width: 6,
    height: 6,
    mode: '0x163',
    endpointMode: 8,
    endpointRange: 39,
    dualPlane: false,
  },
] as const

async function open(bytes: Uint8Array, maxScalarBytes = imageTestBudget.maxScalarBytes) {
  return openImageCodec('astc/codec.js', bytes, { ...imageTestBudget, maxScalarBytes })
}

function metadataValue(
  descriptor: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['descriptor']>>,
  key: string,
) {
  return descriptor.metadata
    .find(group => group.id === 'astc-texture')
    ?.entries.find(entry => entry.key === key)?.value
}

describe('GPU remainder ASTC ordinary 2D LDR decode', () => {
  it.each(fixtures)('matches astcenc exactly: $name', async fixture => {
    const bytes = fromHex(fixture.bytes)
    expect(bytes.byteLength).toBe(32)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256)
    const session = await open(bytes)
    const descriptor = await session.descriptor()
    expect(metadataValue(descriptor, 'decodedBlockModes')).toEqual([fixture.mode])
    expect(metadataValue(descriptor, 'decodedEndpointModes')).toEqual([fixture.endpointMode])
    expect(metadataValue(descriptor, 'decodedEndpointRanges')).toEqual([fixture.endpointRange])
    expect(String(metadataValue(descriptor, 'decodedSubset'))).toContain(
      fixture.dualPlane ? 'dual-plane' : 'single-partition',
    )

    const lease = await session.dataSource('common.view/raster-image-source', 1)
    const raster = lease.value as RasterImageSource
    expect(await raster.info()).toMatchObject({
      width: fixture.width,
      height: fixture.height,
      decodedAccess: true,
    })
    if (raster.readRegion === undefined) throw new Error('ASTC ordinary raster has no reader')
    const decoded = await raster.readRegion({
      x: 0,
      y: 0,
      width: fixture.width,
      height: fixture.height,
      maxBytes: fixture.width * fixture.height * 4,
      pixelFormat: 'rgba8',
    })
    expect(Buffer.from(decoded.pixels).toString('hex')).toBe(fixture.rgba)
    await lease.release()
    await session.dispose()
  })

  it('publishes one composite operation proof for binary/trit/quint, infill and dual-plane', () => {
    proves({
      contributionId: 'org.modkitx/astc',
      operation: 'read',
      note: 'five astcenc 5.6 blocks prove binary/trit/quint weights, trit/quint endpoints, infill and dual-plane exact RGBA8',
    })
  })

  it('withholds decoded access for multi-partition and HDR endpoint blocks', async () => {
    const multi = fromHex(fixtures[0].bytes)
    multi[17] |= 0x08 // part bits [12:11] = 1 → two partitions
    const multiSession = await open(multi)
    const multiLease = await multiSession.dataSource('common.view/raster-image-source', 1)
    expect(await (multiLease.value as RasterImageSource).info()).toMatchObject({
      decodedAccess: false,
    })
    expect(metadataValue(await multiSession.descriptor(), 'firstUnsupportedBlock')).toBe(
      'multi-partition-2',
    )
    await multiLease.release()
    await multiSession.dispose()

    const hdr = fromHex(fixtures[1].bytes)
    hdr[17] = (hdr[17] & 0x1f) | (11 << 5)
    hdr[18] = (hdr[18] & 0xfe) | (11 >> 3)
    const hdrSession = await open(hdr)
    const hdrLease = await hdrSession.dataSource('common.view/raster-image-source', 1)
    expect(await (hdrLease.value as RasterImageSource).info()).toMatchObject({
      decodedAccess: false,
    })
    expect(metadataValue(await hdrSession.descriptor(), 'firstUnsupportedBlock')).toBe(
      'hdr-endpoint-mode-11',
    )
    await hdrLease.release()
    await hdrSession.dispose()

    proves({
      contributionId: 'org.modkitx/astc',
      operation: 'validate',
      note: 'multi-partition and HDR endpoint blocks remain named and never publish partial pixels',
    })
  })

  it('keeps legal-looking but unverified block modes compressed-only', async () => {
    const bytes = fromHex(fixtures[0].bytes)
    bytes[16] = 0x43
    const session = await open(bytes, 1)
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    expect(await (lease.value as RasterImageSource).info()).toMatchObject({ decodedAccess: false })
    expect(metadataValue(await session.descriptor(), 'firstUnsupportedBlock')).toBe(
      'unverified-block-mode-0x43',
    )
    await lease.release()
    await session.dispose()
  })

  it('applies the scalar budget after support probing and before ordinary-block decoding', async () => {
    await expect(open(fromHex(fixtures[0].bytes), 63)).rejects.toThrow(/scalar budget/u)
  })
})
