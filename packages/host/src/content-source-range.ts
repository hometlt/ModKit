/**
 * In-process ContentSources range acquisition at the existing VFS→ArtifactSource bridge.
 * The provider owns winning-copy selection, opaque revision and archive lifetime. Host scopes
 * the provider token to the source identity and snapshots inert context through source-bridge.
 * No whole-file fallback, path lookup, native decoder or new source contract lives here.
 * Companion/root callers retain their existing bounded fallback when acquisition is unsupported.
 */
import { throwIfAborted } from '@modkit/core'
import {
  revisionIdFromRef,
  type ArtifactByteSource,
  type AssetSourceRef,
  type Lease,
} from '@modkit/sdk'
import type { ContentSources } from '@modkit/vfs/content-sources'
import { artifactByteSourceFromRandomAccess } from './source-bridge.js'

/** Transfer a pinned native source into one idempotent Host lease; close on failed admission. */
export async function openContentSourceRange(
  sources: Pick<ContentSources, 'openRangeWithContext'>,
  sourceId: string,
  path: string,
  ref: AssetSourceRef,
  signal?: AbortSignal,
): Promise<Lease<ArtifactByteSource> | undefined> {
  throwIfAborted(signal)
  const range = await sources.openRangeWithContext?.(sourceId, path, signal)
  if (range === undefined) return undefined
  let closing: Promise<void> | undefined
  const release = (): Promise<void> =>
    (closing ??= Promise.resolve().then(() => range.source.dispose()))
  try {
    throwIfAborted(signal)
    if (
      typeof range.revision !== 'string' ||
      range.revision.length === 0 ||
      range.revision.length > 65536
    )
      throw new TypeError('Content source range requires a bounded provider revision')
    const value = await artifactByteSourceFromRandomAccess(range.source, {
      ref,
      revision: revisionIdFromRef({
        kind: 'provider-token',
        value: `${ref.id}\0${range.revision}`,
      }),
      ...(signal === undefined ? {} : { signal }),
      ...(range.context === undefined ? {} : { containerContext: range.context }),
    })
    throwIfAborted(signal)
    return Object.freeze({ value, release })
  } catch (error) {
    await release().catch(() => undefined)
    throw error
  }
}
