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
