/*
 * Portable LZMA decoder adapted from the public-domain LZMA SDK decoding algorithm by Igor
 * Pavlov. This implementation is intentionally limited to LZMA-alone streams whose 13-byte
 * header declares a finite uncompressed size, so allocation and output are budgeted up front.
 */

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/lzma'
const PROBABILITY_TOTAL = 2048
const MOVE_BITS = 5
const TOP_VALUE = 1 << 24
const STATES = 12

function initialized(length) {
  const values = new Uint16Array(length)
  values.fill(PROBABILITY_TOTAL >>> 1)
  return values
}

class RangeDecoder {
  constructor(bytes, offset) {
    this.bytes = bytes
    this.cursor = offset
    this.range = 0xffffffff
    this.code = 0
    if (this.readByte() !== 0) throw new TypeError('LZMA range coder has an invalid first byte')
    for (let index = 0; index < 4; index += 1) {
      this.code = ((this.code << 8) | this.readByte()) >>> 0
    }
  }

  readByte() {
    if (this.cursor >= this.bytes.byteLength)
      throw new TypeError('LZMA compressed data is truncated')
    const value = this.bytes[this.cursor] ?? 0
    this.cursor += 1
    return value
  }

  normalize() {
    if (this.range < TOP_VALUE) {
      this.range = (this.range << 8) >>> 0
      this.code = ((this.code << 8) | this.readByte()) >>> 0
    }
  }

  bit(probabilities, index) {
    const probability = probabilities[index] ?? 0
    const bound = Math.imul(this.range >>> 11, probability) >>> 0
    if (this.code < bound) {
      this.range = bound
      probabilities[index] = probability + ((PROBABILITY_TOTAL - probability) >>> MOVE_BITS)
      this.normalize()
      return 0
    }
    this.range = (this.range - bound) >>> 0
    this.code = (this.code - bound) >>> 0
    probabilities[index] = probability - (probability >>> MOVE_BITS)
    this.normalize()
    return 1
  }

  directBits(count) {
    let result = 0
    for (let index = 0; index < count; index += 1) {
      this.range >>>= 1
      result <<= 1
      if (this.code >= this.range) {
        this.code = (this.code - this.range) >>> 0
        result |= 1
      }
      this.normalize()
    }
    return result >>> 0
  }
}

function bitTree(levels) {
  return Object.freeze({ levels, models: initialized(1 << levels) })
}

function decodeTree(decoder, tree) {
  let symbol = 1
  for (let index = 0; index < tree.levels; index += 1) {
    symbol = (symbol << 1) | decoder.bit(tree.models, symbol)
  }
  return symbol - (1 << tree.levels)
}

function decodeReverse(decoder, models, offset, levels) {
  let symbol = 0
  let node = 1
  for (let index = 0; index < levels; index += 1) {
    const bit = decoder.bit(models, offset + node)
    node = (node << 1) | bit
    symbol |= bit << index
  }
  return symbol >>> 0
}

function lengthDecoder(positionStates) {
  return Object.freeze({
    choice: initialized(2),
    low: Object.freeze(Array.from({ length: positionStates }, () => bitTree(3))),
    middle: Object.freeze(Array.from({ length: positionStates }, () => bitTree(3))),
    high: bitTree(8),
  })
}

function decodeLength(decoder, model, positionState) {
  if (decoder.bit(model.choice, 0) === 0) return decodeTree(decoder, model.low[positionState])
  if (decoder.bit(model.choice, 1) === 0) {
    return 8 + decodeTree(decoder, model.middle[positionState])
  }
  return 16 + decodeTree(decoder, model.high)
}

function stateAfterLiteral(state) {
  if (state < 4) return 0
  if (state < 10) return state - 3
  return state - 6
}

function lengthToPositionState(length) {
  const value = length - 2
  return value < 4 ? value : 3
}

function readU32le(bytes, offset) {
  return (
    (((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)) +
      (bytes[offset + 3] ?? 0) * 0x1000000) >>>
    0
  )
}

function readU64le(bytes, offset) {
  return BigInt(readU32le(bytes, offset)) | (BigInt(readU32le(bytes, offset + 4)) << 32n)
}

function parseHeader(bytes) {
  if (bytes.byteLength < 18) throw new TypeError('LZMA-alone stream is truncated')
  const property = bytes[0] ?? 0
  if (property >= 225) throw new TypeError('LZMA property byte is invalid')
  const lc = property % 9
  const remainder = Math.floor(property / 9)
  const lp = remainder % 5
  const pb = Math.floor(remainder / 5)
  if (pb > 4) throw new TypeError('LZMA position property is invalid')
  const dictionarySize = readU32le(bytes, 1)
  const unpackedSize = readU64le(bytes, 5)
  if (unpackedSize === 0xffffffffffffffffn) {
    throw new TypeError('LZMA-alone streams with unknown output size are unsupported')
  }
  if (unpackedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('LZMA output size exceeds the portable integer range')
  }
  return Object.freeze({ dictionarySize: Math.max(dictionarySize, 1), lc, lp, pb, unpackedSize })
}

function decodeLzma(bytes, budget) {
  const header = parseHeader(bytes)
  const outputSize = Number(header.unpackedSize)
  if (outputSize > budget.maxScalarBytes) {
    throw new RangeError('LZMA payload exceeds maxScalarBytes budget')
  }
  if (budget.maxNodes < 1) throw new RangeError('LZMA entry count exceeds maxNodes budget')

  const decoder = new RangeDecoder(bytes, 13)
  const positionStates = 1 << header.pb
  const positionStateMask = positionStates - 1
  const literalPositionMask = (1 << header.lp) - 1
  const literalContexts = 1 << (header.lc + header.lp)
  const literalModels = Array.from({ length: literalContexts }, () => initialized(0x300))
  const isMatch = initialized(STATES << 4)
  const isRep = initialized(STATES)
  const isRepG0 = initialized(STATES)
  const isRepG1 = initialized(STATES)
  const isRepG2 = initialized(STATES)
  const isRep0Long = initialized(STATES << 4)
  const positionSlots = Array.from({ length: 4 }, () => bitTree(6))
  const positionModels = initialized(114)
  const positionAlign = bitTree(4)
  const matchLengths = lengthDecoder(positionStates)
  const repLengths = lengthDecoder(positionStates)
  const output = new Uint8Array(outputSize)

  let state = 0
  let rep0 = 0
  let rep1 = 0
  let rep2 = 0
  let rep3 = 0
  let position = 0
  let previousByte = 0

  while (position < outputSize) {
    const positionState = position & positionStateMask
    if (decoder.bit(isMatch, (state << 4) + positionState) === 0) {
      const context =
        ((position & literalPositionMask) << header.lc) + (previousByte >>> (8 - header.lc))
      const models = literalModels[context]
      let symbol = 1
      if (state >= 7) {
        if (rep0 >= position) throw new TypeError('LZMA literal match distance is invalid')
        let matchByte = output[position - rep0 - 1] ?? 0
        while (symbol < 0x100) {
          const matchBit = (matchByte >>> 7) & 1
          matchByte = (matchByte << 1) & 0xff
          const bit = decoder.bit(models, ((1 + matchBit) << 8) + symbol)
          symbol = (symbol << 1) | bit
          if (matchBit !== bit) {
            while (symbol < 0x100) symbol = (symbol << 1) | decoder.bit(models, symbol)
            break
          }
        }
      } else {
        while (symbol < 0x100) symbol = (symbol << 1) | decoder.bit(models, symbol)
      }
      previousByte = symbol - 0x100
      output[position++] = previousByte
      state = stateAfterLiteral(state)
      continue
    }

    let length = 0
    if (decoder.bit(isRep, state) !== 0) {
      if (decoder.bit(isRepG0, state) === 0) {
        if (decoder.bit(isRep0Long, (state << 4) + positionState) === 0) {
          state = state < 7 ? 9 : 11
          length = 1
        }
      } else {
        let distance
        if (decoder.bit(isRepG1, state) === 0) distance = rep1
        else if (decoder.bit(isRepG2, state) === 0) distance = rep2
        else {
          distance = rep3
          rep3 = rep2
        }
        rep2 = rep1
        rep1 = rep0
        rep0 = distance
      }
      if (length === 0) {
        length = decodeLength(decoder, repLengths, positionState) + 2
        state = state < 7 ? 8 : 11
      }
    } else {
      rep3 = rep2
      rep2 = rep1
      rep1 = rep0
      length = decodeLength(decoder, matchLengths, positionState) + 2
      state = state < 7 ? 7 : 10
      const slot = decodeTree(decoder, positionSlots[lengthToPositionState(length)])
      if (slot < 4) rep0 = slot
      else {
        const directCount = (slot >>> 1) - 1
        rep0 = ((2 | (slot & 1)) << directCount) >>> 0
        if (slot < 14) {
          rep0 = (rep0 + decodeReverse(decoder, positionModels, rep0 - slot - 1, directCount)) >>> 0
        } else {
          rep0 = (rep0 + decoder.directBits(directCount - 4) * 16) >>> 0
          rep0 = (rep0 + decodeReverse(decoder, positionAlign.models, 0, 4)) >>> 0
          if (rep0 === 0xffffffff)
            throw new TypeError('LZMA end marker precedes declared output size')
        }
      }
    }

    if (rep0 >= position || rep0 >= header.dictionarySize) {
      throw new TypeError('LZMA match distance is invalid')
    }
    if (position + length > outputSize)
      throw new TypeError('LZMA match exceeds declared output size')
    let source = position - rep0 - 1
    for (let index = 0; index < length; index += 1) output[position++] = output[source++] ?? 0
    previousByte = output[position - 1] ?? 0
  }

  return Object.freeze({ ...header, decoded: output })
}

function prefixLooksSupported(prefix) {
  if (prefix.byteLength < 13 || (prefix[0] ?? 0) >= 225) return false
  const size = readU64le(prefix, 5)
  return size !== 0xffffffffffffffffn && size <= BigInt(Number.MAX_SAFE_INTEGER)
}

function namespaceSource(stream, source) {
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('LZMA namespace page limit must be a positive safe integer')
      }
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid LZMA page cursor')
      const items =
        'payload.bin'.startsWith(prefix) && start === 0
          ? Object.freeze([
              Object.freeze({
                id: 'payload',
                path: 'payload.bin',
                name: 'payload.bin',
                kind: 'file',
                size: stream.unpackedSize,
                compression: 'lzma1',
                revision: source.revision,
              }),
            ])
          : Object.freeze([])
      return Object.freeze({ items })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (entryId !== 'payload') throw new TypeError('unknown LZMA payload entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/payload`,
          uri: `lzma-entry:${encodeURIComponent(source.ref.uri)}!/payload`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'lzma',
    label: 'LZMA compressed payload',
    mediaType: 'application/x-lzma',
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
      ? { confidence: 0.92, kind: 'structure', note: 'lzma-alone-known-size-header' }
      : { confidence: 0, kind: 'structure', note: 'unsupported-lzma-alone-header' }
  },
  async inspect(bytes, context) {
    const stream = decodeLzma(bytes, context.budget)
    return {
      summary: {
        format: 'lzma',
        decodedBytes: stream.decoded.byteLength,
        dictionaryBytes: stream.dictionarySize,
        properties: { lc: stream.lc, lp: stream.lp, pb: stream.pb },
      },
      metadata: [
        {
          id: 'lzma-stream',
          label: 'LZMA-alone stream',
          entries: [
            { key: 'decodedBytes', value: stream.decoded.byteLength },
            { key: 'dictionaryBytes', value: stream.dictionarySize },
            { key: 'literalContextBits', value: stream.lc },
            { key: 'literalPositionBits', value: stream.lp },
            { key: 'positionBits', value: stream.pb },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: 1 } },
        { id: 'container.compression', parameters: { methods: ['lzma1'] } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'LZMA',
          preview: `${stream.decoded.byteLength} decoded bytes`,
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
      maxDecodedBytes: stream.unpackedSize,
      unsupportedFeatures: [
        'lzma-alone-unknown-output-size',
        'lzma2-and-container-wrappers',
        'lzma-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
