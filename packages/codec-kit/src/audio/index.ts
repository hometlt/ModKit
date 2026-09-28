/**
 * Writers for the standard audio files a browser plays natively, and decoders of game ADPCMs no
 * browser plays, shared by every game codec that turns its own stream into one (Wwise WEM, Emperor
 * BAG, FMOD FSB5, ...). Narrow on purpose: no compression or WASM, so importing it costs a codec
 * nothing.
 */
import type { ByteRangeSource } from '@modkit/sdk'
import { createCrc32Msb } from '../checksum/index.js'

export {
  decodeEaXa,
  decodeEaXas,
  EA_XA_FRAME_SAMPLES,
  EA_XAS_FRAME_BYTES,
  EA_XAS_FRAME_SAMPLES,
  type EaXaRevision,
} from './ea-xa.js'
export { decodeFadpcm, fadpcmFrames } from './fadpcm.js'
export { decodeXaAdpcm, XA_SOUND_GROUP_BYTES, XA_SOUND_GROUP_SAMPLES } from './xa-adpcm.js'

/**
 * The 89 quantiser step sizes of IMA ADPCM (IMA Digital Audio Focus, 1992), shared by every ADPCM
 * that inherits them — Microsoft IMA in WAV, Blizzard's Storm ADPCM in MPQ — though their codes differ.
 */
export const IMA_STEP_TABLE: readonly number[] = Object.freeze([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10_442,
  11_487, 12_635, 13_899, 15_289, 16_818, 18_500, 20_350, 22_385, 24_623, 27_086, 29_794, 32_767,
])

/** Linear integer PCM (format tag 1). */
export interface PcmFormat {
  readonly channels: number
  readonly sampleRate: number
  /** 8 (unsigned) or 16/24/32 (signed, little-endian) bits per sample. */
  readonly bitsPerSample: number
}

/** Microsoft IMA ADPCM (format tag 0x11): blocks of `blockAlign` bytes, 4 bits per sample. */
export interface ImaAdpcmFormat {
  readonly channels: number
  readonly sampleRate: number
  readonly blockAlign: number
}

export type WavFormat =
  ({ readonly encoding: 'pcm' } & PcmFormat) | ({ readonly encoding: 'ima-adpcm' } & ImaAdpcmFormat)

const PCM_BITS = [8, 16, 24, 32]

function checkShape(channels: number, sampleRate: number): void {
  if (!Number.isInteger(channels) || channels < 1 || channels > 0xffff) {
    throw new RangeError('WAV channels must be 1..65535')
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff) {
    throw new RangeError('WAV sample rate must be a positive 32-bit integer')
  }
}

/** The `fmt ` body, the `fact` sample count (non-PCM only) and the frame size data comes in. */
function formatChunk(format: WavFormat, dataBytes: number) {
  checkShape(format.channels, format.sampleRate)
  const { channels, sampleRate } = format
  if (format.encoding === 'pcm') {
    if (!PCM_BITS.includes(format.bitsPerSample)) {
      throw new RangeError('WAV PCM is 8, 16, 24 or 32 bits')
    }
    const blockAlign = channels * (format.bitsPerSample / 8)
    if (blockAlign > 0xffff) throw new RangeError('WAV frame exceeds 65535 bytes')
    if (dataBytes % blockAlign !== 0) {
      throw new RangeError(`WAV data is not a whole number of ${blockAlign}-byte frames`)
    }
    if (sampleRate * blockAlign > 0xffffffff) throw new RangeError('WAV byte rate exceeds 32 bits')
    const fmt = new DataView(new ArrayBuffer(16))
    fmt.setUint16(0, 1, true)
    fmt.setUint16(2, channels, true)
    fmt.setUint32(4, sampleRate, true)
    fmt.setUint32(8, sampleRate * blockAlign, true)
    fmt.setUint16(12, blockAlign, true)
    fmt.setUint16(14, format.bitsPerSample, true)
    return { fmt: new Uint8Array(fmt.buffer), fact: undefined }
  }
  // Each channel opens a block with 4 header bytes; the nibbles follow in 4-byte words per channel.
  const { blockAlign } = format
  const header = 4 * channels
  if (
    !Number.isInteger(blockAlign) ||
    blockAlign <= header ||
    blockAlign > 0xffff ||
    (blockAlign - header) % header !== 0
  ) {
    throw new RangeError(
      `IMA ADPCM block of ${blockAlign} bytes does not fit ${channels} channel(s)`,
    )
  }
  const samplesPerBlock = 1 + ((blockAlign - header) * 2) / channels
  // A short last block holds its header sample and the whole words it has.
  const tail = dataBytes % blockAlign
  const tailSamples = tail < header ? 0 : 1 + Math.floor((tail - header) / header) * 8
  const fmt = new DataView(new ArrayBuffer(20))
  fmt.setUint16(0, 0x11, true)
  fmt.setUint16(2, channels, true)
  fmt.setUint32(4, sampleRate, true)
  fmt.setUint32(8, Math.round((sampleRate * blockAlign) / samplesPerBlock), true)
  fmt.setUint16(12, blockAlign, true)
  fmt.setUint16(14, 4, true)
  fmt.setUint16(16, 2, true)
  fmt.setUint16(18, samplesPerBlock, true)
  return {
    fmt: new Uint8Array(fmt.buffer),
    fact: Math.floor(dataBytes / blockAlign) * samplesPerBlock + tailSamples,
  }
}

/**
 * The RIFF/WAVE header for `dataBytes` of `format` data: `fmt `, a `fact` sample count for IMA
 * ADPCM, and the `data` chunk header. The data follows it unchanged, then a zero pad byte when
 * `dataBytes` is odd, so a container can present a headerless game stream as a WAV without copying
 * the stream.
 */
export function wavHeader(format: WavFormat, dataBytes: number): Uint8Array {
  if (!Number.isSafeInteger(dataBytes) || dataBytes < 0) {
    throw new RangeError('WAV data size must be a non-negative integer')
  }
  const { fmt, fact } = formatChunk(format, dataBytes)
  const size = 12 + 8 + fmt.byteLength + (fact === undefined ? 0 : 12) + 8
  const riffSize = size - 8 + dataBytes + (dataBytes & 1)
  if (riffSize > 0xffffffff) throw new RangeError('WAV data exceeds the 4 GiB RIFF limit')
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  let at = 0
  const chunk = (id: string, length: number) => {
    for (let index = 0; index < 4; index += 1) bytes[at + index] = id.charCodeAt(index)
    view.setUint32(at + 4, length, true)
    at += 8
  }
  chunk('RIFF', riffSize)
  bytes.set([0x57, 0x41, 0x56, 0x45], at) // WAVE
  at += 4
  chunk('fmt ', fmt.byteLength)
  bytes.set(fmt, at)
  at += fmt.byteLength
  if (fact !== undefined) {
    chunk('fact', 4)
    view.setUint32(at, fact, true)
    at += 4
  }
  chunk('data', dataBytes)
  return bytes
}

/**
 * A container entry holding a headerless stream (PCM, IMA ADPCM) as a WAV, without copying the
 * stream: `wavHeader` for `format` and `length`, then the `length` bytes `read` returns from
 * `offset` of the container, then the RIFF pad byte when `length` is odd. A container codec returns
 * it from the entry's custom `open` and gives the entry `mediaType: 'audio/wav'`. `read` gets any
 * window of the stream and must return all of it.
 */
export function wavEntrySource(
  read: (offset: number, length: number, signal?: AbortSignal) => Promise<Uint8Array>,
  format: WavFormat,
  offset: number,
  length: number,
): ByteRangeSource {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('WAV entry offset must be a non-negative integer')
  }
  const header = wavHeader(format, length)
  const streamEnd = header.byteLength + length
  const total = streamEnd + (length & 1)
  return Object.freeze({
    size: async () => BigInt(total),
    async read(start: bigint, count: number, signal?: AbortSignal) {
      const from = Number(start)
      if (
        !Number.isSafeInteger(from) ||
        from < 0 ||
        from > total ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) {
        throw new RangeError('WAV entry range is outside the entry')
      }
      const end = Math.min(total, from + count)
      const out = new Uint8Array(end - from)
      let cursor = from
      if (cursor < header.byteLength) {
        const take = Math.min(header.byteLength, end) - cursor
        out.set(header.subarray(cursor, cursor + take))
        cursor += take
      }
      if (cursor < Math.min(streamEnd, end)) {
        const take = Math.min(streamEnd, end) - cursor
        const bytes = await read(offset + cursor - header.byteLength, take, signal)
        if (bytes.byteLength !== take) throw new RangeError('WAV entry stream read is truncated')
        out.set(bytes, cursor - from)
      }
      // The pad byte, when the window reaches it, is already zero.
      return out
    },
  })
}

/**
 * A canonical PCM RIFF/WAVE file: a 16-byte `fmt ` (tag 1) and `data` holding `samples` unchanged —
 * interleaved little-endian frames, as a WAVE stores them. The result is one fresh buffer (worker
 * RPC refuses views that do not own theirs), padded to even size as RIFF requires.
 */
export function encodeWav(format: PcmFormat, samples: Uint8Array): Uint8Array {
  const header = wavHeader({ ...format, encoding: 'pcm' }, samples.byteLength)
  const bytes = new Uint8Array(header.byteLength + samples.byteLength + (samples.byteLength & 1))
  bytes.set(header)
  bytes.set(samples, header.byteLength)
  return bytes
}

/** One packet of a logical Ogg stream. */
export interface OggPacket {
  readonly bytes: Uint8Array
  /** Granule position once this packet is decoded (for Vorbis, samples so far); -1n for none. */
  readonly granule: bigint
  /** End the page after this packet, as Vorbis does after its identification header. */
  readonly flush?: boolean
}

const PAGE_HEADER_BYTES = 27
const MAX_SEGMENTS = 255
/** A page is closed once its body reaches this, as libogg does. */
const PAGE_BODY_TARGET = 4096

/**
 * One logical Ogg stream (RFC 3533): packets laced into pages of about 4 KiB, a page's granule
 * that of the last packet ending on it (-1 when none does), BOS on the first page, EOS on the last,
 * and the page CRC (polynomial 0x04C11DB7, init 0, no final XOR).
 */
export function encodeOgg(packets: readonly OggPacket[], serial: number): Uint8Array {
  if (packets.length === 0) throw new RangeError('an Ogg stream needs at least one packet')
  if (!Number.isInteger(serial) || serial < 0 || serial > 0xffffffff) {
    throw new RangeError('Ogg serial must be a 32-bit unsigned integer')
  }
  const pages: Uint8Array[] = []
  let lacing: number[] = []
  let body: Uint8Array[] = []
  let bodyBytes = 0
  let granule = -1n
  let continued = false

  const emit = (last: boolean) => {
    const page = new Uint8Array(PAGE_HEADER_BYTES + lacing.length + bodyBytes)
    const view = new DataView(page.buffer)
    page.set([0x4f, 0x67, 0x67, 0x53], 0)
    page[5] = (continued ? 1 : 0) | (pages.length === 0 ? 2 : 0) | (last ? 4 : 0)
    view.setBigUint64(6, BigInt.asUintN(64, granule), true)
    view.setUint32(14, serial, true)
    view.setUint32(18, pages.length, true)
    page[26] = lacing.length
    page.set(lacing, PAGE_HEADER_BYTES)
    let at = PAGE_HEADER_BYTES + lacing.length
    for (const part of body) {
      page.set(part, at)
      at += part.byteLength
    }
    const crc = createCrc32Msb({ init: 0, xorOut: 0 })
    for (const byte of page) crc.update(byte)
    view.setUint32(22, crc.digest(), true)
    pages.push(page)
    lacing = []
    body = []
    bodyBytes = 0
    granule = -1n
  }

  packets.forEach((packet, index) => {
    const last = index === packets.length - 1
    // A packet is 255-byte segments and one shorter final segment, 0 when the length divides.
    let offset = 0
    for (;;) {
      if (lacing.length === MAX_SEGMENTS) {
        emit(false)
        // The next page continues this packet only if part of it is already out.
        continued = offset > 0
      }
      const segment = Math.min(255, packet.bytes.byteLength - offset)
      lacing.push(segment)
      body.push(packet.bytes.subarray(offset, offset + segment))
      bodyBytes += segment
      offset += segment
      if (segment < 255) break
    }
    granule = packet.granule
    if (last || packet.flush === true || bodyBytes >= PAGE_BODY_TARGET) {
      emit(last)
      continued = false
    }
  })

  const out = new Uint8Array(pages.reduce((total, page) => total + page.byteLength, 0))
  let at = 0
  for (const page of pages) {
    out.set(page, at)
    at += page.byteLength
  }
  return out
}
