/**
 * Microsoft ADPCM (WAVE tag 2) block decoder, mono/stereo, with explicit WAVE coefficient pairs.
 * Format facts: Microsoft RIFF/WAVE ADPCMWAVEFORMAT; not the unrelated IMA codec. Initial sample2
 * precedes sample1, then high nibble first. Signed prediction division truncates toward zero.
 * Rejects invalid predictors/deltas/header/output bounds; no padded or partial successful block.
 */
const ADAPTATION = [230,230,230,230,307,409,512,614,768,614,512,409,307,230,230,230] as const

/** Decode a complete native block into owned, interleaved signed 16-bit samples. */
export function decodeMsAdpcmBlock(block: Uint8Array, channels: number,
  coefficients: readonly (readonly [number, number])[], maxOutputBytes: number): Int16Array {
  if (![1,2].includes(channels) || block.length < channels * 7 || coefficients.length < 1 || coefficients.length > 256 ||
    coefficients.some(pair => pair.length !== 2 || pair.some(v => !Number.isInteger(v) || v < -32768 || v > 32767)))
    throw new TypeError('Invalid Microsoft ADPCM block/coefficients')
  const count = channels * 2 + (block.length - channels * 7) * 2
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < count * 2) throw new RangeError('Microsoft ADPCM output budget')
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength), output = new Int16Array(count)
  const states = Array.from({ length: channels }, (_, channel) => {
    const predictor = block[channel]!, pair = coefficients[predictor]
    const delta = view.getUint16(channels + channel * 2, true)
    const sample1 = view.getInt16(channels * 3 + channel * 2, true), sample2 = view.getInt16(channels * 5 + channel * 2, true)
    if (!pair || delta < 16) throw new TypeError('Microsoft ADPCM predictor/delta')
    output[channel] = sample2; output[channels + channel] = sample1
    return { pair, delta, sample1, sample2 }
  })
  let at = channels * 2
  for (let i = channels * 7; i < block.length; i++) for (let nibble = 0; nibble < 2; nibble++) {
    const code = nibble === 0 ? block[i]! >>> 4 : block[i]! & 15
    const state = states[channels === 2 ? nibble : 0]!
    const predicted = Math.trunc((state.sample1 * state.pair[0] + state.sample2 * state.pair[1]) / 256)
    const value = Math.max(-32768, Math.min(32767, predicted + (code >= 8 ? code - 16 : code) * state.delta))
    state.sample2 = state.sample1; state.sample1 = value
    const delta = Math.max(16, Math.floor(state.delta * ADAPTATION[code]! / 256))
    if (!Number.isSafeInteger(delta) || delta > 0x7fffffff) throw new RangeError('Microsoft ADPCM delta overflow')
    state.delta = delta
    output[at++] = value
  }
  return output
}
