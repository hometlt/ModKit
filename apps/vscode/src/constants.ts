/** Identifiers and budgets the VS Code adapter uses in more than one place. */

export const CUSTOM_EDITOR_TYPE = 'modkit.genericAssetPreview'

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
export const STAGE_CUSTOM_EDITOR_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'modkit.hexViewer': 'hex',
  'modkit.imageViewer': 'image',
  'modkit.archiveViewer': 'archive',
})

/** Every view type this extension owns; the association sync never removes anyone else's. */
export const MODKIT_VIEW_TYPES: readonly string[] = Object.freeze([
  CUSTOM_EDITOR_TYPE,
  ...Object.keys(STAGE_CUSTOM_EDITOR_TYPES),
])

export const LANGUAGE_ACTIVATION_BUDGET = Object.freeze({
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 250_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
})

export const RUNTIME_ACTIVATION_BUDGET = Object.freeze({
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 250_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
  deadlineMs: 30_000,
})

export const RUNTIME_SESSION_BUDGET = Object.freeze({
  maxWallTimeMs: 30_000,
  maxTicks: 1_000_000,
  maxMemoryBytes: 512 * 1024 * 1024,
})

export const GAME_DISCOVERY_BUDGET = Object.freeze({
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
})

export const SERVICE_OPERATION_BUDGET = Object.freeze({
  maxInputBytes: 16_777_216n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 1_000,
  deadlineMs: 120_000,
})

export const PACKAGE_INSTALL_GATE_COMMAND = '_modkit.acceptance.packageInstallGate'
/** Whether Resources joins the dependency chain, remembered per workspace. */
export const RESOURCES_CHAIN_KEY = 'modkit.resources.showChain'
export const PACKAGE_INSTALL_GATE_ENV = 'MODKIT_VSCODE_ACCEPTANCE_PACKAGE_GATE'
export const PACKAGE_INSTALL_GATE_GENERATION_ENV = 'MODKIT_VSCODE_ACCEPTANCE_GENERATION'
export const PACKAGE_INSTALL_GATE_ARTIFACT_ENV = 'MODKIT_VSCODE_ACCEPTANCE_ARTIFACT_SHA256'
export const PACKAGE_INSTALL_GATE_CONTINUE_ENV = 'MODKIT_VSCODE_ACCEPTANCE_CONTINUE'
export const PACKAGE_INSTALL_GATE_DISABLED_URI_ENV = 'MODKIT_VSCODE_ACCEPTANCE_DISABLED_URI'
export const FORMAT_SMOKE_WORKSPACE_ROOT_ENV =
  'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_WORKSPACE_ROOT'
export const FORMAT_SMOKE_SC2_ROOT_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_SC2_ROOT'
export const FORMAT_SMOKE_WARZONE_ROOT_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_WARZONE_ROOT'
export const FORMAT_SMOKE_START_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_START'
export const FORMAT_SMOKE_ACK_ENV = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_ACK'
export const ARCHIVE_ACCEPTANCE_START_ENV = 'MODKIT_VSCODE_ACCEPTANCE_ARCHIVE_START'
export const ARCHIVE_ACCEPTANCE_ACK_ENV = 'MODKIT_VSCODE_ACCEPTANCE_ARCHIVE_ACK'
export const MANAGED_PACKAGES_DIRECTORY = 'managed-packages'
export const MANAGED_RELEASE_DESCRIPTOR = 'release.v1.json'
export const MANAGED_RELEASE_CATALOG = 'catalog.v1.json'
export const SELECTED_SOURCES_KEY = 'modkit.selectedContentSources'
/** Accounts this machine last had connected: region and non-secret account id, never a ticket. */
export const BATTLENET_CONNECTIONS_KEY = 'modkit.sources.knownConnections'
/** The last listing read for each account's root, so a new window can show it before connecting. */
export const CATALOGUE_KEY = 'modkit.sources.catalogue'
