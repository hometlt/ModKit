import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
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
          kind,
          state: 'available',
          itemCount: items.filter(item => item.facet === kind).length,
          lods: ['exact'],
          ...(kind === 'terrain'
            ? { materials: [{ materialId: 'ground', baseColorResourceId: 'ground' }] }
            : {}),
        }))
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
          async page(request: { facet: string }) {
            return {
              snapshotId: 'test',
              facet: request.facet,
              state: 'available',
              items:
                request.facet === 'layers'
                  ? layers
                  : items.filter(item => item.facet === request.facet),
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
