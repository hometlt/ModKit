/** Topology-preserving binary raster thinning (Zhang–Suen candidates with ordered simple-point guards). Operates on a
 * copied 0/1 mask, with zero outside the image. Rechecks deletion candidates so small components cannot disappear. Preserves endpoints and eight-connected paths;
 * it does not choose a world-space wall width or interpolate raster values.
 */
export function thinBinaryMask(width: number, height: number, mask: Uint8Array, signal?: AbortSignal, pins?: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16_777_216 || mask.length !== width * height || (pins !== undefined && pins.length !== mask.length))
    throw new RangeError('invalid thinning raster bounds')
  const out = mask.map(v => v ? 1 : 0)
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : out[x + y * width]!
  const eligible = (x: number, y: number, phase: number) => {
    if (!at(x, y) || pins?.[x + y * width]) return false
    const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)]
    const neighbours = p.reduce((sum, v) => sum + v, 0)
    if (neighbours < 2 || neighbours > 6) return false
    let transitions = 0
    for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) transitions++
    if (transitions !== 1) return false
    if (phase === 0 ? p[0]! * p[2]! * p[4]! || p[2]! * p[4]! * p[6]! : p[0]! * p[2]! * p[6]! || p[0]! * p[4]! * p[6]!) return false
    return true
  }
  let changed = true
  while (changed) {
    signal?.throwIfAborted()
    changed = false
    for (let phase = 0; phase < 2; phase++) {
      const remove: number[] = []
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!eligible(x, y, phase)) continue
        remove.push(x + y * width)
      }
      for (const i of remove) if (eligible(i % width, Math.floor(i / width), phase)) {
        out[i] = 0
        changed = true
      }
    }
  }
  return out
}

/** Fill bounded four-connected zero components up to the requested area; exterior and larger
 * holes remain unchanged. Used before thinning when a caller explicitly discards raster noise. */
export function fillSmallBinaryHoles(width: number, height: number, mask: Uint8Array, maxArea: number, signal?: AbortSignal): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16_777_216 || mask.length !== width * height || !Number.isSafeInteger(maxArea) || maxArea < 0)
    throw new RangeError('invalid hole-fill bounds')
  const out = mask.map(v => v ? 1 : 0), seen = new Uint8Array(mask.length)
  for (let i = 0; i < out.length; i++) {
    if (out[i] || seen[i]) continue
    signal?.throwIfAborted()
    const queue = [i]; seen[i] = 1
    let exterior = false
    for (let k = 0; k < queue.length; k++) {
      const p = queue[k]!, x = p % width, y = Math.floor(p / width)
      if (!x || !y || x === width - 1 || y === height - 1) exterior = true
      for (const q of [x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y ? p - width : -1, y + 1 < height ? p + width : -1])
        if (q >= 0 && !out[q] && !seen[q]) { seen[q] = 1; queue.push(q) }
    }
    if (!exterior && queue.length <= maxArea) for (const p of queue) out[p] = 1
  }
  return out
}
