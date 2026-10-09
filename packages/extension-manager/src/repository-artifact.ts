/**
 * Extension-manager portable artifact byte boundary for Node and Web. Accepts existing UTF-8
 * repository JSON or its gzip transport without changing v1/v2 manifests. Delegates decompression
 * to codec-kit, bounds decoded document bytes independently of acquisition/file-materialization
 * limits, and preserves cancellation. Callers verify transport digest/trust before decoding and
 * retain original bytes for integrity/cache identity. This module does not normalize schemas,
 * execute extensions, write files, or provide installed-file sharing.
 */
import { decompressBounded } from '@modkit/codec-kit/compression/bounded'
import { ExtensionManagerError } from './schema.js'

export const DEFAULT_REPOSITORY_DOCUMENT_MAX_BYTES = 256 * 1024 * 1024

export interface RepositoryArtifactDecodeOptions {
  readonly maxDocumentBytes?: number
  readonly signal?: AbortSignal
}

/** Decode one verified transport, enforcing the same document ceiling for plain JSON and gzip. */
export async function decodeRepositoryArtifact(
  bytes: Uint8Array,
  options: RepositoryArtifactDecodeOptions = {},
): Promise<Uint8Array> {
  const maximum = options.maxDocumentBytes ?? DEFAULT_REPOSITORY_DOCUMENT_MAX_BYTES
  if (!(bytes instanceof Uint8Array)) throw new TypeError('repository artifact must be bytes')
  if (!Number.isSafeInteger(maximum) || maximum <= 0)
    throw new RangeError('maxDocumentBytes must be a positive safe integer')
  options.signal?.throwIfAborted()
  const limitError = (): ExtensionManagerError => new ExtensionManagerError(
    'extension-manager/artifact-document-limit',
    `repository document exceeds its ${maximum}-byte decoded limit`,
    { maxDocumentBytes: maximum },
  )
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return decompressBounded(bytes, 'gzip', {
      maxOutputBytes: maximum,
      outputLimitError: limitError,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }
  if (bytes.byteLength > maximum) throw limitError()
  return bytes
}
