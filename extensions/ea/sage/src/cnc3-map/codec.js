// Hand-ported SAGE CkMp map directory reader, including the retail EAR + RefPack envelope.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/cnc3-map'
const EAR = 'EAR\0'
const CKMP = 'CkMp'

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function ascii(bytes, offset, length, label = 'read') {
  if (offset < 0 || length < 0 || offset > bytes.byteLength || length > bytes.byteLength - offset)
    throw new RangeError(`CkMp ${label} is outside the container`)
  let result = ''
  for (let index = 0; index < length; index += 1)
    result += String.fromCharCode(bytes[offset + index] ?? 0)
  return result
}

function magic(bytes) {
  return bytes.byteLength < 4 ? '' : ascii(bytes, 0, 4, 'magic')
}

function isRefPack(bytes) {
  return bytes.byteLength >= 2 && ((bytes[0] ?? 0) & 0x3e) === 0x10 && bytes[1] === 0xfb
}

function readUnsignedBe(bytes, offset, length) {
  if (offset + length > bytes.byteLength) throw new TypeError('RefPack header is truncated')
  let value = 0
  for (let index = 0; index < length; index += 1) value = value * 256 + (bytes[offset + index] ?? 0)
  return value
}

function refPackHeader(bytes) {
  if (!isRefPack(bytes)) throw new TypeError('EAR RefPack header is invalid')
  const flags = bytes[0] ?? 0
  const sizeBytes = (flags & 0x80) !== 0 ? 4 : 3
  let cursor = 2
  if ((flags & 0x01) !== 0) cursor += sizeBytes
  const size = readUnsignedBe(bytes, cursor, sizeBytes)
  return Object.freeze({ headerBytes: cursor + sizeBytes, size })
}

function decodeRefPack(bytes, maximum) {
  const header = refPackHeader(bytes)
  if (header.size > maximum) throw new RangeError('EAR expanded map exceeds maxScalarBytes')
  const output = new Uint8Array(header.size)
  let source = header.headerBytes
  let target = 0
  let stopped = false
  const literals = length => {
    if (source + length > bytes.byteLength) throw new TypeError('EAR RefPack literal is truncated')
    if (target + length > output.byteLength) throw new TypeError('EAR RefPack output overflows')
    output.set(bytes.subarray(source, source + length), target)
    source += length
    target += length
  }
  const match = (distance, length) => {
    if (distance <= 0 || distance > target || target + length > output.byteLength)
      throw new TypeError('EAR RefPack match is invalid')
    let read = target - distance
    for (let index = 0; index < length; index += 1) {
      output[target] = output[read] ?? 0
      target += 1
      read += 1
    }
  }
  while (source < bytes.byteLength) {
    const control = bytes[source]
    if (control === undefined) break
    source += 1
    let literalBytes = 0
    let matchBytes = 0
    let distance = 0
    if (control >= 0xfc) {
      literals(control & 0x03)
      stopped = true
      break
    }
    if (control < 0x80) {
      const second = bytes[source]
      if (second === undefined) throw new TypeError('EAR RefPack command is truncated')
      source += 1
      literalBytes = control & 0x03
      matchBytes = ((control & 0x1c) >>> 2) + 3
      distance = ((control & 0x60) << 3) + second + 1
    } else if (control < 0xc0) {
      const second = bytes[source]
      const third = bytes[source + 1]
      if (second === undefined || third === undefined)
        throw new TypeError('EAR RefPack command is truncated')
      source += 2
      literalBytes = second >>> 6
      matchBytes = (control & 0x3f) + 4
      distance = ((second & 0x3f) << 8) + third + 1
    } else if (control < 0xe0) {
      const second = bytes[source]
      const third = bytes[source + 1]
      const fourth = bytes[source + 2]
      if (second === undefined || third === undefined || fourth === undefined)
        throw new TypeError('EAR RefPack command is truncated')
      source += 3
      literalBytes = control & 0x03
      matchBytes = ((control & 0x0c) << 6) + fourth + 5
      distance = ((control & 0x10) << 12) + (second << 8) + third + 1
    } else {
      literalBytes = ((control & 0x1f) + 1) << 2
    }
    literals(literalBytes)
    if (matchBytes > 0) match(distance, matchBytes)
  }
  if (!stopped || target !== output.byteLength)
    throw new TypeError('EAR RefPack stream is incomplete')
  return output
}

function expand(bytes, budget) {
  if (magic(bytes) !== EAR) return Object.freeze({ bytes, compressed: false })
  if (bytes.byteLength < 8) throw new TypeError('EAR header is truncated')
  const declared = viewOf(bytes).getUint32(4, true)
  if (declared > budget.maxScalarBytes) throw new RangeError('EAR map exceeds maxScalarBytes')
  const decoded = decodeRefPack(bytes.subarray(8), budget.maxScalarBytes)
  if (decoded.byteLength !== declared)
    throw new TypeError(`EAR size mismatch: declared ${declared}, decoded ${decoded.byteLength}`)
  return Object.freeze({ bytes: decoded, compressed: true })
}

function parse(bytes, budget) {
  const envelope = expand(bytes, budget)
  const container = envelope.bytes
  if (magic(container) !== CKMP) throw new TypeError('CkMp magic is missing')
  if (container.byteLength < 8) throw new TypeError('CkMp header is truncated')
  const view = viewOf(container)
  const nameCount = view.getUint32(4, true)
  if (nameCount > budget.maxNodes) throw new RangeError('CkMp names exceed maxNodes')
  const names = []
  const byIndex = new Map()
  let cursor = 8
  for (let index = 0; index < nameCount; index += 1) {
    const length = container[cursor]
    if (length === undefined) throw new TypeError(`CkMp name ${index} is truncated`)
    cursor += 1
    const name = ascii(container, cursor, length, `name ${index}`)
    cursor += length
    if (cursor + 4 > container.byteLength)
      throw new TypeError(`CkMp name ${index} index is truncated`)
    const nameIndex = view.getUint32(cursor, true)
    cursor += 4
    if (byIndex.has(nameIndex)) throw new TypeError(`CkMp name index ${nameIndex} is duplicated`)
    byIndex.set(nameIndex, name)
    names.push(name)
  }
  const chunks = []
  let dimensions
  while (cursor + 10 <= container.byteLength) {
    if (nameCount + chunks.length >= budget.maxNodes)
      throw new RangeError('CkMp names and chunks exceed maxNodes')
    const nameIndex = view.getUint32(cursor, true)
    const version = view.getUint16(cursor + 4, true)
    const byteLength = view.getUint32(cursor + 6, true)
    const name = byIndex.get(nameIndex)
    if (name === undefined)
      throw new TypeError(`CkMp chunk references unknown name index ${nameIndex}`)
    const offset = cursor + 10
    if (offset > container.byteLength || byteLength > container.byteLength - offset)
      throw new RangeError(`CkMp chunk ${name} is outside the container`)
    const id = String(chunks.length)
    chunks.push(Object.freeze({ id, name, version, offset, byteLength }))
    if (name === 'HeightMapData' && byteLength >= 12) {
      dimensions = Object.freeze({
        width: view.getUint32(offset, true),
        height: view.getUint32(offset + 4, true),
        borderSize: view.getUint32(offset + 8, true),
      })
    }
    cursor = offset + byteLength
  }
  if (cursor !== container.byteLength)
    throw new TypeError(`CkMp trailing data: consumed ${cursor} of ${container.byteLength}`)
  return Object.freeze({
    compressed: envelope.compressed,
    expandedByteLength: container.byteLength,
    container,
    names: Object.freeze(names),
    chunks: Object.freeze(chunks),
    dimensions,
  })
}

function namespaceSource(chunks, source) {
  const byId = new Map(chunks.map(chunk => [chunk.id, chunk]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0)
        throw new TypeError('CkMp namespace limit must be positive')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid CkMp cursor')
      const matching = chunks.filter(chunk => chunk.name.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(chunk =>
        Object.freeze({
          id: chunk.id,
          path: chunk.name,
          name: chunk.name,
          kind: 'file',
          size: BigInt(chunk.byteLength),
          storedSize: BigInt(chunk.byteLength),
          compression: 'stored',
          revision: source.revision,
        }),
      )
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < matching.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!byId.has(entryId)) throw new TypeError(`unknown CkMp chunk ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `ckmp-chunk:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'cnc3-map', label: 'Command & Conquer 3 map' }),
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
    const value = magic(prefix)
    return value === EAR || value === CKMP
      ? {
          confidence: 0.99,
          kind: 'magic',
          note: value === EAR ? 'EAR RefPack envelope' : 'CkMp header',
        }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const map = parse(bytes, context.budget)
    const byId = new Map(map.chunks.map(chunk => [chunk.id, chunk]))
    return {
      summary: {
        format: 'cnc3-map',
        envelope: map.compressed ? 'ear-refpack' : 'ckmp',
        expandedBytes: map.expandedByteLength,
        names: map.names,
        chunks: map.chunks.map(chunk => ({
          id: chunk.id,
          name: chunk.name,
          version: chunk.version,
          offset: chunk.offset,
          byteLength: chunk.byteLength,
        })),
        dimensions: map.dimensions ?? null,
      },
      metadata: [
        {
          id: 'cnc3-map',
          label: 'SAGE CkMp map',
          entries: [
            { key: 'envelope', value: map.compressed ? 'EAR + RefPack' : 'CkMp' },
            { key: 'expandedBytes', value: map.expandedByteLength },
            { key: 'names', value: map.names.length },
            { key: 'chunks', value: map.chunks.length },
            ...(map.dimensions === undefined
              ? []
              : [
                  { key: 'width', value: map.dimensions.width },
                  { key: 'height', value: map.dimensions.height },
                  { key: 'borderSize', value: map.dimensions.borderSize },
                ]),
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: map.chunks.length } },
        ...(map.compressed
          ? [{ id: 'container.compression', parameters: { methods: ['refpack'] } }]
          : []),
        {
          id: 'game.map',
          parameters: { dimensions: map.dimensions ?? null, terrainDecoded: false },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/namespace-entry-source': namespaceSource(map.chunks, context.source),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'map',
          label: 'SAGE CkMp map',
          preview: `${map.chunks.length} chunks`,
          children: [
            {
              kind: 'section',
              label: 'Directory',
              preview: `${map.names.length} names`,
              children: map.names.map((name, index) => ({
                kind: 'name',
                label: name,
                preview: `index ${index}`,
              })),
            },
            {
              kind: 'section',
              label: 'Chunks',
              preview: `${map.chunks.length} chunks`,
              children: map.chunks.map(chunk => {
                const heightMap = chunk.name === 'HeightMapData' ? map.dimensions : undefined
                return {
                  kind: heightMap === undefined ? 'raw-chunk' : 'height-map',
                  label: chunk.name,
                  preview: `v${chunk.version}, ${chunk.byteLength} bytes`,
                  children:
                    heightMap === undefined
                      ? []
                      : [
                          { kind: 'scalar', label: 'Width', preview: String(heightMap.width) },
                          { kind: 'scalar', label: 'Height', preview: String(heightMap.height) },
                          {
                            kind: 'scalar',
                            label: 'Border size',
                            preview: String(heightMap.borderSize),
                          },
                        ],
                }
              }),
            },
          ],
        }),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input))
            throw new TypeError('container.extract requires {entryId}')
          const chunk = byId.get(String(input.entryId ?? ''))
          if (chunk === undefined) throw new TypeError('CkMp chunk id was not found')
          return {
            kind: 'bytes',
            value: map.container.slice(chunk.offset, chunk.offset + chunk.byteLength),
          }
        },
      },
      maxDecodedBytes: Math.max(bytes.byteLength, map.expandedByteLength),
      unsupportedFeatures: [
        'terrain-object-and-script-chunk-semantics',
        'compiled-map-bin-manifest-relo-imp-sidecars',
        'map-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
