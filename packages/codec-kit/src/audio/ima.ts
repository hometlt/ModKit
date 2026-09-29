/**
 * The 89 quantiser step sizes of IMA ADPCM (IMA Digital Audio Focus, 1992), shared by every ADPCM
 * that inherits them — Microsoft IMA in WAV, Blizzard's Storm ADPCM in MPQ, Westwood's AUD and VQA — though their
 * codes differ.
 */
export const IMA_STEP_TABLE: readonly number[] = Object.freeze([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10_442,
  11_487, 12_635, 13_899, 15_289, 16_818, 18_500, 20_350, 22_385, 24_623, 27_086, 29_794, 32_767,
])

/** IMA ADPCM step index change per 4-bit code (IMA Digital Audio Focus, 1992). */
export const IMA_INDEX_TABLE: readonly number[] = Object.freeze([
  -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
])

/**
 * One block of Microsoft IMA ADPCM (WAV format tag 0x11), as interleaved 16-bit frames. Each
 * channel opens the block with a 16-bit predictor and an 8-bit step index — that predictor is the
 * first frame — then 4-byte words of 8 codes, low nibble first, alternate by channel. A short last
 * block keeps its header and whole word groups. Xbox IMA (FMOD FSB5 codec 7) is the same block of
 * 0x24 bytes a channel, of which the player keeps the first 64 frames.
 */
export function decodeImaAdpcmBlock(block: Uint8Array, channels: number): Int16Array {
  const header = 4 * channels
  if (channels <= 0 || block.byteLength < header) return new Int16Array(0)
  const groups = Math.floor((block.byteLength - header) / header)
  const out = new Int16Array((1 + groups * 8) * channels)
  for (let channel = 0; channel < channels; channel += 1) {
    const at = 4 * channel
    let predictor = (((block[at] ?? 0) | ((block[at + 1] ?? 0) << 8)) << 16) >> 16
    let index = Math.min(88, block[at + 2] ?? 0)
    out[channel] = predictor
    for (let group = 0; group < groups; group += 1) {
      const word = header + (group * channels + channel) * 4
      for (let nibble = 0; nibble < 8; nibble += 1) {
        const code = ((block[word + (nibble >> 1)] ?? 0) >> ((nibble & 1) * 4)) & 0x0f
        const step = IMA_STEP_TABLE[index] ?? 0
        let difference = step >> 3
        if ((code & 1) !== 0) difference += step >> 2
        if ((code & 2) !== 0) difference += step >> 1
        if ((code & 4) !== 0) difference += step
        predictor += (code & 8) !== 0 ? -difference : difference
        predictor = predictor < -32_768 ? -32_768 : predictor > 32_767 ? 32_767 : predictor
        index = Math.min(88, Math.max(0, index + (IMA_INDEX_TABLE[code] ?? 0)))
        out[(1 + group * 8 + nibble) * channels + channel] = predictor
      }
    }
  }
  return out
}
