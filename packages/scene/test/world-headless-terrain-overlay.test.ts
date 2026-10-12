import { describe, expect, it } from 'vitest'
import type { SceneRendererTexture } from '@modkit/sdk/renderer'
import { sceneTexturePixels } from '../src/render/compressed-textures.js'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { renderWorldHeadless, worldHeadlessScene } from '../src/world/headless.js'

describe('headless terrain overlay coverage', () => {
  it('uses explicit corner UVs inside an atlas tile', () => {
    const items = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([x, y], index) => ({
      facet: 'terrain' as const,
      id: `vertex-${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact' as const,
      x: x!,
      y: y!,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x: x!, y: 0, z: y! },
    }))
    const texture = { id: 'atlas', width: 4, height: 4, rgba: new Uint8Array(64).fill(255) }
    const plan = createWorldWebGlPlan({
      items: [
        ...items,
        {
          facet: 'terrain-materials',
          id: 'material-cell',
          layerId: 'materials',
          coordinateSpaceId: 'height-grid',
          lod: 'exact' as const,
          x: 0,
          y: 0,
          textureIndex: 0,
          cornerUv: [
            [0.2, 0.2],
            [0.6, 0.2],
            [0.6, 0.8],
            [0.2, 0.8],
          ],
          layers: [{ materialId: 'atlas', tile: { column: 0, row: 0 } }],
        },
      ],
      terrainMaterials: [{ materialId: 'atlas', baseColorResourceId: 'atlas', atlas: { rows: 1 } }],
      terrainTextures: new Map([['atlas', texture]]),
    })
    const coordinates = Array.from(plan.texturedTriangles[0]!.textureCoordinates)
    const u = coordinates.filter((_, index) => index % 2 === 0)
    const v = coordinates.filter((_, index) => index % 2 === 1)
    expect(Math.min(...u)).toBeCloseTo(0.2)
    expect(Math.max(...u)).toBeCloseTo(0.6)
    expect(Math.min(...v)).toBeCloseTo(0.2)
    expect(Math.max(...v)).toBeCloseTo(0.8)
  })

  it.each([
    { policy: 'texture', storage: 'rgba' },
    { policy: 'coverage', storage: 'rgba' },
    { policy: 'texture', storage: 'bc3' },
    { policy: 'coverage', storage: 'bc3' },
  ] as const)(
    'uses corner coverage and the $policy alpha policy with $storage storage',
    async ({ policy, storage }) => {
      const items = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([x, y], index) => ({
        facet: 'terrain' as const,
        id: `vertex-${index}`,
        layerId: 'terrain',
        coordinateSpaceId: 'height-grid',
        lod: 'exact' as const,
        x: x!,
        y: y!,
        heightBase: 0,
        heightAdjustment: 0,
        mask: 0,
        uvwPosition: { x: x!, y: 0, z: y! },
      }))
      const texture = { id: 'ground', width: 1, height: 1, rgba: Uint8Array.of(255, 0, 0, 255) }
      // Transparent blue DXT5 block: real game textures carry blocks and an empty rgba buffer.
      const blocks = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 31, 0, 31, 0, 0, 0, 0, 0)
      const upper: SceneRendererTexture =
        storage === 'rgba'
          ? { ...texture, id: 'upper', rgba: Uint8Array.of(0, 0, 255, 0) }
          : {
              id: 'upper',
              width: 4,
              height: 4,
              rgba: new Uint8Array(0),
              compressed: {
                schemaVersion: 1,
                format: 'bc3-rgba-unorm',
                dimensions: { width: 4, height: 4, depth: 1 },
                mipLevelCount: 1,
                layerCount: 1,
                faceCount: 1,
                colorSpace: 'unknown',
                alphaMode: 'unknown',
                block: { width: 4, height: 4, depth: 1, bytes: 16 },
                subresources: [
                  {
                    mipLevel: 0,
                    layer: 0,
                    face: 0,
                    depthSlice: 0,
                    width: 4,
                    height: 4,
                    depth: 1,
                    data: blocks,
                  },
                ],
                source: { codecId: 'dds', containerFormat: 'dds', preservation: 'source-bytes' },
              },
            }
      const originalPixels = sceneTexturePixels(upper).slice()
      const originalBlocks = blocks.slice()
      const plan = createWorldWebGlPlan({
        items: [
          ...items,
          {
            facet: 'terrain-materials',
            id: 'material-cell',
            layerId: 'materials',
            coordinateSpaceId: 'height-grid',
            lod: 'exact' as const,
            x: 0,
            y: 0,
            textureIndex: 0,
            layers: [
              { materialId: 'ground', tile: { column: 0, row: 0 } },
              { materialId: 'upper', tile: { column: 0, row: 0 }, cornerAlpha: [0, 1, 1, 0] },
            ],
          },
        ],
        terrainMaterials: [
          { materialId: 'ground', baseColorResourceId: 'ground', atlas: { rows: 1 } },
          {
            materialId: 'upper',
            baseColorResourceId: 'upper',
            atlas: { rows: 1 },
            ...(policy === 'coverage' ? { overlayAlpha: policy } : {}),
          },
        ],
        terrainTextures: new Map([
          ['ground', texture],
          ['upper', upper],
        ]),
      })
      const before = Array.from(plan.terrainDecalTriangles[0]!.colors)
      const headless = worldHeadlessScene(plan).scene
      const converted = headless.primitives.find(item => item.id === 'world/decal-0')!.colors!
      expect(plan.terrainDecalTriangles[0]!.overlayAlpha).toBe(
        policy === 'coverage' ? policy : undefined,
      )
      const renderedTexture = headless.textures!.at(-1)!
      const renderedPixels = sceneTexturePixels(renderedTexture)
      expect(sceneTexturePixels(upper)).toEqual(originalPixels)
      expect(blocks).toEqual(originalBlocks)
      if (storage === 'bc3') expect(upper.rgba).toHaveLength(0)
      expect(renderedPixels[3]).toBe(policy === 'coverage' ? 255 : 0)
      if (policy === 'coverage') expect(renderedTexture.compressed).toBeUndefined()
      else expect(renderedTexture.compressed).toBe(upper.compressed)
      for (let index = 0; index < renderedPixels.length; index += 4) {
        expect(Array.from(renderedPixels.slice(index, index + 3))).toEqual(
          Array.from(originalPixels.slice(index, index + 3)),
        )
      }
      expect(Array.from(plan.terrainDecalTriangles[0]!.colors)).toEqual(before)
      for (let index = 0; index < before.length; index += 4) {
        expect(Array.from(converted.slice(index, index + 4))).toEqual([
          before[index + 3],
          before[index + 3],
          before[index + 3],
          before[index],
        ])
      }
      expect(new Set(Array.from(converted).filter((_, index) => index % 4 === 3))).toEqual(
        new Set([0, 1]),
      )
      const frame = await renderWorldHeadless(plan, {
        width: 64,
        height: 64,
        camera: {
          azimuth: Math.PI / 2,
          elevation: 1.5,
          zoom: 1,
          target: [0, 0, 0],
          frame: { center: [0.5, 0, 0.5], radius: 0.6 },
        },
      })
      const mixed = Array.from(frame.rgba).filter(
        (value, index) => index % 4 === 0 && value > 20 && frame.rgba[index + 2]! > 20,
      )
      if (policy === 'coverage') expect(mixed.length).toBeGreaterThan(100)
      else expect(mixed.length).toBe(0)
    },
  )
})
