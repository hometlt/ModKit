/**
 * A path → subject opener for Node hosts (S9): the serving side of the subject RPC needs a
 * `SubjectOpener` that turns a requested path into an opened subject and an inert snapshot. This
 * is that policy object for files on disk — confinement to configured roots (a request outside
 * them is refused before any stat), the S7 file adapter (revision-pinned reads), the host's
 * `subjects.open` under a grant and budget the host chooses, and the snapshot the RPC carries
 * (descriptor, selection, candidates, diagnostics; the session itself stays a capability).
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Diagnostic } from '@modkitx-x3/core'
import type { PermissionGrant, ResourceBudget } from '@modkitx-x3/sdk'
import type { SubjectServices } from '../subject-services.js'
import type { Inventory } from '../inventory.js'
import type { OpenedSubject, SubjectInputResolver } from '../subject-open.js'
import type { SubjectOpener, SubjectOpenSnapshot } from '../subject-rpc.js'
import { createCompanionInputResolver, createSignatureTraitProbe } from '../input-resolution.js'
import { createFilesystemCompanionOrigin } from './companion-origin.js'
import { openFileArtifactSource } from './file-artifact-source.js'

export interface PathSubjectOpenerOptions {
  readonly subjects: SubjectServices
  /** Absolute directories requests may name; a path outside every root is refused. */
  readonly roots: readonly string[]
  /** The grant every open runs under (default: `read-source` only). */
  readonly grant?: PermissionGrant
  readonly budget?: ResourceBudget
  readonly intent?: 'inspect' | 'full'
  readonly sessionId?: () => string
  /**
   * Called with the opened subject just before its snapshot is returned, and only for an open that
   * resolved. A host that composes editing needs the `OpenedSubject` itself, which is otherwise
   * dropped here; the session id is the key an editing policy is keyed by.
   */
  onOpened?(opened: OpenedSubject, sessionId: string): void
}

export const DEFAULT_SUBJECT_OPEN_BUDGET: ResourceBudget = Object.freeze({
  maxInputBytes: BigInt(64 * 1024 * 1024),
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxScalarBytes: 64 * 1024 * 1024,
  maxDiagnostics: 10_000,
  deadlineMs: 30_000,
})

function inside(roots: readonly string[], path: string): boolean {
  return roots.some(root => {
    const rel = relative(root, path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

export interface FilesystemInputResolverOptions {
  /** Absolute path of the subject being opened; its directory becomes the confined root. */
  readonly primaryPath: string
  /** Absolute directories the product granted; a subject outside every one of them is refused. */
  readonly roots: readonly string[]
  /** The inventory the subject is resolved against, for bounded `expected`-trait validation. */
  readonly inventory: Inventory
  /** Ceiling for the whole resolution, normally the open's own deadline. */
  readonly deadlineMs?: number
  /** Where named non-fatal outcomes go — an absent optional companion, an unserved scope. */
  readonly onDiagnostic?: (item: Diagnostic) => void
}

/**
 * The companion resolver for a subject that lives on disk.
 *
 * Extracted from `createPathSubjectOpener` so a product that opens files its own way can still get
 * the same resolution instead of a second, slightly different one. Electron is exactly that case:
 * its main process opens the byte source itself — it has already decided writability and has its
 * own diagnostics to add — so it cannot use the path opener wholesale, and without this factory it
 * would have had to reassemble the composition by hand and drift from it.
 *
 * A codec asking for a companion receives host-issued bindings: identity it may read under the
 * `read-source` it already holds, and no directory handle, no roots list, and no way to name a file
 * the host did not select for it.
 */
export function createFilesystemInputResolver(
  options: FilesystemInputResolverOptions,
): SubjectInputResolver {
  return createCompanionInputResolver(
    createFilesystemCompanionOrigin({
      primaryPath: options.primaryPath,
      roots: options.roots.map(root => resolve(root)),
    }),
    {
      traitProbe: createSignatureTraitProbe(options.inventory),
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
      ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    },
  )
}

/** The opener a host passes to `exposeSubjectRpc`; refusals throw, so the RPC reports them. */
export function createPathSubjectOpener(options: PathSubjectOpenerOptions): SubjectOpener {
  const roots = options.roots.map(root => resolve(root))
  const grant = options.grant ?? { id: 'subject-rpc', classes: ['read-source'] }
  const budget = options.budget ?? DEFAULT_SUBJECT_OPEN_BUDGET
  const nextId = options.sessionId ?? randomUUID
  return async (requested, signal) => {
    const path = resolve(requested)
    if (roots.length === 0 || !inside(roots, path)) {
      throw new TypeError(`path is outside the granted roots`)
    }
    const source = await openFileArtifactSource(path, signal === undefined ? {} : { signal })
    /*
     * The subject came from a real place on disk, and this opener is the last point that still
     * knows where: the directory it sits in, confined to the roots the product granted. That fact
     * is closed over by the resolver: a codec asking for a companion receives host-issued
     * bindings — identity it may read, under the `read-source` it already holds — and no directory
     * handle, no roots list and no way to name a file the host did not select for it.
     */
    const companionDiagnostics: Diagnostic[] = []
    const resolveInput = createFilesystemInputResolver({
      primaryPath: path,
      roots,
      inventory: options.subjects.inventory,
      onDiagnostic: item => companionDiagnostics.push(item),
      ...(budget.deadlineMs === undefined ? {} : { deadlineMs: budget.deadlineMs }),
    })
    const result = await options.subjects.open({
      source,
      path,
      intent: options.intent ?? 'full',
      grant: { ...grant, id: `${grant.id}:${nextId()}` },
      budget,
      resolveInput,
      ...(signal === undefined ? {} : { signal }),
    })
    // an absent optional companion is a fact the caller needs, and the resolver is the only place
    // that knows it; without this the snapshot would say "opened" and nothing else
    const diagnostics = [...result.diagnostics, ...companionDiagnostics].map(item => ({
      code: item.code,
      message: item.message,
    }))
    if (result.state === 'unresolved') {
      const snapshot: SubjectOpenSnapshot = {
        state: 'unresolved',
        reason: result.reason,
        candidates: result.candidates,
        diagnostics,
      }
      return { snapshot }
    }
    const snapshot: SubjectOpenSnapshot = {
      state: 'opened',
      sessionId: nextId(),
      descriptor: result.descriptor as unknown as Record<string, unknown>,
      selected: {
        contributionId: result.selected.contributionId,
        variantId: result.selected.variantId,
        confidence: result.selected.confidence,
      },
      candidates: result.candidates,
      diagnostics,
    }
    /*
     * The opened subject, handed over before the snapshot leaves.
     *
     * A host that also edits needs it: `createSubjectEditing({ opened })` takes the whole
     * `OpenedSubject`, and this function used to keep it — a host had to wrap
     * `SubjectServices.open` and catch the result on its way past, which is a lot of machinery to
     * recover something that was right here. The session id is passed too, because that is the key
     * an editing policy is looked up by on the serving side.
     */
    options.onOpened?.(result, snapshot.sessionId)
    return { snapshot, session: result.session }
  }
}
