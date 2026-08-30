/**
 * Exact Focused Product GA replacements for the legacy SC2 authoring surface.
 *
 * The VS Code shell owns only native file associations and routes.  Language analysis stays in
 * `common.language/document-analysis@1`; document semantics stay in codecs and data providers;
 * presentation and editing stay in the shared UI/host contracts.  Keeping the legacy source-unit
 * ids here makes the migration claim reviewable without reviving any app-owned SC2 parser.
 */

export type Sc2AuthoringReplacementOwner =
  | 'manifest-language'
  | 'shared-language-session'
  | 'shared-subject-command'
  | 'shared-presentation'
  | 'game-launch-integration'

export interface Sc2AuthoringReplacement {
  readonly legacySourceUnitId: string
  readonly owner: Sc2AuthoringReplacementOwner
  readonly targets: readonly string[]
  readonly reason: string
}

const replacement = (
  legacySourceUnitId: string,
  owner: Sc2AuthoringReplacementOwner,
  targets: readonly string[],
  reason: string,
): Sc2AuthoringReplacement =>
  Object.freeze({ legacySourceUnitId, owner, targets: Object.freeze([...targets]), reason })

/**
 * Language ids are native VS Code file associations, not claims that the app contains a parser.
 * Galaxy has a matching shared language provider.  The other authored SC2 text formats open via
 * their codecs and the generic subject workbench, which publishes only the stages each descriptor
 * actually supports.
 */
export const FOCUSED_SC2_LANGUAGE_CONTRIBUTIONS = Object.freeze([
  Object.freeze({
    id: 'galaxy',
    aliases: Object.freeze(['SC2 Galaxy Script', 'galaxy']),
    extensions: Object.freeze(['.galaxy']),
    analysis: 'shared-provider',
  }),
  Object.freeze({
    id: 'ini',
    aliases: Object.freeze(['SC2 Hotkeys', 'ini']),
    extensions: Object.freeze(['.SC2Hotkeys', '.sc2hotkeys']),
    analysis: 'subject-workbench',
  }),
  Object.freeze({
    id: 'sc2layout',
    aliases: Object.freeze(['SC2 Layout', 'sc2layout']),
    extensions: Object.freeze(['.SC2Layout', '.sc2layout']),
    analysis: 'subject-workbench',
  }),
  Object.freeze({
    id: 'sc2strings',
    aliases: Object.freeze(['SC2 Localized Strings', 'sc2strings']),
    filenamePatterns: Object.freeze(['**/LocalizedData/**/*.txt', '**/localizeddata/**/*.txt']),
    analysis: 'subject-workbench',
  }),
  Object.freeze({
    id: 'sc2style',
    aliases: Object.freeze(['SC2 Style', 'sc2style']),
    extensions: Object.freeze(['.SC2Style', '.sc2style']),
    analysis: 'subject-workbench',
  }),
  Object.freeze({
    id: 'xml',
    aliases: Object.freeze(['SC2 XML', 'xml']),
    extensions: Object.freeze(['.SC2Lighting', '.sc2lighting']),
    filenames: Object.freeze(['Attributes', 'Objects', 'Regions']),
    analysis: 'subject-workbench',
  }),
] as const)

/**
 * One row for every exact fact in the `vscode-sc2-authoring-launch` shortlist gap.
 *
 * `game-launch-integration` rows name the shared launch command which the game-service slice wires;
 * they are deliberately isolated so this module cannot acquire process-launch behavior.
 */
export const FOCUSED_SC2_AUTHORING_REPLACEMENTS: readonly Sc2AuthoringReplacement[] = Object.freeze(
  [
    replacement(
      'legacy/vscode/command/modkit.gamedata.validateMod',
      'shared-subject-command',
      ['modkit.runCommand', 'subject.validate'],
      'The active data subject enters the same bounded validator used by every host.',
    ),
    replacement(
      'legacy/vscode/command/modkit.gamedata.validateModStrings',
      'shared-subject-command',
      ['modkit.runCommand', 'subject.validate', 'presentation:table'],
      'Localized catalogs use codec validation and the generic bounded table instead of an app-owned report.',
    ),
    replacement(
      'legacy/vscode/command/modkit.launchMap',
      'game-launch-integration',
      ['modkit.game.launchActiveMap'],
      'The game service owns a deterministic launch plan and the native host confirms its side effect.',
    ),
    replacement(
      'legacy/vscode/command/modkit.openLaunchSettings',
      'game-launch-integration',
      ['SettingsDocument.gameInstallations', 'modkit.game.launchActiveMap'],
      'Launch uses the portable selected installation and an explicit command subject instead of private settings.',
    ),
    replacement(
      'legacy/vscode/command/modkit.openModCard',
      'shared-presentation',
      ['modkit.openWith', 'presentation:tree', 'presentation:table', 'presentation:relations'],
      'Resolved mod data is shown through descriptor-published tree, table and relation sources.',
    ),
    replacement(
      'legacy/vscode/command/modkit.showEntityCard',
      'shared-presentation',
      ['modkit.openWith', 'presentation:tree', 'presentation:table', 'presentation:relations'],
      'Entity details and links come from the shared resolved-data sources rather than a VS Code-only card.',
    ),
    replacement(
      'legacy/vscode/command/modkit.showModWiki',
      'shared-presentation',
      ['modkit.openWith', 'presentation:tree', 'presentation:relations'],
      'The resolved subject workbench exposes searchable structure and links without a second wiki model.',
    ),
    replacement(
      'legacy/vscode/command/modkit.strings.extractChanged',
      'shared-presentation',
      ['presentation:text-editor', 'common.edit/writer@1'],
      'Changed strings are saved through the evidence-gated byte-identical SC2 text writer.',
    ),
    replacement(
      'legacy/vscode/command/modkit.strings.openColumns',
      'shared-presentation',
      ['modkit.openWith', 'presentation:table'],
      'String rows use the shared bounded table stage published by the SC2 strings codec.',
    ),
    replacement(
      'legacy/vscode/command/modkit.strings.openText',
      'shared-presentation',
      ['modkit.openWith', 'presentation:text', 'presentation:text-editor'],
      'String source uses the generic text reader and writer-backed text editor.',
    ),
    replacement(
      'legacy/vscode/command/modkit.verifyGalaxyScript',
      'shared-language-session',
      ['language-session.diagnostics', 'subject.validate'],
      'Galaxy diagnostics come from the shared language provider and codec validator.',
    ),
    replacement(
      'legacy/vscode/command/sc2layout.dtree.revealActiveFile',
      'shared-language-session',
      ['language-session.documentSymbols', 'modkit.navigateResource'],
      'Document symbols and native resource navigation replace the private layout selection bridge.',
    ),
    replacement(
      'legacy/vscode/command/sc2layout.dtree.showInTextEditor',
      'shared-presentation',
      ['modkit.navigateResource', 'presentation:text', 'presentation:text-editor'],
      'The selected resource opens in the native editor and shared text stages.',
    ),
    replacement(
      'legacy/vscode/command/sc2layout.dtree.showProperties',
      'shared-presentation',
      ['presentation:tree', 'presentation:metadata'],
      'Layout structure and properties are descriptor-backed generic views.',
    ),
    replacement(
      'legacy/vscode/contribution/configurationDefaults/[sc2layout]',
      'manifest-language',
      ['contributes.languages:sc2layout', 'presentation:text-editor'],
      'The file association is native while editing behavior follows the shared text editor.',
    ),
    replacement(
      'legacy/vscode/contribution/grammars/galaxy',
      'shared-language-session',
      ['common.language/document-analysis@1', 'language-session.semanticTokens'],
      'Provider-owned semantic tokens replace the bundled TextMate grammar.',
    ),
    replacement(
      'legacy/vscode/contribution/grammars/sc2layout',
      'shared-presentation',
      ['subject.validate', 'presentation:text', 'presentation:tree'],
      'The layout codec publishes validated text and structure without embedding an SC2 grammar in the app.',
    ),
    replacement(
      'legacy/vscode/contribution/grammars/sc2strings',
      'shared-presentation',
      ['subject.validate', 'presentation:text', 'presentation:table'],
      'The strings codec publishes validated text and rows without embedding an SC2 grammar in the app.',
    ),
    replacement(
      'legacy/vscode/contribution/grammars/sc2style',
      'shared-presentation',
      ['contributes.languages:sc2style', 'vscode.nativeTextEditor'],
      'SC2 style keeps an honest native text association without claiming an app-owned parser or grammar.',
    ),
    replacement(
      'legacy/vscode/contribution/snippets/galaxy',
      'shared-language-session',
      ['common.language/document-analysis@1', 'presentation:text-editor'],
      'Galaxy authoring remains provider-owned; the app does not carry a second semantic snippet bundle.',
    ),
    replacement(
      'legacy/vscode/language/galaxy',
      'manifest-language',
      ['contributes.languages:galaxy', 'common.language/document-analysis@1'],
      'VS Code identifies Galaxy files and the shared provider supplies analysis.',
    ),
    replacement(
      'legacy/vscode/language/ini',
      'manifest-language',
      ['contributes.languages:ini', 'vscode.nativeTextEditor'],
      'VS Code identifies SC2 hotkey files without claiming semantic analysis that is not provided.',
    ),
    replacement(
      'legacy/vscode/language/sc2layout',
      'manifest-language',
      ['contributes.languages:sc2layout', 'subject.validate'],
      'VS Code identifies SC2 layout files while codecs own validation and structure.',
    ),
    replacement(
      'legacy/vscode/language/sc2strings',
      'manifest-language',
      ['contributes.languages:sc2strings', 'subject.validate'],
      'VS Code identifies localized catalogs while codecs own validation and rows.',
    ),
    replacement(
      'legacy/vscode/language/sc2style',
      'manifest-language',
      ['contributes.languages:sc2style', 'vscode.nativeTextEditor'],
      'VS Code identifies SC2 style files without claiming an app-owned parser.',
    ),
    replacement(
      'legacy/vscode/language/xml',
      'manifest-language',
      ['contributes.languages:xml', 'vscode.nativeTextEditor'],
      'Native XML identification is extended to SC2 files without claiming a dedicated SC2 analyzer.',
    ),
    replacement(
      'legacy/vscode/menu/commandPalette/modkit.openModCard',
      'shared-presentation',
      ['modkit.openWith'],
      'The command palette opens the same generic subject workbench.',
    ),
    replacement(
      'legacy/vscode/menu/editor/context/modkit.launchMap',
      'game-launch-integration',
      ['modkit.game.launchActiveMap'],
      'The explicit launch command is available from the native command palette and editor context.',
    ),
    replacement(
      'legacy/vscode/menu/editor/context/modkit.strings.extractChanged',
      'shared-presentation',
      ['presentation:text-editor', 'common.edit/writer@1'],
      'The writer-backed text stage is the single strings edit surface.',
    ),
    replacement(
      'legacy/vscode/menu/editor/context/modkit.strings.openColumns',
      'shared-presentation',
      ['presentation:table'],
      'The workbench stage picker exposes the generic strings table.',
    ),
    replacement(
      'legacy/vscode/menu/editor/context/modkit.strings.openText',
      'shared-presentation',
      ['presentation:text', 'presentation:text-editor'],
      'The workbench stage picker exposes generic text read and edit views.',
    ),
    replacement(
      'legacy/vscode/menu/editor/context/modkit.verifyGalaxyScript',
      'shared-language-session',
      ['language-session.diagnostics', 'subject.validate'],
      'Native Problems and the shared validator expose Galaxy failures.',
    ),
    replacement(
      'legacy/vscode/menu/editor/title/modkit.launchMap',
      'game-launch-integration',
      ['modkit.game.launchActiveMap'],
      'The explicit launch command replaces every legacy launch menu alias.',
    ),
    replacement(
      'legacy/vscode/menu/editor/title/modkit.strings.extractChanged',
      'shared-presentation',
      ['presentation:text-editor', 'common.edit/writer@1'],
      'The writer-backed text stage replaces the title-bar extraction shortcut.',
    ),
    replacement(
      'legacy/vscode/menu/editor/title/modkit.strings.openColumns',
      'shared-presentation',
      ['presentation:table'],
      'The workbench stage picker replaces the title-bar table shortcut.',
    ),
    replacement(
      'legacy/vscode/menu/editor/title/modkit.strings.openText',
      'shared-presentation',
      ['presentation:text', 'presentation:text-editor'],
      'The workbench stage picker replaces the title-bar text shortcut.',
    ),
    replacement(
      'legacy/vscode/menu/editor/title/modkit.verifyGalaxyScript',
      'shared-language-session',
      ['language-session.diagnostics', 'subject.validate'],
      'Automatic diagnostics and the shared validator replace the title-bar verification shortcut.',
    ),
    replacement(
      'legacy/vscode/menu/explorer/context/modkit.launchMap',
      'game-launch-integration',
      ['modkit.game.launchActiveMap'],
      'Explorer launch uses the same explicit, confirmed game-service command.',
    ),
    replacement(
      'legacy/vscode/menu/explorer/context/modkit.verifyGalaxyScript',
      'shared-language-session',
      ['language-session.diagnostics', 'subject.validate'],
      'Explorer validation uses the shared language and subject validators.',
    ),
    replacement(
      'legacy/vscode/menu/view/title/sc2layout.dtree.revealActiveFile',
      'shared-language-session',
      ['language-session.documentSymbols', 'modkit.navigateResource'],
      'Document symbols and native navigation replace the layout view title action.',
    ),
    replacement(
      'legacy/vscode/menu/view/title/sc2layout.dtree.showInTextEditor',
      'shared-presentation',
      ['modkit.navigateResource', 'presentation:text', 'presentation:text-editor'],
      'Native navigation and shared text stages replace the layout view title action.',
    ),
    replacement(
      'legacy/vscode/menu/view/title/sc2layout.dtree.showProperties',
      'shared-presentation',
      ['presentation:tree', 'presentation:metadata'],
      'Generic tree and metadata stages replace the layout properties action.',
    ),
  ],
)

const replacementsById = new Map(
  FOCUSED_SC2_AUTHORING_REPLACEMENTS.map(row => [row.legacySourceUnitId, row] as const),
)

/** Resolve an exact legacy fact; facts outside the accepted focused shortlist are never guessed. */
export function focusedSc2AuthoringReplacement(
  legacySourceUnitId: string,
): Sc2AuthoringReplacement | undefined {
  return replacementsById.get(legacySourceUnitId)
}
