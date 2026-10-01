/**
 * The two locale commands MK2 had beside its strings table — the translation gaps of every bound
 * locale, and the strings changed since a git revision — over the codec's own comparison
 * (`TableActions.compareVariants`). DOM- and vscode-free: the extension asks and shows.
 */
import { execFile } from 'node:child_process'
import { isAbsolute, relative } from 'node:path'
import type { TableColumnInfo, TableVariantComparison } from '@modkit/sdk'

/** What git printed, or a rejection carrying its stderr; never through a shell. */
export function gitText(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error === null) resolve(stdout)
        else reject(Object.assign(new Error(stderr.trim() || error.message), { stderr }))
      },
    )
  })
}

/** A text without the byte-order mark git hands back and a decoder would have dropped. */
export function withoutByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** What the comparison answers when given an earlier text of the file (`since`). */
export interface StringChangesAnswer {
  readonly locale: string
  readonly since?: string
  readonly added: number
  readonly modified: number
  readonly deleted: number
  /** The added and modified keys with their new values, as a `key=value` file for a translator. */
  readonly staged: string
}

/** The locales a gap report covers: every variant column but the base the others translate. */
export function comparedLocales(columns: readonly TableColumnInfo[]): readonly string[] {
  const variants = columns.filter(
    column => column.role === 'variant' && column.variant !== undefined,
  )
  const base = variants.find(column => column.base === true) ?? variants[0]
  return variants.flatMap(column =>
    column === base || column.variant === undefined ? [] : [column.variant],
  )
}

/** Whether a locale's comparison found anything to translate or remove. */
export function hasGaps(value: TableVariantComparison): boolean {
  return (
    value.missing.length + value.identical.length + value.empty.length + value.orphaned.length > 0
  )
}

/**
 * The git object of `file` at `ref`: `<ref>:<path from the repository top level>`, with forward
 * slashes as git spells it. Undefined when the file is not inside that repository.
 */
export function gitShowSpec(ref: string, topLevel: string, file: string): string | undefined {
  const path = relative(topLevel, file)
  if (path === '' || path.startsWith('..') || isAbsolute(path)) return undefined
  return `${ref}:${path.replaceAll('\\', '/')}`
}

/** A revision a reader typed, or nothing usable: a ref, a tag or a hash, never an option. */
export function gitRevision(value: string | undefined): string | undefined {
  const ref = value?.trim()
  return ref === undefined || ref === '' || ref.startsWith('-') || /\s/u.test(ref) ? undefined : ref
}

/** Git's answer when the file did not exist at that revision: every key of it is new since. */
export function missingAtRevision(stderr: string): boolean {
  return /exists on disk, but not in|does not exist in|path '.*' does not exist/iu.test(stderr)
}
