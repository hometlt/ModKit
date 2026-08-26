/**
 * What this host will open, and why it refuses the rest.
 *
 * VS Code hands out a `Uri` for many things that are not files: an unsaved buffer (`untitled:`), a
 * file on a remote machine (`vscode-remote:`), a revision out of source control (`git:`), the
 * editor's own settings storage (`vscode-userdata:`). The subject pipeline below opens bytes from
 * a path on this machine through `openFileArtifactSource`, so everything else has to be refused —
 * and refused *here*, with a sentence the user can act on, rather than deep inside a `stat` that
 * fails with `ENOENT` on a path that never existed.
 *
 * `createPathSubjectOpener` already refuses a path outside the granted roots before it touches the
 * filesystem. This runs before that, because a non-`file:` URI has no path to compare in the first
 * place.
 *
 * Kept free of the `vscode` module so the rule is unit-testable in Node: the two fields this reads
 * are declared structurally, the way `apps/web/src/files.ts` declares the File System Access
 * shapes it consumes.
 */

import { CONTAINER_SCHEME, parseContainerUriText } from './container-uri.js'

/** The two fields of `vscode.Uri` this host reads, plus the identity it prints when refusing. */
export interface UriLike {
  readonly scheme: string
  /** Platform path of a `file:` URI; meaningless for every other scheme, so it is never trusted. */
  readonly fsPath: string
  toString(): string
}

export type OpenTarget =
  | {
      readonly state: 'accepted'
      /**
       * What the subject opener is handed. A platform path for a file; the URI text itself for a
       * container member, which is not a path and has no `fsPath` worth trusting.
       */
      readonly path: string
      readonly kind: 'file' | 'container-entry'
    }
  | { readonly state: 'refused'; readonly reason: string }

/** Schemes worth naming: a generic refusal reads as a bug, a specific one reads as a limit. */
const KNOWN_SCHEMES: Readonly<Record<string, string>> = Object.freeze({
  untitled: 'it has never been written to disk, so there are no bytes to detect a format from',
  'vscode-remote': 'it lives on a remote machine, and this host reads local files only',
  'vscode-userdata': 'it is editor storage, not a workspace file',
  'vscode-vfs': 'it is served by a virtual filesystem extension, not by the local disk',
  git: 'it is a revision out of source control rather than the working-tree file',
  http: 'it is a network resource; save it into the workspace first',
  https: 'it is a network resource; save it into the workspace first',
  output: 'it is an output channel, not a file',
})

/**
 * Decide whether a URI names something this host can open.
 *
 * Accepting yields the platform path the opener will confine against; refusing yields one sentence
 * naming the scheme, so the surface that shows it never has to invent an explanation.
 */
export function describeOpenTarget(uri: UriLike): OpenTarget {
  if (uri.scheme === 'file') {
    if (uri.fsPath.length === 0) {
      return { state: 'refused', reason: `«${uri.toString()}» is a file URI with an empty path` }
    }
    return { state: 'accepted', path: uri.fsPath, kind: 'file' }
  }
  /*
   * The second thing this host opens: one member of a container it can already read.
   *
   * The scheme is served by this extension's own read-only `FileSystemProvider`, so unlike every
   * other non-`file:` scheme above there *is* a route to bytes — through the open container, never
   * through a temporary file on disk. The container's own path is confined exactly as a direct open
   * would be, one layer down, so accepting the URI here grants nothing the window did not have.
   */
  if (uri.scheme === CONTAINER_SCHEME) {
    const location = parseContainerUriText(uri.toString())
    if (location === undefined) {
      return {
        state: 'refused',
        reason: `«${uri.toString()}» is a Modkit container URI that names no container`,
      }
    }
    if (location.entry === '') {
      return {
        state: 'refused',
        reason: 'this URI names the container itself; open the container file to browse it',
      }
    }
    return { state: 'accepted', path: uri.toString(), kind: 'container-entry' }
  }
  const known = KNOWN_SCHEMES[uri.scheme]
  return {
    state: 'refused',
    reason:
      known === undefined
        ? `«${uri.scheme}:» is not a local file scheme, and this host opens local files only`
        : `«${uri.scheme}:» cannot be opened here: ${known}`,
  }
}

/** The refusal sentence, or `undefined` when the URI is openable. Convenience for call sites. */
export function refusalFor(uri: UriLike): string | undefined {
  const target = describeOpenTarget(uri)
  return target.state === 'refused' ? target.reason : undefined
}
