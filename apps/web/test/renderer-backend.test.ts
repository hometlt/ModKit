import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const browserModule = join(repoRoot, 'extensions', 'common', 'rendering-3d', 'src', 'browser.js')
const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((value): value is string => value !== undefined)

let browser: Browser
let server: Server
let origin = ''

beforeAll(async () => {
  const source = (await readFile(browserModule, 'utf8')).replace(
    "'@modkitx-x3/sdk/renderer'",
    "'./sdk-renderer.js'",
  )
  server = createServer((request, response) => {
    response.setHeader('content-type', 'text/javascript; charset=utf-8')
    if (request.url === '/browser.js') {
      response.end(source)
      return
    }
    if (request.url === '/sdk-renderer.js') {
      response.end("export const SCENE_RENDERER_CONTRACT = 'common.render/scene-3d'")
      return
    }
    if (request.url === '/worker.js') {
      response.end(`
        import { renderBrowser } from './browser.js'
        const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1])
        self.onmessage = async () => {
          try {
            const frame = await renderBrowser({
              scene: {
                materials: [{ id: 'red', baseColor: [1, 0, 0, 1] }],
                primitives: [{
                  id: 'browser-triangle',
                  topology: 'triangles',
                  positions: new Float32Array([-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0]),
                  indices: new Uint32Array([0, 1, 2]),
                  materialId: 'red',
                }],
              },
              camera: { viewProjection: identity },
              viewport: { width: 32, height: 32 },
              clearColor: [0, 0, 0, 1],
              outputKind: 'rgba8',
            })
            let redPixels = 0
            for (let offset = 0; offset < frame.rgba.length; offset += 4) {
              if (frame.rgba[offset] === 255 && frame.rgba[offset + 1] === 0 &&
                  frame.rgba[offset + 2] === 0 && frame.rgba[offset + 3] === 255) redPixels += 1
            }
            self.postMessage({
              outputKind: frame.outputKind,
              width: frame.width,
              height: frame.height,
              diagnostics: frame.diagnostics,
              statistics: frame.statistics,
              redPixels,
            })
          } catch (error) {
            self.postMessage({ error: error instanceof Error ? error.message : String(error) })
          }
        }
      `)
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><title>renderer worker harness</title>')
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('renderer server failed')
  origin = `http://127.0.0.1:${address.port}`
  const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
  if (executablePath === undefined) throw new Error('Chrome/Chromium is required')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
})

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(done => server?.close(() => done()))
})

describe('browser WebGL scene renderer', () => {
  it('renders typed geometry inside a real browser worker', async () => {
    const page = await browser.newPage()
    await page.goto(origin)
    const result = await page.evaluate(
      () =>
        new Promise<Record<string, unknown>>((resolveResult, reject) => {
          const worker = new Worker('/worker.js', { type: 'module' })
          worker.onerror = event => reject(new Error(event.message))
          worker.onmessage = event => {
            worker.terminate()
            resolveResult(event.data as Record<string, unknown>)
          }
          worker.postMessage('render')
        }),
    )
    expect(result).not.toHaveProperty('error')
    expect(result).toMatchObject({
      outputKind: 'rgba8',
      width: 32,
      height: 32,
      diagnostics: [],
      statistics: { primitives: 1, triangles: 1 },
    })
    const statistics = result['statistics']
    if (typeof statistics !== 'object' || statistics === null || !('fragments' in statistics)) {
      throw new Error('browser renderer returned no fragment statistics')
    }
    expect(result['redPixels']).toBe(statistics.fragments)
    expect(result['redPixels']).toEqual(expect.any(Number))
    expect(result['redPixels']).not.toBe(0)
    await page.close()
  }, 30_000)
})
