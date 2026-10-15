import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materialWebGlDraws } from '../src/render/material-webgl.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const camera = { viewProjection: identity }
const source = {
  fragmentSource: 'precision highp float; void main(){}',
  uniforms: {},
  textures: [],
  defines: { uvSetCount: 1 },
  blend: 'opaque',
  twoSided: false,
}
const material = { textures: new Map() }
const primitive = () => ({
  id: 'triangle',
  topology: 'triangles',
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
  indices: Uint32Array.of(0, 1, 2),
})
const draw = (geometry, program = source, options = {}) => ({
  primitive: geometry,
  program,
  material,
  ...options,
})

// Models the VAO-owned element/attribute bindings and context-owned generic attributes separately.
// With `uniforms`, uniform locations are named and scalar and vec4 uploads are recorded.
function context({ uniforms = false } = {}) {
  const noop = () => undefined
  const calls = new Map(),
    live = { vao: new Set(), buffer: new Set(), program: new Set() },
    uniformCalls = []
  let vao, arrayBuffer, depthMask, colorMask, blendFunction, frontFace
  const constants = new Map(),
    enabled = new Set(),
    submissions = []
  const allocate = kind => {
    const handle = {}
    live[kind].add(handle)
    return handle
  }
  const remove = (kind, handle) => assert.ok(live[kind].delete(handle), `deleted ${kind} twice`)
  const gl = {
    TRIANGLES: 4,
    TRIANGLE_STRIP: 5,
    TRIANGLE_FAN: 6,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    FLOAT: 5126,
    UNSIGNED_INT: 5125,
    STATIC_DRAW: 35044,
    MAX_TEXTURE_IMAGE_UNITS: 34930,
    NO_ERROR: 0,
    DEPTH_TEST: 2929,
    CULL_FACE: 2884,
    BLEND: 3042,
    POLYGON_OFFSET_FILL: 32823,
    SRC_ALPHA: 770,
    ONE_MINUS_SRC_ALPHA: 771,
    ONE: 1,
    ZERO: 0,
    BACK: 1029,
    CCW: 2305,
    CW: 2304,
    LEQUAL: 515,
    FUNC_ADD: 32774,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    createShader: () => ({}),
    shaderSource: noop,
    compileShader: noop,
    deleteShader: noop,
    getShaderParameter: () => true,
    attachShader: noop,
    linkProgram: noop,
    getProgramParameter: () => true,
    getParameter: () => 16,
    getError: () => 0,
    createProgram: () => allocate('program'),
    deleteProgram: handle => remove('program', handle),
    useProgram: handle => assert.ok(live.program.has(handle)),
    getUniformLocation: uniforms ? (_, name) => ({ name }) : () => null,
    ...(uniforms
      ? {
          uniform1f: (location, value) => uniformCalls.push([location.name, value]),
          uniform4fv: (location, value) => uniformCalls.push([location.name, [...value]]),
        }
      : {}),
    createVertexArray: () =>
      Object.assign(allocate('vao'), { attributes: new Map(), indices: null }),
    deleteVertexArray: handle => remove('vao', handle),
    bindVertexArray(handle) {
      assert.ok(handle === null || live.vao.has(handle))
      vao = handle
    },
    createBuffer: () => allocate('buffer'),
    deleteBuffer: handle => remove('buffer', handle),
    bindBuffer(target, handle) {
      assert.ok(live.buffer.has(handle))
      if (target === gl.ARRAY_BUFFER) arrayBuffer = handle
      else vao.indices = handle
    },
    bufferData(target, values) {
      ;(target === gl.ARRAY_BUFFER ? arrayBuffer : vao.indices).data = values
    },
    getAttribLocation: (_, name) =>
      ['a_position', 'a_normal', 'a_tangent', 'a_color', 'a_uv0'].indexOf(name),
    enableVertexAttribArray: noop,
    disableVertexAttribArray: location => vao.attributes.delete(location),
    vertexAttribPointer: location => vao.attributes.set(location, arrayBuffer),
    vertexAttrib4fv: (location, values) => constants.set(location, [...values]),
    enable: value => enabled.add(value),
    disable: value => enabled.delete(value),
    depthMask: value => {
      depthMask = value
    },
    colorMask: (...values) => {
      colorMask = values
    },
    blendFuncSeparate: (...values) => {
      blendFunction = values
    },
    depthFunc: noop,
    cullFace: noop,
    frontFace: value => { frontFace = value },
    blendEquation: noop,
    polygonOffset: noop,
    bindSampler: noop,
    drawElements() {
      submit(true)
    },
    drawArrays() {
      submit(false)
    },
  }
  function submit(indexed) {
    assert.ok(live.vao.has(vao))
    for (const buffer of vao.attributes.values()) assert.ok(live.buffer.has(buffer))
    if (indexed) assert.ok(live.buffer.has(vao.indices))
    submissions.push({
      vao,
      indexed,
      indices: vao.indices?.data,
      attributes: new Map([...vao.attributes].map(([location, buffer]) => [location, buffer.data])),
      constants: new Map(constants),
      depthMask,
      colorMask,
      blendFunction,
      frontFace,
      enabled: new Set(enabled),
    })
  }
  const proxy = new Proxy(gl, {
    get(target, name) {
      const value = target[name] ?? (String(name).startsWith('uniform') ? noop : undefined)
      if (typeof value !== 'function') return value
      return (...args) => {
        calls.set(name, (calls.get(name) ?? 0) + 1)
        return value(...args)
      }
    },
  })
  return { gl: proxy, calls, live, submissions, uniformCalls }
}

it('shares a VAO across placed instances, new uniform leases and frames without rebinding geometry', () => {
  const { gl, calls, live, submissions } = context()
  const renderer = materialWebGlDraws(gl, new Map(), { checkEachDraw: false })
  const mesh = primitive()
  const emptyStats = { bufferEntries: 0, bufferBytesRetained: 0, vertexArrayEntries: 0 }
  assert.deepEqual(renderer.stats(), emptyStats)
  renderer.draw(draw(mesh), camera)
  const firstStats = renderer.stats()
  assert.deepEqual(firstStats, {
    bufferEntries: 3,
    bufferBytesRetained:
      mesh.positions.byteLength + mesh.textureCoordinates.byteLength + mesh.indices.byteLength,
    vertexArrayEntries: 1,
  })
  assert.ok(Object.isFrozen(firstStats))
  const beforeStats = new Map(calls)
  assert.deepEqual(renderer.stats(), firstStats)
  assert.deepEqual(calls, beforeStats)
  renderer.sweep()
  const pointerCalls = calls.get('vertexAttribPointer'),
    bindings = calls.get('bindBuffer')
  for (let i = 0; i < 1000; i++) {
    // Like an unrelated pass, change context-owned defaults before returning to this VAO.
    gl.vertexAttrib4fv(3, [0, 0, 0, 0])
    renderer.draw(
      draw({ ...mesh, id: `instance-${i}`, transform: identity }, { ...source }),
      camera,
    )
  }
  renderer.sweep()
  assert.equal(calls.get('createVertexArray'), 1)
  assert.equal(calls.get('deleteVertexArray') ?? 0, 0)
  assert.equal(calls.get('vertexAttribPointer'), pointerCalls)
  assert.equal(calls.get('bindBuffer'), bindings)
  // Five vertex attributes and four placement columns, looked up once for the one VAO.
  assert.equal(calls.get('getAttribLocation'), 9)
  assert.equal(renderer.drawCalls(), 1001)
  assert.deepEqual(renderer.stats(), firstStats)
  assert.deepEqual(submissions.at(-1).constants.get(3), [1, 1, 1, 1])
  assert.equal(submissions.at(-1).vao, submissions[0].vao)
  renderer.sweep() // No use this frame: VAOs are evicted, buffers wait one frame as spares.
  assert.equal(live.vao.size, 0)
  assert.equal(live.buffer.size, 3)
  assert.deepEqual(renderer.stats(), { ...firstStats, vertexArrayEntries: 0 })
  renderer.sweep() // Spares no draw took are deleted.
  assert.equal(live.buffer.size, 0)
  assert.deepEqual(renderer.stats(), emptyStats)
  renderer.draw(draw(mesh), camera)
  assert.equal(calls.get('createVertexArray'), 2)
  renderer.release()
  renderer.release()
  assert.deepEqual(renderer.stats(), emptyStats)
  assert.equal(firstStats.bufferEntries, 3) // Old snapshots do not track live state.
  for (const resources of Object.values(live)) assert.equal(resources.size, 0)
})

it('uploads a new array into the buffer an array of its size left behind', () => {
  const { gl, calls, live } = context()
  const renderer = materialWebGlDraws(gl, new Map())
  const mesh = primitive()
  renderer.draw(draw(mesh), camera)
  renderer.sweep()
  renderer.sweep() // The first arrays are spares now.
  const moved = {
    ...mesh,
    positions: mesh.positions.map(value => value + 1),
    textureCoordinates: mesh.textureCoordinates.slice(),
    indices: mesh.indices.slice(),
  }
  renderer.draw(draw(moved), camera)
  assert.equal(calls.get('createBuffer'), 3)
  assert.equal(calls.get('deleteBuffer') ?? 0, 0)
  assert.equal(calls.get('bufferData'), 6)
  assert.equal(live.buffer.size, 3)
  assert.deepEqual(
    new Set([...live.buffer].map(buffer => buffer.data)),
    new Set([moved.positions, moved.textureCoordinates, moved.indices]),
  )
  renderer.release()
  for (const resources of Object.values(live)) assert.equal(resources.size, 0)
})

it('replaces VAOs for changed attributes or UVs, rebinds changed indices, retaining buffers in use', () => {
  const { gl, live, submissions } = context()
  const renderer = materialWebGlDraws(gl, new Map())
  let mesh = primitive()
  for (const [replacement, kept] of [
    [{}, false],
    [{ normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1) }, false],
    [{ textureCoordinateSets: [{ set: 0, coordinates: Float32Array.of(1, 1, 0, 1, 1, 0) }] }, false],
    // other indices over the same vertices (a blended primitive sorted again) bind into the kept VAO
    [{ indices: Uint32Array.of(0, 2, 1) }, true],
    [{ indices: undefined }, false],
  ]) {
    mesh = { ...mesh, ...replacement }
    renderer.draw(draw(mesh), camera)
    renderer.sweep()
    const last = submissions.at(-1),
      previous = submissions.at(-2)
    assert.equal(live.vao.size, 1)
    assert.deepEqual(renderer.stats(), {
      bufferEntries: live.buffer.size,
      bufferBytesRetained: [...live.buffer].reduce(
        (sum, buffer) => sum + buffer.data.byteLength,
        0,
      ),
      vertexArrayEntries: 1,
    })
    assert.equal(last.indices, mesh.indices)
    assert.equal(last.attributes.get(0), mesh.positions)
    assert.equal(last.attributes.get(1), mesh.normals)
    assert.equal(
      last.attributes.get(4),
      mesh.textureCoordinateSets?.[0].coordinates ?? mesh.textureCoordinates,
    )
    if (previous && kept) assert.equal(last.vao, previous.vao)
    else if (previous) {
      assert.notEqual(last.vao, previous.vao)
      assert.ok(!live.vao.has(previous.vao))
    }
  }
  renderer.release()
  for (const resources of Object.values(live)) assert.equal(resources.size, 0)
})

it('keeps VAOs local to a linked program and context and disposes them with their owner', () => {
  const first = context(),
    second = context(),
    mesh = primitive()
  for (const ctx of [first, second]) {
    const renderer = materialWebGlDraws(ctx.gl, new Map())
    renderer.draw(draw(mesh), camera)
    renderer.draw(
      draw(mesh, { ...source, fragmentSource: `${source.fragmentSource}\n// other shader` }),
      camera,
    )
    assert.equal(ctx.live.vao.size, 2)
    assert.deepEqual(renderer.stats(), {
      bufferEntries: 3,
      bufferBytesRetained: 72,
      vertexArrayEntries: 2,
    })
    assert.notEqual(ctx.submissions[0].vao, ctx.submissions[1].vao)
    renderer.release()
    for (const resources of Object.values(ctx.live)) assert.equal(resources.size, 0)
  }
  assert.notEqual(first.submissions[0].vao, second.submissions[0].vao)
})

it('reuses geometry without skipping alpha-test, transparent or depth-only draw state', () => {
  const { gl, submissions, calls } = context()
  const renderer = materialWebGlDraws(gl, new Map())
  const mesh = primitive(),
    alphaTest = { ...source, blend: 'alpha-test' }
  const transparent = { ...source, blend: 'blend', twoSided: true }
  renderer.draw(draw(mesh, alphaTest), camera)
  renderer.draw(draw(mesh, transparent, { depthOnly: true }), camera)
  renderer.draw(draw(mesh, transparent), camera)
  renderer.draw(draw(mesh, transparent), camera)
  assert.equal(calls.get('createVertexArray'), 2)
  for (const [index, sample] of submissions.entries()) {
    assert.equal(sample.depthMask, index < 2)
    assert.deepEqual(sample.colorMask, Array(4).fill(index !== 1))
    assert.equal(sample.enabled.has(gl.BLEND), index >= 2)
    assert.equal(sample.enabled.has(gl.CULL_FACE), index === 0)
  }
  assert.deepEqual(submissions[3].blendFunction, [
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA,
  ])
  const before = renderer.drawCalls()
  assert.equal(renderer.draw(draw({ ...mesh, topology: 'lines' }), camera), 0)
  assert.equal(renderer.drawCalls(), before)
  renderer.release()
})

it('counts separate GPU uploads of aliased views and retains upload sizes after CPU detachment', () => {
  const { gl } = context()
  const renderer = materialWebGlDraws(gl, new Map())
  const mesh = primitive()
  renderer.draw(draw(mesh), camera)
  renderer.draw(draw({ ...mesh, positions: mesh.positions.subarray() }), camera)
  const expected = { bufferEntries: 4, bufferBytesRetained: 108, vertexArrayEntries: 2 }
  assert.deepEqual(renderer.stats(), expected)
  // GPU storage remains live after the source buffer is transferred back to a worker.
  structuredClone(mesh.positions.buffer, { transfer: [mesh.positions.buffer] })
  assert.deepEqual(renderer.stats(), expected)
  renderer.release()
  assert.deepEqual(renderer.stats(), {
    bufferEntries: 0,
    bufferBytesRetained: 0,
    vertexArrayEntries: 0,
  })
})

it('cleans up a VAO when buffer allocation fails and can retry without stale bindings', () => {
  const { gl, live } = context()
  const renderer = materialWebGlDraws(gl, new Map())
  const createBuffer = gl.createBuffer
  gl.createBuffer = () => null
  assert.throws(() => renderer.draw(draw(primitive()), camera), /allocate material geometry/)
  assert.equal(live.vao.size, 0)
  assert.equal(renderer.drawCalls(), 0)
  gl.createBuffer = createBuffer
  renderer.draw(draw(primitive()), camera)
  renderer.release()
  for (const resources of Object.values(live)) assert.equal(resources.size, 0)
})

it('draws a kept draw with the uniform values of the program it stands for', () => {
  const { gl, uniformCalls } = context({ uniforms: true })
  const renderer = materialWebGlDraws(gl, new Map(), { checkEachDraw: false })
  const kept = { ...source, uniforms: { u_alpha: 0.25, u_color: [1, 0, 0, 1] } }
  const standFor = uniforms => new Map([[kept, { ...kept, uniforms }]])
  const valuesOf = name =>
    uniformCalls.filter(([uniform]) => uniform === name).map(([, value]) => value)
  const drawKept = programs =>
    renderer.drawSequence([{ draw: draw(primitive(), kept) }], camera, undefined, programs)
  drawKept(standFor({ u_alpha: 0.75, u_color: [0, 1, 0, 1] }))
  assert.deepEqual(valuesOf('u_alpha'), [0.75])
  assert.deepEqual(valuesOf('u_color'), [[0, 1, 0, 1]])
  // The next frame stands for other values: the same lease uploads them.
  drawKept(standFor({ u_alpha: 0.5, u_color: [0, 0, 1, 1] }))
  assert.deepEqual(valuesOf('u_alpha'), [0.75, 0.5])
  // Standing for nothing, the draw uploads its own values again; a repeat uploads nothing.
  drawKept(undefined)
  drawKept(undefined)
  assert.deepEqual(valuesOf('u_alpha'), [0.75, 0.5, 0.25])
  assert.equal(renderer.programCompilations(), 1)
})

it('resets front-facing state for two-sided draws after mirrored culling and restores CCW', () => {
  const { gl, submissions } = context()
  const renderer = materialWebGlDraws(gl, new Map(), { checkEachDraw: false })
  const mirrored = identity.slice()
  mirrored[0] = -1
  const culled = draw({ ...primitive(), transform: mirrored })
  const twoSided = draw(primitive(), { ...source, twoSided: true })
  renderer.drawSequence([{ draw: culled }, { draw: twoSided }, { draw: culled }], camera)
  assert.deepEqual(submissions.map(s => s.frontFace), [gl.CW, gl.CCW, gl.CW])
  assert.deepEqual(submissions.map(s => s.enabled.has(gl.CULL_FACE)), [true, false, true])
  // Restore applies to the shared context even if the final draw was mirrored and culled.
  renderer.draw(twoSided, camera)
  assert.equal(submissions.at(-1).frontFace, gl.CCW)
  assert.equal(submissions.at(-1).enabled.has(gl.CULL_FACE), false)
  renderer.release()
})
