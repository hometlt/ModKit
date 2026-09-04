import type { EditorModule, TextDataSource, ChangeSet } from '@modkit/sdk'
/**
 * Monaco code-editor implementation for the built-in MK3 code module.
 *
 * Trusted in-process only. Measured behaviour under the viewer policy: Monaco constructs and
 * renders text under strict `script-src 'self'` — it needs **no** `unsafe-eval` — but its runtime
 * injected stylesheet (~140 KB of theme, token and decoration rules) is refused, leaving the
 * editor unthemed. Hosts that ship this backend serve `VIEWER_CSP_TRUSTED_EDITOR`, which adds
 * `style-src 'unsafe-inline'` and nothing else. Untrusted viewers keep the strict policy.
 *
 * The editor never owns saving: it emits a ChangeSet and the host ports validate, authorise and
 * commit (doc 06 §16).
 */
import * as monaco from 'monaco-editor/editor/editor.main.js'

export const abiVersion = 1

/** Format id → Monaco language id. Unknown formats fall back to plain text, never to a guess. */
const LANGUAGE_BY_FORMAT: Readonly<Record<string, string>> = Object.freeze({
  json: 'json',
  jsonc: 'json',
  xml: 'xml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  markdown: 'markdown',
  html: 'html',
  css: 'css',
  javascript: 'javascript',
  typescript: 'typescript',
  lua: 'lua',
  python: 'python',
  csharp: 'csharp',
  glsl: 'cpp',
  hlsl: 'cpp',
  wgsl: 'rust',
  galaxy: 'cpp',
  csv: 'plaintext',
  tsv: 'plaintext',
  rtf: 'plaintext',
})

export function languageForFormat(formatId: string) {
  return LANGUAGE_BY_FORMAT[formatId] ?? 'plaintext'
}

/**
 * Map the Modkit token palette onto a Monaco theme, so the editor follows the host theme instead
 * of shipping its own colours.
 */
function defineTheme(root: HTMLElement) {
  const styles = getComputedStyle(root)
  const token = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim()
    return (value.startsWith('#') ? value : fallback).replace('#', '')
  }
  const base = styles.getPropertyValue('--mk-color-bg').trim()
  const dark = base !== '' && Number.parseInt(base.slice(1, 3), 16) < 128
  monaco.editor.defineTheme('modkit', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': `#${token('--mk-color-surface', '#1f1f1f')}`,
      'editor.foreground': `#${token('--mk-color-fg', '#cccccc')}`,
      'editorLineNumber.foreground': `#${token('--mk-color-fg-subtle', '#7a7a7a')}`,
      'editorCursor.foreground': `#${token('--mk-color-accent', '#0078d4')}`,
      'editor.selectionBackground': `#${token('--mk-color-selection', '#04395e')}`,
      'editor.lineHighlightBackground': `#${token('--mk-color-hover', '#2a2d2e')}`,
      'editorWidget.background': `#${token('--mk-color-overlay', '#2c2c2d')}`,
      'editorWidget.border': `#${token('--mk-color-border', '#2b2b2b')}`,
    },
  })
  return 'modkit'
}

const TEXT_SOURCE = { contract: 'common.view/text-data-source', major: 1 } as const

/**
 * Mirrors the proven request shape of the bounded text stage: ask for the source's own line
 * count, not a heuristic window. A fixed `lineCount` returned nothing here and produced a
 * silently empty editor.
 */
async function loadText(source: TextDataSource, maximum: number, signal?: AbortSignal) {
  const info = await source.info()
  if (info.bytes > BigInt(maximum)) {
    throw new RangeError(`source exceeds the editor budget: ${info.bytes} bytes`)
  }
  const slice = await source.slice(
    {
      kind: 'from-line',
      line: 0,
      lineCount: info.lines === 'unknown' ? Number.MAX_SAFE_INTEGER : Math.max(1, info.lines),
      maxBytes: maximum,
    },
    signal,
  )
  return slice.text
}

/**
 * Resolve the editor's type metrics from the active theme.
 *
 * Without this Monaco silently uses its own `Consolas, "Courier New", monospace` at 14px/19px: the
 * code stage then ignores `--mk-font-mono` and, worse, measures a font the theme never asked for.
 * The line height is rounded to a whole pixel on purpose — Monaco positions each line at an integer
 * `top` derived from it, so a fractional height (1.45 x 12px = 17.4) accumulates rounding error
 * down the viewport and the lines drift apart from their own backgrounds.
 */
function editorFont(root: HTMLElement) {
  const style = root.ownerDocument.defaultView?.getComputedStyle(root)
  if (style === undefined) return {}
  const family = style.getPropertyValue('--mk-font-mono').trim()
  const size = Number.parseFloat(style.getPropertyValue('--mk-font-size-sm')) || 12
  const ratio = Number.parseFloat(style.getPropertyValue('--mk-line-normal')) || 1.45
  return {
    ...(family === '' ? {} : { fontFamily: family }),
    fontSize: size,
    lineHeight: Math.round(size * ratio),
  }
}

export function createMonacoEditor(
  options: { maximumSourceBytes?: number; readOnly?: boolean } = {},
): EditorModule {
  const maximum = options.maximumSourceBytes ?? 8 * 1024 * 1024
  const readOnly = options.readOnly ?? false

  return {
    abiVersion: 1,
    async mount(args) {
      const container = args.container as HTMLElement
      const document = container.ownerDocument
      const root = document.createElement('section') as HTMLElement & {
        __mkEditor?: monaco.editor.IStandaloneCodeEditor
      }
      root.className = 'modkit-viewer'
      root.setAttribute('role', 'region')
      root.setAttribute('aria-label', readOnly ? 'Code viewer' : 'Code editor')
      root.dataset['mkPart'] = 'viewer'
      container.replaceChildren(root)

      const toolbar = document.createElement('div')
      toolbar.dataset['mkPart'] = 'editor.toolbar'
      toolbar.setAttribute('role', 'toolbar')
      root.append(toolbar)

      const status = document.createElement('output')
      status.dataset['mkPart'] = 'viewer.status'
      status.textContent = 'Ready'

      const save = document.createElement('button')
      save.type = 'button'
      save.textContent = 'Save'
      save.disabled = true
      save.dataset['mkPart'] = 'operations.button'
      if (!readOnly) toolbar.append(save)
      toolbar.append(status)

      const host = document.createElement('div')
      host.dataset['mkPart'] = 'editor.text'
      root.append(host)

      const lease = await args.sources.get(
        TEXT_SOURCE as typeof TEXT_SOURCE & { bindingId: import('@modkit/sdk').BindingId },
      )
      if (lease === undefined) throw new TypeError('code editor text binding is unavailable')

      const formatId = args.descriptor?.identity?.formatId
      const language = languageForFormat(formatId)

      const text = await loadText(lease.value, maximum, args.signal)

      const font = editorFont(root)

      const editor = monaco.editor.create(host, {
        value: text,
        language,
        theme: defineTheme(root),
        readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontLigatures: false,
        ...font,
      })

      // Monaco measures one character at create time and positions every line from that number.
      // Two things invalidate the measurement and make the lines visibly jump once it corrects
      // itself: a webfont that arrives after create, and a create that happened while the host had
      // no layout box (a tab mounted off-screen measures against a zero-width probe). Re-measure on
      // both signals; each is idempotent and cheap.
      let disposed = false
      const remeasure = () => {
        if (disposed) return
        monaco.editor.remeasureFonts()
        editor.layout()
      }
      document.fonts?.ready.then(remeasure, () => {
        // Best-effort: if font loading reports a failure the create-time measurement stands.
      })
      const sizeWatch = new ResizeObserver(entries => {
        const box = entries[0]?.contentRect
        if (box === undefined || box.width === 0 || box.height === 0) return
        sizeWatch.disconnect()
        remeasure()
      })
      // A theme switch restamps data-mk-theme on the document root; the palette was read once at
      // create, so redefine the named theme from the new tokens and re-apply it — open editors
      // follow the host instead of keeping the previous palette until the next file opens.
      const themeWatch = new MutationObserver(() => {
        if (disposed) return
        monaco.editor.setTheme(defineTheme(root))
      })
      themeWatch.observe(root.ownerDocument.documentElement, {
        attributes: true,
        attributeFilter: ['data-mk-theme', 'data-mk-density'],
      })
      sizeWatch.observe(host)

      // Conformance hook: Monaco paints through requestAnimationFrame, which does not tick in a
      // non-compositing tab, so a harness needs a handle to force a synchronous layout.
      root.__mkEditor = editor

      let baseline = text
      const syncDirty = () => {
        const dirty = editor.getValue() !== baseline
        save.disabled = readOnly || !dirty
        status.textContent = dirty ? 'Modified' : 'Ready'
        root.dataset['mkState'] = dirty ? 'mutating' : ''
      }
      const subscription = editor.onDidChangeModelContent(syncDirty)

      save.addEventListener('click', async () => {
        const next = editor.getValue()
        /*
         * The 13D `ChangeSet`: `{ targets, edits: SourceEdit[], provenance: { actor } }`. This
         * used to be hand-built with `baseRevisions`, `bindingId` and a bare `kind` — fields no
         * contract declares — so `createRawWriter`, which reads `change.targets` first thing, could
         * never accept it. The Code tab offered a Save that could not work.
         */
        const target = args.edit.targets[0]
        if (target === undefined) {
          status.textContent = 'Nothing to save: this session carries no writable target'
          root.dataset['mkState'] = 'error'
          return
        }
        const change: ChangeSet = {
          targets: args.edit.targets,
          edits: [
            {
              operation: 'replace',
              targetId: target.targetId,
              source: target.ownerSource,
              range: { kind: 'utf16', offset: 0, length: baseline.length },
              payload: { kind: 'text', text: next },
              label: 'Edit text',
            },
          ],
          provenance: { actor: 'user' },
        }
        status.textContent = 'Validating…'
        // `ValidationResult` is `{ valid, diagnostics }`; looking for a `state` of `invalid` meant
        // a refused change went on to be planned and prepared as if the writer had accepted it
        const validation = await args.edit.propose(change)
        if (validation?.valid === false) {
          const first = validation.diagnostics?.[0]
          status.textContent =
            first === undefined ? 'Rejected by validation' : `Rejected: ${first.message}`
          root.dataset['mkState'] = 'error'
          return
        }
        const plan = await args.edit.plan(change)
        const authorization = await args.authorization.request(plan)
        if (authorization === undefined) {
          status.textContent = 'Not authorised'
          return
        }
        const prepared = await args.commit.prepare(plan, { grant: authorization.grant })
        // `ready` is what a CommitCoordinator answers with; `prepared` is a state no coordinator
        // produces, so every save reported a failure *after* the plan had already been made
        if (prepared?.state !== 'ready') {
          status.textContent =
            prepared?.state === 'conflict'
              ? 'Conflict: the source changed'
              : `Prepare rejected: ${(prepared as { reason?: string })?.reason ?? prepared?.state ?? 'unknown'}`
          root.dataset['mkState'] = 'error'
          return
        }
        const receipt = await args.commit.commit(prepared.prepared, { grant: authorization.grant })
        if (receipt?.state !== undefined && receipt.state !== 'committed') {
          status.textContent =
            receipt.state === 'not-applied'
              ? `Save rejected: ${receipt.reason ?? 'not applied'}`
              : `Save ${receipt.state}`
          root.dataset['mkState'] = 'error'
          return
        }
        baseline = next
        syncDirty()
        status.textContent = 'Committed'
      })

      return {
        async update(next) {
          root.dataset['revision'] = String(next.revision ?? '')
        },
        async unmount() {
          disposed = true
          themeWatch.disconnect()
          sizeWatch.disconnect()
          subscription.dispose()
          editor.dispose()
          await lease.release()
          root.remove()
        },
      }
    },
  }
}

export const monacoEditor = createMonacoEditor()
export const monacoViewer = createMonacoEditor({ readOnly: true })
