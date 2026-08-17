import { describe, expect, it } from 'vitest'

import { createOrbitController } from '../src/model/orbit.js'

const dot = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((sum, value, index) => sum + value * (b[index] as number), 0)

describe('orbit controller', () => {
  it('starts at MK2 default pose', () => {
    const camera = createOrbitController()
    expect(camera.pose).toEqual({ yaw: 0.7, pitch: 0.45, distanceScale: 1 })
  })

  it('applies MK2 drag sensitivity', () => {
    const camera = createOrbitController({ yaw: 0, pitch: 0 })
    camera.orbit(100, 50)
    expect(camera.pose.yaw).toBeCloseTo(0.8, 10)
    expect(camera.pose.pitch).toBeCloseTo(0.4, 10)
  })

  it('clamps pitch asymmetrically, as MK2 does', () => {
    const camera = createOrbitController({ pitch: 0 })
    camera.orbit(0, 100_000)
    expect(camera.pose.pitch).toBe(1.5)
    camera.orbit(0, -100_000)
    expect(camera.pose.pitch).toBe(-1.4)
  })

  it('steps and clamps zoom on the MK2 wheel curve', () => {
    const camera = createOrbitController()
    camera.zoom(1)
    expect(camera.pose.distanceScale).toBeCloseTo(1.1, 10)
    camera.zoom(-1)
    expect(camera.pose.distanceScale).toBeCloseTo(0.99, 10)
    for (let step = 0; step < 200; step += 1) camera.zoom(1)
    expect(camera.pose.distanceScale).toBe(8)
    for (let step = 0; step < 400; step += 1) camera.zoom(-1)
    expect(camera.pose.distanceScale).toBe(0.15)
  })

  it('produces an orthonormal basis at every pose', () => {
    const camera = createOrbitController()
    const poses: readonly (readonly [number, number])[] = [
      [0, 0],
      [0.7, 0.45],
      [-2.1, 1.4],
      [Math.PI, -1.3],
    ]
    for (const [yaw, pitch] of poses) {
      camera.set({ yaw, pitch })
      const { backward, right, up } = camera.basis()
      expect(Math.hypot(...backward)).toBeCloseTo(1, 6)
      expect(Math.hypot(...right)).toBeCloseTo(1, 6)
      expect(Math.hypot(...up)).toBeCloseTo(1, 6)
      expect(dot(backward, right)).toBeCloseTo(0, 6)
      expect(dot(backward, up)).toBeCloseTo(0, 6)
      expect(dot(right, up)).toBeCloseTo(0, 6)
    }
  })

  it('snaps each axis to a pose that looks down that axis', () => {
    const camera = createOrbitController()
    // The camera sits on the +axis it is named for, so `backward` must align with it.
    const expected: Record<string, readonly number[]> = {
      '+x': [1, 0, 0],
      '-x': [-1, 0, 0],
      '+y': [0, 1, 0],
      '-y': [0, -1, 0],
      '+z': [0, 0, 1],
      '-z': [0, 0, -1],
    }
    for (const [axis, vector] of Object.entries(expected)) {
      camera.snapTo(axis as '+x')
      expect(dot(camera.basis().backward, vector)).toBeCloseTo(1, 3)
    }
  })

  it('never reaches a degenerate basis at the poles', () => {
    const camera = createOrbitController()
    camera.snapTo('+y')
    const { right } = camera.basis()
    expect(Number.isFinite(right[0] as number)).toBe(true)
    expect(Math.hypot(...right)).toBeCloseTo(1, 6)
  })

  it('places the camera at the framing radius scaled by distance', () => {
    const camera = createOrbitController({ yaw: 0, pitch: 0, distanceScale: 2 })
    const position = camera.position([0, 0, 0], 10)
    expect(position[0]).toBeCloseTo(0, 6)
    expect(position[1]).toBeCloseTo(0, 6)
    expect(position[2]).toBeCloseTo(20, 6)
  })

  it('notifies listeners and stops after unsubscribe', () => {
    const camera = createOrbitController()
    const seen: number[] = []
    const off = camera.onChange(pose => seen.push(pose.yaw))
    camera.orbit(10, 0)
    off()
    camera.orbit(10, 0)
    expect(seen).toHaveLength(1)
  })

  it('rejects an unknown axis rather than silently holding the pose', () => {
    const camera = createOrbitController()
    expect(() => camera.snapTo('+w' as '+x')).toThrow(TypeError)
  })
})
