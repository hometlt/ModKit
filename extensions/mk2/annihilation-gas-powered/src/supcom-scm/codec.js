// Hand-ported from org.modkitx/supcom-scm. This dependency-free profile decodes SCM v5
// geometry and the authored bone hierarchy; SCA/BP/DDS companions remain resolver work.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/supcom-scm'
const VERSION = 5
const HEADER_BYTES = 0x30
const NAME_START = 0x40
const SKELETON_STRIDE = 108
const VERTEX_STRIDE = 68
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const ascii = new TextDecoder('ascii')

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function tag(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) return ''
  return ascii.decode(bytes.subarray(offset, offset + 4))
}

function signature(bytes) {
  return bytes.byteLength >= 4 && tag(bytes, 0) === 'MODL'
}

function checkedSpan(offset, count, stride, label) {
  const length = count * stride
  const end = offset + length
  if (!Number.isSafeInteger(length) || !Number.isSafeInteger(end)) {
    throw new RangeError(`SCM ${label} span overflows`)
  }
  return Object.freeze({ offset, length, end })
}

function section(bytes, dataOffset, marker) {
  if (!Number.isSafeInteger(dataOffset) || dataOffset < 4 || dataOffset > bytes.byteLength) {
    throw new RangeError(`SCM ${marker} offset is outside the file`)
  }
  if (tag(bytes, dataOffset - 4) !== marker) {
    throw new TypeError(`SCM ${marker} section marker is missing`)
  }
}

function readHeader(bytes, budget) {
  if (!signature(bytes)) throw new TypeError('SCM MODL signature is invalid')
  if (bytes.byteLength < HEADER_BYTES) throw new TypeError('SCM header is truncated')
  const view = viewOf(bytes)
  const header = Object.freeze({
    version: view.getUint32(0x04, true),
    skeletonOffset: view.getUint32(0x08, true),
    skeletonRecords: view.getUint32(0x0c, true),
    vertexOffset: view.getUint32(0x10, true),
    extraVertexOffset: view.getUint32(0x14, true),
    vertices: view.getUint32(0x18, true),
    indexOffset: view.getUint32(0x1c, true),
    indices: view.getUint32(0x20, true),
    infoOffset: view.getUint32(0x24, true),
    infoVariant: view.getUint32(0x28, true),
    names: view.getUint32(0x2c, true),
  })
  if (header.version !== VERSION) throw new TypeError(`unsupported SCM version ${header.version}`)
  if (header.vertices === 0 || header.indices === 0) {
    throw new TypeError('SCM geometry buffers must not be empty')
  }
  if (header.indices % 3 !== 0) throw new TypeError('SCM index count is not divisible by three')
  if (header.vertices + header.indices + header.skeletonRecords > budget.maxNodes) {
    throw new RangeError('SCM records exceed the maxNodes budget')
  }
  section(bytes, NAME_START, 'NAME')
  section(bytes, header.skeletonOffset, 'SKEL')
  section(bytes, header.vertexOffset, 'VTXL')
  section(bytes, header.indexOffset, 'TRIS')
  const hasInfo = header.infoOffset >= 4 && tag(bytes, header.infoOffset - 4) === 'INFO'
  if (header.infoOffset !== 0 && !hasInfo) throw new TypeError('SCM INFO section marker is missing')
  if (!(
    NAME_START <= header.skeletonOffset - 4 &&
    header.skeletonOffset <= header.vertexOffset - 4 &&
    header.vertexOffset <= header.indexOffset - 4
  )) {
    throw new RangeError('SCM sections are out of order')
  }
  const skeleton = checkedSpan(
    header.skeletonOffset,
    header.skeletonRecords,
    SKELETON_STRIDE,
    'skeleton',
  )
  const vertices = checkedSpan(header.vertexOffset, header.vertices, VERTEX_STRIDE, 'vertex')
  const indices = checkedSpan(header.indexOffset, header.indices, 2, 'index')
  if (skeleton.end > header.vertexOffset - 4) throw new RangeError('SCM skeleton overlaps VTXL')
  if (vertices.end > header.indexOffset - 4) throw new RangeError('SCM vertex buffer overlaps TRIS')
  const indexLimit = hasInfo ? header.infoOffset - 4 : bytes.byteLength
  if (indices.end > indexLimit)
    throw new RangeError('SCM index buffer is truncated or overlaps INFO')
  const decodedBytes = header.vertices * (3 + 3 + 2) * 4 + header.indices * 4
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > budget.maxScalarBytes) {
    throw new RangeError('SCM decoded geometry exceeds the maxScalarBytes budget')
  }
  return Object.freeze({
    ...header,
    hasInfo,
    skeleton,
    vertexSpan: vertices,
    indexSpan: indices,
    decodedBytes,
  })
}

function stringTable(bytes, start, end) {
  const values = []
  let chunk = []
  const push = () => {
    if (chunk.length === 0) return
    const value = ascii.decode(Uint8Array.from(chunk)).trim()
    if (value !== '') values.push(value)
    chunk = []
  }
  for (let offset = start; offset < end; offset += 1) {
    const value = bytes[offset]
    if (value === 0) push()
    else if (value !== 0xc5 && value !== 0xcc) chunk.push(value)
  }
  push()
  return Object.freeze(values)
}

function cString(bytes, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.byteLength) return ''
  let end = offset
  while (end < bytes.byteLength && bytes[end] !== 0) end += 1
  return ascii.decode(bytes.subarray(offset, end)).trim()
}

function finiteFloat(view, offset, label) {
  const value = view.getFloat32(offset, true)
  if (!Number.isFinite(value)) throw new TypeError(`SCM ${label} is not finite`)
  return value
}

function transformOf(translation, rotation) {
  const [x, y, z, w] = rotation
  const length = Math.hypot(x, y, z, w)
  if (length === 0) throw new TypeError('SCM bone quaternion has zero length')
  const qx = x / length
  const qy = y / length
  const qz = z / length
  const qw = w / length
  const xx = qx * qx
  const yy = qy * qy
  const zz = qz * qz
  const xy = qx * qy
  const xz = qx * qz
  const yz = qy * qz
  const wx = qw * qx
  const wy = qw * qy
  const wz = qw * qz
  return Object.freeze([
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    0,
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    0,
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ])
}

function readBones(bytes, header, names) {
  const view = viewOf(bytes)
  const bones = []
  for (let index = 0; index < header.skeletonRecords; index += 1) {
    const offset = header.skeletonOffset + index * SKELETON_STRIDE
    const translation = [
      finiteFloat(view, offset + 64, `bone ${index} translation x`),
      finiteFloat(view, offset + 68, `bone ${index} translation y`),
      finiteFloat(view, offset + 72, `bone ${index} translation z`),
    ]
    const rotation = [
      finiteFloat(view, offset + 80, `bone ${index} rotation x`),
      finiteFloat(view, offset + 84, `bone ${index} rotation y`),
      finiteFloat(view, offset + 88, `bone ${index} rotation z`),
      finiteFloat(view, offset + 76, `bone ${index} rotation w`),
    ]
    const nameOffset = view.getInt32(offset + 92, true)
    const parent = view.getInt32(offset + 96, true)
    if (parent < -1 || parent >= index)
      throw new TypeError(`SCM bone ${index} has invalid parent ${parent}`)
    bones.push(
      Object.freeze({
        index,
        name: cString(bytes, nameOffset) || names[index] || `Bone_${index}`,
        parent,
        transform: transformOf(translation, rotation),
      }),
    )
  }
  return Object.freeze(bones)
}

function readGeometry(bytes, header) {
  const view = viewOf(bytes)
  const positions = new Float32Array(header.vertices * 3)
  const normals = new Float32Array(header.vertices * 3)
  const textureCoordinates = new Float32Array(header.vertices * 2)
  for (let vertex = 0; vertex < header.vertices; vertex += 1) {
    const source = header.vertexOffset + vertex * VERTEX_STRIDE
    for (let axis = 0; axis < 3; axis += 1) {
      positions[vertex * 3 + axis] = finiteFloat(
        view,
        source + axis * 4,
        `vertex ${vertex} position`,
      )
      normals[vertex * 3 + axis] = finiteFloat(
        view,
        source + 12 + axis * 4,
        `vertex ${vertex} normal`,
      )
    }
    textureCoordinates[vertex * 2] = finiteFloat(view, source + 48, `vertex ${vertex} u`)
    textureCoordinates[vertex * 2 + 1] = finiteFloat(view, source + 52, `vertex ${vertex} v`)
  }
  const indices = new Uint32Array(header.indices)
  for (let index = 0; index < header.indices; index += 1) {
    const value = view.getUint16(header.indexOffset + index * 2, true)
    if (value >= header.vertices) throw new RangeError(`SCM index ${value} is out of range`)
    indices[index] = value
  }
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis])
      max[axis] = Math.max(max[axis], positions[offset + axis])
    }
  }
  return Object.freeze({
    positions,
    normals,
    textureCoordinates,
    indices,
    bounds: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }),
  })
}

function sceneOf(geometry, bones) {
  const roots = bones.filter(bone => bone.parent === -1)
  const nodes = [
    {
      id: 'model',
      name: 'Supreme Commander model',
      childIds: roots.map(bone => `bone-${bone.index}`),
      meshIds: ['mesh-0'],
      transform: IDENTITY,
    },
    ...bones.map(bone => ({
      id: `bone-${bone.index}`,
      name: bone.name,
      childIds: bones
        .filter(child => child.parent === bone.index)
        .map(child => `bone-${child.index}`),
      meshIds: [],
      transform: bone.transform,
    })),
  ]
  const primitive = {
    id: 'primitive-0',
    topology: 'triangles',
    positions: geometry.positions,
    indices: geometry.indices,
    normals: geometry.normals,
    textureCoordinates: geometry.textureCoordinates,
    materialId: 'material-0',
    bounds: geometry.bounds,
  }
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: nodes.length,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: 3,
      animations: 0,
      bounds: geometry.bounds,
      geometryAccess: 'decoded',
    },
    nodes,
    meshes: [{ id: 'mesh-0', name: 'SCM mesh', primitiveIds: [primitive.id] }],
    primitives: [primitive],
  })
}

function parseScm(bytes, context) {
  const header = readHeader(bytes, context.budget)
  const names = stringTable(bytes, NAME_START, header.skeletonOffset - 4)
  const bones = readBones(bytes, header, names)
  const geometry = readGeometry(bytes, header)
  const info = header.hasInfo ? stringTable(bytes, header.infoOffset, bytes.byteLength) : []
  return Object.freeze({ header, names, bones, geometry, info })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'supcom-scm', label: 'Supreme Commander SCM model' }),
  async detect(prefix) {
    return signature(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'modl-signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const model = parseScm(bytes, context)
    const { header, geometry, bones } = model
    const scene = sceneOf(geometry, bones)
    const tree = createTreeDataSource({
      kind: 'model',
      label: 'Supreme Commander SCM',
      preview: `${header.vertices} vertices, ${header.indices / 3} triangles`,
      children: [
        { kind: 'section', label: 'NAME', preview: `${model.names.length} name(s)` },
        { kind: 'section', label: 'SKEL', preview: `${bones.length} bone(s)` },
        { kind: 'section', label: 'VTXL', preview: `${header.vertices} vertices` },
        { kind: 'section', label: 'TRIS', preview: `${header.indices} indices` },
        ...(header.hasInfo
          ? [{ kind: 'section', label: 'INFO', preview: `${model.info.length} value(s)` }]
          : []),
      ],
    })
    return {
      summary: {
        format: 'supcom-scm',
        version: header.version,
        vertices: header.vertices,
        indices: header.indices,
        triangles: header.indices / 3,
        bones: bones.length,
        names: model.names,
        info: model.info,
        bounds: geometry.bounds,
        geometryAccess: 'decoded',
      },
      metadata: [
        {
          id: 'supcom-scm-model',
          label: 'Supreme Commander SCM model',
          entries: [
            { key: 'version', value: header.version },
            { key: 'vertices', value: header.vertices },
            { key: 'triangles', value: header.indices / 3 },
            { key: 'bones', value: bones.length },
            { key: 'names', value: model.names },
            { key: 'info', value: model.info },
            { key: 'textureConvention', value: '{model}_{Albedo,NormalsTS,SpecTeam}.dds' },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: { triangles: header.indices / 3, bounds: geometry.bounds },
        },
        { id: 'structure.hierarchy', parameters: { bones: bones.length } },
        { id: 'content.binary', parameters: { version: header.version } },
      ],
      maxDecodedBytes: header.decodedBytes,
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/model-scene-source': scene,
      },
      unsupportedFeatures: [
        'skinning-weights-in-model-scene-source',
        'secondary-uv-and-tangent-publication',
        'sca-animation-sidecars',
        'bp-blueprint-overrides',
        'dds-texture-resolution',
        'model-rendering',
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
