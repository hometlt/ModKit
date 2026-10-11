import { describe, expect, it } from 'vitest'
import type { WorldSceneModelResult, WorldSceneObjectItem } from '@modkit/sdk/maps'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

// An asymmetric Z-up source point (2,5,3), already converted by UVM to (2,3,-5).
const positions = Float32Array.from([2, 3, -5, 3, 3, -5, 2, 4, -5])
const object = (rotation: number): WorldSceneObjectItem => ({
  facet: 'objects',
  id: 'object',
  layerId: 'objects',
  coordinateSpaceId: 'map-native',
  kind: 'doodad',
  objectId: 1,
  position: { x: 10, y: 20, z: 30 },
  rotation,
  nativeRotationUnit: 'radians',
  presentationModelReflection: 'z',
  resourceId: 'model',
})
const model = (program: boolean): WorldSceneModelResult => ({
  state: 'converted',
  sourceKey: 'model',
  diagnostics: [],
  complete: true,
  meshes: [],
  primitives: [
    {
      id: 'triangle',
      topology: 'triangles',
      positions,
      ...(program ? { materialId: 'surface' } : {}),
    },
  ],
  ...(program
    ? {
        materials: [
          {
            id: 'surface',
            shader: {
              id: 'modkit.render-material.v1',
              parameters: {
                renderModel: {
                  version: 1,
                  standard: {
                    layers: {},
                    blendMode: 0,
                    priority: 0,
                    specularity: 0,
                    specMult: 1,
                    emisMult: 1,
                    specMode: 0,
                    alphaTestThreshold: 0.5,
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
      }
    : {}),
})

describe('native model preview frame', () => {
  it.each([0, Math.PI / 2, -Math.PI / 4])(
    'agrees with native Z-up yaw %s in batches and GPU instances',
    yaw => {
      const item = object(yaw)
      const input = { items: [item], models: new Map([['model', model(false)]]) }
      const cpu = createWorldWebGlPlan(input)
      const gpu = createWorldWebGlPlan({ ...input, models: new Map([['model', model(true)]]) })
      const expected = [
        10 + 2 * Math.cos(yaw) - 5 * Math.sin(yaw),
        33,
        20 + 2 * Math.sin(yaw) + 5 * Math.cos(yaw),
      ]
      const matrix = gpu.modelMaterialScenes[0]!.primitives[0]!.transform!
      const transformed = [0, 1, 2].map(
        row => matrix[row]! * 2 + matrix[row + 4]! * 3 - matrix[row + 8]! * 5 + matrix[row + 12]!,
      )
      expected.forEach((value, axis) => {
        expect(cpu.opaqueTriangles.positions[axis]).toBeCloseTo(value, 5)
        expect(transformed[axis]).toBeCloseTo(value, 5)
      })
      expect(item.position).toEqual({ x: 10, y: 20, z: 30 })
      expect(item.rotation).toBe(yaw)
    },
  )

  it('does not reflect canonical placements, or other publishers without the field', () => {
    const native = object(0)
    for (const item of [
      { ...native, uvwPosition: { x: 10, y: 30, z: 20 } },
      { ...native, presentationModelReflection: undefined },
    ]) {
      const plan = createWorldWebGlPlan({
        items: [item],
        models: new Map([['model', model(false)]]),
      })
      expect(Array.from(plan.opaqueTriangles.positions.slice(0, 3))).toEqual([12, 33, 15])
    }
  })

  it('keeps native edit translation and rebuilds the reflected retained placement', () => {
    const item = object(0)
    const models = new Map([['model', model(false)]])
    const first = createWorldWebGlPlan({ items: [item], models })
    const second = createWorldWebGlPlan(
      { items: [item], models, selectedObjectId: 1, previewPosition: { x: 100, y: 200, z: 300 } },
      first,
    )
    expect(Array.from(second.opaqueTriangles.positions.slice(0, 3))).toEqual([102, 303, 205])
  })
})
