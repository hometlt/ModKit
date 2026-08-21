import {
  bytesToHex,
  compareBytesUnsigned,
  hexToBytes,
  joinPath,
  readUintBE,
  readUintLE,
  sliceExact,
} from './binary.js'
import { decodeBlte } from './blte.js'
import { cascError, throwIfCancelled } from './limits.js'
function bucketForKey(key, keyLength) {
  let acc = 0
  for (let i = 0; i < keyLength; i++) acc ^= key[i] ?? 0
  return (acc & 0x0f) ^ ((acc >> 4) & 0x0f)
}
function readHashBlock(data, offset) {
  const length = readUintLE(data, offset, 4)
  const start = offset + 8
  return { block: sliceExact(data, start, length, 'CASC hash block'), nextOffset: start + length }
}
function align16(value) {
  return (value + 15) & ~15
}
function parseIndexFile(data) {
  const { block: header, nextOffset } = readHashBlock(data, 0)
  if (header.length < 16) throw new Error('CASC index header is too small')
  const bucketIndex = header[2]
  const fileSizeLength = header[4]
  const dataOffsetLength = header[5]
  const encodingKeyLength = header[6]
  const dataFileSizeBits = header[7]
  const entriesOffset = align16(nextOffset)
  const { block: entriesBlock } = readHashBlock(data, entriesOffset)
  const entryLength = encodingKeyLength + dataOffsetLength + fileSizeLength
  if (entryLength === 0 || entriesBlock.length % entryLength !== 0) {
    throw new Error('CASC index entries block has invalid length')
  }
  const entries = []
  for (let offset = 0; offset < entriesBlock.length; offset += entryLength) {
    const key = entriesBlock.slice(offset, offset + encodingKeyLength)
    const dataOffset = readUintBE(entriesBlock, offset + encodingKeyLength, dataOffsetLength)
    const fileSize = readUintLE(
      entriesBlock,
      offset + encodingKeyLength + dataOffsetLength,
      fileSizeLength,
    )
    entries.push({
      keyBytes: key,
      encodingKey: bytesToHex(key),
      fileSize,
      dataFile: Math.floor(dataOffset / 2 ** dataFileSizeBits),
      dataOffset: dataOffset % 2 ** dataFileSizeBits,
    })
  }
  entries.sort((a, b) => compareBytesUnsigned(a.keyBytes, b.keyBytes))
  if (entries.length > 0 && bucketIndex !== bucketForKey(entries[0].keyBytes, encodingKeyLength)) {
    // Some buckets may be empty or sparse; keep parsing permissive because Blizzard
    // index variants differ across products.
  }
  return { bucketIndex, keyLength: encodingKeyLength, entries }
}
function lowerBoundEntries(entries, keyBytes) {
  let lo = 0
  let hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (compareBytesUnsigned(entries[mid].keyBytes, keyBytes) < 0) lo = mid + 1
    else hi = mid
  }
  return lo
}
function latestIndexByBucket(names) {
  const byBucket = new Map()
  for (const name of names) {
    const base = name.split('/').pop() ?? name
    const match = /^([0-9a-f]{2})([0-9a-f]{8})\.idx$/i.exec(base)
    if (!match) continue
    const bucket = match[1].toLowerCase()
    const version = Number.parseInt(match[2], 16)
    const current = byBucket.get(bucket)
    if (!current || version > current.version) byBucket.set(bucket, { version, name })
  }
  return [...byBucket.values()].sort((a, b) => a.name.localeCompare(b.name)).map(v => v.name)
}
// A stored frame is either a bare BLTE stream, or a 30-byte BLTE_ENCODED_HEADER
// (whose EKey field may be zeroed) followed by the BLTE stream.
const BLTE_ENCODED_HEADER_SIZE = 30
const BLTE_SIGNATURE = [0x42, 0x4c, 0x54, 0x45] // 'BLTE'
function hasBlteSignature(data, offset) {
  return BLTE_SIGNATURE.every((b, i) => data[offset + i] === b)
}
function dataFileName(index) {
  return `data.${String(index).padStart(3, '0')}`
}
export class CascStorage {
  source
  dataRoot
  config
  buckets
  options
  constructor(source, dataRoot, config, buckets, options) {
    this.source = source
    this.dataRoot = dataRoot
    this.config = config
    this.buckets = buckets
    this.options = options
  }
  static async open(source, dataRoot, config, options) {
    throwIfCancelled(options.signal)
    const dataPath = joinPath(dataRoot, 'data')
    const names = await source.list(dataPath)
    const indexNames = latestIndexByBucket(names)
    if (indexNames.length === 0)
      throw cascError('x3.casc/index-missing', 'CASC has no local indexes', { dataPath })
    if (indexNames.length > options.maxIndexFiles) {
      throw cascError('x3.casc/index-file-budget-exceeded', 'CASC has too many local indexes', {
        indexFiles: indexNames.length,
        maxIndexFiles: options.maxIndexFiles,
      })
    }
    const buckets = []
    let indexBytes = 0
    for (const name of indexNames) {
      throwIfCancelled(options.signal)
      const path = name.includes('/') ? name : joinPath(dataPath, name)
      const bytes = await source.get(path)
      indexBytes += bytes.byteLength
      if (indexBytes > options.maxIndexBytes) {
        throw cascError(
          'x3.casc/index-byte-budget-exceeded',
          'CASC indexes exceed their byte budget',
          {
            indexBytes,
            maxIndexBytes: options.maxIndexBytes,
          },
        )
      }
      buckets.push(parseIndexFile(bytes))
    }
    return new CascStorage(source, dataRoot, config, buckets, options)
  }
  findCandidates(encodingKey) {
    const keyBytes = hexToBytes(encodingKey)
    const candidates = []
    for (const bucket of this.buckets) {
      if (bucketForKey(keyBytes, bucket.keyLength) !== bucket.bucketIndex) continue
      const prefixBytes = keyBytes.subarray(0, bucket.keyLength)
      const start = lowerBoundEntries(bucket.entries, prefixBytes)
      for (
        let i = start;
        i < bucket.entries.length &&
        compareBytesUnsigned(bucket.entries[i].keyBytes, prefixBytes) === 0;
        i++
      ) {
        candidates.push(bucket.entries[i])
      }
    }
    return candidates
  }
  find(encodingKey) {
    return this.findCandidates(encodingKey)[0]
  }
  hasEncodingKey(encodingKey) {
    return this.findCandidates(encodingKey).length > 0
  }
  async readEncodingKey(encodingKey, signal) {
    throwIfCancelled(signal)
    const normalizedKey = encodingKey.toLowerCase()
    const entries = this.findCandidates(normalizedKey)
    if (entries.length === 0) {
      throw cascError('x3.casc/encoding-key-not-local', 'CASC encoding key is not local', {
        encodingKey,
      })
    }
    // CascLib trusts the index entry and does not re-verify the container's EKey
    // (it is frequently zeroed for files stored inside data segments). It only locates
    // the BLTE stream: present directly, or after a 30-byte BLTE_ENCODED_HEADER.
    let lastError
    for (const entry of entries) {
      throwIfCancelled(signal)
      const dataPath = joinPath(this.dataRoot, 'data', dataFileName(entry.dataFile))
      const container = await this.readContainer(dataPath, entry.dataOffset, entry.fileSize)
      const blteStart = hasBlteSignature(container, 0)
        ? 0
        : hasBlteSignature(container, BLTE_ENCODED_HEADER_SIZE)
          ? BLTE_ENCODED_HEADER_SIZE
          : -1
      if (blteStart < 0) continue
      try {
        return decodeBlte(container.subarray(blteStart), {
          maxOutputBytes: this.options.maxDecodedBytes,
        })
      } catch (err) {
        lastError = err
      }
    }
    throw cascError('x3.casc/blte-frame-unreadable', 'CASC has no readable BLTE frame', {
      encodingKey,
      cause: lastError instanceof Error ? lastError.message : undefined,
    })
  }
  // Read one container span. CASC `data.NNN` files are up to 1 GB, so prefer a
  // ranged read when the source supports it; otherwise fall back to whole-file.
  async readContainer(dataPath, offset, length) {
    if (length > this.options.maxContainerReadBytes) {
      throw cascError(
        'x3.casc/container-read-budget-exceeded',
        'CASC container range exceeds its budget',
        {
          dataPath,
          offset,
          length,
          maxContainerReadBytes: this.options.maxContainerReadBytes,
        },
      )
    }
    if (this.source.getRange) return this.source.getRange(dataPath, offset, length)
    return sliceExact(await this.source.get(dataPath), offset, length, 'CASC storage container')
  }
}
