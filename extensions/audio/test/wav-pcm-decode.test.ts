import { describe, expect, it } from 'vitest'
import { createAudioMediaSource } from '@modkit/codec-kit'
import {
  adpcmFramesPerBlock,
  decodeWavPcm,
  frameCountFor,
  isDecodableFormat,
} from '../src/wav/pcm.js'

/**
 * WAV sample decoding (Wave 2B, anchor 2B-3).
 *
 * The expectations here are computed from the format definition, never from this decoder: the
 * linear cases carry the exact integers that were written, and the IMA ADPCM cases carry predictor
 * values worked out from the published step and index tables by hand. A decoder that agreed with
 * itself but not with the format would fail these.
 */

interface Format {
  readonly encoding: string
  readonly channels: number
  readonly sampleRate: number
  readonly blockAlign: number
  readonly bitsPerSample: number
}

const pcm16 = (channels: number): Format => ({
  encoding: 'pcm',
  channels,
  sampleRate: 44_100,
  blockAlign: 2 * channels,
  bitsPerSample: 16,
})

function int16Data(samples: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return bytes
}

describe('WAV linear PCM', () => {
  it('returns exactly the 16-bit samples that were written, scaled to [-1, 1)', async () => {
    const data = int16Data([0, 32_767, -32_768, 16_384])
    const channels = decodeWavPcm(data, pcm16(1), 0, 4)
    expect(channels).toHaveLength(1)
    expect([...(channels[0] as Float32Array)]).toEqual([0, 32_767 / 32_768, -1, 0.5])
  })

  it('deinterleaves stereo frames instead of concatenating channels', async () => {
    const data = int16Data([100, -100, 200, -200, 300, -300])
    const channels = decodeWavPcm(data, pcm16(2), 0, 3)
    expect([...(channels[0] as Float32Array)].map(value => Math.round(value * 32_768))).toEqual([
      100, 200, 300,
    ])
    expect([...(channels[1] as Float32Array)].map(value => Math.round(value * 32_768))).toEqual([
      -100, -200, -300,
    ])
  })

  it('reads a window from the middle and clamps a window past the end', async () => {
    const data = int16Data([1, 2, 3, 4, 5])
    expect(
      [...(decodeWavPcm(data, pcm16(1), 2, 2)[0] as Float32Array)].map(value =>
        Math.round(value * 32_768),
      ),
    ).toEqual([3, 4])
    expect(decodeWavPcm(data, pcm16(1), 4, 10)[0]).toHaveLength(1)
    expect(decodeWavPcm(data, pcm16(1), 9, 10)[0]).toHaveLength(0)
  })

  it('names the formats it cannot decode instead of returning silence', async () => {
    expect(isDecodableFormat({ ...pcm16(1), encoding: 'a-law', bitsPerSample: 8 })).toBe(false)
    expect(() =>
      decodeWavPcm(int16Data([1]), { ...pcm16(1), encoding: 'mu-law', bitsPerSample: 8 }, 0, 1),
    ).toThrow(/mu-law at 8 bits has no decoder/u)
  })
})

/**
 * One mono IMA ADPCM block: 4 header bytes (int16 predictor, uint8 index, uint8 pad) then nibble
 * words. `blockAlign` 8 leaves one 4-byte word, i.e. 8 nibbles, i.e. 8 frames after the preamble.
 */
function imaBlock(predictor: number, index: number, nibbleBytes: readonly number[]): Uint8Array {
  const block = new Uint8Array(4 + nibbleBytes.length)
  const view = new DataView(block.buffer)
  view.setInt16(0, predictor, true)
  view.setUint8(2, index)
  view.setUint8(3, 0)
  nibbleBytes.forEach((byte, at) => view.setUint8(4 + at, byte))
  return block
}

const imaFormat = (channels: number, blockAlign: number): Format => ({
  encoding: 'ima-adpcm',
  channels,
  sampleRate: 44_100,
  blockAlign,
  bitsPerSample: 4,
})

describe('WAV IMA ADPCM', () => {
  it('counts frames as one preamble plus two nibbles per byte per channel', async () => {
    expect(adpcmFramesPerBlock(8, 1)).toBe(9)
    expect(adpcmFramesPerBlock(512, 2)).toBe(505)
    expect(frameCountFor(imaFormat(2, 512), 512 * 3)).toBe(1515)
  })

  it('emits the block preamble as the first frame', async () => {
    const data = imaBlock(1000, 0, [0, 0, 0, 0])
    const channels = decodeWavPcm(data, imaFormat(1, 8), 0, 9)
    expect(Math.round((channels[0]?.[0] as number) * 32_768)).toBe(1000)
  })

  /*
   * Hand-computed from the published tables. Starting at index 0 the step is 7.
   *  nibble 4  -> difference = (7>>3) + 7 = 7, sign bit clear  -> predictor 1000 + 7 = 1007,
   *               index += INDEX_TABLE[4] = 2 -> step 9
   *  nibble 12 -> difference = (9>>3) + 9 = 10, sign bit set   -> predictor 1007 - 10 = 997
   * The low nibble of a byte is the earlier sample, so byte 0xC4 yields 1007 then 997.
   */
  it('takes the low nibble of each byte first, then the high nibble', async () => {
    const data = imaBlock(1000, 0, [0xc4, 0, 0, 0])
    const channels = decodeWavPcm(data, imaFormat(1, 8), 0, 3)
    expect([...(channels[0] as Float32Array)].map(value => Math.round(value * 32_768))).toEqual([
      1000, 1007, 997,
    ])
  })

  it('keeps each channel on its own predictor across the interleaved words', async () => {
    // blockAlign 16 = two 4-byte headers plus one 4-byte word per channel.
    const block = new Uint8Array(16)
    const view = new DataView(block.buffer)
    view.setInt16(0, 1000, true)
    view.setUint8(2, 0)
    view.setInt16(4, -1000, true)
    view.setUint8(6, 0)
    view.setUint8(8, 0xc4) // channel 0 word
    view.setUint8(12, 0xc4) // channel 1 word
    const channels = decodeWavPcm(block, imaFormat(2, 16), 0, 3)
    expect([...(channels[0] as Float32Array)].map(value => Math.round(value * 32_768))).toEqual([
      1000, 1007, 997,
    ])
    expect([...(channels[1] as Float32Array)].map(value => Math.round(value * 32_768))).toEqual([
      -1000, -993, -1003,
    ])
  })

  it('decodes a window that starts inside a later block by replaying that block', async () => {
    const data = new Uint8Array(16)
    data.set(imaBlock(1000, 0, [0, 0, 0, 0]), 0)
    data.set(imaBlock(-2000, 0, [0xc4, 0, 0, 0]), 8)
    const channels = decodeWavPcm(data, imaFormat(1, 8), 9, 3)
    expect([...(channels[0] as Float32Array)].map(value => Math.round(value * 32_768))).toEqual([
      -2000, -1993, -2003,
    ])
  })

  it('decodes a short last block: its preamble and the whole words it holds', async () => {
    // A full 12-byte block (17 frames), then a 9-byte tail: header, one word, one stray byte.
    const data = new Uint8Array(21)
    data.set(imaBlock(1000, 0, new Array(8).fill(0)), 0)
    data.set(imaBlock(-2000, 0, [0xc4, 0, 0, 0, 0x77]), 12)
    expect(frameCountFor(imaFormat(1, 12), data.byteLength)).toBe(17 + 9)
    const channels = decodeWavPcm(data, imaFormat(1, 12), 17, 100)
    const frames = [...(channels[0] as Float32Array)].map(value => Math.round(value * 32_768))
    // Nine frames — the stray byte is not a word — opening as the hand-computed case above.
    expect(frames).toHaveLength(9)
    expect(frames.slice(0, 3)).toEqual([-2000, -1993, -2003])
  })
})

/**
 * The audio media source over the capability RPC (Wave 2B, anchor 2B-3).
 *
 * JSON has no `undefined`. A viewer asking for "no particular track" in-process passes `undefined`;
 * the same call arrives as `null` once the codec runs worker-brokered, which is how every installed
 * VS Code editor runs it. That difference used to make the default request refuse itself.
 */
describe('audio media source track selection', () => {
  const source = () =>
    createAudioMediaSource(new Uint8Array([1, 2, 3, 4]), 'audio/wav', {
      durationMs: 10,
      seekable: true,
      tracks: [{ id: 'stream-0', codec: 'pcm', channels: 1, sampleRate: 8_000, selected: true }],
      pcmAccess: false,
    })

  it('treats null like undefined: both mean "no particular track"', async () => {
    await expect(source().encoded(undefined)).resolves.toBeDefined()
    await expect(source().encoded(null as unknown as undefined)).resolves.toBeDefined()
  })

  it('still refuses a track id that does not exist', async () => {
    await expect(source().encoded('stream-9')).rejects.toThrow(/unknown audio track stream-9/u)
  })

  it('refuses to declare pcmAccess without a reader', async () => {
    expect(() =>
      createAudioMediaSource(new Uint8Array([1]), 'audio/wav', {
        durationMs: 1,
        seekable: true,
        tracks: [{ id: 'stream-0', codec: 'pcm', channels: 1, sampleRate: 8_000, selected: true }],
        pcmAccess: true,
      }),
    ).toThrow(/pcmAccess without a readPcm/u)
  })
})
