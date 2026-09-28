import { describe, expect, it } from 'vitest'
import { IMA_STEP_TABLE } from '../src/audio/ima.js'
import { decodeImaWs, decodeWsAdpcm } from '../src/audio/westwood.js'

describe('Westwood IMA ADPCM', () => {
  it('scales by (2m + 1) * step >> 3, low nibble first, the predictor running across chunks', () => {
    // index 0 (step 7): code 7 -> (15 * 7) >> 3 = 13, index 8 (step 16); code 0 -> 16 >> 3 = 2.
    expect([...decodeImaWs([Uint8Array.of(0x07)], 1)]).toEqual([13, 15])
    expect([...decodeImaWs([Uint8Array.of(0x07), Uint8Array.of(0x08)], 1)]).toEqual([
      13, 15, 14, 15,
    ])
    // (Microsoft's sum of shifted steps would give 0 + 7 + 3 + 1 = 11 for the first code 7.)
    expect(IMA_STEP_TABLE[8]).toBe(16)
  })

  it('interleaves stereo a byte per channel, or halves a version 3 VQA chunk', () => {
    // left codes 7 then 0, right codes 1 then 0
    const left = [13, 15]
    const right = [2, 2]
    const frames = [left[0], right[0], left[1], right[1]]
    expect([...decodeImaWs([Uint8Array.of(0x07, 0x01)], 2)]).toEqual(frames)
    expect([...decodeImaWs([Uint8Array.of(0x07, 0x01)], 2, 'planar')]).toEqual(frames)
    // two pairs: interleaved L R L R, planar L L R R
    const interleaved = decodeImaWs([Uint8Array.of(0x07, 0x01, 0x00, 0x00)], 2)
    const planar = decodeImaWs([Uint8Array.of(0x07, 0x00, 0x01, 0x00)], 2, 'planar')
    expect([...planar]).toEqual([...interleaved])
    expect(() => decodeImaWs([Uint8Array.of(1, 2, 3)], 2)).toThrow(/odd number of bytes/u)
  })

  it('clamps to 16 bits', () => {
    const loud = decodeImaWs([new Uint8Array(64).fill(0x77)], 1)
    expect(loud.at(-1)).toBe(32_767)
  })
})

describe('WS SND1', () => {
  const pcm = (samples: number[]) => samples.map(sample => (sample - 128) << 8)

  it('expands each code from 128, afresh in every chunk', () => {
    const chunk = Uint8Array.of(
      0x00,
      0b11_10_01_00, // 2-bit deltas -2 -1 0 +1
      0x40,
      0xf0, //          4-bit deltas -9 then +8
      0x80 | 0x20 | 0x1f, //  5-bit delta -1
      0x80 | 0x01,
      200,
      10, // two raw samples
      0xc0 | 0x02, //         run of three
    )
    const samples = [126, 125, 125, 126, 117, 125, 124, 200, 10, 10, 10, 10]
    expect([...decodeWsAdpcm([{ data: chunk, samples: 12 }])]).toEqual(pcm(samples))
    expect([
      ...decodeWsAdpcm([
        { data: chunk, samples: 12 },
        { data: Uint8Array.of(0xc1), samples: 2 },
      ]),
    ]).toEqual(pcm([...samples, 128, 128]))
  })

  it('takes a chunk as long as its output raw, and holds the last sample past a short one', () => {
    expect([...decodeWsAdpcm([{ data: Uint8Array.of(0, 255), samples: 2 }])]).toEqual(pcm([0, 255]))
    // a run of 64 in a chunk of 3 samples ends the chunk: 128 held
    expect([...decodeWsAdpcm([{ data: Uint8Array.of(0xc0 | 0x3f, 0), samples: 3 }])]).toEqual(
      pcm([128, 128, 128]),
    )
    expect([...decodeWsAdpcm([{ data: Uint8Array.of(0x40, 0x0f, 0x40), samples: 5 }])]).toEqual(
      pcm([136, 127, 127, 127, 127]),
    )
  })
})
