import assert from 'node:assert/strict'
import { it } from 'node:test'
import { decodePngSamples } from '@modkit/codec-kit/raster'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { worldGlb } from '../src/world/gltf.js'

it('keeps the full rock mask period when the diffuse texture repeats inside it', async () => {
  const tex = { id: 'rock', width: 8, height: 1, rgba: Uint8Array.from(
    Array.from({ length: 8 }, (_, i) => [i % 2 ? 255 : 0, i % 2 ? 0 : 255, 0, i < 4 ? 0 : 255]).flat(),
  ) }
  const layer = (slot, channels, extra = {}) => ({ slot, texturePath: tex.id, uvSource: 0,
    channels, op: 2, teamColorMode: 0, invert: false, clampResult: true, wrapX: true, wrapY: true, ...extra })
  const coords = Float32Array.of(0, 0, 1, 0, 0, 1)
  const piece = { state: 'converted', sourceKey: 'rock', complete: true, diagnostics: [], meshes: [], nodes: [],
    primitives: [{ id: 'rock-face', topology: 'triangles', materialId: 'rock',
      positions: Float32Array.of(0, 0, 0, 2, 0, 0, 0, 1, 0), textureCoordinates: coords }],
    textures: [tex], materials: [{ id: 'rock', layers: [{ slot: 'diffuse', resourceId: tex.id, uvSource: 0 }],
      shader: { id: 'modkit.render-material.v1', parameters: { renderModel: { version: 1, standard: {
        layers: { diffuse: layer('diffuse', 0, { uvTiling: { value: [2, 1] } }), alpha1: layer('alpha1', 2) },
        blendMode: 1, priority: 0, specularity: 10, specMult: 1, emisMult: 1, specMode: 0,
        alphaTestThreshold: 0, twoSided: false, unshaded: true, doubleLambert: false,
        clampOutput: false, usesVertexColor: false, usesVertexAlpha: false,
      } } } },
    }],
  }
  const makePlan = model => createWorldWebGlPlan({ items: [{ facet: 'objects', id: 'cliff', layerId: 'objects',
    coordinateSpaceId: 'uvw', kind: 'doodad', objectId: 1, derivedFrom: 'cliffs', resourceIds: ['rock'],
    position: { x: 0, y: 0, z: 0 }, uvwPosition: { x: 0, y: 0, z: 0 }, uvwRotation: [0, 0, 0, 1] }],
    models: new Map([['rock', model]]) })
  const plan = makePlan(piece)
  const result = await worldGlb(plan, { terrainTextureSize: 16, maxBytes: 1024 * 1024 })
  const length = new DataView(result.bytes.buffer).getUint32(12, true)
  const document = JSON.parse(new TextDecoder().decode(result.bytes.subarray(20, 20 + length)))
  const bin = result.bytes.subarray(28 + length)
  const accessor = document.accessors[document.meshes[0].primitives[0].attributes.TEXCOORD_0]
  const view = document.bufferViews[accessor.bufferView]
  assert.deepEqual(new Float32Array(bin.buffer, bin.byteOffset + view.byteOffset, 6), coords)
  const imageView = document.bufferViews[document.images[0].bufferView]
  const decoded = await decodePngSamples(bin.subarray(imageView.byteOffset, imageView.byteOffset + imageView.byteLength))
  assert.equal(decoded.width, 16, 'two repetitions retain the diffuse texture resolution')
  assert.deepEqual(Array.from(decoded.samples).filter((_, i) => i % 4 === 3).map(v => v >= 128),
    Array.from({ length: 16 }, (_, i) => i >= 8))
  // A constant mask cannot be the UV domain of a varying diffuse texture.
  const constant = structuredClone(piece)
  constant.materials[0].shader.parameters.renderModel.standard.layers.alpha1.uvTiling = { value: [0, 0] }
  const constantResult = await worldGlb(makePlan(constant), { terrainTextureSize: 16, maxBytes: 1024 * 1024 })
  const constantLength = new DataView(constantResult.bytes.buffer).getUint32(12, true)
  const constantDocument = JSON.parse(new TextDecoder().decode(constantResult.bytes.subarray(20, 20 + constantLength)))
  const constantAccessor = constantDocument.accessors[constantDocument.meshes[0].primitives[0].attributes.TEXCOORD_0]
  const constantView = constantDocument.bufferViews[constantAccessor.bufferView]
  const constantBin = constantResult.bytes.subarray(28 + constantLength)
  assert.deepEqual(new Float32Array(constantBin.buffer, constantBin.byteOffset + constantView.byteOffset, 6),
    Float32Array.of(-.5, 0, 1.5, 0, -.5, 1))
  const masked = structuredClone(piece)
  masked.materials[0].shader.parameters.renderModel.standard.blendMode = 0
  masked.materials[0].shader.parameters.renderModel.standard.alphaTestThreshold = .5
  masked.primitives[0].positions = Float32Array.of(
    0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0)
  masked.primitives[0].textureCoordinates = Float32Array.of(
    .125, 0, .125, 0, .125, 0, .75, 0, .75, 0, .75, 0, .125, 0, 1.125, 0, .125, 1)
  const culled = await worldGlb(makePlan(masked), { terrainTextureSize: 16, maxBytes: 1024 * 1024 })
  assert.equal(culled.stats.triangles, 2,
    'a fully transparent face is omitted; opaque faces and repeated UVs crossing an opaque interior remain')
  const legacyBatch = { positions: masked.primitives[0].positions,
    normals: Float32Array.from({ length: 27 }, (_, i) => i % 3 === 2 ? 1 : 0),
    colors: new Float32Array(36).fill(1), textureCoordinates: masked.primitives[0].textureCoordinates,
    texture: tex, alphaCutoff: .5 }
  const legacy = await worldGlb({ ...createWorldWebGlPlan({ items: [] }), texturedTriangles: [legacyBatch] },
    { terrainTextureSize: 16, maxBytes: 1024 * 1024 })
  assert.equal(legacy.stats.triangles, 2, 'the same alpha-discard rule applies to plain textured cliff pieces')
  const opaque = await worldGlb({ ...createWorldWebGlPlan({ items: [] }),
    texturedTriangles: [{ ...legacyBatch, alphaCutoff: undefined }] },
  { terrainTextureSize: 16, maxBytes: 1024 * 1024 })
  assert.equal(opaque.stats.triangles, 3, 'an opaque material keeps faces even when source texels have zero alpha')
})

it('keeps visible cliff walls under the rock and pins their shared plateau vertices', async () => {
  const positions = Float32Array.of(0, 0, 0, 2, 0, 0, 0, 0, 2,
    0, 0, 0, 2, 0, 0, 0, 1, 0,
    4, 0, 0, 5, 0, 0, 4, 1, 0)
  const batch = {
    positions, normals: Float32Array.of(.2, .98, 0, .2, .98, 0, .2, .98, 0,
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
    colors: new Float32Array(36).fill(1),
    textures: [{ id: 'ground', width: 1, height: 1, rgba: Uint8Array.of(120, 90, 60, 255) }],
    normalTextures: [], normalSwizzles: [],
    textureCoordinates: [new Float32Array(18)],
    textureWeights0: Float32Array.from({ length: 36 }, (_, i) => i % 4 === 0 ? 1 : 0),
    textureWeights1: new Float32Array(36),
    maskTexture: { id: 'rock', width: 2, height: 1,
      rgba: Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 255) },
    maskTextureCoordinates: Float32Array.of(.1, .5, .9, .5, .1, .5, .1, .5, .9, .5, .1, .5,
      .75, .5, .75, .5, .75, .5),
    maskChannel: 3,
  }
  const plain = { ...batch, positions: Float32Array.of(2, 0, 0, 4, 0, 0, 2, 0, 2),
    normals: Float32Array.of(.2, .98, 0, .2, .98, 0, .2, .98, 0), colors: new Float32Array(12).fill(1),
    textureCoordinates: [new Float32Array(6)],
    textureWeights0: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0), textureWeights1: new Float32Array(12),
    maskTexture: undefined, maskTextureCoordinates: undefined }
  const plan = { ...createWorldWebGlPlan({ items: [] }), splatTriangles: [batch, plain],
    bounds: { minimum: [0, 0, 0], maximum: [6, 1, 2] } }
  const result = await worldGlb(plan, { terrainTextureSize: 64, maxBytes: 8 * 1024 * 1024 })
  const jsonLength = new DataView(result.bytes.buffer).getUint32(12, true)
  const document = JSON.parse(new TextDecoder().decode(result.bytes.subarray(20, 20 + jsonLength)))
  const bin = result.bytes.subarray(28 + jsonLength)
  const mesh = document.meshes.find(mesh => mesh.name === 'world/terrain-baked')
  assert.ok(mesh, 'cliff ground and plateau share one opaque terrain bake')
  const primitive = mesh.primitives[0]
  assert.equal(document.accessors[primitive.indices].count, 9,
    'visible floor, vertical wall and plateau remain; the completely covered wall is omitted')
  const accessor = document.accessors[primitive.attributes.POSITION]
  const view = document.bufferViews[accessor.bufferView]
  const written = new Float32Array(bin.buffer, bin.byteOffset + view.byteOffset, accessor.count * 3)
  for (const from of [3, 12]) assert.deepEqual(Array.from(written.subarray(from, from + 3)), [2, 0, 0],
    'vertices shared with the plateau stay exactly fixed')
  assert.ok(Math.abs(written[1] + .001) < 1e-7, 'floor interior sits just under rock')
  assert.equal(written[0], 0, 'the flat floor is not pushed sideways by a bevel normal')
  assert.ok(Math.abs(written[11] + .001) < 1e-7, 'vertical wall moves inward rather than being dropped')
  const na = document.accessors[primitive.attributes.NORMAL], nv = document.bufferViews[na.bufferView]
  const normals = new Float32Array(bin.buffer, bin.byteOffset + nv.byteOffset, na.count * 3)
  assert.deepEqual(Array.from(normals.subarray(0, 3)), [0, 1, 0], 'flat projected terrain matches the plateau normal')
  assert.deepEqual(Array.from(normals.subarray(9, 12)), [0, 0, 1], 'the vertical wall keeps its normal')
  assert.deepEqual(Array.from(normals.subarray(18, 21)), [0, 1, 0], 'the ordinary plateau uses the same flat normal')
  const material = document.materials[primitive.material]
  assert.equal(material.alphaMode, undefined, 'terrain under the rock is opaque, with no atlas alpha filtering holes')
  const image = document.images[document.textures[material.pbrMetallicRoughness.baseColorTexture.index].source]
  const imageView = document.bufferViews[image.bufferView]
  const decoded = await decodePngSamples(bin.subarray(imageView.byteOffset, imageView.byteOffset + imageView.byteLength))
  const pixels = decoded.samples
  assert.ok(pixels.every((v, i) => i % 4 !== 3 || v === 255), 'the common ground texture is fully opaque')
  const clearResult = await worldGlb({ ...plan, bounds: { minimum: [0, 0, 0], maximum: [6, 1, 2] },
    splatTriangles: [{ ...batch,
      maskTexture: { id: 'clear', width: 1024, height: 1, rgba: new Uint8Array(4096) },
      maskTextureCoordinates: Float32Array.of(0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 10),
    }],
  }, { terrainTextureSize: 64, maxBytes: 8 * 1024 * 1024 })
  assert.equal(clearResult.stats.triangles, 3, 'uniform clear coverage needs no oversized mask chart, even with repeated UVs')
  const broadMask = new Uint8Array(128 * 128 * 4).fill(255)
  const bounded = await worldGlb({ ...plan, splatTriangles: [{ ...batch,
    maskTexture: { id: 'broad', width: 128, height: 128, rgba: broadMask },
    maskTextureCoordinates: Float32Array.of(0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 10, 0, 0, 10),
  }] }, { terrainTextureSize: 16, maxBytes: 8 * 1024 * 1024 })
  assert.equal(bounded.stats.triangles, 3, 'broad rectangles are kept conservatively rather than scanning the full mask per face')
  const ramp = await worldGlb({ ...plan, splatTriangles: [{ ...plain,
    positions: Float32Array.of(0, 0, 0, 1, .5, 0, 0, 0, 1),
  }] }, { terrainTextureSize: 16, maxBytes: 8 * 1024 * 1024 })
  const rampLength = new DataView(ramp.bytes.buffer).getUint32(12, true)
  const rampDoc = JSON.parse(new TextDecoder().decode(ramp.bytes.subarray(20, 20 + rampLength)))
  const rampAccessor = rampDoc.accessors[rampDoc.meshes[0].primitives[0].attributes.NORMAL]
  const rampView = rampDoc.bufferViews[rampAccessor.bufferView]
  const rampNormals = new Float32Array(ramp.bytes.buffer, ramp.bytes.byteOffset + 28 + rampLength + rampView.byteOffset, rampAccessor.count * 3)
  assert.ok(rampNormals[0] > .19, 'a sloped surface keeps its authored normal')
  const joined = await worldGlb({ ...plan, splatTriangles: [{ ...batch,
    positions: Float32Array.of(0, 0, 0, 1, .25, 0, 0, 0, 1),
    normals: Float32Array.of(-.24, .97, 0, -.24, .97, 0, -.24, .97, 0),
    colors: new Float32Array(12).fill(1), maskTextureCoordinates: new Float32Array(6),
  }, { ...plain, positions: Float32Array.of(1, .23, 0, 2, .5, 1, 0, -.02, 1) }] },
  { terrainTextureSize: 16, maxBytes: 8 * 1024 * 1024 })
  const joinedLength = new DataView(joined.bytes.buffer).getUint32(12, true)
  const joinedDoc = JSON.parse(new TextDecoder().decode(joined.bytes.subarray(20, 20 + joinedLength)))
  const joinedAccessor = joinedDoc.accessors[joinedDoc.meshes[0].primitives[0].attributes.POSITION]
  const joinedView = joinedDoc.bufferViews[joinedAccessor.bufferView]
  const jp = new Float32Array(joined.bytes.buffer, joined.bytes.byteOffset + 28 + joinedLength + joinedView.byteOffset,
    joinedAccessor.count * 3)
  assert.deepEqual(Array.from(jp.subarray(3, 9)), [1, .25, 0, 0, 0, 1], 'the ramp rim is pinned to the joined ground')
  assert.deepEqual(Array.from(jp.subarray(9, 18)), [1, .25, 0, 2, .5, 1, 0, 0, 1],
    'rendering offsets close without flattening the ramp or changing unrelated vertices')
  const skinned = await worldGlb({ ...plan, terrainTexturedBatches: 1, texturedTriangles: [{
    positions: batch.positions, normals: batch.normals, colors: batch.colors,
    textureCoordinates: batch.textureCoordinates[0], texture: batch.textures[0], alphaCutoff: .5,
  }] }, { terrainTextureSize: 16, maxBytes: 8 * 1024 * 1024 })
  const skinLength = new DataView(skinned.bytes.buffer).getUint32(12, true)
  const skinDoc = JSON.parse(new TextDecoder().decode(skinned.bytes.subarray(20, 20 + skinLength)))
  const skinMesh = skinDoc.meshes.find(mesh => mesh.name === 'world/terrain-baked')
  const skinAccessor = skinDoc.accessors[skinMesh.primitives[0].attributes.POSITION]
  const skinView = skinDoc.bufferViews[skinAccessor.bufferView]
  const sp = new Float32Array(skinned.bytes.buffer, skinned.bytes.byteOffset + 28 + skinLength + skinView.byteOffset,
    skinAccessor.count * 3)
  assert.ok(Math.abs(sp[1] + .001) < 1e-7, 'a textured cliff skin does not pin its ground copy into the same plane')
  assert.deepEqual(Array.from(sp.subarray(3, 6)), [2, 0, 0], 'the real shared plateau rim remains pinned')
})
