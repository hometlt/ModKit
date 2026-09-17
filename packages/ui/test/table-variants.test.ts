/**
 * The variant (localization) table in a real browser: search, status filters, key groups, adding a
 * key and comparing locales — every request routed through the operation ids the source names.
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

interface Probe {
  createTableViewer(options: unknown): {
    mount(args: unknown): Promise<unknown>
  }
  calls: { handler: string; input: unknown }[]
  commits: unknown[]
  reopenedCount(): number
}

let server: Server
let browser: Browser
let page: Page

beforeAll(async () => {
  const built = await build({
    stdin: {
      contents: `import { createTableViewer } from './packages/ui/src/table/index.ts'; globalThis.createTableViewer = createTableViewer;`,
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
  if (bundle === undefined) throw new Error('table bundle was not emitted')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
    <body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`
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
  await page.waitForFunction(() => 'createTableViewer' in globalThis)
  await page.evaluate(async () => {
    const rows = [
      ['Abil/Name/A', 'Alpha', 'Альфа', 'Alpha', ''],
      ['Abil/Name/B', 'Beta', '', 'Beta', 'missing'],
      ['Unit/Name/C', 'Gamma', 'Gamma', 'Gamma', 'untranslated'],
    ]
    const calls: { handler: string; input: unknown }[] = []
    const commits: unknown[] = []
    const source = {
      async shape() {
        return {
          rows: rows.length,
          columns: 5,
          header: ['Key', 'enUS', 'ruRU', 'Preview', 'Status'],
          columnInfo: [
            { role: 'key' },
            { role: 'variant', variant: 'enUS', language: 'en', base: true },
            { role: 'variant', variant: 'ruRU', language: 'ru' },
            { role: 'detail' },
            { role: 'status' },
          ],
          actions: {
            addRow: 'edit.content',
            compareVariants: 'asset.compare',
            translateVariant: 'x/strings.translate',
          },
          keySeparator: '/',
        }
      },
      async rows(request: { from?: number; count: number }) {
        const from = request.from ?? 0
        return {
          items: rows
            .slice(from, from + request.count)
            .map((cells, index) => ({ index: from + index, cells })),
        }
      },
      async cell(coord: { row: number; column: number }) {
        return { value: rows[coord.row]?.[coord.column] ?? '' }
      },
      async *search() {
        yield* []
      },
    }
    const operation = (id: string, handlerId: string, mutatesSource = false) => ({
      id,
      handlerId,
      mutatesSource,
      state: 'available',
    })
    const descriptor = {
      subjectUri: 'memory://GameStrings.txt',
      revision: 'r1',
      operations: [
        operation('edit.content', 'edit-strings', true),
        operation('asset.compare', 'compare-locales'),
        operation('x/strings.translate', 'translate'),
      ],
    }
    const operations = {
      async invoke(handler: string, input: Record<string, unknown>) {
        calls.push({ handler, input })
        if (handler === 'translate')
          return {
            state: 'ok',
            output: {
              kind: 'json',
              value: { available: false, reason: 'no backend has credentials' },
            },
          }
        if (handler === 'compare-locales') {
          return {
            state: 'ok',
            output: {
              kind: 'json',
              value: {
                missing: ['Abil/Name/B'],
                orphaned: [],
                identical: ['Unit/Name/C'],
                empty: [],
                total: 3,
                translated: 1,
              },
            },
          }
        }
        return { state: 'ok', output: { kind: 'edit-plan', plan: { planId: 'p' } } }
      },
    }
    const container = document.getElementById('app') as HTMLElement
    let reopened = 0
    const viewer = (globalThis as unknown as Probe).createTableViewer({
      onCommitted: async () => {
        reopened += 1
        return true
      },
    })
    await viewer.mount({
      container,
      descriptor,
      slot: {
        slotId: 'localization',
        kind: 'stage',
        contributionId: 'modkit.ui/localization-table-stage',
        extensionId: 'modkit/ui',
        priority: 410,
        bindings: [{ bindingId: 'b', contract: 'common.view/table-data-source', major: 1 }],
      },
      sources: {
        async get() {
          return { value: source, release: async () => undefined }
        },
      },
      operations,
      commit: {
        async prepare(plan: unknown) {
          commits.push(plan)
          return { state: 'ready', prepared: plan }
        },
        async commit() {
          return { state: 'committed' }
        },
      },
      authorization: {
        async request() {
          return { grant: {} }
        },
      },
    })
    Object.assign(globalThis, { calls, commits, reopenedCount: () => reopened })
  })
}, 90_000)

afterAll(async () => {
  await browser?.close()
  await new Promise(resolve => server?.close(resolve))
})

const keys = () =>
  page.$$eval('[data-mk-part="table.body"] tr', rows =>
    rows.map(row => row.querySelectorAll('td')[1]?.textContent),
  )

describe('variant table surface', () => {
  it('shows every row with a selection column and a header', async () => {
    expect(await keys()).toEqual(['Abil/Name/A', 'Abil/Name/B', 'Unit/Name/C'])
    expect(
      await page.$$eval('[data-mk-part="table.head"] th', cells =>
        cells.map(cell => cell.textContent),
      ),
    ).toEqual(['', 'Key', 'enUS', 'ruRU', 'Preview', 'Status'])
  })

  it('searches keys and values, filters by status and by key group', async () => {
    await page.fill('[data-mk-part="toolbar.search-input"]', 'альфа')
    expect(await keys()).toEqual(['Abil/Name/A'])
    await page.fill('[data-mk-part="toolbar.search-input"]', '')
    await page.click('button[aria-label="Missing"]')
    expect(await keys()).toEqual(['Abil/Name/B'])
    await page.click('button[aria-label="Missing"]')
    await page.selectOption('select[aria-label="Key group"]', 'Unit/')
    expect(await keys()).toEqual(['Unit/Name/C'])
    await page.selectOption('select[aria-label="Key group"]', '')
    expect(await keys()).toHaveLength(3)
  })

  it('explains why translation is disabled before anything is sent', async () => {
    expect(await page.isDisabled('button[aria-label="Translate empty cells"]')).toBe(true)
    expect(await page.textContent('[data-mk-part="table.note"]')).toContain(
      'no backend has credentials',
    )
    const calls = await page.evaluate(() => (globalThis as unknown as Probe).calls)
    expect(calls).toContainEqual({ handler: 'translate', input: { probe: true } })
  })

  it('adds a key through the addRow operation and commits its plan', async () => {
    await page.click('button[aria-label="Add key"]')
    await page.fill('input[aria-label="New key"]', 'Unit/Name/D')
    await page.fill('input[aria-label="Value (enUS)"]', 'Delta')
    await page.click('[data-mk-part="table.add"] button')
    await page.waitForFunction(() => (globalThis as unknown as Probe).commits.length === 1)
    const calls = await page.evaluate(() => (globalThis as unknown as Probe).calls)
    expect(calls).toContainEqual({
      handler: 'edit-strings',
      input: { action: 'add', key: 'Unit/Name/D', value: 'Delta', variant: 'enUS' },
    })
    expect(await keys()).toContain('Unit/Name/D')
    expect(await page.evaluate(() => (globalThis as unknown as Probe).reopenedCount())).toBe(1)
    await page.click('button[aria-label="Changed"]')
    expect(await keys()).toEqual(['Unit/Name/D'])
    await page.click('button[aria-label="Changed"]')
  })

  it('compares each locale with the base and filters to a compared key set', async () => {
    await page.click('button[aria-label="Compare locales"]')
    await page.waitForSelector('[data-mk-part="table.compare"]')
    const calls = await page.evaluate(() => (globalThis as unknown as Probe).calls)
    expect(calls).toContainEqual({ handler: 'compare-locales', input: { variant: 'ruRU' } })
    expect(await page.textContent('[data-mk-part="table.compare"]')).toContain(
      'ruRU: 1 of 3 translated from enUS',
    )
    await page.click('[data-mk-part="table.compare"] button:has-text("Untranslated")')
    expect(await keys()).toEqual(['Unit/Name/C'])
  })
})
