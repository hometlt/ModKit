/**
 * The template stage in a viewer short and narrow enough to stack its panels (v88): each keeps its
 * own height and the viewer scrolls, so nothing is drawn over the template or the diagnostics.
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
      contents: `import { renderGameTemplatePreview } from './packages/ui/src/template/index.ts'; globalThis.renderGameTemplatePreview = renderGameTemplatePreview;`,
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
  if (bundle === undefined) throw new Error('template bundle was not emitted')
  const css = readFileSync('packages/ui/styles/modkit-ui.css', 'utf8')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/modkit-ui.css"></head>
    <body><section id="viewer" class="modkit-viewer" data-mk-part="viewer" style="height:400px"></section>
    <script type="module" src="/app.js"></script></body></html>`
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
  await page.waitForFunction(() => 'renderGameTemplatePreview' in globalThis)
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve =>
    server === undefined ? resolve() : server.close(() => resolve()),
  )
})

async function layout(width: number) {
  await page.setViewportSize({ width, height: 700 })
  return page.evaluate(() => {
    const probe = globalThis as unknown as {
      renderGameTemplatePreview(document: Document, host: HTMLElement, preview: unknown): void
    }
    const viewer = document.querySelector('#viewer') as HTMLElement
    const source = { origin: 'declaration', frame: 'Panel' }
    probe.renderGameTemplatePreview(document, viewer, {
      schemaVersion: 1,
      operationId: 'template.preview',
      templateKind: 'sc2-layout',
      entryUri: 'file:///mod/Panel.SC2Layout',
      resolvedTree: {
        name: 'Panel',
        type: 'Frame',
        path: ['Panel'],
        properties: Array.from({ length: 12 }, (_, index) => ({
          name: `Property${index}`,
          val: String(index),
          source,
        })),
        children: Array.from({ length: 8 }, (_, index) => ({
          name: `Child${index}`,
          type: 'Frame',
          path: ['Panel', `Child${index}`],
          children: [],
        })),
      },
      displayItems: [
        { kind: 'box', path: ['Panel'], rect: { x: 0, y: 0, width: 800, height: 600 } },
      ],
      diagnostics: [{ code: 'no-state-matched', message: 'StateGroup has no active state' }],
      completeness: 'partial',
      fidelity: { comparison: 'semantic', unsupported: [] },
      provenance: null,
      digest: null,
    })
    const box = (selector: string) => {
      const rect = viewer.querySelector(selector)?.getBoundingClientRect()
      return { top: rect?.top ?? Number.NaN, bottom: rect?.bottom ?? Number.NaN }
    }
    return {
      tree: box('.modkit-template__tree'),
      stage: box('.modkit-template__stage'),
      properties: box('.modkit-template__properties'),
      diagnostics: box('.modkit-template__body + .modkit-template__diagnostics'),
    }
  })
}

describe('the template stage in a short viewer', () => {
  it('stacks the tree, the drawn template and the element view without overlap', async () => {
    // a narrow window stacks the three panels (the webview of v88 was 781 px wide)
    const stacked = await layout(760)
    expect(stacked.tree.bottom).toBeLessThanOrEqual(stacked.stage.top)
    expect(stacked.stage.bottom).toBeLessThanOrEqual(stacked.properties.top)
    expect(stacked.properties.bottom).toBeLessThanOrEqual(stacked.diagnostics.top)
    // side by side, the tallest panel still ends before the diagnostics
    const wide = await layout(1200)
    expect(wide.tree.top).toBe(wide.properties.top)
    expect(
      Math.max(wide.tree.bottom, wide.stage.bottom, wide.properties.bottom),
    ).toBeLessThanOrEqual(wide.diagnostics.top)
  })
})
