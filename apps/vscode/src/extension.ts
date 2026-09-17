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
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vscode from 'vscode'
import { loadContentSources, callContentSources } from '@modkit/vfs/content-sources/node'
import type { ContentSources } from '@modkit/vfs/content-sources'
import { chooseContentSource } from '@modkit/ui/content-sources'
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
  createModkitCommandRuntime,
  discoverServiceOperations,
  invokeServiceOperation,
  loadLocalizationCatalogs,
  type CommandInput,
  type CommandResult,
} from '@modkit/host'
import {
  createLanguageWorkspace,
  languageProviderRoutes,
  resolveLanguageProvider,
  type LanguageWorkspaceDocumentSource,
} from '@modkit/host/language'
import { discoverGameInstallations } from '@modkit/host/games'
import { createNodeMapPreviewResourcePlanResolver, launchNodeGameResource } from '@modkit/host/node'
import type { SubjectCandidateProviderSource, SubjectCandidateScope } from '@modkit/sdk'
import type { ContainerRegistry } from './containers.js'
import {
  createOperationOutputStore,
  operationOutputName,
  operationOutputText,
  OPERATION_OUTPUT_SCHEME,
} from './operation-output.js'
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
import { planEditorAssociations, type AssociationPlan } from './editor-associations.js'
import { createViewerStatusBar } from './viewer-status.js'
import {
  selectScopedSubjectCandidates,
  type VsCodeSubjectCandidateScope,
} from './subject-candidates.js'
import {
  ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES,
  ARMOD_EXTERNAL_PROCESS_TREE_MAX_OBSERVED_INTERVAL_MS,
  ARMOD_EXTERNAL_PROCESS_TREE_MIN_SAMPLES,
  INSTALLED_ARCHIVE_AUTHORITIES,
  INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS,
} from './installed-archive-acceptance.js'

const CUSTOM_EDITOR_TYPE = 'modkit.genericAssetPreview'

/**
 * The stage-specific native editors (owner decision 2026-09-01, wave 2B first slice).
 *
 * Each is a real VS Code custom editor, so the modes appear in the editor picker — «Text», then
 * «Modkit Hex Viewer», then the family viewer — instead of behind a dropdown inside the webview.
 * The provider is one object: `panel.viewType` tells it which mode it is resolving.
 *
 * Boundary, stated rather than implied: a static `customEditors.selector` is a glob list, and «every
 * binary format but not the text ones» is not expressible as one. Hex is therefore offered for `*`
 * as an option, never a default; the text carve-out lives in the DEFAULT association sync, where it
 * can be expressed.
 */
const STAGE_CUSTOM_EDITOR_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'modkit.hexViewer': 'hex',
  'modkit.imageViewer': 'image',
  'modkit.archiveViewer': 'archive',
})

/** Every view type this extension owns; the association sync never removes anyone else's. */
const MODKIT_VIEW_TYPES: readonly string[] = Object.freeze([
  CUSTOM_EDITOR_TYPE,
  ...Object.keys(STAGE_CUSTOM_EDITOR_TYPES),
])

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

const SERVICE_OPERATION_BUDGET = Object.freeze({
  maxInputBytes: 16_777_216n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
  deadlineMs: 120_000,
})

const PACKAGE_INSTALL_GATE_COMMAND = '_modkit.acceptance.packageInstallGate'
const PACKAGE_INSTALL_GATE_ENV = 'MODKIT_VSCODE_ACCEPTANCE_PACKAGE_GATE'
const PACKAGE_INSTALL_GATE_GENERATION_ENV = 'MODKIT_VSCODE_ACCEPTANCE_GENERATION'
const PACKAGE_INSTALL_GATE_ARTIFACT_ENV = 'MODKIT_VSCODE_ACCEPTANCE_ARTIFACT_SHA256'
const PACKAGE_INSTALL_GATE_CONTINUE_ENV = 'MODKIT_VSCODE_ACCEPTANCE_CONTINUE'
const PACKAGE_INSTALL_GATE_DISABLED_URI_ENV = 'MODKIT_VSCODE_ACCEPTANCE_DISABLED_URI'
const FORMAT_SMOKE_WORKSPACE_ROOT_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_WORKSPACE_ROOT'
const FORMAT_SMOKE_SC2_ROOT_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_SC2_ROOT'
const FORMAT_SMOKE_WARZONE_ROOT_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_WARZONE_ROOT'
const FORMAT_SMOKE_START_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_START'
const FORMAT_SMOKE_ACK_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_ACK'
const ARCHIVE_ACCEPTANCE_START_ENV = 'MODKIT_VSCODE_ACCEPTANCE_ARCHIVE_START'
const ARCHIVE_ACCEPTANCE_ACK_ENV = 'MODKIT_VSCODE_ACCEPTANCE_ARCHIVE_ACK'
const MANAGED_PACKAGES_DIRECTORY = 'managed-packages'
const MANAGED_RELEASE_DESCRIPTOR = 'release.v1.json'
const MANAGED_RELEASE_CATALOG = 'catalog.v1.json'
const SELECTED_SOURCES_KEY = 'modkit.selectedContentSources'

interface PackagedManagedRegistry {
  readonly catalogPath: string
  readonly trustedPublicKeys: Readonly<Record<string, string>>
}

const FORMAT_SMOKE_CASE_IDS = Object.freeze([
  'image-dds',
  'image-png',
  'image-tga',
  'image-jpeg',
  'document-odt',
  'data-xml',
  'archive-zip',
  'archive-warzone-wz',
  'archive-mpq',
  'casc-dds',
  'audio-wav',
  'audio-ogg',
  'model-m3',
  'model-warzone-pie',
])

interface FormatSmokeRouteStep {
  readonly formatId: string
  readonly extensionId: string
  readonly contributionId: string
}

interface FormatSmokeAuthorityCase {
  readonly id: string
  readonly family: string
  readonly formats: readonly string[]
  readonly route: readonly FormatSmokeRouteStep[]
  readonly stage: 'raster' | 'tree-text' | 'tree' | 'metadata-tree' | 'model-or-wireframe'
  readonly corpus:
    | { readonly kind: 'named-exclusion'; readonly reason: string }
    | {
        readonly kind:
          'workspace-reference' | 'warzone-install-file' | 'sc2-install-file' | 'sc2-casc-entry'
        readonly path: string
        readonly bytes: number
        readonly sha256: string
      }
    | {
        readonly kind: 'warzone-wz-entry'
        readonly container: string
        readonly path: string
        readonly bytes: number
        readonly sha256: string
      }
}

interface FormatSmokeAuthority {
  readonly kind: 'x3.ga-recovery/format-family-smoke'
  readonly schemaVersion: 1
  readonly cases: readonly FormatSmokeAuthorityCase[]
  readonly namedExclusions: readonly { readonly id: string; readonly reason: string }[]
}

interface FormatSmokeOpenCase {
  readonly kind: 'open'
  readonly id: string
  readonly family: string
  readonly stage: FormatSmokeAuthorityCase['stage']
  readonly route: readonly FormatSmokeRouteStep[]
  readonly source:
    | {
        readonly kind: 'file'
        readonly path: string
        readonly uri: vscode.Uri
        readonly bytes: number
        readonly sha256: string
      }
    | {
        readonly kind: 'container-entry'
        readonly container: string
        readonly entry: string
        readonly uri: vscode.Uri
        readonly bytes: number
        readonly sha256: string
      }
}

interface FormatSmokeExcludedCase {
  readonly kind: 'excluded'
  readonly id: string
  readonly family: string
  readonly stage: FormatSmokeAuthorityCase['stage']
  readonly route: readonly FormatSmokeRouteStep[]
  readonly reason: string
}

type FormatSmokeCase = FormatSmokeOpenCase | FormatSmokeExcludedCase

const formatSmokeObject = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

interface AttemptedContainerCandidate {
  readonly contributionId: string
  readonly formatIds: readonly string[]
  readonly state: 'rejected' | 'detected' | 'selected'
  readonly diagnostics: readonly {
    readonly severity: string
    readonly code: string
    readonly message: string
  }[]
}

const isAttemptedContainerCandidate = (value: unknown): value is AttemptedContainerCandidate => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.contributionId === 'string' &&
    Array.isArray(candidate.formatIds) &&
    candidate.formatIds.every((formatId: unknown) => typeof formatId === 'string') &&
    (candidate.state === 'rejected' ||
      candidate.state === 'detected' ||
      candidate.state === 'selected') &&
    Array.isArray(candidate.diagnostics) &&
    candidate.diagnostics.every(diagnostic => {
      if (diagnostic === null || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) {
        return false
      }
      const item = diagnostic as Record<string, unknown>
      return (
        typeof item.severity === 'string' &&
        typeof item.code === 'string' &&
        typeof item.message === 'string'
      )
    })
  )
}

const formatSmokeConfinedPath = (root: string, portable: string, label: string): string => {
  if (portable.includes('\0')) throw new TypeError(`${label} contains NUL`)
  const normalized = portable.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-z]:\//iu.test(normalized)) {
    throw new TypeError(`${label} escapes its explicit root`)
  }
  const target = resolve(root, ...normalized.split('/'))
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new TypeError(`${label} escapes its explicit root`)
  }
  return target
}

const formatSmokeEntryPath = (value: string, label: string): string => {
  const normalized = value.replaceAll('\\', '/')
  if (
    normalized.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`${label} is not a confined container entry`)
  }
  return normalized
}

function readPackagedFormatSmoke(extensionRoot: string): {
  readonly authority: FormatSmokeAuthority
  readonly sha256: string
} {
  const path = join(extensionRoot, 'dist-app', 'format-smoke.v1.json')
  const bytes = readFileSync(path)
  const parsed = formatSmokeObject(JSON.parse(bytes.toString('utf8')), 'format smoke authority')
  if (parsed.kind !== 'x3.ga-recovery/format-family-smoke' || parsed.schemaVersion !== 1) {
    throw new TypeError('format smoke authority has the wrong kind or schemaVersion')
  }
  const cases = parsed.cases
  if (!Array.isArray(cases) || cases.length !== FORMAT_SMOKE_CASE_IDS.length) {
    throw new TypeError('format smoke authority must contain exactly 14 cases')
  }
  const ids = cases.map(item => formatSmokeObject(item, 'format smoke case').id)
  if (JSON.stringify(ids) !== JSON.stringify(FORMAT_SMOKE_CASE_IDS)) {
    throw new TypeError(`format smoke authority case order is ${JSON.stringify(ids)}`)
  }
  const exclusions = parsed.namedExclusions
  if (!Array.isArray(exclusions) || exclusions.length !== 0) {
    throw new TypeError('format smoke authority must contain no exclusions')
  }
  return Object.freeze({
    authority: parsed as unknown as FormatSmokeAuthority,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  })
}

const requiredFormatSmokeRoot = (environment: string): string => {
  const value = process.env[environment]
  if (value === undefined || value.trim() === '' || !isAbsolute(value)) {
    throw new TypeError(`${environment} must name an absolute root`)
  }
  return resolve(value)
}

function resolvePackagedFormatSmokeCases(
  authority: FormatSmokeAuthority,
): readonly FormatSmokeCase[] {
  const workspaceRoot = requiredFormatSmokeRoot(FORMAT_SMOKE_WORKSPACE_ROOT_ENV)
  const sc2Root = requiredFormatSmokeRoot(FORMAT_SMOKE_SC2_ROOT_ENV)
  const warzoneRoot = requiredFormatSmokeRoot(FORMAT_SMOKE_WARZONE_ROOT_ENV)
  return Object.freeze(
    authority.cases.map(entry => {
      const common = {
        id: entry.id,
        family: entry.family,
        stage: entry.stage,
        route: Object.freeze(
          entry.route.map(step =>
            Object.freeze({
              formatId: step.formatId,
              extensionId: step.extensionId,
              contributionId: step.contributionId,
            }),
          ),
        ),
      }
      if (entry.corpus.kind === 'named-exclusion') {
        return Object.freeze({
          ...common,
          kind: 'excluded' as const,
          reason: entry.corpus.reason,
        })
      }
      const corpus = entry.corpus
      if (corpus.kind === 'sc2-casc-entry') {
        const member = formatSmokeEntryPath(corpus.path, `${entry.id}.corpus.path`)
        return Object.freeze({
          ...common,
          kind: 'open' as const,
          source: Object.freeze({
            kind: 'container-entry' as const,
            container: sc2Root,
            entry: member,
            uri: vscode.Uri.from({
              scheme: CONTAINER_SCHEME,
              path: containerUriPath(sc2Root, member),
            }),
            bytes: corpus.bytes,
            sha256: corpus.sha256,
          }),
        })
      }
      if (corpus.kind === 'warzone-wz-entry') {
        const container = formatSmokeConfinedPath(
          warzoneRoot,
          corpus.container,
          `${entry.id}.corpus.container`,
        )
        const member = formatSmokeEntryPath(corpus.path, `${entry.id}.corpus.path`)
        return Object.freeze({
          ...common,
          kind: 'open' as const,
          source: Object.freeze({
            kind: 'container-entry' as const,
            container,
            entry: member,
            uri: vscode.Uri.from({
              scheme: CONTAINER_SCHEME,
              path: containerUriPath(container, member),
            }),
            bytes: corpus.bytes,
            sha256: corpus.sha256,
          }),
        })
      }
      const root =
        corpus.kind === 'workspace-reference'
          ? workspaceRoot
          : corpus.kind === 'sc2-install-file'
            ? sc2Root
            : warzoneRoot
      const path = formatSmokeConfinedPath(root, corpus.path, `${entry.id}.corpus.path`)
      return Object.freeze({
        ...common,
        kind: 'open' as const,
        source: Object.freeze({
          kind: 'file' as const,
          path,
          uri: vscode.Uri.file(path),
          bytes: corpus.bytes,
          sha256: corpus.sha256,
        }),
      })
    }),
  )
}

async function formatSmokeFileDigest(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function readPackagedManagedRegistry(extensionRoot: string): PackagedManagedRegistry | undefined {
  const releaseRoot = join(extensionRoot, 'dist-app', MANAGED_PACKAGES_DIRECTORY)
  const descriptorPath = join(releaseRoot, MANAGED_RELEASE_DESCRIPTOR)
  if (!existsSync(descriptorPath)) return undefined
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as {
    readonly catalog?: { readonly file?: unknown }
    readonly signing?: { readonly keyId?: unknown; readonly publicKeyPem?: unknown }
  }
  if (descriptor.catalog?.file !== MANAGED_RELEASE_CATALOG) {
    throw new Error(`packaged managed catalog file must be ${MANAGED_RELEASE_CATALOG}`)
  }
  const keyId = descriptor.signing?.keyId
  const publicKeyPem = descriptor.signing?.publicKeyPem
  if (typeof keyId !== 'string' || keyId.trim() === '') {
    throw new Error('packaged managed release signing keyId must be non-empty')
  }
  if (typeof publicKeyPem !== 'string' || publicKeyPem.trim() === '') {
    throw new Error('packaged managed release public key must be non-empty PEM')
  }
  return Object.freeze({
    catalogPath: join(releaseRoot, MANAGED_RELEASE_CATALOG),
    trustedPublicKeys: Object.freeze({ [keyId]: publicKeyPem }),
  })
}

/**
 * The subject string a URI names.
 *
 * A `file:` URI names a path; a `modkit-container:` URI names a member of an open container and has
 * no meaningful `fsPath` at all — its own text *is* the identity, and handing `fsPath` to anything
 * downstream would silently address a file that does not exist.
 */
function subjectPathOf(uri: vscode.Uri): string {
  return uri.scheme === CONTAINER_SCHEME || uri.scheme === 'modkit-source'
    ? uri.toString()
    : uri.fsPath
}

/** The inverse: the URI a subject string names, for the editor surfaces that take one. */
function subjectUriOf(path: string): vscode.Uri {
  if (path.startsWith('modkit-source:')) return vscode.Uri.parse(path)
  return parseContainerUriText(path) === undefined ? vscode.Uri.file(path) : vscode.Uri.parse(path)
}

function subjectCandidateScopeOf(uri: vscode.Uri): VsCodeSubjectCandidateScope {
  const container = parseContainerUriText(uri.toString())
  const workspaceTarget = container === undefined ? uri : vscode.Uri.file(container.container)
  const workspaceUri = vscode.workspace.getWorkspaceFolder(workspaceTarget)?.uri.toString()
  return Object.freeze({
    uri: uri.toString(),
    ...(workspaceUri === undefined ? {} : { workspaceUri }),
    ...(container === undefined
      ? {}
      : { containerUri: vscode.Uri.file(container.container).toString() }),
  })
}

class ModkitCustomDocument implements vscode.CustomDocument {
  readonly state: CustomDocumentState
  /** A container member is served by a read-only provider; there is nothing to save it back into. */
  readonly readOnly: boolean

  constructor(
    readonly uri: vscode.Uri,
    forceReadOnly = false,
  ) {
    this.state = new CustomDocumentState(subjectPathOf(uri))
    this.readOnly =
      forceReadOnly || uri.scheme === CONTAINER_SCHEME || uri.scheme === 'modkit-source'
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

/** Where viewer exports land: one deterministic folder per window, never a page-supplied path. */
export const VIEWER_EXPORT_FOLDER = 'modkit-export'

/**
 * Write viewer-produced export files into this window's export folder.
 *
 * The destination is derived here and nowhere else — the page sends leaf names and bytes, never a
 * location — and a window with no writable folder refuses by saying so rather than choosing a
 * directory on the user's behalf.
 */
async function exportViewerFiles(
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
): Promise<
  | { readonly state: 'written'; readonly names: readonly string[] }
  | {
      readonly state: 'refused'
      readonly reason: string
    }
> {
  const localizer = createVscodeLocalizer(vscode.env.language)
  const folder = (vscode.workspace.workspaceFolders ?? []).find(
    candidate => candidate.uri.scheme === 'file',
  )
  if (folder === undefined) {
    return { state: 'refused', reason: localizer.text('vscode.export.noFolder') }
  }
  const target = vscode.Uri.joinPath(folder.uri, VIEWER_EXPORT_FOLDER)
  await vscode.workspace.fs.createDirectory(target)
  const names: string[] = []
  for (const file of files) {
    const destination = vscode.Uri.joinPath(target, file.name)
    // `workspace.fs.writeFile` is typed `Uint8Array`; a Buffer subclass is rejected by the wire.
    await vscode.workspace.fs.writeFile(destination, new Uint8Array(file.bytes))
    names.push(file.name)
  }
  void vscode.window.showInformationMessage(
    localizer.text('vscode.export.written', { count: names.length, folder: target.fsPath }),
  )
  return { state: 'written', names: Object.freeze(names) }
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
  /** The one stage a stage-specific native editor raised this page for. */
  readonly forcedStage?: string
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
      ...(options.host.webviewRenderer === undefined
        ? {}
        : { renderer: options.host.webviewRenderer }),
      topologyId: options.host.services.host.topology.topologyId,
      session: options.session,
      moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
      contributionId: VSCODE_SUBJECT_CONTRIBUTION_ID,
      supportedExtensions: options.host.supportedExtensions,
      extensions: options.host.extensions,
      diagnostics: options.host.services.host.inventory.diagnostics.length,
      acceptance: options.acceptance,
      ...(options.openPath === undefined ? {} : { openPath: options.openPath }),
      ...(options.forcedStage === undefined ? {} : { forcedStage: options.forcedStage }),
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
  /** Zoom, channel, dimensions, format and size of the viewer in the active Modkit editor. */
  const viewerStatusBar = createViewerStatusBar()
  context.subscriptions.push(viewerStatusBar)
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
  const packagedRegistry = readPackagedManagedRegistry(extensionRoot)
  const managerSecurity = extensionManagerSecurityOptions(
    {
      MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS: process.env.MODKIT_EXTENSION_TRUSTED_PUBLIC_KEYS,
      MODKIT_EXTENSION_ALLOWED_ORIGINS: process.env.MODKIT_EXTENSION_ALLOWED_ORIGINS,
      MODKIT_EXTENSION_RAPID_POOL_ROOT: process.env.MODKIT_EXTENSION_RAPID_POOL_ROOT,
    },
    packagedRegistry?.trustedPublicKeys,
  )
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
      ? packagedRegistry === undefined
        ? { catalogSource: noRegistryCatalog }
        : {
            catalog: packagedRegistry.catalogPath,
            baseDirectory: dirname(packagedRegistry.catalogPath),
            requireSignature: true,
          }
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
  let packageGateDisabledProbeAcceptance: unknown
  let packageGateFormatSmokeAcceptance: unknown
  let packageGateArchiveAcceptance: unknown
  const formatSmokeReadOnlySubjects = new Set<string>()
  const liveArchiveAcceptanceDocuments = new Map<string, ModkitCustomDocument>()
  const liveArchiveAcceptanceServed = new Map<string, VsCodeServed>()
  let nativeWriterReceiptForAcceptance: unknown
  /*
   * The custom editor provider is constructed far below this point, so the acceptance route holds
   * a late-bound slot rather than a `let` the provider would have to hoist itself into.
   */
  const liveArchiveAcceptanceSaver: {
    save?: (document: ModkitCustomDocument, destination: vscode.Uri) => Promise<void>
  } = {}
  const webviewAcceptance = (): ModkitAcceptanceReceipt => {
    if (
      packageGateDisabledProbeAcceptance === undefined &&
      packageGateFormatSmokeAcceptance === undefined &&
      packageGateArchiveAcceptance === undefined
    ) {
      return acceptance
    }
    return {
      ...acceptance,
      ...(packageGateDisabledProbeAcceptance === undefined
        ? {}
        : {
            packageInstallGate: Object.freeze({
              disabledProbe: packageGateDisabledProbeAcceptance,
            }),
          }),
      ...(packageGateFormatSmokeAcceptance === undefined
        ? {}
        : { formatSmoke: packageGateFormatSmokeAcceptance }),
      ...(packageGateArchiveAcceptance === undefined
        ? {}
        : { archiveAcceptance: packageGateArchiveAcceptance }),
    } as ModkitAcceptanceReceipt
  }
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
  const archiveAcceptanceExtractions: {
    container: string
    entry: string
    bytes: number
  }[] = []
  const archiveAcceptanceReads: { readonly uri: string; readonly bytes: number }[] = []
  const archiveAcceptanceStreams: { readonly uri: string }[] = []
  let archiveAcceptanceIoActive = false

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
    ...(process.env[PACKAGE_INSTALL_GATE_ENV] === '1'
      ? {
          onExtract: event => archiveAcceptanceExtractions.push({ ...event }),
        }
      : {}),
  })
  context.subscriptions.push({
    dispose: () => {
      void containers.dispose()
    },
  })

  /*
   * One container folder joins the window at a time.
   *
   * VS Code declares it invalid to call `updateWorkspaceFolders` again before the previous change
   * has been announced, and answers such a call with `false`. Browsing a second archive in the same
   * window is an ordinary thing to do, so the mutations are serialized and each one waits for its
   * announcement — otherwise the second archive is reported as a workspace that refused it.
   */
  let workspaceFolderMutation: Promise<unknown> = Promise.resolve()
  let workspaceFolderAnnouncements = 0
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      workspaceFolderAnnouncements += 1
    }),
  )
  const addContainerWorkspaceFolder = (
    folder: vscode.Uri,
    name: string,
  ): Promise<'added' | 'already-present' | 'rejected'> => {
    const attempt = async (settleMs: number): Promise<'added' | 'already-present' | 'rejected'> => {
      const current = vscode.workspace.workspaceFolders ?? []
      if (current.some(item => item.uri.toString() === folder.toString())) {
        return 'already-present'
      }
      let announce: (() => void) | undefined
      const announcement = new Promise<void>(resolvePromise => {
        announce = resolvePromise
      })
      const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => announce?.())
      let timer: ReturnType<typeof setTimeout> | undefined
      // A bounded wait: a window that never announces the change must not hold every later browse.
      const settled = async (limitMs: number): Promise<void> => {
        await Promise.race([
          announcement,
          new Promise<void>(resolvePromise => {
            timer = setTimeout(resolvePromise, limitMs)
          }),
        ])
      }
      try {
        if (!vscode.workspace.updateWorkspaceFolders(current.length, 0, { uri: folder, name })) {
          // Someone else's folder change may still be in flight; give it its announcement.
          await settled(settleMs)
          return 'rejected'
        }
        await settled(10_000)
        return 'added'
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        subscription.dispose()
      }
    }
    const mutation = workspaceFolderMutation.then(async () => {
      const first = await attempt(2_000)
      return first === 'rejected' ? await attempt(0) : first
    })
    workspaceFolderMutation = mutation.catch(() => undefined)
    return mutation
  }

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
  // The same Explorer accepts local containers and remote VFS roots. This adapter owns no login protocol.
  let contentSources: Promise<ContentSources | undefined> | undefined
  const requireContentSources = async (): Promise<ContentSources> => {
    if (!vscode.workspace.isTrusted) throw new Error('Content sources require a trusted workspace')
    const storage = join(context.globalStorageUri.fsPath, 'content-sources')
    const defaultConfig = join(storage, 'provider.json')
    contentSources ??= loadContentSources(
      process.env['MODKIT_CONTENT_SOURCE_CONFIG'] ??
        (existsSync(defaultConfig) ? defaultConfig : undefined),
      storage,
    )
    const source = await contentSources
    if (!source)
      throw new Error('Battle.net source runtime is not configured for this installation')
    return source
  }
  const sourceChanges = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  const readContentSource = async (uri: string, maxBytes: number, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const location = sourceLocation(vscode.Uri.parse(uri))
    const bytes = await (await requireContentSources()).read(location.id, location.path, maxBytes)
    signal?.throwIfAborted()
    return bytes
  }
  const sourceLocation = (uri: vscode.Uri) => {
    if (
      uri.scheme !== 'modkit-source' ||
      uri.authority !== 'battlenet' ||
      uri.query ||
      uri.fragment
    ) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
    const [id, ...parts] = uri.path.replace(/^\//u, '').split('/')
    if (!id || parts.some(part => part === '..' || part === '.'))
      throw vscode.FileSystemError.FileNotFound(uri)
    return { id, path: parts.join('/') }
  }
  const sourceFileSystem: vscode.FileSystemProvider = {
    onDidChangeFile: sourceChanges.event,
    watch: () => new vscode.Disposable(() => undefined),
    async stat(uri) {
      const location = sourceLocation(uri)
      const source = await requireContentSources()
      if (!location.path) {
        if (!(await source.snapshot()).roots.some(root => root.id === location.id))
          throw vscode.FileSystemError.FileNotFound(uri)
        return {
          type: vscode.FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: 0,
          permissions: vscode.FilePermission.Readonly,
        }
      }
      const parts = location.path.split('/')
      const name = parts.pop()
      const node = (await source.list(location.id, parts.join('/'))).find(
        item => item.name === name,
      )
      if (!node) throw vscode.FileSystemError.FileNotFound(uri)
      return {
        type: node.directory ? vscode.FileType.Directory : vscode.FileType.File,
        ctime: 0,
        mtime: 0,
        size: node.size ?? 0,
        permissions: vscode.FilePermission.Readonly,
      }
    },
    async readDirectory(uri) {
      const location = sourceLocation(uri)
      return (await (await requireContentSources()).list(location.id, location.path)).map(item => [
        item.name,
        item.directory ? vscode.FileType.Directory : vscode.FileType.File,
      ])
    },
    async readFile(uri) {
      const location = sourceLocation(uri)
      return (await requireContentSources()).read(location.id, location.path, 64 * 1024 * 1024)
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
  const operationOutputs = createOperationOutputStore()
  const operationOutputChanged = new vscode.EventEmitter<vscode.Uri>()
  context.subscriptions.push(
    sourceChanges,
    vscode.workspace.registerFileSystemProvider('modkit-source', sourceFileSystem, {
      isReadonly: true,
      isCaseSensitive: true,
    }),
    // Answers that are documents; the scheme carries no authority, only what this window produced.
    vscode.workspace.registerTextDocumentContentProvider(OPERATION_OUTPUT_SCHEME, {
      onDidChange: operationOutputChanged.event,
      provideTextDocumentContent: uri => operationOutputs.read(uri.path) ?? '',
    }),
    operationOutputChanged,
    {
      dispose: () => {
        void contentSources?.then(source => source?.dispose()).catch(() => undefined)
      },
    },
    vscode.commands.registerCommand('modkit.contentSources', async () => {
      try {
        await chooseContentSource({
          russian: vscode.env.language.startsWith('ru'),
          choose: async (title, items) =>
            (await vscode.window.showQuickPick([...items], { title }))?.id,
          input: title => Promise.resolve(vscode.window.showInputBox({ title })),
          async call(method, args) {
            const source = await requireContentSources()
            const value = await callContentSources(source, method, args)
            if (
              [
                'connect',
                'disconnect',
                'add',
                'remove',
                'refresh',
                'publish',
                'deletePublication',
              ].includes(method)
            ) {
              sourceChanges.fire(
                (vscode.workspace.workspaceFolders ?? [])
                  .filter(folder => folder.uri.scheme === 'modkit-source')
                  .map(folder => ({ type: vscode.FileChangeType.Changed, uri: folder.uri })),
              )
            }
            return value
          },
          async open(source) {
            if (!vscode.workspace.workspaceFolders?.length) {
              throw new Error(localizer.text('vscode.container.openFolderFirst'))
            }
            const uri = vscode.Uri.from({
              scheme: 'modkit-source',
              authority: 'battlenet',
              path: `/${source.id}`,
            })
            const result = await addContainerWorkspaceFolder(uri, source.label)
            if (result === 'rejected')
              throw new Error('The workspace could not add this content source')
            await vscode.commands.executeCommand('revealInExplorer', uri)
          },
          async openLocal() {
            const selected = await vscode.commands.executeCommand<
              { installPath: string } | undefined
            >('modkit.selectGameInstallation')
            if (selected)
              await vscode.commands.executeCommand(
                'modkit.browseContainer',
                vscode.Uri.file(selected.installPath),
              )
          },
        })
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Modkit: ${error instanceof Error ? error.message : 'Content source failed'}`,
        )
      }
    }),
  )
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
  let packageGateChangeEvents = 0
  context.subscriptions.push(extensionManager.onDidChange(() => (packageGateChangeEvents += 1)))
  const packageGatePackageIds = Object.freeze([
    'blizzard/starcraft2-suite',
    'wz2100project/warzone-2100',
  ])
  const packageGateBlizzardPackage = 'blizzard/starcraft2-suite'
  const packageGateWarzonePackage = 'wz2100project/warzone-2100'
  const packageGateExpectedGames = Object.freeze([
    { id: 'blizzard/starcraft-2', displayName: 'StarCraft II' },
    { id: 'wz2100project/warzone-2100', displayName: 'Warzone 2100' },
  ])
  const packageGateExpectedCommonRoots = Object.freeze(
    BUNDLED_CATALOG.roots.map(root => root.coordinate).sort(),
  )
  const packageGateExpectedExternalRoots = Object.freeze(
    [
      'blizzard/casc',
      'blizzard/common-formats',
      'blizzard/diablo',
      'blizzard/galaxy-language',
      'blizzard/models',
      'blizzard/mpq',
      'blizzard/starcraft2',
      'blizzard/warcraft-3',
      'wz2100project/warzone-2100',
    ].sort(),
  )
  const packageGateSameList = (left: readonly unknown[], right: readonly unknown[]) =>
    JSON.stringify(left) === JSON.stringify(right)
  const packageGateEntrySummary = (entry: ExtensionManagerEntry) =>
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
  const packageGateSnapshotSummary = async () => {
    const snapshot = await extensionManager.snapshot()
    const entries = Object.freeze(snapshot.entries.map(packageGateEntrySummary))
    const managed = Object.freeze(
      entries
        .filter(entry => packageGatePackageIds.includes(entry.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
    )
    return Object.freeze({
      entries,
      managed,
      trustedAvailableEntries: Object.freeze(
        managed
          .filter(entry => entry.trusted && entry.installedVersion === undefined)
          .map(entry => entry.id),
      ),
      checkoutEntries: Object.freeze(
        entries
          .filter(entry => entry.source === 'workspace' || entry.source.startsWith('local:'))
          .map(entry => entry.id),
      ),
      gameAvailability: Object.freeze(
        packageGateExpectedGames.map(game => {
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
      ),
    })
  }
  const packageGateCardModel = () => {
    const cards = [...extensionCards().values()]
    return Object.freeze({
      count: cards.length,
      managed: Object.freeze(
        cards
          .filter(card => card.managedPackageId !== undefined)
          .map(card =>
            Object.freeze({
              id: card.id,
              installed: card.installed,
              managedPackageId: card.managedPackageId,
              managedPackageEnabled: card.managedPackageEnabled,
              records: card.projection.records.length,
            }),
          )
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    })
  }
  const packageGateHostModel = () =>
    Object.freeze({
      bundledRoots: host.extensions.bundled.length,
      bundledRootIds: Object.freeze([...host.extensions.bundled].sort()),
      installedRoots: host.extensions.installed.length,
      installedRootIds: Object.freeze([...host.extensions.installed].sort()),
      managedRootIds: Object.freeze([...host.extensions.managed].sort()),
      extensionLoadFailures: Object.freeze(
        host.extensions.failures.map(failure =>
          Object.freeze({
            root: failure.root,
            code: failure.code,
            message: failure.message,
          }),
        ),
      ),
      bundledLoadFailures: Object.freeze(
        host.bundledLoadErrors.map(failure =>
          Object.freeze({
            root: failure.root,
            code: failure.code,
            message: failure.message,
          }),
        ),
      ),
      contributionCount: host.contributions.length,
      disabledManagedRoots: managedExtensionState.disabledExtensions.filter(id =>
        id.startsWith('blizzard/'),
      ).length,
      disabledHostContributions: host.contributions.filter(row => row.disabled).length,
      blizzardRootsInInventory: host.extensions.installed.filter(id => id.startsWith('blizzard/')),
    })
  const packageGateStores = async () =>
    Object.freeze({
      materialized: Object.freeze(
        (await nodeExtensionManager.artifactStore.list()).map(item => item.id).sort(),
      ),
      enablement: Object.freeze(
        (await nodeExtensionManager.enablementStore.list())
          .map(item => Object.freeze({ id: item.id, enabled: item.enabled }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    })
  const packageGateReceiptTarget = vscode.Uri.joinPath(
    context.globalStorageUri,
    'package-install-gate.json',
  )
  const readPackageGateReceipt = async () => {
    try {
      const bytes = await vscode.workspace.fs.readFile(packageGateReceiptTarget)
      return JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      return undefined
    }
  }
  const packageGateCumulative = async (phase: unknown) => {
    const existing = await readPackageGateReceipt()
    const phases = [
      ...((existing as { phases?: readonly unknown[] } | undefined)?.phases ?? []).filter(
        item =>
          (item as { generation?: unknown }).generation !==
          (phase as { generation?: unknown }).generation,
      ),
      phase,
    ].sort(
      (left, right) =>
        Number((left as { generation?: unknown }).generation) -
        Number((right as { generation?: unknown }).generation),
    )
    const failures = phases.flatMap(item =>
      Array.isArray((item as { failures?: unknown }).failures)
        ? ((item as { failures: readonly unknown[] }).failures as readonly {
            readonly code?: unknown
            readonly message?: unknown
          }[])
        : [],
    )
    const completedGenerations = phases
      .filter(item => (item as { verdict?: unknown }).verdict === 'pass')
      .map(item => (item as { generation?: unknown }).generation)
    const artifactSha256 = process.env[PACKAGE_INSTALL_GATE_ARTIFACT_ENV]
    return Object.freeze({
      kind: 'x3.modkit/vscode-package-install-gate',
      schemaVersion: 1,
      command: PACKAGE_INSTALL_GATE_COMMAND,
      artifactSha256,
      execution: Object.freeze({
        host: 'vscode-extension-host',
        extensionDevelopmentMode: context.extensionMode === vscode.ExtensionMode.Development,
        registryEnvironmentCleared: (process.env.MODKIT_EXTENSION_REGISTRY ?? '') === '',
        networkAccessRequested: false,
        generationEnvironment: process.env[PACKAGE_INSTALL_GATE_GENERATION_ENV] ?? null,
      }),
      expected: Object.freeze({
        offlineCatalogSigned: true,
        offlineCatalogVisible: true,
        games: packageGateExpectedGames,
        packages: packageGatePackageIds,
        lifecycle: Object.freeze([
          'available',
          'install',
          'disable',
          'enable',
          'uninstall',
          'reinstall',
        ]),
        generations: Object.freeze([1, 2, 3]),
        persistedAcrossFullProcessRestart: true,
      }),
      phases: Object.freeze(phases),
      failures: Object.freeze(failures),
      verdict:
        failures.length === 0 && JSON.stringify(completedGenerations) === JSON.stringify([1, 2, 3])
          ? ('pass' as const)
          : ('fail' as const),
    })
  }
  const writePackageGateReceipt = async (value: unknown) => {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri)
    const temporary = vscode.Uri.joinPath(
      context.globalStorageUri,
      `package-install-gate.${Date.now()}.${nonce()}.tmp.json`,
    )
    const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
    await vscode.workspace.fs.writeFile(temporary, bytes)
    await vscode.workspace.fs.rename(temporary, packageGateReceiptTarget, { overwrite: true })
  }
  const packageGateFailure = (code: string, message: string) => Object.freeze({ code, message })
  const packageGateAssert = (
    condition: boolean,
    failures: { code: string; message: string }[],
    code: string,
    message: string,
  ) => {
    if (!condition) failures.push(packageGateFailure(code, message))
  }
  const packageGateAssertActionsRefreshed = (
    actions: readonly unknown[],
    failures: { code: string; message: string }[],
  ) => {
    for (const action of actions) {
      const summary = action as {
        readonly kind?: unknown
        readonly changedEventsDelta?: unknown
        readonly snapshotReturned?: unknown
      }
      packageGateAssert(
        summary.snapshotReturned === true,
        failures,
        'x3.acceptance/package-action-snapshot-missing',
        `${String(summary.kind ?? 'unknown package action')} did not return a refreshed package tree snapshot`,
      )
      packageGateAssert(
        typeof summary.changedEventsDelta === 'number' && summary.changedEventsDelta >= 1,
        failures,
        'x3.acceptance/package-action-change-event-missing',
        `${String(summary.kind ?? 'unknown package action')} did not publish an onDidChange refresh event`,
      )
    }
  }
  const packageGateAction = async (
    kind: string,
    command: Parameters<ExtensionManagerController['execute']>[0],
  ) => {
    const before = await packageGateSnapshotSummary()
    const beforeCards = packageGateCardModel()
    const beforeEvents = packageGateChangeEvents
    let after
    let error: string | undefined
    try {
      after = await extensionManager.execute(command)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
      throw caught
    } finally {
      // Captures the tree/card projection after every attempted action, including typed failures.
    }
    const afterSummary = await packageGateSnapshotSummary()
    return Object.freeze({
      kind,
      command,
      before,
      beforeCards,
      after: afterSummary,
      afterCards: packageGateCardModel(),
      changedEventsDelta: packageGateChangeEvents - beforeEvents,
      snapshotReturned: after !== undefined,
      ...(error === undefined ? {} : { error }),
    })
  }
  const waitForPackageGateContinuation = async (path: string) => {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      if (existsSync(path)) return true
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
    }
    return false
  }

  const formatSmokeControlPath = (environment: string): string => {
    const value = process.env[environment]
    if (value === undefined || value.trim() === '' || !isAbsolute(value)) {
      throw new TypeError(`${environment} must name an absolute control path`)
    }
    return resolve(value)
  }

  const verifyFormatSmokeCase = async (testCase: FormatSmokeOpenCase) => {
    let bytes: number
    let sha256: string
    if (testCase.source.kind === 'file') {
      const details = statSync(testCase.source.path)
      if (!details.isFile()) throw new TypeError(`${testCase.id} corpus is not a file`)
      bytes = details.size
      if (bytes !== testCase.source.bytes) {
        throw new TypeError(
          `${testCase.id} corpus size mismatch: expected ${testCase.source.bytes}, got ${bytes}`,
        )
      }
      sha256 = await formatSmokeFileDigest(testCase.source.path)
    } else {
      const value = await containers.read(testCase.source.container, testCase.source.entry)
      bytes = value.byteLength
      if (bytes !== testCase.source.bytes) {
        throw new TypeError(
          `${testCase.id} corpus size mismatch: expected ${testCase.source.bytes}, got ${bytes}`,
        )
      }
      sha256 = createHash('sha256').update(value).digest('hex')
    }
    if (sha256 !== testCase.source.sha256) {
      throw new TypeError(
        `${testCase.id} corpus SHA-256 mismatch: expected ${testCase.source.sha256}, got ${sha256}`,
      )
    }
    return Object.freeze({
      kind: testCase.source.kind,
      bytes,
      sha256,
      verifiedBeforeOpen: true,
      readOnly: true,
    })
  }

  const waitForFormatSmokeAck = async (expected: {
    readonly path: string
    readonly artifactSha256: string
    readonly operationRevision: number
    readonly caseId: string
    readonly observationToken: string
    readonly route: readonly FormatSmokeRouteStep[]
  }) => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      try {
        const ack = formatSmokeObject(
          JSON.parse(readFileSync(expected.path, 'utf8')),
          'format smoke acknowledgement',
        )
        if (
          ack.kind !== 'x3.vscode-installed-format-smoke-ack' ||
          ack.schemaVersion !== 1 ||
          ack.artifactSha256 !== expected.artifactSha256 ||
          ack.generation !== 3 ||
          ack.operationRevision !== expected.operationRevision ||
          ack.caseId !== expected.caseId ||
          ack.observationToken !== expected.observationToken
        ) {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
          continue
        }
        const observation = formatSmokeObject(ack.observation, 'format smoke observation')
        const digest = `sha256:${createHash('sha256')
          .update(JSON.stringify(observation))
          .digest('hex')}`
        if (ack.observationSha256 !== digest) {
          throw new TypeError(`${expected.caseId} observation digest mismatch`)
        }
        if (ack.verdict !== 'pass') {
          throw new TypeError(`${expected.caseId} external observation did not pass`)
        }
        const actualRoute = Array.isArray(observation.selectedRoute)
          ? observation.selectedRoute.map(step => {
              const route = formatSmokeObject(step, `${expected.caseId} selected route`)
              return {
                formatId: route.formatId,
                extensionId: route.extensionId,
                contributionId: route.contributionId,
              }
            })
          : undefined
        if (JSON.stringify(actualRoute) !== JSON.stringify(expected.route)) {
          throw new TypeError(`${expected.caseId} actual selected route does not match authority`)
        }
        return Object.freeze({
          observationSha256: digest,
          observation: Object.freeze(observation),
        })
      } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
          continue
        }
        throw error
      }
    }
    throw new TypeError(`${expected.caseId} external observation timed out`)
  }

  const waitForArchiveAcceptanceAck = async (expected: {
    readonly path: string
    readonly artifactSha256: string
    readonly stage: 'source-observed' | 'target-observed'
    readonly source: string
    readonly target: string
  }) => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      try {
        const ack = formatSmokeObject(
          JSON.parse(readFileSync(expected.path, 'utf8')),
          'archive acceptance acknowledgement',
        )
        if (
          ack.kind !== 'x3.vscode-installed-archive-acceptance-ack' ||
          ack.schemaVersion !== 1 ||
          ack.artifactSha256 !== expected.artifactSha256 ||
          ack.generation !== 3 ||
          ack.caseId !== 'wte70-save-as-reopen' ||
          ack.stage !== expected.stage ||
          ack.source !== expected.source ||
          ack.target !== expected.target ||
          ack.observedBy !== 'cdp' ||
          ack.verdict !== 'pass'
        ) {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
          continue
        }
        const nativeUserCommand =
          expected.stage === 'source-observed'
            ? formatSmokeObject(ack.nativeUserCommand, 'WTE70 native Save As observation')
            : undefined
        if (
          nativeUserCommand !== undefined &&
          (nativeUserCommand.command !== 'workbench.action.files.saveAs' ||
            nativeUserCommand.attempted !== false ||
            nativeUserCommand.proof !== false ||
            typeof nativeUserCommand.cdpQuickInputObserved !== 'boolean')
        ) {
          throw new TypeError('WTE70 native Save As acknowledgement is malformed')
        }
        return Object.freeze({
          observedBy: 'cdp' as const,
          stage: expected.stage,
          ...(nativeUserCommand === undefined ? {} : { nativeUserCommand }),
        })
      } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
          continue
        }
        throw error
      }
    }
    throw new TypeError(`WTE70 ${expected.stage} external observation timed out`)
  }

  /*
   * Unlike the WTE70 bridge, a container search deliberately stops in the ordinary VS Code
   * quick-input surface. The installed harness has to drive the InputBox and select the
   * QuickPick row; only the return value of the registered command can then bind that external
   * selection back to the product route. Keep this acknowledgement case-bound so a stale
   * Save-As acknowledgement, or a selection from another archive family, can never satisfy it.
   */
  const waitForArchiveAcceptanceSearchAck = async (expected: {
    readonly path: string
    readonly artifactSha256: string
    readonly caseId: (typeof INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS)[number]
    readonly container: string
    readonly query: string
    readonly requiredEntry: string
    readonly selectedUri: string
  }) => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      try {
        const ack = formatSmokeObject(
          JSON.parse(readFileSync(expected.path, 'utf8')),
          'archive search acknowledgement',
        )
        if (
          ack.kind !== 'x3.vscode-installed-archive-acceptance-ack' ||
          ack.schemaVersion !== 1 ||
          ack.artifactSha256 !== expected.artifactSha256 ||
          ack.generation !== 3 ||
          ack.caseId !== expected.caseId ||
          ack.stage !== 'search-picker-selected' ||
          ack.container !== expected.container ||
          ack.query !== expected.query ||
          ack.requiredEntry !== expected.requiredEntry ||
          ack.selectedUri !== expected.selectedUri ||
          ack.selectedRoute !== CONTAINER_SCHEME ||
          ack.observedBy !== 'cdp' ||
          ack.inputBoxObserved !== true ||
          ack.quickPickObserved !== true ||
          ack.pickedLabel !== expected.requiredEntry ||
          ack.verdict !== 'pass'
        ) {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
          continue
        }
        return Object.freeze({
          observedBy: 'cdp' as const,
          inputBoxObserved: true as const,
          quickPickObserved: true as const,
          pickedLabel: expected.requiredEntry,
          selectedUri: expected.selectedUri,
          selectedRoute: CONTAINER_SCHEME,
        })
      } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
          continue
        }
        throw error
      }
    }
    throw new TypeError(`${expected.caseId} external search selection timed out`)
  }

  /*
   * The isolated-product harness owns this sampler.  In particular, it must keep sampling even
   * when the extension host is busy awaiting an isolated runtime worker, which an in-host timer
   * cannot prove.  The acknowledgement is bound to this exact installed artifact, generation,
   * and case before either the open or the stop boundary may advance.
   */
  const waitForArmodProcessTreeMemoryAck = async (expected: {
    readonly path: string
    readonly artifactSha256: string
    readonly stage: 'armod-memory-sampling-start' | 'armod-memory-sampling-stop'
  }) => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      try {
        const ack = formatSmokeObject(
          JSON.parse(readFileSync(expected.path, 'utf8')),
          'ARmod external process-tree memory acknowledgement',
        )
        if (
          ack.kind !== 'x3.vscode-installed-archive-acceptance-ack' ||
          ack.schemaVersion !== 1 ||
          ack.artifactSha256 !== expected.artifactSha256 ||
          ack.generation !== 3 ||
          ack.caseId !== 'armod-open' ||
          ack.stage !== expected.stage
        ) {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
          continue
        }
        if (
          ack.observedBy !== 'external-process-tree' ||
          ack.collector !== 'Win32_Process' ||
          ack.requestedSampleIntervalMs !== 25 ||
          ack.verdict !== 'pass'
        ) {
          throw new TypeError(`ARmod ${expected.stage} external memory acknowledgement failed`)
        }
        if (expected.stage === 'armod-memory-sampling-stop') {
          const workingSetBytes = formatSmokeObject(ack.workingSetBytes, 'ARmod working set')
          const privateBytes = formatSmokeObject(ack.privateBytes, 'ARmod private bytes')
          const sampleCount = ack.sampleCount
          const samples = Array.isArray(ack.samples)
            ? ack.samples.map((sample, index) =>
                formatSmokeObject(sample, `ARmod external process-tree sample ${index + 1}`),
              )
            : []
          const observedCadence = formatSmokeObject(
            ack.observedCadence,
            'ARmod external process-tree observed cadence',
          )
          const timestamps = samples.map(sample => sample.timestampMs)
          const observedIntervals = timestamps.slice(1).map((timestamp, index) => {
            const previous = timestamps[index]
            return typeof timestamp === 'number' && typeof previous === 'number'
              ? timestamp - previous
              : Number.NaN
          })
          const validMetric = (metric: Readonly<Record<string, unknown>>) => {
            const baselineBytes = metric.baselineBytes
            const peakBytes = metric.peakBytes
            const deltaBytes = metric.deltaBytes
            return (
              typeof baselineBytes === 'number' &&
              Number.isSafeInteger(baselineBytes) &&
              baselineBytes >= 0 &&
              typeof peakBytes === 'number' &&
              Number.isSafeInteger(peakBytes) &&
              peakBytes >= baselineBytes &&
              typeof deltaBytes === 'number' &&
              Number.isSafeInteger(deltaBytes) &&
              deltaBytes === peakBytes - baselineBytes &&
              metric.deltaCeilingBytes === ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES &&
              deltaBytes <= ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES
            )
          }
          const validCadence =
            typeof observedCadence.intervalCount === 'number' &&
            Number.isSafeInteger(observedCadence.intervalCount) &&
            observedCadence.intervalCount === observedIntervals.length &&
            typeof observedCadence.minIntervalMs === 'number' &&
            Number.isSafeInteger(observedCadence.minIntervalMs) &&
            observedCadence.minIntervalMs > 0 &&
            observedCadence.minIntervalMs === Math.min(...observedIntervals) &&
            typeof observedCadence.maxIntervalMs === 'number' &&
            Number.isSafeInteger(observedCadence.maxIntervalMs) &&
            observedCadence.maxIntervalMs === Math.max(...observedIntervals) &&
            observedCadence.maxIntervalMs >= observedCadence.minIntervalMs &&
            observedCadence.maxIntervalMs <= ARMOD_EXTERNAL_PROCESS_TREE_MAX_OBSERVED_INTERVAL_MS &&
            typeof observedCadence.averageIntervalMs === 'number' &&
            Number.isFinite(observedCadence.averageIntervalMs) &&
            observedCadence.averageIntervalMs ===
              observedIntervals.reduce((total, interval) => total + interval, 0) /
                observedIntervals.length
          if (
            !Array.isArray(ack.matchedRootPids) ||
            ack.matchedRootPids.length === 0 ||
            ack.matchedRootPids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) ||
            !Array.isArray(ack.descendantPids) ||
            ack.descendantPids.length === 0 ||
            ack.descendantPids.some(pid => !Number.isSafeInteger(pid) || pid <= 0) ||
            typeof sampleCount !== 'number' ||
            !Number.isSafeInteger(sampleCount) ||
            sampleCount < ARMOD_EXTERNAL_PROCESS_TREE_MIN_SAMPLES ||
            !Array.isArray(ack.samples) ||
            samples.length !== sampleCount ||
            samples.some(
              sample =>
                !Number.isSafeInteger(sample.timestampMs) ||
                !Number.isSafeInteger(sample.workingSetBytes) ||
                !Number.isSafeInteger(sample.privateBytes),
            ) ||
            !validCadence ||
            !Array.isArray(ack.errors) ||
            ack.errors.length !== 0 ||
            !validMetric(workingSetBytes) ||
            !validMetric(privateBytes)
          ) {
            throw new TypeError('ARmod external process-tree memory acknowledgement is incomplete')
          }
        }
        return Object.freeze({ ...ack })
      } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
          continue
        }
        throw error
      }
    }
    throw new TypeError(`ARmod ${expected.stage} external memory acknowledgement timed out`)
  }

  const runInstalledFormatSmoke = async (
    artifactSha256: string,
    persist: (value: unknown) => Promise<void>,
  ) => {
    const packaged = readPackagedFormatSmoke(extensionRoot)
    const cases = resolvePackagedFormatSmokeCases(packaged.authority)
    const exclusions = cases.filter(
      (entry): entry is FormatSmokeExcludedCase => entry.kind === 'excluded',
    )
    const openCases = cases.filter((entry): entry is FormatSmokeOpenCase => entry.kind === 'open')
    if (openCases.length !== 14 || exclusions.length !== 0) {
      throw new TypeError('format smoke must contain 14 opens and no exclusions')
    }
    const startPath = formatSmokeControlPath(FORMAT_SMOKE_START_ENV)
    const ackPath = formatSmokeControlPath(FORMAT_SMOKE_ACK_ENV)
    await persist(
      await packageGateCumulative(
        Object.freeze({
          generation: 3,
          state: 'awaiting-format-smoke-start',
          formatSmoke: Object.freeze({
            authoritySha256: packaged.sha256,
            expectedCases: cases.length,
            expectedOpens: openCases.length,
            exclusions: Object.freeze(
              exclusions.map(entry => Object.freeze({ caseId: entry.id, reason: entry.reason })),
            ),
          }),
          failures: Object.freeze([]),
          verdict: 'pending',
        }),
      ),
    )
    if (!(await waitForPackageGateContinuation(startPath))) {
      throw new TypeError('format smoke start sentinel was not observed')
    }

    const results: unknown[] = []
    let operationRevision = 0
    for (const testCase of openCases) {
      operationRevision += 1
      if (testCase.source.kind === 'container-entry') {
        // The acceptance authority names the owner-supplied installation root, but resolving that
        // name does not itself widen the product grant. Give the shared container registry the
        // container's directory before the integrity read; the later custom-editor open uses the
        // same grant and therefore exercises the normal confined product path.
        grantFor({ path: testCase.source.uri.toString(), kind: 'container-entry' })
      }
      const verification = await verifyFormatSmokeCase(testCase)
      const observationToken = nonce()
      const subject = subjectKey(subjectPathOf(testCase.source.uri))
      formatSmokeReadOnlySubjects.add(subject)
      packageGateFormatSmokeAcceptance = Object.freeze({
        caseId: testCase.id,
        operationRevision,
        observationToken,
        readOnly: true,
      })
      try {
        openResource(testCase.source.uri)
        await persist(
          await packageGateCumulative(
            Object.freeze({
              generation: 3,
              state: 'awaiting-format-smoke-observation',
              formatSmoke: Object.freeze({
                authoritySha256: packaged.sha256,
                completedCases: results.length,
                current: Object.freeze({
                  caseId: testCase.id,
                  family: testCase.family,
                  stage: testCase.stage,
                  operationRevision,
                  observationToken,
                  corpus: verification,
                }),
              }),
              failures: Object.freeze([]),
              verdict: 'pending',
            }),
          ),
        )
        const acknowledged = await waitForFormatSmokeAck({
          path: ackPath,
          artifactSha256,
          operationRevision,
          caseId: testCase.id,
          observationToken,
          route: testCase.route,
        })
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
        let unchangedAfterClose: boolean | undefined
        if (testCase.id === 'archive-mpq' && testCase.source.kind === 'file') {
          const afterBytes = statSync(testCase.source.path).size
          const afterSha256 = await formatSmokeFileDigest(testCase.source.path)
          unchangedAfterClose =
            afterBytes === verification.bytes && afterSha256 === verification.sha256
          if (!unchangedAfterClose) {
            throw new TypeError('archive-mpq corpus changed during read-only installed open')
          }
        }
        results.push(
          Object.freeze({
            caseId: testCase.id,
            family: testCase.family,
            stage: testCase.stage,
            operationRevision,
            corpus: Object.freeze({
              ...verification,
              ...(unchangedAfterClose === undefined ? {} : { unchangedAfterClose }),
            }),
            observationSha256: acknowledged.observationSha256,
            observation: acknowledged.observation,
            verdict: 'pass',
          }),
        )
      } finally {
        packageGateFormatSmokeAcceptance = undefined
        formatSmokeReadOnlySubjects.delete(subject)
      }
    }
    return Object.freeze({
      kind: 'x3.vscode-installed-format-smoke',
      schemaVersion: 1,
      artifactSha256,
      authoritySha256: packaged.sha256,
      expectedCases: cases.length,
      openedCases: results.length,
      exclusions: Object.freeze(
        exclusions.map(entry =>
          Object.freeze({ caseId: entry.id, reason: entry.reason, authorityMatched: true }),
        ),
      ),
      cases: Object.freeze(results),
      failures: Object.freeze([]),
      verdict: 'pass',
    })
  }

  /*
   * Wave 2A is deliberately a second generation-three phase rather than another A8 case.  A8
   * proves format routes in a webview; this phase proves the native container doors that a person
   * actually uses (indexed Explorer tree, bounded search, native Save As/materialize, and a
   * nested subject).  It is opt-in: only the existing materialize command and the explicit
   * acceptance-gated Save As bridge write separate user-selected destinations.
   */
  const runInstalledArchiveAcceptance = async (
    artifactSha256: string,
    persist: (value: unknown) => Promise<void>,
  ) => {
    const startPath = formatSmokeControlPath(ARCHIVE_ACCEPTANCE_START_ENV)
    const ackPath = formatSmokeControlPath(ARCHIVE_ACCEPTANCE_ACK_ENV)
    await persist(
      await packageGateCumulative(
        Object.freeze({
          generation: 3,
          state: 'awaiting-archive-acceptance-start',
          archiveAcceptance: Object.freeze({
            expectedCases: INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS,
            artifactSha256,
          }),
          failures: Object.freeze([]),
          verdict: 'pending',
        }),
      ),
    )
    if (!(await waitForPackageGateContinuation(startPath))) {
      throw new TypeError('archive acceptance start sentinel was not observed')
    }

    const sc2Root = requiredFormatSmokeRoot(FORMAT_SMOKE_SC2_ROOT_ENV)
    const warzoneRoot = requiredFormatSmokeRoot(FORMAT_SMOKE_WARZONE_ROOT_ENV)
    const authorityWorkspace = requiredFormatSmokeRoot(FORMAT_SMOKE_WORKSPACE_ROOT_ENV)
    const scratchWorkspace = workspaceFolders()[0]
    if (scratchWorkspace === undefined) throw new TypeError('archive acceptance needs a workspace')
    const cases: unknown[] = []
    const materializations: unknown[] = []
    const record = (
      caseId: (typeof INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS)[number],
      evidence: unknown,
    ) =>
      cases.push(
        Object.freeze({ caseId, evidence: Object.freeze(evidence as object), verdict: 'pass' }),
      )
    const digestFile = async (
      path: string,
      expected: { readonly bytes: number; readonly sha256: string },
    ) => {
      const details = statSync(path)
      if (!details.isFile() || details.size !== expected.bytes) {
        throw new TypeError(`${basename(path)} does not match its exact corpus byte length`)
      }
      const sha256 = await formatSmokeFileDigest(path)
      if (sha256 !== expected.sha256)
        throw new TypeError(`${basename(path)} does not match its corpus SHA-256`)
      return Object.freeze({ bytes: details.size, sha256 })
    }
    const requireNested = async (
      container: string,
      entry: string,
      expected: { readonly formatId: string; readonly contributionId: string },
    ) => {
      const uri = vscode.Uri.from({
        scheme: CONTAINER_SCHEME,
        path: containerUriPath(container, entry),
      })
      const opened = await commandOpener(uri.toString())
      if (opened.snapshot.state !== 'opened') {
        throw new TypeError(
          `nested ${entry} did not open: ${JSON.stringify(opened.snapshot.diagnostics)}`,
        )
      }
      try {
        const selected = opened.snapshot.selected
        const selectedRoute = opened.snapshot.selectedRoute?.at(-1)
        if (
          selectedRoute?.formatId !== expected.formatId ||
          selected.contributionId !== expected.contributionId
        ) {
          throw new TypeError(
            `nested ${entry} selected ${selectedRoute?.formatId ?? 'unknown'}/${selected.contributionId}, not ${expected.formatId}/${expected.contributionId}`,
          )
        }
        return Object.freeze({ selectedRoute: opened.snapshot.selectedRoute ?? [], selected })
      } finally {
        await opened.session?.dispose()
      }
    }
    const treeSearchLazy = async (
      caseId: (typeof INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS)[number],
      container: string,
      query: string,
      requiredEntry: string,
    ) => {
      archiveAcceptanceExtractions.length = 0
      const browse = await vscode.commands.executeCommand(
        'modkit.browseContainer',
        vscode.Uri.file(container),
      )
      if (browse === null || typeof browse !== 'object' || Array.isArray(browse)) {
        throw new TypeError(`${caseId} registered browse command returned no Explorer folder`)
      }
      const browseResult = browse as {
        readonly folder?: unknown
        readonly indexedFiles?: unknown
        readonly workspaceEffect?: unknown
        readonly state?: unknown
        readonly code?: unknown
        readonly failedStep?: unknown
        readonly message?: unknown
      }
      const indexedFiles = browseResult.indexedFiles
      if (
        !(browseResult.folder instanceof vscode.Uri) ||
        typeof indexedFiles !== 'number' ||
        !Number.isSafeInteger(indexedFiles) ||
        indexedFiles < 1 ||
        (browseResult.workspaceEffect !== 'added' &&
          browseResult.workspaceEffect !== 'already-present')
      ) {
        /*
         * The browse command answers a refusal with the same shape it answers a folder with, so
         * carry what it actually said: a receipt that only says "no workspace effect" cannot tell
         * a refused container from an empty index or a workspace that declined the folder.
         */
        throw new TypeError(
          `${caseId} browse command did not publish an Explorer workspace effect: ` +
            JSON.stringify({
              state: browseResult.state,
              code: browseResult.code,
              failedStep: browseResult.failedStep,
              message: browseResult.message,
              indexedFiles: browseResult.indexedFiles,
              workspaceEffect: browseResult.workspaceEffect,
              folder:
                browseResult.folder instanceof vscode.Uri ? 'uri' : typeof browseResult.folder,
              workspaceFolderAnnouncements,
              workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(item =>
                item.uri.scheme === CONTAINER_SCHEME
                  ? `${CONTAINER_SCHEME}:${item.name}`
                  : item.uri.scheme,
              ),
            }),
        )
      }
      // This is the registered `modkit-container:` FileSystemProvider, not an internal index.
      const rootEntries = await vscode.workspace.fs.readDirectory(browseResult.folder)
      const memberUri = vscode.Uri.from({
        scheme: CONTAINER_SCHEME,
        path: containerUriPath(container, requiredEntry),
      })
      const member = await vscode.workspace.fs.stat(memberUri)
      if ((member.type & vscode.FileType.File) === 0) {
        throw new TypeError(
          `${caseId} Explorer filesystem did not expose its exact authority entry`,
        )
      }
      /*
       * This is the laziness boundary, and it is the deterministic one: browsing the container,
       * listing its root and stat'ing the authority entry index it without reading a single
       * member's bytes. Reading the member the visible search selects is what the selection means,
       * so what must never appear afterwards is a read of a member nobody picked. Extractions are
       * scoped to this container because a previous case's editor may still be loading its own.
       */
      const containerExtractions = () =>
        archiveAcceptanceExtractions.filter(item => item.container === container)
      const indexedExtractions = containerExtractions()
      if (indexedExtractions.length !== 0) {
        throw new TypeError(
          `${caseId} read ${indexedExtractions.length} member(s) while indexing its container`,
        )
      }
      const expectedSelection = Object.freeze({
        caseId,
        container: basename(container),
        query,
        requiredEntry,
        selectedUri: memberUri.toString(),
      })
      await persist(
        await packageGateCumulative(
          Object.freeze({
            generation: 3,
            state: 'awaiting-archive-search-picker',
            archiveAcceptance: Object.freeze({
              stage: 'search-picker',
              ...expectedSelection,
            }),
            failures: Object.freeze([]),
            verdict: 'pending',
          }),
        ),
      )
      // This is specifically the normal visible command path. It intentionally supplies no
      // query and no `resultOnly` flag: the external installed harness must type the authority
      // query into InputBox and choose the matching QuickPick row just as a user would.
      const selected = await vscode.commands.executeCommand('modkit.searchContainer', { container })
      if (
        !(selected instanceof vscode.Uri) ||
        selected.toString() !== expectedSelection.selectedUri
      ) {
        throw new TypeError(`${caseId} search UI selected a URI other than its authority entry`)
      }
      const acknowledgement = await waitForArchiveAcceptanceSearchAck({
        path: ackPath,
        artifactSha256,
        ...expectedSelection,
      })
      const foreignExtractions = containerExtractions().filter(item => item.entry !== requiredEntry)
      if (foreignExtractions.length !== 0) {
        throw new TypeError(
          `${caseId} read ${foreignExtractions
            .map(item => item.entry)
            .join(', ')} rather than only its authority entry`,
        )
      }
      record(caseId, {
        browseCommand: 'modkit.browseContainer',
        explorerFileSystem: CONTAINER_SCHEME,
        workspaceEffect: browseResult.workspaceEffect,
        indexedFiles,
        explorerRootEntries: rootEntries.length,
        explorerMember: Object.freeze({
          entry: requiredEntry,
          kind: 'file',
          size: member.size,
        }),
        searchCommand: 'modkit.searchContainer',
        resultOnly: false,
        // `true` only comes from the external CDP acknowledgement above; product code itself
        // observes only the URI returned by its registered command.
        uiPickerObserved:
          acknowledgement.observedBy === 'cdp' &&
          acknowledgement.inputBoxObserved &&
          acknowledgement.quickPickObserved,
        inputBoxObserved: acknowledgement.inputBoxObserved,
        quickPickObserved: acknowledgement.quickPickObserved,
        pickedLabel: acknowledgement.pickedLabel,
        selectedUri: acknowledgement.selectedUri,
        selectedRoute: acknowledgement.selectedRoute,
        query,
        requiredEntry,
        extractionCountWhileIndexing: indexedExtractions.length,
        foreignExtractionCount: foreignExtractions.length,
      })
    }
    const materialize = async (
      caseId: (typeof INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS)[number],
      container: string,
      entry: string,
      targetName: string,
      expected: { readonly bytes: number; readonly sha256: string },
    ) => {
      const target = vscode.Uri.file(join(scratchWorkspace, targetName))
      archiveAcceptanceExtractions.length = 0
      const result = await vscode.commands.executeCommand(
        'modkit.materializeContainerEntry',
        Object.freeze({ container, entry, target }),
      )
      if (!(result instanceof vscode.Uri) || result.fsPath !== target.fsPath) {
        throw new TypeError(`${caseId} did not return its explicit deterministic destination`)
      }
      const extracted = archiveAcceptanceExtractions.find(
        item => item.container === container && item.entry === entry,
      )
      if (extracted === undefined || extracted.bytes !== expected.bytes) {
        throw new TypeError(`${caseId} recorded no exact provider extraction`)
      }
      const evidence = Object.freeze({
        command: 'modkit.materializeContainerEntry',
        dialogBypass: true,
        target: basename(target.fsPath),
        corpus: await digestFile(target.fsPath, expected),
        extraction: extracted,
      })
      materializations.push(Object.freeze({ caseId, ...evidence }))
      record(caseId, evidence)
    }
    const corruptThenCanary = async (
      caseId: (typeof INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS)[number],
      expected: {
        readonly family: 'mpq' | 'casc' | 'wz'
        readonly route: 'file-container' | 'casc-namespace'
        readonly corpusMutation: string
        readonly path: string
        readonly contributionId: string
        readonly formatId: string
      },
    ) => {
      const result = await vscode.commands.executeCommand(
        'modkit.browseContainer',
        vscode.Uri.file(expected.path),
      )
      if (result === null || typeof result !== 'object' || Array.isArray(result)) {
        throw new TypeError(`${caseId} browse command returned no typed refusal`)
      }
      const refusalResult = result as {
        readonly state?: unknown
        readonly command?: unknown
        readonly failedStep?: unknown
        readonly code?: unknown
        readonly message?: unknown
        readonly attemptedCandidates?: unknown
      }
      const attemptedCandidates = Array.isArray(refusalResult.attemptedCandidates)
        ? refusalResult.attemptedCandidates.filter(isAttemptedContainerCandidate).map(value =>
            Object.freeze({
              contributionId: value.contributionId,
              formatIds: Object.freeze([...value.formatIds]),
              state: value.state,
              diagnostics: Object.freeze(
                value.diagnostics.map(diagnostic => Object.freeze({ ...diagnostic })),
              ),
            }),
          )
        : []
      const attempted = attemptedCandidates.find(
        candidate =>
          candidate.contributionId === expected.contributionId &&
          candidate.formatIds.includes(expected.formatId) &&
          candidate.state === 'rejected',
      )
      const diagnostic = attempted?.diagnostics.find(
        item => item.severity === 'error' && item.code.trim() !== '' && item.message.trim() !== '',
      )
      if (
        refusalResult.state !== 'refused' ||
        refusalResult.command !== 'modkit.browseContainer' ||
        refusalResult.failedStep !== 'container-index' ||
        attempted === undefined ||
        diagnostic === undefined
      ) {
        throw new TypeError(`${caseId} accepted a corrupt ${expected.family} container`)
      }
      const canary = await containers.stat(sc2Root, INSTALLED_ARCHIVE_AUTHORITIES.cascDds.entry)
      if (canary.kind !== 'file')
        throw new TypeError(`${caseId} valid CASC canary did not remain openable`)
      record(caseId, {
        family: expected.family,
        route: expected.route,
        corpusMutation: expected.corpusMutation,
        failedStep: refusalResult.failedStep,
        attempted: Object.freeze({
          contributionId: attempted.contributionId,
          formatId: expected.formatId,
          state: attempted.state,
          diagnostic: Object.freeze({ code: diagnostic.code, message: diagnostic.message }),
        }),
        refusal: Object.freeze({
          source: 'candidate-diagnostic',
          code: diagnostic.code,
          message: diagnostic.message,
        }),
        appAlive: Object.freeze({ validCascCanary: true, entry: canary.name }),
      })
    }

    const wte70Path = formatSmokeConfinedPath(
      sc2Root,
      INSTALLED_ARCHIVE_AUTHORITIES.wte70.path,
      'WTE70',
    )
    const rustBucketPath = formatSmokeConfinedPath(
      sc2Root,
      INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.path,
      'RustBucket MPQ',
    )
    const baseWzPath = formatSmokeConfinedPath(
      warzoneRoot,
      INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.container,
      'Warzone base.wz',
    )
    const armodPath = formatSmokeConfinedPath(
      authorityWorkspace,
      INSTALLED_ARCHIVE_AUTHORITIES.armod.path,
      'ARmod',
    )
    await digestFile(wte70Path, INSTALLED_ARCHIVE_AUTHORITIES.wte70)
    await digestFile(rustBucketPath, INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3)
    await digestFile(armodPath, INSTALLED_ARCHIVE_AUTHORITIES.armod)
    const rustBucketMpqPath = join(scratchWorkspace, 'wave2a-rustbucket.mpq')
    copyFileSync(rustBucketPath, rustBucketMpqPath)
    await digestFile(rustBucketMpqPath, INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3)
    granted.add(dirname(sc2Root))
    granted.add(dirname(rustBucketMpqPath))
    granted.add(dirname(baseWzPath))
    granted.add(dirname(armodPath))

    await treeSearchLazy(
      'mpq-tree-search-lazy',
      rustBucketMpqPath,
      'LandingLights_NoLensFlare.m3',
      INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entry,
    )
    await treeSearchLazy(
      'casc-tree-search-lazy',
      sc2Root,
      'alpha2.dds',
      INSTALLED_ARCHIVE_AUTHORITIES.cascDds.entry,
    )
    await treeSearchLazy(
      'wz-tree-search-lazy',
      baseWzPath,
      'cybd_run.pie',
      INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.entry,
    )
    record(
      'casc-dds-nested-open',
      await requireNested(sc2Root, INSTALLED_ARCHIVE_AUTHORITIES.cascDds.entry, {
        formatId: 'dds',
        contributionId: 'modkit/dds',
      }),
    )
    await materialize(
      'casc-dds-materialize',
      sc2Root,
      INSTALLED_ARCHIVE_AUTHORITIES.cascDds.entry,
      'wave2a-casc-alpha2.dds',
      INSTALLED_ARCHIVE_AUTHORITIES.cascDds,
    )
    record(
      'mpq-m3-nested-open',
      await requireNested(rustBucketMpqPath, INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entry, {
        formatId: 'm3',
        contributionId: 'blizzard/m3',
      }),
    )
    await materialize(
      'mpq-m3-materialize',
      rustBucketMpqPath,
      INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entry,
      'wave2a-rustbucket.m3',
      {
        bytes: INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entryBytes,
        sha256: INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entrySha256,
      },
    )
    record(
      'wz-pie-nested-open',
      await requireNested(baseWzPath, INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.entry, {
        formatId: 'warzone-pie',
        contributionId: 'modkit/warzone-pie',
      }),
    )
    await materialize(
      'wz-pie-materialize',
      baseWzPath,
      INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.entry,
      'wave2a-cybd_run.pie',
      INSTALLED_ARCHIVE_AUTHORITIES.warzonePie,
    )

    const wte70Uri = vscode.Uri.file(wte70Path)
    const wte70SaveAsUri = vscode.Uri.file(join(scratchWorkspace, 'wave2a-wte70-save-as.SC2Map'))
    const wte70Source = basename(wte70Path)
    const wte70Target = basename(wte70SaveAsUri.fsPath)
    packageGateArchiveAcceptance = Object.freeze({
      caseId: 'wte70-save-as-reopen',
      stage: 'source-open',
      source: wte70Source,
      target: wte70Target,
      readOnly: false,
      materializations: Object.freeze([...materializations]),
    })
    try {
      // This opens the ordinary installed custom editor.  The harness must see the same live
      // webview through CDP before it authorizes the opt-in bridge below.
      openResource(wte70Uri)
      await persist(
        await packageGateCumulative(
          Object.freeze({
            generation: 3,
            state: 'awaiting-wte70-source-observation',
            archiveAcceptance: Object.freeze({
              caseId: 'wte70-save-as-reopen',
              stage: 'source-open',
              source: wte70Source,
              target: wte70Target,
              materializations: Object.freeze([...materializations]),
            }),
            failures: Object.freeze([]),
            verdict: 'pending',
          }),
        ),
      )
      const sourceAcknowledgement = await waitForArchiveAcceptanceAck({
        path: ackPath,
        artifactSha256,
        stage: 'source-observed',
        source: wte70Source,
        target: wte70Target,
      })
      const document = liveArchiveAcceptanceDocuments.get(wte70Uri.toString())
      const saveLiveDocumentAs = liveArchiveAcceptanceSaver.save
      if (document === undefined || saveLiveDocumentAs === undefined) {
        throw new TypeError('WTE70 source is not a live installed custom document')
      }
      const beforeSaveAs = await digestFile(wte70Path, INSTALLED_ARCHIVE_AUTHORITIES.wte70)
      nativeWriterReceiptForAcceptance = undefined
      const started = Date.now()
      await saveLiveDocumentAs(document, wte70SaveAsUri)
      const saveOperationElapsedMs = Date.now() - started
      const afterSaveAs = await digestFile(wte70Path, INSTALLED_ARCHIVE_AUTHORITIES.wte70)
      const saved = await digestFile(wte70SaveAsUri.fsPath, {
        bytes: INSTALLED_ARCHIVE_AUTHORITIES.wte70.savedBytes,
        sha256: INSTALLED_ARCHIVE_AUTHORITIES.wte70.savedSha256,
      })
      const nativeWriterReceipt = formatSmokeObject(
        nativeWriterReceiptForAcceptance,
        'WTE70 native writer receipt',
      )
      if (
        nativeWriterReceipt.kind !== 'mpq-native-export-receipt-v1' ||
        nativeWriterReceipt.strategy !== 'whole-archive-save-as-fixed-slots' ||
        nativeWriterReceipt.archiveByteIdentity !== 'changed' ||
        nativeWriterReceipt.sourceArchiveDigest !== `sha256:${beforeSaveAs.sha256}` ||
        nativeWriterReceipt.outputArchiveDigest !== `sha256:${saved.sha256}`
      ) {
        throw new TypeError('WTE70 Save As did not return the installed native writer receipt')
      }
      const changed = Array.isArray(nativeWriterReceipt.changed)
        ? nativeWriterReceipt.changed.find(
            item =>
              item !== null &&
              typeof item === 'object' &&
              (item as Record<string, unknown>).path === 'MapScript.galaxy',
          )
        : undefined
      if (changed === undefined) {
        throw new TypeError('WTE70 native writer receipt did not name MapScript.galaxy')
      }
      packageGateArchiveAcceptance = Object.freeze({
        caseId: 'wte70-save-as-reopen',
        stage: 'target-reopen',
        source: wte70Source,
        target: wte70Target,
        readOnly: false,
        materializations: Object.freeze([...materializations]),
      })
      openResource(wte70SaveAsUri)
      await persist(
        await packageGateCumulative(
          Object.freeze({
            generation: 3,
            state: 'awaiting-wte70-target-observation',
            archiveAcceptance: Object.freeze({
              caseId: 'wte70-save-as-reopen',
              stage: 'target-reopen',
              source: wte70Source,
              target: wte70Target,
              materializations: Object.freeze([...materializations]),
            }),
            failures: Object.freeze([]),
            verdict: 'pending',
          }),
        ),
      )
      await waitForArchiveAcceptanceAck({
        path: ackPath,
        artifactSha256,
        stage: 'target-observed',
        source: wte70Source,
        target: wte70Target,
      })
      const elapsedMs = Date.now() - started
      if (elapsedMs >= 60_000) {
        throw new TypeError(
          `WTE70 Save As through confirmed reopen took ${elapsedMs}ms, not under 60s`,
        )
      }
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      record('wte70-save-as-reopen', {
        mode: 'live-provider-bridge',
        acceptanceGated: true,
        cleanCopy: false,
        nativeUserCommandProof: false,
        nativeWriterProof: true,
        classification: 'installed-acceptance-native-writer-save-as',
        modifiedWriterReceiptSha256:
          INSTALLED_ARCHIVE_AUTHORITIES.wte70.modifiedWriterReceiptSha256,
        nativeWriterReceipt,
        nativeUserCommand: sourceAcknowledgement.nativeUserCommand,
        bridge: 'live-custom-document-save-as',
        providerMethod: 'CustomEditorProvider.saveCustomDocumentAs',
        sourceObservedByCdp: true,
        targetObservedByCdp: true,
        sourceUnchanged: beforeSaveAs.sha256 === afterSaveAs.sha256,
        source: beforeSaveAs,
        saved,
        elapsedScope: 'save-as-through-cdp-reopen',
        saveOperationElapsedMs,
        elapsedMs,
        semanticRoute: 'blizzard/sc2-map',
      })
    } finally {
      packageGateArchiveAcceptance = undefined
    }
    const installedWarzoneRoot = managedExtensionState.roots.find(
      root => root.expectedId === INSTALLED_ARCHIVE_AUTHORITIES.armod.route.extensionId,
    )
    if (installedWarzoneRoot === undefined || typeof installedWarzoneRoot.root !== 'string') {
      throw new TypeError('ARmod selected extension has no installed physical root')
    }
    const installedManifestPath = join(installedWarzoneRoot.root, 'package.json')
    const installedManifestBytes = readFileSync(installedManifestPath)
    const installedManifestSha256 = `sha256:${createHash('sha256')
      .update(installedManifestBytes)
      .digest('hex')}`
    if (
      installedManifestSha256 !== INSTALLED_ARCHIVE_AUTHORITIES.armod.route.installedManifestSha256
    ) {
      throw new TypeError(
        `ARmod installed package manifest ${installedManifestSha256} does not match its pinned ` +
          `authority ${INSTALLED_ARCHIVE_AUTHORITIES.armod.route.installedManifestSha256}`,
      )
    }
    const installedManifest = formatSmokeObject(
      JSON.parse(installedManifestBytes.toString('utf8')),
      'installed ARmod extension manifest',
    )
    const installedModkit = formatSmokeObject(
      installedManifest.modkit,
      'installed ARmod modkit manifest',
    )
    if (installedModkit.publisher !== 'wz2100project' || installedModkit.id !== 'warzone-2100') {
      throw new TypeError('ARmod selected root does not contain the installed Warzone manifest')
    }
    const installedContribution = formatSmokeObject(
      JSON.parse(
        readFileSync(
          join(installedWarzoneRoot.root, 'contributions', 'codec-warzone-wz.json'),
          'utf8',
        ),
      ),
      'installed ARmod contribution',
    )
    const installedVariant = Array.isArray(installedContribution.runtimeVariants)
      ? installedContribution.runtimeVariants.find(
          variant =>
            formatSmokeObject(variant, 'installed ARmod runtime variant').variantId ===
            INSTALLED_ARCHIVE_AUTHORITIES.armod.route.variantId,
        )
      : undefined
    if (
      installedContribution.id !== INSTALLED_ARCHIVE_AUTHORITIES.armod.route.contributionId ||
      installedVariant === undefined ||
      formatSmokeObject(installedVariant, 'installed ARmod selected runtime variant').entrypoint !==
        INSTALLED_ARCHIVE_AUTHORITIES.armod.route.entrypoint
    ) {
      throw new TypeError(
        'ARmod installed contribution/entrypoint does not match the selected route',
      )
    }
    await persist(
      await packageGateCumulative(
        Object.freeze({
          generation: 3,
          state: 'awaiting-armod-external-memory-start',
          archiveAcceptance: Object.freeze({
            caseId: 'armod-open',
            stage: 'armod-memory-sampling-start',
            artifactSha256,
            collector: 'Win32_Process',
            requestedSampleIntervalMs: 25,
          }),
          failures: Object.freeze([]),
          verdict: 'pending',
        }),
      ),
    )
    const externalMemoryStart = await waitForArmodProcessTreeMemoryAck({
      path: ackPath,
      artifactSha256,
      stage: 'armod-memory-sampling-start',
    })
    archiveAcceptanceReads.length = 0
    archiveAcceptanceStreams.length = 0
    archiveAcceptanceIoActive = true
    // This is explicitly supplemental: only the external process-tree sampler is authoritative.
    const extensionHostRssBaselineBytes = process.memoryUsage().rss
    let extensionHostRssPeakBytes = extensionHostRssBaselineBytes
    const sampleExtensionHostRss = () => {
      extensionHostRssPeakBytes = Math.max(extensionHostRssPeakBytes, process.memoryUsage().rss)
    }
    const extensionHostRssSampler = setInterval(sampleExtensionHostRss, 25)
    let armod: Awaited<ReturnType<typeof commandOpener>> | undefined
    let armodEvidence:
      | {
          readonly selected: unknown
          readonly selectedRoute: unknown
          readonly selectedDetection: unknown
        }
      | undefined
    let inspection: Readonly<Record<string, unknown>> | undefined
    let externalMemoryStop: Readonly<Record<string, unknown>> | undefined
    let armodOpenFailed = false
    let armodOpenError: unknown
    try {
      const opened = await commandOpener(armodPath)
      armod = opened
      sampleExtensionHostRss()
      if (opened.snapshot.state !== 'opened') {
        throw new TypeError(`ARmod did not open: ${JSON.stringify(opened.snapshot.diagnostics)}`)
      }
      const selected = opened.snapshot.selected
      if (
        selected.contributionId !== INSTALLED_ARCHIVE_AUTHORITIES.armod.route.contributionId ||
        selected.variantId !== INSTALLED_ARCHIVE_AUTHORITIES.armod.route.variantId
      ) {
        throw new TypeError(
          `ARmod selected ${selected.contributionId}/${selected.variantId}, not ` +
            `${INSTALLED_ARCHIVE_AUTHORITIES.armod.route.contributionId}/` +
            `${INSTALLED_ARCHIVE_AUTHORITIES.armod.route.variantId}`,
        )
      }
      const descriptor = await opened.session?.descriptor()
      const codecIdentity = formatSmokeObject(
        descriptor !== undefined && 'identity' in descriptor ? descriptor.identity : undefined,
        'ARmod selected detection identity',
      )
      /*
       * The descriptor's identity names the codec and the format. What binds the route to the
       * package installed in this profile are the bytes on disk: the contribution manifest that
       * declares the codec, and the range codec its variant names as the entrypoint.
       */
      const installedRouteDigest = (relative: string) =>
        `sha256:${createHash('sha256')
          .update(
            readFileSync(
              join(installedWarzoneRoot.root, ...relative.replace(/^\.\//u, '').split('/')),
            ),
          )
          .digest('hex')}`
      const identity = Object.freeze({
        formatId: codecIdentity.formatId,
        codecId: codecIdentity.codecId,
        manifestDigest: installedRouteDigest(
          INSTALLED_ARCHIVE_AUTHORITIES.armod.route.contributionManifest,
        ),
        artifactDigest: installedRouteDigest(INSTALLED_ARCHIVE_AUTHORITIES.armod.route.entrypoint),
      })
      if (
        identity.formatId !== 'warzone-wz' ||
        identity.manifestDigest !== INSTALLED_ARCHIVE_AUTHORITIES.armod.route.manifestDigest ||
        identity.artifactDigest !== INSTALLED_ARCHIVE_AUTHORITIES.armod.route.artifactDigest
      ) {
        throw new TypeError(
          `ARmod selected detection identity does not match installed authority: ${JSON.stringify(identity)}`,
        )
      }
      armodEvidence = Object.freeze({
        selected,
        selectedRoute: opened.snapshot.selectedRoute ?? [],
        selectedDetection: identity,
      })
      const inspect = descriptor?.operations.find(
        operation => operation.id === 'view.inspect' && operation.state === 'available',
      )
      if (inspect === undefined || opened.session === undefined) {
        throw new TypeError('ARmod installed route does not expose view.inspect')
      }
      const inspected = await opened.session.operations().invoke(inspect.handlerId, null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
        throw new TypeError('ARmod installed view.inspect did not return metadata JSON')
      }
      inspection = formatSmokeObject(inspected.output.value, 'ARmod installed inspect result')
      if (
        inspection.inspectionMode !== 'metadata-first-range' ||
        inspection.sourceBytes !== String(INSTALLED_ARCHIVE_AUTHORITIES.armod.bytes) ||
        inspection.metadataBytesRead !== 65_557
      ) {
        throw new TypeError(
          `ARmod installed inspect did not preserve metadata-first authority facts: ${JSON.stringify(
            {
              inspectionMode: inspection.inspectionMode,
              sourceBytes: inspection.sourceBytes,
              metadataBytesRead: inspection.metadataBytesRead,
            },
          )}`,
        )
      }
    } catch (error) {
      armodOpenFailed = true
      armodOpenError = error
    } finally {
      clearInterval(extensionHostRssSampler)
      archiveAcceptanceIoActive = false
      const dispose = Promise.allSettled([Promise.resolve().then(() => armod?.session?.dispose())])
      let externalHandshakeError: unknown
      try {
        await persist(
          await packageGateCumulative(
            Object.freeze({
              generation: 3,
              state: 'awaiting-armod-external-memory-stop',
              archiveAcceptance: Object.freeze({
                caseId: 'armod-open',
                stage: 'armod-memory-sampling-stop',
                artifactSha256,
                collector: 'Win32_Process',
                requestedSampleIntervalMs: 25,
              }),
              failures: Object.freeze([]),
              verdict: 'pending',
            }),
          ),
        )
        externalMemoryStop = await waitForArmodProcessTreeMemoryAck({
          path: ackPath,
          artifactSha256,
          stage: 'armod-memory-sampling-stop',
        })
      } catch (error) {
        externalHandshakeError = error
      }
      const [disposeResult] = await dispose
      if (armodOpenFailed) throw armodOpenError
      if (externalHandshakeError !== undefined) throw externalHandshakeError
      if (disposeResult.status === 'rejected') throw disposeResult.reason
    }
    if (armodEvidence === undefined || inspection === undefined || externalMemoryStop === undefined)
      throw new TypeError('ARmod opened without route/metadata evidence')
    const metadataIo = Object.freeze({
      readCount: archiveAcceptanceReads.length,
      bytes: archiveAcceptanceReads.reduce((total, item) => total + item.bytes, 0),
      maxReadBytes: archiveAcceptanceReads.reduce(
        (maximum, item) => Math.max(maximum, item.bytes),
        0,
      ),
      streamCount: archiveAcceptanceStreams.length,
    })
    if (
      metadataIo.readCount !== INSTALLED_ARCHIVE_AUTHORITIES.armod.metadataIo.readCount ||
      metadataIo.bytes !== INSTALLED_ARCHIVE_AUTHORITIES.armod.metadataIo.bytes ||
      metadataIo.maxReadBytes !== INSTALLED_ARCHIVE_AUTHORITIES.armod.metadataIo.maxReadBytes ||
      metadataIo.streamCount !== INSTALLED_ARCHIVE_AUTHORITIES.armod.metadataIo.streamCount
    ) {
      throw new TypeError(`ARmod installed metadata I/O differed: ${JSON.stringify(metadataIo)}`)
    }
    sampleExtensionHostRss()
    const extensionHostRssDeltaBytes = extensionHostRssPeakBytes - extensionHostRssBaselineBytes
    if (extensionHostRssDeltaBytes > ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES) {
      throw new TypeError(
        `ARmod installed extension-host RSS delta ${extensionHostRssDeltaBytes} exceeds ${ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES}`,
      )
    }
    record('armod-open', {
      ...armodEvidence,
      installedManifestSha256,
      entrypoint: formatSmokeObject(installedVariant, 'installed ARmod selected runtime variant')
        .entrypoint,
      inspection,
      metadataIo,
      externalProcessTreeMemory: Object.freeze({
        startAcknowledgement: externalMemoryStart,
        stopAcknowledgement: externalMemoryStop,
      }),
      extensionHostRss: Object.freeze({
        source: 'process.memoryUsage().rss',
        baselineBytes: extensionHostRssBaselineBytes,
        peakBytes: extensionHostRssPeakBytes,
        deltaBytes: extensionHostRssDeltaBytes,
        deltaCeilingBytes: ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES,
      }),
    })

    const corruptRoot = join(scratchWorkspace, 'wave2a-corrupt-casc')
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(corruptRoot))
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(join(corruptRoot, 'SC2Data')))
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(join(corruptRoot, 'SC2Data', 'config')),
    )
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(join(corruptRoot, 'SC2Data', 'data')))
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(join(corruptRoot, 'SC2Data', 'indices')),
    )
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(join(corruptRoot, 'Data.000')),
      Uint8Array.of(0),
    )
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(join(corruptRoot, '.build.info')),
      new TextEncoder().encode('Build Key\tCDN Key\nmalformed\t'),
    )
    const corruptMpq = join(scratchWorkspace, 'wave2a-corrupt.SC2Map')
    const corruptWz = join(scratchWorkspace, 'wave2a-corrupt.wz')
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(corruptMpq),
      // MPQ\x1a followed by a deliberately truncated header/table region.
      Uint8Array.of(0x4d, 0x50, 0x51, 0x1a, 0x20, 0x00, 0x00, 0x00),
    )
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(corruptWz),
      // A ZIP local-file header that ends before its declared archive can be read.
      Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00),
    )
    await corruptThenCanary('corrupt-mpq-then-canary', {
      family: 'mpq',
      route: 'file-container',
      corpusMutation: 'MPQ\\x1a header with a truncated archive/table region',
      path: corruptMpq,
      contributionId: 'blizzard/mpq',
      formatId: 'mpq',
    })
    // This is intentionally the CASC-only directory branch, never a generic directory subject.
    await corruptThenCanary('corrupt-casc-then-canary', {
      family: 'casc',
      route: 'casc-namespace',
      corpusMutation: 'CASC marker namespace with malformed build info/config/data/indices',
      path: corruptRoot,
      contributionId: 'blizzard/casc',
      formatId: 'casc',
    })
    await corruptThenCanary('corrupt-wz-then-canary', {
      family: 'wz',
      route: 'file-container',
      corpusMutation: 'ZIP local-file header truncated before a complete WZ archive directory',
      path: corruptWz,
      contributionId: 'modkit/warzone-wz',
      formatId: 'warzone-wz',
    })

    if (cases.length !== INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS.length) {
      throw new TypeError('archive acceptance did not record every required case')
    }
    return Object.freeze({
      kind: 'x3.vscode-installed-archive-acceptance',
      schemaVersion: 1,
      artifactSha256,
      expectedCases: INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS,
      cases: Object.freeze(cases),
      failures: Object.freeze([]),
      verdict: 'pass' as const,
    })
  }
  const packageInstallGateReceipt = async (
    persist: (value: unknown) => Promise<void> = async () => undefined,
  ) => {
    const generation = Number(process.env[PACKAGE_INSTALL_GATE_GENERATION_ENV])
    const artifactSha256 = process.env[PACKAGE_INSTALL_GATE_ARTIFACT_ENV] ?? ''
    const failures: { code: string; message: string }[] = []
    packageGateAssert(
      Number.isInteger(generation) && generation >= 1 && generation <= 3,
      failures,
      'x3.acceptance/package-gate-generation-invalid',
      `${PACKAGE_INSTALL_GATE_GENERATION_ENV} must be 1, 2 or 3`,
    )
    packageGateAssert(
      /^sha256:[a-f0-9]{64}$/u.test(artifactSha256),
      failures,
      'x3.acceptance/package-gate-artifact-sha-invalid',
      `${PACKAGE_INSTALL_GATE_ARTIFACT_ENV} must be sha256: followed by exactly 64 lowercase hex characters`,
    )
    packageGateAssert(
      context.extensionMode !== vscode.ExtensionMode.Development,
      failures,
      'x3.acceptance/extension-development-host-refused',
      'the package/install gate must run from an ordinarily installed VSIX',
    )
    packageGateAssert(
      (process.env.MODKIT_EXTENSION_REGISTRY ?? '') === '',
      failures,
      'x3.acceptance/registry-env-not-cleared',
      'MODKIT_EXTENSION_REGISTRY must be cleared for installed offline acceptance',
    )

    const actions: unknown[] = []
    let catalog: unknown
    let formatSmoke: unknown
    let archiveAcceptance: unknown
    if (failures.length === 0 && generation === 1) {
      const envelope = (await nodeExtensionManager.catalogSource.refresh()) as
        | {
            readonly catalog?: {
              readonly packages?: readonly { readonly id: string }[]
            }
            readonly source?: string
            readonly signatureVerified?: boolean
          }
        | undefined
      if (envelope?.catalog?.packages === undefined) {
        failures.push(
          packageGateFailure(
            'x3.acceptance/offline-catalog-refresh-empty',
            'offline catalog refresh returned no catalog envelope',
          ),
        )
      }
      catalog = Object.freeze({
        source: envelope?.source,
        signatureVerified: envelope?.signatureVerified === true,
        packages: Object.freeze((envelope?.catalog?.packages ?? []).map(item => item.id).sort()),
      })
      extensionManager.invalidate()
      const snapshot = await packageGateSnapshotSummary()
      packageGateAssert(
        envelope?.signatureVerified === true,
        failures,
        'x3.acceptance/offline-catalog-signature-unverified',
        'offline catalog refresh did not verify the packaged Ed25519 signature',
      )
      packageGateAssert(
        JSON.stringify(snapshot.trustedAvailableEntries) === JSON.stringify(packageGatePackageIds),
        failures,
        'x3.acceptance/offline-available-packages-mismatch',
        `expected trusted Available packages ${packageGatePackageIds.join(', ')}, found ${snapshot.trustedAvailableEntries.join(', ')}`,
      )
      packageGateAssert(
        snapshot.checkoutEntries.length === 0,
        failures,
        'x3.acceptance/checkout-source-visible',
        `package/install gate saw checkout-local entries: ${snapshot.checkoutEntries.join(', ')}`,
      )
      for (const availability of snapshot.gameAvailability) {
        packageGateAssert(
          availability.state === 'available',
          failures,
          'x3.acceptance/game-extension-not-available',
          `${availability.game.displayName} (${availability.game.id}) is not Available in the installed offline catalog snapshot`,
        )
      }
      if (failures.length === 0) {
        actions.push(
          await packageGateAction('install-blizzard', {
            kind: 'install',
            id: packageGateBlizzardPackage,
          }),
        )
        actions.push(
          await packageGateAction('install-warzone', {
            kind: 'install',
            id: packageGateWarzonePackage,
          }),
        )
        actions.push(
          await packageGateAction('enable-blizzard', {
            kind: 'set-enabled',
            id: packageGateBlizzardPackage,
            enabled: true,
          }),
        )
        actions.push(
          await packageGateAction('enable-warzone', {
            kind: 'set-enabled',
            id: packageGateWarzonePackage,
            enabled: true,
          }),
        )
        actions.push(
          await packageGateAction('disable-blizzard', {
            kind: 'set-enabled',
            id: packageGateBlizzardPackage,
            enabled: false,
          }),
        )
        actions.push(
          await packageGateAction('keep-warzone-enabled', {
            kind: 'set-enabled',
            id: packageGateWarzonePackage,
            enabled: true,
          }),
        )
        packageGateAssertActionsRefreshed(actions, failures)
      }
    }

    if (failures.length === 0 && generation === 2) {
      const before = await packageGateSnapshotSummary()
      const hostModel = packageGateHostModel()
      packageGateAssert(
        before.managed.find(entry => entry.id === packageGateBlizzardPackage)?.enabled === false,
        failures,
        'x3.acceptance/blizzard-disabled-state-not-persisted',
        'generation 2 did not start with Blizzard disabled',
      )
      packageGateAssert(
        before.managed.find(entry => entry.id === packageGateWarzonePackage)?.enabled === true,
        failures,
        'x3.acceptance/warzone-enabled-state-not-persisted',
        'generation 2 did not start with Warzone enabled',
      )
      packageGateAssert(
        hostModel.disabledManagedRoots > 0 && hostModel.blizzardRootsInInventory.length > 0,
        failures,
        'x3.acceptance/disabled-blizzard-inventory-missing',
        'host did not keep disabled Blizzard roots in inventory on restart',
      )
      const disabledUri = process.env[PACKAGE_INSTALL_GATE_DISABLED_URI_ENV]
      const disabledProbe = {
        uriSupplied: disabledUri !== undefined && disabledUri.trim() !== '',
        opened: false,
        awaitingContinuation: false,
        continuation: process.env[PACKAGE_INSTALL_GATE_CONTINUE_ENV] ?? null,
        observedDiagnostics: [] as { code: string; message: string }[],
        diagnostics: [] as { code: string; message: string }[],
      }
      if (disabledUri === undefined || disabledUri.trim() === '') {
        failures.push(
          packageGateFailure(
            'x3.acceptance/disabled-route-uri-missing',
            `${PACKAGE_INSTALL_GATE_DISABLED_URI_ENV} must supply a real disabled Blizzard route`,
          ),
        )
      } else {
        const beforeDiagnostics = publishedSubjectDiagnostics.length
        openResource(vscode.Uri.parse(disabledUri))
        disabledProbe.opened = true
        const deadline = Date.now() + 60_000
        while (Date.now() < deadline) {
          const observed = publishedSubjectDiagnostics.slice(beforeDiagnostics).map(item => ({
            code: item.code,
            message: item.message,
          }))
          disabledProbe.observedDiagnostics = observed
          const diagnostics = observed.filter(
            item =>
              item.code === 'x3.host/candidate-suppressed' &&
              item.message.includes('x3.host/extension-disabled'),
          )
          if (diagnostics.length > 0) {
            disabledProbe.diagnostics = diagnostics.map(item => ({
              code: item.code,
              message: item.message,
            }))
            break
          }
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
        }
        if (disabledProbe.diagnostics.length === 0) {
          failures.push(
            packageGateFailure(
              'x3.acceptance/disabled-route-suppression-missing',
              `disabled route did not publish x3.host/candidate-suppressed containing x3.host/extension-disabled; observed ${JSON.stringify(disabledProbe.observedDiagnostics)}`,
            ),
          )
        } else {
          packageGateDisabledProbeAcceptance = Object.freeze({
            diagnostics: disabledProbe.diagnostics,
          })
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
          openResource(vscode.Uri.parse(disabledUri))
        }
      }
      if (failures.length === 0) {
        disabledProbe.awaitingContinuation = true
        const awaitingPhase = await packageGateCumulative(
          Object.freeze({
            generation,
            state: 'awaiting-continuation',
            catalog,
            before,
            host: hostModel,
            disabledProbe,
            actions,
            failures,
            verdict: 'pending',
          }),
        )
        await persist(awaitingPhase)
        const continuationPath = process.env[PACKAGE_INSTALL_GATE_CONTINUE_ENV]
        if (
          continuationPath === undefined ||
          continuationPath.trim() === '' ||
          !(await waitForPackageGateContinuation(continuationPath))
        ) {
          failures.push(
            packageGateFailure(
              'x3.acceptance/package-gate-continuation-missing',
              'external continuation sentinel was not observed after disabled-route proof',
            ),
          )
        }
        if (failures.length === 0) {
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
        }
      }
      if (failures.length === 0) {
        actions.push(
          await packageGateAction('enable-blizzard-after-disabled-probe', {
            kind: 'set-enabled',
            id: packageGateBlizzardPackage,
            enabled: true,
          }),
        )
        actions.push(
          await packageGateAction('remove-blizzard', {
            kind: 'remove',
            id: packageGateBlizzardPackage,
          }),
        )
        actions.push(
          await packageGateAction('remove-warzone', {
            kind: 'remove',
            id: packageGateWarzonePackage,
          }),
        )
        const emptyState = await packageGateSnapshotSummary()
        const emptyStores = await packageGateStores()
        packageGateAssert(
          JSON.stringify(emptyState.trustedAvailableEntries) ===
            JSON.stringify(packageGatePackageIds),
          failures,
          'x3.acceptance/available-state-not-restored',
          'removing both packages did not restore exact trusted Available state',
        )
        packageGateAssert(
          emptyStores.materialized.length === 0 && emptyStores.enablement.length === 0,
          failures,
          'x3.acceptance/manager-state-not-empty-after-remove',
          `expected empty materialized/enablement stores, found ${JSON.stringify(emptyStores)}`,
        )
        actions.push(
          await packageGateAction('reinstall-blizzard', {
            kind: 'install',
            id: packageGateBlizzardPackage,
          }),
        )
        actions.push(
          await packageGateAction('reinstall-warzone', {
            kind: 'install',
            id: packageGateWarzonePackage,
          }),
        )
        actions.push(
          await packageGateAction('enable-blizzard-final', {
            kind: 'set-enabled',
            id: packageGateBlizzardPackage,
            enabled: true,
          }),
        )
        actions.push(
          await packageGateAction('enable-warzone-final', {
            kind: 'set-enabled',
            id: packageGateWarzonePackage,
            enabled: true,
          }),
        )
        packageGateAssertActionsRefreshed(actions, failures)
      }
    }

    if (failures.length === 0 && generation === 3) {
      const before = await packageGateSnapshotSummary()
      const hostModel = packageGateHostModel()
      packageGateAssert(
        before.managed.length === 2 && before.managed.every(entry => entry.enabled === true),
        failures,
        'x3.acceptance/final-enabled-state-not-persisted',
        'generation 3 did not start with both managed packages enabled',
      )
      packageGateAssert(
        hostModel.bundledRoots === 8 &&
          hostModel.installedRoots === 9 &&
          packageGateSameList(hostModel.bundledRootIds, packageGateExpectedCommonRoots) &&
          packageGateSameList(hostModel.installedRootIds, packageGateExpectedExternalRoots),
        failures,
        'x3.acceptance/final-host-root-count-mismatch',
        `expected exact Common 8 + external 9 roots, found Common ${JSON.stringify(hostModel.bundledRootIds)} + external ${JSON.stringify(hostModel.installedRootIds)}`,
      )
      packageGateAssert(
        hostModel.extensionLoadFailures.length === 0 && hostModel.bundledLoadFailures.length === 0,
        failures,
        'x3.acceptance/final-host-load-failures',
        `expected zero host load failures, found ${JSON.stringify({
          bundled: hostModel.bundledLoadFailures,
          extensions: hostModel.extensionLoadFailures,
        })}`,
      )
      packageGateAssert(
        hostModel.contributionCount > 0 && packageGateCardModel().count > 0,
        failures,
        'x3.acceptance/final-host-card-model-empty',
        'generation 3 host/card model did not expose any contributions or cards',
      )
      if (failures.length === 0) {
        try {
          formatSmoke = await runInstalledFormatSmoke(artifactSha256, persist)
        } catch (error) {
          failures.push(
            packageGateFailure(
              'x3.acceptance/installed-format-smoke-failed',
              error instanceof Error ? error.message : String(error),
            ),
          )
        }
      }
      if (failures.length === 0) {
        try {
          archiveAcceptance = await runInstalledArchiveAcceptance(artifactSha256, persist)
        } catch (error) {
          failures.push(
            packageGateFailure(
              'x3.acceptance/installed-archive-acceptance-failed',
              error instanceof Error ? error.message : String(error),
            ),
          )
        }
      }
    }

    const phase = Object.freeze({
      generation,
      state: 'complete',
      catalog,
      snapshot: await packageGateSnapshotSummary(),
      cards: packageGateCardModel(),
      host: packageGateHostModel(),
      stores: await packageGateStores(),
      ...(formatSmoke === undefined ? {} : { formatSmoke }),
      ...(archiveAcceptance === undefined ? {} : { archiveAcceptance }),
      actions: Object.freeze(actions),
      changeEventCount: packageGateChangeEvents,
      failures: Object.freeze(failures),
      verdict: failures.length === 0 ? ('pass' as const) : ('fail' as const),
    })
    return packageGateCumulative(phase)
  }
  const writePackageInstallGateReceipt = async () => {
    let gateReceipt: unknown
    try {
      gateReceipt = await packageInstallGateReceipt(writePackageGateReceipt)
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
    await writePackageGateReceipt(gateReceipt)
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '_modkit.acceptance.packageInstallGate',
      packageInstallGateReceipt,
    ),
  )
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
          // Not installed here, so this window knows no formats for it; only inventory rows do.
          fileExtensions: [],
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
  const publishedSubjectDiagnostics: {
    readonly code: string
    readonly message: string
    readonly severity: 'error' | 'warning' | 'information' | 'hint'
    readonly path?: string
  }[] = []

  const publishDiagnostic = (item: {
    readonly code: string
    readonly message: string
    readonly severity: 'error' | 'warning' | 'information' | 'hint'
    readonly path?: string
  }): void => {
    publishedSubjectDiagnostics.push(item)
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

  const live = new Set<VsCodeServed>()
  const liveSubjects = new Map<VsCodeServed, string | undefined>()
  const languageSubjectCandidates: SubjectCandidateProviderSource = Object.freeze({
    async open(scope: SubjectCandidateScope, signal?: AbortSignal) {
      let requested: VsCodeSubjectCandidateScope
      try {
        requested = subjectCandidateScopeOf(vscode.Uri.parse(scope.uri, true))
      } catch {
        return undefined
      }
      const selected = selectScopedSubjectCandidates(
        requested,
        [...liveSubjects].flatMap(([served, path]) => {
          if (path === undefined) return []
          return [
            {
              ...subjectCandidateScopeOf(subjectUriOf(path)),
              available: served.hasSubjectCandidates(),
              open: (openSignal?: AbortSignal) => served.openSubjectCandidates(openSignal),
            },
          ]
        }),
      )
      return selected?.open(signal)
    },
  })

  const languageDocumentSource: LanguageWorkspaceDocumentSource = Object.freeze({
    async snapshot(request: Parameters<LanguageWorkspaceDocumentSource['snapshot']>[0]) {
      request.signal.throwIfAborted()
      const accepted = new Set(request.workspaceLanguageIds)
      const extensions = [
        ...new Set(
          languageRoutes.flatMap(route =>
            accepted.has(route.languageId) && route.extension !== undefined
              ? [route.extension]
              : [],
          ),
        ),
      ].sort()
      if (extensions.length === 0 || request.maxDocuments === 0) {
        return { documents: Object.freeze([]), isComplete: extensions.length === 0 }
      }
      // The document under the cursor is open too, and the host rejects a snapshot that repeats it.
      const openUris = new Set([
        request.document.uri,
        ...request.workspaceDocuments.map(document => document.uri),
      ])
      const candidates = new Map<string, { readonly uri: vscode.Uri; readonly extension: string }>()
      let isComplete = true
      for (const extension of extensions) {
        request.signal.throwIfAborted()
        const remaining = request.maxDocuments - candidates.size
        if (remaining <= 0) {
          isComplete = false
          break
        }
        const uris = await vscode.workspace.findFiles(
          `**/*.${extension}`,
          '**/{node_modules,.git}/**',
          remaining + 1,
        )
        if (uris.length > remaining) isComplete = false
        for (const uri of uris.slice(0, remaining)) {
          if (openUris.has(uri.toString())) continue
          candidates.set(uri.toString(), { uri, extension })
        }
      }
      /*
       * Order decides what survives the byte budget. Files of the edited document's own kind come
       * first — a layout resolves its templates against other layouts — and the rest are interleaved
       * by extension so one large kind cannot spend the remainder alone.
       */
      const primaryExtension = request.document.uri.split('.').at(-1)?.toLowerCase()
      const byExtension = new Map<
        string,
        { readonly uri: vscode.Uri; readonly extension: string }[]
      >()
      for (const candidate of [...candidates.values()].sort((left, right) =>
        left.uri.toString().localeCompare(right.uri.toString()),
      ))
        byExtension.set(candidate.extension, [
          ...(byExtension.get(candidate.extension) ?? []),
          candidate,
        ])
      const ranked = [...(byExtension.get(primaryExtension ?? '') ?? [])]
      const others = [...byExtension.entries()]
        .filter(([extension]) => extension !== primaryExtension)
        .map(([, list]) => list)
      for (let index = 0; others.some(list => index < list.length); index += 1)
        for (const list of others) {
          const candidate = list[index]
          if (candidate !== undefined) ranked.push(candidate)
        }
      const documents = []
      let totalTextBytes = 0
      for (const candidate of ranked.slice(0, request.maxDocuments)) {
        request.signal.throwIfAborted()
        const document = await vscode.workspace.openTextDocument(candidate.uri)
        const routedLanguageIds = [
          ...new Set(
            languageRoutes.flatMap(route =>
              accepted.has(route.languageId) && route.extension === candidate.extension
                ? [route.languageId]
                : [],
            ),
          ),
        ]
        const languageId = accepted.has(document.languageId)
          ? document.languageId
          : routedLanguageIds.length === 1
            ? routedLanguageIds[0]
            : undefined
        if (languageId === undefined) {
          // `.xml` and `.txt` commonly have several SC2 meanings. Extension-only routing would
          // inject the wrong semantic document, so leave the snapshot honestly incomplete.
          isComplete = false
          continue
        }
        const text = document.getText()
        const bytes = new TextEncoder().encode(text).byteLength
        if (bytes > 4_194_304 || totalTextBytes + bytes > 67_108_864) {
          isComplete = false
          continue
        }
        totalTextBytes += bytes
        documents.push(
          Object.freeze({
            uri: candidate.uri.toString(),
            languageId,
            version: document.version,
            text,
          }),
        )
      }
      return { documents: Object.freeze(documents), isComplete }
    },
  })

  /*
   * The languages a document is read together with, as its own language provider declares them.
   * A page shown in a custom editor has no TextDocument, so the route is found by extension; the
   * provider's opt-in (a layout reads style sheets and strings) is what the language features use
   * too, so a preview and a hover see the same neighbours.
   */
  const workspaceLanguagesFor = async (
    languageId: string | undefined,
    extension: string | undefined,
  ): Promise<readonly string[]> => {
    const route =
      languageRoutes.find(item => item.languageId === languageId) ??
      languageRoutes.find(item => extension !== undefined && item.extension === extension)
    if (route === undefined) return languageId === undefined ? [] : [languageId]
    const resolution = await resolveLanguageProvider({
      ...route,
      services: host.services,
      grant: { id: 'modkit.app.vscode/language', classes: [] },
      budgets: LANGUAGE_ACTIVATION_BUDGET,
    })
    if (resolution.state !== 'resolved') return [route.languageId]
    const accepted = resolution.provider.workspaceLanguageIds ?? []
    await resolution.release()
    return [route.languageId, ...accepted.filter(item => item !== route.languageId)]
  }

  const languageWorkspace = createLanguageWorkspace({
    services: host.services,
    grant: { id: 'modkit.app.vscode/language', classes: [] },
    budgets: LANGUAGE_ACTIVATION_BUDGET,
    subjectCandidates: languageSubjectCandidates,
    documentSource: languageDocumentSource,
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

  const languageDiagnosticSeverity = (
    severity: vscode.DiagnosticSeverity,
  ): 'error' | 'warning' | 'information' | 'hint' => {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'error'
      case vscode.DiagnosticSeverity.Warning:
        return 'warning'
      case vscode.DiagnosticSeverity.Hint:
        return 'hint'
      default:
        return 'information'
    }
  }

  const diagnosticCode = (diagnostic: vscode.Diagnostic): string | undefined => {
    if (diagnostic.code === undefined) return undefined
    if (typeof diagnostic.code === 'object') return String(diagnostic.code.value)
    return String(diagnostic.code)
  }

  const nativeCodeActionKind = (kind: string): vscode.CodeActionKind | undefined => {
    switch (kind) {
      case 'quickfix':
        return vscode.CodeActionKind.QuickFix
      case 'refactor':
        return vscode.CodeActionKind.Refactor
      case 'refactor.extract':
        return vscode.CodeActionKind.RefactorExtract
      case 'refactor.inline':
        return vscode.CodeActionKind.RefactorInline
      case 'rewrite':
        return vscode.CodeActionKind.RefactorRewrite
      case 'source':
        return vscode.CodeActionKind.Source
      default:
        return undefined
    }
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
      vscode.languages.registerCodeActionsProvider(
        languageSelector,
        {
          async provideCodeActions(document, range, context, token) {
            const cancellation = signalFor(token)
            try {
              const diagnostics = context.diagnostics.map(item => {
                const code = diagnosticCode(item)
                return {
                  range: {
                    start: { line: item.range.start.line, character: item.range.start.character },
                    end: { line: item.range.end.line, character: item.range.end.character },
                  },
                  severity: languageDiagnosticSeverity(item.severity),
                  message: item.message,
                  ...(code === undefined ? {} : { code }),
                  ...(item.source === undefined ? {} : { source: item.source }),
                }
              })
              const result = await languageController.codeActions(
                languageDocument(document),
                {
                  start: { line: range.start.line, character: range.start.character },
                  end: { line: range.end.line, character: range.end.character },
                },
                diagnostics,
                cancellation.signal,
              )
              return result?.actions.map(item => {
                const action = new vscode.CodeAction(
                  item.title,
                  nativeCodeActionKind(item.kind ?? ''),
                )
                if (item.isPreferred !== undefined) action.isPreferred = item.isPreferred
                if (item.disabledReason !== undefined)
                  action.disabled = { reason: item.disabledReason }
                if (item.diagnosticCodes !== undefined) {
                  const codes = new Set(item.diagnosticCodes)
                  action.diagnostics = context.diagnostics.filter(candidate => {
                    const code = diagnosticCode(candidate)
                    return code !== undefined && codes.has(code)
                  })
                }
                if (item.edit !== undefined) {
                  const edit = new vscode.WorkspaceEdit()
                  for (const change of item.edit.documentChanges) {
                    edit.set(
                      vscode.Uri.parse(change.uri),
                      change.edits.map(candidate =>
                        vscode.TextEdit.replace(rangeOf(candidate.range), candidate.newText),
                      ),
                    )
                  }
                  action.edit = edit
                }
                return action
              })
            } catch (error) {
              if (token.isCancellationRequested) return undefined
              log(
                `[language] code actions failed: ${error instanceof Error ? error.message : String(error)}`,
              )
              return undefined
            } finally {
              cancellation.dispose()
            }
          },
        },
        {
          providedCodeActionKinds: [
            vscode.CodeActionKind.QuickFix,
            vscode.CodeActionKind.Refactor,
            vscode.CodeActionKind.RefactorExtract,
            vscode.CodeActionKind.RefactorInline,
            vscode.CodeActionKind.RefactorRewrite,
            vscode.CodeActionKind.Source,
          ],
        },
      ),
      vscode.languages.registerColorProvider(languageSelector, {
        async provideDocumentColors(document, token) {
          const cancellation = signalFor(token)
          try {
            const result = await languageController.documentColors(
              languageDocument(document),
              cancellation.signal,
            )
            return result?.colors.map(
              item =>
                new vscode.ColorInformation(
                  rangeOf(item.range),
                  new vscode.Color(
                    item.color.red,
                    item.color.green,
                    item.color.blue,
                    item.color.alpha,
                  ),
                ),
            )
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] document colours failed: ${error instanceof Error ? error.message : String(error)}`,
            )
            return undefined
          } finally {
            cancellation.dispose()
          }
        },
        async provideColorPresentations(color, context, token) {
          const cancellation = signalFor(token)
          try {
            const result = await languageController.colorPresentations(
              languageDocument(context.document),
              { red: color.red, green: color.green, blue: color.blue, alpha: color.alpha },
              {
                start: { line: context.range.start.line, character: context.range.start.character },
                end: { line: context.range.end.line, character: context.range.end.character },
              },
              cancellation.signal,
            )
            return result?.presentations.map(item => {
              const presentation = new vscode.ColorPresentation(item.label)
              if (item.textEdit !== undefined) {
                presentation.textEdit = vscode.TextEdit.replace(
                  rangeOf(item.textEdit.range),
                  item.textEdit.newText,
                )
              }
              return presentation
            })
          } catch (error) {
            if (token.isCancellationRequested) return undefined
            log(
              `[language] colour presentation failed: ${error instanceof Error ? error.message : String(error)}`,
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
                if (item.replacementRange !== undefined)
                  native.range = rangeOf(item.replacementRange)
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
  const attach = (
    webview: vscode.Webview,
    openPath?: string,
    lifecycle?: {
      readonly onDirty: (path: string, dirty: boolean) => void
      readonly onSaveRequested: (path: string) => void
      /** One committed edit in a view with its own history; one editor undo-stack entry. */
      readonly onEdited?: (path: string) => void
    },
    extensionCard?: import('./extension-cards.js').ExtensionCardBundle,
    extensionCardResources?: import('./extension-cards.js').ExtensionCardResourceTargets,
    extensionCardIconPath?: string,
    forcedStage?: string,
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
      ...(openPath === undefined
        ? {}
        : {
            viewerStatus: (items, choose) =>
              viewerStatusBar.set(subjectKey(openPath), items, choose),
          }),
      openInEditor: async path => {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path))
      },
      /*
       * The same bounded snapshot the language features run on, for the operations that need it.
       * A template names a template in another file and a localized value renders through the
       * mod's style sheet; both are invoked on one open document and would otherwise report
       * everything around them as missing.
       */
      async readWorkspaceDocuments(request) {
        const uri = request.path === undefined ? undefined : vscode.Uri.file(request.path)
        const open =
          uri === undefined
            ? undefined
            : vscode.workspace.textDocuments.find(item => item.uri.toString() === uri.toString())
        const languageIds =
          request.languageIds ??
          (await workspaceLanguagesFor(
            open?.languageId,
            request.path?.split('.').at(-1)?.toLowerCase(),
          ))
        if (languageIds.length === 0) return { documents: [], isComplete: false }
        const primary = {
          uri: uri?.toString() ?? '',
          languageId: languageIds[0] as string,
          version: open?.version ?? 1,
          text: open?.getText() ?? '',
        }
        const controller = new AbortController()
        const snapshot = await languageDocumentSource.snapshot({
          document: primary,
          workspaceDocuments: [primary],
          workspaceLanguageIds: languageIds,
          maxDocuments: Math.min(request.maxDocuments ?? 1_024, 1_024),
          signal: controller.signal,
        })
        return { documents: snapshot.documents, isComplete: snapshot.isComplete }
      },
      exportFiles: files => exportViewerFiles(files),
      configuration,
      mapPreviewResourcePlanResolver,
      localizer,
      // The window's one registry, so a page opening a member reaches the archive the Explorer
      // already has open rather than a second copy of it.
      containers,
      readContentSource,
      ...(lifecycle === undefined
        ? {}
        : {
            onDocumentDirty: lifecycle.onDirty,
            onDocumentSaveRequested: lifecycle.onSaveRequested,
            ...(lifecycle.onEdited === undefined ? {} : { onDocumentEdited: lifecycle.onEdited }),
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
      acceptance: webviewAcceptance(),
      ...(openPath === undefined ? {} : { openPath }),
      ...(forcedStage === undefined ? {} : { forcedStage }),
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
    readonly kind: 'file' | 'container-entry' | 'source-entry'
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
   * The same subject and generic service commands the CLI and protocol adapters run.
   *
   * Nothing about them is written here: the descriptors, what each one does, and how a missing
   * operation is reported all live in `@modkit/host`. This is the editor-shaped half — a
   * palette entry, a progress notification, a cancellation token — and it is the only half that
   * should ever differ between the three applications.
   */
  const commandRuntime = createModkitCommandRuntime()
  const commandOpener = commandSubjectsFrom(
    createVsCodeCommandOpener({
      readContentSource,
      services: host.services,
      roots,
      containers,
      onRead: event => {
        if (archiveAcceptanceIoActive) archiveAcceptanceReads.push(event)
      },
      onStream: event => {
        if (archiveAcceptanceIoActive) archiveAcceptanceStreams.push(event)
      },
    }),
  )
  const serviceOperationServices = Object.freeze({
    ...host.services,
    target: host.services.host.target,
  })
  const serviceOperationGrant = Object.freeze({
    id: 'modkit-vscode-service-operations',
    classes: Object.freeze([]),
  })

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
    readonly subject?: string
    readonly entry?: string
    readonly target?: string
    readonly operationId?: string
    readonly operationInput?: CommandInput[string]
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
              ...(request.subject === undefined ? {} : { subject: request.subject }),
              ...(request.entry === undefined ? {} : { entry: request.entry }),
              ...(request.target === undefined ? {} : { target: request.target }),
              ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
              ...(request.operationInput === undefined
                ? {}
                : { operationInput: request.operationInput }),
            },
            {
              openSubject: commandOpener,
              serviceOperations: {
                catalog: request =>
                  discoverServiceOperations({
                    services: serviceOperationServices,
                    alternateTargets: [host.services.target],
                    grant: serviceOperationGrant,
                    budgets: SERVICE_OPERATION_BUDGET,
                    offset: request.offset,
                    limit: request.limit,
                    activate: request.activate,
                    ...(request.signal === undefined ? {} : { signal: request.signal }),
                  }),
                invoke: request =>
                  invokeServiceOperation({
                    services: serviceOperationServices,
                    alternateTargets: [host.services.target],
                    operationId: request.operationId,
                    input: request.input,
                    grant: serviceOperationGrant,
                    budgets: SERVICE_OPERATION_BUDGET,
                    allowedEffects: ['none'],
                    ...(request.signal === undefined ? {} : { signal: request.signal }),
                  }),
              },
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
        path: request.subject ?? `service:${request.operationId ?? request.command}`,
      })
    }
    if (result.state === 'ok') {
      /*
       * An answer that is a document opens as one. A converted catalog or a merged declaration is
       * read, not acknowledged, and a notification saying "completed" hides what was produced.
       */
      const output = operationOutputText(result.data)
      if (output !== undefined) {
        const name = operationOutputName(
          request.operationId ?? request.command,
          request.subject,
          output.languageId,
        )
        const uri = vscode.Uri.from({
          scheme: OPERATION_OUTPUT_SCHEME,
          path: operationOutputs.publish(name, output.text),
        })
        operationOutputChanged.fire(uri)
        const document = await vscode.workspace.openTextDocument(uri)
        if (output.languageId !== undefined)
          await vscode.languages.setTextDocumentLanguage(document, output.languageId)
        await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true })
        return result
      }
      void vscode.window.showInformationMessage(
        `${title}: ${localizer.text('vscode.command.completedOutput', {
          subject:
            request.subject === undefined
              ? (request.operationId ?? request.command)
              : subjectLabel(request.subject),
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
        /*
         * A binary tab has no `activeTextEditor`, so fall back to whatever the active tab names.
         * Every URI-bearing tab input (text, custom editor, notebook) exposes `uri`; diff, webview
         * and terminal inputs do not, and are correctly left unresolved here.
         */
        const activeInput: unknown = vscode.window.tabGroups.activeTabGroup.activeTab?.input
        const activeTabUri =
          typeof activeInput === 'object' && activeInput !== null && 'uri' in activeInput
            ? (activeInput as { readonly uri?: unknown }).uri
            : undefined
        const active =
          vscode.window.activeTextEditor?.document.uri ??
          (activeTabUri instanceof vscode.Uri ? activeTabUri : undefined)
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
        | {
            command?: string
            subject?: string
            entry?: string
            target?: string
            operationId?: string
            operationInput?: CommandInput[string]
          }
        | undefined
      return (async (): Promise<CommandResult | undefined> => {
        const requestedDescriptor =
          typeof request?.command === 'string' ? commandRuntime.get(request.command) : undefined
        if (
          requestedDescriptor !== undefined &&
          (!requestedDescriptor.needsSubject || typeof request?.subject === 'string')
        ) {
          return runSharedCommand({
            command: requestedDescriptor.id,
            ...(typeof request?.subject === 'string' ? { subject: request.subject } : {}),
            ...(typeof request?.entry === 'string' ? { entry: request.entry } : {}),
            ...(typeof request?.target === 'string' ? { target: request.target } : {}),
            ...(typeof request?.operationId === 'string'
              ? { operationId: request.operationId }
              : {}),
            ...(request?.operationInput === undefined
              ? {}
              : { operationInput: request.operationInput }),
          })
        }
        const paletteSubject = activeSubject ?? vscode.window.activeTextEditor?.document.uri.fsPath
        const picked = await vscode.window.showQuickPick(
          commandRuntime.descriptors.map(item => ({
            label: item.title,
            description: item.id,
            detail: item.summary,
          })),
          {
            title:
              paletteSubject === undefined
                ? 'Modkit: Run command'
                : localizer.text('vscode.command.runOn', { subject: subjectLabel(paletteSubject) }),
            placeHolder: localizer.text('vscode.command.pick'),
          },
        )
        if (picked === undefined) return undefined
        if (picked.description === 'service.operations') {
          return runSharedCommand({ command: picked.description })
        }
        if (picked.description === 'service.invoke') {
          const catalog = await discoverServiceOperations({
            services: serviceOperationServices,
            alternateTargets: [host.services.target],
            grant: serviceOperationGrant,
            budgets: SERVICE_OPERATION_BUDGET,
            offset: 0,
            limit: 100,
            activate: false,
          })
          const operation = await vscode.window.showQuickPick(
            catalog.entries.map(item => {
              const detail = item.descriptor?.summary ?? item.diagnostics.at(-1)?.message
              return {
                label: item.operationId,
                description: item.state,
                ...(detail === undefined ? {} : { detail }),
              }
            }),
            { title: 'Modkit: extension operation', placeHolder: 'Choose an operation ID' },
          )
          if (operation === undefined) return undefined
          const authoredInput = await vscode.window.showInputBox({
            title: `Modkit: ${operation.label}`,
            prompt: 'JSON input',
            value: '{}',
            validateInput(value) {
              try {
                JSON.parse(value)
                return undefined
              } catch (error) {
                return error instanceof Error ? error.message : String(error)
              }
            },
          })
          if (authoredInput === undefined) return undefined
          return runSharedCommand({
            command: picked.description,
            operationId: operation.label,
            operationInput: JSON.parse(authoredInput) as CommandInput[string],
          })
        }
        const subject = paletteSubject
        if (subject === undefined) {
          void vscode.window.showInformationMessage(
            `Modkit: ${localizer.text('vscode.command.openFileFirst')}`,
          )
          return undefined
        }
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
    vscode.commands.registerCommand('modkit.browseContainer', (argument: unknown) =>
      (async () => {
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
          return undefined
        }
        granted.add(dirname(target.path))
        let index: Awaited<ReturnType<typeof containers.index>>
        try {
          // Opens and indexes it; a subject that is not a container is refused here by name,
          // before a folder the Explorer could not list appears in the workspace.
          index = await containers.index(target.path)
        } catch (error) {
          const named = error as {
            readonly code?: unknown
            readonly message?: unknown
            readonly context?: unknown
          }
          const code = typeof named.code === 'string' ? named.code : undefined
          const message = typeof named.message === 'string' ? named.message : String(error)
          const context =
            named.context !== null && typeof named.context === 'object'
              ? (named.context as Record<string, unknown>)
              : undefined
          const attemptedCandidates = Array.isArray(context?.attemptedCandidates)
            ? Object.freeze(
                context.attemptedCandidates.filter(isAttemptedContainerCandidate).map(item =>
                  Object.freeze({
                    contributionId: item.contributionId,
                    formatIds: Object.freeze([...item.formatIds]),
                    state: item.state,
                    diagnostics: Object.freeze(
                      item.diagnostics.map(diagnostic => Object.freeze({ ...diagnostic })),
                    ),
                  }),
                ),
              )
            : Object.freeze([])
          log(`browse refused ${basename(target.path)}: ${message}`)
          void vscode.window.showWarningMessage(
            localizer.text('vscode.container.cannotBrowse', { reason: message }),
          )
          return Object.freeze({
            state: 'refused' as const,
            command: 'modkit.browseContainer',
            failedStep: 'container-index',
            ...(code === undefined ? {} : { code }),
            message,
            attemptedCandidates,
          })
        }
        const existing = vscode.workspace.workspaceFolders
        if (existing === undefined || existing.length === 0) {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.container.openFolderFirst')}`,
          )
          return undefined
        }
        const folder = vscode.Uri.from({
          scheme: CONTAINER_SCHEME,
          path: containerUriPath(target.path),
        })
        if (existing.some(item => item.uri.toString() === folder.toString())) {
          void vscode.commands.executeCommand('revealInExplorer', folder)
          return Object.freeze({
            container: target.path,
            folder,
            indexedFiles: index.files.size,
            workspaceEffect: 'already-present' as const,
          })
        }
        const effect = await addContainerWorkspaceFolder(folder, basename(target.path))
        log(
          effect === 'rejected'
            ? `the workspace refused the container folder for ${basename(target.path)}`
            : `container ${effect} in the workspace: ${basename(target.path)}`,
        )
        if (effect === 'rejected') {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.container.workspaceRejected')}`,
          )
        }
        return Object.freeze({
          container: target.path,
          folder,
          indexedFiles: index.files.size,
          workspaceEffect: effect,
        })
      })(),
    ),

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
  /*
   * Content changes and real edits both travel here.
   *
   * A view that keeps its own history (the image tools) reports each edit, and each becomes one
   * entry in the editor's undo stack with `undo`/`redo` routed back into that view — so Ctrl+Z,
   * Ctrl+Y and Ctrl+S behave exactly as they do in a text editor, and no view draws its own.
   */
  const customDocumentChanged = new vscode.EventEmitter<
    | vscode.CustomDocumentContentChangeEvent<ModkitCustomDocument>
    | vscode.CustomDocumentEditEvent<ModkitCustomDocument>
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
      return new ModkitCustomDocument(
        uri,
        formatSmokeReadOnlySubjects.has(subjectKey(subjectPathOf(uri))),
      )
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
      const served = attach(
        panel.webview,
        target.path,
        {
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
          onEdited(path) {
            if (path !== document.state.path) return
            document.state.markDirty(true)
            customDocumentChanged.fire({
              document,
              label: 'Edit',
              undo: () => document.state.undo(),
              redo: () => document.state.redo(),
            })
          },
        },
        undefined,
        undefined,
        undefined,
        // One provider serves every Modkit view type; the panel says which mode it was chosen as.
        STAGE_CUSTOM_EDITOR_TYPES[panel.viewType],
      )
      document.state.attach(served)
      liveArchiveAcceptanceDocuments.set(document.uri.toString(), document)
      liveArchiveAcceptanceServed.set(document.uri.toString(), served)

      /*
       * The status bar follows the active editor, not the open one. Several Modkit editors can be
       * open at once, and only the one in front is what the bar is describing.
       */
      const followActive = (): void => {
        const key = subjectKey(target.path)
        if (panel.active) {
          activeSubject = key
          showSubjectStatus(target.path)
          viewerStatusBar.setActive(key)
        } else if (activeSubject === key) {
          activeSubject = undefined
          showSubjectStatus(undefined)
          viewerStatusBar.setActive(undefined)
        }
      }
      followActive()
      panel.onDidChangeViewState(followActive)

      panel.onDidDispose(() => {
        if (liveArchiveAcceptanceDocuments.get(document.uri.toString()) === document) {
          liveArchiveAcceptanceDocuments.delete(document.uri.toString())
        }
        if (liveArchiveAcceptanceServed.get(document.uri.toString()) === served) {
          liveArchiveAcceptanceServed.delete(document.uri.toString())
        }
        viewerStatusBar.remove(subjectKey(target.path))
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
      const served = liveArchiveAcceptanceServed.get(document.uri.toString())
      const nativeSaveAsEnabled = process.env[PACKAGE_INSTALL_GATE_ENV] === '1'
      if (nativeSaveAsEnabled && served !== undefined && document.state.isDirty) {
        throw new Error('native MPQ Save As requires a clean source document')
      }
      if (!document.readOnly && document.state.isDirty) await document.state.save()
      checkCancellation(token)
      if (destination.toString() !== document.uri.toString()) {
        if (nativeSaveAsEnabled && served !== undefined) {
          const sourceBytes = await vscode.workspace.fs.readFile(document.uri)
          const native = await served.nativeSaveAs(
            document.uri.fsPath,
            destination.fsPath,
            sourceBytes,
          )
          if (native !== undefined) {
            await vscode.workspace.fs.writeFile(destination, native.bytes)
            nativeWriterReceiptForAcceptance = native.nativeWriterReceipt
            return
          }
        }
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
  liveArchiveAcceptanceSaver.save = async (document, destination) => {
    const cancellation = new vscode.CancellationTokenSource()
    try {
      await customEditor.saveCustomDocumentAs(document, destination, cancellation.token)
    } finally {
      cancellation.dispose()
    }
  }
  for (const viewType of MODKIT_VIEW_TYPES) {
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(viewType, customEditor, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }),
    )
  }

  // ------------------------------------------------- per-codec «open by default» (owner decision)
  /*
   * An enabled codec is the default editor for the formats it claims, unless the user turns that
   * one codec's default off or points the association somewhere else with VS Code's own «Open With
   * → Set Default». The planner in `./editor-associations.js` decides; this writes.
   *
   * The automatic sync writes the user's settings only. Writing the workspace created
   * `.vscode/settings.json` inside whatever folder was opened — for a mod folder, inside the mod —
   * on every activation, without the user asking. A workspace-level association the user sets
   * still wins over this one, as VS Code resolves it.
   */
  const associationTarget = (): vscode.ConfigurationTarget => vscode.ConfigurationTarget.Global

  const readStringList = (key: string): readonly string[] => {
    const value = vscode.workspace.getConfiguration().get(key)
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  }

  const syncEditorAssociations = async (reason: string): Promise<AssociationPlan> => {
    const associations = vscode.workspace.getConfiguration('workbench').get('editorAssociations')
    const current: Record<string, string> = {}
    if (associations !== null && typeof associations === 'object' && !Array.isArray(associations)) {
      for (const [pattern, viewType] of Object.entries(associations)) {
        if (typeof viewType === 'string') current[pattern] = viewType
      }
    }
    const plan = planEditorAssociations({
      contributions: host.contributions,
      nonDefault: readStringList('modkit.nonDefaultContributions'),
      current,
      managed: readStringList('modkit.managedEditorAssociations'),
      ownViewTypes: MODKIT_VIEW_TYPES,
      defaultViewType: CUSTOM_EDITOR_TYPE,
      includeTextFormats:
        vscode.workspace.getConfiguration().get('modkit.defaultEditorForTextFormats') === true,
    })
    const managedChanged =
      JSON.stringify(plan.managed) !==
      JSON.stringify(readStringList('modkit.managedEditorAssociations'))
    if (plan.changed || managedChanged) {
      const target = associationTarget()
      if (plan.changed) {
        await vscode.workspace
          .getConfiguration('workbench')
          .update('editorAssociations', plan.next, target)
      }
      await vscode.workspace
        .getConfiguration()
        .update('modkit.managedEditorAssociations', [...plan.managed], target)
    }
    log(
      `[associations] ${reason}: +${plan.added.length} -${plan.removed.length} ` +
        `respected ${plan.respected.length} managed ${plan.managed.length}`,
    )
    return plan
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('modkit.syncEditorAssociations', () =>
      syncEditorAssociations('command'),
    ),
    /*
     * The per-codec switch as an ordinary command. It lists the codecs this window loaded with the
     * position of their default, and toggling one writes `modkit.nonDefaultContributions` and
     * re-syncs immediately — so unchecking a default gives the built-in editor back on the next
     * open, with no reinstall and no window reload.
     */
    vscode.commands.registerCommand('modkit.setCodecDefaultEditor', async () => {
      const nonDefault = new Set(readStringList('modkit.nonDefaultContributions'))
      const rows = host.contributions.filter(
        row => row.id !== undefined && !row.disabled && row.fileExtensions.length > 0,
      )
      if (rows.length === 0) {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('vscode.associations.noCodecs')}`,
        )
        return undefined
      }
      const picked = await vscode.window.showQuickPick(
        rows.map(row => ({
          label: row.id as string,
          description: row.fileExtensions.map(extension => `.${extension}`).join(' '),
          detail: localizer.text(
            nonDefault.has(row.id as string)
              ? 'vscode.associations.notDefault'
              : 'vscode.associations.isDefault',
          ),
        })),
        { title: localizer.text('vscode.associations.pickTitle') },
      )
      if (picked === undefined) return undefined
      if (nonDefault.has(picked.label)) nonDefault.delete(picked.label)
      else nonDefault.add(picked.label)
      await vscode.workspace
        .getConfiguration()
        .update('modkit.nonDefaultContributions', [...nonDefault].sort(), associationTarget())
      const plan = await syncEditorAssociations(`toggled ${picked.label}`)
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('vscode.associations.applied', {
          id: picked.label,
          state: localizer.text(
            nonDefault.has(picked.label)
              ? 'vscode.associations.notDefault'
              : 'vscode.associations.isDefault',
          ),
          added: plan.added.length,
          removed: plan.removed.length,
        })}`,
      )
      return Object.freeze({
        contributionId: picked.label,
        isDefault: !nonDefault.has(picked.label),
        added: plan.added,
        removed: plan.removed,
        respected: plan.respected,
      })
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration('modkit.nonDefaultContributions') ||
        event.affectsConfiguration('modkit.defaultEditorForTextFormats') ||
        event.affectsConfiguration('modkit.disabledContributions')
      ) {
        void syncEditorAssociations('settings changed')
      }
    }),
  )
  void syncEditorAssociations('activation')

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

  if (process.env[PACKAGE_INSTALL_GATE_ENV] === '1') {
    void writePackageInstallGateReceipt().catch(error => {
      log(
        `[acceptance] package install gate failed to write: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    })
  }

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
