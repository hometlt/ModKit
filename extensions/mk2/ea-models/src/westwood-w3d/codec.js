// Hand-ported structural Westwood W3D reader. It walks bounded recursive chunks and exposes the
// hierarchy as model metadata; geometry and animation decoding remain explicitly absent.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/westwood-w3d'
const SIZE_MASK = 0x7fffffff
const HAS_CHILDREN = 0x80000000
const TOP_LEVEL = new Set([
  0x0, 0x100, 0x200, 0x280, 0x2c0, 0x300, 0x400, 0x420, 0x440, 0x460, 0x500, 0x600, 0x700, 0x740,
  0x750, 0x800, 0x900, 0xa00,
])
const NAMES = new Map([
  [0x0, 'MESH'],
  [0x100, 'HIERARCHY'],
  [0x101, 'HIERARCHY_HEADER'],
  [0x102, 'PIVOTS'],
  [0x200, 'ANIMATION'],
  [0x280, 'COMPRESSED_ANIMATION'],
  [0x500, 'EMITTER'],
  [0x600, 'AGGREGATE'],
  [0x700, 'HLOD'],
  [0x740, 'BOX'],
  [0x900, 'DAZZLE'],
  [0xa00, 'SOUND_OBJECT'],
])
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function validRoot(prefix) {
  if (prefix.byteLength < 8 || prefix[0] === 0x3c) return false
  const data = view(prefix)
  const type = data.getUint32(0, true)
  const size = data.getUint32(4, true) & SIZE_MASK
  return TOP_LEVEL.has(type) && size > 0
}

function chunkName(type) {
  return NAMES.get(type) ?? `CHUNK_0x${type.toString(16).padStart(8, '0')}`
}

function readChunks(bytes, start, end, depth, state, budget) {
  if (depth > budget.maxDepth) throw new RangeError('W3D chunk tree exceeds maxDepth')
  const chunks = []
  let cursor = start
  while (cursor < end) {
    if (end - cursor < 8) throw new TypeError('W3D chunk header is truncated')
    if (state.nodes >= budget.maxNodes) throw new RangeError('W3D chunks exceed maxNodes')
    const data = view(bytes)
    const type = data.getUint32(cursor, true)
    const sizeField = data.getUint32(cursor + 4, true)
    const size = sizeField & SIZE_MASK
    const payloadStart = cursor + 8
    const payloadEnd = payloadStart + size
    if (!Number.isSafeInteger(payloadEnd) || payloadEnd > end) {
      throw new RangeError(`W3D ${chunkName(type)} payload is outside its parent`)
    }
    state.nodes += 1
    const children =
      (sizeField & HAS_CHILDREN) !== 0
        ? readChunks(bytes, payloadStart, payloadEnd, depth + 1, state, budget)
        : Object.freeze([])
    chunks.push(
      Object.freeze({
        id: String(state.nodes - 1),
        type,
        name: chunkName(type),
        offset: cursor,
        size,
        hasChildren: (sizeField & HAS_CHILDREN) !== 0,
        children,
      }),
    )
    cursor = payloadEnd
  }
  return Object.freeze(chunks)
}

function flatten(chunks, out = []) {
  for (const chunk of chunks) {
    out.push(chunk)
    flatten(chunk.children, out)
  }
  return out
}

function treeChunk(chunk) {
  return {
    kind: chunk.hasChildren ? 'section' : 'record',
    label: chunk.name,
    preview: `${chunk.size} payload bytes at ${chunk.offset}`,
    children: chunk.children.map(treeChunk),
  }
}

function modelSource(total) {
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 0,
      primitives: 0,
      materials: 0,
      textures: 0,
      animations: 0,
      geometryAccess: 'metadata-only',
    },
    nodes: [
      {
        id: 'w3d-root',
        name: `Westwood W3D structural root (${total} chunks)`,
        childIds: [],
        meshIds: [],
        transform: IDENTITY,
      },
    ],
    meshes: [],
    primitives: [],
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'westwood-w3d', label: 'Westwood W3D binary model' }),
  async detect(prefix) {
    return validRoot(prefix)
      ? { confidence: 0.99, kind: 'structure', note: 'bounded W3D root chunk' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    if (!validRoot(bytes)) throw new TypeError('W3D root chunk is invalid')
    const roots = readChunks(bytes, 0, bytes.byteLength, 0, { nodes: 0 }, context.budget)
    const all = flatten(roots)
    const types = Object.freeze(
      Object.entries(
        all.reduce((counts, chunk) => {
          counts[chunk.name] = (counts[chunk.name] ?? 0) + 1
          return counts
        }, {}),
      ).map(([name, count]) => ({ name, count })),
    )
    return {
      summary: {
        format: 'westwood-w3d',
        rootChunks: roots.length,
        chunks: all.length,
        chunkTypes: types,
        geometryAccess: 'metadata-only',
      },
      metadata: [
        {
          id: 'westwood-w3d-model',
          label: 'Westwood W3D model',
          entries: [
            { key: 'rootChunks', value: roots.length },
            { key: 'chunks', value: all.length },
            {
              key: 'chunkTypes',
              value: types.map(type => `${type.name}:${type.count}`).join(', '),
            },
            { key: 'geometryAccess', value: 'metadata-only' },
          ],
        },
      ],
      traits: [
        { id: 'model.geometry', parameters: { meshes: 0, decoded: false } },
        { id: 'structure.hierarchy', parameters: { chunks: all.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/model-scene-source': modelSource(all.length),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Westwood W3D',
          preview: `${all.length} chunks`,
          children: roots.map(treeChunk),
        }),
      },
      maxDecodedBytes: 0,
      unsupportedFeatures: [
        'w3d-geometry-decoding',
        'w3d-hierarchy-decoding',
        'w3d-animation-decoding',
        'protected-asset-recovery',
        'companion-resolution',
        'texture-resolution',
        'shader-particle-and-dazzle-execution',
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
