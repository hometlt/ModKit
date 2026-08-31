/**
 * `contributionManifests` pattern rules and pure expansion (MK3/27 §5.1).
 * Browser-safe: works over a caller-supplied file listing, never touches a filesystem.
 */

import { compareUtf8, diagnostic, type Diagnostic } from '@modkit/core'

function normalize(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path
}

/** Rule 1: one shallow `*` segment max; no `**`, no absolute paths, no `..`. */
export function validateContributionPattern(pattern: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const bad = (message: string) =>
    diagnostics.push(diagnostic('error', 'x3.sdk/invalid-contribution-pattern', message, [pattern]))
  if (pattern.trim().length === 0) bad('empty pattern')
  if (/^([/\\]|[A-Za-z]:)/.test(pattern)) bad('absolute paths are forbidden')
  if (pattern.includes('\\')) bad('use forward slashes')
  if (pattern.split('/').includes('..')) bad('`..` segments are forbidden')
  if (pattern.includes('**')) bad('recursive `**` is forbidden')
  const stars = pattern.split('*').length - 1
  if (stars > 1) bad('at most one shallow `*` is allowed')
  return diagnostics
}

function toRegExp(pattern: string): RegExp {
  const escaped = normalize(pattern)
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*')
  return new RegExp(`^${escaped}$`)
}

export interface ContributionEntry {
  readonly pattern: string
  readonly path: string
}

export interface ExpansionResult {
  /** Matched manifest paths, sorted by canonical UTF-8 comparison (rule 2). */
  readonly entries: readonly ContributionEntry[]
  readonly diagnostics: readonly Diagnostic[]
}

/**
 * Expands declared patterns over a file listing (relative, forward-slash paths):
 * each manifest must match exactly one declaration (rule 3); a pattern with zero
 * matches is an error (no optional groups in v1); files literally named
 * `contribution.manifest.json` that no pattern covers are orphans (rule 4).
 */
export function expandContributionManifests(
  patterns: readonly string[],
  files: readonly string[],
): ExpansionResult {
  const diagnostics: Diagnostic[] = []
  for (const pattern of patterns) diagnostics.push(...validateContributionPattern(pattern))
  if (diagnostics.length > 0) return { entries: [], diagnostics }

  const normalizedFiles = files.map(normalize)
  const regexes = patterns.map(toRegExp)
  const entries: ContributionEntry[] = []

  for (const file of normalizedFiles) {
    const matched: string[] = []
    for (let i = 0; i < patterns.length; i += 1) {
      if ((regexes[i] as RegExp).test(file)) matched.push(patterns[i] as string)
    }
    if (matched.length > 1) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/duplicate-pattern-match',
          `«${file}» matches ${matched.length} declarations`,
          [file],
          { patterns: matched },
        ),
      )
    } else if (matched.length === 1) {
      entries.push({ pattern: matched[0] as string, path: file })
    } else if (file.endsWith('/contribution.manifest.json')) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/orphan-contribution-manifest',
          `«${file}» is not covered by any contributionManifests declaration`,
          [file],
        ),
      )
    }
  }

  for (const pattern of patterns) {
    if (!entries.some(entry => entry.pattern === pattern)) {
      diagnostics.push(
        diagnostic(
          'error',
          'x3.sdk/pattern-without-matches',
          `«${pattern}» matched no files (optional groups do not exist in v1)`,
          [pattern],
        ),
      )
    }
  }

  entries.sort((a, b) => compareUtf8(a.path, b.path))
  return { entries, diagnostics }
}
