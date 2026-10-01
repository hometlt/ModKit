import type { AudioMediaSource, AudioPcmRequest } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { AUDIO_MAXIMUM_PCM_FRAMES, audioTrackLine, collectCodecPcm } from '../src/audio/index.js'

/** A mono codec PCM source of `frames` silent frames that answers exactly what is asked. */
function silence(frames: number): AudioMediaSource {
  const samples = new Float32Array(1 << 18)
  return {
    info: async () => ({ durationMs: 'unknown', seekable: true, tracks: [], pcmAccess: true }),
    encoded: async () => {
      throw new TypeError('not used')
    },
    readPcm: async (request: AudioPcmRequest) => {
      const count = Math.max(0, Math.min(request.frameCount, frames - Number(request.fromFrame)))
      return {
        sampleRate: 48_000,
        fromFrame: request.fromFrame,
        frameCount: count,
        channelCount: 1,
        samples: samples.subarray(0, count),
      }
    },
  }
}

describe('audio tracks', () => {
  it('names each track by number, codec, layout, bitrate and language, leaving out the unknown', () => {
    expect(
      audioTrackLine(
        {
          id: 's1',
          codec: 'vorbis',
          channels: 2,
          sampleRate: 44_100,
          bitrateKbps: 96,
          language: 'ru',
          selected: false,
        },
        1,
      ),
    ).toBe('#2 · vorbis · 2 ch · 44.1 kHz · 96 kbps · ru')
    expect(
      audioTrackLine(
        { id: 's0', codec: 'fadpcm', channels: 'unknown', sampleRate: 'unknown', selected: true },
        0,
      ),
    ).toBe('#1 · fadpcm')
  })

  it('says when a track is longer than the player keeps, and not when it ends first', async () => {
    const short = await collectCodecPcm(silence(1000), 'main')
    expect(short.truncated).toBe(false)
    expect(short.channels[0]?.length).toBe(1000)
    const long = await collectCodecPcm(silence(AUDIO_MAXIMUM_PCM_FRAMES + 48_000), 'main')
    expect(long.truncated).toBe(true)
    expect(long.channels[0]?.length).toBe(AUDIO_MAXIMUM_PCM_FRAMES)
  })
})
