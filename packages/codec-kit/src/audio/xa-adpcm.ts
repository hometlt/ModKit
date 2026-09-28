/**
 * CD-XA ADPCM, the audio of PlayStation XA sectors. A Form 2 audio sector carries 18 sound groups of
 * 128 bytes: 16 bytes of unit parameters (shift in the low nibble, filter in bits 4-5; units 0-7 at
 * bytes 4-11), then 28 rows of 4 bytes holding the 4-bit codes of 8 units of 28 samples, two units
 * per byte, low nibble first. In stereo even units are the left channel and odd units the right.
 * Written from the nocash PSX specification (psx-spx, "CDROM XA-ADPCM"): the predictor keeps the
 * clamped sample, as ffmpeg's `adpcm_xa` does (bit-identical); vgmstream keeps the unclamped sum, so
 * it differs after a clipped sample. The 8-bit mode (CD-i only; no PlayStation title uses it) is not
 * decoded.
 */

export const XA_SOUND_GROUP_BYTES = 128
/** 4-bit samples in one sound group, over all channels. */
export const XA_SOUND_GROUP_SAMPLES = 224
const UNIT_SAMPLES = 28

/** Positive and negative predictor weights of the four XA filters, in 1/64. */
const FILTERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [60, 0],
  [115, -52],
  [98, -55],
]

/**
 * Consecutive 4-bit sound groups of one XA channel (the 2304 audio bytes of each of its sectors,
 * in order) as interleaved 16-bit PCM. The predictor of each channel runs across groups and
 * sectors, as the drive's decoder does.
 */
export function decodeXaAdpcm(groups: Uint8Array, channels: 1 | 2): Int16Array {
  if (channels !== 1 && channels !== 2) throw new RangeError('XA ADPCM is mono or stereo')
  if (groups.byteLength % XA_SOUND_GROUP_BYTES !== 0) {
    throw new RangeError(
      `XA ADPCM data is not a whole number of ${XA_SOUND_GROUP_BYTES}-byte groups`,
    )
  }
  const count = groups.byteLength / XA_SOUND_GROUP_BYTES
  const out = new Int16Array(count * XA_SOUND_GROUP_SAMPLES)
  // Per channel: the two previous samples and how many samples are out.
  type State = { history1: number; history2: number; written: number }
  const states: [State, State] = [
    { history1: 0, history2: 0, written: 0 },
    { history1: 0, history2: 0, written: 0 },
  ]
  for (let group = 0; group < count; group += 1) {
    const at = group * XA_SOUND_GROUP_BYTES
    for (let unit = 0; unit < 8; unit += 1) {
      const parameters = groups[at + 4 + unit] ?? 0
      // Shifts 13-15 are reserved; the hardware treats them as 9.
      const raw = parameters & 0x0f
      const shift = raw > 12 ? 9 : raw
      const [weight1, weight2] = FILTERS[(parameters >> 4) & 3] ?? [0, 0]
      const channel = channels === 2 ? unit & 1 : 0
      const state = states[channel === 0 ? 0 : 1]
      let { history1, history2, written: index } = state
      const column = unit >> 1
      const nibble = (unit & 1) * 4
      for (let row = 0; row < UNIT_SAMPLES; row += 1) {
        const byte = groups[at + 16 + row * 4 + column] ?? 0
        // Sign-extend the code into the top of 16 bits, then scale it down by the shift.
        const code = (((byte >> nibble) << 28) >> 16) >> shift
        let sample = code + ((history1 * weight1 + history2 * weight2 + 32) >> 6)
        sample = sample < -32768 ? -32768 : sample > 32767 ? 32767 : sample
        out[index * channels + channel] = sample
        index += 1
        history2 = history1
        history1 = sample
      }
      state.written = index
      state.history1 = history1
      state.history2 = history2
    }
  }
  return out
}
