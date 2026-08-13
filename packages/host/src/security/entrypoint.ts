/**
 * Entry-point containment (MK3/24 §8: activation runs the *selected* entry point of the
 * artifact — nothing else). An authored `entrypoint` is a relative path inside its own
 * artifact; anything that can escape it is a structured refusal, checked before any
 * import and independently of the schema (defence in depth: the schema also rejects
 * these shapes, but the host must not rely on someone else having validated the input).
 */

import { ModkitError } from '@modkitx-x3/core'

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const WINDOWS_DRIVE = /^[a-zA-Z]:/

function refuse(entrypoint: string, why: string): ModkitError {
  return new ModkitError({
    code: 'x3.host/entrypoint-not-contained',
    message: `entry point «${entrypoint}» is not a relative path inside the artifact: ${why}`,
    context: { entrypoint, why },
  })
}

/**
 * Validates the authored form. Rejects: any URL scheme (`data:`, `http(s):`, `file:`,
 * `node:`, `blob:`), absolute POSIX/UNC/Windows-drive paths, `..` traversal, backslashes
 * (they are path separators on Windows and would slip past a `/`-only check), and
 * embedded control characters.
 */
export function assertRelativeEntrypoint(entrypoint: string): void {
  if (entrypoint.trim().length === 0) throw refuse(entrypoint, 'empty')
  if (/[\u0000-\u001f\u007f]/.test(entrypoint)) {
    throw refuse(entrypoint, 'contains control characters')
  }
  if (SCHEME.test(entrypoint) && !WINDOWS_DRIVE.test(entrypoint)) {
    throw refuse(entrypoint, 'URL schemes are not allowed')
  }
  if (WINDOWS_DRIVE.test(entrypoint)) throw refuse(entrypoint, 'absolute Windows path')
  if (entrypoint.startsWith('/') || entrypoint.startsWith('\\')) {
    throw refuse(entrypoint, 'absolute path')
  }
  if (entrypoint.includes('\\')) throw refuse(entrypoint, 'use forward slashes')
  if (entrypoint.split('/').includes('..')) throw refuse(entrypoint, '`..` traversal')
}

/**
 * Resolves the entry point against the artifact root and proves the result stayed inside
 * it (belt and braces: catches anything the syntactic check above could miss, including
 * URL-encoded traversal).
 */
export function resolveContainedEntrypoint(baseUrl: URL, entrypoint: string): URL {
  assertRelativeEntrypoint(entrypoint)
  const root = baseUrl.href.endsWith('/') ? baseUrl : new URL(`${baseUrl.href}/`)
  const resolved = new URL(entrypoint, root)
  if (resolved.protocol !== root.protocol) {
    throw refuse(entrypoint, `resolved to a different protocol (${resolved.protocol})`)
  }
  if (!resolved.href.startsWith(root.href)) {
    throw refuse(entrypoint, `resolved outside the artifact root (${root.href})`)
  }
  return resolved
}
