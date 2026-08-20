/**
 * The PWA boots.
 *
 * Every other test in this app exercises a module against structural fakes; none of them loads the
 * built page. That gap is not theoretical — a composition-root mistake (reading a binding in a
 * callback the panel invokes before that binding is initialised) shipped a build whose every unit
 * test passed and whose first line in a browser was
 * `Boot failed: Cannot access 'services' before initialization`. Nothing in the gate could see it.
 *
 * So this test serves the committed `dist-app` exactly as the build script does and loads it in a
 * real Chromium: the workbench mounts, the boot placeholder is gone, and nothing was refused by the
 * page's own CSP. It asserts that the app *starts*, not what it can do — the rest of the suite
 * covers that, and a smoke test that grows features stops being a smoke test.
 */
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { chromium, type Browser } from 'playwright-core'
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
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

const dist = resolve('apps/web/dist-app')
let server: Server
let browser: Browser
let origin = ''

beforeAll(async () => {
  server = createServer((request, response) => {
    const name = (request.url ?? '/').split('?')[0] ?? '/'
    const target = normalize(join(dist, name === '/' ? 'index.html' : name))
    // never serve outside the built app, whatever the request line says
    if (!target.startsWith(dist + sep) && target !== dist) {
      response.writeHead(403).end()
      return
    }
    void readFile(target).then(
      bytes => {
        response.writeHead(200, {
          'content-type': MIME[extname(target)] ?? 'application/octet-stream',
        })
        response.end(bytes)
      },
      () => response.writeHead(404).end(),
    )
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', done)
  })
  const location = server.address()
  if (location === null || typeof location === 'string') throw new Error('boot server failed')
  origin = `http://127.0.0.1:${location.port}`
  const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
  if (executablePath === undefined) throw new Error('Chrome/Chromium is required for the boot test')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(done => server?.close(() => done()))
})

describe('PWA boot', () => {
  it('mounts the workbench from the committed build, with no boot failure and no CSP refusal', async () => {
    const page = await browser.newPage({ colorScheme: 'dark' })
    const failures: string[] = []
    page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
    page.on('console', message => {
      if (message.type() === 'error') failures.push(`console: ${message.text()}`)
    })
    await page.addInitScript(() => {
      const refused: string[] = []
      Object.defineProperty(globalThis, '__cspRefusals', { configurable: true, value: refused })
      document.addEventListener('securitypolicyviolation', event => {
        refused.push(`${event.violatedDirective}:${event.blockedURI || 'inline'}`)
      })
    })

    await page.goto(origin, { waitUntil: 'load' })
    await page.waitForSelector('[data-mk-part="workbench"]', { timeout: 60_000 })

    const booted = await page.evaluate(() => ({
      booting: document.querySelector('.booting')?.textContent ?? '',
      explorer: document.querySelector('[data-mk-part="explorer"]') !== null,
      host: document.querySelector('.web-host-panel') !== null,
    }))

    /*
     * Open Settings the way a user does. The settings view is attached when it is shown, so
     * querying for the panel on the boot screen would assert nothing — and the point of this
     * assertion is that the user-extensions panel is part of the shell rather than an export
     * nobody mounted.
     */
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForSelector('.web-extensions-view', { timeout: 30_000 })

    const state = await page.evaluate(() => ({
      extensions: document.querySelector('.web-extensions-view')?.textContent ?? '',
      refusals: (globalThis as unknown as { __cspRefusals: string[] }).__cspRefusals,
    }))

    // the placeholder the page ships with is replaced, not merely hidden
    expect(booted.booting).toBe('')
    expect(booted.explorer).toBe(true)
    expect(booted.host).toBe(true)
    // and the panel states the trust model rather than only listing folders
    expect(state.extensions).toMatch(/picked it|trusted because/u)
    expect(state.refusals).toEqual([])
    /*
     * The service worker cannot register in every embedded browser, and that is a property of the
     * environment rather than of this build, so its warning is not a failure here.
     */
    expect(
      failures.filter(line => !/ServiceWorker|service-worker|Failed to register/u.test(line)),
    ).toEqual([])
    await page.close()
  }, 120_000)
})
