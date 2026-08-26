import {
  createInspectionCodec,
  createModelResourceRefsSource,
  createModelSceneSource,
  createProjectionReceipt,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/spring-s3o'
const MAGIC = new TextEncoder().encode('Spring unit\0')
const HEADER_BYTES = 52
const PIECE_BYTES = 52
const VERTEX_BYTES = 32

function modelTree(label, nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const childIds = new Set(nodes.flatMap(node => node.childIds))
  const treeNode = id => {
    const node = byId.get(id)
    if (node === undefined) throw new TypeError(`S3O tree names an unknown piece ${id}`)
    return {
      kind: 'model-node',
      label: node.name ?? node.id,
      preview: `${node.meshIds.length} mesh(es)`,
      children: node.childIds.map(treeNode),
    }
  }
  return createTreeDataSource({
    kind: 'model',
    label,
    preview: `${nodes.length} piece(s)`,
    children: nodes.filter(node => !childIds.has(node.id)).map(node => treeNode(node.id)),
  })
}

function hasMagic(bytes) {
  return (
    bytes.byteLength >= MAGIC.byteLength && MAGIC.every((value, index) => bytes[index] === value)
  )
}

function checkedRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new RangeError(`S3O ${label} range is invalid`)
  }
  const end = offset + length
  if (!Number.isSafeInteger(end) || end > bytes.byteLength) {
    throw new RangeError(`S3O ${label} range is outside the file`)
  }
  return end
}

function logicalPath(value, label) {
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '')
  if (
    normalized.length === 0 ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split('/').some(segment => segment === '..' || segment.length === 0)
  ) {
    throw new TypeError(`S3O ${label} is not a confined logical path`)
  }
  return normalized
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`S3O ${label} is not finite`)
  return value
}

function reflectedX(value) {
  return value === 0 ? 0 : -value
}

function normal(x, y, z) {
  const mapped = [reflectedX(x), y, z]
  const length = Math.hypot(...mapped)
  return length === 0 ? [0, 0, 0] : mapped.map(value => value / length)
}

function localTransform(offset) {
  return Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset[0], offset[1], offset[2], 1])
}

function boundsOf(values) {
  if (values.length === 0) return undefined
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (let offset = 0; offset < values.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], values[offset + axis])
      max[axis] = Math.max(max[axis], values[offset + axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function trianglesFrom(type, source) {
  const out = []
  const add = (a, b, c) => {
    if (a === b || b === c || a === c) return
    // Negating X changes handedness. Reverse each native winding to keep the same front face.
    out.push(a, c, b)
  }
  if (type === 0) {
    if (source.length % 3 !== 0)
      throw new TypeError('S3O triangle index table is not divisible by three')
    for (let index = 0; index < source.length; index += 3)
      add(source[index], source[index + 1], source[index + 2])
    return out
  }
  if (type === 1) {
    let strip = []
    const flush = () => {
      for (let index = 2; index < strip.length; index += 1) {
        if (index % 2 === 0) add(strip[index - 2], strip[index - 1], strip[index])
        else add(strip[index - 1], strip[index - 2], strip[index])
      }
      strip = []
    }
    for (const value of source) {
      if (value === -1) flush()
      else strip.push(value)
    }
    flush()
    return out
  }
  if (type === 2) {
    if (source.length % 4 !== 0)
      throw new TypeError('S3O quad index table is not divisible by four')
    for (let index = 0; index < source.length; index += 4) {
      add(source[index], source[index + 1], source[index + 2])
      add(source[index], source[index + 2], source[index + 3])
    }
    return out
  }
  throw new RangeError(`S3O primitive type ${type} is unsupported`)
}

function parseS3o(bytes, budget, signal) {
  if (!hasMagic(bytes)) throw new TypeError('S3O magic is missing')
  checkedRange(bytes, 0, HEADER_BYTES, 'header')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getInt32(12, true)
  if (version !== 0) throw new RangeError(`S3O version ${version} is unsupported`)
  const radius = finite(view.getFloat32(16, true), 'radius')
  const height = finite(view.getFloat32(20, true), 'height')
  const midpoint = [
    finite(view.getFloat32(24, true), 'midpoint X'),
    finite(view.getFloat32(28, true), 'midpoint Y'),
    finite(view.getFloat32(32, true), 'midpoint Z'),
  ]
  const rootOffset = view.getInt32(36, true)
  const modelCollisionOffset = view.getInt32(40, true)
  const textureOffsets = [view.getInt32(44, true), view.getInt32(48, true)]
  if (rootOffset <= 0) throw new RangeError('S3O root piece offset is invalid')
  if (radius < 0 || height < 0) throw new RangeError('S3O radius and height must be non-negative')

  let nodesRead = 0
  const consume = amount => {
    nodesRead += amount
    if (!Number.isSafeInteger(nodesRead) || nodesRead > budget.maxNodes) {
      throw new RangeError('S3O records exceed maxNodes')
    }
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  }
  const stringAt = (offset, label, path) => {
    if (offset === 0) return undefined
    if (!Number.isSafeInteger(offset) || offset < HEADER_BYTES || offset >= bytes.byteLength) {
      throw new RangeError(`S3O ${label} string offset is outside the file`)
    }
    const maxLength = Math.min(bytes.byteLength - offset, budget.maxScalarBytes)
    let end = offset
    while (end - offset < maxLength && bytes[end] !== 0) end += 1
    if (end === offset + maxLength)
      throw new RangeError(`S3O ${label} string exceeds maxScalarBytes or lacks a terminator`)
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, end))
    if (value.length === 0) throw new TypeError(`S3O ${label} string is empty`)
    return path ? logicalPath(value, label) : value
  }

  const resources = textureOffsets
    .map((offset, index) => stringAt(offset, `texture ${index + 1}`, true))
    .filter(Boolean)
  const piecesByOffset = new Map()
  const visiting = new Set()
  const primitives = []
  const meshes = []
  const nodes = []
  const globalPositions = []
  let pieceCollisionRecords = 0

  const readPiece = (offset, depth, parentWorld) => {
    if (depth > budget.maxDepth) throw new RangeError('S3O piece hierarchy exceeds maxDepth')
    if (visiting.has(offset))
      throw new TypeError(`S3O piece hierarchy contains a cycle at offset ${offset}`)
    if (piecesByOffset.has(offset))
      throw new TypeError(`S3O piece offset ${offset} is referenced more than once`)
    checkedRange(bytes, offset, PIECE_BYTES, 'piece')
    consume(1)
    visiting.add(offset)
    const nameOffset = view.getInt32(offset, true)
    const childCount = view.getInt32(offset + 4, true)
    const childrenOffset = view.getInt32(offset + 8, true)
    const vertexCount = view.getInt32(offset + 12, true)
    const verticesOffset = view.getInt32(offset + 16, true)
    const vertexType = view.getInt32(offset + 20, true)
    const primitiveType = view.getInt32(offset + 24, true)
    const indexCount = view.getInt32(offset + 28, true)
    const indicesOffset = view.getInt32(offset + 32, true)
    const collisionOffset = view.getInt32(offset + 36, true)
    const sourceOffset = [
      finite(view.getFloat32(offset + 40, true), 'piece X offset'),
      finite(view.getFloat32(offset + 44, true), 'piece Y offset'),
      finite(view.getFloat32(offset + 48, true), 'piece Z offset'),
    ]
    for (const [label, value] of [
      ['child count', childCount],
      ['vertex count', vertexCount],
      ['index count', indexCount],
    ]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`S3O ${label} is invalid`)
    }
    if (vertexType !== 0) throw new RangeError(`S3O vertex type ${vertexType} is unsupported`)
    if (primitiveType < 0 || primitiveType > 2)
      throw new RangeError(`S3O primitive type ${primitiveType} is unsupported`)
    consume(childCount + vertexCount + indexCount)
    checkedRange(bytes, childrenOffset, childCount * 4, 'child offset table')
    checkedRange(bytes, verticesOffset, vertexCount * VERTEX_BYTES, 'vertex table')
    checkedRange(bytes, indicesOffset, indexCount * 4, 'index table')
    const name = stringAt(nameOffset, 'piece name', false)
    const localOffset = [reflectedX(sourceOffset[0]), sourceOffset[1], sourceOffset[2]]
    const worldOffset = localOffset.map((value, axis) => value + parentWorld[axis])
    const id = `s3o-piece-${offset}`
    const positions = []
    const normals = []
    const textureCoordinates = []
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const vertex = verticesOffset + vertexIndex * VERTEX_BYTES
      const x = finite(view.getFloat32(vertex, true), 'vertex X')
      const y = finite(view.getFloat32(vertex + 4, true), 'vertex Y')
      const z = finite(view.getFloat32(vertex + 8, true), 'vertex Z')
      positions.push(reflectedX(x), y, z)
      globalPositions.push(reflectedX(x) + worldOffset[0], y + worldOffset[1], z + worldOffset[2])
      normals.push(
        ...normal(
          finite(view.getFloat32(vertex + 12, true), 'normal X'),
          finite(view.getFloat32(vertex + 16, true), 'normal Y'),
          finite(view.getFloat32(vertex + 20, true), 'normal Z'),
        ),
      )
      textureCoordinates.push(
        finite(view.getFloat32(vertex + 24, true), 'texture U'),
        finite(view.getFloat32(vertex + 28, true), 'texture V'),
      )
    }
    const nativeIndices = []
    for (let index = 0; index < indexCount; index += 1) {
      const value = view.getInt32(indicesOffset + index * 4, true)
      if (value !== -1 && (value < 0 || value >= vertexCount)) {
        throw new RangeError(`S3O index ${value} is outside the piece vertex table`)
      }
      if (value === -1 && primitiveType !== 1) {
        throw new TypeError('S3O primitive restart is valid only in a triangle strip')
      }
      nativeIndices.push(value)
    }
    const triangleIndices = trianglesFrom(primitiveType, nativeIndices)
    const primitiveIds = []
    if (vertexCount > 0 && triangleIndices.length > 0) {
      const primitiveId = `${id}-primitive`
      const meshId = `${id}-mesh`
      primitives.push({
        id: primitiveId,
        topology: 'triangles',
        positions: new Float32Array(positions),
        indices: new Uint32Array(triangleIndices),
        normals: new Float32Array(normals),
        textureCoordinates: new Float32Array(textureCoordinates),
        bounds: boundsOf(positions),
      })
      meshes.push({ id: meshId, name, primitiveIds: [primitiveId] })
      primitiveIds.push(meshId)
    }
    if (collisionOffset !== 0) pieceCollisionRecords += 1
    const childIds = []
    for (let childIndex = 0; childIndex < childCount; childIndex += 1) {
      const childOffset = view.getInt32(childrenOffset + childIndex * 4, true)
      if (childOffset <= 0) throw new RangeError('S3O child piece offset is invalid')
      childIds.push(readPiece(childOffset, depth + 1, worldOffset))
    }
    nodes.push({
      id,
      name,
      childIds,
      meshIds: primitiveIds,
      transform: localTransform(localOffset),
    })
    visiting.delete(offset)
    piecesByOffset.set(offset, id)
    return id
  }

  const rootId = readPiece(rootOffset, 0, [0, 0, 0])
  return {
    version,
    radius,
    height,
    midpoint,
    rootId,
    modelCollisionOffset,
    pieceCollisionRecords,
    resources: [...new Set(resources)],
    primitives,
    meshes,
    nodes,
    bounds: boundsOf(globalPositions),
  }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'spring-s3o', label: 'Spring/Recoil S3O model' }),
  async detect(prefix) {
    return hasMagic(prefix)
      ? { confidence: 0.995, kind: 'magic', note: 'Spring unit NUL signature' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = parseS3o(bytes, context.budget, context.signal)
    const info = {
      scenes: 1,
      nodes: parsed.nodes.length,
      meshes: parsed.meshes.length,
      primitives: parsed.primitives.length,
      materials: 0,
      textures: parsed.resources.length,
      animations: 0,
      // The source stores radius/height and local piece transforms, not a canonical AABB. A
      // transform-aware aggregate bounds contract is a later concern; claiming the local union as
      // world bounds would be false. Primitive-local bounds remain available on every primitive.
      geometryAccess: 'decoded',
    }
    return {
      summary: {
        format: 'spring-s3o',
        version: parsed.version,
        pieces: parsed.nodes.length,
        meshes: parsed.meshes.length,
        primitives: parsed.primitives.length,
        vertices: parsed.primitives.reduce(
          (total, primitive) => total + primitive.positions.length / 3,
          0,
        ),
        triangles: parsed.primitives.reduce(
          (total, primitive) => total + primitive.indices.length / 3,
          0,
        ),
        textures: parsed.resources.length,
        namedRemainder: ['spring-3do', 's3o-writing', 'external-bos-cob-lua-animation-binding'],
      },
      traits: [
        { id: 'model.geometry' },
        { id: 'structure.hierarchy' },
        { id: 'content.binary' },
        ...(parsed.resources.length === 0 ? [] : [{ id: 'model.textures' }]),
      ],
      maxDecodedBytes: parsed.primitives.reduce(
        (total, primitive) =>
          total +
          primitive.positions.byteLength +
          primitive.indices.byteLength +
          primitive.normals.byteLength +
          primitive.textureCoordinates.byteLength,
        0,
      ),
      projectionReceipt: createProjectionReceipt({
        adapter: { id: ID, version: '1.0.0' },
        subjectRevision: context.input.revisions.revision,
        companions: [],
        basis: {
          handedness: 'right',
          upAxis: 'y',
          forwardAxis: '+z',
          unit: 'source-unit',
          sourceUnit: 'elmo',
          unitsPerCell: 8,
        },
        planes: [
          {
            planeId: 'geometry',
            state: 'normalized',
            note: 'official S3O vertices and normals are converted from left-handed space by negating X; winding is reversed',
          },
          {
            planeId: 'structure',
            state: 'preserved',
            note: 'piece names, child order and local offsets are preserved',
          },
          {
            planeId: 'resources',
            state: 'preserved',
            note: `${parsed.resources.length} confined logical texture reference(s), unresolved by the codec`,
          },
          {
            planeId: 'animation',
            state: 'lost',
            note: 'S3O version 0 is static; unit motion lives in separately selected BOS/COB or Lua unit scripts, and the S3O header carries no script path to bind',
          },
          {
            planeId: 'materials',
            state: 'lost',
            note: 'the two texture slots do not define material or shader semantics',
          },
          {
            planeId: 'collision',
            state:
              parsed.modelCollisionOffset === 0 && parsed.pieceCollisionRecords === 0
                ? 'preserved'
                : 'lost',
            note:
              parsed.modelCollisionOffset === 0 && parsed.pieceCollisionRecords === 0
                ? 'no collision records are declared'
                : `model collision offset ${parsed.modelCollisionOffset}; ${parsed.pieceCollisionRecords} piece collision record(s) are not decoded`,
          },
        ],
        evidence: [
          {
            kind: 'observed',
            statement: `${parsed.nodes.length} piece(s), ${parsed.primitives.length} decoded primitive(s), ${parsed.resources.length} texture reference(s)`,
            bytesRead: BigInt(bytes.byteLength),
          },
          {
            kind: 'declared',
            statement:
              'header, piece, vertex and index layouts follow Recoil rts/Rendering/Models/s3o.h and S3OParser.cpp',
            source: 'recoil-engine-s3o-v0',
          },
        ],
        confidence: parsed.primitives.length > 0 ? 'high' : 'partial',
      }),
      dataSources: {
        'common.view/model-scene-source': createModelSceneSource({
          info,
          nodes: parsed.nodes,
          meshes: parsed.meshes,
          primitives: parsed.primitives,
        }),
        'common.view/tree-data-source': modelTree('Spring/Recoil S3O', parsed.nodes),
        ...(parsed.resources.length === 0
          ? {}
          : {
              'common.view/model-resource-refs-source': createModelResourceRefsSource({
                references: parsed.resources.map(id => ({
                  id,
                  role: 'texture',
                  provenance: 'reference-only',
                })),
              }),
            }),
      },
      unsupportedFeatures: [
        'spring-3do',
        's3o-writing',
        'external-bos-cob-lua-animation-binding',
        'material-semantics',
        ...(parsed.modelCollisionOffset === 0 && parsed.pieceCollisionRecords === 0
          ? []
          : ['collision-data']),
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
