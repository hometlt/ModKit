import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
// One triangle whose looping one-second Stand clip lifts it from 0 to 2.
const model = {
  state: 'converted',
  sourceKey: 'wave',
  complete: true,
  diagnostics: [],
  nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
  meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
  skeleton: [
    {
      partId: 'triangle',
      boneIndex: 0,
      boneName: 'root',
      provenance: 'direct',
      hierarchyId: 'skin',
      parentBoneIndex: null,
      nodeId: 'root',
      localPose: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      inverseBindMatrix: identity,
    },
  ],
  primitives: [{ id: 'triangle', topology: 'triangles', positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1) }],
  animations: [
    {
      id: 'stand',
      name: 'Stand',
      kind: 'animation',
      provenance: 'direct',
      frames: 2,
      durationSeconds: 1,
      looping: true,
      channels: [
        {
          target: 'root',
          kind: 'translation',
          firstFrame: 0,
          lastFrame: 1,
          interpolation: 'linear',
          samples: [
            { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
            { frame: 1, timeSeconds: 1, value: [0, 2, 0] },
          ],
        },
      ],
    },
  ],
}
const copies = 16
const planAt = (presentationAnimation, extra = {}) =>
  createWorldWebGlPlan({
    items: Array.from({ length: copies }, (_, index) => ({
      facet: 'objects',
      id: `objects:doodad:${index}`,
      layerId: 'objects',
      coordinateSpaceId: 'uvw',
      kind: 'doodad',
      objectId: index + 1,
      resourceId: 'wave',
      position: { x: index * 4, y: 0, z: 0 },
      uvwPosition: { x: index * 4, y: 0, z: 0 },
      presentationAnimation,
    })),
    models: new Map([['wave', model]]),
    timeSeconds: 0,
    ...extra,
  })
/** The lift of each copy, keyed by its column. */
const lifts = plan => {
  const positions = plan.opaqueTriangles.positions
  const byCopy = new Map()
  for (let index = 0; index < positions.length; index += 3)
    byCopy.set(Math.floor((positions[index] + 0.5) / 4), Math.round(positions[index + 1] * 1000) / 1000)
  return [...byCopy.entries()].sort(([left], [right]) => left - right).map(([, lift]) => lift)
}
const stand = { name: 'Stand', groups: [], loop: true, speed: 1 }

it('starts each copy of a RandomStartOffset clip at its own stable phase', () => {
  const lockstep = lifts(planAt(stand))
  assert.deepEqual(lockstep, Array(copies).fill(0))
  const spread = lifts(planAt({ ...stand, randomStart: true }))
  assert.equal(spread.length, copies)
  // Phases are whole eighths of the clip, so copies still share sampled geometry in groups.
  assert.ok(spread.every(lift => Number.isInteger(lift * 4) && lift >= 0 && lift < 2))
  assert.ok(new Set(spread).size > 2)
  // The phase belongs to the object, not to the frame.
  assert.deepEqual(lifts(planAt({ ...stand, randomStart: true })), spread)
  assert.deepEqual(
    lifts(planAt({ ...stand, randomStart: true }, { timeSeconds: 0.125 })),
    spread.map(lift => Math.round(((lift + 0.25) % 2) * 1000) / 1000),
  )
})

it('plays an explicit object time and a one-shot clip as given', () => {
  const times = new Map(Array.from({ length: copies }, (_, index) => [index + 1, 0.25]))
  assert.deepEqual(
    lifts(planAt({ ...stand, randomStart: true }, { animationTimes: times })),
    Array(copies).fill(0.5),
  )
  assert.deepEqual(lifts(planAt({ ...stand, loop: false, randomStart: true })), Array(copies).fill(0))
})
