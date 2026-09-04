/**
 * Legacy (MK2) vs MK3 BC6H/BC7 decode, byte for byte.
 *
 * BC6H and BC7 are the two DDS payloads legacy did not decode itself: it called
 * `decode_bc6` / `decode_bc7` from the npm package `texture2ddecoder-wasm` through
 * `packages/image-processing/src/core/gpu-texture-wasm.ts`. MK3 now carries that package (vendored
 * at `modkit-core/extensions/images/vendor/texture2ddecoder/`) and reaches it through
 * `extensions/images/src/dds/bptc.js`.
 *
 * This harness holds MK3's whole path — header parse, subresource walk, block slice, decode,
 * BGRA→RGBA swizzle — against legacy's whole path on the same bytes. The legacy module is loaded
 * from `references/modkitmk2` with its two non-decode imports stubbed exactly as
 * `compare-legacy-dds.mjs` does, except that here the BC6H/BC7 stubs are replaced by the real
 * `texture2ddecoder-wasm` from the legacy checkout's own `node_modules` — that is the oracle.
 *
 * The SC2 corpus contains one BC7 file and no BC6H file, so most of the evidence here is
 * synthetic: pseudo-random block payloads across every BC7 mode byte and every BC6H mode, at
 * several surface sizes including non-multiple-of-4 ones. Random blocks exercise the mode,
 * partition and endpoint paths of the decoder without needing an encoder.
 *
 *   node artifacts/legacy-parity-textures/compare-legacy-dds-bptc.mjs [--corpus <dir> ...]
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//u, ''))
const codingRoot = path.resolve(here, '..', '..')
const legacySource = path.join(
  codingRoot,
  'references/modkitmk2/extensions/common/images/codecs/dds/src/dds.ts',
)
const legacyWasm = path.join(
  codingRoot,
  'references/modkitmk2/node_modules/texture2ddecoder-wasm/dist/index.mjs',
)
const mk3Codec = path.join(codingRoot, 'modkit-core/extensions/images/src/dds/codec.js')

const argv = process.argv.slice(2)
const roots = argv.flatMap((value, index) => (value === '--corpus' ? [argv[index + 1]] : []))

/**
 * Load the legacy decoder with its real BC6H/BC7 back end.
 *
 * Only the two import lines are replaced: the decode-size guard (a runtime helper outside the
 * decode path) and the WASM entry points, which are re-bound to the very package legacy imported.
 * Everything from the first non-import line onward is the untouched original file.
 */
async function loadLegacy() {
  const original = await readFile(legacySource, 'utf8')
  const lines = original.split(/\r?\n/u)
  const bc7Line = lines.findIndex(line => line.includes('decode_bc6, decode_bc7'))
  const guardLine = lines.findIndex(line => line.includes('assertRgba8DecodeWithinLimit'))
  if (bc7Line < 0 || guardLine < 0 || guardLine > bc7Line) {
    throw new Error('legacy import header did not match; refusing to guess')
  }
  const stubbed = [
    'function assertRgba8DecodeWithinLimit(width, height) {',
    "  if (width * height * 4 > 800_000_000) throw new Error('decode limit')",
    '}',
    `import { decode_bc6, decode_bc7 } from ${JSON.stringify(pathToFileURL(legacyWasm).href)}`,
    ...lines.slice(bc7Line + 1),
  ].join('\n')
  const directory = mkdtempSync(path.join(tmpdir(), 'legacy-dds-bptc-'))
  const file = path.join(directory, 'legacy-dds.mts')
  writeFileSync(file, stubbed)
  return import(pathToFileURL(file).href)
}

const legacy = await loadLegacy()
const mk3 = await import(pathToFileURL(mk3Codec).href)

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

async function decodeMk3(bytes, name, mipLevel = 0) {
  const codec = mk3.createCodec({})
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

/** A deterministic pseudo-random stream, so a failing case can be reproduced from its seed. */
function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state >>> 24
  }
}

/** A minimal DX10 DDS around a block payload, mip 0 only. */
function dx10Dds(dxgiFormat, width, height, blocks) {
  const out = new Uint8Array(148 + blocks.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x2053_4444, true)
  view.setUint32(4, 124, true)
  view.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x8_0000, true)
  view.setUint32(12, height, true)
  view.setUint32(16, width, true)
  view.setUint32(20, blocks.length, true)
  view.setUint32(28, 1, true)
  view.setUint32(76, 32, true)
  view.setUint32(80, 0x4, true)
  out.set([0x44, 0x58, 0x31, 0x30], 84) // 'DX10'
  view.setUint32(108, 0x1000, true)
  view.setUint32(128, dxgiFormat, true)
  view.setUint32(132, 3, true) // TEXTURE2D
  view.setUint32(136, 0, true)
  view.setUint32(140, 1, true)
  view.setUint32(144, 0, true)
  out.set(blocks, 148)
  return out
}

const verdicts = new Map()
let compared = 0
let identical = 0
let mismatched = 0
function note(key, detail) {
  if (!verdicts.has(key)) verdicts.set(key, { count: 0, detail })
  verdicts.get(key).count += 1
}

async function compareBytes(label, bytes, name) {
  let reference
  try {
    reference = await legacy.decodeDdsAsync(bytes)
  } catch (error) {
    note(`${label} :: legacy-refused: ${error.message}`, name)
    return
  }
  compared += 1
  let observed
  try {
    observed = await decodeMk3(bytes, name)
  } catch (error) {
    mismatched += 1
    note(`${label} :: MK3-FAILED-where-legacy-decoded: ${error.message}`, name)
    return
  }
  if (observed.width !== reference.width || observed.height !== reference.height) {
    mismatched += 1
    note(`${label} :: SIZE-MISMATCH`, name)
    return
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
    note(`${label} :: DIFFERS bytes=${differing} maxDelta=${worst}`, name)
    return
  }
  identical += 1
  note(`${label} :: IDENTICAL`, name)
}

/*
 * Synthetic sweep. Every BC7 block's first byte selects its mode (the mode is the position of the
 * lowest set bit), and every BC6H block's first two bits or five bits do the same, so sweeping the
 * leading byte across 0..255 with random remainder reaches every mode including the invalid ones a
 * decoder must survive.
 */
const SIZES = [
  [4, 4],
  [8, 8],
  [16, 16],
  [5, 3],
  [13, 7],
]
for (const [dxgi, label] of [
  [95, 'BC6H_UF16'],
  [96, 'BC6H_SF16'],
  [94, 'BC6H_TYPELESS'],
  [98, 'BC7_UNORM'],
  [99, 'BC7_UNORM_SRGB'],
  [97, 'BC7_TYPELESS'],
]) {
  for (const [width, height] of SIZES) {
    const blockCount = Math.ceil(width / 4) * Math.ceil(height / 4)
    for (let leading = 0; leading < 256; leading += 1) {
      const next = random(0x5eed_0000 + leading * 131 + width * 7 + height)
      const blocks = new Uint8Array(blockCount * 16)
      for (let block = 0; block < blockCount; block += 1) {
        blocks[block * 16] = leading
        for (let byte = 1; byte < 16; byte += 1) blocks[block * 16 + byte] = next()
      }
      await compareBytes(
        `synthetic ${label}`,
        dx10Dds(dxgi, width, height, blocks),
        `${label}-${width}x${height}-lead${leading}`,
      )
    }
  }
}

/* Whatever BPTC the real corpus holds, on top of the synthetic sweep. */
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

for (const root of roots) {
  for await (const file of walk(root)) {
    const bytes = new Uint8Array(await readFile(file))
    if (bytes.byteLength < 148) continue
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(0, true) !== 0x2053_4444) continue
    if ((view.getUint32(80, true) & 0x4) === 0) continue
    const code = String.fromCharCode(
      view.getUint8(84),
      view.getUint8(85),
      view.getUint8(86),
      view.getUint8(87),
    )
    if (code !== 'DX10') continue
    const dxgi = view.getUint32(128, true)
    if (dxgi < 94 || dxgi > 99) continue
    await compareBytes(`corpus DXGI:${dxgi}`, bytes, path.basename(file))
    console.log(`corpus BPTC file: ${file} (DXGI ${dxgi})`)
  }
}

console.log('\n--- legacy MK2 decodeDdsAsync vs MK3 modkit/dds, BC6H and BC7 ---')
for (const [key, { count }] of [...verdicts.entries()].sort()) {
  console.log(`${String(count).padStart(5)}  ${key}`)
}
console.log(
  `\ncompared ${compared} surface(s) against the legacy decoder: ` +
    `${identical} byte-identical, ${mismatched} differing`,
)
process.exitCode = mismatched === 0 && identical > 0 ? 0 : 1
