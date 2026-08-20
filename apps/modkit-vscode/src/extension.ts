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
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vscode from 'vscode'

import type { CloseAnswer, WebviewChannel } from './bridge.js'
import { CustomDocumentState } from './custom-document.js'
import { withExtensionRoot } from './extension-roots.js'
import {
  catalogCandidates,
  createVsCodeSubjectHost,
  VSCODE_MAXIMUM_SUBJECT_BYTES,
  VSCODE_SUBJECT_CONTRIBUTION_ID,
  VSCODE_SUBJECT_SERVICES_URL,
  type VsCodeConfigurationPort,
  type VsCodeServed,
  type VsCodeSubjectHost,
} from './host.js'
import { pageHtml, refusalHtml, type WebviewLike } from './page.js'
import { describeOpenTarget } from './uri.js'

const VIEW_TYPE = 'modkit.workbench'
const CUSTOM_EDITOR_TYPE = 'modkit.genericAssetPreview'

class ModkitCustomDocument implements vscode.CustomDocument {
  readonly state: CustomDocumentState

  constructor(readonly uri: vscode.Uri) {
    this.state = new CustomDocumentState(uri.fsPath)
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

class AssetsView implements vscode.TreeDataProvider<vscode.Uri> {
  private readonly changed = new vscode.EventEmitter<vscode.Uri | undefined>()
  readonly onDidChangeTreeData = this.changed.event

  refresh(): void {
    this.changed.fire(undefined)
  }

  getTreeItem(uri: vscode.Uri): vscode.TreeItem {
    const name = uri.path.split('/').filter(Boolean).at(-1) ?? uri.fsPath
    const directory = this.directories.has(uri.toString())
    const item = new vscode.TreeItem(
      name,
      directory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    )
    item.resourceUri = uri
    if (!directory) {
      item.command = { command: 'modkit.openResource', title: 'Open in Modkit', arguments: [uri] }
    }
    return item
  }

  /** Remembered from the last listing, because a `TreeItem` is built without its parent. */
  private readonly directories = new Set<string>()

  async getChildren(uri?: vscode.Uri): Promise<vscode.Uri[]> {
    if (uri === undefined) {
      const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri)
      for (const root of roots) this.directories.add(root.toString())
      return roots
    }
    const entries = await vscode.workspace.fs.readDirectory(uri)
    const children: vscode.Uri[] = []
    for (const [name, kind] of [...entries].sort((left, right) =>
      left[1] === right[1] ? left[0].localeCompare(right[0]) : right[1] - left[1],
    )) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const child = vscode.Uri.joinPath(uri, name)
      if (kind === vscode.FileType.Directory) this.directories.add(child.toString())
      else if (kind !== vscode.FileType.File) continue
      children.push(child)
    }
    return children
  }
}

// ---------------------------------------------------------------------------------------------
// activation

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
  const host = await createVsCodeSubjectHost({
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
  const granted = new Set<string>()
  const roots = (): readonly string[] => [...new Set([...workspaceFolders(), ...granted])]

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
      ...(lifecycle === undefined
        ? {}
        : {
            onDocumentDirty: lifecycle.onDirty,
            onDocumentSaveRequested: lifecycle.onSaveRequested,
          }),
      onDiagnostic: diagnostic => log(`[subject-rpc] ${diagnostic.code}: ${diagnostic.message}`),
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

  let workbench: { panel: vscode.WebviewPanel; served: VsCodeServed } | undefined

  const openWorkbench = (openPath?: string): void => {
    if (workbench !== undefined) {
      workbench.panel.reveal(vscode.ViewColumn.Active)
      // The page is already live here, so both travel as events; a panel that is being created
      // carries the path in its bootstrap instead, because a message posted before the bundle
      // runs is dropped. Roots go first: opening a file outside the workspace widened them.
      workbench.served.publishRoots()
      if (openPath !== undefined) workbench.served.open(openPath)
      return
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Modkit', vscode.ViewColumn.Active, {
      ...webviewOptions(),
      retainContextWhenHidden: true,
    })
    const served = attach(panel.webview, openPath)
    workbench = { panel, served }
    panel.onDidDispose(() => {
      workbench = undefined
      live.delete(served)
      void served.close('the workbench panel was closed')
    })
  }

  /** Grant the file's directory and route it to the workbench, or say why it cannot be opened. */
  const openResource = (uri: vscode.Uri): void => {
    const target = describeOpenTarget(uri)
    if (target.state === 'refused') {
      log(`refused ${uri.toString()}: ${target.reason}`)
      void vscode.window.showWarningMessage(`Modkit cannot open this: ${target.reason}`)
      return
    }
    granted.add(dirname(target.path))
    openWorkbench(target.path)
  }

  // ---------------------------------------------------------------- commands
  context.subscriptions.push(
    vscode.commands.registerCommand('modkit.showHostProfile', () => {
      openWorkbench()
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
      granted.add(dirname(target.path))
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
      panel.onDidDispose(() => {
        document.state.detach(served)
        live.delete(served)
        void served.close('the asset editor was closed')
      })
    },

    async saveCustomDocument(document, token) {
      checkCancellation(token)
      await document.state.save()
      checkCancellation(token)
    },

    async saveCustomDocumentAs(document, destination, token) {
      checkCancellation(token)
      await document.state.save()
      checkCancellation(token)
      if (destination.toString() !== document.uri.toString()) {
        await vscode.workspace.fs.copy(document.uri, destination, { overwrite: true })
      }
    },

    async revertCustomDocument(document, token) {
      checkCancellation(token)
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
      await document.state.save()
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
  const assets = new AssetsView()
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('modkit.assets', assets),
    vscode.window.registerTreeDataProvider('modkit.extensions', new ExtensionsView(host)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      assets.refresh()
      // The grant widened or narrowed; every open page reloads its tree and is told why.
      for (const served of live) {
        served.publishRoots()
        served.notice('The workspace folders changed, so the file tree was reloaded.')
      }
    }),
  )

  // ---------------------------------------------------------------- status bar
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  status.text = `$(package) Modkit ${host.extensions.bundled.length + host.extensions.installed.length}`
  status.tooltip =
    `${host.services.host.profile.realmId} · ` +
    `${host.supportedExtensions.length} detectable types · ` +
    `reads up to ${VSCODE_MAXIMUM_SUBJECT_BYTES / (1024 * 1024)} MiB per file`
  status.command = 'modkit.showHostProfile'
  status.show()
  context.subscriptions.push(status)

  context.subscriptions.push({
    dispose: () => {
      for (const served of live) void served.close('the extension was deactivated')
      live.clear()
    },
  })

  log('Modkit MK3 activated')
}

export function deactivate(): void {
  // Nothing to tear down: every disposable is registered on the extension context.
}
