import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/unity-mesh'
const MAGIC = new TextEncoder().encode('MKXUNITYMESH\0')
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function hasMagic(bytes) {
  return (
    bytes.byteLength >= MAGIC.byteLength && MAGIC.every((value, index) => bytes[index] === value)
  )
}

function segment(header, name, payloadBytes, componentType, multiple) {
  const value = header.segments?.[name]
  if (
    value === null ||
    typeof value !== 'object' ||
    value.componentType !== componentType ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0 ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength % multiple !== 0 ||
    value.offset + value.byteLength > payloadBytes.byteLength
  ) {
    throw new TypeError(`Unity mesh ${name} segment is invalid`)
  }
  return payloadBytes.subarray(value.offset, value.offset + value.byteLength)
}

function parseMesh(bytes, context) {
  if (!hasMagic(bytes) || bytes.byteLength < MAGIC.byteLength + 4) {
    throw new TypeError('not a MKXUNITYMESH payload')
  }
  if (BigInt(bytes.byteLength) > context.budget.maxInputBytes) {
    throw new RangeError('Unity mesh exceeds maxInputBytes')
  }
  const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    MAGIC.byteLength,
    true,
  )
  const jsonStart = MAGIC.byteLength + 4
  const payloadStart = jsonStart + jsonLength
  if (jsonLength < 2 || payloadStart > bytes.byteLength) {
    throw new RangeError('Unity mesh JSON header is truncated')
  }
  if (jsonLength > context.budget.maxScalarBytes) {
    throw new RangeError('Unity mesh JSON exceeds maxScalarBytes')
  }
  let header
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, payloadStart)))
  } catch {
    throw new TypeError('Unity mesh JSON header is invalid')
  }
  if (
    header === null ||
    typeof header !== 'object' ||
    Array.isArray(header) ||
    header.version !== 2 ||
    !Number.isSafeInteger(header.vertexCount) ||
    header.vertexCount < 3 ||
    header.vertexCount > context.budget.maxNodes ||
    !Array.isArray(header.submeshes) ||
    header.submeshes.length < 1 ||
    header.submeshes.length > context.budget.maxNodes
  ) {
    throw new TypeError('unsupported Unity mesh payload header')
  }
  const payload = bytes.subarray(payloadStart)
  const positionBytes = segment(header, 'positions', payload, 'float32', 4)
  if (positionBytes.byteLength !== header.vertexCount * 12) {
    throw new TypeError('Unity mesh position count does not match vertexCount')
  }
  const indexType = header.indexComponentType
  if (indexType !== 'uint16' && indexType !== 'uint32') {
    throw new TypeError('Unity mesh index component type is unsupported')
  }
  const indexStride = indexType === 'uint16' ? 2 : 4
  const indexBytes = segment(header, 'indices', payload, indexType, indexStride)
  const indexCount = indexBytes.byteLength / indexStride
  if (indexCount < 3 || indexCount % 3 !== 0) {
    throw new TypeError('Unity mesh indices do not form triangles')
  }
  if (header.vertexCount + indexCount > context.budget.maxNodes) {
    throw new RangeError('Unity mesh exceeds maxNodes')
  }
  const positions = new Float32Array(header.vertexCount * 3)
  const positionView = new DataView(
    positionBytes.buffer,
    positionBytes.byteOffset,
    positionBytes.byteLength,
  )
  for (let vertex = 0; vertex < header.vertexCount; vertex += 1) {
    const offset = vertex * 12
    const x = positionView.getFloat32(offset, true)
    const y = positionView.getFloat32(offset + 4, true)
    const z = positionView.getFloat32(offset + 8, true)
    if (![x, y, z].every(Number.isFinite)) {
      throw new TypeError(`Unity mesh vertex ${vertex} contains a non-finite coordinate`)
    }
    positions[vertex * 3] = x
    positions[vertex * 3 + 1] = -z || 0
    positions[vertex * 3 + 2] = y
  }
  const indexView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength)
  const indices = new Uint32Array(indexCount)
  for (let index = 0; index < indexCount; index += 1) {
    const value =
      indexType === 'uint16'
        ? indexView.getUint16(index * 2, true)
        : indexView.getUint32(index * 4, true)
    if (value >= header.vertexCount)
      throw new RangeError(`Unity mesh index ${value} is out of range`)
    indices[index] = value
  }
  const submeshes = header.submeshes.map((value, index) => {
    if (
      value === null ||
      typeof value !== 'object' ||
      value.topology !== 0 ||
      !Number.isSafeInteger(value.firstIndex) ||
      value.firstIndex < 0 ||
      !Number.isSafeInteger(value.indexCount) ||
      value.indexCount < 3 ||
      value.indexCount % 3 !== 0 ||
      value.firstIndex + value.indexCount > indexCount
    ) {
      throw new TypeError(`Unity mesh submesh ${index} is invalid or non-triangular`)
    }
    return {
      name: typeof value.name === 'string' ? value.name : `Submesh ${index}`,
      firstIndex: value.firstIndex,
      indexCount: value.indexCount,
    }
  })
  const scalarBytes = jsonLength + submeshes.reduce((sum, value) => sum + value.name.length, 0)
  if (scalarBytes > context.budget.maxScalarBytes) {
    throw new RangeError('Unity mesh metadata exceeds maxScalarBytes')
  }
  return {
    name: typeof header.name === 'string' ? header.name : 'Unity mesh',
    unityVersion: typeof header.unityVersion === 'string' ? header.unityVersion : '',
    vertexCount: header.vertexCount,
    positions,
    indices,
    indexType,
    submeshes,
    jsonLength,
  }
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis])
      max[axis] = Math.max(max[axis], positions[offset + axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function modelSource(mesh) {
  const bounds = boundsOf(mesh.positions)
  const primitives = mesh.submeshes.map((submesh, index) =>
    Object.freeze({
      id: `primitive-${index}`,
      topology: 'triangles',
      positions: mesh.positions,
      indices: mesh.indices.slice(submesh.firstIndex, submesh.firstIndex + submesh.indexCount),
      bounds,
    }),
  )
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: primitives.length,
      materials: 0,
      textures: 0,
      animations: 0,
      bounds,
      geometryAccess: 'decoded',
    },
    nodes: [
      { id: 'root', name: mesh.name, childIds: [], meshIds: ['mesh-0'], transform: IDENTITY },
    ],
    meshes: [{ id: 'mesh-0', name: mesh.name, primitiveIds: primitives.map(value => value.id) }],
    primitives,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'unity-mesh', label: 'Unity serialized Mesh payload' }),
  async detect(prefix) {
    return hasMagic(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'mkx-unity-mesh' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const mesh = parseMesh(bytes, context)
    const scene = modelSource(mesh)
    return {
      summary: {
        format: 'unity-mesh',
        profile: 'MKXUNITYMESH/triangles',
        name: mesh.name,
        unityVersion: mesh.unityVersion,
        vertices: mesh.vertexCount,
        indices: mesh.indices.length,
        triangles: mesh.indices.length / 3,
        submeshes: mesh.submeshes.length,
        indexType: mesh.indexType,
      },
      metadata: [
        {
          id: 'unity-mesh',
          label: 'Unity mesh payload',
          entries: [
            { key: 'name', value: mesh.name },
            { key: 'unityVersion', value: mesh.unityVersion || '(unknown)' },
            { key: 'vertices', value: mesh.vertexCount },
            { key: 'indices', value: mesh.indices.length },
            { key: 'submeshes', value: mesh.submeshes.length },
            { key: 'indexType', value: mesh.indexType },
            { key: 'headerBytes', value: mesh.jsonLength },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: {
            vertices: mesh.vertexCount,
            triangles: mesh.indices.length / 3,
            primitives: mesh.submeshes.length,
          },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: mesh.name,
          preview: `${mesh.vertexCount} vertices; ${mesh.indices.length / 3} triangles`,
          children: mesh.submeshes.map((submesh, index) => ({
            kind: 'mesh',
            label: submesh.name,
            preview: `${submesh.indexCount / 3} triangles; primitive ${index}`,
          })),
        }),
        'common.view/model-scene-source': scene,
      },
      unsupportedFeatures: [
        'raw-serialized-assets-input',
        'non-triangle-topologies',
        'normals-tangents-uvs-colors',
        'materials-skeletons-morph-targets-and-animations',
        'mesh-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
