import assert from 'node:assert/strict'
import { it } from 'node:test'
import { worldModelAnimation } from '../src/world/webgl.js'

const clip = name => ({ id: name, name, kind: 'animation', durationSeconds: 1, channels: [] })
const result = {
  state: 'converted',
  animations: [clip('Stand'), clip('Stand Work'), clip('Stand 01')],
}
const object = animation => ({
  facet: 'objects',
  objectId: 1,
  ...(animation === undefined ? {} : { presentationAnimation: animation }),
})

it('keeps the main pose when automatically active clips use a separate lifetime clock', () => {
  const channel = target => ({ target, kind: 'translation', firstFrame: 0, lastFrame: 1,
    interpolation: 'linear', samples: [
      { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
      { frame: 1, timeSeconds: 1, value: [1, 0, 0] },
    ] })
  const base = { ...clip('Stand'), provenance: 'direct', frames: 2, channels: [channel('legs')] }
  const automatic = { ...clip('GL Stand'), provenance: 'direct', frames: 2, alwaysActive: true, channels: [channel('arms')] }
  const source = { state: 'converted', animations: [base, automatic] }
  const composed = worldModelAnimation(source, object({ name: 'Stand', groups: [], loop: true,
    speed: 1, globalTimeSeconds: 1.25 }))
  assert.deepEqual(Object.fromEntries(composed.channels.map(channel => [channel.target, channel.samples[0].value[0]])),
    { arms: 0.25, legs: 0.25 })
  // Existing map sources without an explicit lifetime clock retain the selected clip identity.
  assert.equal(worldModelAnimation(source, object({ name: 'Stand', groups: [], loop: true, speed: 1 })), base)
})

it('plays the sequence holding every requested property with the fewest others', () => {
  // InvisibleWalkablePlatform8x8 asks for Work; its model names the sequence "Stand Work".
  assert.equal(
    worldModelAnimation(result, object({ name: 'Work', groups: [], loop: true, speed: 1 }))?.name,
    'Stand Work',
  )
  assert.equal(
    worldModelAnimation(result, object({ name: 'Stand', groups: [], loop: true, speed: 1 }))?.name,
    'Stand',
  )
  assert.equal(
    worldModelAnimation(result, object({ name: 'Stand', groups: ['Work'], loop: true, speed: 1 }))
      ?.name,
    'Stand Work',
  )
  assert.equal(
    worldModelAnimation(result, object({ name: 'Death', groups: [], loop: true, speed: 1 })),
    undefined,
  )
})
