import { loadMk3Reference } from '../legacy-oracle/mk3-reference.mjs'
import { trackedReadFile as readFile } from '../legacy-oracle/track-corpus.mjs'
/** Pinned MK2 vs MK3 parity. Universal loader: step 0.3; original harness in M1 old-snapshot.
 * --corpus is required for real files; original default caps and synthetic cases are unchanged.
 */
import { readdir, open as openFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { codingRoot, loadLegacy } from './legacy-mk2.mjs'

const argv = process.argv.slice(2)
const roots = argv.flatMap((value, index) => (value === '--corpus' ? [argv[index + 1]] : []))
const capIndex = argv.indexOf('--cap')
const CAP = capIndex < 0 ? 15 : Number(argv[capIndex + 1])

const legacy = await loadLegacy({ wasm: false })
const mk3 = await loadMk3Reference('ops/raster-ops.js', path.join(codingRoot, 'modkit-core/extensions/images/src/ops/raster-ops.js'))

const verdicts = new Map()
let compared = 0
let identical = 0
let mismatched = 0
function note(key, example) {
  if (!verdicts.has(key)) verdicts.set(key, { count: 0, example })
  verdicts.get(key).count += 1
}

/**
 * Compare one operation on both sides, whether it returns or throws.
 *
 * Some option combinations are invalid — an inner size larger than the final size, for instance —
 * and legacy throws for them. Refusing identically is parity too, so the thunk form captures the
 * error instead of letting it end the run.
 */
function compareOp(label, leftThunk, rightThunk, example) {
  const run = thunk => {
    try {
      return { value: thunk() }
    } catch (error) {
      return { error: `${error.constructor.name}: ${error.message}` }
    }
  }
  const left = run(leftThunk)
  const right = run(rightThunk)
  if (left.error !== undefined || right.error !== undefined) {
    compared += 1
    /* Only the message is compared: MK3 throws TypeError where legacy threw a bare Error. */
    const leftMessage = left.error?.replace(/^\w+: /u, '')
    const rightMessage = right.error?.replace(/^\w+: /u, '')
    if (leftMessage === rightMessage) {
      identical += 1
      note(`${label} :: BOTH-REFUSED (${leftMessage})`, example)
    } else {
      mismatched += 1
      note(`${label} :: REFUSAL-DIFFERS "${left.error}" vs "${right.error}"`, example)
    }
    return
  }
  compareImages(label, left.value, right.value, example)
}

function compareImages(label, left, right, example) {
  compared += 1
  if (left.width !== right.width || left.height !== right.height) {
    mismatched += 1
    note(`${label} :: SIZE ${left.width}x${left.height} vs ${right.width}x${right.height}`, example)
    return
  }
  for (let index = 0; index < left.pixels.length; index += 1) {
    if (left.pixels[index] !== right.pixels[index]) {
      mismatched += 1
      note(
        `${label} :: DIFFERS byte ${index}: ${left.pixels[index]} vs ${right.pixels[index]}`,
        example,
      )
      return
    }
  }
  identical += 1
  note(`${label} :: IDENTICAL`, example)
}

/** Run every operation on one raster and compare each result. */
function sweep(prefix, image, partner, example) {
  const half = [Math.max(1, image.width >> 1), Math.max(1, image.height >> 1)]
  const grow = [image.width + 3, image.height + 5]
  for (const [width, height] of [[image.width, image.height], half, grow, [1, 1], [7, 3]]) {
    compareOp(
      `${prefix} resizeRgba -> ${width}x${height}`,
      () => legacy.ops.resizeRgba(image, width, height),
      () => mk3.resizeRgba(image, width, height),
      example,
    )
  }
  compareOp(
    `${prefix} convertNormalMapToSc2`,
    () => legacy.ops.convertNormalMapToSc2(image),
    () => mk3.convertNormalMapToSc2(image),
    example,
  )
  compareOp(
    `${prefix} combineNormalSpecular`,
    () => legacy.ops.combineNormalSpecular(image, partner),
    () => mk3.combineNormalSpecular(image, partner),
    example,
  )
  for (const radius of [0, 1, 4, 16, Math.min(image.width, image.height)]) {
    compareOp(
      `${prefix} applyRoundedAlpha r=${radius}`,
      () => legacy.ops.applyRoundedAlpha(image, radius),
      () => mk3.applyRoundedAlpha(image, radius),
      example,
    )
  }
  for (const options of [
    {},
    { finalSize: 128 },
    { finalWidth: 64, finalHeight: 48 },
    { innerSize: 30, radius: 7 },
    { framePercent: 0.2 },
    { finalSize: 33, innerWidth: 11, innerHeight: 9, radius: 3 },
  ]) {
    compareOp(
      `${prefix} prepareSc2ButtonIcon ${JSON.stringify(options)}`,
      () => legacy.ops.prepareSc2ButtonIcon(image, options),
      () => mk3.prepareSc2ButtonIcon(image, options),
      example,
    )
  }
  for (const options of [
    { target: { r: 255, g: 0, b: 255 } },
    { target: { r: 0, g: 0, b: 0 }, tolerance: 8 },
    {
      target: { r: 128, g: 128, b: 128 },
      tolerance: 200,
      replacement: { r: 1, g: 2, b: 3, a: 4 },
    },
  ]) {
    compareOp(
      `${prefix} applyColorKeyTransparency ${JSON.stringify(options)}`,
      () => legacy.ops.applyColorKeyTransparency(image, options),
      () => mk3.applyColorKeyTransparency(image, options),
      example,
    )
  }
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
  let previous
  for (const file of files) {
    let raster
    try {
      raster = legacy.dds.decodeDds(new Uint8Array(await readFile(file)))
    } catch {
      continue
    }
    if (raster.width * raster.height > 256 * 256) continue
    sweep(bucket, raster, previous ?? raster, path.basename(file))
    previous = raster
  }
}

/* Synthetic rasters: the shapes and channel extremes the corpus does not happen to contain. */
function synthetic(width, height, seed) {
  let state = seed >>> 0
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length; index += 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    pixels[index] = state >>> 24
  }
  return { width, height, pixels }
}

for (const [width, height] of [
  [1, 1],
  [1, 9],
  [9, 1],
  [3, 3],
  [17, 5],
  [64, 64],
  [128, 128],
]) {
  sweep(
    `synthetic ${width}x${height}`,
    synthetic(width, height, 0x1234 + width * 31 + height),
    synthetic(Math.max(1, width >> 1), Math.max(1, height >> 1), 0x99),
    `${width}x${height}`,
  )
}
for (const [label, value] of [
  ['opaque', 255],
  ['transparent', 0],
  ['mid', 128],
]) {
  const image = synthetic(12, 8, 7)
  for (let index = 3; index < image.pixels.length; index += 4) image.pixels[index] = value
  sweep(`synthetic alpha=${label}`, image, image, label)
}

/* Both sides must refuse a raster whose pixel buffer does not match its declared size. */
const refused = source => {
  try {
    source()
    return 'accepted'
  } catch (error) {
    return `refused: ${error.message}`
  }
}
const malformed = { width: 4, height: 4, pixels: new Uint8Array(60) }
for (const [label, run] of [
  ['resizeRgba', target => target.resizeRgba(malformed, 2, 2)],
  ['convertNormalMapToSc2', target => target.convertNormalMapToSc2(malformed)],
  ['applyRoundedAlpha', target => target.applyRoundedAlpha(malformed, 2)],
  ['prepareSc2ButtonIcon', target => target.prepareSc2ButtonIcon(malformed)],
  [
    'applyColorKeyTransparency',
    target => target.applyColorKeyTransparency(malformed, { target: { r: 0, g: 0, b: 0 } }),
  ],
]) {
  const left = refused(() => run(legacy.ops))
  const right = refused(() => run(mk3))
  compared += 1
  if (left === right) {
    identical += 1
    note(`refusal ${label} :: IDENTICAL (${left})`, label)
  } else {
    mismatched += 1
    note(`refusal ${label} :: DIFFERS "${left}" vs "${right}"`, label)
  }
}

console.log('--- legacy MK2 ops.ts vs MK3 ops/raster-ops.js ---')
const summary = new Map()
for (const [key, { count, example }] of [...verdicts.entries()].sort()) {
  const verdict = key.slice(key.indexOf(' :: ') + 4).split(' ')[0]
  summary.set(verdict, (summary.get(verdict) ?? 0) + count)
  if (verdict !== 'IDENTICAL') console.log(`${String(count).padStart(5)}  ${key}  e.g. ${example}`)
}
for (const [verdict, count] of [...summary.entries()].sort()) {
  console.log(`${String(count).padStart(6)}  ${verdict}`)
}
console.log(`\ncompared ${compared} case(s): ${identical} byte-identical, ${mismatched} differing`)
process.exitCode = mismatched === 0 && identical > 0 ? 0 : 1
