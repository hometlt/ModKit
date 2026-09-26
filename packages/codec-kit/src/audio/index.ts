/**
 * Writers for the standard audio files a browser plays natively, shared by every game codec that
 * turns its own stream into one (Wwise WEM, Emperor BAG, ...). Narrow on purpose: no decoder and no
 * compression code, so importing it costs a codec nothing.
 */
import { createCrc32Msb } from '../checksum/index.js'

/** Linear integer PCM, the only shape `encodeWav` writes (format tag 1). */
export interface PcmFormat {
  readonly channels: number
  readonly sampleRate: number
  /** 8 (unsigned) or 16/24/32 (signed, little-endian) bits per sample. */
  readonly bitsPerSample: number
}

const HEADER_BYTES = 44
const PCM_BITS = [8, 16, 24, 32]

/**
 * A canonical RIFF/WAVE file: a 16-byte `fmt ` (tag 1) and `data` holding `samples` unchanged —
 * interleaved little-endian frames, as a WAVE stores them. The result is one fresh buffer (worker
 * RPC refuses views that do not own theirs), padded to even size as RIFF requires.
 */
export function encodeWav(format: PcmFormat, samples: Uint8Array): Uint8Array {
  const { channels, sampleRate, bitsPerSample } = format
  if (!Number.isInteger(channels) || channels < 1 || channels > 0xffff) {
    throw new RangeError('WAV channels must be 1..65535')
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff) {
    throw new RangeError('WAV sample rate must be a positive 32-bit integer')
  }
  if (!PCM_BITS.includes(bitsPerSample)) throw new RangeError('WAV PCM is 8, 16, 24 or 32 bits')
  const blockAlign = channels * (bitsPerSample / 8)
  if (blockAlign > 0xffff) throw new RangeError('WAV frame exceeds 65535 bytes')
  if (samples.byteLength % blockAlign !== 0) {
    throw new RangeError(`WAV data is not a whole number of ${blockAlign}-byte frames`)
  }
  const byteRate = sampleRate * blockAlign
  if (byteRate > 0xffffffff) throw new RangeError('WAV byte rate exceeds 32 bits')
  const pad = samples.byteLength & 1
  const riffSize = HEADER_BYTES - 8 + samples.byteLength + pad
  if (riffSize > 0xffffffff) throw new RangeError('WAV data exceeds the 4 GiB RIFF limit')

  const bytes = new Uint8Array(HEADER_BYTES + samples.byteLength + pad)
  const view = new DataView(bytes.buffer)
  const tag = (offset: number, text: string) => {
    for (let index = 0; index < 4; index += 1) bytes[offset + index] = text.charCodeAt(index)
  }
  tag(0, 'RIFF')
  view.setUint32(4, riffSize, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  tag(36, 'data')
  view.setUint32(40, samples.byteLength, true)
  bytes.set(samples, HEADER_BYTES)
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
