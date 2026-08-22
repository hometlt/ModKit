// Hand-ported from org.modkitx/ply. PLY 1.0 ASCII and both binary byte orders are decoded from
// the element/property schema; polygon faces are deterministically triangulated as fans.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/ply'
const decoder = new TextDecoder('ascii', { fatal: false })
const encoder = new TextEncoder()
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const END_HEADER = encoder.encode('end_header')
const INTEGER_TYPES = new Set(['char', 'uchar', 'short', 'ushort', 'int', 'uint'])
const TYPE_ALIASES = Object.freeze({
  int8: 'char',
  uint8: 'uchar',
  int16: 'short',
  uint16: 'ushort',
  int32: 'int',
  uint32: 'uint',
  float32: 'float',
  float64: 'double',
})
const TYPE_RANGES = Object.freeze({
  char: [-128, 127],
  uchar: [0, 255],
  short: [-32768, 32767],
  ushort: [0, 65535],
  int: [-2147483648, 2147483647],
  uint: [0, 4294967295],
})

function boundsFromPositions(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis]
      if (!Number.isFinite(value)) throw new TypeError('PLY position is not finite')
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function geometryByteLength(geometry) {
  return (
    geometry.positions.byteLength +
    (geometry.indices?.byteLength ?? 0) +
    (geometry.normals?.byteLength ?? 0) +
    (geometry.textureCoordinates?.byteLength ?? 0)
  )
}

function decodedModelSources(geometry, preview, children) {
  const primitive = {
    id: 'primitive-0',
    topology: geometry.topology,
    positions: geometry.positions,
    ...(geometry.indices === undefined ? {} : { indices: geometry.indices }),
    ...(geometry.normals === undefined ? {} : { normals: geometry.normals }),
    ...(geometry.textureCoordinates === undefined
      ? {}
      : { textureCoordinates: geometry.textureCoordinates }),
    bounds: geometry.bounds,
  }
  return Object.freeze({
    bounds: geometry.bounds,
    scene: createModelSceneSource({
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 0,
        textures: 0,
        animations: 0,
        bounds: geometry.bounds,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'root',
          name: 'PLY root',
          childIds: [],
          meshIds: ['mesh-0'],
          transform: IDENTITY,
        },
      ],
      meshes: [{ id: 'mesh-0', name: 'PLY mesh', primitiveIds: [primitive.id] }],
      primitives: [primitive],
    }),
    tree: createTreeDataSource({ kind: 'model', label: 'PLY', preview, children }),
  })
}

function normalizeType(value) {
  const lower = value?.toLowerCase()
  const normalized = TYPE_ALIASES[lower] ?? lower
  return [...INTEGER_TYPES, 'float', 'double'].includes(normalized) ? normalized : undefined
}

function scalarSize(type) {
  if (type === 'char' || type === 'uchar') return 1
  if (type === 'short' || type === 'ushort') return 2
  if (type === 'double') return 8
  return 4
}

function headerBoundary(bytes) {
  for (let offset = 0; offset <= bytes.byteLength - END_HEADER.byteLength; offset += 1) {
    const lineStart = offset === 0 || bytes[offset - 1] === 0x0a || bytes[offset - 1] === 0x0d
    if (!lineStart) continue
    if (!END_HEADER.every((value, index) => bytes[offset + index] === value)) continue
    let end = offset + END_HEADER.byteLength
    if (bytes[end] === 0x0d && bytes[end + 1] === 0x0a) end += 2
    else if (bytes[end] === 0x0a || bytes[end] === 0x0d) end += 1
    else if (end !== bytes.byteLength) continue
    return { textEnd: offset + END_HEADER.byteLength, bodyOffset: end }
  }
  return undefined
}

function parseCount(value, label) {
  if (!/^(?:0|[1-9]\d*)$/u.test(value ?? '')) throw new TypeError(`PLY ${label} is not a count`)
  const count = Number(value)
  if (!Number.isSafeInteger(count)) throw new RangeError(`PLY ${label} exceeds safe integer range`)
  return count
}

function parseHeader(bytes, budget) {
  const boundary = headerBoundary(bytes)
  if (boundary === undefined) throw new TypeError('PLY header is missing end_header')
  if (boundary.bodyOffset > budget.maxScalarBytes) {
    throw new RangeError('PLY header exceeds the maxScalarBytes budget')
  }
  const lines = decoder.decode(bytes.subarray(0, boundary.textEnd)).split(/\r?\n|\r/u)
  if (lines[0] !== 'ply') throw new TypeError('PLY magic line is invalid')
  const elements = []
  const comments = []
  let format
  let current
  for (const raw of lines.slice(1)) {
    const line = raw.trim()
    if (line === '' || line === 'end_header') continue
    const parts = line.split(/\s+/u)
    const keyword = parts[0]
    if (keyword === 'format') {
      if (format !== undefined || parts.length !== 3 || parts[2] !== '1.0') {
        throw new TypeError('PLY must declare exactly one supported format version 1.0')
      }
      if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(parts[1])) {
        throw new TypeError(`PLY format ${parts[1] ?? ''} is unsupported`)
      }
      format = parts[1]
    } else if (keyword === 'comment' || keyword === 'obj_info') {
      comments.push(line.slice(keyword.length).trim())
    } else if (keyword === 'element') {
      if (parts.length !== 3 || parts[1] === '')
        throw new TypeError('PLY element declaration is malformed')
      current = { name: parts[1], count: parseCount(parts[2], 'element count'), properties: [] }
      elements.push(current)
    } else if (keyword === 'property') {
      if (current === undefined) throw new TypeError('PLY property appears before an element')
      if (parts[1] === 'list') {
        const countType = normalizeType(parts[2])
        const itemType = normalizeType(parts[3])
        if (
          parts.length !== 5 ||
          countType === undefined ||
          !INTEGER_TYPES.has(countType) ||
          itemType === undefined
        ) {
          throw new TypeError('PLY list property declaration is malformed')
        }
        current.properties.push({ kind: 'list', countType, itemType, name: parts[4] })
      } else {
        const type = normalizeType(parts[1])
        if (parts.length !== 3 || type === undefined) {
          throw new TypeError('PLY scalar property declaration is malformed')
        }
        current.properties.push({ kind: 'scalar', type, name: parts[2] })
      }
    } else {
      throw new TypeError(`PLY header directive ${keyword} is unsupported`)
    }
  }
  if (format === undefined) throw new TypeError('PLY header has no format declaration')
  if (elements.length === 0) throw new TypeError('PLY header declares no elements')
  const records = elements.reduce((total, element) => total + element.count, 0)
  if (!Number.isSafeInteger(records) || records > budget.maxNodes) {
    throw new RangeError('PLY element records exceed the maxNodes budget')
  }
  if (elements.some(element => element.count > 0 && element.properties.length === 0)) {
    throw new TypeError('PLY element with records has no properties')
  }
  return Object.freeze({ format, elements, comments, bodyOffset: boundary.bodyOffset })
}

function validateScalar(value, type, label) {
  if (!Number.isFinite(value)) throw new TypeError(`PLY ${label} is not finite`)
  if (INTEGER_TYPES.has(type)) {
    const range = TYPE_RANGES[type]
    if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
      throw new TypeError(`PLY ${label} is outside the ${type} range`)
    }
  }
  return value
}

function readBinaryScalar(view, offset, type, littleEndian) {
  const size = scalarSize(type)
  if (offset + size > view.byteLength) throw new TypeError('PLY binary body is truncated')
  let value
  if (type === 'char') value = view.getInt8(offset)
  else if (type === 'uchar') value = view.getUint8(offset)
  else if (type === 'short') value = view.getInt16(offset, littleEndian)
  else if (type === 'ushort') value = view.getUint16(offset, littleEndian)
  else if (type === 'int') value = view.getInt32(offset, littleEndian)
  else if (type === 'uint') value = view.getUint32(offset, littleEndian)
  else if (type === 'float') value = view.getFloat32(offset, littleEndian)
  else value = view.getFloat64(offset, littleEndian)
  return { value: validateScalar(value, type, 'binary scalar'), offset: offset + size }
}

function asciiReader(bytes, header, budget) {
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError('ASCII PLY text exceeds the maxScalarBytes budget')
  }
  const body = decoder.decode(bytes.subarray(header.bodyOffset)).trim()
  const tokens = body === '' ? [] : body.split(/\s+/u)
  let offset = 0
  return {
    scalar(type) {
      const token = tokens[offset]
      if (token === undefined) throw new TypeError('PLY ASCII body is truncated')
      offset += 1
      if (INTEGER_TYPES.has(type) && !/^[+-]?\d+$/u.test(token)) {
        throw new TypeError('PLY ASCII integer token is malformed')
      }
      return validateScalar(Number(token), type, 'ASCII scalar')
    },
    finish() {
      if (offset !== tokens.length) throw new TypeError('PLY ASCII body has trailing tokens')
    },
  }
}

function binaryReader(bytes, header) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const littleEndian = header.format === 'binary_little_endian'
  let offset = header.bodyOffset
  return {
    scalar(type) {
      const result = readBinaryScalar(view, offset, type, littleEndian)
      offset = result.offset
      return result.value
    },
    finish() {
      if (offset !== bytes.byteLength) throw new TypeError('PLY binary body has trailing bytes')
    },
  }
}

function firstScalar(record, names) {
  for (const name of names) {
    const value = record.get(name)
    if (typeof value === 'number') return value
  }
  return undefined
}

function parseBody(bytes, header, budget) {
  const reader =
    header.format === 'ascii' ? asciiReader(bytes, header, budget) : binaryReader(bytes, header)
  const vertices = []
  const faces = []
  let listItems = 0
  for (const element of header.elements) {
    for (let row = 0; row < element.count; row += 1) {
      const record = new Map()
      for (const property of element.properties) {
        if (property.kind === 'scalar') {
          record.set(property.name, reader.scalar(property.type))
          continue
        }
        const count = reader.scalar(property.countType)
        if (count < 0) throw new TypeError('PLY list count is negative')
        listItems += count
        if (count > budget.maxNodes || listItems > budget.maxNodes) {
          throw new RangeError('PLY list items exceed the maxNodes budget')
        }
        const values = []
        for (let index = 0; index < count; index += 1) values.push(reader.scalar(property.itemType))
        record.set(property.name, values)
      }
      if (element.name === 'vertex') {
        const position = ['x', 'y', 'z'].map(name => firstScalar(record, [name]))
        if (!position.every(Number.isFinite))
          throw new TypeError('PLY vertex is missing finite x/y/z')
        const normal = ['nx', 'ny', 'nz'].map(name => firstScalar(record, [name]))
        const texture = [
          firstScalar(record, ['u', 's', 'texture_u', 'texture_s']),
          firstScalar(record, ['v', 't', 'texture_v', 'texture_t']),
        ]
        vertices.push({
          position,
          ...(normal.every(Number.isFinite) ? { normal } : {}),
          ...(texture.every(Number.isFinite) ? { texture } : {}),
        })
      } else if (element.name === 'face') {
        const indices = record.get('vertex_indices') ?? record.get('vertex_index')
        if (!Array.isArray(indices) || indices.length < 3) {
          throw new TypeError('PLY face has no vertex index list of at least three values')
        }
        faces.push(indices)
      }
    }
  }
  reader.finish()
  if (vertices.length === 0) throw new TypeError('PLY contains no vertex geometry')
  return Object.freeze({ vertices, faces })
}

function buildGeometry(parsed, budget) {
  const hasNormals = parsed.vertices.every(vertex => vertex.normal !== undefined)
  const hasTexture = parsed.vertices.every(vertex => vertex.texture !== undefined)
  const indexValues = []
  let triangles = 0
  for (const face of parsed.faces) {
    for (const index of face) {
      if (!Number.isInteger(index) || index < 0 || index >= parsed.vertices.length) {
        throw new TypeError(`PLY face references invalid vertex ${index}`)
      }
    }
    triangles += face.length - 2
    if (triangles > budget.maxNodes)
      throw new RangeError('PLY triangles exceed the maxNodes budget')
    for (let corner = 1; corner + 1 < face.length; corner += 1) {
      indexValues.push(face[0], face[corner], face[corner + 1])
    }
  }
  const expectedBytes =
    parsed.vertices.length * (12 + (hasNormals ? 12 : 0) + (hasTexture ? 8 : 0)) +
    indexValues.length * 4
  if (expectedBytes > budget.maxScalarBytes) {
    throw new RangeError('PLY decoded geometry exceeds the maxScalarBytes budget')
  }
  const positions = new Float32Array(parsed.vertices.flatMap(vertex => vertex.position))
  const normals = hasNormals
    ? new Float32Array(parsed.vertices.flatMap(vertex => vertex.normal))
    : undefined
  const textureCoordinates = hasTexture
    ? new Float32Array(parsed.vertices.flatMap(vertex => vertex.texture))
    : undefined
  return Object.freeze({
    topology: parsed.faces.length === 0 ? 'points' : 'triangles',
    positions,
    ...(indexValues.length === 0 ? {} : { indices: new Uint32Array(indexValues) }),
    ...(normals === undefined ? {} : { normals }),
    ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
    bounds: boundsFromPositions(positions),
    triangles,
  })
}

function parsePly(bytes, budget) {
  const header = parseHeader(bytes, budget)
  const body = parseBody(bytes, header, budget)
  return Object.freeze({ header, body, geometry: buildGeometry(body, budget) })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'ply', label: 'PLY polygon mesh', mediaType: 'model/ply' }),
  async detect(prefix) {
    if (
      prefix[0] !== 0x70 ||
      prefix[1] !== 0x6c ||
      prefix[2] !== 0x79 ||
      (prefix[3] !== 0x0a && prefix[3] !== 0x0d)
    ) {
      return { confidence: 0, kind: 'magic', note: 'ply-magic-mismatch' }
    }
    const boundary = headerBoundary(prefix)
    return boundary === undefined
      ? { confidence: 0.82, kind: 'magic', note: 'ply-header-prefix' }
      : { confidence: 0.99, kind: 'structure', note: 'ply-1.0-header' }
  },
  async inspect(bytes, context) {
    const ply = parsePly(bytes, context.budget)
    const decodedBytes = geometryByteLength(ply.geometry)
    const sources = decodedModelSources(
      ply.geometry,
      `${ply.body.vertices.length} vertices, ${ply.geometry.triangles} triangles`,
      ply.header.elements.map(element => ({
        kind: 'element',
        label: element.name,
        preview: `${element.count} record(s), ${element.properties.length} properties`,
      })),
    )
    return {
      summary: {
        format: 'ply',
        version: '1.0',
        encoding: ply.header.format,
        vertices: ply.body.vertices.length,
        faces: ply.body.faces.length,
        triangles: ply.geometry.triangles,
        elements: ply.header.elements.length,
        bounds: sources.bounds,
      },
      metadata: [
        {
          id: 'ply-geometry',
          label: 'PLY geometry',
          entries: [
            { key: 'version', value: '1.0' },
            { key: 'encoding', value: ply.header.format },
            { key: 'vertices', value: ply.body.vertices.length },
            { key: 'faces', value: ply.body.faces.length },
            { key: 'triangles', value: ply.geometry.triangles },
            { key: 'comments', value: ply.header.comments.length },
            { key: 'bounds', value: sources.bounds },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: {
            vertices: ply.body.vertices.length,
            triangles: ply.geometry.triangles,
            bounds: sources.bounds,
          },
        },
        { id: 'structure.hierarchy', parameters: { elements: ply.header.elements.length } },
        { id: 'content.binary', parameters: { encoding: ply.header.format } },
      ],
      maxDecodedBytes: decodedBytes,
      dataSources: {
        'common.view/tree-data-source': sources.tree,
        'common.view/model-scene-source': sources.scene,
      },
      unsupportedFeatures: ['vertex-colours', 'non-polygon-elements'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
