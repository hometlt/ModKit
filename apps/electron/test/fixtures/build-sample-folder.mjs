/**
 * Assemble the folder the renderer self-test opens: one sample per stage the app can mount.
 *
 *   node apps/electron/test/fixtures/build-sample-folder.mjs <target-directory>
 *
 * Real bytes wherever the repository already has them (`packages/testkit/test/fixtures`, the theme
 * screenshots), synthesised only where a tiny valid file is trivially producible (SVG, OBJ, the
 * text formats, a store-only ZIP). Nothing here is a codec fixture: these files exist to prove the
 * *host* mounts every viewer, so "minimal and valid" is the whole requirement.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..', '..')
const synthetic = join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic')

const CRC_TABLE = (() => {
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

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xffffffff) >>> 0
}

/** A store-only (method 0) ZIP — the smallest thing the archive codec accepts as real. */
function buildZip(entries) {
  const encoder = new TextEncoder()
  const locals = []
  const central = []
  let offset = 0
  for (const [name, text] of entries) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(text)
    const crc = crc32(data)
    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    Buffer.from(nameBytes).copy(local, 30)

    const header = Buffer.alloc(46 + nameBytes.length)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt32LE(0, 8)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(nameBytes.length, 28)
    header.writeUInt32LE(offset, 42)
    Buffer.from(nameBytes).copy(header, 46)

    locals.push(local, Buffer.from(data))
    central.push(header)
    offset += local.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** EBML element: the id bytes already carry their own length marker; the size is a vint. */
function ebml(id, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  let size
  if (body.length < 0x7f) size = Buffer.from([0x80 | body.length])
  else if (body.length < 0x3fff) size = Buffer.from([0x40 | (body.length >> 8), body.length & 0xff])
  else {
    size = Buffer.from([0x20 | (body.length >> 16), (body.length >> 8) & 0xff, body.length & 0xff])
  }
  return Buffer.concat([Buffer.from(id), size, body])
}

const uint = value => {
  const bytes = []
  let rest = value
  do {
    bytes.unshift(rest & 0xff)
    rest = Math.floor(rest / 256)
  } while (rest > 0)
  return Buffer.from(bytes)
}

/**
 * A well-formed Matroska/WebM header with one VP9 video track and no clusters.
 *
 * The repository ships no playable video, and the synthetic corpus carries signatures only, which
 * the WebM codec rejects (`WebM has no supported video track`). This is a real EBML document of
 * exactly the class an inspection codec reads — headers — so the stage mounts over real track
 * facts; the platform player then reports honestly that there are no frames to play.
 */
function buildWebm() {
  const header = ebml(
    [0x1a, 0x45, 0xdf, 0xa3],
    Buffer.concat([
      ebml([0x42, 0x86], uint(1)),
      ebml([0x42, 0xf7], uint(1)),
      ebml([0x42, 0xf2], uint(4)),
      ebml([0x42, 0xf3], uint(8)),
      ebml([0x42, 0x82], Buffer.from('webm', 'latin1')),
      ebml([0x42, 0x87], uint(2)),
      ebml([0x42, 0x85], uint(2)),
    ]),
  )
  const info = ebml(
    [0x15, 0x49, 0xa9, 0x66],
    Buffer.concat([
      ebml([0x2a, 0xd7, 0xb1], uint(1_000_000)),
      ebml([0x4d, 0x80], Buffer.from('modkit-lab', 'latin1')),
      ebml([0x57, 0x41], Buffer.from('modkit-lab', 'latin1')),
    ]),
  )
  const track = ebml(
    [0xae],
    Buffer.concat([
      ebml([0xd7], uint(1)),
      ebml([0x73, 0xc5], uint(1)),
      ebml([0x83], uint(1)),
      ebml([0x86], Buffer.from('V_VP9', 'latin1')),
      ebml([0xe0], Buffer.concat([ebml([0xb0], uint(16)), ebml([0xba], uint(16))])),
    ]),
  )
  const tracks = ebml([0x16, 0x54, 0xae, 0x6b], track)
  return Buffer.concat([header, ebml([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks]))])
}

/**
 * One MPEG-1 Layer III frame: `FF FB 90 64` is 44.1 kHz, 128 kbps, joint stereo, and 417 bytes is
 * that frame's exact length. The payload is silence-shaped padding — enough for the codec's header
 * parser, which is what publishes the audio and transport sources.
 */
function buildMp3(frames = 24) {
  const frame = Buffer.alloc(417)
  Buffer.from([0xff, 0xfb, 0x90, 0x64]).copy(frame, 0)
  return Buffer.concat(Array.from({ length: frames }, () => frame))
}

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect x="4" y="4" width="56" height="56" fill="#204060" />
  <circle cx="32" cy="32" r="18" fill="#b6f04a" />
  <path d="M8 56 L32 20 L56 56 Z" fill="none" stroke="#f0a02a" stroke-width="3" />
</svg>
`

const OBJ = `# sample triangle
v 0.0 0.0 0.0
v 1.0 0.0 0.0
v 0.0 1.0 0.0
vn 0.0 0.0 1.0
f 1//1 2//1 3//1
`

const FILES = [
  [
    'sample.json',
    JSON.stringify({ name: 'sample', items: [1, 2, 3], nested: { ok: true } }, null, 2),
  ],
  ['sample.csv', 'id,name,size\n1,alpha,10\n2,beta,20\n3,gamma,30\n'],
  ['sample.ini', '[section]\nkey = value\nother = 2\n'],
  [
    'sample.md',
    '# Sample\n\nA paragraph with a [link](https://example.invalid).\n\n- one\n- two\n',
  ],
  ['sample.xml', '<?xml version="1.0"?>\n<root><child id="1">text</child></root>\n'],
  ['sample.yaml', 'name: sample\nitems:\n  - one\n  - two\n'],
  ['sample.toml', 'title = "sample"\n\n[owner]\nname = "lab"\n'],
  ['sample.svg', SVG],
  ['sample.obj', OBJ],
  ['sample.txt', 'Plain text with no codec: the built-in text/hex fallback shows this.\n'],
  ['savetest.txt', 'original text'],
]

const COPIES = [
  ['sample.png', join(synthetic, 'minimal.png')],
  ['sample.jpg', join(repoRoot, 'assets', 'themes', 'nexus-forge', 'preview-electron.jpg')],
]

const BINARIES = [
  ['sample.mp3', buildMp3()],
  ['sample.webm', buildWebm()],
  // Claimed by nothing: proves the built-in hex fallback and the hex editing probe.
  ['unknown.bin', Buffer.from([0, 1, 2, 3, 250, 251, 252, 253])],
]

export function buildSampleFolder(target) {
  const directory = resolve(target)
  mkdirSync(directory, { recursive: true })
  for (const [name, text] of FILES) writeFileSync(join(directory, name), text, 'utf8')
  for (const [name, from] of COPIES) copyFileSync(from, join(directory, name))
  for (const [name, bytes] of BINARIES) writeFileSync(join(directory, name), bytes)

  // The UVM fixture is a real GLB carried as base64 so the repository stays text-only there.
  const glb = readFileSync(
    join(
      repoRoot,
      'packages',
      'testkit',
      'test',
      'fixtures',
      'uvm',
      'm3-native-triangle.uvm.glb.b64',
    ),
    'utf8',
  )
  writeFileSync(join(directory, 'sample.uvm.glb'), Buffer.from(glb.trim(), 'base64'))

  writeFileSync(
    join(directory, 'sample.zip'),
    buildZip([
      ['readme.txt', 'An entry the archive stage previews as text.\n'],
      ['data/values.csv', 'a,b\n1,2\n'],
    ]),
  )

  const names = [
    ...FILES.map(([name]) => name),
    ...COPIES.map(([name]) => name),
    ...BINARIES.map(([name]) => name),
    'sample.uvm.glb',
    'sample.zip',
  ].sort()
  return { directory, names }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const target = process.argv[2]
  if (target === undefined) {
    process.stderr.write('usage: build-sample-folder.mjs <target-directory>\n')
    process.exitCode = 1
  } else {
    const result = buildSampleFolder(target)
    const digest = createHash('sha256').update(result.names.join('\n')).digest('hex').slice(0, 12)
    process.stdout.write(`${result.names.length} samples in ${result.directory} (${digest})\n`)
  }
}
