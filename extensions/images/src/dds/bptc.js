/**
 * BC6H and BC7 decode, through the same third-party runtime the legacy MK2 codec used.
 *
 * Legacy reached these two formats at
 * `references/modkitmk2/extensions/common/images/codecs/dds/src/dds.ts` →
 * `decodeDdsAsync` → `decode_bc6` / `decode_bc7` from
 * `@modkitx/image-processing/core/gpu-texture-wasm.js`, which loaded the npm package
 * `texture2ddecoder-wasm`. That package is vendored at `../../vendor/texture2ddecoder/` and this
 * module is the only thing that loads it.
 *
 * Why the dependency travels rather than being reimplemented: BC6H ends in half floats, and the
 * projection from half float to the 8-bit view is a choice this library makes, not one the format
 * dictates. Byte-identical output against the legacy decoder is therefore only reachable by
 * running the same implementation. BC7 has no such freedom, but it shares the runtime.
 *
 * The runtime returns BGRA; legacy swizzled it to RGBA on the way out (`bgraToRgba`) and so does
 * this module, byte for byte.
 */

/** One lazily-created runtime for the whole process; the module is ~180 KB of Wasm. */
let runtimePromise

/**
 * Load the vendored Emscripten module.
 *
 * The factory resolves `texture2ddecoder.wasm` relative to its own script directory, which is the
 * vendor directory next to it, so nothing outside this package has to be told where the asset is —
 * the same resolution legacy's Node path used.
 */
async function runtime() {
  if (runtimePromise === undefined) {
    runtimePromise = import('../../vendor/texture2ddecoder/texture2ddecoder.js')
      .then(module => module.default())
      .catch(cause => {
        runtimePromise = undefined
        throw cause
      })
  }
  return runtimePromise
}

/**
 * Copy an Emscripten byte vector out of Wasm memory and release it.
 *
 * The vector is a bound C++ object, not a typed array: it is indexable and has a length, and it
 * must be deleted or the Wasm heap keeps the allocation. Legacy did exactly this in
 * `wasmOutputToUint8Array`.
 */
function copyOut(vector) {
  if (!vector) return null
  try {
    const bytes = new Uint8Array(vector.length)
    for (let index = 0; index < vector.length; index += 1) bytes[index] = vector[index]
    return bytes
  } finally {
    vector.delete?.()
  }
}

/** BGRA8 → RGBA8, in place of a copy the caller would otherwise make. */
function bgraToRgba(bgra, width, height, label) {
  const expected = width * height * 4
  if (bgra.length < expected) {
    throw new TypeError(`DDS ${label} decoder returned ${bgra.length} bytes, expected ${expected}`)
  }
  const rgba = new Uint8Array(expected)
  for (let index = 0; index < expected; index += 4) {
    rgba[index] = bgra[index + 2]
    rgba[index + 1] = bgra[index + 1]
    rgba[index + 2] = bgra[index]
    rgba[index + 3] = bgra[index + 3]
  }
  return rgba
}

async function decodeThrough(name, label, data, width, height) {
  const module = await runtime()
  const decode = module[name]
  if (typeof decode !== 'function') {
    throw new TypeError(`the vendored texture2ddecoder runtime has no ${name}`)
  }
  const bgra = copyOut(decode(data, width, height))
  if (bgra === null) throw new TypeError(`DDS ${label} decode failed`)
  return bgraToRgba(bgra, width, height, label)
}

/** BC6H (DXGI 94/95/96) block payload → rgba8, one surface. */
export function decodeBc6h(data, width, height) {
  return decodeThrough('decode_bc6', 'BC6H', data, width, height)
}

/** BC7 (DXGI 97/98/99) block payload → rgba8, one surface. */
export function decodeBc7(data, width, height) {
  return decodeThrough('decode_bc7', 'BC7', data, width, height)
}

/** Formats this module answers for, so the codec can route without knowing the runtime exists. */
export const BPTC_FORMATS = Object.freeze(new Set(['BC6H', 'BC7']))
