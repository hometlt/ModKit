// Hand-ported from the MK2 codec org.modkitx/swf (OPUS-MK2-01 task C pilot; signatures added in
// OPUS-MK2-02 task E).
//
// The v1 manifest was detector-first: its only match rule was a path glob matching every file,
// which MK3 does not accept as a wildcard. The contribution now declares the three SWF
// signatures instead (cited in the extension README), so the host shortlists this codec from the
// bytes alone — a file called `ipistol.swf` opened by its bare name still reaches this probe.
// That makes a strict header check the whole job: a known signature, a plausible version, and a
// declared length that agrees with the file. Anything less is a 0.
//
// Fidelity matches the v1 limitation exactly: signature, version, compression mode and declared
// length. The stage rect and frame rate live behind the compression for CWS/ZWS, and this port
// does not inflate — those stay `unknown` instead of being guessed.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVideoMediaSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/swf'
const ascii = new TextDecoder('latin1')

const COMPRESSION = Object.freeze({ FWS: 'none', CWS: 'zlib', ZWS: 'lzma' })

function u32le(bytes, offset) {
  if (offset + 4 > bytes.byteLength) throw new RangeError('truncated SWF u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function headerOf(bytes) {
  if (bytes.byteLength < 8) return undefined
  const signature = ascii.decode(bytes.subarray(0, 3))
  const compression = COMPRESSION[signature]
  if (compression === undefined) return undefined
  const version = bytes[3] ?? 0
  if (version === 0 || version > 64) return undefined // no released SWF is outside this range
  return Object.freeze({ signature, compression, version, declaredBytes: u32le(bytes, 4) })
}

/** Uncompressed SWF only: the stage rect is a bit-packed RECT right after the 8-byte header. */
function stageOf(bytes) {
  if (bytes.byteLength < 13) return undefined
  const bitsPerValue = (bytes[8] ?? 0) >>> 3
  if (bitsPerValue === 0 || bitsPerValue > 31) return undefined
  const totalBits = 5 + bitsPerValue * 4
  const rectBytes = Math.ceil(totalBits / 8)
  if (8 + rectBytes + 4 > bytes.byteLength) return undefined
  let cursor = 5
  const read = () => {
    let value = 0
    for (let index = 0; index < bitsPerValue; index += 1) {
      const bit = ((bytes[8 + ((cursor / 8) | 0)] ?? 0) >>> (7 - (cursor % 8))) & 1
      value = value * 2 + bit
      cursor += 1
    }
    return value
  }
  read() // xMin, always 0 in practice but the field is there
  const xMax = read()
  read() // yMin
  const yMax = read()
  const rateOffset = 8 + rectBytes
  // frame rate is 8.8 fixed point, little endian: fraction byte first
  const frameRate = (bytes[rateOffset + 1] ?? 0) + (bytes[rateOffset] ?? 0) / 256
  const frameCount = (bytes[rateOffset + 2] ?? 0) | ((bytes[rateOffset + 3] ?? 0) << 8)
  return Object.freeze({
    width: Math.round(xMax / 20), // twips → pixels
    height: Math.round(yMax / 20),
    frameRate,
    frameCount,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'swf',
    label: 'Shockwave Flash',
    mediaType: 'application/x-shockwave-flash',
  }),
  async detect(prefix) {
    const header = headerOf(prefix)
    if (header === undefined)
      return { confidence: 0, kind: 'magic', note: 'swf-signature-mismatch' }
    // The declared length is the cheapest structural cross-check available inside the probe
    // window; a file that fits inside its own header is the only thing that can be wrong here.
    const plausible = header.declaredBytes >= 9
    return {
      confidence: plausible ? 0.97 : 0.2,
      kind: 'magic',
      note: `swf-${header.signature.toLowerCase()}-v${header.version}`,
    }
  },
  async inspect(bytes) {
    const header = headerOf(bytes)
    if (header === undefined) throw new TypeError('SWF signature is invalid')
    const stage = header.compression === 'none' ? stageOf(bytes) : undefined
    const durationMs =
      stage === undefined || stage.frameRate <= 0
        ? 'unknown'
        : Math.round((stage.frameCount / stage.frameRate) * 1000)
    const video = createVideoMediaSource(bytes, 'application/x-shockwave-flash', {
      durationMs,
      seekable: false,
      tracks: [
        {
          id: 'stage',
          kind: 'video',
          codec: `swf-${header.version}`,
          selected: true,
          ...(stage === undefined ? {} : { width: stage.width, height: stage.height }),
          ...(stage === undefined ? {} : { frameRate: stage.frameRate }),
        },
      ],
      frameAccess: false,
    })
    const tree = createTreeDataSource({
      kind: 'movie',
      label: 'SWF',
      preview: `${header.signature} v${header.version}, ${header.compression} compression`,
      children: [
        { kind: 'header', label: 'signature', preview: header.signature },
        { kind: 'header', label: 'version', preview: String(header.version) },
        { kind: 'header', label: 'compression', preview: header.compression },
        { kind: 'header', label: 'declared bytes', preview: String(header.declaredBytes) },
        ...(stage === undefined
          ? [{ kind: 'stage', label: 'stage', preview: 'behind compression' }]
          : [
              { kind: 'stage', label: 'stage', preview: `${stage.width} × ${stage.height}` },
              { kind: 'stage', label: 'frames', preview: String(stage.frameCount) },
            ]),
      ],
    })
    return {
      summary: {
        format: 'swf',
        signature: header.signature,
        version: header.version,
        compression: header.compression,
        declaredBytes: header.declaredBytes,
        actualBytes: bytes.byteLength,
        width: stage?.width ?? null,
        height: stage?.height ?? null,
        frameCount: stage?.frameCount ?? null,
      },
      metadata: [
        {
          id: 'swf-header',
          label: 'SWF header',
          entries: [
            { key: 'signature', value: header.signature },
            { key: 'version', value: header.version },
            { key: 'compression', value: header.compression },
            { key: 'declaredBytes', value: header.declaredBytes },
            { key: 'actualBytes', value: bytes.byteLength },
            {
              key: 'stage',
              value: stage === undefined ? 'compressed' : `${stage.width}x${stage.height}`,
            },
            { key: 'frameRate', value: stage?.frameRate ?? 0 },
            { key: 'frameCount', value: stage?.frameCount ?? 0 },
          ],
        },
      ],
      traits: [
        { id: 'video.streams', parameters: { count: 1, codec: `swf-${header.version}` } },
        ...(durationMs === 'unknown'
          ? []
          : [{ id: 'media.duration', parameters: { milliseconds: durationMs } }]),
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/video-media-source': video,
      },
      unsupportedFeatures: [
        'tag-stream-parsing',
        'zlib-inflate',
        'lzma-inflate',
        'actionscript-execution',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
