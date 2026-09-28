import { describe, expect, it } from 'vitest'
import type { AudioMediaSource } from '@modkit/sdk'
import { encodeWav } from '../src/audio/index.js'
import { CONVERT_TO_WAV, pcmAudio, type PcmStream } from '../src/audio/pcm-audio.js'

const stream = (samples: readonly number[], channels = 1): PcmStream => ({
  channels,
  sampleRate: 8000,
  samples: samples.length / channels,
  decode: () => Int16Array.from(samples),
})
const wavOf = (samples: readonly number[], channels = 1) =>
  encodeWav(
    { channels, sampleRate: 8000, bitsPerSample: 16 },
    new Uint8Array(Int16Array.from(samples).buffer),
  )

async function played(source: unknown) {
  const encoded = await (source as AudioMediaSource).encoded()
  const descriptor = await encoded.descriptor()
  return {
    mediaType: descriptor.mediaType,
    bytes: await encoded.read(0n, Number(descriptor.bytes)),
  }
}

describe('pcmAudio', () => {
  it('plays and converts a decoded stream as one 16-bit WAV', async () => {
    const audio = await pcmAudio(stream([1, -1, 2, -2]), undefined, 1 << 20)
    expect(audio).toMatchObject({ durationMs: 1, refusal: undefined, operationStates: [] })
    expect(await played(audio.dataSources['common.view/audio-media-source'])).toEqual({
      mediaType: 'audio/wav',
      bytes: wavOf([1, -1, 2, -2]),
    })
    expect(await audio.handlers['convert-audio']({ target: 'wav' })).toEqual({
      kind: 'bytes',
      value: wavOf([1, -1, 2, -2]),
    })
    await expect(audio.handlers['convert-audio']({ target: 'mp3' })).rejects.toThrow(
      /target: 'wav'/u,
    )
    expect(CONVERT_TO_WAV).toMatchObject({ id: 'export.convert', handlerId: 'convert-audio' })
  })

  it('converts the stream `pick` names, and refuses one it does not', async () => {
    const second = stream([7, 8], 2)
    const audio = await pcmAudio(stream([1]), undefined, 1 << 20, {
      pick: async input => (input['stream'] === 1 ? second : undefined),
    })
    expect(await audio.handlers['convert-audio']({ target: 'wav', stream: 1 })).toEqual({
      kind: 'bytes',
      value: wavOf([7, 8], 2),
    })
    await expect(audio.handlers['convert-audio']({ target: 'wav', stream: 2 })).rejects.toThrow(
      /no stream matches/u,
    )
  })

  it('describes but neither decodes nor plays a sound past the budget, and says why', async () => {
    let decoded = false
    const big: PcmStream = {
      ...stream([0, 0, 0, 0]),
      decode: () => ((decoded = true), new Int16Array(4)),
    }
    const audio = await pcmAudio(big, undefined, 44 + 7)
    expect(decoded).toBe(false)
    expect(audio.dataSources).toEqual({})
    expect(audio.operationStates).toEqual([
      { id: 'export.convert', state: 'disabled', reason: expect.stringMatching(/maxScalarBytes/u) },
    ])
    const none = await pcmAudio(undefined, 'codec 0x0f is not decoded', 1 << 20)
    expect(none.refusal).toBe('codec 0x0f is not decoded')
    await expect(none.handlers['convert-audio']({ target: 'wav' })).rejects.toThrow(/0x0f/u)
  })
})
