/**
 * VS Code extension host entry.
 *
 * This file is the only place allowed to import `vscode`. Everything that decides anything —
 * composing the realms, opening a subject, confining a path, writing a file — lives in
 * `./host.ts`, `./index.ts` and `./uri.ts`, which know nothing about the editor and are therefore
 * testable in plain Node. What is left here is the adapter: workspace folders in, a webview
 * channel out, and the editor's own affordances (commands, a custom editor, two tree views, an
 * output channel) wired to the host's answers.
 *
 * The webview never receives extension-host power. It gets a bridge realm profile, a strict CSP
 * with a per-load nonce, and a consumer of `x3.app/subject-services@1` — so doc 19's rule (a
 * webview is not an extension host) stays true in the running product and not only in the
 * topology.
 */
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vscode from 'vscode'

import type { CloseAnswer, WebviewChannel } from './bridge.js'
import {
  containerUriPath,
  CONTAINER_SCHEME,
  parseContainerUriPath,
  parseContainerUriText,
  type ContainerNode,
} from './container-uri.js'
import {
  commandSubjectsFrom,
  createSubjectCommandRuntime,
  type CommandResult,
} from '@modkitx-x3/host'
import { createLanguageWorkspace, languageProviderRoutes } from '@modkitx-x3/host/language'
import { createNodeMapPreviewResourcePlanResolver } from '@modkitx-x3/host/node'
import type { ContainerRegistry } from './containers.js'
import { CustomDocumentState } from './custom-document.js'
import { withExtensionRoot } from './extension-roots.js'
import {
  catalogCandidates,
  createVsCodeCommandOpener,
  createVsCodeSubjectHost,
  subjectKey,
  subjectLabel,
  VSCODE_MAXIMUM_SUBJECT_BYTES,
  VSCODE_SUBJECT_CONTRIBUTION_ID,
  VSCODE_SUBJECT_SERVICES_URL,
  type VsCodeConfigurationPort,
  type VsCodeServed,
  type VsCodeSubjectHost,
} from './host.js'
import { describeDegradation, describeFacilities, type FacilityReport } from './facilities.js'
import { pageHtml, refusalHtml, type WebviewLike } from './page.js'
import BUNDLED_CATALOG from '../generated/bundled-catalog.json' with { type: 'json' }
import { describeOpenTarget } from './uri.js'
import {
  createLanguageSessionController,
  LANGUAGE_TOKEN_MODIFIERS,
  LANGUAGE_TOKEN_TYPES,
  type EditorDocumentSymbol,
  type EditorLanguageDocument,
} from './language-session.js'
import {
  createRuntimeDebugController,
  type RuntimeDebugCommandRequest,
  type RuntimeDebugCommandResult,
  type RuntimeDebugController,
} from './runtime-debug.js'

const CUSTOM_EDITOR_TYPE = 'modkit.genericAssetPreview'

let activeLanguageShutdown: (() => Promise<void>) | undefined

const LANGUAGE_ACTIVATION_BUDGET = Object.freeze({
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 250_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
})

const RUNTIME_ACTIVATION_BUDGET = Object.freeze({
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 250_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
  deadlineMs: 30_000,
})

const RUNTIME_SESSION_BUDGET = Object.freeze({
  maxWallTimeMs: 30_000,
  maxTicks: 1_000_000,
  maxMemoryBytes: 512 * 1024 * 1024,
})

/**
 * The subject string a URI names.
 *
 * A `file:` URI names a path; a `modkit-container:` URI names a member of an open container and has
 * no meaningful `fsPath` at all — its own text *is* the identity, and handing `fsPath` to anything
 * downstream would silently address a file that does not exist.
 */
function subjectPathOf(uri: vscode.Uri): string {
  return uri.scheme === CONTAINER_SCHEME ? uri.toString() : uri.fsPath
}

/** The inverse: the URI a subject string names, for the editor surfaces that take one. */
function subjectUriOf(path: string): vscode.Uri {
  return parseContainerUriText(path) === undefined ? vscode.Uri.file(path) : vscode.Uri.parse(path)
}

class ModkitCustomDocument implements vscode.CustomDocument {
  readonly state: CustomDocumentState
  /** A container member is served by a read-only provider; there is nothing to save it back into. */
  readonly readOnly: boolean

  constructor(readonly uri: vscode.Uri) {
    this.state = new CustomDocumentState(subjectPathOf(uri))
    this.readOnly = uri.scheme === CONTAINER_SCHEME
  }

  dispose(): void {
    // The resolved panel owns the bridge session and detaches it from `state` on disposal.
  }
}

/** Nonce for the webview CSP. A fresh one per load, so a cached script cannot be replayed. */
function nonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function workspaceFolders(): readonly string[] {
  return (vscode.workspace.workspaceFolders ?? []).flatMap(folder =>
    folder.uri.scheme === 'file' ? [folder.uri.fsPath] : [],
  )
}

// ---------------------------------------------------------------------------------------------
// the page

interface PanelPageOptions {
  readonly webview: vscode.Webview
  readonly extensionUri: vscode.Uri
  readonly host: VsCodeSubjectHost
  readonly session: string
  readonly openPath?: string
}

/**
 * Build the page. The document, its policy and its nonce live in `./page.ts`; what this adds is
 * the editor's own URI rewriting and the snapshot cut from the composed host.
 */
function panelHtml(options: PanelPageOptions): string {
  const { webview, extensionUri } = options
  const asset: WebviewLike = {
    cspSource: webview.cspSource,
    asWebviewUri: name => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist-app', name)),
  }
  return pageHtml({
    webview: asset,
    nonce: nonce(),
    /*
     * Inert data a bridge realm is allowed to see, serialised into the page rather than fetched:
     * the webview has no host access, and this is exactly what it may know about the realms it
     * sits between.
     */
    bootstrap: {
      extensionHost: {
        realmId: options.host.services.host.profile.realmId,
        facilities: options.host.services.host.profile.facilities,
      },
      webview: {
        realmId: options.host.webview.profile.realmId,
        facilities: options.host.webview.profile.facilities,
      },
      topologyId: options.host.services.host.topology.topologyId,
      session: options.session,
      moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
      contributionId: VSCODE_SUBJECT_CONTRIBUTION_ID,
      supportedExtensions: options.host.supportedExtensions,
      extensions: options.host.extensions,
      diagnostics: options.host.services.host.inventory.diagnostics.length,
      ...(options.openPath === undefined ? {} : { openPath: options.openPath }),
    },
  })
}

// ---------------------------------------------------------------------------------------------
// tree views

interface ExtensionNode {
  readonly label: string
  readonly detail: string
  readonly failed: boolean
}

class ExtensionsView implements vscode.TreeDataProvider<ExtensionNode> {
  constructor(private readonly host: VsCodeSubjectHost) {}

  getTreeItem(node: ExtensionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
    item.description = node.detail
    item.tooltip = `${node.label}\n${node.detail}`
    item.iconPath = new vscode.ThemeIcon(node.failed ? 'error' : 'package')
    return item
  }

  getChildren(): ExtensionNode[] {
    const report = this.host.extensions
    const loaded: ExtensionNode[] = [
      ...report.bundled.map(id => ({ label: id, detail: 'bundled', failed: false })),
      ...report.installed.map(id => ({ label: id, detail: 'installed', failed: false })),
    ]
    const broken: ExtensionNode[] = [
      ...report.failures.map(failure => ({
        label: failure.root,
        detail: `${failure.code}: ${failure.message}`,
        failed: true,
      })),
      ...report.problems.map(problem => ({ label: problem, detail: 'setting', failed: true })),
    ]
    if (loaded.length === 0 && broken.length === 0) {
      return [{ label: 'No extensions loaded', detail: 'text and hex only', failed: false }]
    }
    return [...loaded, ...broken]
  }
}

/**
 * The realm rail, as a native tree.
 *
 * Exactly the facts the webview used to draw down the side of its own panel — the topology and
 * realm this window composed, what loaded from where, and the facilities this page holds. None of
 * it was ever editor content: it describes the window, it is true whatever file is open, and a
 * sidebar is where VS Code puts that kind of thing. Drawing it inside the editor area meant the
 * custom editor was showing something other than the subject, which is what the owner's screenshot
 * caught.
 */
interface HostNode {
  readonly label: string
  readonly detail?: string
  readonly icon?: string
  readonly children?: readonly HostNode[]
}

class HostView implements vscode.TreeDataProvider<HostNode> {
  private readonly changed = new vscode.EventEmitter<HostNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  /** What the page answered for; undefined until a page has loaded and reported. */
  private facilities: FacilityReport | undefined

  constructor(
    private readonly host: VsCodeSubjectHost,
    private readonly topologyId: string,
  ) {}

  /** Called when a page reports its facilities, so the rail stops guessing and starts knowing. */
  report(facilities: FacilityReport | undefined): void {
    this.facilities = facilities
    this.changed.fire(undefined)
  }

  getTreeItem(node: HostNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children === undefined || node.children.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Expanded,
    )
    if (node.detail !== undefined) {
      item.description = node.detail
      item.tooltip = `${node.label}\n${node.detail}`
    }
    if (node.icon !== undefined) item.iconPath = new vscode.ThemeIcon(node.icon)
    return item
  }

  getChildren(node?: HostNode): HostNode[] {
    if (node !== undefined) return [...(node.children ?? [])]
    const services = this.host.services
    const webviewFacilities = this.host.webview.profile.facilities
    /*
     * The isolation claim, drawn from the very object the running product hands the page — so this
     * row is a statement about this window, not a repetition of what the topology intends.
     */
    const isolated = !webviewFacilities.includes('editor.host-native')
    return [
      {
        label: 'Host',
        icon: 'server-process',
        children: [
          { label: 'topology', detail: this.topologyId },
          { label: 'extension host', detail: services.host.profile.realmId },
          {
            label: 'codecs',
            detail: `${services.workers.profile.realmId} (${services.executionProfiles.join('/')})`,
          },
          { label: 'webview', detail: this.host.webview.profile.realmId },
          {
            label: 'inventory diagnostics',
            detail: String(services.host.inventory.diagnostics.length),
          },
          {
            label: 'isolation',
            detail: isolated
              ? 'the page holds no extension-host facility'
              : 'the page was granted an extension-host facility, which it must never have',
            icon: isolated ? 'shield' : 'warning',
          },
          { label: 'detectable types', detail: String(this.host.supportedExtensions.length) },
        ],
      },
      {
        /*
         * Composed against honoured. Before a page has loaded there is nothing to compare, and the
         * rail says the composed set and no more — inventing an observation would be the exact
         * imitation §1.5 forbids.
         */
        label: 'Facilities',
        icon: 'list-unordered',
        children:
          this.facilities === undefined
            ? webviewFacilities.map(facility => ({
                label: facility,
                detail: 'composed; no page has reported yet',
              }))
            : [
                ...this.facilities.intended.map(facility => ({
                  label: facility,
                  detail: this.facilities?.observed.includes(facility)
                    ? 'honoured by the page'
                    : 'composed, but this page cannot honour it — unavailable, not emulated',
                  icon: this.facilities?.observed.includes(facility) ? 'pass' : 'warning',
                })),
                ...this.facilities.ungranted.map(facility => ({
                  label: facility,
                  detail: 'the page offers it; this realm is not composed with it',
                  icon: 'circle-outline',
                })),
              ],
      },
    ]
  }
}

// ---------------------------------------------------------------------------------------------
// activation

/**
 * What `activate()` hands back to anyone holding this extension.
 *
 * Exit-gate line 4 of block 13 asks that activation time not regress, and a number nobody can read
 * cannot be gated. VS Code exposes an extension's return value as `extension.exports`, so the
 * smoke reads the same figure the output channel prints rather than timing the editor from outside
 * and measuring the editor's own startup along with it.
 */
export interface ModkitExtensionApi {
  /** Wall time of `activate()` itself: composition, catalog load, every registration. */
  readonly activationMs: number
  /** Roots the shipped catalog named that this build does not contain. Empty is the healthy state. */
  readonly missingCatalogRoots: readonly string[]
  readonly contributions: number
  /** Generic leased runtime control for other editor integrations; selection stays host-owned. */
  readonly runtime: RuntimeDebugController
  /**
   * What the most recent page reported it can honour, or `undefined` before any page has loaded.
   *
   * A function rather than a value because the answer arrives *after* activation: the realm is
   * composed first and the page reports second, so a frozen field would always say "unknown".
   */
  facilities(): FacilityReport | undefined
}

export async function activate(context: vscode.ExtensionContext): Promise<ModkitExtensionApi> {
  if (activeLanguageShutdown !== undefined) await activeLanguageShutdown()
  const activationStarted = Date.now()
  const output = vscode.window.createOutputChannel('Modkit MK3')
  context.subscriptions.push(output)
  const log = (line: string): void => output.appendLine(line)

  const extensionRoot = context.extensionUri.fsPath
  // In a checkout the extension lives at `<repo>/apps/modkit-vscode`; in a packaged build it
  // carries its own copy of the catalog and the checkout guess simply does not exist.
  const repositoryRoot = resolve(extensionRoot, '..', '..')

  /*
   * Composed once at activation. The profile revision keys resolution caches, so recomposing per
   * command would silently invalidate them — and composing is where extension roots are read, so
   * doing it twice would also report every failure twice.
   */
  /*
   * What this build ships, read from the generated catalog rather than found by scanning.
   *
   * `catalogCandidates` still answers *where* — `dist-app/extensions` in a packaged build, the
   * repository's `extensions/` in a checkout — but the list of roots is now data committed beside
   * the code, the same arrangement Electron and the PWA have had all along.
   */
  const host = await createVsCodeSubjectHost({
    bundledCatalog: BUNDLED_CATALOG.roots,
    catalogCandidates: catalogCandidates(extensionRoot, repositoryRoot),
    workspaceFolders: workspaceFolders(),
    configuredExtensions: vscode.workspace.getConfiguration('modkit').get('extensions'),
    configuredDisabledContributions: vscode.workspace
      .getConfiguration('modkit')
      .get('disabledContributions'),
    // the bootstrap this extension ships beside its own bundle: a CommonJS entry has no
    // `import.meta.url` for the backend to resolve it from
    bootstrapUrl: pathToFileURL(join(extensionRoot, 'dist-app', 'worker-bootstrap.js')),
    onDiagnostic: diagnostic =>
      log(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`),
  })
  const mapPreviewResourcePlanResolver = createNodeMapPreviewResourcePlanResolver({
    subjects: host.services,
  })
  const runtimeDebug = createRuntimeDebugController({
    services: host.services,
    grant: Object.freeze({ id: 'vscode-runtime', classes: Object.freeze([]) }),
    activationBudget: RUNTIME_ACTIVATION_BUDGET,
    sessionBudget: RUNTIME_SESSION_BUDGET,
  })
  context.subscriptions.push({ dispose: () => void runtimeDebug.dispose() })

  log(
    `composed ${host.services.host.topology.topologyId}: ` +
      `extension host ${host.services.host.profile.facilities.length} facilities, ` +
      `codecs run in ${host.services.workers.profile.realmId} ` +
      `(${host.services.executionProfiles.join('/')})`,
  )
  for (const coordinate of host.extensions.bundled) log(`extension loaded (bundled): ${coordinate}`)
  for (const coordinate of host.extensions.installed) {
    log(`extension loaded (installed): ${coordinate}`)
  }
  /*
   * Never swallowed. A root that did not load is written here, shown in the Extensions view, and
   * carried into the webview's host rail — the user who wrote the setting is looking at the
   * window, not at a log, so one of those three has to be in front of them.
   */
  for (const failure of host.extensions.failures) {
    log(`extension NOT loaded: ${failure.root} — ${failure.code}: ${failure.message}`)
  }
  for (const problem of host.extensions.problems) log(`modkit settings: ${problem}`)
  for (const id of host.extensions.disabledContributions) {
    log(`contribution disabled by modkit.disabledContributions: ${id}`)
  }
  if (host.extensions.failures.length > 0 || host.extensions.problems.length > 0) {
    void vscode.window.showWarningMessage(
      `Modkit: ${host.extensions.failures.length + host.extensions.problems.length} extension ` +
        'root(s) did not load. See the Modkit MK3 output channel.',
    )
  }

  // ---------------------------------------------------------------- granted roots
  /** Directories the user reached outside the workspace (a single file opened by name). */
  /** The realm rail. Held rather than constructed inline, because a page's report refreshes it. */
  const hostView = new HostView(host, host.services.host.topology.topologyId)

  const granted = new Set<string>()
  const roots = (): readonly string[] => [...new Set([...workspaceFolders(), ...granted])]

  // ---------------------------------------------------------------- containers
  /*
   * Archive members, in the editor's own Explorer.
   *
   * The owner's requirement names the mechanism (REQUEST_VSCODE_NATIVE_SHELL §3): not a bespoke
   * tree of our own beside the native one, but a `FileSystemProvider` over the host's
   * `openNestedSubject` route, so a BIG, a CASC or an MPQ is browsed by the same Explorer, the same
   * Quick Open and the same "Open With" as any other folder. Everything below is the adapter for
   * that; the decisions live in `./containers.ts`, which knows no `vscode`.
   *
   * Read-only, and declared so: the provider serves what a container holds and this host has no
   * route that writes a member back. `isReadonly` makes the workbench say that instead of offering
   * a Save that would fail.
   */
  const containers: ContainerRegistry = host.containers({
    roots,
    onDiagnostic: item =>
      log(`[container] ${item.severity ?? 'information'} ${item.code}: ${item.message}`),
  })
  context.subscriptions.push({
    dispose: () => {
      void containers.dispose()
    },
  })

  const containerLocation = (uri: vscode.Uri): { container: string; entry: string } => {
    const location = parseContainerUriPath(uri.path)
    if (location === undefined) throw vscode.FileSystemError.FileNotFound(uri)
    return location
  }

  const FILE_TYPE: Readonly<Record<ContainerNode['kind'], vscode.FileType>> = Object.freeze({
    file: vscode.FileType.File,
    directory: vscode.FileType.Directory,
  })

  /** Anything the registry refuses becomes the editor's own vocabulary, never a raw throw. */
  const asFileSystemError = (uri: vscode.Uri, error: unknown): Error => {
    if (error instanceof vscode.FileSystemError) return error
    const message = error instanceof Error ? error.message : String(error)
    log(`[container] ${uri.path}: ${message}`)
    return vscode.FileSystemError.FileNotFound(
      `${vscode.workspace.asRelativePath(uri)}: ${message}`,
    )
  }

  const containerFileSystem: vscode.FileSystemProvider = {
    // Containers are opened once and read; nothing under this scheme changes while a window lives,
    // so an event that never fires is the honest implementation rather than a missing one.
    onDidChangeFile: new vscode.EventEmitter<vscode.FileChangeEvent[]>().event,
    watch: () => new vscode.Disposable(() => undefined),

    async stat(uri) {
      const { container, entry } = containerLocation(uri)
      try {
        const node = await containers.stat(container, entry)
        return {
          type: FILE_TYPE[node.kind],
          ctime: node.modifiedAt ?? 0,
          mtime: node.modifiedAt ?? 0,
          size: node.size ?? 0,
          permissions: vscode.FilePermission.Readonly,
        }
      } catch (error) {
        throw asFileSystemError(uri, error)
      }
    },

    async readDirectory(uri) {
      const { container, entry } = containerLocation(uri)
      try {
        const children = await containers.list(container, entry)
        return children.map(
          child => [child.name, FILE_TYPE[child.kind]] as [string, vscode.FileType],
        )
      } catch (error) {
        throw asFileSystemError(uri, error)
      }
    },

    async readFile(uri) {
      const { container, entry } = containerLocation(uri)
      try {
        return await containers.read(container, entry)
      } catch (error) {
        throw asFileSystemError(uri, error)
      }
    },

    createDirectory: uri => {
      throw vscode.FileSystemError.NoPermissions(uri)
    },
    writeFile: uri => {
      throw vscode.FileSystemError.NoPermissions(uri)
    },
    delete: uri => {
      throw vscode.FileSystemError.NoPermissions(uri)
    },
    rename: uri => {
      throw vscode.FileSystemError.NoPermissions(uri)
    },
  }

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(CONTAINER_SCHEME, containerFileSystem, {
      // Container entry paths come out of the container's own tables; two members differing only in
      // case are two members, and folding them would hide one.
      isCaseSensitive: true,
      isReadonly: true,
    }),
  )

  // ---------------------------------------------------------------- configuration
  /*
   * The only place in this product that writes a VS Code setting.
   *
   * The webview asks for a change over the shell channel and this answers it, because
   * `getConfiguration().update` exists only on the extension side — a page that could reach it
   * would have become an extension host. Writes land in the workspace when one is open (a folder
   * of extensions is usually a property of the project) and in the user's settings otherwise.
   */
  const configurationScope: 'workspace' | 'user' =
    (vscode.workspace.workspaceFolders ?? []).length > 0 ? 'workspace' : 'user'
  const configurationTarget =
    configurationScope === 'workspace'
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global

  /** Composed once at activation, so a write asks the user to reload rather than pretending. */
  const askToReload = (message: string): void => {
    void vscode.window.showInformationMessage(message, 'Reload Window').then(choice => {
      if (choice === 'Reload Window') {
        void vscode.commands.executeCommand('workbench.action.reloadWindow')
      }
    })
  }

  const configuration: VsCodeConfigurationPort = {
    scope: configurationScope,
    readExtensions: () => vscode.workspace.getConfiguration('modkit').get('extensions'),
    readDisabledContributions: () =>
      vscode.workspace.getConfiguration('modkit').get('disabledContributions'),
    async write(key, value) {
      await vscode.workspace.getConfiguration('modkit').update(key, [...value], configurationTarget)
      log(`modkit.${key} written (${configurationScope}): ${JSON.stringify(value)}`)
      askToReload(`Modkit: modkit.${key} was updated. Reload the window for it to take effect.`)
    },
    async pickFolder() {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Add extension folder',
        title: 'Add a Modkit extension folder',
      })
      return picked?.[0]?.fsPath
    },
  }

  const confirmClose = async (message: string, savable: boolean): Promise<CloseAnswer> => {
    const choices = savable ? ['Save', 'Discard'] : ['Discard']
    const answer = await vscode.window.showWarningMessage(message, { modal: true }, ...choices)
    if (answer === 'Save') return 'save'
    return answer === 'Discard' ? 'discard' : 'cancel'
  }

  // ---------------------------------------------------------------- problems
  /*
   * Subject diagnostics on the editor's own surface.
   *
   * These used to reach `log()` and stop there: an output channel is a place a diagnostic goes to
   * be forgotten, and nothing in the API can read one back. A `DiagnosticCollection` is the
   * surface VS Code already owns for "something is worth saying about this file" — it survives the
   * next status message, it is filterable by severity, and it is where a user looks.
   *
   * The range is the head of the file rather than a guess: a subject diagnostic is about the
   * subject, not about a line, and pointing at line 1 is the honest way to say so.
   */
  const problems = vscode.languages.createDiagnosticCollection('modkit')
  context.subscriptions.push(problems)

  const SEVERITY: Readonly<Record<string, vscode.DiagnosticSeverity>> = Object.freeze({
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    information: vscode.DiagnosticSeverity.Information,
    hint: vscode.DiagnosticSeverity.Hint,
  })

  /** What has already been said about each subject, so a repeat does not stack up. */
  const problemsFor = new Map<string, vscode.Diagnostic[]>()

  const publishDiagnostic = (item: {
    readonly code: string
    readonly message: string
    readonly severity: 'error' | 'warning' | 'information' | 'hint'
    readonly path?: string
  }): void => {
    if (item.path === undefined) return
    // Either kind of subject, on the same panel: a finding about a member of an archive is shown
    // against the member, addressed by the URI the Explorer already shows it under.
    const uri = subjectUriOf(item.path)
    const key = uri.toString()
    const existing = problemsFor.get(key) ?? []
    // The same code about the same subject is one problem, however many times it is reported.
    if (existing.some(entry => entry.code === item.code && entry.message === item.message)) return
    const entry = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0),
      item.message,
      SEVERITY[item.severity] ?? vscode.DiagnosticSeverity.Information,
    )
    entry.code = item.code
    entry.source = 'Modkit'
    const next = [...existing, entry]
    problemsFor.set(key, next)
    problems.set(uri, next)
    log(`[problems] ${item.severity} ${item.code}: ${item.message}`)
  }

  /** Drop a subject's problems when its editor goes away; a closed file has no findings. */
  const forgetDiagnostics = (path: string): void => {
    const uri = subjectUriOf(path)
    problemsFor.delete(uri.toString())
    problems.delete(uri)
  }

  // ---------------------------------------------------------------- language providers
  /*
   * Provider routes are runtime inventory data. No Galaxy id, filename pattern or language
   * contribution is baked into this application: a configured/bundled language-provider
   * extension contributes the route, and the host resolver still decides which provider runs.
   */
  const languageRoutes = languageProviderRoutes(host.services.inventory)
  const languageDiagnostics = vscode.languages.createDiagnosticCollection('modkit-language')
  context.subscriptions.push(languageDiagnostics)

  const languageWorkspace = createLanguageWorkspace({
    services: host.services,
    grant: { id: 'org.modkitx.app.vscode/language', classes: [] },
    budgets: LANGUAGE_ACTIVATION_BUDGET,
  })

  const rangeOf = (range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }): vscode.Range =>
    new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character)

  const SYMBOL_KIND: Readonly<Record<EditorDocumentSymbol['kind'], vscode.SymbolKind>> =
    Object.freeze({
      class: vscode.SymbolKind.Class,
      constant: vscode.SymbolKind.Constant,
      enum: vscode.SymbolKind.Enum,
      field: vscode.SymbolKind.Field,
      function: vscode.SymbolKind.Function,
      interface: vscode.SymbolKind.Interface,
      module: vscode.SymbolKind.Module,
      namespace: vscode.SymbolKind.Namespace,
      property: vscode.SymbolKind.Property,
      struct: vscode.SymbolKind.Struct,
      variable: vscode.SymbolKind.Variable,
    })

  const nativeSymbol = (symbol: EditorDocumentSymbol): vscode.DocumentSymbol => {
    const native = new vscode.DocumentSymbol(
      symbol.name,
      symbol.detail ?? '',
      SYMBOL_KIND[symbol.kind],
      rangeOf(symbol.range),
      rangeOf(symbol.selectionRange),
    )
    native.children = symbol.children.map(nativeSymbol)
    return native
  }

  const languageDocument = (document: vscode.TextDocument): EditorLanguageDocument => ({
    uri: document.uri.toString(),
    fileName: document.fileName,
    languageId: document.languageId,
    version: document.version,
    // Full snapshots only: the neutral provider contract has no incremental-edit vocabulary.
    text: document.getText(),
  })

  const languageController = createLanguageSessionController({
    workspace: languageWorkspace,
    routes: languageRoutes,
    publishDiagnostics: (uri, diagnostics) => {
      const target = vscode.Uri.parse(uri)
      languageDiagnostics.set(
        target,
        diagnostics.map(item => {
          const native = new vscode.Diagnostic(
            rangeOf(item.range),
            item.message,
            SEVERITY[item.severity] ?? vscode.DiagnosticSeverity.Information,
          )
          if (item.code !== undefined) native.code = item.code
          native.source = item.source ?? 'Modkit Language'
          return native
        }),
      )
    },
    reportHostDiagnostics: (uri, diagnostics) => {
      for (const item of diagnostics) {
        log(`[language-host] ${uri}: ${item.severity} ${item.code}: ${item.message}`)
      }
    },
    reportNotice: notice =>
      log(
        `[language] ${notice.code}${notice.uri === undefined ? '' : ` ${notice.uri}`}: ${notice.message}`,
      ),
  })
  await languageController.initialize()

  const selectorEntries = new Map<string, vscode.DocumentFilter>()
  for (const route of languageRoutes) {
    const byLanguage: vscode.DocumentFilter = { language: route.languageId }
    selectorEntries.set(JSON.stringify(byLanguage), byLanguage)
    if (route.extension !== undefined) {
      const byExtension: vscode.DocumentFilter = {
        scheme: 'file',
        pattern: `**/*.${route.extension.replace(/^\./u, '')}`,
      }
      selectorEntries.set(JSON.stringify(byExtension), byExtension)
    }
  }
  const languageSelector: vscode.DocumentSelector = [...selectorEntries.values()]

  const signalFor = (
    token: vscode.CancellationToken,
  ): { readonly signal: AbortSignal; dispose(): void } => {
    const controller = new AbortController()
    if (token.isCancellationRequested) controller.abort('VS Code cancelled the language request')
    const subscription = token.onCancellationRequested(() =>
      controller.abort('VS Code cancelled the language request'),
    )
    return { signal: controller.signal, dispose: () => subscription.dispose() }
  }

  if (languageSelector.length > 0) {
    const legend = new vscode.SemanticTokensLegend(
      [...LANGUAGE_TOKEN_TYPES],
      [...LANGUAGE_TOKEN_MODIFIERS],
    )
    const tokenTypes = new Map(LANGUAGE_TOKEN_TYPES.map((kind, index) => [kind, index]))
    const tokenModifiers = new Map(LANGUAGE_TOKEN_MODIFIERS.map((kind, index) => [kind, index]))
    context.subscriptions.push(
      vscode.languages.registerDocumentSymbolProvider(languageSelector, {
        async provideDocumentSymbols(document, token) {
          const cancellation = signalFor(token)
          try {
            const symbols = await languageController.documentSymbols(
              languageDocument(document),
              cancellation.signal,
            )
            return symbols?.map(nativeSymbol)
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] document symbols failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            return undefined
          } finally {
            cancellation.dispose()
          }
        },
      }),
      vscode.languages.registerDocumentSemanticTokensProvider(
        languageSelector,
        {
          async provideDocumentSemanticTokens(document, token) {
            const cancellation = signalFor(token)
            try {
              const tokens = await languageController.semanticTokens(
                languageDocument(document),
                cancellation.signal,
              )
              if (tokens === undefined) return undefined
              const builder = new vscode.SemanticTokensBuilder(legend)
              for (const item of tokens) {
                const tokenType = tokenTypes.get(item.tokenType)
                if (tokenType === undefined) continue
                const modifierBits = item.modifiers.reduce((bits, modifier) => {
                  const index = tokenModifiers.get(modifier)
                  return index === undefined ? bits : bits | (1 << index)
                }, 0)
                builder.push(item.line, item.character, item.length, tokenType, modifierBits)
              }
              return builder.build()
            } catch (error) {
              if (token.isCancellationRequested) return undefined
              log(
                `[language] semantic tokens failed: ${error instanceof Error ? error.message : String(error)}`,
              )
              return undefined
            } finally {
              cancellation.dispose()
            }
          },
        },
        legend,
      ),
      vscode.workspace.onDidOpenTextDocument(document =>
        languageController.open(languageDocument(document)),
      ),
      vscode.workspace.onDidChangeTextDocument(event =>
        languageController.change(languageDocument(event.document)),
      ),
      vscode.workspace.onDidCloseTextDocument(document => {
        void languageController
          .close(document.uri.toString())
          .catch(error =>
            log(
              `[language] close failed: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
      }),
    )
    for (const document of vscode.workspace.textDocuments) {
      languageController.open(languageDocument(document))
    }
  }

  let languageClosed = false
  const shutDownLanguage = async (): Promise<void> => {
    if (languageClosed) return
    languageClosed = true
    languageDiagnostics.clear()
    await languageController.shutdown()
  }
  activeLanguageShutdown = shutDownLanguage
  context.subscriptions.push({
    dispose: () =>
      void shutDownLanguage().catch(error =>
        log(
          `[language] shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ),
  })
  log(`language routes configured: ${languageRoutes.length}`)

  // ---------------------------------------------------------------- facilities
  /*
   * What the page reports it can honour, against what the realm was composed with (§1.5).
   *
   * The composed set cannot change after activation — every resolution cache is keyed to the
   * realm's revision — so the honest arrangement is to keep the intent, learn the reality, and name
   * the difference. `--disable-gpu`, a remote session or a driver without WebGL2 all produce a real
   * degradation here, and the Host view says which rather than the product going on asserting it.
   */
  let facilityReport: FacilityReport | undefined
  const recordFacilities = (observed: readonly string[]): void => {
    facilityReport = describeFacilities(observed)
    log(
      `[facilities] page honours ${facilityReport.observed.join(', ') || 'none'}` +
        ` (composed: ${facilityReport.intended.join(', ')})`,
    )
    for (const line of describeDegradation(facilityReport)) log(`[facilities] ${line}`)
    hostView.report(facilityReport)
  }

  // ---------------------------------------------------------------- webviews
  const live = new Set<VsCodeServed>()

  const attach = (
    webview: vscode.Webview,
    openPath?: string,
    lifecycle?: {
      readonly onDirty: (path: string, dirty: boolean) => void
      readonly onSaveRequested: (path: string) => void
    },
  ): VsCodeServed => {
    const channel: WebviewChannel = {
      post: message => {
        void webview.postMessage(message)
      },
      onMessage: handler => {
        const subscription = webview.onDidReceiveMessage((message: unknown) => handler(message))
        return () => subscription.dispose()
      },
    }
    const session = `vscode-${nonce()}`
    const served = host.serve({
      channel,
      session,
      roots,
      confirmClose,
      configuration,
      mapPreviewResourcePlanResolver,
      // The window's one registry, so a page opening a member reaches the archive the Explorer
      // already has open rather than a second copy of it.
      containers,
      ...(lifecycle === undefined
        ? {}
        : {
            onDocumentDirty: lifecycle.onDirty,
            onDocumentSaveRequested: lifecycle.onSaveRequested,
          }),
      onDiagnostic: diagnostic => log(`[subject-rpc] ${diagnostic.code}: ${diagnostic.message}`),
      onSubjectDiagnostic: publishDiagnostic,
      onSubjectOpened: rememberSubject,
      onFacilities: recordFacilities,
    })
    live.add(served)
    // The listener is attached first: the page opens the endpoint the moment its bundle runs.
    webview.html = panelHtml({
      webview,
      extensionUri: context.extensionUri,
      host,
      session,
      ...(openPath === undefined ? {} : { openPath }),
    })
    return served
  }

  const webviewOptions = (): vscode.WebviewOptions => ({
    enableScripts: true,
    // Without this the webview may only load from the extension root; the bundle lives deeper.
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-app')],
  })

  /**
   * Widen the grant to whatever directory this subject needs, in one place.
   *
   * A file needs its own directory. A container member needs the *container's* directory, because
   * the member is reached by opening the container through the very same confined path opener — so
   * granting the member without granting its container would produce a URI that addresses something
   * this window then refuses to read.
   */
  const grantFor = (target: {
    readonly path: string
    readonly kind: 'file' | 'container-entry'
  }) => {
    if (target.kind === 'file') {
      granted.add(dirname(target.path))
      return
    }
    const location = parseContainerUriText(target.path)
    if (location !== undefined) granted.add(dirname(location.container))
  }

  /** Grant the file's directory and open it in the custom editor, or say why it cannot be opened. */
  const openResource = (uri: vscode.Uri): void => {
    const target = describeOpenTarget(uri)
    if (target.state === 'refused') {
      log(`refused ${uri.toString()}: ${target.reason}`)
      void vscode.window.showWarningMessage(`Modkit cannot open this: ${target.reason}`)
      return
    }
    grantFor(target)
    // The custom editor is the one place a subject is shown; there is no second panel any more.
    void vscode.commands.executeCommand('vscode.openWith', uri, CUSTOM_EDITOR_TYPE)
  }

  // ---------------------------------------------------------------- shared command runtime
  /*
   * The same six commands the CLI runs and Electron dispatches (block 13, works 4–6).
   *
   * Nothing about them is written here: the descriptors, what each one does, and how a missing
   * operation is reported all live in `@modkitx-x3/host`. This is the editor-shaped half — a
   * palette entry, a progress notification, a cancellation token — and it is the only half that
   * should ever differ between the three applications.
   */
  const commandRuntime = createSubjectCommandRuntime()
  const commandOpener = commandSubjectsFrom(
    createVsCodeCommandOpener({ services: host.services, roots, containers }),
  )

  const chooseRuntimeSession = async (): Promise<string | undefined> => {
    if (runtimeDebug.sessionIds.length === 0) {
      void vscode.window.showInformationMessage(
        'Modkit: no runtime session is open in this window.',
      )
      return undefined
    }
    if (runtimeDebug.sessionIds.length === 1) return runtimeDebug.sessionIds[0]
    return vscode.window.showQuickPick([...runtimeDebug.sessionIds], {
      title: 'Runtime session',
      placeHolder: 'Pick the session to control',
    })
  }

  const runtimeRequestFromPalette = async (): Promise<RuntimeDebugCommandRequest | undefined> => {
    const action = await vscode.window.showQuickPick(
      [
        { label: 'Start', description: 'start' },
        { label: 'Continue to tick or limit', description: 'continue' },
        { label: 'Pause', description: 'pause' },
        { label: 'Step', description: 'step' },
        { label: 'Inspect paused state', description: 'inspect' },
        { label: 'Status', description: 'status' },
        { label: 'Events', description: 'events' },
        { label: 'Capture snapshot', description: 'snapshot' },
        { label: 'Restore snapshot', description: 'restore' },
        { label: 'State hash', description: 'stateHash' },
        { label: 'Stop', description: 'stop' },
      ] as const,
      { title: 'Control a Modkit runtime', placeHolder: 'Pick an action' },
    )
    if (action === undefined) return undefined
    if (action.description === 'start') {
      const runtimeId = await vscode.window.showInputBox({
        title: 'Runtime id',
        prompt: 'A runtime id advertised through common.runtime/provider',
        ignoreFocusOut: true,
      })
      if (runtimeId === undefined) return undefined
      const sessionId = await vscode.window.showInputBox({
        title: 'Runtime session id',
        value: `vscode-runtime-${Date.now()}`,
        ignoreFocusOut: true,
      })
      return sessionId === undefined ? undefined : { action: 'start', runtimeId, sessionId }
    }
    const sessionId = await chooseRuntimeSession()
    if (sessionId === undefined) return undefined
    if (action.description === 'step') {
      const value = await vscode.window.showInputBox({ title: 'Ticks to step', value: '1' })
      if (value === undefined) return undefined
      return { action: 'step', sessionId, ticks: Number(value) }
    }
    if (action.description === 'continue') {
      const value = await vscode.window.showInputBox({
        title: 'Maximum ticks before pausing',
        value: '100',
      })
      if (value === undefined) return undefined
      const tick = await vscode.window.showInputBox({
        title: 'Optional tick breakpoint',
        prompt: 'Leave empty to pause only at the maximum tick count',
      })
      if (tick === undefined) return undefined
      return {
        action: 'continue',
        sessionId,
        maxTicks: Number(value),
        ...(tick.trim() === '' ? {} : { breakpoints: [{ tick: Number(tick) }] }),
      }
    }
    if (action.description === 'snapshot') {
      const snapshotId = await vscode.window.showInputBox({
        title: 'Snapshot id',
        value: `snapshot-${Date.now()}`,
      })
      return snapshotId === undefined ? undefined : { action: 'snapshot', sessionId, snapshotId }
    }
    if (action.description === 'restore') {
      const snapshotId = await vscode.window.showQuickPick(
        [...runtimeDebug.snapshotIds(sessionId)],
        {
          title: 'Restore snapshot',
        },
      )
      return snapshotId === undefined ? undefined : { action: 'restore', sessionId, snapshotId }
    }
    return { action: action.description, sessionId }
  }

  const runRuntimeDebug = async (
    argument: unknown,
  ): Promise<RuntimeDebugCommandResult | undefined> => {
    const request =
      typeof argument === 'object' && argument !== null && 'action' in argument
        ? (argument as RuntimeDebugCommandRequest)
        : await runtimeRequestFromPalette()
    if (request === undefined) return undefined
    const result = await runtimeDebug.dispatch(request)
    log(`[runtime] ${JSON.stringify(result)}`)
    if (result.state === 'unavailable') {
      void vscode.window.showWarningMessage(`Modkit runtime: ${result.message}`)
    } else {
      void vscode.window.showInformationMessage(
        `Modkit runtime ${result.sessionId}: ${result.action} completed.`,
      )
    }
    return result
  }

  /** Run one command with the editor's own progress and cancellation, and report it natively. */
  const runSharedCommand = async (request: {
    readonly command: string
    readonly subject: string
    readonly entry?: string
    readonly target?: string
  }): Promise<CommandResult> => {
    const descriptor = commandRuntime.get(request.command)
    const title = `Modkit: ${descriptor?.title ?? request.command}`
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      async (progress, token) => {
        /*
         * VS Code cancels through a token; the runtime cancels through an `AbortSignal`. One
         * listener bridges them, and the runtime turns the abort into a `x3.command/cancelled`
         * result rather than an exception — so the notification closes on an answer either way.
         */
        const controller = new AbortController()
        const subscription = token.onCancellationRequested(() => controller.abort())
        try {
          return await commandRuntime.run(
            request.command,
            {
              subject: request.subject,
              ...(request.entry === undefined ? {} : { entry: request.entry }),
              ...(request.target === undefined ? {} : { target: request.target }),
            },
            {
              openSubject: commandOpener,
              signal: controller.signal,
              progress: step => progress.report({ message: step.message }),
            },
          )
        } finally {
          subscription.dispose()
        }
      },
    )
    log(`[command] ${JSON.stringify(result)}`)
    // Findings about the subject go where every other subject finding goes.
    for (const item of result.diagnostics) {
      publishDiagnostic({
        code: item.code,
        message: item.message,
        severity: item.severity ?? 'information',
        path: request.subject,
      })
    }
    if (result.state === 'ok') {
      void vscode.window.showInformationMessage(
        `${title}: ${subjectLabel(request.subject)} — see the Modkit MK3 output for the full result.`,
      )
    } else if (result.state === 'unavailable') {
      // §4.2: the reason and the alternative, both, on a surface the person is already looking at.
      void vscode.window
        .showWarningMessage(`${title}: ${result.reason}`, 'What instead?')
        .then(choice => {
          if (choice !== undefined) void vscode.window.showInformationMessage(result.alternative)
        })
    } else {
      void vscode.window.showErrorMessage(`${title}: ${result.message}`)
    }
    return result
  }

  // ---------------------------------------------------------------- commands
  context.subscriptions.push(
    /*
     * Focuses the native view container rather than opening a panel of its own. What this command
     * used to raise was a webview listing the realm, its extensions and its facilities inside the
     * editor area — all three are native tree views now, and an editor tab is not where a window
     * describes itself.
     */
    vscode.commands.registerCommand('modkit.showHostProfile', () => {
      void vscode.commands.executeCommand('workbench.view.extension.modkit')
    }),

    vscode.commands.registerCommand('modkit.openResource', (uri: unknown) => {
      if (uri instanceof vscode.Uri) openResource(uri)
    }),

    vscode.commands.registerCommand('modkit.openWith', () => {
      void (async () => {
        const active = vscode.window.activeTextEditor?.document.uri
        if (active !== undefined) {
          openResource(active)
          return
        }
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Open in Modkit',
        })
        const first = picked?.[0]
        if (first !== undefined) openResource(first)
      })()
    }),

    /*
     * The shared command surface, in the palette.
     *
     * One entry rather than six: the list of commands is the runtime's, and a manifest that
     * repeated it would be a second copy to keep in step. Called with an argument object it runs
     * exactly that command, which is how the smoke drives one fixture through this host.
     */
    vscode.commands.registerCommand('modkit.runCommand', (argument: unknown) => {
      const request = argument as
        { command?: string; subject?: string; entry?: string; target?: string } | undefined
      return (async (): Promise<CommandResult | undefined> => {
        if (typeof request?.command === 'string' && typeof request.subject === 'string') {
          return runSharedCommand({
            command: request.command,
            subject: request.subject,
            ...(typeof request.entry === 'string' ? { entry: request.entry } : {}),
            ...(typeof request.target === 'string' ? { target: request.target } : {}),
          })
        }
        const subject = activeSubject ?? vscode.window.activeTextEditor?.document.uri.fsPath
        if (subject === undefined) {
          void vscode.window.showInformationMessage(
            'Modkit: open a file first — these commands run against the active subject.',
          )
          return undefined
        }
        const picked = await vscode.window.showQuickPick(
          commandRuntime.descriptors.map(item => ({
            label: item.title,
            description: item.id,
            detail: item.summary,
          })),
          { title: `Run on ${subjectLabel(subject)}`, placeHolder: 'Pick a command' },
        )
        if (picked === undefined) return undefined
        /*
         * `subject.extract` is the one of the six that needs a second word, and asking for it is
         * better than running it with an empty entry and reporting a refusal the user caused.
         */
        let entry: string | undefined
        if (picked.description === 'subject.extract') {
          entry = await vscode.window.showInputBox({
            title: 'Member to extract',
            prompt: 'Path of the entry inside the container',
          })
          if (entry === undefined) return undefined
        }
        return runSharedCommand({
          command: picked.description,
          subject,
          ...(entry === undefined ? {} : { entry }),
        })
      })()
    }),

    /** One generic surface; action and runtime identity are request data, never game branches. */
    vscode.commands.registerCommand('modkit.runtime.control', runRuntimeDebug),

    /*
     * Put a container in the Explorer.
     *
     * The folder added is a `modkit-container:` URI derived from the archive's own path, so it is
     * stable: the same archive yields the same folder in every window, and a saved workspace
     * reopens it. VS Code restarts the extension host when the *first* folder of a window changes,
     * which would tear down the composition mid-command — so an empty window is told to open a
     * folder first rather than being restarted behind the user's back.
     */
    vscode.commands.registerCommand('modkit.browseContainer', (argument: unknown) => {
      void (async () => {
        const uri =
          argument instanceof vscode.Uri
            ? argument
            : (vscode.window.activeTextEditor?.document.uri ??
              (
                await vscode.window.showOpenDialog({
                  canSelectMany: false,
                  openLabel: 'Browse container',
                })
              )?.[0])
        if (uri === undefined) return
        const target = describeOpenTarget(uri)
        if (target.state === 'refused' || target.kind !== 'file') {
          void vscode.window.showWarningMessage(
            `Modkit cannot browse this: ${target.state === 'refused' ? target.reason : 'it is already a container member'}`,
          )
          return
        }
        granted.add(dirname(target.path))
        try {
          // Opens and indexes it; a subject that is not a container is refused here by name,
          // before a folder the Explorer could not list appears in the workspace.
          await containers.index(target.path)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(`browse refused ${basename(target.path)}: ${message}`)
          void vscode.window.showWarningMessage(`Modkit cannot browse this file: ${message}`)
          return
        }
        const existing = vscode.workspace.workspaceFolders
        if (existing === undefined || existing.length === 0) {
          void vscode.window.showWarningMessage(
            'Modkit: open a folder in this window first — adding the first workspace folder ' +
              'restarts the extension host, which would close the container again. ' +
              'Open a folder and run this command again.',
          )
          return
        }
        const folder = vscode.Uri.from({
          scheme: CONTAINER_SCHEME,
          path: containerUriPath(target.path),
        })
        if (existing.some(item => item.uri.toString() === folder.toString())) {
          void vscode.commands.executeCommand('revealInExplorer', folder)
          return
        }
        const added = vscode.workspace.updateWorkspaceFolders(existing.length, 0, {
          uri: folder,
          name: basename(target.path),
        })
        log(
          added
            ? `container added to the workspace: ${basename(target.path)}`
            : `the workspace refused the container folder for ${basename(target.path)}`,
        )
        if (!added) {
          void vscode.window.showWarningMessage(
            'Modkit: VS Code did not accept the container as a workspace folder.',
          )
        }
      })()
    }),

    /*
     * Open one member of a container as a subject of its own.
     *
     * With a URI (from the Explorer, from a keybinding, from another extension) it opens that
     * member. Without one it lists the members of the container in the active editor, which is the
     * palette's answer to "I am looking at an archive and I want what is inside it".
     */
    vscode.commands.registerCommand('modkit.openArchiveEntry', (argument: unknown) => {
      void (async () => {
        if (argument instanceof vscode.Uri) {
          openResource(argument)
          return
        }
        const active = activeSubject
        if (active === undefined || parseContainerUriText(active) !== undefined) {
          void vscode.window.showInformationMessage(
            'Modkit: open a container file first, then run this command to pick a member.',
          )
          return
        }
        let members: readonly string[]
        try {
          const index = await containers.index(active)
          members = [...index.files.keys()].sort()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          void vscode.window.showWarningMessage(
            `Modkit: ${basename(active)} holds no entries: ${message}`,
          )
          return
        }
        const picked = await vscode.window.showQuickPick([...members], {
          title: `Members of ${basename(active)}`,
          placeHolder: 'Open a member as a subject of its own',
        })
        if (picked === undefined) return
        openResource(
          vscode.Uri.from({ scheme: CONTAINER_SCHEME, path: containerUriPath(active, picked) }),
        )
      })()
    }),

    /*
     * Connect a folder without opening the workbench first.
     *
     * The same write the settings view performs, reached from the command palette — one code path,
     * because two ways of appending to a setting would eventually disagree about what a duplicate
     * is or which target to write.
     */
    vscode.commands.registerCommand('modkit.addExtensionFolder', () => {
      void (async () => {
        const picked = await configuration.pickFolder()
        if (picked === undefined) return
        const root = resolve(picked)
        const { next, added, reason } = withExtensionRoot(configuration.readExtensions(), root, {
          caseSensitive: process.platform !== 'win32' && process.platform !== 'darwin',
        })
        if (!added) {
          log(`modkit.extensions unchanged: ${reason ?? 'already present'}`)
          void vscode.window.showInformationMessage(`Modkit: ${reason ?? 'already present'}`)
          return
        }
        // `write` logs, and asks to reload — this extension host composed once at activation.
        await configuration.write('extensions', next)
      })()
    }),

    vscode.commands.registerCommand('modkit.explainResolution', () => {
      const lines = [
        `topology: ${host.services.host.topology.topologyId}`,
        `extension host: ${host.services.host.profile.realmId} — ` +
          `${host.services.host.profile.facilities.length} facilities`,
        `codecs: ${host.services.workers.profile.realmId} (${host.services.executionProfiles.join('/')})`,
        `webview: ${host.webview.profile.realmId} — ${host.webview.profile.facilities.length} facilities`,
        `extensions: ${host.extensions.bundled.length + host.extensions.installed.length} loaded, ` +
          `${host.extensions.failures.length + host.extensions.problems.length} refused`,
        `contributions: ${host.contributions.length} inventoried, ` +
          `${host.contributions.filter(row => row.disabled).length} switched off`,
        `detectable types: ${host.supportedExtensions.length}`,
        `diagnostics: ${host.services.host.inventory.diagnostics.length}`,
      ]
      for (const line of lines) log(line)
      void vscode.window.showInformationMessage(lines.join(' · '), { modal: false })
    }),
  )

  // ---------------------------------------------------------------- custom editor
  const customDocumentChanged = new vscode.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<ModkitCustomDocument>
  >()
  context.subscriptions.push(customDocumentChanged)

  const checkCancellation = (token: vscode.CancellationToken): void => {
    if (token.isCancellationRequested) throw new vscode.CancellationError()
  }

  /**
   * A container member has nowhere to be saved back into.
   *
   * The provider is registered read-only, so VS Code normally never asks — but a custom editor is
   * asked directly by `workbench.action.files.save`, and answering "done" to a save that wrote
   * nothing is the one failure mode worth being loud about.
   */
  const refuseWriteToContainer = (document: ModkitCustomDocument): void => {
    if (!document.readOnly) return
    throw new Error(
      `${subjectLabel(subjectPathOf(document.uri))} lives inside a container, which this host opens read-only`,
    )
  }

  const customEditor: vscode.CustomEditorProvider<ModkitCustomDocument> = {
    onDidChangeCustomDocument: customDocumentChanged.event,

    async openCustomDocument(uri, openContext, token) {
      checkCancellation(token)
      if (openContext.backupId !== undefined) {
        log(`restoring custom document from checkpoint ${openContext.backupId}`)
        await vscode.workspace.fs.copy(vscode.Uri.parse(openContext.backupId), uri, {
          overwrite: true,
        })
        checkCancellation(token)
      }
      return new ModkitCustomDocument(uri)
    },

    resolveCustomEditor(document, panel) {
      panel.webview.options = webviewOptions()
      const target = describeOpenTarget(document.uri)
      if (target.state === 'refused') {
        log(`refused ${document.uri.toString()}: ${target.reason}`)
        panel.webview.html = refusalHtml(target.reason)
        return
      }
      grantFor(target)
      const served = attach(panel.webview, target.path, {
        onDirty(path, dirty) {
          if (path !== document.state.path) return
          if (document.state.markDirty(dirty) === 'became-dirty') {
            customDocumentChanged.fire({ document })
          }
        },
        onSaveRequested(path) {
          if (path === document.state.path) {
            void vscode.commands.executeCommand('workbench.action.files.save')
          }
        },
      })
      document.state.attach(served)

      /*
       * The status bar follows the active editor, not the open one. Several Modkit editors can be
       * open at once, and only the one in front is what the bar is describing.
       */
      const followActive = (): void => {
        const key = subjectKey(target.path)
        if (panel.active) {
          activeSubject = key
          showSubjectStatus(target.path)
        } else if (activeSubject === key) {
          activeSubject = undefined
          showSubjectStatus(undefined)
        }
      }
      followActive()
      panel.onDidChangeViewState(followActive)

      panel.onDidDispose(() => {
        if (activeSubject === subjectKey(target.path)) {
          activeSubject = undefined
          showSubjectStatus(undefined)
        }
        subjectFacts.delete(subjectKey(target.path))
        document.state.detach(served)
        live.delete(served)
        forgetDiagnostics(target.path)
        void served.close('the asset editor was closed')
      })
    },

    async saveCustomDocument(document, token) {
      checkCancellation(token)
      refuseWriteToContainer(document)
      await document.state.save()
      checkCancellation(token)
    },

    async saveCustomDocumentAs(document, destination, token) {
      checkCancellation(token)
      // Saving a container member *elsewhere* is extraction, and it is allowed: the copy below
      // reads through the read-only provider and writes a file that is no longer a member.
      if (!document.readOnly) await document.state.save()
      checkCancellation(token)
      if (destination.toString() !== document.uri.toString()) {
        await vscode.workspace.fs.copy(document.uri, destination, { overwrite: true })
      }
    },

    async revertCustomDocument(document, token) {
      checkCancellation(token)
      refuseWriteToContainer(document)
      await document.state.revert()
      checkCancellation(token)
    },

    async backupCustomDocument(document, backupContext, token) {
      checkCancellation(token)
      /*
       * The editor buffers live in the isolated webview, not in an extension-host mirror. The safe
       * hot-exit checkpoint is therefore: commit through the same native save path, then copy the
       * exact committed bytes to VS Code's backup destination. It may save earlier than shutdown,
       * but it never fabricates or drops an editor-specific buffer.
       */
      if (!document.readOnly) await document.state.save()
      checkCancellation(token)
      await vscode.workspace.fs.copy(document.uri, backupContext.destination, { overwrite: true })
      return {
        id: backupContext.destination.toString(),
        delete: () => vscode.workspace.fs.delete(backupContext.destination),
      }
    },
  }
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(CUSTOM_EDITOR_TYPE, customEditor, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  )

  // ---------------------------------------------------------------- views
  /*
   * Two native views and no file tree.
   *
   * There used to be a third, `modkit.assets`, which listed the workspace — a second file explorer
   * beside the one VS Code ships, offering the same folders with fewer features. Browsing workspace
   * files is the native Explorer's job and always was.
   *
   * Entries *inside* a container (BIG, CASC, MPQ) are the case the native Explorer genuinely cannot
   * serve today, and the answer for them is not a bespoke tree either: it is a `FileSystemProvider`
   * over the host's `openNestedSubject` route, so the real Explorer shows archive members. That is
   * blocks 13–14 — see docs/MK3/requests/REQUEST_VSCODE_NATIVE_SHELL_2026-08-25.md §3. Until then
   * the archive stage in the editor is where container entries are listed.
   */
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('modkit.host', hostView),
    vscode.window.registerTreeDataProvider('modkit.extensions', new ExtensionsView(host)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // The grant widened or narrowed; every open page reloads its tree and is told why.
      for (const served of live) {
        served.publishRoots()
        served.notice('The workspace folders changed, so the file tree was reloaded.')
      }
    }),
  )

  // ---------------------------------------------------------------- status bar
  /*
   * The subject's own facts, on the editor's status bar.
   *
   * This replaces a footer the webview drew inside itself, which — besides being chrome in a
   * surface that should hold only the working area — printed the subject's *absolute* path. A
   * status bar is where an editor says what the active thing is, and `asRelativePath` is how it
   * says it without handing out the shape of this machine.
   *
   * Shown only while a Modkit editor is the active one: a status bar entry that outlives its
   * subject is describing a file the user is no longer looking at.
   */
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  status.command = 'modkit.explainResolution'
  context.subscriptions.push(status)

  /** Facts per opened subject, kept so activating a tab again can restate them. */
  const subjectFacts = new Map<
    string,
    { readonly contributionId: string; readonly variantId: string; readonly bytes?: number }
  >()

  /**
   * How this window names a file out loud.
   *
   * `asRelativePath` returns the path unchanged when it is outside every workspace folder, and a
   * single file opened by name usually is — so the absolute answer is refused and the basename
   * used instead. A status bar has no room for a full path anyway, and no need for one.
   */
  const describeSubject = (path: string): string => {
    // A container member is named by its container's file name and its own path inside it — the
    // container's absolute path stays inside the URI and never reaches the bar.
    if (parseContainerUriText(path) !== undefined) return subjectLabel(path)
    const relative = vscode.workspace.asRelativePath(vscode.Uri.file(path), false)
    return isAbsolute(relative) ? basename(relative) : relative
  }

  const showSubjectStatus = (path: string | undefined): void => {
    if (path === undefined) {
      status.hide()
      return
    }
    const facts = subjectFacts.get(subjectKey(path))
    const size =
      facts?.bytes === undefined
        ? undefined
        : facts.bytes < 1024
          ? `${facts.bytes} B`
          : `${(facts.bytes / 1024).toFixed(1)} KiB`
    status.text = `$(file-binary) ${describeSubject(path)}`
    status.tooltip = [
      describeSubject(path),
      facts === undefined ? 'not opened by a codec' : `${facts.contributionId}/${facts.variantId}`,
      size,
      `reads up to ${VSCODE_MAXIMUM_SUBJECT_BYTES / (1024 * 1024)} MiB per file`,
    ]
      .filter(line => line !== undefined)
      .join('\n')
    status.show()
  }

  /** The Modkit editor the user is looking at, or nothing when they are looking elsewhere. */
  let activeSubject: string | undefined

  const rememberSubject = (opened: {
    readonly path: string
    readonly contributionId: string
    readonly variantId: string
  }): void => {
    const key = subjectKey(opened.path)
    // The size of a container member comes from the provider registered above, so this one call
    // answers for both kinds of subject.
    void vscode.workspace.fs.stat(subjectUriOf(key)).then(
      stat => {
        subjectFacts.set(key, {
          contributionId: opened.contributionId,
          variantId: opened.variantId,
          bytes: stat.size,
        })
        if (activeSubject === key) showSubjectStatus(key)
      },
      () => {
        subjectFacts.set(key, {
          contributionId: opened.contributionId,
          variantId: opened.variantId,
        })
        if (activeSubject === key) showSubjectStatus(key)
      },
    )
  }

  context.subscriptions.push({
    dispose: () => {
      for (const served of live) void served.close('the extension was deactivated')
      live.clear()
    },
  })

  const activationMs = Date.now() - activationStarted
  log(`Modkit MK3 activated in ${activationMs} ms`)
  return Object.freeze({
    activationMs,
    /*
     * A catalog root that was named and not shipped is the failure block-9's receipt caught as its
     * sixth defect, and it is reported three ways because it is the kind of fault that otherwise
     * looks like a healthy product: here for a harness, in the Extensions view for a person, and in
     * the warning `host.extensions.problems` already raises.
     */
    missingCatalogRoots: Object.freeze(
      host.extensions.problems.filter(problem => problem.startsWith('the shipped catalog names')),
    ),
    contributions: host.contributions.length,
    runtime: runtimeDebug,
    facilities: () => facilityReport,
  })
}

export async function deactivate(): Promise<void> {
  const shutdown = activeLanguageShutdown
  activeLanguageShutdown = undefined
  await shutdown?.()
}
