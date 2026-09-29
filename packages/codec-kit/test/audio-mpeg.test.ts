import { describe, expect, it } from 'vitest'
import { mpegAudioFrame } from '../src/audio/mpeg.js'

const header = (...bytes: number[]) => Uint8Array.of(...bytes)

describe('mpegAudioFrame', () => {
  it('reads version, layer, rate, channels and the frame length of each layer', () => {
    // MPEG-1 layer III, 128 kbps, 44.1 kHz: 144000 * 128 / 44100 = 417.96 -> 417, 418 padded.
    expect(mpegAudioFrame(header(0xff, 0xfb, 0x90, 0x00), 0)).toEqual({
      version: 1,
      layer: 3,
      bitrateKbps: 128,
      sampleRate: 44_100,
      channels: 2,
      samples: 1152,
      bytes: 417,
    })
    expect(mpegAudioFrame(header(0xff, 0xfb, 0x92, 0xc0), 0)).toMatchObject({
      channels: 1,
      bytes: 418,
    })
    // MPEG-2 layer III, 64 kbps, 22.05 kHz: 72000 * 64 / 22050 = 208.98 -> 208, 576 samples.
    expect(mpegAudioFrame(header(0xff, 0xf3, 0x80, 0x00), 0)).toMatchObject({
      version: 2,
      layer: 3,
      sampleRate: 22_050,
      samples: 576,
      bytes: 208,
    })
    // MPEG-2.5 layer III, 8 kbps, 8 kHz: 72000 * 8 / 8000 = 72.
    expect(mpegAudioFrame(header(0xff, 0xe3, 0x18, 0x00), 0)).toMatchObject({
      version: 2.5,
      sampleRate: 8_000,
      bytes: 72,
    })
    // MPEG-1 layer II, 192 kbps, 48 kHz: 144000 * 192 / 48000 = 576.
    expect(mpegAudioFrame(header(0xff, 0xfd, 0xa4, 0x00), 0)).toMatchObject({
      layer: 2,
      bitrateKbps: 192,
      samples: 1152,
      bytes: 576,
    })
    // MPEG-1 layer I, 384 kbps, 44.1 kHz: (12000 * 384 / 44100 = 104.49 -> 104) * 4 = 416.
    expect(mpegAudioFrame(header(0xff, 0xff, 0xc0, 0x00), 0)).toMatchObject({
      layer: 1,
      samples: 384,
      bytes: 416,
    })
  })

  it('reads at an offset and refuses what is not a frame it can measure', () => {
    expect(mpegAudioFrame(header(0x00, 0xff, 0xfb, 0x90, 0x00), 1)).toMatchObject({ bytes: 417 })
    expect(mpegAudioFrame(header(0xff, 0xfb, 0x90), 0)).toBeUndefined() // truncated
    expect(mpegAudioFrame(header(0xff, 0x7b, 0x90, 0x00), 0)).toBeUndefined() // no sync
    expect(mpegAudioFrame(header(0xff, 0xeb, 0x90, 0x00), 0)).toBeUndefined() // reserved version
    expect(mpegAudioFrame(header(0xff, 0xf9, 0x90, 0x00), 0)).toBeUndefined() // reserved layer
    expect(mpegAudioFrame(header(0xff, 0xfb, 0x00, 0x00), 0)).toBeUndefined() // free format
    expect(mpegAudioFrame(header(0xff, 0xfb, 0xf0, 0x00), 0)).toBeUndefined() // bad bitrate
    expect(mpegAudioFrame(header(0xff, 0xfb, 0x9c, 0x00), 0)).toBeUndefined() // reserved rate
  })
})
