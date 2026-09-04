import { loadMk3Reference } from '../legacy-oracle/mk3-reference.mjs'
import { loadLegacy as loadPinnedLegacy } from './legacy-mk2.mjs'
import { trackedReadFile as readFile } from '../legacy-oracle/track-corpus.mjs'
/** Pinned MK2 vs MK3 parity. Universal loader: step 0.3; original harness in M1 old-snapshot.
 * --corpus is required for real files; original default caps and synthetic cases are unchanged.
 */
import { readdir, open as openFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//u, ''))
const codingRoot = path.resolve(here, '..', '..')
const mk3Codec = path.join(codingRoot, 'modkit-core/extensions/images/src/dds/codec.js')

const argv = process.argv.slice(2)
const corpora = argv.flatMap((value, index) => (value === '--corpus' ? [argv[index + 1]] : []))
const capIndex = argv.indexOf('--cap')
const CAP = capIndex < 0 ? 250 : Number(argv[capIndex + 1])
const roots = corpora.length > 0 ? corpora : [process.env.MODKITX_SC2_ROOT].filter(Boolean)
if (roots.length === 0) {
  throw new Error('no corpus: pass --corpus <dir> or set MODKITX_SC2_ROOT')
}

const legacy = (await loadPinnedLegacy()).dds
const mk3 = await loadMk3Reference('dds/codec.js', mk3Codec)

const budget = {
  maxInputBytes: 400_000_000n,
  maxDepth: 16,
  maxNodes: 4096,
  maxScalarBytes: 400_000_000,
  maxDiagnostics: 32,
}

function byteSource(bytes, name) {
  const uri = `memory://compare/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: `content-hash.sha256:${name}`,
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source) {
  const binding = {
    sourceKind: 'candidate',
    bindingId: 'content',
    role: 'content',
    ownership: 'owned',
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: source.ref.id,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, async release() {} }
    },
  }
}

/** Decode one mip level through the MK3 codec's published raster-image data source. */
async function decodeMk3(bytes, name, mipLevel) {
  const codec = mk3.createCodec({})
  // The SDK revision grammar excludes characters that appear in real asset names; the synthetic
  // name must not introduce a failure the product does not have.
  const safe = name.replaceAll(/[^A-Za-z0-9._~-]/gu, '-')
  const session = await codec.open(inputFor(byteSource(bytes, safe)), 'inspect', budget)
  try {
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    try {
      const info = await lease.value.info()
      const region = await lease.value.readRegion({
        x: 0,
        y: 0,
        width: Math.max(1, info.width >>> mipLevel),
        height: Math.max(1, info.height >>> mipLevel),
        pixelFormat: 'rgba8',
        maxBytes: 400_000_000,
        mipLevel,
      })
      return { pixels: region.pixels, width: region.width, height: region.height, info }
    } finally {
      await lease.release()
    }
  } finally {
    await session.dispose()
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

/** Bucket a file by the pixel format its header declares, so every variant is sampled. */
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
    return `OTHER:0x${flags.toString(16)}`
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

const verdicts = new Map()
let compared = 0
let identical = 0
let mismatched = 0
function note(key, file) {
  if (!verdicts.has(key)) verdicts.set(key, { count: 0, example: file })
  verdicts.get(key).count += 1
}

for (const [bucket, files] of [...buckets.entries()].sort()) {
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(file))
    let reference
    try {
      reference = legacy.decodeDds(bytes)
    } catch (error) {
      // Legacy refused these bytes too, so there is nothing to hold MK3 against.
      note(`${bucket} :: legacy-refused: ${error.message}`, file)
      continue
    }
    compared += 1
    let observed
    try {
      observed = await decodeMk3(bytes, path.basename(file), 0)
    } catch (error) {
      mismatched += 1
      note(`${bucket} :: MK3-FAILED-where-legacy-decoded: ${error.message}`, file)
      continue
    }
    if (observed.width !== reference.width || observed.height !== reference.height) {
      mismatched += 1
      note(`${bucket} :: SIZE-MISMATCH`, file)
      continue
    }
    let differing = 0
    let worst = 0
    for (let index = 0; index < reference.pixels.length; index += 1) {
      const delta = Math.abs(reference.pixels[index] - observed.pixels[index])
      if (delta !== 0) {
        differing += 1
        if (delta > worst) worst = delta
      }
    }
    if (differing !== 0) {
      mismatched += 1
      note(`${bucket} :: DIFFERS bytes=${differing} maxDelta=${worst}`, file)
      continue
    }
    // Every remaining mip level, not only the top one.
    let verdict = 'IDENTICAL'
    for (let level = 1; level < observed.info.mipLevels; level += 1) {
      let referenceLevel
      try {
        referenceLevel = legacy.decodeDds(bytes, { mipLevel: level })
      } catch {
        break
      }
      let observedLevel
      try {
        observedLevel = await decodeMk3(bytes, path.basename(file), level)
      } catch (error) {
        verdict = `MIP${level}-FAILED: ${error.message}`
        break
      }
      let levelDiffering = 0
      for (let index = 0; index < referenceLevel.pixels.length; index += 1) {
        if (referenceLevel.pixels[index] !== observedLevel.pixels[index]) levelDiffering += 1
      }
      if (levelDiffering !== 0) {
        verdict = `MIP${level}-DIFFERS bytes=${levelDiffering}`
        break
      }
    }
    if (verdict === 'IDENTICAL') identical += 1
    else mismatched += 1
    note(`${bucket} :: ${verdict}`, file)
  }
}

console.log('--- legacy MK2 decodeDds vs MK3 modkit/dds, real SC2 files, every mip level ---')
for (const [key, { count, example }] of [...verdicts.entries()].sort()) {
  console.log(`${String(count).padStart(5)}  ${key}`)
  if (!key.includes('IDENTICAL') && !key.includes('legacy-refused')) {
    console.log(`         e.g. ${example}`)
  }
}
console.log(
  `\ncompared ${compared} file(s) against the legacy decoder: ` +
    `${identical} byte-identical, ${mismatched} differing`,
)
process.exitCode = mismatched === 0 ? 0 : 1
