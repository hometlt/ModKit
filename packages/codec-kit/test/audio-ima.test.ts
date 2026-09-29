import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decodeImaAdpcmBlock } from '../src/audio/ima.js'

const hex = (text: string) => Uint8Array.from(text.match(/../gu) ?? [], byte => parseInt(byte, 16))

describe('Microsoft IMA ADPCM blocks', () => {
  it('starts at the header predictor and sums the shifted steps, low nibble first', () => {
    // index 0 (step 7): code 7 -> 0 + 1 + 3 + 7 = 11, index 8 (step 16); code 0 -> 16 >> 3 = 2,
    // then the index falls a step a code (14, 13, ... 9) and each adds 1.
    const block = Uint8Array.of(100, 0, 0, 0, 0x07, 0x00, 0x00, 0x00)
    expect([...decodeImaAdpcmBlock(block, 1)]).toEqual([
      100, 111, 113, 114, 115, 116, 117, 118, 119,
    ])
  })

  it('alternates 4-byte words by channel and keeps a short block to its whole words', () => {
    const block = Uint8Array.of(10, 0, 0, 0, 0xf6, 0xff, 0, 0, 0x07, 0, 0, 0, 0, 0, 0, 0, 0x99)
    const frames = decodeImaAdpcmBlock(block, 2)
    expect(frames.length).toBe(18) // the trailing byte is not a whole word group
    expect([frames[0], frames[1], frames[2], frames[3]]).toEqual([10, -10, 21, -10]) // code 0 at step 7 adds 7 >> 3 = 0
    expect(decodeImaAdpcmBlock(Uint8Array.of(1, 2, 3), 1).length).toBe(0)
  })

  it('decodes a stereo block of 0x24 bytes a channel as ffmpeg adpcm_ima_wav does', () => {
    const block = hex(
      'd41c3400d4de0c0004e44424846460100030a0504070e09080b020d0c0f0601000cba050400b168ea6deb6ae4' +
        '6fe56cee61ef6ee863e310d54f414b4d474943454f414b4d47430a0',
    )
    const frames = decodeImaAdpcmBlock(block, 2)
    expect(frames.length).toBe(65 * 2)
    expect(createHash('sha256').update(new Uint8Array(frames.buffer)).digest('hex')).toBe(
      '64261153d8736e8de327941f70105645ac80c3f1f68db40223cbbe6370744c9c',
    )
  })
})
