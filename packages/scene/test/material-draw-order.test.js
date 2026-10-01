import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { uvmMaterialDrawOrder } from '../src/uvm/materials.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const quad = (id, z) => ({
  id,
  materialId: id,
  topology: 'triangles',
  positions: Float32Array.of(-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
})
/** The centre pixel of red (near, z -0.5) and blue (far, z 0.5) drawn in this order. */
async function centre(red, blue) {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: {
      materials: [
        { id: 'red', baseColor: [1, 0, 0, 0.5], ...red },
        { id: 'blue', baseColor: [0, 0, 1, 0.5], ...blue },
      ],
      primitives: [quad('red', -0.5), quad('blue', 0.5)],
    },
  })
  return [...frame.rgba.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)]
}

it('draws blended materials by priority before depth (UV_game_material.sortPriority)', async () => {
  const blend = { alphaMode: 'blend' }
  // back to front: the near red over the far blue
  assert.deepEqual(await centre(blend, blend), [170, 0, 85, 192])
  // the far blue's higher priority draws it later, over the red
  assert.deepEqual(await centre(blend, { ...blend, priority: 1 }), [85, 0, 170, 192])
})

it('writes depth as the material says, else as its alpha mode does', async () => {
  // the red draws first and, writing depth, hides the far blue drawn after it
  assert.deepEqual(
    await centre({ alphaMode: 'blend', depthWrite: true }, { alphaMode: 'blend', priority: 1 }),
    [255, 0, 0, 128],
  )
  // an opaque material that does not write depth lets a farther draw after it cover it
  assert.deepEqual(await centre({}, {}), [255, 0, 0, 255])
  assert.deepEqual(await centre({ depthWrite: false }, {}), [0, 0, 255, 255])
})

it('reads a UVM material order from its game material, else from the publisher fields', () => {
  assert.deepEqual(
    uvmMaterialDrawOrder({
      extensions: { UV_game_material: { shader: 's', depthWrite: false, sortPriority: 4 } },
    }),
    { depthWrite: false, priority: 4 },
  )
  assert.deepEqual(
    uvmMaterialDrawOrder({
      extras: { modkit: { material: { version: 1, fields: { depthWrite: true, priority: 2 } } } },
    }),
    { depthWrite: true, priority: 2 },
  )
  assert.deepEqual(uvmMaterialDrawOrder({}), {})
})
