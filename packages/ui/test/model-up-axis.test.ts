import type { SceneRendererPrimitive } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { framePrimitives, orientPrimitive, upAxisCorrection } from '../src/model/scene.js'

/** A single triangle standing along +Z, which is where a z-up publisher puts "up". */
function standing(): SceneRendererPrimitive {
  return {
    id: 'triangle',
    topology: 'triangles',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 4]),
    indices: new Uint32Array([0, 1, 2]),
  } as SceneRendererPrimitive
}

describe('publisher up axis', () => {
  it('turns nothing for a publisher that is already y-up', () => {
    expect(upAxisCorrection(undefined)).toBeUndefined()
    expect(upAxisCorrection('+y')).toBeUndefined()
    const primitive = standing()
    expect(orientPrimitive(primitive, undefined)).toBe(primitive)
  })

  it('brings a z-up model onto the viewer y axis', () => {
    const correction = upAxisCorrection('+z')
    expect(correction).toBeDefined()
    const oriented = orientPrimitive(standing(), correction)
    // The orbit controller works in y-up space, so the tall axis has to become Y before the model
    // is framed or lit; otherwise it lies on its side and the key light rakes it from below.
    const framing = framePrimitives([oriented])
    expect(framing.center[1]).toBeCloseTo(2, 5)
    expect(framing.center[2]).toBeCloseTo(0, 5)
  })

  it('composes with a transform the primitive already carries', () => {
    const correction = upAxisCorrection('+z')
    const moved = {
      ...standing(),
      // Column-major translation of +10 along the publisher's Z.
      transform: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1]),
    } as SceneRendererPrimitive
    const oriented = orientPrimitive(moved, correction)
    const framing = framePrimitives([oriented])
    // The existing translation is turned with the model rather than dropped or applied twice.
    expect(framing.center[1]).toBeCloseTo(12, 5)
  })
})
