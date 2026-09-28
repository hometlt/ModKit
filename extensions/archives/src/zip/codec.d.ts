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

/** The central directory of a whole ZIP in memory; ZIP64 included. */
export function parseZipArchive(bytes: Uint8Array, maxEntries: number): readonly ZipArchiveEntry[]

/** One file entry's bytes out of a whole ZIP in memory (stored or deflate). */
export function extractZipArchiveEntry(
  bytes: Uint8Array,
  entry: ZipArchiveEntry,
): Promise<Uint8Array>

/**
 * The central directory and the host's entry table of a ZIP read by ranges, any size, ZIP64
 * included: an open reads only the tail and the directory; each entry finds its data on first use.
 */
export function readZipByRanges(
  source: ByteRangeSource,
  budget: { readonly maxInputBytes: bigint | number; readonly maxNodes: number },
  signal?: AbortSignal,
): Promise<{
  readonly entries: readonly ZipArchiveEntry[]
  readonly containerEntries: ContainerEntryTable
}>

export const abiVersion: 1
export function createCodec(context: unknown): unknown
