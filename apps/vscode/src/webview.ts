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
  EXPLORER_MAXIMUM_BYTES,
  type EditorArea,
  type ExplorerEntry,
  type FileAccess,
  type PreviewResolver,
} from '@modkit/ui/explorer'
import { createWorkbench } from '@modkit/ui/workbench'
import type { UiCatalogDocument, UiLocale, UiLocalizer } from '@modkit/ui/localization'
import {
  createSubjectCard,
  loadSubjectCardSections,
  type CardRef,
  type SubjectCard,
} from '@modkit/ui/card'
import { connectSubjectRpc, type SubjectPreviewSession } from '@modkit/host'
import {
  subjectFactsSourceFromWire,
  type ExtensionSubjectCardWireDocument,
} from '@modkit/extension-manager'

import { createBridge, type ShellEntry, type WebviewChannel } from './bridge.js'
import { probeWebviewFacilities } from './facilities.js'
import { createWebviewEditorPorts, type WebviewEditorPorts } from './editor-ports.js'
import { reopenCommittedEntry } from './edit-reopen.js'
import { continueVsCodeMapPreviewSelection } from './map-preview-selection.js'
import { createVsCodePreviewFallback, createVsCodePreviewStages } from './stages.js'
import { preferredStage } from './view-policy.js'
import { createVscodeLocalizer } from './localization.js'

/** What the extension host serialises into the page. Inert data a bridge realm may see. */
interface RealmSnapshot {
  readonly realmId: string
  readonly facilities: readonly string[]
}

interface Bootstrap {
  readonly locale: UiLocale
  readonly localizationCatalogs: readonly UiCatalogDocument[]
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
  readonly extensionCard?: import('./extension-cards.js').ExtensionCardBundle
}

/** `acquireVsCodeApi`, declared structurally so nothing here depends on the editor's typings. */
interface VsCodeWebviewApi {
  postMessage(message: unknown): void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface MapPreviewCandidate {
  readonly kind: 'map-preview-selection'
  readonly candidateId: string
  readonly displayName: string
  readonly sourcePath?: string
}

const mapPreviewCandidates = (items: readonly unknown[]): readonly MapPreviewCandidate[] =>
  items.flatMap(item => {
    if (
      typeof item !== 'object' ||
      item === null ||
      (item as { kind?: unknown }).kind !== 'map-preview-selection' ||
      typeof (item as { candidateId?: unknown }).candidateId !== 'string' ||
      typeof (item as { displayName?: unknown }).displayName !== 'string'
    ) {
      return []
    }
    return [item as MapPreviewCandidate]
  })

function baseName(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

const bootstrap = (globalThis as { __MODKIT_BOOTSTRAP__?: Bootstrap }).__MODKIT_BOOTSTRAP__
const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeWebviewApi }).acquireVsCodeApi
const pageLocalizer = createVscodeLocalizer(
  bootstrap?.locale ?? document.documentElement.lang,
  bootstrap?.localizationCatalogs,
)

const root = document.querySelector('#root')
if (root === null) throw new Error('missing #root')

if (bootstrap === undefined || acquire === undefined) {
  const message = document.createElement('p')
  message.textContent =
    bootstrap === undefined
      ? pageLocalizer.text('vscode.webview.noSnapshot')
      : pageLocalizer.text('vscode.webview.notInside')
  root.replaceChildren(message)
} else {
  void mount(root, bootstrap, acquire()).catch((error: unknown) => {
    const message = document.createElement('p')
    message.textContent = pageLocalizer.text('vscode.webview.workbenchFailed', {
      reason: describe(error),
    })
    root.replaceChildren(message)
  })
}

async function mount(
  mountPoint: Element,
  snapshot: Bootstrap,
  api: VsCodeWebviewApi,
): Promise<void> {
  const localizer = createVscodeLocalizer(snapshot.locale, snapshot.localizationCatalogs)
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

  // ---------------------------------------------------------------- chrome
  /*
   * Built before the RPC client, not after. `onDiagnostic` fires from the moment the client is
   * connected, and it has to be able to reach the status line — when this block sat below the
   * connect, the handler could only `bridge.emit`, so a subject diagnostic went to the extension's
   * output channel and was never drawn anywhere a person looks.
   */
  const workbench = createWorkbench(document, {
    localizer,
    title: localizer.text('app.title'),
    host: { label: snapshot.webview.realmId, facilities: snapshot.webview.facilities },
    // VS Code owns this editor's chrome; the page mounts only its subject surface.
    embedded: true,
  })
  mountPoint.replaceChildren(workbench.root)

  /*
   * No status line of its own any more.
   *
   * The page used to draw a footer — realm id, facility count, the subject's absolute path, its
   * size — which is exactly the chrome the owner's screenshot objected to, and it leaked a local
   * path while doing it. The editor has a status bar; the extension writes the subject's facts
   * there, workspace-relative. What is left of  is the mirror into the output channel, so a
   * message still has somewhere to go.
   *
   * Diagnostics do not travel this way at all: they go to the Problems panel, with their code and
   * severity intact.
   */
  const say = (message: string): void => {
    bridge.emit({ op: 'status', text: message })
  }

  /*
   * What this page can actually honour, answered once and sent up (§1.5).
   *
   * The extension composed this realm with an intended facility set; only the page can say whether
   * the machine agrees. The smoke's own editor runs with `--disable-gpu`, which is exactly the case
   * where a composed `gpu.webgl2` would otherwise go on being asserted by a product that never
   * asked.
   */
  bridge.emit({ op: 'facilities', observed: probeWebviewFacilities(globalThis) })

  if (snapshot.extensionCard !== undefined) {
    await mountExtensionSubjectCard(workbench, bridge, snapshot.extensionCard, localizer)
    return
  }

  const client = await connectSubjectRpc({
    framePort: bridge.framePort,
    // This port is emitter-shaped (`on`), and its payload is the frame itself.
    session: snapshot.session,
    moduleUrl: snapshot.moduleUrl,
    contributionId: snapshot.contributionId,
    /*
     * Said on the page, where it used to be silent. `say` also mirrors into the output channel,
     * so this one call covers both of the page's own channels.
     *
     * The editor's Problems panel is fed from the extension host instead, not from here: this
     * channel narrows a diagnostic to `{code, message}`, and a severity guessed from a code string
     * would be a worse answer than the one the host already has.
     */
    onDiagnostic: diagnostic => {
      say(`${diagnostic.code}: ${diagnostic.message}`)
    },
  })

  // ---------------------------------------------------------------- file access
  /**
   * Browsing is shell traffic, not RPC: the tree needs a listing and the tab needs bytes, and
   * neither is a capability. Both are confined on the serving side to the folders this window
   * granted — the very roots `createPathSubjectOpener` confines `open` to.
   */
  const access: FileAccess = {
    label: localizer.text('vscode.webview.workspace'),
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
      if (!(answer instanceof Uint8Array)) {
        throw new Error(localizer.text('vscode.webview.noBytes'))
      }
      return answer
    },
  }

  // ---------------------------------------------------------------- subjects
  /** One record per open subject: what `editorPorts` and the status line need afterwards. */
  interface SubjectRecord {
    readonly entry: ExplorerEntry
    readonly sessionId: string
    readonly session: SubjectPreviewSession
    readonly descriptor: Record<string, unknown>
    readonly planActive: string | undefined
  }
  const subjects = new Map<string, SubjectRecord>()
  /** Live editor ports per open file, so "save before closing" commits the very ports in use. */
  const openPorts = new Map<string, WebviewEditorPorts>()
  /** Last successful Path A outcome per file, retained across the mandatory reopen. */
  const editOutcomes = new Map<string, string>()
  /** Entry id of the focused tab — the only tab that can receive a keystroke. */
  let focused: string | undefined

  const markDirty = (entryId: string, dirty: boolean): void => {
    editors.markDirty(entryId, dirty)
    if (entryId === snapshot.openPath) bridge.emit({ op: 'document-dirty', path: entryId, dirty })
  }

  const recordForDescriptor = (descriptor: Record<string, unknown>): SubjectRecord | undefined =>
    [...subjects.values()].find(record => record.descriptor === descriptor)

  const codecPreview = createCodecPreview({
    localizer,
    supported: snapshot.supportedExtensions,
    stages: createVsCodePreviewStages({
      localizer,
      portsFor(descriptor) {
        const record = recordForDescriptor(descriptor)
        return record === undefined ? undefined : openPorts.get(record.entry.id)
      },
      async reopen(descriptor) {
        const record = recordForDescriptor(descriptor)
        return record === undefined ? false : reopenCommittedEntry(editors, record.entry)
      },
      lastOutcome(descriptor) {
        const record = recordForDescriptor(descriptor)
        return record === undefined ? undefined : editOutcomes.get(record.entry.id)
      },
      recordOutcome(descriptor, outcome) {
        const record = recordForDescriptor(descriptor)
        if (record !== undefined) editOutcomes.set(record.entry.id, outcome)
      },
      onStatus(status) {
        say(status.message)
      },
    }),
    fallback: createVsCodePreviewFallback(localizer),

    async openSession(entry) {
      let result = await client.open(entry.id)
      if (result.state === 'opened') {
        const candidates = mapPreviewCandidates(result.snapshot.candidates)
        if (candidates.length > 0) {
          const choice = window.prompt(
            localizer.text('vscode.webview.chooseMap', {
              candidates: candidates
                .map(
                  candidate =>
                    `${candidate.candidateId} — ${candidate.displayName}${
                      candidate.sourcePath === undefined ? '' : ` (${candidate.sourcePath})`
                    }`,
                )
                .join('\n'),
            }),
            '',
          )
          if (choice !== null && choice.trim().length > 0) {
            const selected = candidates.find(candidate => candidate.candidateId === choice.trim())
            if (selected === undefined) {
              say(localizer.text('vscode.webview.invalidMapSelection', { name: entry.name }))
            } else {
              const firstSession = result.session
              result = await continueVsCodeMapPreviewSelection({
                path: entry.id,
                selectionId: selected.candidateId,
                dispose: () => firstSession.dispose(),
                open: request => client.open(request),
              })
            }
          }
        }
      }
      if (result.state === 'unresolved') {
        say(
          localizer.text('vscode.webview.noCodecClaimed', {
            name: entry.name,
            reason: result.snapshot.reason,
          }),
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
        entry,
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
          localizer,
          onStatus: message => say(`${entry.name} · ${message}`),
          onDirty: dirty => markDirty(entry.id, dirty),
        })
        openPorts.set(entry.id, ports)
        return ports
      } catch (error) {
        say(
          localizer.text('vscode.webview.readOnly', {
            name: entry.name,
            reason: describe(error),
          }),
        )
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
    localizer,
    preview,
    /*
     * In the custom editor the file already has a tab and a breadcrumb — VS Code drew them, above
     * this webview, for this very file. A second row of tabs showing the same one file, and a
     * second breadcrumb spelling out its absolute location, are this component not knowing where
     * it was mounted. Switched off, what is left is the working area: the view picker and the
     * stage. The standalone panel keeps both, because there it is the only thing that has them.
     */
    ...(snapshot.openPath === undefined
      ? {}
      : { chrome: { tabs: false, breadcrumb: false } as const }),
    read: (entry, signal) => access.read(entry.id, EXPLORER_MAXIMUM_BYTES, signal),
    async confirmClose(entry) {
      const answer = String(
        await bridge.request({
          op: 'confirm',
          message: localizer.text('vscode.webview.unsavedChanges', { name: entry.name }),
          savable: openPorts.has(entry.id),
        }),
      )
      return answer === 'save' || answer === 'discard' ? answer : 'cancel'
    },
    async save(entry) {
      const ports = openPorts.get(entry.id)
      if (ports === undefined || !(await ports.save())) {
        throw new Error(localizer.text('vscode.webview.saveFailed', { name: entry.name }))
      }
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
    if (focused !== undefined) markDirty(focused, true)
  })
  editors.root.addEventListener(
    'click',
    event => {
      if (snapshot.openPath === undefined || focused !== snapshot.openPath) return
      const target = event.target
      if (!(target instanceof Element)) return
      const save = target.closest<HTMLElement>('[data-modkit-action="save"]')
      if (save === null) return
      // The provider calls the editor command directly after VS Code dispatches Save. Stopping the
      // page button here avoids committing once in the page and then a second time through Ctrl+S.
      event.preventDefault()
      event.stopPropagation()
      bridge.emit({ op: 'document-save-requested', path: snapshot.openPath })
    },
    true,
  )

  /*
   * The native CustomEditorProvider asks the buffer that is already mounted here. Saving through
   * the editor-area command reaches text before it has produced an edit plan and hex after it has;
   * reverting drops the whole mounted revision and reopens disk bytes under a fresh session.
   */
  bridge.serve(async request => {
    if (request.op !== 'document-save' && request.op !== 'document-revert') {
      throw new Error(localizer.text('vscode.webview.lifecycleOnly'))
    }
    if (snapshot.openPath === undefined || request.path !== snapshot.openPath) {
      throw new Error(localizer.text('vscode.webview.wrongDocument'))
    }
    if (request.op === 'document-save') {
      const record = subjects.get(request.path)
      if (record === undefined) {
        throw new Error(localizer.text('vscode.webview.documentNotOpen'))
      }
      const entry = record.entry
      if (!(await editors.save(request.path))) {
        throw new Error(localizer.text('vscode.webview.editorSaveRefused'))
      }
      markDirty(request.path, false)
      if (!(await editors.close(request.path))) {
        throw new Error(localizer.text('vscode.webview.staleRevisionCloseFailed'))
      }
      await editors.open(entry)
      return true
    }
    const record = subjects.get(request.path)
    if (record === undefined) {
      throw new Error(localizer.text('vscode.webview.documentNotOpen'))
    }
    const entry = record.entry
    markDirty(request.path, false)
    if (!(await editors.close(request.path))) {
      throw new Error(localizer.text('vscode.webview.documentCloseFailed'))
    }
    await editors.open(entry)
    return true
  })

  // ---------------------------------------------------------------- the working area
  /*
   * The editor area, mounted on its own.
   *
   * What used to be here: an explorer with a file tree, an activity bar offering Files and
   * Extensions, a sidebar rail describing the realm, and a settings section listing every
   * contribution with switches beside it. Every one of those had a native equivalent one layer
   * up — VS Code's own Explorer, its view container, its Settings UI — so the page was drawing a
   * second, worse copy of the editor it was running inside. They are gone; see
   * docs/MK3/requests/REQUEST_VSCODE_NATIVE_SHELL_2026-08-25.md.
   *
   * What is left is the subject: a stage picker and the stage. That is the whole of this page.
   */
  workbench.setMain(editors.root)

  /** Open a path as this page's subject. One editor area, so there is nowhere else to put it. */
  const openPath = async (path: string, name: string): Promise<void> => {
    const entry: ExplorerEntry = { id: path, name, directory: false }
    await editors.open(entry)
  }

  bridge.onEvent(event => {
    switch (event.op) {
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

  if (snapshot.openPath !== undefined) {
    await openPath(snapshot.openPath, baseName(snapshot.openPath))
  }
}

async function mountExtensionSubjectCard(
  workbench: ReturnType<typeof createWorkbench>,
  bridge: ReturnType<typeof createBridge>,
  bundle: import('./extension-cards.js').ExtensionCardBundle,
  localizer: UiLocalizer,
): Promise<void> {
  const documents = new Map(
    bundle.documents.map(document => [document.subject.subjectId, document]),
  )
  const root = document.createElement('div')
  root.className = 'modkit-extension-subject'
  root.dataset['mkPart'] = 'card'
  const toolbar = document.createElement('div')
  toolbar.className = 'modkit-extension-subject__toolbar'
  toolbar.dataset['mkPart'] = 'settings.adder'
  const status = document.createElement('span')
  status.dataset['mkPart'] = 'settings.status'
  const resources = document.createElement('div')
  resources.className = 'modkit-extension-subject__resources'
  resources.dataset['mkPart'] = 'card.facts'
  const icon =
    bundle.extension.iconUri === undefined
      ? undefined
      : (() => {
          const image = document.createElement('img')
          image.className = 'modkit-extension-subject__icon'
          image.src = bundle.extension.iconUri
          image.alt = ''
          image.setAttribute('aria-hidden', 'true')
          return image
        })()
  let card: SubjectCard | undefined

  const configure = async (
    request:
      | { readonly op: 'set-contribution'; readonly id: string; readonly enabled: boolean }
      | {
          readonly op: 'set-contributions'
          readonly ids: readonly string[]
          readonly enabled: boolean
        }
      | { readonly op: 'set-extension-coordinate'; readonly id: string; readonly enabled: boolean }
      | { readonly op: 'set-managed-package'; readonly id: string; readonly enabled: boolean }
      | { readonly op: 'remove-managed-package'; readonly id: string }
      | { readonly op: 'link-extension'; readonly id: string }
      | {
          readonly op: 'manage-repository-subject'
          readonly kind: 'vendor' | 'game'
          readonly id: string
          readonly action: 'install' | 'remove'
        },
  ): Promise<void> => {
    await bridge.request(request)
    status.textContent = localizer.text('extensions.status.configurationUpdated')
  }

  const button = (label: string, run: () => void): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['mkPart'] = 'settings.add'
    button.textContent = label
    button.addEventListener('click', run)
    return button
  }

  const openResource = async (
    resource: (typeof bundle.extension.resources)[number],
  ): Promise<void> => {
    const result = (await bridge.request({
      op: 'open-extension-resource',
      subjectId: bundle.extension.subjectId,
      resourceId: resource.id,
      role: resource.role,
    })) as { readonly opened?: unknown; readonly message?: unknown }
    status.textContent =
      typeof result.message === 'string'
        ? result.message
        : result.opened === true
          ? localizer.text('extensions.status.configurationUpdated')
          : localizer.text('vscode.webview.unknownExtensionSubject', { id: bundle.extension.id })
  }

  const resourceRows = (): readonly HTMLElement[] =>
    bundle.extension.resources.map(resource => {
      const row = document.createElement('div')
      row.className = 'modkit-extension-subject__resource'
      row.dataset['mkPart'] = 'card.fact'
      const label = document.createElement('span')
      label.className = 'modkit-extension-subject__resource-label'
      label.textContent =
        resource.role === 'source'
          ? localizer.text('extensions.label.source')
          : resource.label === 'License'
            ? localizer.text('extensions.label.license')
            : resource.label
      const display = document.createElement('code')
      display.className = 'modkit-extension-subject__resource-path'
      display.textContent = resource.display
      row.append(
        label,
        display,
        button(
          localizer.text(
            resource.role === 'source'
              ? 'extensions.action.openSource'
              : 'extensions.action.openLicense',
          ),
          () => {
            void openResource(resource).catch(error => {
              status.textContent = describe(error)
            })
          },
        ),
      )
      return row
    })

  const actionButtons = (
    active: ExtensionSubjectCardWireDocument,
  ): readonly HTMLButtonElement[] => {
    const subject = active.subject
    if (subject.kind === 'modkit/vendor' || subject.kind === 'modkit/game') {
      const control = bundle.repositorySubject
      if (
        control === undefined ||
        control.id !== subject.id ||
        control.kind !== (subject.kind === 'modkit/vendor' ? 'vendor' : 'game')
      ) {
        return []
      }
      return control.actions.map(action =>
        button(localizer.text(action === 'install' ? 'common.install' : 'common.remove'), () => {
          void configure({
            op: 'manage-repository-subject',
            kind: control.kind,
            id: control.id,
            action,
          })
        }),
      )
    }
    if (
      bundle.extension.managedPackageId !== undefined &&
      bundle.extension.managedPackageEnabled === false
    ) {
      const packageId = bundle.extension.managedPackageId
      return [
        button(localizer.text('extensions.action.enablePackage'), () => {
          void configure({ op: 'set-managed-package', id: packageId, enabled: true })
        }),
      ]
    }
    if (!bundle.extension.installed && bundle.extension.linkable) {
      return [
        button(localizer.text('common.install'), () => {
          void configure({ op: 'link-extension', id: bundle.extension.id })
        }),
      ]
    }
    if (subject.kind === 'modkit/contribution') {
      return [
        button(
          localizer.text(
            subject.enabled
              ? 'extensions.action.disableContribution'
              : 'extensions.action.enableContribution',
          ),
          () => {
            void configure({ op: 'set-contribution', id: subject.id, enabled: !subject.enabled })
          },
        ),
      ]
    }
    const actions = [
      button(
        localizer.text(
          bundle.extension.enabled
            ? 'extensions.action.disableExtension'
            : 'extensions.action.enableExtension',
        ),
        () => {
          void configure({
            op: 'set-extension-coordinate',
            id: bundle.extension.id,
            enabled: !bundle.extension.enabled,
          })
        },
      ),
    ]
    if (bundle.extension.managedPackageId !== undefined) {
      const packageId = bundle.extension.managedPackageId
      actions.push(
        button(localizer.text('common.remove'), () => {
          void configure({ op: 'remove-managed-package', id: packageId })
        }),
      )
    }
    if (bundle.extension.codecs.ids.length > 0) {
      actions.push(
        button(
          localizer.text(
            bundle.extension.codecs.enabled
              ? 'extensions.action.disableAllCodecs'
              : 'extensions.action.enableAllCodecs',
          ),
          () => {
            void configure({
              op: 'set-contributions',
              ids: bundle.extension.codecs.ids,
              enabled: !bundle.extension.codecs.enabled,
            })
          },
        ),
      )
    }
    return actions
  }

  const render = async (subjectId: string): Promise<void> => {
    const active = documents.get(subjectId)
    if (active === undefined) {
      throw new Error(localizer.text('vscode.webview.unknownExtensionSubject', { id: subjectId }))
    }
    const sections = await loadSubjectCardSections(subjectFactsSourceFromWire(active), {
      localizer,
    })
    card?.destroy()
    toolbar.replaceChildren(...(icon === undefined ? [] : [icon]), ...actionButtons(active), status)
    const navigate = (ref: CardRef): void => {
      if (ref.href !== undefined && documents.has(ref.href)) {
        void render(ref.href)
      }
    }
    card = createSubjectCard(document, {
      localizer,
      label: active.subject.displayName,
      sections,
      onNavigate: navigate,
    })
    resources.replaceChildren(...resourceRows())
    root.replaceChildren(toolbar, resources, card.root)
  }

  workbench.setMain(root)
  await render(bundle.activeSubjectId)
}
