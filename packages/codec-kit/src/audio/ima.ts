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
