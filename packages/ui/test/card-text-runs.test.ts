/**
 * A card value its producer styled (`text-runs`, plan 5.9): colour and emphasis as the game shows
 * them, an inline icon the host draws, and a run the producer could not resolve, marked.
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

let server: Server
let browser: Browser
let page: Page

beforeAll(async () => {
  const built = await build({
    stdin: {
      contents: `import { createSubjectCard } from './packages/ui/src/card/index.ts'; globalThis.createSubjectCard = createSubjectCard;`,
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
  if (bundle === undefined) throw new Error('card bundle was not emitted')
  const css = readFileSync('packages/ui/styles/modkit-ui.css', 'utf8')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/modkit-ui.css"></head>
    <body><aside id="side" style="width:260px"></aside><script type="module" src="/app.js"></script></body></html>`
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
  await page.waitForFunction(() => 'createSubjectCard' in globalThis)
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve =>
    server === undefined ? resolve() : server.close(() => resolve()),
  )
})

describe('a styled card value', () => {
  it('draws colour, emphasis, an inline icon and an unresolved run', async () => {
    const drawn = await page.evaluate(async () => {
      const probe = globalThis as unknown as {
        createSubjectCard(document: Document, options: unknown): { root: HTMLElement }
      }
      const card = probe.createSubjectCard(document, {
        label: 'SCV',
        header: false,
        async resolveImage() {
          return { width: 2, height: 2, rgba: new Uint8Array(16).fill(200) }
        },
        sections: [
          {
            kind: 'fields',
            id: 'description',
            title: 'Description',
            expanded: true,
            fields: [
              {
                name: 'Tooltip',
                value: 'Builds structures. ?',
                runs: [
                  { text: 'Builds ', color: '#ff0000' },
                  { text: 'half ', color: '#00ff0080' },
                  { text: 'structures', bold: true },
                  { text: '', asset: 'Assets/Textures/btn-unit-terran-scv.dds' },
                  { text: '?', unresolved: 'no catalog at hand' },
                ],
              },
            ],
          },
        ],
      })
      document.querySelector('#side')?.append(card.root)
      await new Promise(resolve => setTimeout(resolve, 50))
      const value = document.querySelector('[data-mk-part="card.field-value"]')
      const spans = [...(value?.querySelectorAll(':scope > span') ?? [])] as HTMLElement[]
      const canvas = value?.querySelector(
        '[data-mk-part="card.asset-image"]',
      ) as HTMLCanvasElement | null
      const name = canvas?.nextElementSibling as HTMLElement | null
      const unresolved = value?.querySelector(
        '[data-mk-part="card.unresolved"]',
      ) as HTMLElement | null
      return {
        red: spans.find(span => span.textContent === 'Builds ')?.style.color,
        translucent: spans.find(span => span.textContent === 'half ')?.style.color,
        bold: spans.find(span => span.textContent === 'structures')?.style.fontWeight,
        icon: canvas !== null && !canvas.hidden && canvas.width === 2,
        nameShown: name === null ? 'none' : getComputedStyle(name).display,
        unresolved: unresolved?.title,
      }
    })
    expect(drawn).toEqual({
      red: 'rgb(255, 0, 0)',
      // SC2 writes a translucent colour as #rrggbbaa (blizzard 9fd8860d)
      translucent: 'rgba(0, 255, 0, 0.5)',
      bold: 'bold',
      icon: true,
      nameShown: 'none',
      unresolved: 'no catalog at hand',
    })
  })
})
