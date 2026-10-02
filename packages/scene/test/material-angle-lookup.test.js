import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'
import { shadeMaterial } from '../src/render/material-sampling.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
// a ramp from black to white across four texels, read by how edge-on the surface is
const ramp = {
  id: 'ramp',
  width: 4,
  height: 1,
  rgba: Uint8Array.from([0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255]),
  filter: 'nearest',
}
const parameters = angleLookup => ({
  renderModel: {
    version: 1,
    standard: {
      layers: {
        diffuse: {
          slot: 'diffuse',
          texturePath: 'ramp',
          uvSource: 0,
          channels: 0,
          op: 2,
          teamColorMode: 0,
          invert: false,
          clampResult: false,
          wrapX: false,
          wrapY: false,
          ...(angleLookup === undefined ? {} : { angleLookup }),
        },
      },
      blendMode: 0,
      priority: 0,
      specularity: 0,
      specMult: 1,
      emisMult: 1,
      specMode: 0,
      alphaTestThreshold: 0,
      twoSided: false,
      unshaded: true,
      doubleLambert: false,
      clampOutput: false,
      usesVertexColor: false,
      usesVertexAlpha: false,
    },
  },
})
const vertex = viewDirection => ({
  uv: [[0, 0]],
  modelPosition: [0, 0, 0],
  modelNormal: [0, 0, 1],
  worldPosition: [0, 0, 0],
  worldNormal: [0, 0, 1],
  viewPosition: [0, 0, -1],
  viewNormal: [0, 0, 1],
  lightDirection: [0, 0, 1],
  halfVector: [0, 0, -1],
  viewDirection,
  clip: [0, 0, 0, 1],
  color: [1, 1, 1, 1],
})

it('reads a falloff ramp by the view angle on the headless route (Supreme Commander Seraphim)', () => {
  const [program] = createStandardMaterialPrograms(parameters({ u: 'edge', v: 'row', row: 0.5 }), {
    budget,
  }).sample({ time: 0 })
  const textures = new Map([['ramp', ramp]])
  const facing = shadeMaterial(program, textures, vertex([0, 0, 1])).rgba
  const edgeOn = shadeMaterial(program, textures, vertex([1, 0, 0.001])).rgba
  assert.ok(facing[0] < 0.1, `facing ${facing[0]}`)
  assert.ok(edgeOn[0] > 0.9, `edge-on ${edgeOn[0]}`)
})

it('refuses an angle lookup a renderer could not read', () => {
  for (const angleLookup of [
    { u: 'edge', v: 'row' },
    { u: 'reflection', v: 'light', exponent: 2 },
    { u: 'edge', v: 'light', row: 0.5 },
    { u: 'up', v: 'light' },
    { u: 'edge', v: 'row', row: 0.5, exponent: 0 },
  ])
    assert.throws(
      () => createStandardMaterialPrograms(parameters(angleLookup), { budget }),
      /angleLookup/,
    )
})
