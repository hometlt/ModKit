import { describe, expect, it } from 'vitest'
import { unpack_crunch, unpack_unity_crunch } from '../src/texture/gpu-texture-wasm.js'

describe('Crunch unpacking through Texture2DDecoder', () => {
  it('reaches the WASM runtime and refuses data that is not Crunch', async () => {
    const noise = new Uint8Array(64).fill(7)
    expect(await unpack_crunch(noise)).toBeNull()
    expect(await unpack_unity_crunch(noise)).toBeNull()
  })
})
