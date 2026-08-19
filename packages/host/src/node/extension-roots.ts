/**
 * Loading extension roots without letting one bad root take the application down (S12).
 *
 * `loadExtensionDirectory` throws: the right behaviour for a build step that must not proceed on a
 * malformed artifact, the wrong behaviour for a product that just read a user's extension list.
 * A directory the user moved, renamed or broke must leave the other extensions loaded and the
 * application running, with the failure stated — not swallowed, and not fatal.
 *
 * This module is that policy in one place:
 *  - each root is loaded independently; a failure becomes a record, never an exception;
 *  - the execution decision is per group, made by the caller and never inferred: first-party
 *    bundled roots may be admitted to the in-process boundary, user-installed ones never are
 *    (the gate refuses `trusted-in-process` without `allowTrustedInProcess`, and this keeps
 *    products from setting it by accident);
 *  - two roots claiming the same extension coordinate are a conflict: the first wins and the
 *    second is reported, because silently loading both would make resolution order the authority;
 *  - a directory that carries no authored container is not an extension. The loader is content to
 *    return an inert artifact for it; a product must not be, or a user who picked the wrong folder
 *    sees a silent success and an application that gained nothing.
 */

import { ModkitError } from '@modkitx-x3/core'
import type { ExtensionInput, ExtensionOrigin } from '../inventory.js'
import { loadExtensionDirectory } from './loader.js'

export interface ExtensionRootRequest {
  /** Absolute path of the extension directory. */
  readonly root: string
  /** Identity the caller expected (from a settings entry); mismatches are reported, not enforced. */
  readonly expectedId?: string
}

export interface ExtensionRootFailure {
  readonly root: string
  readonly code: string
  readonly message: string
}

export interface LoadedExtensionRoots {
  /** Inputs for `createHostComposition`/`createNodeSubjectServices`, in request order. */
  readonly inputs: readonly ExtensionInput[]
  /** One record per root that did not load, or loaded into a conflict. */
  readonly failures: readonly ExtensionRootFailure[]
  /** Coordinate (`publisher/id`) of every loaded root, in the same order as `inputs`. */
  readonly coordinates: readonly string[]
}

export interface LoadExtensionRootsOptions {
  /** How the host obtained these roots; `installed`/`linked` never reach the in-process boundary. */
  readonly origin: ExtensionOrigin
  /**
   * Explicit decision to admit these exact artifacts to the unsandboxed boundary. Only meaningful
   * for `bundled` roots; anything else is refused here rather than at the gate, so a product
   * cannot hand a user's directory full process authority by passing the wrong flag.
   */
  readonly allowTrustedInProcess?: boolean
  /** Coordinates already claimed (a bundled catalog loaded first); duplicates are reported. */
  readonly claimed?: readonly string[]
  readonly signal?: AbortSignal
}

/** `publisher/id` from the authored container (`package.json#modkit` or `modkit.extension.json`). */
function coordinateOf(input: ExtensionInput): string | undefined {
  const blocks = [
    (input.containers.packageJson as { readonly modkit?: unknown } | undefined)?.modkit,
    input.containers.standalone,
  ]
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const authored = block as { readonly publisher?: unknown; readonly id?: unknown }
    if (typeof authored.publisher === 'string' && typeof authored.id === 'string') {
      return `${authored.publisher}/${authored.id}`
    }
  }
  return undefined
}

const messageOf = (error: unknown): string =>
  error instanceof ModkitError || error instanceof Error ? error.message : String(error)

const codeOf = (error: unknown): string =>
  error instanceof ModkitError ? error.code : 'x3.host/extension-root-unreadable'

/**
 * Load every requested root, keeping what loads and reporting what does not.
 *
 * `allowTrustedInProcess: true` is accepted only together with `origin: 'bundled'`; any other
 * combination throws here, because that mistake is a product bug, not a user's broken directory.
 */
export async function loadExtensionRoots(
  requests: readonly (ExtensionRootRequest | string)[],
  options: LoadExtensionRootsOptions,
): Promise<LoadedExtensionRoots> {
  const trusted = options.allowTrustedInProcess === true
  if (trusted && options.origin !== 'bundled') {
    throw new ModkitError({
      code: 'x3.host/extension-trust-misdeclared',
      message: `only bundled roots may be admitted in-process; «${options.origin}» roots may not`,
      context: { origin: options.origin },
    })
  }
  const inputs: ExtensionInput[] = []
  const failures: ExtensionRootFailure[] = []
  const coordinates: string[] = []
  const claimed = new Set(options.claimed ?? [])
  for (const request of requests) {
    const item = typeof request === 'string' ? { root: request } : request
    let loaded: ExtensionInput
    try {
      loaded = await loadExtensionDirectory(
        item.root,
        options.signal === undefined ? undefined : options.signal,
      )
    } catch (error) {
      failures.push({ root: item.root, code: codeOf(error), message: messageOf(error) })
      continue
    }
    const coordinate = coordinateOf(loaded)
    if (coordinate === undefined) {
      failures.push({
        root: item.root,
        code: 'x3.host/extension-not-an-extension',
        message:
          'no authored container: the directory has neither package.json#modkit nor modkit.extension.json',
      })
      continue
    }
    if (claimed.has(coordinate)) {
      failures.push({
        root: item.root,
        code: 'x3.host/extension-coordinate-conflict',
        message: `«${coordinate}» is already loaded from another root; this one is ignored`,
      })
      continue
    }
    if (item.expectedId !== undefined && item.expectedId !== coordinate) {
      failures.push({
        root: item.root,
        code: 'x3.host/extension-identity-mismatch',
        message: `configured as «${item.expectedId}» but the directory declares «${coordinate}»`,
      })
      continue
    }
    claimed.add(coordinate)
    coordinates.push(coordinate)
    inputs.push({
      ...loaded,
      execution: { origin: options.origin, allowTrustedInProcess: trusted },
    })
  }
  return Object.freeze({
    inputs: Object.freeze(inputs),
    failures: Object.freeze(failures),
    coordinates: Object.freeze(coordinates),
  })
}
