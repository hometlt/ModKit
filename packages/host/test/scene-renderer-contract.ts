import { describe, expect, it } from 'vitest'
import type { SceneRenderer } from '@modkitx-x3/sdk/renderer'

const identity = (): Float32Array =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1])

export function sceneRendererContractSuite(
  name: string,
  rendererFactory: () => SceneRenderer,
): void {
  describe(`${name} scene-renderer contract`, () => {
    it('returns an owned bounded RGBA8 frame for typed geometry', async () => {
      const renderer = rendererFactory()
      const frame = await renderer.render({
        scene: {
          materials: [{ id: 'red', baseColor: [1, 0, 0, 1] }],
          primitives: [
            {
              id: 'triangle',
              topology: 'triangles',
              positions: new Float32Array([-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0]),
              indices: new Uint32Array([0, 1, 2]),
              materialId: 'red',
            },
          ],
        },
        camera: { viewProjection: identity() },
        viewport: { width: 16, height: 16 },
        clearColor: [0, 0, 0, 1],
        outputKind: 'rgba8',
      })

      expect(frame).toMatchObject({
        outputKind: 'rgba8',
        width: 16,
        height: 16,
        diagnostics: [],
        statistics: { primitives: 1, triangles: 1 },
      })
      expect(frame.rgba).toBeInstanceOf(Uint8Array)
      expect(frame.rgba).toHaveLength(16 * 16 * 4)
      expect(frame.statistics.fragments).toBeGreaterThan(0)
      let redPixels = 0
      for (let offset = 0; offset < frame.rgba.length; offset += 4) {
        if (
          frame.rgba[offset] === 255 &&
          frame.rgba[offset + 1] === 0 &&
          frame.rgba[offset + 2] === 0 &&
          frame.rgba[offset + 3] === 255
        ) {
          redPixels += 1
        }
      }
      expect(redPixels).toBe(frame.statistics.fragments)
    })

    it('reports a non-triangle topology instead of inventing geometry', async () => {
      const frame = await rendererFactory().render({
        scene: {
          primitives: [
            {
              id: 'line',
              topology: 'lines',
              positions: new Float32Array([-1, 0, 0, 1, 0, 0]),
            },
          ],
        },
        camera: { viewProjection: identity() },
        viewport: { width: 8, height: 8 },
        outputKind: 'rgba8',
      })
      expect(frame.statistics).toMatchObject({ primitives: 1, triangles: 0, fragments: 0 })
      expect(frame.diagnostics).toEqual([
        expect.objectContaining({ severity: 'warning', primitiveId: 'line' }),
      ])
    })

    it('honours an already-aborted request', async () => {
      const controller = new AbortController()
      controller.abort('contract-test')
      await expect(
        rendererFactory().render({
          scene: { primitives: [] },
          camera: { viewProjection: identity() },
          viewport: { width: 8, height: 8 },
          outputKind: 'rgba8',
          signal: controller.signal,
        }),
      ).rejects.toBeDefined()
    })
  })
}
