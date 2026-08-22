import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/aac'
const SAMPLE_RATES = Object.freeze([
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025,
  8_000, 7_350,
])
const PROFILES = Object.freeze(['Main', 'LC', 'SSR', 'LTP'])

// ISO/IEC 13818-7 ADTS fixed/variable headers. Each frame carries its own length and may use
// either the 7-byte header or the 9-byte form with CRC. Raw AAC spectral decoding is out of scope.
function frameAt(bytes, offset) {
  if (offset + 7 > bytes.byteLength) throw new RangeError('AAC ADTS frame header is truncated')
  const b0 = bytes[offset]
  const b1 = bytes[offset + 1]
  const b2 = bytes[offset + 2]
  const b3 = bytes[offset + 3]
  const b4 = bytes[offset + 4]
  const b5 = bytes[offset + 5]
  const b6 = bytes[offset + 6]
  if (b0 !== 0xff || (b1 & 0xf6) !== 0xf0)
    throw new TypeError('AAC ADTS syncword/layer is invalid')
  const mpegVersion = (b1 & 0x08) === 0 ? 4 : 2
  const protectionAbsent = (b1 & 1) !== 0
  const profileIndex = (b2 >>> 6) & 3
  const frequencyIndex = (b2 >>> 2) & 0x0f
  const sampleRate = SAMPLE_RATES[frequencyIndex]
  const channels = ((b2 & 1) << 2) | (b3 >>> 6)
  const frameLength = ((b3 & 3) << 11) | (b4 << 3) | (b5 >>> 5)
  const headerBytes = protectionAbsent ? 7 : 9
  const rawDataBlocks = (b6 & 3) + 1
  if (sampleRate === undefined || channels === 0 || frameLength < headerBytes)
    throw new TypeError('AAC ADTS profile/rate/channel/length is invalid')
  if (offset + frameLength > bytes.byteLength)
    throw new RangeError('AAC ADTS frame payload is truncated')
  return Object.freeze({
    offset,
    mpegVersion,
    protectionAbsent,
    profileIndex,
    profile: PROFILES[profileIndex],
    sampleRate,
    channels,
    frameLength,
    headerBytes,
    rawDataBlocks,
    samples: rawDataBlocks * 1024,
  })
}

function parseAdts(bytes, budget, maximumFrames = budget.maxNodes) {
  if (budget.maxDepth < 2) throw new RangeError('AAC ADTS exceeds maxDepth budget')
  const frames = []
  let offset = 0
  while (offset < bytes.byteLength) {
    if (frames.length >= maximumFrames || frames.length >= budget.maxNodes)
      throw new RangeError('AAC ADTS frames exceed maxNodes budget')
    const frame = frameAt(bytes, offset)
    const first = frames[0]
    if (
      first !== undefined &&
      (frame.sampleRate !== first.sampleRate ||
        frame.channels !== first.channels ||
        frame.profileIndex !== first.profileIndex)
    )
      throw new TypeError('AAC ADTS stream changes profile, sample rate, or channel layout')
    frames.push(frame)
    offset += frame.frameLength
  }
  if (frames.length === 0) throw new TypeError('AAC ADTS stream has no frames')
  if (frames.length * 48 > budget.maxScalarBytes)
    throw new RangeError('AAC ADTS metadata exceeds maxScalarBytes budget')
  const samples = frames.reduce((sum, frame) => sum + frame.samples, 0)
  return Object.freeze({
    frames: Object.freeze(frames),
    first: frames[0],
    samples,
    durationMs: Math.round((samples / frames[0].sampleRate) * 1000),
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'aac', label: 'AAC (ADTS)', mediaType: 'audio/aac' }),
  async detect(prefix) {
    try {
      const frame = frameAt(prefix, 0)
      return {
        confidence: 0.99,
        kind: 'structure',
        note: `ADTS MPEG-${frame.mpegVersion} ${frame.profile}`,
      }
    } catch {
      return { confidence: 0, kind: 'structure', note: 'ADTS header mismatch' }
    }
  },
  async inspect(bytes, context) {
    const parsed = parseAdts(bytes, context.budget)
    const first = parsed.first
    const audio = createAudioMediaSource(bytes, 'audio/aac', {
      durationMs: parsed.durationMs,
      seekable: false,
      tracks: [
        {
          id: 'aac-0',
          codec: `aac-${first.profile.toLowerCase()}`,
          channels: first.channels,
          sampleRate: first.sampleRate,
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'audio',
      label: 'AAC/ADTS',
      preview: `${first.sampleRate} Hz, ${first.channels} channel(s), ${parsed.frames.length} frame(s)`,
      children: parsed.frames.map((frame, index) => ({
        kind: 'frame',
        label: `ADTS frame ${index}`,
        preview: `${frame.frameLength} bytes, ${frame.rawDataBlocks} raw block(s) at ${frame.offset}`,
      })),
    })
    return {
      summary: {
        format: 'aac',
        container: 'adts',
        mpegVersion: first.mpegVersion,
        profile: first.profile,
        sampleRate: first.sampleRate,
        channels: first.channels,
        frames: parsed.frames.length,
        samples: parsed.samples,
        durationMs: parsed.durationMs,
      },
      metadata: [
        {
          id: 'aac-adts',
          label: 'AAC ADTS stream',
          entries: [
            { key: 'mpegVersion', value: first.mpegVersion },
            { key: 'profile', value: first.profile },
            { key: 'sampleRate', value: first.sampleRate },
            { key: 'channels', value: first.channels },
            { key: 'frames', value: parsed.frames.length },
            { key: 'samples', value: parsed.samples },
          ],
        },
      ],
      traits: [
        { id: 'audio.streams', parameters: { count: 1, codec: 'aac' } },
        { id: 'media.duration', parameters: { milliseconds: parsed.durationMs } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: ['pcm-decoding', 'seeking-and-frame-indexing', 'id3-metadata', 'writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
