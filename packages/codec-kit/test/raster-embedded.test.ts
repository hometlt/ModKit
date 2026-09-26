import { describe, expect, it } from 'vitest'
import { findEmbeddedImage } from '../src/raster/embedded.js'

describe('embedded standard image', () => {
  it('finds a DDS or PNG signature behind a header and nothing in noise', () => {
    const head = new Uint8Array(64).fill(0xee)
    head.set([0x44, 0x44, 0x53, 0x20], 20)
    expect(findEmbeddedImage(head)).toEqual({ kind: 'dds', offset: 20 })
    head.set([0x89, 0x50, 0x4e, 0x47], 8)
    expect(findEmbeddedImage(head)).toEqual({ kind: 'png', offset: 8 })
    expect(findEmbeddedImage(new Uint8Array(64).fill(0xee))).toBeUndefined()
  })

  it('recognises a plausible TGA header', () => {
    const head = new Uint8Array(64).fill(0xee)
    // true-colour TGA, 4x2, 32 bits per pixel, starting at 5
    head.set([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 2, 0, 32], 5)
    expect(findEmbeddedImage(head)).toEqual({ kind: 'tga', offset: 5 })
  })
})
