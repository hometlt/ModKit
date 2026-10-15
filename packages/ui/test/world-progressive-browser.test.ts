import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { describe, expect, it } from 'vitest'

interface BrowserFixture {
  createWorldViewer(options: { initialView: string }): {
    mount(args: unknown): Promise<BrowserFixture['mount']>
  }
  calls: string[]
  finishTexture(): void
  mount: { unmount(): Promise<void> }
  mountPreview(): Promise<BrowserFixture['mount']>
}

const executablePath = [
  process.env['CHROME_PATH'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
].find(path => path !== undefined && existsSync(path))

interface FrameFixture {
  inputs: { time: number; objectIds: number[]; sourceEye?: number[] }[]
  aborted: number[]
  requested: number[]
  pages: number
  releases: number
  emit(time: number): void
  finish(time: number): void
  refine(): void
  mount: { unmount(): Promise<void> }
}

describe.runIf(executablePath !== undefined)('transport samples in the mounted world viewer', () => {
  it('keeps the latest seek, selects source camera explicitly and cancels samples on close without reloading resources', async () => {
    const sceneEntry = createRequire(import.meta.url).resolve('@modkit/scene/world').replaceAll('\\', '/')
    const built = await build({
      stdin: { contents: `import {createWorldViewer} from './packages/ui/src/world/index.ts'; globalThis.createWorldViewer=createWorldViewer;`, resolveDir: process.cwd() },
      bundle: true, write: false, platform: 'browser', format: 'iife',
      plugins: [{ name: 'observe-world-boundary', setup(build) {
        build.onResolve({ filter: /^@modkit\/scene\/world$/ }, () => ({ path: 'frame-renderer', namespace: 'fixture' }))
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', resolveDir: process.cwd(), contents: `
          export * from ${JSON.stringify(sceneEntry)};
          export function createWorldWebGlRenderer(){return {draw(input){
            globalThis.frameFixture.inputs.push({time:input.timeSeconds,objectIds:input.items.filter(i=>i.facet==='objects').map(i=>i.objectId),sourceEye:input.camera?.source?.eye});
            return {modelTriangles:0,diagnosticPlaceholders:0};
          },dispose(){}};}
        ` }))
      } }],
    })
    const browser = await chromium.launch({ ...(executablePath === undefined ? {} : { executablePath }), headless: true })
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.setContent('<div id="root" style="width:800px;height:600px"></div>')
      await page.addScriptTag({ content: built.outputFiles[0]!.text })
      await page.evaluate(async () => {
        const state = { inputs: [], aborted: [], requested: [], pages: 0, releases: 0, emit: undefined, finish: undefined, mount: undefined } as unknown as FrameFixture
        ;(globalThis as unknown as { frameFixture: FrameFixture }).frameFixture = state
        const object = (id: number) => ({ facet: 'objects', id: `object:${id}`, objectId: id, layerId: 'objects', kind: 'doodad', coordinateSpaceId: 'native', position: { x: id, y: 0, z: 0 } })
        const info = { contract: 'common.view/world-scene-source', major: 1, maturity: 'publisher-candidate', snapshotId: 'scene', mapId: 'scene', coordinateSpaces: [{ id: 'native', horizontalAxes: ['x','z'], verticalAxis: 'y', handedness: 'right', linearUnit: 'unit', rotationUnit: 'radian', origin: 'scene' }], crossSpaceTransforms: [], bounds: [], facets: [{ facet: 'objects', layerId: 'objects', state: 'available', itemCount: 1, lods: ['exact'] }], provenance: [], unknownFacets: [], lossPolicy: 'explicit-partial', complete: true }
        let snapshotId = 'scene'
        const sample = (timeMs: number) => {
          const objectId = timeMs + (snapshotId === 'scene' ? 0 : 10000)
          return { snapshotId, timeMs, objects: [object(objectId)], diagnostics: [], complete: true, animationTimes: [{ objectId, seconds: timeMs / 2000 }], ...(timeMs === 3500 ? {} : { camera: { eye: [timeMs, 2, 6], target: [timeMs, 0, 0], up: [0,1,0], near: .01, far: 100, verticalFieldOfView: 1 } }) }
        }
        const pending = new Map<number, (value: ReturnType<typeof sample>) => void>()
        let finishRefined: ((refined: boolean) => void) | undefined
        const world = { info: async () => ({ ...info, snapshotId }), page: async (request: { facet: string }) => {
          state.pages++; return { snapshotId, facet: request.facet, state: 'available', items: request.facet === 'layers' ? [{ facet: 'layers', id: 'objects', layerId: 'objects', kind: 'objects', state: 'available', itemCount: 1, lods: ['exact'] }] : [object(0)] }
        }, refined: async (signal: AbortSignal) => new Promise<boolean>(resolve => { finishRefined = resolve; signal.addEventListener('abort', () => resolve(false), { once: true }) }),
        frame: async (time: number, signal: AbortSignal) => {
          state.requested.push(time)
          if (time === 1000 || time === 2000 || time === 4000) {
            signal.addEventListener('abort', () => state.aborted.push(time), { once: true })
            return new Promise<ReturnType<typeof sample>>(resolve => pending.set(time, resolve))
          }
          return sample(time)
        } }
        let positionMs = 1000
        const snapshot = () => ({ state: 'paused', positionMs, durationMs: 5000, rate: 1, seekable: true, live: false, tracks: [], controls: {} })
        let next: ((value: number | undefined) => void) | undefined
        const transport = { snapshot: async () => snapshot(), async *events(signal: AbortSignal) {
          while (!signal.aborted) {
            const at = await new Promise<number | undefined>(resolve => { next = resolve; signal.addEventListener('abort', () => resolve(undefined), { once: true }) })
            if (at === undefined) return
            yield { kind: 'snapshot', snapshot: { ...snapshot(), positionMs: at } }
          }
        } }
        state.emit = time => { positionMs = time; next?.(time) }
        state.finish = time => pending.get(time)?.(sample(time))
        state.refine = () => { snapshotId = 'scene-refined'; finishRefined?.(true) }
        const scope = globalThis as unknown as { createWorldViewer(options: unknown): { mount(args: unknown): Promise<FrameFixture['mount']> } }
        state.mount = await scope.createWorldViewer({ initialView: '3d', animations: true }).mount({
          container: document.getElementById('root'), descriptor: { id: 'scene', revision: 'scene', formatId: 'example', operations: [], diagnostics: [] },
          slot: { slotId: 'world', kind: 'stage', contributionId: 'example', bindings: [{ bindingId: 'world', contract: 'common.view/world-scene-source', major: 1 }, { bindingId: 'transport', contract: 'common.view/transport-source', major: 1 }] },
          sources: { async get(binding: { contract: string }) { return { value: binding.contract === 'common.view/transport-source' ? transport : world, release: async () => { state.releases++ } } } },
          operations: { async invoke() {}, async dispose() {} },
        })
      })
      await page.waitForFunction(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.requested.includes(1000))
      await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.emit(1500))
      await page.waitForFunction(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.at(-1)?.time === 1.5)
      await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.finish(1000))
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.at(-1)?.objectIds)).toEqual([1500])
      const pages = await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.pages)
      await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.emit(2000))
      await page.waitForFunction(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.requested.includes(2000))
      await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.emit(3000))
      await page.waitForFunction(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.at(-1)?.time === 3)
      await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.finish(2000))
      await page.waitForTimeout(30)
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.at(-1)?.objectIds)).toEqual([3000])
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.aborted)).toContain(2000)
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.pages)).toBe(pages)
      const selector = page.locator('select:has(option[value="source"])')
      expect(await selector.inputValue()).toBe('orbit')
      await selector.selectOption('source')
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.at(-1)?.sourceEye)).toEqual([3000, 2, 6])
      await page.locator('canvas').first().dispatchEvent('wheel', { deltaY: 1 })
      expect(await selector.inputValue()).toBe('orbit')
      await selector.selectOption('source')
      await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.emit(3500))
      await page.waitForFunction(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.at(-1)?.time === 3.5)
      expect(await selector.inputValue()).toBe('orbit')
      expect(await selector.isDisabled()).toBe(true)
      await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.refine())
      await page.waitForFunction(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.at(-1)?.objectIds[0] === 13500)
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.at(-1)?.time)).toBe(3.5)
      await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.emit(4000))
      await page.waitForFunction(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.requested.includes(4000))
      const drawsBeforeClose = await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.length)
      await page.evaluate(async () => { const f = (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture; await f.mount.unmount(); f.finish(4000) })
      await page.waitForTimeout(30)
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.inputs.length)).toBe(drawsBeforeClose)
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.aborted)).toContain(4000)
      expect(await page.evaluate(() => (globalThis as unknown as { frameFixture: FrameFixture }).frameFixture.releases)).toBe(2)
      expect(errors).toEqual([])
    } finally { await browser.close() }
  }, 60_000)
})

describe.runIf(executablePath !== undefined)('progressive map render area in a browser', () => {
  it('mounts a filled lattice before assets, switches to WebGL, replaces placeholders and cancels on close', async () => {
    const built = await build({
      stdin: {
        contents: `import { createWorldViewer } from './packages/ui/src/world/index.ts'; globalThis.createWorldViewer = createWorldViewer;`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
    })
    const browser = await chromium.launch({
      ...(executablePath === undefined ? {} : { executablePath }),
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.setContent('<div id="root" style="width:1000px;height:700px"></div>')
      await page.addStyleTag({
        content: await readFile('packages/ui/styles/modkit-ui.css', 'utf8'),
      })
      const script = built.outputFiles[0]
      if (script === undefined) throw new Error('browser fixture bundle is missing')
      await page.addScriptTag({ content: script.text })
      await page.evaluate(async () => {
        const scope = globalThis as unknown as BrowserFixture
        const calls: string[] = []
        scope['calls'] = calls
        const items = [
          ...Array.from({ length: 25 }, (_, i) => ({
            facet: 'terrain',
            id: `t${i}`,
            layerId: 'terrain',
            coordinateSpaceId: 'height-grid',
            lod: 'exact',
            x: i % 5,
            y: Math.floor(i / 5),
            heightBase: (i % 5) * 0.2,
            heightAdjustment: 0,
            mask: 0,
            uvwPosition: { x: i % 5, y: (i % 5) * 0.2, z: Math.floor(i / 5) },
          })),
          {
            facet: 'objects',
            id: 'tree',
            layerId: 'objects',
            coordinateSpaceId: 'map-native',
            kind: 'doodad',
            objectId: 1,
            resourceId: 'tree',
            position: { x: 2, y: -2, z: 0 },
            uvwPosition: { x: 2, y: 0.4, z: 2 },
          },
          {
            facet: 'resources',
            id: 'tree',
            layerId: 'resources',
            kind: 'uvm',
            objectIds: [1],
            modelResource: { logicalId: 'tree' },
          },
        ]
        const layers = ['terrain', 'objects', 'resources'].map(kind => ({
          facet: 'layers',
          id: kind,
          layerId: kind,
          ...(kind === 'terrain' || kind === 'objects' ? { spaceId: 'ground' } : {}),
          kind,
          state: 'available',
          itemCount: items.filter(item => item.facet === kind).length,
          lods: ['exact'],
          ...(kind === 'terrain'
            ? { materials: [{ materialId: 'ground', baseColorResourceId: 'ground' }] }
            : {}),
        }))
        layers.push({ facet: 'layers', id: 'terrain-other', layerId: 'terrain-other', kind: 'terrain',
          spaceId: 'other', state: 'available', itemCount: 0, lods: ['exact'] } as typeof layers[number])
        const source = {
          async info() {
            return {
              contract: 'common.view/world-scene-source',
              major: 1,
              snapshotId: 'test',
              maturity: 'publisher-candidate',
              mapId: 'Progressive fixture',
              coordinateSpaces: [],
              bounds: [],
              facets: [],
              unknownFacets: [],
              provenance: [],
              complete: true,
            }
          },
          async page(request: { facet: string; layerId?: string }) {
            return {
              snapshotId: 'test',
              facet: request.facet,
              state: 'available',
              items:
                request.facet === 'layers'
                  ? layers
                  : request.layerId === 'terrain-other' ? [] : items.filter(item => item.facet === request.facet),
            }
          },
          async texture(id: string, _request: unknown, signal: AbortSignal) {
            calls.push(`texture:${id}`)
            await new Promise<void>((resolve, reject) => {
              scope['finishTexture'] = resolve
              signal.addEventListener(
                'abort',
                () => {
                  calls.push('aborted')
                  reject(signal.reason)
                },
                { once: true },
              )
            })
            return {
              state: 'decoded',
              texture: { id, width: 1, height: 1, rgba: new Uint8Array([120, 190, 80, 255]) },
              diagnostics: [],
            }
          },
          async model(id: string) {
            calls.push(`model:${id}`)
            return {
              state: 'converted',
              complete: true,
              sourceKey: id,
              meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
              primitives: [
                {
                  id: 'triangle',
                  topology: 'triangles',
                  positions: new Float32Array([-0.4, 0, 0, 0.4, 0, 0, 0, 1, 0]),
                  indices: new Uint32Array([0, 1, 2]),
                },
              ],
              diagnostics: [],
            }
          },
        }
        scope['mountPreview'] = async () =>
          scope['createWorldViewer']({ initialView: 'lattice' }).mount({
            container: document.getElementById('root'),
            descriptor: { revision: 'r1', operations: [], diagnostics: [] },
            slot: {
              slotId: 'world',
              contributionId: 'modkit.ui/world-stage',
              kind: 'stage',
              bindings: [
                { bindingId: 'world', contract: 'common.view/world-scene-source', major: 1 },
              ],
            },
            sources: {
              async get() {
                return {
                  value: source,
                  async release() {
                    calls.push('released')
                  },
                }
              },
            },
            operations: {
              async invoke() {
                return undefined
              },
              async dispose() {
                return undefined
              },
            },
          })
        scope['mount'] = await scope['mountPreview']()
      })
      await page.waitForFunction(() =>
        (globalThis as unknown as BrowserFixture).calls.includes('texture:ground'),
      )
      expect(await page.locator('[data-mk-part="media-shell"]').count()).toBe(1)
      expect(await page.locator('[data-world-renderer="lattice-2d"]').isVisible()).toBe(true)
      expect(
        await page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            '[data-world-renderer="lattice-2d"]',
          )
          return (
            canvas?.getContext('2d')?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1)
              .data[3] ?? 0
          )
        }),
      ).toBeGreaterThan(0)
      const space = page.locator('select:has(option[value="other"])')
      await space.selectOption('other')
      expect(await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-world-renderer="lattice-2d"]')!
        return canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3]
      })).toBe(0)
      await space.selectOption('ground')
      expect(await page.evaluate(() => (globalThis as unknown as BrowserFixture).calls)).toEqual([
        'texture:ground',
      ])
      await page.getByRole('button', { name: '3D preview', exact: true }).click()
      expect(await page.locator('[data-world-renderer="webgl"]').isVisible()).toBe(true)
      expect(
        await page
          .locator('[data-world-model-triangles]')
          .getAttribute('data-world-model-triangles'),
      ).toBe('0')
      await page.evaluate(() => (globalThis as unknown as BrowserFixture).finishTexture())
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-world-loading-phase]')
            ?.getAttribute('data-world-loading-phase') === 'complete',
      )
      expect(
        await page
          .locator('[data-world-model-triangles]')
          .getAttribute('data-world-model-triangles'),
      ).toBe('1')
      await page.getByRole('button', { name: 'Lattice 2D', exact: true }).click()
      expect(await page.locator('[data-world-renderer="lattice-2d"]').isVisible()).toBe(true)
      await page.evaluate(async () => {
        const scope = globalThis as unknown as BrowserFixture
        await scope.mount.unmount()
        scope.calls.length = 0
        scope.mount = await scope.mountPreview()
      })
      await page.waitForFunction(() =>
        (globalThis as unknown as BrowserFixture).calls.includes('texture:ground'),
      )
      await page.evaluate(async () => (globalThis as unknown as BrowserFixture).mount.unmount())
      expect(await page.evaluate(() => (globalThis as unknown as BrowserFixture).calls)).toEqual([
        'texture:ground',
        'aborted',
        'released',
      ])
      expect(await page.locator('[data-mk-part="media-shell"]').count()).toBe(0)
      expect(errors).toEqual([])
    } finally {
      await browser.close()
    }
  }, 60_000)
})
