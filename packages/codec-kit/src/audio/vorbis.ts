/**
 * Ogg Vorbis from Vorbis packets a game stored without Ogg: Wwise and FMOD FSB5 keep the audio
 * packets and a setup header (their own or one the encoder is known to write) but drop the
 * identification and comment headers and the Ogg framing. This rebuilds those headers, reads the
 * long-window flag of each mode from a standard setup header, and writes the Ogg stream with each
 * packet's granule position as revorb computes it — no audio is decoded or re-encoded.
 */
import { encodeOgg, type OggPacket } from './index.js'

export interface VorbisStreamInfo {
  readonly channels: number
  readonly sampleRate: number
  /** log2 of the short and long block sizes (8 and 11 for FMOD's 256 and 2048). */
  readonly blocksizes: readonly [number, number]
  /** Bits per second the stream states; 0 (unset) where omitted. */
  readonly nominalBitrate?: number
}

const signature = (type: number) => [type, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]

/** The 30-byte identification header (type 1). */
export function vorbisIdentificationHeader(info: VorbisStreamInfo): Uint8Array {
  const [small, large] = info.blocksizes
  if (!Number.isInteger(info.channels) || info.channels < 1 || info.channels > 255) {
    throw new RangeError('Vorbis channels must be 1..255')
  }
  if (!(small >= 6 && small <= large && large <= 13)) {
    throw new RangeError('Vorbis block sizes must be 2^6..2^13, short not above long')
  }
  const bytes = new Uint8Array(30)
  const view = new DataView(bytes.buffer)
  bytes.set(signature(1))
  view.setUint32(7, 0, true)
  bytes[11] = info.channels
  view.setUint32(12, info.sampleRate, true)
  view.setUint32(20, (info.nominalBitrate ?? 0) >>> 0, true)
  bytes[28] = small | (large << 4)
  bytes[29] = 1
  return bytes
}

/** A comment header (type 3) naming `vendor`, with no comments. */
export function vorbisCommentHeader(vendor: string): Uint8Array {
  const name = new TextEncoder().encode(vendor)
  const bytes = new Uint8Array(7 + 4 + name.byteLength + 4 + 1)
  const view = new DataView(bytes.buffer)
  bytes.set(signature(3))
  view.setUint32(7, name.byteLength, true)
  bytes.set(name, 11)
  bytes[bytes.byteLength - 1] = 1
  return bytes
}

/**
 * The long-window flag of each mode of a standard setup header (type 5). The modes close the
 * header: a 6-bit count less one, then per mode a block flag, two 16-bit zeros (window and
 * transform type) and an 8-bit mapping, then the framing bit. Codebooks, floors and residues need
 * not be decoded: the modes are read backwards from the framing bit, as ffmpeg's Vorbis parser does,
 * and the count they end on must be the count the header states.
 */
export function vorbisModeBlockflags(setup: Uint8Array): boolean[] {
  if (setup[0] !== 5) throw new TypeError('not a Vorbis setup header')
  const bit = (index: number) => ((setup[index >> 3] ?? 0) >> (index & 7)) & 1
  const read = (index: number, width: number) => {
    let value = 0
    for (let offset = 0; offset < width; offset += 1) value |= bit(index + offset) << offset
    return value >>> 0
  }
  let last = setup.byteLength - 1
  while (last > 0 && setup[last] === 0) last -= 1
  const top = setup[last] ?? 0
  if (top === 0) throw new TypeError('Vorbis setup header has no framing bit')
  const framing = last * 8 + (31 - Math.clz32(top))
  // How many modes could end at the framing bit, then the largest count its field confirms.
  let candidates = 0
  for (let count = 1; count <= 64; count += 1) {
    const start = framing - 41 * count
    if (start < 7 * 8 || read(start + 1, 16) !== 0 || read(start + 17, 16) !== 0) break
    if (read(start + 33, 8) > 63) break
    candidates = count
  }
  for (let count = candidates; count >= 1; count -= 1) {
    const start = framing - 41 * count
    if (start - 6 >= 7 * 8 && read(start - 6, 6) === count - 1) {
      return Array.from({ length: count }, (_, mode) => bit(start + 41 * mode) === 1)
    }
  }
  throw new TypeError('Vorbis setup header modes could not be read')
}

export interface VorbisOggOptions {
  readonly info: VorbisStreamInfo
  readonly vendor: string
  /** A standard setup header (type 5). */
  readonly setup: Uint8Array
  /** Standard audio packets, in order. */
  readonly packets: Iterable<Uint8Array>
  /** Each mode's long-window flag; read from `setup` when omitted. */
  readonly blockflags?: readonly boolean[]
  /** Samples the stream holds: the last granule is cut to it, so a decoder ends where the game does. */
  readonly sampleCount?: number
  readonly serial?: number
}

/**
 * One Ogg Vorbis stream: the three headers, then each audio packet with its granule — each packet
 * after the first adds a quarter of the two windows it overlaps (revorb).
 */
export function vorbisPacketsToOgg(options: VorbisOggOptions): Uint8Array {
  const blockflags = options.blockflags ?? vorbisModeBlockflags(options.setup)
  if (blockflags.length === 0) throw new TypeError('Vorbis setup header has no modes')
  const modeBits = 32 - Math.clz32(blockflags.length - 1)
  const modeMask = (1 << modeBits) - 1
  const [small, large] = options.info.blocksizes
  const packets: OggPacket[] = [
    { bytes: vorbisIdentificationHeader(options.info), granule: 0n, flush: true },
    { bytes: vorbisCommentHeader(options.vendor), granule: 0n },
    { bytes: options.setup, granule: 0n, flush: true },
  ]
  let previousSize = 0
  let granule = 0n
  for (const packet of options.packets) {
    const first = packet[0] ?? 0
    if ((first & 1) !== 0) throw new TypeError('a Vorbis audio packet starts with a zero bit')
    const mode = (first >> 1) & modeMask
    const flag = blockflags[mode]
    if (flag === undefined) throw new RangeError(`Vorbis packet names mode ${mode}`)
    const size = 1 << (flag ? large : small)
    if (previousSize > 0) granule += BigInt((previousSize + size) / 4)
    previousSize = size
    packets.push({ bytes: packet, granule })
  }
  if (packets.length === 3) throw new TypeError('the Vorbis stream holds no audio packets')
  const lastIndex = packets.length - 1
  const lastPacket = packets[lastIndex]
  if (
    lastPacket !== undefined &&
    options.sampleCount !== undefined &&
    BigInt(options.sampleCount) < lastPacket.granule
  ) {
    packets[lastIndex] = { ...lastPacket, granule: BigInt(options.sampleCount) }
  }
  return encodeOgg(packets, options.serial ?? 1)
}
