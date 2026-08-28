/**
 * Focused Product GA replacements for the settings exposed by the legacy VS Code extension.
 *
 * This is deliberately a mapping, not a second settings model.  Portable values point at the
 * shared `SettingsDocument`; provider-specific values live in extension options; host policies are
 * automatic; and one-shot actions point at the shared workbench command that performs them.
 */

export type PrioritySettingReplacementKind =
  'portable-setting' | 'provider-option' | 'automatic-policy' | 'shared-workflow'

export interface PrioritySettingReplacement {
  readonly legacyKey: string
  readonly kind: PrioritySettingReplacementKind
  readonly target: string
  readonly reason: string
}

const replacement = (
  legacyKey: string,
  kind: PrioritySettingReplacementKind,
  target: string,
  reason: string,
): PrioritySettingReplacement => Object.freeze({ legacyKey, kind, target, reason })

/**
 * Exact, reviewable closure of `vscode-priority-settings`.
 *
 * The order is lexical so generated migration checks can compare it without a hidden normaliser.
 * A key not present here is not silently accepted as a Product GA replacement.
 */
export const FOCUSED_PRIORITY_SETTING_REPLACEMENTS: readonly PrioritySettingReplacement[] =
  Object.freeze([
    replacement(
      'modkit.autoDetectInstall',
      'automatic-policy',
      'common.game/installation-discovery@1',
      'Installed games are discovered by the selected game provider and can still be overridden by portable configured paths.',
    ),
    replacement(
      'modkit.builtinMods',
      'provider-option',
      'SettingsDocument.extensions[].options.builtinSources',
      'A game extension owns its source vocabulary; the host only persists the opaque provider option.',
    ),
    replacement(
      'modkit.casc.autoLoadForProjects',
      'shared-workflow',
      'modkit.source.select',
      'A source is selected explicitly for a workspace instead of being mounted by an editor-specific startup branch.',
    ),
    replacement(
      'modkit.casc.installations',
      'portable-setting',
      'SettingsDocument.gameInstallations',
      'Manual installation roots use the same qualified-game map in every host.',
    ),
    replacement(
      'modkit.dataPath',
      'shared-workflow',
      'modkit.source.select',
      'Data roots are normal content sources selected through the shared source lifecycle.',
    ),
    replacement(
      'modkit.disabledMods',
      'portable-setting',
      'SettingsDocument.disabledContributions',
      'The portable contribution switch replaces an app-owned list of disabled mods.',
    ),
    replacement(
      'modkit.documentDiagnosticsDelay',
      'automatic-policy',
      'language-session.debounce',
      'The language controller owns bounded diagnostic scheduling and cancellation.',
    ),
    replacement(
      'modkit.documentUpdateDelay',
      'automatic-policy',
      'language-session.document-version',
      'Document versions cancel stale work, so an editor-specific update timer is unnecessary.',
    ),
    replacement(
      'modkit.enable',
      'portable-setting',
      'SettingsDocument.extensions[].enabled',
      'Extensions are enabled or disabled by identity in the portable settings document.',
    ),
    replacement(
      'modkit.gameInstallations',
      'portable-setting',
      'SettingsDocument.gameInstallations',
      'All hosts share one qualified-game installation override map.',
    ),
    replacement(
      'modkit.gamedata.useLsp',
      'automatic-policy',
      'common.language/provider@1',
      'Language support activates when a matching provider resolves; VS Code does not own a second parser switch.',
    ),
    replacement(
      'modkit.games.codecOverrides',
      'provider-option',
      'SettingsDocument.extensions[].options.codecOverrides',
      'Game-specific codec choices remain provider-owned opaque options.',
    ),
    replacement(
      'modkit.launch.gameLogsPath',
      'provider-option',
      'SettingsDocument.extensions[].options.launch.gameLogsPath',
      'The SC2 launch provider interprets its own optional log location.',
    ),
    replacement(
      'modkit.launch.installDir',
      'portable-setting',
      'SettingsDocument.gameInstallations',
      'The launch workflow consumes the selected confirmed installation instead of a second install path.',
    ),
    replacement(
      'modkit.launch.mapPath',
      'shared-workflow',
      'modkit.game.launch-active-map',
      'The active map is an explicit command subject and is never a stale global path.',
    ),
    replacement(
      'modkit.launch.warnIfRunning',
      'automatic-policy',
      'game-launch.confirm-side-effect',
      'Every native launch requires an explicit side-effect confirmation, whether the game is already running or not.',
    ),
    replacement(
      'modkit.locale',
      'provider-option',
      'SettingsDocument.extensions[].options.locale',
      'Locale vocabulary belongs to the selected game or language provider.',
    ),
    replacement(
      'modkit.log.categories',
      'shared-workflow',
      'modkit.diagnostics.export',
      'Structured diagnostics are filtered and exported from the workbench instead of hidden in an OutputChannel.',
    ),
    replacement(
      'modkit.log.level',
      'shared-workflow',
      'modkit.diagnostics.export',
      'Severity is part of the structured diagnostic record and its export workflow.',
    ),
    replacement(
      'modkit.maxGraphHops',
      'automatic-policy',
      'relation-graph.request-budget',
      'Relation traversal is bounded per request by the shared graph source.',
    ),
    replacement(
      'modkit.modelPreview.renderer',
      'automatic-policy',
      'PresentationPlan.viewer-eligibility',
      'The presentation resolver selects an eligible renderer and publishes a named fallback.',
    ),
    replacement(
      'modkit.s2mod.sources',
      'shared-workflow',
      'modkit.source.select',
      'SC2 mod roots are selected through the same source lifecycle as other content roots.',
    ),
    replacement(
      'modkit.sources',
      'shared-workflow',
      'modkit.source.select',
      'Content roots are selected and removed through one source lifecycle.',
    ),
    replacement(
      'modkit.treeview.visible',
      'shared-workflow',
      'modkit.showHostProfile',
      'The generic workbench controls its visible views without a persisted legacy tree switch.',
    ),
    replacement(
      'modkit.xsdPath',
      'provider-option',
      'SettingsDocument.extensions[].options.schemaRoots',
      'Schema locations belong to language providers and stay opaque to the host.',
    ),
  ])

const replacementsByKey = new Map(
  FOCUSED_PRIORITY_SETTING_REPLACEMENTS.map(item => [item.legacyKey, item] as const),
)

/** Resolve one legacy key without guessing for keys outside the accepted focused closure. */
export function focusedPrioritySettingReplacement(
  legacyKey: string,
): PrioritySettingReplacement | undefined {
  return replacementsByKey.get(legacyKey)
}
