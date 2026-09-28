import { describe, expect, it } from 'vitest'
import {
  vorbisCommentHeader,
  vorbisIdentificationHeader,
  vorbisModeBlockflags,
  vorbisPacketsToOgg,
} from '../src/audio/vorbis.js'

/** LSB-first bits, as Vorbis packs them. */
function bits(fields: readonly (readonly [value: number, width: number])[]): Uint8Array {
  const out: number[] = []
  let at = 0
  for (const [value, width] of fields) {
    for (let offset = 0; offset < width; offset += 1, at += 1) {
      if ((at & 7) === 0) out.push(0)
      out[out.length - 1]! |= ((value >>> offset) & 1) << (at & 7)
    }
  }
  return Uint8Array.from(out)
}

const vorbis = [0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]

/** A setup header whose end is `modes`: filler, the count less one, each mode, the framing bit. */
function setup(modes: readonly { flag: 0 | 1; mapping: number }[]): Uint8Array {
  return bits([
    [5, 8],
    ...vorbis.map(byte => [byte, 8] as const),
    // stands for codebooks, floors, residues and mappings
    [0x2d, 8],
    [0x3ff, 13],
    [modes.length - 1, 6],
    ...modes.flatMap(
      mode =>
        [
          [mode.flag, 1],
          [0, 16],
          [0, 16],
          [mode.mapping, 8],
        ] as const,
    ),
    [1, 1],
  ])
}

/** The granule of each Ogg page, in order. */
function pageGranules(ogg: Uint8Array): bigint[] {
  const view = new DataView(ogg.buffer, ogg.byteOffset, ogg.byteLength)
  const granules: bigint[] = []
  for (let at = 0; at < ogg.byteLength;) {
    granules.push(view.getBigInt64(at + 6, true))
    const segments = ogg[at + 26] ?? 0
    let body = 0
    for (let index = 0; index < segments; index += 1) body += ogg[at + 27 + index] ?? 0
    at += 27 + segments + body
  }
  return granules
}

describe('Vorbis without Ogg, rebuilt as Ogg Vorbis', () => {
  it('writes the identification and comment headers the game left out', () => {
    const id = vorbisIdentificationHeader({
      channels: 2,
      sampleRate: 44_100,
      blocksizes: [8, 11],
      nominalBitrate: 128_000,
    })
    expect(id.byteLength).toBe(30)
    expect([...id.subarray(0, 7)]).toEqual([1, ...vorbis])
    const view = new DataView(id.buffer)
    expect([id[11], view.getUint32(12, true), view.getUint32(20, true), id[28], id[29]]).toEqual([
      2, 44_100, 128_000, 0xb8, 1,
    ])
    const comment = vorbisCommentHeader('Modkit')
    const vendor = [...new TextEncoder().encode('Modkit')]
    expect([...comment]).toEqual([3, ...vorbis, 6, 0, 0, 0, ...vendor, 0, 0, 0, 0, 1])
  })

  it('reads each mode long-window flag backwards from the framing bit', () => {
    expect(
      vorbisModeBlockflags(
        setup([
          { flag: 0, mapping: 0 },
          { flag: 1, mapping: 1 },
        ]),
      ),
    ).toEqual([false, true])
    expect(vorbisModeBlockflags(setup([{ flag: 1, mapping: 0 }]))).toEqual([true])
    expect(() => vorbisModeBlockflags(Uint8Array.of(1, ...vorbis))).toThrow(/not a Vorbis setup/u)
  })

  it('gives each packet the revorb granule and cuts the last to the sample count', () => {
    const header = setup([
      { flag: 0, mapping: 0 },
      { flag: 1, mapping: 1 },
    ])
    // mode 0 (short, 256) then mode 1 (long, 2048) twice: 0, (256 + 2048) / 4 = 576, 576 + 1024.
    const packets = [Uint8Array.of(0 << 1, 9), Uint8Array.of(1 << 1, 9), Uint8Array.of(1 << 1, 9)]
    const info = { channels: 1, sampleRate: 22_050, blocksizes: [8, 11] } as const
    const whole = vorbisPacketsToOgg({ info, vendor: 'Modkit', setup: header, packets })
    expect(pageGranules(whole).at(-1)).toBe(1600n)
    const cut = vorbisPacketsToOgg({
      info,
      vendor: 'Modkit',
      setup: header,
      packets,
      sampleCount: 1000,
    })
    expect(pageGranules(cut).at(-1)).toBe(1000n)
    expect(() =>
      vorbisPacketsToOgg({ info, vendor: 'Modkit', setup: header, packets: [Uint8Array.of(1)] }),
    ).toThrow(/zero bit/u)
  })
})
