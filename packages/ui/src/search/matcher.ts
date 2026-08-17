/**
 * Text matching for filter and search surfaces.
 *
 * Ported from MK2 `apps/modkit-vscode/src/webview/text-filter.ts` (`compileMatcher`/`textMatches`)
 * and `src/strings-search.ts` (`plainSearchRanges`), plus the glob behaviour of
 * `src/archive-search.ts`. Semantics are preserved exactly:
 *
 *   - empty query matches everything (MK2 `null`)
 *   - an invalid regular expression matches nothing (MK2 `false`)
 *   - whole-word plain matching re-scans past a rejected hit rather than stopping
 *   - whole-word regex matching wraps the source in `(?<![A-Za-z0-9_])…(?![A-Za-z0-9_])`
 *
 * The callback-style `onError` parameter is replaced by a typed `invalid` result; nothing else
 * about the behaviour changed. See PORTED.md.
 */

export type SearchMode = 'plain' | 'regex' | 'glob'

export interface SearchOptions {
  readonly caseSensitive?: boolean
  readonly wholeWord?: boolean
  readonly mode?: SearchMode
}

export type CompiledSearch =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly message: string }
  | {
      readonly kind: 'plain'
      readonly needle: string
      readonly caseSensitive: boolean
      readonly wholeWord: boolean
    }
  | { readonly kind: 'regex'; readonly regex: RegExp }

export interface MatchRange {
  readonly start: number
  readonly end: number
}

const WORD = /[A-Za-z0-9_]/u

function isWordChar(character: string): boolean {
  return character.length > 0 && WORD.test(character)
}

function hasWordBoundary(text: string, start: number, end: number): boolean {
  return !isWordChar(text.charAt(start - 1)) && !isWordChar(text.charAt(end))
}

function wholeWordSource(source: string): string {
  return `(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])`
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$+?.()|[\]{}*]/gu, '\\$&')
}

/** MK2 `archive-search`: a bare query is a substring match, `*` turns it into an anchored glob. */
function globSource(query: string): string {
  return `^${query.split('*').map(escapeRegExp).join('.*')}$`
}

export function compileSearch(query: string, options: SearchOptions = {}): CompiledSearch {
  const caseSensitive = options.caseSensitive ?? false
  const wholeWord = options.wholeWord ?? false
  const mode = options.mode ?? 'plain'
  if (query.length === 0) return { kind: 'empty' }

  if (mode === 'glob') {
    if (!query.includes('*')) {
      return {
        kind: 'plain',
        needle: caseSensitive ? query : query.toLowerCase(),
        caseSensitive,
        wholeWord,
      }
    }
    try {
      return { kind: 'regex', regex: new RegExp(globSource(query), caseSensitive ? 'u' : 'iu') }
    } catch (error) {
      return { kind: 'invalid', message: describe(error) }
    }
  }

  if (mode === 'plain') {
    return {
      kind: 'plain',
      needle: caseSensitive ? query : query.toLowerCase(),
      caseSensitive,
      wholeWord,
    }
  }

  try {
    const source = wholeWord ? wholeWordSource(query) : query
    return { kind: 'regex', regex: new RegExp(source, caseSensitive ? 'u' : 'iu') }
  } catch (error) {
    return { kind: 'invalid', message: describe(error) }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Invalid regular expression'
}

export function matches(text: string, compiled: CompiledSearch): boolean {
  switch (compiled.kind) {
    case 'empty':
      return true
    case 'invalid':
      return false
    case 'regex':
      return compiled.regex.test(text)
    case 'plain':
      return matchRanges(text, compiled, true).length > 0
    default:
      return false
  }
}

/** Every match, or only the first. Used for highlighting and for the match counter. */
export function matchRanges(
  text: string,
  compiled: CompiledSearch,
  firstOnly = false,
): readonly MatchRange[] {
  if (compiled.kind === 'empty' || compiled.kind === 'invalid') return []

  if (compiled.kind === 'regex') {
    const ranges: MatchRange[] = []
    const scanner = new RegExp(
      compiled.regex.source,
      compiled.regex.flags.includes('g') ? compiled.regex.flags : `${compiled.regex.flags}g`,
    )
    let guard = 0
    for (const match of text.matchAll(scanner)) {
      if (match.index === undefined) continue
      const end = match.index + match[0].length
      ranges.push({ start: match.index, end })
      if (firstOnly) break
      // A zero-length match would otherwise spin forever on the same index.
      if (match[0].length === 0) break
      guard += 1
      if (guard > 10_000) break
    }
    return ranges
  }

  const needle = compiled.needle
  if (needle.length === 0) return []
  const haystack = compiled.caseSensitive ? text : text.toLowerCase()
  const ranges: MatchRange[] = []
  let at = haystack.indexOf(needle)
  while (at >= 0) {
    const end = at + needle.length
    if (!compiled.wholeWord || hasWordBoundary(text, at, end)) {
      ranges.push({ start: at, end })
      if (firstOnly) break
    }
    at = haystack.indexOf(needle, at + Math.max(1, needle.length))
  }
  return ranges
}

/** Convenience for list filtering: compile once, test many. */
export function createFilter(
  query: string,
  options: SearchOptions = {},
): (text: string) => boolean {
  const compiled = compileSearch(query, options)
  return text => matches(text, compiled)
}
