import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { renderHeadless } from '../src/render/headless.js'

const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

describe('headless scene renderer', () => {
  it('draws a neutral layer list by its diffuse layer without calling its shader unsupported', async () => {
    const result = await renderHeadless({
      outputKind: 'rgba8',
      viewport: { width: 4, height: 4 },
      camera: { viewProjection: identity },
      scene: {
        materials: [
          {
            id: 'listed',
            baseColor: [1, 1, 1, 1],
            shader: {
              id: 'modkit.material-layers.v1',
              parameters: { renderModel: { layers: [{ label: 'diffuse', path: 'skin.png' }] } },
            },
            textureBindings: [{ resourceId: 'skin.png', textureId: 'skin' }],
          },
        ],
        textures: [{ id: 'skin', width: 1, height: 1, rgba: Uint8Array.of(0, 128, 255, 255) }],
        primitives: [
          {
            id: 'quad',
            topology: 'triangles',
            materialId: 'listed',
            positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
            textureCoordinates: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
          },
        ],
      },
    })
    assert.deepEqual([...result.rgba.subarray(20 * 2, 20 * 2 + 4)], [0, 128, 255, 255])
    assert.deepEqual(result.diagnostics, [])
  })

  it('renders a neutral triangle without DOM or game-specific knowledge', async () => {
    const result = await renderHeadless({
      outputKind: 'rgba8',
      viewport: { width: 16, height: 16 },
      camera: { viewProjection: identity },
      clearColor: [0, 0, 0, 0],
      scene: {
        materials: [{ id: 'material', baseColor: [1, 0.25, 0, 1] }],
        primitives: [
          {
            id: 'triangle',
            topology: 'triangles',
            materialId: 'material',
            positions: Float32Array.from([-0.75, -0.75, 0, 0, 0.75, 0, 0.75, -0.75, 0]),
          },
        ],
      },
    })

    assert.equal(result.width, 16)
    assert.equal(result.height, 16)
    assert.equal(result.rgba.byteLength, 16 * 16 * 4)
    assert.equal(result.statistics.primitives, 1)
    assert.equal(result.statistics.triangles, 1)
    assert.ok(result.statistics.fragments > 0)
  })

  // A game material names its textures in its own layer list, not as a glTF base-color texture.
  // Before this, every StarCraft II and Warcraft III material drew flat here.
  it('samples the diffuse layer a render material names through its own bindings', async () => {
    const texture = {
      id: 'diffuse-texture',
      width: 2,
      height: 2,
      rgba: Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
      filter: 'nearest',
    }
    const scene = binding => ({
      outputKind: 'rgba8',
      viewport: { width: 8, height: 8 },
      camera: { viewProjection: identity },
      clearColor: [0, 0, 0, 0],
      scene: {
        textures: [texture],
        materials: [
          {
            id: 'material',
            baseColor: [1, 1, 1, 1],
            // A game material from a publisher that does not carry StarCraft II's standard
            // material payload: the layer list is all the renderer has to go on.
            shader: {
              id: 'example.game-material.v1',
              parameters: {
                renderModel: { layers: [{ label: 'diffuse', path: 'Textures/A.dds' }] },
              },
            },
            ...(binding === undefined ? {} : { textureBindings: [binding] }),
          },
        ],
        primitives: [
          {
            id: 'triangle',
            topology: 'triangles',
            materialId: 'material',
            positions: Float32Array.from([-0.9, -0.9, 0, 0, 0.9, 0, 0.9, -0.9, 0]),
            textureCoordinates: Float32Array.from([0, 0, 0.5, 1, 1, 0]),
          },
        ],
      },
    })

    const bound = await renderHeadless(
      scene({ resourceId: 'Textures/A.dds', textureId: 'diffuse-texture' }),
    )
    const centre = (bound.height / 2) * bound.width * 4 + (bound.width / 2) * 4
    assert.equal(bound.rgba[centre], 255)
    assert.equal(bound.rgba[centre + 1], 0)
    assert.equal(bound.rgba[centre + 2], 0)

    // Without a binding the material keeps its base colour: an unresolved texture is not a
    // missing mesh, and the renderer must not invent one.
    const unbound = await renderHeadless(scene(undefined))
    assert.equal(unbound.rgba[centre], 255)
    assert.equal(unbound.rgba[centre + 1], 255)
    assert.equal(unbound.rgba[centre + 2], 255)

    // A binding that names a texture the scene did not carry is reported, not silently dropped.
    const dangling = await renderHeadless(
      scene({ resourceId: 'Textures/A.dds', textureId: 'absent-texture' }),
    )
    assert.ok(
      dangling.diagnostics.some(entry => entry.code === 'modkit.headless/diffuse-layer-unavailable'),
    )
  })

  it('modulates ordinary base-color materials with perspective-correct vertex RGBA', async () => {
    const result = await renderHeadless({
      outputKind: 'rgba8',
      viewport: { width: 4, height: 4 },
      camera: { viewProjection: identity },
      clearColor: [0, 0, 0, 0],
      scene: {
        materials: [{ id: 'material', baseColor: [0.5, 0.5, 0.5, 0.5], alphaMode: 'blend' }],
        primitives: [
          {
            id: 'triangle',
            topology: 'triangles',
            materialId: 'material',
            positions: Float32Array.from([-1, -1, 0, 1, -1, 0, -1, 1, 0]),
            colors: Float32Array.from([1, 0.5, 0.25, 0.5, 1, 0.5, 0.25, 0.5, 1, 0.5, 0.25, 0.5]),
          },
        ],
      },
    })

    assert.deepEqual([...result.rgba.subarray((2 * 4 + 1) * 4, (2 * 4 + 2) * 4)], [128, 64, 32, 64])
  })

  it('rejects malformed COLOR_0 before drawing an ordinary material', async () => {
    await assert.rejects(
      renderHeadless({
        outputKind: 'rgba8',
        viewport: { width: 4, height: 4 },
        camera: { viewProjection: identity },
        scene: {
          primitives: [
            {
              id: 'triangle',
              topology: 'triangles',
              positions: Float32Array.from([-1, -1, 0, 1, -1, 0, -1, 1, 0]),
              colors: Float32Array.of(1, 1, 1, 1),
            },
          ],
        },
      }),
      /RGBA/,
    )
  })
})


describe('ordinary perspective triangle clipping', () => {
  const perspective = Float32Array.from([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -11 / 9, -1, 0, 0, -20 / 9, 0,
  ])
  const draw = primitives => renderHeadless({
    outputKind: 'rgba8', viewport: { width: 32, height: 32 },
    camera: { viewProjection: perspective }, clearColor: [0, 0, 0, 0],
    scene: { primitives, materials: [
      { id: 'green', baseColor: [0, 1, 0, 1] },
      { id: 'red', baseColor: [1, 0, 0, 1] },
      { id: 'textured', baseColor: [1, 1, 1, 1], textureId: 'grid' },
    ], textures: [{ id: 'grid', width: 2, height: 2,
      rgba: Uint8Array.from([255, 255, 255, 255, 255, 128, 255, 255,
        128, 255, 255, 255, 255, 255, 128, 255]), filter: 'linear' }] },
  })
  it('does not let a triangle behind the camera cover visible geometry', async () => {
    const front = { id: 'front', topology: 'triangles', materialId: 'green',
      positions: Float32Array.from([-1, -1, -2, 1, -1, -2, 1, 1, -2, -1, 1, -2]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) }
    const behind = { id: 'behind', topology: 'triangles', materialId: 'red',
      positions: Float32Array.from([-2, -2, 2, 2, -2, 2, 0, 2, 2]) }
    const expected = await draw([front]), actual = await draw([front, behind])
    assert.deepEqual(actual.rgba, expected.rgba)
    const center = (16 * 32 + 16) * 4
    assert.deepEqual([...actual.rgba.subarray(center, center + 4)], [0, 255, 0, 255])
  })
  it('clips a crossing triangle while preserving its colors and texture coordinates', async () => {
    const crossing = { id: 'crossing', topology: 'triangles', materialId: 'textured',
      positions: Float32Array.from([-0.8, -0.8, -2, 0.8, -0.8, -2, 0, 0.4, -0.5]),
      colors: Float32Array.from([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 0.5, 1]) }
    // Intersections of the authored edges with z=-1 (the near plane).
    const clipped = { id: 'reference', topology: 'triangles', materialId: 'textured',
      positions: Float32Array.from([-0.8, -0.8, -2, 0.8, -0.8, -2,
        0.8 / 3, 0, -1, -0.8 / 3, 0, -1]),
      colors: Float32Array.from([1, 0, 0, 1, 0, 1, 0, 1,
        0, 1 / 3, 2 / 3, 1, 1 / 3, 0, 2 / 3, 1]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 2 / 3, 2 / 3, 1 / 3, 2 / 3]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]) }
    const actual = await draw([crossing]), expected = await draw([clipped])
    assert.ok(actual.rgba.some(value => value !== 0))
    assert.ok(actual.rgba.every((value, index) => Math.abs(value - expected.rgba[index]) <= 1))
    assert.equal(actual.statistics.triangles, 1)
  })
})
