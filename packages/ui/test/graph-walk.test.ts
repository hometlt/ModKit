/**
 * The relation graph viewer walking from a root (plan 5.19) in a real browser: the whole graph
 * first, then the neighbourhood of the subject's node by depth and direction, then a new root.
 */
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
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
      contents: `import { createRelationGraphViewer } from './packages/ui/src/graph/index.ts'; globalThis.createRelationGraphViewer = createRelationGraphViewer;`,
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
  if (bundle === undefined) throw new Error('graph bundle was not emitted')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
    <body><main id="app" style="width:800px;height:600px"></main><script type="module" src="/app.js"></script></body></html>`
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
  await page.waitForFunction(() => 'createRelationGraphViewer' in globalThis)
  await page.evaluate(async () => {
    // A → B → C → D, and E alone; the source lists A, its subject, first.
    const nodes = ['A', 'B', 'C', 'D', 'E'].map(id => ({
      id,
      label: `Node ${id}`,
      type: 'entity',
    }))
    const edges = [
      { from: 'A', to: 'B', role: 'reference' },
      { from: 'B', to: 'C', role: 'reference' },
      { from: 'C', to: 'D', role: 'reference' },
    ]
    const source = {
      async summary() {
        return {
          snapshotId: 'walk-v1',
          totalNodes: nodes.length,
          totalEdges: edges.length,
          completeness: 'complete',
          types: [{ id: 'entity', label: 'Entities', count: nodes.length, tone: 0 }],
        }
      },
      async nodes(request: { cursor?: string; limit: number }) {
        const offset = request.cursor === undefined ? 0 : Number(request.cursor)
        const end = Math.min(nodes.length, offset + request.limit)
        return {
          items: nodes.slice(offset, end),
          ...(end < nodes.length ? { nextCursor: String(end) } : {}),
        }
      },
      async edges() {
        return { items: edges }
      },
    }
    const viewer = (
      globalThis as unknown as {
        createRelationGraphViewer(options: unknown): { mount(args: unknown): Promise<unknown> }
      }
    ).createRelationGraphViewer({ depth: 2 })
    await viewer.mount({
      container: document.getElementById('app'),
      descriptor: { revision: 'r', operations: [], diagnostics: [] },
      slot: {
        slotId: 'relations',
        kind: 'stage',
        contributionId: 'modkit.ui/relation-graph-stage',
        extensionId: 'modkit/ui',
        priority: 300,
        bindings: [
          { bindingId: 'relations', contract: 'common.view/relation-graph-source', major: 1 },
        ],
      },
      sources: {
        async get() {
          return { value: source, release: async () => undefined }
        },
      },
      operations: { async invoke() {}, async dispose() {} },
    })
  })
}, 90_000)

afterAll(async () => {
  await page?.close()
  server?.closeAllConnections()
  await browser?.close()
  await new Promise(resolve => server?.close(resolve))
}, 30_000)

const listed = () => page.locator('.modkit-graph__node-list option').allTextContents()
const walk = '[data-mk-part="graph.walk"]'

describe('the relation graph walk', () => {
  it('opens on the whole graph, then walks from the subject by depth and direction', async () => {
    expect(await listed()).toEqual(['Node A', 'Node B', 'Node C', 'Node D', 'Node E'])
    expect(await page.isDisabled(`${walk} label:has-text("Depth") select`)).toBe(true)
    await page.uncheck(`${walk} input[type="checkbox"]`)
    // two edges from A either way: B, then C; the root first, the rest by degree
    await expect.poll(listed).toEqual(['Node A', 'Node B', 'Node C'])
    expect(await page.textContent(`${walk} output`)).toBe('Root: Node A')
    await page.selectOption(`${walk} label:has-text("Depth") select`, '1')
    await expect.poll(listed).toEqual(['Node A', 'Node B'])
    // nothing points at A
    await page.selectOption(`${walk} label:has-text("Direction") select`, 'incoming')
    await expect.poll(listed).toEqual(['Node A'])
    await page.selectOption(`${walk} label:has-text("Direction") select`, 'both')
    await expect.poll(listed).toEqual(['Node A', 'Node B'])
  })

  it('makes the selected node the root and walks again from it', async () => {
    const makeRoot = 'button:has-text("Make root")'
    // the root itself is not offered
    await page.selectOption('.modkit-graph__node-list', { index: 0 })
    expect(await page.isDisabled(makeRoot)).toBe(true)
    await page.selectOption('.modkit-graph__node-list', { index: 1 })
    expect(await page.isDisabled(makeRoot)).toBe(false)
    await page.click(makeRoot)
    await expect.poll(listed).toEqual(['Node B', 'Node A', 'Node C'])
    expect(await page.textContent(`${walk} output`)).toBe('Root: Node B')
    await page.check(`${walk} input[type="checkbox"]`)
    await expect.poll(listed).toHaveLength(5)
  })
})
