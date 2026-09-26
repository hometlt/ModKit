import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

const texture = { id: 'surface.dds', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) }
const diffuse = animated => ({
  slot: 'diffuse',
  texturePath: texture.id,
  constantColor: { value: [1, 1, 1, 1] },
  uvSource: 0,
  channels: 0,
  op: 6,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
  ...(animated
    ? {
        colorMultiply: {
          value: 0,
          sequenceTracks: [
            {
              sequenceIndex: 0,
              track: {
                globalSeqId: null,
                lineType: 1,
                keys: [
                  { frame: 0, vector: [0] },
                  { frame: 1, vector: [1] },
                ],
              },
            },
          ],
        },
      }
    : {}),
})
const model = animated => ({
  state: 'converted',
  sourceKey: 'surface',
  complete: true,
  diagnostics: [],
  meshes: [],
  animations: [
    {
      id: 'stand',
      name: 'Stand',
      kind: 'sequence',
      provenance: 'direct',
      frames: 2,
      durationSeconds: 1,
      looping: true,
      sequenceIndex: 0,
      channels: [],
    },
  ],
  primitives: [
    {
      id: 'triangle',
      topology: 'triangles',
      materialId: 'surface',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      indices: Uint32Array.from([0, 1, 2]),
      textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
    },
  ],
  materials: [
    {
      id: 'surface',
      layers: [{ slot: 'diffuse', resourceId: texture.id, uvSource: 0 }],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: {
          renderModel: {
            version: 1,
            standard: {
              layers: { diffuse: diffuse(animated) },
              blendMode: 0,
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
  textures: [texture],
})
const item = {
  facet: 'objects',
  id: 'object-1',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
  resourceId: 'model',
  presentationAnimation: { name: 'Stand', groups: [], loop: true, speed: 1 },
}
const programsAt = (converted, timeSeconds) =>
  createWorldWebGlPlan({ items: [item], models: new Map([['model', converted]]), timeSeconds })
    .modelMaterialScenes[0].programs

it('keeps the programs of clock-independent materials across animated frames', () => {
  const still = model(false)
  const first = programsAt(still, 0)
  assert.equal(first.size, 1)
  // Same model result, later clock: the prepared programs are the same objects, so the renderer
  // keeps their GPU leases instead of preparing them again every frame.
  assert.equal(programsAt(still, 0.5), first)
  assert.equal(programsAt(still, 1.75), first)
})

it('prepares the programs of tracked materials at each clock', () => {
  const animated = model(true)
  const first = programsAt(animated, 0)
  const later = programsAt(animated, 0.5)
  assert.notEqual(later, first)
  const multiply = programs => [...programs.values()][0].passes[0].uniforms
  assert.notDeepEqual(multiply(later), multiply(first))
})
