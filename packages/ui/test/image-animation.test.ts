/**
 * An animated image in a real browser: the frame is an axis of its own, Play steps through the
 * frames the raster source decodes, and the edit tools say why an animation is not edited.
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
  frames: number[]
}

let server: Server
let browser: Browser
let page: Page

beforeAll(async () => {
  const built = await build({
    stdin: {
      contents: `import { createImageViewer } from './packages/ui/src/image/index.ts'; globalThis.createImageViewer = createImageViewer;`,
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
  if (bundle === undefined) throw new Error('image bundle was not emitted')
  // the package's own styles: without them the canvas and its stage grow each other without end
  const css = readFileSync('packages/ui/styles/modkit-ui.css', 'utf8')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/modkit-ui.css"></head>
    <body><main id="app" style="width:800px;height:600px"></main><script type="module" src="/app.js"></script></body></html>`
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
  page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.waitForFunction(() => 'createImageViewer' in globalThis)
  await page.evaluate(async () => {
    const frames: number[] = []
    // Three 4×4 frames, red, green and blue, so a frame is told by its pixels.
    const source = {
      async info() {
        return {
          width: 4,
          height: 4,
          depth: 1,
          layers: 1,
          faces: 1,
          mipLevels: 1,
          frames: 3,
          channels: 4,
          bitDepth: 8,
          colorSpace: 'srgb',
          alphaMode: 'straight',
          orientation: 'top-left',
          decodedAccess: true,
        }
      },
      async readRegion(request: { frame?: number; width: number; height: number }) {
        const frame = request.frame ?? 0
        frames.push(frame)
        const pixels = new Uint8Array(request.width * request.height * 4)
        for (let at = 0; at < pixels.length; at += 4) {
          pixels[at + frame] = 255
          pixels[at + 3] = 255
        }
        return { width: request.width, height: request.height, pixels }
      },
      async encoded() {
        throw new Error('decoded only')
      },
    }
    const viewer = (
      globalThis as unknown as {
        createImageViewer(options: unknown): { mount(args: unknown): Promise<unknown> }
      }
    ).createImageViewer({
      async savePixels() {
        return { state: 'saved', message: 'saved' }
      },
    })
    await viewer.mount({
      container: document.getElementById('app'),
      descriptor: { subjectUri: 'memory://spin.gif', revision: 'r1', operations: [] },
      slot: {
        slotId: 'image',
        kind: 'stage',
        contributionId: 'modkit.ui/image-stage',
        extensionId: 'modkit/ui',
        priority: 360,
        bindings: [{ bindingId: 'b', contract: 'common.view/raster-image-source', major: 1 }],
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
    })
    Object.assign(globalThis, { frames })
  })
}, 90_000)

afterAll(async () => {
  await page?.close()
  server?.closeAllConnections()
  await browser?.close()
  await new Promise(resolve => server?.close(resolve))
}, 30_000)

const decodedFrames = () => page.evaluate(() => (globalThis as unknown as Probe).frames)
const frameField = '[data-mk-part="image.subresources"] input[aria-label*="frame"]'

describe('an animated image', () => {
  it('steps and plays its frames, decoding each one by its index', async () => {
    await page.waitForSelector(frameField)
    expect(await decodedFrames()).toEqual([0])
    await page.click('[data-mk-part="image.subresources"] button[title*="Next"]')
    await page.waitForFunction(() => (globalThis as unknown as Probe).frames.includes(1))
    expect(await page.inputValue(frameField)).toBe('1')
    // Play, then stop once every frame came round: 2, then 0 again, read from the cache.
    await page.fill('[data-mk-part="image.subresources"] input[title="Frames per second"]', '60')
    await page.dispatchEvent(
      '[data-mk-part="image.subresources"] input[title="Frames per second"]',
      'change',
    )
    const play = '[data-mk-part="image.subresources"] button[title="Play the frames in turn"]'
    await page.click(play)
    await page.waitForFunction(() => (globalThis as unknown as Probe).frames.includes(2))
    await page.waitForFunction(
      selector => (document.querySelector(selector) as HTMLInputElement | null)?.value === '0',
      frameField,
    )
    expect(await page.getAttribute(play, 'aria-pressed')).toBe('true')
    await page.click(play)
    expect(await page.textContent(play)).toBe('▶')
    // each frame decoded once
    expect([...(await decodedFrames())].sort()).toEqual([0, 1, 2])
  })

  it('stops at the last frame when Loop is off', async () => {
    await page.uncheck('[data-mk-part="image.subresources"] label input[type="checkbox"]')
    await page.click('[data-mk-part="image.subresources"] button[title="Play the frames in turn"]')
    await page.waitForFunction(
      selector => (document.querySelector(selector) as HTMLInputElement | null)?.value === '2',
      frameField,
    )
    await page.waitForFunction(
      () =>
        document
          .querySelector(
            '[data-mk-part="image.subresources"] button[title="Play the frames in turn"]',
          )
          ?.getAttribute('aria-pressed') !== 'true',
    )
    expect(await page.inputValue(frameField)).toBe('2')
  })

  it('offers no edit tools that would save one frame over the animation', async () => {
    expect(await page.textContent('[data-section-id="edit"]')).toContain(
      'would keep one of the 3 frames',
    )
  })
})
