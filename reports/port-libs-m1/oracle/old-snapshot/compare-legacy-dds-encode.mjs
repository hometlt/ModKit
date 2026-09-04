/**
 * Legacy (MK2) vs MK3 DDS *encoding*, byte for byte.
 *
 * Legacy: `references/modkitmk2/extensions/common/images/codecs/dds/src/dds.ts` → `encodeDds`,
 * plus the three authoring entry points in `.../helpers.ts` (`chooseDdsFormatForImage`,
 * `createRgbaImage`, `createDdsImage`).
 * MK3: `modkit-core/extensions/images/src/dds/encode.js`, same names.
 *
 * The rasters fed to both encoders are real: every sampled corpus file is decoded by the legacy
 * decoder and the resulting pixels are re-encoded in all four formats legacy could write
 * (`rgba8`, `dxt1`, `dxt3`, `dxt5`). Whole-file comparison, header included — a difference of one
 * flag bit fails just as loudly as a difference of one block.
 *
 *   node --experimental-strip-types artifacts/legacy-parity-textures/compare-legacy-dds-encode.mjs \
 *     --corpus "C:/FILES/SC2Files/Mods" [--cap 20]
 */
import { readFile, readdir, open as openFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { codingRoot, loadLegacy } from './legacy-mk2.mjs'

const argv = process.argv.slice(2)
const roots = argv.flatMap((value, index) => (value === '--corpus' ? [argv[index + 1]] : []))
const capIndex = argv.indexOf('--cap')
const CAP = capIndex < 0 ? 20 : Number(argv[capIndex + 1])
if (roots.length === 0) throw new Error('no corpus: pass --corpus <dir>')

const legacy = await loadLegacy({ wasm: false })
const mk3 = await import(
  pathToFileURL(path.join(codingRoot, 'modkit-core/extensions/images/src/dds/encode.js')).href
)

const FORMATS = ['rgba8', 'dxt1', 'dxt3', 'dxt5']

const verdicts = new Map()
let compared = 0
let identical = 0
let mismatched = 0
function note(key, example) {
  if (!verdicts.has(key)) verdicts.set(key, { count: 0, example })
  verdicts.get(key).count += 1
}

function firstDifference(left, right) {
  if (left.length !== right.length) return `length ${left.length} vs ${right.length}`
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return `byte ${index}: 0x${left[index].toString(16)} vs 0x${right[index].toString(16)}`
    }
  }
  return null
}

function compare(label, left, right, example) {
  compared += 1
  const difference = firstDifference(left, right)
  if (difference === null) {
    identical += 1
    note(`${label} :: IDENTICAL`, example)
    return
  }
  mismatched += 1
  note(`${label} :: DIFFERS ${difference}`, example)
}

async function* walk(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dds')) yield full
  }
}

/** Bucket by declared pixel format, so the sample spans every variant the corpus holds. */
async function bucketOf(file) {
  let handle
  try {
    handle = await openFile(file, 'r')
    const buffer = Buffer.alloc(148)
    const { bytesRead } = await handle.read(buffer, 0, 148, 0)
    if (bytesRead < 128) return null
    const view = new DataView(buffer.buffer, buffer.byteOffset, bytesRead)
    if (view.getUint32(0, true) !== 0x2053_4444) return null
    const flags = view.getUint32(80, true)
    if ((flags & 0x4) !== 0) {
      const code = String.fromCharCode(
        view.getUint8(84),
        view.getUint8(85),
        view.getUint8(86),
        view.getUint8(87),
      )
      return code === 'DX10' ? `DX10:${view.getUint32(128, true)}` : `FOURCC:${code}`
    }
    if ((flags & 0x40) !== 0) return `RGB:${view.getUint32(88, true)}`
    if ((flags & 0x2_0000) !== 0) return `LUMINANCE:${view.getUint32(88, true)}`
    if ((flags & 0x2) !== 0) return `ALPHA:${view.getUint32(88, true)}`
    return null
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

const buckets = new Map()
for (const root of roots) {
  for await (const file of walk(root)) {
    const bucket = await bucketOf(file)
    if (bucket === null) continue
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    const list = buckets.get(bucket)
    if (list.length < CAP) list.push(file)
  }
}

for (const [bucket, files] of [...buckets.entries()].sort()) {
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(file))
    let raster
    try {
      raster = legacy.dds.decodeDds(bytes)
    } catch {
      continue
    }
    /* Very large rasters make the sweep quadratic in wall time without adding a distinct path. */
    if (raster.width * raster.height > 512 * 512) continue
    const name = path.basename(file)
    for (const format of FORMATS) {
      compare(
        `${bucket} encodeDds ${format}`,
        legacy.dds.encodeDds(raster, { format }),
        mk3.encodeDds(raster, { format }),
        name,
      )
    }
    /* The mip-count header field, which legacy wrote without writing extra levels. */
    compare(
      `${bucket} encodeDds dxt5 mipMapCount=4`,
      legacy.dds.encodeDds(raster, { format: 'dxt5', mipMapCount: 4 }),
      mk3.encodeDds(raster, { format: 'dxt5', mipMapCount: 4 }),
      name,
    )
    const legacyChoice = legacy.helpers.chooseDdsFormatForImage(raster)
    const mk3Choice = mk3.chooseDdsFormatForImage(raster)
    compared += 1
    if (legacyChoice === mk3Choice) {
      identical += 1
      note(`${bucket} chooseDdsFormatForImage :: IDENTICAL (${legacyChoice})`, name)
    } else {
      mismatched += 1
      note(`${bucket} chooseDdsFormatForImage :: DIFFERS ${legacyChoice} vs ${mk3Choice}`, name)
    }
  }
}

/* The authoring entry points, which take no corpus: a sweep over sizes, fills and formats. */
for (const [width, height] of [
  [1, 1],
  [4, 4],
  [7, 5],
  [64, 32],
]) {
  for (const fill of [
    undefined,
    { r: 0, g: 0, b: 0, a: 0 },
    { r: 255, g: 128, b: 3, a: 255 },
    { r: 12, g: 200, b: 90, a: 127 },
    { r: -5, g: 300, b: 1.6, a: Number.NaN },
  ]) {
    compare(
      `authoring createRgbaImage ${width}x${height}`,
      legacy.helpers.createRgbaImage(width, height, fill).pixels,
      mk3.createRgbaImage(width, height, fill).pixels,
      JSON.stringify(fill),
    )
    for (const format of ['auto', ...FORMATS]) {
      compare(
        `authoring createDdsImage ${width}x${height} ${format}`,
        legacy.helpers.createDdsImage(width, height, { fill, format }),
        mk3.createDdsImage(width, height, { fill, format }),
        JSON.stringify(fill),
      )
    }
  }
}

/* Both must refuse the same non-encodable formats and the same malformed rasters. */
for (const [label, run] of [
  ['bc4', () => ({ format: 'bc4' })],
  ['bc5', () => ({ format: 'bc5' })],
  ['bc6h', () => ({ format: 'bc6h' })],
  ['bc7', () => ({ format: 'bc7' })],
  ['uncompressed', () => ({ format: 'uncompressed' })],
]) {
  const image = { width: 4, height: 4, pixels: new Uint8Array(64) }
  const refused = source => {
    try {
      source()
      return 'accepted'
    } catch (error) {
      return `refused: ${error.message}`
    }
  }
  const left = refused(() => legacy.dds.encodeDds(image, run()))
  const right = refused(() => mk3.encodeDds(image, run()))
  compared += 1
  if (left === right) {
    identical += 1
    note(`refusal encodeDds ${label} :: IDENTICAL (${left})`, label)
  } else {
    mismatched += 1
    note(`refusal encodeDds ${label} :: DIFFERS "${left}" vs "${right}"`, label)
  }
}
for (const [label, image] of [
  ['short payload', { width: 4, height: 4, pixels: new Uint8Array(60) }],
  ['zero width', { width: 0, height: 4, pixels: new Uint8Array(0) }],
  ['fractional height', { width: 4, height: 1.5, pixels: new Uint8Array(24) }],
]) {
  const refused = source => {
    try {
      source()
      return 'accepted'
    } catch (error) {
      return `refused: ${error.message}`
    }
  }
  const left = refused(() => legacy.dds.encodeDds(image, { format: 'dxt1' }))
  const right = refused(() => mk3.encodeDds(image, { format: 'dxt1' }))
  compared += 1
  if (left === right) {
    identical += 1
    note(`refusal encodeDds ${label} :: IDENTICAL`, label)
  } else {
    mismatched += 1
    note(`refusal encodeDds ${label} :: DIFFERS "${left}" vs "${right}"`, label)
  }
}

console.log('--- legacy MK2 encodeDds vs MK3 dds/encode.js, whole files ---')
for (const [key, { count, example }] of [...verdicts.entries()].sort()) {
  console.log(`${String(count).padStart(5)}  ${key}`)
  if (key.includes('DIFFERS')) console.log(`         e.g. ${example}`)
}
console.log(`\ncompared ${compared} case(s): ${identical} byte-identical, ${mismatched} differing`)
process.exitCode = mismatched === 0 && identical > 0 ? 0 : 1
