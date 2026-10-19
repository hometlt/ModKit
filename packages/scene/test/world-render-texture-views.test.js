import assert from 'node:assert/strict'
import { it } from 'node:test'
import { prepareWorldRenderTextureFrame, worldWebGlCameraFromSource } from '../src/world/webgl.js'
import { renderWorldHeadlessFrame } from '../src/world/headless.js'

const camera = { eye: [0, 0, 3], target: [0, 0, 0], up: [0, 1, 0], near: 0.1, far: 10, verticalFieldOfView: 0.8 }
const request = (id = 'render-texture:0', fields = {}) => ({ id, camera, ...fields })
const views = requests => [...prepareWorldRenderTextureFrame({ items: [], renderTextures: requests }).views]

it('shares the sampled input and camera while excluding both unfinished and previous targets', () => {
  const input = { items: [], models: new Map(), timeSeconds: 1.489, animationTimes: new Map([[7, 0.4]]),
    renderTextures: [request()], renderTextureTargets: new Map([['old', {}]]) }
  const prepared = prepareWorldRenderTextureFrame(input)
  assert.equal(prepared.input.items, input.items)
  assert.equal(prepared.input.models, input.models)
  assert.equal(prepared.input.animationTimes, input.animationTimes)
  assert.equal(prepared.input.timeSeconds, 1.489)
  assert.equal(prepared.input.renderTextures, undefined)
  assert.equal(prepared.input.renderTextureTargets, undefined)
  assert.equal(input.renderTextureTargets.size, 1)
  const [view] = [...prepared.views]
  assert.deepEqual(view.camera, worldWebGlCameraFromSource(camera))
  assert.deepEqual([view.width, view.height, view.clearColor], [512, 512, [0, 0, 0, 0]])
})

it('rejects duplicate identities, invalid sizes/cameras and excessive total pixels before allocation', () => {
  for (const requests of [
    [request('')], [request(), request()], [request('a', { width: 15 })],
    [request('a', { height: 2049 })], [request('a', { width: 32.5 })],
    Array.from({ length: 9 }, (_, i) => request(String(i))),
    Array.from({ length: 5 }, (_, i) => request(String(i), { width: 1024, height: 1024 })),
    [{ id: 'a' }], [request('a', { modelCamera: { objectId: 1, cameraIndex: 0 } })],
  ]) assert.throws(() => views(requests), /offscreen/)
  assert.equal(views([request('a', { width: 2048, height: 2048 })]).length, 1)
})

it('checks cancellation before resolving a model camera and between views', () => {
  const cancelled = new AbortController()
  cancelled.abort(new Error('cancelled sample'))
  const unresolved = prepareWorldRenderTextureFrame({ items: [], renderTextures: [{ id: 'a', modelCamera: { objectId: 9, cameraIndex: 0 } }] }, cancelled.signal)
  assert.throws(() => unresolved.views.next(), /cancelled sample/)
  const controller = new AbortController()
  const prepared = prepareWorldRenderTextureFrame({ items: [], renderTextures: [request('a'), request('b')] }, controller.signal)
  assert.equal(prepared.views.next().value.id, 'a')
  controller.abort(new Error('seek superseded'))
  assert.throws(() => prepared.views.next(), /seek superseded/)
})

it('keeps secondary lighting and fog but grades the composed frame only once', async () => {
  const toneMapping = { operator: 'linear', exposure: 1, whitePoint: 1, contrast: 1, correctGamma: true,
    colorization: { inputLow: 0, inputHigh: 1, inputGamma: 1, outputLow: 0, outputHigh: 1,
      brightness: 0.7, contrast: 1, hue: 0, saturation: 0, lightness: 0, blend: 0 } }
  const lighting = { facet: 'lighting', id: 'light', layerId: 'light', coordinateSpaceId: 'uvw',
    ambientColor: [1,1,1], ambientIntensity: 1, directional: [], toneMapping }
  const object = (objectId, resourceId, x) => ({ facet: 'objects', id: String(objectId), objectId,
    resourceId, layerId: 'objects', coordinateSpaceId: 'uvw', kind: 'doodad',
    position: { x, y: 0, z: 0 }, uvwPosition: { x, y: 0, z: 0 }, uvwRotation: [0,0,0,1] })
  const model = (id, layer) => ({ state: 'converted', sourceKey: id, complete: true,
    diagnostics: [], meshes: [], nodes: [],
    textures: [{ id: 'flat', width: 1, height: 1, rgba: Uint8Array.of(64,128,192,255) }],
    primitives: [{ id, materialId: id, topology: 'triangles',
      positions: Float32Array.of(-1,-1,0, 1,-1,0, -1,1,0, 1,-1,0, 1,1,0, -1,1,0),
      textureCoordinates: Float32Array.of(0,0, 1,0, 0,1, 1,0, 1,1, 0,1) }],
    materials: [{ id, layers: [{ slot: 'diffuse', resourceId: 'flat', uvSource: 0 }], shader: { id: 'modkit.render-material.v1', parameters: {
      renderModel: { version: 1, standard: {
        layers: { diffuse: { slot: 'diffuse', uvSource: 0, channels: 1, op: 2, teamColorMode: 0,
          invert: false, clampResult: false, wrapX: false, wrapY: false, texturePath: 'flat', ...layer } },
        blendMode: 0, priority: 0, specularity: 0, specMult: 1, emisMult: 1, specMode: 0,
        alphaTestThreshold: 0, twoSided: true, unshaded: true, doubleLambert: false,
        clampOutput: false, usesVertexColor: false, usesVertexAlpha: false,
      } },
    } } }],
  })
  const source = model('source', {}), screen = model('screen', { renderTextureChannel: 0 })
  const models = new Map([['source', source], ['screen', screen]])
  const options = { width: 32, height: 32, camera: worldWebGlCameraFromSource(camera) }
  const direct = await renderWorldHeadlessFrame({ items: [lighting, object(1, 'source', 0)], models }, options)
  const input = { items: [lighting, object(1, 'screen', 0), object(2, 'source', 10)], models,
    renderTextures: [request('render-texture:0', { width: 32, height: 32,
      camera: { ...camera, eye: [10,0,3], target: [10,0,0] } })] }
  const prepared = prepareWorldRenderTextureFrame(input)
  assert.equal(prepared.input.items[0].toneMapping, toneMapping)
  assert.equal(prepared.secondaryInput.items[0].toneMapping.correctGamma, undefined)
  assert.equal(prepared.secondaryInput.items[0].toneMapping.colorization, undefined)
  assert.equal(prepared.secondaryInput.items[0].ambientColor, lighting.ambientColor)
  assert.equal(prepared.secondaryInput.items[1], input.items[1])
  const fog = { density: 0.1, falloff: 0, startingHeight: 0, color: [0.2,0.3,0.4] }
  assert.equal(prepareWorldRenderTextureFrame({ ...input, items: [{ ...lighting, fog }] }).secondaryInput.items[0].fog, fog)
  const composed = await renderWorldHeadlessFrame(input, options)
  const center = (16 * 32 + 16) * 4
  assert.deepEqual([...composed.rgba.slice(center, center+4)], [...direct.rgba.slice(center, center+4)])
  assert.ok(direct.rgba[center] > 64, 'the final gamma/colour processing must actually run')
  assert.equal(lighting.toneMapping, toneMapping)
})
