/**
 * The PWA boots.
 *
 * Every other test in this app exercises a module against structural fakes; none of them loads the
 * built page. That gap is not theoretical — a composition-root mistake (reading a binding in a
 * callback the panel invokes before that binding is initialised) shipped a build whose every unit
 * test passed and whose first line in a browser was
 * `Boot failed: Cannot access 'services' before initialization`. Nothing in the gate could see it.
 *
 * So this test builds the app into a scratch directory exactly as the product build does and loads
 * it in a real Chromium: the workbench mounts, the boot placeholder is gone, and nothing was
 * refused by the page's own CSP. `dist-app` is deliberately not a source artifact and the test must
 * not silently validate an older committed copy. It asserts that the app *starts*, not what it can
 * do — the rest of the suite covers that, and a smoke test that grows features stops being a smoke
 * test.
 */
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

let dist = ''
let server: Server
let browser: Browser
let origin = ''
const servedRequests: string[] = []

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'modkit-web-boot-'))
  execFileSync(process.execPath, [resolve('apps/web/scripts/build.mjs'), '--out', dist], {
    cwd: resolve('.'),
    stdio: 'pipe',
  })
  server = createServer((request, response) => {
    const name = (request.url ?? '/').split('?')[0] ?? '/'
    servedRequests.push(name)
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
  if (dist !== '') rmSync(dist, { recursive: true, force: true })
})

describe('PWA boot', () => {
  it('mounts the workbench from the current product build, with no boot failure and no CSP refusal', async () => {
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

    await page.goto(`${origin}/?lang=en`, { waitUntil: 'load' })
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
    const settings = page.getByRole('button', { name: 'Settings' })
    await settings.waitFor({ state: 'visible', timeout: 120_000 })
    await settings.click()
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
    expect(state.extensions).toContain('Downloadable extensions')
    expect(state.extensions).toContain('Check available extensions')
    expect(state.refusals).toEqual([])
    /*
     * The service worker cannot register in every embedded browser, and that is a property of the
     * environment rather than of this build, so its warning is not a failure here.
     */
    expect(failures).toEqual([])
    await page.close()
  }, 120_000)

  it('boots the Russian catalog and its explicit self-hosted Cyrillic face', async () => {
    const page = await browser.newPage({ colorScheme: 'dark' })
    const failures: string[] = []
    page.on('pageerror', error => failures.push(error.message))
    await page.goto(`${origin}/?lang=ru`, { waitUntil: 'load' })
    await page.waitForSelector('[data-mk-part="workbench"]', { timeout: 60_000 })
    const settings = page.getByRole('button', { name: 'Настройки' })
    await settings.waitFor({ state: 'visible', timeout: 120_000 })
    await settings.click()
    await page.waitForSelector('.web-settings-view', { timeout: 30_000 })
    const state = await page.evaluate(async () => {
      await document.fonts.ready
      const root = document.documentElement
      return {
        lang: root.lang,
        title: document.title,
        settings: document.querySelector('.web-settings-view')?.textContent ?? '',
        host: document.querySelector('.web-host-panel')?.textContent ?? '',
        fontStack: getComputedStyle(document.body).fontFamily,
        cyrillicFace: document.fonts.check('16px "Modkit Cyrillic UI"', 'Русский'),
      }
    })
    expect(state).toMatchObject({
      lang: 'ru',
      title: 'Modkit MK3',
      cyrillicFace: true,
    })
    expect(state.settings).toContain('Встроенные расширения')
    expect(state.host).toContain('Возможности')
    expect(state.fontStack).toContain('Modkit Cyrillic UI')
    expect(failures).toEqual([])
    await page.close()
  }, 120_000)

  it('closes a worker-backed page and opens the same subject in a fresh page', async () => {
    const failures: string[] = []
    const openSubjectPage = async () => {
      const page = await browser.newPage({ colorScheme: 'dark' })
      page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
      page.on('console', message => {
        if (message.type() === 'error') failures.push(`console: ${message.text()}`)
      })
      await page.goto(`${origin}/?open=./favicon-32.png`, { waitUntil: 'load' })
      await page.waitForSelector('[data-mk-part="explorer.filetab"]', { timeout: 60_000 })
      return page
    }
    const waitForWorkerRequestAfter = async (before: number): Promise<number> => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const current = servedRequests.filter(path => path === '/worker-entry.js').length
        if (current > before) return current
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return servedRequests.filter(path => path === '/worker-entry.js').length
    }

    const beforeFirstOpen = servedRequests.filter(path => path === '/worker-entry.js').length
    const first = await openSubjectPage()
    const afterFirstOpen = await waitForWorkerRequestAfter(beforeFirstOpen)
    expect(afterFirstOpen).toBeGreaterThan(beforeFirstOpen)
    await first.close()

    const second = await openSubjectPage()
    const afterSecondOpen = await waitForWorkerRequestAfter(afterFirstOpen)
    expect(afterSecondOpen).toBeGreaterThan(afterFirstOpen)
    expect(
      failures.filter(line => !/ServiceWorker|service-worker|Failed to register/u.test(line)),
    ).toEqual([])
    await second.close()
  }, 120_000)

  it('offers a manual whole-session restart after a worker crash and does not restart by itself', async () => {
    const page = await browser.newPage({ colorScheme: 'dark' })
    let navigations = 0
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) navigations += 1
    })
    await page.route('**/worker-entry.js', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: "throw new Error('forced worker crash for recovery smoke')",
      })
    })

    await page.goto(`${origin}/?open=./favicon-32.png&lang=en`, { waitUntil: 'load' })
    const restart = page.getByRole('button', { name: 'Restart session' })
    await restart.waitFor({ state: 'visible', timeout: 60_000 })
    const beforeClick = navigations
    await page.waitForTimeout(500)
    expect(navigations).toBe(beforeClick)

    await page.unroute('**/worker-entry.js')
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), restart.click()])
    await page.waitForSelector('[data-mk-part="workbench"]', { timeout: 60_000 })
    expect(navigations).toBeGreaterThan(beforeClick)
    await page.close()
  }, 120_000)
})
