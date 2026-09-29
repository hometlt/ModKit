import assert from 'node:assert/strict'
import { it } from 'node:test'

import { shaderPairCacheKey } from '../src/materials/webgl.js'
import { materialWebGlDraws } from '../src/render/material-webgl.js'

const source = {
  fragmentSource: 'precision highp float; uniform sampler2D u_diffuseMap; void main(){}',
  uniforms: { u_specularity: 0.5 },
  textures: [
    {
      resourceId: 'albedo',
      uniform: 'u_diffuseMap',
      slot: 'diffuse',
      wrapU: 'wrap',
      wrapV: 'wrap',
    },
  ],
  defines: { uvSetCount: 1 },
  blend: 'opaque',
  twoSided: false,
}
const material = { textures: new Map([['albedo', { id: 'albedo.png' }]]) }
const mesh = id => ({
  id,
  topology: 'triangles',
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  indices: Uint32Array.of(0, 1, 2),
})

// Counts every call by name; every other method is a no-op.
function context() {
  const calls = new Map()
  const gl = {
    MAX_TEXTURE_IMAGE_UNITS: 34930,
    NO_ERROR: 0,
    createShader: () => ({}),
    createProgram: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 16,
    getError: () => 0,
  }
  const proxy = new Proxy(gl, {
    get(target, name) {
      const value = target[name]
      if (value !== undefined && typeof value !== 'function') return value
      return (...args) => {
        calls.set(name, (calls.get(name) ?? 0) + 1)
        return value?.(...args)
      }
    },
  })
  return { gl: proxy, count: name => calls.get(name) ?? 0 }
}

it('links a shader variant once for any number of its program objects, and not again later', () => {
  const { gl, count } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  // Programs that follow the clock: a new object every frame, one shader variant.
  const draws = id =>
    Array.from({ length: 4 }, () => ({ primitive: mesh(id), program: { ...source }, material }))
  assert.equal(renderer.warm(draws('a')), 1)
  assert.equal(count('createProgram'), 1)
  assert.equal(renderer.warm(draws('b')), 0)
  // Equal sources of another variant object find the linked program too.
  const copy = { ...source, defines: { ...source.defines } }
  assert.equal(renderer.warm([{ primitive: mesh('c'), program: copy, material }]), 0)
  assert.equal(count('createProgram'), 1)
  assert.equal(count('linkProgram'), 1)
})

it('keys a shader pair by its joined sources', () => {
  const pair = { vertexSource: 'void main(){}', fragmentSource: 'precision highp float;' }
  assert.equal(shaderPairCacheKey(pair), 'void main(){}\u0000precision highp float;')
  assert.equal(shaderPairCacheKey({ ...pair }), shaderPairCacheKey(pair))
})
