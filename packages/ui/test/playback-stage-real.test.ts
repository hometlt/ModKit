import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
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
      contents: `import * as ui from '@modkit/ui'; globalThis.modkit = { ui };`,
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
  if (bundle === undefined) throw new Error('playback bundle was not emitted')
  const stylesheet = await readFile('packages/ui/styles/modkit-ui.css')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'">
    <link rel="stylesheet" href="/modkit-ui.css"></head>
    <body><main id="app"></main><script type="module" src="/app.js"></script></body></html>`
  server = createServer((request, response) => {
    const [type, body] =
      request.url === '/app.js'
        ? ['text/javascript', bundle]
        : request.url === '/modkit-ui.css'
          ? ['text/css', stylesheet]
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
  page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.waitForFunction(() => 'modkit' in globalThis)
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve => server?.close(() => resolve()))
})

describe('playback stage in a real browser', () => {
  it('keeps controls, events, charts and positions in step with the transport', async () => {
    await page.evaluate(async () => {
      const { ui } = (globalThis as unknown as { modkit: { ui: Record<string, unknown> } }).modkit
      const snapshot = (positionMs: number, state = 'paused', rate = 1) => ({
        state,
        positionMs,
        durationMs: 60_000,
        rate,
        seekable: true,
        live: false,
        tracks: [],
        controls: { playPause: 'media.play-pause', seek: 'media.seek', setRate: 'media.set-rate' },
      })
      const log: { handler: string; input: unknown }[] = []
      let push: ((value: unknown) => void) | undefined
      let position = 0
      const transport = {
        async snapshot() {
          return snapshot(position)
        },
        async *events(signal?: AbortSignal) {
          while (!signal?.aborted) {
            const next = await new Promise(resolve => (push = resolve))
            yield { kind: 'snapshot', snapshot: next }
          }
        },
        async timeline() {
          return {
            label: 'Abyssal Reef LE · 30.09.2026',
            participants: [
              {
                id: '1',
                label: 'Alpha',
                color: '#ff0000',
                group: 'Terran',
                outcome: 'win',
                facts: [{ id: 'apm', label: 'APM', value: '150' }],
              },
              { id: '2', label: 'Beta', color: '#0000ff', outcome: 'loss', facts: [] },
            ],
            series: [
              { metric: 'units', label: 'Units', participantId: '1', points: [0, 12, 30_000, 40] },
              { metric: 'units', label: 'Units', participantId: '2', points: [0, 12, 30_000, 20] },
              { metric: 'custom', label: 'Custom metric', points: [0, 1] },
            ],
            markers: [
              { positionMs: 5_000, kind: 'unit-born', label: 'Marine', participantId: '1' },
              { positionMs: 20_000, kind: 'unit-died', label: 'Zergling', participantId: '2' },
              { positionMs: 40_000, kind: 'novel-kind', label: 'Mystery' },
              { positionMs: 50_000, kind: 'chat', label: 'Alpha: gg', participantId: '1' },
            ],
            complete: false,
            fidelity: 'sampled',
          }
        },
      }
      let pinned = 0
      const world = {
        async info() {
          pinned = position
          return {
            contract: 'common.view/world-scene-source',
            major: 1,
            maturity: 'publisher-candidate',
            snapshotId: `w:${pinned}`,
            mapId: 'fixture',
            coordinateSpaces: [],
            crossSpaceTransforms: [],
            bounds: [
              {
                facet: 'objects',
                coordinateSpaceId: 's',
                x: { state: 'known', minimum: 0, maximum: 200 },
                y: { state: 'known', minimum: 0, maximum: 100 },
                z: { state: 'known', minimum: 0, maximum: 0 },
              },
            ],
            facets: [
              {
                facet: 'objects',
                layerId: 'u',
                state: 'available',
                itemCount: 1,
                lods: ['sampled'],
              },
            ],
            provenance: [],
            unknownFacets: [],
            lossPolicy: 'explicit-partial',
            complete: false,
          }
        },
        async page() {
          const count = pinned >= 20_000 ? 1 : 2
          return {
            snapshotId: `w:${pinned}`,
            facet: 'objects',
            state: 'available',
            items: Array.from({ length: count }, (_, index) => ({
              facet: 'objects',
              id: `unit:${index}`,
              layerId: 'u',
              coordinateSpaceId: 's',
              kind: 'unit',
              objectId: index,
              position: { x: 10 + index, y: 10, z: 0 },
              player: index + 1,
            })),
          }
        },
      }
      const operations = ['media.play-pause', 'media.seek', 'media.set-rate']
      const descriptor = {
        revision: 'r1',
        operations: operations.map(id => ({
          id,
          handlerId: id,
          mutatesSource: false,
          requiredPermissions: ['read-source'],
          outputKinds: ['none'],
          state: 'available',
        })),
      }
      const container = document.createElement('div')
      document.querySelector('#app')?.append(container)
      await (
        ui['createPlaybackViewer'] as () => { mount(args: unknown): Promise<unknown> }
      )().mount({
        container,
        descriptor,
        slot: {
          slotId: 'playback',
          kind: 'stage',
          contributionId: 'modkit.ui/playback-stage',
          extensionId: 'modkit/ui',
          priority: 390,
          bindings: [
            { bindingId: 'content', contract: 'common.view/transport-source', major: 1 },
            { bindingId: 'world', contract: 'common.view/world-scene-source', major: 1 },
          ],
        },
        sources: {
          async get(binding: { contract: string }) {
            const value = binding.contract === 'common.view/transport-source' ? transport : world
            return { value, async release() {} }
          },
        },
        operations: {
          async invoke(handler: string, input: unknown) {
            log.push({ handler, input })
            return { state: 'ok', output: { kind: 'none' }, diagnostics: [] }
          },
        },
      })
      Object.assign(globalThis, {
        playback: {
          log,
          emit(next: number, state?: string, rate?: number) {
            position = next
            push?.(snapshot(next, state, rate))
          },
        },
      })
    })

    const text = (selector: string) => page.locator(selector).first().innerText()
    // the replay's map and date as the player's title
    expect(await text('[data-mk-part="playback.title"]')).toBe('Abyssal Reef LE · 30.09.2026')
    expect(await text('[data-mk-part="playback.time"]')).toBe('0:00 / 1:00')
    expect(await text('[data-mk-part="playback.note"]')).toContain('not a game simulation')
    expect(await text('[data-mk-part="playback.note"]')).toContain('Bounded view')
    const participants = await page.locator('[data-mk-part="playback.participant"]').allInnerTexts()
    expect(participants[0]).toContain('Alpha')
    expect(participants[0]).toContain('Terran · Victory · APM 150')
    expect(participants[1]).toContain('Defeat')
    expect(
      await page.locator('[data-mk-part="playback.chart"] figcaption').allInnerTexts(),
    ).toEqual(['Units', 'Custom metric'])
    const events = await page.locator('[data-mk-part="playback.event"]').allInnerTexts()
    expect(events).toEqual([
      '0:05 Born Marine',
      '0:20 Died Zergling',
      '0:40 novel-kind Mystery',
      '0:50 Chat Alpha: gg',
    ])
    expect(
      await page.locator('[data-mk-part="playback.map"] canvas').getAttribute('aria-label'),
    ).toBe('Positions at 0:00: 2 units')

    // The transport moves: time, seek, playhead, the active event and the map follow it.
    await page.evaluate(() =>
      (globalThis as unknown as { playback: { emit(n: number, s: string): void } }).playback.emit(
        21_000,
        'playing',
      ),
    )
    await page.waitForFunction(
      () => document.querySelector('[data-mk-part="playback.time"]')?.textContent === '0:21 / 1:00',
    )
    expect(await page.locator('[data-mk-part="transport.button"]').innerText()).toBe('Pause')
    expect(await page.locator('[data-mk-part="playback.seek"]').inputValue()).toBe('21000')
    expect(
      await page.locator('[data-mk-part="playback.event"][aria-current="true"]').allInnerTexts(),
    ).toEqual(['0:20 Died Zergling'])
    expect(
      await page.locator('[data-mk-part="playback.playhead"]').first().getAttribute('x1'),
    ).toBe(String((21_000 / 60_000) * 240))
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-mk-part="playback.map"] canvas')
          ?.getAttribute('aria-label') === 'Positions at 0:21: 1 units',
    )

    // Controls go through the declared operations with the transport's own input shapes.
    await page.locator('[data-mk-part="playback.event"] button').first().click()
    await page.locator('[data-mk-part="transport.button"]').click()
    await page.locator('[data-mk-part="playback.rate"]').selectOption('4')
    await page.locator('[data-mk-part="playback.seek"]').fill('30000')
    const log = await page.evaluate(
      () => (globalThis as unknown as { playback: { log: unknown[] } }).playback.log,
    )
    expect(log).toEqual([
      { handler: 'media.seek', input: { positionMs: 5_000 } },
      { handler: 'media.play-pause', input: null },
      { handler: 'media.set-rate', input: { rate: 4 } },
      { handler: 'media.seek', input: { positionMs: 30_000 } },
    ])

    // A rate the picker does not list is still shown, and a pause relabels the button.
    await page.evaluate(() =>
      (
        globalThis as unknown as { playback: { emit(n: number, s: string, r: number): void } }
      ).playback.emit(30_000, 'paused', 3),
    )
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-mk-part="playback.rate"]') as HTMLSelectElement)?.value ===
        '3',
    )
    expect(await page.locator('[data-mk-part="transport.button"]').innerText()).toBe('Play')
  }, 60_000)
})
