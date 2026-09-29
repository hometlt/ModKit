import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createUvmParticleGeometry } from '../src/uvm/effect-particles.js'
import { ModelEffectSimulation } from '@modkit/codec-kit/model-math/effects-sim'

// The emitter's bone turned a quarter about Y (as ShorelineWavesBeach's Star2Part01): its X axis
// points along -Z, its Y axis stands up and its Z axis lies level.
const turned = (_kind, _index, _node, _time, out) => {
  out.position.set([0, 0, 0])
  out.xAxis.set([0, 0, -1])
  out.yAxis.set([0, 1, 0])
  out.zAxis.set([1, 0, 0])
}
const options = {
  cameraRight: [1, 0, 0],
  cameraUp: [0, 1, 0],
  cameraPosition: [0, 0, 10],
  time: 0.25,
  anchorProvider: turned,
  maxBytes: 1024 * 1024,
  maxNodes: 10000,
}
const base = { name: 'particle', boneIndex: 0, materialIndex: 0, width: 2, length: 2 }
function particle(emitter) {
  const simulation = new ModelEffectSimulation(
    { particles: [emitter], ribbons: [] },
    { maxParticles: 4, maxRibbons: 0, maxProjectorSplats: 0, seed: 123 },
  )
  const state = simulation.particles
  state.activeCount = 1
  state.activeSlots[0] = 0
  state.emitterIndices[0] = 0
  state.ages[0] = 0.25
  state.lifeSpans[0] = 1
  state.randomSeeds[0] = 0
  state.velocities.set([1, 1, 2])
  return state
}
const heights = entry => [1, 4, 7, 10].map(at => entry.positions[at])
const rise = entry => Math.max(...heights(entry)) - Math.min(...heights(entry))

it('lays terrain-oriented particles on the ground it is given, whatever their bone turned', () => {
  for (const mode of ['terrain-oriented', 'terrain-direction-oriented']) {
    const emitter = { ...base, orientationMode: mode }
    const state = particle(emitter)
    const flat = createUvmParticleGeometry(state, [emitter], {
      ...options,
      terrainNormal: [0, 1, 0],
    }).entries[0]
    assert.ok(rise(flat) < 1e-6, `${mode} on the ground: ${heights(flat)}`)
    // Its size stays: the quad keeps its sides of 2.
    const side = Math.hypot(
      flat.positions[3] - flat.positions[0],
      flat.positions[4] - flat.positions[1],
      flat.positions[5] - flat.positions[2],
    )
    assert.ok(Math.abs(side - 2) < 1e-5, `${mode} side ${side}`)
    // Without a ground the bone's own axes stand in, as before: the turned quad stands up.
    const standing = createUvmParticleGeometry(state, [emitter], options).entries[0]
    assert.ok(rise(standing) > 1, `${mode} on its bone: ${heights(standing)}`)
  }
})
