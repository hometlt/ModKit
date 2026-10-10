/**
 * VS Code extension host entry.
 *
 * This file and the adapter modules beside it (the tree views, the panel page, subject URIs, the
 * custom document) are the only places allowed to import `vscode`. Everything that decides
 * anything — composing the realms, opening a subject, confining a path, writing a file — lives in
 * `./host.ts`, `./index.ts` and `./uri.ts`, which know nothing about the editor and are therefore
 * testable in plain Node. What is left here is the adapter: workspace folders in, a webview
 * channel out, and the editor's own affordances (commands, a custom editor, tree views, an output
 * channel) wired to the host's answers.
 *
 * The webview never receives extension-host power. It gets a bridge realm profile, a strict CSP
 * with a per-load nonce, and a consumer of `x3.app/subject-services@1` — so doc 19's rule (a
 * webview is not an extension host) stays true in the running product and not only in the
 * topology.
 */
import { createHash } from 'node:crypto'
import {
browserImageType,
imageGalleryExtensions,
MAXIMUM_BROWSER_IMAGE_BYTES,
renderGalleryThumbnail,
type GalleryThumbnail,
} from './image-gallery.js'
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as vscode from 'vscode'
import { callContentSources } from '@modkit/vfs/content-sources/node'
import { LoadedModResourceSessions } from '@modkit/host/mods'
import {
HOST_LAYER_SOURCE_ID,
type ContentSourceLocalPath,
type ContentSourceSearchResult,
type ContentSources
} from '@modkit/vfs/content-sources'
import { chooseContentSource } from '@modkit/ui/content-sources'
import { exportConversions } from '@modkit/ui/export'
import { convertedFileName } from '@modkit/ui/image'
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
type UiCatalogDocument, type UiMessageKey
} from '@modkit/ui/localization'

import type { CloseAnswer, WebviewChannel } from './bridge.js'
import { ActiveModLoads } from './active-mod-loads.js'
import {
createA7AcceptanceReceipt,
createModkitAcceptanceReceipt,
type ModkitAcceptanceReceipt,
} from './acceptance.js'
import {
containerUriPath,
containerUriText,
containerLocationIdentity,
CONTAINER_SCHEME,
parseContainerUriPath,
parseContainerUriText,
splitContainer,
type ContainerNode,
} from './container-uri.js'
import { advertisesSubjectCandidates, SUBJECT_SELECTOR_SOURCE } from './subject-candidates.js'
import {
commandSubjectsFrom,
composeLanguageDocumentSources,
contentSourceRootServing,
createModkitCommandRuntime,
discoverServiceOperations,
invokeServiceOperation,
SERVICE_OPERATION_CATALOG_MAX_PAGE_ITEMS,
loadLocalizationCatalogs,
modContextCatalogEntities,
offersFromInventory,
resolveContentLanguageSources,
subjectTarget,
baseModsFor,
type BaseModSetting,
type CommandInput,
type CommandResult,
type SubjectCatalogOptions,
} from '@modkit/host'
import {
classifyLanguageFile,
createLanguageModContexts,
createLanguageWorkspace,
LANGUAGE_MAX_DOCUMENTS,
contentPathIndexSemanticInputs,
languageFileAssociations,
languageFileExtension,
languageWorkspaceContextToken,
languageProviderRoutes,
languageProviderTriggerCharacters,
resolveLanguageProvider,
type LanguageAssetImage,
type LanguageAssetImageRequest,
type LanguageWorkspaceDocumentSource,
type LanguageWorkspaceDocumentSourceResult,
} from '@modkit/host/language'
import { encodeRgbaPng } from '@modkit/scene/output/png'
import {
discoverGameInstallations,
gameInstallationSearchOf,
gameLaunchOptionsOf,
interpretGameLaunchLog,
planGameLaunch,
} from '@modkit/host/games'
import {
createContentSourceMapPreviewResourcePlanResolver,
createNodeMapPreviewResourcePlanResolver,
flushArtifactDigestCache,
launchNodeGameResource,
listIndexCaches,
openCachedContentIndex,
removeIndexCache,
resolveContentSources,
withSharedModContexts,
createNodeInstallationFiles,
runningGameProcesses,
searchInstallationFolders,
stopGameProcesses,
useArtifactDigestCache,
watchGameLaunchLogs,
type CachedContentIndex,
type GameLaunchLogWatch,
type InstallationFolderSearch,
type NodeGameLaunchReceipt,
} from '@modkit/host/node'
import { configuredIndexCaches } from './contribution-settings.js'
import type {
AnyDescriptor,
AssetSession,
JsonValue,
LanguageCompletionItem,
OperationSession,
SubjectCandidateProviderSource,
SubjectCandidateScope,
TableColumnInfo,
TableDataSource,
TableVariantComparison,
TreeDataSource,
TreeNodeFacts
} from '@modkit/sdk'
import { createSubjectCandidateProvider, indexCacheEnabled } from '@modkit/sdk'
import { NATIVE_MAP_ENCODER_CONTRACT } from '@modkit/sdk/maps'
import { isModkitError } from '@modkit/core'
import {
CONTAINER_ENTRY_EXISTS,
CONTAINER_ENTRY_NOT_FOUND,
type ContainerRegistry,
} from './containers.js'
import { registerWorkspaceSearch, type SearchFolderFile } from './workspace-search.js'
import { decodeText } from './workspace-search-core.js'
import {
createOperationOutputStore,
operationOutputName,
operationOutputText,
OPERATION_OUTPUT_SCHEME,
} from './operation-output.js'
import { formatPublicationVersion, nextPublicationVersion } from './publication-revision.js'
import {
createExtensionCardCatalog,
extensionCardBundle,
extensionCardIconTarget,
extensionCardResourceTargets,
type ExtensionCardBundle,
} from './extension-cards.js'
import { openVsCodeExtensionCardResource } from './extension-card-resource-actions.js'
import {
configuredExtensionRoots,
configuredDisabledContributions,
configuredDisabledExtensions,
describeConfiguredExtensions,
withContributionDisabled,
withContributionsDisabled,
withExtensionRoot,
} from './extension-roots.js'
import {
extensionEntryIsMutable,
extensionEntrySupportsGroupedRemoval,
extensionEntryDisplayName, OPEN_CONTRIBUTION_COMMAND,
OPEN_EXTENSION_COMMAND,
OPEN_GAME_COMMAND,
OPEN_VENDOR_COMMAND,
type ExtensionComponentNode,
type ExtensionNode,
type ExtensionVendorNode
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
ownedWireBytes,
subjectKey,
subjectLabel, type ViewerSurfaceOperation,
type ViewerSurfaceOperationResult,
type VsCodeConfigurationPort,
type VsCodeServed,
type VsCodeServeOptions, type VsCodeTreeSubject
} from './host.js'
import { describeDegradation, describeFacilities, type FacilityReport } from './facilities.js'
import { refusalHtml } from './page.js'
import BUNDLED_CATALOG from '../generated/bundled-catalog.json' with { type: 'json' }
import { describeOpenTarget } from './uri.js'
import { registerDocumentVerification } from './verify-document.js'
import { createVscodeLocalizer, VSCODE_UI_CATALOGS } from './localization.js'
import {
applyEditorOnTypeEditResult,
caseInsensitiveExtensionPattern,
caseInsensitiveNamePattern,
createLanguageSessionController,
LANGUAGE_TOKEN_MODIFIERS,
LANGUAGE_TOKEN_TYPES,
oneBuildPerKey,
plainLanguagePosition,
type EditorDocumentSymbol,
type EditorLanguageDiagnostic,
type EditorLanguageDocument,
} from './language-session.js'
import {
  associatedLanguageOf,
  completionKindName,
  LANGUAGE_COMMAND,
  languageCommandTarget,
  rebaseLanguageSnapshot,
} from './language-native.js'
import {
createRuntimeDebugController,
type RuntimeDebugCommandRequest,
type RuntimeDebugCommandResult,
type RuntimeDebugController,
} from './runtime-debug.js'
import {
assertMaterializationBound,
createDiagnosticJournal,
GAME_LOCALES,
gameLocales,
installationGameIds,
logLevelOf,
diagnosticsReport,
installationSearchFolders,
installationsAtFolder,
regionsToConnect,
selectedContentSource,
selectedContentSources,
selectedInstallationDirectory,
encoderTargetInstallations,
withSelectedContentSource,
withoutSelectedContentSource,
type SelectedContentSource,
} from './workbench-workflows.js'
import { anchorDocumentIndex } from './anchor-documents.js'
import { type SourceTreeNode } from './source-tree.js'
import {
runExplicitGameLaunch,
VSCODE_GAME_LAUNCH_COMMAND,
type ExplicitGameLaunchRequest,
} from './game-launch-workflow.js'
import {
gameLaunchConfiguration,
gameLaunchConfigurationFor,
gameLogFindingsByFile,
launchTargetOf,
linesAfterEdit,
VSCODE_GAME_LAUNCH_DEBUG_TYPE,
VSCODE_GAME_LAUNCH_MOD_COMMAND,
type GameLaunchConfiguration,
type GameLaunchKind,
} from './game-launch-ui.js'
import {
anchorAssociationPattern,
associationPattern,
contributedLanguageExtensions,
contributedLanguageFileNames,
planEditorAssociations,
type AssociationPlan,
} from './editor-associations.js'
import { deferredTreeDataProvider, type DeferredTreeDataProvider } from './deferred-tree.js'
import { createPhaseLog } from './timing.js'
import { createViewerStatusBar } from './viewer-status.js'
import {
selectScopedSubject,
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

import {
  CUSTOM_EDITOR_TYPE,
  STAGE_CUSTOM_EDITOR_TYPES,
  MODKIT_VIEW_TYPES,
  LANGUAGE_ACTIVATION_BUDGET,
  LANGUAGE_WORKSPACE_BUDGET,
  RUNTIME_ACTIVATION_BUDGET,
  RUNTIME_SESSION_BUDGET,
  GAME_DISCOVERY_BUDGET,
  SERVICE_OPERATION_BUDGET,
  PACKAGE_INSTALL_GATE_COMMAND,
  RESOURCES_CHAIN_KEY,
  PACKAGE_INSTALL_GATE_ENV,
  PACKAGE_INSTALL_GATE_GENERATION_ENV,
  PACKAGE_INSTALL_GATE_ARTIFACT_ENV,
  PACKAGE_INSTALL_GATE_CONTINUE_ENV,
  PACKAGE_INSTALL_GATE_DISABLED_URI_ENV,
  FORMAT_SMOKE_WORKSPACE_ROOT_ENV,
  FORMAT_SMOKE_SC2_ROOT_ENV,
  FORMAT_SMOKE_WARZONE_ROOT_ENV,
  FORMAT_SMOKE_START_ENV,
  FORMAT_SMOKE_ACK_ENV,
  ARCHIVE_ACCEPTANCE_START_ENV,
  ARCHIVE_ACCEPTANCE_ACK_ENV,
  SELECTED_SOURCES_KEY,
  BATTLENET_CONNECTIONS_KEY,
  CATALOGUE_KEY,
  ICON_THEME_ID,
  ICON_THEME_OFFERED_KEY,
} from './constants.js'
import {
  type FormatSmokeRouteStep,
  type FormatSmokeOpenCase,
  type FormatSmokeExcludedCase,
  formatSmokeObject,
  isAttemptedContainerCandidate,
  formatSmokeConfinedPath,
  readPackagedFormatSmoke,
  requiredFormatSmokeRoot,
  resolvePackagedFormatSmokeCases,
  formatSmokeFileDigest,
} from './packaged-acceptance.js'
import { readPackagedManagedRegistry } from './managed-registry.js'
import { announceModContexts } from './mod-context-progress.js'
import {
  commandOutputLeaf,
  nativeEncoderFormats,
  WORLD_UVW_LIMITS,
  worldUvwReceiptOf,
  type WorldUvwReceipt,
} from './command-output.js'
import {
  BATCH_CONVERT_MAX_FILES,
  runBatchConversion,
  type BatchOutcome,
  type BatchSubject,
} from './batch-convert.js'
import { contentSourceOptionsFor } from './content-source-options.js'
import {
  comparedLocales,
  gitRevision,
  gitShowSpec,
  gitText,
  hasGaps,
  missingAtRevision,
  withoutByteOrderMark,
  type StringChangesAnswer,
} from './translation-report.js'
import {
  subjectPathOf,
  modContextTargetOf,
  subjectUriOf,
  namespaceEntryPathOf,
  namespaceEntryRootOf,
  memberUriOf,
  openResourceFile,
  subjectCandidateScopeOf,
} from './subject-uris.js'
import { BACKSLASH, ModkitCustomDocument } from './modkit-custom-document.js'
import { workspaceFolders, findDiskFiles } from './workspace-files.js'
import { exportViewerFiles } from './viewer-export.js'
import { nonce, panelHtml } from './panel-page.js'
import { UI_PREFERENCES_KEY, withUiPreference } from './ui-preferences.js'
import { ExtensionsView } from './extensions-view.js'
import { HostView } from './host-view.js'
import { SourcesView } from './sources-view.js'
import {
  adoptKeptTickets,
  adoptReplacedApplicationSettings,
  adoptReplacedSettings,
} from './credential-ports.js'
import { contentSourceRoots } from './content-source-roots.js'
import {
  AccountsView,
  createEditorCredentialPrompter,
  createSecretCredentialStore,
  credentialSetting,
  registerAccountsCommands,
} from './credentials.js'
import {
  type ResourceTreeNode,
  type ResourceTreeHost,
  type ResourceMemberTrees,
  ResourcesView,
} from './resources-view.js'

let activeLanguageShutdown: (() => Promise<void>) | undefined

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
  /** Language routes composed for this process; exposed so installed acceptance can name coverage. */
  readonly languageRoutes: readonly string[]
  /** Bounded mirror of the output channel for installed acceptance and support bundles. */
  diagnostics(): readonly string[]
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

/**
 * The sidebar's three views, with providers from the first moment of activation.
 *
 * Composing the host reads and validates every extension root before any view can be built, and a
 * view without a provider says "There is no data provider registered" for that whole time. Each
 * view shows one loading row and a progress bar instead, then hands over to its real provider.
 */
interface DeferredModkitViews {
  readonly sources: DeferredTreeDataProvider<SourceTreeNode>
  readonly resources: DeferredTreeDataProvider<ResourceTreeNode>
  readonly extensions: DeferredTreeDataProvider<ExtensionNode>
}

export async function activate(context: vscode.ExtensionContext): Promise<ModkitExtensionApi> {
  const loading = createVscodeLocalizer(vscode.env.language).text('vscode.views.loading')
  const views: DeferredModkitViews = {
    sources: deferredTreeDataProvider(loading),
    resources: deferredTreeDataProvider(loading),
    extensions: deferredTreeDataProvider(loading),
  }
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('modkit.sources', views.sources),
    vscode.window.registerTreeDataProvider('modkit.resources', views.resources),
    vscode.window.registerTreeDataProvider('modkit.extensions', views.extensions),
  )
  let composed!: () => void
  const settled = new Promise<void>(resolve => (composed = resolve))
  for (const viewId of ['modkit.sources', 'modkit.resources', 'modkit.extensions']) {
    void vscode.window.withProgress({ location: { viewId } }, () => settled)
  }
  let failure: string | undefined
  try {
    return await activateModkit(context, views)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    // A view whose provider never arrived (language-only debugging, a failed start) stops saying
    // it is loading; `modkit.ready` retires the welcome text shown before activation began.
    for (const view of [views.sources, views.resources, views.extensions]) view.settle(failure)
    composed()
    void vscode.commands.executeCommand('setContext', 'modkit.ready', true)
  }
}

/** How long a mod context may take before the status bar says it is being built (plan 0.8). */
const MOD_CONTEXT_PROGRESS_DELAY_MS = 400

async function activateModkit(
  context: vscode.ExtensionContext,
  views: DeferredModkitViews,
): Promise<ModkitExtensionApi> {
  if (activeLanguageShutdown !== undefined) await activeLanguageShutdown()
  const activationStarted = Date.now()
  const languageOnly = process.env.MODKIT_VSCODE_LANGUAGE_ONLY === '1'
  // A log channel: VS Code keeps it on disk and «Developer: Set Log Level…» filters it.
  const output = vscode.window.createOutputChannel('Modkit MK3', { log: true })
  context.subscriptions.push(output)
  // Registered first: the log is wanted most when the rest of activation fails.
  context.subscriptions.push(
    vscode.commands.registerCommand('modkit.showLog', () => output.show(true)),
    vscode.commands.registerCommand('modkit.openLogFolder', async () => {
      await vscode.workspace.fs.createDirectory(context.logUri)
      await vscode.commands.executeCommand('revealFileInOS', context.logUri)
    }),
  )
  /** Where the time goes on the paths a person waits on; see `./timing.ts`. */
  const timing = createPhaseLog(line => {
    output.appendLine(line)
  })
  /** Zoom, channel, dimensions, format and size of the viewer in the active Modkit editor. */
  const viewerStatusBar = createViewerStatusBar()
  context.subscriptions.push(viewerStatusBar)
  const journal = createDiagnosticJournal()
  let localizer = createVscodeLocalizer(vscode.env.language)
  const log = (line: string): void => {
    journal.append(line)
    const level = logLevelOf(line)
    if (level === 'error') output.error(line)
    else if (level === 'warning') output.warn(line)
    else output.info(line)
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
  const debugLanguageExtensions = process.env.MODKIT_VSCODE_LANGUAGE_EXTENSIONS
  const rawConfiguredExtensions =
    languageOnly && debugLanguageExtensions !== undefined
      ? debugLanguageExtensions.split('|').filter(Boolean)
      : initialConfiguration.get('extensions')
  const registrySetting = initialConfiguration.get<unknown>('extensionRegistry')
  const registryEnvironment = process.env.MODKIT_EXTENSION_REGISTRY
  const packagedRegistry = readPackagedManagedRegistry(
    extensionRoot,
    initialConfiguration.get<string>('extensionPackages'),
  )
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
        'No game packages or extension registry is configured. Set modkit.extensionPackages ' +
          '(the folder of game bundles published beside Modkit), modkit.extensionRegistry or ' +
          'MODKIT_EXTENSION_REGISTRY before refreshing.',
      )
    },
  })
  const nodeExtensionManager = createNodeExtensionManager({
    root: join(context.globalStorageUri.fsPath, 'extension-manager'),
    trustedPublicKeys: managerSecurity.trustedPublicKeys,
    vfsOptions: managerSecurity.vfsOptions,
    ...(registry === undefined
      ? packagedRegistry?.catalogPath === undefined
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
  /*
   * Digests of the bundled roots, kept between launches.
   *
   * Loading the catalog hashes every file of every extension root, and nothing in a shipped VSIX
   * changes between two launches of the same build — so the answer is remembered in this window's
   * own storage, keyed by a stat fingerprint of each root. A file that changed is hashed again.
   */
  useArtifactDigestCache(join(context.globalStorageUri.fsPath, 'artifact-digests.v1.json'))
  context.subscriptions.push({ dispose: () => flushArtifactDigestCache() })
  const composing = timing.phase('compose host (catalog roots, inventory, realms)')
  // The broker's application ports: secrets in SecretStorage, prompts in the editor's own boxes.
  const credentialPrompter = createEditorCredentialPrompter(() => localizer)
  // One directory of index caches for every codec and content source: an installation's name and
  // content indexes are built once, whichever asked first, and listed and cleared in one place.
  const indexCacheDirectory = join(context.globalStorageUri.fsPath, 'index-cache')
  // Content indexes of source roots this window opened, one per root revision (see the search).
  const contentIndexes = new Map<string, Promise<CachedContentIndex>>()
  const closeContentIndexes = async (): Promise<void> => {
    const open = [...contentIndexes.values()]
    contentIndexes.clear()
    await Promise.all(open.map(opened => opened.then(index => index.close()).catch(() => undefined)))
  }
  context.subscriptions.push({ dispose: () => void closeContentIndexes() })
  /*
   * A subject's mod context, inside the base mods the `modkit.baseMods` setting names for its path:
   * it answers an operation that names catalog entities (a replay's units), and an ordinary open's
   * request for a resource of the mod (a map's tileset, a model's texture in the game).
   */
  /** The installation the user chose for a game; answered once the choices are read below. */
  let selectedInstallationOf = (_gameId: string): string | undefined => undefined
  const subjectCatalog: SubjectCatalogOptions = {
    contentSources: () => requireContentSources().catch(() => undefined),
    baseMods: target =>
      typeof target === 'string'
        ? baseModsFor(target, baseModsSetting(vscode.Uri.file(target)))
        : undefined,
  }
  const host = await createVsCodeSubjectHost({
    credentials: {
      store: createSecretCredentialStore(context.secrets),
      prompter: credentialPrompter,
      setting: credentialSetting,
    },
    subjectCatalog,
    // a codec reads the chosen installation's own files (Diablo III's type registry), nothing else
    installationFiles: createNodeInstallationFiles({
      installationOf: gameId => selectedInstallationOf(gameId),
    }),
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
    configuredContributionSettings: vscode.workspace
      .getConfiguration('modkit')
      .get('contributionSettings'),
    configuredTrustedExtensions: vscode.workspace.getConfiguration('modkit').get('trustedExtensions'),
    // Where a contribution may keep what it wants between windows (a parsed index, a digest
    // table). One subdirectory per contribution id; the host names it, the contribution fills it.
    contributionCacheDirectory: join(context.globalStorageUri.fsPath, 'contribution-cache'),
    indexCacheDirectory,
    configuredIndexCaches: vscode.workspace.getConfiguration('modkit').get('indexCaches'),
    // the bootstrap this extension ships beside its own bundle: a CommonJS entry has no
    // `import.meta.url` for the backend to resolve it from
    bootstrapUrl: pathToFileURL(join(extensionRoot, 'dist-app', 'worker-bootstrap.js')),
    onDiagnostic: diagnostic =>
      log(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`),
  })
  composing()
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
  // Game-string locales, preferred first: `modkit.locale`, else the display language, then enUS.
  const configuredGameLocales = (): readonly string[] =>
    gameLocales(vscode.workspace.getConfiguration('modkit').get('locale'), vscode.env.language)
  /*
   * A map loads like a mod: it names its dependencies, the configured content sources (the
   * installation, its CASC storage, the player's folders) resolve them, and the world reads every
   * layer from those mounts. A subject that names none, or a window with no source catalogue,
   * keeps the installation locator path.
   */
  /*
   * The folder search (owner decision 2026-09-28), walked once per window: every game's markers,
   * the folders `modkit.installationSearchFolders` names. A map preview's installation discovery
   * reads this answer; the Games command searches again, with progress and cancel, and replaces it.
   */
  let installationFolderSearch: Promise<InstallationFolderSearch | undefined> | undefined
  const searchedInstallationFolders = (): Promise<InstallationFolderSearch | undefined> =>
    (installationFolderSearch ??= (async () => {
      const wanted = gameInstallationSearchOf(host.services.host.inventory)
      if (wanted.markers.length === 0) return undefined
      const configured = installationSearchFolders(
        vscode.workspace.getConfiguration('modkit').get('installationSearchFolders'),
        process.env,
      )
      return searchInstallationFolders({
        markers: wanted.markers,
        commonFolders: configured.driveFolders,
        searchFolders: wanted.searchFolders,
        folders: configured.folders,
      }).catch((error: unknown) => {
        log(
          `[installation] error folder search: ${error instanceof Error ? error.message : String(error)}`,
        )
        return undefined
      })
    })())
  const mapPreviewResourcePlanResolver = createContentSourceMapPreviewResourcePlanResolver({
    contentSources: () => requireContentSources().catch(() => undefined),
    fallback: createNodeMapPreviewResourcePlanResolver({
      subjects: host.services,
      // The installation the user chose for each game, read at each preview: a game whose maps
      // resolve through its installation (Dune 2000, Warzone) opens the one chosen in Games.
      get configuredPaths() {
        return Object.fromEntries(
          presentSources().map(source => [source.gameId, [source.installPath]] as const),
        )
      },
      // and the folders the folder search found, which the game's provider still confirms
      searchPaths: async gameId => (await searchedInstallationFolders())?.found[gameId],
      // Same classes the explicit discovery commands pass; without them the installed game is never
      // located and a map opens as its archive entry list instead of the world view.
      installationDiscoveryGrant: {
        id: 'vscode-map-preview-installation-discovery',
        classes:
          process.platform === 'win32' ? ['filesystem-read', 'process-launch'] : ['filesystem-read'],
      },
    }),
  })
  const runtimeDebug = createRuntimeDebugController({
    services: host.services,
    grant: Object.freeze({ id: 'vscode-runtime', classes: Object.freeze(['read-source'] as const) }),
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
  // A chosen game installation belongs to the user, not to one workspace; older windows kept it
  // per workspace, so that value is still read when nothing is stored for the user yet.
  let selectedSources = selectedContentSources(
    context.globalState.get<unknown>(SELECTED_SOURCES_KEY) ??
      context.workspaceState.get<unknown>(SELECTED_SOURCES_KEY),
  )
  /**
   * The chosen installations whose folders are still there. One moved or deleted is no choice: its
   * game's sources and the discovery take the installation found instead (02.10: SC2 moved from
   * C:Apps to F:GAMES kept the old folder chosen, and no SC2 chain loaded).
   */
  const presentSources = (): readonly SelectedContentSource[] =>
    selectedSources.filter(source => existsSync(source.installPath))
  selectedInstallationOf = gameId =>
    presentSources().find(source => source.gameId === gameId)?.installPath
  /**
   * Mounts in flight, by the id the Sources row carries — a provider root id or an installation's
   * normalized path. A mount adds its folder first and reads afterwards, so this is what lets the
   * row say it is still loading while the workspace folder is already there.
   */
  const mountingSources = new Map<string, AbortController>()
  const normalizedSourcePath = (path: string): string => resolve(path).toLowerCase()
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
  /** The one "show hidden files and folders" option, for every archive and content-source view. */
  const showHiddenEntries = (): boolean =>
    vscode.workspace.getConfiguration('modkit').get<boolean>('showHiddenEntries') === true
  const containers: ContainerRegistry = host.containers({
    roots,
    showHidden: showHiddenEntries,
    // A map inside a zip or a campaign opens into its world, as the same map on disk does.
    mapPreview: {
      mapPreviewResourcePlanResolver,
      gameLocales: configuredGameLocales,
      contentSources: () => requireContentSources().catch(() => undefined),
      localizer,
    },
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
  if (!languageOnly)
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        workspaceFolderAnnouncements += 1
      }),
    )
  const workspaceFolderIdentity = (uri: vscode.Uri): string => {
    if (uri.scheme !== CONTAINER_SCHEME) return uri.toString()
    const location = parseContainerUriPath(uri.path)
    return location === undefined
      ? uri.toString()
      : `${CONTAINER_SCHEME}:${containerLocationIdentity(
          location.container,
          location.entry,
          process.platform !== 'win32',
        )}`
  }
  /** Replace the window's folders with `desired`, then wait (bounded) for VS Code to announce it. */
  const replaceWorkspaceFolders = async (
    desired: readonly { readonly uri: vscode.Uri; readonly name: string }[],
    waitMs: number,
  ): Promise<boolean> => {
    let announce: (() => void) | undefined
    const announced = new Promise<void>(resolvePromise => {
      announce = resolvePromise
    })
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => announce?.())
    try {
      const current = vscode.workspace.workspaceFolders ?? []
      if (!vscode.workspace.updateWorkspaceFolders(0, current.length, ...desired)) return false
      await Promise.race([
        announced,
        new Promise<void>(resolvePromise => setTimeout(resolvePromise, waitMs)),
      ])
      return true
    } finally {
      subscription.dispose()
    }
  }
  const synchronizeContainerWorkspaceFolders = async (): Promise<void> => {
    const current = vscode.workspace.workspaceFolders ?? []
    const seen = new Set<string>()
    let changed = false
    const desired = current.flatMap(item => {
      if (item.uri.scheme !== CONTAINER_SCHEME) return [{ uri: item.uri, name: item.name }]
      const identity = workspaceFolderIdentity(item.uri)
      if (seen.has(identity)) {
        changed = true
        return []
      }
      seen.add(identity)
      const source = selectedSources.find(candidate => {
        const uri = vscode.Uri.from({
          scheme: CONTAINER_SCHEME,
          path: containerUriPath(candidate.installPath),
        })
        return workspaceFolderIdentity(uri) === identity
      })
      const name =
        source === undefined
          ? item.name
          : `CASC: ${source.displayName}${
              source.version === undefined ? '' : ` · ${source.version}`
            }`
      if (name !== item.name) changed = true
      return [{ uri: item.uri, name }]
    })
    if (!changed) return
    log(
      (await replaceWorkspaceFolders(desired, 500))
        ? 'normalized container workspace folders'
        : 'the workspace refused container folder normalization',
    )
  }
  await synchronizeContainerWorkspaceFolders()
  const addContainerWorkspaceFolder = (
    folder: vscode.Uri,
    name: string,
  ): Promise<'added' | 'already-present' | 'rejected'> => {
    const attempt = async (settleMs: number): Promise<'added' | 'already-present' | 'rejected'> => {
      const current = vscode.workspace.workspaceFolders ?? []
      const identity = workspaceFolderIdentity(folder)
      if (current.some(item => workspaceFolderIdentity(item.uri) === identity)) {
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
  /**
   * Every container folder leaves the window in one change, after any folder change still in
   * flight; the containers they showed are returned. VS Code restarts the extension host only when
   * the first folder changes, and that folder stays unless it was a container itself.
   */
  const closeContainerFolders = (): Promise<readonly string[]> => {
    const mutation = workspaceFolderMutation.then(async () => {
      const current = vscode.workspace.workspaceFolders ?? []
      const kept = current.filter(item => item.uri.scheme !== CONTAINER_SCHEME)
      if (kept.length === current.length) return []
      const closed = current.flatMap(item => {
        if (item.uri.scheme !== CONTAINER_SCHEME) return []
        const location = parseContainerUriPath(item.uri.path)
        return location === undefined ? [] : [location.container]
      })
      const replaced = await replaceWorkspaceFolders(
        kept.map(item => ({ uri: item.uri, name: item.name })),
        10_000,
      )
      return replaced ? [...new Set(closed)] : []
    })
    workspaceFolderMutation = mutation.catch(() => undefined)
    return mutation
  }

  /** Open either an archive file or an installation namespace through the shared container VFS. */
  const openContainerPath = async (container: string, label: string) => {
    const startedAt = Date.now()
    const absolute = resolve(container)
    granted.add(statSync(absolute).isDirectory() ? absolute : dirname(absolute))
    const existing = vscode.workspace.workspaceFolders
    if (existing === undefined || existing.length === 0) {
      throw new Error(localizer.text('vscode.container.openFolderFirst'))
    }
    const folder = vscode.Uri.from({
      scheme: CONTAINER_SCHEME,
      path: containerUriPath(absolute),
    })
    /*
     * Order matters, and every step here was a delay the reader saw as «nothing happened».
     *
     * The row is marked mounting *before* anything is awaited, so the spinner and its cancel
     * action exist from the click. The folder is then added — that is the only wait — and
     * revealing it is fire-and-forget, because revealing makes the Explorer list the container,
     * and listing an installation is exactly the long read this mount is trying not to block on.
     */
    const mountKey = normalizedSourcePath(absolute)
    const cancellation = new AbortController()
    mountingSources.get(mountKey)?.abort()
    mountingSources.set(mountKey, cancellation)
    sourcesView.refresh()
    const effect = await addContainerWorkspaceFolder(folder, label)
    if (effect === 'rejected') {
      mountingSources.delete(mountKey)
      sourcesView.refresh()
      throw new Error(localizer.text('vscode.container.workspaceRejected'))
    }
    void vscode.commands.executeCommand('revealInExplorer', folder).then(undefined, () => undefined)
    log(`container ${effect} in the workspace in ${String(Date.now() - startedAt)} ms: ${label}`)
    try {
      const index = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Modkit: ${label}` },
        () => containers.index(absolute, cancellation.signal),
      )
      return Object.freeze({
        container: absolute,
        folder,
        indexedFiles: index.files.size,
        workspaceEffect: effect,
      })
    } finally {
      if (mountingSources.get(mountKey) === cancellation) mountingSources.delete(mountKey)
      sourcesView.refresh()
    }
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

  /** Run one container change and answer in the filesystem's own error vocabulary. */
  const changeContainer = async (uri: vscode.Uri, change: () => Promise<void>): Promise<void> => {
    try {
      await change()
    } catch (error) {
      if (error instanceof vscode.FileSystemError) throw error
      const message = error instanceof Error ? error.message : String(error)
      log(`[container] ${uri.path}: ${message}`)
      if (isModkitError(error) && error.code === CONTAINER_ENTRY_EXISTS) {
        throw vscode.FileSystemError.FileExists(message)
      }
      if (isModkitError(error) && error.code === CONTAINER_ENTRY_NOT_FOUND) {
        throw vscode.FileSystemError.FileNotFound(message)
      }
      throw vscode.FileSystemError.NoPermissions(message)
    }
  }

  const containerChanges = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  context.subscriptions.push(containerChanges)
  // The same Explorer accepts local containers and remote VFS roots. This adapter owns no login protocol.
  let contentSources: Promise<ContentSources | undefined> | undefined
  /** The roots the inventory loaded, one per extension, for the content-source modules they declare. */
  const extensionRootPaths = (): string[] => contentSourceRoots(host.services.host.inventory)
  const resetContentSources = (): void => {
    const previous = contentSources
    contentSources = undefined
    void previous?.then(source => source?.dispose()).catch(() => undefined)
  }
  /*
   * The confirmed installations of every game none is selected for, and where this window works:
   * such a game's sources read the one that holds a workspace folder or an open file, else the only
   * one found (`selectedInstallationDirectory`). Taken when the sources compose; a selection resets
   * them. ponytail: a file opened later in another installation keeps the composed one until the
   * sources are composed again; choosing it in «Select Game Installation» does that.
   */
  const foundInstallations = async (): Promise<{
    readonly installations: readonly SelectedContentSource[]
    readonly anchors: readonly string[]
  }> => {
    const chosen = new Set(presentSources().map(source => source.gameId))
    const games = installationGameIds(host.services.host.inventory).filter(id => !chosen.has(id))
    const searched = await searchedInstallationFolders()
    const found = await Promise.all(
      games.map(async gameId => {
        const searchPaths = searched?.found[gameId] ?? []
        const discovery = await discoverGameInstallations({
          services: host.services,
          gameId,
          ...(searchPaths.length === 0 ? {} : { searchPaths }),
          maxCandidates: 32,
          grant: {
            id: 'vscode-content-source-installations',
            classes:
              process.platform === 'win32'
                ? ['filesystem-read', 'process-launch']
                : ['filesystem-read'],
          },
          budgets: GAME_DISCOVERY_BUDGET,
        }).catch(() => undefined)
        return discovery?.state === 'discovered'
          ? discovery.result.installations.map(selectedContentSource)
          : []
      }),
    )
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs)
    const anchors = [
      ...(vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri),
      ...tabs.flatMap(({ input }) =>
        input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom
          ? [input.uri]
          : [],
      ),
    ].flatMap(uri => (uri.scheme === 'file' ? [uri.fsPath] : []))
    const installations = found.flat()
    if (installations.length > 0)
      log(
        `[installation] found with none selected: ${installations.map(item => `${item.gameId} ${item.installPath}`).join(', ')}`,
      )
    return { installations, anchors }
  }
  const requireContentSources = async (): Promise<ContentSources> => {
    if (!vscode.workspace.isTrusted) throw new Error('Content sources require a trusted workspace')
    const storage = join(context.globalStorageUri.fsPath, 'content-sources')
    const defaultConfig = join(storage, 'provider.json')
    const configuredSetting = vscode.workspace
      .getConfiguration('modkit')
      .get<unknown>('contentSourceConfig')
    const configuredPath =
      typeof configuredSetting === 'string' && configuredSetting.trim().length > 0
        ? configuredSetting.trim()
        : undefined
    // Without an explicit configuration every extension's declared sources compose; each module
    // learns the chosen installation of its own game through moduleOptions and keeps its state (the
    // public Battle.net catalogue included) in the host's `<storage>/state`.
    const configured =
      process.env['MODKIT_CONTENT_SOURCE_CONFIG'] ??
      configuredPath ??
      (existsSync(defaultConfig) ? defaultConfig : undefined)
    // One extension's module options: the chosen installation of its game and the team's settings.
    const moduleOptionsOf = (
      extension: string,
      found: Parameters<typeof selectedInstallationDirectory>[3],
    ): Readonly<Record<string, unknown>> | undefined => {
      const installationDirectory = selectedInstallationDirectory(
        host.services.host.inventory,
        presentSources(),
        extension,
        found,
      )
      // the settings a team commits (plan 8.9) win over the installation one user picked here
      const configured = contentSourceOptionsFor(
        vscode.workspace.getConfiguration('modkit').inspect('contentSourceOptions') ?? {},
        extension,
        {
          workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(folder => ({
            name: folder.name,
            path: folder.uri.fsPath,
          })),
          env: process.env,
          userHome: homedir(),
        },
      )
      // StarCraft II keeps the Data parses of these stock mods' chains (owner decision 10.10)
      const cachedMods =
        extension === 'blizzard/starcraft2'
          ? vscode.workspace.getConfiguration('modkit').get<unknown>('starcraft2.cachedMods')
          : undefined
      const kept =
        Array.isArray(cachedMods) && cachedMods.every(item => typeof item === 'string')
          ? { cachedMods }
          : undefined
      if (installationDirectory === undefined && configured === undefined && kept === undefined)
        return undefined
      return {
        ...(installationDirectory === undefined ? {} : { installationDirectory }),
        ...kept,
        ...configured,
      }
    }
    if (contentSources === undefined) {
      const finished = timing.phase('content sources (every extension that declares them)')
      // the user's per-product switches: a module keeps no name index its product turned off
      const indexCaches = configuredIndexCaches(
        vscode.workspace.getConfiguration('modkit').get('indexCaches'),
      ).switches
      contentSources = foundInstallations().then(found =>
        resolveContentSources({
          extensionRoots: extensionRootPaths(),
          ...(configured === undefined ? {} : { configPath: configured }),
          storage,
          indexCacheDirectory,
          indexCaches,
          moduleOptions: extension => moduleOptionsOf(extension, found),
          // each extension's module reaches only the credentials that extension declared
          credentials: extension => host.services.credentials?.portFor(extension),
        }).then(created =>
          created === undefined
            ? undefined
            : // a context that takes a while says so in the status bar, as MK2's did (plan 0.8)
              announceModContexts(
                // The loaded mods live in the user's shared mod server (owner decision 07.10): one
                // process for every window, the LSP and MCP; without it this window loads them.
                withSharedModContexts(created, {
                  enabled: vscode.workspace
                    .getConfiguration('modkit')
                    .get<boolean>('sharedModServer', true),
                  extensionRoots: extensionRootPaths(),
                  ...(configured === undefined ? {} : { configPath: configured }),
                  storage,
                  indexCacheDirectory,
                  indexCaches,
                  moduleOptions: Object.fromEntries(
                    [
                      ...new Set(
                        host.services.host.inventory.extensions.map(
                          item => `${item.manifest.publisher}/${item.manifest.id}`,
                        ),
                      ),
                    ].flatMap(extension => {
                      const options = moduleOptionsOf(extension, found)
                      return options === undefined ? [] : [[extension, options] as const]
                    }),
                  ),
                  daemonScript: join(extensionRoot, 'dist-app', 'mod-server-daemon.js'),
                  onFallback: error =>
                    log(`[mod-server] unavailable, this window loads its mods: ${String(error)}`),
                }),
                {
                  delayMs: MOD_CONTEXT_PROGRESS_DELAY_MS,
                  building: opening =>
                    void vscode.window.withProgress(
                      {
                        location: vscode.ProgressLocation.Window,
                        title: localizer.text('vscode.modContext.building'),
                      },
                      () => opening,
                    ),
                  ready: layers =>
                    vscode.window.setStatusBarMessage(
                      localizer.text('vscode.modContext.ready', { layers }),
                      4_000,
                    ),
                },
              ),
        ),
      )
      void contentSources.finally(finished).catch(() => undefined)
      // Tickets and keys kept before the broker move into it once the sources say whose they are.
      void contentSources
        .then(created => (created === undefined ? undefined : moveKeptTickets(created)))
        .catch(error => log(`[accounts] moving kept tickets: ${String(error)}`))
    }
    const source = await contentSources
    if (!source) throw new Error('No extension of this window offers content sources')
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
  /**
   * Which publications of a root are already in the local cache.
   *
   * The provider says so per row: a cached publication offers `clear-cache`, one that is not yet
   * downloaded offers `download`. Listing a root is a catalogue call, so the answer is held briefly
   * and dropped whenever a row is downloaded, cleared, added or detached.
   */
  /**
   * Which accounts this machine last had open, so a new window can take the same ones back.
   *
   * A native session is a process with a live connection: closing the window ends it, and nothing
   * here pretends otherwise. What survives is the sign-in itself, so reconnecting the remembered
   * account asks Battle.net for nothing the user has to type.
   */
  const knownConnections = (): readonly { region: string; accountId: string }[] => {
    const stored = context.globalState.get<unknown>(BATTLENET_CONNECTIONS_KEY)
    if (!Array.isArray(stored)) return []
    return stored.flatMap(item =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { region?: unknown }).region === 'string' &&
      typeof (item as { accountId?: unknown }).accountId === 'string'
        ? [
            {
              region: (item as { region: string }).region,
              accountId: (item as { accountId: string }).accountId,
            },
          ]
        : [],
    )
  }
  /** Where tickets and keys were kept before the broker; read once, to move them into it. */
  const ticketKey = (region: string): string => `modkit.contentSources.ticket.${region}`
  const earlierTicketKey = (region: string): string => `modkit.battlenet.ticket.${region}`
  /** The declared credential a region stands for (`credentialId`), with the broker and its port. */
  const brokeredRegion = async (source: ContentSources, region: string) => {
    const broker = host.services.credentials
    const id = (await source.snapshot()).regions?.find(item => item.id === region)?.credentialId
    const entry =
      id === undefined ? undefined : broker?.declared().find(item => item.requirement.id === id)
    return broker === undefined || entry === undefined
      ? undefined
      : { broker, entry, id: entry.requirement.id, port: broker.portFor(entry.extension) }
  }
  /**
   * Tickets and keys kept before the broker, under either earlier name, move into it without loss:
   * adopt keeps a value the broker already holds, and the old entry goes only after that answer.
   * Kept for windows updating from a version that stored them there.
   */
  const moveKeptTickets = async (source: ContentSources): Promise<void> => {
    const broker = host.services.credentials
    if (broker === undefined) return
    await adoptKeptTickets({
      regions: (await source.snapshot()).regions ?? [],
      secrets: context.secrets,
      broker,
      keysFor: region => [ticketKey(region), earlierTicketKey(region)],
      log,
    })
  }
  /** A signed-out account must not be taken back: the broker forgets what it kept for the region. */
  const forgetRegion = async (region: string, source: ContentSources): Promise<void> => {
    const brokered = await brokeredRegion(source, region)
    if (brokered !== undefined) await brokered.broker.signOut(brokered.id, region)
  }
  /**
   * Connect an account. A key or an OAuth sign-in is acquired from the broker first (it asks and
   * keeps it; cancelling leaves the region as it was). A provider session — the service's own sign-in
   * page — takes and keeps its ticket through the source's own broker port, so nothing passes here.
   */
  const connectAccount = async (
    source: ContentSources,
    region: string,
    accountId?: string,
  ): Promise<void> => {
    const brokered = await brokeredRegion(source, region)
    if (brokered !== undefined && brokered.entry.requirement.kind !== 'provider-session') {
      const status = await brokered.port.acquire(brokered.id, {
        reason: localizer.text('vscode.accounts.reasonConnect', {
          label: brokered.entry.requirement.label,
        }),
        interactive: true,
        scope: region,
      })
      if (status !== 'available') return
    }
    await callContentSources(source, 'connect', [region, accountId])
    await rememberConnections(source)
  }
  const rememberedAccount = (region: string): string | undefined =>
    knownConnections().find(item => item.region === region)?.accountId
  const rememberConnections = async (source: ContentSources): Promise<void> => {
    const snapshot = await source.snapshot()
    await context.globalState.update(
      BATTLENET_CONNECTIONS_KEY,
      (snapshot.connections ?? []).map(item => ({
        region: item.region,
        accountId: item.accountId,
      })),
    )
  }
  /** A row action arrives as the Explorer's URI; anything else is not a content-source row. */
  const contentSourceRow = (
    argument: unknown,
  ): { readonly id: string; readonly path: string; readonly name: string } | undefined => {
    const uri =
      argument instanceof vscode.Uri
        ? argument
        : typeof argument === 'object' &&
            argument !== null &&
            (argument as { readonly resourceUri?: unknown }).resourceUri instanceof vscode.Uri
          ? (argument as { readonly resourceUri: vscode.Uri }).resourceUri
          : undefined
    if (uri === undefined) {
      // A row action may arrive as a tree node instead of an Explorer URI.
      const row =
        typeof argument === 'object' && argument !== null
          ? (argument as { readonly sourceId?: unknown; readonly normalizedPath?: unknown })
          : undefined
      return typeof row?.sourceId === 'string' && typeof row.normalizedPath === 'string'
        ? { id: row.sourceId, path: row.normalizedPath, name: row.normalizedPath }
        : undefined
    }
    try {
      const location = sourceLocation(uri)
      if (!location.path) return undefined
      return { ...location, name: location.path.split('/').at(-1) ?? location.path }
    } catch {
      return undefined
    }
  }
  const sourceDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>()
  const cacheStates = new Map<
    string,
    { readonly at: number; readonly rows: Map<string, boolean> }
  >()
  const CACHE_STATE_TTL = 15_000
  const forgetCacheStates = (id?: string) => {
    if (id === undefined) cacheStates.clear()
    else cacheStates.delete(id)
    sourceDecorations.fire(undefined)
  }
  /*
   * A publication that was read is downloaded from that moment, whoever caused the read. The row
   * is redrawn once per publication, not once per file inside it: opening a mod reads hundreds of
   * entries, and each one would otherwise ask the provider again.
   */
  const readPublications = new Set<string>()
  const publicationRead = (location: { readonly id: string; readonly path: string }): void => {
    const root = location.path.split('/')[0]
    if (root === undefined || root === '') return
    const key = `${location.id}/${root}`
    if (readPublications.has(key)) return
    rowChanged({ id: location.id, path: root })
    readPublications.add(key)
  }
  const storageStates = new Map<string, { readonly at: number; readonly text: string }>()
  const STORAGE_TTL = 60_000
  /** A row whose cache state changed is redrawn at once: decoration, colour and tree row. */
  const rowChanged = (target: { readonly id: string; readonly path: string }): void => {
    cacheStates.delete(target.id)
    // Clearing a local copy makes the next read count again.
    readPublications.delete(`${target.id}/${target.path}`)
    sourceDecorations.fire(
      vscode.Uri.parse(
        `modkit-source://battlenet/${encodeURIComponent(target.id)}/${target.path
          .split('/')
          .map(part => encodeURIComponent(part))
          .join('/')}`,
      ),
    )
    sourcesView.refresh()
  }
  const cacheStateOf = async (id: string): Promise<Map<string, boolean>> => {
    const held = cacheStates.get(id)
    if (held !== undefined && Date.now() - held.at < CACHE_STATE_TTL) return held.rows
    const rows = new Map<string, boolean>()
    for (const entry of await (await requireContentSources()).list(id, '')) {
      const actions = entry.actions ?? []
      if (actions.some(action => action.id === 'clear-cache')) rows.set(entry.name, true)
      else if (actions.some(action => action.id === 'download')) rows.set(entry.name, false)
    }
    cacheStates.set(id, { at: Date.now(), rows })
    return rows
  }
  /*
   * Editing a published document.
   *
   * What the cache holds is not editable: the archive is named by its own digest, shared with
   * every other window, and replaced whenever the publication moves. Editing one therefore means
   * a copy the author places and owns. This window remembers where that copy went and what it
   * looked like when it was taken, which is the whole of what «changed» means on the row.
   */
  const WORKING_COPY_KEY = 'modkit.battlenet.workingCopies'
  interface WorkingCopy {
    readonly id: string
    readonly name: string
    readonly path: string
    readonly size: number
    readonly mtime: number
  }
  const workingCopyKey = (id: string, name: string): string => JSON.stringify([id, name])
  const workingCopies = (): Record<string, WorkingCopy> => {
    const stored = context.globalState.get<unknown>(WORKING_COPY_KEY)
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
    const copies: Record<string, WorkingCopy> = {}
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      const copy = value as Partial<WorkingCopy> | null
      if (
        typeof copy?.id === 'string' &&
        typeof copy.name === 'string' &&
        typeof copy.path === 'string' &&
        typeof copy.size === 'number' &&
        typeof copy.mtime === 'number'
      ) {
        copies[key] = copy as WorkingCopy
      }
    }
    return copies
  }
  const rememberWorkingCopy = async (copy: WorkingCopy | undefined, key: string): Promise<void> => {
    const kept = Object.fromEntries(
      Object.entries(workingCopies()).filter(([held]) => held !== key),
    )
    await context.globalState.update(
      WORKING_COPY_KEY,
      copy === undefined ? kept : { ...kept, [key]: copy },
    )
  }
  /*
   * ponytail: a copy counts as edited when its size or its modification time no longer match the
   * moment it was taken. Digesting the archive instead would read every working copy on every
   * listing; compare digests here only if an editor that rewrites a file without moving either
   * ever turns up. `undefined` means the file is no longer there.
   */
  const workingCopyEdited = async (copy: WorkingCopy): Promise<boolean | undefined> => {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(copy.path))
      return stat.size !== copy.size || stat.mtime !== copy.mtime
    } catch {
      return undefined
    }
  }
  /** What a publication row should say about its working copy, if it has one at all. */
  const workingCopyState = async (
    id: string,
    name: string,
  ): Promise<'clean' | 'edited' | undefined> => {
    const copy = workingCopies()[workingCopyKey(id, name)]
    if (copy === undefined) return undefined
    const edited = await workingCopyEdited(copy)
    return edited === undefined ? undefined : edited ? 'edited' : 'clean'
  }
  /*
   * What each account's catalogue held when it was last read.
   *
   * A window that opens before any connection still has to show the account's mods: the folder was
   * mounted in this workspace and the reader expects to find it there. So the listing is kept, and
   * a root served from it is greyed until a connection refreshes it — the rows are real names, not
   * a promise that they are usable offline.
   */
  interface RememberedCatalogue {
    readonly label: string
    readonly region: string
    readonly accountId: string
    readonly at: number
    readonly names: readonly string[]
  }
  const catalogues = (): Record<string, RememberedCatalogue> =>
    context.globalState.get<Record<string, RememberedCatalogue>>(CATALOGUE_KEY) ?? {}
  const staleRoots = new Set<string>()
  const noteCatalogue = async (id: string, names: readonly string[]): Promise<void> => {
    if (!id.startsWith('mine:')) return
    const source = await contentSources?.catch(() => undefined)
    const snapshot =
      source === undefined ? undefined : await source.snapshot().catch(() => undefined)
    const root = snapshot?.roots.find(item => item.id === id)
    const connection = snapshot?.connections.find(item => `mine:${item.id}` === id)
    if (root === undefined || connection === undefined) return
    await context.globalState.update(CATALOGUE_KEY, {
      ...catalogues(),
      [id]: {
        label: root.label,
        region: root.region,
        accountId: connection.accountId,
        at: Date.now(),
        names: [...names],
      },
    })
  }
  /**
   * Take the account back on demand: reaching for a root this window has no connection for is a
   * reason to sign in, not an error to report. One attempt at a time per account, so a folder that
   * fans out into many reads asks once.
   */
  const signingIn = new Map<string, Promise<boolean>>()
  const signInFor = (id: string): Promise<boolean> => {
    const remembered = catalogues()[id]
    if (remembered === undefined) return Promise.resolve(false)
    let task = signingIn.get(id)
    if (task === undefined) {
      task = (async () => {
        const source = await requireContentSources()
        if ((await source.snapshot()).roots.some(root => root.id === id)) return true
        await connectAccount(source, remembered.region, remembered.accountId)
        staleRoots.delete(id)
        sourceDecorations.fire(undefined)
        sourcesView.refresh()
        return true
      })().catch(() => false)
      signingIn.set(id, task)
      void task.finally(() => signingIn.delete(id))
    }
    return task
  }
  const sourceDecorationProvider: vscode.FileDecorationProvider = {
    onDidChangeFileDecorations: sourceDecorations.event,
    async provideFileDecoration(uri) {
      if (uri.scheme === 'modkit-account') {
        return {
          color: new vscode.ThemeColor('disabledForeground'),
          tooltip: localizer.text('vscode.sources.disconnected'),
        }
      }
      if (uri.scheme !== 'modkit-source') return undefined
      let location: { id: string; path: string }
      try {
        location = sourceLocation(uri)
      } catch {
        return undefined
      }
      /*
       * A working copy outranks «listed from the last session». Both can be true of one row, and
       * of the two only the copy is something the reader can act on right now — the stale list is
       * about the account, the copy is about this document.
       */
      if (location.path && !location.path.includes('/')) {
        const copy = workingCopies()[workingCopyKey(location.id, location.path)]
        const state = copy === undefined ? undefined : await workingCopyState(location.id, location.path)
        if (copy !== undefined && state !== undefined) {
          return state === 'edited'
            ? {
                badge: '●',
                color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
                tooltip: localizer.text('vscode.sources.copyEditedTip', { path: copy.path }),
              }
            : { tooltip: localizer.text('vscode.sources.copyCleanTip', { path: copy.path }) }
        }
      }
      // A root served from the last session says so, and says it about its rows too.
      if (staleRoots.has(location.id)) {
        return {
          ...(location.path && !location.path.includes('/') ? { badge: '☁' } : {}),
          color: new vscode.ThemeColor('disabledForeground'),
          tooltip: localizer.text('vscode.sources.stale'),
        }
      }
      // Only a publication row carries a cache state; everything below it lives inside one.
      if (!location.path || location.path.includes('/')) return undefined
      const cached = (await cacheStateOf(location.id).catch(() => undefined))?.get(location.path)
      if (cached === undefined) return undefined
      return cached
        ? { tooltip: localizer.text('vscode.sources.cached') }
        : {
            badge: '☁',
            color: new vscode.ThemeColor('disabledForeground'),
            tooltip: localizer.text('vscode.sources.notCached'),
          }
    },
  }
  /** The content-source root that reads `directory`'s storage (`storageOf`), if one does. */
  const sourceServingInstallation = (directory: string) =>
    requireContentSources()
      .then(sources => contentSourceRootServing(sources, directory))
      .catch(() => undefined)
  const openContentSourceRoot = async (source: {
    readonly id: string
    readonly label: string
  }): Promise<void> => {
    if (!vscode.workspace.workspaceFolders?.length) {
      throw new Error(localizer.text('vscode.container.openFolderFirst'))
    }
    const uri = vscode.Uri.from({
      scheme: 'modkit-source',
      authority: 'battlenet',
      path: `/${source.id}`,
    })
    const cancellation = new AbortController()
    mountingSources.get(source.id)?.abort()
    mountingSources.set(source.id, cancellation)
    sourcesView.refresh()
    let result: Awaited<ReturnType<typeof addContainerWorkspaceFolder>>
    try {
      result = await addContainerWorkspaceFolder(uri, source.label)
    } finally {
      if (mountingSources.get(source.id) === cancellation) mountingSources.delete(source.id)
      sourcesView.refresh()
    }
    if (result === 'rejected') {
      // Say which folder the workspace refused: the id is what distinguishes one root from the
      // next, and without it every refused mount reads as the same unactionable failure.
      log(`content source mount rejected: ${uri.toString()}`)
      throw new Error(
        `The workspace could not add this content source: ${uri.toString(true)}. ` +
          'Reload the window and try again.',
      )
    }
    await vscode.commands.executeCommand('revealInExplorer', uri)
  }
  const revealLocalPath = async (target: ContentSourceLocalPath): Promise<boolean> => {
    if (!isAbsolute(target.path))
      throw new Error('The content provider returned a non-absolute local path')
    const uri = vscode.Uri.file(target.path)
    if (target.kind === 'directory') return vscode.env.openExternal(uri)
    await vscode.commands.executeCommand('revealFileInOS', uri)
    return true
  }
  const revealLocalSource = async (argument: unknown): Promise<boolean> => {
    // A publication row in the Sources view carries the same target as its Explorer URI.
    const row = argument instanceof vscode.Uri ? undefined : contentSourceRow(argument)
    if (row !== undefined) {
      const target = (await callContentSources(await requireContentSources(), 'resolveLocalPath', [
        row.id,
        row.path,
      ])) as ContentSourceLocalPath | undefined
      if (target !== undefined) return revealLocalPath(target)
    }
    if (argument instanceof vscode.Uri) {
      if (argument.scheme === 'modkit-source') {
        const location = sourceLocation(argument)
        const target = (await callContentSources(
          await requireContentSources(),
          'resolveLocalPath',
          [location.id, location.path],
        )) as ContentSourceLocalPath | undefined
        if (target !== undefined) return revealLocalPath(target)
      } else if (argument.scheme === CONTAINER_SCHEME) {
        const location = parseContainerUriPath(argument.path)
        if (location !== undefined) {
          const path = splitContainer(location.container).file
          const stat = statSync(path)
          return revealLocalPath({ path, kind: stat.isDirectory() ? 'directory' : 'file' })
        }
      } else if (argument.scheme === 'file') {
        const stat = statSync(argument.fsPath)
        return revealLocalPath({
          path: argument.fsPath,
          kind: stat.isDirectory() ? 'directory' : 'file',
        })
      }
    }
    if (typeof argument === 'object' && argument !== null) {
      const row = argument as { readonly sourceId?: unknown; readonly uri?: unknown }
      if (typeof row.sourceId === 'string') {
        const target = (await callContentSources(
          await requireContentSources(),
          'resolveLocalPath',
          [row.sourceId, ''],
        )) as ContentSourceLocalPath | undefined
        if (target !== undefined) return revealLocalPath(target)
      }
      if (typeof row.uri === 'string' && isAbsolute(row.uri)) {
        const stat = statSync(row.uri)
        return revealLocalPath({ path: row.uri, kind: stat.isDirectory() ? 'directory' : 'file' })
      }
    }
    void vscode.window.showInformationMessage('Modkit: This source has no local folder to reveal.')
    return false
  }
  const sourcesView = new SourcesView(
    () =>
      (vscode.workspace.workspaceFolders ?? []).map(folder => ({
        name: folder.name,
        uri: folder.uri.toString(),
      })),
    () => selectedSources,
    () =>
      new Set(
        (vscode.workspace.workspaceFolders ?? [])
          .filter(folder => folder.uri.scheme === 'modkit-source')
          .map(folder => folder.uri.path.replace(/^\//u, '').split('/')[0])
          .filter((id): id is string => id !== undefined && id.length > 0),
      ),
    async () => (await requireContentSources()).snapshot(),
    localizer,
    () =>
      new Set(
        (vscode.workspace.workspaceFolders ?? [])
          .filter(folder => folder.uri.scheme === CONTAINER_SCHEME)
          .flatMap(folder => {
            const location = parseContainerUriPath(folder.uri.path)
            return location === undefined || location.entry !== ''
              ? []
              : [normalizedSourcePath(location.container)]
          }),
      ),
    () => new Set(mountingSources.keys()),
    () => knownConnections(),
    async sourceId => {
      try {
        const rows = await (await requireContentSources()).list(sourceId, '', {
          includeHidden: showHiddenEntries(),
        })
        const states = await cacheStateOf(sourceId).catch(() => new Map<string, boolean>())
        staleRoots.delete(sourceId)
        void noteCatalogue(
          sourceId,
          rows.map(row => row.name),
        )
        // Only the few rows this window actually took a copy of are stat'ed, not the catalogue.
        const copies = workingCopies()
        return Promise.all(
          rows
            .filter(row => row.directory)
            .map(async row => {
              const copy =
                copies[workingCopyKey(sourceId, row.name)] === undefined
                  ? undefined
                  : await workingCopyState(sourceId, row.name)
              return {
                name: row.name,
                cached: states.get(row.name) === true,
                ...(copy === undefined ? {} : { copy }),
              }
            }),
        )
      } catch (error) {
        // Not connected: the account's mods are listed from the last session, and stay greyed.
        const remembered = catalogues()[sourceId]
        if (remembered === undefined) throw error
        staleRoots.add(sourceId)
        return remembered.names.map(name => ({ name, cached: false }))
      }
    },
    () =>
      Object.entries(catalogues()).map(([id, entry]) => ({
        id,
        label: entry.label,
        region: entry.region,
      })),
    async () => {
      /*
       * What an account has left to publish into. It is one query per connected account, held
       * briefly: the number moves only when something is published, and a tree redraw must not
       * turn into a round of network calls.
       */
      const source = await contentSources?.catch(() => undefined)
      const rows = new Map<string, string>()
      if (source === undefined) return rows
      const snapshot = await source.snapshot().catch(() => undefined)
      for (const connection of snapshot?.connections ?? []) {
        const id = `mine:${connection.id}`
        const held = storageStates.get(id)
        let text = held !== undefined && Date.now() - held.at < STORAGE_TTL ? held.text : undefined
        if (text === undefined) {
          const answer = (await callContentSources(source, 'storage', [connection.id]).catch(
            () => undefined,
          )) as
            | { usedBytes?: number; maxBytes?: number; usedSlots?: number; maxSlots?: number }
            | undefined
          if (answer?.usedBytes !== undefined && answer.maxBytes !== undefined) {
            const mib = (value: number) => Math.round(value / (1024 * 1024))
            text = localizer.text('vscode.sources.storage', {
              used: String(mib(answer.usedBytes)),
              total: String(mib(answer.maxBytes)),
              slots: String(answer.usedSlots ?? 0),
              maxSlots: String(answer.maxSlots ?? 0),
            })
            storageStates.set(id, { at: Date.now(), text })
          }
        }
        if (text !== undefined) rows.set(id, text)
      }
      return rows
    },
  )
  const sourceFileSystem: vscode.FileSystemProvider = {
    onDidChangeFile: sourceChanges.event,
    watch: () => new vscode.Disposable(() => undefined),
    async stat(uri) {
      const location = sourceLocation(uri)
      const source = await requireContentSources()
      const directory = {
        type: vscode.FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
        permissions: vscode.FilePermission.Readonly,
      }
      if (!location.path) {
        if ((await source.snapshot()).roots.some(root => root.id === location.id)) return directory
        // Not connected in this window: the folder is still the one that was mounted here.
        if (catalogues()[location.id] === undefined) throw vscode.FileSystemError.FileNotFound(uri)
        staleRoots.add(location.id)
        return directory
      }
      const parts = location.path.split('/')
      const name = parts.pop()
      const node = (
        // A path named exactly is found hidden or not: only listings and search leave them out.
        await source.list(location.id, parts.join('/'), { includeHidden: true }).catch((error: unknown) => {
          if (parts.length === 0 && catalogues()[location.id]?.names.includes(name ?? ''))
            return undefined
          throw error
        })
      )?.find(item => item.name === name)
      if (!node) {
        if (parts.length === 0 && catalogues()[location.id]?.names.includes(name ?? '')) {
          staleRoots.add(location.id)
          return directory
        }
        throw vscode.FileSystemError.FileNotFound(uri)
      }
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
      const read = async (): Promise<[string, vscode.FileType][]> => {
        // The sources leave hidden entries out unless the option asks for them (vfs `includeHidden`).
        const entries = await (await requireContentSources()).list(location.id, location.path, {
          includeHidden: showHiddenEntries(),
        })
        if (!location.path) {
          staleRoots.delete(location.id)
          void noteCatalogue(
            location.id,
            entries.map(entry => entry.name),
          )
        }
        // Browsing inside a publication downloads it, so the row it belongs to has to say so.
        publicationRead(location)
        return entries.map(entry => [
          entry.name,
          entry.directory ? vscode.FileType.Directory : vscode.FileType.File,
        ])
      }
      try {
        return await read()
      } catch (error) {
        const remembered = catalogues()[location.id]
        if (remembered === undefined) throw error
        /*
         * Reaching into a mod that is not loaded is the moment to ask for the account: the reader
         * asked for its contents, and only the account can produce them. The root itself is served
         * from the last session instead, so a window opens with the mods it had.
         */
        if (location.path && (await signInFor(location.id))) return read()
        if (location.path) throw error
        staleRoots.add(location.id)
        sourceDecorations.fire(undefined)
        return remembered.names.map(name => [name, vscode.FileType.Directory])
      }
    },
    async readFile(uri) {
      const location = sourceLocation(uri)
      const read = async (): Promise<Uint8Array> => {
        const bytes = await (
          await requireContentSources()
        ).read(location.id, location.path, 64 * 1024 * 1024)
        publicationRead(location)
        return bytes
      }
      try {
        return await read()
      } catch (error) {
        if (await signInFor(location.id)) return read()
        throw error
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
  const operationOutputs = createOperationOutputStore()
  const operationOutputChanged = new vscode.EventEmitter<vscode.Uri>()
  if (!languageOnly)
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
      /*
       * Signing in and out are first-class rows, not steps buried in a quick-pick.
       *
       * The provider already models several accounts at once — one connection per account and
       * region — so the view offers the region list to add one and offers sign-out on the
       * connection itself. Nothing here holds a credential: the provider owns the login.
       */
      vscode.commands.registerCommand('modkit.sources.signIn', async (argument: unknown) => {
        const source = await requireContentSources()
        // Selecting an account the machine knows connects that one, without asking for a region.
        const offline =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly offlineAccount?: { region?: unknown; accountId?: unknown } })
                .offlineAccount
            : undefined
        if (typeof offline?.region === 'string' && typeof offline.accountId === 'string') {
          await connectAccount(source, offline.region, offline.accountId)
          sourcesView.refresh()
          return true
        }
        const snapshot = await source.snapshot()
        const regions = snapshot.regions ?? []
        if (regions.length === 0) {
          /*
           * There is nothing to sign in to unless the provider's online half is configured: it
           * runs the official Blizzard login out of process, so it needs a native runtime this
           * window does not ship. Say that, and offer the setting that points at it.
           */
          const open = await vscode.window.showWarningMessage(
            localizer.text('vscode.sources.onlineUnavailable'),
            localizer.text('vscode.sources.openSetting'),
          )
          if (open !== undefined) {
            await vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'modkit.contentSourceConfig',
            )
          }
          return false
        }
        const chosen =
          regions.length === 1
            ? regions[0]
            : await vscode.window.showQuickPick(
                regions.map(region => ({
                  label: region.label,
                  description: region.id,
                  id: region.id,
                })),
                { title: localizer.text('vscode.sources.chooseRegion') },
              )
        const region = chosen === undefined ? undefined : 'id' in chosen ? chosen.id : undefined
        if (typeof region !== 'string') return false
        await connectAccount(source, region, rememberedAccount(region))
        sourcesView.refresh()
        return true
      }),

      /*
       * Deleting one of this account's publications. The backend hands back a description of
       * exactly the row it will delete, and that description — not the row that was clicked — is
       * what the reader confirms, so a stale tree cannot delete the wrong publication.
       */
      vscode.commands.registerCommand(
        'modkit.sources.deletePublication',
        async (argument: unknown) => {
          const target = contentSourceRow(argument)
          if (target === undefined) return false
          const source = await requireContentSources()
          const review = (await callContentSources(source, 'prepareDeletePublication', [
            target.id,
            target.path,
          ])) as { id: string; label: string; description: string }
          const confirmed = await vscode.window.showWarningMessage(
            localizer.text('vscode.sources.confirmDelete', {
              name: review.label,
              detail: review.description,
            }),
            { modal: true },
            localizer.text('vscode.sources.deleteAction'),
          )
          if (confirmed === undefined) return false
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: localizer.text('vscode.sources.deleting', { name: review.label }),
            },
            () => callContentSources(source, 'deletePublication', [review.id]),
          )
          rowChanged(target)
          void vscode.window.showInformationMessage(
            localizer.text('vscode.sources.deleted', { name: review.label }),
          )
          return true
        },
      ),

      /*
       * Publishing a document Battle.net has never seen.
       *
       * The server is asked about the name first: it answers with the attribute namespace the
       * header must carry, and refuses outright if the name is already published — which is what
       * separates creating a publication from revising one.
       */
      vscode.commands.registerCommand('modkit.sources.publishNew', async (argument: unknown) => {
        const source = await requireContentSources()
        const snapshot = await source.snapshot()
        if (snapshot.publishing !== true) {
          void vscode.window.showWarningMessage(localizer.text('vscode.sources.publishUnavailable'))
          return false
        }
        const row =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly sourceId?: unknown })
            : undefined
        const connections = snapshot.connections ?? []
        const chosen =
          typeof row?.sourceId === 'string' && row.sourceId.startsWith('mine:')
            ? connections.find(item => `mine:${item.id}` === row.sourceId)
            : connections.length === 1
              ? connections[0]
              : await vscode.window
                  .showQuickPick(
                    connections.map(item => ({
                      label: item.label,
                      description: item.region.toUpperCase(),
                      id: item.id,
                    })),
                    { title: localizer.text('vscode.sources.chooseConnection') },
                  )
                  .then(picked =>
                    picked === undefined
                      ? undefined
                      : connections.find(item => item.id === picked.id),
                  )
        if (chosen === undefined) return false
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: localizer.text('vscode.sources.publishConfirmAction'),
          title: localizer.text('vscode.sources.publishNewArchive'),
          filters: { StarCraft: ['SC2Map', 'SC2Mod', 's2ma'] },
        })
        const archivePath = picked?.[0]?.fsPath
        if (archivePath === undefined) return false
        const name = await vscode.window.showInputBox({
          title: localizer.text('vscode.sources.publishNewName'),
          placeHolder: localizer.text('vscode.sources.publishNewNamePlaceholder'),
          value:
            archivePath
              .split(/[\\/]/u)
              .at(-1)
              ?.replace(/\.(SC2Map|SC2Mod|s2ma)$/iu, '') ?? '',
          validateInput: value =>
            value.trim().length > 0 && value.trim().length <= 80 ? undefined : '',
        })
        if (name === undefined || name.trim().length === 0) return false
        const listing = await vscode.window.showQuickPick(
          [
            { label: localizer.text('vscode.sources.publishPrivate'), value: 'private' as const },
            { label: localizer.text('vscode.sources.publishPublic'), value: 'public' as const },
          ],
          { title: localizer.text('vscode.sources.publishVisibility') },
        )
        if (listing === undefined) return false
        const lock = await vscode.window.showQuickPick(
          [
            {
              label: localizer.text('vscode.sources.publishLockedProtected'),
              value: true,
              protect: true,
            },
            {
              label: localizer.text('vscode.sources.publishLockedYes'),
              value: true,
              protect: false,
            },
            {
              label: localizer.text('vscode.sources.publishLockedNo'),
              value: false,
              protect: false,
            },
          ],
          { title: localizer.text('vscode.sources.publishLocked') },
        )
        if (lock === undefined) return false
        const review = (await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: localizer.text('vscode.sources.publishPreparing'),
          },
          () =>
            callContentSources(source, 'prepareFirstPublication', [
              chosen.id,
              {
                archivePath,
                name: name.trim(),
                visibility: listing.value,
                locked: lock.value,
                protectHeader: lock.protect,
              },
            ]),
        )) as {
          id: string
          name: string
          account: string
          region: string
          bytes: number
          locked: boolean
        }
        const confirmed = await vscode.window.showWarningMessage(
          localizer.text('vscode.sources.publishNewConfirm', {
            name: review.name,
            region: review.region.toUpperCase(),
            visibility: localizer.text(
              listing.value === 'public'
                ? 'vscode.sources.publishPublic'
                : 'vscode.sources.publishPrivate',
            ),
            locked: review.locked ? ` + ${localizer.text('vscode.sources.publishLockedYes')}` : '',
            account: review.account,
            bytes: String(review.bytes),
          }),
          { modal: true },
          localizer.text('vscode.sources.publishConfirmAction'),
        )
        if (confirmed === undefined) return false
        const receipt = (await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: localizer.text('vscode.sources.publishing', { name: review.name }),
          },
          () => callContentSources(source, 'publish', [review.id]),
        )) as { publication?: { version?: number } }
        const published = receipt.publication?.version ?? 0
        forgetCacheStates()
        sourcesView.refresh()
        void vscode.window.showInformationMessage(
          localizer.text('vscode.sources.published', {
            name: review.name,
            version: `${published >>> 16}.${published & 0xffff}`,
          }),
        )
        return true
      }),

      /*
       * Taking a published document out for editing.
       *
       * The cached archive is not the thing to edit: it is named by its digest, shared between
       * windows, and thrown away when the publication moves. So the author says where the copy
       * goes, keeps it, and this window only remembers the link — publishing a revision then
       * offers that copy first, and the row says meanwhile whether it has been changed.
       */
      vscode.commands.registerCommand('modkit.sources.editCopy', async (argument: unknown) => {
        const target = contentSourceRow(argument)
        if (target === undefined) return false
        const source = await requireContentSources()
        const key = workingCopyKey(target.id, target.path)
        const existing = workingCopies()[key]
        if (existing !== undefined) {
          const state = await workingCopyEdited(existing)
          const chosen = await vscode.window.showQuickPick(
            [
              ...(state === undefined
                ? []
                : [{ label: localizer.text('vscode.sources.copyOpen'), action: 'open' as const }]),
              { label: localizer.text('vscode.sources.copyReplace'), action: 'replace' as const },
              { label: localizer.text('vscode.sources.copyForget'), action: 'forget' as const },
            ],
            { title: localizer.text('vscode.sources.copyExisting', { path: existing.path }) },
          )
          if (chosen === undefined) return false
          if (chosen.action === 'open') {
            await vscode.commands.executeCommand(
              'vscode.openWith',
              vscode.Uri.file(existing.path),
              CUSTOM_EDITOR_TYPE,
            )
            return true
          }
          if (chosen.action === 'forget') {
            // The author's file is theirs: the link goes, the copy stays where they put it.
            await rememberWorkingCopy(undefined, key)
            rowChanged(target)
            return true
          }
        }
        const cachedPath = async (): Promise<ContentSourceLocalPath | undefined> =>
          (await callContentSources(source, 'resolveLocalPath', [target.id, target.path])) as
            | ContentSourceLocalPath
            | undefined
        let local = await cachedPath()
        if (local === undefined) {
          // Nothing to copy until the archive is here; taking it is what the author just asked for.
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: localizer.text('vscode.sources.downloading', { name: target.name }),
            },
            () => callContentSources(source, 'download', [target.id, target.path]),
          )
          rowChanged(target)
          local = await cachedPath()
        }
        if (local === undefined) {
          void vscode.window.showWarningMessage(localizer.text('vscode.sources.copyUnavailable'))
          return false
        }
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri
        const destination = await vscode.window.showSaveDialog({
          title: localizer.text('vscode.sources.copyWhere', { name: target.name }),
          saveLabel: localizer.text('vscode.sources.copySave'),
          defaultUri:
            folder === undefined
              ? vscode.Uri.file(target.name)
              : vscode.Uri.joinPath(folder, target.name),
        })
        if (destination === undefined) return false
        await vscode.workspace.fs.copy(vscode.Uri.file(local.path), destination, { overwrite: true })
        const stat = await vscode.workspace.fs.stat(destination)
        await rememberWorkingCopy(
          {
            id: target.id,
            name: target.path,
            path: destination.fsPath,
            size: stat.size,
            mtime: stat.mtime,
          },
          key,
        )
        rowChanged(target)
        await vscode.commands.executeCommand('vscode.openWith', destination, CUSTOM_EDITOR_TYPE)
        return true
      }),

      /*
       * Publishing a revision of one of this account's publications.
       *
       * A revision is not a new publication: the name, the preview images and everything the
       * catalogue reports about how the mod is listed come from the header it already has, and
       * only the archive and the two flags the author chose are new. Each choice is asked once,
       * and nothing is sent until the compiled package is described and accepted.
       */
      vscode.commands.registerCommand('modkit.sources.publish', async (argument: unknown) => {
        const target = contentSourceRow(argument)
        if (target === undefined) return false
        const source = await requireContentSources()
        if ((await source.snapshot()).publishing !== true) {
          void vscode.window.showWarningMessage(localizer.text('vscode.sources.publishUnavailable'))
          return false
        }
        // A working copy is what the author has been editing, so it is what a revision means here.
        const copyKey = workingCopyKey(target.id, target.path)
        const workingCopy = workingCopies()[copyKey]
        const copyState = workingCopy === undefined ? undefined : await workingCopyEdited(workingCopy)
        const archive = await vscode.window.showQuickPick(
          [
            ...(workingCopy === undefined || copyState === undefined
              ? []
              : [
                  {
                    label: localizer.text('vscode.sources.publishArchiveCopy'),
                    description: workingCopy.path,
                    pick: false,
                    copy: true,
                  },
                ]),
            { label: localizer.text('vscode.sources.publishArchiveCached'), pick: false, copy: false },
            { label: localizer.text('vscode.sources.publishArchivePick'), pick: true, copy: false },
          ],
          { title: localizer.text('vscode.sources.publishArchive') },
        )
        if (archive === undefined) return false
        let archivePath: string | undefined
        if (archive.copy && workingCopy !== undefined) archivePath = workingCopy.path
        if (archive.pick) {
          const chosen = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: localizer.text('vscode.sources.publishConfirmAction'),
            filters: { StarCraft: ['SC2Map', 'SC2Mod', 's2ma'] },
          })
          archivePath = chosen?.[0]?.fsPath
          if (archivePath === undefined) return false
        }
        const listing = await vscode.window.showQuickPick(
          [
            { label: localizer.text('vscode.sources.publishPrivate'), value: 'private' as const },
            { label: localizer.text('vscode.sources.publishPublic'), value: 'public' as const },
          ],
          { title: localizer.text('vscode.sources.publishVisibility') },
        )
        if (listing === undefined) return false
        const lock = await vscode.window.showQuickPick(
          [
            {
              label: localizer.text('vscode.sources.publishLockedProtected'),
              value: true,
              protect: true,
            },
            {
              label: localizer.text('vscode.sources.publishLockedYes'),
              value: true,
              protect: false,
            },
            {
              label: localizer.text('vscode.sources.publishLockedNo'),
              value: false,
              protect: false,
            },
          ],
          { title: localizer.text('vscode.sources.publishLocked') },
        )
        if (lock === undefined) return false
        /*
         * Minor or major, the same question the Editor asks. The server allocates the number, so
         * what is shown is what it is expected to allocate: minor keeps the major and adds one,
         * major takes the next major and starts its minor at zero.
         */
        const revision = await vscode.window.showQuickPick(
          [
            { label: localizer.text('vscode.sources.publishRevisionMinor'), major: false },
            { label: localizer.text('vscode.sources.publishRevisionMajor'), major: true },
          ],
          { title: localizer.text('vscode.sources.publishRevision') },
        )
        if (revision === undefined) return false
        const review = (await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: localizer.text('vscode.sources.publishPreparing'),
          },
          () =>
            callContentSources(source, 'prepareRevision', [
              target.id,
              target.path,
              {
                ...(archivePath === undefined ? {} : { archivePath }),
                visibility: listing.value,
                locked: lock.value,
                protectHeader: lock.protect,
                majorRevision: revision.major,
              },
            ]),
        )) as {
          id: string
          name: string
          account: string
          region: string
          bytes: number
          visibility: string
          locked: boolean
          target: { mode: string; id?: number; expectedVersion?: number }
        }
        const version = review.target.expectedVersion ?? 0
        const confirmed = await vscode.window.showWarningMessage(
          localizer.text('vscode.sources.publishConfirm', {
            name: review.name,
            region: review.region.toUpperCase(),
            visibility: localizer.text(
              review.visibility === 'public'
                ? 'vscode.sources.publishPublic'
                : 'vscode.sources.publishPrivate',
            ),
            locked: review.locked ? ` + ${localizer.text('vscode.sources.publishLockedYes')}` : '',
            account: review.account,
            bytes: String(review.bytes),
            version: formatPublicationVersion(version),
            next: nextPublicationVersion(version, revision.major),
          }),
          { modal: true },
          localizer.text('vscode.sources.publishConfirmAction'),
        )
        if (confirmed === undefined) return false
        const receipt = (await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: localizer.text('vscode.sources.publishing', { name: review.name }),
          },
          () => callContentSources(source, 'publish', [review.id]),
        )) as { publication?: { version?: number } }
        const published = receipt.publication?.version ?? 0
        /*
         * What was just published is what the copy holds, so the row stops saying «changed». The
         * baseline is re-read rather than kept from before: protection rewrites the bytes that are
         * sent, not the author's file, and the file may have been touched while this ran.
         */
        if (archive.copy && workingCopy !== undefined) {
          const stat = await vscode.workspace.fs
            .stat(vscode.Uri.file(workingCopy.path))
            .then(value => value, () => undefined)
          if (stat !== undefined) {
            await rememberWorkingCopy({ ...workingCopy, size: stat.size, mtime: stat.mtime }, copyKey)
          }
        }
        rowChanged(target)
        void vscode.window.showInformationMessage(
          localizer.text('vscode.sources.published', {
            name: review.name,
            version: `${published >>> 16}.${published & 0xffff}`,
          }),
        )
        return true
      }),
      /*
       * Disconnect on the root row: the account that produced these mods is the thing being let go
       * of. A connected account is signed out. One that is only remembered has nothing to sign out
       * of, so the row itself is what goes — after saying so, because the list is the only trace
       * of it this window has.
       */
      vscode.commands.registerCommand('modkit.sources.disconnect', async (argument: unknown) => {
        const row =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly sourceId?: unknown })
            : undefined
        const sourceId = typeof row?.sourceId === 'string' ? row.sourceId : undefined
        if (sourceId === undefined || !sourceId.startsWith('mine:')) return false
        const source = await requireContentSources()
        const snapshot = await source.snapshot()
        if (snapshot.roots.some(root => root.id === sourceId)) {
          await callContentSources(source, 'disconnect', [sourceId.slice('mine:'.length)])
          const region = snapshot.roots.find(root => root.id === sourceId)?.region
          if (region !== undefined) await forgetRegion(region, source)
          await rememberConnections(source)
          staleRoots.add(sourceId)
          sourceDecorations.fire(undefined)
          sourcesView.refresh()
          return true
        }
        const remembered = catalogues()[sourceId]
        if (remembered === undefined) return false
        const confirmed = await vscode.window.showWarningMessage(
          localizer.text('vscode.sources.confirmForget', { name: remembered.label }),
          { modal: true },
          localizer.text('vscode.sources.forget'),
        )
        if (confirmed === undefined) return false
        await context.globalState.update(
          CATALOGUE_KEY,
          Object.fromEntries(Object.entries(catalogues()).filter(([id]) => id !== sourceId)),
        )
        await context.globalState.update(
          BATTLENET_CONNECTIONS_KEY,
          knownConnections().filter(item => item.accountId !== remembered.accountId),
        )
        staleRoots.delete(sourceId)
        sourcesView.refresh()
        return true
      }),
      vscode.commands.registerCommand('modkit.sources.signOut', async (argument: unknown) => {
        const row =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly id?: unknown })
            : undefined
        const source = await requireContentSources()
        const snapshot = await source.snapshot()
        const connections = snapshot.connections ?? []
        const named =
          typeof row?.id === 'string' && row.id.startsWith('connection:')
            ? row.id.slice('connection:'.length)
            : undefined
        const chosen =
          named ??
          (connections.length === 1
            ? connections[0]?.id
            : (
                await vscode.window.showQuickPick(
                  connections.map(connection => ({
                    label: connection.label,
                    description: connection.region,
                    id: connection.id,
                  })),
                  { title: localizer.text('vscode.sources.chooseSignOut') },
                )
              )?.id)
        if (typeof chosen !== 'string') return false
        await callContentSources(source, 'disconnect', [chosen])
        // A signed-out account must not be taken back by the next window.
        const region = connections.find(item => item.id === chosen)?.region
        if (region !== undefined) await forgetRegion(region, source)
        await rememberConnections(source)
        sourcesView.refresh()
        return true
      }),

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
                sourcesView.refresh()
              }
              return value
            },
            open: openContentSourceRoot,
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
      vscode.window.registerFileDecorationProvider(sourceDecorationProvider),
      sourceDecorations,

      /*
       * Adding a published mod is a search, not a path: Battle.net addresses a publication by id
       * and version, which nobody types. The account answers the search, the row names what it
       * found, and adding it only records the choice — the bytes arrive when it is opened or
       * downloaded.
       */
      /*
       * Adding a published mod is a search on one server: the + sits on that server's row, so the
       * region is decided before the dialog opens and the account used is one signed in there.
       * The results follow what is typed, because a reader looking for a mod rarely knows its
       * exact name and should be able to narrow it without starting over.
       */
      vscode.commands.registerCommand('modkit.sources.addPublic', async (argument: unknown) => {
        const source = await requireContentSources()
        const row =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly sourceId?: unknown })
            : undefined
        const region =
          typeof row?.sourceId === 'string' && row.sourceId.startsWith('public:')
            ? row.sourceId.slice('public:'.length)
            : undefined
        const connectionFor = async (): Promise<string | undefined> => {
          const inRegion = ((await source.snapshot()).connections ?? []).filter(
            item => region === undefined || item.region === region,
          )
          if (inRegion.length === 1) return inRegion[0]?.id
          if (inRegion.length > 1) {
            return (
              await vscode.window.showQuickPick(
                inRegion.map(item => ({
                  label: item.label,
                  description: item.region.toUpperCase(),
                  id: item.id,
                })),
                { title: localizer.text('vscode.sources.chooseConnection') },
              )
            )?.id
          }
          // Searching a server needs an account on it, so the row that searches also signs in.
          if (region === undefined) {
            await vscode.commands.executeCommand('modkit.sources.signIn')
          } else {
            await connectAccount(source, region, rememberedAccount(region))
            sourcesView.refresh()
          }
          return ((await source.snapshot()).connections ?? []).find(
            item => region === undefined || item.region === region,
          )?.id
        }
        const connectionId = await connectionFor()
        if (connectionId === undefined) return false
        const chosen = await new Promise<ContentSourceSearchResult | undefined>(resolve => {
          const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { id?: string }>()
          pick.title =
            region === undefined
              ? localizer.text('vscode.sources.searchTitle')
              : `${localizer.text('vscode.sources.searchTitle')} · ${region.toUpperCase()}`
          pick.placeholder = localizer.text('vscode.sources.searchPlaceholder')
          pick.matchOnDescription = true
          const found = new Map<string, ContentSourceSearchResult>()
          let latest = 0
          let timer: ReturnType<typeof setTimeout> | undefined
          const search = (): void => {
            const query = pick.value.trim()
            const mine = ++latest
            if (query.length === 0) {
              pick.items = []
              pick.busy = false
              return
            }
            pick.busy = true
            void (async () => {
              try {
                const rows = ((await callContentSources(source, 'search', [connectionId, query])) ??
                  []) as readonly ContentSourceSearchResult[]
                if (mine !== latest) return
                found.clear()
                for (const item of rows) found.set(item.id, item)
                pick.items =
                  rows.length > 0
                    ? rows.map(item => ({
                        label: item.label,
                        ...(item.description === undefined
                          ? {}
                          : { description: item.description }),
                        id: item.id,
                      }))
                    : [{ label: localizer.text('vscode.sources.noMatches', { query }) }]
              } catch {
                if (mine === latest) pick.items = []
              } finally {
                if (mine === latest) pick.busy = false
              }
            })()
          }
          pick.onDidChangeValue(() => {
            // One request per pause in typing, not per keystroke.
            if (timer !== undefined) clearTimeout(timer)
            timer = setTimeout(search, 400)
          })
          pick.onDidAccept(() => {
            const selected = pick.selectedItems[0]
            resolve(selected?.id === undefined ? undefined : found.get(selected.id))
            pick.hide()
          })
          pick.onDidHide(() => {
            if (timer !== undefined) clearTimeout(timer)
            resolve(undefined)
            pick.dispose()
          })
          pick.show()
        })
        if (chosen === undefined) return false
        await callContentSources(source, 'add', [chosen.id])
        forgetCacheStates()
        sourcesView.refresh()
        void vscode.window.showInformationMessage(
          localizer.text('vscode.sources.added', { name: chosen.label }),
        )
        return true
      }),

      vscode.commands.registerCommand('modkit.sources.download', async (argument: unknown) => {
        const target = contentSourceRow(argument)
        if (target === undefined) return
        const source = await requireContentSources()
        if (typeof source.download !== 'function') {
          void vscode.window.showWarningMessage(localizer.text('vscode.sources.actionUnavailable'))
          return
        }
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: localizer.text('vscode.sources.downloading', { name: target.name }),
          },
          () => callContentSources(source, 'download', [target.id, target.path]),
        )
        rowChanged(target)
        void vscode.window.showInformationMessage(
          localizer.text('vscode.sources.downloaded', { name: target.name }),
        )
      }),

      vscode.commands.registerCommand('modkit.sources.clearCache', async (argument: unknown) => {
        const target = contentSourceRow(argument)
        if (target === undefined) return
        const source = await requireContentSources()
        if (typeof source.clearCache !== 'function') {
          void vscode.window.showWarningMessage(localizer.text('vscode.sources.actionUnavailable'))
          return
        }
        await callContentSources(source, 'clearCache', [target.id, target.path])
        rowChanged(target)
        void vscode.window.showInformationMessage(
          localizer.text('vscode.sources.cacheCleared', { name: target.name }),
        )
      }),

      /** Detaching drops the row from this catalogue; the publication itself is untouched. */
      vscode.commands.registerCommand('modkit.sources.detach', async (argument: unknown) => {
        const target = contentSourceRow(argument)
        if (target === undefined) return
        const confirmed = await vscode.window.showWarningMessage(
          localizer.text('vscode.sources.confirmDetach', { name: target.name }),
          { modal: true },
          localizer.text('vscode.sources.detach'),
        )
        if (confirmed === undefined) return
        const source = await requireContentSources()
        await callContentSources(source, 'remove', [target.id, target.path])
        forgetCacheStates(target.id)
        sourcesView.refresh()
        void vscode.window.showInformationMessage(
          localizer.text('vscode.sources.detached', { name: target.name }),
        )
      }),

      /*
       * The catalogue is read when a connection is opened and then held: browsing a published mod
       * must not ask Battle.net again for the list. Refresh is the one place that does, for the
       * selected root or for every one of them.
       */
      /*
       * The assets an open file names, fetched by the content source whose root declares their
       * scheme (Roblox's `rbxassetid`, say). A codec spells a reference as a path — `rbxassetid/123`
       * — and it goes to `download` as `rbxassetid://123`. The report says what came, what was
       * already here and why the rest did not; a second run finds them present, offline.
       */
      vscode.commands.registerCommand(
        'modkit.sources.downloadReferences',
        async (argument: unknown) => {
          const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
          const uri =
            argument instanceof vscode.Uri
              ? argument
              : tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText
                ? tab.uri
                : undefined
          if (uri === undefined) {
            void vscode.window.showInformationMessage(localizer.text('vscode.references.noFile'))
            return
          }
          const source = await requireContentSources()
          const downloaders = (await source.snapshot()).roots.filter(
            root => (root.referenceSchemes?.length ?? 0) > 0,
          )
          const references =
            downloaders.length === 0
              ? []
              : ((await host.resourceReferences(subjectPathOf(uri), roots())) ?? [])
          const wanted = new Map<string, { readonly sourceId: string; readonly reference: string }>()
          for (const id of references) {
            for (const root of downloaders) {
              const scheme = root.referenceSchemes?.find(
                item => id.startsWith(`${item}://`) || id.startsWith(`${item}/`),
              )
              if (scheme === undefined) continue
              const reference = id.startsWith(`${scheme}://`)
                ? id
                : `${scheme}://${id.slice(scheme.length + 1)}`
              wanted.set(`${root.id}\n${reference}`, { sourceId: root.id, reference })
              break
            }
          }
          if (wanted.size === 0) {
            void vscode.window.showInformationMessage(
              localizer.text(
                downloaders.length === 0 ? 'vscode.references.noSource' : 'vscode.references.none',
              ),
            )
            return
          }
          // A download that needs a key asks for it once, here, rather than failing every asset —
          // only for the regions these downloads come from: another game's account (Battle.net)
          // has nothing to do with them, and its failed sign-in stopped the command.
          const current = await source.snapshot()
          for (const region of regionsToConnect(
            [...wanted.values()].map(item => item.sourceId),
            downloaders,
            current.regions ?? [],
            (current.connections ?? []).map(item => item.region),
          )) {
            await connectAccount(source, region)
          }
          let downloaded = 0
          let present = 0
          // Per code: how many, and the first message — the code alone does not say which asset or why.
          const failed = new Map<string, { count: number; readonly message: string }>()
          // ponytail: one request at a time; a few parallel downloads if places name thousands.
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: localizer.text('vscode.references.progress', { count: wanted.size }),
              cancellable: true,
            },
            async (progress, token) => {
              for (const item of wanted.values()) {
                if (token.isCancellationRequested) break
                try {
                  const result = (await callContentSources(source, 'download', [
                    item.sourceId,
                    item.reference,
                  ])) as { readonly state?: unknown } | undefined
                  if (result?.state === 'present') present += 1
                  else downloaded += 1
                } catch (error) {
                  const code = (error as { readonly code?: unknown } | null)?.code
                  const message = error instanceof Error ? error.message : String(error)
                  const reason = typeof code === 'string' ? code : message
                  const seen = failed.get(reason)
                  if (seen === undefined) failed.set(reason, { count: 1, message })
                  else seen.count += 1
                  log(
                    `[references] ${item.reference}: ${reason === message ? message : `${reason}: ${message}`}`,
                  )
                }
                progress.report({ increment: 100 / wanted.size })
              }
            },
          )
          const notDownloaded = [...failed.values()].reduce((sum, item) => sum + item.count, 0)
          const summary = localizer.text('vscode.references.done', {
            downloaded,
            present,
            failed: notDownloaded,
          })
          const reasons = [...failed]
            .map(
              ([reason, item]) =>
                `${reason === item.message ? reason : `${reason}: ${item.message}`} ×${item.count}`,
            )
            .join('; ')
          if (notDownloaded === 0) void vscode.window.showInformationMessage(summary)
          else void vscode.window.showWarningMessage(`${summary} ${reasons}`)
          if (downloaded === 0) return
          sourcesView.refresh()
          // The open view resolved its references before the download: reopen it to show them.
          for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
              const input = tab.input
              if (!(input instanceof vscode.TabInputCustom) || tab.isDirty) continue
              if (input.uri.toString() !== uri.toString()) continue
              await vscode.window.tabGroups.close(tab, true)
              await vscode.commands.executeCommand('vscode.openWith', uri, input.viewType, {
                viewColumn: group.viewColumn,
                preserveFocus: true,
              })
            }
          }
        },
      ),
      vscode.commands.registerCommand('modkit.sources.refresh', async (argument: unknown) => {
        const row =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly sourceId?: unknown; readonly id?: unknown })
            : undefined
        const selected =
          typeof row?.sourceId === 'string'
            ? row.sourceId
            : typeof row?.id === 'string' && row.id.includes(':')
              ? row.id
              : undefined
        const source = await contentSources?.catch(() => undefined)
        if (source !== undefined) {
          const roots =
            selected !== undefined
              ? [selected]
              : [
                  ...new Set([
                    ...(await source.snapshot()).roots.map(root => root.id),
                    ...Object.keys(catalogues()),
                  ]),
                ]
          // Refreshing a root this window has no connection for is a reason to sign in.
          for (const id of roots) {
            if (!(await source.snapshot()).roots.some(root => root.id === id)) await signInFor(id)
          }
          for (const id of roots) {
            await callContentSources(source, 'refresh', [id]).catch(() => undefined)
          }
          forgetResourcePaths()
          await loadedSessions?.then(sessions => sessions.reloadAll())
          resourcesView.refresh()
        }
        forgetCacheStates(selected)
        sourcesView.refresh()
        return true
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        // content sources are composed with these: a provider file, index switches, module options
        if (
          !event.affectsConfiguration('modkit.contentSourceConfig') &&
          !event.affectsConfiguration('modkit.indexCaches') &&
          !event.affectsConfiguration('modkit.starcraft2.cachedMods') &&
          !event.affectsConfiguration('modkit.contentSourceOptions') &&
          !event.affectsConfiguration('modkit.sharedModServer')
        )
          return
        resetContentSources()
        sourcesView.refresh()
        resourcesView.refresh()
      }),
      // Listings read the option per request, so the Explorer only has to ask again; this re-reads
      // every expanded folder of an archive or a mounted source without reopening anything.
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('modkit.showHiddenEntries')) return
        void vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
        sourcesView.refresh()
        // Open Modkit pages draw their archive views again with the new value.
        const show = showHiddenEntries()
        for (const served of live) served.bridge.emit({ op: 'show-hidden', show })
      }),
      vscode.commands.registerCommand('modkit.sources.open', async (argument: unknown) => {
        const row =
          typeof argument === 'object' && argument !== null
            ? (argument as { readonly sourceId?: unknown; readonly label?: unknown })
            : undefined
        if (typeof row?.sourceId !== 'string' || typeof row.label !== 'string') {
          throw new TypeError('A content source root must be selected')
        }
        return openContentSourceRoot({ id: row.sourceId, label: row.label })
      }),
      vscode.commands.registerCommand(
        'modkit.sources.openInstallation',
        async (argument: unknown) => {
          const row =
            typeof argument === 'object' && argument !== null
              ? (argument as { readonly uri?: unknown; readonly label?: unknown })
              : undefined
          if (typeof row?.uri !== 'string' || typeof row.label !== 'string') {
            throw new TypeError('A selected game installation must be provided')
          }
          try {
            // A content source that already reads this installation's storage answers for it:
            // mounting it as a container would index and hold the same storage a second time.
            const served = await sourceServingInstallation(row.uri)
            if (served !== undefined) return await openContentSourceRoot(served)
            return await openContainerPath(row.uri, row.label)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            log(`installation namespace refused ${row.uri}: ${message}`)
            void vscode.window.showWarningMessage(
              localizer.text('vscode.container.cannotBrowse', { reason: message }),
            )
            return undefined
          }
        },
      ),
      vscode.commands.registerCommand('modkit.sources.revealLocal', revealLocalSource),
      /*
       * Unmount is the exact inverse of opening a provider root: the root is mounted as this
       * window's `modkit-source:` workspace folder, so removing that folder is what releases it.
       * The provider connection itself stays — disconnecting it is a different action.
       */
      vscode.commands.registerCommand('modkit.sources.unmount', async (argument: unknown) => {
        const row =
          typeof argument === 'object' && argument !== null
            ? (argument as {
                readonly sourceId?: unknown
                readonly uri?: unknown
                readonly normalizedPath?: unknown
              })
            : undefined
        const sourceId = typeof row?.sourceId === 'string' ? row.sourceId : undefined
        /*
         * An installation row names its directory, and it does so in two fields — the path the
         * discovery reported and the normalized one the view keys on. Reading only the first left
         * the command refusing to unmount a CASC installation that was plainly mounted. With
         * neither field — from the command palette, say — the mounted folders are offered instead
         * of failing.
         */
        const named =
          typeof row?.uri === 'string'
            ? row.uri
            : typeof row?.normalizedPath === 'string'
              ? row.normalizedPath
              : undefined
        let containerPath = named === undefined ? undefined : normalizedSourcePath(named)
        if (sourceId === undefined && containerPath === undefined) {
          const mounted = (vscode.workspace.workspaceFolders ?? []).flatMap(folder => {
            if (folder.uri.scheme !== CONTAINER_SCHEME) return []
            const location = parseContainerUriPath(folder.uri.path)
            return location === undefined || location.entry !== ''
              ? []
              : [{ label: folder.name, description: location.container }]
          })
          if (mounted.length === 0) {
            void vscode.window.showInformationMessage(
              localizer.text('vscode.sources.nothingMounted'),
            )
            return false
          }
          const chosen =
            mounted.length === 1
              ? mounted[0]
              : await vscode.window.showQuickPick(mounted, {
                  title: localizer.text('vscode.sources.chooseUnmount'),
                })
          if (chosen?.description === undefined) return false
          containerPath = normalizedSourcePath(chosen.description)
        }
        // Cancel a read still in flight before removing the folder it was filling.
        for (const key of [sourceId, containerPath]) {
          if (key === undefined) continue
          const pending = mountingSources.get(key)
          if (pending === undefined) continue
          pending.abort()
          mountingSources.delete(key)
        }
        const folders = vscode.workspace.workspaceFolders ?? []
        const index = folders.findIndex(folder => {
          if (folder.uri.scheme === 'modkit-source') {
            return (
              sourceId !== undefined &&
              folder.uri.path.replace(/^\//u, '').split('/')[0] === sourceId
            )
          }
          if (folder.uri.scheme !== CONTAINER_SCHEME || containerPath === undefined) return false
          const location = parseContainerUriPath(folder.uri.path)
          return (
            location !== undefined &&
            location.entry === '' &&
            normalizedSourcePath(location.container) === containerPath
          )
        })
        if (index === -1) {
          sourcesView.refresh()
          return false
        }
        const removed = vscode.workspace.updateWorkspaceFolders(index, 1)
        // Unmounting a container also releases its held session; leaving it open would keep the
        // whole index alive for a folder the window no longer shows.
        const folder = folders[index]
        if (removed && folder?.uri.scheme === CONTAINER_SCHEME) {
          const location = parseContainerUriPath(folder.uri.path)
          if (location !== undefined) await containers.release(location.container)
        }
        sourcesView.refresh()
        return removed
      }),
      // MK2's "Clear Archives": every archive folder leaves the window, its held session closes.
      vscode.commands.registerCommand('modkit.closeContainers', async () => {
        const closed = await closeContainerFolders()
        if (closed.length === 0) {
          void vscode.window.showInformationMessage(localizer.text('vscode.container.noneOpen'))
          return 0
        }
        for (const container of closed) await containers.release(container)
        sourcesView.refresh()
        return closed.length
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

    /*
     * Writing, creating, removing and renaming inside a container go through its own
     * `container.pack`, so the Explorer's file operations work on an archive as on a folder. A
     * format that cannot be written refuses with its reason; on a save, VS Code then offers Save
     * As — the "keep a copy" the person needs.
     */
    async createDirectory(uri) {
      const { container, entry } = containerLocation(uri)
      await changeContainer(uri, () => containers.edit(container, { folders: [entry] }))
      containerChanges.fire([{ type: vscode.FileChangeType.Created, uri }])
    },
    async writeFile(uri, content, flags) {
      const { container, entry } = containerLocation(uri)
      const exists = await containers.stat(container, entry).then(
        () => true,
        () => false,
      )
      if (!exists && !flags.create) throw vscode.FileSystemError.FileNotFound(uri)
      if (exists && !flags.overwrite) throw vscode.FileSystemError.FileExists(uri)
      await changeContainer(uri, () => containers.write(container, entry, content))
      containerChanges.fire([
        { type: exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri },
      ])
    },
    async delete(uri) {
      const { container, entry } = containerLocation(uri)
      if (entry === '') throw vscode.FileSystemError.NoPermissions(uri)
      await changeContainer(uri, () => containers.edit(container, { remove: [entry] }))
      containerChanges.fire([{ type: vscode.FileChangeType.Deleted, uri }])
    },
    async rename(oldUri, newUri) {
      const from = containerLocation(oldUri)
      const to = containerLocation(newUri)
      if (from.container !== to.container || from.entry === '' || to.entry === '') {
        // Moving between containers is a copy and a delete; VS Code falls back to that itself.
        throw vscode.FileSystemError.NoPermissions(oldUri)
      }
      await changeContainer(oldUri, () =>
        containers.edit(from.container, { rename: [{ from: from.entry, to: to.entry }] }),
      )
      containerChanges.fire([
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri },
      ])
    },
  }

  if (!languageOnly)
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(CONTAINER_SCHEME, containerFileSystem, {
        // Container entry paths come out of the container's own tables; two members differing only in
        // case are two members, and folding them would hide one.
        isCaseSensitive: true,
      }),
    )

  // ---------------------------------------------------------------- workspace search
  /*
   * Quick open and Find in Files inside mounted sources and containers, as in a folder on disk. A
   * source that keeps its files indexed (the game's CASC storage) answers a page at a time from the
   * index; one that does not is walked folder by folder. See `workspace-search.ts`.
   */
  if (!languageOnly) {
    const relativeTo = (path: string, folder: string): string =>
      folder === '' ? path : path.slice(folder.length + 1)
    async function* walkSource(
      sources: ContentSources,
      id: string,
      root: string,
      includeHidden: boolean,
      signal: AbortSignal,
    ): AsyncGenerator<readonly SearchFolderFile[]> {
      const folders = [root]
      for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
        signal.throwIfAborted()
        const files: SearchFolderFile[] = []
        for (const entry of await sources.list(id, folder, { includeHidden })) {
          if (entry.directory) folders.push(entry.path)
          else
            files.push({
              path: relativeTo(entry.path, root),
              ...(entry.size === undefined ? {} : { size: entry.size }),
              ...(entry.hidden === true ? { hidden: true as const } : {}),
            })
        }
        yield files
      }
    }
    const searches = [
      registerWorkspaceSearch(
        'modkit-source',
        {
          async *files(folder, query, signal) {
            const { id, path } = sourceLocation(folder)
            const sources = await requireContentSources()
            let cursor: string | undefined
            do {
              signal.throwIfAborted()
              const page = await sources.files?.(id, path, {
                ...query,
                limit: 2000,
                ...(cursor === undefined ? {} : { cursor }),
              })
              if (page === undefined) {
                yield* walkSource(sources, id, path, query.includeHidden === true, signal)
                return
              }
              yield page.items.map(item => ({
                path: relativeTo(item.path, path),
                ...(item.size === undefined ? {} : { size: item.size }),
                ...(item.hidden === true ? { hidden: true as const } : {}),
              }))
              cursor = page.nextCursor
            } while (cursor !== undefined)
          },
          read: (folder, path, maxBytes, signal) =>
            readContentSource(
              vscode.Uri.joinPath(folder, ...path.split('/')).toString(),
              maxBytes,
              signal,
            ),
          /*
           * A root whose source states its revision keeps a content index in the shared cache: the
           * first text search builds it, later ones read only the files that may hold the query.
           */
          async contentIndex(folder, files, signal) {
            const { id, path } = sourceLocation(folder)
            // one index per root: a folder inside one is searched by reading
            if (path !== '') return undefined
            const sources = await requireContentSources()
            const root = (await sources.snapshot()).roots.find(item => item.id === id)
            if (root?.revision === undefined) return undefined
            const { switches } = configuredIndexCaches(
              vscode.workspace.getConfiguration('modkit').get('indexCaches'),
            )
            if (root.product !== undefined && !indexCacheEnabled(switches, root.product, 'content'))
              return undefined
            const key = `${id}\n${root.revision}`
            let opened = contentIndexes.get(key)
            if (opened === undefined) {
              opened = openCachedContentIndex({
                directory: indexCacheDirectory,
                manifest: {
                  // a source that does not say which game its root reads is grouped by product
                  game: root.game ?? root.product ?? root.region,
                  ...(root.product === undefined ? {} : { product: root.product }),
                  installation: root.storageOf ?? root.label,
                },
                root: id,
                revision: root.revision,
                files,
                signal,
              })
              contentIndexes.set(key, opened)
              void opened.catch(() => contentIndexes.delete(key))
            }
            return opened
          },
        },
        log,
        showHiddenEntries,
      ),
      registerWorkspaceSearch(
        CONTAINER_SCHEME,
        {
          async *files(folder, _query, signal) {
            const { container, entry } = containerLocation(folder)
            const root = entry.replace(/^\/+|\/+$/gu, '')
            const members = await containers.walk(container, root, 1_000_000, signal)
            yield members.map(member => ({
              path: relativeTo(member.path.replace(/^\/+/u, ''), root),
              ...(member.size === undefined ? {} : { size: Number(member.size) }),
            }))
          },
          read: (folder, path, _maxBytes, signal) => {
            const { container, entry } = containerLocation(
              vscode.Uri.joinPath(folder, ...path.split('/')),
            )
            return containers.read(container, entry, signal)
          },
        },
        log,
      ),
    ]
    for (const search of searches) if (search !== undefined) context.subscriptions.push(search)
  }

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
  if (!languageOnly)
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
          anchorFileNames: [],
          pathFileNames: [],
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
        event.affectsConfiguration('modkit.trustedExtensions') ||
        event.affectsConfiguration('modkit.disabledExtensions') ||
        event.affectsConfiguration('modkit.disabledContributions')
      ) {
        extensionManager.invalidate()
      }
    }),
  )

  const ask = async (message: string, choices: readonly string[]): Promise<number | undefined> => {
    const answer = await vscode.window.showWarningMessage(message, { modal: true }, ...choices)
    const index = answer === undefined ? -1 : choices.indexOf(answer)
    return index < 0 ? undefined : index
  }

  const confirmClose = async (message: string, savable: boolean): Promise<CloseAnswer> => {
    const save = localizer.text('vscode.shell.save')
    const discard = localizer.text('vscode.shell.discard')
    const choices = savable ? [save, discard] : [discard]
    const answer = await vscode.window.showWarningMessage(message, { modal: true }, ...choices)
    if (answer === save) return 'save'
    return answer === discard ? 'discard' : 'cancel'
  }

  /*
   * A lossy save needs the person's consent, and the editor's own Save is that consent: a texture
   * in a block-compressed format is re-encoded on every save, which is what saving it means. The
   * host still issues the token itself, so a page can never confirm on anyone's behalf.
   */
  const confirmLossyWrite = async (): Promise<boolean> => true

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

  /*
   * Several confirmed installations and none chosen: the map preview cannot pick one, and the reader
   * is asked to, once per window, with the picker the Sources view uses (plan 6.15).
   */
  let installationChoiceOffered = false
  const offerInstallationChoice = (): void => {
    if (installationChoiceOffered) return
    installationChoiceOffered = true
    const choose = localizer.text('vscode.map.chooseInstallation')
    void vscode.window
      .showInformationMessage(
        `Modkit: ${localizer.text('vscode.map.installationAmbiguous')}`,
        choose,
      )
      .then(answer => {
        if (answer === choose) void vscode.commands.executeCommand('modkit.selectGameInstallation')
      })
  }
  const publishDiagnostic = (item: {
    readonly code: string
    readonly message: string
    readonly severity: 'error' | 'warning' | 'information' | 'hint'
    readonly path?: string
  }): void => {
    publishedSubjectDiagnostics.push(item)
    if (item.code === 'x3.host/map-preview-installation-ambiguous') offerInstallationChoice()
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
  // A game's file association (`.scar` → lua) also gives the editor its language: colours, brackets.
  const fileAssociations = languageFileAssociations(host.services.inventory)
  // Decided once per document: a user who sets the language back keeps it.
  const associatedDocuments = new Set<string>()
  const associateLanguage = (document: vscode.TextDocument): void => {
    const languageId = associatedLanguageOf(fileAssociations, {
      fileName: document.fileName,
      languageId: document.languageId,
      head: document.getText(
        new vscode.Range(new vscode.Position(0, 0), document.positionAt(4_096)),
      ),
    })
    const key = document.uri.toString()
    if (languageId === undefined || associatedDocuments.has(key)) return
    associatedDocuments.add(key)
    void vscode.languages.setTextDocumentLanguage(document, languageId)
  }
  vscode.workspace.textDocuments.forEach(associateLanguage)
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(associateLanguage))
  const languageDiagnostics = vscode.languages.createDiagnosticCollection('modkit-language')
  context.subscriptions.push(languageDiagnostics)

  const live = new Set<VsCodeServed>()
  const liveSubjects = new Map<VsCodeServed, string | undefined>()
  /** The Modkit editor the user is looking at, or nothing while another editor is active. */
  let activeSubject: string | undefined
  const supportedDirectorySubjects = new Set(
    host.supportedExtensions.map(extension => extension.replace(/^\./u, '').toLowerCase()),
  )
  let loadedModResources: () => Promise<ResourceTreeHost | undefined> = async () => undefined
  let navigateWorkspaceResource: (
    root: string,
    subjectId: string,
    range?: TreeNodeFacts['range'],
    stage?: string,
  ) => Promise<boolean> = async () => false

  /**
   * Resource files opened as subjects of their own, so their codec can answer what is inside.
   *
   * Held for the life of one tree render: expanding twenty layout files must not open twenty
   * sessions twice, and a refresh drops them all rather than letting them accumulate.
   */
  const memberTreeSubjects = new Map<
    string,
    Promise<{ readonly subject: VsCodeTreeSubject; readonly tree: TreeDataSource } | undefined>
  >()
  /*
   * Which files are worth expanding in place.
   *
   * This is a hint, not a contract: a codec states what it can open, but nothing in the ABI says
   * whether its tree is a useful outline or a single metadata row. Expanding every file would put
   * a twisty on thousands of textures that open to one line, so the view asks only the formats
   * whose contents are themselves reference targets — scripts, layouts, styles, component lists.
   */
  const OUTLINE_FORMATS = Object.freeze([
    'galaxy',
    'sc2layout',
    'sc2style',
    'sc2lib',
    'sc2triggers',
    'sc2components',
    'blizwiz',
  ])
  const memberFormats = new Set(
    OUTLINE_FORMATS.filter(extension =>
      host.supportedExtensions.some(
        supported => supported.replace(/^\./u, '').toLowerCase() === extension,
      ),
    ),
  )
  const resourceMemberTrees: ResourceMemberTrees = Object.freeze({
    subjectOf(subjectId: string): string | undefined {
      const entry = namespaceEntryPathOf(subjectId)
      if (entry === undefined) return undefined
      const extension = entry.split('/').at(-1)?.split('.').at(-1)?.toLowerCase()
      // Package directories are subjects too, but a package inside a package is not what this is
      // for; only a file of a format this window can open expands here.
      if (extension === undefined || !memberFormats.has(extension)) return undefined
      const root = namespaceEntryRootOf(subjectId)
      if (root === undefined) return undefined
      return subjectPathOf(memberUriOf(root, entry))
    },
    async open(subject: string): Promise<TreeDataSource | undefined> {
      const known = memberTreeSubjects.get(subject)
      if (known !== undefined) return (await known)?.tree
      const opening = (async () => {
        const opened = await host.openTreeSubject(subject, roots())
        if (opened === undefined) return undefined
        const lease = await opened.openTreeDataSource()
        if (lease === undefined) {
          await opened.dispose()
          return undefined
        }
        return Object.freeze({ subject: opened, tree: lease.value })
      })().catch(error => {
        log(
          `[resources] ${subject} published no tree: ${error instanceof Error ? error.message : String(error)}`,
        )
        return undefined
      })
      memberTreeSubjects.set(subject, opening)
      return (await opening)?.tree
    },
    reveal(subject: string, range?: TreeNodeFacts['range']): void {
      void openResourceFile(subjectUriOf(subject), range).catch(error =>
        vscode.window.showErrorMessage(
          `Modkit: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    },
    reset(): void {
      const pending = [...memberTreeSubjects.values()]
      memberTreeSubjects.clear()
      for (const item of pending) {
        void item.then(value => value?.subject.dispose()).catch(() => undefined)
      }
    },
  })
  context.subscriptions.push({ dispose: () => resourceMemberTrees.reset() })

  // Resources belongs to loaded mods, never to whichever model or document has focus.
  const resourcesView = new ResourcesView(localizer, () => loadedModResources(), resourceMemberTrees)
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
      if (selected !== undefined) return selected.open(signal)
      const automatic = await resolveLanguageScope(vscode.Uri.parse(scope.uri, true), signal)
      if (automatic === undefined || !advertisesSubjectCandidates(automatic.descriptor)) {
        return undefined
      }
      const opened = await automaticLanguageScopes.get(automatic.path)
      const lease = await opened?.session.dataSource(
        SUBJECT_SELECTOR_SOURCE.contract,
        SUBJECT_SELECTOR_SOURCE.major,
      )
      return lease === undefined
        ? undefined
        : Object.freeze({
            value: createSubjectCandidateProvider(lease.value),
            release: () => lease.release(),
          })
    },
  })

  interface LiveLanguageScope {
    readonly path: string
    readonly root?: vscode.Uri
    readonly contextId: string
    readonly layerId: string
    readonly revision: string
    readonly descriptor: AnyDescriptor
    readonly operations: OperationSession
    readonly openTreeDataSource: ResourceTreeHost['openTreeDataSource']
  }

  const liveLanguageScope = (uri: vscode.Uri): LiveLanguageScope | undefined => {
    const selected = selectScopedSubject(
      subjectCandidateScopeOf(uri),
      [...liveSubjects].flatMap(([served, path]) => {
        if (path === undefined) return []
        const subject = served.languageSubject()
        return [
          {
            ...subjectCandidateScopeOf(subjectUriOf(path)),
            available: subject !== undefined,
            path,
            served,
            subject,
          },
        ]
      }),
    )
    const subject = selected?.subject
    if (selected === undefined || subject === undefined) return undefined
    const container = uri.scheme === CONTAINER_SCHEME ? parseContainerUriPath(uri.path) : undefined
    const workspaceTarget = container === undefined ? uri : vscode.Uri.file(container.container)
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(workspaceTarget)?.uri
    let subjectRoot: vscode.Uri | undefined
    if (isAbsolute(selected.path)) {
      try {
        if (statSync(selected.path).isDirectory()) subjectRoot = vscode.Uri.file(selected.path)
      } catch {
        // A subject may be a container member or may have disappeared after it was opened.
      }
    }
    const selectedUri = subjectUriOf(selected.path)
    const selectedContainer =
      selectedUri.scheme === CONTAINER_SCHEME ? parseContainerUriPath(selectedUri.path) : undefined
    const root =
      subjectRoot ??
      (selectedContainer?.entry === undefined || selectedContainer.entry === ''
        ? workspaceRoot
        : selectedUri)
    const contextId = languageWorkspaceContextToken({
      subject: subjectKey(selected.path),
      workspace: root?.toString(),
    })
    return Object.freeze({
      path: selected.path,
      ...(root === undefined ? {} : { root }),
      contextId,
      layerId: `${contextId}:subject`,
      revision: subject.revision,
      descriptor: subject.descriptor,
      operations: subject.operations,
      openTreeDataSource: (signal?: AbortSignal) => selected.served.openTreeDataSource(signal),
    })
  }

  interface AutomaticLanguageScope extends LiveLanguageScope {
    readonly session: AssetSession
  }

  interface LanguageSubjectCandidate {
    readonly path: string
    readonly root: vscode.Uri
    /** Load order when this candidate came from a resolved dependency chain. */
    readonly order?: number
  }

  const directorySubjectCandidates = (uri: vscode.Uri): readonly LanguageSubjectCandidate[] => {
    if (uri.scheme === CONTAINER_SCHEME) {
      const location = parseContainerUriPath(uri.path)
      if (location === undefined) return Object.freeze([])
      /*
       * A container whose file is a folder is a storage (the game's CASC). A package inside it is
       * the mod loader's: it lists and reads it already, as a layer of the document's chain.
       * Opening it again through the storage's codec walked 192 000 entries a second time.
       */
      try {
        if (statSync(splitContainer(location.container).file).isDirectory()) {
          return Object.freeze([])
        }
      } catch {
        // A container this window cannot stat is a packed file it opened some other way.
      }
      const segments = location.entry.split('/').filter(Boolean)
      const candidates: LanguageSubjectCandidate[] = []
      for (let count = segments.length - 1; count > 0; count -= 1) {
        const entry = segments.slice(0, count).join('/')
        const extension = segments[count - 1]?.split('.').at(-1)?.toLowerCase()
        if (extension === undefined || !supportedDirectorySubjects.has(extension)) continue
        const root = vscode.Uri.from({
          scheme: CONTAINER_SCHEME,
          path: containerUriPath(location.container, entry),
        })
        candidates.push(Object.freeze({ path: containerUriText(location.container, entry), root }))
      }
      return Object.freeze(candidates)
    }
    if (uri.scheme !== 'file') return Object.freeze([])
    const candidates: LanguageSubjectCandidate[] = []
    let candidate = dirname(uri.fsPath)
    for (let depth = 0; depth < 64; depth += 1) {
      const extension = basename(candidate).split('.').at(-1)?.toLowerCase()
      if (extension !== undefined && supportedDirectorySubjects.has(extension)) {
        candidates.push(Object.freeze({ path: candidate, root: vscode.Uri.file(candidate) }))
      }
      const parent = dirname(candidate)
      if (parent === candidate) break
      candidate = parent
    }
    return Object.freeze(candidates)
  }

  const automaticLanguageScopes = new Map<string, Promise<AutomaticLanguageScope | undefined>>()
  const resolvedLanguageScopesByDocument = new Map<string, LiveLanguageScope>()
  const languageSubjectOpener = createVsCodeCommandOpener({
    services: host.services,
    roots,
    containers,
    subjectCatalog,
  })
  const openAutomaticLanguageScope = (
    candidate: LanguageSubjectCandidate,
    signal?: AbortSignal,
  ): Promise<AutomaticLanguageScope | undefined> => {
    const known = automaticLanguageScopes.get(candidate.path)
    if (known !== undefined) return known
    const opening = (async () => {
      // Opening a document is an explicit read action. Admit its containing package so the codec
      // can read DocumentInfo and sibling components even when the file is outside the workspace.
      if (candidate.root.scheme === 'file') granted.add(resolve(candidate.root.fsPath))
      const answer = await languageSubjectOpener(candidate.path, signal)
      if (answer.snapshot.state !== 'opened' || answer.session === undefined) return undefined
      const session = answer.session
      const descriptor = await session.descriptor()
      const contextId = languageWorkspaceContextToken({
        subject: subjectKey(candidate.path),
        root: candidate.root.toString(),
      })
      log(`[language-context] loaded package scope ${candidate.path}`)
      return Object.freeze({
        path: candidate.path,
        root: candidate.root,
        contextId,
        layerId: `${contextId}:subject`,
        revision: String(session.revision),
        descriptor,
        operations: session.operations(),
        async openTreeDataSource(openSignal?: AbortSignal) {
          openSignal?.throwIfAborted()
          if (
            session.state() !== 'live' ||
            !descriptor.dataSources.some(
              source => source.contract === 'common.view/tree-data-source' && source.major === 1,
            )
          )
            return undefined
          const lease = await session.dataSource('common.view/tree-data-source', 1)
          try {
            openSignal?.throwIfAborted()
          } catch (error) {
            await lease.release()
            throw error
          }
          if (session.state() !== 'live') {
            await lease.release()
            return undefined
          }
          return lease
        },
        session,
      })
    })().catch(error => {
      if (signal?.aborted === true) throw error
      log(
        `[language-context] package candidate ${candidate.path} did not open: ${error instanceof Error ? error.message : String(error)}`,
      )
      return undefined
    })
    automaticLanguageScopes.set(candidate.path, opening)
    return opening
  }

  const resolveLanguageScope = async (
    uri: vscode.Uri,
    signal?: AbortSignal,
  ): Promise<LiveLanguageScope | undefined> => {
    const liveScope = liveLanguageScope(uri)
    if (liveScope !== undefined) {
      resolvedLanguageScopesByDocument.set(uri.toString(), liveScope)
      return liveScope
    }
    for (const candidate of directorySubjectCandidates(uri)) {
      const scope = await openAutomaticLanguageScope(candidate, signal)
      if (scope === undefined) continue
      resolvedLanguageScopesByDocument.set(uri.toString(), scope)
      return scope
    }
    resolvedLanguageScopesByDocument.delete(uri.toString())
    return undefined
  }

  const cachedLanguageScope = (uri: vscode.Uri): LiveLanguageScope | undefined =>
    liveLanguageScope(uri) ?? resolvedLanguageScopesByDocument.get(uri.toString())

  /** Whether Resources shows the chain of loaded mods or only the active package. */
  let resourcesShowChain = context.workspaceState.get<boolean>(RESOURCES_CHAIN_KEY) ?? true
  let loadedSessions: Promise<LoadedModResourceSessions> | undefined
  let loadedSessionSource: ContentSources | undefined
  const activeModLoads = new ActiveModLoads()
  const forgetResourcePaths = (): void => activeModLoads.forget()
  /*
   * Host files belong to no one module of the composed sources, which refuse a refresh of «host»
   * («no content source module owns «host»»); the refusal stopped every reload after it, so an edited
   * mod file never reopened its mod (v87). The contexts read host files afresh when they reopen.
   */
  const refreshHostFiles = (source: ContentSources): Promise<void> =>
    Promise.resolve(source.refresh('host')).catch(() => undefined)
  const resourceSessions = async (): Promise<LoadedModResourceSessions> => {
    const source = await requireContentSources()
    if (loadedSessions === undefined || loadedSessionSource !== source) {
      const previous = loadedSessions
      loadedSessionSource = source
      // Entity names in Resources come in the chosen game locale (`modkit.locale`), read per open.
      loadedSessions = Promise.resolve(
        new LoadedModResourceSessions(source, { locales: configuredGameLocales }),
      )
      // The new sessions start empty: every document must load its mod again.
      forgetResourcePaths()
      await previous?.then(sessions => sessions.dispose())
    }
    return loadedSessions
  }
  context.subscriptions.push({
    dispose: () => { void loadedSessions?.then(sessions => sessions.dispose()).catch(() => undefined) },
  })
  const discoverActiveResourceMod = async (): Promise<{
    readonly sessions?: LoadedModResourceSessions
    readonly path?: string
    readonly failure?: string
    readonly changed: boolean
  }> => {
    const uri = vscode.window.activeTextEditor?.document.uri
    const path = activeSubject ?? (uri === undefined ? undefined :
      (await resolveLanguageScope(uri))?.path ??
      (uri.scheme === 'file' || uri.scheme === 'modkit-source' || uri.scheme === CONTAINER_SCHEME
        ? subjectPathOf(uri) : undefined))
    const sessions = await resourceSessions().catch(() => undefined)
    if (sessions === undefined) return { changed: false }
    const target = path === undefined ? undefined : modContextTargetOf(path)
    if (path === undefined || target === undefined) return { sessions, changed: false }
    const result = await activeModLoads.ensure(
      path,
      // Only a document inside a mod package loads that mod. A loose file, a model or any other
      // tab that merely has focus loads nothing — the game's loader decides, not a file pattern.
      async () => (await (await requireContentSources()).locateModPackage?.(target))?.kind === 'package',
      async () => {
        const baseMods = baseModsSetting(subjectUriOf(path))
        return sessions.load(target, baseMods === undefined ? undefined : baseModsFor(path, baseMods))
      },
    )
    if (result.state === 'none') return { sessions, changed: false }
    if (result.state === 'loaded') return { sessions, path, changed: result.changed }
    if (result.changed) log(`[resources] ${path}: ${result.failure}`)
    return { sessions, path, failure: result.failure, changed: result.changed }
  }
  const refreshForActiveResource = (): void => {
    void discoverActiveResourceMod().then(({ changed }) => {
      if (changed) resourcesView.refresh()
    }).catch(error => log(`[resources] ${error instanceof Error ? error.message : String(error)}`))
  }
  loadedModResources = async () => {
    const { sessions, path, failure } = await discoverActiveResourceMod()
    if (sessions === undefined) return undefined
    return Object.freeze({
      ...(failure === undefined ? {} : { failure }),
      openTreeDataSource: async () => Object.freeze({ value: sessions.tree(resourcesShowChain), release: async () => undefined }),
      async navigate(subjectId: string, range?: TreeNodeFacts['range'], stage?: string) {
        try {
          return await navigateWorkspaceResource(path ?? '', subjectId, range, stage)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log(`[resources] navigation ${subjectId} failed: ${message}`)
          void vscode.window.showErrorMessage(`Modkit: ${message}`)
          return false
        }
      },
    })
  }

  const logicalIdInScope = (scope: LiveLanguageScope, uri: vscode.Uri): string | undefined => {
    const root = scope.root
    if (root === undefined) return undefined
    if (root.scheme === CONTAINER_SCHEME && uri.scheme === CONTAINER_SCHEME) {
      const rootLocation = parseContainerUriPath(root.path)
      const location = parseContainerUriPath(uri.path)
      if (rootLocation === undefined || location === undefined) return undefined
      if (
        containerLocationIdentity(rootLocation.container) !==
        containerLocationIdentity(location.container)
      ) {
        return undefined
      }
      const prefix = rootLocation.entry === '' ? '' : `${rootLocation.entry}/`
      if (location.entry === rootLocation.entry) return ''
      return location.entry.startsWith(prefix) ? location.entry.slice(prefix.length) : undefined
    }
    if (root.scheme !== 'file' || uri.scheme !== 'file') return undefined
    const logicalId = relative(root.fsPath, uri.fsPath).replaceAll('\\', '/')
    return logicalId.startsWith('../') ? undefined : logicalId
  }

  interface EnumeratedScopeFiles {
    readonly files: readonly { readonly uri: vscode.Uri; readonly logicalId: string }[]
    readonly complete: boolean
  }

  const enumerateScopeFiles = async (
    root: vscode.Uri,
    extensions: ReadonlySet<string> | undefined,
    maxEntries: number,
    signal?: AbortSignal,
    /** Exact file names (lower-case) wanted besides the extensions. */
    names: ReadonlySet<string> = new Set(),
  ): Promise<EnumeratedScopeFiles> => {
    const queue: { readonly uri: vscode.Uri; readonly logicalId: string }[] = [
      { uri: root, logicalId: '' },
    ]
    const files: { readonly uri: vscode.Uri; readonly logicalId: string }[] = []
    let complete = true
    for (let directory = queue.shift(); directory !== undefined; directory = queue.shift()) {
      signal?.throwIfAborted()
      const entries = [...(await vscode.workspace.fs.readDirectory(directory.uri))].sort(
        ([left], [right]) => left.localeCompare(right),
      )
      for (const [name, type] of entries) {
        signal?.throwIfAborted()
        if (name === '.git' || name === 'node_modules') continue
        const logicalId = directory.logicalId === '' ? name : `${directory.logicalId}/${name}`
        const uri = vscode.Uri.joinPath(directory.uri, name)
        if ((type & vscode.FileType.Directory) !== 0) {
          queue.push({ uri, logicalId })
          continue
        }
        if ((type & vscode.FileType.File) === 0) continue
        const extension = languageFileExtension(name)
        if (
          extensions !== undefined &&
          !names.has(name.toLowerCase()) &&
          (extension === undefined || !extensions.has(extension))
        ) {
          continue
        }
        files.push(Object.freeze({ uri, logicalId }))
        if (files.length > maxEntries) {
          complete = false
          return Object.freeze({ files: Object.freeze(files.slice(0, maxEntries)), complete })
        }
      }
    }
    return Object.freeze({ files: Object.freeze(files), complete })
  }

  const disposeAutomaticLanguageScopes = (): void => {
    const pending = [...automaticLanguageScopes.values()]
    automaticLanguageScopes.clear()
    resolvedLanguageScopesByDocument.clear()
    for (const scope of pending) {
      void scope.then(value => value?.session.dispose()).catch(() => undefined)
    }
  }
  context.subscriptions.push({ dispose: disposeAutomaticLanguageScopes })

  interface LanguageContentPathIndex {
    readonly paths: readonly string[]
    readonly complete: boolean
    readonly revision: string
  }

  const languageContentPathIndexes = new Map<string, Promise<LanguageContentPathIndex>>()
  type LanguageSnapshotRequest = Parameters<LanguageWorkspaceDocumentSource['snapshot']>[0]
  interface CachedLanguageDocumentSnapshot {
    readonly capturedAt: number
    readonly value: LanguageWorkspaceDocumentSourceResult
  }
  const languageDocumentSnapshots = new Map<string, CachedLanguageDocumentSnapshot>()
  /** Snapshots being built, by key: the requests a shown editor sends at once wait for one. */
  const languageSnapshotBuilds = new Map<string, Promise<unknown>>()
  const clearLanguageCaches = (): void => {
    languageContentPathIndexes.clear()
    languageDocumentSnapshots.clear()
    languageSnapshotBuilds.clear()
    disposeAutomaticLanguageScopes()
  }
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(clearLanguageCaches),
    vscode.workspace.onDidDeleteFiles(clearLanguageCaches),
    vscode.workspace.onDidRenameFiles(clearLanguageCaches),
  )

  const workspaceContentPathIndex = (
    scope: LiveLanguageScope | undefined,
    contextId: string,
  ): Promise<LanguageContentPathIndex> => {
    const key = `${contextId}\0${scope?.revision ?? ''}`
    const cached = languageContentPathIndexes.get(key)
    if (cached !== undefined) return cached
    const pending = (async () => {
      const maxEntries = 65_536
      if (scope?.root !== undefined) {
        try {
          const enumerated = await enumerateScopeFiles(scope.root, undefined, maxEntries)
          const paths = Object.freeze(enumerated.files.map(item => item.logicalId).sort())
          return Object.freeze({
            paths,
            complete: enumerated.complete,
            revision: languageWorkspaceContextToken({ complete: enumerated.complete, paths }),
          })
        } catch {
          return Object.freeze({
            paths: Object.freeze([]),
            complete: false,
            revision: languageWorkspaceContextToken({ complete: false, paths: [] }),
          })
        }
      }
      let complete = true
      let uris: readonly vscode.Uri[] = []
      try {
        uris = await findDiskFiles('**/*', '**/{node_modules,.git}/**', maxEntries + 1)
      } catch {
        complete = false
      }
      if (uris.length > maxEntries) complete = false
      const paths = Object.freeze(
        [
          ...new Set(
            uris.slice(0, maxEntries).flatMap(candidate => {
              const root = vscode.workspace.getWorkspaceFolder(candidate)?.uri
              if (root === undefined) return []
              const logicalId = relative(root.fsPath, candidate.fsPath).replaceAll('\\', '/')
              return logicalId.startsWith('../') ? [] : [logicalId]
            }),
          ),
        ].sort(),
      )
      return Object.freeze({
        paths,
        complete,
        revision: languageWorkspaceContextToken({ complete, paths }),
      })
    })()
    languageContentPathIndexes.set(key, pending)
    return pending
  }

  const languageSnapshotKey = (
    scope: LiveLanguageScope | undefined,
    request: LanguageSnapshotRequest,
    closure?: { readonly loose?: string; readonly baseMods?: BaseModSetting },
  ): string =>
    languageWorkspaceContextToken({
      scope: scope?.contextId,
      scopeRevision: scope?.revision,
      loose: closure?.loose,
      baseMods: closure?.baseMods,
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(folder =>
        folder.uri.toString(),
      ),
      languages: [...request.workspaceLanguageIds].sort(),
    })

  const cachedLanguageSnapshot = (
    key: string,
    request: LanguageSnapshotRequest,
  ): LanguageWorkspaceDocumentSourceResult | undefined => {
    const cached = languageDocumentSnapshots.get(key)
    if (cached === undefined || Date.now() - cached.capturedAt > 10_000) {
      languageDocumentSnapshots.delete(key)
      return undefined
    }
    languageDocumentSnapshots.delete(key)
    languageDocumentSnapshots.set(key, cached)
    return rebaseLanguageSnapshot(cached.value, request)
  }

  const rememberLanguageSnapshot = (
    key: string,
    snapshot: LanguageWorkspaceDocumentSourceResult,
  ): void => {
    languageDocumentSnapshots.delete(key)
    languageDocumentSnapshots.set(key, Object.freeze({ capturedAt: Date.now(), value: snapshot }))
    while (languageDocumentSnapshots.size > 32) {
      const oldest = languageDocumentSnapshots.keys().next().value
      if (oldest === undefined) break
      languageDocumentSnapshots.delete(oldest)
    }
  }

  const workspaceLanguageDocumentSource = (
    scope: LiveLanguageScope | undefined,
    semanticComplete: boolean,
  ): LanguageWorkspaceDocumentSource =>
    Object.freeze({
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
        // Files a game knows by name (`Objects`, `Preload.xml`) route by that name.
        const fileNames = [
          ...new Set(
            languageRoutes.flatMap(route =>
              accepted.has(route.languageId) && route.fileName !== undefined
                ? [route.fileName.toLowerCase()]
                : [],
            ),
          ),
        ].sort()
        const kindOf = (path: string): string | undefined => {
          const name = path.slice(path.replaceAll('\\', '/').lastIndexOf('/') + 1).toLowerCase()
          return fileNames.includes(name) ? `name:${name}` : languageFileExtension(path)
        }
        if ((extensions.length === 0 && fileNames.length === 0) || request.maxDocuments === 0) {
          return {
            documents: Object.freeze([]),
            isComplete: extensions.length === 0 && fileNames.length === 0,
          }
        }
        // The document under the cursor is open too, and the host rejects a snapshot that repeats it.
        const openUris = new Set([
          request.document.uri,
          ...request.workspaceDocuments.map(document => document.uri),
        ])
        const candidates = new Map<
          string,
          { readonly uri: vscode.Uri; readonly extension: string }
        >()
        let isComplete = true
        if (scope?.root !== undefined) {
          const enumerated = await enumerateScopeFiles(
            scope.root,
            new Set(extensions),
            request.maxDocuments + 1,
            request.signal,
            new Set(fileNames),
          )
          isComplete = enumerated.complete
          for (const item of enumerated.files.slice(0, request.maxDocuments)) {
            if (openUris.has(item.uri.toString())) continue
            const extension = kindOf(item.logicalId)
            if (extension !== undefined) {
              candidates.set(item.uri.toString(), { uri: item.uri, extension })
            }
          }
        } else {
          for (const extension of extensions) {
            request.signal.throwIfAborted()
            const remaining = request.maxDocuments - candidates.size
            if (remaining <= 0) {
              isComplete = false
              break
            }
            const extensionPattern = caseInsensitiveExtensionPattern(extension)
            const uris = await findDiskFiles(
              `**/*.${extensionPattern}`,
              '**/{node_modules,.git}/**',
              remaining + 1,
            )
            if (uris.length > remaining) isComplete = false
            for (const uri of uris.slice(0, remaining)) {
              if (openUris.has(uri.toString())) continue
              candidates.set(uri.toString(), { uri, extension })
            }
          }
          for (const fileName of fileNames) {
            request.signal.throwIfAborted()
            const remaining = request.maxDocuments - candidates.size
            if (remaining <= 0) {
              isComplete = false
              break
            }
            const uris = await findDiskFiles(
              `**/${caseInsensitiveNamePattern(fileName)}`,
              '**/{node_modules,.git}/**',
              remaining + 1,
            )
            if (uris.length > remaining) isComplete = false
            for (const uri of uris.slice(0, remaining)) {
              if (openUris.has(uri.toString())) continue
              candidates.set(uri.toString(), { uri, extension: `name:${fileName}` })
            }
          }
        }
        /*
         * Order decides what survives the byte budget. Files of the edited document's own kind come
         * first — a layout resolves its templates against other layouts — and the rest are interleaved
         * by extension so one large kind cannot spend the remainder alone.
         */
        const primaryExtension = kindOf(vscode.Uri.parse(request.document.uri).path)
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
        const documentOrigins = []
        const folders = vscode.workspace.workspaceFolders ?? []
        const contextId =
          scope?.contextId ??
          languageWorkspaceContextToken({
            folders: folders.map(folder => folder.uri.toString()),
          })
        const pathIndex = await workspaceContentPathIndex(scope, contextId)
        request.signal.throwIfAborted()
        let totalTextBytes = 0
        /*
         * An open document gives its unsaved text; any other file is read from disk. Opening it as
         * a TextDocument would open it in the language workspace too, and every such opening
         * cancels the request this snapshot serves — a completion never got past the mod's files.
         */
        const openDocuments = new Map(
          vscode.workspace.textDocuments.map(item => [item.uri.toString(), item]),
        )
        for (const candidate of ranked.slice(0, request.maxDocuments)) {
          request.signal.throwIfAborted()
          const open = openDocuments.get(candidate.uri.toString())
          const classified = classifyLanguageFile(languageRoutes, candidate.uri.path)
          const routedLanguageIds = classified.candidates.filter(languageId =>
            accepted.has(languageId),
          )
          const languageId =
            open !== undefined && accepted.has(open.languageId)
              ? open.languageId
              : routedLanguageIds.length === 1
                ? routedLanguageIds[0]
                : undefined
          if (languageId === undefined) {
            // `.xml` and `.txt` commonly have several SC2 meanings. Extension-only routing would
            // inject the wrong semantic document, so leave the snapshot honestly incomplete. A file
            // only another language claims (`Preload.xml`) is simply not part of this snapshot.
            if (routedLanguageIds.length > 1) isComplete = false
            continue
          }
          const version = open?.version ?? 0
          const text =
            open?.getText() ??
            decodeText(await vscode.workspace.fs.readFile(candidate.uri), undefined)
          const bytes = new TextEncoder().encode(text).byteLength
          if (
            BigInt(bytes) > LANGUAGE_ACTIVATION_BUDGET.maxInputBytes ||
            BigInt(totalTextBytes + bytes) > LANGUAGE_WORKSPACE_BUDGET.maxInputBytes
          ) {
            isComplete = false
            continue
          }
          totalTextBytes += bytes
          documents.push(
            Object.freeze({
              uri: candidate.uri.toString(),
              languageId,
              version,
              text,
              ...(classified.dialect === undefined || classified.languageId !== languageId
                ? {}
                : { dialect: classified.dialect }),
            }),
          )
          const folder = vscode.workspace.getWorkspaceFolder(candidate.uri)
          const root = scope?.root ?? folder?.uri
          const precedence =
            scope === undefined ? (folder === undefined ? -1 : folders.indexOf(folder)) : 0
          const logicalId =
            scope === undefined
              ? root === undefined
                ? undefined
                : relative(root.fsPath, candidate.uri.fsPath).replaceAll('\\', '/')
              : logicalIdInScope(scope, candidate.uri)
          if (root !== undefined && logicalId !== undefined && precedence >= 0) {
            documentOrigins.push(
              Object.freeze({
                uri: candidate.uri.toString(),
                layerId: scope?.layerId ?? `${contextId}:root:${precedence}`,
                logicalId,
                precedence,
                sourceRevision: languageWorkspaceContextToken({ version, text }),
                readOnly: candidate.uri.scheme !== 'file',
                overlay: candidate.uri.scheme === 'file',
              }),
            )
          }
        }
        const suppliedOpenOrigins = request.workspaceDocumentOrigins.filter(origin =>
          scope === undefined
            ? origin.layerId.startsWith(`${contextId}:root:`)
            : origin.layerId === scope.layerId,
        )
        const openOriginsByUri = new Map(suppliedOpenOrigins.map(origin => [origin.uri, origin]))
        if (scope !== undefined) {
          for (const document of [request.document, ...request.workspaceDocuments]) {
            if (openOriginsByUri.has(document.uri)) continue
            let documentUri: vscode.Uri
            try {
              documentUri = vscode.Uri.parse(document.uri, true)
            } catch {
              continue
            }
            const logicalId = logicalIdInScope(scope, documentUri)
            if (logicalId === undefined || logicalId === '') continue
            openOriginsByUri.set(
              document.uri,
              Object.freeze({
                uri: document.uri,
                layerId: scope.layerId,
                logicalId,
                precedence: 0,
                sourceRevision: languageWorkspaceContextToken({
                  version: document.version,
                  text: document.text,
                }),
                readOnly: documentUri.scheme !== 'file',
                overlay: documentUri.scheme === 'file',
              }),
            )
          }
        }
        const openOrigins = [...openOriginsByUri.values()]
        const contextOrigins = Object.freeze([...openOrigins, ...documentOrigins])
        const locales = configuredGameLocales()
        const semanticInputs = Object.freeze([
          Object.freeze({
            kind: 'locale-set',
            id: `selected-game-locales:${locales.join(',')}`,
            revision: languageWorkspaceContextToken(locales),
            payload: Object.freeze({ locales: [...locales] }),
          }),
          ...contentPathIndexSemanticInputs({
            id: `${contextId}:local`,
            revision: pathIndex.revision,
            isComplete: pathIndex.complete,
            paths: pathIndex.paths,
          }),
          ...(scope === undefined
            ? []
            : [
                Object.freeze({
                  kind: 'subject',
                  id: scope.contextId,
                  revision: scope.revision,
                }),
              ]),
        ])
        if (languageOnly) {
          log(
            `[language-context] local workspace snapshot for ${request.document.uri}: accepted=${request.workspaceLanguageIds.join(',')} open=${request.workspaceDocuments.length} additional=${documents.length} origins=${contextOrigins.length}`,
          )
          // Large dependency URI lists belong to opt-in tracing, not every editor request.
          if (output.logLevel === vscode.LogLevel.Trace)
            output.trace(
              `[language-context] local documents: open=${request.workspaceDocuments.map(document => `${document.languageId}:${document.uri}`).join(',')} additional=${documents.map(document => `${document.languageId}:${document.uri}`).join(',')} origins=${contextOrigins.map(origin => `${origin.logicalId}:${origin.uri}`).join(',')}`,
            )
        }
        return {
          documents: Object.freeze(documents),
          isComplete,
          scopeWorkspaceDocuments: true,
          workspaceContext: Object.freeze({
            id: contextId,
            revision: languageWorkspaceContextToken({
              complete: isComplete,
              subjectRevision: scope?.revision,
              semanticInputs,
              documents: contextOrigins.map(origin => ({
                uri: origin.uri,
                sourceRevision: origin.sourceRevision,
              })),
            }),
            semanticComplete: semanticComplete && isComplete && pathIndex.complete,
            documentOrigins: contextOrigins,
            semanticInputs,
          }),
        }
      },
    })

  /**
   * `modkit.baseMods` for a document: the packages a file outside any package opens inside, keyed
   * by folder or file. Relative keys are taken against the document's workspace folder.
   */
  const baseModsSetting = (uri: vscode.Uri): BaseModSetting | undefined => {
    const raw: unknown = vscode.workspace.getConfiguration('modkit', uri).get('baseMods')
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath
    const entries = Object.entries(raw).flatMap(([key, mods]) =>
      Array.isArray(mods) && mods.length > 0 && mods.every(mod => typeof mod === 'string' && mod)
        ? [[key === '*' || isAbsolute(key) || folder === undefined ? key : join(folder, key), mods]]
        : [],
    )
    return entries.length === 0 ? undefined : Object.freeze(Object.fromEntries(entries))
  }


  /*
   * The projection names a file of a content source `content-source://<source>/<path>`; this window
   * opens the same file as `modkit-source://battlenet/<source>/<path>`. One name per file: an open
   * CASC document keeps its open URI even when storage spells its path in another case. Source ids
   * keep installations separate; a reference into Core opens in the editor.
   */
  const editorUriOfProjected = (uri: string, open: ReadonlyMap<string, string>): string => {
    const target = uri.startsWith('content-source:') ? subjectTarget(uri) : undefined
    return target === undefined || typeof target === 'string'
      ? uri
      : (open.get(`${target.sourceId}\0${target.path.toLowerCase()}`) ??
          open.get(target.path.toLowerCase()) ??
          vscode.Uri.from({
            scheme: 'modkit-source',
            authority: 'battlenet',
            path: `/${target.sourceId}/${target.path}`,
          }).toString())
  }
  /*
   * An open member of the game's storage mounted as a container (`CASC: StarCraft II`) is the same
   * file the projection names by its storage path; it keeps the editor's URI, or the unit a reader
   * looks at is declared twice.
   */
  const openStorageMembers = (request: {
    readonly document: { readonly uri: string }
    readonly workspaceDocuments: readonly { readonly uri: string }[]
  }): ReadonlyMap<string, string> => {
    const members = new Map<string, string>()
    for (const document of [request.document, ...request.workspaceDocuments]) {
      let parsed: vscode.Uri
      try {
        parsed = vscode.Uri.parse(document.uri, true)
      } catch {
        continue
      }
      if (parsed.scheme === 'modkit-source') {
        const target = modContextTargetOf(document.uri)
        if (target !== undefined && typeof target !== 'string')
          members.set(`${target.sourceId}\0${target.path.toLowerCase()}`, document.uri)
        continue
      }
      if (parsed.scheme !== CONTAINER_SCHEME) continue
      const entry = parseContainerUriPath(parsed.path)?.entry
      if (entry !== undefined && entry !== '') members.set(entry.toLowerCase(), document.uri)
    }
    return members
  }
  const withEditorUris = (source: LanguageWorkspaceDocumentSource): LanguageWorkspaceDocumentSource =>
    Object.freeze({
      async snapshot(request: Parameters<LanguageWorkspaceDocumentSource['snapshot']>[0]) {
        const result = await source.snapshot(request)
        const open = openStorageMembers(request)
        const context = result.workspaceContext
        return Object.freeze({
          ...result,
          documents: Object.freeze(
            result.documents.map(item =>
              Object.freeze({ ...item, uri: editorUriOfProjected(item.uri, open) }),
            ),
          ),
          ...(context === undefined
            ? {}
            : {
                workspaceContext: Object.freeze({
                  ...context,
                  documentOrigins: Object.freeze(
                    context.documentOrigins.map(origin =>
                      Object.freeze({ ...origin, uri: editorUriOfProjected(origin.uri, open) }),
                    ),
                  ),
                }),
              }),
        })
      },
    })

  /*
   * The loaded mods' servers language requests read (owner decision 07.10): each language scope's
   * mod context, kept open while the window lives and replaced when the scope's context is rebuilt
   * over another chain. Documents are named here as the editor names them.
   */
  const languageModContexts = createLanguageModContexts({
    targetOf: uri => {
      let parsed: vscode.Uri
      try {
        parsed = vscode.Uri.parse(uri, true)
      } catch {
        return undefined
      }
      const subject = subjectPathOf(parsed)
      return subject === undefined ? undefined : modContextTargetOf(subject)
    },
    uriOf: target =>
      typeof target === 'string'
        ? vscode.Uri.file(target).toString()
        : vscode.Uri.from({
            scheme: 'modkit-source',
            authority: 'battlenet',
            path: `/${target.sourceId}/${target.path}`,
          }).toString(),
    maxDocumentBytes: Number(LANGUAGE_ACTIVATION_BUDGET.maxInputBytes),
  })
  context.subscriptions.push({ dispose: () => void languageModContexts.dispose() })
  const dependencyFailureNotices = new Set<string>()
  /** The snapshot one key stands for, built once and remembered; callers rebase it on their request. */
  const buildLanguageSnapshot = async (
    request: LanguageSnapshotRequest,
    scope: LiveLanguageScope | undefined,
    loose: string | undefined,
    baseMods: BaseModSetting | undefined,
    snapshotKey: string,
  ): Promise<LanguageWorkspaceDocumentSourceResult> => {
    if (scope === undefined && loose === undefined) {
      const snapshot = await workspaceLanguageDocumentSource(undefined, false).snapshot(request)
      rememberLanguageSnapshot(snapshotKey, snapshot)
      return snapshot
    }
    let projected: Awaited<ReturnType<typeof resolveContentLanguageSources>> | undefined
    const includeLocalWorkspace =
      scope?.root !== undefined || (scope === undefined && request.document.uri.startsWith('file:'))
    try {
      const targetPath = scope?.path ?? loose
      const target = targetPath === undefined ? undefined : modContextTargetOf(targetPath)
      projected = await resolveContentLanguageSources({
        contentSources: await requireContentSources(),
        routes: languageRoutes,
        limits: {
          maxDocumentBytes: Number(LANGUAGE_ACTIVATION_BUDGET.maxInputBytes),
          maxWorkspaceBytes: Number(LANGUAGE_WORKSPACE_BUDGET.maxInputBytes),
          maxEntries: 65_536,
        },
        subjects:
          target === undefined
            ? []
            : [{ descriptor: scope?.descriptor ?? Object.freeze({}), target }],
        ...(baseMods === undefined ? {} : { baseMods }),
        keepContexts: true,
        signal: request.signal,
      })
      languageModContexts.replace(scope?.contextId ?? loose ?? '', projected.contexts ?? [])
      // The scope's server builds its Data while the snapshot is composed.
      void languageModContexts.prepare()
      for (const item of projected.diagnostics) {
        log(`[language-context] ${item.severity} ${item.code}: ${item.message}`)
      }
    } catch (error) {
      request.signal.throwIfAborted()
      const message = error instanceof Error ? error.message : String(error)
      const notice = `${scope?.contextId ?? loose}:${message}`
      if (!dependencyFailureNotices.has(notice)) {
        dependencyFailureNotices.add(notice)
        log(
          `[language-context] dependency context unavailable for ${scope?.path ?? loose}: ${message}`,
        )
      }
    }
    // Content-source targets supply their own closure; local folder fallback would mix other mods.
    const local = includeLocalWorkspace
      ? workspaceLanguageDocumentSource(scope, projected?.dependenciesComplete === true)
      : undefined
    const composed = composeLanguageDocumentSources([
      ...(projected?.sources ?? []).map(withEditorUris),
      ...(local === undefined ? [] : [local]),
    ])
    const snapshot: LanguageWorkspaceDocumentSourceResult =
      composed === undefined
        ? Object.freeze({ documents: Object.freeze([]), isComplete: false })
        : await composed.snapshot(request)
    rememberLanguageSnapshot(snapshotKey, snapshot)
    log(
      `[language-context] workspace snapshot for ${request.document.uri}: accepted=${request.workspaceLanguageIds.join(',')} open=${request.workspaceDocuments.length} additional=${snapshot.documents.length} origins=${snapshot.workspaceContext?.documentOrigins.length ?? 0}`,
    )
    if (output.logLevel === vscode.LogLevel.Trace)
      output.trace(
        `[language-context] workspace documents: open=${request.workspaceDocuments.map(document => `${document.languageId}:${document.uri}`).join(',')} additional=${snapshot.documents.map(document => `${document.languageId}:${document.uri}`).join(',')} origins=${snapshot.workspaceContext?.documentOrigins.map(origin => `${origin.logicalId}:${origin.uri}`).join(',') ?? ''}`,
      )
    return snapshot
  }

  const languageDocumentSource: LanguageWorkspaceDocumentSource = Object.freeze({
    async snapshot(request: Parameters<LanguageWorkspaceDocumentSource['snapshot']>[0]) {
      let uri: vscode.Uri
      try {
        uri = vscode.Uri.parse(request.document.uri, true)
      } catch {
        return workspaceLanguageDocumentSource(undefined, false).snapshot(request)
      }
      const scope = await resolveLanguageScope(uri, request.signal)
      const baseMods = baseModsSetting(uri)
      // A file that belongs to no package still opens inside mods: the setting's, or the game's own.
      const loose =
        scope === undefined &&
        (uri.scheme === 'file' || uri.scheme === 'modkit-source' || uri.scheme === CONTAINER_SCHEME)
          ? subjectPathOf(uri)
          : undefined
      const snapshotKey = languageSnapshotKey(scope, request, {
        ...(loose === undefined ? {} : { loose }),
        ...(baseMods === undefined ? {} : { baseMods }),
      })
      /*
       * One build per key at a time. A shown editor asks for tokens, highlights, inlays and a
       * definition at once; each missed the cache while the first was still building and built its
       * own (v88: eight builds of a second each, one after another, before F12 was answered).
       */
      return oneBuildPerKey(
        languageSnapshotBuilds,
        snapshotKey,
        () => cachedLanguageSnapshot(snapshotKey, request),
        async () =>
          rebaseLanguageSnapshot(
            await buildLanguageSnapshot(request, scope, loose, baseMods, snapshotKey),
            request,
          ),
        request.signal,
      )
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

  const observedLanguageContexts = new Set<string>()
  /*
   * A picture of an asset a hover or a focused completion names (plan 0.5, core 6840676d): the
   * path is found in the document's mod context — the last layer holding it — and drawn by the
   * gallery's route (`galleryThumbnailOf`, assigned once the explorer is built). The host appends
   * it as a data image; one that fails is left out.
   */
  let drawThumbnail: (
    ref: string,
    maxEdge: number,
  ) => Promise<GalleryThumbnail | undefined> = async () => undefined
  /**
   * Where a path the game names (an asset, a model) lies in the mod chain of the document at `uri`:
   * a path on disk for a host layer, a `modkit-source:` address for a layer of a content source.
   */
  const locateInModChain = async (uri: vscode.Uri, path: string): Promise<string | undefined> => {
    const target = modContextTargetOf(subjectPathOf(uri))
    const source = await requireContentSources().catch(() => undefined)
    if (target === undefined || source?.openModContext === undefined) return undefined
    const baseMods =
      typeof target === 'string' ? baseModsFor(target, baseModsSetting(uri)) : undefined
    const modContext = await source.openModContext({
      schemaVersion: 1,
      target,
      ...(baseMods === undefined ? {} : { baseMods }),
    })
    try {
      const located = await modContext.locate(path)
      const layer = modContext.layers.find(item => item.id === located?.layerId)
      if (located === undefined || layer === undefined) return undefined
      return layer.sourceId === HOST_LAYER_SOURCE_ID
        ? join(layer.sourcePath, located.path)
        : vscode.Uri.from({
            scheme: 'modkit-source',
            authority: 'battlenet',
            path: `/${layer.sourceId}/${layer.sourcePath}/${located.path}`,
          }).toString()
    } finally {
      await modContext.dispose()
    }
  }

  const assetImage = async (
    request: LanguageAssetImageRequest,
  ): Promise<LanguageAssetImage | undefined> => {
    const ref = await locateInModChain(vscode.Uri.parse(request.documentUri, true), request.path)
    if (ref === undefined) return undefined
    const picture = await drawThumbnail(ref, request.maxEdge)
    if (picture === undefined) return undefined
    // a vector picture goes as it is; the host takes SVG up to its own bound
    if ('svg' in picture)
      return { mediaType: 'image/svg+xml', bytes: new TextEncoder().encode(picture.svg) }
    // a file only a browser decodes, or a font only a page sets, is not a picture this host encodes
    if ('image' in picture || 'font' in picture) return undefined
    return { mediaType: 'image/png', bytes: await encodeRgbaPng(picture, request.signal) }
  }

  const languageWorkspace = createLanguageWorkspace({
    services: host.services,
    assetImage,
    grant: { id: 'modkit.app.vscode/language', classes: [] },
    budgets: LANGUAGE_ACTIVATION_BUDGET,
    workspaceBudgets: LANGUAGE_WORKSPACE_BUDGET,
    subjectCandidates: languageSubjectCandidates,
    documentSource: languageDocumentSource,
    modContexts: languageModContexts,
    documentOrigin: document => {
      let uri: vscode.Uri
      try {
        uri = vscode.Uri.parse(document.uri, true)
      } catch {
        return undefined
      }
      const scope = cachedLanguageScope(uri)
      if (scope !== undefined) {
        const logicalId = logicalIdInScope(scope, uri)
        if (logicalId === undefined || logicalId === '' || logicalId.startsWith('..')) {
          return undefined
        }
        return Object.freeze({
          uri: document.uri,
          layerId: scope.layerId,
          logicalId,
          precedence: 0,
          sourceRevision: languageWorkspaceContextToken({
            version: document.version,
            text: document.text,
          }),
          readOnly: uri.scheme !== 'file',
          overlay: uri.scheme === 'file',
        })
      }
      const folders = vscode.workspace.workspaceFolders ?? []
      const folder = vscode.workspace.getWorkspaceFolder(uri)
      const precedence = folder === undefined ? -1 : folders.indexOf(folder)
      if (folder === undefined || precedence < 0) return undefined
      const contextId = languageWorkspaceContextToken({
        folders: folders.map(item => item.uri.toString()),
      })
      return Object.freeze({
        uri: document.uri,
        layerId: `${contextId}:root:${precedence}`,
        logicalId: relative(folder.uri.fsPath, uri.fsPath).replaceAll('\\', '/'),
        precedence,
        sourceRevision: languageWorkspaceContextToken({
          version: document.version,
          text: document.text,
        }),
        readOnly: false,
        overlay: true,
      })
    },
    observeWorkspaceContext: (context, documentUri) => {
      const observedKey = `${documentUri}\0${context?.revision}`
      if (context === undefined || observedLanguageContexts.has(observedKey)) return
      observedLanguageContexts.add(observedKey)
      const inputs = context.semanticInputs?.map(input => `${input.kind}:${input.id}`).sort() ?? []
      const failures =
        context.semanticInputs?.flatMap(input => {
          if (
            input.kind !== 'semantic-context-status' ||
            typeof input.payload !== 'object' ||
            input.payload === null ||
            Array.isArray(input.payload)
          ) {
            return []
          }
          const message = (input.payload as Readonly<Record<string, unknown>>)['message']
          return typeof message === 'string' ? [message] : []
        }) ?? []
      // The loaded mod's server a provider asks, by scope and revision (owner decision 07.10).
      const server =
        context.modContext === undefined
          ? ''
          : `${context.modContext.scope}@${context.modContext.revision}`
      log(
        `[language-context] resolved revision=${context.revision} complete=${String(context.semanticComplete)} inputs=${inputs.join(',')} modContext=${server} document=${documentUri} failures=${failures.join('; ')}`,
      )
    },
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

  const nativeLocation = (location: {
    readonly uri: string
    readonly range: Parameters<typeof rangeOf>[0]
  }): vscode.Location =>
    new vscode.Location(vscode.Uri.parse(location.uri), rangeOf(location.range))

  /** A provider's markdown: its HTML subset drawn, and of commands only the language command runs. */
  const providerMarkdown = (markdown: string): vscode.MarkdownString => {
    const native = new vscode.MarkdownString(markdown)
    native.supportHtml = true
    native.isTrusted = { enabledCommands: [LANGUAGE_COMMAND] }
    return native
  }

  /** A hover's links — the entity's card, its graph, a place — as command links it trusts. */
  const hoverLinks = (
    commands: readonly { readonly title: string; readonly command: unknown }[] | undefined,
  ): string =>
    commands === undefined || commands.length === 0
      ? ''
      : `\n\n${commands
          .map(
            item =>
              `[${item.title.replace(/[[\]]/gu, '')}](command:${LANGUAGE_COMMAND}?${encodeURIComponent(
                JSON.stringify([item.command]),
              )})`,
          )
          .join(' · ')}`

  /** A provider's command as a VS Code one: the language command, with the command as argument. */
  const providerCommand = (title: string, command: unknown): vscode.Command => ({
    title,
    command: LANGUAGE_COMMAND,
    arguments: [command],
  })

  /** Where each listed completion came from, so its provider can fill it in when focused. */
  const completionOrigins = new WeakMap<
    vscode.CompletionItem,
    {
      readonly document: vscode.TextDocument
      readonly position: vscode.Position
      readonly item: LanguageCompletionItem
    }
  >()

  const FOLDING_KINDS = {
    comment: vscode.FoldingRangeKind.Comment,
    imports: vscode.FoldingRangeKind.Imports,
    region: vscode.FoldingRangeKind.Region,
  } as const
  const HIGHLIGHT_KINDS = {
    text: vscode.DocumentHighlightKind.Text,
    read: vscode.DocumentHighlightKind.Read,
    write: vscode.DocumentHighlightKind.Write,
  } as const

  /** The schemes of a file a page may ask this window to show: on disk, of a source, in a container. */
  const SOURCE_SCHEMES = new Set(['file', 'modkit-source', CONTAINER_SCHEME])
  /**
   * A list the snapshot's limits cut (references, workspace symbols): VS Code has no flag for it, so
   * the status bar says the list is not all there rather than letting it pass for complete.
   */
  const announceIncomplete = (count: number): void => {
    vscode.window.setStatusBarMessage(
      `$(warning) ${localizer.text('vscode.language.incomplete', { count })}`,
      8_000,
    )
  }
  /** A link's target as the editor opens it: a content-source address through its mounted source. */
  const linkTarget = (target: string): vscode.Uri | undefined => {
    const place = target.startsWith('content-source:') ? subjectTarget(target) : undefined
    if (place !== undefined && typeof place !== 'string') {
      return vscode.Uri.from({
        scheme: 'modkit-source',
        authority: 'battlenet',
        path: `/${place.sourceId}/${place.path}`,
      })
    }
    try {
      return vscode.Uri.parse(target, true)
    } catch {
      return undefined
    }
  }

  /** One provider feature: cancelled with the editor's token; a failure is logged, answered empty. */
  const askProvider = async <T>(
    name: string,
    token: vscode.CancellationToken,
    run: (signal: AbortSignal) => Promise<T | undefined>,
  ): Promise<T | undefined> => {
    const cancellation = signalFor(token)
    try {
      return await run(cancellation.signal)
    } catch (error) {
      if (!token.isCancellationRequested) {
        log(`[language] ${name} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      return undefined
    } finally {
      cancellation.dispose()
    }
  }

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

  /** A provider diagnostic as VS Code draws it: its code link, tags, related places. */
  const nativeDiagnostic = (item: EditorLanguageDiagnostic): vscode.Diagnostic => {
    const native = new vscode.Diagnostic(
      rangeOf(item.range),
      item.message,
      SEVERITY[item.severity] ?? vscode.DiagnosticSeverity.Information,
    )
    if (item.code !== undefined) {
      // an http(s) page for the code makes it a link in the Problems view
      native.code =
        item.codeDescription === undefined
          ? item.code
          : { value: item.code, target: vscode.Uri.parse(item.codeDescription) }
    }
    native.source = item.source ?? 'Modkit Language'
    if (item.tags !== undefined) {
      native.tags = item.tags.map(tag =>
        tag === 'deprecated' ? vscode.DiagnosticTag.Deprecated : vscode.DiagnosticTag.Unnecessary,
      )
    }
    if (item.relatedInformation !== undefined) {
      native.relatedInformation = item.relatedInformation.map(
        related =>
          new vscode.DiagnosticRelatedInformation(
            nativeLocation(related.location),
            related.message,
          ),
      )
    }
    return native
  }

  const languageController = createLanguageSessionController({
    workspace: languageWorkspace,
    routes: languageRoutes,
    // Keep background semantic analysis out of the completion latency window after a keystroke.
    // Explicit Verify is immediate; only automatic diagnostics wait for the editor to go idle.
    // Both waits are settings (MK2's documentUpdateDelay, documentDiagnosticsDelay), read each time.
    debounceMs: () =>
      vscode.workspace.getConfiguration('modkit').get<number>('documentUpdateDelay', 150),
    semanticDiagnosticsDelayMs: () =>
      vscode.workspace.getConfiguration('modkit').get<number>('documentDiagnosticsDelay', 2_500),
    publishDiagnostics: (uri, diagnostics) => {
      const target = vscode.Uri.parse(uri)
      for (const item of diagnostics) {
        log(`[language] ${uri}: ${item.severity} ${item.code}: ${item.message}`)
      }
      languageDiagnostics.set(target, diagnostics.map(nativeDiagnostic))
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
  context.subscriptions.push(
    registerDocumentVerification(languageController, localizer, nativeDiagnostic, log),
  )

  const selectorEntries = new Map<string, vscode.DocumentFilter>()
  for (const route of languageRoutes) {
    const byLanguage: vscode.DocumentFilter = { language: route.languageId }
    selectorEntries.set(JSON.stringify(byLanguage), byLanguage)
    if (route.extension !== undefined) {
      const extensionPattern = caseInsensitiveExtensionPattern(route.extension)
      const byExtension: vscode.DocumentFilter = {
        scheme: 'file',
        pattern: `**/*.${extensionPattern}`,
      }
      selectorEntries.set(JSON.stringify(byExtension), byExtension)
    }
    if (route.fileName !== undefined) {
      const byName: vscode.DocumentFilter = {
        scheme: 'file',
        pattern: `**/${caseInsensitiveNamePattern(route.fileName)}`,
      }
      selectorEntries.set(JSON.stringify(byName), byName)
    }
  }
  const languageSelector: vscode.DocumentSelector = [...selectorEntries.values()]
  const completionTriggerCharacters = languageProviderTriggerCharacters(
    languageRoutes,
    'completion',
  )
  const signatureHelpTriggerCharacters = languageProviderTriggerCharacters(
    languageRoutes,
    'signatureHelp',
  )
  const onTypeFormattingTriggerCharacters = languageProviderTriggerCharacters(
    languageRoutes,
    'onTypeFormatting',
  )
  const onTypeFormattingTriggers = new Set(onTypeFormattingTriggerCharacters)
  /*
   * One registration serves every language, so it carries the union of their trigger characters. A
   * character only another language declares (a space for strings, `,` elsewhere) must not open
   * this document's list — MK2 registered each language with its own.
   */
  const foreignTrigger = (
    document: vscode.TextDocument,
    feature: 'completion' | 'signatureHelp',
    triggerCharacter: string | undefined,
  ): boolean =>
    typeof triggerCharacter === 'string' &&
    triggerCharacter.length > 0 &&
    languageController
      .triggerCharacters(languageDocument(document), feature)
      ?.includes(triggerCharacter) !== true

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

  const applyOnTypeEdit = async (event: vscode.TextDocumentChangeEvent): Promise<void> => {
    const [change] = event.contentChanges
    if (
      event.contentChanges.length !== 1 ||
      change === undefined ||
      change.rangeLength !== 0 ||
      !onTypeFormattingTriggers.has(change.text)
    ) {
      return
    }
    const document = languageDocument(event.document)
    const editor = vscode.window.visibleTextEditors.find(
      candidate => candidate.document.uri.toString() === document.uri,
    )
    const tabSize = typeof editor?.options.tabSize === 'number' ? editor.options.tabSize : 4
    const insertSpaces =
      typeof editor?.options.insertSpaces === 'boolean' ? editor.options.insertSpaces : true
    const result = await languageController.onTypeFormatting(
      document,
      plainLanguagePosition(event.document.positionAt(change.rangeOffset + change.text.length)),
      change.text,
      { tabSize, insertSpaces },
    )
    if (result === undefined) return
    let actionVersion: number | undefined
    await applyEditorOnTypeEditResult(result, {
      async applyEdits(edits) {
        if (event.document.version !== document.version) return false
        if (edits.length === 0) {
          actionVersion = document.version
          return true
        }
        const workspaceEdit = new vscode.WorkspaceEdit()
        workspaceEdit.set(
          event.document.uri,
          edits.map(item => vscode.TextEdit.replace(rangeOf(item.range), item.newText)),
        )
        const applied = await vscode.workspace.applyEdit(workspaceEdit)
        if (!applied || event.document.version !== document.version + 1) return false
        actionVersion = event.document.version
        return true
      },
      moveCursor(position) {
        const active = vscode.window.activeTextEditor
        if (
          active?.document.uri.toString() !== document.uri ||
          active.document.version !== actionVersion
        ) {
          return
        }
        const cursor = new vscode.Position(position.line, position.character)
        active.selection = new vscode.Selection(cursor, cursor)
      },
      async requestCompletion() {
        const active = vscode.window.activeTextEditor
        if (
          active?.document.uri.toString() !== document.uri ||
          active.document.version !== actionVersion
        ) {
          return
        }
        await vscode.commands.executeCommand('editor.action.triggerSuggest')
      },
    })
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
                // run after the edit, or alone: open the entity the fix concerns
                if (item.command !== undefined)
                  action.command = providerCommand(item.title, item.command)
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
      vscode.languages.registerCompletionItemProvider(
        languageSelector,
        {
          async provideCompletionItems(document, position, token, context) {
            if (foreignTrigger(document, 'completion', context.triggerCharacter)) return undefined
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
                    vscode.CompletionItemKind[completionKindName(item.kind)],
                  )
                  if (item.detail !== undefined) native.detail = item.detail
                  if (item.documentation !== undefined) {
                    // a colour item's plain documentation is the swatch VS Code draws beside it
                    native.documentation =
                      item.kind === 'color'
                        ? item.documentation
                        : new vscode.MarkdownString(item.documentation)
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
                  // A shortcut item (`:Button`) replaces from its shortcut character on; VS Code
                  // filters by the range's text, so without the provider's filter text it hides it.
                  if (item.filterText !== undefined) native.filterText = item.filterText
                  if (item.preselect === true) native.preselect = true
                  if (item.commitCharacters !== undefined)
                    native.commitCharacters = [...item.commitCharacters]
                  if (item.deprecated === true) native.tags = [vscode.CompletionItemTag.Deprecated]
                  // `name=""` asks for its values next, as MK2's attribute completion did
                  if (item.retrigger === true) {
                    native.command = { command: 'editor.action.triggerSuggest', title: '' }
                  }
                  completionOrigins.set(native, { document, position, item })
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
          // documentation read on demand and the asset drawn, for the item the editor focused
          resolveCompletionItem: (native, token) =>
            askProvider('completion resolve', token, async signal => {
              const origin = completionOrigins.get(native)
              if (origin === undefined) return native
              const resolved = await languageController.resolveCompletion(
                languageDocument(origin.document),
                { line: origin.position.line, character: origin.position.character },
                origin.item,
                signal,
              )
              if (resolved?.detail !== undefined) native.detail = resolved.detail
              if (resolved?.documentation !== undefined) {
                native.documentation =
                  resolved.kind === 'color'
                    ? resolved.documentation
                    : providerMarkdown(resolved.documentation)
              }
              return native
            }).then(resolved => resolved ?? native),
        },
        ...completionTriggerCharacters,
      ),
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
                  providerMarkdown(`${hover.markdown}${hoverLinks(hover.commands)}`),
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
          async provideSignatureHelp(document, position, token, context) {
            if (foreignTrigger(document, 'signatureHelp', context.triggerCharacter))
              return undefined
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
        ...signatureHelpTriggerCharacters,
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
            if (result?.isIncomplete === true) announceIncomplete(result.locations.length)
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
            if (result?.isIncomplete === true) announceIncomplete(result.symbols.length)
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
      vscode.languages.registerCodeLensProvider(languageSelector, {
        provideCodeLenses: (document, token) =>
          askProvider('code lenses', token, async signal =>
            (await languageController.codeLenses(languageDocument(document), signal))?.lenses.map(
              lens =>
                new vscode.CodeLens(
                  rangeOf(lens.range),
                  // a lens without a command is a title the reader cannot click
                  lens.command === undefined
                    ? { title: lens.title, command: '' }
                    : providerCommand(lens.title, lens.command),
                ),
            ),
          ),
      }),
      vscode.languages.registerFoldingRangeProvider(languageSelector, {
        provideFoldingRanges: (document, _context, token) =>
          askProvider('folding ranges', token, async signal =>
            (
              await languageController.foldingRanges(languageDocument(document), signal)
            )?.ranges.map(
              range =>
                new vscode.FoldingRange(
                  range.startLine,
                  range.endLine,
                  range.kind === undefined ? undefined : FOLDING_KINDS[range.kind],
                ),
            ),
          ),
      }),
      vscode.languages.registerDocumentLinkProvider(languageSelector, {
        provideDocumentLinks: (document, token) =>
          askProvider('document links', token, async signal =>
            (
              await languageController.documentLinks(languageDocument(document), signal)
            )?.links.flatMap(link => {
              const target = linkTarget(link.target)
              if (target === undefined) return []
              const native = new vscode.DocumentLink(rangeOf(link.range), target)
              if (link.tooltip !== undefined) native.tooltip = link.tooltip
              return [native]
            }),
          ),
      }),
      vscode.languages.registerDocumentHighlightProvider(languageSelector, {
        provideDocumentHighlights: (document, position, token) =>
          askProvider('document highlights', token, async signal =>
            (
              await languageController.documentHighlights(
                languageDocument(document),
                { line: position.line, character: position.character },
                signal,
              )
            )?.highlights.map(
              highlight =>
                new vscode.DocumentHighlight(
                  rangeOf(highlight.range),
                  highlight.kind === undefined ? undefined : HIGHLIGHT_KINDS[highlight.kind],
                ),
            ),
          ),
      }),
      vscode.languages.registerInlayHintsProvider(languageSelector, {
        provideInlayHints: (document, range, token) =>
          askProvider('inlay hints', token, async signal =>
            (
              await languageController.inlayHints(
                languageDocument(document),
                {
                  start: { line: range.start.line, character: range.start.character },
                  end: { line: range.end.line, character: range.end.character },
                },
                signal,
              )
            )?.hints.map(hint => {
              const native = new vscode.InlayHint(
                new vscode.Position(hint.position.line, hint.position.character),
                hint.label,
                hint.kind === 'type'
                  ? vscode.InlayHintKind.Type
                  : hint.kind === 'parameter'
                    ? vscode.InlayHintKind.Parameter
                    : undefined,
              )
              if (hint.tooltip !== undefined) native.tooltip = hint.tooltip
              if (hint.paddingLeft === true) native.paddingLeft = true
              if (hint.paddingRight === true) native.paddingRight = true
              return native
            }),
          ),
      }),
      /** What a provider's lens, code action or hover link asks for: the sdk's closed command set. */
      vscode.commands.registerCommand(LANGUAGE_COMMAND, async (argument: unknown) => {
        const target = languageCommandTarget(argument)
        if (target === undefined) return false
        if (target.kind === 'location') {
          await vscode.window.showTextDocument(vscode.Uri.parse(target.uri), {
            selection: rangeOf(target.range),
          })
          return true
        }
        // an entity of the active document's workspace, on the view the provider named
        const host = await loadedModResources()
        if (host === undefined) {
          void vscode.window.showWarningMessage(
            localizer.text('vscode.entity.noWorkspace', { subject: target.subjectId }),
          )
          return false
        }
        return (await host.navigate(target.subjectId, undefined, target.stage)) !== false
      }),
      vscode.workspace.onDidOpenTextDocument(document => {
        languageController.open(languageDocument(document))
        void resolveLanguageScope(document.uri).catch(error =>
          log(
            `[language-context] package preload failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        languageController.change(languageDocument(event.document))
        void applyOnTypeEdit(event).catch(error =>
          log(
            `[language] on-type edit failed: ${error instanceof Error ? error.message : String(error)}${
              isModkitError(error) && typeof error.context?.['error'] === 'string'
                ? `: ${error.context['error']}`
                : ''
            }`,
          ),
        )
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        resolvedLanguageScopesByDocument.delete(document.uri.toString())
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
      if (
        vscode.window.visibleTextEditors.some(
          editor => editor.document.uri.toString() === document.uri.toString(),
        )
      ) {
        languageController.open(languageDocument(document))
        void resolveLanguageScope(document.uri).catch(error =>
          log(
            `[language-context] package preload failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
      }
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

  if (languageOnly) {
    const activationMs = Date.now() - activationStarted
    log(`Modkit language-only debug host activated in ${activationMs} ms`)
    return Object.freeze({
      activationMs,
      missingCatalogRoots: Object.freeze(
        host.extensions.problems.filter(problem => problem.startsWith('the shipped catalog names')),
      ),
      contributions: host.contributions.length,
      languageRoutes: Object.freeze(
        languageRoutes.map(
          route => `${route.languageId}:${route.documentKind}:${route.extension ?? '*'}`,
        ),
      ),
      runtime: runtimeDebug,
      facilities: () => undefined,
      diagnostics: () => journal.lines(),
    })
  }

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

  // ---------------------------------------------------------------- explorer gallery
  /*
   * Pictures for the gallery of the webview file explorer.
   *
   * The gallery used to be a sidebar view of its own; it is now part of the explorer, so it draws
   * whatever the explorer lists — archive members, folder files, content-source entries — through
   * one opener that takes all three kinds of ref. Requests run one at a time, so a folder of large
   * images cannot flood the codec workers.
   */
  const galleryExtensions = imageGalleryExtensions(host.services.inventory)
  // the pictures "Convert…" is offered on in menus; a menu matches an extension as written
  void vscode.commands.executeCommand('setContext', 'modkit.pictureExtensions', [
    ...[...galleryExtensions].flatMap(extension => [
      `.${extension}`,
      `.${extension.toUpperCase()}`,
    ]),
  ])
  const thumbnailOpener = createVsCodeCommandOpener({
    services: host.services,
    roots,
    containers,
    subjectCatalog,
    readContentSource,
  })
  let thumbnailQueue: Promise<unknown> = Promise.resolve()
  /*
   * A picture no codec decodes to pixels (WebP and GIF publish none) but the page can decode: the
   * file's bytes, read through VS Code's file system (plan 7.37).
   */
  const browserImageOf = async (ref: string): Promise<GalleryThumbnail | undefined> => {
    const mediaType = browserImageType(ref)
    if (mediaType === undefined) return undefined
    const uri = subjectUriOf(ref)
    if ((await vscode.workspace.fs.stat(uri)).size > MAXIMUM_BROWSER_IMAGE_BYTES) return undefined
    // a Buffer would cross to the page through its `toJSON`, as a list of numbers
    return { image: ownedWireBytes(await vscode.workspace.fs.readFile(uri)), mediaType }
  }
  const galleryThumbnailOf = (
    ref: string,
    maxEdge: number,
  ): Promise<GalleryThumbnail | undefined> => {
    const drawn = thumbnailQueue.then(
      async () =>
        (await renderGalleryThumbnail(thumbnailOpener, ref, maxEdge).catch(() => undefined)) ??
        (await browserImageOf(ref)),
    )
    thumbnailQueue = drawn.catch(() => undefined)
    // A file with no decoded pixels stays in the gallery by name.
    return drawn.catch(() => undefined)
  }
  drawThumbnail = galleryThumbnailOf

  // ---------------------------------------------------------------- webviews
  /*
   * A member or file opened from an explorer page (plan 7.37).
   *
   * MK2 showed a gallery's clicked picture in the same panel. Here a gallery click opens a preview
   * tab, which the next gallery click reuses, as a single click in VS Code's Explorer does, and
   * `workbench.editor.enablePreview` turns that off. The page's own tab is kept first: a preview
   * tab would otherwise replace the archive or folder the click came from. Everything else opens
   * a tab of its own.
   */
  const openGalleryAware = async (uri: vscode.Uri, preview: boolean): Promise<void> => {
    if (preview) await vscode.commands.executeCommand('workbench.action.keepEditor')
    await vscode.commands.executeCommand('vscode.open', uri, { preview })
  }
  const attach = (
    webview: vscode.Webview,
    openPath?: string,
    lifecycle?: {
      readonly onDirty: (path: string, dirty: boolean) => void
      readonly onSaveRequested: (path: string) => void
      readonly onRevertRequested?: (path: string) => void
      /** One committed edit in a view with its own history; one editor undo-stack entry. */
      readonly onEdited?: (path: string) => void
    },
    extensionCard?: import('./extension-cards.js').ExtensionCardBundle,
    extensionCardResources?: import('./extension-cards.js').ExtensionCardResourceTargets,
    extensionCardIconPath?: string,
    forcedStage?: string,
    explorer?: {
      readonly label: string
      readonly backend: NonNullable<VsCodeServeOptions['explorer']>
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
      ask,
      pick: async (title, items) =>
        (
          await vscode.window.showQuickPick(
            items.map(item => ({
              label: item.label,
              ...(item.detail === undefined ? {} : { description: item.detail }),
              id: item.id,
            })),
            { title, matchOnDescription: true },
          )
        )?.id,
      tableBaseline: pickTableBaseline,
      confirmLossyWrite,
      ...(openPath === undefined
        ? {}
        : {
            viewerStatus: (items, choose) =>
              viewerStatusBar.set(subjectKey(openPath), items, choose),
          }),
      /*
       * The archive viewer's context menu, answered as the Explorer answers its own: names are
       * asked for in the editor's input box, a delete is confirmed in a modal, paths go to the
       * clipboard. Every change is one repack of the container through `containers.edit`.
       */
      archiveAction: async ({ container, action, path, kind }) => {
        const { file, members } = splitContainer(container)
        const leafOf = (item: string): string => item.slice(item.lastIndexOf('/') + 1)
        const parentOf = (item: string): string => item.slice(0, Math.max(0, item.lastIndexOf('/')))
        const join = (folder: string, leaf: string): string =>
          folder === '' ? leaf : `${folder}/${leaf}`
        const askName = async (prompt: string, value?: string): Promise<string | undefined> =>
          (
            await vscode.window.showInputBox({
              prompt,
              ...(value === undefined ? {} : { value }),
              validateInput: text =>
                text.trim() === '' || text.includes('/') || text.includes(BACKSLASH)
                  ? localizer.text('vscode.archive.badName')
                  : undefined,
            })
          )?.trim()
        const openMember = (member: string): Thenable<unknown> =>
          vscode.commands.executeCommand(
            'vscode.open',
            subjectUriOf(containerUriText(container, member)),
            { preview: false },
          )
        try {
          switch (action) {
            case 'open':
              await openMember(path)
              return false
            case 'copy-path':
            case 'copy-relative-path': {
              // `C:\Folder\Z2.zip!\Z.zip!\T.txt`, in the separators the file system uses.
              const separator = file.includes(BACKSLASH) ? BACKSLASH : '/'
              const head =
                action === 'copy-path'
                  ? file
                  : vscode.workspace.asRelativePath(vscode.Uri.file(file), false)
              const inside = [...members, path].filter(item => item !== '')
              await vscode.env.clipboard.writeText(
                [head, ...inside]
                  .map(item => item.replaceAll('/', separator))
                  .join(`!${separator}`),
              )
              return false
            }
            case 'new-file':
            case 'new-folder': {
              const folder = kind === 'file' ? parentOf(path) : path
              const leaf = await askName(
                localizer.text(
                  action === 'new-file' ? 'vscode.archive.newFile' : 'vscode.archive.newFolder',
                ),
              )
              if (leaf === undefined || leaf === '') return false
              const target = join(folder, leaf)
              if (action === 'new-folder') {
                await containers.edit(container, { folders: [target] })
                return true
              }
              await containers.write(container, target, new Uint8Array())
              await openMember(target)
              return true
            }
            case 'rename': {
              const name = leafOf(path)
              const leaf = await askName(localizer.text('vscode.archive.rename', { name }), name)
              if (leaf === undefined || leaf === '' || leaf === name) return false
              await containers.edit(container, {
                rename: [{ from: path, to: join(parentOf(path), leaf) }],
              })
              return true
            }
            case 'delete': {
              const confirm = localizer.text('vscode.archive.delete')
              const answer = await vscode.window.showWarningMessage(
                localizer.text('vscode.archive.deleteConfirm', { name: leafOf(path) }),
                { modal: true },
                confirm,
              )
              if (answer !== confirm) return false
              await containers.edit(container, { remove: [path] })
              return true
            }
            case 'extract': {
              // Beside the archive file by default: that is where a person looks for what came out.
              const beside = vscode.Uri.file(dirname(file))
              if (kind === 'file') {
                const target = await vscode.window.showSaveDialog({
                  defaultUri: vscode.Uri.joinPath(beside, leafOf(path)),
                })
                if (target === undefined) return false
                await vscode.workspace.fs.writeFile(target, await containers.read(container, path))
                return false
              }
              const picked = await vscode.window.showOpenDialog({
                defaultUri: beside,
                canSelectFiles: false,
                canSelectFolders: true,
                openLabel: localizer.text('vscode.archive.extractHere'),
              })
              const folder = picked?.[0]
              if (folder === undefined) return false
              const members = (await containers.walk(container, path, 1_000_000)).filter(
                item => item.kind === 'file',
              )
              const prefix = path === '' ? '' : `${path}/`
              const written = await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: localizer.text('vscode.archive.extracting', { name: basename(file) }),
                  cancellable: true,
                },
                async (progress, token) => {
                  const controller = new AbortController()
                  token.onCancellationRequested(() => controller.abort())
                  let count = 0
                  for (const member of members) {
                    if (controller.signal.aborted) break
                    const relativePath = member.path.startsWith(prefix)
                      ? member.path.slice(prefix.length)
                      : member.path
                    const bytes = await containers.read(container, member.path, controller.signal)
                    await vscode.workspace.fs.writeFile(
                      vscode.Uri.joinPath(folder, ...relativePath.split('/')),
                      bytes,
                    )
                    count += 1
                    progress.report({
                      message: `${count} / ${members.length}`,
                      increment: 100 / members.length,
                    })
                  }
                  return count
                },
              )
              void vscode.window.showInformationMessage(
                `Modkit: ${localizer.text('vscode.archive.extracted', {
                  count: written,
                  total: members.length,
                  folder: folder.fsPath,
                })}`,
              )
              return false
            }
            case 'add-files': {
              const picked = await vscode.window.showOpenDialog({
                canSelectMany: true,
                openLabel: localizer.text('vscode.archive.addHere'),
              })
              if (picked === undefined || picked.length === 0) return false
              const into = kind === 'file' ? parentOf(path) : path
              for (const source of picked) {
                await containers.write(
                  container,
                  join(into, basename(source.path)),
                  await vscode.workspace.fs.readFile(source),
                )
              }
              return true
            }
          }
        } catch (error) {
          void vscode.window.showErrorMessage(
            `Modkit: ${error instanceof Error ? error.message : String(error)}`,
          )
          return false
        }
      },
      openInEditor: async (path, preview) => {
        await openGalleryAware(subjectUriOf(path), preview)
      },
      // A viewer preference from a page, kept for the pages after it (plan 7.18).
      preference: async (key, value) => {
        const next = withUiPreference(context.globalState.get(UI_PREFERENCES_KEY), key, value)
        if (next === undefined) throw new TypeError(`a page cannot keep the preference «${key}»`)
        await context.globalState.update(UI_PREFERENCES_KEY, next)
      },
      // A card's model: found in its subject's mod chain, opened as a subject of its own (plan 5.5).
      openModel: async (subject, model) => {
        const ref = await locateInModChain(subjectUriOf(subject), model)
        if (ref === undefined) {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.card.modelNotFound', { model })}`,
          )
          return
        }
        openResource(
          ref.startsWith('modkit-source:') ? vscode.Uri.parse(ref) : vscode.Uri.file(ref),
        )
      },
      // A card's source opens where Resources opens a declaration: the file, at its line.
      openSource: async (address, line, column, range) => {
        const uri = linkTarget(address)
        // the page names files only; a link of any other kind is not this request's to follow
        if (uri === undefined || !SOURCE_SCHEMES.has(uri.scheme)) {
          log(`[card] not a file this window opens: ${address}`)
          return
        }
        if (range !== undefined) {
          // a declaration by its offsets (a template node, plan 3.33): selected, as text
          const document = await vscode.workspace.openTextDocument(uri)
          // in the group that already has the file as text, else beside
          const group = vscode.window.tabGroups.all.find(item =>
            item.tabs.some(
              tab =>
                tab.input instanceof vscode.TabInputText &&
                tab.input.uri.toString() === uri.toString(),
            ),
          )
          await vscode.window.showTextDocument(document, {
            selection: new vscode.Range(
              document.positionAt(range.start),
              document.positionAt(range.end ?? range.start),
            ),
            viewColumn: group?.viewColumn ?? vscode.ViewColumn.Beside,
            preview: false,
          })
          return
        }
        await openResourceFile(
          uri,
          line === undefined
            ? undefined
            : ({ line, column: column ?? 0 } as TreeNodeFacts['range']),
        )
      },
      thumbnail: galleryThumbnailOf,
      ...(explorer === undefined ? {} : { explorer: explorer.backend }),
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
          workspaceDocumentOrigins: [],
          workspaceLanguageIds: languageIds,
          maxDocuments: Math.min(request.maxDocuments ?? LANGUAGE_MAX_DOCUMENTS, LANGUAGE_MAX_DOCUMENTS),
          signal: controller.signal,
        })
        return { documents: snapshot.documents, isComplete: snapshot.isComplete }
      },
      exportFiles: (files, beside) => exportViewerFiles(files, beside),
      configuration,
      mapPreviewResourcePlanResolver,
      gameLocales: configuredGameLocales,
      // Downloaded assets and a game's shipped textures sit in the subject's dependency layers.
      contentSources: () => requireContentSources().catch(() => undefined),
      localizer,
      // The window's one registry, so a page opening a member reaches the archive the Explorer
      // already has open rather than a second copy of it.
      containers,
      readContentSource,
      viewerOperations: viewerSurfaceOperations,
      timing,
      ...(lifecycle === undefined
        ? {}
        : {
            onDocumentDirty: lifecycle.onDirty,
            onDocumentSaveRequested: lifecycle.onSaveRequested,
            ...(lifecycle.onRevertRequested === undefined
              ? {}
              : { onDocumentRevertRequested: lifecycle.onRevertRequested }),
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
      galleryExtensions: [...galleryExtensions].sort(),
      ...(explorer === undefined ? {} : { explorer: { label: explorer.label } }),
      preferences: context.globalState.get(UI_PREFERENCES_KEY) ?? {},
    })
    /*
     * The page is now fetching and evaluating its bundle; the codec can come up in that time
     * instead of after it. `warm` opens the same subject under the same grant, drops the session
     * and leaves the realm warm for the page's own open a moment later.
     */
    if (openPath !== undefined) served.warm(openPath)
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

  /**
   * A folder that stands for one subject (a mod package, a map folder) opens at the document the
   * codec names as its anchor; a file opens as itself. Undefined: the folder has no anchor.
   */
  const anchoredUri = async (target: vscode.Uri): Promise<vscode.Uri | undefined> => {
    if (((await vscode.workspace.fs.stat(target)).type & vscode.FileType.Directory) === 0) return target
    const name = basename(target.path)
    const anchors = anchorDocumentIndex(host.services.inventory).get(
      name.slice(name.lastIndexOf('.') + 1).toLowerCase(),
    )
    const anchor = (await vscode.workspace.fs.readDirectory(target)).find(
      ([entry, type]) => type === vscode.FileType.File && anchors?.has(entry.toLowerCase()),
    )
    return anchor === undefined ? undefined : vscode.Uri.joinPath(target, anchor[0])
  }

  /** Write `bytes` at `destination`, or beside it as `name (2).ext` …, never over a file. */
  const writeFresh = async (destination: vscode.Uri, bytes: Uint8Array): Promise<vscode.Uri> => {
    const directory = vscode.Uri.joinPath(destination, '..')
    const name = basename(destination.path)
    const dot = name.lastIndexOf('.')
    let target = destination
    for (let copy = 2; ; copy += 1) {
      const exists = await vscode.workspace.fs.stat(target).then(
        () => true,
        () => false,
      )
      if (!exists) break
      target = vscode.Uri.joinPath(
        directory,
        dot <= 0 ? `${name} (${copy})` : `${name.slice(0, dot)} (${copy})${name.slice(dot)}`,
      )
    }
    await vscode.workspace.fs.writeFile(target, new Uint8Array(bytes))
    return target
  }

  /** What a conversion run did, in the log line by line and in one notification. */
  const reportConversion = async (
    heading: string,
    outcomes: readonly BatchOutcome[],
    total: number,
  ): Promise<void> => {
    const converted = outcomes.filter(item => item.state === 'converted').length
    const skipped = outcomes.filter(item => item.state === 'skipped').length
    const failed = outcomes.filter(item => item.state === 'failed').length
    log(`[batch] ${heading}`)
    for (const item of outcomes) {
      log(
        item.state === 'converted'
          ? `[batch] converted ${item.file} → ${item.output}`
          : `[batch] ${item.state} ${item.file}: ${item.reason}`,
      )
    }
    const summary = localizer.text('vscode.batch.summary', { converted, skipped, failed, total })
    const show = localizer.text('vscode.batch.showReport')
    const choice = await (failed > 0
      ? vscode.window.showWarningMessage(`Modkit: ${summary}`, show)
      : vscode.window.showInformationMessage(`Modkit: ${summary}`, show))
    if (choice === show) output.show(true)
  }

  /*
   * A baseline copy of a locale table (plan 7.36, MK2's «review»): a file the reader picks, opened
   * as a subject of its own, its table read in one locale — or in its own base when it names none.
   */
  const pickTableBaseline = async (
    variant: string,
  ): Promise<{ label: string; values: [string, string][] } | undefined> => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: localizer.text('vscode.table.baselineOpen'),
      title: localizer.text('vscode.table.baselineTitle', { locale: variant }),
    })
    const path = picked?.[0]?.fsPath
    if (path === undefined) return undefined
    const subject = await commandOpener(path, new AbortController().signal)
    try {
      if (subject.snapshot.state !== 'opened' || subject.session === undefined) {
        throw new Error(localizer.text('vscode.table.baselineRefused', { file: basename(path) }))
      }
      const lease = await subject.session.dataSource('common.view/table-data-source', 1)
      try {
        const table = lease.value as unknown as TableDataSource
        const info = (await table.shape()).columnInfo ?? []
        const key = Math.max(
          0,
          info.findIndex(column => column.role === 'key'),
        )
        const locales = info.flatMap((column, index) =>
          column.role === 'variant' ? [{ ...column, index }] : [],
        )
        const locale =
          locales.find(column => column.variant === variant) ??
          locales.find(column => column.base === true) ??
          locales[0]
        if (locale === undefined) {
          throw new Error(localizer.text('vscode.table.baselineRefused', { file: basename(path) }))
        }
        const values: [string, string][] = []
        for (let from = 0; ; from += 1_000) {
          const page = await table.rows({ kind: 'range', from, count: 1_000 })
          for (const row of page.items) {
            values.push([row.cells[key] ?? '', row.cells[locale.index] ?? ''])
          }
          if (page.nextCursor === undefined || page.items.length === 0) break
        }
        return { label: basename(path), values }
      } finally {
        await lease.release()
      }
    } finally {
      await subject.dispose()
    }
  }

  /** A map world exported as UVW (П24): where it went and what UVW left out, as a conversion. */
  const reportWorldExport = (receipt: WorldUvwReceipt, wroteTo: unknown): void => {
    log(`[world-export] ${typeof wroteTo === 'string' ? wroteTo : '(not written)'}`)
    log(`[world-export] artifact digest ${receipt.artifactDigest}`)
    log(`[world-export] excluded facets: ${receipt.excludedFacetIds.join(', ') || '—'}`)
    log(`[world-export] omitted objects: ${String(receipt.omittedObjects)}`)
    for (const field of receipt.lostFields) {
      log(`[world-export] lost field ${field.path} × ${String(field.count)}`)
    }
    const show = localizer.text('vscode.batch.showReport')
    const summary = localizer.text('vscode.world.exported', {
      file: typeof wroteTo === 'string' ? basename(wroteTo) : '—',
      facets: receipt.excludedFacetIds.length,
      objects: receipt.omittedObjects,
      fields: receipt.lostFields.length,
    })
    void vscode.window.showInformationMessage(`Modkit: ${summary}`, show).then(choice => {
      if (choice === show) output.show(true)
    })
  }

  /** The UVW codec's way back to a game's map (WT10), run by `subject.convert`. */
  const MAP_EXPORT_NATIVE = 'map.export-native'
  /** A world saved as a game's map: where it went, and what the map does not carry (WT10). */
  const reportNativeMapExport = (
    diagnostics: CommandResult['diagnostics'],
    wroteTo: unknown,
  ): void => {
    const file = typeof wroteTo === 'string' ? basename(wroteTo) : '—'
    log(`[world-export] ${typeof wroteTo === 'string' ? wroteTo : '(not written)'}`)
    for (const item of diagnostics) log(`[world-export] ${item.code}: ${item.message}`)
    const show = localizer.text('vscode.batch.showReport')
    const summary =
      diagnostics.length === 0
        ? localizer.text('vscode.world.savedAsMap', { file })
        : localizer.text('vscode.world.savedAsMapLosses', { file, count: diagnostics.length })
    void vscode.window
      .showInformationMessage(`Modkit: ${summary}`, ...(diagnostics.length === 0 ? [] : [show]))
      .then(choice => {
        if (choice === show) output.show(true)
      })
  }

  /** A file of a conversion run opened as a subject, or the reason it could not be. */
  const openForConversion = async (path: string, signal: AbortSignal): Promise<BatchSubject> => {
    const subject = await commandOpener(path, signal)
    const dispose = () => subject.dispose()
    if (subject.snapshot.state !== 'opened' || subject.session === undefined) {
      return { reason: localizer.text('vscode.batch.notOpened'), dispose }
    }
    return {
      descriptor: await subject.session.descriptor(),
      operations: subject.session.operations(),
      dispose,
    }
  }

  /**
   * Convert the pictures a menu names through their codec's own conversion (plan 7.11, MK2's
   * "DDS → PNG" and "DXT5 → DXT1"): the first file's conversions are offered, and each file writes
   * its result beside itself as `<name>.<variant>.<extension>`, never over its source.
   */
  const convertFiles = async (picked: readonly vscode.Uri[]): Promise<void> => {
    const files = picked.filter(uri => uri.scheme === 'file')
    const first = files[0]
    if (first === undefined) {
      void vscode.window.showWarningMessage(`Modkit: ${localizer.text('vscode.batch.filesOnDisk')}`)
      return
    }
    for (const file of files) granted.add(file.fsPath)
    const offered = await openForConversion(first.fsPath, new AbortController().signal)
    let conversions: ReturnType<typeof exportConversions> = []
    try {
      if (offered.descriptor !== undefined) conversions = exportConversions(offered.descriptor)
    } finally {
      await offered.dispose().catch(() => undefined)
    }
    if (conversions.length === 0) {
      void vscode.window.showWarningMessage(
        `Modkit: ${localizer.text('vscode.batch.noConversions', { name: basename(first.path) })}`,
      )
      return
    }
    const choice = await vscode.window.showQuickPick(
      conversions.map(conversion => ({
        label: conversion.form.label,
        description: conversion.form.writes.extension,
        conversion,
      })),
      { title: localizer.text('vscode.batch.convertFiles', { count: files.length }) },
    )
    if (choice === undefined) return
    const { form } = choice.conversion
    const outcomes = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${localizer.text('vscode.batch.convertFiles', { count: files.length })} ${form.label}`,
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController()
        const subscription = token.onCancellationRequested(() => controller.abort())
        try {
          return await runBatchConversion({
            files: files.map(file => file.fsPath),
            extension: form.writes.extension,
            formId: form.id,
            open: openForConversion,
            conversions: descriptor => exportConversions(descriptor),
            outputPath: (file, conversion) => {
              const name = basename(file)
              const dot = name.lastIndexOf('.')
              const stem = dot <= 0 ? name : name.slice(0, dot)
              return join(
                dirname(file),
                convertedFileName(stem, conversion.form.id ?? '', conversion.form.writes.extension),
              )
            },
            write: async (path, bytes) =>
              vscode.workspace.asRelativePath(
                await writeFresh(vscode.Uri.file(path), bytes),
                false,
              ),
            signal: controller.signal,
          })
        } finally {
          subscription.dispose()
        }
      },
    )
    await reportConversion(`${files.length} file(s) → ${form.label}`, outcomes, files.length)
  }

  /**
   * Convert every file of a folder through its codec's own conversion to one extension (plan 7.12):
   * the folder, the extension and where the results go are asked; the run shows progress, stops on
   * Cancel between files and ends with a report of what was converted, skipped and why.
   */
  const convertFolder = async (given: vscode.Uri | undefined): Promise<void> => {
    const folder =
      given ??
      (
        await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: localizer.text('vscode.batch.pickFolder'),
        })
      )?.[0]
    if (folder === undefined) return
    if (folder.scheme !== 'file') {
      void vscode.window.showWarningMessage(`Modkit: ${localizer.text('vscode.batch.diskOnly')}`)
      return
    }
    const extension = (
      await vscode.window.showInputBox({
        title: localizer.text('vscode.batch.title'),
        prompt: localizer.text('vscode.batch.targetPrompt'),
        value: 'png',
        validateInput: value =>
          /^\.?[a-z0-9]{1,12}$/iu.test(value.trim())
            ? undefined
            : localizer.text('vscode.batch.targetInvalid'),
      })
    )
      ?.trim()
      .replace(/^\./u, '')
    if (extension === undefined) return
    const into = (
      await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: folder,
        openLabel: localizer.text('vscode.batch.pickOutput'),
      })
    )?.[0]
    if (into === undefined) return
    // every file below the folder, the results' own folder left out when it lies inside
    const files: string[] = []
    const walk = async (directory: vscode.Uri, prefix: string): Promise<void> => {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
        if (files.length >= BATCH_CONVERT_MAX_FILES) return
        const child = vscode.Uri.joinPath(directory, name)
        if ((type & vscode.FileType.Directory) !== 0) {
          if (child.toString() !== into.toString()) await walk(child, `${prefix}${name}/`)
        } else if ((type & vscode.FileType.File) !== 0) files.push(`${prefix}${name}`)
      }
    }
    await walk(folder, '')
    granted.add(folder.fsPath)
    const title = localizer.text('vscode.batch.running', { count: files.length, extension })
    const outcomes = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      async (progress, token) => {
        const controller = new AbortController()
        const subscription = token.onCancellationRequested(() => controller.abort())
        try {
          return await runBatchConversion({
            files,
            extension,
            open: (file, signal) =>
              openForConversion(join(folder.fsPath, ...file.split('/')), signal),
            conversions: descriptor => exportConversions(descriptor),
            write: async (relative, bytes) => {
              const parts = relative.split('/')
              const name = parts.pop() ?? relative
              const directory = vscode.Uri.joinPath(into, ...parts)
              await vscode.workspace.fs.createDirectory(directory)
              const written = await writeFresh(vscode.Uri.joinPath(directory, name), bytes)
              return vscode.workspace.asRelativePath(written, false)
            },
            progress: (done, file) =>
              progress.report({
                increment: files.length === 0 ? 0 : 100 / files.length,
                message: `${done + 1}/${files.length} ${file}`,
              }),
            signal: controller.signal,
          })
        } finally {
          subscription.dispose()
        }
      },
    )
    await reportConversion(
      `${folder.fsPath} → ${into.fsPath} (.${extension})`,
      outcomes,
      files.length,
    )
  }

  /**
   * A resource a menu names: a file as itself, a package folder (`X.SC2Map`) at the document its
   * codec declares to stand for it — a folder is not something a VS Code editor opens.
   */
  const openNamedResource = (uri: vscode.Uri): void => {
    void anchoredUri(uri)
      .then(anchored => {
        if (anchored !== undefined) openResource(anchored)
        else
          void vscode.window.showWarningMessage(
            localizer.text('vscode.map.noAnchor', { name: basename(uri.path) }),
          )
      })
      .catch(error =>
        vscode.window.showErrorMessage(
          `Modkit: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
  }

  navigateWorkspaceResource = async (root, subjectId, range, stage) => {
    /*
     * A resource that *is* a file opens as that file. Routing it through the package's own custom
     * editor made every click open the package instead — which a CASC package cannot even preview,
     * because extracting the package as if it were one of its own entries does not exist.
     */
    const entry = namespaceEntryPathOf(subjectId)
    if (entry !== undefined) {
      // A resource that knows where it is declared opens *at* that declaration, in the file
      // of the layer that declared it — which with a chain on screen is often not the active
      // package.
      await openResourceFile(memberUriOf(namespaceEntryRootOf(subjectId) ?? root, entry), range)
      return true
    }
    /*
     * A place by its own address — a package the chain loads implicitly (Liberty in the game's
     * storage), a declaring file of another layer — opens there: a file at its declaration, a
     * package at the document that stands for it.
     */
    const place =
      subjectId.startsWith('content-source:') || subjectId.startsWith('file:')
        ? subjectTarget(subjectId)
        : isAbsolute(subjectId)
          ? subjectId
          : undefined
    if (place !== undefined) {
      const uri =
        typeof place === 'string'
          ? vscode.Uri.file(place)
          : vscode.Uri.from({
              scheme: 'modkit-source',
              authority: 'battlenet',
              path: `/${place.sourceId}/${place.path}`,
            })
      const anchored = await anchoredUri(uri)
      if (anchored === undefined) {
        throw new Error(localizer.text('vscode.map.noAnchor', { name: basename(uri.path) }))
      }
      if (anchored === uri) await openResourceFile(uri, range)
      else await vscode.commands.executeCommand('vscode.openWith', anchored, CUSTOM_EDITOR_TYPE)
      return true
    }
    /*
     * An entity opens inside its package. A folder package has no editor of its own — opening it
     * as one said «… is not a file» — so it opens through the document that stands for it, as a
     * click on that document does; a packed package opens as itself.
     */
    const packageUri = subjectUriOf(root)
    const uri = (await anchoredUri(packageUri).catch(() => undefined)) ?? packageUri
    // The package the reader is looking at stays where it is; beside it went to a new group (v84).
    const active = vscode.window.tabGroups.activeTabGroup
    const looking =
      active.activeTab?.input instanceof vscode.TabInputCustom &&
      active.activeTab.input.uri.toString() === uri.toString()
    await vscode.commands.executeCommand('vscode.openWith', uri, CUSTOM_EDITOR_TYPE, {
      viewColumn: looking ? active.viewColumn : vscode.ViewColumn.Beside,
      preserveFocus: false,
    })
    const opened = new Set([subjectKey(root), subjectKey(subjectPathOf(uri))])
    const served = [...liveSubjects].find(([, path]) => path !== undefined && opened.has(path))?.[0]
    if (served === undefined) {
      throw new Error(`the resource workspace subject did not open: ${basename(root)}`)
    }
    served.navigate(subjectId, stage)
    return true
  }

  // ---------------------------------------------------------------- Modkit Explorer
  /*
   * A folder of any VS Code file system in the webview file explorer.
   *
   * An archive's editor lists the container's members; this is the same page listing a folder —
   * `file:`, a `modkit-source:` content source, a folder inside a mounted `modkit-container:` —
   * through `vscode.workspace.fs`, the one API all of those schemes answer. The page names only ids
   * this panel handed out and paths below its one root.
   */
  const openInTab = async (uri: vscode.Uri, preview = false): Promise<void> => {
    const target = describeOpenTarget(uri)
    if (target.state !== 'refused') grantFor(target)
    // VS Code's own choice of editor: an associated format opens in Modkit, text in the text editor.
    await openGalleryAware(uri, preview)
  }
  const explorerBackend = (root: vscode.Uri): NonNullable<VsCodeServeOptions['explorer']> => {
    const listed = new Map<string, vscode.Uri>()
    const folderOf = (path: string): { readonly uri: vscode.Uri; readonly path: string } => {
      const parts = path.split('/').filter(part => part !== '')
      if (parts.some(part => part === '.' || part === '..' || part.includes(BACKSLASH))) {
        throw new Error('that path is not inside this explorer')
      }
      return {
        uri: parts.length === 0 ? root : vscode.Uri.joinPath(root, ...parts),
        path: parts.join('/'),
      }
    }
    return {
      async children(path) {
        const folder = folderOf(path)
        const children = await vscode.workspace.fs.readDirectory(folder.uri)
        return Promise.all(
          children.map(async ([name, type]) => {
            const uri = vscode.Uri.joinPath(folder.uri, name)
            const directory = (type & vscode.FileType.Directory) !== 0
            const stat = directory
              ? undefined
              : await Promise.resolve(vscode.workspace.fs.stat(uri)).catch(() => undefined)
            const id = uri.toString()
            listed.set(id, uri)
            return {
              id,
              path: folder.path === '' ? name : `${folder.path}/${name}`,
              name,
              kind: directory ? ('directory' as const) : ('file' as const),
              ...(stat === undefined ? {} : { size: stat.size, modifiedAt: stat.mtime }),
            }
          }),
        )
      },
      async open(id, preview) {
        const uri = listed.get(id)
        if (uri === undefined) throw new Error('that entry is not listed in this explorer')
        await openInTab(uri, preview)
      },
      async thumbnail(id, maxEdge) {
        const uri = listed.get(id)
        if (uri === undefined) return undefined
        const target = describeOpenTarget(uri)
        if (target.state === 'refused') return undefined
        grantFor(target)
        return galleryThumbnailOf(target.path, maxEdge)
      },
    }
  }
  /**
   * What an "Open in Modkit Explorer" was invoked on: a folder of the native Explorer, a content
   * source root or a game installation of the Sources view (its logical container, not the
   * physical directory), or nothing — then a folder is asked for.
   */
  const explorerTargetOf = async (argument: unknown): Promise<vscode.Uri | undefined> => {
    if (argument instanceof vscode.Uri) return argument
    const row =
      typeof argument === 'object' && argument !== null
        ? (argument as {
            readonly sourceId?: unknown
            readonly uri?: unknown
            readonly normalizedPath?: unknown
          })
        : undefined
    if (typeof row?.sourceId === 'string') {
      return vscode.Uri.from({ scheme: 'modkit-source', authority: 'battlenet', path: `/${row.sourceId}` })
    }
    const installation =
      typeof row?.uri === 'string'
        ? row.uri
        : typeof row?.normalizedPath === 'string'
          ? row.normalizedPath
          : undefined
    if (installation !== undefined) {
      const absolute = resolve(installation)
      granted.add(absolute)
      return vscode.Uri.from({ scheme: CONTAINER_SCHEME, path: containerUriPath(absolute) })
    }
    return (
      await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: localizer.text('vscode.explorer.pick'),
      })
    )?.[0]
  }
  const openExplorer = async (argument: unknown): Promise<void> => {
    const uri = await explorerTargetOf(argument)
    if (uri === undefined) return
    const name = basename(uri.path) || uri.toString()
    // The folder the user chose is the grant: its files open, list and draw like workspace files.
    if (uri.scheme === 'file') granted.add(uri.fsPath)
    else {
      const target = describeOpenTarget(uri)
      if (target.state !== 'refused') grantFor(target)
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      // A file is shown by its own editor; an archive's editor is this same explorer.
      if ((stat.type & vscode.FileType.Directory) === 0) {
        await openInTab(uri)
        return
      }
    } catch (error) {
      void vscode.window.showWarningMessage(
        localizer.text('vscode.explorer.cannotOpen', {
          name,
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
      return
    }
    const panel = vscode.window.createWebviewPanel('modkit.explorer', name, vscode.ViewColumn.Active, {
      ...webviewOptions(),
      retainContextWhenHidden: true,
    })
    const served = attach(
      panel.webview,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { label: name, backend: explorerBackend(uri) },
    )
    panel.onDidDispose(() => {
      live.delete(served)
      liveSubjects.delete(served)
      void served.close('the Modkit Explorer was closed')
    })
  }
  context.subscriptions.push(vscode.commands.registerCommand('modkit.openExplorer', openExplorer))

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
  /** The map of a package an export chose, whose name its output takes (П24). */
  let chosenMapName: string | undefined
  const commandOpenerOptions: Parameters<typeof createVsCodeCommandOpener>[0] = {
    readContentSource,
    services: host.services,
    roots,
    containers,
    subjectCatalog,
    onRead: event => {
      if (archiveAcceptanceIoActive) archiveAcceptanceReads.push(event)
    },
    onStream: event => {
      if (archiveAcceptanceIoActive) archiveAcceptanceStreams.push(event)
    },
  }
  const commandOpener = commandSubjectsFrom(createVsCodeCommandOpener(commandOpenerOptions))
  /** The same, with a map's world, which `subject.convert` makes UVW of (П24). */
  const worldOpener = commandSubjectsFrom(
    createVsCodeCommandOpener({
      ...commandOpenerOptions,
      mapWorld: {
        resourcePlanResolver: mapPreviewResourcePlanResolver,
        locales: configuredGameLocales,
        contentSources: () => requireContentSources().catch(() => undefined),
        choose: async candidates => {
          const picked = await vscode.window.showQuickPick(
            candidates.map(candidate => ({
              label: candidate.displayName,
              ...(candidate.sourcePath === undefined ? {} : { description: candidate.sourcePath }),
              candidateId: candidate.candidateId,
            })),
            { title: localizer.text('vscode.world.chooseMap') },
          )
          // the file the world is saved to takes the map's name, not the package's
          chosenMapName = picked?.label
          return picked?.candidateId
        },
        report: diagnostics => {
          for (const item of diagnostics) log(`[world-export] ${item.code}: ${item.message}`)
        },
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

  /**
   * Operations extensions published for a viewer surface (`ServiceOperationDescriptor.surface`).
   *
   * Discovery and invocation stay here, where the grant and the runtime realm are: the page gets
   * inert descriptors and sends back an operation id, its input and the pixels. That is how an
   * extension adds a section to a viewer without shipping code into the webview, which the page's
   * content-security policy forbids outright.
   */
  const viewerSurfaceOperations = {
    async list(surface: string): Promise<readonly ViewerSurfaceOperation[]> {
      const catalog = await discoverServiceOperations({
        services: serviceOperationServices,
        alternateTargets: [host.services.target],
        grant: serviceOperationGrant,
        budgets: SERVICE_OPERATION_BUDGET,
        offset: 0,
        limit: SERVICE_OPERATION_CATALOG_MAX_PAGE_ITEMS,
        activate: true,
      })
      return catalog.entries.flatMap(entry => {
        const declared = entry.descriptor?.surface
        if (entry.descriptor === undefined || declared?.target !== surface) return []
        return [
          {
            id: entry.descriptor.id,
            title: entry.descriptor.title,
            summary: entry.descriptor.summary,
            sectionId: declared.sectionId,
            sectionTitle: declared.title,
            ...(declared.icon === undefined ? {} : { icon: declared.icon }),
            ...(declared.forms === undefined ? {} : { inputSchema: declared.forms }),
            ...(declared.copyPresetId === undefined ? {} : { copyPresetId: declared.copyPresetId }),
          },
        ]
      })
    },
    async run(
      operationId: string,
      input: unknown,
      image: { readonly width: number; readonly height: number; readonly rgba: Uint8Array },
    ): Promise<ViewerSurfaceOperationResult> {
      const result = await invokeServiceOperation({
        services: serviceOperationServices,
        alternateTargets: [host.services.target],
        operationId,
        input: {
          ...(typeof input === 'object' && input !== null && !Array.isArray(input)
            ? (input as Record<string, never>)
            : {}),
          image: {
            width: image.width,
            height: image.height,
            pixels: Buffer.from(image.rgba).toString('base64'),
          },
        },
        grant: serviceOperationGrant,
        budgets: SERVICE_OPERATION_BUDGET,
        allowedEffects: ['none'],
      })
      if (result.state !== 'invoked') {
        const why = result.diagnostics.at(-1)?.message ?? result.state
        return { state: 'refused', reason: `${operationId}: ${why}` }
      }
      if (result.result.state !== 'completed') {
        return {
          state: 'refused',
          reason: `${result.result.code}: ${result.result.message}`,
        }
      }
      const value = result.result.value as {
        image?: { width?: unknown; height?: unknown; pixels?: unknown }
      }
      const width = Number(value.image?.width)
      const height = Number(value.image?.height)
      const pixels = value.image?.pixels
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        typeof pixels !== 'string'
      ) {
        return { state: 'refused', reason: `${operationId} answered no image` }
      }
      return { state: 'ok', image: { width, height, rgba: pixels } }
    },
  }

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
  const runSharedCommand = async (
    request: {
      readonly command: string
      readonly subject?: string
      readonly entry?: string
      readonly target?: string
      /** The operation a conversion runs (`map.export-native`), not the first the subject offers. */
      readonly operation?: string
      /** The installation a converted map is written for: its catalog answers the encoder (WT10). */
      readonly targetContext?: string
      readonly operationId?: string
      readonly operationInput?: CommandInput[string]
    },
    opener = commandOpener,
  ): Promise<CommandResult> => {
    // a map chosen in an earlier run names nothing of this one
    chosenMapName = undefined
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
              ...(request.operation === undefined ? {} : { operation: request.operation }),
              ...(request.targetContext === undefined
                ? {}
                : { targetContext: request.targetContext }),
              ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
              ...(request.operationInput === undefined
                ? {}
                : { operationInput: request.operationInput }),
            },
            {
              openSubject: opener,
              // a map's world becomes one UVW document (П24), the CLI's materializer and limits
              worldToUvw: async (source, signal) => {
                const { materializeWorldToUvw } = await import('@modkit/uv/world')
                return materializeWorldToUvw(source, {
                  ...WORLD_UVW_LIMITS,
                  ...(signal === undefined ? {} : { signal }),
                })
              },
              // what a command produces (a converted model, a world, an extracted member) is saved
              // where the person says; without a place the run ends as cancelled
              writeOutput: async (name, bytes) => {
                const leaf = commandOutputLeaf(
                  request.command,
                  request.subject,
                  name,
                  chosenMapName,
                )
                const near =
                  request.subject === undefined
                    ? undefined
                    : (parseContainerUriText(request.subject)?.container ?? request.subject)
                const folder =
                  near !== undefined && isAbsolute(near) ? dirname(near) : workspaceFolders()[0]
                const target = await vscode.window.showSaveDialog({
                  ...(folder === undefined
                    ? {}
                    : { defaultUri: vscode.Uri.file(join(folder, leaf)) }),
                  saveLabel: localizer.text('vscode.command.saveOutput'),
                })
                if (target === undefined) {
                  controller.abort()
                  throw new DOMException('the output was not saved', 'AbortError')
                }
                await vscode.workspace.fs.writeFile(target, bytes)
                return target.fsPath
              },
              /*
               * A map encoder's catalog questions are answered from the installation it writes for
               * (question 67): the sources composed for that installation alone, as the CLI's
               * --target-context composes them, and disposed with its mod context.
               */
              openTargetCatalog: async target => {
                const sources = await resolveContentSources({
                  extensionRoots: extensionRootPaths(),
                  storage: join(context.globalStorageUri.fsPath, 'content-sources'),
                  indexCacheDirectory,
                  moduleOptions: () => ({ installationDirectory: target }),
                })
                if (sources?.openModContext === undefined) {
                  await sources?.dispose()
                  throw new TypeError(
                    `no extension opens the installation ${target} for its catalog`,
                  )
                }
                const modContext = await sources
                  .openModContext({ schemaVersion: 1, target })
                  .catch(async (error: unknown) => {
                    await sources.dispose()
                    throw error
                  })
                const dispose = async (): Promise<void> => {
                  await modContext.dispose()
                  await sources.dispose()
                }
                const entities = modContextCatalogEntities(modContext)
                if (entities === undefined) {
                  await dispose()
                  throw new TypeError(`the mod context of ${target} answers no catalog questions`)
                }
                return { entities, dispose }
              },
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
      // a world exported as UVW reports, as a conversion does, what UVW left out (П24)
      const receipt = worldUvwReceiptOf(result.data)
      if (receipt !== undefined) {
        reportWorldExport(receipt, (result.data as { readonly wroteTo?: unknown }).wroteTo)
        return result
      }
      // a world saved as a game's map (WT10): what the map does not carry is its diagnostics
      const converted = result.data as { readonly via?: unknown; readonly wroteTo?: unknown } | null
      if (converted?.via === MAP_EXPORT_NATIVE) {
        reportNativeMapExport(result.diagnostics, converted.wroteTo)
        return result
      }
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
  /** The subject a command runs on: the resource a menu passed, else the Modkit tab on show. */
  const commandSubjectOf = (argument: unknown): string | undefined =>
    argument instanceof vscode.Uri
      ? argument.scheme === 'file'
        ? argument.fsPath
        : argument.toString()
      : activeSubject
  const containerFrom = (argument: unknown): string | undefined => {
    if (argument instanceof vscode.Uri) {
      return argument.scheme === CONTAINER_SCHEME
        ? parseContainerUriPath(argument.path)?.container
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
    if (argument instanceof vscode.Uri) {
      return argument.scheme === CONTAINER_SCHEME
        ? parseContainerUriPath(argument.path)?.entry
        : undefined
    }
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
    await context.globalState.update(SELECTED_SOURCES_KEY, next)
    resetContentSources()
    hostView.refresh()
    sourcesView.refresh()
    for (const served of live) {
      served.publishRoots()
      served.notice(localizer.text('vscode.shell.selectedSourcesChanged'))
    }
  }

  if (selectedSources.some(source => source.version === undefined)) {
    let enriched = selectedSources
    for (const source of selectedSources.filter(item => item.version === undefined)) {
      try {
        const discovery = await discoverGameInstallations({
          services: host.services,
          gameId: source.gameId,
          configuredPaths: [source.installPath],
          maxCandidates: 4,
          grant: {
            id: `vscode-game-installation-refresh-${nonce()}`,
            classes:
              process.platform === 'win32'
                ? ['filesystem-read', 'process-launch']
                : ['filesystem-read'],
          },
          budgets: GAME_DISCOVERY_BUDGET,
        })
        const installation =
          discovery.state === 'discovered'
            ? discovery.result.installations.find(
                item => item.normalizedPath === source.normalizedPath,
              )
            : undefined
        // a provider that names no version leaves nothing to add: no new selection to store
        if (installation?.version === undefined) continue
        enriched = withSelectedContentSource(enriched, {
          ...source,
          ...(installation.version === undefined ? {} : { version: installation.version }),
          ...(installation.buildName === undefined ? {} : { buildName: installation.buildName }),
          ...(installation.buildUid === undefined ? {} : { buildUid: installation.buildUid }),
        })
      } catch (error) {
        log(
          `[installation] could not refresh ${source.installPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    if (enriched !== selectedSources) {
      /*
       * A version is a label: the folders, and so the composed sources, stay the same. Publishing
       * it as a new selection recomposed every extension's sources at each start, and the first
       * composition closed under the accounts move (v95: "Content sources closed").
       */
      selectedSources = enriched
      await context.globalState.update(SELECTED_SOURCES_KEY, enriched)
      hostView.refresh()
      sourcesView.refresh()
      await synchronizeContainerWorkspaceFolders()
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

  // ------------------------------------------------------------------------------------------
  // Game launch: a map, or a mod tested on a map, through the selected installation's game provider

  const launchDiagnostics = vscode.languages.createDiagnosticCollection('modkit-game-logs')
  let launchWatch: GameLaunchLogWatch | undefined
  context.subscriptions.push(launchDiagnostics, { dispose: () => launchWatch?.dispose() })

  /** The map a mod is tested on: the `modkit.launch.testMap` setting, else one the user picks. */
  const chooseTestMap = async (): Promise<string | undefined> => {
    const configuredMap = vscode.workspace.getConfiguration('modkit').get<string>('launch.testMap', '').trim()
    if (configuredMap !== '' && isAbsolute(configuredMap)) return configuredMap
    const found = await findDiskFiles(
      '{**/*.[Ss][Cc]2[Mm][Aa][Pp],**/*.[Ss]2[Mm][Aa],**/*.[Ss][Cc]2[Mm][Aa][Pp]/[Mm]ap[Ii]nfo}',
      '**/node_modules/**',
      200,
    )
    const maps = [
      ...new Set(
        found.map(uri => launchTargetOf(uri.fsPath, 'map')?.path).filter((path): path is string => path !== undefined),
      ),
    ].sort()
    const picked = await vscode.window.showQuickPick(
      maps.map(path => ({ label: basename(path), detail: path })),
      { title: localizer.text('vscode.game.chooseTestMap'), ignoreFocusOut: true },
    )
    return picked?.detail
  }

  /**
   * Offer to close the game when it is already running; false when the user keeps it open. The
   * process names come from the game's own plan; closing needs the same launch grant.
   */
  const closeRunningGame = async (
    request: ExplicitGameLaunchRequest,
    options: Readonly<Record<string, JsonValue>>,
  ): Promise<boolean> => {
    const planning = await planGameLaunch({
      services: host.services,
      gameId: request.gameId,
      installation: request.installation,
      resource: request.resource,
      options,
      grant: request.grant,
      budgets: GAME_DISCOVERY_BUDGET,
    })
    const names = planning.state === 'planned' ? (planning.plan.runningProcessNames ?? []) : []
    const running = await runningGameProcesses(names)
    if (running.length === 0) return true
    if (vscode.workspace.getConfiguration('modkit').get<boolean>('launch.warnIfRunning', true)) {
      const action = localizer.text('vscode.game.closeRunningAction')
      const choice = await vscode.window.showWarningMessage(
        localizer.text('vscode.game.closeRunningTitle', { game: request.installation.displayName }),
        { modal: true },
        action,
      )
      if (choice !== action) return false
    }
    for (const item of await stopGameProcesses(running, request.grant)) {
      log(`[game-launch] ${item.severity} ${item.code}: ${item.message}`)
    }
    return true
  }

  /** The launched run's logs (script errors, alerts) into Problems, as the game reads them. */
  const watchLaunchLogs = async (receipt: NodeGameLaunchReceipt, gameId: string): Promise<void> => {
    launchWatch?.dispose()
    launchDiagnostics.clear()
    const documentsDirectory = vscode.workspace
      .getConfiguration('modkit')
      .get<string>('launch.documentsDirectory', '')
      .trim()
    launchWatch = await watchGameLaunchLogs({
      plan: receipt.plan,
      ...(documentsDirectory === '' ? {} : { documentsDirectory }),
      interpret: async (fileName, text) => {
        const report = await interpretGameLaunchLog({
          services: host.services,
          gameId,
          grant: { id: `vscode-game-log-${nonce()}`, classes: [] },
          budgets: GAME_DISCOVERY_BUDGET,
          resource: receipt.resource,
          fileName,
          text,
        })
        for (const item of report.hostDiagnostics) {
          log(`[game-logs] ${item.severity} ${item.code}: ${item.message}`)
        }
        return report
      },
      onReport: async (fileName, report) => {
        for (const item of report.diagnostics) {
          log(`[game-logs] ${fileName}: ${item.severity} ${item.message}`)
        }
        const findings = report.diagnostics.filter(item => item.severity !== 'information')
        if (findings.length === 0) return
        const severity = {
          error: vscode.DiagnosticSeverity.Error,
          warning: vscode.DiagnosticSeverity.Warning,
          information: vscode.DiagnosticSeverity.Information,
        } as const
        let first: { readonly uri: vscode.Uri; readonly range: vscode.Range } | undefined
        for (const [path, items] of gameLogFindingsByFile(findings, receipt.resource.path)) {
          const uri = vscode.Uri.file(path)
          launchDiagnostics.set(
            uri,
            items.map(item => {
              const line = item.line ?? 0
              const diagnostic = new vscode.Diagnostic(
                new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
                item.message,
                severity[item.severity],
              )
              diagnostic.source = fileName
              diagnostic.code = item.code
              first ??= item.path === undefined ? undefined : { uri, range: diagnostic.range }
              return diagnostic
            }),
          )
        }
        void vscode.window.showErrorMessage(
          `Modkit: ${localizer.text('vscode.game.scriptErrors', { count: String(findings.length) })}`,
        )
        await vscode.commands.executeCommand('workbench.actions.view.problems')
        if (first !== undefined) {
          await vscode.window.showTextDocument(first.uri, { selection: first.range, preserveFocus: false })
        }
      },
      onLog: message => log(`[game-logs] ${message}`),
      onError: error => log(`[game-logs] ${error instanceof Error ? error.message : String(error)}`),
    })
  }

  /*
   * A map in its 3D world or its layers drawn in 2D (plan 6.9): the Explorer's file or folder, or
   * the active tab. No editor opens a folder, so a map folder opens through the anchor document
   * its codec declares (MapInfo for SC2), exactly as clicking that document does.
   */
  const openMapIn = async (argument: unknown, viewType: string): Promise<void> => {
    const input: unknown = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    const tabUri =
      typeof input === 'object' && input !== null && 'uri' in input
        ? (input as { readonly uri?: unknown }).uri
        : undefined
    const target =
      argument instanceof vscode.Uri ? argument : tabUri instanceof vscode.Uri ? tabUri : undefined
    if (target === undefined) return
    const anchored = await anchoredUri(target)
    if (anchored === undefined) {
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('vscode.map.noAnchor', { name: basename(target.path) })}`,
      )
      return
    }
    await vscode.commands.executeCommand('vscode.openWith', anchored, viewType)
  }

  /**
   * Launch a map, or test a mod on a map, after modal confirmation; offers to close a running
   * game first and reads the run's logs afterwards — the MK2 launch surface over the host's plan.
   */
  const launchGame = async (
    argument: unknown,
    kind: GameLaunchKind,
    configured: GameLaunchConfiguration = { options: {} },
  ) => {
        const argumentPath =
          configured.resource ??
          (argument instanceof vscode.Uri
            ? argument.scheme === 'file'
              ? argument.fsPath
              : undefined
            : typeof argument === 'string' && isAbsolute(argument)
              ? argument
              : (activeSubject ?? vscode.window.activeTextEditor?.document.uri.fsPath))
        // The package the path is in: a script or data file launches its map (or tests its mod).
        const target =
          argumentPath === undefined || !isAbsolute(argumentPath)
            ? undefined
            : launchTargetOf(argumentPath, kind)
        if (target === undefined) {
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text(kind === 'mod' ? 'vscode.game.openModFirst' : 'vscode.game.openMapFirst')}`,
          )
          return undefined
        }
        const requestedPath = target.path
        const options: Record<string, JsonValue> = { ...configured.options }
        if (target.kind === 'mod' && options['map'] === undefined) {
          const map = await chooseTestMap()
          if (map === undefined) return undefined
          options['map'] = map
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
            resourceKind: target.kind,
          },
          {
            localizer,
            confirm: async request =>
              (await vscode.window.showWarningMessage(
                request.title,
                { modal: true, detail: request.detail },
                request.action,
              )) === request.action,
            execute: async request => {
              if (!(await closeRunningGame(request, options))) {
                return Object.freeze({ state: 'denied' as const, diagnostics: Object.freeze([]) })
              }
              return launchNodeGameResource({
                services: host.services,
                ...request,
                options,
                budgets: GAME_DISCOVERY_BUDGET,
              })
            },
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
          await watchLaunchLogs(launched.receipt, installation.gameId)
          return launched.receipt
        } finally {
          await launched.release()
        }
  }

  // An edited line's findings belong to the run that reported them, not to the new text; the
  // rest of the file's findings move with their lines (plan 6.16).
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      const findings = launchDiagnostics.get(event.document.uri)
      if (event.contentChanges.length === 0 || findings === undefined || findings.length === 0)
        return
      const moved = linesAfterEdit(
        findings.map(item => item.range.start.line),
        event.contentChanges.map(change => ({
          startLine: change.range.start.line,
          endLine: change.range.end.line,
          insertedBreaks: change.text.split('\n').length - 1,
        })),
      )
      launchDiagnostics.set(
        event.document.uri,
        findings.flatMap((item, index) => {
          const line = moved[index]
          if (line === undefined) return []
          const kept = new vscode.Diagnostic(
            new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
            item.message,
            item.severity,
          )
          if (item.source !== undefined) kept.source = item.source
          if (item.code !== undefined) kept.code = item.code
          return [kept]
        }),
      )
    }),
  )

  // The launch button, shown while the active editor is in a map or mod (MK2's status item).
  const launchStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 45)
  const updateLaunchStatus = (): void => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined
    const uri = input?.uri ?? vscode.window.activeTextEditor?.document.uri
    const target = uri?.scheme === 'file' ? launchTargetOf(uri.fsPath) : undefined
    // the editor's context menu offers the same launch (plan 8.2)
    void vscode.commands.executeCommand('setContext', 'modkit.launchTarget', target?.kind ?? '')
    if (target === undefined) {
      launchStatus.hide()
      return
    }
    launchStatus.text = `$(run) ${localizer.text(target.kind === 'mod' ? 'vscode.game.statusTestMod' : 'vscode.game.statusLaunchMap')}`
    launchStatus.tooltip = target.path
    launchStatus.command = target.kind === 'mod' ? VSCODE_GAME_LAUNCH_MOD_COMMAND : VSCODE_GAME_LAUNCH_COMMAND
    launchStatus.show()
  }
  updateLaunchStatus()
  context.subscriptions.push(
    launchStatus,
    vscode.window.onDidChangeActiveTextEditor(updateLaunchStatus),
    vscode.window.tabGroups.onDidChangeTabs(updateLaunchStatus),
  )

  /*
   * The locale commands MK2 had beside its strings table (plan 4.12/4.13), over the codec's own
   * comparison — the operation its table names (`compareVariants`): asked for each bound locale it
   * gives the translation gaps, and given the file's text at a git revision, the strings changed
   * since. The codec reads nothing itself; git runs here, where the file is.
   */
  const withLocaleComparison = async (
    argument: unknown,
    run: (
      compare: (input: JsonValue) => Promise<unknown>,
      columns: readonly TableColumnInfo[],
      uri: vscode.Uri,
    ) => Promise<void>,
  ): Promise<void> => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    const uri =
      argument instanceof vscode.Uri
        ? argument
        : tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText
          ? tab.uri
          : undefined
    if (uri === undefined) {
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('vscode.strings.noFile')}`,
      )
      return
    }
    try {
      const subject = await commandOpener(subjectPathOf(uri))
      try {
        const session = subject.session
        if (session === undefined) throw new Error(localizer.text('vscode.strings.noComparison'))
        const lease = await session.dataSource('common.view/table-data-source', 1)
        const shape = await (lease.value as TableDataSource).shape().finally(() => lease.release())
        const operationId = shape.actions?.compareVariants
        const descriptor = await session.descriptor()
        const operation = descriptor.operations.find(
          item => item.id === operationId && item.state === 'available',
        )
        if (operation === undefined) throw new Error(localizer.text('vscode.strings.noComparison'))
        const operations = session.operations()
        await run(
          async input => {
            const result = await operations.invoke(operation.handlerId, input)
            if (result.state === 'ok' && result.output.kind === 'json') return result.output.value
            throw new Error(
              result.state === 'ok' ? `the codec answered ${result.output.kind}` : result.reason,
            )
          },
          shape.columnInfo ?? [],
          uri,
        )
      } finally {
        await subject.dispose()
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Modkit: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const translationGaps = (argument: unknown): Promise<void> =>
    withLocaleComparison(argument, async (compare, columns, uri) => {
      const name = basename(uri.path)
      const locales = comparedLocales(columns)
      if (locales.length === 0) {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('vscode.strings.oneLocale', { name })}`,
        )
        return
      }
      const lines: vscode.QuickPickItem[] = []
      for (const locale of locales) {
        const value = (await compare({ variant: locale })) as TableVariantComparison
        if (!hasGaps(value)) continue
        lines.push({
          label: locale,
          description: localizer.text('vscode.strings.gapLine', {
            missing: value.missing.length,
            empty: value.empty.length,
            untranslated: value.identical.length,
            orphaned: value.orphaned.length,
          }),
          detail: localizer.text('vscode.strings.translated', {
            translated: value.translated,
            total: value.total,
          }),
        })
      }
      if (lines.length === 0) {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('vscode.strings.noGaps', { name })}`,
        )
        return
      }
      await vscode.window.showQuickPick(lines, {
        title: localizer.text('vscode.strings.gapsTitle', { name }),
      })
    })

  const extractChangedStrings = (argument: unknown): Promise<void> =>
    withLocaleComparison(argument, async (compare, _columns, uri) => {
      if (uri.scheme !== 'file') {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('vscode.strings.noGit')}`,
        )
        return
      }
      const ref = gitRevision(
        await vscode.window.showInputBox({
          prompt: localizer.text('vscode.strings.refPrompt'),
          value: 'HEAD~1',
          placeHolder: localizer.text('vscode.strings.refPlaceholder'),
        }),
      )
      if (ref === undefined) return
      const topLevel = (await gitText(['rev-parse', '--show-toplevel'], dirname(uri.fsPath))).trim()
      const spec = gitShowSpec(ref, topLevel, uri.fsPath)
      if (spec === undefined) throw new Error(localizer.text('vscode.strings.noGit'))
      // a file the revision did not have yet: every key of it is new since
      const text = await gitText(['show', spec], topLevel).catch((error: unknown) => {
        const stderr = (error as { readonly stderr?: unknown }).stderr
        if (typeof stderr === 'string' && missingAtRevision(stderr)) return ''
        throw error
      })
      const answer = (await compare({
        since: { text: withoutByteOrderMark(text), label: ref },
      })) as StringChangesAnswer
      if (answer.added + answer.modified === 0) {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('vscode.strings.noChanges', { ref, deleted: answer.deleted })}`,
        )
        return
      }
      // What a translator is handed, unsaved: the reader decides where it goes.
      const language = (await vscode.workspace.openTextDocument(uri)).languageId
      const document = await vscode.workspace.openTextDocument({
        content: answer.staged,
        language,
      })
      await vscode.window.showTextDocument(document, { preview: false })
      void vscode.window.showInformationMessage(
        `Modkit: ${localizer.text('vscode.strings.staged', {
          count: answer.added + answer.modified,
          ref,
          added: answer.added,
          modified: answer.modified,
          deleted: answer.deleted,
          locale: answer.locale,
        })}`,
      )
    })

  /** The package of the mod the active (or given) file belongs to, at its anchor, in `viewType`. */
  const openModPackage = async (argument: unknown, viewType: string): Promise<boolean> => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    const uri =
      argument instanceof vscode.Uri
        ? argument
        : tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText
          ? tab.uri
          : undefined
    if (uri === undefined) {
      void vscode.window.showInformationMessage(localizer.text('vscode.resolution.noFile'))
      return false
    }
    const target = modContextTargetOf(subjectPathOf(uri))
    const source = await requireContentSources().catch(() => undefined)
    const placement = target === undefined ? undefined : await source?.locateModPackage?.(target)
    if (placement?.kind !== 'package') {
      void vscode.window.showInformationMessage(
        localizer.text('vscode.modCard.none', { name: basename(uri.path) }),
      )
      return false
    }
    const packageUri =
      placement.sourceId === HOST_LAYER_SOURCE_ID
        ? vscode.Uri.file(placement.path)
        : vscode.Uri.from({
            scheme: 'modkit-source',
            authority: 'battlenet',
            path: `/${placement.sourceId}/${placement.path}`,
          })
    const anchored = await anchoredUri(packageUri)
    if (anchored === undefined) {
      void vscode.window.showInformationMessage(
        localizer.text('vscode.map.noAnchor', { name: placement.displayName }),
      )
      return false
    }
    await vscode.commands.executeCommand('vscode.openWith', anchored, viewType)
    return true
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

    /*
     * The open map's world as one UVW document (П24): the shared `subject.convert` with target `uvw`,
     * over the map opened with the world its preview builds, saved where the person says, and the
     * receipt of what UVW left out reported like a conversion.
     */
    vscode.commands.registerCommand('modkit.exportWorldUvw', (argument: unknown) => {
      const subject = commandSubjectOf(argument)
      if (subject === undefined) {
        void vscode.window.showWarningMessage(localizer.text('vscode.world.exportNoSubject'))
        return undefined
      }
      return runSharedCommand({ command: 'subject.convert', subject, target: 'uvw' }, worldOpener)
    }),

    /*
     * A UVW world saved as a game's map (WT10): the shared `subject.convert` running the world's
     * `map.export-native` with a format an installed encoder writes; the encoder's diagnostics —
     * what the map does not carry — are reported like a conversion's.
     */
    vscode.commands.registerCommand('modkit.exportWorldNative', async (argument: unknown) => {
      const subject = commandSubjectOf(argument)
      if (subject === undefined) {
        void vscode.window.showWarningMessage(localizer.text('vscode.world.saveAsMapNoSubject'))
        return undefined
      }
      const formats = nativeEncoderFormats(
        offersFromInventory(host.services.inventory),
        NATIVE_MAP_ENCODER_CONTRACT,
      )
      if (formats.length === 0) {
        void vscode.window.showWarningMessage(localizer.text('vscode.world.noMapEncoders'))
        return undefined
      }
      const picked = await vscode.window.showQuickPick(
        formats.map(format => ({
          label: format.formatId,
          description: format.extensions.join(', '),
          extensions: format.extensions,
        })),
        { title: localizer.text('vscode.world.chooseMapFormat') },
      )
      if (picked === undefined) return undefined
      // the encoder may ask its game's catalog (question 67): the installations of the games its
      // extension discovers, the chosen ones first; with several, the person says which
      const targets = encoderTargetInstallations(host.services.host.inventory, picked.extensions, [
        ...presentSources(),
        ...(await foundInstallations()).installations,
      ])
      const target =
        targets.length > 1
          ? await vscode.window.showQuickPick(
              targets.map(source => ({
                label: source.displayName,
                description: source.installPath,
                installPath: source.installPath,
              })),
              { title: localizer.text('vscode.world.chooseMapTarget') },
            )
          : targets.map(source => ({ installPath: source.installPath }))[0]
      if (targets.length > 1 && target === undefined) return undefined
      return runSharedCommand({
        command: 'subject.convert',
        subject,
        target: picked.label,
        operation: MAP_EXPORT_NATIVE,
        ...(target === undefined ? {} : { targetContext: target.installPath }),
      })
    }),

    vscode.commands.registerCommand('modkit.convertFiles', (uri: unknown, uris: unknown) => {
      // from a menu: every selected resource; from the palette: the active tab's
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input as
        | { readonly uri?: unknown }
        | undefined
      const picked = Array.isArray(uris) ? uris : [uri ?? tab?.uri]
      void convertFiles(
        picked.filter((item): item is vscode.Uri => item instanceof vscode.Uri),
      ).catch(error =>
        vscode.window.showErrorMessage(
          `Modkit: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    }),

    vscode.commands.registerCommand('modkit.convertFolder', (uri: unknown) => {
      void convertFolder(uri instanceof vscode.Uri ? uri : undefined).catch(error =>
        vscode.window.showErrorMessage(
          `Modkit: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    }),

    vscode.commands.registerCommand('modkit.openResource', (uri: unknown) => {
      if (uri instanceof vscode.Uri) openNamedResource(uri)
    }),

    vscode.commands.registerCommand('modkit.openWith', (argument: unknown) => {
      // From a menu: the resource the menu was opened on, not whichever tab has focus.
      if (argument instanceof vscode.Uri) {
        openNamedResource(argument)
        return
      }
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
        /*
         * The folder search (owner decision 2026-09-28): every game's markers from its manifest,
         * the folders `modkit.installationSearchFolders` names; a match is a candidate its game's
         * provider still confirms, after the registry and the stores.
         */
        const wanted = gameInstallationSearchOf(host.services.host.inventory)
        const configured = installationSearchFolders(
          vscode.workspace.getConfiguration('modkit').get('installationSearchFolders'),
          process.env,
        )
        const searched =
          wanted.markers.length === 0
            ? undefined
            : await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: localizer.text('vscode.game.searching'),
                  cancellable: true,
                },
                async (_progress, token) => {
                  const controller = new AbortController()
                  token.onCancellationRequested(() => controller.abort())
                  try {
                    const result = await searchInstallationFolders({
                      markers: wanted.markers,
                      // the setting's names replace the host's common folders, removed ones too
                      commonFolders: configured.driveFolders,
                      searchFolders: wanted.searchFolders,
                      folders: configured.folders,
                      signal: controller.signal,
                    })
                    if (!result.complete)
                      log('[installation] warning the folder search stopped at its folder limit')
                    return result
                  } catch (error) {
                    if (!controller.signal.aborted)
                      log(
                        `[installation] error folder search: ${error instanceof Error ? error.message : String(error)}`,
                      )
                    return undefined
                  }
                },
              )
        if (searched !== undefined) installationFolderSearch = Promise.resolve(searched)
        const discover = async (gameId: string, configuredPaths: readonly string[]) => {
          const searchPaths = searched?.found[gameId] ?? []
          const discovery = await discoverGameInstallations({
            services: host.services,
            gameId,
            ...(configuredPaths.length === 0 ? {} : { configuredPaths }),
            ...(searchPaths.length === 0 ? {} : { searchPaths }),
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
          return discovery.state === 'discovered' ? discovery.result.installations : []
        }
        const candidates: SelectedContentSource[] = []
        for (const gameId of gameIds) {
          // A folder chosen by hand is not in the registry: it comes back as a configured path.
          const chosen = selectedSources
            .filter(source => source.gameId === gameId)
            .map(source => source.installPath)
          for (const installation of await discover(gameId, chosen)) {
            if (!candidates.some(item => item.normalizedPath === installation.normalizedPath))
              candidates.push(selectedContentSource(installation))
          }
        }
        type SourcePick = vscode.QuickPickItem & { readonly source?: SelectedContentSource }
        const items = (sources: readonly SelectedContentSource[]): SourcePick[] =>
          sources.map(source => ({
            label: source.displayName,
            description:
              source.version === undefined ? source.gameId : `${source.gameId} · ${source.version}`,
            detail: source.installPath,
            source,
          }))
        const title = localizer.text('vscode.game.selectInstallation')
        const picked = await vscode.window.showQuickPick<SourcePick>(
          [
            ...items(candidates),
            ...(candidates.length === 0
              ? []
              : [{ label: '', kind: vscode.QuickPickItemKind.Separator }]),
            { label: `$(folder-opened) ${localizer.text('vscode.game.specifyFolder')}` },
          ],
          {
            title,
            ...(candidates.length === 0
              ? { placeHolder: localizer.text('vscode.game.noVerifiedInstallation') }
              : {}),
          },
        )
        if (picked === undefined) return undefined
        let source = picked.source
        if (source === undefined) {
          // The provider still proves the folder; a path the user typed is never trusted as is.
          const folder = (
            await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              title: localizer.text('vscode.game.specifyFolder'),
            })
          )?.[0]?.fsPath
          if (folder === undefined) return undefined
          const verified: SelectedContentSource[] = []
          for (const gameId of gameIds)
            verified.push(...installationsAtFolder(await discover(gameId, [folder]), folder))
          source =
            verified.length > 1
              ? (await vscode.window.showQuickPick(items(verified), { title }))?.source
              : verified[0]
          if (source === undefined) {
            if (verified.length === 0)
              void vscode.window.showWarningMessage(
                `Modkit: ${localizer.text('vscode.game.folderNotInstallation', { path: folder })}`,
              )
            return undefined
          }
        }
        granted.add(resolve(source.installPath))
        await publishSelectedSources(withSelectedContentSource(selectedSources, source))
        log(`selected content source: ${source.displayName} (${source.installPath})`)
        return source
      })(),
    ),

    /** The shared index caches and their sizes; the picked ones go and are rebuilt when needed. */
    vscode.commands.registerCommand('modkit.indexCaches', () =>
      (async () => {
        const caches = await listIndexCaches(indexCacheDirectory)
        if (caches.length === 0) {
          void vscode.window.showInformationMessage(
            `Modkit: ${localizer.text('vscode.indexCaches.none')}`,
          )
          return
        }
        const mebibytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)
        const picked = await vscode.window.showQuickPick(
          caches.map(cache => ({
            label: [
              ...new Set([cache.manifest.game, cache.manifest.product].filter(part => part)),
            ].join(' · '),
            description: localizer.text(
              cache.manifest.kind === 'names'
                ? 'vscode.indexCaches.names'
                : cache.manifest.kind === 'data'
                  ? 'vscode.indexCaches.data'
                  : 'vscode.indexCaches.content',
              { size: mebibytes(cache.bytes) },
            ),
            detail: cache.manifest.installation,
            cache,
          })),
          {
            canPickMany: true,
            title: localizer.text('vscode.indexCaches.title', {
              size: mebibytes(caches.reduce((sum, cache) => sum + cache.bytes, 0)),
            }),
            placeHolder: localizer.text('vscode.indexCaches.pick'),
          },
        )
        if (picked === undefined || picked.length === 0) return
        // an open index holds its file, and Windows refuses to delete an open file
        await closeContentIndexes()
        const failed: string[] = []
        for (const item of picked) {
          try {
            await removeIndexCache(indexCacheDirectory, item.cache.folder)
          } catch (error) {
            failed.push(item.label)
            log(`[index-cache] ${item.cache.folder}: ${String(error)}`)
          }
        }
        log(
          `[index-cache] removed ${String(picked.length - failed.length)} of ${String(picked.length)}`,
        )
        if (failed.length > 0)
          void vscode.window.showWarningMessage(
            `Modkit: ${localizer.text('vscode.indexCaches.inUse', { names: failed.join(', ') })}`,
          )
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

    /** Launch the active map, or test the active mod on a map, in the game. */
    vscode.commands.registerCommand(VSCODE_GAME_LAUNCH_COMMAND, (argument: unknown) =>
      launchGame(argument, 'map'),
    ),
    vscode.commands.registerCommand(VSCODE_GAME_LAUNCH_MOD_COMMAND, (argument: unknown) =>
      launchGame(argument, 'mod'),
    ),
    vscode.commands.registerCommand('modkit.openMap3D', (argument: unknown) =>
      openMapIn(argument, 'modkit.worldViewer'),
    ),
    vscode.commands.registerCommand('modkit.openMap2D', (argument: unknown) =>
      openMapIn(argument, 'modkit.mapLayersViewer'),
    ),
    // A `modkit-launch` launch configuration (F5): its package, kind and game options.
    vscode.debug.registerDebugConfigurationProvider(VSCODE_GAME_LAUNCH_DEBUG_TYPE, {
      resolveDebugConfiguration(_folder, config) {
        const configured = gameLaunchConfiguration(config)
        void launchGame(undefined, configured.kind ?? 'map', configured)
        return undefined
      },
    }),
    /*
     * «Configure Game Launch» (plan 8.8, MK2's «Configure Map Launch»): a configuration with the
     * options the game declares, at their defaults, added to the folder's launch.json and shown.
     */
    vscode.commands.registerCommand('modkit.game.configureLaunch', async () => {
      const games = gameLaunchOptionsOf(host.services.inventory)
      if (games.size === 0) {
        void vscode.window.showInformationMessage(
          `Modkit: ${localizer.text('vscode.launch.noOptions')}`,
        )
        return false
      }
      const gameId =
        games.size === 1
          ? [...games.keys()][0]
          : await vscode.window.showQuickPick([...games.keys()].sort(), {
              title: localizer.text('vscode.launch.pickGame'),
            })
      const options = gameId === undefined ? undefined : games.get(gameId)
      if (gameId === undefined || options === undefined) return false
      const folders = vscode.workspace.workspaceFolders ?? []
      const folder = folders.length > 1 ? await vscode.window.showWorkspaceFolderPick() : folders[0]
      if (folder === undefined) {
        void vscode.window.showWarningMessage(`Modkit: ${localizer.text('vscode.launch.noFolder')}`)
        return false
      }
      const launch = vscode.workspace.getConfiguration('launch', folder.uri)
      const configured = launch.inspect<unknown[]>('configurations')?.workspaceFolderValue ?? []
      const name = localizer.text('vscode.launch.configurationName', { game: gameId })
      await launch.update(
        'configurations',
        [...configured, gameLaunchConfigurationFor(name, options)],
        vscode.ConfigurationTarget.WorkspaceFolder,
      )
      await vscode.window.showTextDocument(
        vscode.Uri.joinPath(folder.uri, '.vscode', 'launch.json'),
      )
      return true
    }),

    /** Re-run the active subject route; relation/tree stages refresh from the new descriptor. */
    /*
     * «Reveal in DescTree» (plan 3.33): the template node declared at the cursor, selected in the
     * file's Modkit editor — the one open, or one opened beside.
     */
    vscode.commands.registerCommand('modkit.template.reveal', async () => {
      const editor = vscode.window.activeTextEditor
      if (editor === undefined) return false
      const uri = editor.document.uri
      const offset = editor.document.offsetAt(editor.selection.active)
      const key = subjectKey(subjectPathOf(uri))
      const servedFor = () => [...liveSubjects].find(([, path]) => path === key)?.[0]
      if (servedFor() === undefined) {
        await vscode.commands.executeCommand('vscode.openWith', uri, CUSTOM_EDITOR_TYPE, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true,
        })
      }
      const served = servedFor()
      if (served === undefined) return false
      served.revealTemplate(uri.toString(), offset)
      return true
    }),

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

    /*
     * MK2's "Reload mod": the loaded mods read their files again, for a change the file watcher
     * could not see (a network drive, a file written while the window slept).
     */
    vscode.commands.registerCommand('modkit.resources.refresh', async () => {
      const sessions = await loadedSessions
      if (sessions !== undefined && sessions.list().length > 0) {
        const source = await requireContentSources()
        forgetResourcePaths()
        await refreshHostFiles(source)
        await sessions.reloadAll()
      }
      resourcesView.refresh()
      return true
    }),

    /*
     * The chain is what the game loads; the package alone is what the author writes. Both are
     * legitimate questions, and neither can be inferred from the other, so the reader picks.
     */
    vscode.commands.registerCommand('modkit.resources.toggleChain', async () => {
      resourcesShowChain = !resourcesShowChain
      await context.workspaceState.update(RESOURCES_CHAIN_KEY, resourcesShowChain)
      resourcesView.refresh()
      void vscode.window.setStatusBarMessage(
        localizer.text(
          resourcesShowChain ? 'vscode.resources.chainOn' : 'vscode.resources.chainOff',
        ),
        4_000,
      )
      return resourcesShowChain
    }),

    vscode.commands.registerCommand('modkit.resources.search', async () => {
      const query = await vscode.window.showInputBox({
        title: localizer.text('vscode.resources.searchTitle'),
        placeHolder: localizer.text('vscode.resources.searchPlaceholder'),
      })
      if (query === undefined) return false
      await resourcesView.search(query)
      return true
    }),

    vscode.commands.registerCommand('modkit.resources.open', (argument: unknown) =>
      resourcesView.open(argument as ResourceTreeNode),
    ),
    vscode.commands.registerCommand('modkit.resources.goToDeclaration', (argument: unknown) =>
      resourcesView.goToDeclaration(argument as ResourceTreeNode),
    ),

    /*
     * An entity's card or its relations graph (plan 5.30): the Resources row the command ran on,
     * else one picked by id or name across the loaded mods, starting from the word at the cursor.
     */
    ...(['card', 'relations'] as const).map(stage =>
      vscode.commands.registerCommand(
        stage === 'card' ? 'modkit.openEntityCard' : 'modkit.openEntityGraph',
        async (argument: unknown) => {
          const row = argument as ResourceTreeNode | undefined
          if (row?.kind === 'resource' && row.facts.subjectId !== undefined)
            return resourcesView.open(row, stage)
          const editor = vscode.window.activeTextEditor
          const range = editor?.selection.isEmpty
            ? editor.document.getWordRangeAtPosition(editor.selection.active)
            : editor?.selection
          const picked = await resourcesView.pick(
            range === undefined || editor === undefined ? '' : editor.document.getText(range),
            localizer.text(stage === 'card' ? 'vscode.entity.card' : 'vscode.entity.graph'),
            localizer.text('vscode.entity.placeholder'),
          )
          return picked === undefined ? false : resourcesView.open(picked, stage)
        },
      ),
    ),

    /** The card of the mod the active (or given) file belongs to: its package, at its anchor. */
    vscode.commands.registerCommand('modkit.openModCard', (argument: unknown) =>
      openModPackage(argument, CUSTOM_EDITOR_TYPE),
    ),
    /*
     * The wiki of a mod (plan 5.25): a loaded mod's row in Resources opens its subject on the wiki;
     * from the palette, the mod the active file belongs to, in the wiki's own editor.
     */
    vscode.commands.registerCommand('modkit.openModWiki', (argument: unknown) => {
      const row = argument as ResourceTreeNode | undefined
      return row?.kind === 'resource' && row.facts.kind === 'mod'
        ? resourcesView.open(row, 'wiki')
        : openModPackage(argument, 'modkit.wikiViewer')
    }),
    vscode.commands.registerCommand('modkit.strings.translationGaps', translationGaps),
    vscode.commands.registerCommand('modkit.strings.extractChanged', extractChangedStrings),

    /** Unload a mod from Resources: the row it ran on, else one picked from the loaded mods. */
    vscode.commands.registerCommand('modkit.resources.unloadMod', async (argument: unknown) => {
      const sessions = await resourceSessions().catch(() => undefined)
      const loaded = sessions?.list() ?? []
      if (sessions === undefined || loaded.length === 0) {
        void vscode.window.showInformationMessage(localizer.text('vscode.resources.noActiveSubject'))
        return false
      }
      const row = argument as ResourceTreeNode | undefined
      const named =
        row?.kind === 'resource' && row.facts.kind === 'mod'
          ? loaded.filter(mod => mod.label === row.facts.label)
          : []
      const chosen =
        named.length === 1
          ? named[0]
          : await vscode.window.showQuickPick(
              loaded.map(mod => ({ label: mod.label, id: mod.id })),
              { title: localizer.text('vscode.resources.unloadTitle') },
            )
      if (chosen === undefined) return false
      await sessions.unload(chosen.id)
      resourcesView.refresh()
      return true
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
                  join(workspaceFolders()[0] ?? extensionRoot, 'modkit-diagnostics.json'),
                ),
                filters: { JSON: ['json'] },
              })
        if (target === undefined) return undefined
        // What a report says about the window; the broker's secrets are never read here.
        const roots = await contentSources
          ?.then(source => source?.snapshot())
          .then(snapshot => snapshot?.roots)
          .catch(() => undefined)
        const sessions = await loadedSessions?.catch(() => undefined)
        const report = diagnosticsReport({
          createdAt: new Date().toISOString(),
          versions: {
            modkit: String((context.extension.packageJSON as { version?: unknown }).version),
            vscode: vscode.version,
            platform: `${process.platform} ${process.arch}`,
            node: process.versions.node,
          },
          settings: JSON.parse(JSON.stringify(vscode.workspace.getConfiguration('modkit'))),
          contentSources: (roots ?? []).map(root => ({
            id: root.id,
            label: root.label,
            ...(root.game === undefined ? {} : { game: root.game }),
            ...(root.product === undefined ? {} : { product: root.product }),
            ...(root.storageOf === undefined ? {} : { storageOf: root.storageOf }),
          })),
          loadedMods: sessions?.list() ?? [],
          journal: journal.text(),
        })
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(report))
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

    /*
     * How the active file resolves: the package it lies in, the mod chain the game's loader builds
     * for it in load order (each layer's role, why it is there and where it comes from), which layer
     * actually serves this file — the last one that has it — and what no content source holds. The
     * report is a Markdown document, so it can be read, searched and pasted into a bug.
     */
    vscode.commands.registerCommand('modkit.explainResolution', async (argument: unknown) => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      const uri =
        argument instanceof vscode.Uri
          ? argument
          : tab instanceof vscode.TabInputCustom || tab instanceof vscode.TabInputText
            ? tab.uri
            : undefined
      if (uri === undefined) {
        void vscode.window.showInformationMessage(localizer.text('vscode.resolution.noFile'))
        return
      }
      const path = subjectPathOf(uri)
      const target = modContextTargetOf(path)
      const source = await requireContentSources().catch(() => undefined)
      if (target === undefined || source?.openModContext === undefined) {
        void vscode.window.showInformationMessage(
          localizer.text('vscode.resolution.noLoader', { name: basename(uri.path) }),
        )
        return
      }
      const baseMods =
        typeof target === 'string' ? baseModsFor(target, baseModsSetting(uri)) : undefined
      const started = performance.now()
      const placement = await source.locateModPackage?.(target)
      const modContext = await source.openModContext({
        schemaVersion: 1,
        target,
        ...(baseMods === undefined ? {} : { baseMods }),
      })
      const milliseconds = Math.round(performance.now() - started)
      try {
        const targetPath = typeof target === 'string' ? target : target.path
        const inside =
          placement?.kind !== 'package'
            ? undefined
            : typeof target === 'string'
              ? relative(placement.path, targetPath).replaceAll('\\', '/')
              : targetPath.toLowerCase().startsWith(`${placement.path.toLowerCase()}/`)
                ? targetPath.slice(placement.path.length + 1)
                : undefined
        const served =
          inside === undefined || inside === '' || inside.startsWith('..')
            ? undefined
            : await modContext.locate(inside)
        const layerName = (id: string) =>
          modContext.layers.find(layer => layer.id === id)?.displayName ?? id
        const cell = (text: string) => text.replaceAll('|', '\\|')
        const report = [
          `# ${localizer.text('vscode.resolution.title', { name: basename(uri.path) })}`,
          '',
          placement?.kind === 'package'
            ? localizer.text('vscode.resolution.inPackage', {
                name: placement.displayName,
                source: placement.sourceId,
                path: placement.path,
              })
            : // A single module answers `foreign` directly; for the reader it is as unplaced as `missing`.
              placement?.kind === 'missing' || placement?.kind === 'foreign'
              ? localizer.text('vscode.resolution.missing')
              : localizer.text('vscode.resolution.loose', {
                  mods: (baseMods ?? []).join(', ') || '—',
                }),
          '',
          localizer.text('vscode.resolution.context', {
            game: modContext.gameId,
            layers: modContext.layers.length,
            milliseconds,
          }),
          '',
          `| # | ${localizer.text('vscode.resolution.columns')} |`,
          '| --- | --- | --- | --- | --- | --- |',
          ...modContext.layers.map(
            (layer, index) =>
              `| ${index + 1} | ${cell(layer.displayName)} | ${layer.role} | ${layer.provenance} | ` +
              `${cell(layer.sourceId)} | ${cell(layer.sourcePath)} |`,
          ),
          '',
          served === undefined
            ? localizer.text('vscode.resolution.notServed')
            : localizer.text('vscode.resolution.served', {
                layer: layerName(served.layerId),
                path: served.path,
              }),
          '',
          modContext.unresolved.length === 0
            ? localizer.text('vscode.resolution.allResolved')
            : localizer.text('vscode.resolution.unresolved', {
                names: modContext.unresolved.join(', '),
              }),
          '',
          `## ${localizer.text('vscode.resolution.host')}`,
          '',
          ...hostResolutionLines().map(line => `- ${line}`),
          '',
        ].join('\n')
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument({ language: 'markdown', content: report }),
          { preview: true },
        )
      } finally {
        await modContext.dispose()
      }
    }),
  )

  /** The composed host, for the end of a resolution report: realms, extensions, contributions. */
  function hostResolutionLines(): readonly string[] {
    return [
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
  }

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

  /**
   * Edits a backup kept from the last session: applied to the file only when the user says so; the
   * open view then reads the file again, now with them.
   */
  const offerKeptEdits = async (document: ModkitCustomDocument, kept: Uint8Array) => {
    const current = await vscode.workspace.fs.readFile(document.uri).then(
      bytes => bytes,
      () => undefined,
    )
    // a backup equal to the file kept nothing unsaved
    if (current !== undefined && Buffer.from(current).equals(Buffer.from(kept))) return
    const apply = localizer.text('vscode.document.keptApply')
    const choice = await vscode.window.showWarningMessage(
      localizer.text('vscode.document.kept', { name: basename(document.uri.fsPath) }),
      apply,
      localizer.text('vscode.document.keptDiscard'),
    )
    if (choice !== apply) return
    await vscode.workspace.fs.writeFile(document.uri, kept)
    log(`applied kept edits to ${document.uri.toString()}`)
    await document.state.revert().catch(() => undefined)
  }

  const customEditor: vscode.CustomEditorProvider<ModkitCustomDocument> = {
    onDidChangeCustomDocument: customDocumentChanged.event,

    async openCustomDocument(uri, openContext, token) {
      checkCancellation(token)
      const document = new ModkitCustomDocument(
        uri,
        formatSmokeReadOnlySubjects.has(subjectKey(subjectPathOf(uri))),
      )
      if (openContext.backupId !== undefined) {
        /*
         * A backup holds edits that were never saved. They reach the file only if the user says so:
         * the document opens as the file is on disk, and a notice offers to apply them.
         */
        const kept = await vscode.workspace.fs
          .readFile(vscode.Uri.parse(openContext.backupId))
          .then(
            bytes => bytes,
            () => undefined,
          )
        checkCancellation(token)
        if (kept !== undefined) void offerKeptEdits(document, kept)
      }
      return document
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
          onRevertRequested(path) {
            if (path === document.state.path) {
              void vscode.commands.executeCommand('workbench.action.files.revert')
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
          viewerStatusBar.setActive(key)
          refreshForActiveResource()
        } else if (activeSubject === key) {
          activeSubject = undefined
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
        }
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
      const itself = destination.toString() === document.uri.toString()
      if (!document.readOnly && document.state.isDirty) {
        if (itself) {
          await document.state.save()
          return
        }
        /*
         * The edits go to the new file and the source keeps what is on disk. A view that cannot
         * encode its buffer is refused, never saved into the source to get at the bytes.
         */
        const bytes = await document.state.encode()
        checkCancellation(token)
        if (bytes === undefined) throw new Error(localizer.text('vscode.document.saveAsUnsaved'))
        await vscode.workspace.fs.writeFile(destination, bytes)
        return
      }
      checkCancellation(token)
      if (!itself) {
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
       * A backup keeps the unsaved edits beside the file, never in it: the bytes a save would write,
       * encoded by the view that holds them. VS Code backs a dirty document up soon after each edit,
       * so saving here wrote every edit to disk without Ctrl+S. A view that cannot encode its buffer
       * refuses, and VS Code then asks to save or discard instead of trusting a backup.
       */
      if (!document.readOnly && document.state.isDirty) {
        const bytes = await document.state.encode()
        checkCancellation(token)
        if (bytes === undefined)
          throw new Error(localizer.text('vscode.document.backupUnavailable'))
        await vscode.workspace.fs.writeFile(backupContext.destination, bytes)
      } else {
        await vscode.workspace.fs.copy(document.uri, backupContext.destination, { overwrite: true })
      }
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
  /*
   * The active subject follows the tab in front. A panel restored with the focus says it is active
   * and, when the reader then clicks a text editor in another group, never says it is not (v89):
   * «Entity Card…» sent the SCV to that panel, a layout preview, which refused it.
   */
  const followActiveTab = (): void => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    if (input instanceof vscode.TabInputCustom && MODKIT_VIEW_TYPES.includes(input.viewType)) return
    if (activeSubject === undefined) return
    activeSubject = undefined
    viewerStatusBar.setActive(undefined)
  }
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabGroups(followActiveTab),
    vscode.window.tabGroups.onDidChangeTabs(followActiveTab),
  )

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
      // `.SC2Style`, `.SC2Bank`, `.BlizWiz`…: this extension's own text languages open as text
      textLanguageExtensions: contributedLanguageExtensions(context.extension.packageJSON),
      // `Objects`, `Preload.xml`, a map's `Regions`: names those languages claim open as text as well
      textLanguageFileNames: contributedLanguageFileNames(context.extension.packageJSON),
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
  /*
   * Editors that were already on screen when this activation claimed their format.
   *
   * Activation comes after the workbench has restored its tabs, and the association map is
   * only written once the host has composed — so on a first run, and on any run where a model tab
   * was restored, the file is already open in the text editor that `workbench.editorAssociations`
   * would now have kept it out of. Reopening a folder fixed it because the second activation found
   * the associations already written; nothing else about the window had changed.
   *
   * Only patterns this sync *added* are reopened. A pattern that was already ours, or that the user
   * pointed somewhere else, is left exactly where it is: this repairs the race, it does not take
   * editors over.
   */
  const reopenNewlyAssociatedTabs = async (plan: AssociationPlan): Promise<void> => {
    if (plan.added.length === 0) return
    const added = new Set(plan.added)
    const claimed = (uri: vscode.Uri): boolean => {
      const name = basename(uri.path)
      const dot = name.lastIndexOf('.')
      return (
        added.has(anchorAssociationPattern(name)) ||
        (dot > 0 && added.has(associationPattern(name.slice(dot + 1))))
      )
    }
    const stale = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .filter(tab => tab.input instanceof vscode.TabInputText && claimed(tab.input.uri))
    for (const tab of stale) {
      const input = tab.input as vscode.TabInputText
      try {
        // Closed first: `vscode.openWith` on a resource that already has a text editor in the group
        // adds a second tab for the same file rather than replacing the one that is there.
        await vscode.window.tabGroups.close(tab, true)
        await vscode.commands.executeCommand('vscode.openWith', input.uri, CUSTOM_EDITOR_TYPE, {
          viewColumn: tab.group.viewColumn,
          preserveFocus: !tab.isActive,
          preview: tab.isPreview,
        })
      } catch (error) {
        log(
          `[associations] could not reopen ${input.uri.toString()}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (stale.length > 0) log(`[associations] reopened ${stale.length} tab(s) this sync claimed`)
  }
  void syncEditorAssociations('activation').then(reopenNewlyAssociatedTabs)

  /*
   * VS Code never turns on a contributed icon theme by itself, so the Modkit icons showed nowhere
   * until the user went looking for them. They are offered once; whatever the answer, not again.
   */
  const workbench = vscode.workspace.getConfiguration('workbench')
  if (
    context.globalState.get(ICON_THEME_OFFERED_KEY) !== true &&
    workbench.get('iconTheme') !== ICON_THEME_ID
  ) {
    void context.globalState.update(ICON_THEME_OFFERED_KEY, true)
    void vscode.window
      .showInformationMessage(
        localizer.text('vscode.iconTheme.offer'),
        localizer.text('vscode.iconTheme.enable'),
      )
      .then(choice =>
        choice === undefined
          ? undefined
          : workbench.update('iconTheme', ICON_THEME_ID, vscode.ConfigurationTarget.Global),
      )
  }

  /*
   * The game-string locale sits in the status bar while one of this extension's own languages is
   * edited: names in hover, completions and cards come in it. Picking one writes `modkit.locale`;
   * the built-in languages it only adds files to (XML, INI, Lua) do not show it.
   */
  const ownLanguages = new Set(
    ((context.extension.packageJSON as { contributes?: { languages?: unknown[] } }).contributes
      ?.languages ?? [])
      .filter(
        (language): language is { id: string; aliases: unknown } =>
          typeof language === 'object' && language !== null && 'aliases' in language,
      )
      .map(language => language.id),
  )
  // The editor context menu offers Modkit's commands only in these languages.
  void vscode.commands.executeCommand('setContext', 'modkit.languages', [...ownLanguages])
  const localeStatus = vscode.window.createStatusBarItem(
    'modkit.gameLocale',
    vscode.StatusBarAlignment.Right,
    99,
  )
  localeStatus.name = localizer.text('vscode.locale.statusName')
  localeStatus.command = 'modkit.selectGameLocale'
  const showLocaleStatus = (): void => {
    const locale = configuredGameLocales()[0] as string
    localeStatus.text = `$(globe) ${locale}`
    localeStatus.tooltip = localizer.text('vscode.locale.tooltip', { locale })
    const languageId = vscode.window.activeTextEditor?.document.languageId
    if (languageId !== undefined && ownLanguages.has(languageId)) localeStatus.show()
    else localeStatus.hide()
  }
  context.subscriptions.push(
    localeStatus,
    vscode.window.onDidChangeActiveTextEditor(showLocaleStatus),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('modkit.locale')) return
      showLocaleStatus()
      // Answers already in flight were computed in the old locale.
      languageWorkspace.invalidate('game-string locale changed')
      // The loaded mods read their names in the new locale.
      void loadedSessions
        ?.then(sessions => sessions.reloadAll())
        .then(() => resourcesView.refresh())
        .catch(error => log(`[resources] ${error instanceof Error ? error.message : String(error)}`))
    }),
    vscode.commands.registerCommand('modkit.selectGameLocale', async () => {
      const current = vscode.workspace.getConfiguration('modkit').get<string>('locale') ?? ''
      const automatic = gameLocales('', vscode.env.language)[0] as string
      const items = [
        { label: localizer.text('vscode.locale.auto', { locale: automatic }), value: '' },
        ...GAME_LOCALES.map(locale => ({ label: locale, value: locale })),
      ].map(item =>
        item.value === current.trim()
          ? { ...item, description: localizer.text('vscode.locale.current') }
          : item,
      )
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: localizer.text('vscode.locale.pick'),
      })
      if (picked === undefined) return
      await vscode.workspace
        .getConfiguration('modkit')
        .update('locale', picked.value, vscode.ConfigurationTarget.Global)
    }),
  )
  showLocaleStatus()

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
  /*
   * Secrets an extension used to read from `modkit.contributionSettings` (a declaration's
   * `replacesSettings`) move into the broker from every level that holds them — user, workspace
   * and, in a multi-root workspace, each folder — and leave the settings once adopted. One notice
   * says how many moved and how many stayed; it never shows a value.
   */
  const moveReplacedSettings = async (
    broker: NonNullable<typeof host.services.credentials>,
  ): Promise<void> => {
    const declared = broker
      .declared()
      .filter(
        entry =>
          (entry.requirement.replacesSettings?.length ?? 0) > 0 ||
          (entry.requirement.replacesApplicationSettings?.length ?? 0) > 0,
      )
    if (declared.length === 0) return
    const root = vscode.workspace.getConfiguration('modkit')
    const levels: {
      readonly config: vscode.WorkspaceConfiguration
      readonly target: vscode.ConfigurationTarget
      readonly value: unknown
    }[] = [
      {
        config: root,
        target: vscode.ConfigurationTarget.Global,
        value: root.inspect('contributionSettings')?.globalValue,
      },
      {
        config: root,
        target: vscode.ConfigurationTarget.Workspace,
        value: root.inspect('contributionSettings')?.workspaceValue,
      },
      // folder settings are a level of their own only in a multi-root workspace
      ...(vscode.workspace.workspaceFile === undefined
        ? []
        : (vscode.workspace.workspaceFolders ?? []).map(folder => {
            const config = vscode.workspace.getConfiguration('modkit', folder.uri)
            return {
              config,
              target: vscode.ConfigurationTarget.WorkspaceFolder,
              value: config.inspect('contributionSettings')?.workspaceFolderValue,
            }
          })),
    ]
    const totals = { adopted: 0, kept: 0, refused: 0 }
    for (const level of levels) {
      if (level.value === undefined) continue
      const result = await adoptReplacedSettings({ level: level.value, declared, broker, log })
      totals.adopted += result.adopted
      totals.kept += result.kept
      totals.refused += result.refused
      if (result.changed)
        await level.config.update('contributionSettings', result.next, level.target)
    }
    // MK2's own top-level settings (`modkit.stormgate.aesKey`), at every level that holds one
    const applicationSettings = [
      ...new Set(
        declared.flatMap(entry =>
          (entry.requirement.replacesApplicationSettings ?? []).map(item => item.setting),
        ),
      ),
    ]
    const everything = vscode.workspace.getConfiguration()
    const applicationLevels: {
      readonly config: vscode.WorkspaceConfiguration
      readonly target: vscode.ConfigurationTarget
      readonly value: (setting: string) => unknown
    }[] = [
      {
        config: everything,
        target: vscode.ConfigurationTarget.Global,
        value: setting => everything.inspect(setting)?.globalValue,
      },
      {
        config: everything,
        target: vscode.ConfigurationTarget.Workspace,
        value: setting => everything.inspect(setting)?.workspaceValue,
      },
      ...(vscode.workspace.workspaceFile === undefined
        ? []
        : (vscode.workspace.workspaceFolders ?? []).map(folder => {
            const config = vscode.workspace.getConfiguration(undefined, folder.uri)
            return {
              config,
              target: vscode.ConfigurationTarget.WorkspaceFolder,
              value: (setting: string) => config.inspect(setting)?.workspaceFolderValue,
            }
          })),
    ]
    for (const level of applicationSettings.length === 0 ? [] : applicationLevels) {
      const values = Object.fromEntries(
        applicationSettings.flatMap(setting => {
          const value = level.value(setting)
          return value === undefined ? [] : [[setting, value] as const]
        }),
      )
      if (Object.keys(values).length === 0) continue
      const result = await adoptReplacedApplicationSettings({ values, declared, broker, log })
      totals.adopted += result.adopted
      totals.kept += result.kept
      totals.refused += result.refused
      for (const setting of result.cleared) {
        await level.config.update(setting, undefined, level.target)
      }
    }
    if (totals.adopted + totals.kept + totals.refused === 0) return
    void vscode.window.showInformationMessage(
      localizer.text('vscode.accounts.settingsMoved', totals),
    )
  }
  const credentialBroker = host.services.credentials
  if (credentialBroker !== undefined) {
    const accountsView = new AccountsView(credentialBroker, localizer)
    context.subscriptions.push(
      accountsView,
      vscode.window.registerTreeDataProvider('modkit.accounts', accountsView),
      ...registerAccountsCommands({
        broker: credentialBroker,
        prompter: credentialPrompter,
        view: accountsView,
        localizer,
        log,
      }),
    )
    void moveReplacedSettings(credentialBroker).catch(error =>
      log(`[accounts] moving keys out of settings: ${error instanceof Error ? error.message : ''}`),
    )
  }
  /*
   * A file of a loaded mod changed — saved here or written by another program (the SC2 editor,
   * git): the mods whose chain holds it reopen with their dependents (host reloadHolding), and the
   * others keep their contexts. Events for one path within a moment are one change.
   */
  const reloadTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const modFileChanged = (uri: vscode.Uri): void => {
    if (uri.scheme !== 'file') return
    const path = uri.fsPath
    clearTimeout(reloadTimers.get(path))
    reloadTimers.set(
      path,
      setTimeout(() => {
        reloadTimers.delete(path)
        // The servers language requests read list and read their chains again.
        void languageModContexts
          .invalidate()
          .catch(error =>
            log(`[language-context] reload: ${error instanceof Error ? error.message : String(error)}`),
          )
        void resourceSessions()
          .then(async sessions => {
            if (sessions.list().length === 0) return
            const source = await requireContentSources()
            const placement = await source.locateModPackage?.(path)
            if (placement?.kind !== 'package') return
            forgetResourcePaths()
            await refreshHostFiles(source)
            if (await sessions.reloadHolding('host', path)) resourcesView.refresh()
          })
          .catch(error =>
            log(`[resources] reload: ${error instanceof Error ? error.message : String(error)}`),
          )
      }, 300),
    )
  }
  const modFiles = vscode.workspace.createFileSystemWatcher('**/*')
  context.subscriptions.push({
    dispose: () => {
      for (const timer of reloadTimers.values()) clearTimeout(timer)
    },
  })
  context.subscriptions.push(
    sourcesView,
    resourcesView,
    // Registered at the very start of activation; the real providers take over here.
    views.sources.resolve(sourcesView),
    views.resources.resolve(resourcesView),
    views.extensions.resolve(extensionsView),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // The grant widened or narrowed; every open page reloads its tree and is told why.
      for (const served of live) {
        served.publishRoots()
        served.notice(localizer.text('vscode.shell.workspaceFoldersChanged'))
      }
      sourcesView.refresh()
      resourcesView.refresh()
    }),
    vscode.window.onDidChangeActiveTextEditor(refreshForActiveResource),
    modFiles,
    modFiles.onDidChange(modFileChanged),
    modFiles.onDidCreate(modFileChanged),
    modFiles.onDidDelete(modFileChanged),
    // a file outside the workspace folders is not watched; its save still counts
    vscode.workspace.onDidSaveTextDocument(document => modFileChanged(document.uri)),
  )

  /*
   * A subject opened in an editor: the loaded mods may have changed. Its facts — size, format,
   * codec — are the viewer's own status items (`viewerStatusBar`); the subject entry that once
   * stood beside them was removed in 168cf44d.
   */
  const rememberSubject = (): void => {
    resourcesView.refresh()
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
  /*
   * The content sources are composed now, in the background, not at the first open: every open
   * waits for them (a game file resolves its mod and installation through them), and composing
   * them took 14 s that the first map opened in a window spent before its codec even started (v83).
   */
  if (vscode.workspace.isTrusted) void requireContentSources().catch(() => undefined)
  log(
    `Modkit MK3 ${String((context.extension.packageJSON as { version?: unknown }).version)} activated in ` +
      `${activationMs} ms: ${host.extensions.bundled.length} bundled and ` +
      `${host.extensions.installed.length} installed extension roots, ` +
      `${host.extensions.failures.length} failed, ${host.contributions.length} contributions`,
  )
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
    languageRoutes: Object.freeze(
      languageRoutes.map(
        route => `${route.languageId}:${route.documentKind}:${route.extension ?? '*'}`,
      ),
    ),
    completionTriggerCharacters,
    signatureHelpTriggerCharacters,
    runtime: runtimeDebug,
    facilities: () => facilityReport,
    diagnostics: () => journal.lines(),
  })
}

export async function deactivate(): Promise<void> {
  const shutdown = activeLanguageShutdown
  activeLanguageShutdown = undefined
  await shutdown?.()
}
