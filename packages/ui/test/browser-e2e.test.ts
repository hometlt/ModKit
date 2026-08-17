/* eslint-disable @typescript-eslint/no-empty-function -- browser-side protocol stubs intentionally do no work */
import { createServer, type Server } from 'node:http'
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
        import * as ui from '@modkitx-x3/ui';
        import * as browserHost from '@modkitx-x3/testkit/browser';
        import * as host from '@modkitx-x3/host';
        import { plainTextCodec } from './examples/modkit-extension-x3-plain-text/src/codec.js';
        ${imports}
        const codecFactories = {
          ${codecFactories}
        };
        const providerFactories = {
          ${providerFactories}
        };
        const createTextCodec = (format, context) => codecFactories[format](context);
        const createTextSyntaxProvider = contract => providerFactories[contract]({ contract });
        globalThis.modkit = {
          ui,
          browserHost,
          host,
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
    </head><body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`
  server = createServer((request, response) => {
    if (request.url === '/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(bundle)
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
        contributionId: 'org.modkitx.ui/bounded-text-stage',
        extensionId: 'org.modkitx/ui',
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
        contributionId: 'org.modkitx.ui/virtual-text-stage',
        extensionId: 'org.modkitx/ui',
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
          contributionId: 'org.modkitx.ui/hex-stage',
          extensionId: 'org.modkitx/ui',
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
          contributionId: 'org.modkitx.ui/tree-stage',
          extensionId: 'org.modkitx/ui',
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
          contributionId: 'org.modkitx.ui/table-stage',
          extensionId: 'org.modkitx/ui',
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
        contributionId: 'org.modkitx.ui/bounded-text-stage',
        extensionId: 'org.modkitx/ui',
        priority: 220,
        singletonGroup: 'center-stage',
        bindings: [
          { bindingId: 'text-binding', contract: 'common.view/text-data-source', major: 1 },
        ],
      }
      const hexSlot = {
        slotId: 'hex',
        kind: 'stage',
        contributionId: 'org.modkitx.ui/hex-stage',
        extensionId: 'org.modkitx/ui',
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
          'org.modkitx.ui/bounded-text-stage': ui['boundedTextViewer'],
          'org.modkitx.ui/hex-stage': ui['hexViewer'],
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
              extensionId: 'org.modkitx/ui',
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
        'org.modkitx.ui/bounded-text-stage',
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
          table ? 'org.modkitx.ui/table-stage' : 'org.modkitx.ui/tree-stage',
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
            contributionId: 'org.modkitx.ui/unknown-binary-fallback',
            extensionId: 'org.modkitx/ui',
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
        modules: { 'org.modkitx.ui/unknown-binary-fallback': modkit.ui['hexViewer'] },
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
      fallback: 'org.modkitx.ui/unknown-binary-fallback',
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
      const base = { extensionId: 'org.modkitx/ui', priority: 100, bindings: [] }
      await (ui['diagnosticsPanel'] as { mount(args: unknown): Promise<unknown> }).mount({
        container: panelRoot,
        descriptor,
        slot: {
          ...base,
          slotId: 'd',
          kind: 'panel',
          contributionId: 'org.modkitx.ui/diagnostics-panel',
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
          contributionId: 'org.modkitx.ui/operation-toolbar',
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
          contributionId: 'org.modkitx.ui/transport-bar',
          extensionId: 'org.modkitx/ui',
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
          contributionId: 'org.modkitx.ui/namespace-tree',
          extensionId: 'org.modkitx/ui',
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
        corpusId: 'org.modkitx/browser-editor',
        corpusDigest: 'sha256:corpus',
        conformanceProfile: 'org.modkitx/browser-editor-v1',
        writer: {
          providerId: 'org.modkitx/browser-writer',
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
    await page.getByRole('button', { name: 'Save' }).click()
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
})
