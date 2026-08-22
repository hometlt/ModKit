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
 *  - **It serves the same output on two ports**, because every origin claim in the contract is a
 *    claim about two origins and cannot be proven with one. The second origin carries three
 *    assertions: a cross-origin *asset base* is refused with a sentence rather than hanging on a
 *    worker the browser will never let it construct; a cross-origin *src* opens when it is
 *    CORS-served and the page's `connect-src` names its origin; and the same file fails, with the
 *    URL and both conditions stated, when the policy does not.
 */
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'
import { VIEWER_CSP_TEXT } from '@modkitx-x3/ui'
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
  fileHandle: unknown
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
  // The deployer chooses the remote-catalog origins before building. Starting this origin first
  // gives the build the exact origin (including its random port) to compile into embed.js.
  otherOrigin = await serve(scratch)
  /*
   * The real build, into a scratch directory. Synchronous on purpose: nothing else may run while
   * esbuild writes, and vitest's `fileParallelism: false` already means no other suite is live.
   */
  execFileSync(process.execPath, [resolve('apps/web/scripts/build.mjs'), '--out', scratch], {
    cwd: resolve('.'),
    env: { ...process.env, MODKIT_EMBED_EXTENSION_ORIGINS: otherOrigin.origin },
    stdio: 'pipe',
  })
  writeFileSync(
    join(scratch, 'remote-catalog.json'),
    JSON.stringify({ schemaVersion: 1, extensions: [], excluded: [] }),
  )
  /*
   * The same page again, under the policy `packages/ui` publishes for a viewer host. An embedding
   * page that already applies `VIEWER_CSP` should need no relaxation to embed one of these, and
   * this is the assertion that keeps that true: change the policy in a way that breaks embedding
   * and it goes red here, in the app that noticed.
   */
  const demo = readFileSync(join(scratch, 'embed-demo.html'), 'utf8')
  const declared = /content="(default-src[^"]*)"/u.exec(demo)?.[1]
  if (declared === undefined) throw new Error('the demo page no longer declares a CSP to replace')
  writeFileSync(
    join(scratch, 'embed-demo-viewer-csp.html'),
    demo.replace(declared, VIEWER_CSP_TEXT),
  )
  pageOrigin = await serve(scratch)
  /*
   * A third variant, written once the second origin has a port: same page, but its `connect-src`
   * also names that origin. `src` is the one URL an element fetches that need not be same-origin,
   * and «CORS-served is enough» is only half true — the *embedding page's* policy has to allow the
   * origin too. One variant proves each half.
   */
  writeFileSync(
    join(scratch, 'embed-demo-cors.html'),
    demo.replace(
      declared,
      declared.replace("connect-src 'self'", `connect-src 'self' ${otherOrigin.origin}`),
    ),
  )
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

  it('saves through an explicitly delegated File System Access handle', async () => {
    const saved = await page.evaluate(async () => {
      let contents = 'id,name\n1,Nova\n'
      let modified = 1
      const handle = {
        kind: 'file' as const,
        name: 'delegated.csv',
        async getFile() {
          return new File([contents], this.name, { type: 'text/csv', lastModified: modified })
        },
        async queryPermission() {
          return 'granted' as const
        },
        async requestPermission() {
          return 'granted' as const
        },
        async createWritable() {
          let replacement = new Uint8Array()
          return {
            async write(bytes: Uint8Array) {
              replacement = bytes.slice()
            },
            async close() {
              contents = new TextDecoder().decode(replacement)
              modified += 1
            },
            async abort() {
              replacement = new Uint8Array()
            },
          }
        },
      }
      const node = document.createElement('modkit-viewer') as unknown as ViewerElement
      node.fileHandle = handle
      node.setAttribute('view', 'text-editor')
      document.body.append(node)
      for (let attempt = 0; attempt < 300; attempt += 1) {
        if (node.getAttribute('data-mk-state') === 'ready' && node.activeView === 'text-editor')
          break
        await new Promise(done => setTimeout(done, 100))
      }
      const input = node.shadowRoot?.querySelector('textarea')
      const button = node.shadowRoot?.querySelector('[data-modkit-action="save"]')
      if (!(input instanceof HTMLTextAreaElement) || !(button instanceof HTMLButtonElement)) {
        return {
          state: node.getAttribute('data-mk-state') ?? '',
          view: node.activeView,
          views: node.views.map(view => view.id),
          contents,
          editor: false,
        }
      }
      input.value = 'id,name\n1,Raynor\n'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      button.click()
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const status = node.shadowRoot?.querySelector('[data-mk-part="viewer.status"]')?.textContent
        if (status === 'Saved') break
        await new Promise(done => setTimeout(done, 50))
      }
      const answer = {
        state: node.getAttribute('data-mk-state') ?? '',
        view: node.activeView,
        views: node.views.map(view => view.id),
        contents,
        editor: true,
      }
      node.remove()
      return answer
    })
    expect(saved).toMatchObject({
      state: 'ready',
      view: 'text-editor',
      editor: true,
      contents: 'id,name\n1,Raynor\n',
    })
    expect(saved.views).toContain('text-editor')
    expect(saved.views).toContain('hex-editor')
  }, 90_000)

  it('works verbatim under the VIEWER_CSP the ui package publishes', async () => {
    const strict = await browser.newPage()
    const refused: string[] = []
    strict.on('pageerror', error => refused.push(`pageerror: ${error.message}`))
    await strict.addInitScript(() => {
      const seen: string[] = []
      Object.defineProperty(globalThis, '__cspRefusals', { configurable: true, value: seen })
      document.addEventListener('securitypolicyviolation', event => {
        seen.push(`${event.violatedDirective}:${event.blockedURI || 'inline'}`)
      })
    })
    await strict.goto(`${pageOrigin.origin}/embed-demo-viewer-csp.html`, { waitUntil: 'load' })
    await strict.waitForFunction(
      () =>
        [...document.querySelectorAll('modkit-viewer')].every(node => {
          const state = node.getAttribute('data-mk-state')
          return state !== null && state !== 'loading'
        }),
      undefined,
      { timeout: 60_000 },
    )
    const answer = await strict.evaluate(() => ({
      ready: [...document.querySelectorAll('modkit-viewer[src]')]
        .filter(node => node.getAttribute('data-mk-state') === 'ready')
        .map(node => node.id),
      refusals: (globalThis as unknown as { __cspRefusals: string[] }).__cspRefusals,
    }))
    await strict.close()
    expect(answer.refusals).toEqual([])
    expect(answer.ready).toEqual(['roster-viewer', 'marker-viewer', 'thumb-viewer'])
    expect(refused).toEqual([])
  })

  /** Open one page, add one element, wait for it to settle, and report what it and the CSP said. */
  const probeSrc = async (
    pageName: string,
    src: string,
  ): Promise<{
    readonly state: string
    readonly view: string
    readonly status: string
    readonly refusals: readonly string[]
  }> => {
    const probe = await browser.newPage()
    await probe.addInitScript(() => {
      const seen: string[] = []
      Object.defineProperty(globalThis, '__cspRefusals', { configurable: true, value: seen })
      document.addEventListener('securitypolicyviolation', event => {
        seen.push(`${event.violatedDirective}:${event.blockedURI || 'inline'}`)
      })
    })
    await probe.goto(`${pageOrigin.origin}/${pageName}`, { waitUntil: 'load' })
    const answer = await probe.evaluate(async target => {
      const node = document.createElement('modkit-viewer') as unknown as ViewerElement
      node.setAttribute('src', target)
      document.body.append(node)
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const state = node.getAttribute('data-mk-state')
        if (state === 'ready' || state === 'error') break
        await new Promise(done => setTimeout(done, 100))
      }
      return {
        state: node.getAttribute('data-mk-state') ?? '',
        view: node.activeView,
        status: node.shadowRoot?.querySelector('.modkit-embed__status')?.textContent ?? '',
        refusals: (globalThis as unknown as { __cspRefusals: string[] }).__cspRefusals,
      }
    }, src)
    await probe.close()
    return answer
  }

  const probeCatalog = async (
    catalogUrl: string,
    pageAddedOrigin?: string,
  ): Promise<{ readonly state: string; readonly status: string }> => {
    const probe = await browser.newPage()
    await probe.goto(`${pageOrigin.origin}/embed-demo-cors.html`, { waitUntil: 'load' })
    const answer = await probe.evaluate(
      async ({ catalogUrl: target, pageAddedOrigin: attempted }) => {
        const node = document.createElement('modkit-viewer')
        node.setAttribute('src', './samples/sample.csv')
        node.setAttribute('extension-catalog', target)
        // Deliberately meaningless: the component has no page-owned allowlist input.
        if (attempted !== undefined) node.setAttribute('extension-origins', attempted)
        document.body.append(node)
        for (let attempt = 0; attempt < 300; attempt += 1) {
          const state = node.getAttribute('data-mk-state')
          if (state === 'ready' || state === 'error') break
          await new Promise(done => setTimeout(done, 100))
        }
        return {
          state: node.getAttribute('data-mk-state') ?? '',
          status: node.shadowRoot?.querySelector('.modkit-embed__status')?.textContent ?? '',
        }
      },
      { catalogUrl, pageAddedOrigin },
    )
    await probe.close()
    return answer
  }

  it('loads a catalog from the origin compiled into embed.js', async () => {
    const answer = await probeCatalog(`${otherOrigin.origin}/remote-catalog.json`)
    expect(answer).toEqual({ state: 'ready', status: '' })
    expect(otherOrigin.hits.filter(path => path === '/remote-catalog.json')).toHaveLength(1)
  })

  it('refuses a page-added catalog origin before fetching it', async () => {
    const attacker = 'https://extensions.invalid'
    const answer = await probeCatalog(`${attacker}/catalog.json`, attacker)
    expect(answer.state).toBe('error')
    expect(answer.status).toContain(attacker)
    expect(answer.status).toContain('build-time allowlist')
    expect(answer.status).toContain('cannot add an origin')
  })

  it('opens a cross-origin src when it is CORS-served and the page policy allows the origin', async () => {
    const answer = await probeSrc(
      'embed-demo-cors.html',
      `${otherOrigin.origin}/samples/sample.csv`,
    )
    expect(answer.state).toBe('ready')
    expect(answer.view).toBe('table')
    expect(answer.refusals).toEqual([])
  })

  it('states the failure when the page policy does not allow that origin', async () => {
    /*
     * The same file, CORS-served just as generously, on the page whose `connect-src` is `'self'`.
     * The element cannot fetch it and says so where the file would have been; the browser records
     * the reason it could not. This is the other half of «same-origin or CORS-served»: the
     * embedding page's own policy is the second gate, and no header on the file's server opens it.
     */
    const answer = await probeSrc('embed-demo.html', `${otherOrigin.origin}/samples/sample.csv`)
    expect(answer.state).toBe('error')
    // the URL and both gates, because a rejected fetch says only «Failed to fetch» on its own
    expect(answer.status).toContain(otherOrigin.origin)
    expect(answer.status).toContain('connect-src')
    expect(answer.refusals.some(line => line.startsWith('connect-src'))).toBe(true)
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
    /*
     * And it never asked that origin for an asset: the refusal is decided before anything is
     * fetched. (The `src` probes above did fetch a sample from there, which is a different URL and
     * a different rule — hence naming the assets rather than asserting silence.)
     */
    const assets = otherOrigin.hits.filter(
      name =>
        name.endsWith('.js') ||
        name.endsWith('modkit-ui.css') ||
        name.startsWith('/extensions/') ||
        name.startsWith('/vendor/'),
    )
    expect(assets).toEqual([])
  })
})
