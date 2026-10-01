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
  mountTable(options?: {
    available?: boolean
    changed?: boolean
    reopen?: boolean
    wait?: boolean
    many?: number
  }): Promise<void>
  finishTranslation(): void
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
    let mounted: { unmount(): Promise<void> } | undefined
    const mountTable = async (
      options: {
        available?: boolean
        changed?: boolean
        reopen?: boolean
        wait?: boolean
        many?: number
      } = {},
    ) => {
      await mounted?.unmount()
      let finishTranslation = () => undefined
      const translationGate =
        options.wait === true
          ? new Promise<void>(resolve => {
              finishTranslation = resolve
            })
          : Promise.resolve()
      const rows = [
        ['Abil/Name/A', 'Alpha', 'Альфа', 'Alpha', ''],
        ['Abil/Name/B', 'Beta', '', 'Beta', 'missing'],
        ['Unit/Name/C', 'Gamma', 'Gamma', 'Gamma', 'untranslated error'],
        // a long file, past one page of shown rows
        ...Array.from({ length: options.many ?? 0 }, (_, index) => [
          `Long/Name/${String(index).padStart(4, '0')}`,
          `Value ${index}`,
          `Значение ${index}`,
          `Value ${index}`,
          '',
        ]),
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
              renderValues: 'x/strings.render',
              highlightValue: 'x/strings.highlight',
              completeValue: 'x/strings.complete',
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
          return {
            value: rows[coord.row]?.[coord.column] ?? '',
            ...(coord.column === 1 || coord.column === 2
              ? {
                  type: { kind: 'text' },
                  editable: { write: { operation: 'edit.field' } },
                  spans: [{ from: 0, to: 1, kind: 'keyword' }],
                }
              : {}),
          }
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
          operation('edit.field', 'edit-field', true),
          operation('asset.compare', 'compare-locales'),
          operation('x/strings.translate', 'translate'),
          operation('x/strings.render', 'render'),
          operation('x/strings.highlight', 'highlight'),
          operation('x/strings.complete', 'complete'),
        ],
      }
      const operations = {
        async invoke(handler: string, input: Record<string, unknown>) {
          calls.push({ handler, input })
          if (handler === 'translate') {
            if (input['probe'] !== true) await translationGate
            return {
              state: 'ok',
              output: {
                kind: 'json',
                value:
                  input['probe'] === true
                    ? {
                        available: options.available === true,
                        reason: 'no backend has credentials',
                      }
                    : {
                        translated: options.changed === false ? 'Beta' : 'Бета',
                        changed: options.changed !== false,
                      },
              },
            }
          }
          if (handler === 'highlight') {
            const text = input['text'] as string
            const open = text.lastIndexOf('<') > text.lastIndexOf('>')
            return {
              state: 'ok',
              output: {
                kind: 'json',
                value: {
                  spans: [{ from: 0, to: 1, kind: 'keyword' }],
                  diagnostics: open ? [{ from: 0, to: 1, message: 'Unclosed tag' }] : [],
                },
              },
            }
          }
          if (handler === 'complete') {
            const text = input['text'] as string
            const offset = input['offset'] as number
            const items =
              text[offset - 1] === '<'
                ? [
                    {
                      label: 's',
                      kind: 'keyword',
                      detail: 'style',
                      insertText: 's val="$0"/>',
                      insertTextFormat: 'snippet',
                    },
                    { label: 'n/', kind: 'keyword', insertText: 'n/>' },
                  ]
                : []
            return {
              state: 'ok',
              output: { kind: 'json', value: { from: offset, to: offset, items } },
            }
          }
          if (handler === 'render') {
            const items = input['items'] as { text: string }[]
            return {
              state: 'ok',
              output: {
                kind: 'json',
                value: {
                  items: items.map(item => ({
                    runs: [
                      { text: item.text.toUpperCase(), color: '#ff0000', bold: true },
                      { text: 'x', color: 'red; background: url(//evil)' },
                      { text: '', asset: 'Assets/Icons/Mineral.dds' },
                      { text: '?', unresolved: 'no catalog' },
                      { text: 'drawn', asset: 'Assets/Icons/Gas.dds' },
                    ],
                  })),
                },
              },
            }
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
          return options.reopen !== false
        },
      })
      mounted = (await viewer.mount({
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
      })) as { unmount(): Promise<void> }
      Object.assign(globalThis, {
        calls,
        commits,
        reopenedCount: () => reopened,
        finishTranslation,
      })
    }
    Object.assign(globalThis, { mountTable })
    await mountTable()
  })
}, 90_000)

afterAll(async () => {
  await page?.close()
  server?.closeAllConnections()
  await browser?.close()
  await new Promise(resolve => server?.close(resolve))
}, 30_000)

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
    // a locale without a value, as MK2's «empty» filter counted it
    await page.click('button[aria-label="Empty"]')
    expect(await keys()).toEqual(['Abil/Name/B'])
    await page.click('button[aria-label="Empty"]')
    // a value the codec's checks refuse: its status column says `error`
    await page.click('button[aria-label="Errors"]')
    expect(await keys()).toEqual(['Unit/Name/C'])
    await page.click('button[aria-label="Errors"]')
    // «Wrap» lets long values break inside their cells
    const wrapped = () => page.getAttribute('table:has([data-mk-part="table.body"])', 'data-wrap')
    await page.click('button[aria-label="Wrap"]')
    expect(await wrapped()).toBe('true')
    await page.click('button[aria-label="Wrap"]')
    expect(await wrapped()).toBe(null)
    // and keeps each key one name, whole in its tooltip
    const key = '[data-mk-part="table.body"] tr:first-child td:nth-child(2)'
    expect(await page.getAttribute(key, 'data-key')).toBe('true')
    expect(await page.getAttribute(key, 'title')).toBe('Abil/Name/A')
    await page.selectOption('select[aria-label="Key group"]', 'Unit/')
    expect(await keys()).toEqual(['Unit/Name/C'])
    await page.selectOption('select[aria-label="Key group"]', '')
    expect(await keys()).toHaveLength(3)
  })

  it('hides a column in the head and in every drawn row, across redraws', async () => {
    const ruRU = '[data-mk-part="table.columns"] label:has-text("ruRU") input'
    const visibleHead = () =>
      page.$$eval('[data-mk-part="table.head"] th', cells =>
        cells.filter(cell => !cell.hidden).map(cell => cell.textContent),
      )
    const visibleCells = () =>
      page.$$eval('[data-mk-part="table.row"]', rows =>
        rows.map(row => [...row.querySelectorAll('td')].filter(cell => !cell.hidden).length),
      )
    await page.click('[data-mk-part="table.columns"] summary')
    await page.uncheck(ruRU)
    expect(await visibleHead()).toEqual(['', 'Key', 'enUS', 'Preview', 'Status'])
    expect(await visibleCells()).toEqual([5, 5, 5])
    await page.fill('[data-mk-part="toolbar.search-input"]', 'Beta')
    expect(await visibleCells()).toEqual([5])
    await page.fill('[data-mk-part="toolbar.search-input"]', '')
    await page.check(ruRU)
    expect(await visibleHead()).toEqual(['', 'Key', 'enUS', 'ruRU', 'Preview', 'Status'])
    expect(await visibleCells()).toEqual([6, 6, 6])
    await page.click('[data-mk-part="table.columns"] summary')
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

  it('highlights locale values by default and drafts only the current cell editor', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    const cell = '[data-mk-part="table.body"] tr:first-child td:nth-child(3)'
    await page.focus(cell)
    await page.waitForSelector(`${cell} [data-mk-token="keyword"]`)
    await page.dblclick(cell)
    await page.fill(`${cell} input`, 'discarded')
    await page.press(`${cell} input`, 'Escape')
    await page.dblclick(cell)
    await page.fill(`${cell} input`, 'accepted')
    await page.press(`${cell} input`, 'Enter')
    // The value waits in the draft, marked, with the focus back on its cell.
    await page.waitForSelector(`${cell}[data-mk-state~="mutating"]`)
    expect(await page.textContent(cell)).toBe('accepted')
    expect(await page.$eval(cell, node => node === document.activeElement)).toBe(true)
    expect(await page.evaluate(() => (globalThis as unknown as Probe).commits.length)).toBe(0)
    expect(await page.textContent('[data-modkit-action="save"]')).toBe('Save (1)')
    await page.click('[data-modkit-action="save"]')
    await page.waitForFunction(() => (globalThis as unknown as Probe).commits.length > 0)
    const writes = await page.evaluate(() =>
      (globalThis as unknown as Probe).calls.filter(call => /^edit-/u.test(call.handler)),
    )
    expect(writes).toEqual([
      {
        handler: 'edit-strings',
        input: {
          action: 'set-many',
          variant: 'enUS',
          entries: [{ key: 'Abil/Name/A', value: 'accepted' }],
        },
      },
    ])
    // The page's own Save asks the host to reopen the subject on the revision it wrote.
    expect(await page.evaluate(() => (globalThis as unknown as Probe).reopenedCount())).toBe(1)
    expect(await page.textContent(cell)).toBe('accepted')
  })

  it('steps the draft with the host Undo and Redo and saves it, open editor included, as one plan', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    await page.evaluate(() => {
      Object.assign(globalThis, { announced: 0 })
      document.addEventListener('modkit-editor-edited', () => {
        ;(globalThis as unknown as { announced: number }).announced += 1
      })
    })
    const announced = () =>
      page.evaluate(() => (globalThis as unknown as { announced: number }).announced)
    const history = (direction: 'undo' | 'redo') =>
      page.evaluate(direction => {
        let done: boolean | undefined
        document.querySelector('[data-modkit-editor]')?.dispatchEvent(
          new CustomEvent('modkit-editor-history-request', {
            detail: { direction, answer: (value: boolean) => (done = value) },
          }),
        )
        return done
      }, direction)
    const cell = (row: number, column: number) =>
      `[data-mk-part="table.body"] tr:nth-child(${row}) td:nth-child(${column + 2})`
    const type = async (selector: string, value: string, enter = true) => {
      await page.dblclick(selector)
      await page.fill(`${selector} input`, value)
      if (enter) await page.press(`${selector} input`, 'Enter')
    }
    const drafted = () =>
      page.locator('[data-mk-part="table.cell"][data-mk-state~="mutating"]').count()

    await type(cell(1, 1), 'Alpha!')
    await page.waitForSelector(`${cell(1, 1)}[data-mk-state~="mutating"]`)
    await type(cell(2, 2), 'Бета')
    await page.waitForSelector(`${cell(2, 2)}[data-mk-state~="mutating"]`)
    expect(await drafted()).toBe(2)
    expect(await announced()).toBe(2)
    expect(await history('undo')).toBe(true)
    expect(await page.textContent(cell(2, 2))).toBe('')
    expect(await page.textContent('[data-modkit-action="save"]')).toBe('Save (1)')
    expect(await history('redo')).toBe(true)
    expect(await page.textContent(cell(2, 2))).toBe('Бета')
    expect(await history('redo')).toBe(false)
    // A key is added, renamed or deleted at once, so the draft must be saved or reverted first.
    await page.click('button[aria-label="Add key"]')
    expect(await page.isHidden('[data-mk-part="table.panel"]')).toBe(true)
    expect(await page.textContent('[data-mk-part="table.controls"] + output')).toContain(
      'Save or revert the unsaved changes first.',
    )

    // VS Code's Ctrl+S with a cell editor still open: what it holds is saved with the rest.
    await type(cell(3, 2), 'Гамма', false)
    const saved = await page.evaluate(async () => {
      let operation: Promise<boolean> | undefined
      document.querySelector('[data-modkit-editor]')?.dispatchEvent(
        new CustomEvent('modkit-editor-save-request', {
          detail: { waitUntil: (next: Promise<boolean>) => (operation = next) },
        }),
      )
      return operation === undefined ? 'unanswered' : await operation
    })
    expect(saved).toBe(true)
    const writes = await page.evaluate(() =>
      (globalThis as unknown as Probe).calls.filter(call => /^edit-/u.test(call.handler)),
    )
    expect(writes).toEqual([
      {
        handler: 'edit-strings',
        input: {
          action: 'set-variants',
          entries: [
            { key: 'Abil/Name/A', variant: 'enUS', value: 'Alpha!' },
            { key: 'Abil/Name/B', variant: 'ruRU', value: 'Бета' },
            { key: 'Unit/Name/C', variant: 'ruRU', value: 'Гамма' },
          ],
        },
      },
    ])
    // The host reopens after its own save, and the flushed editor is no step of its Undo.
    expect(await page.evaluate(() => (globalThis as unknown as Probe).reopenedCount())).toBe(0)
    expect(await announced()).toBe(2)
    expect(await drafted()).toBe(0)
    expect(await page.isDisabled('[data-modkit-action="save"]')).toBe(true)
  })

  it('keeps what an open cell editor holds when another cell is opened', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    const first = '[data-mk-part="table.body"] tr:nth-child(1) td:nth-child(3)'
    const second = '[data-mk-part="table.body"] tr:nth-child(2) td:nth-child(3)'
    await page.dblclick(first)
    await page.fill(`${first} input`, 'Alpha?')
    await page.dblclick(second)
    await page.waitForSelector(`${second} input`)
    expect(await page.textContent(first)).toBe('Alpha?')
    expect(await page.textContent('[data-modkit-action="save"]')).toBe('Save (1)')
    await page.fill(`${second} input`, 'Beta?')
    await page.press(`${second} input`, 'Enter')
    await page.waitForSelector(`${second}[data-mk-state~="mutating"]`)
    expect(await page.textContent('[data-modkit-action="save"]')).toBe('Save (2)')
  })

  it('moves between cells with the arrows and goes on editing below with ↓ (7.36)', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    const cell = (row: number, column: number) =>
      `[data-mk-part="table.body"] tr:nth-child(${row}) td:nth-child(${column})`
    // not editing: the arrows move the focus, as in a spreadsheet
    await page.focus(cell(1, 3))
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest('tr')?.querySelector('td:nth-child(2)')?.textContent +
          ' ' +
          String((document.activeElement as HTMLTableCellElement | null)?.cellIndex),
      ),
    ).toBe('Abil/Name/B 3')
    // editing: Shift+Enter keeps the field open; ↓ keeps the value and edits the cell below
    await page.dblclick(cell(1, 3))
    await page.fill(`${cell(1, 3)} input`, 'Alpha!')
    await page.keyboard.press('Shift+Enter')
    expect(await page.isVisible(`${cell(1, 3)} input`)).toBe(true)
    await page.keyboard.press('ArrowDown')
    await page.waitForSelector(`${cell(2, 3)} input`)
    expect(await page.textContent(cell(1, 3))).toBe('Alpha!')
    expect(await page.textContent('[data-modkit-action="save"]')).toBe('Save (1)')
    await page.keyboard.press('Escape')
  })

  it("shows a value's trailing white space without changing its text (7.36)", async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    const cell = '[data-mk-part="table.body"] tr:first-child td:nth-child(3)'
    await page.dblclick(cell)
    await page.fill(`${cell} input`, 'Alpha  ')
    await page.press(`${cell} input`, 'Enter')
    await page.waitForSelector(`${cell}[data-mk-state~="mutating"]`)
    expect(await page.textContent(cell)).toBe('Alpha  ')
    expect(await page.textContent(`${cell} [data-mk-part="table.trailing"]`)).toBe('  ')
  })

  it("marks each locale's cell without a value or with the base text still (7.36)", async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    const states = await page.$$eval('[data-mk-part="table.body"] tr', rows =>
      rows.map(row =>
        [2, 3].map(index => row.querySelectorAll('td')[index]?.getAttribute('data-mk-state') ?? ''),
      ),
    )
    expect(states).toEqual([
      ['', ''],
      ['', 'empty'],
      ['', 'stale'],
    ])
    const missing = '[data-mk-part="table.body"] tr:nth-child(2) td:nth-child(4)'
    expect(await page.getAttribute(missing, 'title')).toBe('No value in ruRU')
  })

  it('shows the next page of rows once the reader scrolls to the end (7.36)', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable({ many: 450 }))
    const drawn = () => page.locator('[data-mk-part="table.body"] tr').count()
    expect(await drawn()).toBe(200)
    await page.locator('[data-mk-part="table.next"]').scrollIntoViewIfNeeded()
    await expect.poll(drawn).toBe(400)
    await page.locator('[data-mk-part="table.next"]').scrollIntoViewIfNeeded()
    await expect.poll(drawn).toBe(453)
    expect(await page.isHidden('[data-mk-part="table.next"]')).toBe(true)
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
  })

  it('reverts the draft to the values the source holds, writing nothing', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    const cell = '[data-mk-part="table.body"] tr:first-child td:nth-child(4)'
    await page.dblclick(cell)
    await page.fill(`${cell} input`, 'Альфа!')
    await page.press(`${cell} input`, 'Enter')
    await page.waitForSelector(`${cell}[data-mk-state~="mutating"]`)
    await page.click('[data-modkit-action="revert"]')
    expect(await page.textContent(cell)).toBe('Альфа')
    expect(await page.getAttribute(cell, 'data-mk-state')).toBe(null)
    expect(await page.isDisabled('[data-modkit-action="revert"]')).toBe(true)
    expect(await page.evaluate(() => (globalThis as unknown as Probe).commits.length)).toBe(0)
  })

  it('reviews one translation batch and prevents further writes to an unreopened session', async () => {
    await page.evaluate(() =>
      (globalThis as unknown as Probe).mountTable({ available: true, reopen: false, wait: true }),
    )
    const translate = 'button[aria-label="Translate empty cells"]'
    await page.click(translate)
    expect(await page.isDisabled(translate)).toBe(true)
    expect(await page.evaluate(() => (globalThis as unknown as Probe).commits.length)).toBe(0)
    await page.evaluate(() => (globalThis as unknown as Probe).finishTranslation())
    await page.waitForSelector('[data-mk-part="table.panel"] button')
    await page.click('[data-mk-part="table.panel"] button')
    // Accepted translations join the draft; Save writes them.
    expect(await page.evaluate(() => (globalThis as unknown as Probe).commits.length)).toBe(0)
    await page.click('[data-modkit-action="save"]')
    await page.waitForFunction(() => (globalThis as unknown as Probe).commits.length === 1)
    const writes = await page.evaluate(() =>
      (globalThis as unknown as Probe).calls.filter(call => call.handler === 'edit-strings'),
    )
    expect(writes).toEqual([
      {
        handler: 'edit-strings',
        input: {
          action: 'set-many',
          variant: 'ruRU',
          entries: [{ key: 'Abil/Name/B', value: 'Бета' }],
        },
      },
    ])
    await page.click('button[aria-label="Add key"]')
    await page.fill('input[aria-label="New key"]', 'Another')
    await page.fill('input[aria-label="Value (enUS)"]', 'next')
    await page.click('[data-mk-part="table.add"] button')
    expect(await page.evaluate(() => (globalThis as unknown as Probe).commits.length)).toBe(1)
    expect(await page.textContent('[data-mk-part="table.controls"] + output')).toMatch(
      /reopen|changed|saved/iu,
    )
  })

  it('does not offer an unchanged translation for applying', async () => {
    await page.evaluate(() =>
      (globalThis as unknown as Probe).mountTable({ available: true, changed: false }),
    )
    await page.click('button[aria-label="Translate empty cells"]')
    await page.waitForFunction(() =>
      document.querySelector('[data-mk-part="table.panel"]')?.textContent?.includes('Beta'),
    )
    expect(await page.locator('[data-mk-part="table.panel"] button').count()).toBe(0)
    expect(await page.evaluate(() => (globalThis as unknown as Probe).commits.length)).toBe(0)
  })

  it('draws locale values as in game in one batch, only through safe text and colours', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    await page.click('button[aria-label="As in game"]')
    await page.waitForSelector('[data-mk-part="table.body"] td[data-rendered="true"]')
    const calls = await page.evaluate(() =>
      (globalThis as unknown as Probe).calls.filter(call => call.handler === 'render'),
    )
    // Empty values are not sent: five of the six locale cells hold text.
    expect(calls).toHaveLength(1)
    expect((calls[0]?.input as { items: unknown[] }).items).toEqual([
      { column: 1, text: 'Alpha' },
      { column: 2, text: 'Альфа' },
      { column: 1, text: 'Beta' },
      { column: 1, text: 'Gamma' },
      { column: 2, text: 'Gamma' },
    ])
    const first = await page.$eval('[data-mk-part="table.row"] td:nth-child(3)', cell => ({
      text: cell.textContent,
      spans: [...cell.children].map(child => ({
        part: child.getAttribute('data-mk-part'),
        color: (child as HTMLElement).style.color,
        weight: (child as HTMLElement).style.fontWeight,
        title: (child as HTMLElement).title,
      })),
    }))
    // The run carrying both an image and text is refused whole; the unsafe colour is dropped.
    expect(first.text).toBe('ALPHAxMineral.dds?')
    expect(first.spans).toEqual([
      { part: null, color: 'rgb(255, 0, 0)', weight: 'bold', title: '' },
      { part: null, color: '', weight: '', title: '' },
      { part: 'table.asset', color: '', weight: '', title: 'Assets/Icons/Mineral.dds' },
      { part: 'table.unresolved', color: '', weight: '', title: 'no catalog' },
    ])
    // Hovering a drawn cell must not paint the stored text's syntax runs over it.
    await page.hover('[data-mk-part="table.row"] td:nth-child(3)')
    expect(await page.textContent('[data-mk-part="table.row"] td:nth-child(3)')).toBe(
      'ALPHAxMineral.dds?',
    )
    await page.click('button[aria-label="As in game"]')
    expect(await page.textContent('[data-mk-part="table.row"] td:nth-child(3)')).toBe('Alpha')
  })

  it('shows problems and suggestions while a value is typed, without saving on Enter', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    const cell = '[data-mk-part="table.row"] td:nth-child(3)'
    await page.dblclick(cell)
    const field = `${cell} input`
    await page.focus(field)
    await page.press(field, 'End')
    await page.keyboard.type('<')
    const list = '[data-mk-part="table.suggestions"]:not([hidden])'
    await page.waitForSelector(list)
    expect(await page.$$eval(`${list} li`, items => items.map(item => item.textContent))).toEqual([
      's — style',
      'n/',
    ])
    expect(await page.textContent(`${cell} [data-mk-part="table.assist"] li`)).toBe('Unclosed tag')
    expect(await page.getAttribute(field, 'aria-invalid')).toBe('true')
    // Enter takes the suggestion, puts the caret where the snippet says, and saves nothing.
    await page.keyboard.press('Enter')
    expect(await page.inputValue(field)).toBe('Alpha<s val=""/>')
    expect(await page.$eval(field, input => (input as HTMLInputElement).selectionStart)).toBe(13)
    await page.waitForFunction(
      selector => document.querySelector(selector)?.getAttribute('aria-invalid') === null,
      field,
    )
    const calls = await page.evaluate(() => (globalThis as unknown as Probe).calls)
    expect(calls).toContainEqual({
      handler: 'complete',
      input: { row: 0, column: 1, text: 'Alpha<', offset: 6 },
    })
    expect(calls.some(call => call.handler === 'edit-field')).toBe(false)
    // With the list closed, Escape drops the edit and the cell shows what it showed before.
    await page.keyboard.press('Escape')
    await page.waitForFunction(selector => !document.querySelector(selector), field)
    expect(await page.textContent(cell)).toBe('Alpha')
    expect(await page.evaluate(() => (globalThis as unknown as Probe).commits.length)).toBe(0)
  })
})

describe('variant table find and replace', () => {
  const filter = '[data-mk-part="table.controls"] [data-mk-part="toolbar.search-input"]'
  const filterToggle = (label: string) =>
    `[data-mk-part="table.controls"] button[aria-label="${label}"]`
  const findBar = '[data-mk-part="table.find"]'
  const findInput = `${findBar} input[aria-label="Find"]`
  const replaceInput = `${findBar} input[aria-label="Replace with"]`
  const findToggle = (label: string) => `${findBar} button[aria-label="${label}"]`
  const count = () => page.textContent(`${findBar} [data-mk-part="toolbar.label"]`)
  const marks = () => page.locator('[data-mk-part="table.match"]').count()
  const activeKey = () =>
    page.textContent('[data-mk-part="table.row"][data-mk-state~="active"] td:nth-child(2)')
  const stringWrites = () =>
    page.evaluate(() =>
      (globalThis as unknown as Probe).calls
        .filter(call => call.handler === 'edit-strings')
        .map(call => call.input),
    )
  /** The find state follows the subject across mounts; each case leaves it as it found it. */
  const resetFind = async () => {
    await page.fill(findInput, '')
    if (await page.isVisible(replaceInput)) await page.fill(replaceInput, '')
    for (const label of ['Match case', 'Match whole word', 'Use regular expression']) {
      if ((await page.getAttribute(findToggle(label), 'aria-pressed')) === 'true') {
        await page.click(findToggle(label))
      }
    }
    if ((await page.getAttribute(findToggle('Toggle replace'), 'aria-pressed')) === 'true') {
      await page.click(findToggle('Toggle replace'))
    }
    await page.press(findInput, 'Escape')
  }

  it('filters with case, whole word and a regular expression', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    await page.fill(filter, 'alpha')
    expect(await keys()).toEqual(['Abil/Name/A'])
    await page.click(filterToggle('Match case'))
    expect(await keys()).toEqual([])
    await page.click(filterToggle('Match case'))
    await page.fill(filter, 'Nam')
    await page.click(filterToggle('Match whole word'))
    expect(await keys()).toEqual([])
    await page.fill(filter, 'Name')
    expect(await keys()).toHaveLength(3)
    await page.click(filterToggle('Match whole word'))
    await page.click(filterToggle('Use regular expression'))
    await page.fill(filter, '^(Beta|Gamma)$')
    expect(await keys()).toEqual(['Abil/Name/B', 'Unit/Name/C'])
    await page.fill(filter, '(')
    expect(await keys()).toEqual([])
    expect(await page.getAttribute(filter, 'aria-invalid')).toBe('true')
    expect(await page.textContent('[data-mk-part="table.controls"] + output')).toMatch(/regular/iu)
    await page.fill(filter, '')
    await page.click(filterToggle('Use regular expression'))
    expect(await page.getAttribute(filter, 'aria-invalid')).toBe('false')
    expect(await keys()).toHaveLength(3)
  })

  it('finds with Ctrl+F: counts the rows, marks the matches, steps and closes', async () => {
    await page.evaluate(() => {
      const leaked: string[] = []
      window.addEventListener('keydown', event => leaked.push(event.code))
      Object.assign(globalThis, { leaked })
    })
    expect(await page.isHidden(findBar)).toBe(true)
    await page.focus('[data-mk-part="table.body"] tr:first-child td:nth-child(2)')
    await page.keyboard.press('Control+f')
    expect(await page.isVisible(findBar)).toBe(true)
    expect(await page.isHidden(replaceInput)).toBe(true)
    // The host's own Find never hears the key.
    expect(await page.evaluate(() => (globalThis as { leaked?: string[] }).leaked)).not.toContain(
      'KeyF',
    )
    await page.keyboard.type('Name')
    expect(await count()).toBe('1 of 3')
    expect(await marks()).toBe(3)
    expect(await activeKey()).toBe('Abil/Name/A')
    await page.press(findInput, 'Enter')
    expect(await count()).toBe('2 of 3')
    expect(await activeKey()).toBe('Abil/Name/B')
    await page.press(findInput, 'Shift+Enter')
    await page.press(findInput, 'Shift+Enter')
    expect(await count()).toBe('3 of 3')
    expect(await activeKey()).toBe('Unit/Name/C')
    await page.click(findToggle('Next match'))
    expect(await count()).toBe('1 of 3')
    // Only the key and the locale columns are searched, not the preview.
    await page.fill(findInput, 'Gamma')
    expect(await count()).toBe('1 of 1')
    expect(await marks()).toBe(2)
    await page.fill(findInput, 'nothing like it')
    expect(await count()).toBe('No results')
    // Plain text is taken as it is, not as an expression.
    await page.fill(findInput, '(')
    expect(await count()).toBe('No results')
    expect(await page.getAttribute(findInput, 'aria-invalid')).toBe('false')
    await resetFind()
    expect(await page.isHidden(findBar)).toBe(true)
    expect(await marks()).toBe(0)
    expect(await page.locator('[data-mk-part="table.row"][data-mk-state~="active"]').count()).toBe(
      0,
    )
  })

  it('replaces the next match through one set-many plan, with $1 from an expression', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    await page.focus('[data-mk-part="table.body"] tr:first-child td:nth-child(2)')
    await page.keyboard.press('Control+h')
    expect(await page.isVisible(replaceInput)).toBe(true)
    await page.click(findToggle('Use regular expression'))
    await page.fill(findInput, 'B(eta)')
    await page.fill(replaceInput, 'b$1!')
    await page.click(findToggle('Replace'))
    // The replaced value waits in the draft until Save.
    await page.waitForSelector('[data-mk-part="table.cell"][data-mk-state~="mutating"]')
    expect(await page.evaluate(() => (globalThis as unknown as Probe).commits.length)).toBe(0)
    await page.click('[data-modkit-action="save"]')
    await page.waitForFunction(() => (globalThis as unknown as Probe).commits.length === 1)
    expect(await stringWrites()).toEqual([
      { action: 'set-many', variant: 'enUS', entries: [{ key: 'Abil/Name/B', value: 'beta!' }] },
    ])
    expect(await page.textContent('[data-mk-part="table.row"] td:nth-child(3) >> nth=1')).toBe(
      'beta!',
    )
    await resetFind()
  })

  it('renames a ticked key in every locale and deletes it, one plan each', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    const tick = '[data-mk-part="table.body"] tr:first-child input[type="checkbox"]'
    await page.click(tick)
    await page.click('button[aria-label="Rename key…"]')
    await page.fill('[data-mk-part="table.add"] input', 'Abil/Name/Z')
    await page.click('[data-mk-part="table.add"] button')
    await page.waitForFunction(() => (globalThis as unknown as Probe).commits.length === 1)
    expect(await stringWrites()).toEqual([
      { action: 'rename-variants', oldKey: 'Abil/Name/A', newKey: 'Abil/Name/Z' },
    ])
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    await page.click(tick)
    await page.click('button[aria-label="Delete key…"]')
    await page.click('[data-mk-part="table.add"] button')
    await page.waitForFunction(() => (globalThis as unknown as Probe).commits.length === 1)
    expect(await stringWrites()).toEqual([{ action: 'delete-variants', key: 'Abil/Name/A' }])
  })

  it('replaces all in one plan across locales, literally, and only in the columns on screen', async () => {
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    await page.focus('[data-mk-part="table.body"] tr:first-child td:nth-child(2)')
    await page.keyboard.press('Control+h')
    await page.fill(findInput, 'Gamma')
    await page.fill(replaceInput, '$1')
    await page.click(findToggle('Replace all'))
    await page.click('[data-modkit-action="save"]')
    await page.waitForFunction(() => (globalThis as unknown as Probe).commits.length === 1)
    expect(await stringWrites()).toEqual([
      {
        action: 'set-variants',
        entries: [
          { key: 'Unit/Name/C', variant: 'enUS', value: '$1' },
          { key: 'Unit/Name/C', variant: 'ruRU', value: '$1' },
        ],
      },
    ])
    // The same find on a fresh table, with ruRU hidden: one locale, so set-many.
    await page.evaluate(() => (globalThis as unknown as Probe).mountTable())
    expect(await page.isVisible(findBar)).toBe(true)
    const ruRU = '[data-mk-part="table.columns"] label:has-text("ruRU") input'
    await page.click('[data-mk-part="table.columns"] summary')
    await page.uncheck(ruRU)
    expect(await marks()).toBe(1)
    await page.click(findToggle('Replace all'))
    await page.click('[data-modkit-action="save"]')
    await page.waitForFunction(() => (globalThis as unknown as Probe).commits.length === 1)
    expect(await stringWrites()).toEqual([
      { action: 'set-many', variant: 'enUS', entries: [{ key: 'Unit/Name/C', value: '$1' }] },
    ])
    await page.check(ruRU)
    await page.click('[data-mk-part="table.columns"] summary')
    await resetFind()
  })
})
