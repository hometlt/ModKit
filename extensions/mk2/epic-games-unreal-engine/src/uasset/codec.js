import { createAudioMediaSource, createInspectionCodec } from '@modkitx-x3/codec-kit'
import {
  exportBytes,
  exportOf,
  packageClassProbe,
  packageTree,
  parseUnrealPackage,
} from '../unreal-uasset/codec.js'

const ID = 'org.modkitx/uasset'

function ascii(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.byteLength) return ''
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function embeddedWave(bytes, budget) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset + 12 <= bytes.byteLength; offset += 1) {
    if (ascii(bytes, offset, 4) !== 'RIFF' || ascii(bytes, offset + 8, 4) !== 'WAVE') continue
    const end = offset + 8 + view.getUint32(offset + 4, true)
    if (end > bytes.byteLength || end < offset + 12)
      throw new RangeError('Unreal SoundWave embedded RIFF is truncated')
    let cursor = offset + 12
    let format
    let dataBytes = 0
    let chunkCount = 0
    while (cursor < end) {
      if (cursor + 8 > end) throw new RangeError('Unreal SoundWave RIFF chunk is truncated')
      const id = ascii(bytes, cursor, 4)
      const size = view.getUint32(cursor + 4, true)
      const payload = cursor + 8
      if (payload + size > end) throw new RangeError('Unreal SoundWave RIFF payload is truncated')
      chunkCount += 1
      if (chunkCount + 8 > budget.maxNodes)
        throw new RangeError('Unreal SoundWave chunks exceed maxNodes budget')
      if (id === 'fmt ') {
        if (size < 16) throw new TypeError('Unreal SoundWave fmt chunk is too short')
        format = Object.freeze({
          encodingTag: view.getUint16(payload, true),
          channels: view.getUint16(payload + 2, true),
          sampleRate: view.getUint32(payload + 4, true),
          byteRate: view.getUint32(payload + 8, true),
          blockAlign: view.getUint16(payload + 12, true),
          bitsPerSample: view.getUint16(payload + 14, true),
        })
      } else if (id === 'data') dataBytes += size
      cursor = payload + size + (size & 1)
    }
    if (
      format === undefined ||
      format.encodingTag !== 1 ||
      format.channels < 1 ||
      format.sampleRate < 1 ||
      format.byteRate < 1 ||
      format.blockAlign < 1 ||
      dataBytes === 0
    )
      throw new TypeError('Unreal SoundWave carries no supported PCM WAVE stream')
    return Object.freeze({
      bytes: bytes.slice(offset, end),
      format,
      dataBytes,
      chunks: chunkCount,
      durationMs: Math.round((dataBytes / format.byteRate) * 1000),
    })
  }
  throw new TypeError('Unreal SoundWave export has no embedded RIFF/WAVE payload')
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'uasset', label: 'Unreal Engine SoundWave' }),
  async detect(prefix) {
    return packageClassProbe(prefix, ['SoundWave'])
  },
  async inspect(bytes, context) {
    const packageModel = parseUnrealPackage(bytes, context.budget)
    const exportEntry = exportOf(packageModel, ['SoundWave'])
    const wave = embeddedWave(exportBytes(bytes, exportEntry), context.budget)
    const audio = createAudioMediaSource(wave.bytes, 'audio/wav', {
      durationMs: wave.durationMs,
      seekable: true,
      tracks: [
        {
          id: 'stream-0',
          codec: 'pcm',
          channels: wave.format.channels,
          sampleRate: wave.format.sampleRate,
          bitrateKbps: Math.round((wave.format.byteRate * 8) / 1000),
          selected: true,
        },
      ],
      pcmAccess: false,
    })
    const tree = packageTree(packageModel, exportEntry, [
      {
        kind: 'audio',
        label: 'Embedded RIFF/WAVE',
        preview: `${wave.format.sampleRate} Hz, ${wave.format.channels} channel(s), ${wave.dataBytes} PCM bytes`,
      },
    ])
    return {
      summary: {
        format: 'uasset',
        engine: `UE4/${packageModel.summary.ue4FileVersion}`,
        exportClass: exportEntry.className,
        exportName: exportEntry.objectName,
        embeddedFormat: 'wav',
        channels: wave.format.channels,
        sampleRate: wave.format.sampleRate,
        bitsPerSample: wave.format.bitsPerSample,
        durationMs: wave.durationMs,
      },
      metadata: [
        {
          id: 'unreal-sound-wave',
          label: 'Unreal SoundWave',
          entries: [
            { key: 'folder', value: packageModel.summary.folderName },
            { key: 'export', value: exportEntry.objectName },
            { key: 'embeddedFormat', value: 'RIFF/WAVE PCM' },
            { key: 'channels', value: wave.format.channels },
            { key: 'sampleRate', value: wave.format.sampleRate },
            { key: 'bitsPerSample', value: wave.format.bitsPerSample },
          ],
        },
      ],
      traits: [
        {
          id: 'audio.streams',
          parameters: { count: 1, codec: 'pcm', channels: wave.format.channels },
        },
        { id: 'media.duration', parameters: { milliseconds: wave.durationMs } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/audio-media-source': audio,
      },
      maxDecodedBytes: wave.bytes.byteLength,
      unsupportedFeatures: [
        'wem-ogg-opus-flac-mp3-aac-and-m4a-payloads',
        'streamed-soundwave-chunk-reconstruction',
        'uexp-and-ubulk-sidecars',
        'ue5-and-unversioned-properties',
        'package-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
