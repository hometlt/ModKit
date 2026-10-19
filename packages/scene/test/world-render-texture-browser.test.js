import assert from 'node:assert/strict'
import { it } from 'node:test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { renderWorldHeadlessFrame } from '../src/world/headless.js'
import { worldWebGlCameraFromSource } from '../src/world/webgl.js'

const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(p => p && existsSync(p))

// The same neutral fixture goes through the real CPU and WebGL world/material owners.
function fixture(graded = false) {
  const standard = source => ({ renderModel: { version: 1, standard: {
    layers: { diffuse: { slot: 'diffuse', uvSource: 0, channels: 1, op: 2, teamColorMode: 0,
      invert: false, clampResult: false, wrapX: false, wrapY: false, ...source } },
    blendMode: 0, priority: 0, specularity: 0, specMult: 1, emisMult: 1, specMode: 0,
    alphaTestThreshold: 0, twoSided: true, unshaded: true, doubleLambert: false,
    clampOutput: false, usesVertexColor: false, usesVertexAlpha: false,
  } } })
  const object = (id, resourceId, x) => ({ facet: 'objects', id: String(id), objectId: id, resourceId,
    layerId: 'objects', coordinateSpaceId: 'uvw', kind: 'doodad', position: { x, y: 0, z: 0 },
    uvwPosition: { x, y: 0, z: 0 }, uvwRotation: [0, 0, 0, 1] })
  const model = (id, parameters, textures) => ({ state: 'converted', sourceKey: id, complete: true,
    diagnostics: [], meshes: [], nodes: [], textures,
    primitives: [{ id: id + '-quad', materialId: id, topology: 'triangles',
      positions: Float32Array.of(-1,-1,0, 1,-1,0, -1,1,0, 1,-1,0, 1,1,0, -1,1,0),
      textureCoordinates: Float32Array.of(0,0, 1,0, 0,1, 1,0, 1,1, 0,1) }],
    materials: [{ id, layers: [{ slot: 'diffuse', resourceId: textures[0].id, uvSource: 0 }],
      shader: { id: 'modkit.render-material.v1', parameters } }],
  })
  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
  const cameraTransform = [...identity]; cameraTransform[14] = 3
  const rig = {
    uvmBytes: new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' },
      nodes: [{ children: [1] }, { camera: 0, translation: [0,0,3] }], cameras: [{ type: 'perspective', perspective: { yfov: 0.8, znear: 0.1, zfar: 10 } }] })),
    nodes: [{ id: 'node-0', childIds: ['node-1'], meshIds: ['source-mesh'], transform: identity,
      trs: { translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] } },
      { id: 'node-1', childIds: [], meshIds: [], transform: cameraTransform,
        trs: { translation: [0,0,3], rotation: [0,0,0,1], scale: [1,1,1] } }],
    meshes: [{ id: 'source-mesh', primitiveIds: ['source-quad'] }],
    animations: [{ id: 'stand', name: 'Stand', kind: 'animation', provenance: 'direct', frames: 2, durationSeconds: 1,
      channels: [{ target: 'node-1', kind: 'translation', firstFrame: 0, lastFrame: 1, interpolation: 'linear',
        samples: [{ frame: 0, timeSeconds: 0, value: [0,0,3] }, { frame: 1, timeSeconds: 1, value: [10,0,3] }] }] }],
  }
  const screen = model('screen', standard({ texturePath: 'fallback', renderTextureChannel: 0 }),
    [{ id: 'fallback', width: 1, height: 1, rgba: Uint8Array.of(255,255,255,255) }])
  const source = model('source', standard({ texturePath: 'bands' }),
    [{ id: 'bands', width: 2, height: 2, filter: 'nearest', rgba: Uint8Array.of(255,0,0,255,255,0,0,255,0,0,255,255,0,0,255,255) }])
  Object.assign(source, rig)
  if (graded) source.textures[0].rgba = Uint8Array.of(64,128,192,255,64,128,192,255,64,128,192,255,64,128,192,255)
  const lighting = { facet: 'lighting', id: 'light', layerId: 'light', coordinateSpaceId: 'uvw',
    ambientColor: [1,1,1], ambientIntensity: 1, directional: [],
    toneMapping: { operator: 'linear', exposure: 1, whitePoint: 1, contrast: 1, correctGamma: true,
      colorization: { inputLow: 0, inputHigh: 1, inputGamma: 1, outputLow: 0, outputHigh: 1,
        brightness: 0.7, contrast: 1, hue: 0, saturation: 0, lightness: 0, blend: 0 } } }
  const camera = { eye: [0,0,3], target: [0,0,0], up: [0,1,0], near: 0.1, far: 10, verticalFieldOfView: 0.8 }
  return { camera, input: { items: [...(graded ? [lighting] : []), object(1, 'screen', 0), object(99, 'source', 10)],
    models: new Map([['screen', screen], ['source', source]]), animationTimes: new Map([[99, 0]]),
    renderTextures: [{ id: 'render-texture:0', width: 32, height: 32, clearColor: [0,1,0,1], modelCamera: { objectId: 99, cameraIndex: 0 } }],
  } }
}

it('draws camera RTT in real WebGL, matches CPU row orientation, updates a seek and releases its target',
  { skip: executablePath === undefined ? 'Chrome/Chromium not installed' : false, timeout: 60000 }, async () => {
    const first = fixture()
    const expected = await renderWorldHeadlessFrame(first.input, { width: 64, height: 64, camera: worldWebGlCameraFromSource(first.camera) })
    const graded = fixture(true)
    const expectedGraded = await renderWorldHeadlessFrame(graded.input, { width: 64, height: 64, camera: worldWebGlCameraFromSource(graded.camera) })
    const entry = fileURLToPath(new URL('../src/world/webgl.ts', import.meta.url))
    const bundled = await build({ stdin: { contents: `import {createWorldWebGlRenderer,worldWebGlCameraFromSource} from ${JSON.stringify(entry)};
      globalThis.gpuWorld={createWorldWebGlRenderer,worldWebGlCameraFromSource}; globalThis.rttFixture=${fixture.toString()};`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
      bundle: true, write: false, platform: 'browser', format: 'iife',
      alias: { '@modkit/uv/model/validation': fileURLToPath(new URL('../../uv/src/model/validation/index.ts', import.meta.url)),
        '@modkit/sdk/maps': fileURLToPath(new URL('../../sdk/src/maps/index.ts', import.meta.url)) } })
    const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
    try {
      const page = await browser.newPage()
      await page.setContent('<canvas width="64" height="64"></canvas>')
      await page.addScriptTag({ content: bundled.outputFiles[0].text })
      const result = await page.evaluate(() => {
        const canvas = document.querySelector('canvas'), api = globalThis.gpuWorld
        const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true, stencil: true, preserveDrawingBuffer: false })
        if (!gl) throw Error('WebGL2 unavailable')
        const live = new Set(), create = gl.createFramebuffer.bind(gl), destroy = gl.deleteFramebuffer.bind(gl)
        let linkedPrograms = 0
        const createProgram = gl.createProgram.bind(gl)
        gl.createProgram = () => { linkedPrograms++; return createProgram() }
        const rttPixels = [], readPixels = gl.readPixels.bind(gl)
        gl.readPixels = (...args) => { readPixels(...args); if (args[2] === 32 && args[3] === 32) {
          const offset = (16*32+16)*4; rttPixels.push(Array.from(args[6].slice(offset,offset+4)))
        } }
        gl.createFramebuffer = () => { const f = create(); if (f) live.add(f); return f }
        gl.deleteFramebuffer = f => { live.delete(f); destroy(f) }
        const renderer = api.createWorldWebGlRenderer(canvas)
        const { input, camera } = globalThis.rttFixture()
        input.camera = api.worldWebGlCameraFromSource(camera)
        const pixels = () => { const bytes = new Uint8Array(64*64*4); gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,bytes); return bytes }
        const sample = (bytes, x, topY) => Array.from(bytes.slice(((63-topY)*64+x)*4, ((63-topY)*64+x)*4+4))
        const firstStats = renderer.draw(input)
        const a = pixels(), top = sample(a, 32, 22), bottom = sample(a, 32, 42), retained = live.size, linkedAtFirst = linkedPrograms
        input.animationTimes = new Map([[99, 0.5]])
        renderer.draw(input)
        const moved = sample(pixels(), 32, 32), reused = live.size
        input.animationTimes = new Map([[99, 0]])
        renderer.draw(input)
        const backward = pixels(), backwardTop = sample(backward, 32, 22), backwardBottom = sample(backward, 32, 42), linkedAfterSeeks = linkedPrograms
        const { renderTextures, ...ordinary } = input
        renderer.draw(ordinary)
        const fallback = sample(pixels(), 32, 32), afterOrdinary = live.size, frames = renderer.stats().frames
        const error = gl.getError()
        renderer.dispose()
        const graded = globalThis.rttFixture(true), gradedRenderer = api.createWorldWebGlRenderer(canvas)
        graded.input.camera = api.worldWebGlCameraFromSource(graded.camera)
        gradedRenderer.draw(graded.input)
        const gradedPixel = sample(pixels(), 32, 32)
        gradedRenderer.dispose()
        return { top, bottom, moved, backwardTop, backwardBottom, linkedAtFirst, linkedAfterSeeks, fallback, retained, reused, afterOrdinary, frames, error, firstStats, liveAfterDispose: live.size,
          disposedBytes: renderer.stats().knownGpuBytesRetained, gradedPixel, rttPixels, requestUnchanged: renderTextures[0].modelCamera.objectId === 99 && input.renderTextureTargets === undefined }
      })
      for (const [name, y] of [['top', 22], ['bottom', 42]]) {
        const offset = (y*64+32)*4, rgba = Array.from(expected.rgba.slice(offset, offset+4))
        for (let c=0;c<3;c++) assert.ok(Math.abs(result[name][c]-rgba[c]) < 16, `${name} channel${c}: GPU ${result[name]} CPU ${rgba}; ${JSON.stringify(result)}`)
      }
      assert.ok(result.moved[1] > 240 && result.moved[0] < 10 && result.moved[2] < 10, JSON.stringify(result))
      assert.ok(result.fallback.slice(0,3).every(c => c > 240), JSON.stringify(result))
      assert.deepEqual(result.backwardTop, result.top)
      assert.deepEqual(result.backwardBottom, result.bottom)
      assert.equal(result.linkedAfterSeeks, result.linkedAtFirst, 'RTT rebinding must reuse the linked shaders')
      assert.equal(result.retained, result.reused)
      assert.equal(result.afterOrdinary, result.retained-1)
      assert.equal(result.frames, 4)
      assert.equal(result.error, 0)
      assert.equal(result.liveAfterDispose, 0)
      assert.equal(result.disposedBytes, 0)
      assert.equal(result.requestUnchanged, true)
      const center = (32*64+32)*4
      for (let channel=0;channel<3;channel++) assert.ok(Math.abs(result.gradedPixel[channel]-expectedGraded.rgba[center+channel]) <= 2,
        `graded RTT channel${channel}: GPU ${result.gradedPixel} CPU ${Array.from(expectedGraded.rgba.slice(center,center+4))}`)
    } finally { await browser.close() }
  })
