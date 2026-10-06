import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { materialAlpha, alphaDrawOrder, depthSortedTriangles } from '../src/render/alpha.js'
import { sceneMaterialDraws } from '../src/render/material-draws.js'
import { createStandardMaterialPrograms } from '../src/materials/index.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const translation = z => Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1)
/** One primitive of two quads: the first at z -0.5, nearer under the identity view than the second at z 0.5. */
const twoQuads = id => ({
  id,
  materialId: 'water',
  topology: 'triangles',
  positions: Float32Array.of(
    ...[-1, -1, 1, -1, 1, 1, -1, 1].flatMap((value, index) =>
      index % 2 ? [value, -0.5] : [value],
    ),
    ...[-1, -1, 1, -1, 1, 1, -1, 1].flatMap((value, index) => (index % 2 ? [value, 0.5] : [value])),
  ),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7),
})
/** The far quad first, then the near one. */
const FAR_FIRST = [4, 5, 6, 4, 6, 7, 0, 1, 2, 0, 2, 3]
const NEAR_FIRST = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]
/**
 * A skin as the sampler gives it (ModelSceneSkin): each vertex wholly moved by the slot `slots` names,
 * the palette the given matrices then the identity. Posing it on the CPU counts and fails.
 */
const skinOf = (slots, matrices, counter) => ({
  joints: Uint8Array.from(
    slots.flatMap(slot => [slot, matrices.length, matrices.length, matrices.length]),
  ),
  weights: Float32Array.from(slots.flatMap(() => [1, 0, 0, 0])),
  palette: Float32Array.from([...matrices.flatMap(matrix => [...matrix]), ...identity]),
  deformed: () => {
    counter.posed += 1
    throw new Error('skin posed on the CPU')
  },
})
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

it('orders blended skins where their poses stand, without posing them on the CPU', () => {
  const counter = { posed: 0 }
  // one bind pose at z 0; each palette moves its skin along z
  const skinned = (id, z) => ({
    ...quad(id),
    skin: skinOf([0, 0, 0, 0], [translation(z)], counter),
  })
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
  const near = skinned('near', -0.5)
  const far = skinned('far', 0.5)
  for (const primitives of [
    [near, far],
    [far, near],
  ])
    assert.deepEqual(
      alphaDrawOrder(primitives, blendOf(['near', 'far']), identity).map(x => x.id),
      ['far', 'near'],
    )
  assert.equal(counter.posed, 0)
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

it('sorts each placement of a shared blended skin once while view and pose stay, by its pose', () => {
  // the first quad's vertices move with slot 0, the second's with slot 1
  const counter = { posed: 0 }
  const { positions, indices } = twoQuads('water')
  const rest = skinOf([0, 0, 0, 0, 1, 1, 1, 1], [identity, identity], counter)
  const placed = (x, skin = rest) => {
    const transform = identity.slice()
    transform[12] = x
    return {
      id: `water ${x}`,
      materialId: 'water',
      topology: 'triangles',
      positions,
      indices,
      skin,
      transform,
    }
  }
  const left = placed(-3)
  const right = placed(3)
  const first = depthSortedTriangles(left, identity)
  assert.deepEqual([...first.indices], FAR_FIRST)
  // the placements share their vertices, not their placement: the second sorts for its own
  depthSortedTriangles(right, identity)
  // and the first, at the same view, comes back as it was, sorted no more
  assert.equal(depthSortedTriangles(left, identity), first)
  // another view sorts again
  const behind = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)
  assert.deepEqual([...depthSortedTriangles(left, behind).indices], NEAR_FIRST)
  // and so does another pose: slot 1 brings the second quad in front of the first
  const moved = placed(-3, skinOf([0, 0, 0, 0, 1, 1, 1, 1], [identity, translation(-2)], counter))
  assert.deepEqual([...depthSortedTriangles(moved, identity).indices], NEAR_FIRST)
  assert.equal(counter.posed, 0)
})

it("keeps a primitive's order while an orthographic view moves or zooms, and its array while the order stays", () => {
  const water = twoQuads('pan')
  const view = (scale, x, y) =>
    Float32Array.of(scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, x, y, 0.25, 1)
  const first = depthSortedTriangles(water, view(1, 0, 0))
  assert.deepEqual([...first.indices], FAR_FIRST)
  // moving or zooming an orthographic view adds the same to every depth and scales them alike
  assert.equal(depthSortedTriangles(water, view(1, 0.5, -0.25)), first)
  assert.equal(depthSortedTriangles(water, view(2, 0.5, -0.25)), first)
  // a perspective view sorts again, and the same order found keeps its index array
  const perspective = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 2)
  assert.equal(depthSortedTriangles(water, perspective).indices, first.indices)
  // turned around, the order changes
  const behind = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)
  assert.deepEqual([...depthSortedTriangles(water, behind).indices], NEAR_FIRST)
})

it("leaves a blended draw's own triangles in their order where the order cannot show", () => {
  const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
  const standard = (blendMode, depthPrepass) => ({
    layers: {
      diffuse: {
        slot: 'diffuse',
        texturePath: null,
        constantColor: { value: [0.4, 0.4, 0.4, 0.5] },
        uvSource: 0,
        channels: 1,
        op: 2,
        teamColorMode: 0,
        invert: false,
        clampResult: true,
        wrapX: true,
        wrapY: true,
      },
    },
    blendMode,
    priority: 0,
    specularity: 10,
    specMult: 1,
    emisMult: 1,
    specMode: 0,
    alphaTestThreshold: 0,
    twoSided: false,
    unshaded: false,
    doubleLambert: false,
    clampOutput: false,
    usesVertexColor: false,
    usesVertexAlpha: false,
    depthPrepass,
  })
  /** The order a colour pass of the material draws the two quads in: authored, or sorted. */
  const orderOf = (blendMode, { depthPrepass = false, tint } = {}) => {
    const water = {
      ...twoQuads('water'),
      normals: Float32Array.from({ length: 24 }, (_, index) => (index % 3 === 2 ? 1 : 0)),
      tangents: Float32Array.from({ length: 32 }, (_, index) =>
        index % 4 === 0 || index % 4 === 3 ? 1 : 0,
      ),
      textureCoordinates: new Float32Array(16),
      ...(tint === undefined ? {} : { tint }),
    }
    const passes = createStandardMaterialPrograms(
      { renderModel: { version: 1, standard: standard(blendMode, depthPrepass) } },
      { budget },
    ).sample({ time: 0 })
    const draws = sceneMaterialDraws(
      [water],
      [{ id: 'water', baseColor: [1, 1, 1, 1] }],
      new Map([['water', { passes, textures: new Map() }]]),
      identity,
      [],
      1,
    )
    const colour = draws.find(draw => draw.depthOnly !== true).primitive
    return colour.indices === water.indices ? 'authored' : [...colour.indices]
  }
  // source-over (blend 1, premultiplied 6, a fading solid pass) and modulate2x (5, clamped after
  // each triangle) show it
  for (const blendMode of [1, 5, 6])
    assert.deepEqual(orderOf(blendMode), FAR_FIRST, `blend ${blendMode}`)
  assert.deepEqual(orderOf(0, { tint: [1, 1, 1, 0.5] }), FAR_FIRST)
  // additive (2), add-alpha (3) and modulate (4) add or multiply what each triangle draws
  for (const blendMode of [2, 3, 4])
    assert.equal(orderOf(blendMode), 'authored', `blend ${blendMode}`)
  // a depth prepass leaves the colour pass only the nearest surface
  assert.equal(orderOf(1, { depthPrepass: true }), 'authored')
})
