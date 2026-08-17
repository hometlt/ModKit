/**
 * Modkit UI gallery — a conformance harness, not a mock-up.
 *
 * Every viewer card mounts the shipped `ViewerModule` from `@modkitx-x3/ui` against a real
 * in-memory data source through the same `mount/update/unmount` ABI the host uses. Nothing here
 * re-implements a viewer, and nothing pretends a planned component exists.
 */
import {
  vectorViewer,
  videoViewer,
  modelViewer,
  metadataPanel,
  propertiesTable,
  imageViewer,
  audioViewer,
  textEditor,
  createSearchField,
  matchRanges,
  boundedTextViewer,
  virtualTextViewer,
  hexViewer,
  treeViewer,
  tableViewer,
  namespaceViewer,
  transportViewer,
  diagnosticsPanel,
  operationToolbar,
} from '@modkitx-x3/ui'
import {
  TOKENS,
  cssVariableName,
  applyTheme,
  applyDensity,
  setToken,
  readToken,
  PALETTES,
  type TokenName,
} from '@modkitx-x3/ui/tokens'
import { PARTS, STATES, auditParts } from '@modkitx-x3/ui/viewer'
import type { ViewerModule, ViewerMount } from '@modkitx-x3/sdk'
import {
  CASES,
  namespaceSource,
  galleryDescriptor,
  operationSession,
  slotFor,
  sourcesFor,
  type GalleryCase,
} from './fixtures.js'
import catalogSnapshot from './catalog-snapshot.json'
import {
  FORMATS,
  openFormat,
  publishedSources,
  traitsOf,
  type FormatSpec,
  type OpenedFormat,
} from './text-data.js'
import { createEditorPorts } from './editor-ports.js'
import { mountShellDemo } from './shell-demo.js'
import { mountCardDemo, mountGraphDemo } from './card-demo.js'
import { mountImageEditDemo } from './imageedit-demo.js'
import { monacoViewer } from '../../../extensions/common/ui-monaco/src/index.js'

/**
 * Monaco ships as an extension and speaks the editor ABI. The gallery adapts it to the viewer ABI
 * with the same in-memory ports the text editor uses, so the Code tab sits beside the others.
 */
const codeStage: ViewerModule = {
  abiVersion: 1,
  async mount(mountArgs) {
    const ports = createEditorPorts('content-hash.sha256:gallery-text-data', line =>
      $('#editor-log').prepend(el('li', undefined, line)),
    )
    const mounted = await monacoViewer.mount({
      container: mountArgs.container,
      descriptor: mountArgs.descriptor as never,
      edit: ports.session,
      commit: ports.commit,
      payloads: ports.payloads,
      authorization: ports.authorization,
      sources: mountArgs.sources,
      ...(mountArgs.signal === undefined ? {} : { signal: mountArgs.signal }),
    })
    return {
      async update() {
        return Promise.resolve()
      },
      unmount: () => mounted.unmount(),
    }
  },
}
import {
  audioMediaSourceFor,
  makePngBytes,
  makeWavBytes,
  makeWebmBytes,
  modelSceneSourceFor,
  rasterImageSourceFor,
  vectorSceneSourceFor,
  videoMediaSourceFor,
} from './media-fixtures.js'

const MODULES: Readonly<Record<string, ViewerModule>> = {
  'org.modkitx.ui/bounded-text-stage': boundedTextViewer,
  'org.modkitx.ui/virtual-text-stage': virtualTextViewer,
  'org.modkitx.ui/hex-stage': hexViewer,
  'org.modkitx.ui/tree-stage': treeViewer,
  'org.modkitx.ui/table-stage': tableViewer,
  'org.modkitx.ui/namespace-tree': namespaceViewer,
  'org.modkitx.ui/transport-bar': transportViewer,
  'org.modkitx.ui/diagnostics-panel': diagnosticsPanel,
  'org.modkitx.ui/operation-toolbar': operationToolbar,
}

/**
 * Hand Monaco its language workers. Monaco reads this the first time an editor asks for one, which
 * is always after module init, so declaring it here is early enough. Same-origin scripts satisfy
 * `worker-src 'self' blob:` — no relaxation needed.
 */
;(globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorkerUrl(_workerId: string, label: string): string {
    return label === 'json' ? './json.worker.js' : './editor.worker.js'
  },
}

const doc = document
const $ = <T extends HTMLElement>(selector: string): T => {
  const node = doc.querySelector<T>(selector)
  if (node === null) throw new Error(`missing element: ${selector}`)
  return node
}

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = doc.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// ---------------------------------------------------------------- CSP violation log
const violations: string[] = []
const cspList = $('#csp-log')
const cspCount = $('#csp-count')

function renderCspMode(): void {
  const node = $('#csp-mode')
  node.textContent =
    'Strict production policy. Descriptor schemas use build-time standalone validators; runtime ' +
    'code generation and unsafe-eval are not required.'
  node.dataset['degraded'] = 'false'
}

function renderViolations(): void {
  cspCount.textContent = String(violations.length)
  cspCount.dataset['ok'] = String(violations.length === 0)
  cspList.replaceChildren()
  if (violations.length === 0) {
    cspList.append(el('li', 'muted', 'No violations. C1 and C2 hold under the production policy.'))
    return
  }
  for (const entry of violations) cspList.append(el('li', 'violation', entry))
}

doc.addEventListener('securitypolicyviolation', event => {
  violations.push(
    `${event.violatedDirective} — ${event.blockedURI || 'inline'} (${event.sourceFile ?? 'page'})`,
  )
  renderViolations()
})

/**
 * Deliberately attempt every mechanism ADR-UI-001 forbids and report what the policy did.
 *
 * The expected answer depends on which policy the host serves. A page embedding the trusted
 * in-process editor runs `VIEWER_CSP_TRUSTED_EDITOR`, which relaxes C1 and C2 because the editor
 * positions its lines through `style` attributes and themes itself through an injected stylesheet.
 * Asserting "blocked" there would report a false pass, so the probe reads the active policy first.
 * Component-level C1/C2 conformance is proven separately by the static gate in the build script,
 * which does not depend on the page policy at all.
 */
function probeCsp(): void {
  const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''
  const served = `${meta} ${doc.documentElement.dataset.mkCsp ?? ''}`
  const relaxed = served.includes("style-src-attr 'unsafe-inline'")

  const victim = $('#csp-probe-target')
  const before = victim.getBoundingClientRect().width
  try {
    victim.setAttribute('style', 'padding-left: 64px')
  } catch {
    /* the attribute set itself does not throw; CSP blocks the effect */
  }
  const styleTag = doc.createElement('style')
  styleTag.textContent = '#csp-probe-target { padding-right: 64px }'
  doc.head.append(styleTag)
  const after = victim.getBoundingClientRect().width
  const applied = after !== before

  $('#csp-probe-result').textContent = relaxed
    ? applied
      ? 'Trusted-editor policy in force: C1 and C2 are relaxed as declared, and the probe confirms it.'
      : 'UNEXPECTED: the trusted-editor policy declares C1/C2 relaxed, but the mechanisms were blocked.'
    : applied
      ? `UNEXPECTED: geometry changed by ${after - before}px — the policy is not being enforced.`
      : 'C1 and C2 confirmed: the style attribute and the injected <style> had no effect.'

  styleTag.remove()
  victim.removeAttribute('style')
}

// ---------------------------------------------------------------- controls
interface ControlState {
  theme: string
  density: 'compact' | 'comfortable'
  dir: 'ltr' | 'rtl'
  zoom: 100 | 200
  reducedMotion: boolean
}

const state: ControlState = {
  theme: 'modkit-dark',
  density: 'compact',
  dir: 'ltr',
  zoom: 100,
  reducedMotion: false,
}

function applyControls(): void {
  const root = doc.documentElement
  // An empty selection means "no explicit choice": the attribute must be removed, not blanked,
  // or `:root:not([data-mk-theme])` stops matching and the OS preference never applies.
  applyTheme(root, state.theme === '' ? undefined : state.theme)
  applyDensity(root, state.density)
  root.setAttribute('dir', state.dir)
  // C3: a continuous value travels as a validated custom property, never as a style attribute.
  setToken(root, 'font.size-md', state.zoom === 200 ? '26px' : '13px')
  root.dataset['reducedMotion'] = String(state.reducedMotion)
  $('#state-readout').textContent =
    `${state.theme} · ${state.density} · ${state.dir.toUpperCase()} · ${state.zoom}% · motion ${state.reducedMotion ? 'reduced' : 'normal'}`
  renderInspector()
}

function wireControls(): void {
  const themeSelect = $<HTMLSelectElement>('#control-theme')
  for (const palette of PALETTES) {
    const option = doc.createElement('option')
    option.value = palette.id
    option.textContent = `${palette.displayName} (${palette.appearance})`
    themeSelect.append(option)
  }
  const adapter = doc.createElement('option')
  adapter.value = 'vscode-adapter'
  adapter.textContent = 'VS Code adapter (host-driven)'
  themeSelect.append(adapter)
  const system = doc.createElement('option')
  system.value = ''
  system.textContent = 'System (prefers-color-scheme)'
  themeSelect.append(system)
  themeSelect.value = state.theme

  themeSelect.addEventListener('change', () => {
    state.theme = themeSelect.value
    doc.documentElement.dataset['simulateVscode'] = String(themeSelect.value === 'vscode-adapter')
    applyControls()
  })
  $<HTMLSelectElement>('#control-density').addEventListener('change', event => {
    state.density = (event.target as HTMLSelectElement).value as ControlState['density']
    applyControls()
  })
  $<HTMLSelectElement>('#control-dir').addEventListener('change', event => {
    state.dir = (event.target as HTMLSelectElement).value as ControlState['dir']
    applyControls()
  })
  $<HTMLSelectElement>('#control-zoom').addEventListener('change', event => {
    state.zoom = Number((event.target as HTMLSelectElement).value) as ControlState['zoom']
    applyControls()
  })
  $<HTMLInputElement>('#control-motion').addEventListener('change', event => {
    state.reducedMotion = (event.target as HTMLInputElement).checked
    applyControls()
  })
  $('#csp-probe-run').addEventListener('click', probeCsp)
}

// ---------------------------------------------------------------- token inspector
const inspectorBody = $('#inspector-body')
let inspectorSearch: ReturnType<typeof createSearchField> | undefined

function tokenMatches(name: string, type: string): boolean {
  if (inspectorSearch === undefined) return true
  const compiled = inspectorSearch.state.compiled
  if (compiled.kind === 'empty') return true
  return (
    matchRanges(name, compiled, true).length > 0 || matchRanges(type, compiled, true).length > 0
  )
}

function mountInspectorSearch(): void {
  inspectorSearch = createSearchField(doc, {
    label: 'Filter tokens',
    placeholder: 'color, ^space\., duration…',
    debounceMs: 60,
    onChange: () => renderInspector(),
    countMatches: () => TOKENS.filter(token => tokenMatches(token.name, token.type)).length,
  })
  $('#inspector-search').replaceChildren(inspectorSearch.root)
}

function renderInspector(): void {
  const probe = doc.documentElement
  inspectorBody.replaceChildren()
  const matching = TOKENS.filter(token => tokenMatches(token.name, token.type))
  inspectorSearch?.refresh()
  for (const token of matching.slice(0, 400)) {
    const row = el('tr')
    const value = readToken(probe, token.name as TokenName)
    row.append(el('td', 'tier', String(token.tier)))
    row.append(el('td', 'name', token.name))
    row.append(el('td', 'type', token.type))
    const swatch = el('td', 'swatch')
    if (token.type === 'color' && value !== '') {
      const chip = el('span', 'chip')
      chip.style.setProperty('--chip', value)
      swatch.append(chip)
    }
    row.append(swatch)
    row.append(el('td', 'value', value || '—'))
    row.append(el('td', 'var', cssVariableName(token.name)))
    inspectorBody.append(row)
  }
  $('#inspector-count').textContent = `${matching.length} of ${TOKENS.length}`
}

// ---------------------------------------------------------------- viewer cards
const mounts: ViewerMount[] = []
const formatSessions: OpenedFormat[] = []

async function mountCase(item: GalleryCase, index: number): Promise<void> {
  const card = el('article', 'card')
  const head = el('header', 'card-head')
  head.append(el('h3', undefined, item.title))
  head.append(el('code', 'pill', item.contributionId))
  head.append(el('code', 'pill subtle', item.contract))
  card.append(head)
  card.append(el('p', 'summary', item.summary))

  const surface = el('div', 'surface')
  card.append(surface)

  const audit = el('p', 'audit')
  card.append(audit)
  $('#viewers').append(card)

  const module = MODULES[item.contributionId]
  if (module === undefined) {
    surface.append(el('div', 'failure', `no module registered for ${item.contributionId}`))
    return
  }
  try {
    const mount = await module.mount({
      container: surface,
      descriptor: galleryDescriptor(),
      slot: slotFor(item, index),
      sources: sourcesFor(item),
      operations: operationSession(line => {
        $('#operation-log').prepend(el('li', undefined, line))
      }),
    })
    mounts.push(mount)
    const report = auditParts(surface.firstElementChild ?? surface)
    audit.textContent =
      report.unregistered.length === 0
        ? `parts: ${report.present.join(', ')}`
        : `UNREGISTERED PARTS: ${report.unregistered.join(', ')}`
    audit.dataset['ok'] = String(report.unregistered.length === 0)
  } catch (error) {
    surface.append(el('div', 'failure', `mount failed: ${String(error)}`))
  }
}

async function mountPanels(): Promise<void> {
  for (const [id, module, title] of [
    ['org.modkitx.ui/diagnostics-panel', diagnosticsPanel, 'Diagnostics panel'],
    ['org.modkitx.ui/operation-toolbar', operationToolbar, 'Operation toolbar'],
  ] as const) {
    const card = el('article', 'card')
    const head = el('header', 'card-head')
    head.append(el('h3', undefined, title))
    head.append(el('code', 'pill', id))
    card.append(head)
    const surface = el('div', 'surface')
    card.append(surface)
    $('#viewers').append(card)
    const mount = await module.mount({
      container: surface,
      descriptor: galleryDescriptor(),
      slot: {
        slotId: id.split('/')[1],
        kind: id.includes('toolbar') ? 'toolbar' : 'panel',
        contributionId: id,
        extensionId: 'org.modkitx.ui',
        priority: 10,
        bindings: [],
      } as never,
      sources: {
        async get() {
          return undefined
        },
        async getUnknown() {
          return undefined
        },
      },
      operations: operationSession(line => {
        $('#operation-log').prepend(el('li', undefined, line))
      }),
    })
    mounts.push(mount)
  }
}

// ---------------------------------------------------------------- MK2 assets-viewer parity
async function mountAssetCard(
  title: string,
  contributionId: string,
  module: ViewerModule,
  summary: string,
  source: unknown,
  contract: string | undefined,
): Promise<void> {
  const card = el('article', 'card')
  const head = el('header', 'card-head')
  head.append(el('h3', undefined, title))
  head.append(el('code', 'pill', contributionId))
  if (contract !== undefined) head.append(el('code', 'pill subtle', contract))
  card.append(head)
  card.append(el('p', 'summary', summary))
  const surface = el('div', 'surface')
  card.append(surface)
  const audit = el('p', 'audit')
  card.append(audit)
  $('#assets').append(card)

  try {
    const mount = await module.mount({
      container: surface,
      descriptor: galleryDescriptor(),
      slot: {
        slotId: contributionId.split('/')[1],
        kind: 'stage',
        contributionId,
        extensionId: 'org.modkitx.ui',
        priority: 100,
        bindings: contract === undefined ? [] : [{ bindingId: 'data', contract, major: 1 }],
      } as never,
      sources: {
        async get() {
          return source === undefined
            ? undefined
            : ({
                value: source,
                async release() {
                  return Promise.resolve()
                },
              } as never)
        },
        async getUnknown() {
          return source === undefined
            ? undefined
            : {
                value: source,
                async release() {
                  return Promise.resolve()
                },
              }
        },
      },
      operations: operationSession(line => $('#operation-log').prepend(el('li', undefined, line))),
    })
    mounts.push(mount)
    const report = auditParts(surface.firstElementChild ?? surface)
    audit.textContent =
      report.unregistered.length === 0
        ? `parts: ${report.present.join(', ')}`
        : `UNREGISTERED PARTS: ${report.unregistered.join(', ')}`
    audit.dataset['ok'] = String(report.unregistered.length === 0)
  } catch (error) {
    surface.append(el('div', 'failure', `mount failed: ${String(error)}`))
  }
}

async function mountAssetViewers(): Promise<void> {
  await mountAssetCard(
    'Metadata panel',
    'org.modkitx.ui/metadata-panel',
    metadataPanel,
    'Metadata groups straight off the descriptor — the MK2 asset metadata pane.',
    undefined,
    undefined,
  )
  await mountAssetCard(
    'Properties table',
    'org.modkitx.ui/properties-table',
    propertiesTable,
    'Identity, observed traits with their parameters, and declared operations.',
    undefined,
    undefined,
  )
  await mountAssetCard(
    'Archive explorer',
    'org.modkitx.ui/namespace-tree',
    namespaceViewer,
    'Container entries over the namespace contract — the zip/mpq/casc surface.',
    namespaceSource(),
    'common.view/namespace-entry-source',
  )
  try {
    const png = await makePngBytes()
    await mountAssetCard(
      'Image stage (PNG)',
      'org.modkitx.ui/image-stage',
      imageViewer,
      'Real PNG bytes decoded by the platform. Fit/zoom, backdrop cycle, channel isolation.',
      rasterImageSourceFor(png, 256, 160),
      'common.view/raster-image-source',
    )
  } catch (error) {
    $('#assets').append(el('div', 'failure', `PNG fixture failed: ${String(error)}`))
  }
  await mountAssetCard(
    'Vector stage (SVG)',
    'org.modkitx.ui/vector-stage',
    vectorViewer,
    'Secure-static profile only: rendered as an isolated image, never injected into the DOM.',
    vectorSceneSourceFor(),
    'common.view/vector-scene-source',
  )
  await mountAssetCard(
    'Model stage (cube)',
    'org.modkitx.ui/model-stage',
    modelViewer,
    'Real positions and indices through the model-scene contract; no GPU renderer required.',
    modelSceneSourceFor(),
    'common.view/model-scene-source',
  )
  try {
    // Even with the fixture's own guard, never let one card stall the whole boot sequence.
    const webm = await Promise.race([
      makeWebmBytes(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('WebM fixture timed out')), 15_000),
      ),
    ])
    await mountAssetCard(
      'Video stage (WebM)',
      'org.modkitx.ui/video-stage',
      videoViewer,
      'A WebM recorded in-page by the platform encoder, played back through the media contract.',
      videoMediaSourceFor(webm.bytes, webm.mediaType, 1200),
      'common.view/video-media-source',
    )
  } catch (error) {
    $('#assets').append(el('div', 'failure', `WebM fixture unavailable: ${String(error)}`))
  }
  await mountAssetCard(
    'Audio stage (WAV)',
    'org.modkitx.ui/audio-stage',
    audioViewer,
    'Real PCM bytes decoded by WebAudio; only bucket peaks are kept, never the sample buffer.',
    audioMediaSourceFor(makeWavBytes(), 3000),
    'common.view/audio-media-source',
  )
}

// ---------------------------------------------------------------- text-data formats
const SEMANTIC_VIEWER: Readonly<Record<string, ViewerModule>> = {
  'common.view/tree-data-source': treeViewer,
  'common.view/table-data-source': tableViewer,
}

async function mountFormat(spec: FormatSpec): Promise<void> {
  const card = el('article', 'card')
  const head = el('header', 'card-head')
  head.append(el('h3', undefined, spec.label))
  head.append(el('code', 'pill', spec.mediaType))
  card.append(head)

  const meta = el('div', 'pills')
  for (const trait of spec.traits) meta.append(el('code', 'pill subtle', trait))
  card.append(meta)

  const tabs = el('div', 'tabs')
  card.append(tabs)
  const surface = el('div', 'surface')
  card.append(surface)
  const audit = el('p', 'audit')
  card.append(audit)
  $('#formats').append(card)

  let opened: OpenedFormat
  try {
    opened = await openFormat(spec)
  } catch (error) {
    const context =
      typeof error === 'object' && error !== null && 'context' in error
        ? JSON.stringify((error as { readonly context?: unknown }).context)
        : undefined
    surface.append(
      el(
        'div',
        'failure',
        `codec open failed: ${String(error)}${context === undefined ? '' : `\n${context}`}`,
      ),
    )
    return
  }
  formatSessions.push(opened)

  // Tabs are derived, never hardcoded: a tab exists only when the descriptor declares BOTH the
  // trait and the published data source. So JSON gets Code but no Hex, a PNG gets Hex but no Code.
  const traits = new Set(traitsOf(opened.descriptor))
  const published = new Set(publishedSources(opened.descriptor))
  const candidates: readonly [string, ViewerModule, string, unknown, string][] = [
    [
      spec.semantic === 'common.view/table-data-source' ? 'Table' : 'Tree',
      SEMANTIC_VIEWER[spec.semantic] as ViewerModule,
      spec.semantic,
      opened.semanticSource,
      spec.semantic === 'common.view/table-data-source' ? 'table.cells' : 'structure.hierarchy',
    ],
    ['Code', codeStage, 'common.view/text-data-source', opened.textSource, 'content.text'],
    ['Text', boundedTextViewer, 'common.view/text-data-source', opened.textSource, 'content.text'],
    ['Hex', hexViewer, 'common.view/byte-range-source', opened.byteSource, 'content.binary'],
  ]
  // `content.binary` is true of every file, so it alone cannot decide the Hex tab. A subject whose
  // primary representation is text gets Code and Text; Hex is for subjects with no text form.
  const primarilyText = traits.has('content.text')
  const views = candidates.filter(([label, module, contract, , trait]) => {
    if (module === undefined || !traits.has(trait) || !published.has(contract)) return false
    if (label === 'Hex' && primarilyText) return false
    return true
  })
  if (views.length === 0) {
    surface.append(
      el('div', 'failure', 'no tab qualifies: no declared trait matches a published source'),
    )
    return
  }

  let active: ViewerMount | undefined
  const show = async (index: number): Promise<void> => {
    const [label, module, contract, source] = views[index] as (typeof views)[number]
    if (active !== undefined) await active.unmount()
    for (const [position, button] of [...tabs.children].entries()) {
      button.setAttribute('aria-pressed', String(position === index))
      button.setAttribute('data-mk-state', position === index ? 'active' : '')
    }
    try {
      active = await module.mount({
        container: surface,
        descriptor: opened.descriptor as never,
        slot: {
          slotId: `${spec.id}-${label.toLowerCase()}`,
          kind: 'stage',
          contributionId: `org.modkitx.ui/${label.toLowerCase()}`,
          extensionId: 'org.modkitx.ui',
          priority: 100,
          bindings: [{ bindingId: 'data', contract, major: 1 }],
        } as never,
        sources: {
          async get() {
            return {
              value: source,
              async release() {
                return Promise.resolve()
              },
            } as never
          },
          async getUnknown() {
            return {
              value: source,
              async release() {
                return Promise.resolve()
              },
            }
          },
        },
        operations: operationSession(line =>
          $('#operation-log').prepend(el('li', undefined, line)),
        ),
      })
      mounts.push(active)
      const report = auditParts(surface.firstElementChild ?? surface)
      audit.textContent =
        report.unregistered.length === 0
          ? `${contract} · parts ok`
          : `UNREGISTERED PARTS: ${report.unregistered.join(', ')}`
      audit.dataset['ok'] = String(report.unregistered.length === 0)
    } catch (error) {
      surface.replaceChildren(el('div', 'failure', `mount failed: ${String(error)}`))
    }
  }

  views.forEach(([label], index) => {
    const button = el('button', 'tab', label) as HTMLButtonElement
    button.type = 'button'
    button.addEventListener('click', () => void show(index))
    tabs.append(button)
  })
  await show(0)
}

// ---------------------------------------------------------------- code editor
async function mountEditor(): Promise<void> {
  const spec = FORMATS.find(item => item.id === 'json') as FormatSpec
  const opened = await openFormat(spec)
  formatSessions.push(opened)
  const log = (line: string) => $('#editor-log').prepend(el('li', undefined, line))
  const ports = createEditorPorts('content-hash.sha256:gallery-text-data', log)
  const surface = $('#editor-surface')
  const mount = await textEditor.mount({
    container: surface,
    descriptor: galleryDescriptor(false) as never,
    edit: ports.session,
    commit: ports.commit,
    payloads: ports.payloads,
    authorization: ports.authorization,
    sources: {
      async get() {
        return {
          value: opened.textSource,
          async release() {
            return Promise.resolve()
          },
        } as never
      },
      async getUnknown() {
        return {
          value: opened.textSource,
          async release() {
            return Promise.resolve()
          },
        }
      },
    },
  })
  mounts.push(mount as unknown as ViewerMount)
}

// ---------------------------------------------------------------- vocabulary + catalog
function renderVocabulary(): void {
  const parts = $('#parts-list')
  for (const part of PARTS) parts.append(el('code', 'pill', part))
  const states = $('#states-list')
  for (const stateName of STATES) states.append(el('code', 'pill subtle', stateName))
}

interface CatalogRow {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly status: string
}

function renderCatalog(): void {
  const snapshot = catalogSnapshot as { readonly reason?: string; readonly rows?: CatalogRow[] }
  const body = $('#catalog-body')
  const note = $('#catalog-note')
  if (snapshot.rows === undefined || snapshot.rows.length === 0) {
    note.textContent =
      snapshot.reason ?? 'Component catalog not available in this checkout; nothing is fabricated.'
    return
  }
  note.textContent =
    `${snapshot.rows.length} catalog rows. Rows below are declarations from the generated catalog — ` +
    'a planned component has no implementation here and is not simulated.'
  const implemented = new Set(Object.keys(MODULES))
  for (const row of snapshot.rows) {
    const tr = el('tr')
    tr.append(el('td', 'name', row.id))
    tr.append(el('td', undefined, row.name))
    tr.append(el('td', 'type', row.kind))
    const status = el('td', 'status', row.status)
    status.dataset['status'] = row.status
    tr.append(status)
    const live = [...implemented].some(id => id.endsWith(row.name.toLowerCase()))
    tr.append(el('td', 'live', live ? 'mounted above' : 'not implemented'))
    body.append(tr)
  }
}

// ---------------------------------------------------------------- boot
async function main(): Promise<void> {
  renderViolations()
  renderCspMode()
  mountShellDemo($('#mk2-shell'))
  const cardLog = (line: string) => $('#card-log').prepend(el('li', undefined, line))
  mountCardDemo($('#subject-card'), cardLog)
  mountGraphDemo($('#relation-graph'), cardLog)

  const imageEditLog = (line: string) => $('#imageedit-log').prepend(el('li', undefined, line))
  mountImageEditDemo(
    $('#imageedit-canvas') as HTMLCanvasElement,
    $('#imageedit-panel'),
    imageEditLog,
  )
  wireControls()
  renderVocabulary()
  renderCatalog()
  mountInspectorSearch()
  applyControls()
  for (const [index, item] of CASES.entries()) await mountCase(item, index)
  await mountPanels()
  await mountAssetViewers()
  for (const spec of FORMATS) await mountFormat(spec)
  try {
    await mountEditor()
  } catch (error) {
    $('#editor-surface').append(el('div', 'failure', `editor failed: ${String(error)}`))
  }
  $('#boot-status').textContent = `${mounts.length} viewer modules mounted`
}

window.addEventListener('beforeunload', () => {
  for (const mount of mounts) void mount.unmount()
  for (const session of formatSessions) void session.dispose()
})

void main().catch(error => {
  $('#boot-status').textContent = `boot failed: ${String(error)}`
})
