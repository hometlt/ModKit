import assert from 'node:assert/strict'
import { it } from 'node:test'

import { sceneMaterialVertexSource } from '../src/render/material-geometry.js'
import { materialCanInstance, materialWebGlDraws } from '../src/render/material-webgl.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const camera = { viewProjection: identity, viewMatrix: identity }
const source = {
  fragmentSource: 'precision highp float; void main(){}',
  uniforms: {},
  textures: [],
  defines: { uvSetCount: 1 },
  blend: 'opaque',
  twoSided: false,
}
const material = { textures: new Map() }
const mesh = {
  id: 'triangle',
  topology: 'triangles',
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  indices: Uint32Array.of(0, 1, 2),
}

// Records VAO attribute layouts, uniform values by name and submissions.
function context() {
  const names = ['a_position', 'a_normal', 'a_tangent', 'a_color', 'a_uv0']
  for (let column = 0; column < 4; column++) names.push(`a_instanceMatrix${column}`)
  let vao, arrayBuffer
  const uniforms = new Map()
  const constants = new Map()
  const submissions = []
  const gl = {
    TRIANGLES: 4,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    FLOAT: 5126,
    UNSIGNED_INT: 5125,
    STATIC_DRAW: 35044,
    MAX_TEXTURE_IMAGE_UNITS: 34930,
    NO_ERROR: 0,
    createShader: () => ({}),
    createProgram: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 16,
    getError: () => 0,
    getUniformLocation: (_, name) => name,
    createVertexArray: () => ({ attributes: new Map(), divisors: new Map() }),
    bindVertexArray: value => {
      vao = value
    },
    createBuffer: () => ({}),
    bindBuffer(target, buffer) {
      if (target === gl.ARRAY_BUFFER) arrayBuffer = buffer
    },
    bufferData(target, data) {
      if (target === gl.ARRAY_BUFFER) arrayBuffer.data = data
    },
    getAttribLocation: (_, name) => names.indexOf(name),
    vertexAttribPointer(location, size, _type, _normalized, stride, offset) {
      vao.attributes.set(location, { data: arrayBuffer.data, size, stride, offset })
    },
    vertexAttribDivisor: (location, divisor) => vao.divisors.set(location, divisor),
    vertexAttrib4fv: (location, values) => constants.set(location, [...values]),
    drawElements: () => submissions.push({ instances: undefined, vao, constants: new Map(constants) }),
    drawElementsInstanced: (_mode, _count, _type, _offset, instances) =>
      submissions.push({ instances, vao, constants: new Map(constants) }),
  }
  const record = (name, value) => uniforms.set(name, value)
  const proxy = new Proxy(gl, {
    get(target, name) {
      if (name in target) return target[name]
      if (String(name).startsWith('uniform'))
        return (location, ...values) =>
          record(location, values.length === 1 ? values[0] : values.at(-1) ?? values)
      return () => undefined
    },
  })
  return { gl: proxy, uniforms, submissions }
}

it('keeps the uniform vertex stage and reads the placement from attributes only on request', () => {
  const defines = { uvSetCount: 1, layers: [] }
  const uniforms = sceneMaterialVertexSource(defines)
  assert.doesNotMatch(uniforms, /a_instanceMatrix/)
  assert.match(uniforms, /uniform mat4 u_model, u_modelView, u_viewProjection, u_materialWorld;/)
  assert.match(uniforms, /vec4 world=u_model\*vec4\(a_position,1\.0\);/)
  const placed = sceneMaterialVertexSource(defines, true, false, true)
  assert.match(placed, /in vec4 a_instanceMatrix0, a_instanceMatrix1, a_instanceMatrix2, a_instanceMatrix3;/)
  assert.match(placed, /mat4 model=mat4\(a_instanceMatrix0,a_instanceMatrix1,a_instanceMatrix2,a_instanceMatrix3\);/)
  assert.match(placed, /vec4 world=model\*vec4\(a_position,1\.0\);/)
  assert.match(placed, /vec3 sceneN=unit\(objectNormalMatrix\*a_normal/)
  assert.doesNotMatch(placed, /u_model\b|u_modelView|u_viewNormalMatrix|u_sceneWorldNormalMatrix/)
})

it('draws every placement at once from per-instance model matrices', () => {
  const { gl, uniforms, submissions } = context()
  const renderer = materialWebGlDraws(gl, new Map(), { checkEachDraw: false })
  const matrices = new Float32Array(3 * 16)
  for (let index = 0; index < 3; index++) matrices.set(identity, index * 16)
  const triangles = renderer.drawInstanced(
    { primitive: mesh, program: source, material },
    { matrices, count: 3 },
    camera,
  )
  assert.equal(triangles, 3)
  assert.equal(renderer.drawCalls(), 1)
  assert.equal(submissions.length, 1)
  assert.equal(submissions[0].instances, 3)
  const { attributes, divisors } = submissions[0].vao
  for (let column = 0; column < 4; column++) {
    const location = 5 + column
    assert.equal(attributes.get(location).data, matrices)
    assert.equal(attributes.get(location).stride, 64)
    assert.equal(attributes.get(location).offset, column * 16)
    assert.equal(divisors.get(location), 1)
  }
  assert.equal(uniforms.get('u_view'), identity)
  // A single draw runs the same stage: its model matrix columns become constant attribute values.
  const moved = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1)
  renderer.draw({ primitive: { ...mesh, transform: moved }, program: source, material }, camera)
  assert.equal(submissions[1].instances, undefined)
  assert.notEqual(submissions[1].vao, submissions[0].vao)
  assert.equal(submissions[1].vao.divisors.size, 0)
  assert.deepEqual(submissions[1].constants.get(8), [5, 6, 7, 1])
})

it('refuses materials whose fragments read the draw normal matrix, and draws nothing for no placements', () => {
  const objectSpace = { ...source, normalMapSpace: 'object' }
  assert.equal(materialCanInstance(objectSpace), false)
  assert.equal(materialCanInstance(source), true)
  const { gl, submissions } = context()
  const renderer = materialWebGlDraws(gl, new Map(), { checkEachDraw: false })
  assert.throws(
    () =>
      renderer.drawInstanced(
        { primitive: mesh, program: objectSpace, material },
        { matrices: new Float32Array(16), count: 1 },
        camera,
      ),
    /cannot be instanced/,
  )
  assert.equal(
    renderer.drawInstanced(
      { primitive: mesh, program: source, material },
      { matrices: new Float32Array(0), count: 0 },
      camera,
    ),
    0,
  )
  assert.equal(submissions.length, 0)
})
