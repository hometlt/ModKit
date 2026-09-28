import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'

import { createWorldWebGlRenderer } from '../src/world/webgl.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const texture = id => ({
  id,
  width: 1,
  height: 1,
  rgba: Uint8Array.of(80, 160, 200, 255),
})

// Ground with a splat material, a textured water plane (a blended batch) and an animated actor.
function world(timeSeconds) {
  const terrain = Array.from({ length: 9 }, (_, i) => ({
    facet: 'terrain',
    id: `ground:${i}`,
    layerId: 'ground',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x: i % 3,
    y: Math.floor(i / 3),
    heightBase: 0,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x: i % 3, y: 0, z: -Math.floor(i / 3) },
  }))
  const channel = {
    target: 'root',
    kind: 'translation',
    firstFrame: 0,
    lastFrame: 1,
    interpolation: 'linear',
    samples: [
      { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
      { frame: 1, timeSeconds: 1, value: [0, 2, 0] },
    ],
  }
  const actor = {
    state: 'converted',
    sourceKey: 'actor',
    complete: true,
    diagnostics: [],
    nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1),
      },
    ],
    animations: [
      {
        id: 'stand',
        name: 'Stand',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        durationSeconds: 1,
        looping: true,
        channels: [channel],
      },
    ],
  }
  return {
    items: [
      ...terrain,
      {
        facet: 'water',
        id: 'water',
        layerId: 'water',
        coordinateSpaceId: 'uvw',
        zoneId: 0,
        templateId: 'water',
        materialId: 'water',
        minimum: { x: 0, y: 0 },
        maximum: { x: 2, y: 2 },
        uvwMinimum: { x: 0, z: -2 },
        uvwMaximum: { x: 2, z: 0 },
        uvwElevation: 0.5,
      },
      {
        facet: 'objects',
        id: 'actor',
        layerId: 'objects',
        coordinateSpaceId: 'uvw',
        kind: 'doodad',
        objectId: 1,
        resourceId: 'actor',
        position: { x: 0, y: 0, z: 0 },
        uvwPosition: { x: 0, y: 0, z: 0 },
      },
    ],
    models: new Map([['actor', actor]]),
    terrainMaterials: [{ materialId: 'ground', baseColorResourceId: 'ground.png' }],
    terrainWeightRasters: [
      {
        resourceId: 'weights',
        width: 1,
        height: 1,
        materialIds: ['ground'],
        encoding: 'rgba8-unorm',
        normalization: 'sum',
      },
    ],
    terrainTextures: new Map([
      ['ground.png', texture('ground.png')],
      ['water.png', texture('water.png')],
      ['weights', { ...texture('weights'), rgba: Uint8Array.of(255, 0, 0, 0) }],
    ]),
    waterMaterials: [
      {
        materialId: 'water',
        baseColorResourceId: 'water.png',
        scroll: [0.25, 0.5],
        shorelineMode: 'terrain-clipped',
      },
    ],
    shadows: true,
    timeSeconds,
  }
}

// A WebGL2 stand-in that keeps what a program holds: the value of each uniform (as float32 or
// int32, as the context stores it) by program, and at every draw a copy of the drawing program's
// uniforms by name. Programs are known by their shader sources, so two contexts compare.
function recordingCanvas() {
  const constants = new Map()
  const sources = new Map()
  const programs = new Map()
  const names = new Map()
  const held = new Map()
  const draws = []
  const calls = new Map()
  let current
  const target = {
    drawingBufferWidth: 64,
    drawingBufferHeight: 64,
    NO_ERROR: 0,
    FRAMEBUFFER_COMPLETE: 36053,
    shaderSource: (shader, source) => sources.set(shader, source),
    attachShader: (program, shader) =>
      programs.set(program, [...(programs.get(program) ?? []), sources.get(shader)]),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 4096,
    getError: () => 0,
    getExtension: () => null,
    isContextLost: () => false,
    checkFramebufferStatus: () => 36053,
    getUniformLocation: (_, name) => {
      const location = {}
      names.set(location, name)
      return location
    },
    getAttribLocation: () => 0,
    useProgram: program => {
      current = program
    },
  }
  const store = (name, args) => {
    const values = name.startsWith('uniformMatrix') ? args.slice(2) : args.slice(1)
    const flat = values.flatMap(value => (typeof value === 'number' ? [value] : Array.from(value)))
    const integer = /^uniform[1-4]u?iv?$/u.test(name)
    let program = held.get(current)
    if (program === undefined) held.set(current, (program = new Map()))
    program.set(
      names.get(args[0]),
      flat.map(value => (integer ? value | 0 : Math.fround(value))).join(','),
    )
  }
  const gl = new Proxy(target, {
    get(object, name) {
      if (typeof name !== 'string') return undefined
      if (/^[A-Z0-9_]+$/u.test(name) && !(name in object)) {
        if (!constants.has(name)) constants.set(name, 0x9000 + constants.size)
        return constants.get(name)
      }
      const value = object[name]
      if (name in object && typeof value !== 'function') return value
      return (...args) => {
        calls.set(name, (calls.get(name) ?? 0) + 1)
        if (name.startsWith('uniform') && args[0] !== null) store(name, args)
        if (/^draw(?:Arrays|Elements|RangeElements)(?:Instanced)?$/u.test(name))
          draws.push({
            program: (programs.get(current) ?? []).join('\n'),
            uniforms: new Map(held.get(current) ?? []),
          })
        if (value !== undefined) return value(...args)
        return name.startsWith('create') ? {} : undefined
      }
    },
  })
  return {
    canvas: { width: 64, height: 64, getContext: () => gl },
    draws,
    calls: name => calls.get(name) ?? 0,
  }
}

// What the world program's draws of the fixture sample, in order: the opaque actor, the splat
// ground, and the textured water (a blended batch that receives no shadows).
const WORLD_DRAW_FLAGS = [
  { textured: '0', splatTextured: '0', secondaryTextured: '0', shadowReceiver: '1' },
  { textured: '0', splatTextured: '1', secondaryTextured: '0', shadowReceiver: '1' },
  { textured: '1', splatTextured: '0', secondaryTextured: '1', shadowReceiver: '0' },
]
const worldDrawFlags = draws =>
  draws
    .filter(draw => draw.program.includes('uniform float splatTextured'))
    .map(draw =>
      Object.fromEntries(
        Object.keys(WORLD_DRAW_FLAGS[0]).map(name => [name, draw.uniforms.get(name)]),
      ),
    )

it('holds at every draw the uniform values it sets, also in a later frame of the renderer', () => {
  const warm = recordingCanvas()
  const renderer = createWorldWebGlRenderer(warm.canvas)
  renderer.draw(world(0))
  const firstDraws = warm.draws.length
  const firstScalars = warm.calls('uniform1f') + warm.calls('uniform1i')
  renderer.draw(world(0.5))
  const later = warm.draws.slice(firstDraws)
  const laterScalars = warm.calls('uniform1f') + warm.calls('uniform1i') - firstScalars

  const cold = recordingCanvas()
  const fresh = createWorldWebGlRenderer(cold.canvas)
  fresh.draw(world(0.5))
  // A value set for one draw and another for the next reaches both, in the first frame and later.
  assert.deepEqual(worldDrawFlags(warm.draws.slice(0, firstDraws)), WORLD_DRAW_FLAGS)
  assert.deepEqual(worldDrawFlags(cold.draws), WORLD_DRAW_FLAGS)
  assert.deepEqual(worldDrawFlags(later), WORLD_DRAW_FLAGS)
  // The same draws, and at each one the warm program holds every value the fresh renderer has
  // set by then (a uniform the fresh frame has not set yet is the warm one's earlier value).
  assert.equal(later.length, cold.draws.length)
  for (const [index, draw] of cold.draws.entries()) {
    assert.equal(later[index].program, draw.program)
    for (const [name, value] of draw.uniforms)
      assert.equal(later[index].uniforms.get(name), value, `draw ${index}, uniform ${name}`)
  }
  // The warm frame sends only what changed: fewer scalar writes than the fresh frame.
  const freshScalars = cold.calls('uniform1f') + cold.calls('uniform1i')
  assert.ok(laterScalars < freshScalars, `${laterScalars} scalar writes, fresh ${freshScalars}`)
  renderer.dispose()
  fresh.dispose()
})

it('writes the scalar uniforms of the world programs only through the held-value helpers', () => {
  // A direct write would leave the helpers' record of the program's value stale.
  const source = readFileSync(new URL('../src/world/webgl.ts', import.meta.url), 'utf8')
  assert.equal(source.match(/gl\.uniform1f\(/gu)?.length, 1)
  assert.equal(source.match(/gl\.uniform1i\(/gu)?.length, 1)
})
