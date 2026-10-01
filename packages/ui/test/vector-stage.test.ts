/**
 * The vector stage in a real browser: its facts, Fit, wheel zoom and a double click back, the size
 * and zoom in the host status bar, and a PNG export at twice the drawing's size.
 */
import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((value): value is string => value !== undefined)

interface Probe {
  statusItems: { id: string; text: string }[]
  exported: { name: string; mediaType: string; bytes: number[] }[]
}

let server: Server
let browser: Browser
let page: Page

beforeAll(async () => {
  const built = await build({
    stdin: {
      contents: `import { createVectorViewer } from './packages/ui/src/vector/index.ts'; globalThis.createVectorViewer = createVectorViewer;`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    write: false,
    logLevel: 'silent',
  })
  const bundle = built.outputFiles[0]?.contents
  if (bundle === undefined) throw new Error('vector bundle was not emitted')
  const css = readFileSync('packages/ui/styles/modkit-ui.css', 'utf8')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/modkit-ui.css"></head>
    <body><main id="app" style="width:900px;height:600px"></main><script type="module" src="/app.js"></script></body></html>`
  server = createServer((request, response) => {
    const [type, body] =
      request.url === '/app.js'
        ? ['text/javascript', bundle]
        : request.url === '/modkit-ui.css'
          ? ['text/css', css]
          : ['text/html', html]
    response.writeHead(200, { 'content-type': `${type}; charset=utf-8` })
    response.end(body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server failed')
  const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
  if (executablePath === undefined) throw new Error('Chrome/Chromium is required')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.waitForFunction(() => 'createVectorViewer' in globalThis)
  await page.evaluate(async () => {
    const statusItems: { id: string; text: string }[] = []
    const exported: { name: string; mediaType: string; bytes: number[] }[] = []
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20">' +
      '<rect x="0" y="0" width="20" height="20" fill="#ff0000"/></svg>'
    const source = {
      async info() {
        return {
          width: 40,
          height: 20,
          viewBox: [0, 0, 40, 20],
          nodes: 2,
          paths: 0,
          shapes: 1,
          textNodes: 0,
          gradients: 0,
        }
      },
      async document() {
        return { mediaType: 'image/svg+xml', profile: 'uvg.secure-static.v1', text: svg }
      },
    }
    const viewer = (
      globalThis as unknown as {
        createVectorViewer(options: unknown): { mount(args: unknown): Promise<unknown> }
      }
    ).createVectorViewer({
      async exportBytes(files: { name: string; mediaType: string; bytes: Uint8Array }[]) {
        for (const file of files) {
          exported.push({ name: file.name, mediaType: file.mediaType, bytes: [...file.bytes] })
        }
        return { state: 'written', names: files.map(file => file.name) }
      },
      exportBaseName: () => 'badge',
    })
    await viewer.mount({
      container: document.getElementById('app'),
      descriptor: { subjectUri: 'memory://badge.svg', revision: 'r1', operations: [] },
      slot: {
        slotId: 'vector',
        kind: 'stage',
        contributionId: 'modkit.ui/vector-stage',
        extensionId: 'modkit/ui',
        priority: 340,
        bindings: [{ bindingId: 'b', contract: 'common.view/vector-scene-source', major: 1 }],
      },
      sources: {
        async get() {
          return { value: source, release: async () => undefined }
        },
      },
      operations: {
        async invoke() {
          return { state: 'refused', reason: 'none' }
        },
      },
      status: {
        set(items: { id: string; text: string }[]) {
          statusItems.splice(
            0,
            status.length,
            ...items.map(item => ({ id: item.id, text: item.text })),
          )
        },
        clear() {
          statusItems.splice(0, status.length)
        },
      },
    })
    Object.assign(globalThis, { statusItems, exported })
  })
}, 90_000)

afterAll(async () => {
  await page?.close()
  server?.closeAllConnections()
  await browser?.close()
  await new Promise(resolve => server?.close(resolve))
}, 30_000)

const image = '[data-mk-part="vector.image"]'
const width = () => page.$eval(image, node => node.getBoundingClientRect().width)
const zoomText = () =>
  page.evaluate(
    () => (globalThis as unknown as Probe).statusItems.find(item => item.id === 'zoom')?.text,
  )

describe('the vector stage', () => {
  it('names the drawing in its facts and the status bar, and fits it to the render area', async () => {
    await page.waitForSelector('[data-section-id="vector"] dl')
    const facts = await page.textContent('[data-section-id="vector"]')
    expect(facts).toContain('40 × 20')
    expect(facts).toContain('0 0 40 20')
    const status = await page.evaluate(() => (globalThis as unknown as Probe).statusItems)
    expect(status.find(item => item.id === 'size')?.text).toBe('40 × 20')
    expect(status.find(item => item.id === 'viewbox')?.text).toBe('viewBox 0 0 40 20')
    expect(await zoomText()).toMatch(/^Fit \(\d+%\)$/u)
    // a vector is enlarged to fit: 40 × 20 drawn far larger than its own size
    expect(await width()).toBeGreaterThan(200)
  })

  it('zooms with the wheel about the pointer and goes back to Fit on a double click', async () => {
    const fitted = await width()
    const box = await page.$eval('[data-mk-part="vector"]', node => {
      const rect = node.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    await page.mouse.move(box.x, box.y)
    await page.mouse.wheel(0, -100)
    await page.waitForFunction(
      before =>
        (document.querySelector('[data-mk-part="vector.image"]')?.getBoundingClientRect().width ??
          0) > before,
      fitted,
    )
    expect(await zoomText()).toMatch(/^\d+%$/u)
    await page.mouse.dblclick(box.x, box.y)
    await page.waitForFunction(
      before =>
        Math.abs(
          (document.querySelector('[data-mk-part="vector.image"]')?.getBoundingClientRect().width ??
            0) - before,
        ) < 1,
      fitted,
    )
    expect(await zoomText()).toMatch(/^Fit/u)
  })

  it('exports the drawing as a PNG at the chosen scale through the host writer', async () => {
    await page.selectOption('[data-section-id="export"] select', '2')
    await page.click('[data-section-id="export"] [data-mk-part="operations.button"]')
    await page.waitForFunction(() => (globalThis as unknown as Probe).exported.length === 1)
    const [file] = await page.evaluate(() => (globalThis as unknown as Probe).exported)
    expect(file?.name).toBe('badge@2x.png')
    expect(file?.mediaType).toBe('image/png')
    const bytes = Uint8Array.from(file?.bytes ?? [])
    // the PNG signature, then IHDR's width and height: twice 40 × 20
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(bytes.buffer)
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([80, 40])
    expect(
      await page.textContent('[data-section-id="export"] [data-mk-part="viewer.status"]'),
    ).toContain('badge@2x.png')
  })
})
