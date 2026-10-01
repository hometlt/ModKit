import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { materialAlpha, alphaDrawOrder } from '../src/render/alpha.js'
import { sceneMaterialDraws } from '../src/render/material-draws.js'

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

it('orders placements that share one vertex array by their own transforms, under every camera', () => {
  const shared = quad('shared').positions
  const placed = (id, z) => {
    const transform = identity.slice()
    transform[14] = z
    return { ...quad(id), positions: shared, transform }
  }
  const primitives = [placed('near', -0.5), placed('far', 0.5), placed('middle', 0)]
  const blend = () => ({ mode: 'blend', cutoff: 0.5 })
  assert.deepEqual(
    alphaDrawOrder(primitives, blend, identity).map(x => x.id),
    ['far', 'middle', 'near'],
  )
  // A camera looking the other way sorts the same arrays the other way round.
  const flipped = identity.slice()
  flipped[10] = -1
  assert.deepEqual(
    alphaDrawOrder(primitives, blend, flipped).map(x => x.id),
    ['near', 'middle', 'far'],
  )
  const broken = { ...quad('broken'), positions: Float32Array.of(0, 0, Number.NaN) }
  for (let round = 0; round < 2; round++)
    assert.throws(() => alphaDrawOrder([broken], blend, identity), /nonfinite blend position/)
})

it('poses a skin on the CPU only when there are blended primitives to order', () => {
  let posed = 0
  const skinned = (id, z) => {
    const positions = quad(id).positions.map((value, index) => (index % 3 === 2 ? z : value))
    return {
      ...quad(id),
      skin: {
        deformed: () => {
          posed += 1
          return { positions }
        },
      },
    }
  }
  const blendOf = ids => materialId => ({
    mode: ids.includes(materialId) ? 'blend' : 'opaque',
    cutoff: 0.5,
  })
  const lone = skinned('lone', 0.5)
  const solid = quad('solid')
  assert.deepEqual(
    alphaDrawOrder([lone, solid], blendOf(['lone']), identity).map(x => x.id),
    ['solid', 'lone'],
  )
  assert.equal(posed, 0)
  // Two blended skins order where their poses stand.
  const near = skinned('near', -0.5)
  const far = skinned('far', 0.5)
  assert.deepEqual(
    alphaDrawOrder([near, far], blendOf(['near', 'far']), identity).map(x => x.id),
    ['far', 'near'],
  )
  assert.equal(posed, 2)
})

it("draws a blended primitive's own triangles back to front, again while the view stays", () => {
  // one primitive of two quads: z -0.5 is nearer than z 0.5 under the identity view
  const water = {
    id: 'water',
    materialId: 'water',
    topology: 'triangles',
    positions: Float32Array.of(
      ...[-1, -1, 1, -1, 1, 1, -1, 1].flatMap((value, index) =>
        index % 2 ? [value, -0.5] : [value],
      ),
      ...[-1, -1, 1, -1, 1, 1, -1, 1].flatMap((value, index) =>
        index % 2 ? [value, 0.5] : [value],
      ),
    ),
    indices: Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7),
  }
  const draws = (view, alphaMode = 'blend') =>
    sceneMaterialDraws(
      [water],
      [{ id: 'water', baseColor: [0, 0, 1, 0.5], alphaMode }],
      new Map(),
      view,
      [],
      1,
    )[0].primitive.indices
  const sorted = draws(identity)
  assert.deepEqual([...sorted], [4, 5, 6, 4, 6, 7, 0, 1, 2, 0, 2, 3])
  // the same view draws the same index array again
  assert.equal(draws(identity), sorted)
  // seen from the other side the far quad is the near one
  const behind = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)
  assert.deepEqual([...draws(behind)], [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  // an opaque primitive keeps its own order
  assert.equal(draws(identity, 'opaque'), water.indices)
})
