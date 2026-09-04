import { describe, expect, it } from 'vitest'
import { classifyNormalMapFormat } from '../../../src/legacy/models/texture-codec.js'

describe('normal-map format classification', () => {
  it('maps format tags onto decode conventions', () => {
    expect(classifyNormalMapFormat('dxt5')).toBe('dxt5nm')
    expect(classifyNormalMapFormat('bc5')).toBe('bc5')
    expect(classifyNormalMapFormat('rgba8')).toBe('rgb8')
    expect(classifyNormalMapFormat('png')).toBe('rgb8')
  })
})
