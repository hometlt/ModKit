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
const CAP = capIndex < 0 ? 40 : Number(argv[capIndex + 1])

const legacy = await loadLegacy({ wasm: false })
const mk3 = await loadMk3Reference('dds/compressed.js', path.join(codingRoot, 'modkit-core/extensions/images/src/dds/compressed.js'))

const verdicts = new Map()
let compared = 0
let identical = 0
let mismatched = 0
function note(key, example) {
  if (!verdicts.has(key)) verdicts.set(key, { count: 0, example })
  verdicts.get(key).count += 1
}

/** Every difference between two descriptors, named. An empty list is byte identity. */
function differences(left, right) {
  const problems = []
  const scalar = [
    'schemaVersion',
    'format',
    'mipLevelCount',
    'layerCount',
    'faceCount',
    'colorSpace',
    'alphaMode',
  ]
  for (const key of scalar) {
    if (left[key] !== right[key]) problems.push(`${key}: ${left[key]} vs ${right[key]}`)
  }
  for (const key of ['dimensions', 'block', 'source', 'notes']) {
    const a = JSON.stringify(left[key] ?? null)
    const b = JSON.stringify(right[key] ?? null)
    if (a !== b) problems.push(`${key}: ${a} vs ${b}`)
  }
  if (left.subresources.length !== right.subresources.length) {
    problems.push(`subresources: ${left.subresources.length} vs ${right.subresources.length}`)
    return problems
  }
  for (let index = 0; index < left.subresources.length; index += 1) {
    const a = left.subresources[index]
    const b = right.subresources[index]
    for (const key of ['mipLevel', 'layer', 'face', 'depthSlice', 'width', 'height', 'depth']) {
      if (a[key] !== b[key]) problems.push(`subresource ${index} ${key}: ${a[key]} vs ${b[key]}`)
    }
    if (a.sourceByteRange.offset !== b.sourceByteRange.offset) {
      problems.push(
        `subresource ${index} offset: ${a.sourceByteRange.offset} vs ${b.sourceByteRange.offset}`,
      )
    }
    if (a.sourceByteRange.length !== b.sourceByteRange.length) {
      problems.push(
        `subresource ${index} length: ${a.sourceByteRange.length} vs ${b.sourceByteRange.length}`,
      )
    }
    if (a.data.length !== b.data.length) {
      problems.push(`subresource ${index} data length: ${a.data.length} vs ${b.data.length}`)
      continue
    }
    for (let byte = 0; byte < a.data.length; byte += 1) {
      if (a.data[byte] !== b.data[byte]) {
        problems.push(`subresource ${index} data byte ${byte}`)
        break
      }
    }
  }
  return problems
}

function compare(label, bytes, name) {
  let reference
  try {
    reference = legacy.codec.ddsCodec.readCompressed(bytes)
  } catch (error) {
    let observedMessage = 'accepted'
    try {
      mk3.readCompressedDds(bytes)
    } catch (mk3Error) {
      observedMessage = mk3Error.message
    }
    compared += 1
    if (observedMessage === error.message) {
      identical += 1
      note(`${label} :: BOTH-REFUSED (${error.message})`, name)
    } else {
      mismatched += 1
      note(`${label} :: REFUSAL-DIFFERS "${error.message}" vs "${observedMessage}"`, name)
    }
    return
  }
  compared += 1
  let observed
  try {
    observed = mk3.readCompressedDds(bytes)
  } catch (error) {
    mismatched += 1
    note(`${label} :: MK3-FAILED-where-legacy-described: ${error.message}`, name)
    return
  }
  const problems = differences(reference, observed)
  if (problems.length === 0) {
    identical += 1
    note(`${label} :: IDENTICAL (${reference.format}, ${reference.subresources.length} sub)`, name)
    return
  }
  mismatched += 1
  note(`${label} :: DIFFERS ${problems[0]}`, name)
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
    const caps2 = view.getUint32(112, true)
    const shape =
      (caps2 & 0x200) !== 0 ? '|cube' : (caps2 & 0x20_0000) !== 0 ? '|volume' : ''
    if ((flags & 0x4) !== 0) {
      const code = String.fromCharCode(
        view.getUint8(84),
        view.getUint8(85),
        view.getUint8(86),
        view.getUint8(87),
      )
      return code === 'DX10'
        ? `DX10:${view.getUint32(128, true)}${shape}`
        : `FOURCC:${code}${shape}`
    }
    if ((flags & 0x40) !== 0) return `RGB:${view.getUint32(88, true)}${shape}`
    if ((flags & 0x2_0000) !== 0) return `LUMINANCE:${view.getUint32(88, true)}${shape}`
    if ((flags & 0x2) !== 0) return `ALPHA:${view.getUint32(88, true)}${shape}`
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
    compare(bucket, new Uint8Array(await readFile(file)), path.basename(file))
  }
}

/*
 * Synthetic coverage for what the corpus lacks: BC4 and BC6H, the SNORM spellings, the DX10 misc2
 * alpha modes, texture arrays, cubemaps and volumes. Block bytes are pseudo-random and the
 * descriptor never decodes them, so the values only have to be present and identical on both sides.
 */
function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state >>> 24
  }
}

const BLOCK_BYTES = { 71: 8, 74: 16, 77: 16, 80: 8, 81: 8, 83: 16, 84: 16, 95: 16, 96: 16, 94: 16, 98: 16, 99: 16 }

function dx10Dds({ dxgi, width, height, depth = 1, mips = 1, layers = 1, cube = false, misc2 = 0 }) {
  const blockBytes = BLOCK_BYTES[dxgi]
  const sizes = []
  let total = 0
  for (let level = 0; level < mips; level += 1) {
    const w = Math.max(1, width >>> level)
    const h = Math.max(1, height >>> level)
    const d = Math.max(1, depth >>> level)
    const slice = Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes
    sizes.push(slice * d)
    total += slice * d
  }
  const faces = cube ? 6 : 1
  const payload = total * layers * faces
  const out = new Uint8Array(148 + payload)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x2053_4444, true)
  view.setUint32(4, 124, true)
  view.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x8_0000 | (mips > 1 ? 0x2_0000 : 0), true)
  view.setUint32(12, height, true)
  view.setUint32(16, width, true)
  view.setUint32(20, sizes[0], true)
  view.setUint32(24, depth, true)
  view.setUint32(28, mips, true)
  view.setUint32(76, 32, true)
  view.setUint32(80, 0x4, true)
  out.set([0x44, 0x58, 0x31, 0x30], 84)
  view.setUint32(108, 0x1000, true)
  view.setUint32(112, (cube ? 0xfe00 : 0) | (depth > 1 ? 0x20_0000 : 0), true)
  view.setUint32(128, dxgi, true)
  view.setUint32(132, depth > 1 ? 4 : 3, true)
  view.setUint32(136, cube ? 0x4 : 0, true)
  view.setUint32(140, layers, true)
  view.setUint32(144, misc2, true)
  const next = random(0xc0ffee + dxgi * 17 + width * 3 + height)
  for (let index = 148; index < out.length; index += 1) out[index] = next()
  return out
}

for (const dxgi of [71, 74, 77, 80, 81, 83, 84, 94, 95, 96, 98, 99]) {
  for (const shape of [
    { width: 4, height: 4 },
    { width: 16, height: 16, mips: 5 },
    { width: 13, height: 7, mips: 3 },
    { width: 8, height: 8, mips: 4, layers: 3 },
    { width: 8, height: 8, mips: 4, cube: true },
    { width: 8, height: 8, depth: 4, mips: 3 },
    { width: 8, height: 8, misc2: 1 },
    { width: 8, height: 8, misc2: 2 },
    { width: 8, height: 8, misc2: 3 },
  ]) {
    compare(
      `synthetic DXGI:${dxgi}`,
      dx10Dds({ dxgi, ...shape }),
      `dxgi${dxgi}-${JSON.stringify(shape)}`,
    )
  }
}

console.log('--- legacy MK2 readCompressed vs MK3 dds/compressed.js ---')
for (const [key, { count, example }] of [...verdicts.entries()].sort()) {
  console.log(`${String(count).padStart(5)}  ${key}`)
  if (key.includes('DIFFERS') || key.includes('FAILED')) console.log(`         e.g. ${example}`)
}
console.log(`\ncompared ${compared} file(s): ${identical} identical, ${mismatched} differing`)
process.exitCode = mismatched === 0 && identical > 0 ? 0 : 1
