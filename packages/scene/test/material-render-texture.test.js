import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'
import { renderTextureResourceId } from '../src/materials/standard-program.js'
import { createSceneMaterialProgramSampler } from '../src/render/materials.js'
import { renderWorldHeadlessFrame } from '../src/world/headless.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const parameters = source => ({ renderModel: { version: 1, standard: {
  layers: { diffuse: {
    slot: 'diffuse', texturePath: null, renderTextureChannel: 0,
    uvSource: 0, channels: 1, op: 2, teamColorMode: 0,
    invert: false, clampResult: false, wrapX: true, wrapY: false, ...source,
  } },
  blendMode: 0, priority: 0, specularity: 0, specMult: 1, emisMult: 1,
  specMode: 0, alphaTestThreshold: 0, twoSided: false, unshaded: true,
  doubleLambert: false, clampOutput: false, usesVertexColor: false, usesVertexAlpha: false,
} } })

it('binds RTT channel zero as a renderer target and shares the ordinary CPU/GPU texel kernel', () => {
  const source = parameters({ uvSource: 2 })
  const factory = createStandardMaterialPrograms(source, { budget })
  assert.deepEqual(factory.resources, [])
  assert.throws(() => factory.sample({ time: 0 }), /active render texture channel 0/)
  const [program] = factory.sample({ time: 0 }, { renderTextureChannels: [0], ambient: [0, 0, 0, 0] })
  assert.equal(program.textures.length, 1)
  assert.equal(program.textures[0].resourceId, renderTextureResourceId(0))
  assert.equal(program.textures[0].renderTextureChannel, 0)
  assert.equal(program.textures[0].wrapV, 'clamp')
  assert.equal(program.defines.layers[0].hasTexture, true)
  assert.equal(program.defines.layers[0].uvSource, 2)
  assert.deepEqual(program.shade({ texels: { diffuse: [0.25, 0.5, 0.75, 1] } }).rgba, [0.25, 0.5, 0.75, 1])
  assert.equal(source.renderModel.standard.layers.diffuse.texturePath, null)
})

it('keeps authored bitmap fallback and invalidates cached bindings when the ready channels change', () => {
  const source = parameters({ texturePath: 'Assets/Textures/fallback.dds' })
  const factory = createStandardMaterialPrograms(source, { budget })
  assert.deepEqual(factory.resources, ['Assets/Textures/fallback.dds'])
  const channels = [0]
  const first = factory.sample({ time: 0 }, { renderTextureChannels: channels })[0]
  assert.equal(first.textures[0].renderTextureChannel, 0)
  channels[0] = 1
  const second = factory.sample({ time: 0 }, { renderTextureChannels: channels })[0]
  assert.equal(second.textures[0].resourceId, 'Assets/Textures/fallback.dds')
  assert.equal(second.textures[0].renderTextureChannel, undefined)
  const third = factory.sample({ time: 1 }, { renderTextureChannels: [0] })[0]
  assert.equal(third.textures[0].renderTextureChannel, 0)
  assert.equal(source.renderModel.standard.layers.diffuse.texturePath, 'Assets/Textures/fallback.dds')
})

it('refuses invalid native and frame channels instead of allocating an unbounded target', () => {
  for (const channel of [-1, 7, 0.5, '0', NaN])
    assert.throws(() => createStandardMaterialPrograms(parameters({ renderTextureChannel: channel }), { budget }), /renderTextureChannel|non-JSON/)
  const factory = createStandardMaterialPrograms(parameters({}), { budget })
  for (const channels of [[7], [-1], Array(8).fill(0)])
    assert.throws(() => factory.sample({ time: 0 }, { renderTextureChannels: channels }), /channels must be 0-6/)
})

it('retains explicitly selected constant color until RTT/constant precedence is qualified', () => {
  const [program] = createStandardMaterialPrograms(parameters({ constantColor: { value: [0.1, 0.2, 0.3, 1] } }), { budget })
    .sample({ time: 0 }, { renderTextureChannels: [0], ambient: [0, 0, 0, 0] })
  assert.deepEqual(program.textures, [])
  assert.deepEqual(program.shade({}).rgba, [0.1, 0.2, 0.3, 1])
})

it('rebinds a static material when a completed target changes without retaining old pixels', () => {
  const sampler = createSceneMaterialProgramSampler([{ id: 'screen', baseColor: [1,1,1,1], shader: { id: 'modkit.render-material.v1', parameters: parameters({}) } }], new Map())
  const targets = new Map([['render-texture:0', { id: 'render-texture:0', width: 1, height: 1, rgba: Uint8Array.of(255,0,0,255) }]])
  const first = sampler.sample({ renderTextureTargets: targets }, []).get('screen')
  const green = { id: 'render-texture:0', width: 1, height: 1, rgba: Uint8Array.of(0,255,0,255) }
  targets.set('render-texture:0', green)
  const second = sampler.sample({ renderTextureTargets: targets }, []).get('screen')
  assert.notEqual(first, second)
  assert.equal(first.textures.get('render-texture:0').rgba[0], 255)
  assert.equal(second.textures.get('render-texture:0'), green)
  assert.equal(first.passes, second.passes)
})

it('renders a secondary world view and samples its pixels on an RTT-only material', async () => {
  const item = { facet:'objects', id:'screen', objectId:1, layerId:'objects', coordinateSpaceId:'test', kind:'doodad', resourceId:'screen', position:{x:0,y:0,z:0}, uvwPosition:{x:0,y:0,z:0}, uvwRotation:[0,0,0,1] }
  const resource = { state:'converted', sourceKey:'screen', complete:true, diagnostics:[], meshes:[], nodes:[], textures:[],
    primitives:[{id:'quad',materialId:'screen',topology:'triangles',positions:Float32Array.of(-1,-1,0,1,-1,0,-1,1,0,1,-1,0,1,1,0,-1,1,0),textureCoordinates:Float32Array.of(0,0,1,0,0,1,1,0,1,1,0,1)}],
    materials:[{id:'screen',shader:{id:'modkit.render-material.v1',parameters:parameters({})}}] }
  const camera={eye:[0,0,3],target:[0,0,0],up:[0,1,0],near:0.1,far:10,verticalFieldOfView:0.8}
  // Secondary camera looks away from the screen; its clear red reaches the main material.
  const input={items:[item],models:new Map([['screen',resource]]),renderTextures:[{id:'render-texture:0',width:32,height:32,clearColor:[1,0,0,1],camera:{...camera,target:[0,0,6]}}]}
  const {worldWebGlCameraFromSource}=await import('../src/world/webgl.js')
  const frame=await renderWorldHeadlessFrame(input,{width:32,height:32,camera:worldWebGlCameraFromSource(camera)})
  const offset=(16*32+16)*4
  assert.ok(frame.rgba[offset]>240 && frame.rgba[offset+1]<10 && frame.rgba[offset+2]<10)
  assert.equal(resource.materials[0].shader.parameters.renderModel.standard.layers.diffuse.texturePath,null)
  await assert.rejects(renderWorldHeadlessFrame({...input,renderTextures:[...input.renderTextures,...input.renderTextures]},{width:32,height:32}),/offscreen/)
})
