import { describe, expect, it } from 'vitest'
import type { ModelAnimationClip } from '@modkit/sdk'
import { materializeUvmAnimationMaterialTargets } from '../src/model/animation-materials.js'
import { materializeUvmCore } from '../src/model/materializer.js'

const request = {
  scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
  profile: 'UVM/core@1.0',
  subjectRevision: 'provider-token:material-targets',
  options: { assetId: 'fixture/material-targets', sourceFormat: 'whm' },
} as never

const clip: ModelAnimationClip = {
  id: 'scroll',
  name: 'Scroll',
  kind: 'animation',
  provenance: 'direct',
  frames: 0,
  durationSeconds: 1,
  sequenceIndex: 3,
  channels: [],
}

/** One material whose diffuse UV offset scrolls under clip sequence 3. */
const material = (sequenceTracks: readonly object[]) => ({
  id: 'water',
  shader: {
    id: 'modkit.render-material.v1',
    parameters: {
      renderModel: {
        version: 1,
        standard: {
          layers: {
            diffuse: {
              uvOffset: { value: [0, 0], sequenceTracks },
            },
          },
        },
      },
    },
  },
})

const track = {
  sequenceIndex: 3,
  track: {
    lineType: 1,
    globalSeqId: null,
    keys: [
      { frame: 0, vector: [0, 0] },
      { frame: 1, vector: [1, 0] },
    ],
  },
}

const projection = (materials: readonly object[]) =>
  ({
    info: {
      scenes: 0,
      nodes: 0,
      meshes: 0,
      primitives: 0,
      materials: materials.length,
      textures: 0,
      animations: 1,
      geometryAccess: 'decoded',
    },
    nodes: [],
    meshes: [],
    primitives: [],
    materials,
    animations: [clip],
  }) as never

type Clips = { readonly clips: unknown; readonly materialTargets?: unknown }
const clipsOf = (output: unknown) =>
  (output as { document: { extensions: { UV_game_animation_clips: Clips } } }).document.extensions
    .UV_game_animation_clips

describe('material targets of the clip catalog', () => {
  it('the materializer indexes animated material params itself', () => {
    const materials = [material([track])]
    const clips = clipsOf(materializeUvmCore(projection(materials), request))
    expect(clips.materialTargets).toEqual(
      JSON.parse(JSON.stringify(materializeUvmAnimationMaterialTargets(materials as never))),
    )
    expect(clips.materialTargets).toMatchObject([
      { id: 'water', properties: [{ path: '/renderModel/standard/layers/diffuse/uvOffset' }] },
    ])
  })

  it('leaves the catalog without targets when no material param is animated', () => {
    const clips = clipsOf(materializeUvmCore(projection([material([])]), request))
    expect(clips.materialTargets).toBeUndefined()
  })
})
