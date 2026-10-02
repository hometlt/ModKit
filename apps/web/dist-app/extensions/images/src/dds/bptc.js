/**
 * BC6H and BC7 decode, through codec-kit's Texture2DDecoder runtime (`@modkit/codec-kit/texture`).
 *
 * Legacy reached these two formats through the same third-party implementation
 * (`texture2ddecoder-wasm`, MIT), which codec-kit loads lazily, once per process. The dependency
 * travels rather than being reimplemented: BC6H ends in half floats, and the projection from half
 * float to the 8-bit view is a choice this library makes, not one the format dictates, so output
 * byte-identical to the legacy decoder is only reachable by running it. The runtime returns BGRA;
 * it leaves as RGBA, as it did in legacy.
 */

async function decodeThrough(name, label, data, width, height) {
  const texture = await import('@modkit/codec-kit/texture')
  const bgra = await texture[name](data, width, height)
  if (bgra === null) throw new TypeError(`DDS ${label} decode failed`)
  return texture.bgraToRgba(bgra, width, height, `DDS ${label}`)
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
