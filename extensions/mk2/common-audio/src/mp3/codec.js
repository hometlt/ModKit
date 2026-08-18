// Hand-ported from the MK2 codec org.modkitx/mp3 (OPUS-MK2-01 task C pilot).
//
// The v1 manifest routed on the extension alone, so the port earns its confidence from the
// stream instead: skip an ID3v2 tag if present, then validate an MPEG audio frame header. PCM
// decoding stays out (the v1 limitation says the same); the audio source publishes stream
// metadata and the encoded bytes.

import {
  createAudioMediaSource,
  createInspectionCodec,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/mp3'
const ascii = new TextDecoder('latin1')

const BITRATES_V1_L3 = Object.freeze([
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
])
const BITRATES_V2_L3 = Object.freeze([
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
])
const SAMPLE_RATES = Object.freeze({
  3: Object.freeze([44100, 48000, 32000, 0]), // MPEG 1
  2: Object.freeze([22050, 24000, 16000, 0]), // MPEG 2
  0: Object.freeze([11025, 12000, 8000, 0]), // MPEG 2.5
})
const CHANNEL_MODES = Object.freeze(['stereo', 'joint-stereo', 'dual-channel', 'mono'])

/** ID3v2 header: 'ID3', two version bytes, flags, then a 28-bit syncsafe size. */
function id3Length(bytes) {
  if (bytes.byteLength < 10 || ascii.decode(bytes.subarray(0, 3)) !== 'ID3') return 0
  const size =
    ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0)
  const footer = ((bytes[5] ?? 0) & 0x10) === 0 ? 0 : 10
  return 10 + size + footer
}

function frameAt(bytes, offset) {
  if (offset + 4 > bytes.byteLength) return undefined
  const b0 = bytes[offset] ?? 0
  const b1 = bytes[offset + 1] ?? 0
  const b2 = bytes[offset + 2] ?? 0
  const b3 = bytes[offset + 3] ?? 0
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return undefined
  const versionBits = (b1 >>> 3) & 0x03
  const layerBits = (b1 >>> 1) & 0x03
  if (versionBits === 1 || layerBits === 0) return undefined // reserved
  const sampleRates = SAMPLE_RATES[versionBits]
  if (sampleRates === undefined) return undefined
  const sampleRate = sampleRates[(b2 >>> 2) & 0x03] ?? 0
  const table = versionBits === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3
  const bitrateKbps = table[(b2 >>> 4) & 0x0f] ?? 0
  if (sampleRate === 0 || bitrateKbps === 0) return undefined
  const padding = (b2 >>> 1) & 0x01
  const channelMode = CHANNEL_MODES[(b3 >>> 6) & 0x03] ?? 'stereo'
  const samplesPerFrame = versionBits === 3 ? 1152 : 576
  const frameBytes =
    Math.floor((samplesPerFrame / 8) * ((bitrateKbps * 1000) / sampleRate)) + padding
  return Object.freeze({
    offset,
    version: versionBits === 3 ? 'mpeg-1' : versionBits === 2 ? 'mpeg-2' : 'mpeg-2.5',
    layer: 4 - layerBits,
    sampleRate,
    bitrateKbps,
    channelMode,
    channels: channelMode === 'mono' ? 1 : 2,
    samplesPerFrame,
    frameBytes,
  })
}

/** First frame within the declared window; `window` bounds the sync scan to the probe budget. */
function findFrame(bytes, window) {
  const start = id3Length(bytes)
  const limit = Math.min(bytes.byteLength - 4, start + window)
  for (let offset = start; offset <= limit; offset += 1) {
    const frame = frameAt(bytes, offset)
    if (frame !== undefined) return { frame, id3Bytes: start }
  }
  return undefined
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'mp3', label: 'MP3', mediaType: 'audio/mpeg' }),
  async detect(prefix) {
    const found = findFrame(prefix, 2048)
    if (found === undefined) return { confidence: 0, kind: 'structure', note: 'no-mpeg-frame-sync' }
    // A frame at the very start (or right after ID3) is decisive; a later sync could be noise.
    const immediate = found.frame.offset === found.id3Bytes
    return {
      confidence: immediate ? 0.95 : 0.7,
      kind: 'structure',
      note: `${found.frame.version}-layer-${found.frame.layer}`,
    }
  },
  async inspect(bytes, context) {
    const found = findFrame(bytes, 65536)
    if (found === undefined) throw new TypeError('MP3 carries no valid MPEG audio frame')
    const first = found.frame
    // Frame count without decoding: walk the declared frame lengths, bounded by maxNodes.
    let frames = 0
    let offset = first.offset
    let variable = false
    while (offset + 4 <= bytes.byteLength && frames < context.budget.maxNodes) {
      const frame = frameAt(bytes, offset)
      if (frame === undefined) break
      if (frame.bitrateKbps !== first.bitrateKbps) variable = true
      frames += 1
      offset += frame.frameBytes
    }
    const audioBytes = bytes.byteLength - first.offset
    const durationMs =
      frames > 0
        ? Math.round((frames * first.samplesPerFrame * 1000) / first.sampleRate)
        : 'unknown'
    const audio = createAudioMediaSource(bytes.subarray(first.offset), 'audio/mpeg', {
      durationMs,
      seekable: !variable,
      tracks: [
        {
          id: 'stream-0',
          codec: 'mp3',
          channels: first.channels,
          sampleRate: first.sampleRate,
          bitrateKbps: first.bitrateKbps,
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'audio',
      label: 'MP3',
      preview: `${first.sampleRate} Hz, ${first.channelMode}, ${first.bitrateKbps} kbps`,
      children: [
        {
          kind: 'header',
          label: 'first frame',
          preview: `${first.version} layer ${first.layer} at byte ${first.offset}`,
        },
        {
          kind: 'frames',
          label: 'frames',
          preview: `${frames}${variable ? ' (variable rate)' : ''}`,
        },
        ...(found.id3Bytes > 0
          ? [{ kind: 'tag', label: 'ID3v2', preview: `${found.id3Bytes} bytes` }]
          : []),
      ],
    })
    return {
      summary: {
        format: 'mp3',
        version: first.version,
        layer: first.layer,
        sampleRate: first.sampleRate,
        channels: first.channels,
        bitrateKbps: first.bitrateKbps,
        variableBitrate: variable,
        frames,
        durationMs,
      },
      metadata: [
        {
          id: 'mpeg-audio',
          label: 'MPEG audio',
          entries: [
            { key: 'version', value: first.version },
            { key: 'layer', value: first.layer },
            { key: 'sampleRate', value: first.sampleRate },
            { key: 'channelMode', value: first.channelMode },
            { key: 'bitrateKbps', value: first.bitrateKbps },
            { key: 'variableBitrate', value: variable },
            { key: 'frames', value: frames },
            { key: 'id3Bytes', value: found.id3Bytes },
            { key: 'audioBytes', value: audioBytes },
          ],
        },
      ],
      traits: [
        { id: 'audio.streams', parameters: { count: 1, codec: 'mp3' } },
        ...(durationMs === 'unknown'
          ? []
          : [{ id: 'media.duration', parameters: { milliseconds: durationMs } }]),
        { id: 'media.seekable', parameters: { constantBitrate: !variable } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/audio-media-source': audio,
      },
      unsupportedFeatures: ['pcm-decoding', 'id3-frame-parsing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
