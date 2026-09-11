import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { materialAlpha, alphaDrawOrder } from '../src/render/alpha.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const quad = (id, z = 0, materialId = id) => ({
  id,
  materialId,
  topology: 'triangles',
  positions: Float32Array.of(-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
  textureCoordinates: Float32Array.of(0, 0, 0, 0, 0, 0, 0, 0),
})
const draw = (materials, primitives, textures) =>
  renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: { materials, primitives, ...(textures === undefined ? {} : { textures }) },
  })
const uniform = (frame, expected) => {
  for (let i = 0; i < frame.rgba.length; i += 4)
    assert.deepEqual([...frame.rgba.subarray(i, i + 4)], expected, `pixel ${i / 4}`)
}

it('opaque ignores both factor and texel alpha', async () => {
  const result = await draw(
    [{ id: 'red', baseColor: [1, 0, 0, 0], baseColorTexture: 'tex' }],
    [quad('red')],
    [{ id: 'tex', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 0) }],
  )
  uniform(result, [255, 0, 0, 255])
})

it('mask holes do not write depth and threshold equality is covered', async () => {
  for (const reverse of [false, true]) {
    const primitives = [quad('red', -0.5), quad('blue', 0.5)]
    if (reverse) primitives.reverse()
    const materials = [
      { id: 'red', baseColor: [1, 0, 0, 0.25], alphaMode: 'mask', alphaCutoff: 0.5 },
      { id: 'blue', baseColor: [0, 0, 1, 1] },
    ]
    uniform(await draw(materials, primitives), [0, 0, 255, 255])
    materials[0].baseColor[3] = 0.5
    uniform(await draw(materials, primitives), [255, 0, 0, 255])
  }
})

it('mask and blend use the product of material and texture alpha', async () => {
  const textures = [{ id: 'tex', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 128) }]
  const material = {
    id: 'red',
    baseColor: [1, 0, 0, 0.5],
    baseColorTexture: 'tex',
    alphaMode: 'mask',
    alphaCutoff: 0.3,
  }
  uniform(await draw([material], [quad('red')], textures), [0, 0, 0, 0])
  material.alphaMode = 'blend'
  uniform(await draw([material], [quad('red')], textures), [255, 0, 0, 64])
})

it('blend sorts far to near, uses source-over, and covers shared edges once for either winding', async () => {
  for (const reverse of [false, true])
    for (const winding of [false, true]) {
      const primitives = [quad('red', -0.5), quad('blue', 0.5)]
      if (reverse) primitives.reverse()
      if (winding)
        for (const primitive of primitives) primitive.indices = Uint32Array.of(2, 1, 0, 3, 2, 0)
      const frame = await draw(
        [
          { id: 'red', baseColor: [1, 0, 0, 0.5], alphaMode: 'blend' },
          { id: 'blue', baseColor: [0, 0, 1, 0.5], alphaMode: 'blend' },
        ],
        primitives,
      )
      uniform(frame, [170, 0, 85, 192])
      assert.equal(frame.statistics.fragments, 128)
    }
})

it('solid depth occludes translucent geometry and translucent surfaces do not hide later surfaces', async () => {
  uniform(
    await draw(
      [
        { id: 'red', baseColor: [1, 0, 0, 0.5], alphaMode: 'blend' },
        { id: 'blue', baseColor: [0, 0, 1, 1] },
      ],
      [quad('red', 0.5), quad('blue', -0.5)],
    ),
    [0, 0, 255, 255],
  )
})

it('draw order includes model transforms and rejects invalid alpha state', () => {
  const a = quad('a'),
    b = quad('b')
  a.transform = identity.slice()
  a.transform[14] = -0.5
  b.transform = identity.slice()
  b.transform[14] = 0.5
  assert.deepEqual(
    alphaDrawOrder([a, b], () => ({ mode: 'blend', cutoff: 0.5 }), identity).map(x => x.id),
    ['b', 'a'],
  )
  assert.throws(() => materialAlpha({ alphaMode: 'unknown' }), /alpha mode/)
  for (const alphaCutoff of [-1, NaN, Infinity])
    assert.throws(() => materialAlpha({ alphaCutoff }), /cutoff/)
})
