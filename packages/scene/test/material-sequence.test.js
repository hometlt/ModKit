import assert from 'node:assert/strict'
import { it } from 'node:test'

import { leaseShaderSources, materialWebGlDraws } from '../src/render/material-webgl.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const camera = { viewProjection: identity, viewMatrix: identity }
const source = {
  fragmentSource: 'precision highp float; uniform sampler2D u_diffuseMap; void main(){}',
  uniforms: { u_specularity: 0.5 },
  textures: [
    { resourceId: 'albedo', uniform: 'u_diffuseMap', slot: 'diffuse', wrapU: 'wrap', wrapV: 'wrap' },
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
const placements = count => {
  const matrices = new Float32Array(count * 16)
  for (let index = 0; index < count; index++) matrices.set(identity, index * 16)
  return { matrices, count }
}

// Counts every call by name and keeps the last value uploaded to each uniform, and how often.
function context() {
  const calls = new Map()
  const uniforms = new Map()
  const uploads = new Map()
  const boundTextures = []
  const names = ['a_position', 'a_normal', 'a_tangent', 'a_color', 'a_uv0']
  for (let column = 0; column < 4; column++) names.push(`a_instanceMatrix${column}`)
  const gl = {
    TRIANGLES: 4,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    FLOAT: 5126,
    UNSIGNED_INT: 5125,
    STATIC_DRAW: 35044,
    MAX_TEXTURE_IMAGE_UNITS: 34930,
    NO_ERROR: 0,
    TEXTURE0: 33984,
    TEXTURE_2D: 3553,
    CULL_FACE: 2884,
    createShader: () => ({}),
    createProgram: () => ({}),
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    createSampler: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 16,
    getError: () => 0,
    getUniformLocation: (_, name) => name,
    getAttribLocation: (_, name) => names.indexOf(name),
  }
  const proxy = new Proxy(gl, {
    get(target, name) {
      const value = target[name]
      if (value !== undefined && typeof value !== 'function') return value
      return (...args) => {
        calls.set(name, (calls.get(name) ?? 0) + 1)
        if (String(name).startsWith('uniform') && args[0] !== null) {
          uniforms.set(args[0], args.at(-1))
          uploads.set(args[0], (uploads.get(args[0]) ?? 0) + 1)
        }
        if (name === 'bindTexture') boundTextures.push(args[1])
        return value?.(...args)
      }
    },
  })
  const count = name => calls.get(name) ?? 0
  return { gl: proxy, calls, uniforms, uploads, count, boundTextures }
}

it('draws a sequence changing only what differs from the previous draw, and restores once', () => {
  const { gl, count, uniforms } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  const draws = [
    { draw: { primitive: mesh('a'), program: source, material }, instances: placements(3) },
    { draw: { primitive: mesh('b'), program: source, material }, instances: placements(2) },
    { draw: { primitive: mesh('c'), program: source, material } },
  ]
  assert.equal(renderer.drawSequence(draws, camera), 6)
  assert.equal(renderer.drawCalls(), 3)
  // One program, one lease, one texture: bound, uploaded and set once for the whole sequence.
  assert.equal(count('useProgram'), 1)
  assert.equal(count('bindTexture'), 1)
  assert.equal(count('createSampler'), 1)
  assert.equal(count('uniformMatrix4fv'), 3) // view, view-projection, world-to-material
  assert.equal(count('uniform4fv'), 1) // the shared tint
  assert.equal(count('colorMask'), 2) // the draws' colour mask, and the restore
  assert.equal(count('bindVertexArray'), 4) // three geometries, and the restore
  assert.equal(uniforms.get('u_specularity'), 0.5)
  // Restored once: the sampler unit, the vertex array, the colour mask and culling.
  assert.equal(count('bindSampler'), 2)
  assert.equal(count('disable'), 3) // culling restore, polygon offset and blending of the draws

  // Same camera values in a later sequence: the program keeps its frame and material uniforms.
  renderer.drawSequence(draws.slice(0, 1), { ...camera })
  assert.equal(count('uniformMatrix4fv'), 3)
  assert.equal(count('useProgram'), 2)
  // A moved camera uploads the frame again; the material and tint stay.
  const moved = Float32Array.from(identity)
  moved[12] = 5
  renderer.drawSequence(draws.slice(0, 1), { viewProjection: moved, viewMatrix: moved })
  assert.equal(count('uniformMatrix4fv'), 5)
  assert.equal(uniforms.get('u_viewProjection'), moved)
  assert.equal(count('uniform4fv'), 1)
})

it('sets a program shared by materials only where the next one differs in float32', () => {
  const { gl, uniforms, uploads } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  // One linked program (same sources): 0.1 and its float32 are one value to WebGL.
  const shiny = {
    ...source,
    uniforms: { u_specularity: 0.1, u_emisMult: 1, u_ambient: [1, 0, 0, 1] },
  }
  const same = { ...shiny, uniforms: { ...shiny.uniforms, u_specularity: Math.fround(0.1) } }
  const dull = { ...shiny, uniforms: { ...shiny.uniforms, u_ambient: [1, 0, 0, 0.5] } }
  const draws = [shiny, same, dull, shiny].map((program, index) => ({
    draw: { primitive: mesh(`m${index}`), program, material },
  }))
  renderer.drawSequence(draws, camera)
  assert.equal(uploads.get('u_specularity'), 1)
  assert.equal(uploads.get('u_emisMult'), 1)
  assert.equal(uploads.get('u_ambient'), 3) // shiny, dull, shiny
  assert.equal(uploads.get('u_diffuseMap'), 1) // the sampler unit
  assert.deepEqual([...uniforms.get('u_ambient')], [1, 0, 0, 1])
  // A later sequence finds the program holding the last material's values.
  renderer.drawSequence(draws.slice(3), camera)
  assert.equal(uploads.get('u_ambient'), 3)
})

it('asks a linked program for its attribute locations once, whatever geometry it draws', () => {
  const { gl, count } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  const draws = ['a', 'b', 'c'].map(id => ({
    draw: { primitive: mesh(id), program: source, material },
  }))
  renderer.drawSequence(draws, camera)
  assert.equal(count('createVertexArray'), 3)
  // a_position, a_normal, a_tangent, a_color, a_uv0 and the four instance matrix columns.
  assert.equal(count('getAttribLocation'), 9)
})

it('sets the placement columns once for consecutive draws of one placement', () => {
  const at = transform => id => ({
    draw: { primitive: { ...mesh(id), transform }, program: source, material },
  })
  const here = at(Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1))
  const there = at(Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 3, 4, 1))
  const writes = draws => {
    const { gl, count } = context()
    const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
    renderer.drawSequence(draws, camera)
    return count('vertexAttrib4fv')
  }
  const one = writes([here('a')])
  assert.equal(writes([here('a'), here('b'), here('c')]), one)
  // Only the translation column differs at another placement.
  assert.equal(writes([here('a'), there('b')]), one + 1)
})

it('changes only the texture of a unit when materials share its sampler', () => {
  const { gl, count } = context()
  const renderer = materialWebGlDraws(
    gl,
    new Map([
      ['albedo.png', {}],
      ['other.png', {}],
    ]),
    { checkEachDraw: false },
  )
  const other = { ...source }
  const otherMaterial = { textures: new Map([['albedo', { id: 'other.png' }]]) }
  const draws = [
    [source, material],
    [other, otherMaterial],
    [source, material],
  ].map(([program, surface], index) => ({
    draw: { primitive: mesh(`m${index}`), program, material: surface },
  }))
  renderer.drawSequence(draws, camera)
  assert.equal(count('bindTexture'), 3)
  assert.equal(count('activeTexture'), 1) // unit 0 stays active
  assert.equal(count('bindSampler'), 2) // the shared sampler once, and the restore
})

it('shares one sampler object between leases with equal sampling and deletes it on release', () => {
  const { gl, count } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  // A per-frame material lease (new program object, same shader) samples like the previous one.
  renderer.draw({ primitive: mesh('a'), program: { ...source }, material }, camera)
  renderer.sweep()
  renderer.draw({ primitive: mesh('a'), program: { ...source }, material }, camera)
  renderer.sweep()
  assert.equal(count('createSampler'), 1)
  assert.equal(count('deleteSampler'), 0)
  renderer.release()
  assert.equal(count('deleteSampler'), 1)
})

it('takes each lease texture by its texture object, so equal ids of different sizes stay apart', () => {
  const { gl, boundTextures } = context()
  // One texture path, reduced differently for two models.
  const large = { id: 'albedo.png', width: 256, height: 256 }
  const small = { id: 'albedo.png', width: 128, height: 128 }
  const handles = new Map([
    [large, { name: 'large' }],
    [small, { name: 'small' }],
  ])
  const renderer = materialWebGlDraws(gl, texture => handles.get(texture), { checkEachDraw: false })
  for (const [id, texture] of [
    ['a', large],
    ['b', small],
  ])
    renderer.draw(
      { primitive: mesh(id), program: { ...source }, material: { textures: new Map([['albedo', texture]]) } },
      camera,
    )
  assert.deepEqual(
    boundTextures.map(texture => texture.name),
    ['large', 'small'],
  )
})

it('deletes a linked program once no lease draws with it', () => {
  const { gl, count } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  const other = { ...source, fragmentSource: `${source.fragmentSource}\n// another shader` }
  renderer.draw({ primitive: mesh('a'), program: source, material }, camera)
  renderer.draw({ primitive: mesh('b'), program: other, material }, camera)
  renderer.sweep()
  assert.equal(count('deleteProgram'), 0)
  // The next frame draws only the first material: the other program has no lease left.
  renderer.draw({ primitive: mesh('a'), program: source, material }, camera)
  renderer.sweep()
  assert.equal(count('deleteProgram'), 1)
  renderer.draw({ primitive: mesh('a'), program: source, material }, camera)
  renderer.sweep()
  assert.equal(count('deleteProgram'), 1)
  assert.equal(count('createProgram'), 2)
})

it('builds the final shader sources of a compiled variant once for all its samples', () => {
  const defines = { uvSetCount: 1 }
  const first = leaseShaderSources({ ...source, defines }, material)
  // Another sample of the same template: a new program object with the same variant.
  const sampled = { ...source, defines, uniforms: { u_specularity: 0.7 } }
  assert.equal(leaseShaderSources(sampled, material), first)
  // What the sources read beyond the variant keeps its own: two sides, blending, texture filters.
  assert.notEqual(leaseShaderSources({ ...source, defines, twoSided: true }, material), first)
  assert.notEqual(leaseShaderSources({ ...source, defines, blend: 'add' }, material), first)
  const nearest = { textures: new Map([['albedo', { id: 'albedo.png', filter: 'nearest' }]]) }
  const filtered = leaseShaderSources({ ...source, defines }, nearest)
  assert.notEqual(filtered, first)
  assert.match(filtered.fragmentSource, /texelFetch/)
  // Another fragment source under the same defines object is built anew.
  const edited = { ...source, defines, fragmentSource: `${source.fragmentSource}
` }
  assert.notEqual(leaseShaderSources(edited, material), first)
  assert.equal(leaseShaderSources(sampled, material).fragmentSource, first.fragmentSource)
})

it('lights a scene-lit program with the world shadow on its own unit, per draw as its material takes it', () => {
  const lit = {
    ...source,
    fragmentSource:
      'precision highp float; uniform sampler2D u_diffuseMap; uniform vec3 u_sceneLightColor; uniform vec3 u_sceneAmbientColor;' +
      ' in vec3 v_lightDir; void main(){ vec3 normal = vec3(0.0, 0.0, 1.0); vec3 color = vec3(1.0); vec3 spec = vec3(0.0);' +
      ' float lambert = max(dot(normal, v_lightDir), 0.0);' +
      ' vec3 shaded = color * (u_sceneAmbientColor + u_sceneLightColor * lambert) + spec * u_sceneLightColor; }',
    defines: { uvSetCount: 1, sceneLighting: true },
  }
  // The key light's diffuse and highlight take the shadow; ambient and fills do not.
  const { fragmentSource, vertexSource } = leaseShaderSources(lit, material)
  assert.match(fragmentSource, /float sceneKeyShade = sceneKeyShadow\(max\(dot\(normal, v_lightDir\), 0\.0\)\);/)
  assert.match(fragmentSource, /u_sceneAmbientColor \+ sceneKeyLight \* lambert \+/)
  assert.match(fragmentSource, /spec \* \(u_sceneSpecularColor \* sceneKeyShade\);/)
  assert.match(fragmentSource, /float modkitWorldShadow\(/)
  assert.match(vertexSource, /v_sceneShadowWorld=world\.xyz;/)

  const { gl, uniforms, uploads, boundTextures } = context()
  const renderer = materialWebGlDraws(gl, new Map([['albedo.png', {}]]), { checkEachDraw: false })
  const shadowMap = { shadowMap: true }
  const light = {
    direction: [0, -1, 0],
    color: [1, 1, 1, 1],
    ambient: 0.2,
    shadow: {
      texture: shadowMap,
      viewProjection: identity,
      texelSize: [1 / 1024, 1 / 1024],
      rangeEye: [0, 0, 0],
      rangeDistance: 0,
    },
  }
  renderer.drawSequence(
    [
      { draw: { primitive: mesh('lit'), program: lit, material } },
      { draw: { primitive: mesh('unshadowed'), program: lit, material, receiveShadows: false } },
    ],
    camera,
    light,
  )
  assert.equal(uniforms.get('u_sceneShadowMap'), 14)
  assert.equal(uniforms.get('u_sceneShadowEnabled'), 1)
  assert.ok(boundTextures.includes(shadowMap))
  // the first draw takes the shadow, the second does not
  assert.equal(uploads.get('u_sceneShadowReceiver'), 2)
  assert.equal(uniforms.get('u_sceneShadowReceiver'), 0)
  // A pass without the shadow (the shadow pass draws into that map) takes the map off its unit.
  const before = boundTextures.length
  renderer.drawSequence([{ draw: { primitive: mesh('caster'), program: lit, material } }], camera, {
    direction: [0, -1, 0],
  })
  assert.equal(boundTextures[before], null)
  assert.equal(uniforms.get('u_sceneShadowEnabled'), 0)
})
