import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { revisionId } from '@modkit/sdk'

import { createCandidateWorldSceneLease } from '../../packages/host/src/maps/world-source.js'
import { createNodeInstallationProbes } from '../../packages/host/src/node/installation-probes.js'
import {
  inspectCandidateWorld,
  type CandidateWorldViewerLoadPerformance,
} from '../../packages/ui/src/world/index.js'
// @ts-expect-error The cross-repository JavaScript integration entry has no declaration artifact.
import { analyzeWarzoneMapWorkspace } from '../../../modkit-extensions-warzone/src/map-provider.js'
// @ts-expect-error The cross-repository JavaScript integration entry has no declaration artifact.
import { discoverWarzone2100Installations } from '../../../modkit-extensions-warzone/src/provider.js'
// @ts-expect-error The JavaScript archive fixture is exercised through its runtime API.
import { extractZipArchiveEntry, parseZipArchive } from '../../extensions/archives/src/zip/codec.js'
import { importPieToUvm } from '../../../modkit-extensions-warzone/src/warzone-pie/uvm/converter.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const sourceRoot = 'multiplay/maps/6c-melting'
const browserModelPath = 'components/bodies/cybd_run.pie'
const documents = ['game.map', 'ttypes.ttp', 'droid.json', 'struct.json', 'feature.json'] as const
const evidenceDirectory = join(repoRoot, '..', 'artifacts')
const screenshotPath = join(evidenceDirectory, 'warzone-6c-melting-world-webgl-real.png')
const performancePath = join(evidenceDirectory, 'warzone-6c-melting-world-webgl-performance.json')
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
  server?.closeAllConnections()
  if (server !== undefined) await new Promise<void>(resolve => server?.close(() => resolve()))
  await browser?.close()
})

describe('installed Warzone map in a real browser WebGL2 context', () => {
  it('renders 6c-Melting terrain, water and objects with retained GPU receipts', async () => {
    // The host's probes find the Store, Steam and registry installations; without them only fixed paths.
    const discovery = await discoverWarzone2100Installations(
      { gameId: 'wz2100project/warzone-2100', maxCandidates: 128 },
      createNodeInstallationProbes(),
    )
    const archivePath = discovery.installations[0]?.evidence.find(
      (item: { kind: string; found: boolean }) => item.kind === 'warzone-mp-archive' && item.found,
    )?.path
    const baseArchivePath = discovery.installations[0]?.evidence.find(
      (item: { kind: string; found: boolean }) => item.kind === 'warzone-base-archive' && item.found,
    )?.path
    if (archivePath === undefined || !existsSync(archivePath))
      throw new Error('installed Warzone mp.wz was not discovered')
    if (baseArchivePath === undefined || !existsSync(baseArchivePath))
      throw new Error('installed Warzone base.wz was not discovered')
    const archiveBytes = await readFile(archivePath)
    const archiveEntries = new Map(
      parseZipArchive(archiveBytes, 20_000)
        .filter((entry: { kind: string }) => entry.kind === 'file')
        .map((entry: { name: string }) => [entry.name.toLowerCase(), entry]),
    )
    const workspaceDocuments = await Promise.all(
      documents.map(async name => {
        const path = `${sourceRoot}/${name}`
        const entry = archiveEntries.get(path)
        if (entry === undefined) throw new Error(`${path} is absent from installed mp.wz`)
        return { path, bytes: await extractZipArchiveEntry(archiveBytes, entry) }
      }),
    )
    const baseArchiveBytes = await readFile(baseArchivePath)
    const browserModelEntry = parseZipArchive(baseArchiveBytes, 20_000).find(
      (entry: { kind: string; name: string }) =>
        entry.kind === 'file' && entry.name.toLowerCase() === browserModelPath,
    )
    if (browserModelEntry === undefined)
      throw new Error(`${browserModelPath} is absent from installed base.wz`)
    const browserModelBytes = await extractZipArchiveEntry(baseArchiveBytes, browserModelEntry)
    const browserModelDigest = createHash('sha256').update(browserModelBytes).digest('hex')
    const browserModelUvm = await importPieToUvm(browserModelBytes, {
      assetId: `warzone:${browserModelPath}`,
      subjectRevision: revisionId(`content-hash.sha256:${browserModelDigest}`),
      metersPerSourceUnit: 1,
      budget: {
        maxInputBytes: 16_777_216n,
        maxScalarBytes: 16_777_216,
        maxNodes: 100_000,
        maxDepth: 64,
        maxDiagnostics: 100,
      },
    })
    const snapshot = await analyzeWarzoneMapWorkspace({
      workspaceId: 'warzone-6c-melting-browser',
      gameId: 'wz2100project/warzone-2100',
      mapId: sourceRoot,
      snapshotId: 'warzone-6c-melting-browser-snapshot',
      documents: workspaceDocuments,
      maxDocuments: documents.length,
      maxDocumentBytes: 8_000_000,
      maxTotalBytes: 32_000_000,
      maxObjects: 100_000,
      maxRegions: 10_000,
      maxTerrainCells: 65_536,
      maxTerrainSamples: 65_536,
      maxDepth: 32,
      maxDiagnostics: 100,
      unresolvedRequirementIds: [],
      requiredRequirementIds: ['warzone-game-map', 'warzone-terrain-types'],
    })
    const lease = createCandidateWorldSceneLease(snapshot, [], 65_536)
    let worldJson: string
    let objectCount = 0
    let waterCount = 0
    let loadPerformance: CandidateWorldViewerLoadPerformance
    try {
      const preview = await inspectCandidateWorld(lease.value, {
        maxLayers: 32,
        maxItemsPerLayer: 65_536,
        maxPageItems: 1_024,
        maxModels: 1,
      })
      const originalItems = preview.layers.flatMap(layer => layer.page.items)
      const browserModelResourceId = 'installed-browser-pie-uvm'
      const modelObject = originalItems.find(item => item.facet === 'objects')
      if (modelObject?.facet !== 'objects') throw new Error('Warzone browser fixture has no object')
      const items = originalItems.map(item =>
        item === modelObject
          ? { ...item, resourceIds: [browserModelResourceId], resourceId: browserModelResourceId }
          : item,
      )
      const terrainMaterials = preview.layers.flatMap(layer => layer.layer.materials ?? [])
      const terrainWeightRasters = preview.layers.flatMap(
        layer => layer.layer.weightRasters ?? [],
      )
      const waterMaterials = preview.layers.flatMap(layer => layer.layer.waterMaterials ?? [])
      expect(items.filter(item => item.facet === 'terrain')).toHaveLength(139 * 149)
      objectCount = items.filter(item => item.facet === 'objects').length
      waterCount = items.filter(item => item.facet === 'water').length
      expect(objectCount).toBeGreaterThan(0)
      expect(waterCount).toBeGreaterThan(0)
      loadPerformance = preview.loadPerformance
      worldJson = JSON.stringify({
        items,
        terrainMaterials,
        terrainWeightRasters,
        waterMaterials,
        browserModelResourceId,
        browserModelObjectId: modelObject.objectId,
        browserModelUvm: Buffer.from(browserModelUvm.bytes).toString('base64'),
      })
    } finally {
      await lease.release()
    }

    const bundled = await build({
      stdin: {
        contents: `
          import {
            createWorldWebGlRenderer,
            DEFAULT_WORLD_WEBGL_CAMERA,
          } from './packages/scene/src/world/webgl.ts';
          import { createEmbeddedUvmWorldModelDecoder } from './packages/scene/src/world/embedded-uvm.ts';
          const canvas = document.querySelector('canvas');
          const payload = await fetch('/world.json').then(response => response.json());
          const uvmBytes = Uint8Array.from(atob(payload.browserModelUvm), value => value.charCodeAt(0));
          const decodeModel = createEmbeddedUvmWorldModelDecoder();
          const browserModel = await decodeModel({
            uri: 'uvp:///models/installed-browser-pie.uvm',
            digest: 'installed-browser-pie-uvm',
            bytes: uvmBytes,
            mediaByUri: new Map(),
          }, {
            maxBytes: 16 * 1024 * 1024,
            maxNodes: 1024,
            maxMeshes: 256,
            maxPrimitives: 512,
            maxPrimitiveBytes: 16 * 1024 * 1024,
            maxResources: 64,
            maxTextureBytes: 8 * 1024 * 1024,
            maxTextureTotalBytes: 8 * 1024 * 1024,
          });
          if (browserModel.state !== 'converted') throw new Error('installed PIE UVM did not decode');
          const animationTimesAtStart = new Map([[payload.browserModelObjectId, 0]]);
          const animationTimesAfterSeek = new Map([[payload.browserModelObjectId, 0.125]]);
          const input = {
            ...payload,
            terrainTextures: new Map(),
            models: new Map([[payload.browserModelResourceId, browserModel]]),
            animationTimes: animationTimesAtStart,
            shadows: true,
            shadowMapSize: 1024,
          };
          const renderer = createWorldWebGlRenderer(canvas);
          if (renderer === undefined) throw new Error('WebGL2 is unavailable');
          const gl = canvas.getContext('webgl2');
          let performance = renderer.stats();
          let stats;
          for (let frame = 0; frame < 7; frame++) {
            const previousGpuSamples = performance.gpuFrameSamples;
            const animationTimes = frame < 4 ? animationTimesAtStart : animationTimesAfterSeek;
            stats = renderer.draw(frame % 2 === 0
              ? { ...input, animationTimes }
              : {
                  ...input,
                  animationTimes,
                  camera: {
                    ...DEFAULT_WORLD_WEBGL_CAMERA,
                    azimuth: DEFAULT_WORLD_WEBGL_CAMERA.azimuth + 0.035,
                  },
                });
            gl.finish();
            performance = renderer.stats();
            for (let attempt = 0; attempt < 60 && performance.gpuTimerSupported &&
              performance.gpuFrameSamples === previousGpuSamples; attempt++) {
              await new Promise(resolve => requestAnimationFrame(resolve));
              performance = renderer.stats();
            }
          }
          if (stats === undefined) throw new Error('no Warzone world frame was rendered');
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let changedPixels = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset] !== 9 || pixels[offset + 1] !== 14 || pixels[offset + 2] !== 19)
              changedPixels++;
          }
          renderer.dispose();
          globalThis.warzoneWorldEvidence = {
            stats,
            performance,
            afterDispose: renderer.stats(),
            changedPixels,
            version: gl.getParameter(gl.VERSION),
            browserModel: {
              primitives: browserModel.primitives.length,
              animations: browserModel.animations?.length ?? 0,
              diagnostics: browserModel.diagnostics,
            },
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
    if (application === undefined) throw new Error('Warzone WebGL browser bundle was not emitted')
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:#091019}canvas{display:block;width:720px;height:480px}
      </style></head><body><canvas></canvas><script type="module" src="/app.js"></script></body></html>`
    server = createServer((request, response) => {
      if (request.url === '/app.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        response.end(application)
      } else if (request.url === '/world.json') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        response.end(worldJson)
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
      args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
    const page = await browser.newPage({ viewport: { width: 720, height: 480 } })
    const browserErrors: string[] = []
    page.on('pageerror', error => browserErrors.push(error.message))
    await page.goto(`http://127.0.0.1:${address.port}`)
    try {
      await page.waitForFunction(() => 'warzoneWorldEvidence' in globalThis, undefined, {
        timeout: 120_000,
      })
    } catch (error) {
      throw new Error(`${String(error)}; browser errors: ${browserErrors.join(' | ') || 'none'}`)
    }
    const evidence = await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            warzoneWorldEvidence: {
              stats: Record<string, number>
              performance: Record<string, number | boolean>
              afterDispose: Record<string, number | boolean>
              changedPixels: number
              version: string
              browserModel: {
                primitives: number
                animations: number
                diagnostics: readonly unknown[]
              }
            }
          }
        ).warzoneWorldEvidence,
    )
    expect(evidence.version).toContain('WebGL 2.0')
    expect(evidence.stats).toMatchObject({
      terrainTriangles: 138 * 148 * 2,
      waterPolygons: waterCount,
      objectInstances: objectCount,
      shadowMapSize: 1_024,
    })
    expect(evidence.stats.modelTriangles).toBeGreaterThan(0)
    expect(evidence.stats.diagnosticPlaceholders).toBeLessThan(objectCount)
    expect(evidence.browserModel.primitives).toBeGreaterThan(0)
    expect(evidence.stats.shadowCasterTriangles).toBeGreaterThanOrEqual(138 * 148 * 2)
    expect(evidence.changedPixels).toBeGreaterThan(20_000)
    expect(evidence.performance).toMatchObject({
      frames: 7,
      programCompilations: 2,
      shadowTargetAllocations: 1,
      shadowTargetReuses: 6,
      // The animation seek keeps the static terrain preparation and rebuilds only dynamic sections.
      worldPlanBuilds: 1,
      worldPlanDynamicUpdates: 1,
      worldPlanReuses: 5,
      animationSeekSamples: 1,
      cpuFrameSamples: 7,
      disposed: false,
    })
    expect(Number(evidence.performance['geometryCacheHits'])).toBeGreaterThan(0)
    expect(Number(evidence.performance['geometryBytesRetained'])).toBeGreaterThan(0)
    expect(Number(evidence.performance['cpuFrameP50Milliseconds'])).toBeGreaterThan(0)
    if (evidence.performance['gpuTimerSupported'] === true) {
      expect(Number(evidence.performance['gpuFrameSamples'])).toBe(7)
      expect(Number(evidence.performance['gpuFrameP50Milliseconds'])).toBeGreaterThan(0)
    }
    expect(evidence.afterDispose).toMatchObject({
      geometryEntries: 0,
      geometryBytesRetained: 0,
      textureEntries: 0,
      textureBytesRetained: 0,
      disposed: true,
    })
    mkdirSync(evidenceDirectory, { recursive: true })
    await page.screenshot({ path: screenshotPath })
    writeFileSync(
      performancePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          fixture: sourceRoot,
          sourceArchive: archivePath,
          modelSourceArchive: baseArchivePath,
          modelSource: browserModelPath,
          modelSourceDigest: `sha256:${browserModelDigest}`,
          browserModel: evidence.browserModel,
          viewport: { width: 720, height: 480 },
          backend: evidence.version,
          world: evidence.stats,
          load: loadPerformance,
          renderer: evidence.performance,
          afterDispose: evidence.afterDispose,
          measurement: {
            cpu: 'performance.now around complete plan/upload/draw submission',
            gpu: 'EXT_disjoint_timer_query_webgl2 TIME_ELAPSED_EXT; absent when unsupported',
            frames: 7,
          },
        },
        null,
        2,
      )}\n`,
    )
  }, 180_000)
})
