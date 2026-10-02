/**
 * The card reads its pictures one at a time (v89, plan 5.12): each read lets the host fit it to the
 * subject's whole budget, so a command card read all at once had its icons refused but the first.
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
      contents: `import { createSubjectCardViewer } from './packages/ui/src/card/index.ts'; globalThis.createSubjectCardViewer = createSubjectCardViewer;`,
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
    <body><div id="app" style="width:700px"></div><script type="module" src="/app.js"></script></body></html>`
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
  await page.waitForFunction(() => 'createSubjectCardViewer' in globalThis)
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve =>
    server === undefined ? resolve() : server.close(() => resolve()),
  )
})

describe('a command card of pictures', () => {
  it('reads them one at a time and draws them all', async () => {
    const result = await page.evaluate(async () => {
      const probe = globalThis as unknown as {
        createSubjectCardViewer(options: unknown): {
          mount(args: unknown): Promise<{ unmount(): Promise<void> }>
        }
      }
      let reading = 0
      let most = 0
      let reads = 0
      const viewer = probe.createSubjectCardViewer({
        async textures(_descriptor: unknown, references: readonly { id: string }[]) {
          reading += 1
          most = Math.max(most, reading)
          await new Promise(resolve => setTimeout(resolve, 20))
          reading -= 1
          reads += 1
          return new Map(
            references.map(reference => [
              reference.id,
              { width: 2, height: 2, rgba: new Uint8Array(16).fill(200) },
            ]),
          )
        },
      })
      const facts = {
        async summary() {
          return {
            snapshotId: 'facts-1',
            identity: { subjectId: 'unit:SCV', label: 'SCV', kind: 'entity', origins: [] },
            groupCount: 1,
            relationCount: 0,
          }
        },
        async groups() {
          return {
            items: [
              {
                id: 'commands',
                label: 'Commands',
                factCount: 3,
                presentation: 'slots',
                slots: { rows: 1, columns: 3 },
              },
            ],
          }
        },
        async facts() {
          return {
            items: ['move', 'stop', 'patrol'].map((name, column) => ({
              id: name,
              label: name,
              value: name,
              provenance: [],
              slot: { row: 0, column, image: `Assets/Textures/btn-command-${name}.dds` },
            })),
          }
        },
        async relations() {
          return { items: [] }
        },
      }
      const root = document.querySelector('#app') as HTMLElement
      const mounted = await viewer.mount({
        container: root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        sources: {
          async get() {
            return { value: facts, async release() {} }
          },
        },
        operations: { async invoke() {}, async dispose() {} },
        slot: {
          slotId: 'card',
          kind: 'stage',
          contributionId: 'modkit.ui/subject-card-stage',
          extensionId: 'modkit/ui',
          priority: 390,
          bindings: [
            { bindingId: 'facts', contract: 'common.view/subject-facts-source', major: 1 },
          ],
        },
      })
      const drawn = (): number =>
        [...root.querySelectorAll('[data-mk-part="card.grid-image"]')].filter(
          canvas => (canvas as HTMLCanvasElement).width === 2,
        ).length
      for (let wait = 0; wait < 100 && drawn() < 3; wait += 1)
        await new Promise(resolve => setTimeout(resolve, 20))
      const answer = { most, reads, drawn: drawn() }
      await mounted.unmount()
      return answer
    })
    expect(result).toEqual({ most: 1, reads: 3, drawn: 3 })
  })
})
