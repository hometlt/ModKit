/**
 * The embedded viewers work in a real browser, on a page that is not ours.
 *
 * `boot.test.ts` proves the PWA starts; this proves the other consumer of the same open path. It
 * builds the app the way the build script builds it, serves the output over HTTP, loads
 * `embed-demo.html` — a page with its own markup, its own typography and a strict CSP, which
 * imports nothing from the app shell — and asserts the four claims the embedding contract rests on:
 * the viewers mount with the stage their file deserves, a failed fetch says why, the host page's
 * CSP refuses nothing, and no modkit styling escapes the shadow root.
 *
 * Two details are deliberate:
 *
 *  - **It builds into a scratch directory** (`scripts/build.mjs --out`) rather than serving the
 *    committed `dist-app`. Committing `dist-app` is a separate, deliberate act; a test that
 *    depended on it would go red on every source change until someone remembered to rebuild, which
 *    teaches the suite to be ignored. Nothing here writes into the repository.
 *  - **It serves the same output on two ports**, because "the asset base must be same-origin"
 *    is a claim about two origins and cannot be proven with one. The second origin is used for
 *    exactly one assertion: that a cross-origin asset base is refused with a sentence, rather than
 *    hanging on a worker the browser will never let it construct.
 */
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const chromeCandidates = [
  process.env['CHROME_PATH'],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((value): value is string => value !== undefined)

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
}

interface Origin {
  readonly server: Server
  readonly origin: string
  /** Every path this origin was asked for, in order. */
  readonly hits: string[]
}

async function serve(root: string): Promise<Origin> {
  const hits: string[] = []
  const server = createServer((request, response) => {
    const name = (request.url ?? '/').split('?')[0] ?? '/'
    hits.push(name)
    const target = normalize(join(root, name === '/' ? 'index.html' : decodeURIComponent(name)))
    // never serve outside the built app, whatever the request line says
    if (!target.startsWith(root + sep) && target !== root) {
      response.writeHead(403).end()
      return
    }
    void readFile(target).then(
      bytes => {
        response.writeHead(200, {
          'content-type': MIME[extname(target)] ?? 'application/octet-stream',
          // The second origin answers with CORS on purpose: the refusal it proves is *not* a
          // missing header, and a reader should not be able to explain it away as one.
          'access-control-allow-origin': '*',
        })
        response.end(bytes)
      },
      () => response.writeHead(404).end('not found'),
    )
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', done)
  })
  const location = server.address()
  if (location === null || typeof location === 'string') throw new Error('embed server failed')
  return { server, origin: `http://127.0.0.1:${location.port}`, hits }
}

/**
 * The element's own surface as a page sees it.
 *
 * `document.createElement('modkit-viewer')` is typed `HTMLElement` — the registry is a runtime
 * thing — so every probe below narrows through this. Declared once so the assertions read as
 * assertions rather than as casts.
 */
interface ViewerElement extends HTMLElement {
  readonly activeView: string
  readonly views: readonly { readonly id: string; readonly label: string }[]
  file: unknown
}

/** State of one `<modkit-viewer>`, read from the page. */
interface ViewerState {
  readonly id: string
  readonly state: string
  readonly activeView: string
  readonly views: readonly string[]
  readonly status: string
  readonly stageLabel: string
}

let scratch = ''
let pageOrigin: Origin
let otherOrigin: Origin
let browser: Browser
let page: Page
const failures: string[] = []

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'modkit-embed-'))
  /*
   * The real build, into a scratch directory. Synchronous on purpose: nothing else may run while
   * esbuild writes, and vitest's `fileParallelism: false` already means no other suite is live.
   */
  execFileSync(process.execPath, [resolve('apps/web/scripts/build.mjs'), '--out', scratch], {
    cwd: resolve('.'),
    stdio: 'pipe',
  })
  pageOrigin = await serve(scratch)
  otherOrigin = await serve(scratch)
  const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
  if (executablePath === undefined) {
    throw new Error('Chrome/Chromium is required for the embed test')
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage()
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') {
      failures.push(`console: ${message.text()} @ ${message.location().url}`)
    }
  })
  await page.addInitScript(() => {
    const refused: string[] = []
    Object.defineProperty(globalThis, '__cspRefusals', { configurable: true, value: refused })
    document.addEventListener('securitypolicyviolation', event => {
      refused.push(`${event.violatedDirective}:${event.blockedURI || 'inline'}`)
    })
  })
  await page.goto(`${pageOrigin.origin}/embed-demo.html`, { waitUntil: 'load' })
  // Every element settles into `ready`, `error` or `empty`; none is left at `loading`.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('modkit-viewer')].every(node => {
        const state = node.getAttribute('data-mk-state')
        return state !== null && state !== 'loading'
      }),
    undefined,
    { timeout: 90_000 },
  )
}, 180_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(done => pageOrigin?.server.close(() => done()))
  await new Promise<void>(done => otherOrigin?.server.close(() => done()))
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true })
})

const readViewers = async (): Promise<readonly ViewerState[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('modkit-viewer')].map(node => {
      const viewer = node as unknown as ViewerElement
      const shadow = node.shadowRoot
      const stage = shadow?.querySelector('.modkit-embed__stage [data-mk-part="viewer"]')
      return {
        id: node.id,
        state: node.getAttribute('data-mk-state') ?? '',
        activeView: viewer.activeView,
        views: viewer.views.map(view => view.id),
        status: shadow?.querySelector('.modkit-embed__status')?.textContent ?? '',
        stageLabel: stage?.getAttribute('aria-label') ?? '',
      }
    }),
  )

describe('modkit-viewer on a third-party page', () => {
  it('mounts a stage per file, and says why the one that cannot load did not', async () => {
    const viewers = await readViewers()
    const byId = new Map(viewers.map(viewer => [viewer.id, viewer]))

    const roster = byId.get('roster-viewer')
    expect(roster?.state).toBe('ready')
    expect(roster?.activeView).toBe('table')
    expect(roster?.stageLabel).toBe('Table viewer')
    // the picker keeps every other stage the codec published
    expect(roster?.views).toContain('hex')

    const marker = byId.get('marker-viewer')
    expect(marker?.state).toBe('ready')
    expect(marker?.activeView).toBe('vector')

    const thumb = byId.get('thumb-viewer')
    expect(thumb?.state).toBe('ready')
    expect(thumb?.activeView).toBe('image')

    // the honest failure: the reason is in the element, where the file would have been
    const missing = byId.get('missing-viewer')
    expect(missing?.state).toBe('error')
    expect(missing?.status).toMatch(/october-run\.bin.*404/u)
    expect(missing?.activeView).toBe('')
  })

  it('raises no CSP violation under the demo page policy, and no unexpected page error', async () => {
    const refusals = await page.evaluate(
      () => (globalThis as unknown as { __cspRefusals: string[] }).__cspRefusals,
    )
    expect(refusals).toEqual([])
    /*
     * The one console line this page is *supposed* to produce is the 404 it asks for on purpose.
     * Everything else — a page error, a refused resource, a failed worker — is a failure.
     */
    expect(failures.filter(line => !line.includes('october-run.bin'))).toEqual([])
  })

  it('leaks no modkit styling into the host page, and lets none of the page in', async () => {
    const probe = await page.evaluate(() => {
      const lede = document.querySelector('#site-lede')
      const surface = document
        .querySelector('#roster-viewer')
        ?.shadowRoot?.querySelector('.modkit-embed')
      const outside = lede === null ? undefined : getComputedStyle(lede)
      const inside =
        surface === null || surface === undefined ? undefined : getComputedStyle(surface)
      return {
        // no modkit token reaches the host document
        token: getComputedStyle(document.documentElement).getPropertyValue('--mk-color-fg'),
        bodyToken: getComputedStyle(document.body).getPropertyValue('--mk-color-fg'),
        // and no modkit stylesheet is in the host document at all
        sheets: [...document.styleSheets].map(sheet => sheet.href ?? 'inline'),
        outsideFont: outside?.fontFamily ?? '',
        outsideColor: outside?.color ?? '',
        insideFont: inside?.fontFamily ?? '',
        insideColor: inside?.color ?? '',
        // `.site { letter-spacing: .02em }` is inherited, not selected: a shadow root does not
        // stop it, so the element resetting it on `:host` is what keeps it out
        insideLetterSpacing: inside?.letterSpacing ?? '',
      }
    })

    expect(probe.token).toBe('')
    expect(probe.bodyToken).toBe('')
    expect(probe.sheets.some(href => href.includes('modkit-ui.css'))).toBe(false)
    // the host page's own typography is exactly what its stylesheet says
    expect(probe.outsideFont).toContain('Georgia')
    expect(probe.outsideColor).toBe('rgb(106, 95, 82)')
    // and modkit's is modkit's
    expect(probe.insideFont).not.toContain('Georgia')
    expect(probe.insideColor).not.toBe(probe.outsideColor)
    expect(probe.insideLetterSpacing).toBe('normal')
  })

  it('composes one host per asset base, however many elements there are', async () => {
    const elements = await page.evaluate(
      () => document.querySelectorAll('modkit-viewer[src]').length,
    )
    expect(elements).toBeGreaterThan(1)
    /*
     * The stylesheet is fetched once per host, so counting its requests counts compositions. Four
     * elements, one asset base, one request — a per-element host would have asked four times (and
     * spawned four inventories' worth of workers behind them).
     */
    expect(pageOrigin.hits.filter(name => name.endsWith('/modkit-ui.css'))).toHaveLength(1)
  })

  it('runs the codecs through the worker entry and the attested artifacts, not on the page', () => {
    /*
     * What the page actually asked the server for is the evidence. The module worker entry was
     * fetched, and so were the extension files the catalog attests — which is the open path the
     * workbench uses. `main.js` was never asked for: this page loads the element entry alone, so
     * nothing about the app shell is implicated in what the reader sees above.
     */
    expect(pageOrigin.hits).toContain('/worker-entry.js')
    expect(pageOrigin.hits.some(name => name.startsWith('/extensions/'))).toBe(true)
    expect(pageOrigin.hits).toContain('/embed.js')
    expect(pageOrigin.hits).not.toContain('/main.js')
  })

  it('still shows a file no codec claims, through the built-in fallback', async () => {
    const unknown = await page.evaluate(async () => {
      const node = document.createElement('modkit-viewer') as unknown as ViewerElement
      node.file = new File([new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253])], 'mystery.zzz')
      document.body.append(node)
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const state = node.getAttribute('data-mk-state')
        if (state === 'ready' || state === 'error') break
        await new Promise(done => setTimeout(done, 100))
      }
      const answer = {
        state: node.getAttribute('data-mk-state') ?? '',
        activeView: node.activeView,
        views: node.views.map(view => view.id),
      }
      node.remove()
      return answer
    })
    // binary bytes: the built-in session publishes no text source, so hex is all there is — and
    // "unknown format" still means "look at it" rather than an empty element
    expect(unknown.state).toBe('ready')
    expect(unknown.views).toEqual(['hex'])
    expect(unknown.activeView).toBe('hex')
  })

  it('switches a stage from the picker', async () => {
    const switched = await page.evaluate(async () => {
      const node = document.querySelector('#roster-viewer') as ViewerElement | null
      const picker = node?.shadowRoot?.querySelector('.modkit-embed__picker')
      if (node === null || !(picker instanceof HTMLSelectElement)) return undefined
      const before = node.activeView
      picker.value = 'hex'
      picker.dispatchEvent(new Event('change'))
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (node.activeView === 'hex') break
        await new Promise(done => setTimeout(done, 100))
      }
      const stage = node.shadowRoot?.querySelector('.modkit-embed__stage [data-mk-part="viewer"]')
      return { before, after: node.activeView, label: stage?.getAttribute('aria-label') ?? '' }
    })
    expect(switched).toEqual({ before: 'table', after: 'hex', label: 'Hex viewer' })
  })

  it('honours a preferred view, and falls back to the resolver default when it cannot', async () => {
    const chosen = await page.evaluate(async () => {
      const settle = async (node: Element): Promise<string> => {
        for (let attempt = 0; attempt < 200; attempt += 1) {
          const state = node.getAttribute('data-mk-state')
          if (state === 'ready' || state === 'error') return state
          await new Promise(done => setTimeout(done, 100))
        }
        return node.getAttribute('data-mk-state') ?? ''
      }
      const make = (view: string): ViewerElement => {
        const node = document.createElement('modkit-viewer') as unknown as ViewerElement
        node.setAttribute('src', './samples/sample.csv')
        node.setAttribute('view', view)
        document.body.append(node)
        return node
      }
      // a stage this subject really publishes, one that exists but does not apply, one that is not
      // a stage id at all
      const preferred = make('hex')
      const inapplicable = make('image')
      const nonsense = make('not-a-stage')
      const answer = {
        preferred: [await settle(preferred), preferred.activeView],
        inapplicable: [await settle(inapplicable), inapplicable.activeView],
        nonsense: [await settle(nonsense), nonsense.activeView],
      }
      for (const node of [preferred, inapplicable, nonsense]) node.remove()
      return answer
    })
    expect(chosen.preferred).toEqual(['ready', 'hex'])
    expect(chosen.inapplicable).toEqual(['ready', 'table'])
    expect(chosen.nonsense).toEqual(['ready', 'table'])
  })

  it('opens bytes handed to it directly, without a src', async () => {
    const inline = await page.evaluate(async () => {
      const node = document.createElement('modkit-viewer') as unknown as ViewerElement
      node.file = new File(['id,name\n1,Nova\n'], 'inline.csv', { type: 'text/csv' })
      document.body.append(node)
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const state = node.getAttribute('data-mk-state')
        if (state === 'ready' || state === 'error') break
        await new Promise(done => setTimeout(done, 100))
      }
      const answer = {
        state: node.getAttribute('data-mk-state') ?? '',
        activeView: node.activeView,
        title: node.shadowRoot?.querySelector('.modkit-embed__title')?.textContent ?? '',
      }
      node.remove()
      return answer
    })
    expect(inline).toEqual({ state: 'ready', activeView: 'table', title: 'inline.csv' })
  })

  it('refuses a cross-origin asset base with a reason instead of hanging on it', async () => {
    const refused = await page.evaluate(async other => {
      const node = document.createElement('modkit-viewer')
      node.setAttribute('asset-base', `${other}/`)
      node.setAttribute('src', './samples/sample.csv')
      document.body.append(node)
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (node.getAttribute('data-mk-state') === 'error') break
        await new Promise(done => setTimeout(done, 100))
      }
      const answer = {
        state: node.getAttribute('data-mk-state') ?? '',
        status: node.shadowRoot?.querySelector('.modkit-embed__status')?.textContent ?? '',
      }
      node.remove()
      return answer
    }, otherOrigin.origin)
    expect(refused.state).toBe('error')
    expect(refused.status).toContain('cross-origin')
    expect(refused.status).toContain(otherOrigin.origin)
    // and it never went near the other origin: the refusal is decided before anything is fetched
    expect(otherOrigin.hits).toEqual([])
  })
})
