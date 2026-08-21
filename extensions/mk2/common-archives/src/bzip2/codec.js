/*
 * BZip2 decoder adapted for ModkitX3 from seek-bzip 2.0.0.
 *
 * Copyright (C) 2013-2015 C. Scott Ananian
 * Copyright (C) 2012-2015 Eli Skeggs
 * Copyright (C) 2011 Kevin Kwok
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * seek-bzip is based on micro-bunzip and the reference bzip2 decoder. This adaptation replaces
 * Node streams and Buffers with bounded Uint8Array storage and rejects obsolete randomized blocks.
 */

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/bzip2'
const BLOCK_MAGIC = '314159265359'
const END_MAGIC = '177245385090'
const MAX_HUFFMAN_BITS = 20
const MAX_SYMBOLS = 258
const GROUP_SIZE = 50

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index << 24
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x80000000) === 0 ? value << 1 : (value << 1) ^ 0x04c11db7
    }
    table[index] = value >>> 0
  }
  return table
})()

class BzipCrc {
  value = 0xffffffff

  update(byte, count = 1) {
    for (let index = 0; index < count; index += 1) {
      this.value = ((this.value << 8) ^ (CRC_TABLE[((this.value >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0
    }
  }

  digest() {
    return ~this.value >>> 0
  }
}

class BitReader {
  constructor(bytes, offset) {
    this.bytes = bytes
    this.cursor = offset
    this.bit = 0
  }

  read(width) {
    let value = 0
    for (let index = 0; index < width; index += 1) {
      if (this.cursor >= this.bytes.byteLength) throw new TypeError('BZip2 input is truncated')
      value = value * 2 + (((this.bytes[this.cursor] ?? 0) >>> (7 - this.bit)) & 1)
      this.bit += 1
      if (this.bit === 8) {
        this.cursor += 1
        this.bit = 0
      }
    }
    return width === 32 ? value >>> 0 : value
  }

  magic() {
    let value = ''
    for (let index = 0; index < 6; index += 1) {
      value += this.read(8).toString(16).padStart(2, '0')
    }
    return value
  }

  hasTrailingBytes() {
    if (this.bit !== 0) {
      const mask = (1 << (8 - this.bit)) - 1
      if (((this.bytes[this.cursor] ?? 0) & mask) !== 0) return true
    }
    return this.cursor + (this.bit === 0 ? 0 : 1) < this.bytes.byteLength
  }
}

class BoundedWriter {
  constructor(maximum) {
    this.maximum = maximum
    this.buffer = new Uint8Array(Math.min(Math.max(maximum, 1), 16_384))
    this.length = 0
  }

  writeRun(byte, count) {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new TypeError('BZip2 run length is invalid')
    if (this.length + count > this.maximum) {
      throw new RangeError('BZip2 payload exceeds maxScalarBytes budget')
    }
    if (this.length + count > this.buffer.byteLength) {
      let size = this.buffer.byteLength
      while (size < this.length + count) size = Math.min(this.maximum, Math.max(size * 2, 1))
      const next = new Uint8Array(size)
      next.set(this.buffer)
      this.buffer = next
    }
    this.buffer.fill(byte, this.length, this.length + count)
    this.length += count
  }

  finish() {
    return this.buffer.slice(0, this.length)
  }
}

function moveToFront(array, index) {
  const value = array[index]
  for (let cursor = index; cursor > 0; cursor -= 1) array[cursor] = array[cursor - 1]
  array[0] = value
  return value
}

function decodeBlock(reader, blockSize, writer) {
  const expectedCrc = reader.read(32)
  if (reader.read(1) !== 0)
    throw new TypeError('BZip2 randomized blocks are obsolete and unsupported')
  const originalPointer = reader.read(24)
  if (originalPointer >= blockSize) throw new TypeError('BZip2 original pointer is out of bounds')

  const usedGroups = reader.read(16)
  const symbolToByte = new Uint8Array(256)
  let symbolTotal = 0
  for (let group = 0; group < 16; group += 1) {
    if ((usedGroups & (1 << (15 - group))) === 0) continue
    const used = reader.read(16)
    for (let item = 0; item < 16; item += 1) {
      if ((used & (1 << (15 - item))) !== 0) symbolToByte[symbolTotal++] = group * 16 + item
    }
  }
  if (symbolTotal === 0) throw new TypeError('BZip2 block has an empty symbol map')

  const groupCount = reader.read(3)
  if (groupCount < 2 || groupCount > 6) throw new TypeError('BZip2 Huffman group count is invalid')
  const selectorCount = reader.read(15)
  if (selectorCount === 0) throw new TypeError('BZip2 selector list is empty')

  const mtfSymbols = new Uint16Array(256)
  for (let index = 0; index < mtfSymbols.length; index += 1) mtfSymbols[index] = index
  const selectors = new Uint8Array(selectorCount)
  for (let index = 0; index < selectorCount; index += 1) {
    let selector = 0
    while (reader.read(1) !== 0) {
      selector += 1
      if (selector >= groupCount) throw new TypeError('BZip2 selector is out of bounds')
    }
    selectors[index] = moveToFront(mtfSymbols, selector)
  }

  const symbolCount = symbolTotal + 2
  const groups = []
  for (let group = 0; group < groupCount; group += 1) {
    const lengths = new Uint8Array(symbolCount)
    let length = reader.read(5)
    for (let symbol = 0; symbol < symbolCount; symbol += 1) {
      while (reader.read(1) !== 0) length += reader.read(1) === 0 ? 1 : -1
      if (length < 1 || length > MAX_HUFFMAN_BITS) {
        throw new TypeError('BZip2 Huffman code length is invalid')
      }
      lengths[symbol] = length
    }
    let minimum = lengths[0] ?? 0
    let maximum = minimum
    for (const item of lengths) {
      minimum = Math.min(minimum, item)
      maximum = Math.max(maximum, item)
    }
    const permutation = new Uint16Array(MAX_SYMBOLS)
    const limit = new Uint32Array(MAX_HUFFMAN_BITS + 2)
    const base = new Uint32Array(MAX_HUFFMAN_BITS + 2)
    const counts = new Uint16Array(MAX_HUFFMAN_BITS + 1)
    let permutationIndex = 0
    for (let bits = minimum; bits <= maximum; bits += 1) {
      for (let symbol = 0; symbol < symbolCount; symbol += 1) {
        if (lengths[symbol] === bits) permutation[permutationIndex++] = symbol
      }
    }
    for (const item of lengths) counts[item] = (counts[item] ?? 0) + 1
    let code = 0
    let accumulated = 0
    for (let bits = minimum; bits < maximum; bits += 1) {
      code += counts[bits] ?? 0
      limit[bits] = code - 1
      code <<= 1
      accumulated += counts[bits] ?? 0
      base[bits + 1] = code - accumulated
    }
    limit[maximum] = code + (counts[maximum] ?? 0) - 1
    groups.push({ base, limit, maximum, minimum, permutation })
  }

  const byteCounts = new Uint32Array(256)
  for (let index = 0; index < mtfSymbols.length; index += 1) mtfSymbols[index] = index
  const transformed = new Uint32Array(blockSize)
  let transformedLength = 0
  let selectorIndex = 0
  let symbolsLeft = 0
  let currentGroup
  let runPower = 0
  let runLength = 0

  while (true) {
    if (symbolsLeft === 0) {
      if (selectorIndex >= selectors.length) throw new TypeError('BZip2 selector list is exhausted')
      currentGroup = groups[selectors[selectorIndex++] ?? 0]
      symbolsLeft = GROUP_SIZE
    }
    symbolsLeft -= 1
    let bitLength = currentGroup.minimum
    let code = reader.read(bitLength)
    while (code > currentGroup.limit[bitLength]) {
      bitLength += 1
      if (bitLength > currentGroup.maximum) throw new TypeError('BZip2 Huffman symbol is invalid')
      code = code * 2 + reader.read(1)
    }
    const permutationIndex = code - currentGroup.base[bitLength]
    if (permutationIndex < 0 || permutationIndex >= symbolCount) {
      throw new TypeError('BZip2 Huffman permutation is invalid')
    }
    const nextSymbol = currentGroup.permutation[permutationIndex]
    if (nextSymbol === 0 || nextSymbol === 1) {
      if (runPower === 0) {
        runPower = 1
        runLength = 0
      }
      runLength += nextSymbol === 0 ? runPower : runPower * 2
      runPower <<= 1
      if (runPower > blockSize * 2) throw new TypeError('BZip2 run length is invalid')
      continue
    }
    if (runPower !== 0) {
      runPower = 0
      if (transformedLength + runLength > blockSize) throw new TypeError('BZip2 block is too large')
      const byte = symbolToByte[mtfSymbols[0] ?? 0] ?? 0
      byteCounts[byte] = (byteCounts[byte] ?? 0) + runLength
      transformed.fill(byte, transformedLength, transformedLength + runLength)
      transformedLength += runLength
    }
    if (nextSymbol > symbolTotal) break
    if (transformedLength >= blockSize) throw new TypeError('BZip2 block is too large')
    const mtfIndex = nextSymbol - 1
    if (mtfIndex < 0 || mtfIndex >= symbolTotal) throw new TypeError('BZip2 MTF symbol is invalid')
    const byte = symbolToByte[moveToFront(mtfSymbols, mtfIndex) ?? 0] ?? 0
    byteCounts[byte] = (byteCounts[byte] ?? 0) + 1
    transformed[transformedLength++] = byte
  }

  if (originalPointer >= transformedLength) throw new TypeError('BZip2 original pointer is invalid')
  let total = 0
  for (let byte = 0; byte < byteCounts.length; byte += 1) {
    const next = total + (byteCounts[byte] ?? 0)
    byteCounts[byte] = total
    total = next
  }
  for (let index = 0; index < transformedLength; index += 1) {
    const byte = transformed[index] & 0xff
    const sorted = byteCounts[byte] ?? 0
    transformed[sorted] = (transformed[sorted] | (index << 8)) >>> 0
    byteCounts[byte] = sorted + 1
  }

  let position = transformed[originalPointer] ?? 0
  let current = position & 0xff
  position >>>= 8
  let run = -1
  const crc = new BzipCrc()
  for (let remaining = transformedLength; remaining > 0; remaining -= 1) {
    const previous = current
    const packed = transformed[position] ?? 0
    current = packed & 0xff
    position = packed >>> 8
    let copies = 1
    let outputByte = current
    run += 1
    if (run === 3) {
      copies = current
      outputByte = previous
      current = -1
    }
    crc.update(outputByte, copies)
    writer.writeRun(outputByte, copies)
    if (current !== previous) run = 0
  }
  if (crc.digest() !== expectedCrc) throw new TypeError('BZip2 block CRC mismatch')
  return expectedCrc
}

function decodeBzip2(bytes, budget) {
  if (
    bytes.byteLength < 14 ||
    bytes[0] !== 0x42 ||
    bytes[1] !== 0x5a ||
    bytes[2] !== 0x68 ||
    (bytes[3] ?? 0) < 0x31 ||
    (bytes[3] ?? 0) > 0x39
  ) {
    throw new TypeError('BZip2 header is invalid')
  }
  const level = (bytes[3] ?? 0) - 0x30
  const reader = new BitReader(bytes, 4)
  const writer = new BoundedWriter(budget.maxScalarBytes)
  let combinedCrc = 0
  let blocks = 0
  while (true) {
    const magic = reader.magic()
    if (magic === END_MAGIC) {
      const expected = reader.read(32)
      if (expected !== combinedCrc) throw new TypeError('BZip2 stream CRC mismatch')
      if (reader.hasTrailingBytes())
        throw new TypeError('BZip2 trailing or concatenated streams are unsupported')
      return Object.freeze({ blocks, decoded: writer.finish(), level })
    }
    if (magic !== BLOCK_MAGIC) throw new TypeError('BZip2 block magic is invalid')
    if (blocks >= budget.maxNodes) throw new RangeError('BZip2 block count exceeds maxNodes budget')
    const blockCrc = decodeBlock(reader, level * 100_000, writer)
    combinedCrc = (((combinedCrc << 1) | (combinedCrc >>> 31)) ^ blockCrc) >>> 0
    blocks += 1
  }
}

function prefixLooksSupported(prefix) {
  return (
    prefix.byteLength >= 4 &&
    prefix[0] === 0x42 &&
    prefix[1] === 0x5a &&
    prefix[2] === 0x68 &&
    (prefix[3] ?? 0) >= 0x31 &&
    (prefix[3] ?? 0) <= 0x39
  )
}

function namespaceSource(stream, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('BZip2 namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0)
        throw new TypeError('invalid BZip2 page cursor')
      const items =
        'payload.bin'.startsWith(prefix) && start === 0
          ? Object.freeze([
              Object.freeze({
                id: 'payload',
                path: 'payload.bin',
                name: 'payload.bin',
                kind: 'file',
                size: BigInt(stream.decoded.byteLength),
                compression: 'bzip2',
                revision: source.revision,
              }),
            ])
          : Object.freeze([])
      return Object.freeze({ items })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entryId !== 'payload') throw new TypeError('unknown BZip2 payload entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/payload`,
          uri: `bzip2-entry:${encodeURIComponent(source.ref.uri)}!/payload`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'bzip2',
    label: 'BZip2 compressed payload',
    mediaType: 'application/x-bzip2',
  }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  async detect(prefix) {
    return prefixLooksSupported(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'bzip2-stream-header' }
      : { confidence: 0, kind: 'magic', note: 'invalid-bzip2-header' }
  },
  async inspect(bytes, context) {
    const stream = decodeBzip2(bytes, context.budget)
    return {
      summary: {
        format: 'bzip2',
        decodedBytes: stream.decoded.byteLength,
        blocks: stream.blocks,
        blockSize: stream.level * 100_000,
      },
      metadata: [
        {
          id: 'bzip2-stream',
          label: 'BZip2 stream',
          entries: [
            { key: 'decodedBytes', value: stream.decoded.byteLength },
            { key: 'blocks', value: stream.blocks },
            { key: 'blockSize', value: stream.level * 100_000 },
            { key: 'checksums', value: 'block and combined stream CRC-32 verified' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods: ['bzip2'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'BZip2',
          preview: `${stream.decoded.byteLength} decoded bytes in ${stream.blocks} blocks`,
          children: [
            {
              kind: 'file',
              label: 'payload.bin',
              preview: `${stream.decoded.byteLength} decoded bytes`,
            },
          ],
        }),
        'common.view/namespace-entry-source': namespaceSource(stream, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (
            input === null ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            input.entryId !== 'payload'
          ) {
            throw new TypeError('container.extract requires {entryId:"payload"}')
          }
          return { kind: 'bytes', value: stream.decoded.slice() }
        },
      },
      maxDecodedBytes: BigInt(stream.decoded.byteLength),
      unsupportedFeatures: [
        'obsolete-randomized-bzip2-blocks',
        'concatenated-bzip2-streams',
        'bzip2-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
