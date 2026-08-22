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
//   * nothing is copied from a product or game. Every byte below is written from the format
//     specification named above the builder. For compression formats whose encoders are far larger
//     than this corpus generator, a fixed canonical encoder output is retained and independently
//     decoded by another implementation before landing.
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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const customOut = argValue('--out')
const outRoot = resolve(customOut ?? join(packageRoot, 'test', 'fixtures', 'mk2-synthetic'))
const webMp3Path = resolve(
  packageRoot,
  '..',
  '..',
  'apps',
  'web',
  'public',
  'samples',
  'sample.mp3',
)
const mirrorsWebMp3 = customOut === undefined
const checkOnly = args.includes('--check')
const quiet = args.includes('--quiet')

// ---------------------------------------------------------------- byte helpers

const bytes = (...values) => Uint8Array.from(values.flat())
const ascii = text => Uint8Array.from([...text].map(character => character.charCodeAt(0) & 0xff))

const u16le = value => bytes(value & 0xff, (value >>> 8) & 0xff)
const u24le = value => bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff)
const u32le = value =>
  bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
const u16be = value => bytes((value >>> 8) & 0xff, value & 0xff)
const u24be = value => bytes((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
const u32be = value =>
  bytes((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)

const u64le = value => concat(u32le(Number(value & 0xffffffffn)), u32le(Number(value >> 32n)))
const u64be = value => concat(u32be(Number(value >> 32n)), u32be(Number(value & 0xffffffffn)))

function f32le(value) {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setFloat32(0, value, true)
  return result
}

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
 * ISO/IEC 14496-12 boxes plus AVIF ImageSpatialExtents/PixelInformation properties. This is a
 * structural inspection fixture: the port explicitly does not claim an AV1 pixel payload.
 */
function avif() {
  const box = (type, ...payload) => {
    const body = concat(...payload)
    return concat(u32be(body.byteLength + 8), ascii(type), body)
  }
  const ispe = box('ispe', bytes(0, 0, 0, 0), u32be(2), u32be(1))
  const pixi = box('pixi', bytes(0, 0, 0, 0), bytes(3, 8, 8, 8))
  return concat(
    box('ftyp', ascii('avif'), u32be(0), ascii('avif'), ascii('mif1')),
    box('meta', bytes(0, 0, 0, 0), box('iprp', box('ipco', ispe, pixi))),
    box('mdat'),
  )
}

/**
 * ARM ASTC container: one 4×4×1 image and one 16-byte LDR void-extent block. The standalone
 * header stores dimensions and block size but deliberately carries no colour-space profile.
 */
function astc() {
  return concat(
    bytes(0x13, 0xab, 0xa1, 0x5c),
    bytes(4, 4, 1),
    u24le(4),
    u24le(4),
    u24le(1),
    bytes(
      0xfc,
      0xfd,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0x00,
      0x00,
      0x00,
      0x00,
      0xff,
      0xff,
      0xff,
      0xff,
    ),
  )
}

/**
 * OpenEXR v2 scanline file with the required header attributes, one RGBA float pixel, an offset
 * table and one uncompressed scanline chunk. Values are R=1, G=0.5, B=0.25, A=1.
 */
function exr() {
  const attribute = (name, type, data) =>
    concat(ascii(name), bytes(0), ascii(type), bytes(0), u32le(data.byteLength), data)
  const channel = name =>
    concat(
      ascii(name),
      bytes(0),
      u32le(2), // FLOAT
      bytes(0, 0, 0, 0), // pLinear + reserved
      u32le(1),
      u32le(1),
    )
  const channels = concat(channel('R'), channel('G'), channel('B'), channel('A'), bytes(0))
  const window = concat(u32le(0), u32le(0), u32le(0), u32le(0))
  const header = concat(
    bytes(0x76, 0x2f, 0x31, 0x01),
    u32le(2),
    attribute('channels', 'chlist', channels),
    attribute('compression', 'compression', bytes(0)),
    attribute('dataWindow', 'box2i', window),
    attribute('displayWindow', 'box2i', window),
    attribute('lineOrder', 'lineOrder', bytes(0)),
    attribute('pixelAspectRatio', 'float', f32le(1)),
    attribute('screenWindowCenter', 'v2f', concat(f32le(0), f32le(0))),
    attribute('screenWindowWidth', 'float', f32le(1)),
    bytes(0),
  )
  const pixels = concat(f32le(1), f32le(0.5), f32le(0.25), f32le(1))
  const chunkOffset = BigInt(header.byteLength + 8)
  return concat(header, u64le(chunkOffset), u32le(0), u32le(pixels.byteLength), pixels)
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
 * Radiance RGBE: the required identifier/FORMAT/resolution header followed by one old-style flat
 * RGBE scanline. Exponent 136 makes the stored 128/64/32 mantissas map exactly to RGBA8 128/64/32.
 */
function hdr() {
  return concat(
    ascii('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n'),
    bytes(0x80, 0x40, 0x20, 0x88),
  )
}

/**
 * Microsoft ICO/CUR directory plus one BITMAPINFOHEADER payload. The DIB height is doubled for
 * its XOR and AND planes; the one opaque BGRA pixel is followed by a zero transparency-mask row.
 */
function iconContainer(type) {
  const dib = concat(
    u32le(40),
    u32le(1),
    u32le(2),
    u16le(1),
    u16le(32),
    u32le(0),
    u32le(4),
    u32le(0),
    u32le(0),
    u32le(0),
    u32le(0),
    bytes(0x20, 0x40, 0x80, 0xff),
    new Uint8Array(4),
  )
  return concat(
    u16le(0),
    u16le(type),
    u16le(1),
    bytes(1, 1, 0, 0),
    u16le(type === 1 ? 1 : 0),
    u16le(type === 1 ? 32 : 0),
    u32le(dib.byteLength),
    u32le(22),
    dib,
  )
}

const ico = () => iconContainer(1)
const cur = () => iconContainer(2)

/**
 * Windows animated cursor: RIFF/ACON with one 36-byte anih header and one LIST/fram containing a
 * complete one-pixel CUR frame. The RIFF length includes its form type and both padded chunks.
 */
function ani() {
  const chunk = (id, payload) =>
    concat(ascii(id), u32le(payload.byteLength), payload, new Uint8Array(payload.byteLength & 1))
  const header = concat(
    u32le(36),
    u32le(1),
    u32le(1),
    u32le(1),
    u32le(1),
    u32le(32),
    u32le(1),
    u32le(6),
    u32le(1),
  )
  const frames = chunk('LIST', concat(ascii('fram'), chunk('icon', iconContainer(2))))
  const body = concat(ascii('ACON'), chunk('anih', header), frames)
  return concat(ascii('RIFF'), u32le(body.byteLength), body)
}

/**
 * KTX 1.1: little-endian header, one KTXorientation key/value record, one uncompressed RGBA8 mip
 * and one pixel. The level imageSize is four and therefore needs no additional alignment bytes.
 */
function ktx() {
  const orientation = ascii('KTXorientation\0S=r,T=d\0')
  const orientationPadding = new Uint8Array((4 - (orientation.byteLength % 4)) % 4)
  const keyValues = concat(u32le(orientation.byteLength), orientation, orientationPadding)
  return concat(
    bytes(0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a),
    bytes(1, 2, 3, 4),
    u32le(0x1401),
    u32le(1),
    u32le(0x1908),
    u32le(0x8058),
    u32le(0x1908),
    u32le(1),
    u32le(1),
    u32le(0),
    u32le(0),
    u32le(1),
    u32le(1),
    u32le(keyValues.byteLength),
    keyValues,
    u32le(4),
    bytes(0x80, 0x40, 0x20, 0xff),
  )
}

/** PKM 1.0 ETC1: one padded 4×4 block carrying eight deterministic compressed bytes. */
function pkm() {
  return concat(
    ascii('PKM 10'),
    u16be(0),
    u16be(4),
    u16be(4),
    u16be(1),
    u16be(1),
    new Uint8Array(8),
  )
}

/**
 * PVR v3: little-endian custom RGBA 8/8/8/8 unsigned-normalized format, one surface/face/mip
 * and one exact pixel. No metadata records are declared.
 */
function pvr() {
  return concat(
    ascii('PVR\x03'),
    u32le(0),
    ascii('rgba'),
    bytes(8, 8, 8, 8),
    u32le(1),
    u32le(0),
    u32le(1),
    u32le(1),
    u32le(1),
    u32le(1),
    u32le(1),
    u32le(1),
    u32le(0),
    bytes(0x80, 0x40, 0x20, 0xff),
  )
}

/** JASC-PAL 0100 with two declared colors; the remaining 254 swatch cells default to black. */
function pal() {
  return ascii('JASC-PAL\n0100\n2\n128 64 32\n0 0 0\n')
}

/**
 * ZSoft PCX v5: one uncompressed 24-bit pixel stored in three 8-bit planes. Each one-byte plane
 * row is padded to the declared two-byte bytesPerLine stride.
 */
function pcx() {
  const output = new Uint8Array(134)
  const view = new DataView(output.buffer)
  output[0] = 0x0a
  output[1] = 5
  output[2] = 0
  output[3] = 8
  view.setUint16(4, 0, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, 0, true)
  view.setUint16(10, 0, true)
  view.setUint16(12, 72, true)
  view.setUint16(14, 72, true)
  output[65] = 3
  view.setUint16(66, 2, true)
  view.setUint16(68, 1, true)
  output.set(bytes(0x80, 0x00, 0x40, 0x00, 0x20, 0x00), 128)
  return output
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
 * Classic single-disk ZIP with one stored UTF-8-compatible file. The local header and central
 * directory carry the same sizes and CRC-32, and the EOCD points at the exact directory range.
 */
function zip() {
  const name = ascii('hello.txt')
  const payload = ascii('hello\n')
  const checksum = crc32(payload)
  const local = concat(
    u32le(0x04034b50),
    u16le(20),
    u16le(0),
    u16le(0),
    u16le(0),
    u16le(0),
    u32le(checksum),
    u32le(payload.byteLength),
    u32le(payload.byteLength),
    u16le(name.byteLength),
    u16le(0),
    name,
    payload,
  )
  const central = concat(
    u32le(0x02014b50),
    u16le(20),
    u16le(20),
    u16le(0),
    u16le(0),
    u16le(0),
    u16le(0),
    u32le(checksum),
    u32le(payload.byteLength),
    u32le(payload.byteLength),
    u16le(name.byteLength),
    u16le(0),
    u16le(0),
    u16le(0),
    u16le(0),
    u32le(0),
    u32le(0),
    name,
  )
  const eocd = concat(
    u32le(0x06054b50),
    u16le(0),
    u16le(0),
    u16le(1),
    u16le(1),
    u32le(central.byteLength),
    u32le(local.byteLength),
    u16le(0),
  )
  return concat(local, central, eocd)
}

/** Classic single-disk ZIP with multiple stored parts, used for office document packages. */
function storedZip(parts) {
  const locals = []
  const centralRecords = []
  let localOffset = 0
  for (const [path, value, method = 0] of parts) {
    const name = ascii(path)
    const payload = typeof value === 'string' ? ascii(value) : value
    const compressed = method === 8 ? deflateStored(payload) : payload
    const checksum = crc32(payload)
    const local = concat(
      u32le(0x04034b50),
      u16le(20),
      u16le(0x0800),
      u16le(method),
      u16le(0),
      u16le(0),
      u32le(checksum),
      u32le(compressed.byteLength),
      u32le(payload.byteLength),
      u16le(name.byteLength),
      u16le(0),
      name,
      compressed,
    )
    centralRecords.push(
      concat(
        u32le(0x02014b50),
        u16le(20),
        u16le(20),
        u16le(0x0800),
        u16le(method),
        u16le(0),
        u16le(0),
        u32le(checksum),
        u32le(compressed.byteLength),
        u32le(payload.byteLength),
        u16le(name.byteLength),
        u16le(0),
        u16le(0),
        u16le(0),
        u16le(0),
        u32le(0),
        u32le(localOffset),
        name,
      ),
    )
    locals.push(local)
    localOffset += local.byteLength
  }
  const central = concat(...centralRecords)
  return concat(
    ...locals,
    central,
    u32le(0x06054b50),
    u16le(0),
    u16le(0),
    u16le(parts.length),
    u16le(parts.length),
    u32le(central.byteLength),
    u32le(localOffset),
    u16le(0),
  )
}

const packageTypes = root =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${root}" ContentType="application/xml"/></Types>`
const packageRelationships = root =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="urn:fixture:officeDocument" Target="${root}"/></Relationships>`

function docx() {
  return storedZip([
    ['[Content_Types].xml', packageTypes('word/document.xml'), 8],
    ['_rels/.rels', packageRelationships('word/document.xml'), 8],
    [
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p><w:tbl/></w:body></w:document>',
      8,
    ],
  ])
}

function pptx() {
  return storedZip([
    ['[Content_Types].xml', packageTypes('ppt/presentation.xml'), 8],
    ['_rels/.rels', packageRelationships('ppt/presentation.xml'), 8],
    [
      'ppt/presentation.xml',
      '<?xml version="1.0"?><p:presentation xmlns:p="urn:presentation"><p:sldIdLst><p:sldId id="1"/></p:sldIdLst></p:presentation>',
      8,
    ],
    [
      'ppt/slides/slide1.xml',
      '<?xml version="1.0"?><p:sld xmlns:p="urn:presentation" xmlns:a="urn:drawing"><p:cSld><p:spTree><p:sp><a:t>Hello PPTX</a:t></p:sp></p:spTree></p:cSld></p:sld>',
      8,
    ],
  ])
}

function xlsx() {
  return storedZip([
    ['[Content_Types].xml', packageTypes('xl/workbook.xml'), 8],
    ['_rels/.rels', packageRelationships('xl/workbook.xml'), 8],
    [
      'xl/workbook.xml',
      '<?xml version="1.0"?><workbook xmlns="urn:spreadsheet"><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>',
      8,
    ],
    [
      'xl/worksheets/sheet1.xml',
      '<?xml version="1.0"?><worksheet xmlns="urn:spreadsheet"><sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1"><f>A1*2</f><v>84</v></c></row></sheetData></worksheet>',
      8,
    ],
  ])
}

const odfManifest = mediaType =>
  `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:manifest"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mediaType}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`

function odt() {
  const mediaType = 'application/vnd.oasis.opendocument.text'
  return storedZip([
    ['mimetype', mediaType],
    ['META-INF/manifest.xml', odfManifest(mediaType), 8],
    [
      'content.xml',
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:office" xmlns:text="urn:text"><office:body><office:text><text:h>Heading</text:h><text:p>Hello ODT</text:p></office:text></office:body></office:document-content>',
      8,
    ],
  ])
}

function odp() {
  const mediaType = 'application/vnd.oasis.opendocument.presentation'
  return storedZip([
    ['mimetype', mediaType],
    ['META-INF/manifest.xml', odfManifest(mediaType), 8],
    [
      'content.xml',
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:office" xmlns:draw="urn:draw" xmlns:text="urn:text"><office:body><office:presentation><draw:page><draw:frame><text:p>Hello ODP</text:p></draw:frame></draw:page></office:presentation></office:body></office:document-content>',
      8,
    ],
  ])
}

function ods() {
  const mediaType = 'application/vnd.oasis.opendocument.spreadsheet'
  return storedZip([
    ['mimetype', mediaType],
    ['META-INF/manifest.xml', odfManifest(mediaType), 8],
    [
      'content.xml',
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:office" xmlns:table="urn:table" xmlns:text="urn:text"><office:body><office:spreadsheet><table:table><table:table-row><table:table-cell><text:p>42</text:p></table:table-cell><table:table-cell table:formula="of:=1+1"><text:p>2</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>',
      8,
    ],
  ])
}

/**
 * PDF 1.7 classic file structure: catalog, page tree, page, text stream, info dictionary,
 * byte-accurate cross-reference table, trailer, startxref, and final EOF marker.
 */
function pdfDocument(illustrator = false) {
  const content = 'BT (Hello PDF) Tj ET\n'
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    illustrator
      ? '<< /Creator (Adobe Illustrator 30.0) /Producer (Modkit X3) >>'
      : '<< /Creator (Modkit X3) /Producer (Modkit X3) >>',
  ]
  const header = concat(ascii('%PDF-1.7\n%'), bytes(0xe2, 0xe3, 0xcf, 0xd3), ascii('\n'))
  const objects = []
  const offsets = [0]
  let offset = header.byteLength
  for (let index = 0; index < bodies.length; index += 1) {
    offsets.push(offset)
    const object = ascii(`${index + 1} 0 obj\n${bodies[index]}\nendobj\n`)
    objects.push(object)
    offset += object.byteLength
  }
  const xrefOffset = offset
  const rows = offsets
    .map((value, index) =>
      index === 0 ? '0000000000 65535 f \n' : `${String(value).padStart(10, '0')} 00000 n \n`,
    )
    .join('')
  const tail = ascii(
    `xref\n0 ${offsets.length}\n${rows}` +
      `trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 5 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  )
  return concat(header, ...objects, tail)
}

function pdf() {
  return pdfDocument(false)
}

/** PDF-compatible Illustrator file carrying the standard PDF structure and Illustrator creator. */
function ai() {
  return pdfDocument(true)
}

/** draw.io uncompressed mxfile with one layer, two vertices, an edge, and real geometry records. */
function drawio() {
  return ascii(
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<mxfile host="app.diagrams.net"><diagram id="page-1" name="Page 1">' +
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="node-a" value="Start" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>' +
      '<mxCell id="node-b" value="Finish" vertex="1" parent="1"><mxGeometry x="160" y="0" width="80" height="40" as="geometry"/></mxCell>' +
      '<mxCell id="edge-a-b" edge="1" parent="1" source="node-a" target="node-b"><mxGeometry relative="1" as="geometry"/></mxCell>' +
      '</root></mxGraphModel></diagram></mxfile>\n',
  )
}

/** Visio 2013 OPC package with its document part, page inventory, and one shape-bearing page. */
function visioVsdx() {
  const contentTypes =
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/></Types>'
  const relationships =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="https://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/></Relationships>'
  return storedZip([
    ['[Content_Types].xml', contentTypes, 8],
    ['_rels/.rels', relationships, 8],
    [
      'visio/document.xml',
      '<?xml version="1.0"?><VisioDocument><DocumentSettings/></VisioDocument>',
      8,
    ],
    [
      'visio/pages/pages.xml',
      '<?xml version="1.0"?><Pages><Page ID="0" Name="Page-1"/></Pages>',
      8,
    ],
    [
      'visio/pages/page1.xml',
      '<?xml version="1.0"?><PageContents><Shapes><Shape ID="1" NameU="Rectangle"><Text>Hello Visio</Text></Shape><Shape ID="2" NameU="Circle"/></Shapes><Connects><Connect FromSheet="1" ToSheet="2"/></Connects></PageContents>',
      8,
    ],
  ])
}

/**
 * MS-CFB version 3 with one directory sector, one FAT sector, Root Entry, and the identifying
 * zero-length VisioDocument stream. Sector chains and DIFAT/FAT markers are internally valid.
 */
function visioVsd() {
  const header = new Uint8Array(512)
  const headerView = new DataView(header.buffer)
  header.set(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), 0)
  headerView.setUint16(24, 0x003e, true)
  headerView.setUint16(26, 3, true)
  headerView.setUint16(28, 0xfffe, true)
  headerView.setUint16(30, 9, true)
  headerView.setUint16(32, 6, true)
  headerView.setUint32(40, 0, true)
  headerView.setUint32(44, 1, true)
  headerView.setUint32(48, 0, true)
  headerView.setUint32(56, 4096, true)
  headerView.setUint32(60, 0xfffffffe, true)
  headerView.setUint32(64, 0, true)
  headerView.setUint32(68, 0xfffffffe, true)
  headerView.setUint32(72, 0, true)
  for (let offset = 76; offset < 512; offset += 4) headerView.setUint32(offset, 0xffffffff, true)
  headerView.setUint32(76, 1, true)

  const directory = new Uint8Array(512)
  const directoryView = new DataView(directory.buffer)
  const entry = (offset, name, type, child = 0xffffffff) => {
    const terminated = `${name}\0`
    for (let index = 0; index < terminated.length; index += 1) {
      directoryView.setUint16(offset + index * 2, terminated.charCodeAt(index), true)
    }
    directoryView.setUint16(offset + 64, terminated.length * 2, true)
    directory[offset + 66] = type
    directory[offset + 67] = 1
    directoryView.setUint32(offset + 68, 0xffffffff, true)
    directoryView.setUint32(offset + 72, 0xffffffff, true)
    directoryView.setUint32(offset + 76, child, true)
    directoryView.setUint32(offset + 116, 0xfffffffe, true)
    directoryView.setUint32(offset + 120, 0, true)
    directoryView.setUint32(offset + 124, 0, true)
  }
  entry(0, 'Root Entry', 5, 1)
  entry(128, 'VisioDocument', 2)

  const fat = new Uint8Array(512)
  const fatView = new DataView(fat.buffer)
  for (let offset = 0; offset < 512; offset += 4) fatView.setUint32(offset, 0xffffffff, true)
  fatView.setUint32(0, 0xfffffffe, true)
  fatView.setUint32(4, 0xfffffffd, true)
  return concat(header, directory, fat)
}

/** CorelDRAW RIFF CDR6 hierarchy with a page list, object list, and a bounded loda record. */
function cdr() {
  const record = (id, payload) =>
    concat(
      ascii(id),
      u32le(payload.byteLength),
      payload,
      payload.byteLength & 1 ? bytes(0) : bytes(),
    )
  const object = record('LIST', concat(ascii('obj '), record('loda', u32le(1))))
  const page = record('LIST', concat(ascii('page'), object))
  const body = concat(ascii('CDR6'), page)
  return concat(ascii('RIFF'), u32le(body.byteLength), body)
}

const kiwiVarUint = value => {
  const out = []
  let remaining = value >>> 0
  do {
    const byte = remaining & 0x7f
    remaining >>>= 7
    out.push(byte | (remaining === 0 ? 0 : 0x80))
  } while (remaining !== 0)
  return bytes(...out)
}

/** Embedded Kiwi BinarySchema containing the required NodeChanges message and one string field. */
function figmaCanvas() {
  const schema = concat(
    kiwiVarUint(1),
    ascii('NodeChanges\0'),
    bytes(2),
    kiwiVarUint(1),
    ascii('title\0'),
    kiwiVarUint(11), // ZigZag(-6), Kiwi TYPE_STRING
    bytes(0),
    kiwiVarUint(1),
  )
  const compressedSchema = deflateStored(schema)
  const data = zstd()
  return concat(
    ascii('fig-kiwi'),
    u32le(101),
    u32le(compressedSchema.byteLength),
    compressedSchema,
    u32le(data.byteLength),
    data,
  )
}

/** Current Figma export shape: ZIP package containing canvas.fig and bounded metadata JSON. */
function figma() {
  return storedZip([
    ['canvas.fig', figmaCanvas(), 8],
    ['meta.json', '{"name":"Modkit X3 Figma fixture","version":1}', 8],
  ])
}

/**
 * Adobe Photoshop PSD v1 with every top-level section, a ResolutionInfo resource, one layer with
 * three raw channel payloads, and a raw flattened one-pixel RGB composite.
 */
function psd() {
  const resolution = concat(
    u32be(72 << 16),
    u16be(1),
    u16be(1),
    u32be(72 << 16),
    u16be(1),
    u16be(1),
  )
  const resource = concat(
    ascii('8BIM'),
    u16be(1005),
    bytes(0, 0), // empty Pascal name and its even-byte padding
    u32be(resolution.byteLength),
    resolution,
  )
  const channelRecord = id => concat(u16be(id), u32be(3))
  const layerName = concat(bytes(5), ascii('Layer'), bytes(0, 0))
  const extra = concat(u32be(0), u32be(0), layerName)
  const layerRecord = concat(
    u32be(0),
    u32be(0),
    u32be(1),
    u32be(1),
    u16be(3),
    channelRecord(0),
    channelRecord(1),
    channelRecord(2),
    ascii('8BIM'),
    ascii('norm'),
    bytes(255, 0, 0, 0),
    u32be(extra.byteLength),
    extra,
  )
  const layerInfoUnpadded = concat(
    u16be(1),
    layerRecord,
    u16be(0),
    bytes(255),
    u16be(0),
    bytes(128),
    u16be(0),
    bytes(64),
  )
  const layerInfo = concat(layerInfoUnpadded, bytes(0))
  const layerAndMask = concat(u32be(layerInfo.byteLength), layerInfo, u32be(0))
  return concat(
    ascii('8BPS'),
    u16be(1),
    bytes(0, 0, 0, 0, 0, 0),
    u16be(3),
    u32be(1),
    u32be(1),
    u16be(8),
    u16be(3),
    u32be(0),
    u32be(resource.byteLength),
    resource,
    u32be(layerAndMask.byteLength),
    layerAndMask,
    u16be(0),
    bytes(255, 128, 64),
  )
}

/**
 * Native Blender 4.00 framing with 64-bit little-endian BHeads, legacy triangle geometry, a
 * complete embedded SDNA NAME/TYPE/TLEN/STRC schema, and the special eight-byte ENDB block.
 */
function blend() {
  const pad4 = value => concat(value, new Uint8Array((4 - (value.byteLength % 4)) % 4))
  const names = ['co[3]', 'v1', 'v2', 'v3', 'v4']
  const types = ['float', 'uint', 'MVert', 'MFace']
  const nameData = pad4(concat(...names.map(name => concat(ascii(name), bytes(0)))))
  const typeData = pad4(concat(...types.map(type => concat(ascii(type), bytes(0)))))
  const sdna = concat(
    ascii('SDNA'),
    ascii('NAME'),
    u32le(names.length),
    nameData,
    ascii('TYPE'),
    u32le(types.length),
    typeData,
    ascii('TLEN'),
    u16le(4),
    u16le(4),
    u16le(12),
    u16le(16),
    ascii('STRC'),
    u32le(2),
    u16le(2),
    u16le(1),
    u16le(0),
    u16le(0),
    u16le(3),
    u16le(4),
    u16le(1),
    u16le(1),
    u16le(1),
    u16le(2),
    u16le(1),
    u16le(3),
    u16le(1),
    u16le(4),
  )
  const bhead = (code, payload, oldAddress, sdnaIndex, count) =>
    concat(
      ascii(code),
      u32le(payload.byteLength),
      u64le(BigInt(oldAddress)),
      u32le(sdnaIndex),
      u32le(count),
      payload,
    )
  const vertices = concat(
    f32le(0),
    f32le(0),
    f32le(0),
    f32le(1),
    f32le(0),
    f32le(0),
    f32le(0),
    f32le(1),
    f32le(0),
  )
  const face = concat(u32le(0), u32le(1), u32le(2), u32le(0))
  return concat(
    ascii('BLENDER-v400'),
    bhead('MV  ', vertices, 1, 0, 3),
    bhead('MF  ', face, 2, 1, 1),
    bhead('DNA1', sdna, 0, 0, 1),
    ascii('ENDB'),
    u32le(0),
  )
}

/**
 * Microsoft Cabinet SDK layout: one CAB 1.3 folder, one CFFILE and one uncompressed CFDATA block.
 * A zero CFDATA checksum explicitly means that no checksum was supplied; sizes and offsets remain
 * normative and point at the six stored bytes.
 */
function cab() {
  const name = ascii('hello.txt\0')
  const payload = ascii('hello\n')
  const filesOffset = 36 + 8
  const dataOffset = filesOffset + 16 + name.byteLength
  const cabinetBytes = dataOffset + 8 + payload.byteLength
  return concat(
    ascii('MSCF'),
    u32le(0),
    u32le(cabinetBytes),
    u32le(0),
    u32le(filesOffset),
    u32le(0),
    bytes(3, 1), // versionMinor 3, versionMajor 1
    u16le(1), // one CFFOLDER
    u16le(1), // one CFFILE
    u16le(0), // no continuation or reserve fields
    u16le(0),
    u16le(0),
    u32le(dataOffset),
    u16le(1), // one CFDATA block
    u16le(0), // compression type NONE
    u32le(payload.byteLength),
    u32le(0), // offset within the uncompressed folder stream
    u16le(0), // folder index
    u16le(0), // date
    u16le(0), // time
    u16le(0x20), // archive attribute
    name,
    u32le(0), // CFDATA checksum omitted by the format's zero sentinel
    u16le(payload.byteLength),
    u16le(payload.byteLength),
    payload,
  )
}

/** ISO 9660 ECMA-119 volume with primary/terminator descriptors, path tables and one file. */
function iso() {
  const sectorBytes = 2048
  const volumeBlocks = 22
  const rootExtent = 20
  const fileExtent = 21
  const payload = ascii('hello\n')
  const both16 = value => concat(u16le(value), u16be(value))
  const both32 = value => concat(u32le(value), u32be(value))
  const directoryRecord = (extent, size, flags, identifier) => {
    const padding = identifier.byteLength % 2 === 0 ? 1 : 0
    const record = new Uint8Array(33 + identifier.byteLength + padding)
    record[0] = record.byteLength
    record.set(both32(extent), 2)
    record.set(both32(size), 10)
    record.set(bytes(126, 1, 1, 0, 0, 0, 0), 18) // 2026-01-01 UTC
    record[25] = flags
    record.set(both16(1), 28)
    record[32] = identifier.byteLength
    record.set(identifier, 33)
    return record
  }
  const rootRecord = directoryRecord(rootExtent, sectorBytes, 0x02, bytes(0))
  const parentRecord = directoryRecord(rootExtent, sectorBytes, 0x02, bytes(1))
  const fileRecord = directoryRecord(fileExtent, payload.byteLength, 0, ascii('HELLO.TXT;1'))
  const rootDirectory = new Uint8Array(sectorBytes)
  rootDirectory.set(rootRecord, 0)
  rootDirectory.set(parentRecord, rootRecord.byteLength)
  rootDirectory.set(fileRecord, rootRecord.byteLength + parentRecord.byteLength)

  const primary = new Uint8Array(sectorBytes)
  primary[0] = 1
  primary.set(ascii('CD001'), 1)
  primary[6] = 1
  primary.fill(0x20, 8, 72)
  primary.set(ascii('MODKITX'), 40)
  primary.set(both32(volumeBlocks), 80)
  primary.set(both16(1), 120)
  primary.set(both16(1), 124)
  primary.set(both16(sectorBytes), 128)
  primary.set(both32(10), 132)
  primary.set(u32le(18), 140)
  primary.set(u32be(19), 148)
  primary.set(rootRecord, 156)

  const terminator = new Uint8Array(sectorBytes)
  terminator[0] = 255
  terminator.set(ascii('CD001'), 1)
  terminator[6] = 1
  const littlePathTable = concat(bytes(1, 0), u32le(rootExtent), u16le(1), bytes(0, 0))
  const bigPathTable = concat(bytes(1, 0), u32be(rootExtent), u16be(1), bytes(0, 0))

  const output = new Uint8Array(volumeBlocks * sectorBytes)
  output.set(primary, 16 * sectorBytes)
  output.set(terminator, 17 * sectorBytes)
  output.set(littlePathTable, 18 * sectorBytes)
  output.set(bigPathTable, 19 * sectorBytes)
  output.set(rootDirectory, rootExtent * sectorBytes)
  output.set(payload, fileExtent * sectorBytes)
  return output
}

/**
 * CDRWIN-compatible CUE sheet using the common FILE/TRACK/INDEX grammar documented by libcue and
 * cdrdao, paired with a MODE1/2048 BIN. The BIN is the ISO 9660 image above, so the sector count,
 * data-track payload, and filesystem are independently meaningful rather than sentinel bytes.
 * FILE is deliberately relative: the host, not the codec, resolves the sibling.
 */
function ps1Cue() {
  return ascii('FILE "minimal.bin" BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00\n')
}

function ps1Bin() {
  return iso()
}

/** PE/COFF 8.3: a PE32 x86 console image with one 512-byte `.text` section. */
function pe() {
  const output = new Uint8Array(1024)
  const view = new DataView(output.buffer)
  output.set(ascii('MZ'), 0)
  view.setUint32(60, 0x80, true)
  output.set(bytes(0x50, 0x45, 0, 0), 0x80)
  const coff = 0x84
  view.setUint16(coff, 0x014c, true)
  view.setUint16(coff + 2, 1, true)
  view.setUint16(coff + 16, 0x00e0, true)
  view.setUint16(coff + 18, 0x0102, true)
  const optional = coff + 20
  view.setUint16(optional, 0x010b, true)
  view.setUint32(optional + 4, 0x200, true)
  view.setUint32(optional + 16, 0x1000, true)
  view.setUint32(optional + 20, 0x1000, true)
  view.setUint32(optional + 24, 0x2000, true)
  view.setUint32(optional + 28, 0x00400000, true)
  view.setUint32(optional + 32, 0x1000, true)
  view.setUint32(optional + 36, 0x200, true)
  view.setUint16(optional + 40, 4, true)
  view.setUint16(optional + 48, 4, true)
  view.setUint32(optional + 56, 0x2000, true)
  view.setUint32(optional + 60, 0x200, true)
  view.setUint16(optional + 68, 3, true)
  view.setUint32(optional + 92, 16, true)
  const section = optional + 0xe0
  output.set(ascii('.text'), section)
  view.setUint32(section + 8, 1, true)
  view.setUint32(section + 12, 0x1000, true)
  view.setUint32(section + 16, 0x200, true)
  view.setUint32(section + 20, 0x200, true)
  view.setUint32(section + 36, 0x60000020, true)
  output[0x200] = 0xc3 // x86 RET
  return output
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
 * Truevision TGA 2.0: one uncompressed 24-bit truecolor pixel with top-left origin, followed by
 * the extension/developer offsets and the canonical TRUEVISION-XFILE footer signature.
 */
function tga() {
  const header = concat(
    bytes(1), // one-byte image ID keeps the valid header disjoint from a CUR directory prefix
    bytes(0), // no color map
    bytes(2), // uncompressed truecolor
    new Uint8Array(5), // empty color-map specification
    u16le(0),
    u16le(0), // origin
    u16le(1),
    u16le(1), // dimensions
    bytes(24),
    bytes(0x20), // top-left origin, no alpha bits
  )
  const footer = concat(u32le(0), u32le(0), ascii('TRUEVISION-XFILE.\0'))
  return concat(header, ascii('x'), bytes(0x20, 0x40, 0x80), footer)
}

/**
 * TIFF 6.0 little-endian baseline RGB: one IFD, one uncompressed chunky RGBA8 strip and the
 * required BitsPerSample array stored after the directory. All offsets are derived from the
 * eleven-entry IFD layout rather than copied from another file.
 */
function tiff() {
  const ifdOffset = 8
  const entryCount = 11
  const bitsOffset = ifdOffset + 2 + entryCount * 12 + 4
  const pixelOffset = bitsOffset + 8
  const entry = (tag, type, count, valueOrOffset) =>
    concat(u16le(tag), u16le(type), u32le(count), u32le(valueOrOffset))
  const directory = concat(
    u16le(entryCount),
    entry(256, 3, 1, 1), // ImageWidth
    entry(257, 3, 1, 1), // ImageLength
    entry(258, 3, 4, bitsOffset), // BitsPerSample
    entry(259, 3, 1, 1), // Compression: none
    entry(262, 3, 1, 2), // PhotometricInterpretation: RGB
    entry(273, 4, 1, pixelOffset), // StripOffsets
    entry(274, 3, 1, 1), // Orientation: top-left
    entry(277, 3, 1, 4), // SamplesPerPixel
    entry(278, 4, 1, 1), // RowsPerStrip
    entry(279, 4, 1, 4), // StripByteCounts
    entry(284, 3, 1, 1), // PlanarConfiguration: chunky
    u32le(0), // no next IFD
  )
  return concat(
    ascii('II'),
    u16le(42),
    u32le(ifdOffset),
    directory,
    u16le(8),
    u16le(8),
    u16le(8),
    u16le(8),
    bytes(0x80, 0x40, 0x20, 0xff),
  )
}

/**
 * DDS: Microsoft DDS Programming Guide — legacy 124-byte header and one BC1/DXT1 4×4 block.
 * Both endpoints and every selector choose RGB565 red, so an independent decoder must return
 * sixteen opaque red pixels.
 */
function dds() {
  const output = new Uint8Array(136)
  output.set(ascii('DDS '), 0)
  const view = new DataView(output.buffer)
  view.setUint32(4, 124, true) // dwSize
  view.setUint32(8, 0x00081007, true) // caps, height, width, pixel format, linear size
  view.setUint32(12, 4, true)
  view.setUint32(16, 4, true)
  view.setUint32(20, 8, true)
  view.setUint32(28, 1, true)
  view.setUint32(76, 32, true) // DDS_PIXELFORMAT.dwSize
  view.setUint32(80, 0x4, true) // DDPF_FOURCC
  output.set(ascii('DXT1'), 84)
  view.setUint32(108, 0x1000, true) // DDSCAPS_TEXTURE
  view.setUint16(128, 0xf800, true)
  view.setUint16(130, 0x07e0, true)
  view.setUint32(132, 0, true)
  return output
}

/**
 * M3: the MD34 header and 16-byte section-index layout used by StarCraft II models. The one
 * section points back to the header, which is sufficient to prove bounded index traversal and a
 * metadata-only scene without inventing native geometry records.
 */
function m3() {
  const output = new Uint8Array(40)
  output.set(ascii('43DM'), 0) // little-endian storage of the MD34 tag
  const view = new DataView(output.buffer)
  view.setUint32(4, 24, true) // index_offset
  view.setUint32(8, 1, true) // index_size
  view.setUint32(12, 1, true) // model reference entries
  view.setUint32(16, 0, true) // model reference index
  output.set(ascii('43DM'), 24)
  view.setUint32(28, 0, true) // section offset
  view.setUint32(32, 1, true) // repetitions
  view.setUint32(36, 11, true) // structure version
  return output
}

/** Storm's public MPQ crypt table and hash algorithm, used only to build deterministic tables. */
const MPQ_CRYPT_TABLE = (() => {
  let seed = 0x00100001
  const table = new Uint32Array(0x500)
  for (let slot = 0; slot < 0x100; slot += 1) {
    let index = slot
    for (let round = 0; round < 5; round += 1) {
      seed = (seed * 125 + 3) % 0x2aaaab
      const high = (seed & 0xffff) << 16
      seed = (seed * 125 + 3) % 0x2aaaab
      table[index] = (high | (seed & 0xffff)) >>> 0
      index += 0x100
    }
  }
  return table
})()

function mpqHash(input, type) {
  let seed1 = 0x7fed7fed
  let seed2 = 0xeeeeeeee
  for (const original of ascii(input)) {
    const value = original >= 0x61 && original <= 0x7a ? original - 0x20 : original
    seed1 = ((MPQ_CRYPT_TABLE[(type << 8) + value] ?? 0) ^ (seed1 + seed2)) >>> 0
    seed2 = (value + seed1 + seed2 + (seed2 << 5) + 3) >>> 0
  }
  return seed1 >>> 0
}

function mpqEncrypt(data, key) {
  const output = data.slice()
  const input = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const encrypted = new DataView(output.buffer, output.byteOffset, output.byteLength)
  let seed1 = key >>> 0
  let seed2 = 0xeeeeeeee
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    seed2 = (seed2 + (MPQ_CRYPT_TABLE[0x400 + (seed1 & 0xff)] ?? 0)) >>> 0
    const plain = input.getUint32(offset, true)
    encrypted.setUint32(offset, (plain ^ (seed1 + seed2)) >>> 0, true)
    seed1 = (((~seed1 << 21) + 0x11111111) | (seed1 >>> 11)) >>> 0
    seed2 = (plain + seed2 + (seed2 << 5) + 3) >>> 0
  }
  return output
}

/**
 * MPQ v0: one `(listfile)` plus one stored single-unit file. Hash and block tables are encrypted
 * exactly as Storm expects, so extraction exercises lookup and decryption rather than a fake walk.
 */
function mpq() {
  const listfile = ascii('hello.txt\n')
  const content = ascii('hello')
  const hashEntries = 8
  const blockEntries = 2
  const listOffset = 32
  const contentOffset = listOffset + listfile.byteLength
  const hashOffset = contentOffset + content.byteLength
  const blockOffset = hashOffset + hashEntries * 16
  const archiveBytes = blockOffset + blockEntries * 16

  const hashTable = new Uint8Array(hashEntries * 16)
  hashTable.fill(0xff)
  const hashView = new DataView(hashTable.buffer)
  const addHash = (name, blockIndex) => {
    const start = mpqHash(name, 0) % hashEntries
    for (let probe = 0; probe < hashEntries; probe += 1) {
      const slot = (start + probe) % hashEntries
      const offset = slot * 16
      if (hashView.getUint32(offset + 12, true) !== 0xffffffff) continue
      hashView.setUint32(offset, mpqHash(name, 1), true)
      hashView.setUint32(offset + 4, mpqHash(name, 2), true)
      hashView.setUint16(offset + 8, 0, true)
      hashView.setUint16(offset + 10, 0, true)
      hashView.setUint32(offset + 12, blockIndex, true)
      return
    }
    throw new RangeError('synthetic MPQ hash table is full')
  }
  addHash('(listfile)', 0)
  addHash('hello.txt', 1)

  const blockTable = new Uint8Array(blockEntries * 16)
  const blockView = new DataView(blockTable.buffer)
  const addBlock = (index, offset, size) => {
    const base = index * 16
    blockView.setUint32(base, offset, true)
    blockView.setUint32(base + 4, size, true)
    blockView.setUint32(base + 8, size, true)
    blockView.setUint32(base + 12, 0x81000000, true)
  }
  addBlock(0, listOffset, listfile.byteLength)
  addBlock(1, contentOffset, content.byteLength)

  const header = new Uint8Array(32)
  header.set(bytes(0x4d, 0x50, 0x51, 0x1a))
  const headerView = new DataView(header.buffer)
  headerView.setUint32(4, 32, true)
  headerView.setUint32(8, archiveBytes, true)
  headerView.setUint16(12, 0, true)
  headerView.setUint16(14, 3, true)
  headerView.setUint32(16, hashOffset, true)
  headerView.setUint32(20, blockOffset, true)
  headerView.setUint32(24, hashEntries, true)
  headerView.setUint32(28, blockEntries, true)

  return concat(
    header,
    listfile,
    content,
    mpqEncrypt(hashTable, mpqHash('(hash table)', 3)),
    mpqEncrypt(blockTable, mpqHash('(block table)', 3)),
  )
}

/** EA SAGE BIG4: one stored entry, with the mixed-endian header and null-terminated index path. */
function big() {
  const name = ascii('hello.txt\0')
  const content = ascii('hello')
  const dataOffset = 16 + 8 + name.byteLength
  const archiveBytes = dataOffset + content.byteLength
  return concat(
    ascii('BIG4'),
    u32le(archiveBytes),
    u32be(1),
    u32be(dataOffset),
    u32be(dataOffset),
    u32be(content.byteLength),
    name,
    content,
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

/** Microsoft AVI RIFF form: one uncompressed 1×1 video stream and one `00db` frame chunk. */
function avi() {
  const chunk = (id, payload) =>
    concat(
      ascii(id),
      u32le(payload.byteLength),
      payload,
      payload.byteLength % 2 === 0 ? new Uint8Array(0) : bytes(0),
    )
  const list = (type, ...children) => chunk('LIST', concat(ascii(type), ...children))

  const mainHeader = new Uint8Array(56)
  const main = new DataView(mainHeader.buffer)
  main.setUint32(0, 33_333, true) // dwMicroSecPerFrame: approximately 30 fps
  main.setUint32(4, 120, true) // dwMaxBytesPerSec
  main.setUint32(16, 1, true) // dwTotalFrames
  main.setUint32(24, 1, true) // dwStreams
  main.setUint32(28, 4, true) // dwSuggestedBufferSize
  main.setUint32(32, 1, true) // dwWidth
  main.setUint32(36, 1, true) // dwHeight

  const streamHeader = new Uint8Array(56)
  const stream = new DataView(streamHeader.buffer)
  streamHeader.set(ascii('vids'), 0)
  streamHeader.set(ascii('DIB '), 4)
  stream.setUint32(20, 1, true) // dwScale
  stream.setUint32(24, 30, true) // dwRate
  stream.setUint32(32, 1, true) // dwLength
  stream.setUint32(36, 4, true) // dwSuggestedBufferSize
  stream.setUint32(40, 0xffffffff, true) // dwQuality: default
  stream.setInt16(52, 1, true) // rcFrame.right
  stream.setInt16(54, 1, true) // rcFrame.bottom

  const bitmap = new Uint8Array(40)
  const bitmapView = new DataView(bitmap.buffer)
  bitmapView.setUint32(0, 40, true) // BITMAPINFOHEADER size
  bitmapView.setInt32(4, 1, true)
  bitmapView.setInt32(8, 1, true)
  bitmapView.setUint16(12, 1, true) // planes
  bitmapView.setUint16(14, 24, true) // RGB24
  bitmapView.setUint32(20, 4, true) // one DWORD-aligned scanline

  const headerList = list(
    'hdrl',
    chunk('avih', mainHeader),
    list('strl', chunk('strh', streamHeader), chunk('strf', bitmap)),
  )
  const movieList = list('movi', chunk('00db', bytes(0x20, 0x40, 0x80, 0x00)))
  const body = concat(ascii('AVI '), headerList, movieList)
  return concat(ascii('RIFF'), u32le(body.byteLength), body)
}

/** Microsoft ASF: mandatory Header/File/Stream/Header-Extension objects and an empty Data Object. */
function wmv() {
  const raw = value => new Uint8Array(Buffer.from(value, 'hex'))
  const object = (guid, payload) =>
    concat(raw(guid), u64le(BigInt(24 + payload.byteLength)), payload)
  const fileId = raw('00112233445566778899aabbccddeeff')
  const videoFormat = new Uint8Array(40)
  const formatView = new DataView(videoFormat.buffer)
  formatView.setUint32(0, 40, true)
  formatView.setInt32(4, 1, true)
  formatView.setInt32(8, 1, true)
  formatView.setUint16(12, 1, true)
  formatView.setUint16(14, 24, true)
  videoFormat.set(ascii('WMV3'), 16)
  formatView.setUint32(20, 4, true)
  const videoTypeData = concat(u32le(1), u32le(1), bytes(0), u16le(40), videoFormat)
  const streamProperties = object(
    '9107dcb7b7a9cf118ee600c00c205365',
    concat(
      raw('c0ef19bc4d5bcf11a8fd00805f5c442b'), // ASF_Video_Media
      raw('0057fb20555bcf11a8fd00805f5c442b'), // ASF_No_Error_Correction
      u64le(0n),
      u32le(videoTypeData.byteLength),
      u32le(0),
      u16le(1), // stream number 1, not encrypted
      u32le(0),
      videoTypeData,
    ),
  )
  const headerExtension = object(
    'b503bf5f2ea9cf118ee300c00c205365',
    concat(raw('11d2d3abbaa9cf118ee600c00c205365'), u16le(6), u32le(0)),
  )
  const headerSize = 30 + 104 + streamProperties.byteLength + headerExtension.byteLength
  const dataSize = 50
  const fileSize = headerSize + dataSize
  const fileProperties = object(
    'a1dcab8c47a9cf118ee400c00c205365',
    concat(
      fileId,
      u64le(BigInt(fileSize)),
      u64le(0n), // creation date
      u64le(0n), // data packet count
      u64le(0n), // play duration
      u64le(0n), // send duration
      u64le(0n), // preroll
      u32le(0), // flags
      u32le(0),
      u32le(0),
      u32le(0),
    ),
  )
  const header = concat(
    raw('3026b2758e66cf11a6d900aa0062ce6c'),
    u64le(BigInt(headerSize)),
    u32le(3),
    bytes(1, 2),
    fileProperties,
    streamProperties,
    headerExtension,
  )
  const data = object('3626b2758e66cf11a6d900aa0062ce6c', concat(fileId, u64le(0n), bytes(1, 1)))
  return concat(header, data)
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

/**
 * MPEG-1 Layer III mono silence, ISO/IEC 11172-3 §§2.4.1.2 and 2.4.2.7.
 *
 * The header selects 32 kbit/s at 44.1 kHz with no CRC and one channel. The frame-size formula is
 * floor(144 * bitrate / sampleRate) = 104 bytes. A mono Layer III frame has 17 side-information
 * bytes; keeping every field zero declares no scale-factor or Huffman data for either granule, so
 * the rest is legal ancillary zero data. Thirty-nine independent frames carry 44,928 samples —
 * 1.019 seconds — and require neither an encoder nor a bit reservoir from another frame.
 */
function mp3() {
  const frame = new Uint8Array(104)
  frame.set(bytes(0xff, 0xfb, 0x10, 0xc0))
  return concat(...Array.from({ length: 39 }, () => frame))
}

/**
 * RFC 8878 §3.1.1: one single-segment Zstandard frame containing one final Raw_Block. The
 * frame-content-size byte and block header both declare the exact six-byte payload.
 */
function zstd() {
  const payload = ascii('hello\n')
  const blockHeader = (payload.byteLength << 3) | 1 // Raw_Block and Last_Block
  return concat(
    bytes(0x28, 0xb5, 0x2f, 0xfd),
    bytes(0x20), // Single_Segment_Flag, one-byte Frame_Content_Size, no checksum or dictionary
    bytes(payload.byteLength),
    u24le(blockHeader),
    payload,
  )
}

/**
 * XZ file format 1.2.1: Check=None, one Block with one LZMA2 filter, and one uncompressed LZMA2
 * chunk. All four metadata CRC-32 values and the Index sizes are computed from their real bytes.
 */
function xz() {
  const payload = ascii('hello\n')
  const streamFlags = bytes(0, 0) // version zero and Check=None
  const streamHeader = concat(
    bytes(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00),
    streamFlags,
    u32le(crc32(streamFlags)),
  )
  const compressed = concat(
    bytes(0x01), // uncompressed LZMA2 chunk, reset dictionary
    u16be(payload.byteLength - 1),
    payload,
    bytes(0), // LZMA2 end marker
  )
  const blockHeaderWithoutCrc = bytes(
    2, // (12 / 4) - 1
    0xc0, // one filter; compressed and uncompressed sizes are present
    compressed.byteLength,
    payload.byteLength,
    0x21, // LZMA2 filter id
    1, // one property byte
    0, // 4 KiB dictionary property
    0, // header padding
  )
  const blockHeader = concat(blockHeaderWithoutCrc, u32le(crc32(blockHeaderWithoutCrc)))
  const blockPadding = new Uint8Array((4 - (compressed.byteLength % 4)) % 4)
  const unpaddedBlockSize = blockHeader.byteLength + compressed.byteLength
  const indexWithoutCrc = bytes(0, 1, unpaddedBlockSize, payload.byteLength)
  const index = concat(indexWithoutCrc, u32le(crc32(indexWithoutCrc)))
  const backwardAndFlags = concat(u32le(index.byteLength / 4 - 1), streamFlags)
  const footer = concat(u32le(crc32(backwardAndFlags)), backwardAndFlags, ascii('YZ'))
  return concat(streamHeader, blockHeader, compressed, blockPadding, index, footer)
}

/**
 * RAR 4.x stored archive: a plain main header, one method-0x30 file header and payload, and the
 * end marker. Header CRC fields are the low 16 bits of CRC-32 as used by the official UnRAR reader.
 */
function rar() {
  const payload = ascii('hello\n')
  const name = ascii('hello.txt')
  const header = (type, flags, body) => {
    const withoutCrc = concat(bytes(type), u16le(flags), u16le(7 + body.byteLength), body)
    return concat(u16le(crc32(withoutCrc) & 0xffff), withoutCrc)
  }
  const main = header(0x73, 0, new Uint8Array(6))
  const file = header(
    0x74,
    0x8000, // LONG_BLOCK: a stored data area follows the header
    concat(
      u32le(payload.byteLength),
      u32le(payload.byteLength),
      bytes(2), // HOST_WIN32
      u32le(crc32(payload)),
      u32le(0), // deterministic DOS timestamp
      bytes(20), // minimum unpack version
      bytes(0x30), // stored method
      u16le(name.byteLength),
      u32le(0x20), // archive attribute
      name,
    ),
  )
  const end = header(0x7b, 0x4000, new Uint8Array(0))
  return concat(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00), main, file, payload, end)
}

/**
 * RFC 7932 §11.1 trivial compressor: WBITS=22, one uncompressed meta-block, and a final empty
 * meta-block. The three length bytes are the specification's canonical encoding of len - 1.
 */
function brotli() {
  const payload = ascii('hello\n')
  const remaining = payload.byteLength - 1
  return concat(
    bytes(0x0c),
    bytes((remaining & 31) << 3, remaining >>> 5, 8 + (remaining >>> 13)),
    payload,
    bytes(0x03),
  )
}

/**
 * bzip2 1.0 stream for `hello\n`, emitted by 7-Zip 26.01's BZip2 encoder. BZip2 has no file-name
 * or timestamp fields, so the fixed stream is deterministic; its block and combined CRCs are real.
 */
function bzip2() {
  return bytes(
    0x42,
    0x5a,
    0x68,
    0x39,
    0x31,
    0x41,
    0x59,
    0x26,
    0x53,
    0x59,
    0xc1,
    0xc0,
    0x80,
    0xe2,
    0x00,
    0x00,
    0x01,
    0x41,
    0x00,
    0x00,
    0x10,
    0x02,
    0x44,
    0xa0,
    0x00,
    0x30,
    0xc0,
    0xc3,
    0x06,
    0x86,
    0xb8,
    0x5c,
    0x5d,
    0xc9,
    0x14,
    0xe1,
    0x42,
    0x43,
    0x07,
    0x02,
    0x03,
    0x88,
  )
}

/**
 * LZMA-alone stream for `hello\n`: property 0x5d (lc=3, lp=0, pb=2), 2 MiB dictionary, known
 * six-byte output size, and a genuine range-coded LZMA1 payload independently validated by 7-Zip.
 */
function lzma() {
  return bytes(
    0x5d,
    0x00,
    0x00,
    0x20,
    0x00,
    0x06,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x34,
    0x19,
    0x49,
    0xee,
    0x8d,
    0xdd,
    0x3d,
    0x3a,
    0xdf,
    0xff,
    0xff,
    0xdd,
    0x12,
    0x00,
    0x00,
  )
}

/**
 * Apple UDIF v4 image: one 512-byte raw data fork, an XML resource plist containing a `mish`
 * block table with one raw chunk and the terminator, then the required 512-byte `koly` trailer.
 */
function dmg() {
  const dataFork = new Uint8Array(512)
  dataFork.set(ascii('hello\n'))
  const blockTable = new Uint8Array(284)
  const blockView = new DataView(blockTable.buffer)
  blockTable.set(ascii('mish'), 0)
  blockView.setUint32(4, 1, false)
  blockTable.set(u64be(0n), 8) // start sector
  blockTable.set(u64be(1n), 16) // sector count
  blockTable.set(u64be(0n), 24) // data offset base
  blockView.setUint32(32, 1, false) // buffers needed
  blockView.setUint32(36, 2, false) // descriptors including terminator
  blockView.setUint32(200, 2, false) // entry count
  blockView.setUint32(204, 1, false) // raw block
  blockTable.set(u64be(0n), 212) // relative start sector
  blockTable.set(u64be(1n), 220) // sector count
  blockTable.set(u64be(0n), 228) // absolute data offset
  blockTable.set(u64be(512n), 236) // stored bytes
  blockView.setUint32(244, 0xffffffff, false) // terminator
  blockTable.set(u64be(1n), 252)
  blockTable.set(u64be(512n), 268)
  const blockData = Buffer.from(blockTable).toString('base64')
  const xml = ascii(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
      `<plist version="1.0"><dict><key>resource-fork</key><dict><key>blkx</key><array>` +
      `<dict><key>Attributes</key><string>0x0050</string><key>CFName</key>` +
      `<string>whole disk</string><key>Data</key><data>${blockData}</data><key>ID</key>` +
      `<string>0</string><key>Name</key><string>whole disk</string></dict>` +
      `</array></dict></dict></plist>\n`,
  )
  const trailer = new Uint8Array(512)
  const view = new DataView(trailer.buffer)
  trailer.set(ascii('koly'), 0)
  view.setUint32(4, 4, false) // UDIF version
  view.setUint32(8, 512, false) // trailer size
  view.setUint32(12, 1, false) // flat/raw data fork present
  trailer.set(u64be(0n), 16) // running data fork offset
  trailer.set(u64be(0n), 24) // data fork offset
  trailer.set(u64be(BigInt(dataFork.byteLength)), 32)
  view.setUint32(56, 1, false) // segment number
  view.setUint32(60, 1, false) // segment count
  trailer.set(u64be(BigInt(dataFork.byteLength)), 216) // XML plist offset
  trailer.set(u64be(BigInt(xml.byteLength)), 224)
  view.setUint32(488, 1, false) // raw/read-write image variant
  trailer.set(u64be(1n), 492) // one logical sector
  return concat(dataFork, xml, trailer)
}

/**
 * 7z format's SignatureHeader and raw Header grammar with one Folder, one official Copy coder,
 * one CRC-protected SubStream, and one regular UTF-16LE file. Every CRC covers its real field.
 */
function sevenZip() {
  const payload = ascii('hello\n')
  const name = 'hello.txt\0'
  const utf16Name = new Uint8Array(name.length * 2)
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    utf16Name[index * 2] = code & 0xff
    utf16Name[index * 2 + 1] = code >>> 8
  }
  const nextHeader = concat(
    bytes(0x01), // Header
    bytes(0x04), // MainStreamsInfo
    bytes(0x06, 0x00, 0x01, 0x09, payload.byteLength, 0x00), // one PackInfo stream
    bytes(0x07, 0x0b, 0x01, 0x00), // UnpackInfo, one inline Folder
    bytes(0x01, 0x01, 0x00), // one simple coder, one-byte Copy method id 00
    bytes(0x0c, payload.byteLength, 0x00), // CodersUnpackSize, end UnpackInfo
    bytes(0x08, 0x0a, 0x01), // SubStreamsInfo, all CRCs defined
    u32le(crc32(payload)),
    bytes(0x00, 0x00), // end SubStreamsInfo and MainStreamsInfo
    bytes(0x05, 0x01), // FilesInfo, one file
    bytes(0x11, 1 + utf16Name.byteLength, 0x00),
    utf16Name,
    bytes(0x15, 0x06, 0x01, 0x00), // Win32 attributes are defined and inline
    u32le(0x20),
    bytes(0x00, 0x00), // end FilesInfo and Header
  )
  const startHeader = concat(
    u64le(BigInt(payload.byteLength)),
    u64le(BigInt(nextHeader.byteLength)),
    u32le(crc32(nextHeader)),
  )
  return concat(
    bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04),
    u32le(crc32(startHeader)),
    startHeader,
    payload,
    nextHeader,
  )
}

/** CD-ROM XA Mode 2 Form 2: duplicated four-byte subheader, 2324 data bytes, and EDC. */
function ps1Xa() {
  const sector = new Uint8Array(2336)
  sector.set(bytes(1, 0, 0x64, 0, 1, 0, 0x64, 0)) // file 1, channel 0, audio/Form 2/real-time
  sector.set(ascii('hello\n'), 8)
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xd8018001 : 0)
    }
    table[index] = value >>> 0
  }
  let edc = 0
  for (const byte of sector.subarray(0, 2332)) {
    edc = ((edc >>> 8) ^ (table[(edc ^ byte) & 0xff] ?? 0)) >>> 0
  }
  sector.set(u32le(edc), 2332)
  return sector
}

/**
 * Stanford PLY 1.0 binary little-endian: three position/normal/UV vertices and one indexed face.
 * The header schema describes every following scalar, including the uchar list length.
 */
function ply() {
  const header = ascii(
    'ply\n' +
      'format binary_little_endian 1.0\n' +
      'comment generated by the Modkit X3 specification corpus\n' +
      'element vertex 3\n' +
      'property float x\nproperty float y\nproperty float z\n' +
      'property float nx\nproperty float ny\nproperty float nz\n' +
      'property float u\nproperty float v\n' +
      'element face 1\n' +
      'property list uchar int vertex_indices\n' +
      'end_header\n',
  )
  const vertex = (x, y, u, v) =>
    concat(f32le(x), f32le(y), f32le(0), f32le(0), f32le(0), f32le(1), f32le(u), f32le(v))
  return concat(
    header,
    vertex(0, 0, 0, 0),
    vertex(1, 0, 1, 0),
    vertex(0, 1, 0, 1),
    bytes(3),
    u32le(0),
    u32le(1),
    u32le(2),
  )
}

/** 3D Systems binary STL: one little-endian triangle record after the fixed 80-byte header. */
function stl() {
  const header = new Uint8Array(80)
  header.set(ascii('Modkit X3 binary STL triangle'))
  const point = (x, y, z) => concat(f32le(x), f32le(y), f32le(z))
  return concat(
    header,
    u32le(1),
    point(0, 0, 1),
    point(0, 0, 0),
    point(1, 0, 0),
    point(0, 1, 0),
    u16le(0),
  )
}

/** Wavefront Advanced Visualizer OBJ: one named, textured, normalled polygonal triangle. */
function obj() {
  return ascii(
    '# Modkit X3 specification corpus\n' +
      'o Triangle\n' +
      'v 0 0 0\n' +
      'v 1 0 0\n' +
      'v 0 1 0\n' +
      'vt 0 0\n' +
      'vt 1 0\n' +
      'vt 0 1\n' +
      'vn 0 0 1\n' +
      'f 1/1/1 2/2/1 3/3/1\n',
  )
}

/** COLLADA 1.4.1: one indexed triangle and one visual-scene instance. */
function dae() {
  return ascii(
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">\n' +
      '  <asset><up_axis>Y_UP</up_axis></asset>\n' +
      '  <library_geometries><geometry id="triangle" name="Triangle"><mesh>\n' +
      '    <source id="positions"><float_array id="position-values" count="9">0 0 0 1 0 0 0 1 0</float_array><technique_common><accessor source="#position-values" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>\n' +
      '    <vertices id="vertices"><input semantic="POSITION" source="#positions"/></vertices>\n' +
      '    <triangles count="1"><input semantic="VERTEX" source="#vertices" offset="0"/><p>0 1 2</p></triangles>\n' +
      '  </mesh></geometry></library_geometries>\n' +
      '  <library_visual_scenes><visual_scene id="scene"><node id="triangle-node"><instance_geometry url="#triangle"/></node></visual_scene></library_visual_scenes>\n' +
      '  <scene><instance_visual_scene url="#scene"/></scene>\n' +
      '</COLLADA>\n',
  )
}

/** Shared little-endian glTF geometry payload: float32 VEC3 positions and uint16 indices. */
function gltfTriangleBuffer() {
  return concat(
    f32le(0),
    f32le(0),
    f32le(0),
    f32le(1),
    f32le(0),
    f32le(0),
    f32le(0),
    f32le(1),
    f32le(0),
    u16le(0),
    u16le(1),
    u16le(2),
    u16le(0), // BIN padding
  )
}

function gltfTriangleDocument(buffer) {
  return {
    asset: { version: '2.0', generator: 'Modkit X3 specification corpus' },
    buffers: [{ byteLength: buffer.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ name: 'Triangle', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ name: 'Triangle', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
}

/** glTF 2.0 JSON with a specification-valid embedded base64 buffer. */
function gltf() {
  const buffer = gltfTriangleBuffer()
  const encoded = Buffer.from(buffer).toString('base64')
  return ascii(`{
  "asset": { "version": "2.0", "generator": "Modkit X3 specification corpus" },
  "buffers": [
    {
      "byteLength": ${buffer.byteLength},
      "uri": "data:application/octet-stream;base64,${encoded}"
    }
  ],
  "bufferViews": [
    { "buffer": 0, "byteOffset": 0, "byteLength": 36, "target": 34962 },
    { "buffer": 0, "byteOffset": 36, "byteLength": 6, "target": 34963 }
  ],
  "accessors": [
    {
      "bufferView": 0,
      "componentType": 5126,
      "count": 3,
      "type": "VEC3",
      "min": [0, 0, 0],
      "max": [1, 1, 0]
    },
    { "bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR" }
  ],
  "meshes": [
    { "name": "Triangle", "primitives": [{ "attributes": { "POSITION": 0 }, "indices": 1 }] }
  ],
  "nodes": [{ "name": "Triangle", "mesh": 0 }],
  "scenes": [{ "nodes": [0] }],
  "scene": 0
}
`)
}

/** UVM/core 1.0 stored in its normative GLB carrier with a decoded triangle. */
function uvm() {
  const binary = gltfTriangleBuffer()
  const document = gltfTriangleDocument(binary)
  document.asset.extras = { uv: { format: 'UVM', version: '1.0', profile: 'core' } }
  document.extensionsUsed = ['UV_asset', 'UV_provenance']
  document.extensions = {
    UV_asset: { id: 'urn:modkitx:fixture:triangle', class: 'model' },
    UV_provenance: {
      source: { format: 'synthetic-triangle' },
      importer: { id: 'org.modkitx.testkit', version: '1.0.0' },
    },
  }
  const unpaddedJson = JSON.stringify(document)
  const json = ascii(unpaddedJson + ' '.repeat((4 - (unpaddedJson.length % 4)) % 4))
  const totalLength = 12 + 8 + json.byteLength + 8 + binary.byteLength
  return concat(
    ascii('glTF'),
    u32le(2),
    u32le(totalLength),
    u32le(json.byteLength),
    u32le(0x4e4f534a),
    json,
    u32le(binary.byteLength),
    u32le(0x004e4942),
    binary,
  )
}

/** RFC 4180 CSV: CRLF records, doubled quotes, and a CRLF embedded in a quoted field. */
function csv() {
  return ascii(
    'name,quote,note\r\nAlice,"Hello, ""world""",first\r\nBob,"line one\r\nline two",second\r\n',
  )
}

/** CommonMark source exercising headings, a link, a list, and a fenced code block. */
function markdown() {
  return ascii(
    '# Port Plan\n\nSee [spec](https://example.invalid/spec).\n\n- Parse\n- Validate\n\n## Proof\n\n```js\nconst ready = true\n```\n',
  )
}

/** RTF 1.x root with a font-table group, outline control, section, and paragraphs. */
function rtf() {
  return ascii(
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\sectd\\outlinelevel0 Port report\\par Ready\\par}',
  )
}

/** UTF-8-compatible plain text with two paragraphs and CRLF line endings. */
function txt() {
  return ascii('First paragraph.\r\nStill first.\r\n\r\nSecond paragraph.\r\n')
}

// ---------------------------------------------------------------- the corpus

/** Every fixture: file name → builder. The name is what the acceptance corpus refers to. */
const FIXTURES = {
  'minimal.ai': ai,
  'minimal.ani': ani,
  'minimal.astc': astc,
  'minimal.avi': avi,
  'minimal.avif': avif,
  'minimal.big': big,
  'minimal.blend': blend,
  'minimal.bmp': bmp,
  'minimal.br': brotli,
  'minimal.bz2': bzip2,
  'minimal.cab': cab,
  'minimal.cdr': cdr,
  'minimal.cur': cur,
  'minimal.dds': dds,
  'minimal.dae': dae,
  'minimal.dmg': dmg,
  'minimal.docx': docx,
  'minimal.drawio': drawio,
  'minimal.exr': exr,
  'minimal.fig': figma,
  'minimal-kiwi.fig': figmaCanvas,
  'minimal.gif': gif,
  'minimal.gltf': gltf,
  'minimal.hdr': hdr,
  'minimal.ico': ico,
  'minimal.iso': iso,
  'minimal.ktx': ktx,
  'minimal.lzma': lzma,
  'minimal.md': markdown,
  'minimal.pkm': pkm,
  'minimal.pal': pal,
  'minimal.pcx': pcx,
  'minimal.exe': pe,
  'minimal.pvr': pvr,
  'minimal.cue': ps1Cue,
  'minimal.csv': csv,
  'minimal.bin': ps1Bin,
  'minimal.7z': sevenZip,
  'minimal.rar': rar,
  'minimal.rtf': rtf,
  'minimal.tga': tga,
  'minimal.tiff': tiff,
  'minimal.txt': txt,
  'minimal.uvm.glb': uvm,
  'minimal.vsd': visioVsd,
  'minimal.vsdx': visioVsdx,
  'minimal.wav': wav,
  'minimal.m3': m3,
  'minimal.obj': obj,
  'minimal.ply': ply,
  'minimal.psd': psd,
  'minimal.pdf': pdf,
  'minimal.pptx': pptx,
  'minimal.stl': stl,
  'minimal.mpq': mpq,
  'minimal.tar': tar,
  'minimal.gz': gz,
  'minimal.zip': zip,
  'minimal.png': png,
  'minimal.flv': flv,
  'minimal.mp3': mp3,
  'minimal.ogg': ogg,
  'minimal.odp': odp,
  'minimal.ods': ods,
  'minimal.odt': odt,
  'minimal.opus': opus,
  'minimal.ogv': ogv,
  'minimal.xa': ps1Xa,
  'minimal.mp4': mp4,
  'minimal.mpg': mpeg,
  'minimal.webm': webm,
  'minimal.wmv': wmv,
  'minimal.xz': xz,
  'minimal.xlsx': xlsx,
  'minimal.zst': zstd,
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

const webMp3 = built.get('minimal.mp3')
if (webMp3 === undefined) throw new TypeError('the MP3 builder is missing')
const existingWebMp3 = statSync(webMp3Path, { throwIfNoEntry: false })?.isFile()
  ? new Uint8Array(readFileSync(webMp3Path))
  : undefined
const webMp3Changed = mirrorsWebMp3 && !sameBytes(existingWebMp3, webMp3)
const total =
  drift.added.length + drift.changed.length + drift.removed.length + (webMp3Changed ? 1 : 0)

if (checkOnly) {
  if (total > 0) {
    console.error(`gen-synthetic-corpus --check: ${total} fixture(s) differ from the generator:`)
    for (const name of drift.added) console.error(`  + ${name}`)
    for (const name of drift.changed) console.error(`  ~ ${name}`)
    for (const name of drift.removed) console.error(`  - ${name}`)
    if (webMp3Changed) console.error('  ~ apps/web/public/samples/sample.mp3')
    process.exit(1)
  }
  if (!quiet) console.log(`gen-synthetic-corpus --check: clean (${built.size} fixture(s))`)
} else {
  mkdirSync(outRoot, { recursive: true })
  for (const name of drift.removed) rmSync(join(outRoot, name), { force: true })
  for (const name of [...drift.added, ...drift.changed]) {
    writeFileSync(join(outRoot, name), built.get(name))
  }
  if (webMp3Changed) {
    mkdirSync(dirname(webMp3Path), { recursive: true })
    writeFileSync(webMp3Path, webMp3)
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
