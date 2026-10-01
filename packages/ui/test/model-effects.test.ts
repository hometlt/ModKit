import type { RasterResourceRequest, SceneRenderRequest } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { effectFraming, rememberingRasterPort, withModelEffectLayer } from '../src/model/effects.js'

const triangle = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0])
const stage: SceneRenderRequest = {
  scene: {
    primitives: [{ id: 'hull', topology: 'triangles', positions: triangle, materialId: 'm' }],
    materials: [{ id: 'm', baseColor: [1, 1, 1, 1] }],
  },
  camera: { viewProjection: new Float32Array(16) },
  viewport: { width: 4, height: 4 },
  outputKind: 'rgba8',
}

describe('the effects of a model as a layer of its frame', () => {
  it('adds only the effect primitives, back in source units, with their materials and textures renamed', () => {
    const merged = withModelEffectLayer(stage, {
      metersPerSourceUnit: 0.5,
      effectPrimitiveIds: ['uvm-effect-particle-0'],
      request: {
        ...stage,
        scene: {
          primitives: [
            { id: 'mesh-0-primitive-0', topology: 'triangles', positions: triangle },
            {
              id: 'uvm-effect-particle-0',
              topology: 'triangles',
              positions: triangle,
              materialId: 'm',
              transform: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1]),
            },
          ],
          materials: [
            {
              id: 'm',
              baseColor: [1, 0.5, 0, 1],
              baseColorTexture: 'uvm-texture-1',
              textureBindings: [{ resourceId: 'spark', textureId: 'uvm-texture-1' }],
            },
          ],
          textures: [
            { id: 'uvm-texture-1', width: 1, height: 1, rgba: new Uint8Array(4) },
            { id: 'uvm-texture-2', width: 1, height: 1, rgba: new Uint8Array(4) },
          ],
        },
      },
    })
    expect(merged.scene.primitives.map(item => item.id)).toEqual([
      'hull',
      'effect:uvm-effect-particle-0',
    ])
    const effect = merged.scene.primitives[1]
    expect(effect?.materialId).toBe('effect:m')
    // metres back to source units: two source units per metre, the translation included
    expect(Array.from(effect?.transform ?? [])).toEqual([
      2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 6, 0, 0, 1,
    ])
    expect(merged.scene.materials?.map(item => item.id)).toEqual(['m', 'effect:m'])
    expect(merged.scene.materials?.[1]).toMatchObject({
      baseColorTexture: 'effect:uvm-texture-1',
      textureBindings: [{ resourceId: 'spark', textureId: 'effect:uvm-texture-1' }],
    })
    expect(merged.scene.textures?.map(item => item.id)).toEqual(['effect:uvm-texture-1'])
    // a frame without effects leaves the stage's request as it was
    expect(
      withModelEffectLayer(stage, {
        request: stage,
        metersPerSourceUnit: 1,
        effectPrimitiveIds: [],
      }),
    ).toBe(stage)
  })

  it('frames the same model in the frame’s metres', () => {
    expect(effectFraming({ center: [1, 2, 3], radius: 4 }, 0.5)).toEqual({
      center: [0.5, 1, 1.5],
      radius: 2,
    })
  })

  it('reads a named texture once, an embedded one every time, and asks again after a failure', async () => {
    const asked: string[] = []
    let fail = true
    const port = rememberingRasterPort(
      {
        async read(request) {
          asked.push(request.kind)
          if (request.kind === 'logical' && fail) {
            fail = false
            throw new Error('busy')
          }
          return { state: 'unresolved', diagnostics: [] } as never
        },
      },
      new AbortController().signal,
    )
    const logical = {
      kind: 'logical',
      maxBytes: 1024,
      requirement: {
        id: 't',
        logicalId: 'spark.blp',
        role: 'texture',
        scopes: ['sibling-directory'],
      },
    } as unknown as RasterResourceRequest
    await expect(port.read(logical)).rejects.toThrow('busy')
    await port.read(logical)
    await port.read(logical)
    const embedded = { kind: 'embedded', maxBytes: 1024, bytes: new Uint8Array(1) } as const
    await port.read(embedded)
    await port.read(embedded)
    expect(asked).toEqual(['logical', 'logical', 'embedded', 'embedded'])
  })
})
