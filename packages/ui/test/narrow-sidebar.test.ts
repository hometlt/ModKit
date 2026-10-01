/**
 * A subject card and a tree row in a sidebar as narrow as the world viewer's: a field's value keeps
 * a readable width, and a tree key keeps its place beside the value (v83: one character to a line,
 * a chevron drawn over «128 × 128»).
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

describe('a narrow sidebar', () => {
  it('keeps a card value readable, with its sources under it', async () => {
    const width = await page.evaluate(() => {
      const probe = globalThis as unknown as {
        createSubjectCard(document: Document, options: unknown): { root: HTMLElement }
      }
      const card = probe.createSubjectCard(document, {
        label: 'Amphion-copy.SC2Map',
        header: false,
        sections: [
          {
            kind: 'fields',
            id: 'package',
            title: 'Package',
            expanded: true,
            fields: [
              {
                name: 'Revision',
                value: 'map provider-token:1712487449-5629421',
                sources: [{ label: 'Amphion-copy.SC2Map', href: 'file:///map' }],
              },
            ],
          },
        ],
      })
      document.querySelector('#side')?.append(card.root)
      const value = document.querySelector('[data-mk-part="card.field-value"]')
      return value?.getBoundingClientRect().width ?? 0
    })
    // the row stacks: the value takes the card's width, not what two other columns leave it
    expect(width).toBeGreaterThan(160)
  })

  it('keeps a tree key beside its value instead of under it', async () => {
    const overlap = await page.evaluate(() => {
      const make = (tag: string, part: string, text = '') => {
        const node = document.createElement(tag)
        node.setAttribute('data-mk-part', part)
        node.textContent = text
        return node
      }
      const item = make('div', 'tree.item')
      const row = make('div', 'tree.row')
      const key = make('div', 'tree.key')
      const twisty = make('span', 'tree.twisty', '›')
      key.append(twisty, make('button', 'tree.label', 'Dune 2000 map'))
      const value = make('span', 'tree.value', '128 × 128')
      row.append(key, value)
      item.append(row)
      const side = document.querySelector('#side')
      side?.replaceChildren(item)
      return twisty.getBoundingClientRect().right - value.getBoundingClientRect().left
    })
    expect(overlap).toBeLessThanOrEqual(0)
  })
})
