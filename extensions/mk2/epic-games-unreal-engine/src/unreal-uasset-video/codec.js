import { createInspectionCodec, createVideoMediaSource } from '@modkitx-x3/codec-kit'
import {
  exportBytes,
  exportOf,
  packageClassProbe,
  packageTree,
  parseUnrealPackage,
} from '../unreal-uasset/codec.js'

const ID = 'org.modkitx/unreal-uasset-video'

function ascii(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.byteLength) return ''
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function findChunk(bytes, start, end, id) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = start; offset + 8 <= end; offset += 1) {
    if (ascii(bytes, offset, 4) !== id) continue
    const size = view.getUint32(offset + 4, true)
    if (offset + 8 + size > end) throw new RangeError(`Unreal media AVI ${id} chunk is truncated`)
    return Object.freeze({ offset, size, payload: offset + 8 })
  }
  return undefined
}

function embeddedAvi(bytes, budget) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset + 12 <= bytes.byteLength; offset += 1) {
    if (ascii(bytes, offset, 4) !== 'RIFF' || ascii(bytes, offset + 8, 4) !== 'AVI ') continue
    const end = offset + 8 + view.getUint32(offset + 4, true)
    if (end > bytes.byteLength || end < offset + 12)
      throw new RangeError('Unreal media embedded AVI is truncated')
    const main = findChunk(bytes, offset + 12, end, 'avih')
    const stream = findChunk(bytes, offset + 12, end, 'strh')
    if (main === undefined || main.size < 56 || stream === undefined || stream.size < 56)
      throw new TypeError('Unreal media AVI lacks required avih/strh records')
    if (budget.maxNodes < 10) throw new RangeError('Unreal media AVI exceeds maxNodes budget')
    const microsecondsPerFrame = view.getUint32(main.payload, true)
    const totalFrames = view.getUint32(main.payload + 16, true)
    const streamCount = view.getUint32(main.payload + 24, true)
    const width = view.getUint32(main.payload + 32, true)
    const height = view.getUint32(main.payload + 36, true)
    const streamKind = ascii(bytes, stream.payload, 4)
    const codec = ascii(bytes, stream.payload + 4, 4).trim() || 'unknown'
    const scale = view.getUint32(stream.payload + 20, true)
    const rate = view.getUint32(stream.payload + 24, true)
    if (
      streamKind !== 'vids' ||
      microsecondsPerFrame < 1 ||
      totalFrames < 1 ||
      streamCount < 1 ||
      width < 1 ||
      height < 1 ||
      scale < 1 ||
      rate < 1
    )
      throw new TypeError('Unreal media AVI main/video stream metadata is invalid')
    return Object.freeze({
      bytes: bytes.slice(offset, end),
      width,
      height,
      totalFrames,
      streamCount,
      codec,
      fps: rate / scale,
      durationMs: Math.round((microsecondsPerFrame * totalFrames) / 1000),
    })
  }
  throw new TypeError('Unreal media export has no embedded RIFF/AVI payload')
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'unreal-uasset-video', label: 'Unreal Engine Media Asset' }),
  async detect(prefix) {
    return packageClassProbe(prefix, ['BinkMediaPlayer', 'FileMediaSource'])
  },
  async inspect(bytes, context) {
    const packageModel = parseUnrealPackage(bytes, context.budget)
    const exportEntry = exportOf(packageModel, ['BinkMediaPlayer', 'FileMediaSource'])
    const avi = embeddedAvi(exportBytes(bytes, exportEntry), context.budget)
    const video = createVideoMediaSource(avi.bytes, 'video/x-msvideo', {
      durationMs: avi.durationMs,
      seekable: false,
      tracks: [
        {
          id: 'track-0',
          kind: 'video',
          codec: avi.codec,
          width: avi.width,
          height: avi.height,
          selected: true,
        },
      ],
      frameAccess: false,
    })
    const tree = packageTree(packageModel, exportEntry, [
      {
        kind: 'movie',
        label: 'Embedded RIFF/AVI',
        preview: `${avi.width} × ${avi.height}, ${avi.totalFrames} frame(s), ${avi.codec}`,
      },
    ])
    return {
      summary: {
        format: 'unreal-uasset-video',
        engine: `UE4/${packageModel.summary.ue4FileVersion}`,
        exportClass: exportEntry.className,
        exportName: exportEntry.objectName,
        embeddedFormat: 'avi',
        codec: avi.codec,
        width: avi.width,
        height: avi.height,
        fps: avi.fps,
        frames: avi.totalFrames,
        durationMs: avi.durationMs,
      },
      metadata: [
        {
          id: 'unreal-media-asset',
          label: 'Unreal media asset',
          entries: [
            { key: 'folder', value: packageModel.summary.folderName },
            { key: 'export', value: exportEntry.objectName },
            { key: 'embeddedFormat', value: 'RIFF/AVI' },
            { key: 'codec', value: avi.codec },
            { key: 'width', value: avi.width },
            { key: 'height', value: avi.height },
            { key: 'frames', value: avi.totalFrames },
          ],
        },
      ],
      traits: [
        {
          id: 'video.streams',
          parameters: { count: 1, codec: avi.codec, width: avi.width, height: avi.height },
        },
        { id: 'media.duration', parameters: { milliseconds: avi.durationMs } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      maxDecodedBytes: avi.bytes.byteLength,
      unsupportedFeatures: [
        'external-file-media-source-resolution',
        'bink-webm-mp4-wmv-flv-mpeg-and-smacker-payloads',
        'frame-decoding-remuxing-and-transcoding',
        'uexp-and-ubulk-sidecars',
        'ue5-and-unversioned-properties',
        'package-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
