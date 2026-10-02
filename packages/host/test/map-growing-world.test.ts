import { describe, expect, it, vi } from 'vitest'
import type {
  CandidateWorldSceneSource,
  MapWorldCanonicalTransform,
  MapWorldWindow,
} from '@modkit/sdk/maps'
import { growingWorldLease, nativeWorldWindow } from '../src/maps/index.js'

/** A world lease whose pages name its snapshot, recording its release. */
function world(snapshotId: string, released: string[], uvwTransform?: MapWorldCanonicalTransform) {
  const value = {
    contract: 'common.view/world-scene-source',
    major: 1,
    snapshotId,
    info: async () => ({ snapshotId, ...(uvwTransform === undefined ? {} : { uvwTransform }) }),
    page: async () => ({ snapshotId, facet: 'layers', state: 'available', items: [] }),
  } as unknown as CandidateWorldSceneSource
  return { value, release: async () => void released.push(snapshotId) }
}

const window = (minimumX: number, minimumY: number, maximumX: number, maximumY: number) => ({
  minimumX,
  minimumY,
  maximumX,
  maximumY,
})

describe('a world larger than one analysis reads (MW5)', () => {
  it('moves to the part a viewer looks at, and stays where that part is covered', async () => {
    const released: string[] = []
    const grow = vi.fn(async (wanted: MapWorldWindow, _holds: MapWorldWindow) => ({
      lease: world(`at ${wanted.minimumX},${wanted.minimumY}`, released),
      // the provider covers a window of its own around what was asked
      covered: window(
        wanted.minimumX - 8,
        wanted.minimumY - 8,
        wanted.maximumX + 8,
        wanted.maximumY + 8,
      ),
    }))
    const shared = vi.fn(async () => void released.push('models'))
    const lease = growingWorldLease(
      world('spawn', released),
      window(0, 0, 16, 16),
      grow,
      () => undefined,
      shared,
    )
    // a window inside the first part asks for nothing
    expect(await lease.value.focus!({ minimumX: 2, minimumZ: 2, maximumX: 10, maximumZ: 10 })).toBe(
      false,
    )
    expect(grow).not.toHaveBeenCalled()
    // past it: the provider is asked for that window, in map-native x and y (no transform: x, z)
    expect(
      await lease.value.focus!({ minimumX: 40, minimumZ: 50, maximumX: 48, maximumZ: 58 }),
    ).toBe(true)
    expect(grow.mock.calls[0]![0]).toEqual(window(40, 50, 48, 58))
    // with the part the world holds, which a plan for the same part need not read again
    expect(grow.mock.calls[0]![1]).toEqual(window(0, 0, 16, 16))
    expect(lease.value.snapshotId).toBe('at 40,50')
    expect((await lease.value.page({ facet: 'layers', limit: 1 })).snapshotId).toBe('at 40,50')
    // the part it replaced is released at the swap; the new part covers its neighbourhood
    expect(released).toEqual(['spawn'])
    expect(
      await lease.value.focus!({ minimumX: 35, minimumZ: 45, maximumX: 50, maximumZ: 60 }),
    ).toBe(false)
    await lease.release()
    await lease.release()
    expect(released).toEqual(['spawn', 'at 40,50', 'models'])
    expect(shared).toHaveBeenCalledOnce()
  })

  it('keeps the world shown when the provider cannot move there, and runs one ask at a time', async () => {
    const released: string[] = []
    let calls = 0
    const lease = growingWorldLease(
      world('spawn', released),
      window(0, 0, 16, 16),
      async wanted => {
        calls += 1
        if (wanted.minimumX > 100) return undefined
        return { lease: world(`part ${calls}`, released), covered: window(0, 0, 64, 64) }
      },
      () => undefined,
      async () => undefined,
    )
    expect(
      await lease.value.focus!({ minimumX: 200, minimumZ: 0, maximumX: 210, maximumZ: 10 }),
    ).toBe(false)
    expect(lease.value.snapshotId).toBe('spawn')
    // two asks at once: the second sees what the first covered and asks nothing more
    const [one, two] = await Promise.all([
      lease.value.focus!({ minimumX: 20, minimumZ: 20, maximumX: 30, maximumZ: 30 }),
      lease.value.focus!({ minimumX: 30, minimumZ: 30, maximumX: 40, maximumZ: 40 }),
    ])
    expect([one, two]).toEqual([true, false])
    expect(calls).toBe(2)
    await lease.release()
  })

  it("reads a viewer's window back through the world's canonical transform", () => {
    // uvw x = native x, uvw z = −native y + 100 (a map-native y that grows south, rows reversed)
    const transform = {
      axes: {
        x: { sourceAxis: 'x', scale: 1, offset: 0 },
        y: { sourceAxis: 'z', scale: 1, offset: 0 },
        z: { sourceAxis: 'y', scale: -1, offset: 100 },
      },
    } as unknown as MapWorldCanonicalTransform
    expect(
      nativeWorldWindow({ minimumX: 10, minimumZ: 20, maximumX: 30, maximumZ: 60 }, transform),
    ).toEqual(window(10, 40, 30, 80))
    // a ground whose axes are not native x and y cannot be read back
    const upright = {
      axes: {
        x: { sourceAxis: 'x', scale: 1, offset: 0 },
        y: { sourceAxis: 'y', scale: 1, offset: 0 },
        z: { sourceAxis: 'z', scale: 1, offset: 0 },
      },
    } as unknown as MapWorldCanonicalTransform
    expect(
      nativeWorldWindow({ minimumX: 0, minimumZ: 0, maximumX: 1, maximumZ: 1 }, upright),
    ).toBeUndefined()
    expect(() =>
      nativeWorldWindow({ minimumX: 2, minimumZ: 0, maximumX: 1, maximumZ: 1 }, undefined),
    ).toThrow(TypeError)
  })
})
