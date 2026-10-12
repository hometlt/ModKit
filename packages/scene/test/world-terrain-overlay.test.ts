import { expect, it } from 'vitest'
import { overlayFixture, overlayCamera } from './terrain-overlay-fixture.js'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { renderWorldHeadless } from '../src/world/headless.js'

const pixel = async (options: Parameters<typeof overlayFixture>[0]) => {
  const input = overlayFixture(options)
  const plan = createWorldWebGlPlan(input)
  const frame = await renderWorldHeadless(plan, { width: 64, height: 64, camera: overlayCamera })
  return [...frame.rgba.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)]
}
it.each([false, true])(
  'draws buried road above terrain with self-depth in either source order (%s)',
  async reverse => {
    expect(await pixel({ reverse })).toEqual([255, 0, 0, 255])
  },
)
it('ordinary models retain their front/behind depth tests against the road', async () => {
  expect(await pixel({ building: 1.5 })).toEqual([0, 255, 0, 255])
  expect(await pixel({ building: -0.4 })).toEqual([255, 0, 0, 255])
})
it('retains alpha-test holes and ordinary terrain occlusion when the policy is absent', async () => {
  const masked = await pixel({ mask: true })
  const ordinary = await pixel({ overlay: false })
  expect(masked).not.toEqual([255, 0, 0, 255])
  expect(ordinary).not.toEqual([255, 0, 0, 255])
  expect(masked).toEqual(ordinary)
})
