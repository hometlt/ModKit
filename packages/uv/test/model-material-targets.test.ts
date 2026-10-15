import { describe, expect, it } from 'vitest'
import type { JsonObject, ModelAnimationClip } from '@modkit/sdk'
import { materializeUvmAnimationMaterialTargets, readUvmAnimationMaterialTargets } from '../src/model/animation-materials.js'
import { readUvmContainer, writeUvmContainer } from '../src/model/container.js'
import { validateUvmDocument } from '../src/model/validation/index.js'
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


describe('emissive gain material targets', () => {
  const gainTrack = { sequenceIndex: 3, track: { lineType: 1, globalSeqId: null,
    keys: [{ frame: 0, vector: [0] }, { frame: 1, vector: [2] }] } }
  const gainMaterial = (gain: unknown, composite = false) => ({ id: 'glow', shader: {
    id: 'modkit.render-material.v1', parameters: { renderModel: { version: 1,
      ...(composite ? { composite: { priority: 0, passes: [
        { material: { layers: {}, emisMult: gain }, alphaFactor: { value: 1 } },
      ] } } : { standard: { layers: {}, emisMult: gain } }),
    } },
  } })
  it.each([false, true])('preserves numeric legacy defaults without manufacturing targets: composite=%s', composite => {
    for (const gain of [0, 1, -0.5, 2, { value: 1 }, { value: 1, sequenceTracks: [] }]) {
      const materials = [gainMaterial(gain, composite)]
      expect(materializeUvmAnimationMaterialTargets(materials as never)).toEqual([])
      expect(clipsOf(materializeUvmCore(projection(materials), request)).materialTargets).toBeUndefined()
    }
  })
  it.each([false, true])('registers width1 paths and preserves them in encoded bytes: composite=%s', composite => {
    const path = composite ? '/renderModel/composite/passes/0/material/emisMult' : '/renderModel/standard/emisMult'
    const materials = [gainMaterial({ value: -0.5, sequenceTracks: [gainTrack] }, composite)]
    const output = materializeUvmCore(projection(materials), request)
    const bytes = output.bytes
    const reopened = readUvmContainer(bytes)
    validateUvmDocument(reopened.document, { binaryByteLength: reopened.binary.byteLength })
    expect(readUvmAnimationMaterialTargets(reopened.document)).toEqual([
      { id: 'glow', properties: [{ path, value: -0.5, sequenceTracks: [gainTrack] }] },
    ])
    expect(writeUvmContainer(reopened)).toEqual(bytes)
  })
  it.each([false, true])('requires a numeric emissive default without narrowing unrelated scalar paths: composite=%s', composite => {
    for (const value of [[1], [], [1, 2], null, {}, NaN, Infinity, 1e40])
      expect(() => materializeUvmAnimationMaterialTargets([
        gainMaterial({ value, sequenceTracks: [gainTrack] }, composite),
      ] as never)).toThrow()
    const positive = materializeUvmAnimationMaterialTargets([
      gainMaterial({ value: 1, sequenceTracks: [{ ...gainTrack, track: {
        ...gainTrack.track, keys: [{ frame: 0, vector: [1] }, { frame: 1, vector: [2] }],
      } }] }, composite),
    ] as never)
    expect(positive[0]?.properties[0]?.value).toBe(1)
    expect(positive[0]?.properties[0]?.sequenceTracks[0]?.['track']).toMatchObject({
      keys: [{ vector: [1] }, { vector: [2] }],
    })
    // Preserve the existing reader's one-component array convention at unrelated paths.
    expect(readUvmAnimationMaterialTargets({ extensions: { UV_game_animation_clips: {
      materialTargets: [{ id: 'height', properties: [{
        path: '/renderModel/standard/parallaxHeight', value: [1], sequenceTracks: [gainTrack],
      }] }],
    } } })[0]?.properties[0]?.value).toEqual([1])
  })
  it('keeps invalid widths, overflow, orphan clocks, and unregistered paths refused', () => {
    for (const gain of [1e40, NaN, Infinity,
      { value: 1, sequenceTracks: [{ ...gainTrack, sequenceIndex: -1 }] },
      { value: 1, sequenceTracks: [{ ...gainTrack, track: { ...gainTrack.track,
        keys: [{ frame: 0, vector: [0, 1] }] } }] }])
      expect(() => materializeUvmAnimationMaterialTargets([gainMaterial(gain)] as never)).toThrow()
    const orphan = materializeUvmCore(projection([gainMaterial({ value: 1,
      sequenceTracks: [{ ...gainTrack, sequenceIndex: 999 }],
    })]), request)
    const orphanContainer = readUvmContainer(orphan.bytes)
    expect(() => validateUvmDocument(orphanContainer.document, { binaryByteLength: orphanContainer.binary.byteLength })).toThrow()
    for (const path of ['/renderModel/standard/layers/diffuse/texturePath',
      '/renderModel/composite/passes/00/material/emisMult', '/renderModel/standard/emisMult/extra']) {
      const output = materializeUvmCore(projection([gainMaterial(1)]), request)
      const reopened = readUvmContainer(output.bytes)
      const extensions = reopened.document['extensions']
      if (extensions === null || typeof extensions !== 'object' || Array.isArray(extensions))
        throw new TypeError('Fixture requires an extensions object')
      // Array.isArray does not narrow readonly JSON arrays in TypeScript; both guards are runtime checks.
      const extensionObject = extensions as JsonObject
      const catalog = extensionObject['UV_game_animation_clips']
      if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog))
        throw new TypeError('Fixture requires the animation clip catalog')
      const document = { ...reopened.document, extensions: { ...extensionObject,
        UV_game_animation_clips: { ...(catalog as JsonObject), materialTargets: [{ id: 'glow', properties: [
          { path, value: 1, sequenceTracks: [gainTrack] },
        ] }] },
      } }
      expect(() => validateUvmDocument(document, { binaryByteLength: output.binary.byteLength })).toThrow()
    }
  })
})
