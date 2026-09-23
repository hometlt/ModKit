/**
 * One file of an extension artifact, read the way the host trusts it.
 *
 * Data-only contributions name JSON files of their own extension (localization catalogs, knowledge
 * entries). The host confines the authored path to the artifact root, reads the bytes through the
 * application's VFS and admits them only when they match the SHA-256 the trusted loader recorded
 * for that file. No extension module is imported or executed.
 */

import {
  DEFAULT_VFS_LIMITS,
  normalizeVfsPath,
  type VfsMount,
  type VfsOpenOptions,
} from '@modkit/vfs'

import { inventoryRecordFor, type InventoryContribution } from './inventory.js'
import { resolveContainedEntrypoint } from './security/entrypoint.js'

export interface ArtifactVfsPort {
  /** `VirtualFileSystem.openMount` satisfies this port without exposing a native filesystem path. */
  openMount(uri: string, options?: VfsOpenOptions): Promise<VfsMount>
}

export interface ReadAttestedArtifactFileOptions {
  readonly vfs: ArtifactVfsPort
  /** Largest file admitted, in bytes. */
  readonly maxBytes: number
  /** What the file is, for messages: `localization catalog`, `knowledge entries file`. */
  readonly label: string
  /** Injectable for non-WebCrypto test/embedding environments; returns `sha256:<lowercase hex>`. */
  readonly digest?: (bytes: Uint8Array) => Promise<string>
  readonly signal?: AbortSignal
}

const encoder = new TextEncoder()

/** The authored path, normalized and proven to stay inside the artifact root. */
export function confinedArtifactPath(authored: string, artifactRoot: URL, label: string): string {
  if (authored.startsWith('/') || authored.startsWith('\\') || authored.includes('\\')) {
    throw new TypeError(`${label} path must be a portable relative POSIX path`)
  }
  const normalized = normalizeVfsPath(authored)
  if (normalized === '' || !normalized.toLowerCase().endsWith('.json')) {
    throw new TypeError(`${label} path must identify a JSON file`)
  }
  // URL resolution catches encoded traversal (`%2e%2e`) in addition to normalizeVfsPath's
  // literal `..` refusal. The returned URL is deliberately not handed to any parser.
  resolveContainedEntrypoint(artifactRoot, normalized)
  return normalized
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes)
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new TypeError('WebCrypto SHA-256 is unavailable')
  const digest = new Uint8Array(await subtle.digest('SHA-256', copy.buffer))
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/** The exact attested bytes of `authoredPath` in the contribution's artifact, or a thrown reason. */
export async function readAttestedArtifactFile(
  contribution: InventoryContribution,
  authoredPath: string,
  options: ReadAttestedArtifactFileOptions,
): Promise<Uint8Array> {
  const { label, maxBytes } = options
  const record = inventoryRecordFor(contribution)
  if (record === undefined) throw new TypeError(`${label} contribution has no trusted inventory record`)
  const path = confinedArtifactPath(authoredPath, record.artifactRoot, label)
  const expectedDigest = record.fileDigests?.[path]
  if (expectedDigest === undefined) {
    throw new TypeError(`${label} ${path} is absent from the attested artifact file map`)
  }
  const mount = await options.vfs.openMount(record.artifactRoot.href, {
    limits: {
      // Opening an artifact mount may account all of its files (a model pack can legitimately be
      // much larger than one data file), so retain the platform's artifact ceilings here. The exact
      // file size and all bytes actually read remain capped to this file's own ceiling.
      maxEntries: DEFAULT_VFS_LIMITS.maxEntries,
      maxMaterializedBytes: DEFAULT_VFS_LIMITS.maxMaterializedBytes,
      maxFileBytes: DEFAULT_VFS_LIMITS.maxFileBytes,
      maxReadBytes: BigInt(maxBytes),
      maxReadRangeBytes: maxBytes,
      maxStreamBytes: DEFAULT_VFS_LIMITS.maxStreamBytes,
      maxPathBytes: Math.max(256, encoder.encode(path).byteLength),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  try {
    const node = await mount.stat(path, options.signal)
    if (node?.kind !== 'file') throw new TypeError(`${label} ${path} is not a file`)
    if (node.size !== undefined && node.size > BigInt(maxBytes)) {
      throw new TypeError(`${label} ${path} exceeds the ${maxBytes}-byte raw limit`)
    }
    const source = await mount.open(path, options.signal)
    try {
      const size = await source.size(options.signal)
      if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
        throw new TypeError(`${label} ${path} exceeds the ${maxBytes}-byte raw limit`)
      }
      const bytes = await source.readAt(0, size, options.signal)
      const actualDigest = await (options.digest ?? sha256)(bytes)
      if (actualDigest !== expectedDigest) {
        throw new TypeError(`${label} ${path} does not match its attested SHA-256`)
      }
      return bytes
    } finally {
      await source.dispose()
    }
  } finally {
    await mount.dispose()
  }
}
