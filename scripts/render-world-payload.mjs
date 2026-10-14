#!/usr/bin/env node
// Render a saved world browser payload (world.json + world.bin) with the current Scene WebGL2 renderer.
// Payloads are written by product-route tests via MODKIT_WORLD_PAYLOAD_OUT (scripts/lib/world-payload.mjs);
// no CASC or conversion runs here.
//
//   node scripts/render-world-payload.mjs --payload <dir> --out <dir> [--cameras <file>] [--size 1280x900]
//        [--backend gpu|swiftshader] [--time 0] [--shadows 1] [--terrain-only]
//        [--benchmark 12] [--animation-step 0.25] [--lattice] [--lattice-style lattice|overview] [--geometry-only]
//
// cameras file: [{ "name": "overview", "azimuth": 0.785, "elevation": 0.52, "zoom": 1, "target": [0,0,0] }]
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const coreRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    payload: { type: 'string' },
    out: { type: 'string' },
    cameras: { type: 'string' },
    size: { type: 'string', default: '1280x900' },
    backend: { type: 'string', default: 'gpu' },
    time: { type: 'string', default: '0' },
    shadows: { type: 'string', default: '1' },
    profile: { type: 'boolean', default: false },
    'terrain-only': { type: 'boolean', default: false },
    'geometry-only': { type: 'boolean', default: false },
    lattice: { type: 'boolean', default: false },
    'lattice-style': { type: 'string' },
    'lighting-effects': { type: 'string', default: '1' },
    ssao: { type: 'string', default: '1' },
    benchmark: { type: 'string', default: '0' },
    'animation-step': { type: 'string', default: '0' },
  },
})
if (values.payload === undefined || values.out === undefined)
  throw new TypeError('--payload and --out are required')
const latticeStyle = values['lattice-style'] ?? 'lattice'
if (latticeStyle !== 'lattice' && latticeStyle !== 'overview')
  throw new TypeError('--lattice-style must be lattice or overview')
if (values['lattice-style'] !== undefined && !values.lattice)
  throw new TypeError('--lattice-style requires --lattice')
const payloadDir = resolve(values.payload)
const outDir = resolve(values.out)
const [width, height] = values.size.split('x').map(Number)
if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height))
  throw new TypeError('--size must be WxH')
const camerasPath = values.cameras ?? join(payloadDir, 'cameras.json')
const cameras = existsSync(camerasPath)
  ? JSON.parse(readFileSync(camerasPath, 'utf8').replace(/^﻿/u, ''))
  : [{ name: 'overview', azimuth: (3 * Math.PI) / 4, elevation: 0.52, zoom: 1, target: [0, 0, 0] }]
const executablePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(candidate => candidate !== undefined && existsSync(candidate))
if (executablePath === undefined) throw new Error('Chrome or Edge is required')

const bundled = await build({
  stdin: {
    contents: `
      import { createWorldWebGlRenderer } from './packages/scene/src/world/webgl.ts';
      import { createWorldLatticePlan, drawWorldLattice } from './packages/ui/src/world/lattice.ts';
      import { reviveWorldPayload } from './scripts/lib/world-payload-revive.mjs';
      const binary = await fetch('/world.bin').then(response => response.arrayBuffer());
      const payload = reviveWorldPayload(await fetch('/world.json').then(response => response.json()), binary);
      if (${values['geometry-only']}) {
        payload.models = new Map();
        payload.terrainTextures = new Map();
      }
      if (${values['terrain-only']}) payload.items = payload.items.filter(item => item.facet !== 'objects' || item.derivedFrom === 'cliffs');
      if (${values.ssao === '0'}) payload.items = payload.items.map(item => {
        if (item.facet !== 'lighting' || item.toneMapping === undefined) return item;
        const { ambientOcclusion, ...toneMapping } = item.toneMapping;
        return { ...item, toneMapping };
      });
      if (${values['lighting-effects'] === '0'}) {
        payload.items = payload.items.map(item => {
          if (item.facet === 'terrain') { const { ambientOcclusion, ...base } = item; return base; }
          if (item.facet !== 'lighting') return item;
          const { terrain, ...base } = item;
          if (base.toneMapping) { const { colorization, ambientOcclusion, correctGamma, ...mapping } = base.toneMapping; base.toneMapping = mapping; }
          base.directional = base.directional.map(({ specularColor, specularIntensity, useAmbientOcclusion, ...light }) => light);
          return base;
        });
      }
      const canvas = document.querySelector('canvas');
      if (${values.lattice}) {
        const plan = createWorldLatticePlan(payload.items, undefined, ${JSON.stringify(latticeStyle)});
        globalThis.worldRenderer = {
          glRenderer: ${JSON.stringify(latticeStyle === 'overview' ? 'Canvas2D map overview' : 'Canvas2D lattice')},
          draw() {
            const started = performance.now();
            drawWorldLattice(canvas, plan);
            return { stats: { latticeCells: plan.cells.length, contours: plan.contours.length, ...(plan.style === 'overview' ? { cliffBoundaryEdges: plan.cliffBoundaries.length } : {}), objectMarkers: plan.objects.length },
              renderer: {}, milliseconds: performance.now() - started };
          },
          async benchmark() { throw new Error('Use --benchmark 0 for lattice screenshots'); },
        };
      } else {
      const renderer = createWorldWebGlRenderer(canvas);
      if (renderer === undefined) throw new Error('WebGL2 is unavailable');
      const gl = canvas.getContext('webgl2');
      const drawCalls = { arrays: 0, elements: 0, arraysInstanced: 0, elementsInstanced: 0 };
      for (const [method, counter] of Object.entries({ drawArrays: 'arrays', drawElements: 'elements',
        drawArraysInstanced: 'arraysInstanced', drawElementsInstanced: 'elementsInstanced' })) {
        const draw = gl[method].bind(gl);
        gl[method] = (...args) => { drawCalls[counter] += 1; return draw(...args); };
      }
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      globalThis.worldRenderer = {
        glRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        draw(camera, timeSeconds, shadows) {
          const started = performance.now();
          let stats;
          for (let frame = 0; frame < 2; frame += 1)
            stats = renderer.draw({ ...payload, camera, shadows, shadowMapSize: 2048, timeSeconds });
          gl.finish();
          return { stats, renderer: renderer.stats(), drawCalls: { ...drawCalls }, milliseconds: performance.now() - started };
        },
        async benchmark(camera, timeSeconds, shadows, count, step) {
          const milliseconds = [];
          const callsPerFrame = [];
          for (let frame = 0; frame < count; frame++) {
            const beforeCalls = Object.values(drawCalls).reduce((a, b) => a + b, 0);
            const start = performance.now();
            renderer.draw({ ...payload, camera, shadows, shadowMapSize: 2048, timeSeconds: timeSeconds + frame * step });
            gl.finish();
            milliseconds.push(performance.now() - start);
            callsPerFrame.push(Object.values(drawCalls).reduce((a, b) => a + b, 0) - beforeCalls);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
          const ordered = [...milliseconds].sort((a, b) => a - b);
          const p50 = ordered[Math.floor(ordered.length / 2)];
          return { milliseconds, p50, equivalentFps: 1000 / p50, animationStepSeconds: step, callsPerFrame, drawCalls: { ...drawCalls }, renderer: renderer.stats(),
            jsHeapBytes: performance.memory?.usedJSHeapSize };
        },
      };
      }
    `,
    resolveDir: coreRoot,
    loader: 'ts',
  },
  absWorkingDir: coreRoot,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2023',
  write: false,
  logLevel: 'silent',
})
const application = bundled.outputFiles[0].contents
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#091019}canvas{display:block;width:${width}px;height:${height}px}</style></head><body><canvas width="${width}" height="${height}"></canvas><script type="module" src="/app.js"></script></body></html>`
const server = createServer((request, response) => {
  const file = { '/world.json': 'world.json', '/world.bin': 'world.bin' }[request.url]
  if (request.url === '/app.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
    response.end(application)
  } else if (file !== undefined) {
    const path = join(payloadDir, file)
    response.writeHead(200, { 'content-length': String(statSync(path).size) })
    createReadStream(path).pipe(response)
  } else {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  }
})
await new Promise((resolveListen, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolveListen)
})
const backendArgs =
  values.backend === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', ...backendArgs],
})
try {
  const page = await browser.newPage({ viewport: { width, height } })
  const startedAt = Date.now()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => 'worldRenderer' in globalThis, undefined, { timeout: 600_000 })
  const loadMilliseconds = Date.now() - startedAt
  const glRenderer = await page.evaluate(() => globalThis.worldRenderer.glRenderer)
  mkdirSync(outDir, { recursive: true })
  const frames = []
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const profiler = values.profile ? await page.context().newCDPSession(page) : undefined
  if (profiler !== undefined) {
    await profiler.send('Profiler.enable')
    await profiler.send('Profiler.setSamplingInterval', { interval: 1000 })
  }
  for (const [index, camera] of cameras.entries()) {
    const { name, ...view } = camera
    // Profile a warm frame: the first camera also pays plan build and uploads.
    const profiling = profiler !== undefined && index === Math.min(1, cameras.length - 1)
    if (profiling) await profiler.send('Profiler.start')
    const result = await page.evaluate(
      ([cameraView, timeSeconds, shadows]) =>
        globalThis.worldRenderer.draw(cameraView, timeSeconds, shadows),
      [view, Number(values.time), values.shadows !== '0'],
    )
    if (profiling) {
      const { profile } = await profiler.send('Profiler.stop')
      const self = new Map()
      const byId = new Map(profile.nodes.map(node => [node.id, node]))
      const interval =
        (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length)
      for (const id of profile.samples) {
        const frame = byId.get(id).callFrame
        const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${frame.lineNumber + 1}`
        self.set(key, (self.get(key) ?? 0) + interval)
      }
      const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)
      // Inclusive time per JS function: which of our functions the GL self-time sits under.
      const parent = new Map()
      for (const node of profile.nodes)
        for (const child of node.children ?? []) parent.set(child, node.id)
      const inclusive = new Map()
      for (const id of profile.samples) {
        const seen = new Set()
        for (let current = id; current !== undefined; current = parent.get(current)) {
          const frame = byId.get(current).callFrame
          if (!frame.url.endsWith('app.js') || !frame.functionName) continue
          const key = `${frame.functionName} app.js:${frame.lineNumber + 1}`
          if (seen.has(key)) continue
          seen.add(key)
          inclusive.set(key, (inclusive.get(key) ?? 0) + interval)
        }
      }
      const topInclusive = [...inclusive].sort((a, b) => b[1] - a[1]).slice(0, 25)
      writeFileSync(
        join(outDir, 'profile-top.json'),
        `${JSON.stringify({ self: top, inclusive: topInclusive }, null, 2)}\n`,
      )
      for (const [key, ms] of top.slice(0, 15))
        console.info(`[profile] ${Math.round(ms)} ms  ${key}`)
      for (const [key, ms] of topInclusive.slice(0, 20))
        console.info(`[profile:inclusive] ${Math.round(ms)} ms  ${key}`)
    }
    const path = join(outDir, `${name}.png`)
    await page.locator('canvas').screenshot({ path })
    frames.push({ name, camera: view, path, ...result })
    console.info(`[render-world] ${name}: ${Math.round(result.milliseconds)} ms`)
  }
  const benchmarkCount = Number(values.benchmark)
  const benchmark =
    benchmarkCount > 0
      ? await page.evaluate(
          ([camera, time, shadows, count, step]) =>
            globalThis.worldRenderer.benchmark(camera, time, shadows, count, step),
          [
            cameras[0],
            Number(values.time),
            values.shadows !== '0',
            benchmarkCount,
            Number(values['animation-step']),
          ],
        )
      : undefined
  const receipt = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    applicationSha256: createHash('sha256').update(application).digest('hex'),
    payloadJsonSha256: createHash('sha256')
      .update(readFileSync(join(payloadDir, 'world.json')))
      .digest('hex'),
    configuration: {
      timeSeconds: Number(values.time),
      animationStepSeconds: Number(values['animation-step']),
      benchmarkFrames: benchmarkCount,
      shadows: values.shadows !== '0',
      terrainOnly: values['terrain-only'] ?? false,
      geometryOnly: values['geometry-only'],
      lattice: values.lattice,
      ...(values.lattice && latticeStyle === 'overview' ? { latticeStyle } : {}),
      cameras,
    },
    payloadDir,
    glRenderer,
    backend: values.backend,
    width,
    height,
    loadMilliseconds,
    lightingEffects: values['lighting-effects'] !== '0',
    ssao: values.ssao !== '0',
    frames,
    benchmark,
    pageErrors,
  }
  writeFileSync(join(outDir, 'render-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  console.info(
    `[render-world] ${glRenderer}; load ${loadMilliseconds} ms; ${frames.length} frames -> ${outDir}`,
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  server.close()
}
