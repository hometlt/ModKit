import assert from 'node:assert/strict'
import { it } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
// a quad facing +z, the light and the eye behind it on +z
const quad = {
  id: 'quad',
  materialId: 'm',
  topology: 'triangles',
  positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
  normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
}
const centre = async (
  material,
  light = { direction: [0, 0, 1], color: [1, 1, 1, 1], ambient: 0 },
) => {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity, eyePosition: [0, 0, 5] },
    scene: {
      materials: [{ id: 'm', baseColor: [1, 1, 1, 1], shading: 'pbr', ...material }],
      primitives: [quad],
      ...(light === undefined ? {} : { light }),
    },
  })
  return [...frame.rgba.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)]
}

it('shades a pbr material with the one glTF BRDF under the scene light (П11)', async () => {
  // a rough white dielectric facing the light reflects almost all of it
  const [r] = await centre({ pbr: { metallic: 0, roughness: 1 } })
  assert.ok(r >= 245 && r <= 252, `rough white: ${r}`)
  // a rough gold metal reflects its own colour, blue not at all (smooth, the highlight saturates)
  const gold = await centre({ baseColor: [1, 0.5, 0, 1], pbr: { metallic: 1, roughness: 1 } })
  assert.ok(gold[0] > gold[1] && gold[1] > gold[2], `gold: ${gold}`)
  assert.equal(gold[2], 0)
  // emission adds where the light does not reach
  const dark = await centre(
    { baseColor: [0, 0, 0, 1], pbr: { metallic: 0, roughness: 1, emissive: [1, 0, 0] } },
    { direction: [0, 0, -1], color: [1, 1, 1, 1], ambient: 0 },
  )
  assert.deepEqual(dark, [255, 0, 0, 255])
  // without a light the material is drawn as it is, as lambert is
  assert.deepEqual(
    await centre({ pbr: { metallic: 1, roughness: 0 } }, undefined),
    [255, 255, 255, 255],
  )
})

it('reads team masks and pbr maps on a primitive without a base colour texture', async () => {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 8, height: 8 },
    camera: { viewProjection: identity },
    scene: {
      materials: [
        {
          id: 'm',
          baseColor: [1, 1, 1, 1],
          teamColor: { mask: { texture: 'mask', channel: 'a' }, blend: 'lerp' },
        },
      ],
      primitives: [{ ...quad, textureCoordinates: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1) }],
      textures: [{ id: 'mask', width: 1, height: 1, rgba: Uint8Array.of(0, 0, 0, 255) }],
      materialContext: { teamColor: [0, 0, 1] },
    },
  })
  assert.deepEqual([...frame.rgba.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4)], [0, 0, 255, 255])
})
