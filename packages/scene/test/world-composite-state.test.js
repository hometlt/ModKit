import assert from 'node:assert/strict'
import { it } from 'node:test'

import { DEFAULT_WORLD_WEBGL_CAMERA, createWorldWebGlRenderer } from '../src/world/webgl.js'

const texture = (id, alpha) => ({
  id,
  width: 1,
  height: 1,
  rgba: Uint8Array.of(255, 255, 255, alpha),
})
const triangle = id => ({
  id,
  topology: 'triangles',
  materialId: 'surface',
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
})
// A blended decal the world draws as a textured batch (no render model).
const decal = key => ({
  state: 'converted',
  sourceKey: key,
  diagnostics: [],
  complete: true,
  meshes: [],
  primitives: [triangle(`${key}-triangle`)],
  materials: [
    {
      id: 'surface',
      blendMode: 'blend',
      // unlit: the fallback path draws it (a glTF program lights its material, gltf-program.ts)
      unlit: true,
      layers: [{ slot: 'diffuse', resourceId: `${key}.png`, uvSource: 0 }],
    },
  ],
  textures: [texture(`${key}.png`, 128)],
})
// A blended render-model material: drawn by the material renderer between the decals.
const glass = {
  state: 'converted',
  sourceKey: 'glass',
  diagnostics: [],
  complete: true,
  meshes: [],
  primitives: [triangle('glass-triangle')],
  materials: [
    {
      id: 'surface',
      layers: [{ slot: 'diffuse', resourceId: 'glass.png', uvSource: 0 }],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: {
          renderModel: {
            version: 1,
            standard: {
              layers: {
                diffuse: {
                  slot: 'diffuse',
                  texturePath: 'glass.png',
                  constantColor: { value: [1, 1, 1, 1] },
                  uvSource: 0,
                  channels: 0,
                  op: 6,
                  teamColorMode: 0,
                  invert: false,
                  clampResult: true,
                  wrapX: true,
                  wrapY: true,
                },
              },
              blendMode: 1,
              priority: 0,
              specularity: 10,
              specMult: 1,
              emisMult: 1,
              specMode: 0,
              alphaTestThreshold: 0,
              twoSided: true,
              unshaded: true,
              doubleLambert: false,
              clampOutput: false,
              usesVertexColor: false,
              usesVertexAlpha: false,
            },
          },
        },
      },
    },
  ],
  textures: [texture('glass.png', 128)],
}
const object = (objectId, resourceId, x) => ({
  facet: 'objects',
  id: `object-${objectId}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId,
  position: { x, y: 0, z: 0 },
  uvwPosition: { x, y: 0, z: 0 },
  resourceId,
})

// A WebGL2 stand-in that keeps the context state the composite pass sets (program, capabilities,
// depth writes, blend function) and records it, with the calls in between, at every draw.
function recordingCanvas() {
  const constants = new Map()
  const sources = new Map()
  const programs = new Map()
  const draws = []
  let current
  let calls = []
  const enabled = new Set()
  let depthMask = true
  let blend = []
  const target = {
    drawingBufferWidth: 64,
    drawingBufferHeight: 64,
    NO_ERROR: 0,
    FRAMEBUFFER_COMPLETE: 36053,
    shaderSource: (shader, source) => sources.set(shader, source),
    attachShader: (program, shader) =>
      programs.set(program, [...(programs.get(program) ?? []), sources.get(shader)]),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 4096,
    getError: () => 0,
    getExtension: () => null,
    isContextLost: () => false,
    checkFramebufferStatus: () => 36053,
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    useProgram: program => {
      current = program
    },
    enable: capability => enabled.add(capability),
    disable: capability => enabled.delete(capability),
    depthMask: flag => {
      depthMask = flag
    },
    blendFunc: (source, destination) => {
      blend = [source, destination]
    },
  }
  const gl = new Proxy(target, {
    get(object, name) {
      if (typeof name !== 'string') return undefined
      if (/^[A-Z0-9_]+$/u.test(name) && !(name in object)) {
        if (!constants.has(name)) constants.set(name, 0x9000 + constants.size)
        return constants.get(name)
      }
      const value = object[name]
      if (name in object && typeof value !== 'function') return value
      return (...args) => {
        if (/^draw(?:Arrays|Elements|RangeElements)(?:Instanced)?$/u.test(name)) {
          draws.push({
            world: (programs.get(current) ?? []).join('\n').includes('uniform float splatTextured'),
            blending: enabled.has(gl.BLEND),
            depthMask,
            blend: [...blend],
            calls,
          })
          calls = []
        } else calls.push(name)
        if (value !== undefined) return value(...args)
        return name.startsWith('create') ? {} : undefined
      }
    },
  })
  return { canvas: { width: 64, height: 64, getContext: () => gl }, gl, draws }
}

it('draws consecutive decal runs of the composite pass in the state the first one set', () => {
  const recording = recordingCanvas()
  const renderer = createWorldWebGlRenderer(recording.canvas)
  // Lined up along the view direction, so each covers the others on screen and keeps its sorted
  // place: decal a, the glass (a material run), then decals b and a, one run each.
  renderer.draw({
    items: [object(1, 'a', 0), object(2, 'glass', 10), object(3, 'b', 20), object(4, 'a', 30)],
    models: new Map([
      ['a', decal('a')],
      ['b', decal('b')],
      ['glass', glass],
    ]),
    camera: { ...DEFAULT_WORLD_WEBGL_CAMERA, azimuth: 0, elevation: 0.04 },
  })
  const { gl, draws } = recording
  const decals = draws.filter(draw => draw.world && draw.blending)
  assert.equal(decals.length, 3)
  // Every run blends as a decal, with the world program, after the glass as before it.
  for (const draw of decals) {
    assert.equal(draw.depthMask, false)
    assert.deepEqual(draw.blend, [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA])
  }
  const glassDraw = draws.findIndex(draw => !draw.world && draw.blending)
  assert.ok(glassDraw > draws.indexOf(decals[0]) && glassDraw < draws.indexOf(decals[1]))
  // The run after the glass sets the world's state again; the next one finds it set.
  for (const name of ['useProgram', 'blendFunc', 'depthMask'])
    assert.ok(decals[1].calls.includes(name), `${name} after the material run`)
  for (const name of ['useProgram', 'blendFunc', 'depthMask', 'enable', 'disable'])
    assert.ok(!decals[2].calls.includes(name), `${name} between consecutive runs`)
  renderer.dispose()
})
