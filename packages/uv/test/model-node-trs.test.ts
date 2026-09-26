import { describe, expect, it } from 'vitest'
import type { ModelAnimationClip, ModelNode } from '@modkit/sdk'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:node-trs',
  options: { assetId: 'fixture/node-trs', sourceFormat: 'vxl' },
} as never

/** Translate (2, 0, 0), scale 2: the transform and the TRS a publisher states for it. */
const MATRIX = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 2, 0, 0, 1]
const TRS = {
  translation: [2, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [2, 2, 2],
} as const

const clip: ModelAnimationClip = {
  id: 'hva',
  name: 'HVA',
  kind: 'animation',
  provenance: 'companion',
  frames: 2,
  channels: [
    {
      target: 'section',
      kind: 'translation',
      firstFrame: 0,
      lastFrame: 1,
      interpolation: 'linear',
      samples: [
        { frame: 0, timeSeconds: 0, value: [2, 0, 0] },
        { frame: 1, timeSeconds: 0.5, value: [3, 0, 0] },
      ],
    },
  ],
}

function projection(node: Partial<ModelNode>) {
  return {
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 0,
      textures: 0,
      animations: 1,
      geometryAccess: 'decoded' as const,
    },
    nodes: [{ id: 'section', childIds: [], meshIds: ['mesh'], transform: MATRIX, ...node }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles' as const,
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: Uint32Array.from([0, 1, 2]),
      },
    ],
    animations: [clip],
  } as never
}

interface Written {
  readonly document: {
    readonly nodes: readonly Record<string, unknown>[]
    readonly animations?: readonly {
      channels: readonly { target: { node: number; path: string } }[]
    }[]
  }
  readonly receipt: { readonly lostFacetIds: readonly string[] }
}

describe('a node with a stated TRS', () => {
  it('is written as TRS and can carry its translation track', () => {
    const written = materializeUvmCore(projection({ trs: TRS }), request) as unknown as Written
    expect(written.document.nodes[0]).toMatchObject({
      translation: [2, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [2, 2, 2],
    })
    expect(written.document.nodes[0]?.['matrix']).toBeUndefined()
    expect(written.document.animations?.[0]?.channels[0]?.target).toEqual({
      node: 0,
      path: 'translation',
    })
    expect(written.receipt.lostFacetIds).not.toContain('common.view/model-animation-source@1')
  })

  it('stays a matrix without one, so its track is reported lost rather than decomposed', () => {
    const written = materializeUvmCore(projection({}), request) as unknown as Written
    expect(written.document.nodes[0]?.['matrix']).toEqual(MATRIX)
    expect(written.receipt.lostFacetIds).toContain('common.view/model-animation-source@1')
  })

  it('refuses a TRS that does not compose to the transform published beside it', () => {
    expect(() =>
      materializeUvmCore(projection({ trs: { ...TRS, translation: [9, 0, 0] } }), request),
    ).toThrow(/does not compose/u)
  })
})
