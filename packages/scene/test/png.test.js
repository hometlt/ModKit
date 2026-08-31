import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { encodeRgbaPng } from '../src/output/png.js'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('scene PNG output', () => {
  it('encodes deterministic RGBA output', async () => {
    const frame = {
      width: 2,
      height: 1,
      rgba: Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]),
    }
    const first = await encodeRgbaPng(frame)
    const second = await encodeRgbaPng(frame)

    assert.deepEqual([...first.subarray(0, 8)], PNG_SIGNATURE)
    assert.deepEqual(first, second)
  })
})
