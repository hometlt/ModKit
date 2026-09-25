/**
 * Writers for the standard audio files a browser plays natively, shared by every game codec that
 * turns its own stream into one (Wwise WEM, Emperor BAG, ...). Narrow on purpose: no decoder and no
 * compression code, so importing it costs a codec nothing.
 */

/** Linear integer PCM, the only shape `encodeWav` writes (format tag 1). */
export interface PcmFormat {
  readonly channels: number
  readonly sampleRate: number
  /** 8 (unsigned) or 16/24/32 (signed, little-endian) bits per sample. */
  readonly bitsPerSample: number
}

const HEADER_BYTES = 44
const PCM_BITS = [8, 16, 24, 32]

/**
 * A canonical RIFF/WAVE file: a 16-byte `fmt ` (tag 1) and `data` holding `samples` unchanged —
 * interleaved little-endian frames, as a WAVE stores them. The result is one fresh buffer (worker
 * RPC refuses views that do not own theirs), padded to even size as RIFF requires.
 */
export function encodeWav(format: PcmFormat, samples: Uint8Array): Uint8Array {
  const { channels, sampleRate, bitsPerSample } = format
  if (!Number.isInteger(channels) || channels < 1 || channels > 0xffff) {
    throw new RangeError('WAV channels must be 1..65535')
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 0xffffffff) {
    throw new RangeError('WAV sample rate must be a positive 32-bit integer')
  }
  if (!PCM_BITS.includes(bitsPerSample)) throw new RangeError('WAV PCM is 8, 16, 24 or 32 bits')
  const blockAlign = channels * (bitsPerSample / 8)
  if (blockAlign > 0xffff) throw new RangeError('WAV frame exceeds 65535 bytes')
  if (samples.byteLength % blockAlign !== 0) {
    throw new RangeError(`WAV data is not a whole number of ${blockAlign}-byte frames`)
  }
  const byteRate = sampleRate * blockAlign
  if (byteRate > 0xffffffff) throw new RangeError('WAV byte rate exceeds 32 bits')
  const pad = samples.byteLength & 1
  const riffSize = HEADER_BYTES - 8 + samples.byteLength + pad
  if (riffSize > 0xffffffff) throw new RangeError('WAV data exceeds the 4 GiB RIFF limit')

  const bytes = new Uint8Array(HEADER_BYTES + samples.byteLength + pad)
  const view = new DataView(bytes.buffer)
  const tag = (offset: number, text: string) => {
    for (let index = 0; index < 4; index += 1) bytes[offset + index] = text.charCodeAt(index)
  }
  tag(0, 'RIFF')
  view.setUint32(4, riffSize, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  tag(36, 'data')
  view.setUint32(40, samples.byteLength, true)
  bytes.set(samples, HEADER_BYTES)
  return bytes
}
