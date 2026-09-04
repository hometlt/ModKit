import { loadMk3Reference } from '../legacy-oracle/mk3-reference.mjs'
import { trackedReadFile as readFile } from '../legacy-oracle/track-corpus.mjs'
/**
 * Legacy (MK2) vs MK3 DDS decode, pixel for pixel, over the real StarCraft II corpus.
 *
 * This is the reproduction path for the DDS row of the legacy-parity port. It loads the legacy
 * decoder straight out of `references/modkitmk2` and the MK3 codec straight out of
 * `modkit-core/extensions/images`, decodes the same bytes through both, and compares every byte of
 * every mip level. Legacy is the oracle: any difference is a parity defect in MK3.
 *
 * Run it from anywhere:
 *
 *   node --experimental-strip-types artifacts/legacy-parity-textures/compare-legacy-dds.mjs \
 *     --corpus "C:/FILES/SC2Files/Mods" --corpus "C:/FILES/SC2Files/AllRaces"
 *
 * Options:
 *   --corpus <dir>   Directory to walk for .dds files. Repeatable. Defaults to MODKITX_SC2_ROOT.
 *   --cap <n>        Maximum files sampled per header-format bucket (default 250). Every distinct
 *                    bucket is sampled, so rare formats are always covered even at a low cap.
 *
 * The legacy decoder is TypeScript and imports two runtime helpers this comparison does not need
 * (a decode-size guard and the BC6H/BC7 WASM entry points, neither of which any corpus file
 * reaches). They are replaced with local stubs in a temporary copy so the reference can be loaded
 * without building the whole MK2 monorepo; nothing in the decode path is altered.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readdir, open as openFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//u, ''))
const codingRoot = path.resolve(here, '..', '..')
const legacySource = path.join(
  codingRoot,
  'references/modkitmk2/extensions/common/images/codecs/dds/src/dds.ts',
)
const mk3Codec = path.join(codingRoot, 'modkit-core/extensions/images/src/dds/codec.js')

const argv = process.argv.slice(2)
const corpora = argv.flatMap((value, index) => (value === '--corpus' ? [argv[index + 1]] : []))
const capIndex = argv.indexOf('--cap')
const CAP = capIndex < 0 ? 250 : Number(argv[capIndex + 1])
const roots = corpora.length > 0 ? corpora : [process.env.MODKITX_SC2_ROOT].filter(Boolean)
if (roots.length === 0) {
  throw new Error('no corpus: pass --corpus <dir> or set MODKITX_SC2_ROOT')
}

/** Load the legacy decoder, stubbing only the two imports outside the decode path. */
async function loadLegacy() {
  const original = await readFile(legacySource, 'utf8')
  const lines = original.split(/\r?\n/u)
  /*
   * Drop only the import lines: the `./types.js` type-only import (erased anyway) and the two
   * runtime helpers. Everything from the first non-import line onward is the untouched original.
   */
  const bc7Line = lines.findIndex(line => line.includes('decode_bc6, decode_bc7'))
  const guardLine = lines.findIndex(line => line.includes('assertRgba8DecodeWithinLimit'))
  if (bc7Line < 0 || guardLine < 0 || guardLine > bc7Line) {
    throw new Error('legacy import header did not match; refusing to guess')
  }
  const stubbed = [
    'function assertRgba8DecodeWithinLimit(width, height) {',
    "  if (width * height * 4 > 800_000_000) throw new Error('decode limit')",
    '}',
    'const decode_bc6 = async () => null',
    'const decode_bc7 = async () => null',
    ...lines.slice(bc7Line + 1),
  ].join('\n')
  const directory = mkdtempSync(path.join(tmpdir(), 'legacy-dds-'))
  const file = path.join(directory, 'legacy-dds.mts')
  writeFileSync(file, stubbed)
  return import(pathToFileURL(file).href)
}

const legacy = await loadLegacy()
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
