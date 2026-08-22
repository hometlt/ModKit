// Hand-ported from org.modkitx/diablo3-app. This portable profile decodes APP v260 static
// submeshes and the authored bone hierarchy; ANI and material sidecars remain resolver work.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/diablo3-app'
const MAGIC = 0xdeadbeef
const VERSION = 260
const HEADER_BYTES = 0x228
const SUBMESH_BYTES = 400
const VERTEX_BYTES = 44
const BONE_BYTES = 312
const MATERIAL_BYTES = 144
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const latin1 = new TextDecoder('latin1')

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function range(bytes, offset, size, label) {
  const end = offset + size
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset < 0 ||
    size < 0 ||
    !Number.isSafeInteger(end) ||
    end > bytes.byteLength
  ) {
    throw new RangeError(`Diablo III APP ${label} is out of range`)
  }
  return offset
}

function dataOffset(bytes, storedOffset, size, label) {
  return range(bytes, storedOffset + 16, size, label)
}

function stringAt(bytes, offset, maximum) {
  range(bytes, offset, Math.min(maximum, bytes.byteLength - offset), 'string')
  const limit = Math.min(bytes.byteLength, offset + maximum)
  let end = offset
  while (end < limit && bytes[end] !== 0) end += 1
  return latin1.decode(bytes.subarray(offset, end)).trim()
}

function finite(view, offset, label) {
  const value = view.getFloat32(offset, true)
  if (!Number.isFinite(value)) throw new TypeError(`Diablo III APP ${label} is not finite`)
  return value
}

function decodeNormal(value) {
  return Math.max(-1, Math.min(1, (value - 127) / 127))
}

function cleanZero(value) {
  return value === 0 ? 0 : value
}

function transformMatrix(view, offset, label) {
  let x = finite(view, offset + 4, `${label} rotation x`)
  let y = -finite(view, offset, `${label} rotation y`)
  let z = finite(view, offset + 8, `${label} rotation z`)
  let w = finite(view, offset + 12, `${label} rotation w`)
  const length = Math.hypot(x, y, z, w)
  if (length === 0) {
    x = 0
    y = 0
    z = 0
    w = 1
  } else {
    x /= length
    y /= length
    z /= length
    w /= length
  }
  const scaleValue = finite(view, offset + 28, `${label} scale`)
  const scale = scaleValue === 0 ? 1 : scaleValue
  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const wx = w * x
  const wy = w * y
  const wz = w * z
  return Object.freeze([
    (1 - 2 * (yy + zz)) * scale,
    2 * (xy + wz) * scale,
    2 * (xz - wy) * scale,
    0,
    2 * (xy - wz) * scale,
    (1 - 2 * (xx + zz)) * scale,
    2 * (yz + wx) * scale,
    0,
    2 * (xz + wy) * scale,
    2 * (yz - wx) * scale,
    (1 - 2 * (xx + yy)) * scale,
    0,
    finite(view, offset + 20, `${label} translation x`) * 17,
    -finite(view, offset + 16, `${label} translation y`) * 17,
    finite(view, offset + 24, `${label} translation z`) * 17,
    1,
  ])
}

function parseHeader(bytes, context) {
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('Diablo III APP header is truncated')
  const view = viewOf(bytes)
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== VERSION) {
    throw new TypeError('Diablo III APP signature or version is invalid')
  }
  const header = Object.freeze({
    snoId: view.getInt32(0x10, true),
    objectType: view.getUint32(0x20, true),
    bones: view.getUint32(0x24, true),
    boneTable: view.getUint32(0x28, true),
    submeshes: view.getUint32(0x0a8, true),
    submeshTable: view.getUint32(0x0ac, true),
    materials: view.getUint32(0x1b4, true),
    materialTable: view.getUint32(0x1b8, true),
  })
  if (header.bones + header.submeshes + header.materials > context.budget.maxNodes) {
    throw new RangeError('Diablo III APP records exceed maxNodes budget')
  }
  if (header.submeshes > 0)
    dataOffset(bytes, header.submeshTable, header.submeshes * SUBMESH_BYTES, 'submesh table')
  if (header.bones > 0) dataOffset(bytes, header.boneTable, header.bones * BONE_BYTES, 'bone table')
  if (header.materials > 0)
    dataOffset(bytes, header.materialTable, header.materials * MATERIAL_BYTES, 'material table')
  return header
}

function parseMaterials(bytes, header) {
  if (header.materials === 0) return Object.freeze([])
  const table = header.materialTable + 16
  return Object.freeze(
    Array.from({ length: header.materials }, (_, index) =>
      Object.freeze({
        id: `material-${index}`,
        name: stringAt(bytes, table + index * MATERIAL_BYTES, 128) || `Material ${index}`,
      }),
    ),
  )
}

function materialFor(name, materials) {
  let winner
  for (const material of materials) {
    if (
      name.toLowerCase().includes(material.name.toLowerCase()) &&
      (winner === undefined || material.name.length > winner.name.length)
    )
      winner = material
  }
  return winner
}

function parseMeshes(bytes, header, materials, context) {
  const view = viewOf(bytes)
  const table = header.submeshTable + 16
  const meshes = []
  let decodedBytes = 0
  let recordNodes = header.bones + header.submeshes + header.materials
  for (let meshIndex = 0; meshIndex < header.submeshes; meshIndex += 1) {
    const entry = table + meshIndex * SUBMESH_BYTES
    const vertices = view.getUint32(entry + 4, true)
    const indices = view.getUint32(entry + 0x28, true)
    if (vertices === 0 && indices === 0) continue
    if (vertices === 0 || indices < 3 || indices % 3 !== 0)
      throw new TypeError(`Diablo III APP submesh ${meshIndex} has invalid geometry counts`)
    recordNodes += vertices + indices
    if (recordNodes > context.budget.maxNodes)
      throw new RangeError('Diablo III APP geometry records exceed maxNodes budget')
    const vertexOffset = dataOffset(
      bytes,
      view.getUint32(entry + 8, true),
      vertices * VERTEX_BYTES,
      `submesh ${meshIndex} vertices`,
    )
    const indexOffset = dataOffset(
      bytes,
      view.getUint32(entry + 0x2c, true),
      indices * 2,
      `submesh ${meshIndex} indices`,
    )
    const positions = new Float32Array(vertices * 3)
    const normals = new Float32Array(vertices * 3)
    const textureCoordinates = new Float32Array(vertices * 2)
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      const source = vertexOffset + vertex * VERTEX_BYTES
      positions[vertex * 3] =
        finite(view, source + 4, `submesh ${meshIndex} vertex ${vertex} x`) * 17
      positions[vertex * 3 + 1] = cleanZero(
        -finite(view, source, `submesh ${meshIndex} vertex ${vertex} y`) * 17,
      )
      positions[vertex * 3 + 2] =
        finite(view, source + 8, `submesh ${meshIndex} vertex ${vertex} z`) * 17
      normals[vertex * 3] = decodeNormal(bytes[source + 0x0d])
      normals[vertex * 3 + 1] = cleanZero(-decodeNormal(bytes[source + 0x0c]))
      normals[vertex * 3 + 2] = decodeNormal(bytes[source + 0x0e])
      textureCoordinates[vertex * 2] = cleanZero(
        -(32767 - view.getUint16(source + 0x18, true)) / 512,
      )
      textureCoordinates[vertex * 2 + 1] = cleanZero(
        -(32767 - view.getUint16(source + 0x1a, true)) / 512,
      )
    }
    const indexValues = new Uint32Array(indices)
    for (let index = 0; index < indices; index += 1) {
      const value = view.getUint16(indexOffset + index * 2, true)
      if (value >= vertices)
        throw new RangeError(`Diablo III APP submesh ${meshIndex} index ${value} is out of range`)
      indexValues[index] = value
    }
    const name = stringAt(bytes, entry + 0x5c, 128) || `Submesh ${meshIndex}`
    const material = materialFor(name, materials)
    const primitive = Object.freeze({
      id: `primitive-${meshIndex}`,
      topology: 'triangles',
      positions,
      normals,
      textureCoordinates,
      indices: indexValues,
      ...(material === undefined ? {} : { materialId: material.id }),
      bounds: boundsOf(positions),
    })
    decodedBytes +=
      positions.byteLength +
      normals.byteLength +
      textureCoordinates.byteLength +
      indexValues.byteLength
    if (decodedBytes > context.budget.maxScalarBytes)
      throw new RangeError('Diablo III APP decoded geometry exceeds maxScalarBytes budget')
    meshes.push(
      Object.freeze({
        index: meshIndex,
        name,
        fullPath: stringAt(bytes, entry + 0xdc, 128),
        renderFlags: view.getUint32(entry, true),
        primitive,
      }),
    )
  }
  return Object.freeze({ meshes: Object.freeze(meshes), decodedBytes })
}

function parseBones(bytes, header) {
  if (header.bones === 0) return Object.freeze([])
  const view = viewOf(bytes)
  const table = header.boneTable + 16
  const bones = []
  for (let index = 0; index < header.bones; index += 1) {
    const entry = table + index * BONE_BYTES
    const rawParent = view.getUint32(entry + 0x40, true)
    const parent = rawParent === 0xffffffff ? -1 : rawParent
    if (parent < -1 || parent >= index)
      throw new TypeError(`Diablo III APP bone ${index} has invalid parent ${parent}`)
    bones.push(
      Object.freeze({
        index,
        name: stringAt(bytes, entry, 64) || `Bone ${index}`,
        parent,
        transform: transformMatrix(view, entry + 0xac, `bone ${index}`),
      }),
    )
  }
  return Object.freeze(bones)
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

function modelBounds(meshes) {
  if (meshes.length === 0) return undefined
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const mesh of meshes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], mesh.primitive.bounds.min[axis])
      max[axis] = Math.max(max[axis], mesh.primitive.bounds.max[axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function sceneOf(model) {
  const roots = model.bones.filter(bone => bone.parent === -1)
  const nodes = [
    {
      id: 'model',
      name: 'Diablo III appearance',
      childIds: roots.map(bone => `bone-${bone.index}`),
      meshIds: model.meshes.map(mesh => `mesh-${mesh.index}`),
      transform: IDENTITY,
    },
    ...model.bones.map(bone => ({
      id: `bone-${bone.index}`,
      name: bone.name,
      childIds: model.bones
        .filter(child => child.parent === bone.index)
        .map(child => `bone-${child.index}`),
      meshIds: [],
      transform: bone.transform,
    })),
  ]
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: nodes.length,
      meshes: model.meshes.length,
      primitives: model.meshes.length,
      materials: model.materials.length,
      textures: 0,
      animations: 0,
      ...(model.bounds === undefined ? {} : { bounds: model.bounds }),
      geometryAccess: model.meshes.length === 0 ? 'metadata-only' : 'decoded',
    },
    nodes,
    meshes: model.meshes.map(mesh => ({
      id: `mesh-${mesh.index}`,
      name: mesh.name,
      primitiveIds: [mesh.primitive.id],
    })),
    primitives: model.meshes.map(mesh => mesh.primitive),
  })
}

function parseApp(bytes, context) {
  const header = parseHeader(bytes, context)
  const materials = parseMaterials(bytes, header)
  const parsedMeshes = parseMeshes(bytes, header, materials, context)
  const bones = parseBones(bytes, header)
  const bounds = modelBounds(parsedMeshes.meshes)
  return Object.freeze({
    header,
    materials,
    meshes: parsedMeshes.meshes,
    bones,
    bounds,
    decodedBytes: parsedMeshes.decodedBytes,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'diablo3-app', label: 'Diablo III appearance' }),
  async detect(prefix) {
    if (prefix.byteLength < 8) return { confidence: 0, kind: 'magic', note: 'header-truncated' }
    const view = viewOf(prefix)
    return view.getUint32(0, true) === MAGIC && view.getUint32(4, true) === VERSION
      ? { confidence: 0.99, kind: 'magic', note: 'deadbeef-v260' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const model = parseApp(bytes, context)
    const vertices = model.meshes.reduce(
      (sum, mesh) => sum + mesh.primitive.positions.length / 3,
      0,
    )
    const indices = model.meshes.reduce((sum, mesh) => sum + mesh.primitive.indices.length, 0)
    return {
      summary: {
        format: 'diablo3-app',
        version: VERSION,
        snoId: model.header.snoId,
        objectType: model.header.objectType,
        submeshes: model.meshes.length,
        vertices,
        indices,
        triangles: indices / 3,
        bones: model.bones.length,
        materials: model.materials.map(material => material.name),
        bounds: model.bounds ?? null,
        geometryAccess: model.meshes.length === 0 ? 'metadata-only' : 'decoded',
      },
      metadata: [
        {
          id: 'diablo3-app-model',
          label: 'Diablo III appearance',
          entries: [
            { key: 'version', value: VERSION },
            { key: 'snoId', value: model.header.snoId },
            { key: 'objectType', value: model.header.objectType },
            { key: 'submeshes', value: model.meshes.length },
            { key: 'vertices', value: vertices },
            { key: 'triangles', value: indices / 3 },
            { key: 'bones', value: model.bones.length },
            { key: 'materials', value: model.materials.map(material => material.name) },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: { triangles: indices / 3, bounds: model.bounds ?? null },
        },
        {
          id: 'structure.hierarchy',
          parameters: { bones: model.bones.length, submeshes: model.meshes.length },
        },
        { id: 'content.binary', parameters: { version: VERSION } },
      ],
      ...(model.decodedBytes > 0 ? { maxDecodedBytes: model.decodedBytes } : {}),
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'Diablo III APP',
          preview: `${model.meshes.length} submesh(es), ${model.bones.length} bone(s)`,
          children: [
            ...model.meshes.map(mesh => ({
              kind: 'mesh',
              label: mesh.name,
              preview: `${mesh.primitive.positions.length / 3} vertices; ${mesh.primitive.indices.length / 3} triangles`,
            })),
            ...model.bones.map(bone => ({
              kind: 'bone',
              label: bone.name,
              preview: bone.parent < 0 ? 'root' : `parent ${bone.parent}`,
            })),
          ],
        }),
        'common.view/model-scene-source': sceneOf(model),
      },
      unsupportedFeatures: [
        'skinning-weights-in-model-scene-source',
        'tangent-publication',
        'material-shader-and-texture-resolution',
        'ani-animation-sidecars',
        'model-rendering',
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
