/**
 * `common.compression/oodle-decoder@1`: RAD Oodle (Kraken, Mermaid, Selkie, Leviathan) block
 * decompression as a separately installed service. The decoder is GPL-derived, so it ships as its
 * own optional extension (owner decision 2026-09-26) and codec-kit carries none; a container codec
 * (Unreal pak, IoStore) resolves the contract when it opens an Oodle entry and refuses that entry
 * with its own diagnostic when no provider is installed.
 */

export const OODLE_DECODER_CONTRACT = 'common.compression/oodle-decoder' as const

export interface OodleBlock {
  readonly compressed: Uint8Array
  /** Exact size of the block once decompressed, as the container records it. */
  readonly decompressedSize: number
}

export interface OodleDecodeRequest {
  /** Every block of one entry in order; one call per entry keeps the RPC count per entry at one. */
  readonly blocks: readonly OodleBlock[]
  readonly signal?: AbortSignal
}

export interface OodleDecoder {
  readonly contract: typeof OODLE_DECODER_CONTRACT
  /** The decompressed blocks in request order, each exactly `decompressedSize` bytes. */
  decompressBlocks(request: OodleDecodeRequest): Promise<readonly Uint8Array[]>
}

declare module './service-contracts.js' {
  interface ContractMap {
    'common.compression/oodle-decoder': { 1: OodleDecoder }
  }

  interface ContractRequestMap {
    'common.compression/oodle-decoder': { 1: { presence: 'forbidden' } }
  }

  interface ContractOfferMap {
    'common.compression/oodle-decoder': { 1: { presence: 'forbidden' } }
  }
}
