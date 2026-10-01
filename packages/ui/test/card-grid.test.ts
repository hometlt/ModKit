/**
 * The command card of a subject card in a real browser (plan 5.12): a fixed grid with its empty
 * places, pages, alternatives sharing a cell, pictures from the host, and clicks that open a subject
 * or show a page.
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
  await page.waitForFunction(() => 'createSubjectCard' in globalThis)
  await page.evaluate(() => {
    const probe = globalThis as unknown as {
      createSubjectCard(document: Document, options: unknown): { root: HTMLElement }
      navigated: string[]
      images: string[]
    }
    probe.navigated = []
    probe.images = []
    const card = probe.createSubjectCard(document, {
      label: 'SCV',
      header: false,
      onNavigate: (ref: { href: string }) => probe.navigated.push(ref.href),
      async resolveImage(id: string) {
        probe.images.push(id)
        return { width: 2, height: 2, rgba: new Uint8Array(16).fill(200) }
      },
      sections: [
        {
          kind: 'grid',
          id: 'command-card',
          title: 'Command card',
          columns: 5,
          rows: 3,
          pages: [
            { id: 'Root', label: 'Commands' },
            { id: 'Build', label: 'Build structure' },
          ],
          expanded: true,
          cells: [
            {
              id: 'Move',
              label: 'Move',
              row: 0,
              column: 0,
              page: 'Root',
              hotkey: 'M',
              image: 'btn-move',
              ref: { label: 'Move', href: 'button:Move' },
            },
            {
              id: 'Siege',
              label: 'Siege Mode',
              row: 0,
              column: 1,
              page: 'Root',
              ref: { label: 'Siege Mode', href: 'button:Siege' },
            },
            {
              id: 'Unsiege',
              label: 'Tank Mode',
              row: 0,
              column: 1,
              page: 'Root',
              ref: { label: 'Tank Mode', href: 'button:Unsiege' },
            },
            {
              id: 'Build',
              label: 'Build',
              detail: 'Opens the build menu',
              row: 2,
              column: 0,
              page: 'Root',
              opensPage: 'Build',
            },
            {
              id: 'Barracks',
              label: 'Barracks',
              row: 0,
              column: 0,
              page: 'Build',
              ref: { label: 'Barracks', href: 'button:Barracks' },
            },
            { id: 'Cancel', label: 'Cancel', row: 2, column: 4, page: 'Build', opensPage: 'Root' },
          ],
        },
      ],
    })
    document.querySelector('#app')?.append(card.root)
  })
})

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()))
})

const faces = () =>
  page.$$eval('[data-mk-part="card.grid-cell"]', cells =>
    cells.map(
      cell =>
        cell.querySelector('[data-mk-part="card.grid-face"]')?.getAttribute('aria-label') ?? '',
    ),
  )

describe('command card grid', () => {
  it('draws every place of the shown page, the empty ones too, with hotkeys and pictures', async () => {
    const shown = await faces()
    expect(shown).toHaveLength(15)
    expect(shown.slice(0, 2)).toEqual(['Move', 'Siege Mode'])
    expect(shown[10]).toBe('Build')
    expect(shown.filter(label => label === '')).toHaveLength(12)
    const move = '[data-mk-part="card.grid-cell"]:first-child'
    expect(await page.textContent(`${move} [data-mk-part="card.grid-hotkey"]`)).toBe('M')
    await page.waitForSelector(`${move} [data-mk-part="card.grid-image"]:not([hidden])`)
    expect(
      await page.evaluate(() => (globalThis as unknown as { images: string[] }).images),
    ).toEqual(['btn-move'])
    expect(
      await page.getAttribute(
        '[data-mk-part="card.grid-page"][aria-pressed="true"]',
        'aria-pressed',
      ),
    ).toBe('true')
  })

  it('opens a cell subject on click and turns alternatives sharing a cell', async () => {
    await page.click('[data-mk-part="card.grid-face"][aria-label="Siege Mode"]')
    const cycle = '[data-mk-part="card.grid-cell"]:nth-child(2) [data-mk-part="card.grid-cycle"]'
    expect(await page.getAttribute(cycle, 'title')).toContain('2')
    await page.click(cycle)
    expect((await faces())[1]).toBe('Tank Mode')
    await page.click('[data-mk-part="card.grid-face"][aria-label="Tank Mode"]')
    expect(
      await page.evaluate(() => (globalThis as unknown as { navigated: string[] }).navigated),
    ).toEqual(['button:Siege', 'button:Unsiege'])
  })

  it('shows the page a cell opens, and its Cancel goes back', async () => {
    expect(
      await page.getAttribute('[data-mk-part="card.grid-face"][aria-label="Build"]', 'title'),
    ).toBe('Build\nOpens the build menu')
    await page.click('[data-mk-part="card.grid-face"][aria-label="Build"]')
    expect((await faces())[0]).toBe('Barracks')
    expect(await page.textContent('[data-mk-part="card.grid-page"][aria-pressed="true"]')).toBe(
      'Build structure',
    )
    await page.click(
      '[data-mk-part="card.grid-cell"]:nth-child(15) [data-mk-part="card.grid-opens"]',
    )
    expect((await faces())[0]).toBe('Move')
    // a page tab shows its page as well
    await page.click('[data-mk-part="card.grid-page"]:nth-child(2)')
    expect((await faces())[0]).toBe('Barracks')
  })
})
