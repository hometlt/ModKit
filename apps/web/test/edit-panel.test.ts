/**
 * The Edit panel, driven by a browser, over real codecs, writing real bytes.
 *
 * `boot.test.ts` proves the PWA starts and `embed.test.ts` proves the embedded viewers work on a
 * page that is not ours. This proves the one thing neither can: that a person can open a file in
 * this app, change it through a codec's own mutating operation, and end up with a file on the other
 * side of a File System Access handle that really holds the change — ADR-HOST-002 Path A, end to
 * end, in a page.
 *
 * **What is faked, and only what is faked.** `showOpenFilePicker` needs a user gesture an automated
 * run cannot produce, so this substitutes exactly the one thing that gesture would have produced: a
 * handle with `createWritable()`, over bytes fetched from the app's own origin. Everything else is
 * real — the real build, the real module workers, the real bundled codecs, the real stage list, the
 * real editing backend and commit coordinator, the real DOM events a person's clicks raise. The
 * test then clicks the app's own controls: "Open file…", the Edit panel's picker, its inputs and
 * its Apply button. What it cannot prove is the browser's own permission dialog.
 *
 * **What each claim rests on.** The UI is asserted *and* the bytes are: every write the fake handle
 * accepts is logged, and the assertions read that log rather than trusting the panel's own report.
 * A panel that said "applied" over an unchanged file would pass the first half and fail the second.
 *
 * The cases are one session, in order — a person opening files, changing them and looking at the
 * result — rather than six independent fixtures. The second edit is meaningful only because the
 * first one landed, and "the form now opens on the value the file carries" is only a claim once
 * something wrote that value. Running one case alone will not reproduce it.
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
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
}

/** One write the fake handle accepted, as the page logged it. */
interface HandleWrite {
  readonly name: string
  readonly bytes: readonly number[]
}

let scratch = ''
let server: Server
let browser: Browser
let page: Page
let origin = ''
const failures: string[] = []

const EDIT_PANEL = 'section[aria-label="Edit"]'
const ADDED = 'added-by-the-panel.txt'
/** No newline: the panel collects a payload through a single-line control, and says so. */
const ADDED_TEXT = 'added by the live Edit panel test'
const PNG_TEXT = 'set by the live Edit panel test'
const MP3_TEXT = 'Silent proof from the live Edit panel test'

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'modkit-edit-panel-'))
  /*
   * The real build, into a scratch directory rather than the committed `dist-app`: committing that
   * is a separate, deliberate act, and a test that depended on it would go red on every source
   * change until someone remembered to rebuild. Synchronous on purpose — nothing else may run while
   * esbuild writes, and `fileParallelism: false` already means no other suite is live.
   */
  execFileSync(process.execPath, [resolve('apps/web/scripts/build.mjs'), '--out', scratch], {
    cwd: resolve('.'),
    stdio: 'pipe',
  })
  server = createServer((request, response) => {
    const name = (request.url ?? '/').split('?')[0] ?? '/'
    const target = normalize(join(scratch, name === '/' ? 'index.html' : decodeURIComponent(name)))
    // never serve outside the built app, whatever the request line says
    if (!target.startsWith(scratch + sep) && target !== scratch) {
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
  if (location === null || typeof location === 'string') throw new Error('edit-panel server failed')
  origin = `http://127.0.0.1:${location.port}`

  const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
  if (executablePath === undefined) {
    throw new Error('Chrome/Chromium is required for the Edit panel test')
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage({ colorScheme: 'dark' })
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`)
  })

  /*
   * The one substitution. A queued pick is fetched from the app's own origin and handed back behind
   * a handle that behaves like the File System Access one: `getFile()` always reports the file as
   * it is *now* (so the revision guard sees a write move it) and `createWritable()` accumulates
   * chunks, replacing the content on close and logging exactly what was written.
   */
  await page.addInitScript(() => {
    const queue: { readonly path: string; readonly name: string }[] = []
    const writes: { name: string; bytes: number[] }[] = []
    const scope = globalThis as unknown as {
      __queuePick(path: string, name: string): void
      __handleWrites: { name: string; bytes: number[] }[]
      showOpenFilePicker?: unknown
    }
    scope.__queuePick = (path, name) => void queue.push({ path, name })
    scope.__handleWrites = writes
    scope.showOpenFilePicker = async () => {
      const request = queue.shift()
      if (request === undefined) throw new Error('no file was queued for the picker')
      const response = await fetch(request.path)
      if (!response.ok) throw new Error(`${request.path} answered ${response.status}`)
      let content = new Uint8Array(await response.arrayBuffer())
      let modified = 1_000
      return [
        {
          kind: 'file',
          name: request.name,
          async getFile() {
            return new File([content], request.name, { lastModified: modified })
          },
          async createWritable() {
            const chunks: Uint8Array[] = []
            return {
              async write(data: Uint8Array) {
                chunks.push(data.slice())
              },
              async close() {
                const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
                const next = new Uint8Array(total)
                let at = 0
                for (const chunk of chunks) {
                  next.set(chunk, at)
                  at += chunk.byteLength
                }
                content = next
                // a real write moves the mtime, which is what the revision guard reads
                modified += 1
                writes.push({ name: request.name, bytes: [...next] })
              },
            }
          },
          async queryPermission() {
            return 'granted'
          },
          async requestPermission() {
            return 'granted'
          },
        },
      ]
    }
  })

  await page.goto(`${origin}/?lang=en`, { waitUntil: 'load' })
  await page.waitForSelector('[data-mk-part="workbench"]', { timeout: 60_000 })
  // the inspector region is hidden on boot; the user opens it with the activity bar
  const inspectorButton = page.getByRole('button', {
    name: 'Show or hide diagnostics and operations',
  })
  await inspectorButton.waitFor({ state: 'visible', timeout: 120_000 })
  await inspectorButton.click()
  await page.waitForSelector('[data-mk-part="workbench.panel"]:not([hidden])', { timeout: 30_000 })
}, 300_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(done => server?.close(() => done()))
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------------------------
// driving the app's own controls

/** Open a file through the app's own "Open file…" button, with a writable handle behind it. */
const pickFile = async (path: string, name: string): Promise<void> => {
  await page.evaluate(
    ([target, label]) => {
      ;(globalThis as unknown as { __queuePick(path: string, name: string): void }).__queuePick(
        target ?? '',
        label ?? '',
      )
    },
    [path, name],
  )
  await page.getByTitle('Open a single file in a new tab').click()
  await page.waitForFunction(
    label =>
      [...document.querySelectorAll('[data-mk-part="explorer.filetab"]')].some(
        node => node.getAttribute('title') === label,
      ),
    name,
    { timeout: 60_000 },
  )
}

const closeAllTabs = async (): Promise<void> => {
  const closers = page.locator('[data-mk-part="explorer.filetab-close"]')
  for (let guard = 0; guard < 12 && (await closers.count()) > 0; guard += 1) {
    await closers.first().click()
    await page.waitForTimeout(150)
  }
  await page.waitForFunction(
    () => document.querySelectorAll('[data-mk-part="explorer.filetab"]').length === 0,
    undefined,
    { timeout: 30_000 },
  )
}

/** Wait until the Edit panel is mounted and offering forms for the focused tab. */
const waitForEditPanel = async (): Promise<void> => {
  await page.waitForFunction(
    () =>
      document.querySelector('section[aria-label="Edit"] [data-mk-part="form.select"]') !== null,
    undefined,
    { timeout: 60_000 },
  )
}

const applyForm = async (formId: string, values: Record<string, string>): Promise<void> => {
  await page.locator(`${EDIT_PANEL} [data-mk-part="form.select"]`).selectOption(formId)
  for (const [name, value] of Object.entries(values)) {
    await page.locator(`${EDIT_PANEL} [data-mk-part="form.input"][name="${name}"]`).fill(value)
  }
  await page.locator(`${EDIT_PANEL} [data-mk-part="form.button"]`).click()
}

/**
 * Wait for a sentence to appear anywhere in the (possibly remounted) Edit panel.
 *
 * A timeout reports what the panel actually said instead of only what it did not: every refusal in
 * this feature arrives as words in that panel, so the failure message is the diagnosis.
 */
const waitForPanelText = async (needle: string, timeout = 90_000): Promise<void> => {
  try {
    await page.waitForFunction(
      text =>
        (document.querySelector('section[aria-label="Edit"]')?.textContent ?? '').includes(text),
      needle,
      { timeout },
    )
  } catch (error) {
    const said = await page.evaluate(
      () => document.querySelector('section[aria-label="Edit"]')?.textContent ?? '(no Edit panel)',
    )
    throw new Error(`the Edit panel never said «${needle}». It says: ${said}`, { cause: error })
  }
}

const showView = async (viewId: string): Promise<void> => {
  await page.locator('[data-mk-part="explorer.viewpicker"]').selectOption(viewId)
  await page.waitForTimeout(200)
}

const writes = async (): Promise<readonly HandleWrite[]> =>
  page.evaluate(() => (globalThis as unknown as { __handleWrites: HandleWrite[] }).__handleWrites)

const lastWrittenText = async (): Promise<string> => {
  const log = await writes()
  const last = log.at(-1)
  if (last === undefined) throw new Error('the fake handle was never written to')
  return Buffer.from(last.bytes).toString('latin1')
}

/** The entry names the Entries stage is listing for the focused tab. */
const listedEntries = async (): Promise<readonly string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-mk-part="explorer.tabcontent"]')]
      .filter(node => !node.hasAttribute('hidden'))
      .flatMap(node => [...node.querySelectorAll('[data-mk-part="namespace.label"]')])
      .map(node => node.textContent ?? ''),
  )

const inspectorText = async (): Promise<string> =>
  page.evaluate(() => document.querySelector('.web-inspector')?.textContent ?? '')

// ---------------------------------------------------------------------------------------------

describe('the Edit panel in a real browser', () => {
  it('offers no Edit panel for a subject this page can never write, and says why', async () => {
    /*
     * The served sample reaches the page through a same-origin fetch, so it has no handle and can
     * never be saved back — even though its codec declares three perfectly good mutating operations.
     * This is the half of the offer rule that has to stay true, and the one a host is most tempted
     * to fudge by drawing a disabled control.
     */
    await page.getByRole('button', { name: 'sample.zip — container namespace' }).click()
    await page.waitForFunction(
      () => (document.querySelector('.web-inspector')?.textContent ?? '').includes('sample.zip'),
      undefined,
      { timeout: 60_000 },
    )
    expect(await page.locator(EDIT_PANEL).count()).toBe(0)
    const text = await inspectorText()
    // container.pack (c9f009de) is the third: archives inside archives are written back through it
    expect(text).toContain('0 edit form(s) over 3 mutating operation(s)')
    expect(text).toContain('edit.structure, edit.content, container.pack: no Edit panel')
    expect(text).toContain('no writable handle')
    // and the toolbar still shows the read-only verbs, so "no editing" is not "no operations"
    expect(await page.locator('[data-mk-part="operations.button"]').count()).toBeGreaterThan(0)
    await closeAllTabs()
  }, 180_000)

  it('adds a ZIP entry through the codec, writes it, and reopens the tab showing it', async () => {
    await pickFile('./samples/sample.zip', 'sample.zip')
    await waitForEditPanel()

    // the same file, now with a handle: the panel is offered, over the same three operations
    const before = await inspectorText()
    expect(before).toContain('4 edit form(s) over 3 mutating operation(s)')
    expect(
      await page.locator(`${EDIT_PANEL} [data-mk-part="form.select"] option`).allTextContents(),
    ).toEqual([
      'Add an entry to the archive',
      'Remove an entry from the archive',
      'Rename an entry in the archive',
      "Replace an entry's contents",
    ])

    await showView('archive')
    expect(await listedEntries()).not.toContain(ADDED)

    expect(await writes()).toHaveLength(0)
    await applyForm('zip-add-entry', { path: ADDED, content: ADDED_TEXT })
    await waitForPanelText('Last change: Add an entry to the archive')
    // the panel that reports it is the one the reopen mounted, and it says so
    await waitForPanelText('the tab was reopened, so this view is not stale')

    // the bytes, not the sentence: one write, and it is an archive that holds the new entry
    const log = await writes()
    expect(log).toHaveLength(1)
    expect(log[0]?.name).toBe('sample.zip')
    const written = await lastWrittenText()
    expect(written.startsWith('PK\u0003\u0004')).toBe(true)
    expect(written).toContain(ADDED)
    expect(written).toContain(ADDED_TEXT)
    // the kept entries are still there — a repack, not a replacement
    expect(written).toContain('readme.txt')
    expect(written).toContain('data/values.csv')

    // and the reopened tab is showing the archive that exists now
    await showView('archive')
    expect(await listedEntries()).toContain(ADDED)
  }, 300_000)

  it('removes the entry again, and the reopened view and the bytes agree it is gone', async () => {
    await waitForEditPanel()
    await applyForm('zip-remove-entry', { path: ADDED })
    await waitForPanelText('Last change: Remove an entry from the archive')

    const log = await writes()
    expect(log).toHaveLength(2)
    const written = await lastWrittenText()
    expect(written).not.toContain(ADDED)
    expect(written).not.toContain(ADDED_TEXT)
    expect(written).toContain('readme.txt')
    expect(written).toContain('data/values.csv')

    await showView('archive')
    expect(await listedEntries()).not.toContain(ADDED)
    expect(await listedEntries()).toContain('readme.txt')
  }, 300_000)

  it('shows the codec’s own refusal, and writes nothing when it refuses', async () => {
    await waitForEditPanel()
    await applyForm('zip-remove-entry', { path: 'not-in-this-archive.txt' })
    await page.waitForFunction(
      () => {
        const status = document.querySelector(
          'section[aria-label="Edit"] [data-mk-part="form.status"]',
        )
        return (status?.textContent ?? '').includes('not-in-this-archive.txt')
      },
      undefined,
      { timeout: 60_000 },
    )
    const status = await page.locator(`${EDIT_PANEL} [data-mk-part="form.status"]`).textContent()
    // the codec's words, verbatim, not "the operation failed"
    expect(status).toContain('was not found')
    expect(status).toContain('The codec refused the operation')
    expect(
      await page
        .locator(`${EDIT_PANEL} [data-mk-part="form.status"]`)
        .getAttribute('data-mk-state'),
    ).toBe('error')
    // nothing reached the handle: the refusal happened before a plan existed
    expect(await writes()).toHaveLength(2)
    // the tab was not reopened either, so the archive on screen is still the one on "disk"
    await showView('archive')
    expect(await listedEntries()).toContain('readme.txt')
    await closeAllTabs()
  }, 180_000)

  it('sets a PNG text field, writes the chunk, and the reopened metadata view shows it', async () => {
    await pickFile('./favicon-32.png', 'favicon-32.png')
    await waitForEditPanel()
    // edit.field (text chunks) and, since aa9a265f, edit.content (pixel edits) both write the PNG
    expect(await inspectorText()).toContain('3 edit form(s) over 2 mutating operation(s)')

    // The view lists the schema's fields (Description among them) before the file carries any text,
    // so what proves the write is the value, not the label.
    await showView('metadata')
    expect(await page.locator('[data-mk-part="metadata.value"]').allTextContents()).not.toContain(
      PNG_TEXT,
    )

    await applyForm('png-set-text', { key: 'Description', value: PNG_TEXT })
    await waitForPanelText('Last change: Set a PNG text field')

    const log = await writes()
    expect(log).toHaveLength(3)
    expect(log[2]?.name).toBe('favicon-32.png')
    const written = await lastWrittenText()
    expect(written.startsWith('\u0089PNG\r\n\u001a\n')).toBe(true)
    // one tEXt chunk carrying exactly what the form collected, and the image data untouched
    expect(written).toContain(`tEXtDescription\u0000${PNG_TEXT}`)
    expect(written).toContain('IHDR')
    expect(written).toContain('IDAT')
    expect(written).toContain('IEND')

    // the reopened subject publishes it, which is what the metadata view is showing
    await showView('metadata')
    await page.waitForFunction(
      value =>
        [...document.querySelectorAll('[data-mk-part="metadata.value"]')].some(
          node => node.textContent === value,
        ),
      PNG_TEXT,
      { timeout: 60_000 },
    )
    expect(await page.locator('[data-mk-part="metadata.label"]').allTextContents()).toContain(
      'Description',
    )
  }, 300_000)

  it('prefills the next PNG form from the value the file now carries', async () => {
    // The codec publishes `png-text` for the chunk the previous test wrote, so the form opens on
    // the file's own value rather than on a placeholder. This is the prefill rule, live.
    await waitForEditPanel()
    await page.locator(`${EDIT_PANEL} [data-mk-part="form.select"]`).selectOption('png-set-text')
    const values = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label="Edit"] [data-mk-part="form.input"]')].map(
        node => [
          node.getAttribute('name') ?? '',
          node instanceof HTMLInputElement ? node.value : '',
        ],
      ),
    )
    expect(Object.fromEntries(values)).toEqual({ key: 'Description', value: PNG_TEXT })
    const hint = await page
      .locator(`${EDIT_PANEL} [data-mk-part="form.input"][name="key"]`)
      .getAttribute('title')
    expect(hint).toBe('this file already carries: Description')
  }, 180_000)

  it('decodes the shipped MP3, writes an ID3 frame, and reopens on its value', async () => {
    await closeAllTabs()
    await pickFile('./samples/sample.mp3', 'sample.mp3')
    await waitForEditPanel()
    expect(await inspectorText()).toContain('1 edit form(s) over 1 mutating operation(s)')

    // The committed sample is not only a header fixture: Chromium decodes its 39 silence frames
    // into the audio stage's one engine and reports the roughly one-second duration the generator
    // claims.
    await showView('audio')
    await page.waitForFunction(
      () => {
        const stage = document.querySelector('[data-mk-part="audio"]')
        return stage instanceof HTMLElement && stage.dataset['duration'] !== undefined
      },
      undefined,
      { timeout: 60_000 },
    )
    const duration = await page
      .locator('[data-mk-part="audio"]')
      .evaluate(node => (node instanceof HTMLElement ? Number(node.dataset['duration']) : 0))
    expect(duration).toBeGreaterThan(0.9)
    expect(duration).toBeLessThan(1.2)

    await applyForm('mp3-set-text-frame', { key: 'TIT2', value: MP3_TEXT })
    await waitForPanelText('Last change: Set an ID3v2 text frame')
    await waitForPanelText('the tab was reopened, so this view is not stale')

    const log = await writes()
    expect(log).toHaveLength(4)
    expect(log[3]?.name).toBe('sample.mp3')
    const written = await lastWrittenText()
    expect(written.startsWith('ID3')).toBe(true)
    expect(written).toContain('TIT2')
    expect(written).toContain(MP3_TEXT)
    // The ID3 tag was inserted ahead of the same independently decodable MPEG frames.
    expect(written).toContain('\u00ff\u00fb\u0010\u00c0')

    await showView('metadata')
    await page.waitForFunction(
      value =>
        [...document.querySelectorAll('[data-mk-part="metadata.value"]')].some(
          node => node.textContent === value,
        ),
      MP3_TEXT,
      { timeout: 60_000 },
    )
    expect(await page.locator('[data-mk-part="metadata.label"]').allTextContents()).toContain(
      'TIT2',
    )

    // The remounted form reads the reopened descriptor; this is the live ID3 prefill proof.
    await page
      .locator(`${EDIT_PANEL} [data-mk-part="form.select"]`)
      .selectOption('mp3-set-text-frame')
    const values = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-label="Edit"] [data-mk-part="form.input"]')].map(
        node => [
          node.getAttribute('name') ?? '',
          node instanceof HTMLInputElement ? node.value : '',
        ],
      ),
    )
    expect(Object.fromEntries(values)).toEqual({ key: 'TIT2', value: MP3_TEXT })
  }, 300_000)

  it('raised no page error and no CSP refusal along the way', () => {
    /*
     * A service worker cannot register in every embedded browser, and that is a property of the
     * environment rather than of this build, so its warning is not a failure here.
     */
    expect(
      failures.filter(line => !/ServiceWorker|service-worker|Failed to register/u.test(line)),
    ).toEqual([])
  })
})
