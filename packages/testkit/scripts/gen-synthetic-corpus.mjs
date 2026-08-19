#!/usr/bin/env node
// Synthetic MK2 acceptance corpus (OPUS-MK2-02 task F; REPORT_MK2_CONVERSION §9.7).
//
// The MK2 checkout carries samples for six families and nothing else: no `.wav`, `.bmp`, `.tar`,
// `.flv`, `.ogg`, `.mp4`, `.webm` … anywhere. That is a hard ceiling on acceptance — a ported
// codec with no file to open cannot be shown to work. Root's decision (§9.7) opens a second
// axis: files derived from the *specification*, generated here, byte for byte deterministic.
//
// The rules this generator holds itself to:
//
//   * nothing is copied. Every byte below is written from the format specification named in the
//     comment above the builder, so the fixture is a reading of the spec, not someone's file.
//   * every fixture is minimal and valid: the smallest structure the spec allows, with real
//     checksums (CRC-32, Ogg CRC, adler-32, tar checksum) computed, never faked.
//   * synthetic fixtures prove *structural* opening — probe, descriptor, one data source. They
//     do not prove fidelity against real-world encoders, and the report says so.
//
// Output is byte-stable: no timestamps, no randomness, no host state. `--check` regenerates in
// memory and compares, which is how `pnpm check` keeps the committed fixtures honest.
//
// Usage: node packages/testkit/scripts/gen-synthetic-corpus.mjs [--out <dir>] [--check] [--quiet]

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outRoot = resolve(argValue('--out') ?? join(packageRoot, 'test', 'fixtures', 'mk2-synthetic'))
const checkOnly = args.includes('--check')
const quiet = args.includes('--quiet')

// ---------------------------------------------------------------- byte helpers

const bytes = (...values) => Uint8Array.from(values.flat())
const ascii = text => Uint8Array.from([...text].map(character => character.charCodeAt(0) & 0xff))

const u16le = value => bytes(value & 0xff, (value >>> 8) & 0xff)
const u32le = value =>
  bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
const u16be = value => bytes((value >>> 8) & 0xff, value & 0xff)
const u24be = value => bytes((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
const u32be = value =>
  bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)

function concat(...parts) {
  const flat = parts.flat()
  const total = flat.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of flat) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/** ITU-T V.42 / ISO 3309 CRC-32, reflected, init 0xffffffff — PNG §5.5 and RFC 1952 §8. */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** RFC 3533 §6: Ogg uses a *non*-reflected CRC-32 with init 0 and no final inversion. */
const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index << 24
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x80000000) !== 0 ? ((value << 1) ^ 0x04c11db7) >>> 0 : (value << 1) >>> 0
    }
    table[index] = value >>> 0
  }
  return table
})()

function oggCrc(data) {
  let crc = 0
  for (const byte of data) {
    crc = ((crc << 8) ^ (OGG_CRC_TABLE[((crc >>> 24) & 0xff) ^ byte] ?? 0)) >>> 0
  }
  return crc >>> 0
}

/** RFC 1950 §9. */
function adler32(data) {
  let a = 1
  let b = 0
  for (const byte of data) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

/** RFC 1951 §3.2.4 — one final stored (uncompressed) block; no encoder, no tables. */
function deflateStored(payload) {
  return concat(
    bytes(0x01),
    u16le(payload.byteLength),
    u16le(~payload.byteLength & 0xffff),
    payload,
  )
}

/** Bit writer for the packed bit fields MPEG-1 and GIF LZW need. */
function bitWriter() {
  const out = []
  let current = 0
  let filled = 0
  return {
    /** Most-significant-bit first, the order every MPEG-1 syntax element uses. */
    push(value, width) {
      for (let bit = width - 1; bit >= 0; bit -= 1) {
        current = (current << 1) | ((value >>> bit) & 1)
        filled += 1
        if (filled === 8) {
          out.push(current & 0xff)
          current = 0
          filled = 0
        }
      }
    },
    finish(padBit = 0) {
      while (filled !== 0) this.push(padBit, 1)
      return Uint8Array.from(out)
    },
  }
}

// ---------------------------------------------------------------- format builders

/**
 * RIFF/WAVE: "Multimedia Programming Interface and Data Specifications 1.0" §RIFF WAVE,
 * chunks `fmt ` (WAVEFORMAT, wFormatTag 1 = PCM) and `data`. Four unsigned 8-bit samples.
 */
function wav() {
  const format = concat(
    ascii('fmt '),
    u32le(16),
    u16le(1), // wFormatTag: WAVE_FORMAT_PCM
    u16le(1), // nChannels
    u32le(8000), // nSamplesPerSec
    u32le(8000), // nAvgBytesPerSec = rate * blockAlign
    u16le(1), // nBlockAlign = channels * bits / 8
    u16le(8), // wBitsPerSample
  )
  // 8-bit PCM is unsigned with 0x80 as silence (same spec, "Data Format of the Samples")
  const data = concat(ascii('data'), u32le(4), bytes(0x80, 0xa0, 0x60, 0x80))
  const body = concat(ascii('WAVE'), format, data)
  return concat(ascii('RIFF'), u32le(body.byteLength), body)
}

/**
 * BMP: Windows BITMAPFILEHEADER + BITMAPINFOHEADER (biSize 40), 1×1 pixel, 24 bits, bottom-up,
 * rows padded to a 4-byte boundary. Fields per the Win32 structure documentation.
 */
function bmp() {
  const info = concat(
    u32le(40), // biSize
    u32le(1), // biWidth
    u32le(1), // biHeight (positive: bottom-up)
    u16le(1), // biPlanes
    u16le(24), // biBitCount
    u32le(0), // biCompression: BI_RGB
    u32le(4), // biSizeImage (one padded row)
    u32le(2835), // biXPelsPerMeter (72 dpi)
    u32le(2835), // biYPelsPerMeter
    u32le(0), // biClrUsed
    u32le(0), // biClrImportant
  )
  const pixels = bytes(0x20, 0x40, 0x80, 0x00) // one BGR pixel + row padding
  const offBits = 14 + info.byteLength
  const header = concat(
    ascii('BM'),
    u32le(offBits + pixels.byteLength),
    u16le(0),
    u16le(0),
    u32le(offBits),
  )
  return concat(header, info, pixels)
}

/**
 * GIF89a: "Graphics Interchange Format Version 89a" §17-§22 — header, Logical Screen Descriptor
 * with a 2-entry Global Color Table, Image Descriptor, one LZW data sub-block, trailer.
 * The image data is the shortest legal code stream: Clear, one pixel index, End Of Information.
 */
function gif() {
  const screen = concat(
    u16le(1), // logical screen width
    u16le(1), // logical screen height
    bytes(0xf0), // GCT present, colour resolution 8, GCT size field 0 → 2 entries
    bytes(0x00), // background colour index
    bytes(0x00), // pixel aspect ratio: none given
  )
  const globalColorTable = bytes(0x00, 0x00, 0x00, 0xff, 0xff, 0xff)
  const imageDescriptor = concat(
    bytes(0x2c), // Image Separator
    u16le(0),
    u16le(0),
    u16le(1),
    u16le(1),
    bytes(0x00), // no local colour table, not interlaced
  )
  // §22: codes are packed least-significant-bit first and start one bit wider than the minimum
  // code size. With minimum size 2 the codes are 3 bits: Clear = 4, EOI = 5.
  const codes = (4 | (0 << 3) | (5 << 6)) >>> 0
  const lzw = concat(
    bytes(0x02), // LZW minimum code size (2 is the floor even for two colours)
    bytes(0x02, codes & 0xff, (codes >>> 8) & 0xff), // one data sub-block of two bytes
    bytes(0x00), // block terminator
  )
  return concat(ascii('GIF89a'), screen, globalColorTable, imageDescriptor, lzw, bytes(0x3b))
}

/**
 * POSIX ustar archive: IEEE 1003.1 §pax "ustar Interchange Format" — one 512-byte header block
 * with the octal header checksum, one data block, and the two zero blocks that end an archive.
 */
function tar() {
  const content = ascii('hello\n')
  const header = new Uint8Array(512)
  const put = (offset, value) => header.set(ascii(value), offset)
  const octal = (value, width) => value.toString(8).padStart(width - 1, '0') + '\0'
  put(0, 'hello.txt') // name
  put(100, octal(0o644, 8)) // mode
  put(108, octal(0, 8)) // uid
  put(116, octal(0, 8)) // gid
  put(124, octal(content.byteLength, 12)) // size
  put(136, octal(0, 12)) // mtime: zero keeps the fixture byte-stable
  put(148, '        ') // checksum field is spaces while the checksum is computed
  put(156, '0') // typeflag: regular file
  put(257, 'ustar\0')
  put(263, '00')
  put(265, 'root') // uname
  put(297, 'root') // gname
  let checksum = 0
  for (const byte of header) checksum += byte
  header.set(ascii(checksum.toString(8).padStart(6, '0') + '\0 '), 148)
  const data = new Uint8Array(512)
  data.set(content, 0)
  return concat(header, data, new Uint8Array(1024))
}

/** gzip: RFC 1952 §2.3 header (deflate, no extra fields) wrapping one RFC 1951 stored block. */
function gz() {
  const payload = ascii('hello')
  return concat(
    bytes(0x1f, 0x8b, 0x08, 0x00), // ID1 ID2 CM=deflate FLG=0
    u32le(0), // MTIME: zero means "no time available", and keeps this byte-stable
    bytes(0x00, 0x03), // XFL, OS = Unix
    deflateStored(payload),
    u32le(crc32(payload)),
    u32le(payload.byteLength),
  )
}

/**
 * PNG: ISO/IEC 15948 §5 (signature, chunk layout, CRC) and §11.2 (IHDR, IDAT, IEND). 1×1 truecolour,
 * one scanline with filter type 0, stored in an uncompressed zlib stream so no encoder is involved.
 */
function png() {
  const chunk = (type, data) => {
    const typed = concat(ascii(type), data)
    return concat(u32be(data.byteLength), typed, u32be(crc32(typed)))
  }
  const ihdr = concat(
    u32be(1), // width
    u32be(1), // height
    bytes(8), // bit depth
    bytes(2), // colour type 2: truecolour
    bytes(0), // compression method: deflate
    bytes(0), // filter method
    bytes(0), // interlace: none
  )
  const scanline = bytes(0x00, 0x80, 0x40, 0x20) // filter type 0 + one RGB pixel
  // RFC 1950 §2.2: CMF 0x78 (deflate, 32 KiB window) with FLG chosen so CMF*256+FLG is a
  // multiple of 31 and neither a preset dictionary nor a compression level is claimed.
  const zlib = concat(bytes(0x78, 0x01), deflateStored(scanline), u32be(adler32(scanline)))
  return concat(
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  )
}

/**
 * One Ogg page: RFC 3533 §6. A single-segment first page puts its payload at byte 28, which is
 * where the Vorbis/Opus/Theora identification headers live and where the codec signatures point.
 */
function oggPage(payload, serialNumber) {
  const withoutCrc = concat(
    ascii('OggS'),
    bytes(0x00), // stream structure version
    bytes(0x02), // header type: beginning of stream
    new Uint8Array(8), // granule position 0
    u32le(serialNumber),
    u32le(0), // page sequence number
    u32le(0), // CRC placeholder — RFC 3533 §6 computes it with this field zeroed
    bytes(0x01), // one segment
    bytes(payload.byteLength), // segment table
    payload,
  )
  const page = withoutCrc.slice()
  page.set(u32le(oggCrc(withoutCrc)), 22)
  return page
}

/** Vorbis I §4.2.2 identification header, carried in the Ogg first page (RFC 5334 §4). */
function ogg() {
  return oggPage(
    concat(
      bytes(0x01),
      ascii('vorbis'),
      u32le(0), // vorbis_version
      bytes(1), // audio_channels
      u32le(8000), // audio_sample_rate
      u32le(0), // bitrate_maximum: unset
      u32le(64000), // bitrate_nominal
      u32le(0), // bitrate_minimum: unset
      bytes(0xb8), // blocksize_0 = 2^8, blocksize_1 = 2^11
      bytes(0x01), // framing flag
    ),
    0x6d6b3201,
  )
}

/** RFC 7845 §5.1 "OpusHead" identification header in the Ogg first page. */
function opus() {
  return oggPage(
    concat(
      ascii('OpusHead'),
      bytes(1), // version
      bytes(1), // output channel count
      u16le(312), // pre-skip
      u32le(48000), // input sample rate
      u16le(0), // output gain
      bytes(0), // channel mapping family 0
    ),
    0x6d6b3202,
  )
}

/** Theora I §6.1 identification header in the Ogg first page. */
function ogv() {
  const header = bitWriter()
  header.push(3, 8) // VMAJ
  header.push(2, 8) // VMIN
  header.push(1, 8) // VREV
  header.push(1, 16) // FMBW: frame width in macro blocks
  header.push(1, 16) // FMBH: frame height in macro blocks
  header.push(16, 24) // PICW
  header.push(16, 24) // PICH
  header.push(0, 8) // PICX
  header.push(0, 8) // PICY
  header.push(30, 32) // FRN: frame rate numerator
  header.push(1, 32) // FRD: frame rate denominator
  header.push(0, 24) // PARN
  header.push(0, 24) // PARD
  header.push(0, 8) // CS: colour space unspecified
  header.push(0, 24) // NOMBR: nominal bitrate unspecified
  header.push(31, 6) // QUAL
  header.push(0, 5) // KFGSHIFT
  header.push(0, 2) // PF: pixel format 4:2:0
  header.push(0, 3) // RES: reserved, must be zero
  return oggPage(concat(bytes(0x80), ascii('theora'), header.finish()), 0x6d6b3203)
}

/**
 * ISO/IEC 14496-12: §4.3 FileTypeBox and §8.2.2 MovieHeaderBox. Two boxes are enough for a
 * container walk; there is no media data, and the fixture does not pretend there is.
 */
function mp4() {
  const box = (type, payload) => concat(u32be(8 + payload.byteLength), ascii(type), payload)
  const identityMatrix = concat(
    u32be(0x00010000),
    u32be(0),
    u32be(0),
    u32be(0),
    u32be(0x00010000),
    u32be(0),
    u32be(0),
    u32be(0),
    u32be(0x40000000),
  )
  const mvhd = box(
    'mvhd',
    concat(
      u32be(0), // version 0, flags 0
      u32be(0), // creation time: zero keeps the fixture byte-stable
      u32be(0), // modification time
      u32be(1000), // timescale: units per second
      u32be(1000), // duration: one second
      u32be(0x00010000), // rate 1.0
      u16be(0x0100), // volume 1.0
      u16be(0), // reserved
      new Uint8Array(8), // reserved
      identityMatrix,
      new Uint8Array(24), // pre_defined
      u32be(2), // next_track_ID
    ),
  )
  return concat(
    box('ftyp', concat(ascii('isom'), u32be(512), ascii('isom'), ascii('mp41'))),
    box('moov', mvhd),
  )
}

/**
 * MPEG-1 video elementary stream: ISO/IEC 11172-2 §2.4.2.3 sequence_header, §2.4.2.2
 * sequence_end_code. Start codes are what the v1 codec inventories, and start codes are what
 * this fixture carries — no elementary stream data is invented.
 */
function mpeg() {
  const header = bitWriter()
  header.push(16, 12) // horizontal_size_value
  header.push(16, 12) // vertical_size_value
  header.push(1, 4) // aspect_ratio_information: 1.0
  header.push(3, 4) // frame_rate_code: 25 fps
  header.push(4096, 18) // bit_rate_value
  header.push(1, 1) // marker_bit
  header.push(1, 10) // vbv_buffer_size_value
  header.push(0, 1) // constrained_parameters_flag
  header.push(0, 1) // load_intra_quantizer_matrix
  header.push(0, 1) // load_non_intra_quantizer_matrix
  return concat(
    bytes(0x00, 0x00, 0x01, 0xb3),
    header.finish(),
    bytes(0x00, 0x00, 0x01, 0xb7), // sequence_end_code
  )
}

/**
 * FLV: "Adobe Flash Video File Format Specification v10.1" Annex E — the 9-byte header, the
 * mandatory first PreviousTagSize, and one video tag with a Sorenson H.263 key frame header.
 */
function flv() {
  const tagBody = bytes(0x12, 0x00, 0x00, 0x00) // frame type 1 (key frame), codec id 2
  const tag = concat(
    bytes(0x09), // tag type: video
    u24be(tagBody.byteLength),
    u24be(0), // timestamp
    bytes(0x00), // timestamp extended
    u24be(0), // stream id, always zero
    tagBody,
  )
  return concat(
    ascii('FLV'),
    bytes(0x01), // version
    bytes(0x05), // type flags: audio and video present
    u32be(9), // data offset: the header size
    u32be(0), // PreviousTagSize0
    tag,
    u32be(tag.byteLength),
  )
}

/**
 * WebM: RFC 8794 (EBML) §4 element framing, plus the Matroska/WebM element ids. An EBML header
 * declaring DocType "webm" and a Segment holding Info — the shallow structure the v1 codec claims.
 */
function webm() {
  /** RFC 8794 §4.4: VINT_WIDTH zeros, a one bit, then the value. One-byte form is enough here. */
  const vintSize = length => {
    if (length < 0x7f) return bytes(0x80 | length)
    return concat(bytes(0x40 | ((length >>> 8) & 0x3f)), bytes(length & 0xff))
  }
  const element = (id, payload) => concat(id, vintSize(payload.byteLength), payload)
  const uint = (id, value) => element(id, value <= 0xff ? bytes(value) : u32be(value))
  const string = (id, value) => element(id, ascii(value))
  const ebml = element(
    bytes(0x1a, 0x45, 0xdf, 0xa3),
    concat(
      uint(bytes(0x42, 0x86), 1), // EBMLVersion
      uint(bytes(0x42, 0xf7), 1), // EBMLReadVersion
      uint(bytes(0x42, 0xf2), 4), // EBMLMaxIDLength
      uint(bytes(0x42, 0xf3), 8), // EBMLMaxSizeLength
      string(bytes(0x42, 0x82), 'webm'), // DocType
      uint(bytes(0x42, 0x87), 2), // DocTypeVersion
      uint(bytes(0x42, 0x85), 2), // DocTypeReadVersion
    ),
  )
  const info = element(
    bytes(0x15, 0x49, 0xa9, 0x66),
    concat(
      element(bytes(0x2a, 0xd7, 0xb1), u32be(1000000)), // TimestampScale: one millisecond
      string(bytes(0x4d, 0x80), 'modkitx-synthetic'), // MuxingApp
      string(bytes(0x57, 0x41), 'modkitx-synthetic'), // WritingApp
    ),
  )
  return concat(ebml, element(bytes(0x18, 0x53, 0x80, 0x67), info))
}

// ---------------------------------------------------------------- the corpus

/** Every fixture: file name → builder. The name is what the acceptance corpus refers to. */
const FIXTURES = {
  'minimal.wav': wav,
  'minimal.bmp': bmp,
  'minimal.gif': gif,
  'minimal.tar': tar,
  'minimal.gz': gz,
  'minimal.png': png,
  'minimal.flv': flv,
  'minimal.ogg': ogg,
  'minimal.opus': opus,
  'minimal.ogv': ogv,
  'minimal.mp4': mp4,
  'minimal.mpg': mpeg,
  'minimal.webm': webm,
}

const built = new Map(
  Object.entries(FIXTURES)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([name, build]) => [name, build()]),
)

// ---------------------------------------------------------------- compare / write

function listExisting(root) {
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory() !== true) return new Map()
  const out = new Map()
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    if (entry.isFile()) out.set(entry.name, new Uint8Array(readFileSync(join(root, entry.name))))
  }
  return out
}

const sameBytes = (left, right) =>
  left !== undefined &&
  left.byteLength === right.byteLength &&
  left.every((value, index) => value === right[index])

const existing = listExisting(outRoot)
const drift = { added: [], changed: [], removed: [] }
for (const [name, contents] of built) {
  const current = existing.get(name)
  if (current === undefined) drift.added.push(name)
  else if (!sameBytes(current, contents)) drift.changed.push(name)
}
for (const name of existing.keys()) if (!built.has(name)) drift.removed.push(name)
for (const key of Object.keys(drift)) drift[key].sort()

const total = drift.added.length + drift.changed.length + drift.removed.length

if (checkOnly) {
  if (total > 0) {
    console.error(`gen-synthetic-corpus --check: ${total} fixture(s) differ from the generator:`)
    for (const name of drift.added) console.error(`  + ${name}`)
    for (const name of drift.changed) console.error(`  ~ ${name}`)
    for (const name of drift.removed) console.error(`  - ${name}`)
    process.exit(1)
  }
  if (!quiet) console.log(`gen-synthetic-corpus --check: clean (${built.size} fixture(s))`)
} else {
  mkdirSync(outRoot, { recursive: true })
  for (const name of drift.removed) rmSync(join(outRoot, name), { force: true })
  for (const name of [...drift.added, ...drift.changed]) {
    writeFileSync(join(outRoot, name), built.get(name))
  }
  if (!quiet) {
    const sizes = [...built].map(([name, contents]) => `${name} ${contents.byteLength}B`).join(', ')
    console.log(
      `gen-synthetic-corpus: ${built.size} fixture(s) in ${outRoot}` +
        ` (${drift.added.length} added, ${drift.changed.length} rewritten, ${drift.removed.length} removed` +
        `${total === 0 ? ', byte-stable' : ''})`,
    )
    console.log(`  ${sizes}`)
  }
}
