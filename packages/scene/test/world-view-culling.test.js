import assert from 'node:assert/strict'
import { it } from 'node:test'

import { DEFAULT_WORLD_WEBGL_CAMERA, createWorldWebGlRenderer } from '../src/world/webgl.js'

// One textured triangle with an opaque standard render-model material: its placements instance.
const rock = {
  state: 'converted',
  sourceKey: 'rock',
  diagnostics: [],
  complete: true,
  meshes: [],
  primitives: [
    {
      id: 'rock-triangle',
      topology: 'triangles',
      materialId: 'surface',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
    },
  ],
  materials: [
    {
      id: 'surface',
      blendMode: 'opaque',
      layers: [{ slot: 'diffuse', resourceId: 'rock.png', uvSource: 0 }],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: {
          renderModel: {
            version: 1,
            standard: {
              layers: {
                diffuse: {
                  slot: 'diffuse',
                  texturePath: 'rock.png',
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
              blendMode: 0,
              priority: 0,
              specularity: 10,
              specMult: 1,
              emisMult: 1,
              specMode: 0,
              alphaTestThreshold: 0,
              twoSided: false,
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
  textures: [{ id: 'rock.png', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }],
}
// Twenty rocks 10 apart along x.
const items = Array.from({ length: 20 }, (_, index) => ({
  facet: 'objects',
  id: `rock-${index}`,
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: index + 1,
  position: { x: index * 10, y: 0, z: 0 },
  uvwPosition: { x: index * 10, y: 0, z: 0 },
  resourceId: 'rock',
}))

// A WebGL2 stand-in recording the instance count of each instanced draw.
function recordingCanvas() {
  const constants = new Map()
  let instanced = []
  const target = {
    drawingBufferWidth: 64,
    drawingBufferHeight: 64,
    NO_ERROR: 0,
    FRAMEBUFFER_COMPLETE: 36053,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 4096,
    getError: () => 0,
    getExtension: () => null,
    isContextLost: () => false,
    checkFramebufferStatus: () => 36053,
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    drawElementsInstanced: (...args) => instanced.push(args[4]),
    drawArraysInstanced: (...args) => instanced.push(args[3]),
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
      return (...args) =>
        value !== undefined ? value(...args) : name.startsWith('create') ? {} : undefined
    },
  })
  return {
    canvas: { width: 64, height: 64, getContext: () => gl },
    instanced: () => {
      const counts = instanced
      instanced = []
      return counts
    },
  }
}

it('draws the placements the camera shows, all of them where it shows all', () => {
  const recording = recordingCanvas()
  const renderer = createWorldWebGlRenderer(recording.canvas)
  const input = { items, models: new Map([['rock', rock]]), shadows: false, timeSeconds: 0 }
  renderer.draw({ ...input, camera: { ...DEFAULT_WORLD_WEBGL_CAMERA, zoom: 0.5 } })
  assert.deepEqual(recording.instanced(), [20])
  // Close on the first rocks: the rest lie wholly outside the view.
  const close = { ...DEFAULT_WORLD_WEBGL_CAMERA, zoom: 16, target: [-90, 0, 0] }
  renderer.draw({ ...input, camera: close })
  const [shown] = recording.instanced()
  assert.ok(shown > 0 && shown < 20, `${shown} placements drawn`)
  // Looking where no rock is, the group draws nothing.
  renderer.draw({ ...input, camera: { ...close, target: [0, 0, 90] } })
  assert.deepEqual(recording.instanced(), [])
  renderer.dispose()
})
