// Generated from immutable MK2 declarations. Change the strict adapter, not these algorithms.
// Source selection: packages/codec-kit/crypto-digest-kernels.config.json
import { ModkitError } from '../legacy/core/index.js'

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new ModkitError({
      code: 'CODEC_RUNTIME_LOAD_FAILED',
      message: 'The UVM writer requires the standard Web Crypto SHA-256 implementation.',
    })
  }
  const input = Uint8Array.from(bytes)
  const digest = new Uint8Array(await subtle.digest('SHA-256', input))
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('')
}

export {  }
