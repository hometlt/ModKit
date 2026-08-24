// Portable Westwood W3D reader. It walks bounded recursive chunks, decodes the documented mesh
// streams, and keeps hierarchy, animation, protected-asset, and companion planes explicit as debt.

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
  [0x1f, 'MESH_HEADER3'],
  [0x2, 'VERTICES'],
  [0x3, 'VERTEX_NORMALS'],
  [0x20, 'TRIANGLES'],
  [0x30, 'TEXTURES'],
  [0x31, 'TEXTURE'],
  [0x32, 'TEXTURE_NAME'],
  [0x38, 'MATERIAL_PASS'],
  [0x48, 'TEXTURE_STAGE'],
  [0x49, 'TEXTURE_IDS'],
  [0x4a, 'STAGE_TEXCOORDS'],
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
      if (depth === 0 && chunks.length > 0) {
        state.trailingBytes = end - cursor
        break
      }
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
        payloadStart,
        payloadEnd,
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

function descendants(chunks, type, out = []) {
  for (const chunk of chunks) {
    if (chunk.type === type) out.push(chunk)
    descendants(chunk.children, type, out)
  }
  return out
}

function fixedString(bytes, offset, length) {
  const end = Math.min(bytes.byteLength, offset + length)
  let cursor = offset
  while (cursor < end && bytes[cursor] !== 0) cursor += 1
  return new TextDecoder().decode(bytes.subarray(offset, cursor)).trim()
}

function toUvm([x, y, z]) {
  return [x, z, y === 0 ? 0 : -y]
}

function normalized(vector) {
  const length = Math.hypot(...vector)
  return length === 0 ? [0, 0, 0] : vector.map(value => value / length)
}

function vec3Stream(bytes, chunk, count, label) {
  const available = Math.floor(chunk.size / 12)
  if (count > available) throw new TypeError(`W3D ${label} stream is truncated`)
  const data = view(bytes)
  const result = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    const offset = chunk.payloadStart + index * 12
    result.set(
      toUvm([
        data.getFloat32(offset, true),
        data.getFloat32(offset + 4, true),
        data.getFloat32(offset + 8, true),
      ]),
      index * 3,
    )
  }
  return result
}

function normalStream(bytes, chunk, count, label) {
  const values = vec3Stream(bytes, chunk, count, label)
  for (let offset = 0; offset < values.length; offset += 3) {
    values.set(normalized([values[offset], values[offset + 1], values[offset + 2]]), offset)
  }
  return values
}

function boundsFor(positions) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis]
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function unionBounds(meshes) {
  if (meshes.length === 0) return undefined
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const mesh of meshes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.primitive.bounds.min[axis])
      max[axis] = Math.max(max[axis], mesh.primitive.bounds.max[axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function decodeMesh(bytes, chunk, index) {
  const header = chunk.children.find(child => child.type === 0x1f)
  const vertices = chunk.children.find(child => child.type === 0x2)
  const triangles = chunk.children.find(child => child.type === 0x20)
  if (header === undefined || vertices === undefined || triangles === undefined) return undefined
  if (header.size < 116) throw new TypeError('W3D MESH_HEADER3 is shorter than 116 bytes')
  const data = view(bytes)
  const vertexCount = data.getUint32(header.payloadStart + 44, true)
  const triangleCount = data.getUint32(header.payloadStart + 40, true)
  if (vertexCount === 0 || triangleCount === 0) return undefined
  const positions = vec3Stream(bytes, vertices, vertexCount, 'vertex')
  if (triangles.size < triangleCount * 32) throw new TypeError('W3D triangle stream is truncated')
  const indices = new Uint32Array(triangleCount * 3)
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangles.payloadStart + triangle * 32
    for (let corner = 0; corner < 3; corner += 1) {
      const value = data.getUint32(offset + corner * 4, true)
      if (value >= vertexCount)
        throw new TypeError('W3D triangle index is outside the vertex stream')
      indices[triangle * 3 + corner] = value
    }
  }
  const normalChunk = chunk.children.find(child => child.type === 0x3)
  const normals =
    normalChunk !== undefined && normalChunk.size >= vertexCount * 12
      ? normalStream(bytes, normalChunk, vertexCount, 'normal')
      : undefined
  const texcoordChunk = descendants(chunk.children, 0x4a)[0]
  let textureCoordinates
  if (texcoordChunk !== undefined && texcoordChunk.size >= vertexCount * 8) {
    textureCoordinates = new Float32Array(vertexCount * 2)
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const offset = texcoordChunk.payloadStart + vertex * 8
      textureCoordinates[vertex * 2] = data.getFloat32(offset, true)
      textureCoordinates[vertex * 2 + 1] = 1 - data.getFloat32(offset + 4, true)
    }
  }
  const textures = Object.freeze(
    descendants(chunk.children, 0x32)
      .map(texture => fixedString(bytes, texture.payloadStart, texture.size))
      .filter(Boolean),
  )
  const name = fixedString(bytes, header.payloadStart + 8, 16) || `W3DMesh_${index}`
  const primitive = Object.freeze({
    id: `w3d-primitive-${index}`,
    topology: 'triangles',
    positions,
    indices,
    ...(normals === undefined ? {} : { normals }),
    ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
    materialId: `w3d-material-${index}`,
    bounds: boundsFor(positions),
  })
  return Object.freeze({
    id: `w3d-mesh-${index}`,
    name,
    primitive,
    textures,
    decodedBytes:
      positions.byteLength +
      indices.byteLength +
      (normals?.byteLength ?? 0) +
      (textureCoordinates?.byteLength ?? 0),
  })
}

function decodedMeshes(bytes, roots, budget) {
  const meshes = roots
    .filter(chunk => chunk.type === 0x0)
    .map((chunk, index) => decodeMesh(bytes, chunk, index))
    .filter(Boolean)
  const geometryNodes = meshes.reduce(
    (sum, mesh) => sum + mesh.primitive.positions.length / 3 + mesh.primitive.indices.length / 3,
    0,
  )
  if (geometryNodes > budget.maxNodes) throw new RangeError('W3D geometry exceeds maxNodes')
  const decodedBytes = meshes.reduce((sum, mesh) => sum + mesh.decodedBytes, 0)
  if (decodedBytes > budget.maxScalarBytes)
    throw new RangeError('W3D geometry exceeds maxScalarBytes')
  return Object.freeze({ meshes: Object.freeze(meshes), decodedBytes })
}

function modelSource(total, decoded) {
  const bounds = unionBounds(decoded.meshes)
  const textures = [...new Set(decoded.meshes.flatMap(mesh => mesh.textures))]
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: decoded.meshes.length,
      primitives: decoded.meshes.length,
      materials: decoded.meshes.length,
      textures: textures.length,
      animations: 0,
      ...(bounds === undefined ? {} : { bounds }),
      geometryAccess: decoded.meshes.length > 0 ? 'decoded' : 'metadata-only',
    },
    nodes: [
      {
        id: 'w3d-root',
        name: `Westwood W3D structural root (${total} chunks)`,
        childIds: [],
        meshIds: decoded.meshes.map(mesh => mesh.id),
        transform: IDENTITY,
      },
    ],
    meshes: decoded.meshes.map(mesh => ({
      id: mesh.id,
      name: mesh.name,
      primitiveIds: [mesh.primitive.id],
    })),
    primitives: decoded.meshes.map(mesh => mesh.primitive),
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
    const state = { nodes: 0, trailingBytes: 0 }
    const roots = readChunks(bytes, 0, bytes.byteLength, 0, state, context.budget)
    const all = flatten(roots)
    const decoded = decodedMeshes(bytes, roots, context.budget)
    const textures = [...new Set(decoded.meshes.flatMap(mesh => mesh.textures))]
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
        opaqueTailBytes: state.trailingBytes,
        chunkTypes: types,
        decodedMeshes: decoded.meshes.length,
        decodedVertices: decoded.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.positions.length / 3,
          0,
        ),
        decodedTriangles: decoded.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.indices.length / 3,
          0,
        ),
        textures,
        geometryAccess: decoded.meshes.length > 0 ? 'decoded' : 'metadata-only',
      },
      metadata: [
        {
          id: 'westwood-w3d-model',
          label: 'Westwood W3D model',
          entries: [
            { key: 'rootChunks', value: roots.length },
            { key: 'chunks', value: all.length },
            { key: 'opaqueTailBytes', value: state.trailingBytes },
            {
              key: 'chunkTypes',
              value: types.map(type => `${type.name}:${type.count}`).join(', '),
            },
            { key: 'decodedMeshes', value: decoded.meshes.length },
            { key: 'textures', value: textures.length },
            {
              key: 'geometryAccess',
              value: decoded.meshes.length > 0 ? 'decoded' : 'metadata-only',
            },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: { meshes: decoded.meshes.length, decoded: decoded.meshes.length > 0 },
        },
        ...(textures.length > 0
          ? [{ id: 'model.textures', parameters: { count: textures.length } }]
          : []),
        { id: 'structure.hierarchy', parameters: { chunks: all.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/model-scene-source': modelSource(all.length, decoded),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Westwood W3D',
          preview: `${all.length} chunks`,
          children: roots.map(treeChunk),
        }),
      },
      maxDecodedBytes: Math.max(bytes.byteLength, decoded.decodedBytes),
      unsupportedFeatures: [
        ...(decoded.meshes.length === 0 ? ['remaining-w3d-geometry-variants'] : []),
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
