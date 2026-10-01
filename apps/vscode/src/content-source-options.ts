/**
 * `modkit.contentSourceOptions`: the options each extension's content-source module gets, written
 * in settings so that a team commits them (plan 8.9; the owner chose `settings.json`).
 *
 * The scopes combine as MK2's `modkit.sources` did — a project adds to the user's sources rather
 * than replacing them: objects merge key by key, the more specific scope winning, and lists chain
 * user first, then workspace, then folder. Ordering and dropping entries of such a list is the
 * module's own rule (MK2's `priority` and `disabled`), not this app's. Path tokens expand so the
 * committed file names no machine's absolute path. DOM- and vscode-free.
 */

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }
type JsonObject = { readonly [key: string]: Json }

/** What a token may refer to. */
export interface OptionTokens {
  readonly workspaceFolders: readonly { readonly name: string; readonly path: string }[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly userHome: string
}

/** `inspect()` of the setting, least specific first. */
export interface ScopedValues {
  readonly globalValue?: unknown
  readonly workspaceValue?: unknown
  readonly workspaceFolderValue?: unknown
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `later` over `earlier`: objects key by key, lists chained, anything else replaced. */
export function mergeOptions(earlier: Json | undefined, later: Json): Json {
  if (Array.isArray(earlier) && Array.isArray(later)) return [...earlier, ...later]
  if (isObject(earlier) && isObject(later)) {
    const merged: Record<string, Json> = { ...earlier }
    for (const [key, value] of Object.entries(later))
      merged[key] = mergeOptions(earlier[key], value)
    return merged
  }
  return later
}

/**
 * Every string with its `${workspaceFolder}`, `${workspaceFolder:Name}`, `${env:VAR}` and
 * `${userHome}` replaced. A token that names nothing leaves its string out — an option resting on a
 * folder this window does not have must not reach the module as a literal `${…}`.
 */
export function expandOptionTokens(value: Json, tokens: OptionTokens): Json | undefined {
  if (typeof value === 'string') {
    let unresolved = false
    const expanded = value.replace(/\$\{([^}]+)\}/gu, (whole, token: string) => {
      const [name, argument] = token.split(':', 2)
      const replacement =
        name === 'workspaceFolder'
          ? argument === undefined
            ? tokens.workspaceFolders[0]?.path
            : tokens.workspaceFolders.find(folder => folder.name === argument)?.path
          : name === 'env' && argument !== undefined
            ? tokens.env[argument]
            : name === 'userHome' && argument === undefined
              ? tokens.userHome
              : undefined
      if (replacement === undefined || replacement === '') unresolved = true
      return replacement ?? whole
    })
    return unresolved ? undefined : expanded
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      const expanded = expandOptionTokens(item, tokens)
      return expanded === undefined ? [] : [expanded]
    })
  }
  if (isObject(value)) {
    const expanded: Record<string, Json> = {}
    for (const [key, item] of Object.entries(value)) {
      const next = expandOptionTokens(item, tokens)
      if (next !== undefined) expanded[key] = next
    }
    return expanded
  }
  return value
}

/** The options of one extension (`publisher/id`), merged over the scopes and expanded. */
export function contentSourceOptionsFor(
  scoped: ScopedValues,
  extension: string,
  tokens: OptionTokens,
): Readonly<Record<string, unknown>> | undefined {
  let merged: Json | undefined
  for (const value of [scoped.globalValue, scoped.workspaceValue, scoped.workspaceFolderValue]) {
    const entry = isObject(value) ? value[extension] : undefined
    if (isObject(entry)) merged = mergeOptions(merged, entry)
  }
  if (merged === undefined) return undefined
  const expanded = expandOptionTokens(merged, tokens)
  return isObject(expanded) ? expanded : undefined
}
