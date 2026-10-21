/**
 * Types of the core ZIP codec (plain JavaScript beside this file), for the codecs and content
 * sources of ZIP-based games (Warzone `.wz`, BAR `.sdz`, Minecraft `.jar`) that read a ZIP by
 * ranges. One declaration here instead of a `declare module` in every extension.
 */
import type { ContainerEntryTable } from '@modkit/codec-kit'
import type { ByteRangeSource } from '@modkit/sdk'

/** One central-directory record. */
export interface ZipArchiveEntry {
  /** `entry-<index>` in central-directory order. */
  readonly id: string
  /** The confined path; a folder record ends with `/`. */
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly flags: number
  /** 0 stored, 8 deflate, 93 zstd; others are named but not decoded. */
  readonly method: number
  readonly dosTime: number
  readonly dosDate: number
  readonly crc: number
  readonly compressedSize: number
  readonly size: number
  /** Position of the local header; the data starts after it. */
  readonly localOffset: number
  readonly centralOffset: number
  readonly centralLength: number
}

/**
 * Default: unchanged general ZIP reading, including ZIP64 and normalized legacy names.
 * strict-package: fatal UTF-8 names even without bit 11, no path normalization or duplicates,
 * no ZIP64, exact EOCD/directory framing and local/central header agreement.
 * Ratio, aggregate decoded bytes and document-specific budgets remain the caller's policy.
 */
export function parseZipArchive(
  bytes: Uint8Array,
  maxEntries: number,
  options?: {
    readonly policy?: 'strict-package'
    /** Synchronous admission before appending each entry; throw to stop on caller-owned budgets. */
    readonly admitEntry?: (entry: ZipArchiveEntry) => undefined
  },
): readonly ZipArchiveEntry[]

/**
 * One file entry's bytes (stored or deflate); entry must come from this archive's directory.
 * integrity: true additionally checks local/central headers, descriptors and decoded CRC.
 * Default behavior remains unchanged. This does not enforce an aggregate decoded-byte budget.
 */
export function extractZipArchiveEntry(
  bytes: Uint8Array,
  entry: ZipArchiveEntry,
  options?: { readonly integrity?: true },
): Promise<Uint8Array>

/**
 * The central directory and the host's entry table of a ZIP read by ranges, any size, ZIP64
 * included: an open reads only the tail and the directory; each entry finds its data on first use.
 */
export function readZipByRanges(
  source: ByteRangeSource,
  budget: { readonly maxInputBytes: bigint | number; readonly maxNodes: number },
  signal?: AbortSignal,
  options?: { readonly compatibility?: 'legacy-wrapped-entry-count' },
): Promise<{
  readonly entries: readonly ZipArchiveEntry[]
  readonly containerEntries: ContainerEntryTable
  readonly diagnostics: readonly { readonly code: string; readonly severity: 'warning'; readonly message: string; readonly path: readonly string[] }[]
}>

export const abiVersion: 1
export function createCodec(context: unknown): unknown
