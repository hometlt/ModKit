/**
 * Per-codec "open by default", expressed as `workbench.editorAssociations`.
 *
 * The owner's decision of 2026-09-01 puts the control on the codec, not on a curated list of
 * formats: an enabled codec is the default viewer for its own formats unless the user turns that
 * one codec's default off, or overrides the association with VS Code's own «Open With → Set
 * Default». Both of those are honoured here, and the second one is the harder half — a sync that
 * simply wrote its wishes every activation would silently undo the user's native choice.
 *
 * So this module plans rather than writes. It is deliberately free of `vscode`: what it produces is
 * the next association map plus the reason for every entry it added, removed or refused to touch,
 * which is what the extension writes and what the tests assert.
 */

/** One codec, as the planner needs it: an id, a switch position, and the formats it claims. */
export interface AssociationContribution {
  readonly id?: string
  readonly disabled: boolean
  readonly fileExtensions: readonly string[]
  readonly anchorFileNames?: readonly string[]
  /** File names the codec matches by path (`DocumentHeader`, `Objects`). */
  readonly pathFileNames?: readonly string[]
}

export interface AssociationInputs {
  readonly contributions: readonly AssociationContribution[]
  /** Contribution ids that stay enabled but must not become the default editor. */
  readonly nonDefault: readonly string[]
  /** `workbench.editorAssociations` as it stands right now. */
  readonly current: Readonly<Record<string, string>>
  /** Patterns this extension wrote last time, so it removes only what it added. */
  readonly managed: readonly string[]
  /** Every view type this extension registers; anything else in the map belongs to someone else. */
  readonly ownViewTypes: readonly string[]
  /** The view type a default association points at. */
  readonly defaultViewType: string
  /** When false, formats VS Code edits as text keep their built-in editor. */
  readonly includeTextFormats: boolean
  /**
   * Extensions of the text languages this extension contributes (`.SC2Style`, `.galaxy`…): with
   * language support of their own, they open as text too unless `includeTextFormats` says otherwise.
   */
  readonly textLanguageExtensions?: readonly string[]
  /** File names those text languages claim (`Objects`, `Preload.xml`); they open as text too. */
  readonly textLanguageFileNames?: readonly string[]
}

export interface AssociationPlan {
  readonly next: Readonly<Record<string, string>>
  readonly added: readonly string[]
  readonly removed: readonly string[]
  /** Patterns left alone because the user pointed them at somebody else's editor. */
  readonly respected: readonly string[]
  /** The new managed set, to be stored for the next run. */
  readonly managed: readonly string[]
  readonly changed: boolean
}

/**
 * Formats VS Code is already the right editor for.
 *
 * This is not a carve-out of "common formats" — the decision explicitly removed that idea, and an
 * enabled image codec does become the default for PNG. It is narrower and about a different thing:
 * these extensions open in a text editor people type into, and taking that over on install would
 * replace editing with viewing. The user can still opt in with `modkit.defaultEditorForTextFormats`,
 * and can always reach Modkit through «Reopen Editor With».
 */
export const TEXT_FIRST_EXTENSIONS: readonly string[] = Object.freeze([
  'cfg',
  'conf',
  'csv',
  'galaxy',
  'htm',
  'html',
  'ini',
  'json',
  'jsonc',
  'log',
  'lua',
  'luau',
  'md',
  'markdown',
  'mdown',
  'mkd',
  'sc2layout',
  'tab',
  'toml',
  'tsv',
  'txt',
  'xml',
  'yaml',
  'yml',
])

/** The file extensions of the languages an extension manifest contributes (`contributes.languages`). */
export function contributedLanguageExtensions(packageJson: unknown): readonly string[] {
  const languages = (packageJson as { contributes?: { languages?: unknown } } | undefined)
    ?.contributes?.languages
  if (!Array.isArray(languages)) return Object.freeze([])
  const extensions = new Set<string>()
  for (const language of languages as { extensions?: unknown }[]) {
    if (!Array.isArray(language.extensions)) continue
    for (const item of language.extensions)
      if (typeof item === 'string') extensions.add(normalizedExtension(item))
  }
  return Object.freeze([...extensions].sort())
}

/**
 * The file names the languages of an extension manifest claim: `filenames`, and the literal names
 * a `filenamePatterns` entry ends with (`{Regions,Attributes}` inside a map folder).
 */
export function contributedLanguageFileNames(packageJson: unknown): readonly string[] {
  const languages = (packageJson as { contributes?: { languages?: unknown } } | undefined)
    ?.contributes?.languages
  if (!Array.isArray(languages)) return Object.freeze([])
  const names = new Set<string>()
  for (const language of languages as { filenames?: unknown; filenamePatterns?: unknown }[]) {
    if (Array.isArray(language.filenames)) {
      for (const item of language.filenames) if (typeof item === 'string') names.add(item)
    }
    if (!Array.isArray(language.filenamePatterns)) continue
    for (const item of language.filenamePatterns) {
      if (typeof item !== 'string') continue
      const last = item.split('/').at(-1) ?? ''
      const choices = /^\{([^{}]*)\}$/u.exec(last)?.[1]?.split(',') ?? [last]
      for (const name of choices) if (name !== '' && !/[*?[\]{}!]/u.test(name)) names.add(name)
    }
  }
  return Object.freeze([...names].sort())
}

const normalizedExtension = (value: string): string => value.replace(/^\./u, '').toLowerCase()

/** The glob VS Code keys an association by. One per file extension, lower case. */
export const associationPattern = (extension: string): string =>
  `*.${normalizedExtension(extension)}`

/** The glob for a file name that carries no extension, matched in any folder. */
export const anchorAssociationPattern = (name: string): string => `**/${name}`

/**
 * Every pattern an enabled, default-eligible codec claims.
 *
 * A format claimed by two codecs, one of them opted out, still gets the association: the opt-out is
 * about that codec, and the other one still wants to be the default for the format.
 */
export function defaultAssociationPatterns(
  inputs: Pick<
    AssociationInputs,
    | 'contributions'
    | 'nonDefault'
    | 'includeTextFormats'
    | 'textLanguageExtensions'
    | 'textLanguageFileNames'
  >,
): readonly string[] {
  const excluded = new Set(inputs.nonDefault)
  const text = new Set([
    ...TEXT_FIRST_EXTENSIONS,
    ...(inputs.textLanguageExtensions ?? []).map(normalizedExtension),
  ])
  const textNames = new Set(inputs.textLanguageFileNames ?? [])
  const patterns = new Set<string>()
  for (const contribution of inputs.contributions) {
    if (contribution.disabled) continue
    if (contribution.id !== undefined && excluded.has(contribution.id)) continue
    for (const extension of contribution.fileExtensions) {
      const normalized = normalizedExtension(extension)
      if (normalized.length === 0) continue
      if (!inputs.includeTextFormats && text.has(normalized)) continue
      patterns.add(associationPattern(normalized))
    }
    // An anchor has no extension, so it keys on its name. VS Code matches an association key as a
    // path glob, so a bare `MapInfo` matches nothing in a folder: it needs a recursive prefix, the
    // way `*.ext` gets one for free. An anchor is never a text-first format either — the codec
    // declared the name precisely because reading the document is not the point.

    for (const name of contribution.anchorFileNames ?? []) {
      if (name.length > 0) patterns.add(anchorAssociationPattern(name))
    }
    // A name matched by path keys on itself the same way, unless it is text: a text format by its
    // extension (`Preload.xml`), or a name one of this extension's text languages claims (`Objects`).
    for (const name of contribution.pathFileNames ?? []) {
      const dot = name.lastIndexOf('.')
      const extension = dot < 0 ? '' : normalizedExtension(name.slice(dot + 1))
      if (!inputs.includeTextFormats && (textNames.has(name) || text.has(extension))) continue
      if (name.length > 0) patterns.add(anchorAssociationPattern(name))
    }
  }
  return Object.freeze([...patterns].sort())
}

export function planEditorAssociations(inputs: AssociationInputs): AssociationPlan {
  const own = new Set(inputs.ownViewTypes)
  const wanted = defaultAssociationPatterns(inputs)
  const next = new Map(Object.entries(inputs.current))
  const added: string[] = []
  const removed: string[] = []
  const respected: string[] = []
  const managed = new Set<string>()

  for (const pattern of wanted) {
    const existing = inputs.current[pattern]
    if (existing === undefined) {
      next.set(pattern, inputs.defaultViewType)
      added.push(pattern)
      managed.add(pattern)
      continue
    }
    if (own.has(existing)) {
      // Ours already, whether we wrote it or the user chose it through «Set Default». Keep it, and
      // keep managing it, so turning the codec's default off can put it back.
      managed.add(pattern)
      continue
    }
    // Somebody else's editor. The user said so with VS Code's own mechanism; leave it alone.
    respected.push(pattern)
  }

  for (const pattern of inputs.managed) {
    if (managed.has(pattern)) continue
    const existing = inputs.current[pattern]
    if (existing !== undefined && own.has(existing)) {
      next.delete(pattern)
      removed.push(pattern)
      continue
    }
    // The user repointed or deleted it; it is no longer ours to remove or to remember.
  }

  return Object.freeze({
    next: Object.freeze(Object.fromEntries(next)),
    added: Object.freeze(added),
    removed: Object.freeze(removed.sort()),
    respected: Object.freeze(respected),
    managed: Object.freeze([...managed].sort()),
    changed: added.length > 0 || removed.length > 0,
  })
}
