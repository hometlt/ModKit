import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import {
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openNestedSubject,
  openSubject,
} from '@modkit/host'
import { loadExtensionDirectory } from '@modkit/host/node'
import { VirtualFileSystem } from '@modkit/vfs'
import { createFileVfsProvider } from '@modkit/vfs/providers/file'
import { readUvmContainer } from '@modkit/uv/model/container'

import { createCandidateWorldSceneLease } from '../../packages/host/src/maps/world-source.js'
import {
  inspectCandidateWorld,
  type CandidateWorldViewerLoadPerformance,
} from '../../packages/ui/src/world/index.js'
import { analyzeStarcraft2MapWorkspace } from '../../../modkit-extensions-blizzard/starcraft2/modules/map/providers/semantic/runtime.js'
import { discoverStarcraft2Installations } from '../../../modkit-extensions-blizzard/starcraft2/modules/game/providers/installation/provider.js'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const blizzardRoot = join(repoRoot, '..', 'modkit-extensions-blizzard')
const mapRoot = 'C:/Apps/StarCraft II/Maps/all-races-coop-maps/02-CradleOfDeath.SC2Map'
const browserModelPath =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const browserModelDigest = 'fb7680019ca7ec88aeb37591a7477c2555dd674d57f0c7486736ccb11919a436'
const evidenceDirectory = join(repoRoot, '..', 'artifacts')
const evidencePath = join(evidenceDirectory, 'sc2-cradle-world-webgl-real.png')
const modelParityEvidencePath = join(
  evidenceDirectory,
  'sc2-installed-m3-standalone-world-parity.png',
)
const performanceEvidencePath = join(evidenceDirectory, 'sc2-cradle-world-webgl-performance.json')
const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((value): value is string => value !== undefined)

let browser: Browser | undefined
let server: Server | undefined

const modelTarget = {
  environment: 'node',
  operatingSystem: 'windows',
  architecture: 'x64',
} as const
const modelGrant = { id: 'sc2-browser-m3-read', classes: ['read-source'] } as const
const modelBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 268_435_456,
  maxDiagnostics: 1_000,
}

interface BrowserModelTexture {
  readonly uri: string
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

async function exportInstalledBrowserM3(): Promise<{
  readonly uvmBytes: Uint8Array
  readonly textures: readonly BrowserModelTexture[]
}> {
  const configured = process.env['MODKITX_SC2_ROOT']?.trim()
  const discovery = await discoverStarcraft2Installations({
    gameId: 'blizzard/starcraft-2',
    maxCandidates: 128,
    ...(configured ? { configuredPaths: [configured] } : {}),
  })
  const installation = discovery.installations[0]
  if (installation === undefined) throw new Error('installed SC2 browser proof requires CASC')
  const inventory = await buildInventory(
    await Promise.all(
      [
        join(blizzardRoot, 'casc'),
        join(blizzardRoot, 'models'),
        join(repoRoot, 'extensions/images'),
      ].map(async directory => ({
        ...(await loadExtensionDirectory(directory)),
        execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
      })),
    ),
    createHostContributionContractRegistry(),
  )
  const executionBackends = createExecutionBackendRegistry([
    {
      profile: 'trusted-in-process',
      supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
      async activate(context) {
        return {
          module: (await import(context.entrypoint.href)) as Record<string, unknown>,
          release: async () => undefined,
        }
      },
    },
  ])
  const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
  const mount = await vfs.openMount(pathToFileURL(installation.normalizedPath).href)
  const casc = await openSubject({
    inventory,
    source: artifactNamespaceSourceFromVfsMount(mount),
    path: installation.normalizedPath,
    intent: 'full',
    target: modelTarget,
    grant: modelGrant,
    budget: modelBudget,
    executionBackends,
  })
  if (casc.state !== 'opened')
    throw new Error(`installed SC2 CASC did not open: ${JSON.stringify(casc.diagnostics)}`)
  try {
    const extracted = await casc.session.operations().invoke('extract-entry', {
      entryId: browserModelPath,
    })
    if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes')
      throw new Error(`installed M3 extraction failed: ${JSON.stringify(extracted)}`)
    expect(createHash('sha256').update(extracted.output.value).digest('hex')).toBe(
      browserModelDigest,
    )
    const nested = await openNestedSubject({
      parent: casc.session,
      entryId: browserModelPath,
      inventory,
      executionBackends,
      target: modelTarget,
      grant: modelGrant,
      budget: modelBudget,
      logicalRoots: [
        {
          rootId: 'liberty-campaign',
          pathPrefix: 'campaigns/liberty.sc2campaign/base.sc2assets',
        },
        {
          rootId: 'liberty-mod',
          pathPrefix: 'mods/liberty.sc2mod/base.sc2assets',
        },
      ],
    })
    if (nested.result.state !== 'opened')
      throw new Error(`installed M3 did not open: ${JSON.stringify(nested.result.diagnostics)}`)
    try {
      const converted = await nested.result.session
        .operations()
        .invoke('model-export-uvm', { schemaVersion: 1, metersPerSourceUnit: 1 })
      if (converted.state !== 'ok' || converted.output.kind !== 'bytes')
        throw new Error(`installed M3 UVM export failed: ${JSON.stringify(converted)}`)
      const images = readUvmContainer(converted.output.value).document['images']
      const imageUris = Array.isArray(images)
        ? [
            ...new Set(
              images.flatMap(image =>
                typeof image === 'object' && image !== null && typeof image['uri'] === 'string'
                  ? [image['uri']]
                  : [],
              ),
            ),
          ]
        : []
      if (imageUris.length === 0) throw new Error('installed M3 UVM carries no texture identities')
      const resources = nested.result.resources
      if (resources === undefined) throw new Error('installed M3 resource session is unavailable')
      const textures: BrowserModelTexture[] = []
      for (const uri of imageUris) {
        const resolved = await resources.resolve({
          id: `sc2-browser:${uri}`,
          logicalId: uri,
          role: 'texture',
          scopes: ['workspace-dependency-layer'],
        })
        if (resolved.state !== 'resolved' || resolved.lease.value.kind !== 'bytes')
          throw new Error(`installed M3 texture did not resolve: ${uri}`)
        try {
          const dds = await openSubject({
            inventory,
            source: resolved.lease.value,
            path: uri,
            intent: 'full',
            target: modelTarget,
            grant: modelGrant,
            budget: modelBudget,
            executionBackends,
          })
          if (dds.state !== 'opened') throw new Error(`installed M3 texture did not open: ${uri}`)
          try {
            const raster = await dds.session.dataSource('common.view/raster-image-source', 1)
            try {
              const info = await raster.value.info()
              const region = await raster.value.readRegion?.({
                x: 0,
                y: 0,
                width: info.width,
                height: info.height,
                frame: 0,
                mipLevel: 0,
                layer: 0,
                face: 0,
                slice: 0,
                pixelFormat: 'rgba8',
                maxBytes: modelBudget.maxScalarBytes,
              })
              if (region === undefined || info.orientation === 'unknown')
                throw new Error(`installed M3 texture has no normalized pixels: ${uri}`)
              const rowBytes = region.width * 4
              const rgba = new Uint8Array(rowBytes * region.height)
              for (let y = 0; y < region.height; y += 1) {
                const sourceY = info.orientation === 'bottom-left' ? region.height - 1 - y : y
                rgba.set(
                  region.pixels.subarray(
                    sourceY * region.rowStride,
                    sourceY * region.rowStride + rowBytes,
                  ),
                  y * rowBytes,
                )
              }
              textures.push({ uri, width: region.width, height: region.height, rgba })
            } finally {
              await raster.release()
            }
          } finally {
            await dds.session.dispose()
          }
        } finally {
          await resolved.lease.release()
        }
      }
      return { uvmBytes: converted.output.value, textures }
    } finally {
      await nested.result.session.dispose()
    }
  } finally {
    await casc.session.dispose()
  }
}

afterAll(async () => {
  server?.closeAllConnections()
  if (server !== undefined) await new Promise<void>(resolve => server?.close(() => resolve()))
  if (browser !== undefined) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      browser.close(),
      new Promise<void>(resolve => {
        timeout = setTimeout(resolve, 10_000)
      }),
    ])
    if (timeout !== undefined) clearTimeout(timeout)
  }
}, 30_000)

describe.skipIf(!existsSync(mapRoot))('installed SC2 map in a real browser WebGL2 context', () => {
  it('renders all CradleOfDeath height samples plus an installed M3/UVM model', async () => {
    const names = [
      'Objects',
      'Regions',
      't3HeightMap',
      't3Terrain.xml',
      't3SyncTextureInfo',
      't3TextureMasks',
      't3Water',
      't3SyncCliffLevel',
    ]
    const browserModelBundle = await exportInstalledBrowserM3()
    const browserModelUvm = browserModelBundle.uvmBytes
    const actualBrowserModelDigest = createHash('sha256').update(browserModelUvm).digest('hex')
    const snapshot = await analyzeStarcraft2MapWorkspace({
      schemaVersion: 1,
      workspaceId: 'browser-cradle-of-death',
      gameId: 'blizzard/starcraft-2',
      mapId: mapRoot,
      snapshotId: 'browser-cradle-of-death-snapshot',
      documents: names.map(path => ({
        path,
        bytes: new Uint8Array(readFileSync(`${mapRoot}/${path}`)),
      })),
      unresolvedRequirementIds: [],
      requiredRequirementIds: [],
      maxDocuments: 16,
      maxDocumentBytes: 32_000_000,
      maxTotalBytes: 64_000_000,
      maxObjects: 100_000,
      maxRegions: 10_000,
      maxTerrainCells: 4_194_304,
      maxTerrainSamples: 100_000,
      maxDepth: 128,
      maxDiagnostics: 1_000,
    })
    const lease = createCandidateWorldSceneLease(snapshot, [], 100_000)
    let worldJson: string
    let loadPerformance: CandidateWorldViewerLoadPerformance
    try {
      const preview = await inspectCandidateWorld(lease.value, {
        maxLayers: 32,
        maxItemsPerLayer: 100_000,
        maxPageItems: 1_024,
      })
      const items = preview.layers.flatMap(layer => layer.page.items)
      const browserModelResourceId = 'installed-browser-m3-uvm'
      const modelObjects = items.filter(item => item.facet === 'objects').slice(0, 2)
      if (modelObjects.length !== 2 || modelObjects.some(item => item.facet !== 'objects'))
        throw new Error('SC2 browser fixture needs two objects')
      const modelObjectIds = new Set(modelObjects.map(item => item.objectId))
      const modelItems = items.map(item =>
        item.facet === 'objects' && modelObjectIds.has(item.objectId)
          ? { ...item, resourceIds: [browserModelResourceId], resourceId: browserModelResourceId }
          : item,
      )
      const terrainMaterials = preview.layers.flatMap(layer => layer.layer.materials ?? [])
      expect(items.filter(item => item.facet === 'terrain')).toHaveLength(66_049)
      loadPerformance = preview.loadPerformance
      worldJson = JSON.stringify({
        items: modelItems,
        terrainMaterials,
        browserModelResourceId,
        browserModelObjectIds: modelObjects.map(item => item.objectId),
        browserModelUvm: Buffer.from(browserModelUvm).toString('base64'),
        browserModelMedia: browserModelBundle.textures.map(texture => {
          const bytes = new Uint8Array(8 + texture.rgba.byteLength)
          const view = new DataView(bytes.buffer)
          view.setUint32(0, texture.width, true)
          view.setUint32(4, texture.height, true)
          bytes.set(texture.rgba, 8)
          return {
            uri: texture.uri,
            bytes: Buffer.from(bytes).toString('base64'),
          }
        }),
      })
    } finally {
      await lease.release()
    }

    const bundled = await build({
      stdin: {
        contents: `
          import {
            createWorldWebGlCameraFrame,
            createWorldWebGlPlan,
            createWorldWebGlRenderer,
            DEFAULT_WORLD_WEBGL_CAMERA,
          } from './packages/scene/src/world/webgl.ts';
          import { renderBrowser } from './packages/scene/src/render/browser.ts';
          import { createEmbeddedUvmWorldModelDecoder } from './packages/scene/src/world/embedded-uvm.ts';
          const canvas = document.querySelector('canvas');
          const payload = await fetch('/world.json').then(response => response.json());
          const uvmBytes = Uint8Array.from(atob(payload.browserModelUvm), value => value.charCodeAt(0));
          const mediaByUri = new Map(payload.browserModelMedia.map(media => [media.uri, {
            bytes: Uint8Array.from(atob(media.bytes), value => value.charCodeAt(0)),
            mediaType: 'application/x-modkit-rgba8',
          }]));
          const rasterResources = {
            async read(request) {
              if (request.kind !== 'embedded' || request.mediaType !== 'application/x-modkit-rgba8')
                throw new Error('SC2 browser fixture accepts its embedded RGBA8 media only');
              const view = new DataView(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength);
              const width = view.getUint32(0, true);
              const height = view.getUint32(4, true);
              const pixels = request.bytes.slice(8);
              if (pixels.byteLength !== width * height * 4 || pixels.byteLength > request.maxBytes)
                throw new Error('SC2 browser fixture texture payload is invalid');
              return {
                state: 'decoded',
                diagnostics: [],
                info: {
                  width, height, depth: 1, layers: 1, faces: 1, mipLevels: 1, frames: 1,
                  channels: 4, bitDepth: 8, colorSpace: 'srgb', alphaMode: 'straight',
                  orientation: 'top-left', decodedAccess: true,
                },
                region: { width, height, rowStride: width * 4, pixelFormat: 'rgba8', pixels },
              };
            },
          };
          const decodeModel = createEmbeddedUvmWorldModelDecoder(rasterResources);
          const browserModel = await decodeModel({
            uri: 'uvp:///models/installed-browser-m3.uvm',
            digest: 'installed-browser-m3-uvm',
            bytes: uvmBytes,
            mediaByUri,
          }, {
            maxBytes: 16 * 1024 * 1024,
            maxNodes: 4096,
            maxMeshes: 1024,
            maxPrimitives: 4096,
            maxPrimitiveBytes: 16 * 1024 * 1024,
            maxResources: 128,
            maxTextureBytes: 8 * 1024 * 1024,
            maxTextureTotalBytes: 32 * 1024 * 1024,
          });
          if (browserModel.state !== 'converted') throw new Error('installed M3 UVM did not decode');
          const animationTimesAtStart = new Map([
            [payload.browserModelObjectIds[0], 0],
            [payload.browserModelObjectIds[1], 0.25],
          ]);
          const animationTimesAfterSeek = new Map([
            [payload.browserModelObjectIds[0], 0.125],
            [payload.browserModelObjectIds[1], 0.25],
          ]);
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
            stats = renderer.draw(frame % 2 === 0 ? { ...input, animationTimes } : {
              ...input,
              animationTimes,
              camera: {
                ...DEFAULT_WORLD_WEBGL_CAMERA,
                azimuth: DEFAULT_WORLD_WEBGL_CAMERA.azimuth + 0.04,
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
          if (stats === undefined) throw new Error('no SC2 world frame was rendered');
          const pixels = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let changedPixels = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset] !== 9 || pixels[offset + 1] !== 14 || pixels[offset + 2] !== 19) changedPixels++;
          }

          const parityObjectId = 900001;
          const parityTime = 0.125;
          const parityInput = {
            items: [{
              facet: 'objects', id: 'installed-m3-parity', layerId: 'objects',
              coordinateSpaceId: 'uvw', kind: 'unit', objectId: parityObjectId,
              position: { x: 0, y: 0, z: 0 }, uvwPosition: { x: 0, y: 0, z: 0 },
              resourceId: payload.browserModelResourceId,
            }],
            models: new Map([[payload.browserModelResourceId, browserModel]]),
            animationTimes: new Map([[parityObjectId, parityTime]]),
            shadows: false,
          };
          const parityPlan = createWorldWebGlPlan(parityInput);
          const parityMaterialScene = parityPlan.modelMaterialScenes[0];
          if (parityMaterialScene === undefined)
            throw new Error('installed M3 did not produce a common material parity scene');
          const parityCamera = createWorldWebGlCameraFrame(parityPlan, 720, 480);
          const parityLight = {
            direction: parityPlan.light.direction,
            color: [...parityPlan.light.color, 1],
            ambient: parityPlan.light.ambientIntensity,
          };
          const standalone = await renderBrowser({
            outputKind: 'rgba8', viewport: { width: 720, height: 480 },
            clearColor: [0.035, 0.055, 0.075, 1], camera: parityCamera,
            scene: {
              primitives: parityMaterialScene.primitives,
              materials: parityMaterialScene.materials,
              textures: parityMaterialScene.textures,
              materialContext: { time: parityTime, sequenceTime: parityTime },
              light: parityLight,
            },
          });
          const parityContainer = document.createElement('div');
          parityContainer.id = 'model-parity';
          parityContainer.className = 'parity';
          const panel = (title, child) => {
            const wrapper = document.createElement('section');
            const heading = document.createElement('h2');
            heading.textContent = title;
            wrapper.append(heading, child);
            parityContainer.append(wrapper);
          };
          const standaloneCanvas = document.createElement('canvas');
          standaloneCanvas.width = 720; standaloneCanvas.height = 480;
          standaloneCanvas.getContext('2d').putImageData(
            new ImageData(new Uint8ClampedArray(standalone.rgba), 720, 480), 0, 0,
          );
          const worldCanvas = document.createElement('canvas');
          const parityRenderer = createWorldWebGlRenderer(worldCanvas);
          if (parityRenderer === undefined) throw new Error('parity WebGL2 is unavailable');
          parityRenderer.draw(parityInput);
          const parityGl = worldCanvas.getContext('webgl2');
          parityGl.finish();
          const worldBottomUp = new Uint8Array(720 * 480 * 4);
          parityGl.readPixels(0, 0, 720, 480, parityGl.RGBA, parityGl.UNSIGNED_BYTE, worldBottomUp);
          const worldTopDown = new Uint8Array(worldBottomUp.length);
          for (let y = 0; y < 480; y++)
            worldTopDown.set(worldBottomUp.subarray(y * 720 * 4, (y + 1) * 720 * 4), (479 - y) * 720 * 4);
          let differingPixels = 0, absoluteDelta = 0, maxChannelDelta = 0;
          const diffPixels = new Uint8ClampedArray(worldTopDown.length);
          for (let offset = 0; offset < worldTopDown.length; offset += 4) {
            let pixelDiffers = false, pixelDelta = 0;
            for (let channel = 0; channel < 4; channel++) {
              const delta = Math.abs(worldTopDown[offset + channel] - standalone.rgba[offset + channel]);
              absoluteDelta += delta;
              maxChannelDelta = Math.max(maxChannelDelta, delta);
              pixelDelta = Math.max(pixelDelta, delta);
              if (delta > 2) pixelDiffers = true;
            }
            if (pixelDiffers) differingPixels++;
            diffPixels[offset] = Math.min(255, pixelDelta * 4);
            diffPixels[offset + 1] = 0;
            diffPixels[offset + 2] = Math.min(255, pixelDelta * 2);
            diffPixels[offset + 3] = 255;
          }
          panel('Standalone browser renderer — installed M3 @ 0.125 s', standaloneCanvas);
          panel('World material route — same M3 / camera / light / time', worldCanvas);
          const diffCanvas = document.createElement('canvas');
          diffCanvas.width = 720; diffCanvas.height = 480;
          diffCanvas.getContext('2d').putImageData(new ImageData(diffPixels, 720, 480), 0, 0);
          panel('Absolute pixel difference ×4 (black = identical)', diffCanvas);
          document.body.append(parityContainer);
          const standaloneWorldParity = {
            width: 720, height: 480, differingPixels, maxChannelDelta,
            meanAbsoluteChannelDelta: absoluteDelta / worldTopDown.length,
          };
          renderer.dispose();
          parityRenderer.dispose();
          const afterDispose = renderer.stats();
          globalThis.sc2WorldEvidence = {
            stats,
            performance,
            afterDispose,
            terrainVertices: stats.terrainTriangles * 3,
            changedPixels,
            standaloneWorldParity,
            version: gl.getParameter(gl.VERSION),
            browserModel: {
              primitives: browserModel.primitives.length,
              animations: browserModel.animations?.length ?? 0,
              diagnostics: browserModel.diagnostics,
              textures: browserModel.textures?.length ?? 0,
              complete: browserModel.complete,
              independentClocks: [
                animationTimesAfterSeek.get(payload.browserModelObjectIds[0]),
                animationTimesAfterSeek.get(payload.browserModelObjectIds[1]),
              ],
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
    if (application === undefined) throw new Error('real SC2 WebGL browser bundle was not emitted')
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;background:#091019;color:#dbe7f3;font:16px system-ui}
      body>canvas{display:block;width:960px;height:720px}
      .parity{display:grid;grid-template-columns:720px;gap:12px;padding:12px;background:#091019}
      .parity section{margin:0}.parity h2{font-size:15px;font-weight:500;margin:0 0 8px}
      .parity canvas{display:block;width:720px;height:480px}
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
      args: [
        '--no-sandbox',
        '--enable-webgl',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    })
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
    await page.goto(`http://127.0.0.1:${address.port}`)
    await page.waitForFunction(() => 'sc2WorldEvidence' in globalThis, undefined, {
      timeout: 120_000,
    })
    const evidence = await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            sc2WorldEvidence: {
              stats: Record<string, number>
              performance: Record<string, number | boolean>
              afterDispose: Record<string, number | boolean>
              terrainVertices: number
              changedPixels: number
              standaloneWorldParity: {
                width: number
                height: number
                differingPixels: number
                maxChannelDelta: number
                meanAbsoluteChannelDelta: number
              }
              version: string
              browserModel: {
                primitives: number
                animations: number
                diagnostics: readonly unknown[]
                textures: number
                complete: boolean
                independentClocks: readonly number[]
              }
            }
          }
        ).sc2WorldEvidence,
    )
    expect(evidence.version).toContain('WebGL 2.0')
    expect(evidence.terrainVertices).toBe(256 * 256 * 6)
    expect(evidence.stats.terrainTriangles).toBe(256 * 256 * 2)
    expect(evidence.stats.cliffTriangles).toBeGreaterThan(0)
    expect(evidence.stats.shadowCasterTriangles).toBeGreaterThanOrEqual(256 * 256 * 2)
    expect(evidence.stats.modelTriangles).toBeGreaterThan(0)
    expect(evidence.browserModel.primitives).toBeGreaterThan(0)
    expect(evidence.browserModel.animations).toBeGreaterThan(0)
    expect(evidence.browserModel.diagnostics).toEqual([])
    expect(evidence.browserModel.textures).toBeGreaterThan(0)
    expect(evidence.browserModel.complete).toBe(true)
    expect(evidence.browserModel.independentClocks).toEqual([0.125, 0.25])
    expect(evidence.stats.diagnosticPlaceholders).toBe(
      evidence.stats.objectInstances - evidence.browserModel.independentClocks.length,
    )
    expect(evidence.stats.shadowMapSize).toBe(1_024)
    expect(evidence.changedPixels).toBeGreaterThan(25_000)
    expect(evidence.standaloneWorldParity).toMatchObject({ width: 720, height: 480 })
    expect(evidence.standaloneWorldParity.differingPixels).toBeLessThan(15_000)
    expect(evidence.standaloneWorldParity.meanAbsoluteChannelDelta).toBeLessThan(2)
    expect(evidence.performance).toMatchObject({
      frames: 7,
      // Two world programs plus four solid/transparent M3 programs for each sampled plan.
      programCompilations: 10,
      shadowTargetAllocations: 1,
      shadowTargetReuses: 6,
      worldPlanBuilds: 2,
      worldPlanReuses: 5,
      animationSeekSamples: 1,
      cpuFrameSamples: 7,
      disposed: false,
    })
    expect(Number(evidence.performance['cpuFrameP50Milliseconds'])).toBeGreaterThan(0)
    expect(Number(evidence.performance['cpuFrameP95Milliseconds'])).toBeGreaterThan(0)
    expect(Number(evidence.performance['geometryUploads'])).toBeGreaterThan(0)
    expect(Number(evidence.performance['geometryCacheHits'])).toBeGreaterThan(0)
    expect(Number(evidence.performance['geometryEntries'])).toBeGreaterThan(0)
    expect(Number(evidence.performance['geometryBytesRetained'])).toBeGreaterThan(0)
    if (evidence.performance['gpuTimerSupported'] === true) {
      expect(Number(evidence.performance['gpuFrameSamples'])).toBe(7)
      expect(Number(evidence.performance['gpuFrameP50Milliseconds'])).toBeGreaterThan(0)
      expect(Number(evidence.performance['gpuFrameP95Milliseconds'])).toBeGreaterThan(0)
    }
    expect(evidence.afterDispose).toMatchObject({
      geometryEntries: 0,
      geometryBytesRetained: 0,
      disposed: true,
    })
    expect(Number(evidence.afterDispose['geometryDisposals'])).toBeGreaterThan(0)
    mkdirSync(evidenceDirectory, { recursive: true })
    await page.screenshot({ path: evidencePath })
    await page.locator('#model-parity').screenshot({ path: modelParityEvidencePath })
    writeFileSync(
      performanceEvidencePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          fixture: mapRoot,
          modelSource: browserModelPath,
          modelSourceDigest: `sha256:${browserModelDigest}`,
          modelUvmDigest: `sha256:${actualBrowserModelDigest}`,
          browserModel: evidence.browserModel,
          viewport: { width: 720, height: 480 },
          backend: evidence.version,
          world: evidence.stats,
          standaloneWorldParity: evidence.standaloneWorldParity,
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
