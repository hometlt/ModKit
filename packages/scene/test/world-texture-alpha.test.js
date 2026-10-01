import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { presentWorldModelTextures } from '../src/world/color-keys.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** A UVM whose one texture the game reads without its stored alpha, then keys magenta (Emperor). */
function opaqueKeyedUvm(entry) {
  const { bytes } = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 1,
        textures: 1,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [{ id: 'hull', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
          textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
          indices: Uint32Array.of(0, 1, 2),
          materialId: 'hull',
        },
      ],
      materials: [{ id: 'hull', layers: [{ slot: 'diffuse', resourceId: 'hull.tga' }] }],
      resourceClosure: {
        mode: 'logical',
        entries: [{ role: 'texture', logicalId: 'hull.tga', ...entry }],
      },
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:world-texture-alpha',
      options: { assetId: 'fixture/world-texture-alpha', sourceFormat: 'json' },
    },
  )
  return bytes
}

const model = (uvmBytes, rgba) => ({
  state: 'converted',
  sourceKey: 'hull',
  uvmBytes,
  complete: true,
  diagnostics: [],
  meshes: [],
  primitives: [],
  textures: [{ id: 'hull.tga', width: 2, height: 1, rgba }],
})

it('reads a texture without its stored alpha before keying it, as the game loads it', () => {
  // a magenta texel and a dark one, both stored fully transparent
  const stored = () => Uint8Array.of(255, 0, 255, 0, 10, 20, 30, 0)
  const keyed = presentWorldModelTextures(
    model(
      opaqueKeyedUvm({ ignoreStoredAlpha: true, colorKey: { color: [255, 0, 255] } }),
      stored(),
    ),
  )
  // the key still makes magenta transparent black; the other texel is opaque
  assert.deepEqual([...keyed.textures[0].rgba], [0, 0, 0, 0, 10, 20, 30, 255])
  // the policy alone, without a key: every texel opaque
  const opaque = presentWorldModelTextures(
    model(opaqueKeyedUvm({ ignoreStoredAlpha: true }), stored()),
  )
  assert.deepEqual([...opaque.textures[0].rgba], [255, 0, 255, 255, 10, 20, 30, 255])
  // without it the stored alpha stays
  const kept = model(opaqueKeyedUvm({}), stored())
  assert.equal(presentWorldModelTextures(kept), kept)
})
