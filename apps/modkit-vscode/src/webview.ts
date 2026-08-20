/**
 * Webview bundle — the bridge realm's workbench.
 *
 * It has no host access and imports no composition root: the extension host serialises the realm
 * snapshot into the page, opens every subject on its own side and hands this page a consumer of
 * `x3.app/subject-services@1`. That asymmetry is the point — if this file could compose a host,
 * the webview would have become an extension host. What it holds is a client, a stage catalog and
 * a DOM; what it never holds is an inventory, a grant, an extension root or a file handle.
 *
 * The workbench itself is the shipped one, in the arrangement the PWA and Electron already use: a
 * tree on the left (`createExplorer`), the editor area with tabs and a per-tab view picker in place
 * of the explorer's single preview pane (`createEditorArea`), and one `createCodecPreview` deciding
 * which stages a subject can be shown as. Editing is real: the editable stages get ports that are
 * one RPC call each, and the bytes are written by the extension host inside the granted roots.
 */
import {
  createCodecPreview,
  createEditorArea,
  createExplorer,
  element,
  setViewerText,
  EXPLORER_MAXIMUM_BYTES,
  type EditorArea,
  type ExplorerEntry,
  type FileAccess,
  type PreviewResolver,
} from '@modkitx-x3/ui'
import { createWorkbench } from '@modkitx-x3/ui/workbench'
import { connectSubjectRpc, type SubjectPreviewSession } from '@modkitx-x3/host'

import { createBridge, type ShellEntry, type WebviewChannel } from './bridge.js'
import { createWebviewEditorPorts, type WebviewEditorPorts } from './editor-ports.js'
import { createVsCodePreviewStages, VSCODE_PREVIEW_FALLBACK } from './stages.js'
import { preferredStage } from './view-policy.js'

/** What the extension host serialises into the page. Inert data a bridge realm may see. */
interface RealmSnapshot {
  readonly realmId: string
  readonly facilities: readonly string[]
}

interface Bootstrap {
  readonly extensionHost: RealmSnapshot
  readonly webview: RealmSnapshot
  readonly topologyId: string
  /** Endpoint identity of the subject RPC; the serving side used the same pair. */
  readonly session: string
  readonly moduleUrl: string
  readonly contributionId: string
  readonly supportedExtensions: readonly string[]
  readonly extensions: {
    readonly bundled: readonly string[]
    readonly installed: readonly string[]
    readonly failures: readonly {
      readonly root: string
      readonly code: string
      readonly message: string
    }[]
    readonly problems: readonly string[]
  }
  readonly diagnostics: number
  /** Opened straight away when the panel was raised from a file (the custom editor). */
  readonly openPath?: string
}

/** `acquireVsCodeApi`, declared structurally so nothing here depends on the editor's typings. */
interface VsCodeWebviewApi {
  postMessage(message: unknown): void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

const bootstrap = (globalThis as { __MODKIT_BOOTSTRAP__?: Bootstrap }).__MODKIT_BOOTSTRAP__
const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeWebviewApi }).acquireVsCodeApi

const root = document.querySelector('#root')
if (root === null) throw new Error('missing #root')

if (bootstrap === undefined || acquire === undefined) {
  const message = document.createElement('p')
  message.textContent =
    bootstrap === undefined
      ? 'No host snapshot was provided by the extension host.'
      : 'This page is not running inside a VS Code webview.'
  root.replaceChildren(message)
} else {
  void mount(root, bootstrap, acquire()).catch((error: unknown) => {
    const message = document.createElement('p')
    message.textContent = `The Modkit workbench failed to start: ${describe(error)}`
    root.replaceChildren(message)
  })
}

async function mount(
  mountPoint: Element,
  snapshot: Bootstrap,
  api: VsCodeWebviewApi,
): Promise<void> {
  // ---------------------------------------------------------------- transport
  const channel: WebviewChannel = {
    post: message => {
      api.postMessage(message)
    },
    onMessage: handler => {
      const listener = (event: MessageEvent): void => handler(event.data)
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    },
  }
  const bridge = createBridge({ channel, idPrefix: 'view' })
  const client = await connectSubjectRpc({
    framePort: bridge.framePort,
    // This port is emitter-shaped (`on`), and its payload is the frame itself.
    session: snapshot.session,
    moduleUrl: snapshot.moduleUrl,
    contributionId: snapshot.contributionId,
    onDiagnostic: diagnostic => {
      bridge.emit({ op: 'status', text: `${diagnostic.code}: ${diagnostic.message}` })
    },
  })

  // ---------------------------------------------------------------- chrome
  const workbench = createWorkbench(document, {
    title: 'Modkit',
    host: { label: snapshot.webview.realmId, facilities: snapshot.webview.facilities },
  })
  mountPoint.replaceChildren(workbench.root)

  const statusLine = document.createElement('output')
  statusLine.className = 'vscode-status'
  workbench.root.querySelector('[data-mk-part="workbench.statusbar"]')?.append(statusLine)
  const say = (message: string): void => {
    setViewerText(statusLine, message, 400)
    bridge.emit({ op: 'status', text: message })
  }

  // ---------------------------------------------------------------- file access
  /**
   * Browsing is shell traffic, not RPC: the tree needs a listing and the tab needs bytes, and
   * neither is a capability. Both are confined on the serving side to the folders this window
   * granted — the very roots `createPathSubjectOpener` confines `open` to.
   */
  const access: FileAccess = {
    label: 'Workspace',
    async list(entryId) {
      const answer = await bridge.request({
        op: 'list',
        ...(entryId === undefined ? {} : { path: entryId }),
      })
      return (answer as readonly ShellEntry[]).map(entry => ({
        id: entry.id,
        name: entry.name,
        directory: entry.directory,
        ...(entry.size === undefined ? {} : { size: entry.size }),
      }))
    },
    async read(entryId, maxBytes) {
      const answer = await bridge.request({ op: 'read', path: entryId, maxBytes })
      if (!(answer instanceof Uint8Array)) throw new Error('the extension host returned no bytes')
      return answer
    },
  }

  // ---------------------------------------------------------------- subjects
  /** One record per open subject: what `editorPorts` and the status line need afterwards. */
  interface SubjectRecord {
    readonly sessionId: string
    readonly session: SubjectPreviewSession
    readonly descriptor: Record<string, unknown>
    readonly planActive: string | undefined
  }
  const subjects = new Map<string, SubjectRecord>()
  /** Live editor ports per open file, so "save before closing" commits the very ports in use. */
  const openPorts = new Map<string, WebviewEditorPorts>()
  /** Entry id of the focused tab — the only tab that can receive a keystroke. */
  let focused: string | undefined

  const codecPreview = createCodecPreview({
    supported: snapshot.supportedExtensions,
    stages: createVsCodePreviewStages(),
    fallback: VSCODE_PREVIEW_FALLBACK,

    async openSession(entry) {
      const result = await client.open(entry.id)
      if (result.state === 'unresolved') {
        say(
          `${entry.name} — no codec claimed it (${result.snapshot.reason}); showing the raw bytes.`,
        )
        subjects.delete(entry.id)
        return undefined
      }
      const opened = result.snapshot
      say(
        `${entry.name} · ${opened.selected.contributionId}/${opened.selected.variantId} · ` +
          `${Math.round(opened.selected.confidence * 100)}%`,
      )
      subjects.set(entry.id, {
        sessionId: opened.sessionId,
        session: result.session,
        descriptor: opened.descriptor,
        planActive: result.session.presentation?.activeStage,
      })
      return {
        descriptor: async () => opened.descriptor,
        dataSource: (contract, major) => result.session.dataSource(contract, major),
        operations: () => result.session.operations(),
        async dispose() {
          subjects.delete(entry.id)
          const ports = openPorts.get(entry.id)
          openPorts.delete(entry.id)
          if (ports !== undefined) await ports.dispose().catch(() => undefined)
          await result.session.dispose()
        },
      }
    },

    /*
     * Asked once per opened subject, before any stage mounts. `undefined` drops the editable
     * stages for *that subject alone*, which is exactly how this host says "I cannot write this
     * one": the extension host refuses `edit(sessionId)` for a subject it has no writer or no
     * backend for, and a save button that fails at the end would be worse than none.
     */
    async editorPorts(entry) {
      const record = subjects.get(entry.id)
      if (record === undefined) return undefined
      try {
        const arm = await client.edit(record.sessionId)
        const ports = await createWebviewEditorPorts({
          arm,
          onStatus: message => say(`${entry.name} · ${message}`),
          onDirty: dirty => editors.markDirty(entry.id, dirty),
        })
        openPorts.set(entry.id, ports)
        return ports
      } catch (error) {
        say(`${entry.name} is open read-only: ${describe(error)}`)
        return undefined
      }
    },
  })

  /** Offer every applicable stage, then start on the one the host's plan selected, if any. */
  const preview: PreviewResolver = {
    supported: codecPreview.supported,
    async open(container, entry, bytes, signal) {
      const handle = await codecPreview.open(container, entry, bytes, signal)
      if (handle === undefined) return undefined
      const wanted = preferredStage(
        handle.views.map(view => view.id),
        subjects.get(entry.id)?.planActive,
      )
      if (wanted !== undefined && wanted !== handle.activeView) await handle.show(wanted)
      return handle
    },
  }

  // ---------------------------------------------------------------- tabs
  /*
   * Declared after the previewer because the editor area consumes it, and referenced from
   * `editorPorts` above through the closure — which only runs when a file is opened, long after
   * this line.
   */
  const editors: EditorArea = createEditorArea(document, {
    preview,
    read: (entry, signal) => access.read(entry.id, EXPLORER_MAXIMUM_BYTES, signal),
    async confirmClose(entry) {
      const answer = String(
        await bridge.request({
          op: 'confirm',
          message: `${entry.name} has unsaved changes.`,
          savable: openPorts.has(entry.id),
        }),
      )
      return answer === 'save' || answer === 'discard' ? answer : 'cancel'
    },
    async save(entry) {
      await openPorts.get(entry.id)?.save()
    },
    onStatus(status) {
      say([status.path, status.view, status.detail].filter(Boolean).join(' · '))
      focused = status.path
    },
  })
  /*
   * The hex editor reports unsaved work through `edit.propose` on every changed byte, so the arm
   * marks its tab. The text editor proposes only when Save is pressed, and a textarea that has
   * been typed into but not saved would look clean until then — so typing is observed here. The
   * event bubbles out of the stage and only the focused tab can receive one, which is why the
   * focused path is the right tab to mark.
   */
  editors.root.addEventListener('input', event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || target.dataset['mkPart'] !== 'editor.text') return
    if (focused !== undefined) editors.markDirty(focused, true)
  })

  // ---------------------------------------------------------------- explorer
  const explorer = createExplorer(document, {
    preview,
    // The desktop editor supplies its own commands; a second row of buttons would duplicate them.
    showToolbar: false,
    // The tree browses; the editor area owns what is open, so opening is delegated to it.
    onOpen(entry) {
      void editors.open(entry).catch((error: unknown) => say(describe(error)))
    },
  })
  const singlePane = explorer.root.querySelector('[data-mk-part="explorer.preview"]')
  if (singlePane === null) throw new Error('explorer has no preview pane to replace')
  singlePane.replaceWith(editors.root)

  workbench.setMain(explorer.root)
  workbench.setSidebar(hostPanel(snapshot))

  // ---------------------------------------------------------------- host traffic
  const openPath = async (path: string, name: string): Promise<void> => {
    const entry: ExplorerEntry = { id: path, name, directory: false }
    await editors.open(entry)
  }

  bridge.onEvent(event => {
    switch (event.op) {
      case 'roots':
        void explorer.setAccess(access).catch((error: unknown) => say(describe(error)))
        break
      case 'open':
        void openPath(event.path, event.name).catch((error: unknown) => say(describe(error)))
        break
      case 'notice':
        say(event.text)
        break
      default:
        break
    }
  })

  await explorer.setAccess(access)
  say(
    `${snapshot.extensions.bundled.length + snapshot.extensions.installed.length} extensions · ` +
      `${snapshot.supportedExtensions.length} detectable types`,
  )
  if (snapshot.openPath !== undefined) {
    await openPath(snapshot.openPath, baseName(snapshot.openPath))
  }
}

/**
 * The host rail: what this page's realm holds, what loaded, and — the part that matters — what did
 * not. An extension root that failed is shown here as well as in the output channel, because the
 * user who wrote the setting is looking at this window, not at a log.
 */
function hostPanel(snapshot: Bootstrap): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'vscode-host-panel'

  element(panel, 'h2', { text: 'Host' })
  element(panel, 'p', {
    part: 'settings.description',
    text:
      `${snapshot.topologyId} · ${snapshot.extensionHost.realmId} · ` +
      `${snapshot.diagnostics} inventory diagnostics`,
  })
  const isolated = !snapshot.webview.facilities.includes('editor.host-native')
  element(panel, 'p', {
    part: 'settings.description',
    text: isolated
      ? 'This page holds no extension-host facility: it consumes subjects, it does not open them.'
      : 'This page was granted an extension-host facility, which it must never have.',
  })

  element(panel, 'h2', { text: 'Extensions' })
  const list = element(panel, 'ul', { part: 'settings.list' })
  for (const coordinate of snapshot.extensions.bundled) {
    element(list, 'li', { text: `${coordinate} · bundled` })
  }
  for (const coordinate of snapshot.extensions.installed) {
    element(list, 'li', { text: `${coordinate} · installed` })
  }
  if (snapshot.extensions.bundled.length + snapshot.extensions.installed.length === 0) {
    element(list, 'li', { text: 'none — every file will open with the text/hex fallback' })
  }

  if (snapshot.extensions.failures.length > 0 || snapshot.extensions.problems.length > 0) {
    element(panel, 'h2', { text: 'Not loaded' })
    const failed = element(panel, 'ul', { part: 'settings.list' })
    for (const failure of snapshot.extensions.failures) {
      element(failed, 'li', { text: `${failure.root} — ${failure.code}: ${failure.message}` })
    }
    for (const problem of snapshot.extensions.problems) element(failed, 'li', { text: problem })
  }

  element(panel, 'h2', { text: 'Facilities' })
  const facilities = element(panel, 'ul', { part: 'settings.list' })
  for (const facility of snapshot.webview.facilities) element(facilities, 'li', { text: facility })

  return panel
}
