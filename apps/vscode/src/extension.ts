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
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vscode from 'vscode'
import type { CatalogSource, ExtensionManagerEntry } from '@modkit/extension-manager'
import {
  loadRepositorySubjectProfiles,
  openRepositorySource,
  projectVendorGameSubjects,
  subjectRecordToWire,
} from '@modkit/extension-manager'
import {
  createNodeExtensionVfs,
  createNodeExtensionManager,
  discoverLocalExtensionCandidates,
  type LocalExtensionCandidate,
} from '@modkit/extension-manager/node'
import {
  parseUiCatalogDocument,
  UI_MESSAGES,
  type UiCatalogDocument,
  type UiLocale,
  type UiLocalizer,
  type UiMessageKey,
} from '@modkit/ui/localization'

import type { CloseAnswer, WebviewChannel } from './bridge.js'
import {
  createA7AcceptanceReceipt,
  createModkitAcceptanceReceipt,
  type ModkitAcceptanceReceipt,
} from './acceptance.js'
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
  loadLocalizationCatalogs,
  type CommandResult,
} from '@modkit/host'
import { createLanguageWorkspace, languageProviderRoutes } from '@modkit/host/language'
import { discoverGameInstallations } from '@modkit/host/games'
import { createNodeMapPreviewResourcePlanResolver, launchNodeGameResource } from '@modkit/host/node'
import type { ContainerRegistry } from './containers.js'
import { CustomDocumentState } from './custom-document.js'
import {
  createExtensionCardCatalog,
  extensionCardBundle,
  extensionCardIconTarget,
  extensionCardResourceTargets,
  type ExtensionCardBundle,
} from './extension-cards.js'
import { openVsCodeExtensionCardResource } from './extension-card-resource-actions.js'
import {
  configuredDisabledContributions,
  configuredDisabledExtensions,
  describeConfiguredExtensions,
  withContributionDisabled,
  withContributionsDisabled,
  withExtensionRoot,
} from './extension-roots.js'
import {
  createExtensionTree,
  extensionActionContextValue,
  extensionComponentActionContextValue,
  extensionEntryIsMutable,
  extensionEntrySupportsGroupedRemoval,
  extensionEntryDisplayName,
  extensionGroupActionContextValue,
  extensionTreeChildren,
  extensionVendorActionContextValue,
  OPEN_CONTRIBUTION_COMMAND,
  OPEN_EXTENSION_COMMAND,
  OPEN_GAME_COMMAND,
  OPEN_VENDOR_COMMAND,
  type ExtensionComponentNode,
  type ExtensionNode,
  type ExtensionVendorNode,
} from './extension-tree.js'
import {
  createVsCodeExtensionManagerClient,
  extensionManagerCommandCompletion,
  ExtensionManagerController,
  installedManagerExtensionState,
  type ExtensionManagerCommand,
  type StaticExtensionPackage,
} from './extension-manager.js'
import { extensionManagerSecurityOptions } from './extension-manager-environment.js'
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
import { createVscodeLocalizer, VSCODE_UI_CATALOGS } from './localization.js'
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
import {
  assertMaterializationBound,
  createDiagnosticJournal,
  installationGameIds,
  selectedContentSources,
  withSelectedContentSource,
  withoutSelectedContentSource,
  type SelectedContentSource,
} from './workbench-workflows.js'
import { runExplicitGameLaunch, VSCODE_GAME_LAUNCH_COMMAND } from './game-launch-workflow.js'

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

const GAME_DISCOVERY_BUDGET = Object.freeze({
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
})

const PACKAGE_INSTALL_GATE_COMMAND = '_modkit.acceptance.packageInstallGate'
const PACKAGE_INSTALL_GATE_ENV = 'MODKIT_VSCODE_ACCEPTANCE_PACKAGE_GATE'
const SELECTED_SOURCES_KEY = 'modkit.selectedContentSources'

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
  readonly locale: UiLocale
  readonly localizationCatalogs: readonly UiCatalogDocument[]
  readonly acceptance: ModkitAcceptanceReceipt
  readonly openPath?: string
  readonly extensionCard?: import('./extension-cards.js').ExtensionCardBundle
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
      locale: options.locale,
      localizationCatalogs: options.localizationCatalogs,
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
      acceptance: options.acceptance,
      ...(options.openPath === undefined ? {} : { openPath: options.openPath }),
      ...(options.extensionCard === undefined ? {} : { extensionCard: options.extensionCard }),
    },
  })
}

// ---------------------------------------------------------------------------------------------
// tree views

/**
 * Native extension-manager surface.
 *
 * Installed packages own their contributions. Availability is a separate catalogue question, and
 * problems remain visible without repeating installed packages in state-specific root groups.
 */
class ExtensionsView implements vscode.TreeDataProvider<ExtensionNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ExtensionNode | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  private readonly subscription: { dispose(): void }

  constructor(
    private readonly host: VsCodeSubjectHost,
    private readonly manager: ExtensionManagerController,
    private readonly disabledContributionIds: () => readonly string[],
    private readonly availableContributions: readonly import('./contributions.js').ContributionRow[],
    private readonly localizer: UiLocalizer,
    private readonly iconPathForEntry?: (entry: ExtensionManagerEntry) => string | undefined,
    private readonly gameIconPath?: string,
  ) {
    this.subscription = manager.onDidChange(() => this.changed.fire(undefined))
  }

  dispose(): void {
    this.subscription.dispose()
    this.changed.dispose()
  }

  getTreeItem(node: ExtensionNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const count = node.entries?.length ?? node.problems?.length ?? 0
      const item = new vscode.TreeItem(
        `${node.label} (${count})`,
        node.group === 'installed' && count > 0
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.iconPath = new vscode.ThemeIcon(node.group === 'problems' ? 'warning' : 'extensions')
      item.contextValue = extensionGroupActionContextValue(node)
      return item
    }
    if (node.kind === 'vendor') {
      const count = node.sections.reduce(
        (total, section) =>
          total +
          section.components.reduce((inner, component) => inner + component.entries.length, 0),
        0,
      )
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = `${count}`
      item.tooltip = node.label
      item.iconPath = new vscode.ThemeIcon('organization')
      item.contextValue = extensionVendorActionContextValue(node)
      item.command = {
        command: OPEN_VENDOR_COMMAND,
        title: this.localizer.text('extensions.action.openExtensionCard'),
        arguments: [{ kind: 'vendor', id: node.id } as const],
      }
      return item
    }
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = `${
        node.section === 'components'
          ? node.components.reduce((count, component) => count + component.entries.length, 0)
          : node.components.length
      }`
      item.tooltip = node.label
      item.iconPath = new vscode.ThemeIcon(node.section === 'games' ? 'game' : 'references')
      item.contextValue = `modkitExtensionSection.${node.section}`
      return item
    }
    if (node.kind === 'component') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = `${node.entries.length}`
      item.tooltip =
        node.component === 'shared'
          ? this.localizer.text('vscode.extensions.components')
          : (node.id ?? node.label)
      item.iconPath =
        node.component !== 'game' || this.gameIconPath === undefined
          ? new vscode.ThemeIcon(node.component === 'shared' ? 'references' : 'symbol-event')
          : vscode.Uri.file(this.gameIconPath)
      item.contextValue = extensionComponentActionContextValue(node)
      if (node.component === 'game' && node.id !== undefined) {
        item.command = {
          command: OPEN_GAME_COMMAND,
          title: this.localizer.text('extensions.action.openExtensionCard'),
          arguments: [{ kind: 'game', id: node.id } as const],
        }
      }
      return item
    }
    if (node.kind === 'problem') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None)
      item.description = node.detail
      item.tooltip = `${node.label}\n${node.detail}`
      item.iconPath = new vscode.ThemeIcon('error')
      return item
    }

    if (node.kind === 'contract') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = `${node.contributions.length}`
      const exactContract =
        node.contract === undefined
          ? undefined
          : `${node.contract}${node.contractMajor === undefined ? '' : `@${node.contractMajor}`}`
      item.tooltip =
        exactContract === undefined
          ? this.localizer.text('extensions.tooltip.invalidContract')
          : `${node.label}\n${this.localizer.text('extensions.tooltip.exactContract', { contract: exactContract })}`
      item.iconPath = new vscode.ThemeIcon('symbol-interface')
      item.contextValue = 'modkitContributionContract'
      return item
    }

    if (node.kind === 'contribution') {
      const { contribution } = node
      const item = new vscode.TreeItem(
        contribution.displayName,
        vscode.TreeItemCollapsibleState.None,
      )
      const identity = contribution.id ?? contribution.path
      const state = this.localizer.text(node.enabled ? 'common.enabled' : 'common.disabled')
      // State is communicated by the icon, tooltip and assistive label; do not repeat it as text.
      if (node.pendingReload)
        item.description = this.localizer.text('extensions.state.reloadPending')
      const exactContract = `${contribution.contract ?? this.localizer.text('extensions.tooltip.invalidContract')}${
        contribution.contractMajor === undefined ? '' : `@${contribution.contractMajor}`
      }`
      item.tooltip =
        `${identity}\n${node.extension}\n` +
        `${this.localizer.text('extensions.tooltip.contract', { contract: exactContract })}\n` +
        `${this.localizer.text('extensions.tooltip.state', { state })}` +
        `${node.pendingReload ? ` · ${this.localizer.text('extensions.state.afterReload')}` : ''}\n` +
        this.localizer.text('extensions.tooltip.origin', { origin: contribution.origin })
      item.iconPath = new vscode.ThemeIcon(node.enabled ? 'pass-filled' : 'circle-slash')
      item.accessibilityInformation = {
        label: `${contribution.displayName}: ${state}${
          node.pendingReload ? `; ${this.localizer.text('extensions.state.afterReload')}` : ''
        }`,
      }
      item.contextValue = extensionActionContextValue(node)
      if (contribution.id !== undefined) {
        item.command = {
          command: OPEN_CONTRIBUTION_COMMAND,
          title: this.localizer.text('extensions.action.openContributionCard'),
          arguments: [
            { kind: 'contribution', id: contribution.id, extension: node.extension } as const,
          ],
        }
      }
      return item
    }

    const { entry } = node
    const displayName = extensionEntryDisplayName(entry)
    const item = new vscode.TreeItem(
      displayName,
      node.contributions.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    )
    const version =
      entry.installedVersion === undefined
        ? `${this.localizer.text('extensions.group.available')} ${entry.availableVersion}`
        : entry.updateAvailable
          ? `${entry.installedVersion} → ${entry.availableVersion}`
          : entry.installedVersion
    item.description = `${version}${
      node.pendingReload ? ` · ${this.localizer.text('extensions.state.reloadPending')}` : ''
    }`
    item.tooltip =
      `${displayName}\n${entry.id}\n${version}\n${this.localizer.text('extensions.tooltip.source', {
        source: entry.source,
      })}\n` +
      this.localizer.text(
        entry.trusted
          ? 'extensions.tooltip.trustedPublisher'
          : 'extensions.tooltip.unverifiedPublisher',
      ) +
      (node.pendingReload ? `\n${this.localizer.text('extensions.state.afterReload')}` : '')
    const iconPath = this.iconPathForEntry?.(entry)
    item.iconPath =
      iconPath === undefined
        ? new vscode.ThemeIcon(
            node.group === 'available'
              ? 'cloud-download'
              : entry.enabled
                ? 'extensions'
                : 'circle-slash',
          )
        : vscode.Uri.file(iconPath)
    item.contextValue = extensionActionContextValue(node)
    item.command = {
      command: OPEN_EXTENSION_COMMAND,
      title: this.localizer.text('extensions.action.openExtensionCard'),
      arguments: [{ kind: 'extension', id: entry.id } as const],
    }
    return item
  }

  async getChildren(node?: ExtensionNode): Promise<ExtensionNode[]> {
    if (node !== undefined)
      return [...extensionTreeChildren(node, this.disabledContributionIds(), this.localizer)]

    const entries = (await this.manager.snapshot()).entries
    const problems = [
      ...this.host.extensions.failures.map(failure => ({
        kind: 'problem' as const,
        label: failure.root,
        detail: `${failure.code}: ${failure.message}`,
      })),
      ...this.host.extensions.problems.map(problem => ({
        kind: 'problem' as const,
        label: problem,
        detail: this.localizer.text('activity.settings'),
      })),
    ]
    return [
      ...createExtensionTree({
        entries,
        contributions: [...this.host.contributions, ...this.availableContributions],
        configuredDisabledContributionIds: this.disabledContributionIds(),
        pendingReloadEntryIds: this.manager.pendingReloadIds(),
        problems,
        localizer: this.localizer,
      }),
    ]
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
    private readonly sources: () => readonly SelectedContentSource[],
    private readonly localizer: UiLocalizer,
  ) {}

  refresh(): void {
    this.changed.fire(undefined)
  }

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
        label: this.localizer.text('sidebar.host'),
        icon: 'server-process',
        children: [
          { label: this.localizer.text('vscode.host.topology'), detail: this.topologyId },
          {
            label: this.localizer.text('vscode.host.extensionHost'),
            detail: services.host.profile.realmId,
          },
          {
            label: this.localizer.text('vscode.host.codecs'),
            detail: `${services.workers.profile.realmId} (${services.executionProfiles.join('/')})`,
          },
          {
            label: this.localizer.text('vscode.host.webview'),
            detail: this.host.webview.profile.realmId,
          },
          {
            label: this.localizer.text('vscode.host.inventoryDiagnostics'),
            detail: String(services.host.inventory.diagnostics.length),
          },
          {
            label: this.localizer.text('vscode.host.isolation'),
            detail: isolated
              ? this.localizer.text('vscode.host.isolationSafe')
              : this.localizer.text('vscode.host.isolationUnsafe'),
            icon: isolated ? 'shield' : 'warning',
          },
          {
            label: this.localizer.text('vscode.host.detectableTypes'),
            detail: String(this.host.supportedExtensions.length),
          },
        ],
      },
      {
        /*
         * Composed against honoured. Before a page has loaded there is nothing to compare, and the
         * rail says the composed set and no more — inventing an observation would be the exact
         * imitation §1.5 forbids.
         */
        label: this.localizer.text('sidebar.facilities'),
        icon: 'list-unordered',
        children:
          this.facilities === undefined
            ? webviewFacilities.map(facility => ({
                label: facility,
                detail: this.localizer.text('vscode.host.facilitiesPending'),
              }))
            : [
                ...this.facilities.intended.map(facility => ({
                  label: facility,
                  detail: this.facilities?.observed.includes(facility)
                    ? this.localizer.text('vscode.host.facilityHonoured')
                    : this.localizer.text('vscode.host.facilityUnavailable'),
                  icon: this.facilities?.observed.includes(facility) ? 'pass' : 'warning',
                })),
                ...this.facilities.ungranted.map(facility => ({
                  label: facility,
                  detail: this.localizer.text('vscode.host.facilityUngranted'),
                  icon: 'circle-outline',
                })),
              ],
      },
      {
        label: this.localizer.text('vscode.host.sources'),
        icon: 'root-folder',
        children:
          this.sources().length === 0
            ? [
                {
                  label: this.localizer.text('vscode.host.noSelectedGame'),
                  detail: this.localizer.text('vscode.host.selectGameHint'),
                },
              ]
            : this.sources().map(source => ({
                label: source.displayName,
                detail: source.gameId,
                icon: 'folder-library',
              })),
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
  const journal = createDiagnosticJournal()
  let localizer = createVscodeLocalizer(vscode.env.language)
  const log = (line: string): void => {
    journal.append(line)
    output.appendLine(line)
  }

  const extensionRoot = context.extensionUri.fsPath
  // In a checkout the extension lives at `<repo>/apps/vscode`; in a packaged build it
  // carries its own copy of the catalog and the checkout guess simply does not exist.
  const repositoryRoot = resolve(extensionRoot, '..', '..')
  let localExtensionCandidates: readonly LocalExtensionCandidate[] = Object.freeze([])
  let localExtensionRepositories: readonly import('@modkit/extension-manager/node').LocalExtensionRepositoryCandidate[] =
    Object.freeze([])
  try {
    const discovered = await discoverLocalExtensionCandidates({ workspaceRoot: repositoryRoot })
    localExtensionCandidates = discovered.extensions
    localExtensionRepositories = discovered.repositories
    log(
      `[extensions] local workspace catalog: ${discovered.repositories.length} repositories, ` +
        `${discovered.extensions.length} extensions, ${discovered.diagnostics.length} diagnostics`,
    )
    for (const diagnostic of discovered.diagnostics) {
      log(`[extensions] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
    }
  } catch (error) {
    log(
      `[extensions] no local workspace catalog: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  /*
   * The shared Node manager owns private catalog/artifact/enablement state under VS Code's global
   * storage. Construction and `installedRoots()` are local-only: the configured registry is not
   * opened until the user invokes the refresh command.
   */
  const initialConfiguration = vscode.workspace.getConfiguration('modkit')
  const rawConfiguredExtensions = initialConfiguration.get('extensions')
  const registrySetting = initialConfiguration.get<unknown>('extensionRegistry')
  const registryEnvironment = process.env.MODKIT_EXTENSION_REGISTRY
  const managerSecurity = extensionManagerSecurityOptions({
    MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS: process.env.MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS,
    MODKIT_EXTENSION_ALLOWED_ORIGINS: process.env.MODKIT_EXTENSION_ALLOWED_ORIGINS,
    MODKIT_EXTENSION_RAPID_POOL_ROOT: process.env.MODKIT_EXTENSION_RAPID_POOL_ROOT,
  })
  const registry =
    typeof registrySetting === 'string' && registrySetting.trim().length > 0
      ? registrySetting.trim()
      : registryEnvironment?.trim() === ''
        ? undefined
        : registryEnvironment?.trim()
  const noRegistryCatalog: CatalogSource = Object.freeze({
    cached: async () => undefined,
    refresh: async () => {
      throw new Error(
        'No extension registry is configured. Set modkit.extensionRegistry or ' +
          'MODKIT_EXTENSION_REGISTRY before refreshing.',
      )
    },
  })
  const nodeExtensionManager = createNodeExtensionManager({
    root: join(context.globalStorageUri.fsPath, 'extension-manager'),
    trustedPublicKeys: managerSecurity.trustedPublicKeys,
    vfsOptions: managerSecurity.vfsOptions,
    ...(registry === undefined
      ? { catalogSource: noRegistryCatalog }
      : {
          catalog: registry,
          baseDirectory: workspaceFolders()[0] ?? extensionRoot,
        }),
  })
  context.subscriptions.push({ dispose: () => void nodeExtensionManager.dispose() })
  const managedExtensionState = await installedManagerExtensionState(nodeExtensionManager)

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
    configuredExtensions: rawConfiguredExtensions,
    managedExtensions: managedExtensionState.roots,
    configuredDisabledContributions: vscode.workspace
      .getConfiguration('modkit')
      .get('disabledContributions'),
    configuredDisabledExtensions: [
      ...managedExtensionState.disabledExtensions,
      ...configuredDisabledExtensions(
        vscode.workspace.getConfiguration('modkit').get('disabledExtensions'),
      ).ids,
    ],
    // the bootstrap this extension ships beside its own bundle: a CommonJS entry has no
    // `import.meta.url` for the backend to resolve it from
    bootstrapUrl: pathToFileURL(join(extensionRoot, 'dist-app', 'worker-bootstrap.js')),
    onDiagnostic: diagnostic =>
      log(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`),
  })
  const acceptance = createModkitAcceptanceReceipt(
    createA7AcceptanceReceipt(BUNDLED_CATALOG.roots, {
      roots: host.extensions.bundled,
      contributions: host.contributions,
      loadErrors: host.bundledLoadErrors,
    }),
  )
  let localizationCatalogs: readonly UiCatalogDocument[] = Object.freeze([])
  const localizationVfs = createNodeExtensionVfs(managerSecurity.vfsOptions).vfs
  try {
    const englishAppCatalog = VSCODE_UI_CATALOGS[0]
    if (englishAppCatalog === undefined) throw new TypeError('VS Code English catalog is missing')
    const fallbackCatalog = Object.freeze({
      ...UI_MESSAGES.en,
      ...englishAppCatalog.messages,
    })
    const allowedRoots = Object.freeze(
      [...new Set(Object.keys(fallbackCatalog).map(key => `${key.split('.')[0]}.`))].sort(),
    )
    const loaded = await loadLocalizationCatalogs(host.services.host.inventory, {
      vfs: localizationVfs,
      parseCatalog: parseUiCatalogDocument,
      fallbackCatalog,
      authorizeMessagePrefixes: request => {
        const tail = request.catalogNamespace.split(/[./]/u).at(-1) ?? request.catalogNamespace
        const owner = tail.replace(/-(?:app|ui|localization|messages)$/u, '') || tail
        const ownedPrefix = `${owner}.`
        return request.requestedMessagePrefixes.filter(
          prefix => prefix === ownedPrefix || allowedRoots.some(root => prefix.startsWith(root)),
        )
      },
    })
    localizationCatalogs = loaded.catalogs
    localizer = createVscodeLocalizer(vscode.env.language, localizationCatalogs)
    for (const item of loaded.diagnostics) {
      log(`[localization] ${item.severity} ${item.code}: ${item.message}`)
    }
  } catch (error) {
    log(
      `[localization] external catalogs unavailable; built-in English/Russian remain active: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    await localizationVfs.dispose()
  }
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
    log(
      `extension loaded (${host.extensions.managed.includes(coordinate) ? 'managed' : 'installed'}): ${coordinate}`,
    )
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
  for (const id of host.extensions.disabledExtensions) {
    log(`extension disabled by modkit.disabledExtensions: ${id}`)
  }
  for (const diagnostic of host.services.host.inventory.diagnostics) {
    log(`[inventory] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
  }
  if (host.extensions.failures.length > 0 || host.extensions.problems.length > 0) {
    void vscode.window.showWarningMessage(
      `Modkit: ${localizer.text('vscode.shell.extensionRootsFailed', {
        count: host.extensions.failures.length + host.extensions.problems.length,
      })}`,
    )
  }

  // ---------------------------------------------------------------- granted roots
  /** Directories the user reached outside the workspace (a single file opened by name). */
  /** The realm rail. Held rather than constructed inline, because a page's report refreshes it. */
  let selectedSources = selectedContentSources(
    context.workspaceState.get<unknown>(SELECTED_SOURCES_KEY),
  )
  const hostView = new HostView(
    host,
    host.services.host.topology.topologyId,
    () => selectedSources,
    localizer,
  )

  const granted = new Set<string>(selectedSources.map(source => resolve(source.installPath)))
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

  const containerChanges = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  context.subscriptions.push(containerChanges)
  const containerFileSystem: vscode.FileSystemProvider = {
    // A refresh explicitly invalidates the held session/listing and emits one native root change.
    onDidChangeFile: containerChanges.event,
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
    const reload = localizer.text('extensions.action.reloadWindow')
    void vscode.window.showInformationMessage(message, reload).then(choice => {
      if (choice === reload) {
        void vscode.commands.executeCommand('workbench.action.reloadWindow')
      }
    })
  }

  const writeConfiguration = async (
    key: 'extensions' | 'disabledExtensions' | 'disabledContributions',
    value: readonly unknown[],
    promptForReload: boolean,
  ): Promise<void> => {
    await vscode.workspace.getConfiguration('modkit').update(key, [...value], configurationTarget)
    log(`modkit.${key} written (${configurationScope}): ${JSON.stringify(value)}`)
    if (promptForReload) {
      askToReload(
        `${localizer.text('extensions.status.configurationUpdated')} ${localizer.text(
          'extensions.state.afterReload',
        )}`,
      )
    }
  }

  const configuration: VsCodeConfigurationPort = {
    scope: configurationScope,
    readExtensions: () => vscode.workspace.getConfiguration('modkit').get('extensions'),
    readDisabledContributions: () =>
      vscode.workspace.getConfiguration('modkit').get('disabledContributions'),
    readDisabledExtensions: () =>
      vscode.workspace.getConfiguration('modkit').get('disabledExtensions'),
    async write(key, value) {
      await writeConfiguration(key, value, true)
    },
    async pickFolder() {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: localizer.text('vscode.shell.addExtensionFolder'),
        title: localizer.text('vscode.shell.addExtensionFolderTitle'),
      })
      return picked?.[0]?.fsPath
    },
  }
  const disabledExtensionIds = (): readonly string[] =>
    Object.freeze([
      ...new Set([
        ...managedExtensionState.disabledExtensions,
        ...configuredDisabledExtensions(configuration.readDisabledExtensions?.()).ids,
      ]),
    ])

  /* The Node manager owns package state; static rows are descriptive and never mutation targets. */
  const staticManagerPackages = (): readonly StaticExtensionPackage[] => {
    const configured = describeConfiguredExtensions(configuration.readExtensions())
    const disabledExtensions = new Set(disabledExtensionIds())
    const pathKey = (path: string): string => {
      const absolute = resolve(path)
      return process.platform === 'win32' || process.platform === 'darwin'
        ? absolute.toLowerCase()
        : absolute
    }
    const localByRoot = new Map(
      localExtensionCandidates.flatMap(candidate =>
        candidate.root === undefined ? [] : [[pathKey(candidate.root), candidate] as const],
      ),
    )
    const configuredCoordinates = configured.flatMap(entry => {
      const id = entry.id ?? localByRoot.get(pathKey(entry.path))?.id
      return id === undefined ? [] : ([[id, entry]] as const)
    })
    const configuredById = new Map(configuredCoordinates)
    const localById = new Map(localExtensionCandidates.map(candidate => [candidate.id, candidate]))
    const coordinates = [
      ...new Set([
        ...host.extensions.bundled,
        ...host.extensions.installed,
        ...configuredCoordinates.map(([id]) => id),
      ]),
    ]
    const available = localExtensionCandidates.map(candidate =>
      Object.freeze({
        entry: Object.freeze({
          id: candidate.id,
          displayName: candidate.displayName,
          publisher: candidate.publisher,
          availableVersion: candidate.version,
          enabled: false,
          updateAvailable: false,
          source: `local:${candidate.sourceId}`,
          trusted: true,
          ...(candidate.presentation === undefined ? {} : { presentation: candidate.presentation }),
        }),
      }),
    )
    return Object.freeze([
      ...available,
      ...coordinates.map(id => {
        const root = configuredById.get(id)
        const local = localById.get(id)
        const bundled = host.extensions.bundled.includes(id)
        const managedPackage = managedExtensionState.packageByExtension.get(id)
        const source = bundled
          ? 'bundled'
          : managedPackage === undefined
            ? root === undefined
              ? 'workspace'
              : 'configured'
            : `managed:${managedPackage}`
        return Object.freeze({
          entry: Object.freeze({
            id,
            displayName: local?.displayName ?? id,
            publisher: id.includes('/') ? id.slice(0, id.indexOf('/')) : 'unknown',
            availableVersion: 'local',
            installedVersion: 'local',
            enabled: !disabledExtensions.has(id) && (bundled || root === undefined || root.enabled),
            updateAvailable: false,
            source,
            trusted: bundled,
            ...(local?.presentation === undefined ? {} : { presentation: local.presentation }),
          }),
        })
      }),
    ])
  }
  const managerClient = createVsCodeExtensionManagerClient({
    client: nodeExtensionManager.client,
    staticPackages: staticManagerPackages,
  })
  const extensionManager = new ExtensionManagerController(managerClient)
  const packageInstallGateReceipt = async () => {
    const snapshot = await extensionManager.snapshot()
    const expectedGames = Object.freeze([
      { id: 'blizzard/starcraft-2', displayName: 'StarCraft II' },
      { id: 'wz2100project/warzone-2100', displayName: 'Warzone 2100' },
    ])
    const entrySummary = (entry: ExtensionManagerEntry) =>
      Object.freeze({
        id: entry.id,
        displayName: entry.displayName,
        publisher: entry.publisher,
        availableVersion: entry.availableVersion,
        installedVersion: entry.installedVersion,
        enabled: entry.enabled,
        updateAvailable: entry.updateAvailable,
        source: entry.source,
        trusted: entry.trusted,
        games: Object.freeze(entry.presentation?.games?.map(game => game.id).sort() ?? []),
      })
    const entries = Object.freeze(snapshot.entries.map(entrySummary))
    const checkoutEntries = entries.filter(
      entry => entry.source === 'workspace' || entry.source.startsWith('local:'),
    )
    const gameAvailability = Object.freeze(
      expectedGames.map(game => {
        const matchingEntries = entries.filter(entry => entry.games.includes(game.id))
        const availableEntries = matchingEntries.filter(
          entry => entry.installedVersion === undefined,
        )
        return Object.freeze({
          game,
          state: availableEntries.length > 0 ? ('available' as const) : ('missing' as const),
          entries: Object.freeze(matchingEntries.map(entry => entry.id)),
        })
      }),
    )
    const failures: { code: string; message: string }[] = []
    const extensionDevelopmentMode = context.extensionMode === vscode.ExtensionMode.Development
    if (extensionDevelopmentMode) {
      failures.push({
        code: 'x3.acceptance/extension-development-host-refused',
        message: 'the package/install gate must run from an ordinarily installed VSIX',
      })
    }
    if (!entries.some(entry => entry.trusted && entry.installedVersion === undefined)) {
      failures.push({
        code: 'x3.acceptance/offline-signed-catalog-missing',
        message: 'no trusted available extension from the bundled/offline catalog is visible',
      })
    }
    for (const availability of gameAvailability) {
      if (availability.state !== 'available') {
        failures.push({
          code: 'x3.acceptance/game-extension-not-available',
          message: `${availability.game.displayName} (${availability.game.id}) is not Available in the installed offline catalog snapshot`,
        })
      }
    }
    if (checkoutEntries.length > 0) {
      failures.push({
        code: 'x3.acceptance/checkout-source-visible',
        message: `package/install gate saw checkout-local entries: ${checkoutEntries
          .map(entry => entry.id)
          .join(', ')}`,
      })
    }
    failures.push({
      code: 'x3.acceptance/package-lifecycle-not-implemented',
      message:
        'A3/A5 requires Available -> install -> disable -> enable -> uninstall -> reinstall with persisted restart state; this test-command contract records the red gate but does not implement product package delivery.',
    })
    return Object.freeze({
      kind: 'x3.modkit/vscode-package-install-gate',
      schemaVersion: 1,
      command: PACKAGE_INSTALL_GATE_COMMAND,
      execution: Object.freeze({
        host: 'vscode-extension-host',
        extensionDevelopmentMode,
        catalogRefreshRequested: false,
        networkAccessRequested: false,
        checkoutDependencyDetected: checkoutEntries.length > 0,
      }),
      expected: Object.freeze({
        offlineCatalogSigned: true,
        offlineCatalogVisible: true,
        games: expectedGames,
        lifecycle: Object.freeze([
          'available',
          'install',
          'disable',
          'enable',
          'uninstall',
          'reinstall',
        ]),
        persistedAcrossFullProcessRestart: true,
      }),
      catalog: Object.freeze({
        entries,
        trustedAvailableEntries: Object.freeze(
          entries
            .filter(entry => entry.trusted && entry.installedVersion === undefined)
            .map(entry => entry.id),
        ),
      }),
      gameAvailability,
      lifecycle: Object.freeze({
        attempted: false,
        reason:
          'production package delivery is intentionally not implemented by this acceptance-contract patch',
      }),
      failures: Object.freeze(failures),
      verdict: failures.length === 0 ? ('pass' as const) : ('fail' as const),
    })
  }
  const writePackageInstallGateReceipt = async () => {
    const target = vscode.Uri.joinPath(context.globalStorageUri, 'package-install-gate.json')
    let gateReceipt: unknown
    try {
      gateReceipt = await packageInstallGateReceipt()
    } catch (error) {
      gateReceipt = Object.freeze({
        kind: 'x3.modkit/vscode-package-install-gate',
        schemaVersion: 1,
        command: PACKAGE_INSTALL_GATE_COMMAND,
        failures: Object.freeze([
          Object.freeze({
            code: 'x3.acceptance/package-install-gate-threw',
            message: error instanceof Error ? error.message : String(error),
          }),
        ]),
        verdict: 'fail' as const,
      })
    }
    await vscode.workspace.fs.createDirectory(context.globalStorageUri)
    await vscode.workspace.fs.writeFile(
      target,
      new TextEncoder().encode(`${JSON.stringify(gateReceipt, null, 2)}\n`),
    )
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(PACKAGE_INSTALL_GATE_COMMAND, packageInstallGateReceipt),
  )
  if (process.env[PACKAGE_INSTALL_GATE_ENV] === '1') {
    void writePackageInstallGateReceipt().catch(error => {
      log(
        `[acceptance] package install gate failed to write: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    })
  }
  // Reproject on open so a settings write is reflected even when the user postpones the reload.
  // Inventory stays the activation snapshot; direct enablement is the live preference layered on
  // top of it, and the card names both instead of showing a stale button.
  const extensionCards = () =>
    createExtensionCardCatalog({
      inventory: host.services.host.inventory,
      localCandidates: localExtensionCandidates,
      linkableLocalExtensionIds: [...linkableExtensionRoots.keys()],
      managedPackageByExtension: managedExtensionState.packageByExtension,
      disabledManagedExtensions: managedExtensionState.disabledExtensions,
      disabledExtensions: disabledExtensionIds(),
      disabledContributions: configuredDisabledContributions(
        configuration.readDisabledContributions(),
      ).ids,
      onDiagnostic: message => log(`[extension-card] ${message}`),
    })
  const localCoordinateCounts = new Map<string, number>()
  for (const candidate of localExtensionCandidates) {
    localCoordinateCounts.set(candidate.id, (localCoordinateCounts.get(candidate.id) ?? 0) + 1)
  }
  const linkableExtensionRoots = new Map(
    localExtensionCandidates.flatMap(candidate =>
      candidate.root === undefined || localCoordinateCounts.get(candidate.id) !== 1
        ? []
        : ([[candidate.id, candidate.root]] as const),
    ),
  )
  const localConfiguredEntries = () => {
    const configured = describeConfiguredExtensions(configuration.readExtensions())
    const pathKey = (path: string): string => {
      const absolute = resolve(path)
      return process.platform === 'win32' || process.platform === 'darwin'
        ? absolute.toLowerCase()
        : absolute
    }
    const byRoot = new Map(
      localExtensionCandidates.flatMap(candidate =>
        candidate.root === undefined ? [] : [[pathKey(candidate.root), candidate] as const],
      ),
    )
    const byId = new Map(localExtensionCandidates.map(candidate => [candidate.id, candidate]))
    return configured.flatMap(entry => {
      const candidate =
        (entry.id === undefined ? undefined : byId.get(entry.id)) ?? byRoot.get(pathKey(entry.path))
      return candidate === undefined ? [] : [{ index: entry.index, candidate }]
    })
  }
  const removeConfiguredEntries = async (indices: ReadonlySet<number>): Promise<number> => {
    if (indices.size === 0) return 0
    const raw = configuration.readExtensions()
    if (!Array.isArray(raw)) return 0
    const next = raw.filter((_entry, index) => !indices.has(index))
    if (next.length === raw.length) return 0
    await writeConfiguration('extensions', next, false)
    return raw.length - next.length
  }
  const repositorySubjectProfiles: { vendors: unknown[]; games: unknown[] } = {
    vendors: [],
    games: [],
  }
  const subjectProfileVfs = createNodeExtensionVfs(managerSecurity.vfsOptions).vfs
  for (const repository of localExtensionRepositories) {
    // Profiles describe Available as well as Installed rows. A workspace profile may intentionally
    // leave a repository's codecs unselected, but its inert vendor/game JSON still has to power
    // the catalog cards and the install decision.
    if (!repository.enabled) continue
    try {
      const opened = (await openRepositorySource(subjectProfileVfs, {
        id: repository.sourceId,
        uri: repository.uri,
        enabled: repository.enabled,
      })) as {
        readonly mount: Parameters<typeof loadRepositorySubjectProfiles>[0]
        readonly manifest: unknown
      }
      try {
        const profiles = await loadRepositorySubjectProfiles(opened.mount, opened.manifest)
        repositorySubjectProfiles.vendors.push(...profiles.vendors)
        repositorySubjectProfiles.games.push(...profiles.games)
      } finally {
        await opened.mount.dispose()
      }
    } catch (error) {
      log(
        `[repository-subject] ${repository.sourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
  const uniqueProfile = (
    profiles: readonly unknown[],
    kind: 'vendor' | 'game',
  ): readonly unknown[] => {
    const byId = new Map<string, unknown>()
    for (const profile of profiles) {
      const id =
        profile !== null &&
        typeof profile === 'object' &&
        typeof (profile as { id?: unknown }).id === 'string'
          ? (profile as { readonly id: string }).id
          : undefined
      if (id === undefined) continue
      if (byId.has(id)) {
        log(`[repository-subject] duplicate ${kind} profile ignored: ${id}`)
        continue
      }
      byId.set(id, profile)
    }
    return [...byId.values()]
  }
  const repositorySubjects = projectVendorGameSubjects({
    vendors: uniqueProfile(repositorySubjectProfiles.vendors, 'vendor'),
    games: uniqueProfile(repositorySubjectProfiles.games, 'game'),
    records: [...extensionCards().values()].flatMap(entry => entry.projection.records),
    source: { id: 'modkit-repository:local-subject-profiles' },
    workspace: repositoryRoot,
  })
  const extensionIconPaths = new Map(
    [...extensionCards().entries()].flatMap(([id, entry]) => {
      const icon = extensionCardIconTarget(entry)
      return icon === undefined ? [] : ([[id, icon]] as const)
    }),
  )
  const managedPackageIds = new Set(managedExtensionState.packageByExtension.values())
  const loadedExtensionIds = new Set([...host.extensions.bundled, ...host.extensions.installed])
  const availableContributions = Object.freeze(
    localExtensionCandidates
      .filter(candidate => !loadedExtensionIds.has(candidate.id))
      .flatMap(candidate =>
        candidate.contributions.map(contribution => ({
          id: contribution.id,
          displayName: contribution.displayName,
          contract: contribution.contract.id,
          contractMajor: contribution.contract.major,
          extension: candidate.id,
          origin: `available:${candidate.sourceId}`,
          activationEligible: false,
          disabled: false,
          path: contribution.path,
        })),
      ),
  )
  const extensionsView = new ExtensionsView(
    host,
    extensionManager,
    () => configuredDisabledContributions(configuration.readDisabledContributions()).ids,
    availableContributions,
    localizer,
    entry => extensionIconPaths.get(entry.id),
    join(extensionRoot, 'media', 'game.svg'),
  )
  context.subscriptions.push(extensionsView)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration('modkit.extensions') ||
        event.affectsConfiguration('modkit.disabledExtensions') ||
        event.affectsConfiguration('modkit.disabledContributions')
      ) {
        extensionManager.invalidate()
      }
    }),
  )

  const confirmClose = async (message: string, savable: boolean): Promise<CloseAnswer> => {
    const save = localizer.text('vscode.shell.save')
    const discard = localizer.text('vscode.shell.discard')
    const choices = savable ? [save, discard] : [discard]
    const answer = await vscode.window.showWarningMessage(message, { modal: true }, ...choices)
    if (answer === save) return 'save'
    return answer === discard ? 'discard' : 'cancel'
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
    grant: { id: 'modkit.app.vscode/language', classes: [] },
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

  const nativeCompletionKind = (kind: string): vscode.CompletionItemKind => {
    switch (kind) {
      case 'class':
      case 'struct':
        return vscode.CompletionItemKind.Class
      case 'constant':
        return vscode.CompletionItemKind.Constant
      case 'enum':
        return vscode.CompletionItemKind.Enum
      case 'field':
        return vscode.CompletionItemKind.Field
      case 'function':
        return vscode.CompletionItemKind.Function
      case 'interface':
        return vscode.CompletionItemKind.Interface
      case 'keyword':
        return vscode.CompletionItemKind.Keyword
      case 'module':
      case 'namespace':
        return vscode.CompletionItemKind.Module
      case 'parameter':
      case 'variable':
        return vscode.CompletionItemKind.Variable
      case 'property':
        return vscode.CompletionItemKind.Property
      case 'snippet':
        return vscode.CompletionItemKind.Snippet
      case 'type':
        return vscode.CompletionItemKind.TypeParameter
      default:
        return vscode.CompletionItemKind.Text
    }
  }

  const nativeLocation = (location: {
    readonly uri: string
    readonly range: Parameters<typeof rangeOf>[0]
  }): vscode.Location =>
    new vscode.Location(vscode.Uri.parse(location.uri), rangeOf(location.range))

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
      for (const item of diagnostics) {
        log(`[language] ${uri}: ${item.severity} ${item.code}: ${item.message}`)
      }
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
      vscode.languages.registerDocumentFormattingEditProvider(languageSelector, {
        async provideDocumentFormattingEdits(document, formatting, token) {
          const cancellation = signalFor(token)
          try {
            const result = await languageController.formatting(
              languageDocument(document),
              {
                tabSize: formatting.tabSize,
                insertSpaces: formatting.insertSpaces,
              },
              cancellation.signal,
            )
            return result?.edits.map(item =>
              vscode.TextEdit.replace(rangeOf(item.range), item.newText),
            )
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] formatting failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            return undefined
          } finally {
            cancellation.dispose()
          }
        },
      }),
      vscode.languages.registerCompletionItemProvider(languageSelector, {
        async provideCompletionItems(document, position, token) {
          const cancellation = signalFor(token)
          try {
            const completion = await languageController.completion(
              languageDocument(document),
              { line: position.line, character: position.character },
              cancellation.signal,
            )
            if (completion === undefined) return undefined
            return new vscode.CompletionList(
              completion.items.map(item => {
                const native = new vscode.CompletionItem(
                  item.label,
                  nativeCompletionKind(item.kind),
                )
                if (item.detail !== undefined) native.detail = item.detail
                if (item.documentation !== undefined) {
                  native.documentation = new vscode.MarkdownString(item.documentation)
                }
                if (item.insertText !== undefined) {
                  native.insertText =
                    item.insertTextFormat === 'snippet'
                      ? new vscode.SnippetString(item.insertText)
                      : item.insertText
                }
                if (item.sortText !== undefined) native.sortText = item.sortText
                return native
              }),
              completion.isIncomplete,
            )
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] completion failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            return undefined
          } finally {
            cancellation.dispose()
          }
        },
      }),
      vscode.languages.registerHoverProvider(languageSelector, {
        async provideHover(document, position, token) {
          const cancellation = signalFor(token)
          try {
            const hover = await languageController.hover(
              languageDocument(document),
              { line: position.line, character: position.character },
              cancellation.signal,
            )
            return hover === undefined
              ? undefined
              : new vscode.Hover(
                  new vscode.MarkdownString(hover.markdown),
                  hover.range === undefined ? undefined : rangeOf(hover.range),
                )
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] hover failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            return undefined
          } finally {
            cancellation.dispose()
          }
        },
      }),
      vscode.languages.registerSignatureHelpProvider(
        languageSelector,
        {
          async provideSignatureHelp(document, position, token) {
            const cancellation = signalFor(token)
            try {
              const help = await languageController.signatureHelp(
                languageDocument(document),
                { line: position.line, character: position.character },
                cancellation.signal,
              )
              if (help === undefined) return undefined
              const native = new vscode.SignatureHelp()
              native.activeSignature = help.activeSignature
              native.activeParameter = help.activeParameter
              native.signatures = help.signatures.map(signature => {
                const item = new vscode.SignatureInformation(signature.label)
                if (signature.documentation !== undefined) {
                  item.documentation = signature.documentation
                }
                item.parameters = signature.parameters.map(
                  parameter =>
                    new vscode.ParameterInformation(parameter.label, parameter.documentation),
                )
                return item
              })
              return native
            } catch (error) {
              if (token.isCancellationRequested) return undefined
              log(
                `[language] signature help failed: ${error instanceof Error ? error.message : String(error)}`,
              )
              return undefined
            } finally {
              cancellation.dispose()
            }
          },
        },
        '(',
        ',',
      ),
      vscode.languages.registerDefinitionProvider(languageSelector, {
        async provideDefinition(document, position, token) {
          const cancellation = signalFor(token)
          try {
            const result = await languageController.definition(
              languageDocument(document),
              { line: position.line, character: position.character },
              cancellation.signal,
            )
            return result?.locations.map(nativeLocation)
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] definition failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            return undefined
          } finally {
            cancellation.dispose()
          }
        },
      }),
      vscode.languages.registerReferenceProvider(languageSelector, {
        async provideReferences(document, position, context, token) {
          const cancellation = signalFor(token)
          try {
            const result = await languageController.references(
              languageDocument(document),
              { line: position.line, character: position.character },
              context.includeDeclaration,
              cancellation.signal,
            )
            return result?.locations.map(nativeLocation)
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] references failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            return undefined
          } finally {
            cancellation.dispose()
          }
        },
      }),
      vscode.languages.registerRenameProvider(languageSelector, {
        async prepareRename(document, position, token) {
          const cancellation = signalFor(token)
          try {
            const result = await languageController.prepareRename(
              languageDocument(document),
              { line: position.line, character: position.character },
              cancellation.signal,
            )
            return result === undefined
              ? undefined
              : { range: rangeOf(result.range), placeholder: result.placeholder }
          } finally {
            cancellation.dispose()
          }
        },
        async provideRenameEdits(document, position, newName, token) {
          const cancellation = signalFor(token)
          try {
            const result = await languageController.rename(
              languageDocument(document),
              { line: position.line, character: position.character },
              newName,
              cancellation.signal,
            )
            if (result === undefined) return undefined
            const edit = new vscode.WorkspaceEdit()
            for (const change of result.documentChanges) {
              edit.set(
                vscode.Uri.parse(change.uri),
                change.edits.map(item =>
                  vscode.TextEdit.replace(rangeOf(item.range), item.newText),
                ),
              )
            }
            return edit
          } finally {
            cancellation.dispose()
          }
        },
      }),
      vscode.languages.registerWorkspaceSymbolProvider({
        async provideWorkspaceSymbols(query, token) {
          const cancellation = signalFor(token)
          try {
            const result = await languageController.workspaceSymbols(query, cancellation.signal)
            return result?.symbols.map(
              symbol =>
                new vscode.SymbolInformation(
                  symbol.name,
                  SYMBOL_KIND[symbol.kind],
                  symbol.containerName ?? '',
                  nativeLocation(symbol.location),
                ),
            )
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] workspace symbols failed: ${error instanceof Error ? error.message : String(error)}`,
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
  const liveSubjects = new Map<VsCodeServed, string | undefined>()

  const attach = (
    webview: vscode.Webview,
    openPath?: string,
    lifecycle?: {
      readonly onDirty: (path: string, dirty: boolean) => void
      readonly onSaveRequested: (path: string) => void
    },
    extensionCard?: import('./extension-cards.js').ExtensionCardBundle,
    extensionCardResources?: import('./extension-cards.js').ExtensionCardResourceTargets,
    extensionCardIconPath?: string,
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
      linkableExtensionRoots,
      ...(extensionCardResources === undefined
        ? {}
        : {
            extensionCardResources,
            openExtensionCardResource: resource =>
              openVsCodeExtensionCardResource(vscode, resource),
          }),
      managedPackageIds,
      setManagedPackageEnabled: async (id, enabled) => {
        await extensionManager.execute({ kind: 'set-enabled', id, enabled })
        log(`[extensions] ${id} ${enabled ? 'enabled' : 'disabled'} from extension card`)
        askToReload(
          localizer.text('extensions.status.reloadRequired', {
            id,
            state: localizer.text(enabled ? 'common.enabled' : 'common.disabled'),
          }),
        )
      },
      removeManagedPackage: async id => {
        await extensionManager.execute({ kind: 'remove', id })
        log(`[extensions] ${id} removed from extension card`)
        askToReload(localizer.text('vscode.extensions.removed', { id }))
      },
      ...(extensionCard?.repositorySubject === undefined
        ? {}
        : {
            repositorySubject: extensionCard.repositorySubject,
            manageRepositorySubject: async (request: {
              readonly kind: 'vendor' | 'game'
              readonly id: string
              readonly action: 'install' | 'remove'
            }) => {
              if (request.kind === 'vendor') {
                if (request.action !== 'remove') return
                await vscode.commands.executeCommand('modkit.extensions.removeVendorSupport', {
                  kind: 'vendor',
                  id: request.id,
                  label: extensionCard.repositorySubject?.label ?? request.id,
                })
                return
              }
              await vscode.commands.executeCommand(
                request.action === 'install'
                  ? 'modkit.extensions.installGameSupport'
                  : 'modkit.extensions.removeGameSupport',
                {
                  kind: 'component',
                  component: 'game',
                  id: request.id,
                  label: extensionCard.repositorySubject?.label ?? request.id,
                },
              )
            },
          }),
      confirmClose,
      configuration,
      mapPreviewResourcePlanResolver,
      localizer,
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
    liveSubjects.set(served, openPath === undefined ? undefined : subjectKey(openPath))
    // The listener is attached first: the page opens the endpoint the moment its bundle runs.
    const displayedExtensionCard =
      extensionCard === undefined || extensionCardIconPath === undefined
        ? extensionCard
        : {
            ...extensionCard,
            extension: {
              ...extensionCard.extension,
              iconUri: webview.asWebviewUri(vscode.Uri.file(extensionCardIconPath)).toString(),
            },
          }
    webview.html = panelHtml({
      webview,
      extensionUri: context.extensionUri,
      host,
      session,
      locale: localizer.locale,
      localizationCatalogs,
      acceptance,
      ...(openPath === undefined ? {} : { openPath }),
      ...(displayedExtensionCard === undefined ? {} : { extensionCard: displayedExtensionCard }),
    })
    return served
  }

  const webviewOptions = (resources: readonly vscode.Uri[] = []): vscode.WebviewOptions => ({
    enableScripts: true,
    // Without this the webview may only load from the extension root; the bundle lives deeper.
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist-app'), ...resources],
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
      void vscode.window.showWarningMessage(
        localizer.text('vscode.shell.cannotOpen', { reason: target.reason }),
      )
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
   * operation is reported all live in `@modkit/host`. This is the editor-shaped half — a
   * palette entry, a progress notification, a cancellation token — and it is the only half that
   * should ever differ between the three applications.
   */
  const commandRuntime = createSubjectCommandRuntime()
  const commandOpener = commandSubjectsFrom(
    createVsCodeCommandOpener({ services: host.services, roots, containers }),
  )

  const runtimeActionLabel = (action: string): string => {
    const keys: Readonly<Record<string, UiMessageKey>> = Object.freeze({
      start: 'vscode.runtime.action.start',
      continue: 'vscode.runtime.action.continue',
      pause: 'vscode.runtime.action.pause',
      step: 'vscode.runtime.action.step',
      inspect: 'vscode.runtime.action.inspect',
      status: 'vscode.runtime.action.status',
      events: 'vscode.runtime.action.events',
      snapshot: 'vscode.runtime.action.snapshot',
      restore: 'vscode.runtime.action.restore',
      stateHash: 'vscode.runtime.action.stateHash',
      stop: 'vscode.runtime.action.stop',
    })
    const key = keys[action]
    return key === undefined ? action : localizer.text(key)
  }

  const chooseRuntimeSession = async (): Promise<string | undefined> => {
    if (runtimeDebug.sessionIds.length === 0) {
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('vscode.runtime.noSession')}`,
      )
      return undefined
    }
    if (runtimeDebug.sessionIds.length === 1) return runtimeDebug.sessionIds[0]
    return vscode.window.showQuickPick([...runtimeDebug.sessionIds], {
      title: localizer.text('vscode.runtime.session'),
      placeHolder: localizer.text('vscode.runtime.sessionPlaceholder'),
    })
  }

  const runtimeRequestFromPalette = async (): Promise<RuntimeDebugCommandRequest | undefined> => {
    const action = await vscode.window.showQuickPick(
      [
        { label: runtimeActionLabel('start'), description: 'start' },
        { label: runtimeActionLabel('continue'), description: 'continue' },
        { label: runtimeActionLabel('pause'), description: 'pause' },
        { label: runtimeActionLabel('step'), description: 'step' },
        { label: runtimeActionLabel('inspect'), description: 'inspect' },
        { label: runtimeActionLabel('status'), description: 'status' },
        { label: runtimeActionLabel('events'), description: 'events' },
        { label: runtimeActionLabel('snapshot'), description: 'snapshot' },
        { label: runtimeActionLabel('restore'), description: 'restore' },
        { label: runtimeActionLabel('stateHash'), description: 'stateHash' },
        { label: runtimeActionLabel('stop'), description: 'stop' },
      ] as const,
      {
        title: localizer.text('vscode.runtime.control'),
        placeHolder: localizer.text('vscode.runtime.actionPlaceholder'),
      },
    )
    if (action === undefined) return undefined
    if (action.description === 'start') {
      const runtimeId = await vscode.window.showInputBox({
        title: localizer.text('vscode.runtime.runtimeId'),
        prompt: localizer.text('vscode.runtime.runtimeIdPrompt'),
        ignoreFocusOut: true,
      })
      if (runtimeId === undefined) return undefined
      const sessionId = await vscode.window.showInputBox({
        title: localizer.text('vscode.runtime.sessionId'),
        value: `vscode-runtime-${Date.now()}`,
        ignoreFocusOut: true,
      })
      return sessionId === undefined ? undefined : { action: 'start', runtimeId, sessionId }
    }
    const sessionId = await chooseRuntimeSession()
    if (sessionId === undefined) return undefined
    if (action.description === 'step') {
      const value = await vscode.window.showInputBox({
        title: localizer.text('vscode.runtime.ticks'),
        value: '1',
      })
      if (value === undefined) return undefined
      return { action: 'step', sessionId, ticks: Number(value) }
    }
    if (action.description === 'continue') {
      const value = await vscode.window.showInputBox({
        title: localizer.text('vscode.runtime.maxTicks'),
        value: '100',
      })
      if (value === undefined) return undefined
      const tick = await vscode.window.showInputBox({
        title: localizer.text('vscode.runtime.breakpoint'),
        prompt: localizer.text('vscode.runtime.breakpointPrompt'),
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
        title: localizer.text('vscode.runtime.snapshotId'),
        value: `snapshot-${Date.now()}`,
      })
      return snapshotId === undefined ? undefined : { action: 'snapshot', sessionId, snapshotId }
    }
    if (action.description === 'restore') {
      const snapshotId = await vscode.window.showQuickPick(
        [...runtimeDebug.snapshotIds(sessionId)],
        {
          title: runtimeActionLabel('restore'),
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
      void vscode.window.showWarningMessage(
        `${localizer.text('vscode.runtime.control')}: ${result.message}`,
      )
    } else {
      void vscode.window.showInformationMessage(
        localizer.text('vscode.runtime.completed', {
          session: result.sessionId,
          action: runtimeActionLabel(result.action),
        }),
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
        `${title}: ${localizer.text('vscode.command.completedOutput', {
          subject: subjectLabel(request.subject),
        })}`,
      )
    } else if (result.state === 'unavailable') {
      // §4.2: the reason and the alternative, both, on a surface the person is already looking at.
      void vscode.window
        .showWarningMessage(
          `${title}: ${result.reason}`,
          localizer.text('vscode.command.whatInstead'),
        )
        .then(choice => {
          if (choice !== undefined) void vscode.window.showInformationMessage(result.alternative)
        })
    } else {
      void vscode.window.showErrorMessage(`${title}: ${result.message}`)
    }
    return result
  }

  // ---------------------------------------------------------------- commands
  const containerFrom = (argument: unknown): string | undefined => {
    if (argument instanceof vscode.Uri) {
      return argument.scheme === CONTAINER_SCHEME
        ? parseContainerUriText(argument.toString())?.container
        : argument.scheme === 'file'
          ? argument.fsPath
          : undefined
    }
    if (typeof argument === 'string') {
      return (
        parseContainerUriText(argument)?.container ?? (isAbsolute(argument) ? argument : undefined)
      )
    }
    if (typeof argument === 'object' && argument !== null) {
      const container = (argument as { readonly container?: unknown }).container
      if (typeof container === 'string' && isAbsolute(container)) return container
    }
    const active = activeSubject
    return active === undefined ? undefined : (parseContainerUriText(active)?.container ?? active)
  }

  const entryFrom = (argument: unknown): string | undefined => {
    if (argument instanceof vscode.Uri) return parseContainerUriText(argument.toString())?.entry
    if (typeof argument === 'string') return parseContainerUriText(argument)?.entry
    if (typeof argument === 'object' && argument !== null) {
      const entry = (argument as { readonly entry?: unknown }).entry
      if (typeof entry === 'string' && entry.length > 0) return entry
    }
    return activeSubject === undefined ? undefined : parseContainerUriText(activeSubject)?.entry
  }

  const pickContainerMember = async (
    container: string,
    title: string,
  ): Promise<string | undefined> => {
    const index = await containers.index(container)
    return vscode.window.showQuickPick([...index.files.keys()].sort(), { title })
  }

  const publishRootChange = (container: string): void => {
    containerChanges.fire([
      {
        type: vscode.FileChangeType.Changed,
        uri: vscode.Uri.from({ scheme: CONTAINER_SCHEME, path: containerUriPath(container) }),
      },
    ])
  }

  const publishSelectedSources = async (next: readonly SelectedContentSource[]): Promise<void> => {
    selectedSources = next
    await context.workspaceState.update(SELECTED_SOURCES_KEY, next)
    hostView.refresh()
    for (const served of live) {
      served.publishRoots()
      served.notice(localizer.text('vscode.shell.selectedSourcesChanged'))
    }
  }

  const inside = (root: string, candidate: string): boolean => {
    const child = relative(resolve(root), resolve(candidate))
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  }

  const managerEntryId = (argument: unknown): string | undefined => {
    if (typeof argument === 'string' && argument.length > 0) return argument
    if (typeof argument !== 'object' || argument === null) return undefined
    if ('entry' in argument) {
      const entry = (argument as { readonly entry?: { readonly id?: unknown } }).entry
      if (typeof entry?.id === 'string') return entry.id
    }
    const id = (argument as { readonly id?: unknown }).id
    return typeof id === 'string' && id.length > 0 ? id : undefined
  }

  const contributionEntryId = (argument: unknown): string | undefined => {
    if (typeof argument === 'string' && argument.length > 0) return argument
    if (typeof argument !== 'object' || argument === null) return undefined
    if ('contribution' in argument) {
      const contribution = (argument as { readonly contribution?: { readonly id?: unknown } })
        .contribution
      if (typeof contribution?.id === 'string') return contribution.id
    }
    const id = (argument as { readonly id?: unknown }).id
    return typeof id === 'string' && id.length > 0 ? id : undefined
  }

  const pickCodecContribution = async (enabled: boolean): Promise<string | undefined> => {
    const disabled = new Set(
      configuredDisabledContributions(configuration.readDisabledContributions()).ids,
    )
    const choices = host.contributions
      .flatMap(contribution => {
        const id = contribution.id
        return id === undefined ||
          contribution.contract !== 'modkit/codec-contribution' ||
          disabled.has(id) !== enabled
          ? []
          : [{ label: contribution.displayName, description: id, id }]
      })
      .sort((left, right) => left.label.localeCompare(right.label))
    const picked = await vscode.window.showQuickPick(choices, {
      title: `${localizer.text(
        enabled ? 'extensions.action.enableContribution' : 'extensions.action.disableContribution',
      )}…`,
    })
    return picked?.id
  }

  const setCodecContributionEnabled = async (
    argument: unknown,
    enabled: boolean,
  ): Promise<void> => {
    const id = contributionEntryId(argument) ?? (await pickCodecContribution(enabled))
    if (id === undefined) return
    const { next, changed } = withContributionDisabled(
      configuration.readDisabledContributions(),
      id,
      !enabled,
    )
    if (!changed) {
      void vscode.window.showInformationMessage(
        `${id}: ${localizer.text(enabled ? 'common.enabled' : 'common.disabled')}`,
      )
      return
    }
    await configuration.write('disabledContributions', next)
  }

  const setExtensionCodecContributionsEnabled = async (
    argument: unknown,
    enabled: boolean,
  ): Promise<void> => {
    const extensionId = managerEntryId(argument)
    if (extensionId === undefined) return
    const ids = host.contributions.flatMap(contribution =>
      contribution.extension === extensionId &&
      contribution.contract === 'modkit/codec-contribution' &&
      contribution.id !== undefined
        ? [contribution.id]
        : [],
    )
    if (ids.length === 0) {
      void vscode.window.showInformationMessage(
        `Modkit: ${extensionId} — ${localizer.text('common.none')}`,
      )
      return
    }
    const { next, changed } = withContributionsDisabled(
      configuration.readDisabledContributions(),
      ids,
      !enabled,
    )
    if (!changed) {
      void vscode.window.showInformationMessage(
        `${extensionId}: ${localizer.text(enabled ? 'common.enabled' : 'common.disabled')}`,
      )
      return
    }
    await configuration.write('disabledContributions', next)
  }

  const openExtensionCard = async (argument: unknown): Promise<void> => {
    if (typeof argument !== 'object' || argument === null) return
    const value = argument as {
      readonly kind?: unknown
      readonly id?: unknown
      readonly extension?: unknown
    }
    const extensionId =
      value.kind === 'contribution' && typeof value.extension === 'string'
        ? value.extension
        : typeof value.id === 'string'
          ? value.id
          : undefined
    if (extensionId === undefined) return
    const entry = extensionCards().get(extensionId)
    if (entry === undefined) {
      void vscode.window.showWarningMessage(
        localizer.text('vscode.extensions.noCardData', { id: extensionId }),
      )
      return
    }
    const contributionId =
      value.kind === 'contribution' && typeof value.id === 'string' ? value.id : undefined
    const bundle = await extensionCardBundle(entry, contributionId)
    const iconPath = extensionCardIconTarget(entry)
    const active = bundle.documents.find(
      document => document.subject.subjectId === bundle.activeSubjectId,
    )
    const panel = vscode.window.createWebviewPanel(
      'modkit.extensionSubjectCard',
      active?.subject.displayName ?? extensionId,
      vscode.ViewColumn.Active,
      {
        ...webviewOptions(iconPath === undefined ? [] : [vscode.Uri.file(dirname(iconPath))]),
        retainContextWhenHidden: true,
      },
    )
    const served = attach(
      panel.webview,
      undefined,
      undefined,
      bundle,
      extensionCardResourceTargets(entry),
      iconPath,
    )
    panel.onDidDispose(() => {
      live.delete(served)
      liveSubjects.delete(served)
      void served.close('the extension subject card was closed')
    })
  }

  const openRepositorySubjectCard = async (
    kind: 'vendor' | 'game',
    argument: unknown,
  ): Promise<void> => {
    if (argument === null || typeof argument !== 'object') return
    const value = argument as { readonly id?: unknown }
    if (typeof value.id !== 'string') return
    const subject =
      kind === 'vendor' ? repositorySubjects.vendor(value.id) : repositorySubjects.game(value.id)
    if (subject === undefined) {
      void vscode.window.showWarningMessage(
        localizer.text('vscode.extensions.noCardData', { id: value.id }),
      )
      return
    }
    const records = [
      ...repositorySubjects.records,
      ...[...extensionCards().values()].flatMap(entry => entry.projection.records),
    ]
    const bySubjectId = new Map(records.map(record => [record.subjectId, record]))
    const documents = await Promise.all(
      [...bySubjectId.values()].map(record => subjectRecordToWire(record)),
    )
    const managerSnapshot = await extensionManager.snapshot()
    const removableInstalled = managerSnapshot.entries.filter(
      entry => entry.installedVersion !== undefined && extensionEntrySupportsGroupedRemoval(entry),
    )
    const actions: ('install' | 'remove')[] = []
    if (kind === 'vendor') {
      if (removableInstalled.some(entry => entry.presentation?.vendor?.id === subject.id)) {
        actions.push('remove')
      }
    } else {
      try {
        const plan = await extensionManager.planGameSupport(subject.id)
        const locallyInstallable = plan.targets.some(
          target =>
            target.installedVersion === undefined && linkableExtensionRoots.has(target.packageId),
        )
        const localIds = new Set(
          plan.targets
            .filter(
              target =>
                target.installedVersion === undefined &&
                linkableExtensionRoots.has(target.packageId),
            )
            .map(target => target.packageId),
        )
        const managerReady =
          plan.actions.some(action => !localIds.has(action.packageId)) &&
          plan.blocked.every(blocked => localIds.has(blocked.packageId))
        if (locallyInstallable || managerReady) actions.push('install')
      } catch (error) {
        log(
          `[repository-subject] no install plan for ${subject.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      if (
        removableInstalled.some(entry =>
          entry.presentation?.games?.some(game => game.id === subject.id),
        )
      ) {
        actions.push('remove')
      }
    }
    const bundle: ExtensionCardBundle = Object.freeze({
      activeSubjectId: subject.subjectId,
      documents: Object.freeze(documents),
      repositorySubject: Object.freeze({
        kind,
        id: subject.id,
        label: subject.displayName,
        actions: Object.freeze(actions),
      }),
      // The existing neutral card renderer accepts any subject wire. These inert values suppress
      // extension controls; vendor/game cards are information and safe links, not extensions.
      extension: Object.freeze({
        id: subject.id,
        installed: true,
        enabled: true,
        linkable: false,
        subjectId: subject.subjectId,
        resources: Object.freeze([]),
        codecs: Object.freeze({ ids: Object.freeze([]), enabled: false }),
      }),
    })
    const active = bundle.documents.find(
      document => document.subject.subjectId === bundle.activeSubjectId,
    )
    const panel = vscode.window.createWebviewPanel(
      'modkit.repositorySubjectCard',
      active?.subject.displayName ?? subject.displayName,
      vscode.ViewColumn.Active,
      { ...webviewOptions(), retainContextWhenHidden: true },
    )
    const served = attach(panel.webview, undefined, undefined, bundle)
    panel.onDidDispose(() => {
      live.delete(served)
      liveSubjects.delete(served)
      void served.close('the repository subject card was closed')
    })
  }

  const pickManagerEntry = async (
    title: string,
    accept: (entry: ExtensionManagerEntry) => boolean,
  ): Promise<string | undefined> => {
    const entries = (await extensionManager.snapshot()).entries.filter(accept)
    if (entries.length === 0) {
      void vscode.window.showInformationMessage(
        `Modkit: ${title} — ${localizer.text('common.none')}`,
      )
      return undefined
    }
    return vscode.window
      .showQuickPick(
        entries.map(entry => ({
          label: entry.displayName,
          description: entry.id,
          detail:
            entry.installedVersion === undefined
              ? `${localizer.text('extensions.group.available')} ${entry.availableVersion}`
              : entry.updateAvailable
                ? `${entry.installedVersion} → ${entry.availableVersion}`
                : entry.installedVersion,
          id: entry.id,
        })),
        { title },
      )
      .then(item => item?.id)
  }

  const runManagerCommand = async (
    command: ExtensionManagerCommand,
    success: string,
  ): Promise<void> => {
    try {
      await extensionManager.execute(command)
      log(`[extensions] ${success}`)
      const completion = extensionManagerCommandCompletion(command, success)
      const message =
        command.kind === 'set-enabled'
          ? localizer.text('extensions.status.reloadRequired', {
              id: command.id,
              state: localizer.text(command.enabled ? 'common.enabled' : 'common.disabled'),
            })
          : completion.reload
            ? `${success}. ${localizer.text('extensions.state.afterReload')}.`
            : success
      if (completion.reload) askToReload(message)
      else void vscode.window.showInformationMessage(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`[extensions] command failed: ${message}`)
      void vscode.window.showErrorMessage(`Modkit: ${message}`)
    }
  }

  const installAllAvailable = async (): Promise<void> => {
    const available = (await extensionManager.snapshot()).entries.filter(
      entry => entry.installedVersion === undefined,
    )
    const managed = available.filter(entry => !entry.source.startsWith('local:'))
    const local = available.flatMap(entry => {
      const root = linkableExtensionRoots.get(entry.id)
      return root === undefined ? [] : [{ id: entry.id, root }]
    })
    const total = managed.length + local.length
    if (total === 0) {
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('extensions.action.installAll')} — ${localizer.text('common.none')}`,
      )
      return
    }

    const install = localizer.text('common.install')
    const confirmed = await vscode.window.showWarningMessage(
      localizer.text('vscode.extensions.installAllConfirm', { count: total }),
      { modal: true },
      install,
    )
    if (confirmed !== install) return

    let completed = 0
    try {
      if (managed.length > 0) {
        await extensionManager.executeBatch(
          managed.map(entry => ({ kind: 'install' as const, id: entry.id })),
        )
        completed += managed.length
      }
      const rawConfigured = configuration.readExtensions()
      let configured: readonly unknown[] = Array.isArray(rawConfigured) ? rawConfigured : []
      let linked = false
      for (const entry of local) {
        const result = withExtensionRoot(configured, resolve(entry.root), {
          caseSensitive: process.platform !== 'win32' && process.platform !== 'darwin',
        })
        configured = result.next
        linked ||= result.added
        if (result.added) completed += 1
      }
      if (linked) {
        await writeConfiguration('extensions', configured, false)
      }
      if (completed === 0) {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('extensions.action.installAll')} — ${localizer.text('common.none')}`,
        )
        return
      }
      const message = localizer.text('vscode.extensions.installedAll', { count: completed })
      log(`[extensions] ${message}`)
      askToReload(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`[extensions] install-all failed: ${message}`)
      if (completed > 0) {
        askToReload(localizer.text('vscode.extensions.installAllPartial', { message }))
      } else {
        void vscode.window.showErrorMessage(`Modkit: ${message}`)
      }
    }
  }

  const installGameSupport = async (argument: unknown): Promise<void> => {
    const component = argument as Partial<ExtensionComponentNode> | undefined
    if (component?.kind !== 'component' || component.component !== 'game' || !component.id) return
    const componentLabel = component.label ?? component.id
    try {
      const plan = await extensionManager.planGameSupport(component.id)
      if (plan.targets.length === 0) {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('vscode.extensions.gameSupportUnavailable', {
            game: componentLabel,
          })}`,
        )
        return
      }
      const localTargets = plan.targets.filter(
        target =>
          target.installedVersion === undefined && linkableExtensionRoots.has(target.packageId),
      )
      const localIds = new Set(localTargets.map(target => target.packageId))
      const remainingBlocked = plan.blocked.filter(item => !localIds.has(item.packageId))
      if (remainingBlocked.length > 0) {
        const reasons = remainingBlocked.map(item => item.message).join('\n')
        void vscode.window.showErrorMessage(
          `Modkit: ${localizer.text('vscode.extensions.gameSupportBlocked', {
            game: componentLabel,
            reasons,
          })}`,
        )
        return
      }
      const managerActions = plan.actions.filter(action => !localIds.has(action.packageId))
      if (managerActions.length === 0 && localTargets.length === 0) {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('vscode.extensions.gameSupportReady', {
            game: componentLabel,
          })}`,
        )
        return
      }
      const details = [
        ...localTargets.map(target => `+ ${target.displayName}`),
        ...managerActions.map(action => {
          const target = plan.targets.find(item => item.packageId === action.packageId)
          return `${action.kind === 'install' ? '+' : action.kind === 'enable' ? '✓' : '↻'} ${
            target?.displayName ?? action.packageId
          }`
        }),
      ].join('\n')
      const install = localizer.text('common.install')
      const confirmed = await vscode.window.showWarningMessage(
        `${localizer.text('vscode.extensions.gameSupportConfirm', {
          game: plan.game.displayName,
          count: managerActions.length + localTargets.length,
        })}\n\n${details}`,
        { modal: true },
        install,
      )
      if (confirmed !== install) return
      if (localTargets.length === 0) {
        const result = await extensionManager.applyGameSupport(plan)
        if (result.status === 'applied') {
          const message = localizer.text('vscode.extensions.gameSupportInstalled', {
            game: plan.game.displayName,
          })
          log(`[extensions] ${message}`)
          askToReload(message)
          return
        }
        const message = localizer.text(
          result.status === 'rolled-back'
            ? 'vscode.extensions.gameSupportRolledBack'
            : 'vscode.extensions.gameSupportPartial',
          { game: plan.game.displayName },
        )
        log(`[extensions] ${message}`)
        void vscode.window.showWarningMessage(`Modkit: ${message}`)
        return
      }
      let completed = 0
      if (managerActions.length > 0) {
        await extensionManager.executeBatch(
          managerActions.map(action => {
            if (action.kind === 'install') {
              return { kind: 'install' as const, id: action.packageId, version: action.version }
            }
            if (action.kind === 'enable') {
              return { kind: 'set-enabled' as const, id: action.packageId, enabled: true }
            }
            return { kind: 'update' as const, id: action.packageId }
          }),
        )
        completed += managerActions.length
      }
      if (localTargets.length > 0) {
        const rawConfigured = configuration.readExtensions()
        let configured: readonly unknown[] = Array.isArray(rawConfigured) ? rawConfigured : []
        let linked = false
        for (const target of localTargets) {
          const root = linkableExtensionRoots.get(target.packageId)
          if (root === undefined) continue
          const result = withExtensionRoot(configured, resolve(root), {
            caseSensitive: process.platform !== 'win32' && process.platform !== 'darwin',
          })
          configured = result.next
          linked ||= result.added
          if (result.added) completed += 1
        }
        if (linked) await writeConfiguration('extensions', configured, false)
      }
      if (completed > 0 || localTargets.length > 0) {
        const message = localizer.text('vscode.extensions.gameSupportInstalled', {
          game: plan.game.displayName,
        })
        log(`[extensions] ${message}`)
        askToReload(message)
        return
      }
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('vscode.extensions.gameSupportReady', {
          game: componentLabel,
        })}`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`[extensions] game-support failed: ${message}`)
      void vscode.window.showErrorMessage(`Modkit: ${message}`)
    }
  }

  const removeGameSupport = async (argument: unknown): Promise<void> => {
    const component = argument as Partial<ExtensionComponentNode> | undefined
    if (component?.kind !== 'component' || component.component !== 'game' || !component.id) return
    const gameId = component.id
    const gameLabel = component.label ?? gameId
    const snapshot = await extensionManager.snapshot()
    const candidates = snapshot.entries.filter(entry => {
      const games = entry.presentation?.games ?? []
      return (
        entry.installedVersion !== undefined &&
        games.some(game => game.id === gameId) &&
        extensionEntryIsMutable(entry)
      )
    })
    const configured = localConfiguredEntries().filter(({ candidate }) =>
      candidate.presentation?.games?.some(game => game.id === gameId),
    )
    if (candidates.length === 0 && configured.length === 0) {
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('vscode.extensions.gameSupportReady', { game: gameLabel })}`,
      )
      return
    }
    const remove = localizer.text('common.remove')
    const details = [
      ...candidates.map(entry => `− ${extensionEntryDisplayName(entry)}`),
      ...configured.map(({ candidate }) => `− ${candidate.displayName}`),
    ].join('\n')
    const confirmed = await vscode.window.showWarningMessage(
      `${localizer.text('vscode.extensions.removeGameSupportConfirm', {
        game: gameLabel,
        count: candidates.length + configured.length,
      })}\n\n${details}`,
      { modal: true },
      remove,
    )
    if (confirmed !== remove) return
    try {
      await extensionManager.executeBatch(
        candidates.map(entry => ({ kind: 'remove' as const, id: entry.id })),
      )
      await removeConfiguredEntries(new Set(configured.map(entry => entry.index)))
      const message = localizer.text('vscode.extensions.gameSupportRemoved', { game: gameLabel })
      log(`[extensions] ${message}`)
      askToReload(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`[extensions] game-support removal failed: ${message}`)
      void vscode.window.showErrorMessage(`Modkit: ${message}`)
    }
  }

  const removeVendorSupport = async (argument: unknown): Promise<void> => {
    const vendor = argument as Partial<ExtensionVendorNode> | undefined
    if (vendor?.kind !== 'vendor' || !vendor.id) return
    const vendorLabel = vendor.label ?? vendor.id
    const snapshot = await extensionManager.snapshot()
    const candidates = snapshot.entries.filter(
      entry =>
        entry.installedVersion !== undefined &&
        entry.presentation?.vendor?.id === vendor.id &&
        extensionEntryIsMutable(entry),
    )
    const configured = localConfiguredEntries().filter(
      ({ candidate }) => candidate.presentation?.vendor?.id === vendor.id,
    )
    if (candidates.length === 0 && configured.length === 0) {
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('common.none')} — ${vendorLabel}`,
      )
      return
    }
    const remove = localizer.text('common.remove')
    const details = [
      ...candidates.map(entry => `− ${extensionEntryDisplayName(entry)}`),
      ...configured.map(({ candidate }) => `− ${candidate.displayName}`),
    ].join('\n')
    const confirmed = await vscode.window.showWarningMessage(
      `${localizer.text('vscode.extensions.removeVendorSupportConfirm', {
        vendor: vendorLabel,
        count: candidates.length + configured.length,
      })}\n\n${details}`,
      { modal: true },
      remove,
    )
    if (confirmed !== remove) return
    try {
      await extensionManager.executeBatch(
        candidates.map(entry => ({ kind: 'remove' as const, id: entry.id })),
      )
      await removeConfiguredEntries(new Set(configured.map(entry => entry.index)))
      const message = localizer.text('vscode.extensions.vendorSupportRemoved', {
        vendor: vendorLabel,
      })
      log(`[extensions] ${message}`)
      askToReload(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log(`[extensions] vendor removal failed: ${message}`)
      void vscode.window.showErrorMessage(`Modkit: ${message}`)
    }
  }

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

    vscode.commands.registerCommand('modkit.extensions.refresh', () =>
      runManagerCommand({ kind: 'refresh' }, localizer.text('vscode.extensions.catalogRefreshed')),
    ),

    vscode.commands.registerCommand(OPEN_EXTENSION_COMMAND, (argument: unknown) => {
      void openExtensionCard(argument).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        log(`[extensions] card failed: ${message}`)
        void vscode.window.showErrorMessage(`Modkit: ${message}`)
      })
    }),

    vscode.commands.registerCommand(OPEN_CONTRIBUTION_COMMAND, (argument: unknown) => {
      void openExtensionCard(argument).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        log(`[extensions] contribution card failed: ${message}`)
        void vscode.window.showErrorMessage(`Modkit: ${message}`)
      })
    }),

    vscode.commands.registerCommand(OPEN_VENDOR_COMMAND, (argument: unknown) => {
      void openRepositorySubjectCard('vendor', argument).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        log(`[repository-subject] vendor card failed: ${message}`)
        void vscode.window.showErrorMessage(`Modkit: ${message}`)
      })
    }),

    vscode.commands.registerCommand(OPEN_GAME_COMMAND, (argument: unknown) => {
      void openRepositorySubjectCard('game', argument).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        log(`[repository-subject] game card failed: ${message}`)
        void vscode.window.showErrorMessage(`Modkit: ${message}`)
      })
    }),

    vscode.commands.registerCommand('modkit.extensions.install', async (argument: unknown) => {
      const id =
        managerEntryId(argument) ??
        (await pickManagerEntry(
          localizer.text('vscode.extensions.installTitle'),
          entry => entry.installedVersion === undefined && !entry.source.startsWith('local:'),
        ))
      if (id !== undefined) {
        await runManagerCommand(
          { kind: 'install', id },
          localizer.text('vscode.extensions.installed', { id }),
        )
      }
    }),

    vscode.commands.registerCommand('modkit.extensions.installAll', () => installAllAvailable()),

    vscode.commands.registerCommand('modkit.extensions.installGameSupport', installGameSupport),

    vscode.commands.registerCommand('modkit.extensions.completeGameSupport', installGameSupport),

    vscode.commands.registerCommand('modkit.extensions.removeGameSupport', removeGameSupport),

    vscode.commands.registerCommand('modkit.extensions.removeVendorSupport', removeVendorSupport),

    vscode.commands.registerCommand('modkit.extensions.update', async (argument: unknown) => {
      const id =
        managerEntryId(argument) ??
        (await pickManagerEntry(
          localizer.text('vscode.extensions.updateTitle'),
          entry => entry.updateAvailable,
        ))
      if (id !== undefined) {
        await runManagerCommand(
          { kind: 'update', id },
          localizer.text('vscode.extensions.updated', { id }),
        )
      }
    }),

    vscode.commands.registerCommand('modkit.extensions.remove', async (argument: unknown) => {
      const id =
        managerEntryId(argument) ??
        (await pickManagerEntry(
          localizer.text('vscode.extensions.removeTitle'),
          entry =>
            entry.installedVersion !== undefined &&
            entry.source !== 'bundled' &&
            entry.source !== 'workspace',
        ))
      if (id === undefined) return
      const remove = localizer.text('common.remove')
      const confirmed = await vscode.window.showWarningMessage(
        localizer.text('vscode.extensions.removeConfirm', { id }),
        { modal: true },
        remove,
      )
      if (confirmed === remove) {
        await runManagerCommand(
          { kind: 'remove', id },
          localizer.text('vscode.extensions.removed', { id }),
        )
      }
    }),

    vscode.commands.registerCommand('modkit.extensions.enableContribution', (argument: unknown) =>
      setCodecContributionEnabled(argument, true),
    ),

    vscode.commands.registerCommand('modkit.extensions.disableContribution', (argument: unknown) =>
      setCodecContributionEnabled(argument, false),
    ),

    vscode.commands.registerCommand('modkit.extensions.enableAllCodecs', (argument: unknown) =>
      setExtensionCodecContributionsEnabled(argument, true),
    ),

    vscode.commands.registerCommand('modkit.extensions.disableAllCodecs', (argument: unknown) =>
      setExtensionCodecContributionsEnabled(argument, false),
    ),

    vscode.commands.registerCommand('modkit.extensions.enable', async (argument: unknown) => {
      const id =
        managerEntryId(argument) ??
        (await pickManagerEntry(
          `${localizer.text('extensions.action.enableExtension')}…`,
          entry =>
            entry.installedVersion !== undefined &&
            !entry.enabled &&
            entry.source !== 'bundled' &&
            entry.source !== 'workspace',
        ))
      if (id !== undefined) {
        await runManagerCommand(
          { kind: 'set-enabled', id, enabled: true },
          `${id}: ${localizer.text('common.enabled')}`,
        )
      }
    }),

    vscode.commands.registerCommand('modkit.extensions.disable', async (argument: unknown) => {
      const id =
        managerEntryId(argument) ??
        (await pickManagerEntry(
          `${localizer.text('extensions.action.disableExtension')}…`,
          entry => entry.enabled && entry.source !== 'bundled' && entry.source !== 'workspace',
        ))
      if (id !== undefined) {
        await runManagerCommand(
          { kind: 'set-enabled', id, enabled: false },
          `${id}: ${localizer.text('common.disabled')}`,
        )
      }
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
          openLabel: localizer.text('action.openFile'),
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
            `Modkit: ${localizer.text('vscode.command.openFileFirst')}`,
          )
          return undefined
        }
        const picked = await vscode.window.showQuickPick(
          commandRuntime.descriptors.map(item => ({
            label: item.title,
            description: item.id,
            detail: item.summary,
          })),
          {
            title: localizer.text('vscode.command.runOn', { subject: subjectLabel(subject) }),
            placeHolder: localizer.text('vscode.command.pick'),
          },
        )
        if (picked === undefined) return undefined
        /*
         * `subject.extract` is the one of the six that needs a second word, and asking for it is
         * better than running it with an empty entry and reporting a refusal the user caused.
         */
        let entry: string | undefined
        if (picked.description === 'subject.extract') {
          entry = await vscode.window.showInputBox({
            title: localizer.text('vscode.command.memberToExtract'),
            prompt: localizer.text('vscode.command.memberPath'),
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

    /** Search any standard container listing without restoring a game-specific archive tree. */
    vscode.commands.registerCommand('modkit.searchContainer', (argument: unknown) =>
      (async () => {
        const container = containerFrom(argument)
        if (container === undefined) {
          void vscode.window.showInformationMessage(
            `Modkit: ${localizer.text('vscode.container.openBeforeSearch')}`,
          )
          return undefined
        }
        const supplied =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly query?: unknown }).query
            : undefined
        const query =
          typeof supplied === 'string'
            ? supplied
            : await vscode.window.showInputBox({
                title: localizer.text('vscode.container.search', {
                  container: basename(container),
                }),
              })
        if (query === undefined || query.trim().length === 0) return undefined
        const hits = await containers.search(container, query)
        const picked = await vscode.window.showQuickPick(
          hits.map(hit => ({
            label: hit.path,
            ...(hit.node.size === undefined
              ? {}
              : {
                  description: localizer.text('vscode.container.bytes', {
                    count: String(hit.node.size),
                  }),
                }),
          })),
          {
            title: localizer.text('vscode.container.matches', {
              container: basename(container),
            }),
          },
        )
        if (picked === undefined) return undefined
        const uri = vscode.Uri.from({
          scheme: CONTAINER_SCHEME,
          path: containerUriPath(container, picked.label),
        })
        openResource(uri)
        return uri
      })(),
    ),

    /** Reopen one held container and tell the native Explorer its root changed. */
    vscode.commands.registerCommand('modkit.refreshContainer', (argument: unknown) =>
      (async () => {
        const container = containerFrom(argument)
        if (container === undefined) {
          void vscode.window.showInformationMessage(
            `Modkit: ${localizer.text('vscode.container.openBeforeRefresh')}`,
          )
          return false
        }
        await containers.refresh(container)
        publishRootChange(container)
        log(`container refreshed: ${basename(container)}`)
        return true
      })(),
    ),

    /** Extract one member to a user-selected file, enforcing the same 64 MiB in-memory ceiling. */
    vscode.commands.registerCommand('modkit.materializeContainerEntry', (argument: unknown) =>
      (async () => {
        const container = containerFrom(argument)
        if (container === undefined) {
          void vscode.window.showInformationMessage(
            `Modkit: ${localizer.text('vscode.container.openBeforeMaterialize')}`,
          )
          return undefined
        }
        const entry =
          entryFrom(argument) ??
          (await pickContainerMember(
            container,
            localizer.text('vscode.container.pickMaterialize', {
              container: basename(container),
            }),
          ))
        if (entry === undefined || entry.length === 0) return undefined
        const node = await containers.stat(container, entry)
        assertMaterializationBound(entry, node)
        const requestedTarget =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly target?: unknown }).target
            : undefined
        const target =
          requestedTarget instanceof vscode.Uri
            ? requestedTarget
            : typeof requestedTarget === 'string' && isAbsolute(requestedTarget)
              ? vscode.Uri.file(requestedTarget)
              : await vscode.window.showSaveDialog({
                  title: localizer.text('vscode.container.materialize', { entry }),
                  defaultUri: vscode.Uri.file(join(dirname(container), basename(entry))),
                })
        if (target === undefined) return undefined
        const bytes = await containers.read(container, entry)
        assertMaterializationBound(entry, node, bytes.byteLength)
        await vscode.workspace.fs.writeFile(target, bytes)
        log(`materialized ${basename(container)} › ${entry} (${String(bytes.byteLength)} bytes)`)
        return target
      })(),
    ),

    /** Select a verified installation through whatever standard providers the inventory offers. */
    vscode.commands.registerCommand('modkit.selectGameInstallation', () =>
      (async () => {
        const gameIds = installationGameIds(host.services.host.inventory)
        const candidates: SelectedContentSource[] = []
        for (const gameId of gameIds) {
          const discovery = await discoverGameInstallations({
            services: host.services,
            gameId,
            maxCandidates: 32,
            grant: {
              id: 'vscode-game-installation-discovery',
              classes:
                process.platform === 'win32'
                  ? ['filesystem-read', 'process-launch']
                  : ['filesystem-read'],
            },
            budgets: GAME_DISCOVERY_BUDGET,
          })
          for (const item of discovery.diagnostics) {
            log(`[installation] ${item.severity} ${item.code}: ${item.message}`)
          }
          if (discovery.state !== 'discovered') continue
          for (const installation of discovery.result.installations) {
            candidates.push({
              gameId: installation.gameId,
              displayName: installation.displayName,
              installPath: installation.installPath,
              normalizedPath: installation.normalizedPath,
            })
          }
        }
        if (candidates.length === 0) {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.game.noVerifiedInstallation')}`,
          )
          return undefined
        }
        const picked = await vscode.window.showQuickPick(
          candidates.map(source => ({
            label: source.displayName,
            description: source.gameId,
            detail: source.installPath,
            source,
          })),
          { title: localizer.text('vscode.game.selectInstallation') },
        )
        if (picked === undefined) return undefined
        granted.add(resolve(picked.source.installPath))
        await publishSelectedSources(withSelectedContentSource(selectedSources, picked.source))
        log(`selected content source: ${picked.source.displayName} (${picked.source.installPath})`)
        return picked.source
      })(),
    ),

    /** Remove one selected source and release every cached container held beneath it. */
    vscode.commands.registerCommand('modkit.unloadSource', (argument: unknown) =>
      (async () => {
        const requested =
          typeof argument === 'string'
            ? argument
            : typeof argument === 'object' && argument !== null
              ? (argument as { readonly normalizedPath?: unknown }).normalizedPath
              : undefined
        const selected =
          typeof requested === 'string'
            ? selectedSources.find(source => source.normalizedPath === requested)
            : await vscode.window
                .showQuickPick(
                  selectedSources.map(source => ({
                    label: source.displayName,
                    description: source.gameId,
                    detail: source.installPath,
                    source,
                  })),
                  { title: localizer.text('vscode.game.unloadSource') },
                )
                .then(item => item?.source)
        if (selected === undefined) return false
        granted.delete(resolve(selected.installPath))
        for (const container of containers.held()) {
          if (inside(selected.installPath, container)) await containers.release(container)
        }
        await publishSelectedSources(
          withoutSelectedContentSource(selectedSources, selected.normalizedPath),
        )
        log(`unloaded content source: ${selected.displayName}`)
        return true
      })(),
    ),

    /** Launch one active local map through a selected game provider, after modal confirmation. */
    vscode.commands.registerCommand(VSCODE_GAME_LAUNCH_COMMAND, (argument: unknown) =>
      (async () => {
        const requestedPath =
          argument instanceof vscode.Uri
            ? argument.scheme === 'file'
              ? argument.fsPath
              : undefined
            : typeof argument === 'string' && isAbsolute(argument)
              ? argument
              : activeSubject
        if (requestedPath === undefined || !isAbsolute(requestedPath)) {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.game.openMapFirst')}`,
          )
          return undefined
        }
        if (selectedSources.length === 0) {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.game.selectInstallationFirst')}`,
          )
          return undefined
        }
        const source =
          selectedSources.length === 1
            ? selectedSources[0]
            : await vscode.window
                .showQuickPick(
                  selectedSources.map(item => ({
                    label: item.displayName,
                    description: item.gameId,
                    detail: item.installPath,
                    source: item,
                  })),
                  { title: localizer.text('vscode.game.chooseInstallation') },
                )
                .then(item => item?.source)
        if (source === undefined) {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.game.selectInstallationFirst')}`,
          )
          return undefined
        }

        // Persisted workspace state is never enough to launch a process: probe the selected root
        // again and pass only the provider-confirmed installation to the host executor.
        const discovery = await discoverGameInstallations({
          services: host.services,
          gameId: source.gameId,
          configuredPaths: [source.installPath],
          maxCandidates: 32,
          grant: {
            id: `vscode-game-launch-discovery-${nonce()}`,
            classes:
              process.platform === 'win32'
                ? ['filesystem-read', 'process-launch']
                : ['filesystem-read'],
          },
          budgets: GAME_DISCOVERY_BUDGET,
        })
        for (const item of discovery.diagnostics) {
          log(`[game-launch] ${item.severity} ${item.code}: ${item.message}`)
        }
        const installation =
          discovery.state === 'discovered'
            ? discovery.result.installations.find(
                item => item.normalizedPath === source.normalizedPath,
              )
            : undefined
        if (installation === undefined) {
          void vscode.window.showErrorMessage(
            `Modkit: ${localizer.text('vscode.game.installationStale')}`,
          )
          return undefined
        }

        const workflow = await runExplicitGameLaunch(
          {
            grantId: `vscode-native-game-launch-${nonce()}`,
            installation,
            resourcePath: requestedPath,
          },
          {
            localizer,
            confirm: async request =>
              (await vscode.window.showWarningMessage(
                request.title,
                { modal: true, detail: request.detail },
                request.action,
              )) === request.action,
            execute: request =>
              launchNodeGameResource({
                services: host.services,
                ...request,
                budgets: GAME_DISCOVERY_BUDGET,
              }),
          },
        )
        if (workflow.state === 'cancelled') {
          log(`native game launch cancelled for ${basename(requestedPath)}`)
          return workflow
        }
        const launched = workflow.result
        for (const item of launched.diagnostics) {
          log(`[game-launch] ${item.severity} ${item.code}: ${item.message}`)
        }
        if (launched.state !== 'launched') {
          void vscode.window.showErrorMessage(
            `Modkit: ${localizer.text('vscode.game.launchFailed', { state: launched.state })}`,
          )
          return launched
        }
        try {
          void vscode.window.showInformationMessage(
            `Modkit: ${localizer.text('vscode.game.launched', {
              game: installation.displayName,
              map: basename(requestedPath),
            })}`,
          )
          return launched.receipt
        } finally {
          await launched.release()
        }
      })(),
    ),

    /** Re-run the active subject route; relation/tree stages refresh from the new descriptor. */
    vscode.commands.registerCommand('modkit.refreshRelations', () => {
      if (activeSubject === undefined) return false
      let refreshed = false
      for (const [served, path] of liveSubjects) {
        if (path !== activeSubject) continue
        served.open(activeSubject)
        served.notice(localizer.text('vscode.shell.activeSubjectRefreshed'))
        refreshed = true
      }
      return refreshed
    }),

    /** Open the current or supplied resource through the generic workbench. */
    vscode.commands.registerCommand('modkit.navigateResource', (argument: unknown) => {
      const uri =
        argument instanceof vscode.Uri
          ? argument
          : typeof argument === 'string'
            ? subjectUriOf(argument)
            : activeSubject === undefined
              ? undefined
              : subjectUriOf(activeSubject)
      if (uri === undefined) return false
      openResource(uri)
      return true
    }),

    /** Present a journal snapshot as a normal editor document instead of an opaque channel. */
    vscode.commands.registerCommand('modkit.showDiagnostics', () =>
      vscode.workspace
        .openTextDocument({ language: 'log', content: journal.text() })
        .then(document => vscode.window.showTextDocument(document, { preview: true })),
    ),

    /** Export exactly the same bounded journal the readable diagnostics document shows. */
    vscode.commands.registerCommand('modkit.exportDiagnostics', (argument: unknown) =>
      (async () => {
        const target =
          argument instanceof vscode.Uri
            ? argument
            : await vscode.window.showSaveDialog({
                title: localizer.text('vscode.shell.exportDiagnostics'),
                defaultUri: vscode.Uri.file(
                  join(workspaceFolders()[0] ?? extensionRoot, 'modkit.log'),
                ),
              })
        if (target === undefined) return undefined
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(journal.text()))
        return target
      })(),
    ),

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
                  openLabel: localizer.text('vscode.container.browse'),
                })
              )?.[0])
        if (uri === undefined) return
        const target = describeOpenTarget(uri)
        if (target.state === 'refused' || target.kind !== 'file') {
          void vscode.window.showWarningMessage(
            localizer.text('vscode.container.cannotBrowse', {
              reason:
                target.state === 'refused'
                  ? target.reason
                  : localizer.text('vscode.container.alreadyMember'),
            }),
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
          void vscode.window.showWarningMessage(
            localizer.text('vscode.container.cannotBrowse', { reason: message }),
          )
          return
        }
        const existing = vscode.workspace.workspaceFolders
        if (existing === undefined || existing.length === 0) {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.container.openFolderFirst')}`,
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
            `Modkit: ${localizer.text('vscode.container.workspaceRejected')}`,
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
            `Modkit: ${localizer.text('vscode.container.openFileFirst')}`,
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
            `Modkit: ${localizer.text('vscode.container.holdsNoEntries', {
              container: basename(active),
              reason: message,
            })}`,
          )
          return
        }
        const picked = await vscode.window.showQuickPick([...members], {
          title: localizer.text('vscode.container.members', { container: basename(active) }),
          placeHolder: localizer.text('vscode.container.openMember'),
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
          void vscode.window.showInformationMessage(
            `Modkit: ${reason ?? localizer.text('vscode.shell.alreadyPresent')}`,
          )
          return
        }
        // `write` logs, and asks to reload — this extension host composed once at activation.
        await configuration.write('extensions', next)
      })()
    }),

    vscode.commands.registerCommand('modkit.explainResolution', () => {
      const lines = [
        localizer.text('vscode.resolution.topology', {
          id: host.services.host.topology.topologyId,
        }),
        localizer.text('vscode.resolution.extensionHost', {
          realm: host.services.host.profile.realmId,
          count: host.services.host.profile.facilities.length,
        }),
        localizer.text('vscode.resolution.codecs', {
          realm: host.services.workers.profile.realmId,
          profiles: host.services.executionProfiles.join('/'),
        }),
        localizer.text('vscode.resolution.webview', {
          realm: host.webview.profile.realmId,
          count: host.webview.profile.facilities.length,
        }),
        localizer.text('vscode.resolution.extensions', {
          loaded: host.extensions.bundled.length + host.extensions.installed.length,
          refused: host.extensions.failures.length + host.extensions.problems.length,
        }),
        localizer.text('vscode.resolution.contributions', {
          count: host.contributions.length,
          disabled: host.contributions.filter(row => row.disabled).length,
        }),
        localizer.text('vscode.resolution.detectableTypes', {
          count: host.supportedExtensions.length,
        }),
        localizer.text('vscode.resolution.diagnostics', {
          count: host.services.host.inventory.diagnostics.length,
        }),
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
        panel.webview.html = refusalHtml(target.reason, localizer)
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
        liveSubjects.delete(served)
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
    vscode.window.registerTreeDataProvider('modkit.extensions', extensionsView),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // The grant widened or narrowed; every open page reloads its tree and is told why.
      for (const served of live) {
        served.publishRoots()
        served.notice(localizer.text('vscode.shell.workspaceFoldersChanged'))
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
      facts === undefined
        ? localizer.text('vscode.shell.statusNotOpened')
        : `${facts.contributionId}/${facts.variantId}`,
      size,
      localizer.text('vscode.shell.statusReadLimit', {
        mib: VSCODE_MAXIMUM_SUBJECT_BYTES / (1024 * 1024),
      }),
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
