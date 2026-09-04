import type {
  AssetSource,
  AssetSourceDescriptor,
  AssetReadOptions,
  SourceRange,
} from '../assets/source.js'
import { throwIfCancelled } from '../assets/cancellation.js'

export interface LegacyByteReader {
  size(): Promise<bigint>
  read(offset: bigint, length: bigint, signal?: AbortSignal): Promise<Uint8Array>
}
/** Adapter around an admitted host byte reader; no filesystem scanning or mounting. */
export function adaptByteSource(
  reader: LegacyByteReader,
  descriptor: AssetSourceDescriptor,
): AssetSource {
  const checkedSize = async () => {
    const value = await reader.size()
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new RangeError('Legacy source size exceeds exact number range')
    return Number(value)
  }
  const readRange = async (range: SourceRange, options?: AssetReadOptions) => {
    throwIfCancelled(options?.cancellation)
    if (
      !Number.isSafeInteger(range.offset) ||
      !Number.isSafeInteger(range.length) ||
      range.offset < 0 ||
      range.length < 0
    )
      throw new RangeError('Invalid legacy byte range')
    const size = await checkedSize()
    const offset = Math.min(range.offset, size),
      length = Math.min(range.length, size - offset)
    if (options?.maxBytes !== undefined && length > options.maxBytes)
      throw new RangeError('Legacy read exceeds maxBytes')
    const controller = new AbortController()
    const subscription = options?.cancellation?.onCancellationRequested(() => controller.abort())
    try {
      const bytes = await reader.read(BigInt(offset), BigInt(length), controller.signal)
      throwIfCancelled(options?.cancellation)
      if (bytes.byteLength !== length)
        throw new RangeError('Host byte reader returned an incomplete range')
      return bytes
    } finally {
      subscription?.dispose()
    }
  }
  return {
    descriptor,
    size: async options => {
      throwIfCancelled(options?.cancellation)
      return checkedSize()
    },
    readRange,
    read: async options => readRange({ offset: 0, length: await checkedSize() }, options),
  }
}
