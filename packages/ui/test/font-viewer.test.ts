/**
 * The font stage in a real browser (plan 7.26): a WOFF2 font the codec cannot draw a sheet for is set
 * in MK2's sizes from its own bytes, the reader's text replaces the sample, and the face leaves with
 * the view; bytes the browser refuses say why.
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

/** A real WOFF2 font with Cyrillic, shipped with the apps. */
const fontBytes = [...readFileSync('assets/fonts/jetbrains-mono/jetbrains-mono-cyrillic.woff2')]

let server: Server
let browser: Browser
let page: Page

interface Probe {
  mountFont(bytes: number[]): Promise<void>
  unmountFont(): Promise<void>
}

beforeAll(async () => {
  const built = await build({
    stdin: {
      contents: `
        import { createFontViewer } from './packages/ui/src/font/index.ts'
        let mounted
        globalThis.mountFont = async bytes => {
          await mounted?.unmount()
          const data = Uint8Array.from(bytes)
          const source = {
            async size() { return BigInt(data.byteLength) },
            async read(offset, length) { return data.slice(Number(offset), Number(offset) + length) },
          }
          mounted = await createFontViewer().mount({
            container: document.querySelector('#app'),
            descriptor: { revision: 'content-hash.sha256:font', operations: [], diagnostics: [] },
            slot: {
              slotId: 'font',
              kind: 'stage',
              contributionId: 'modkit.ui/font-stage',
              extensionId: 'modkit/ui',
              priority: 360,
              bindings: [{ bindingId: 'bytes', contract: 'common.view/byte-range-source', major: 1 }],
            },
            sources: { async get() { return { value: source, async release() {} } } },
            operations: { async dispose() {} },
          })
        }
        globalThis.unmountFont = async () => {
          await mounted?.unmount()
          mounted = undefined
        }
      `,
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
  if (bundle === undefined) throw new Error('font bundle was not emitted')
  // the webview's policy: fonts come from the page itself, never from a URL
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; font-src 'self'">
    </head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`
  server = createServer((request, response) => {
    const [type, body] =
      request.url === '/app.js' ? ['text/javascript', bundle] : ['text/html', html]
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
  await page.waitForFunction(() => 'mountFont' in globalThis)
})

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve => server?.close(() => resolve()))
})

describe('font stage', () => {
  it('sets the font in MK2 sizes from its own bytes, in the text the reader types', async () => {
    await page.evaluate(bytes => (globalThis as unknown as Probe).mountFont(bytes), fontBytes)
    const sizes = await page.$$eval('[data-mk-part="font.size"]', nodes =>
      nodes.map(node => node.textContent),
    )
    expect(sizes).toEqual(['12px', '16px', '20px', '28px', '40px', '56px', '80px'])
    const family = await page.$eval(
      '[data-mk-part="font.sample"]',
      node => (node as HTMLElement).style.fontFamily,
    )
    expect(family).toMatch(/modkit-font-\d+/u)
    // the face is this page's, decoded by the browser
    const loaded = (name: string) =>
      [...document.fonts].some(
        face => face.family === name.replaceAll('"', '') && face.status === 'loaded',
      )
    expect(await page.evaluate(loaded, family)).toBe(true)
    expect(
      await page.textContent('[data-mk-part="font.heading"] + [data-mk-part="font.set"]'),
    ).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz')
    await page.fill('input[aria-label="Sample text"]', 'Привет, мир')
    expect(
      await page.$$eval('[data-mk-part="font.sample"]', nodes =>
        nodes.every(node => node.textContent === 'Привет, мир'),
      ),
    ).toBe(true)
    // the face goes with the view
    await page.evaluate(() => (globalThis as unknown as Probe).unmountFont())
    expect(await page.evaluate(loaded, family)).toBe(false)
  })

  it('says why the browser refuses bytes that are not a font', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountFont([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(await page.textContent('[data-mk-part="viewer.status"]')).toMatch(/not read as a font/u)
    expect(await page.locator('[data-mk-part="font.row"]').count()).toBe(0)
  })
})
