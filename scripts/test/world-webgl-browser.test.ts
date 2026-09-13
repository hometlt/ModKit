import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const evidenceDirectory = join(repoRoot, '..', 'artifacts')
const evidencePath = join(evidenceDirectory, 'world-webgl-browser-smoke.png')
const performanceEvidencePath = join(evidenceDirectory, 'world-webgl-browser-performance.json')
const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((value): value is string => value !== undefined)

let browser: Browser | undefined
let server: Server | undefined

afterAll(async () => {
  await browser?.close()
  if (server !== undefined) await new Promise<void>(resolve => server?.close(() => resolve()))
})

describe('common world renderer in a real browser WebGL2 context', () => {
  it('draws depth-tested terrain, water and a UVM instance and records a smoke image', async () => {
    const bundled = await build({
      stdin: {
        contents: `
          import { createWorldWebGlPlan, createWorldWebGlRenderer } from './packages/scene/src/world/webgl.ts';
          const canvas = document.querySelector('canvas');
          const terrain = Array.from({ length: 9 }, (_, index) => {
            const x = index % 3;
            const row = Math.floor(index / 3);
            const elevation = index === 4 ? 3 : 0;
            return {
              facet: 'terrain', id: 'terrain:' + index, layerId: 'terrain',
              coordinateSpaceId: 'height-grid', lod: 'exact', x, y: row,
              heightBase: elevation, heightAdjustment: 0, mask: 0,
              uvwPosition: { x, y: elevation, z: -row },
            };
          });
          const materials = terrain.map(item => ({
            facet: 'terrain-materials', id: 'material:' + item.id, layerId: 'materials',
            coordinateSpaceId: 'height-grid', lod: 'exact', x: item.x, y: item.y,
            textureIndex: 0,
            weights: item.x === 0 && item.y === 0
              ? [{ materialId: 'grass', weight: 1 }]
              : [
                  { materialId: 'grass', weight: (item.x + item.y) % 2 === 0 ? 0.8 : 0.25 },
                  { materialId: 'dirt', weight: (item.x + item.y) % 2 === 0 ? 0.2 : 0.75 },
                ],
          }));
          const input = {
            items: [
              ...terrain, ...materials,
              {
                facet: 'water', id: 'water', layerId: 'water', coordinateSpaceId: 'uvw',
                zoneId: 1, templateId: 'water', minimum: { x: 0, y: 0 }, maximum: { x: 2, y: 2 },
                materialId: 'water-surface',
                uvwMinimum: { x: 0, z: -2 }, uvwMaximum: { x: 2, z: 0 }, uvwElevation: 0.65,
              },
              {
                facet: 'objects', id: 'object', layerId: 'objects', coordinateSpaceId: 'uvw',
                kind: 'structure', objectId: 1, position: { x: 1, y: 1, z: 3 },
                uvwPosition: { x: 1, y: 3, z: -1 }, uvwRotation: [0, 0, 0, 1],
                uvwScale: { x: 0.7, y: 0.7, z: 0.7 }, resourceId: 'model',
              },
            ],
            terrainMaterials: [
              {
                materialId: 'grass',
                baseColorResourceId: 'grass.rgba',
                normalResourceId: 'grass-normal.rgba',
              },
              { materialId: 'dirt', baseColorResourceId: 'dirt.rgba' },
            ],
            terrainWeightRasters: [{
              resourceId: 'terrain-weights.rgba', width: 3, height: 3,
              materialIds: ['grass', 'dirt'], encoding: 'rgba8-unorm', normalization: 'sum',
            }],
            waterMaterials: [{
              materialId: 'water-surface', classification: 'water', shorelineMode: 'zone',
              color: [0.18, 0.33, 0.42, 0.45],
              baseColorResourceId: 'water-primary.rgba',
              secondaryColorResourceId: 'water-secondary.rgba',
              uvScale: [1 / 512, 1 / 512, 1 / 640, 1 / 640],
              scroll: [1 / 80, 1 / 40, 0, -1 / 40], colorFalloff: 0,
            }],
            terrainTextures: new Map([
              ['grass.rgba', { id: 'grass.rgba', width: 1, height: 1, rgba: Uint8Array.from([35,145,58,255]) }],
              ['grass-normal.rgba', { id: 'grass-normal.rgba', width: 1, height: 1, rgba: Uint8Array.from([128,128,255,255]) }],
              ['dirt.rgba', { id: 'dirt.rgba', width: 1, height: 1, rgba: Uint8Array.from([136,92,46,255]) }],
              ['water-primary.rgba', {
                id: 'water-primary.rgba', width: 2, height: 2,
                rgba: Uint8Array.from([
                  120,190,225,255, 75,145,205,255,
                  75,145,205,255, 120,190,225,255,
                ]), filter: 'linear',
              }],
              ['water-secondary.rgba', {
                id: 'water-secondary.rgba', width: 2, height: 2,
                rgba: Uint8Array.from([
                  255,255,255,255, 140,140,140,255,
                  140,140,140,255, 255,255,255,255,
                ]), filter: 'linear',
              }],
              ['terrain-weights.rgba', {
                id: 'terrain-weights.rgba', width: 3, height: 3,
                rgba: Uint8Array.from([
                  255,0,0,0, 192,63,0,0, 128,127,0,0,
                  192,63,0,0, 128,127,0,0, 63,192,0,0,
                  128,127,0,0, 63,192,0,0, 0,255,0,0,
                ]), filter: 'nearest', wrapU: 'clamp', wrapV: 'clamp',
              }],
            ]),
            models: new Map([['model', {
              state: 'converted', sourceKey: 'browser-fixture', diagnostics: [], complete: true,
              nodes: [{
                id: 'root', childIds: [], meshIds: ['pyramid-mesh'],
                transform: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
              }],
              meshes: [{ id: 'pyramid-mesh', primitiveIds: ['pyramid'] }], primitives: [{
                id: 'pyramid', topology: 'triangles', materialId: 'pyramid-surface', positions: Float32Array.from([
                  -1,0,-1, 1,0,-1, 0,2,0,
                  1,0,-1, 1,0,1, 0,2,0,
                  1,0,1, -1,0,1, 0,2,0,
                  -1,0,1, -1,0,-1, 0,2,0,
                ]),
                textureCoordinates: Float32Array.from([
                  0,0, 1,0, 0.5,1, 0,0, 1,0, 0.5,1,
                  0,0, 1,0, 0.5,1, 0,0, 1,0, 0.5,1,
                ]),
              }],
              skeleton: [{
                partId: 'pyramid', boneIndex: 0, boneName: 'root', provenance: 'direct',
                hierarchyId: 'skin', parentBoneIndex: null, nodeId: 'root',
                localPose: {
                  translation: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1],
                },
                inverseBindMatrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
              }],
              animations: [{
                id: 'move', name: 'Move', kind: 'animation', provenance: 'direct',
                frames: 2, durationSeconds: 1, looping: true,
                channels: [{
                  target: 'root', kind: 'translation', firstFrame: 0, lastFrame: 1,
                  interpolation: 'linear', samples: [
                    { frame: 0, timeSeconds: 0, value: [0,0,0] },
                    { frame: 1, timeSeconds: 1, value: [0.5,0,0] },
                  ],
                }],
              }],
              materials: [{
                id: 'pyramid-surface',
                alphaMode: 'mask', alphaCutoff: 0.5,
                receiveShadows: false,
                layers: [
                  { slot: 'diffuse', resourceId: 'checker.rgba', uvSource: 0 },
                  { slot: 'normal', resourceId: 'checker-normal.rgba', uvSource: 0 },
                ],
              }],
              textures: [
                {
                  id: 'checker.rgba', width: 2, height: 2,
                  rgba: Uint8Array.from([
                    240,80,30,255, 30,180,240,0,
                    30,180,240,0, 240,80,30,255,
                  ]),
                  filter: 'nearest',
                },
                {
                  id: 'checker-normal.rgba', width: 1, height: 1,
                  rgba: Uint8Array.from([128,128,255,255]),
                },
              ],
            }]]),
            animationTimes: new Map([[1, 0]]),
          };
          const plan = createWorldWebGlPlan(input);
          const renderer = createWorldWebGlRenderer(canvas);
          if (!renderer) throw new Error('retained WebGL2 renderer unavailable');
          renderer.draw({ ...input, shadows: false });
          const gl = canvas.getContext('webgl2');
          const unshadowed = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, unshadowed);
          let invalidShadowSizeRefused = false;
          try {
            renderer.draw({ ...input, shadows: true, shadowMapSize: 0 });
          } catch (error) {
            invalidShadowSizeRefused = /shadowMapSize.*positive safe integer/.test(String(error));
          }
          const stats = renderer.draw({ ...input, shadows: true, shadowMapSize: 512 });
          renderer.draw({ ...input, shadows: true, shadowMapSize: 512 });
          gl.finish();
          let retainedBeforeDispose = renderer.stats();
          for (let attempt = 0; attempt < 30 &&
            retainedBeforeDispose.gpuTimerSupported &&
            retainedBeforeDispose.gpuFrameSamples === 0; attempt++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            retainedBeforeDispose = renderer.stats();
          }
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let changedPixels = 0;
          let shadowChangedPixels = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset] !== 9 || pixels[offset + 1] !== 14 || pixels[offset + 2] !== 19) changedPixels++;
            if (
              pixels[offset] !== unshadowed[offset] ||
              pixels[offset + 1] !== unshadowed[offset + 1] ||
              pixels[offset + 2] !== unshadowed[offset + 2]
            ) shadowChangedPixels++;
          }
          renderer.draw({ ...input, selectedObjectId: 1, shadows: true, shadowMapSize: 512 });
          const afterInvalidation = renderer.stats();
          renderer.draw({
            ...input,
            selectedObjectId: 1,
            animationTimes: new Map([[1, 0.5]]),
            shadows: true,
            shadowMapSize: 512,
          });
          const afterAnimationSeek = renderer.stats();
          renderer.dispose();
          const retainedAfterDispose = renderer.stats();
          let disposedDrawRefused = false;
          try {
            renderer.draw(input);
          } catch (error) {
            disposedDrawRefused = /renderer is disposed/.test(String(error));
          }
          globalThis.worldWebGlEvidence = {
            stats,
            retainedBeforeDispose,
            afterInvalidation,
            afterAnimationSeek,
            retainedAfterDispose,
            disposedDrawRefused,
            texturedBatches: plan.texturedTriangles.length,
            transparentTexturedBatches: plan.transparentTexturedTriangles.length,
            modelNormalBatches: [
              ...plan.texturedTriangles,
              ...plan.transparentTexturedTriangles,
            ].filter(batch => batch.normalTexture).length,
            maskedBatches: plan.texturedTriangles.filter(batch => batch.alphaCutoff === 0.5).length,
            shadowOptOutReceivers: plan.texturedTriangles.filter(
              batch => batch.receiveShadows === false,
            ).length,
            splatBatches: plan.splatTriangles.length,
            splatNormalLayers: plan.splatTriangles.reduce(
              (count, batch) => count + batch.normalTextures.filter(Boolean).length,
              0,
            ),
            waterSecondaryBatches: plan.transparentTexturedTriangles.filter(
              batch => batch.secondaryTexture?.id === 'water-secondary.rgba',
            ).length,
            changedPixels,
            shadowChangedPixels,
            invalidShadowSizeRefused,
            version: gl.getParameter(gl.VERSION),
          };
        `,
        resolveDir: repoRoot,
        loader: 'ts',
      },
      absWorkingDir: repoRoot,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2023',
      write: false,
      logLevel: 'silent',
    })
    const application = bundled.outputFiles[0]?.contents
    if (application === undefined) throw new Error('world WebGL browser bundle was not emitted')
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:#091019}canvas{display:block;width:720px;height:480px}
      </style></head><body><canvas></canvas><script type="module" src="/app.js"></script></body></html>`
    server = createServer((request, response) => {
      if (request.url === '/app.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        response.end(application)
      } else {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(html)
      }
    })
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject)
      server?.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('browser server failed')
    const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
    if (executablePath === undefined) throw new Error('Chrome/Chromium is required for WebGL proof')
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--enable-webgl',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    })
    const page = await browser.newPage({ viewport: { width: 720, height: 480 } })
    const browserErrors: string[] = []
    page.on('pageerror', error => browserErrors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    await page.goto(`http://127.0.0.1:${address.port}`)
    try {
      await page.waitForFunction(() => 'worldWebGlEvidence' in globalThis)
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; browser errors: ${browserErrors.join(' | ') || 'none'}`,
      )
    }
    const evidence = await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            worldWebGlEvidence: {
              stats: Record<string, number>
              changedPixels: number
              texturedBatches: number
              transparentTexturedBatches: number
              modelNormalBatches: number
              maskedBatches: number
              shadowOptOutReceivers: number
              splatBatches: number
              splatNormalLayers: number
              waterSecondaryBatches: number
              shadowChangedPixels: number
              invalidShadowSizeRefused: boolean
              disposedDrawRefused: boolean
              retainedBeforeDispose: Record<string, number | boolean>
              afterInvalidation: Record<string, number | boolean>
              afterAnimationSeek: Record<string, number | boolean>
              retainedAfterDispose: Record<string, number | boolean>
              version: string
            }
          }
        ).worldWebGlEvidence,
    )
    expect(evidence.version).toContain('WebGL 2.0')
    expect(evidence.changedPixels).toBeGreaterThan(5_000)
    expect(evidence.texturedBatches).toBe(1)
    expect(evidence.transparentTexturedBatches).toBe(1)
    expect(evidence.modelNormalBatches).toBe(1)
    expect(evidence.maskedBatches).toBe(1)
    expect(evidence.shadowOptOutReceivers).toBe(1)
    expect(evidence.waterSecondaryBatches).toBe(1)
    expect(evidence.splatBatches).toBe(1)
    expect(evidence.splatNormalLayers).toBe(1)
    expect(evidence.shadowChangedPixels).toBeGreaterThan(50)
    expect(evidence.invalidShadowSizeRefused).toBe(true)
    expect(evidence.disposedDrawRefused).toBe(true)
    expect(evidence.retainedBeforeDispose).toMatchObject({
      frames: 3,
      programCompilations: 2,
      shadowTargetAllocations: 1,
      shadowTargetReuses: 1,
      worldPlanBuilds: 1,
      worldPlanReuses: 3,
      cpuFrameSamples: 3,
      disposed: false,
    })
    expect(Number(evidence.retainedBeforeDispose['cpuFrameP50Milliseconds'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['cpuFrameP95Milliseconds'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['geometryUploads'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['geometryCacheHits'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['geometryEntries'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['geometryBytesRetained'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['textureUploads'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['textureCacheHits'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['textureEntries'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['textureBytesRetained'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['worldPlanBytesRetained'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedBeforeDispose['shadowTargetBytesRetained'])).toBe(512 * 512 * 4)
    expect(Number(evidence.retainedBeforeDispose['knownGpuBytesRetained'])).toBeGreaterThan(
      Number(evidence.retainedBeforeDispose['geometryBytesRetained']),
    )
    expect(evidence.retainedBeforeDispose['gpuProgramBytesObservable']).toBe(false)
    if (evidence.retainedBeforeDispose['gpuTimerSupported'] === true) {
      expect(Number(evidence.retainedBeforeDispose['gpuFrameSamples'])).toBeGreaterThanOrEqual(1)
      expect(Number(evidence.retainedBeforeDispose['gpuFrameP50Milliseconds'])).toBeGreaterThan(0)
      expect(Number(evidence.retainedBeforeDispose['gpuFrameP95Milliseconds'])).toBeGreaterThan(0)
    } else {
      expect(evidence.retainedBeforeDispose['gpuFrameSamples']).toBe(0)
    }
    expect(evidence.afterInvalidation).toMatchObject({
      frames: 4,
      worldPlanBuilds: 2,
      worldPlanReuses: 3,
      disposed: false,
    })
    expect(Number(evidence.afterInvalidation['geometryDisposals'])).toBeGreaterThan(
      Number(evidence.retainedBeforeDispose['geometryDisposals']),
    )
    expect(evidence.afterAnimationSeek).toMatchObject({
      frames: 5,
      worldPlanBuilds: 3,
      worldPlanReuses: 3,
      worldPlanBuildSamples: 3,
      animationSeekSamples: 1,
      disposed: false,
    })
    expect(Number(evidence.afterAnimationSeek['worldPlanBuildP50Milliseconds'])).toBeGreaterThan(0)
    expect(Number(evidence.afterAnimationSeek['animationSeekP50Milliseconds'])).toBeGreaterThan(0)
    expect(evidence.retainedAfterDispose).toMatchObject({
      frames: 5,
      programCompilations: 2,
      shadowTargetAllocations: 1,
      shadowTargetReuses: 3,
      worldPlanBuilds: 3,
      worldPlanReuses: 3,
      geometryEntries: 0,
      geometryBytesRetained: 0,
      textureEntries: 0,
      textureBytesRetained: 0,
      worldPlanBytesRetained: 0,
      shadowTargetBytesRetained: 0,
      knownGpuBytesRetained: 0,
      gpuProgramBytesObservable: false,
      disposed: true,
    })
    expect(Number(evidence.retainedAfterDispose['geometryDisposals'])).toBeGreaterThan(0)
    expect(Number(evidence.retainedAfterDispose['textureDisposals'])).toBeGreaterThan(0)
    expect(evidence.stats).toMatchObject({
      terrainTriangles: 8,
      terrainTexturedTriangles: 8,
      waterPolygons: 1,
      objectInstances: 1,
      modelTriangles: 4,
      diagnosticPlaceholders: 0,
      shadowCasterTriangles: 12,
      shadowMapSize: 512,
    })
    mkdirSync(evidenceDirectory, { recursive: true })
    await page.screenshot({ path: evidencePath })
    writeFileSync(
      performanceEvidencePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          fixture: 'synthetic-textured-water-model',
          backend: evidence.version,
          world: evidence.stats,
          renderer: evidence.retainedBeforeDispose,
          afterInvalidation: evidence.afterInvalidation,
          afterDispose: evidence.retainedAfterDispose,
          measurement: {
            cpu: 'performance.now around complete plan/upload/draw submission',
            gpu: 'EXT_disjoint_timer_query_webgl2 TIME_ELAPSED_EXT; absent when unsupported',
          },
        },
        null,
        2,
      )}\n`,
    )
  }, 60_000)
})
