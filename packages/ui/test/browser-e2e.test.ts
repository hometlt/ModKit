/* eslint-disable @typescript-eslint/no-empty-function -- browser-side protocol stubs intentionally do no work */
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { discoverTextDataEntrypoints } from '../../../scripts/text-data-entrypoints.mjs'

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
let origin = ''

beforeAll(async () => {
  const formats = ['json', 'jsonc', 'xml', 'yaml', 'toml', 'ini', 'csv', 'tsv'] as const
  const entrypoints = discoverTextDataEntrypoints(process.cwd(), formats)
  const broken = entrypoints.filter(entry => entry.absolute === undefined)
  if (broken.length > 0)
    throw new Error(
      `text-data contribution entrypoint resolution failed: ${broken.map(entry => `${entry.kind}:${entry.id} (${entry.reason})`).join(', ')}`,
    )
  const name = (kind: string, id: string) => `${kind}_${id.replaceAll('-', '_')}`
  const imports = entrypoints
    .map(
      entry =>
        `import { ${entry.kind === 'codec' ? 'createCodec' : 'createProvider'} as ${name(entry.kind, entry.id)} } from ${JSON.stringify(entry.absolute?.replaceAll('\\', '/'))};`,
    )
    .join('\n')
  const codecFactories = entrypoints
    .filter(entry => entry.kind === 'codec')
    .map(entry => `${JSON.stringify(entry.id)}: ${name(entry.kind, entry.id)},`)
    .join('\n')
  const providerFactories = entrypoints
    .filter(entry => entry.kind === 'provider')
    .map(
      entry =>
        `${JSON.stringify(`common.text-data/${entry.id}-syntax`)}: ${name(entry.kind, entry.id)},`,
    )
    .join('\n')
  const built = await build({
    stdin: {
      contents: `
        import * as ui from '@modkit/ui';
        import * as browserHost from '@modkit/testkit/browser';
        import * as host from '@modkit/host';
        import * as sceneRenderer from '@modkit/scene/render/browser';
        import { plainTextCodec } from './examples/modkit-extension-plain-text/src/codec.js';
        ${imports}
        const codecFactories = {
          ${codecFactories}
        };
        const providerFactories = {
          ${providerFactories}
        };
        const createTextCodec = (format, context) => codecFactories[format](context);
        const createTextSyntaxProvider = contract => {
          const created = providerFactories[contract]({
            offerId: 'browser-e2e',
            contract,
            major: 1,
            contractSelectionKey: 'facetless:v1',
          });
          return created?.value ?? created;
        };
        globalThis.modkit = {
          ui,
          browserHost,
          host,
          sceneRenderer,
          fixtures: { plainTextCodec, createTextCodec, createTextSyntaxProvider },
        };
      `,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    write: false,
    logLevel: 'silent',
  })
  const bundle = built.outputFiles[0]?.contents
  if (bundle === undefined) throw new Error('browser E2E bundle was not emitted')
  const html = `<!doctype html>
    <html lang="en"><head>
      <meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src blob:">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Modkit viewer E2E</title>
      <link rel="stylesheet" href="/modkit-ui.css">
    </head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`
  // Served from the same origin rather than injected: the harness runs `style-src 'self'`, so an
  // injected <style> is refused (C2) — which is the policy working, not an obstacle to route around.
  const stylesheet = await readFile('packages/ui/styles/modkit-ui.css')
  server = createServer((request, response) => {
    if (request.url === '/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(bundle)
      return
    }
    if (request.url === '/modkit-ui.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      response.end(stylesheet)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const location = server.address()
  if (location === null || typeof location === 'string') throw new Error('browser server failed')
  origin = `http://127.0.0.1:${location.port}`
  const executablePath = chromeCandidates.find(candidate => existsSync(candidate))
  if (executablePath === undefined) throw new Error('Chrome/Chromium is required for C-18')
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await page.addInitScript(() => {
    const violations: string[] = []
    Object.defineProperty(globalThis, '__modkitCspViolations', {
      configurable: true,
      value: violations,
    })
    document.addEventListener('securitypolicyviolation', event => {
      violations.push(`${event.violatedDirective}:${event.blockedURI || 'inline'}`)
    })
  })
  await page.goto(origin)
  await page.waitForFunction(() => 'modkit' in globalThis)
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve => server?.close(() => resolve()))
})

async function reset(): Promise<void> {
  await page.goto(origin)
  await page.waitForFunction(() => 'modkit' in globalThis)
}

describe('13C real-browser viewer host', () => {
  it('localizes shared component chrome per instance without changing English defaults', async () => {
    const result = await page.evaluate(() => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      const createUiLocalizer = ui['createUiLocalizer'] as (locale: string) => unknown
      const ru = createUiLocalizer('ru')
      const createSearchField = ui['createSearchField'] as (
        document: Document,
        options: Record<string, unknown>,
      ) => { root: HTMLElement; destroy(): void }
      const russian = createSearchField(document, {
        localizer: ru,
        allowGlob: true,
        onChange() {},
      })
      const english = createSearchField(document, { onChange() {} })
      const createSubjectCard = ui['createSubjectCard'] as (
        document: Document,
        options: Record<string, unknown>,
      ) => { root: HTMLElement; destroy(): void }
      const card = createSubjectCard(document, {
        localizer: ru,
        label: 'Fixture',
        sections: [{ kind: 'header', title: 'Fixture' }],
        // The knowledge status belongs only to cards wired to a knowledge adapter. This case
        // exercises per-instance localization, not the deferred product knowledge feature.
        knowledge: {},
      })
      root.append(russian.root, english.root, card.root)
      const result = {
        russianFilter: russian.root.querySelector('input')?.getAttribute('aria-label'),
        russianOptions: russian.root.querySelector('[role="group"]')?.getAttribute('aria-label'),
        russianGlob: russian.root.querySelector('[aria-label="Шаблон пути"]') !== null,
        englishFilter: english.root.querySelector('input')?.getAttribute('aria-label'),
        russianCard: card.root.getAttribute('aria-label'),
        russianCardKnowledge: card.root.querySelector('[role="status"]')?.textContent,
      }
      russian.destroy()
      english.destroy()
      card.destroy()
      return result
    })
    expect(result).toEqual({
      russianFilter: 'Фильтр',
      russianOptions: 'Параметры фильтра',
      russianGlob: true,
      englishFilter: 'Filter',
      russianCard: 'Карточка субъекта «Fixture»',
      russianCardKnowledge: 'Описание пока недоступно.',
    })
  })

  it('opens a live relation target from the shared card and leaves dead targets inert', async () => {
    const result = await page.evaluate(() => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      const opened: string[] = []
      const card = (
        ui['createSubjectCard'] as (
          document: Document,
          options: Record<string, unknown>,
        ) => { root: HTMLElement; destroy(): void }
      )(document, {
        label: 'Marine',
        sections: [
          { kind: 'header', title: 'Marine' },
          {
            kind: 'links',
            id: 'relations',
            title: 'Related subjects',
            expanded: true,
            links: [
              { label: 'Gauss Rifle', href: 'x3-subject:weapon' },
              { label: 'Missing Weapon', href: 'x3-subject:missing', dead: true },
            ],
          },
        ],
        onNavigate(ref: { href?: string }) {
          if (ref.href !== undefined) opened.push(ref.href)
        },
      })
      root.append(card.root)
      ;[...card.root.querySelectorAll('button')]
        .find(button => button.textContent === 'Gauss Rifle')
        ?.click()
      const dead = [...card.root.querySelectorAll('[aria-disabled="true"]')].find(
        node => node.textContent === 'Missing Weapon',
      )
      ;(dead as HTMLElement | undefined)?.click()
      const result = {
        opened,
        deadTag: dead?.tagName,
        deadState: dead?.getAttribute('data-mk-state'),
      }
      card.destroy()
      return result
    })

    expect(result).toEqual({
      opened: ['x3-subject:weapon'],
      deadTag: 'SPAN',
      deadState: 'disabled',
    })
  })

  it('routes projected fallback-card relations through their exact host session', async () => {
    const result = await page.evaluate(async () => {
      const { ui, host } = (
        globalThis as unknown as {
          modkit: { ui: Record<string, unknown>; host: Record<string, unknown> }
        }
      ).modkit
      interface Navigation {
        readonly port: {
          readonly scope: { readonly sessionId: string; readonly subject: string }
          open(request: unknown, signal?: AbortSignal): Promise<unknown>
        }
        dispose(reason?: string): void
      }
      interface PreviewHandle {
        unmount(): Promise<void> | void
      }
      interface Mounted {
        readonly container: HTMLElement
        readonly handle: PreviewHandle
      }
      const createNavigation = host['createScopedViewerSubjectNavigation'] as (options: {
        readonly scope: { readonly sessionId: string; readonly subject: string }
        open(
          subject: { readonly identity: { readonly key: string } },
          signal: AbortSignal,
        ): Promise<void>
      }) => Navigation
      const createGraph = host['createFieldRelationGraphSource'] as (
        options: Record<string, unknown>,
      ) => Promise<unknown>
      const createFallbackFacts = host['createDescriptorFallbackSubjectFactsSource'] as (
        options: Record<string, unknown>,
      ) => unknown
      const createPreview = ui['createCodecPreview'] as (options: Record<string, unknown>) => {
        open(
          container: HTMLElement,
          entry: { readonly id: string; readonly name: string; readonly directory: boolean },
          bytes: Uint8Array,
        ): Promise<PreviewHandle | undefined>
      }
      const root = document.querySelector('#app') as HTMLElement
      const owner = {
        source: { id: 'memory://fixture/catalog.xml' },
        identity: { kind: '', key: '' },
      }
      const target = (key: string) => ({
        source: owner.source,
        identity: { kind: 'fixture/weapon', key },
      })
      const graph = await createGraph({
        owner,
        ownerLabel: 'Fixture catalog',
        ownerKind: 'format:catalog',
        fields: [
          {
            path: 'catalog.weapons',
            type: { kind: 'array', item: { kind: 'subject-ref', subjectKind: 'fixture/weapon' } },
            value: ['GaussRifle', 'MissingWeapon'],
          },
        ],
        resolver: {
          async resolve(request: { readonly value: string }) {
            return request.value === 'MissingWeapon'
              ? undefined
              : {
                  subject: target(request.value),
                  label: 'Gauss Rifle',
                  kind: 'fixture/weapon',
                }
          },
          createUnresolved(request: { readonly value: string }) {
            return {
              subject: target(request.value),
              label: 'Missing Weapon',
              kind: 'fixture/weapon',
            }
          },
        },
      })
      const descriptor = {
        schemaVersion: 2,
        subjectUri: 'memory://fixture/catalog.xml',
        origin: {
          kind: 'single',
          binding: {
            id: 'content',
            role: 'content',
            source: { id: 'catalog.xml', uri: 'memory://fixture/catalog.xml' },
            required: true,
            ownership: 'owned',
            revision: 'content-hash.sha256:generic-card',
            mediaType: 'application/xml',
          },
        },
        interpretation: 'codec',
        identity: {
          codecId: 'fixture.codec/catalog',
          codecVersion: '1.0.0',
          formatId: 'catalog',
          formatLabel: 'Fixture catalog',
          mediaType: 'application/xml',
          confidence: 1,
          detection: [{ kind: 'structure', weight: 1 }],
        },
        traits: [],
        operations: [],
        constraints: { readOnly: true, seekable: true, randomAccess: true, trusted: false },
        dataSources: [{ contract: 'common.view/subject-facts-source', major: 1 }],
        diagnostics: [],
        revision: 'content-hash.sha256:generic-card',
        metadata: [],
      }
      const facts = createFallbackFacts({ descriptor, relations: graph })
      const opened: { readonly session: string; readonly key: string }[] = []
      const navigation = (sessionId: string): Navigation =>
        createNavigation({
          scope: { sessionId, subject: descriptor.subjectUri },
          async open(subject) {
            opened.push({ session: sessionId, key: subject.identity.key })
          },
        })
      const mount = async (sessionId: string, managed?: Navigation): Promise<Mounted> => {
        const container = document.createElement('section')
        container.dataset['session'] = sessionId
        root.append(container)
        const preview = createPreview({
          stages: [
            {
              id: 'subject-card',
              label: 'Card',
              contract: 'common.view/subject-facts-source',
              module: ui['subjectCardViewer'],
            },
          ],
          async openSession() {
            return {
              async descriptor() {
                return descriptor
              },
              async dataSource() {
                return { value: facts }
              },
              ...(managed === undefined ? {} : { subjectNavigation: managed.port }),
              async dispose() {
                managed?.dispose(`${sessionId}-disposed`)
              },
            }
          },
        })
        const handle = await preview.open(
          container,
          { id: sessionId, name: `${sessionId}.xml`, directory: false },
          new Uint8Array(),
        )
        if (handle === undefined) throw new Error(`subject card did not mount for ${sessionId}`)
        return { container, handle }
      }
      const relation = (container: HTMLElement, label: string): HTMLElement => {
        const heading = [...container.querySelectorAll('button')].find(button =>
          button.textContent?.includes('Related subjects'),
        )
        if (heading === undefined) throw new Error('related subjects section is unavailable')
        if (heading.getAttribute('aria-expanded') !== 'true') heading.click()
        const found = [...container.querySelectorAll('[data-mk-part="card.ref"]')].find(
          item => item.textContent === label,
        )
        if (found === undefined) throw new Error(`relation is unavailable: ${label}`)
        return found as HTMLElement
      }
      const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0))

      const firstNavigation = navigation('session-a')
      const first = await mount('session-a', firstNavigation)
      relation(first.container, 'Gauss Rifle').click()
      relation(first.container, 'Missing Weapon').click()
      await settle()

      const secondNavigation = navigation('session-b')
      const second = await mount('session-b', secondNavigation)
      relation(second.container, 'Gauss Rifle').click()
      await settle()
      const crossSession = await firstNavigation.port.open({
        scope: secondNavigation.port.scope,
        target: 'memory://fixture/catalog.xml#fixture%2Fweapon/GaussRifle',
      })

      const withoutPort = await mount('session-without-port')
      const closedTarget = relation(withoutPort.container, 'Gauss Rifle')
      closedTarget.click()
      await settle()

      let finishLate: () => void = () => undefined
      const waitForLate = new Promise<void>(resolve => {
        finishLate = resolve
      })
      let lateSignal: AbortSignal | undefined
      let lateOpened = false
      const lateNavigation = createNavigation({
        scope: { sessionId: 'session-late', subject: descriptor.subjectUri },
        async open(_subject, signal) {
          lateSignal = signal
          await waitForLate
          if (!signal.aborted) lateOpened = true
        },
      })
      const late = await mount('session-late', lateNavigation)
      relation(late.container, 'Gauss Rifle').click()
      await settle()
      await late.handle.unmount()
      finishLate()
      await settle()

      const snapshot = {
        opened,
        deadTag: relation(first.container, 'Missing Weapon').tagName,
        deadDisabled: relation(first.container, 'Missing Weapon').getAttribute('aria-disabled'),
        missingPortTag: closedTarget.tagName,
        crossSession,
        lateAborted: lateSignal?.aborted,
        lateOpened,
      }
      await first.handle.unmount()
      await second.handle.unmount()
      await withoutPort.handle.unmount()
      return snapshot
    })

    expect(result).toEqual({
      opened: [
        { session: 'session-a', key: 'GaussRifle' },
        { session: 'session-b', key: 'GaussRifle' },
      ],
      deadTag: 'SPAN',
      deadDisabled: 'true',
      missingPortTag: 'SPAN',
      crossSession: { state: 'rejected', reason: 'scope-mismatch' },
      lateAborted: true,
      lateOpened: false,
    })
  })

  it('renders bounded and virtual text, searches, and pages a 100 MiB logical line', async () => {
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      let releases = 0
      const small = {
        async info() {
          return {
            bytes: 11n,
            encoding: 'utf-8',
            bom: false,
            newline: 'lf',
            lines: 1,
            longestLineBytes: 11,
          }
        },
        async slice() {
          return { complete: true, text: 'hello world', fromLine: 0, lineCount: 1 }
        },
        async *search() {
          yield { utf16Offset: 0, utf16Length: 5, line: 0, column: 0 }
        },
      }
      const descriptor = {
        revision: 'content-hash.sha256:browser',
        operations: [],
        diagnostics: [],
      }
      const slot = {
        slotId: 'bounded',
        kind: 'stage',
        contributionId: 'modkit.ui/bounded-text-stage',
        extensionId: 'modkit/ui',
        priority: 220,
        bindings: [{ bindingId: 'text', contract: 'common.view/text-data-source', major: 1 }],
      }
      const sources = {
        async get() {
          return {
            value: small,
            async release() {
              releases += 1
            },
          }
        },
      }
      const operations = {
        async invoke() {
          throw new Error('unexpected operation')
        },
        async dispose() {},
      }
      const mount = await (
        ui['boundedTextViewer'] as { mount(args: unknown): Promise<unknown> }
      ).mount({
        container: root,
        descriptor,
        slot,
        sources,
        operations,
      })
      ;(globalThis as unknown as Record<string, unknown>)['currentMount'] = mount
      ;(globalThis as unknown as Record<string, unknown>)['releases'] = () => releases
    })
    expect(await page.locator('pre').textContent()).toBe('hello world')
    await page.getByRole('searchbox').fill('hello')
    await page.getByRole('button', { name: 'Search' }).click()
    await page.waitForFunction(() => document.querySelector('output')?.textContent === '1 match')
    expect(await page.locator('output').textContent()).toBe('1 match')
    await page.evaluate(async () => {
      await (
        globalThis as unknown as { currentMount: { unmount(): Promise<void> } }
      ).currentMount.unmount()
    })
    expect(
      await page.evaluate(() => (globalThis as unknown as { releases: () => number }).releases()),
    ).toBe(1)

    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      let pageNumber = 0
      const huge = {
        async info() {
          return {
            bytes: 100n * 1024n * 1024n,
            encoding: 'utf-8',
            bom: false,
            newline: 'lf',
            lines: 1,
            longestLineBytes: 'unknown',
          }
        },
        async slice(request: { kind: string }) {
          pageNumber += 1
          return request.kind === 'from-line'
            ? {
                complete: false,
                text: 'first-window',
                fromLine: 0,
                lineCount: 0,
                nextCursor: '65536',
              }
            : { complete: true, text: '-second-window', fromLine: 0, lineCount: 1 }
        },
        async *search() {},
      }
      const slot = {
        slotId: 'virtual',
        kind: 'stage',
        contributionId: 'modkit.ui/virtual-text-stage',
        extensionId: 'modkit/ui',
        priority: 120,
        bindings: [{ bindingId: 'text', contract: 'common.view/text-data-source', major: 1 }],
      }
      await (ui['virtualTextViewer'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        slot,
        sources: {
          async get() {
            return { value: huge, async release() {} }
          },
        },
        operations: { async invoke() {}, async dispose() {} },
      })
      ;(globalThis as unknown as Record<string, unknown>)['pageNumber'] = () => pageNumber
    })
    expect(await page.locator('pre').textContent()).toBe('first-window')
    await page.getByRole('button', { name: 'Load next page' }).click()
    await page.waitForFunction(() =>
      document.querySelector('pre')?.textContent?.includes('second-window'),
    )
    expect(await page.locator('pre').textContent()).toBe('first-window-second-window')
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { pageNumber: () => number }).pageNumber(),
      ),
    ).toBe(2)
  })

  it('renders bigint hex, lazy tree/table and hostile cell text without markup execution', async () => {
    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      let requested = 0n
      const source = {
        async size() {
          return 2n ** 60n + 8192n
        },
        async read(offset: bigint, length: number) {
          requested = offset
          return new Uint8Array(Math.min(length, 16)).fill(65)
        },
      }
      await (ui['hexViewer'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        slot: {
          slotId: 'hex',
          kind: 'stage',
          contributionId: 'modkit.ui/hex-stage',
          extensionId: 'modkit/ui',
          priority: 40,
          bindings: [{ bindingId: 'bytes', contract: 'common.view/byte-range-source', major: 1 }],
        },
        sources: {
          async get() {
            return { value: source, async release() {} }
          },
        },
        operations: { async invoke() {}, async dispose() {} },
      })
      ;(globalThis as unknown as Record<string, unknown>)['requested'] = () => requested.toString()
    })
    await page.getByRole('textbox', { name: 'Byte offset' }).fill('0x1000000000000000')
    await page.getByRole('button', { name: 'Go' }).click()
    await page.waitForFunction(() =>
      document.querySelector('pre')?.textContent?.includes('1000000000000000'),
    )
    expect(
      await page.evaluate(() => (globalThis as unknown as { requested: () => string }).requested()),
    ).toBe('1152921504606846976')

    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      let childrenCalls = 0
      const tree = {
        async root() {
          return { id: 'root', hasChildren: true }
        },
        async children() {
          childrenCalls += 1
          return { items: [{ id: 'child', hasChildren: false }] }
        },
        async facts(node: { id: string }) {
          return { kind: 'node', label: node.id }
        },
        async *search() {},
      }
      await (ui['treeViewer'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        slot: {
          slotId: 'tree',
          kind: 'stage',
          contributionId: 'modkit.ui/tree-stage',
          extensionId: 'modkit/ui',
          priority: 300,
          bindings: [{ bindingId: 'tree', contract: 'common.view/tree-data-source', major: 1 }],
        },
        sources: {
          async get() {
            return { value: tree, async release() {} }
          },
        },
        operations: { async invoke() {}, async dispose() {} },
      })
      ;(globalThis as unknown as Record<string, unknown>)['childrenCalls'] = () => childrenCalls
    })
    await page.getByRole('button', { name: 'root' }).click()
    expect(await page.getByRole('button', { name: 'child' }).count()).toBe(1)
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { childrenCalls: () => number }).childrenCalls(),
      ),
    ).toBe(1)

    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      let pageIndex = 0
      const table = {
        async shape() {
          return { rows: 'unknown', columns: 1 }
        },
        async rows() {
          pageIndex += 1
          return pageIndex === 1
            ? { items: [{ index: 0, cells: ['safe'] }], nextCursor: '1' }
            : { items: [{ index: 999999, cells: ['\u202Ejavascript:alert(1)<img src=x>'] }] }
        },
        async cell() {
          return { value: '' }
        },
        async *search() {},
      }
      await (ui['tableViewer'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        slot: {
          slotId: 'table',
          kind: 'stage',
          contributionId: 'modkit.ui/table-stage',
          extensionId: 'modkit/ui',
          priority: 320,
          bindings: [{ bindingId: 'table', contract: 'common.view/table-data-source', major: 1 }],
        },
        sources: {
          async get() {
            return { value: table, async release() {} }
          },
        },
        operations: { async invoke() {}, async dispose() {} },
      })
    })
    await page.getByRole('button', { name: 'Next rows' }).click()
    await page.waitForFunction(() =>
      document.querySelector('td')?.textContent?.includes('javascript'),
    )
    expect(await page.locator('td').textContent()).toContain(
      '\\u{202E}javascript:alert(1)<img src=x>',
    )
    expect(await page.locator('img').count()).toBe(0)
  })

  it('resolves focused table-cell knowledge through the host and ignores stale hover results', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const modkit = (
        globalThis as unknown as {
          modkit: {
            ui: Record<string, unknown>
            browserHost: Record<string, unknown>
          }
        }
      ).modkit
      const root = document.querySelector('#app') as HTMLElement
      const target = (conceptId: string) => ({
        kind: 'concept',
        ecosystem: 'fixture',
        conceptId,
      })
      const observedSignals: AbortSignal[] = []
      const table = {
        async shape() {
          return { rows: 1, columns: 2 }
        },
        async rows() {
          return { items: [{ index: 7, cells: ['old', 'current'] }] }
        },
        async cell(coord: { row: number; column: number }, signal: AbortSignal) {
          observedSignals.push(signal)
          return {
            value: coord.column === 0 ? 'old' : 'current',
            knowledgeTarget: target(coord.column === 0 ? 'old' : 'current'),
          }
        },
        async *search() {},
      }
      const hit = (conceptId: string, summary: string) => ({
        entry: {
          id: `org.example/${conceptId}`,
          target: target(conceptId),
          locale: 'en',
          title: conceptId,
          summary,
          claimKind: 'documented-interpretation',
          confidence: 'high',
          sources: [
            {
              kind: 'external-reference',
              title: 'unsafe',
              url: 'javascript:alert(1)',
              reviewedAt: '2026-08-28',
            },
            {
              kind: 'official-documentation',
              title: 'Fixture documentation',
              url: 'https://example.com/fixture',
              reviewedAt: '2026-08-28',
            },
          ],
        },
        provenance: {
          packId: 'org.example/fixture-pack',
          ownerExtensionId: 'org.example/fixture',
          extensionVersion: '1.0.0',
          manifestPath: 'contributions/knowledge.json',
          manifestDigest: 'sha256:manifest',
          artifactDigest: 'sha256:artifact',
        },
        localeRank: 0,
      })
      const knowledge = {
        snapshotId: 'fixture',
        async search() {
          throw new Error('table help must use exact resolve')
        },
        async resolve(query: { target: { conceptId: string } }) {
          if (query.target.conceptId === 'old') {
            await new Promise(resolve => setTimeout(resolve, 60))
            return {
              snapshotId: 'fixture',
              total: 1,
              items: [hit('old', 'STALE DESCRIPTION')],
              completeness: 'complete',
              diagnostics: [],
            }
          }
          return {
            snapshotId: 'fixture',
            total: 1,
            items: [hit('current', `Current <img src=x> ${'x'.repeat(800)}`)],
            completeness: 'complete',
            diagnostics: [],
          }
        },
      }
      const slot = {
        slotId: 'table',
        kind: 'stage',
        contributionId: 'modkit.ui/table-stage',
        extensionId: 'modkit/ui',
        priority: 320,
        bindings: [{ bindingId: 'table', contract: 'common.view/table-data-source', major: 1 }],
      }
      const host = await (
        modkit.browserHost['createBrowserViewerHost'] as (args: unknown) => Promise<{
          unmount(): Promise<void>
        }>
      )({
        root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        resolved: {
          plan: {
            subjectUri: 'memory://table-knowledge',
            revision: 'r',
            slots: [slot],
            activeStage: 'table',
            alternateStages: [],
            unsatisfied: [],
          },
          bindings: [],
          planDigest: 'fixture',
        },
        sources: {
          async get() {
            return { value: table, async release() {} }
          },
        },
        operations: { async invoke() {}, async dispose() {} },
        knowledge,
        modules: { 'modkit.ui/table-stage': modkit.ui['tableViewer'] },
      })
      const cells = [...root.querySelectorAll('td')]
      cells[0]?.dispatchEvent(new MouseEvent('mouseenter'))
      await new Promise(resolve => setTimeout(resolve, 0))
      ;(cells[1] as HTMLElement | undefined)?.focus()
      await new Promise(resolve => setTimeout(resolve, 90))
      const panel = root.querySelector('[data-knowledge-state]') as HTMLElement
      const summary = panel.querySelector('span')
      const link = panel.querySelector('a')
      const observed = {
        state: panel.dataset['knowledgeState'],
        text: panel.textContent,
        summaryLength: summary?.textContent?.length,
        href: link?.getAttribute('href'),
        target: link?.getAttribute('target'),
        rel: link?.getAttribute('rel'),
        referrerPolicy: link?.getAttribute('referrerpolicy'),
        images: panel.querySelectorAll('img').length,
        firstAborted: observedSignals[0]?.aborted,
      }
      await host.unmount()
      return observed
    })

    expect(result.state).toBe('resolved')
    expect(result.text).toContain('Current <img src=x>')
    expect(result.text).not.toContain('STALE DESCRIPTION')
    expect(result.summaryLength).toBe(513)
    expect(result.href).toBe('https://example.com/fixture')
    expect(result.target).toBe('_blank')
    expect(result.rel).toBe('noopener noreferrer')
    expect(result.referrerPolicy).toBe('no-referrer')
    expect(result.images).toBe(0)
    expect(result.firstAborted).toBe(true)
  })

  it('marks table-cell knowledge missing without a port, target, or matching description', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      const slot = {
        slotId: 'table',
        kind: 'stage',
        contributionId: 'modkit.ui/table-stage',
        extensionId: 'modkit/ui',
        priority: 320,
        bindings: [{ bindingId: 'table', contract: 'common.view/table-data-source', major: 1 }],
      }
      const target = { kind: 'concept', ecosystem: 'fixture', conceptId: 'missing' }
      const knowledge = {
        snapshotId: 'fixture',
        async search() {
          throw new Error('table help must use exact resolve')
        },
        async resolve() {
          return {
            snapshotId: 'fixture',
            total: 0,
            items: [],
            completeness: 'complete',
            diagnostics: [],
          }
        },
      }
      const run = async (mode: 'no-port' | 'no-target' | 'no-hit') => {
        let cellCalls = 0
        let resolveCalls = 0
        const source = {
          async shape() {
            return { rows: 1, columns: 1 }
          },
          async rows() {
            return { items: [{ index: 0, cells: [mode] }] }
          },
          async cell() {
            cellCalls += 1
            return mode === 'no-target' ? { value: mode } : { value: mode, knowledgeTarget: target }
          },
          async *search() {},
        }
        const mounted = await (
          ui['tableViewer'] as { mount(args: unknown): Promise<{ unmount(): Promise<void> }> }
        ).mount({
          container: root,
          descriptor: { revision: 'r', operations: [], diagnostics: [] },
          slot,
          sources: {
            async get() {
              return { value: source, async release() {} }
            },
          },
          operations: { async invoke() {}, async dispose() {} },
          ...(mode === 'no-port'
            ? {}
            : {
                knowledge: {
                  ...knowledge,
                  async resolve() {
                    resolveCalls += 1
                    return knowledge.resolve()
                  },
                },
              }),
        })
        ;(root.querySelector('td') as HTMLElement).focus()
        await new Promise(resolve => setTimeout(resolve, 10))
        const panel = root.querySelector('[data-knowledge-state]') as HTMLElement
        const observed = {
          state: panel.dataset['knowledgeState'],
          text: panel.textContent,
          cellCalls,
          resolveCalls,
        }
        await mounted.unmount()
        return observed
      }
      return {
        noPort: await run('no-port'),
        noTarget: await run('no-target'),
        noHit: await run('no-hit'),
      }
    })

    expect(result.noPort).toEqual({
      state: 'missing',
      text: 'Description is not available yet.',
      cellCalls: 0,
      resolveCalls: 0,
    })
    expect(result.noTarget).toEqual({
      state: 'missing',
      text: 'Description is not available yet.',
      cellCalls: 1,
      resolveCalls: 0,
    })
    expect(result.noHit).toEqual({
      state: 'missing',
      text: 'Description is not available yet.',
      cellCalls: 1,
      resolveCalls: 1,
    })
  })

  it('resolves exact subject-card field knowledge and cancels stale requests', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      const target = (conceptId: string) => ({
        kind: 'concept',
        ecosystem: 'fixture',
        conceptId,
      })
      const observedSignals: AbortSignal[] = []
      const hit = (conceptId: string, summary: string) => ({
        entry: {
          id: `org.example/${conceptId}`,
          target: target(conceptId),
          locale: 'en',
          title: conceptId,
          summary,
          claimKind: 'documented-interpretation',
          confidence: 'high',
          sources: [
            {
              kind: 'external-reference',
              title: 'unsafe',
              url: 'javascript:alert(1)',
              reviewedAt: '2026-08-28',
            },
            {
              kind: 'official-documentation',
              title: 'Complete field documentation',
              url: 'https://example.com/card-field',
              reviewedAt: '2026-08-28',
            },
          ],
        },
        provenance: {
          packId: 'org.example/fixture-pack',
          ownerExtensionId: 'org.example/fixture',
          extensionVersion: '1.0.0',
          manifestPath: 'contributions/knowledge.json',
          manifestDigest: 'sha256:manifest',
          artifactDigest: 'sha256:artifact',
        },
        localeRank: 0,
      })
      const card = (
        ui['createSubjectCard'] as (
          document: Document,
          options: unknown,
        ) => { root: HTMLElement; destroy(): void }
      )(document, {
        label: 'Fixture card',
        sections: [
          { kind: 'header', title: 'Fixture' },
          {
            kind: 'fields',
            id: 'facts',
            title: 'Facts',
            expanded: true,
            fields: [
              { name: 'Old', value: '1', knowledgeTarget: target('old') },
              { name: 'Current', value: '2', knowledgeTarget: target('current') },
            ],
          },
        ],
        knowledgeLocales: ['ru', 'en'],
        knowledge: {
          snapshotId: 'fixture',
          async search() {
            throw new Error('card field help must use exact resolve')
          },
          async resolve(
            query: { target: { conceptId: string }; locales: readonly string[] },
            signal: AbortSignal,
          ) {
            observedSignals.push(signal)
            if (query.target.conceptId === 'old')
              await new Promise(resolve => setTimeout(resolve, 60))
            return {
              snapshotId: 'fixture',
              total: 1,
              items: [
                hit(
                  query.target.conceptId,
                  query.target.conceptId === 'old'
                    ? 'STALE CARD DESCRIPTION'
                    : `Current <img src=x> ${'x'.repeat(800)}`,
                ),
              ],
              completeness: 'complete',
              diagnostics: [],
            }
          },
        },
      })
      root.append(card.root)
      const fields = [...root.querySelectorAll<HTMLElement>('[data-mk-part="card.field"]')]
      fields[0]?.dispatchEvent(new MouseEvent('mouseenter'))
      await new Promise(resolve => setTimeout(resolve, 0))
      fields[1]?.focus()
      await new Promise(resolve => setTimeout(resolve, 90))
      const panel = root.querySelector<HTMLElement>('[data-mk-part="card.knowledge"]')
      const link = panel?.querySelector('a')
      const observed = {
        state: panel?.dataset['knowledgeState'],
        text: panel?.textContent,
        summaryLength: panel?.querySelector('span')?.textContent?.length,
        href: link?.getAttribute('href'),
        target: link?.getAttribute('target'),
        rel: link?.getAttribute('rel'),
        referrerPolicy: link?.getAttribute('referrerpolicy'),
        images: panel?.querySelectorAll('img').length,
        firstAborted: observedSignals[0]?.aborted,
      }
      card.destroy()
      return observed
    })

    expect(result.state).toBe('resolved')
    expect(result.text).toContain('Current <img src=x>')
    expect(result.text).not.toContain('STALE CARD DESCRIPTION')
    expect(result.summaryLength).toBe(513)
    expect(result.href).toBe('https://example.com/card-field')
    expect(result.target).toBe('_blank')
    expect(result.rel).toBe('noopener noreferrer')
    expect(result.referrerPolicy).toBe('no-referrer')
    expect(result.images).toBe(0)
    expect(result.firstAborted).toBe(true)
  })

  it('mounts the bounded relation viewer and releases its aborted lease on unmount', async () => {
    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      const nodes = Array.from({ length: 501 }, (_, index) => ({
        id: String(index),
        label: `Node ${index}`,
        type: 'entity',
      }))
      let releases = 0
      let observedSignal: AbortSignal | undefined
      const source = {
        async summary(signal: AbortSignal) {
          observedSignal = signal
          return {
            snapshotId: 'browser-relations-v1',
            totalNodes: nodes.length,
            totalEdges: 1,
            completeness: 'partial',
            reason: 'dependency catalogue was unavailable',
            types: [{ id: 'entity', label: 'Entities', count: nodes.length, tone: 0 }],
          }
        },
        async nodes(request: { cursor?: string; limit: number }, signal: AbortSignal) {
          observedSignal = signal
          const offset = request.cursor === undefined ? 0 : Number(request.cursor)
          const end = Math.min(nodes.length, offset + request.limit)
          return {
            items: nodes.slice(offset, end),
            ...(end < nodes.length ? { nextCursor: String(end) } : {}),
          }
        },
        async edges(_request: unknown, signal: AbortSignal) {
          observedSignal = signal
          return { items: [{ from: '0', to: '500', role: 'reference' }] }
        },
      }
      const mount = await (
        ui['relationGraphViewer'] as { mount(args: unknown): Promise<unknown> }
      ).mount({
        container: root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        slot: {
          slotId: 'relations',
          kind: 'stage',
          contributionId: 'modkit.ui/relation-graph-stage',
          extensionId: 'modkit/ui',
          priority: 300,
          bindings: [
            {
              bindingId: 'relations',
              contract: 'common.view/relation-graph-source',
              major: 1,
            },
          ],
        },
        sources: {
          async get() {
            return {
              value: source,
              async release() {
                releases += 1
              },
            }
          },
        },
        operations: { async invoke() {}, async dispose() {} },
      })
      ;(globalThis as unknown as Record<string, unknown>)['relationViewerMount'] = mount
      ;(globalThis as unknown as Record<string, unknown>)['relationViewerState'] = () => ({
        releases,
        aborted: observedSignal?.aborted ?? false,
      })
    })

    await page.waitForFunction(() =>
      document.querySelector('.modkit-graph__status')?.textContent?.includes('view capped'),
    )
    const status = (await page.locator('.modkit-graph__status').textContent()) ?? ''
    expect(status).toContain('source partial: dependency catalogue was unavailable')
    expect(status).toContain('view capped: loaded 500 of 501 nodes and 1 of 1 edges')
    const controls = await page.locator('.modkit-graph__control').allTextContents()
    expect(controls.some(label => /^(?:View|Depth|Direction)/u.test(label))).toBe(false)
    expect(await page.locator('.modkit-graph__hint').textContent()).not.toMatch(
      /double-click|entity card/u,
    )

    await page.evaluate(async () => {
      await (
        globalThis as unknown as { relationViewerMount: { unmount(): Promise<void> } }
      ).relationViewerMount.unmount()
    })
    expect(
      await page.evaluate(() =>
        (
          globalThis as unknown as {
            relationViewerState: () => { releases: number; aborted: boolean }
          }
        ).relationViewerState(),
      ),
    ).toEqual({ releases: 1, aborted: true })
    expect(await page.locator('#app').evaluate(element => element.childElementCount)).toBe(0)
  })

  it('mounts subject cards and auditable calculations from their shared contracts', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      let releases = 0
      const facts = {
        async summary() {
          return {
            snapshotId: 'facts-1',
            identity: {
              subjectId: 'unit:Marine',
              label: 'Marine',
              kind: 'entity',
              type: 'Unit',
              origins: [{ label: 'Marine.xml' }],
            },
            groupCount: 1,
            relationCount: 1,
          }
        },
        async groups() {
          return { items: [{ id: 'combat', label: 'Combat', factCount: 1 }] }
        },
        async facts() {
          return {
            items: [{ id: 'life', label: 'Life', value: 45, provenance: [{ label: 'UnitData' }] }],
          }
        },
        async relations() {
          return {
            items: [
              {
                role: 'uses',
                subjectId: 'weapon:GaussRifle',
                label: 'Gauss Rifle',
                kind: 'Weapon',
              },
            ],
          }
        },
      }
      const calculations = {
        async summary() {
          return {
            snapshotId: 'calculations-1',
            subjectId: 'unit:Marine',
            totalCalculations: 1,
            completeness: 'complete',
          }
        },
        async calculations() {
          return {
            items: [
              {
                id: 'weapon-dps',
                label: 'Weapon DPS',
                formula: {
                  id: 'weapon-dps-v1',
                  name: 'Damage per second',
                  version: '1',
                  expression: 'damage / period',
                },
                status: 'computed',
                value: 9.8,
                unit: 'damage/s',
                inputs: [
                  {
                    id: 'damage',
                    label: 'Damage',
                    state: 'resolved',
                    value: 6,
                    provenance: [{ label: 'GaussRifle' }],
                  },
                ],
                provenance: [{ label: 'Marine → GaussRifle' }],
                warnings: [],
              },
            ],
          }
        },
      }
      const sources = {
        async get(binding: { contract: string }) {
          return {
            value: binding.contract.includes('subject-facts') ? facts : calculations,
            async release() {
              releases += 1
            },
          }
        },
      }
      const common = {
        container: root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        sources,
        operations: { async invoke() {}, async dispose() {} },
      }
      const card = await (
        ui['subjectCardViewer'] as { mount(args: unknown): Promise<{ unmount(): Promise<void> }> }
      ).mount({
        ...common,
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
      ;[...root.querySelectorAll('button')]
        .find(button => button.textContent?.includes('Related subjects'))
        ?.click()
      const cardText = root.textContent
      await card.unmount()
      const calculationView = await (
        ui['subjectCalculationsViewer'] as {
          mount(args: unknown): Promise<{ unmount(): Promise<void> }>
        }
      ).mount({
        ...common,
        slot: {
          slotId: 'calculations',
          kind: 'stage',
          contributionId: 'modkit.ui/subject-calculations-stage',
          extensionId: 'modkit/ui',
          priority: 380,
          bindings: [
            {
              bindingId: 'calculations',
              contract: 'common.view/subject-calculations-source',
              major: 1,
            },
          ],
        },
      })
      const calculationsText = root.textContent
      const status = root
        .querySelector('[data-mk-part="calculations.item"]')
        ?.getAttribute('data-status')
      await calculationView.unmount()
      return { cardText, calculationsText, status, releases, remaining: root.childElementCount }
    })

    expect(result.cardText).toContain('Marine')
    expect(result.cardText).toContain('Life')
    expect(result.cardText).toContain('Gauss Rifle')
    expect(result.calculationsText).toContain('Weapon DPS')
    expect(result.calculationsText).toContain('damage / period')
    expect(result.calculationsText).toContain('GaussRifle')
    expect(result.status).toBe('computed')
    expect(result.releases).toBe(2)
    expect(result.remaining).toBe(0)
  })

  it('renders a source-neutral semantic game template through view.template', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      let invoked = 0
      const mount = await (
        ui['gameTemplateViewer'] as {
          mount(args: unknown): Promise<{ unmount(): Promise<void> }>
        }
      ).mount({
        container: root,
        descriptor: {
          revision: 'template-r1',
          operations: [
            {
              id: 'view.template',
              handlerId: 'game-template-preview',
              state: 'available',
              mutatesSource: false,
            },
          ],
          diagnostics: [],
        },
        slot: {
          slotId: 'template',
          kind: 'stage',
          contributionId: 'modkit.ui/game-template-stage',
          extensionId: 'modkit/ui',
          priority: 365,
          bindings: [],
        },
        sources: {
          async get() {
            throw new Error('template stage needs no data source')
          },
        },
        operations: {
          async invoke(handlerId: string) {
            invoked += 1
            if (handlerId !== 'game-template-preview') throw new Error('wrong handler')
            return {
              state: 'ok',
              diagnostics: [],
              output: {
                kind: 'json',
                value: {
                  schemaVersion: 1,
                  operationId: 'view.template',
                  templateKind: 'fixture-tech-tree-v1',
                  entryUri: 'memory://template',
                  resolvedTree: { kind: 'tree', nodes: [{ id: 'Marine' }] },
                  displayItems: [{ id: 'Marine', label: 'Marine' }],
                  diagnostics: [
                    { code: 'fixture-note', severity: 'information', message: 'Semantic proof.' },
                  ],
                  completeness: 'partial',
                  fidelity: { comparison: 'semantic', unsupported: ['runtime-effects'] },
                  provenance: { source: 'fixture' },
                  digest: { algorithm: 'fixture', value: '1' },
                },
              },
            }
          },
          async dispose() {},
        },
      })
      const text = root.textContent
      const kind = root.querySelector('[data-template-kind]')?.getAttribute('data-template-kind')
      const completeness = root
        .querySelector('[data-completeness]')
        ?.getAttribute('data-completeness')
      await mount.unmount()
      return { text, kind, completeness, invoked, remaining: root.childElementCount }
    })

    expect(result.text).toContain('fixture-tech-tree-v1')
    expect(result.text).toContain('Marine')
    expect(result.text).toContain('runtime-effects')
    expect(result.text).toContain('Semantic proof.')
    expect(result.kind).toBe('fixture-tech-tree-v1')
    expect(result.completeness).toBe('partial')
    expect(result.invoked).toBe(1)
    expect(result.remaining).toBe(0)
  })

  it('switches stages 100 times without reopening the asset and releases every lease', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui, browserHost } = (
        globalThis as unknown as {
          modkit: { ui: Record<string, unknown>; browserHost: Record<string, unknown> }
        }
      ).modkit
      const root = document.querySelector('#app') as HTMLElement
      let acquired = 0
      let released = 0
      const text = {
        async info() {
          return {
            bytes: 1n,
            encoding: 'utf-8',
            bom: false,
            newline: 'lf',
            lines: 1,
            longestLineBytes: 1,
          }
        },
        async slice() {
          return { complete: true, text: 'x', fromLine: 0, lineCount: 1 }
        },
        async *search() {},
      }
      const bytes = {
        async size() {
          return 1n
        },
        async read() {
          return new Uint8Array([120])
        },
      }
      const textSlot = {
        slotId: 'text',
        kind: 'stage',
        contributionId: 'modkit.ui/bounded-text-stage',
        extensionId: 'modkit/ui',
        priority: 220,
        singletonGroup: 'center-stage',
        bindings: [
          { bindingId: 'text-binding', contract: 'common.view/text-data-source', major: 1 },
        ],
      }
      const hexSlot = {
        slotId: 'hex',
        kind: 'stage',
        contributionId: 'modkit.ui/hex-stage',
        extensionId: 'modkit/ui',
        priority: 40,
        singletonGroup: 'center-stage',
        bindings: [
          { bindingId: 'hex-binding', contract: 'common.view/byte-range-source', major: 1 },
        ],
      }
      const resolved = {
        plan: {
          subjectUri: 'memory://one',
          revision: 'r',
          slots: [textSlot, hexSlot],
          activeStage: 'text',
          alternateStages: ['hex'],
          unsatisfied: [],
        },
        bindings: [],
        planDigest: 'fixture',
      }
      const sources = {
        async get(binding: { contract: string }) {
          acquired += 1
          return {
            value: binding.contract.includes('text-data') ? text : bytes,
            async release() {
              released += 1
            },
          }
        },
      }
      const host = await (
        browserHost['createBrowserViewerHost'] as (args: unknown) => Promise<{
          switchStage(id: string): Promise<void>
          unmount(): Promise<void>
          metrics(): { mounts: number; unmounts: number; containers: number }
        }>
      )({
        root,
        descriptor: { revision: 'r', operations: [], diagnostics: [] },
        resolved,
        sources,
        operations: { async invoke() {}, async dispose() {} },
        modules: {
          'modkit.ui/bounded-text-stage': ui['boundedTextViewer'],
          'modkit.ui/hex-stage': ui['hexViewer'],
        },
      })
      const assetOpenCount = 1
      for (let index = 0; index < 100; index += 1) {
        await host.switchStage(index % 2 === 0 ? 'hex' : 'text')
      }
      await host.unmount()
      return {
        acquired,
        released,
        assetOpenCount,
        metrics: host.metrics(),
        children: root.children.length,
      }
    })
    expect(result.assetOpenCount).toBe(1)
    expect(result.acquired).toBe(result.released)
    expect(result.metrics.mounts).toBe(result.metrics.unmounts)
    expect(result.metrics.containers).toBe(0)
    expect(result.children).toBe(0)
  })

  it('streams descriptor, diagnostic and stale-state updates without reopening the asset', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { browserHost } = (
        globalThis as unknown as { modkit: { browserHost: Record<string, unknown> } }
      ).modkit
      const root = document.querySelector('#app') as HTMLElement
      const assetOpenCount = 1
      let diagnosticCount = 0
      const states: string[] = []
      const slot = (id: string) => ({
        slotId: id,
        kind: 'stage',
        contributionId: `org.example/${id}`,
        extensionId: 'org.example/viewers',
        priority: id === 'new' ? 200 : 100,
        singletonGroup: 'center-stage',
        bindings: [],
      })
      const slots = [slot('old'), slot('new')]
      const resolved = (revision: string) => ({
        plan: {
          subjectUri: 'memory://event-stream',
          revision,
          slots,
          activeStage: revision === 'r3' ? 'new' : 'old',
          alternateStages: [revision === 'r3' ? 'old' : 'new'],
          unsatisfied: [],
        },
        bindings: [],
        planDigest: revision,
      })
      const module = {
        async mount(args: { container: HTMLElement }) {
          args.container.textContent = 'mounted'
          return {
            async update(update: { descriptor: { diagnostics: unknown[] } }) {
              diagnosticCount = update.descriptor.diagnostics.length
            },
            async unmount() {},
          }
        },
      }
      const host = await (
        browserHost['createBrowserViewerHost'] as (args: unknown) => Promise<{
          update(descriptor: unknown, resolved?: unknown): Promise<void>
          unmount(): Promise<void>
          metrics(): { mounts: number; unmounts: number; containers: number }
        }>
      )({
        root,
        descriptor: { revision: 'r1', operations: [], diagnostics: [] },
        resolved: resolved('r1'),
        sources: { async get() {} },
        operations: { async invoke() {}, async dispose() {} },
        modules: { 'org.example/old': module, 'org.example/new': module },
      })
      const diagnostic = {
        id: 'same',
        code: 'org.example/update',
        category: 'runtime',
        severity: 'warning',
        message: 'updated',
      }
      const session = {
        async *events() {
          yield {
            kind: 'descriptor',
            descriptor: { revision: 'r2', operations: [], diagnostics: [] },
          }
          yield { kind: 'diagnostic', diagnostic }
          yield { kind: 'diagnostic', diagnostic: { ...diagnostic, message: 'deduped' } }
          yield {
            kind: 'descriptor',
            descriptor: { revision: 'r3', operations: [], diagnostics: [diagnostic] },
          }
          yield { kind: 'state', state: 'stale' }
        },
      }
      const binding = (
        browserHost['bindAssetSessionToViewerHost'] as (args: unknown) => {
          done: Promise<void>
          dispose(): Promise<void>
        }
      )({
        session,
        host,
        resolvePlan: (descriptor: { revision: string }) => resolved(descriptor.revision),
        onState: (event: { state: string }) => states.push(event.state),
      })
      await binding.done
      await binding.dispose()
      const beforeUnmount = host.metrics()
      const activeSlot = root.querySelector('[data-slot-id]')?.getAttribute('data-slot-id')
      await host.unmount()
      return {
        assetOpenCount,
        diagnosticCount,
        states,
        activeSlot,
        beforeUnmount,
        afterUnmount: host.metrics(),
      }
    })
    expect(result.assetOpenCount).toBe(1)
    expect(result.diagnosticCount).toBe(1)
    expect(result.states).toEqual(['stale'])
    expect(result.activeSlot).toBe('new')
    expect(result.beforeUnmount).toMatchObject({ mounts: 2, unmounts: 1, containers: 1 })
    expect(result.afterUnmount).toMatchObject({ mounts: 2, unmounts: 2, containers: 0 })
  })

  it('opens plain text, unknown binary, and all eight text-data formats into real viewer plans', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const modkit = (
        globalThis as unknown as {
          modkit: {
            ui: Record<string, unknown>
            browserHost: Record<string, unknown>
            host: Record<string, unknown>
            fixtures: Record<string, unknown>
          }
        }
      ).modkit
      const root = document.querySelector('#app') as HTMLElement
      const budget = {
        maxInputBytes: 1_000_000n,
        maxDepth: 128,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      }
      const sourceFor = (text: string, uri: string) => {
        const bytes = new TextEncoder().encode(text)
        return {
          kind: 'bytes',
          ref: { id: uri, uri },
          revision: 'content-hash.sha256:browser-format',
          size: BigInt(bytes.byteLength),
          async read(offset: bigint, length: number) {
            return bytes.slice(Number(offset), Number(offset) + length)
          },
          async *stream() {
            yield bytes
          },
        }
      }
      const inputFor = (source: ReturnType<typeof sourceFor>) => {
        const binding = {
          sourceKind: 'candidate',
          bindingId: 'content',
          role: 'content',
          ownership: 'owned',
          source: source.ref,
          revision: source.revision,
        }
        return {
          originKind: 'single',
          bindings: [binding],
          primaryBindingId: binding.bindingId,
          revisions: {
            topology: 'single',
            revision: source.revision,
            bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
            compositionFingerprint: `browser:${source.ref.uri}`,
          },
          bindingsFor() {
            return []
          },
          async openBinding() {
            return { value: source, async release() {} }
          },
        }
      }
      const resolvePlan = modkit.host['resolvePresentationPlan'] as (args: unknown) => Promise<{
        plan: { activeStage?: string; fallback?: { contributionId: string } }
        bindings: unknown[]
        planDigest: string
      }>
      const createHost = modkit.browserHost['createBrowserViewerHost'] as (
        args: unknown,
      ) => Promise<{ unmount(): Promise<void> }>
      const renderSession = async (
        session: {
          descriptor(): Promise<{
            subjectUri: string
            revision: string
            operations: unknown[]
            diagnostics: unknown[]
          }>
          dataSource(contract: string, major: number): Promise<unknown>
          operations(): unknown
          dispose(): Promise<void>
        },
        contract: string,
        contributionId: string,
        module: unknown,
      ) => {
        const descriptor = await session.descriptor()
        const binding = { bindingId: 'data', contract, major: 1 }
        const resolved = await resolvePlan({
          descriptor,
          candidates: [
            {
              slotId: `slot-${contributionId}`,
              kind: 'stage',
              contributionId,
              extensionId: 'modkit/ui',
              priority: 300,
              singletonGroup: 'center-stage',
              bindings: [binding],
              eligible: true,
              missing: [],
            },
          ],
          async resolveBinding(value: unknown) {
            return {
              ...(value as object),
              offerId: 'session-source',
              providerId: 'browser-session',
              variantId: 'portable',
              ticket: {},
            }
          },
          digest(value: unknown) {
            return JSON.stringify(value)
          },
          ticketMatches() {
            return true
          },
        })
        const host = await createHost({
          root,
          descriptor,
          resolved,
          sources: {
            get(value: { contract: string; major: number }) {
              return session.dataSource(value.contract, value.major)
            },
          },
          operations: session.operations(),
          modules: { [contributionId]: module },
        })
        const rendered = root.textContent ?? ''
        await host.unmount()
        await session.dispose()
        return {
          rendered,
          activeStage: resolved.plan.activeStage,
          subjectUri: descriptor.subjectUri,
        }
      }

      const plainSource = sourceFor('hello from plain text', 'memory://plain.txt')
      const plainCodec = modkit.fixtures['plainTextCodec'] as {
        open(input: unknown, intent: string, budget: unknown): Promise<unknown>
      }
      const plainSession = await plainCodec.open(inputFor(plainSource), 'full', budget)
      const plain = await renderSession(
        plainSession as never,
        'common.view/text-data-source',
        'modkit.ui/bounded-text-stage',
        modkit.ui['boundedTextViewer'],
      )

      const formats = [
        ['json', 'common.text-data/json-syntax', '{"name":"Modkit","count":2}'],
        ['jsonc', 'common.text-data/jsonc-syntax', '{// comment\n"name":"Modkit",}'],
        ['xml', 'common.text-data/xml-syntax', '<root><child>value</child></root>'],
        ['yaml', 'common.text-data/yaml-syntax', 'name: Modkit\nitems:\n  - one\n'],
        ['toml', 'common.text-data/toml-syntax', 'name = "Modkit"\ncount = 2\n'],
        ['ini', 'common.text-data/ini-syntax', '[main]\nname=Modkit\n'],
        ['csv', 'common.text-data/csv-syntax', 'name,count\nModkit,2\n'],
        ['tsv', 'common.text-data/tsv-syntax', 'name\tcount\nModkit\t2\n'],
      ] as const
      const renderedFormats: {
        format: string
        rendered: string
        activeStage: string | undefined
      }[] = []
      for (const [format, contract, text] of formats) {
        const provider = (
          modkit.fixtures['createTextSyntaxProvider'] as (contract: string) => unknown
        )(contract)
        const codec = (
          modkit.fixtures['createTextCodec'] as (
            format: string,
            context: unknown,
          ) => {
            open(input: unknown, intent: string, budget: unknown): Promise<unknown>
          }
        )(format, {
          budgets: budget,
          diagnostics: { report() {} },
          contracts: {
            async resolve() {
              return { value: provider, async release() {} }
            },
            async resolveUnknown() {
              throw new Error('foreign contract is unavailable')
            },
          },
        })
        const source = sourceFor(text, `memory://${format}`)
        const session = (await codec.open(inputFor(source), 'full', budget)) as never
        const table = format === 'csv' || format === 'tsv'
        const rendered = await renderSession(
          session,
          table ? 'common.view/table-data-source' : 'common.view/tree-data-source',
          table ? 'modkit.ui/table-stage' : 'modkit.ui/tree-stage',
          table ? modkit.ui['tableViewer'] : modkit.ui['treeViewer'],
        )
        renderedFormats.push({
          format,
          rendered: rendered.rendered,
          activeStage: rendered.activeStage,
        })
      }

      const binaryBytes = new Uint8Array([0, 255, 16, 32])
      const unresolved = {
        schemaVersion: 2,
        subjectUri: 'memory://unknown.bin',
        revision: 'content-hash.sha256:unknown',
        state: 'unresolved',
        candidates: [],
        traits: [],
        operations: [],
        diagnostics: [],
        dataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],
      }
      const fallbackBinding = {
        bindingId: 'bytes',
        contract: 'common.view/byte-range-source',
        major: 1,
      }
      const unresolvedPlan = await resolvePlan({
        descriptor: unresolved,
        candidates: [
          {
            slotId: 'unknown-hex',
            kind: 'fallback',
            contributionId: 'modkit.ui/unknown-binary-fallback',
            extensionId: 'modkit/ui',
            priority: -100,
            bindings: [fallbackBinding],
            eligible: true,
            missing: [],
          },
        ],
        async resolveBinding(value: unknown) {
          return {
            ...(value as object),
            offerId: 'host-bytes',
            providerId: 'host',
            variantId: 'portable',
            ticket: {},
          }
        },
        digest(value: unknown) {
          return JSON.stringify(value)
        },
        ticketMatches() {
          return true
        },
      })
      const unknownHost = await createHost({
        root,
        descriptor: unresolved,
        resolved: unresolvedPlan,
        sources: {
          async get() {
            return {
              value: {
                async size() {
                  return BigInt(binaryBytes.byteLength)
                },
                async read(offset: bigint, length: number) {
                  return binaryBytes.slice(Number(offset), Number(offset) + length)
                },
              },
              async release() {},
            }
          },
        },
        operations: { async invoke() {}, async dispose() {} },
        modules: { 'modkit.ui/unknown-binary-fallback': modkit.ui['hexViewer'] },
      })
      const unknown = {
        rendered: root.textContent ?? '',
        subjectUri: unresolved.subjectUri,
        fallback: unresolvedPlan.plan.fallback?.contributionId,
      }
      await unknownHost.unmount()
      return { plain, formats: renderedFormats, unknown }
    })

    expect(result.plain.rendered).toContain('hello from plain text')
    expect(result.plain.activeStage).toContain('bounded-text-stage')
    expect(result.formats.map(item => item.format)).toEqual([
      'json',
      'jsonc',
      'xml',
      'yaml',
      'toml',
      'ini',
      'csv',
      'tsv',
    ])
    for (const item of result.formats) {
      expect(item.activeStage, item.format).toContain(
        item.format === 'csv' || item.format === 'tsv' ? 'table-stage' : 'tree-stage',
      )
      expect(item.rendered.length, item.format).toBeGreaterThan(0)
    }
    expect(result.unknown).toMatchObject({
      subjectUri: 'memory://unknown.bin',
      fallback: 'modkit.ui/unknown-binary-fallback',
    })
    expect(result.unknown.rendered).toContain('00 ff 10 20')
    const cspViolations = await page.evaluate(
      () =>
        (globalThis as unknown as { __modkitCspViolations?: string[] }).__modkitCspViolations ?? [],
    )
    expect(cspViolations).toEqual([])
  })

  it('routes diagnostics and toolbar state without exposing markup or invoking disabled operations', async () => {
    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const root = document.querySelector('#app') as HTMLElement
      const counters = { invoked: 0, jumped: '' }
      root.addEventListener('modkit-diagnostic-jump', event => {
        counters.jumped = (event as CustomEvent<{ id: string }>).detail.id
      })
      const descriptor = {
        revision: 'r',
        diagnostics: [
          {
            id: 'same',
            code: 'org.example/test',
            category: 'structure',
            severity: 'error',
            message: '<script>bad</script>',
          },
          {
            id: 'same',
            code: 'org.example/test',
            category: 'structure',
            severity: 'error',
            message: 'deduped',
          },
        ],
        operations: [
          { id: 'asset.validate', handlerId: 'validate', mutatesSource: false, state: 'available' },
          {
            id: 'asset.search',
            handlerId: 'search',
            mutatesSource: false,
            state: 'disabled',
            reason: 'not now',
          },
        ],
      }
      const operations = {
        async invoke(
          handler: string,
          _input: unknown,
          options: { onProgress?: (value: unknown) => void },
        ) {
          counters.invoked += 1
          options.onProgress?.({ completed: 1, total: 1, message: handler })
          return { state: 'rejected', reason: 'stale-revision', diagnostics: [] }
        },
        async dispose() {},
      }
      const panelRoot = document.createElement('div')
      const toolbarRoot = document.createElement('div')
      root.append(panelRoot, toolbarRoot)
      const base = { extensionId: 'modkit/ui', priority: 100, bindings: [] }
      await (ui['diagnosticsPanel'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: panelRoot,
        descriptor,
        slot: {
          ...base,
          slotId: 'd',
          kind: 'panel',
          contributionId: 'modkit.ui/diagnostics-panel',
        },
        sources: {},
        operations,
      })
      await (ui['operationToolbar'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: toolbarRoot,
        descriptor,
        slot: {
          ...base,
          slotId: 'o',
          kind: 'toolbar',
          contributionId: 'modkit.ui/operation-toolbar',
        },
        sources: {},
        operations,
      })
      ;(globalThis as unknown as Record<string, unknown>)['testCounters'] = counters
    })
    expect(await page.getByRole('button', { name: 'deduped' }).count()).toBe(1)
    expect(await page.locator('script').count()).toBe(1)
    await page.getByRole('button', { name: 'deduped' }).click()
    await page.getByRole('button', { name: 'asset.validate' }).click()
    await page.waitForFunction(
      () => document.querySelector('output')?.textContent === 'stale-revision',
    )
    expect(await page.getByRole('button', { name: 'asset.search' }).isDisabled()).toBe(true)
    const counters = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')]
      const state = (globalThis as unknown as { testCounters: { invoked: number; jumped: string } })
        .testCounters
      return {
        disabled: (
          buttons.find(button => button.textContent === 'asset.search') as HTMLButtonElement
        ).disabled,
        diagnosticText: buttons.find(button => button.textContent === 'deduped')?.textContent,
        invoked: state.invoked,
        jumped: state.jumped,
      }
    })
    expect(counters).toEqual({
      disabled: true,
      diagnosticText: 'deduped',
      invoked: 1,
      jumped: 'same',
    })
  })

  it('drives transport and namespace through typed operations/events and isolates third-party frames', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui, browserHost } = (
        globalThis as unknown as {
          modkit: { ui: Record<string, unknown>; browserHost: Record<string, unknown> }
        }
      ).modkit
      const root = document.querySelector('#app') as HTMLElement
      const transportRoot = document.createElement('div')
      const namespaceRoot = document.createElement('div')
      const frameRoot = document.createElement('div')
      root.append(transportRoot, namespaceRoot, frameRoot)
      let invoked = 0
      let opened = 0
      let released = 0
      let openedEvent = ''
      namespaceRoot.addEventListener('modkit-open-source', event => {
        openedEvent = (event as CustomEvent<{ entryId: string }>).detail.entryId
      })
      const transport = {
        async snapshot() {
          return {
            state: 'paused',
            positionMs: 100,
            durationMs: 1000,
            rate: 1,
            seekable: true,
            live: false,
            tracks: [{ id: 'main', kind: 'audio', selected: true }],
            controls: { playPause: 'media.play' },
          }
        },
        async *events() {
          yield {
            kind: 'snapshot',
            snapshot: {
              state: 'buffering',
              positionMs: 100,
              durationMs: 1000,
              rate: 1,
              seekable: true,
              live: false,
              tracks: [],
              controls: { playPause: 'media.play' },
            },
          }
        },
      }
      const namespace = {
        async list() {
          return {
            items: [
              {
                id: 'entry-1',
                path: 'folder/file.bin',
                name: 'file.bin',
                kind: 'file',
                revision: 'content-hash.sha256:file',
              },
            ],
          }
        },
        async openEntry() {
          opened += 1
          return {
            value: { id: 'memory://file', uri: 'memory://file' },
            async release() {
              released += 1
            },
          }
        },
      }
      const operations = {
        async invoke() {
          invoked += 1
          return { state: 'ok', output: { kind: 'none' }, diagnostics: [] }
        },
        async dispose() {},
      }
      const descriptor = {
        revision: 'r',
        diagnostics: [],
        operations: [
          { id: 'media.play', handlerId: 'play', mutatesSource: false, state: 'available' },
        ],
      }
      const sourceFor = (value: unknown) => ({
        async get() {
          return { value, async release() {} }
        },
      })
      await (ui['transportViewer'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: transportRoot,
        descriptor,
        slot: {
          slotId: 'transport',
          kind: 'transport',
          contributionId: 'modkit.ui/transport-bar',
          extensionId: 'modkit/ui',
          priority: 100,
          bindings: [
            { bindingId: 'transport', contract: 'common.view/transport-source', major: 1 },
          ],
        },
        sources: sourceFor(transport),
        operations,
      })
      await (ui['namespaceViewer'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: namespaceRoot,
        descriptor,
        slot: {
          slotId: 'namespace',
          kind: 'tree',
          contributionId: 'modkit.ui/namespace-tree',
          extensionId: 'modkit/ui',
          priority: 200,
          bindings: [
            {
              bindingId: 'namespace',
              contract: 'common.view/namespace-entry-source',
              major: 1,
            },
          ],
        },
        sources: sourceFor(namespace),
        operations,
      })
      const blob = URL.createObjectURL(new Blob(['export default 1'], { type: 'text/javascript' }))
      const frame = (
        browserHost['createRestrictedViewerFrame'] as (
          container: HTMLElement,
          source: URL,
        ) => HTMLIFrameElement
      )(frameRoot, new URL(blob))
      const messageSafe = (browserHost['isRestrictedViewerMessage'] as (value: unknown) => boolean)(
        { kind: 'navigate', subjectUri: 'memory://safe' },
      )
      const messageHostile = (
        browserHost['isRestrictedViewerMessage'] as (value: unknown) => boolean
      )({ kind: 'navigate', subjectUri: 'memory://safe', ticket: 'secret' })
      const javascriptAllowed = (
        browserHost['isAllowedViewerResource'] as (value: string, base: URL) => boolean
      )('javascript:alert(1)', new URL(document.baseURI))
      ;(globalThis as unknown as Record<string, unknown>)['transportNamespaceCounters'] = () => ({
        invoked,
        opened,
        released,
        openedEvent,
      })
      return {
        sandbox: frame.getAttribute('sandbox'),
        allow: frame.getAttribute('allow'),
        messageSafe,
        messageHostile,
        javascriptAllowed,
      }
    })
    await page.getByRole('button', { name: 'Play or pause' }).click()
    await page.getByRole('button', { name: 'file.bin' }).click()
    await page.waitForFunction(
      () =>
        (
          globalThis as unknown as { transportNamespaceCounters: () => { invoked: number } }
        ).transportNamespaceCounters().invoked === 1,
    )
    const counters = await page.evaluate(() =>
      (
        globalThis as unknown as {
          transportNamespaceCounters: () => {
            invoked: number
            opened: number
            released: number
            openedEvent: string
          }
        }
      ).transportNamespaceCounters(),
    )
    expect(counters).toEqual({ invoked: 1, opened: 1, released: 1, openedEvent: 'entry-1' })
    expect(result).toEqual({
      sandbox: 'allow-scripts',
      allow: '',
      messageSafe: true,
      messageHostile: false,
      javascriptAllowed: false,
    })
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' })
    const mediaLayout = await page.evaluate(() => {
      document.documentElement.dir = 'rtl'
      document.body.style.zoom = '2'
      return {
        direction: getComputedStyle(document.documentElement).direction,
        zoom: document.body.style.zoom,
      }
    })
    expect(mediaLayout).toEqual({ direction: 'rtl', zoom: '2' })
    const transportControl = page.getByRole('button', { name: 'Play or pause' })
    await transportControl.focus()
    expect(await transportControl.evaluate(element => document.activeElement === element)).toBe(
      true,
    )
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () =>
        (
          globalThis as unknown as { transportNamespaceCounters: () => { invoked: number } }
        ).transportNamespaceCounters().invoked === 2,
    )
  })

  it('edits, commits, reports conflicts, and replays undo/redo through host-owned ports', async () => {
    await reset()
    await page.evaluate(async () => {
      const { ui, host } = (
        globalThis as unknown as {
          modkit: { ui: Record<string, unknown>; host: Record<string, unknown> }
        }
      ).modkit
      const root = document.querySelector('#app') as HTMLElement
      const initial = {
        bindings: { content: 'content-hash.sha256:initial' },
        compositionFingerprint: 'composition:initial',
      }
      let current = initial
      let text = 'before'
      let releases = 0
      const beforeByTransaction = new Map<string, { revision: typeof initial; text: string }>()
      const target = {
        targetId: 'document',
        subjectUri: 'memory://document',
        ownerSource: { id: 'document', uri: 'memory://document' },
        semanticPath: ['root'],
        expectedRevision: initial,
      }
      const fidelity = {
        roundTrip: 'byte-identical',
        preservesUnknownData: true,
        evidenceId: 'browser-editor-v1',
        corpusId: 'modkit/browser-editor',
        corpusDigest: 'sha256:corpus',
        conformanceProfile: 'modkit/browser-editor-v1',
        writer: {
          providerId: 'modkit/browser-writer',
          providerVersion: '1.0.0',
          artifactDigest: 'sha256:writer',
          formatId: 'text',
          representationId: 'source',
        },
        optionsFingerprint: 'default',
        inputClass: 'plain-text',
        provenAt: '2026-08-15T00:00:00.000Z',
      }
      let next = 0
      const commit = (
        host['createCommitCoordinator'] as (options: Record<string, unknown>) => {
          prepare(plan: unknown, options: unknown): Promise<unknown>
          commit(prepared: unknown, options: unknown): Promise<unknown>
          undo(transactionId: string, options: unknown): Promise<unknown>
          redo(transactionId: string, options: unknown): Promise<unknown>
        }
      )({
        payloads: {
          async open() {
            throw new Error('not staged')
          },
        },
        backendFor: () => ({
          profile: {
            backendId: 'browser-memory',
            guarantees: ['atomic', 'transactional', 'recoverable', 'best-effort'],
            supportsPrepare: true,
            supportsRollback: true,
            supportsJournal: true,
            supportsRename: true,
          },
          writable: true,
          async currentRevision() {
            return current
          },
          async apply(edit: { payload: { text?: string } }, options: { transactionId: string }) {
            beforeByTransaction.set(options.transactionId, { revision: current, text })
            text = edit.payload.text ?? text
            current = {
              bindings: { content: `content-hash.sha256:${String(++next)}` },
              compositionFingerprint: `composition:${next}`,
            }
            return { after: current }
          },
          async rollback(transactionId: string, _edit: unknown, before: typeof initial) {
            const saved = beforeByTransaction.get(transactionId)
            current = saved?.revision ?? before
            text = saved?.text ?? 'before'
            return current
          },
        }),
        evidenceFor: () => fidelity,
        isGrantValid: () => true,
        digest: (value: unknown) =>
          JSON.stringify(value, (_key, item: unknown) =>
            typeof item === 'bigint' ? item.toString(10) : item,
          ),
        now: () => '2026-08-15T00:00:00.000Z',
      })
      const writer = {
        identity: fidelity.writer,
        offer: {
          providerId: fidelity.writer.providerId,
          fidelityEvidenceId: fidelity.evidenceId,
          formatId: 'text',
          representationId: 'source',
          mutationMode: 'mutate',
          minimumRoundTrip: 'byte-identical',
        },
        async validate(change: { edits: readonly unknown[] }) {
          return { valid: change.edits.length === 1, diagnostics: [] }
        },
        async plan(change: { targets: readonly unknown[]; edits: readonly unknown[] }) {
          return {
            planId: `browser-plan-${String(++next)}`,
            targets: change.targets,
            edits: change.edits,
            semantics: { mutationMode: 'mutate', minimumGuarantee: 'transactional' },
            fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
            diagnostics: [],
          }
        },
      }
      const edit = (host['createEditSession'] as (options: Record<string, unknown>) => unknown)({
        revision: initial,
        targets: [target],
        writer,
      })
      const authorization = {
        async request() {
          return {
            grant: (host['createGrantSnapshot'] as (value: Record<string, unknown>) => unknown)({
              snapshotId: `browser-grant-${String(++next)}`,
              permissions: ['write-source'],
              sourceIds: ['document'],
            }),
          }
        },
      }
      const mount = await (
        ui['textEditor'] as { mount(args: Record<string, unknown>): Promise<unknown> }
      ).mount({
        container: root,
        descriptor: { revision: 'content-hash.sha256:initial', operations: [], diagnostics: [] },
        edit,
        commit,
        payloads: {
          async open() {
            throw new Error('not staged')
          },
        },
        sources: {
          async get() {
            return {
              value: {
                async info() {
                  return {
                    bytes: BigInt(new TextEncoder().encode(text).byteLength),
                    encoding: 'utf-8',
                    bom: false,
                    newline: 'none',
                    lines: 1,
                    longestLineBytes: text.length,
                  }
                },
                async slice() {
                  return { complete: true, text, fromLine: 0, lineCount: 1 }
                },
                async *search() {},
              },
              async release() {
                releases += 1
              },
            }
          },
        },
        authorization,
      })
      ;(globalThis as unknown as Record<string, unknown>)['editorState'] = () => ({
        text,
        revision: current.compositionFingerprint,
        releases,
      })
      ;(globalThis as unknown as Record<string, unknown>)['editorExternalChange'] = () => {
        current = {
          bindings: { content: 'content-hash.sha256:external' },
          compositionFingerprint: 'composition:external',
        }
      }
      ;(globalThis as unknown as Record<string, unknown>)['currentEditorMount'] = mount
    })

    const editor = page.getByRole('textbox', { name: 'Editable text' })
    expect(await editor.inputValue()).toBe('before')
    await editor.fill('after')
    expect(
      await page.evaluate(async () => {
        const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
        const typed = ui as unknown as typeof import('@modkit/ui')
        return typed.requestEditorSave(document.querySelector('#app') as HTMLElement)
      }),
    ).toBe(true)
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Saved')
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { editorState: () => { text: string } }).editorState(),
      ),
    ).toMatchObject({ text: 'after' })

    await page.getByRole('button', { name: 'Undo' }).click()
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Undone')
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { editorState: () => { text: string } }).editorState().text,
      ),
    ).toBe('before')
    await page.getByRole('button', { name: 'Redo' }).click()
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'Redone')
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { editorState: () => { text: string } }).editorState().text,
      ),
    ).toBe('after')

    await page.evaluate(() =>
      (globalThis as unknown as { editorExternalChange: () => void }).editorExternalChange(),
    )
    await editor.fill('conflicting')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForFunction(() =>
      document.querySelector('output')?.textContent?.startsWith('Conflict'),
    )
    expect(
      await page.evaluate(
        () => (globalThis as unknown as { editorState: () => { text: string } }).editorState().text,
      ),
    ).toBe('after')
    await page.evaluate(async () => {
      await (
        globalThis as unknown as { currentEditorMount: { unmount(): Promise<void> } }
      ).currentEditorMount.unmount()
    })
    expect(
      await page.evaluate(
        () =>
          (globalThis as unknown as { editorState: () => { releases: number } }).editorState()
            .releases,
      ),
    ).toBe(1)
  })

  it('mounts a host-owned session once while switching its resolved stages', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const typed = ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      const state = {
        opens: 0,
        descriptors: 0,
        mounts: 0,
        knowledgeMounts: 0,
        unmounts: 0,
        disposes: 0,
      }
      const knowledge = {
        snapshotId: 'preview-knowledge',
        async search() {
          throw new Error('unused')
        },
        async resolve() {
          throw new Error('unused')
        },
      }
      const viewer = (label: string) =>
        ({
          abiVersion: 1,
          async mount(args: { container: unknown; knowledge?: unknown }) {
            state.mounts += 1
            if (args.knowledge === knowledge) state.knowledgeMounts += 1
            ;(args.container as HTMLElement).textContent = label
            return {
              async update() {},
              async unmount() {
                state.unmounts += 1
              },
            }
          },
        }) as const
      const preview = typed.createCodecPreview({
        supported: ['.JSON', 'json'],
        knowledge: knowledge as never,
        stages: [
          { id: 'primary', label: 'Primary', contract: 'test.view/primary', module: viewer('one') },
          {
            id: 'alternate',
            label: 'Alternate',
            contract: 'test.view/alternate',
            module: viewer('two'),
          },
        ],
        async openSession() {
          state.opens += 1
          return {
            async descriptor() {
              state.descriptors += 1
              return {
                traits: [],
                dataSources: [
                  { contract: 'test.view/primary' },
                  { contract: 'test.view/alternate' },
                ],
              }
            },
            async dataSource() {
              return { value: {} }
            },
            async dispose() {
              state.disposes += 1
            },
          }
        },
      })

      const handle = await preview.open(
        root,
        { id: 'fixture', name: 'fixture.json', directory: false },
        new Uint8Array(),
      )
      if (handle === undefined) throw new Error('host session did not produce a preview')
      await handle.show('alternate')
      const beforeUnmount = {
        supported: preview.supported,
        views: handle.views,
        activeView: handle.activeView,
        text: root.textContent,
        ...state,
      }
      await handle.unmount()
      return { beforeUnmount, afterUnmount: state }
    })

    expect(result.beforeUnmount).toMatchObject({
      supported: ['json'],
      views: [
        { id: 'primary', label: 'Primary' },
        { id: 'alternate', label: 'Alternate' },
      ],
      activeView: 'alternate',
      text: 'two',
      opens: 1,
      descriptors: 1,
      mounts: 2,
      knowledgeMounts: 2,
      unmounts: 1,
      disposes: 0,
    })
    expect(result.afterUnmount).toMatchObject({ opens: 1, unmounts: 2, disposes: 1 })
  })

  it('routes the picker and a drop through the host, not into a replaced preview pane', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const typed = ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      const opened: { id: string; size?: number }[] = []
      const bytes = new TextEncoder().encode('hello')
      const access = {
        label: 'memory',
        async list(parent?: string) {
          return parent === undefined
            ? [{ id: 'a.txt', name: 'a.txt', directory: false, size: 5 }]
            : []
        },
        async read() {
          return bytes
        },
      }
      const explorer = typed.createExplorer(document, {
        preview: typed.createCodecPreview({ stages: [] }),
        // a host with its own editor area: it takes over opening and replaces the preview pane
        onOpen: entry =>
          opened.push({ id: entry.id, ...(entry.size === undefined ? {} : { size: entry.size }) }),
        async openFile() {
          return {
            access,
            entry: { id: 'picked.txt', name: 'picked.txt', directory: false, size: 5 },
          }
        },
        async acceptDrop() {
          return {
            access,
            entry: { id: 'dropped.txt', name: 'dropped.txt', directory: false, size: 5 },
          }
        },
      })
      root.replaceChildren(explorer.root)
      const previewPane = explorer.root.querySelector('[data-mk-part="explorer.preview"]')
      previewPane?.remove()
      await explorer.setAccess(access)

      // the tree's own activation already routed through `onOpen`; these two did not

      // 1. the file picker action
      const actions = [...explorer.root.querySelectorAll('button')] as HTMLButtonElement[]
      actions.find(button => button.textContent?.startsWith('Open file'))?.click()

      // 2. a drop, on whatever element the explorer chose as its target
      const transfer = new DataTransfer()
      explorer.root.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))

      await new Promise(resolve => setTimeout(resolve, 150))
      return { opened, paneRemoved: previewPane !== null }
    })

    expect(result.paneRemoved).toBe(true)
    // both reached the host, carrying the size the listing reported. Before this they called
    // `explorer.open`, which previews into `explorer.preview` — the element this host removed — so
    // the picker mounted into a detached node and the drop listener sat on an element not in the
    // document
    expect(result.opened).toEqual([
      { id: 'picked.txt', size: 5 },
      { id: 'dropped.txt', size: 5 },
    ])
  })

  it('falls back to bounded Text/Hex views and lets the explorer switch views', async () => {
    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const typed = ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      const text = new TextEncoder().encode('fallback text')
      const preview = typed.createCodecPreview({
        stages: [],
        fallback: { text: typed.boundedTextViewer, hex: typed.hexViewer },
      })
      const explorer = typed.createExplorer(document, { preview })
      root.replaceChildren(explorer.root)
      await explorer.setAccess({
        label: 'memory',
        async list() {
          return []
        },
        async read() {
          return text
        },
      })
      await explorer.open({ id: 'unknown', name: 'fixture.unknown', directory: false })
      ;(globalThis as unknown as { currentExplorer?: typeof explorer }).currentExplorer = explorer
    })

    const picker = page.getByRole('combobox', { name: 'Preview view' })
    await expect(picker.locator('option').allTextContents()).resolves.toEqual(['Text', 'Hex'])
    // the fallback stages carry ids of their own; before that the picker's *value* for a file no
    // codec claimed was the contract id, which is what a host reads back and shows in a status line
    expect(await picker.inputValue()).toBe('text')
    expect(await page.getByText('fallback text', { exact: true }).count()).toBe(1)

    await picker.selectOption('hex')
    await page.waitForFunction(
      () =>
        document.querySelector('[data-mk-part="explorer.viewpicker"]')?.getAttribute('value') ===
          'hex' ||
        (document.querySelector('[data-mk-part="explorer.viewpicker"]') as HTMLSelectElement | null)
          ?.value === 'hex',
    )
    expect(await page.locator('[data-mk-part="hex.content"]').count()).toBe(1)

    await page.evaluate(() => {
      ;(
        globalThis as unknown as { currentExplorer?: { destroy(): void } }
      ).currentExplorer?.destroy()
    })
  })

  it('shows exactly one tab at a time: the inactive content is hidden, kept mounted, and switching flips it', async () => {
    await reset()
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const typed = ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      root.style.setProperty('height', '600px')
      let mounts = 0
      const preview: import('@modkit/ui').PreviewResolver = {
        supported: [],
        async open(container, entry) {
          mounts += 1
          const body = document.createElement('p')
          body.textContent = `content of ${entry.name}`
          container.append(body)
          return {
            views: [{ id: 'text', label: 'Text' }],
            activeView: 'text',
            async show() {},
            async unmount() {
              container.replaceChildren()
            },
          }
        },
      }
      const area = typed.createEditorArea(document, {
        preview,
        async read() {
          return new Uint8Array()
        },
      })
      root.replaceChildren(area.root)
      area.root.style.setProperty('height', '600px')
      await area.open({ id: '/first.txt', name: 'first.txt', directory: false })
      await area.open({ id: '/second.txt', name: 'second.txt', directory: false })
      ;(globalThis as unknown as Record<string, unknown>)['tabsFixture'] = {
        area,
        mounts: () => mounts,
      }
    })

    const state = () =>
      page.evaluate(() => {
        const contents = [
          ...document.querySelectorAll('[data-mk-part="explorer.tabcontent"]'),
        ] as HTMLElement[]
        return contents.map(node => ({
          text: node.textContent ?? '',
          hidden: node.hidden,
          // the regression: `hidden` was set but authored `display: flex` defeated it, so every
          // open file rendered stacked one under another — computed display is the fact
          display: getComputedStyle(node).display,
          height: node.getBoundingClientRect().height,
        }))
      })

    let contents = await state()
    expect(contents).toHaveLength(2)
    const visible = contents.filter(item => item.display !== 'none')
    expect(visible).toHaveLength(1)
    expect(visible[0]?.text).toContain('second.txt')
    const concealed = contents.find(item => item.display === 'none')
    expect(concealed?.hidden).toBe(true)
    expect(concealed?.height).toBe(0)

    // switching activates the other tab without a second mount of anything
    await page.evaluate(async () => {
      const fixture = (
        globalThis as unknown as {
          tabsFixture: { area: import('@modkit/ui').EditorArea; mounts: () => number }
        }
      ).tabsFixture
      await fixture.area.open({ id: '/first.txt', name: 'first.txt', directory: false })
    })
    contents = await state()
    const nowVisible = contents.filter(item => item.display !== 'none')
    expect(nowVisible).toHaveLength(1)
    expect(nowVisible[0]?.text).toContain('first.txt')
    // both stayed mounted — the tab state survives independently of the viewer instance,
    // and re-activating did not create a second interface for the same file
    const mounts = await page.evaluate(() =>
      (globalThis as unknown as { tabsFixture: { mounts: () => number } }).tabsFixture.mounts(),
    )
    expect(mounts).toBe(2)
  })

  it('gives the editor area the full pane even when the host hides the toolbar', async () => {
    await reset()
    // Layout is the claim here, and the page links the shipped stylesheet, so the measurement
    // reflects what a host actually renders.
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const typed = ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      root.style.setProperty('height', '600px')

      const preview: import('@modkit/ui').PreviewResolver = {
        supported: [],
        async open(container, entry) {
          container.textContent = entry.name
          return {
            views: [{ id: 'text', label: 'Text' }],
            activeView: 'text',
            async show() {},
            async unmount() {
              container.replaceChildren()
            },
          }
        },
      }
      const explorer = typed.createExplorer(document, {
        preview,
        // The desktop host hides the toolbar because it has a native menu.
        showToolbar: false,
        onOpen() {},
      })
      const area = typed.createEditorArea(document, {
        preview,
        async read() {
          return new Uint8Array()
        },
      })
      const pane = explorer.root.querySelector('[data-mk-part="explorer.preview"]')
      pane?.replaceWith(area.root)
      root.replaceChildren(explorer.root)
      // The explorer fills whatever box the host gives it; a host that supplies none gets a
      // content-sized grid, which is why the desktop shell sets a definite height.
      explorer.root.style.setProperty('height', '600px')
      await area.open({ id: '/only.txt', name: 'only.txt', directory: false })
      ;(globalThis as unknown as Record<string, unknown>)['layoutFixture'] = { explorer, area }
    })

    const explorerBox = await page.locator('[data-mk-part="explorer"]').boundingBox()
    const editorsBox = await page.locator('[data-mk-part="explorer.editors"]').boundingBox()
    const sidebarBox = await page.locator('[data-mk-part="explorer.sidebar"]').boundingBox()
    if (explorerBox === null || editorsBox === null || sidebarBox === null) {
      throw new Error('explorer layout did not render')
    }

    // The regression: with the toolbar hidden the editor landed in the `auto` row and collapsed
    // to a short band while the free space went to the row below it.
    expect(editorsBox.height).toBeGreaterThan(explorerBox.height * 0.7)
    // And it must sit beside the tree, not under it.
    expect(editorsBox.x).toBeGreaterThan(sidebarBox.x + sidebarBox.width - 2)
    expect(Math.abs(editorsBox.y - sidebarBox.y)).toBeLessThan(2)

    await page.evaluate(() => {
      const fixture = (
        globalThis as unknown as {
          layoutFixture: { explorer: { destroy(): void }; area: { destroy(): void } }
        }
      ).layoutFixture
      fixture.area.destroy()
      fixture.explorer.destroy()
    })
  })

  it('keeps tab mounts alive across switches and opens a focused split group', async () => {
    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const typed = ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      let unmounts = 0
      let saves = 0
      const preview: import('@modkit/ui').PreviewResolver = {
        supported: [],
        async open(container, entry) {
          let active = 'text'
          const render = (view: string): void => {
            active = view
            container.textContent = `${entry.name}:${view}`
          }
          render(active)
          const editor = document.createElement('div')
          editor.dataset['modkitEditor'] = 'fixture'
          editor.hidden = true
          container.append(editor)
          typed.handleEditorSaveRequest(editor, async () => {
            saves += 1
            return true
          })
          return {
            views: [
              { id: 'text', label: 'Text' },
              { id: 'hex', label: 'Hex' },
            ],
            get activeView() {
              return active
            },
            async show(view) {
              render(view)
            },
            async unmount() {
              unmounts += 1
              container.replaceChildren()
            },
          }
        },
      }
      const area = typed.createEditorArea(document, {
        preview,
        async read() {
          return new Uint8Array()
        },
      })
      root.replaceChildren(area.root)
      await area.open({ id: '/a.txt', name: 'a.txt', directory: false })
      await area.open({ id: '/b.txt', name: 'b.txt', directory: false })
      const saved = await area.save('/a.txt')
      ;(globalThis as unknown as Record<string, unknown>)['editorAreaFixture'] = {
        area,
        unmounts: () => unmounts,
        saves: () => saves,
        saved,
      }
    })

    expect(
      await page.evaluate(() => {
        const fixture = (
          globalThis as unknown as {
            editorAreaFixture: { saves(): number; saved: boolean }
          }
        ).editorAreaFixture
        return { saves: fixture.saves(), saved: fixture.saved }
      }),
    ).toEqual({ saves: 1, saved: true })

    expect(await page.getByRole('tab').allTextContents()).toEqual(['a.txt×', 'b.txt×'])
    await page.getByText('a.txt', { exact: true }).click()
    expect(await page.getByText('a.txt:text', { exact: true }).count()).toBe(1)
    expect(
      await page.evaluate(() =>
        (
          globalThis as unknown as { editorAreaFixture: { unmounts(): number } }
        ).editorAreaFixture.unmounts(),
      ),
    ).toBe(0)

    await page.getByRole('combobox', { name: 'View' }).selectOption('hex')
    expect(await page.getByText('a.txt:hex', { exact: true }).count()).toBe(1)

    await page.evaluate(async () => {
      const fixture = (
        globalThis as unknown as {
          editorAreaFixture: { area: import('@modkit/ui').EditorArea }
        }
      ).editorAreaFixture
      fixture.area.split()
      await fixture.area.open({ id: '/c.txt', name: 'c.txt', directory: false })
    })
    expect(await page.locator('[data-mk-part="explorer.group"]').count()).toBe(2)
    expect(await page.getByText('c.txt:text', { exact: true }).count()).toBe(1)

    await page.evaluate(() => {
      ;(
        globalThis as unknown as { editorAreaFixture: { area: { destroy(): void } } }
      ).editorAreaFixture.area.destroy()
    })
    expect(
      await page.evaluate(() =>
        (
          globalThis as unknown as { editorAreaFixture: { unmounts(): number } }
        ).editorAreaFixture.unmounts(),
      ),
    ).toBe(3)
  })

  it('hosts extra settings groups in one shell and replaces a built-in group by id', async () => {
    await reset()
    const result = await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const typed = ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      const store = typed.createMemorySettingsStore({
        ...typed.DEFAULT_SETTINGS,
        appearance: { theme: 'host-theme', density: 'compact' },
      })
      let reloads = 0
      let destroyed = 0
      const settings = typed.createSettingsUi(document, {
        store,
        themes: [],
        registerFileTypes: async () => 'registered',
        extraGroups: [
          {
            id: 'extensions',
            label: 'Extensions',
            render(host, context) {
              host.textContent = `Host extensions · ${context.settings.appearance.theme}`
            },
            reload(context) {
              reloads += 1
              context.report('Host extension report loaded')
            },
            destroy() {
              destroyed += 1
            },
          },
          {
            id: 'codecs',
            label: 'Codecs',
            render(host) {
              host.textContent = 'Host codecs'
            },
          },
        ],
      })
      root.replaceChildren(settings.root)
      await settings.reload()
      const labels = [...settings.root.querySelectorAll('[data-mk-part="settings.group"]')].map(
        node => node.textContent,
      )
      const showedExtensions = settings.showGroup('extensions')
      const extensionText = settings.root.querySelector(
        '[data-mk-part="settings.pane"]',
      )?.textContent
      const refusedUnknown = settings.showGroup('missing')
      const status = settings.root.querySelector('[data-mk-part="settings.status"]')?.textContent
      settings.destroy()
      return {
        labels,
        showedExtensions,
        extensionText,
        refusedUnknown,
        status,
        reloads,
        destroyed,
      }
    })

    expect(result).toEqual({
      labels: ['Appearance', 'Extensions', 'Codecs', 'File associations'],
      showedExtensions: true,
      extensionText: 'Host extensions · host-theme',
      refusedUnknown: false,
      status: 'Host extension report loaded',
      reloads: 1,
      destroyed: 1,
    })
  })

  it('shows semantic model facets and switches between decoded primitives', async () => {
    await reset()
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const typed = ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      const primitiveCalls: string[] = []
      let releases = 0
      const primitive = (id: string, offset: number) => ({
        id,
        topology: 'triangles' as const,
        positions: new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      })
      const scene = {
        async info() {
          return {
            scenes: 1,
            nodes: 2,
            meshes: 1,
            primitives: 2,
            materials: 1,
            textures: 1,
            animations: 1,
            geometryAccess: 'decoded' as const,
          }
        },
        async nodes() {
          return { items: [] }
        },
        async meshes() {
          return { items: [{ id: 'mesh', primitiveIds: ['hull', 'turret'] }] }
        },
        async primitive(id: string) {
          primitiveCalls.push(id)
          return primitive(id, id === 'hull' ? 0 : 4)
        },
      }
      const skeleton = {
        async info() {
          return { bindings: 2, named: 2, companionBound: 0, hierarchies: 1 }
        },
        async bindings() {
          return {
            items: [
              {
                partId: 'bone/0',
                boneIndex: 0,
                boneName: 'Root',
                provenance: 'direct' as const,
                hierarchyId: 'bones',
                parentBoneIndex: null,
                nativeFlags: 1,
                flagNames: ['inheritTranslation'],
              },
              {
                partId: 'bone/1',
                boneIndex: 1,
                boneName: 'Turret',
                provenance: 'direct' as const,
                hierarchyId: 'bones',
                parentBoneIndex: 0,
                nativeFlags: 0,
                flagNames: [],
              },
            ],
          }
        },
      }
      const materials = {
        async info() {
          return { materials: 1 }
        },
        async materials() {
          return {
            items: [
              {
                id: 'material-0',
                name: 'Hull',
                type: 'standard',
                blendMode: 'opaque',
                layers: [{ slot: 'diffuse', resourceId: 'Hull.dds' }],
              },
            ],
          }
        },
      }
      const values: Record<string, unknown> = {
        'common.view/model-scene-source': scene,
        'common.view/model-skeleton-source': skeleton,
        'common.view/model-material-source': materials,
      }
      const slot = {
        slotId: 'model',
        kind: 'stage',
        contributionId: 'modkit.ui/model-stage',
        extensionId: 'modkit/ui',
        priority: 100,
        bindings: Object.keys(values).map(contract => ({
          bindingId: contract,
          contract,
          major: 1,
        })),
      }
      const mount = await typed.modelViewer.mount({
        container: root,
        descriptor: { revision: 'content-hash.sha256:model', operations: [], diagnostics: [] },
        slot,
        sources: {
          async get(binding: { contract: string }) {
            return {
              value: values[binding.contract],
              async release() {
                releases += 1
              },
            }
          },
        },
        operations: { async dispose() {} },
      } as never)
      ;(globalThis as unknown as Record<string, unknown>)['modelFixture'] = {
        mount,
        primitiveCalls,
        releases: () => releases,
      }
    })

    expect(
      await page.locator('[data-mk-part="model.canvas"]').getAttribute('data-model-renderer'),
    ).toBe('wireframe')
    expect(await page.getByRole('combobox', { name: 'Model primitive' }).inputValue()).toBe('hull')
    expect(await page.getByText('bones (2)', { exact: true }).isVisible()).toBe(true)
    expect(await page.getByText('materials (1)', { exact: true }).isVisible()).toBe(true)
    await page.getByRole('combobox', { name: 'Model primitive' }).selectOption('turret')
    await page.waitForFunction(() =>
      (
        globalThis as unknown as { modelFixture: { primitiveCalls: string[] } }
      ).modelFixture.primitiveCalls.includes('turret'),
    )
    expect(
      await page.evaluate(
        () =>
          (globalThis as unknown as { modelFixture: { primitiveCalls: string[] } }).modelFixture
            .primitiveCalls,
      ),
    ).toEqual(['hull', 'turret'])
    await page.evaluate(async () => {
      await (
        globalThis as unknown as { modelFixture: { mount: { unmount(): Promise<void> } } }
      ).modelFixture.mount.unmount()
    })
    expect(
      await page.evaluate(() =>
        (globalThis as unknown as { modelFixture: { releases(): number } }).modelFixture.releases(),
      ),
    ).toBe(5)
  })

  /**
   * The two render paths of the model stage, in a real browser, told apart by the evidence.
   *
   * This is the pair the wave exists for: a shaded GPU frame where the host resolved a provider,
   * and the 2D wireframe where it did not — both working, and distinguishable without reading any
   * localized text. The provider is the shipped `modkit.browser-webgl` module, driven through the
   * contract's own `SceneRendererPort`, so what is exercised is the product route rather than a
   * test double of it.
   */
  const mountModelStage = async (mode: 'resolved' | 'refused'): Promise<void> => {
    await page.evaluate(async selection => {
      const globals = globalThis as unknown as {
        modkit: {
          ui: Record<string, unknown>
          sceneRenderer: {
            createProvider(request: { contract: string; major: number }): { value: unknown }
          }
        }
      }
      const typed = globals.modkit.ui as unknown as typeof import('@modkit/ui')
      const root = document.querySelector('#app') as HTMLElement
      const port = {
        async acquire(request: { outputKind: string }) {
          if (selection === 'refused') {
            return {
              state: 'unresolved',
              diagnostics: [
                {
                  severity: 'information',
                  code: 'x3.test/no-renderer-here',
                  message: 'this realm offers no renderer',
                },
              ],
            }
          }
          const provider = globals.modkit.sceneRenderer.createProvider({
            contract: 'common.render/scene-3d',
            major: request.outputKind === 'rgba8' ? 1 : 0,
          })
          return {
            state: 'resolved',
            diagnostics: [],
            lease: { renderer: provider.value, release: async () => undefined },
          }
        },
      }
      // one quad and two bones: enough to cover pixels and to draw a bone overlay over them
      const scene = {
        async info() {
          return {
            scenes: 1,
            nodes: 1,
            meshes: 1,
            primitives: 1,
            materials: 1,
            textures: 0,
            animations: 0,
            geometryAccess: 'decoded' as const,
          }
        },
        async nodes() {
          return { items: [] }
        },
        async meshes() {
          return { items: [{ id: 'mesh', primitiveIds: ['plate'] }] }
        },
        async primitive() {
          return {
            id: 'plate',
            topology: 'triangles' as const,
            positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
            normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
            materialId: 'plate-material',
          }
        },
      }
      const skeleton = {
        async info() {
          return { bindings: 2, named: 2, companionBound: 0 }
        },
        async bindings() {
          return {
            items: [
              {
                partId: 'bone/0',
                boneIndex: 0,
                boneName: 'Root',
                provenance: 'direct' as const,
                parentBoneIndex: null,
                restMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              },
              {
                partId: 'bone/1',
                boneIndex: 1,
                boneName: 'Tip',
                provenance: 'direct' as const,
                parentBoneIndex: 0,
                restMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.5, 0, 1],
              },
            ],
          }
        },
      }
      const values: Record<string, unknown> = {
        'common.view/model-scene-source': scene,
        'common.view/model-skeleton-source': skeleton,
      }
      const slot = {
        slotId: 'model',
        kind: 'stage',
        contributionId: 'modkit.ui/model-stage',
        extensionId: 'modkit/ui',
        priority: 100,
        bindings: Object.keys(values).map(contract => ({
          bindingId: contract,
          contract,
          major: 1,
        })),
      }
      const mount = await typed.createModelViewer({ renderer: port as never }).mount({
        container: root,
        descriptor: { revision: 'content-hash.sha256:render', operations: [], diagnostics: [] },
        slot,
        sources: {
          async get(binding: { contract: string }) {
            return { value: values[binding.contract], async release() {} }
          },
        },
        operations: { async dispose() {} },
      } as never)
      ;(globalThis as unknown as Record<string, unknown>)['renderFixture'] = { mount }
    }, mode)
  }

  const modelCanvasEvidence = async (): Promise<Record<string, unknown>> =>
    page.evaluate(() => {
      const canvas = document.querySelector(
        '[data-mk-part="model.canvas"]',
      ) as HTMLCanvasElement | null
      if (canvas === null) return { present: false }
      const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
      let opaquePixels = 0
      const shades = new Set<number>()
      if (pixels !== undefined) {
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if ((pixels[offset + 3] ?? 0) === 0) continue
          opaquePixels += 1
          shades.add(pixels[offset] as number)
        }
      }
      return {
        present: true,
        renderer: canvas.getAttribute('data-model-renderer'),
        rendererId: canvas.getAttribute('data-model-renderer-id'),
        status: canvas.getAttribute('data-model-renderer-status'),
        diagnostic: canvas.getAttribute('data-model-renderer-diagnostic'),
        skeleton: canvas.getAttribute('data-model-skeleton'),
        width: canvas.width,
        height: canvas.height,
        opaquePixels,
        distinctReds: shades.size,
      }
    })

  it('draws a shaded frame through the resolved WebGL2 provider and names it in the evidence', async () => {
    await reset()
    await mountModelStage('resolved')
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-mk-part="model.canvas"]')
          ?.getAttribute('data-model-renderer') === 'webgl2',
    )
    // the frame arrives asynchronously; wait for it rather than for the attribute alone
    await page.waitForFunction(() => {
      const canvas = document.querySelector(
        '[data-mk-part="model.canvas"]',
      ) as HTMLCanvasElement | null
      if (canvas === null) return false
      const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
      if (pixels === undefined) return false
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if ((pixels[offset] ?? 0) !== 0) return true
      }
      return false
    })
    const evidence = await modelCanvasEvidence()
    expect(evidence).toMatchObject({
      present: true,
      renderer: 'webgl2',
      rendererId: 'modkit.browser-webgl',
      status: 'resolved',
      skeleton: '2',
    })
    expect(evidence['opaquePixels']).toBeGreaterThan(0)
    await page.evaluate(async () => {
      await (
        globalThis as unknown as { renderFixture: { mount: { unmount(): Promise<void> } } }
      ).renderFixture.mount.unmount()
    })
  })

  it('keeps the 2D wireframe when the host offers no renderer, and says which reason', async () => {
    await reset()
    await mountModelStage('refused')
    await page.waitForFunction(
      () =>
        ((document.querySelector('[data-mk-part="model.canvas"]') as HTMLCanvasElement | null)
          ?.width as number) > 0,
    )
    const evidence = await modelCanvasEvidence()
    expect(evidence).toMatchObject({
      present: true,
      renderer: 'wireframe',
      rendererId: null,
      status: 'unresolved',
      diagnostic: 'x3.test/no-renderer-here',
      skeleton: '2',
    })
    expect(evidence['opaquePixels']).toBeGreaterThan(0)
    await page.evaluate(async () => {
      await (
        globalThis as unknown as { renderFixture: { mount: { unmount(): Promise<void> } } }
      ).renderFixture.mount.unmount()
    })
  })
})
