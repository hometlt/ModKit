#!/usr/bin/env node
// Render a saved world browser payload (world.json + world.bin) with the current Scene WebGL2 renderer.
// Payloads are written by product-route tests via MODKIT_WORLD_PAYLOAD_OUT; no CASC or conversion runs here.
//
//   node scripts/render-world-payload.mjs --payload <dir> --out <dir> [--cameras <file>] [--size 1280x900]
//        [--backend gpu|swiftshader] [--time 0] [--shadows 1]
//
// cameras file: [{ "name": "overview", "azimuth": 0.785, "elevation": 0.52, "zoom": 1, "target": [0,0,0] }]
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
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
  },
})
if (values.payload === undefined || values.out === undefined)
  throw new TypeError('--payload and --out are required')
const payloadDir = resolve(values.payload)
const outDir = resolve(values.out)
const [width, height] = values.size.split('x').map(Number)
if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) throw new TypeError('--size must be WxH')
const camerasPath = values.cameras ?? join(payloadDir, 'cameras.json')
const cameras = existsSync(camerasPath)
  ? JSON.parse(readFileSync(camerasPath, 'utf8'))
  : [{ name: 'overview', azimuth: Math.PI / 4, elevation: 0.52, zoom: 1, target: [0, 0, 0] }]
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
      const constructors = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
        Int32Array, Uint32Array, Float32Array, Float64Array, DataView };
      const binary = await fetch('/world.bin').then(response => response.arrayBuffer());
      const revive = value => {
        if (Array.isArray(value)) return value.map(revive);
        if (value === null || typeof value !== 'object') return value;
        if ('$bigint' in value) return BigInt(value.$bigint);
        if ('$typed' in value) {
          const Constructor = constructors[value.$typed];
          const bytes = binary.slice(value.offset, value.offset + value.byteLength);
          return Constructor === DataView ? new DataView(bytes) : new Constructor(bytes);
        }
        if ('$map' in value) return new Map(value.$map.map(([key, item]) => [revive(key), revive(item)]));
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]));
      };
      const payload = revive(await fetch('/world.json').then(response => response.json()));
      const canvas = document.querySelector('canvas');
      const renderer = createWorldWebGlRenderer(canvas);
      if (renderer === undefined) throw new Error('WebGL2 is unavailable');
      const gl = canvas.getContext('webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      globalThis.worldRenderer = {
        glRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        draw(camera, timeSeconds, shadows) {
          const started = performance.now();
          let stats;
          for (let frame = 0; frame < 2; frame += 1)
            stats = renderer.draw({ ...payload, camera, shadows, shadowMapSize: 2048, timeSeconds });
          gl.finish();
          return { stats, renderer: renderer.stats(), milliseconds: performance.now() - started };
        },
      };
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
      ([cameraView, timeSeconds, shadows]) => globalThis.worldRenderer.draw(cameraView, timeSeconds, shadows),
      [view, Number(values.time), values.shadows !== '0'],
    )
    if (profiling) {
      const { profile } = await profiler.send('Profiler.stop')
      const self = new Map()
      const byId = new Map(profile.nodes.map(node => [node.id, node]))
      const interval = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length)
      for (const id of profile.samples) {
        const frame = byId.get(id).callFrame
        const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop()}:${frame.lineNumber + 1}`
        self.set(key, (self.get(key) ?? 0) + interval)
      }
      const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)
      writeFileSync(join(outDir, 'profile-top.json'), `${JSON.stringify(top, null, 2)}\n`)
      for (const [key, ms] of top.slice(0, 15)) console.info(`[profile] ${Math.round(ms)} ms  ${key}`)
    }
    const path = join(outDir, `${name}.png`)
    await page.locator('canvas').screenshot({ path })
    frames.push({ name, camera: view, path, ...result })
    console.info(`[render-world] ${name}: ${Math.round(result.milliseconds)} ms`)
  }
  const receipt = { payloadDir, glRenderer, backend: values.backend, width, height, loadMilliseconds, frames }
  writeFileSync(join(outDir, 'render-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  console.info(`[render-world] ${glRenderer}; load ${loadMilliseconds} ms; ${frames.length} frames -> ${outDir}`)
} finally {
  await browser.close()
  server.closeAllConnections()
  server.close()
}
