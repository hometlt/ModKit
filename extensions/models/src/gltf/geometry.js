// Hand-ported from org.modkitx/gltf. This single-source profile decodes standard glTF 2.x
// geometry from embedded data-URI buffers into format-neutral model primitives.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/gltf'
const decoder = new TextDecoder('utf-8', { fatal: true })
const probeDecoder = new TextDecoder('utf-8', { fatal: false })
const COMPONENT_BYTES = Object.freeze({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 })
const COMPONENT_COUNTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
})
const TOPOLOGIES = Object.freeze({
  0: 'points',
  1: 'lines',
  3: 'line-strip',
  4: 'triangles',
  5: 'triangle-strip',
  6: 'triangle-fan',
})
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function list(value, key) {
  const candidate = value?.[key]
  if (candidate === undefined) return []
  if (!Array.isArray(candidate)) throw new TypeError(`glTF ${key} must be an array`)
  return candidate
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function indexOf(value, length, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= length) {
    throw new RangeError(`${label} index is outside the glTF document`)
  }
  return value
}

function boundedJson(value, budget) {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()
    nodes += 1
    if (nodes > budget.maxNodes) throw new RangeError('glTF JSON exceeds maxNodes budget')
    if (current.depth > budget.maxDepth) throw new RangeError('glTF JSON exceeds maxDepth budget')
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 })
    } else if (current.value !== null && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) {
        pending.push({ value: child, depth: current.depth + 1 })
      }
    }
  }
  return nodes
}

function decodeBase64(value) {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new TypeError('glTF buffer data URI has invalid base64')
  }
  let decoded
  try {
    decoded = atob(value)
  } catch {
    throw new TypeError('glTF buffer data URI has invalid base64')
  }
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

function decodeBuffers(document, budget) {
  let total = 0
  const externalUris = []
  const buffers = list(document, 'buffers').map((candidate, bufferIndex) => {
    const buffer = object(candidate, `buffer ${bufferIndex}`)
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 1) {
      throw new TypeError(`buffer ${bufferIndex} byteLength is invalid`)
    }
    if (typeof buffer.uri !== 'string') {
      externalUris.push(`buffer:${bufferIndex}:missing-uri`)
      return undefined
    }
    const match =
      /^data:(application\/(?:octet-stream|gltf-buffer));base64,([A-Za-z0-9+/=]*)$/u.exec(
        buffer.uri,
      )
    if (match === null) {
      externalUris.push(buffer.uri)
      return undefined
    }
    const bytes = decodeBase64(match[2])
    if (bytes.byteLength < buffer.byteLength) {
      throw new RangeError(`buffer ${bufferIndex} data length does not match byteLength`)
    }
    total += bytes.byteLength
    if (total > budget.maxScalarBytes) {
      throw new RangeError('glTF embedded buffers exceed maxScalarBytes budget')
    }
    return bytes
  })
  return Object.freeze({ buffers, externalUris: Object.freeze(externalUris), bytes: total })
}

function readComponent(view, offset, type) {
  if (type === 5120) return view.getInt8(offset)
  if (type === 5121) return view.getUint8(offset)
  if (type === 5122) return view.getInt16(offset, true)
  if (type === 5123) return view.getUint16(offset, true)
  if (type === 5125) return view.getUint32(offset, true)
  if (type === 5126) return view.getFloat32(offset, true)
  throw new TypeError(`unsupported glTF accessor component type ${String(type)}`)
}

function normalized(value, type) {
  if (type === 5120) return Math.max(value / 127, -1)
  if (type === 5121) return value / 255
  if (type === 5122) return Math.max(value / 32767, -1)
  if (type === 5123) return value / 65535
  return value
}

function readAccessor(
  document,
  decodedBuffers,
  accessorIndex,
  budget,
  scalarState,
  label,
  indices,
) {
  const accessors = list(document, 'accessors')
  const views = list(document, 'bufferViews')
  const accessor = object(accessors[indexOf(accessorIndex, accessors.length, label)], label)
  if (accessor.sparse !== undefined)
    throw new TypeError(`glTF ${label} sparse accessor is unsupported`)
  const width = COMPONENT_COUNTS[accessor.type]
  const bytesPerComponent = COMPONENT_BYTES[accessor.componentType]
  if (
    !Number.isSafeInteger(accessor.count) ||
    accessor.count < 1 ||
    width === undefined ||
    bytesPerComponent === undefined
  ) {
    throw new TypeError(`glTF ${label} accessor shape is invalid`)
  }
  if (indices && (width !== 1 || ![5121, 5123, 5125].includes(accessor.componentType))) {
    throw new TypeError(`glTF ${label} must be an unsigned integer SCALAR accessor`)
  }
  if (indices && accessor.normalized === true) {
    throw new TypeError(`glTF ${label} must not be normalized`)
  }
  if (accessor.normalized === true && ![5120, 5121, 5122, 5123].includes(accessor.componentType)) {
    throw new TypeError(`glTF ${label} uses normalized with an invalid component type`)
  }
  if (accessor.normalized !== undefined && typeof accessor.normalized !== 'boolean') {
    throw new TypeError(`glTF ${label} normalized flag is not boolean`)
  }
  const scalarCount = accessor.count * width
  const outputBytes = scalarCount * 4
  if (!Number.isSafeInteger(scalarCount) || outputBytes > budget.maxScalarBytes) {
    throw new RangeError(`glTF ${label} exceeds maxScalarBytes budget`)
  }
  scalarState.bytes += outputBytes
  if (scalarState.bytes > budget.maxScalarBytes) {
    throw new RangeError('glTF decoded geometry exceeds maxScalarBytes budget')
  }
  const output = indices ? new Uint32Array(scalarCount) : new Float32Array(scalarCount)
  if (accessor.bufferView === undefined) {
    return Object.freeze({
      values: output,
      count: accessor.count,
      width,
      componentType: accessor.componentType,
    })
  }
  const bufferView = object(
    views[indexOf(accessor.bufferView, views.length, `${label} bufferView`)],
    `${label} bufferView`,
  )
  const bufferIndex = indexOf(bufferView.buffer, decodedBuffers.length, `${label} buffer`)
  const buffer = decodedBuffers[bufferIndex]
  if (buffer === undefined) throw new TypeError(`glTF ${label} references an external buffer`)
  const viewOffset = bufferView.byteOffset ?? 0
  const accessorOffset = accessor.byteOffset ?? 0
  const viewLength = bufferView.byteLength
  const elementBytes = width * bytesPerComponent
  const stride = bufferView.byteStride ?? elementBytes
  if (
    !Number.isSafeInteger(viewOffset) ||
    !Number.isSafeInteger(accessorOffset) ||
    !Number.isSafeInteger(viewLength) ||
    !Number.isSafeInteger(stride) ||
    viewOffset < 0 ||
    accessorOffset < 0 ||
    viewLength < 0 ||
    stride < elementBytes ||
    accessorOffset % bytesPerComponent !== 0 ||
    (viewOffset + accessorOffset) % bytesPerComponent !== 0 ||
    stride % bytesPerComponent !== 0 ||
    (!indices && ((viewOffset + accessorOffset) % 4 !== 0 || stride % 4 !== 0))
  ) {
    throw new TypeError(`glTF ${label} buffer view range or alignment is invalid`)
  }
  const start = viewOffset + accessorOffset
  const end = start + (accessor.count - 1) * stride + elementBytes
  if (start < viewOffset || end > viewOffset + viewLength || end > buffer.byteLength) {
    throw new RangeError(`glTF ${label} accessor exceeds its buffer view`)
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  for (let item = 0; item < accessor.count; item += 1) {
    for (let component = 0; component < width; component += 1) {
      let value = readComponent(
        view,
        start + item * stride + component * bytesPerComponent,
        accessor.componentType,
      )
      if (!Number.isFinite(value)) throw new TypeError(`glTF ${label} contains a non-finite value`)
      if (accessor.normalized === true) value = normalized(value, accessor.componentType)
      output[item * width + component] = value
    }
  }
  return Object.freeze({
    values: output,
    count: accessor.count,
    width,
    componentType: accessor.componentType,
  })
}

function boundsForPositions(positions) {
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

function unionBounds(primitives) {
  if (primitives.length === 0) return undefined
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const primitive of primitives) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], primitive.bounds.min[axis])
      max[axis] = Math.max(max[axis], primitive.bounds.max[axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function transformFor(node) {
  const hasMatrix = node.matrix !== undefined
  const hasTrs =
    node.rotation !== undefined || node.scale !== undefined || node.translation !== undefined
  if (hasMatrix && hasTrs) throw new TypeError('glTF node mixes matrix and TRS transforms')
  if (hasMatrix) {
    if (
      !Array.isArray(node.matrix) ||
      node.matrix.length !== 16 ||
      !node.matrix.every(Number.isFinite)
    ) {
      throw new TypeError('glTF node matrix is malformed')
    }
    return Object.freeze([...node.matrix])
  }
  if (!hasTrs) return IDENTITY
  const rotation = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1]
  const scale = Array.isArray(node.scale) ? node.scale : [1, 1, 1]
  const translation = Array.isArray(node.translation) ? node.translation : [0, 0, 0]
  if (
    rotation.length !== 4 ||
    scale.length !== 3 ||
    translation.length !== 3 ||
    ![...rotation, ...scale, ...translation].every(Number.isFinite)
  ) {
    throw new TypeError('glTF node TRS transform is malformed')
  }
  const [x, y, z, w] = rotation
  const [sx, sy, sz] = scale
  const [tx, ty, tz] = translation
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
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ])
}

function validateNodeGraph(document, budget) {
  const nodes = list(document, 'nodes')
  const parents = new Uint32Array(nodes.length)
  for (const [nodeIndex, candidate] of nodes.entries()) {
    const node = object(candidate, `node ${nodeIndex}`)
    for (const child of Array.isArray(node.children) ? node.children : []) {
      const childIndex = indexOf(child, nodes.length, `node ${nodeIndex} child`)
      parents[childIndex] += 1
      if (parents[childIndex] > 1) throw new TypeError('glTF node has more than one parent')
    }
  }
  const state = new Uint8Array(nodes.length)
  const visit = (nodeIndex, depth) => {
    if (depth > budget.maxDepth) throw new RangeError('glTF node graph exceeds maxDepth budget')
    if (state[nodeIndex] === 1) throw new TypeError('glTF node graph contains a cycle')
    if (state[nodeIndex] === 2) return
    state[nodeIndex] = 1
    const node = nodes[nodeIndex]
    for (const child of Array.isArray(node.children) ? node.children : []) visit(child, depth + 1)
    state[nodeIndex] = 2
  }
  nodes.forEach((_node, index) => visit(index, 0))
}

function parseGltf(bytes, budget) {
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError('glTF JSON text exceeds maxScalarBytes budget')
  }
  let document
  try {
    document = JSON.parse(decoder.decode(bytes).replace(/^\uFEFF/u, ''))
  } catch (error) {
    throw new TypeError(
      `invalid glTF JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  object(document, 'glTF root')
  const asset = object(document.asset, 'glTF asset')
  if (typeof asset.version !== 'string' || !/^2(?:\.\d+)?$/u.test(asset.version)) {
    throw new TypeError('only glTF 2.x documents are supported')
  }
  const jsonNodes = boundedJson(document, budget)
  validateNodeGraph(document, budget)
  const decodedBuffers = decodeBuffers(document, budget)
  return Object.freeze({ document, jsonNodes, ...decodedBuffers })
}

function decodeScene(gltf, budget) {
  const document = gltf.document
  const meshes = list(document, 'meshes')
  const nodes = list(document, 'nodes')
  const materials = list(document, 'materials')
  const scalarState = { bytes: gltf.bytes }
  const primitives = []
  const modelMeshes = meshes.map((candidate, meshIndex) => {
    const mesh = object(candidate, `mesh ${meshIndex}`)
    const primitiveIds = list(mesh, 'primitives').map((candidatePrimitive, primitiveIndex) => {
      const primitive = object(candidatePrimitive, `mesh ${meshIndex} primitive ${primitiveIndex}`)
      const topology = TOPOLOGIES[primitive.mode ?? 4]
      if (topology === undefined)
        throw new TypeError('glTF LINE_LOOP or unknown topology is unsupported')
      const attributes = object(primitive.attributes, 'glTF primitive attributes')
      const position = readAccessor(
        document,
        gltf.buffers,
        attributes.POSITION,
        budget,
        scalarState,
        'POSITION',
        false,
      )
      if (position.width !== 3 || position.componentType !== 5126) {
        throw new TypeError('glTF POSITION must be a float VEC3 accessor')
      }
      let indices
      if (primitive.indices === undefined) {
        scalarState.bytes += position.count * 4
        if (scalarState.bytes > budget.maxScalarBytes) {
          throw new RangeError('glTF decoded geometry exceeds maxScalarBytes budget')
        }
        indices = Uint32Array.from({ length: position.count }, (_unused, index) => index)
      } else {
        indices = readAccessor(
          document,
          gltf.buffers,
          primitive.indices,
          budget,
          scalarState,
          'indices',
          true,
        ).values
      }
      if (topology === 'triangles' && indices.length % 3 !== 0) {
        throw new TypeError('glTF TRIANGLES indices are not divisible by three')
      }
      if (topology === 'lines' && indices.length % 2 !== 0) {
        throw new TypeError('glTF LINES indices are not divisible by two')
      }
      for (const index of indices) {
        if (index >= position.count) throw new RangeError('glTF primitive index exceeds POSITION')
      }
      const normal =
        attributes.NORMAL === undefined
          ? undefined
          : readAccessor(
              document,
              gltf.buffers,
              attributes.NORMAL,
              budget,
              scalarState,
              'NORMAL',
              false,
            )
      if (
        normal !== undefined &&
        (normal.width !== 3 || normal.componentType !== 5126 || normal.count !== position.count)
      ) {
        throw new TypeError('glTF NORMAL must be float VEC3 matching POSITION')
      }
      const texture =
        attributes.TEXCOORD_0 === undefined
          ? undefined
          : readAccessor(
              document,
              gltf.buffers,
              attributes.TEXCOORD_0,
              budget,
              scalarState,
              'TEXCOORD_0',
              false,
            )
      if (texture !== undefined && (texture.width !== 2 || texture.count !== position.count)) {
        throw new TypeError('glTF TEXCOORD_0 must be VEC2 matching POSITION')
      }
      if (
        texture !== undefined &&
        !(
          texture.componentType === 5126 ||
          ([5121, 5123].includes(texture.componentType) &&
            list(document, 'accessors')[attributes.TEXCOORD_0]?.normalized === true)
        )
      ) {
        throw new TypeError('glTF TEXCOORD_0 component type is unsupported')
      }
      if (primitive.material !== undefined)
        indexOf(primitive.material, materials.length, 'material')
      const id = `mesh-${meshIndex}-primitive-${primitiveIndex}`
      primitives.push({
        id,
        topology,
        positions: position.values,
        indices,
        ...(normal === undefined ? {} : { normals: normal.values }),
        ...(texture === undefined ? {} : { textureCoordinates: texture.values }),
        ...(primitive.material === undefined
          ? {}
          : { materialId: `material-${primitive.material}` }),
        bounds: boundsForPositions(position.values),
      })
      return id
    })
    return {
      id: `mesh-${meshIndex}`,
      ...(typeof mesh.name === 'string' ? { name: mesh.name } : {}),
      primitiveIds,
    }
  })
  const modelNodes = nodes.map((candidate, nodeIndex) => {
    const node = object(candidate, `node ${nodeIndex}`)
    return {
      id: `node-${nodeIndex}`,
      ...(typeof node.name === 'string' ? { name: node.name } : {}),
      childIds: (Array.isArray(node.children) ? node.children : []).map(child => `node-${child}`),
      meshIds:
        node.mesh === undefined
          ? []
          : [`mesh-${indexOf(node.mesh, meshes.length, `node ${nodeIndex} mesh`)}`],
      transform: transformFor(node),
    }
  })
  for (const [sceneIndex, sceneCandidate] of list(document, 'scenes').entries()) {
    const scene = object(sceneCandidate, `scene ${sceneIndex}`)
    for (const node of Array.isArray(scene.nodes) ? scene.nodes : []) {
      indexOf(node, nodes.length, `scene ${sceneIndex} node`)
    }
  }
  if (document.scene !== undefined)
    indexOf(document.scene, list(document, 'scenes').length, 'default scene')
  return Object.freeze({
    nodes: modelNodes,
    meshes: modelMeshes,
    primitives,
    decodedBytes: scalarState.bytes,
    bounds: unionBounds(primitives),
  })
}

export function decodeGltfGeometry(document, buffers, budget, decodedBytes = 0) {
  object(document, 'glTF root')
  const asset = object(document.asset, 'glTF asset')
  if (typeof asset.version !== 'string' || !/^2(?:\.\d+)?$/u.test(asset.version)) {
    throw new TypeError('only glTF 2.x documents are supported')
  }
  const jsonNodes = boundedJson(document, budget)
  validateNodeGraph(document, budget)
  return Object.freeze({
    jsonNodes,
    scene: decodeScene({ document, buffers, bytes: decodedBytes }, budget),
  })
}

export function decodeEmbeddedGltfGeometry(document, budget) {
  const decoded = decodeBuffers(document, budget)
  return Object.freeze({
    ...decoded,
    ...decodeGltfGeometry(document, decoded.buffers, budget, decoded.bytes),
  })
}

export function decodeEmbeddedGltfBuffers(document, budget) {
  return decodeBuffers(document, budget)
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'gltf', label: 'glTF 2.0 JSON', mediaType: 'model/gltf+json' }),
  async detect(prefix) {
    const text = probeDecoder
      .decode(prefix)
      .replace(/^\uFEFF/u, '')
      .trimStart()
    return text.startsWith('{') &&
      /"asset"\s*:\s*\{/u.test(text) &&
      /"version"\s*:\s*"2(?:\.|"|$)/u.test(text)
      ? { confidence: 0.96, kind: 'structure', note: 'gltf-json-2' }
      : { confidence: 0, kind: 'structure', note: 'gltf-json-2-missing' }
  },
  async inspect(bytes, context) {
    const gltf = parseGltf(bytes, context.budget)
    const document = gltf.document
    const scene = decodeScene(gltf, context.budget)
    const scenes = list(document, 'scenes')
    const materials = list(document, 'materials')
    const textures = list(document, 'textures')
    const animations = list(document, 'animations')
    const model = createModelSceneSource({
      info: {
        scenes: scenes.length,
        nodes: scene.nodes.length,
        meshes: scene.meshes.length,
        primitives: scene.primitives.length,
        materials: materials.length,
        textures: textures.length,
        animations: animations.length,
        ...(scene.bounds === undefined ? {} : { bounds: scene.bounds }),
        geometryAccess: 'decoded',
      },
      nodes: scene.nodes,
      meshes: scene.meshes,
      primitives: scene.primitives,
    })
    const tree = createTreeDataSource({
      kind: 'model',
      label: 'glTF',
      preview: `${scene.nodes.length} nodes, ${scene.meshes.length} meshes`,
      children: [
        {
          kind: 'collection',
          label: 'Nodes',
          preview: String(scene.nodes.length),
          children: scene.nodes.map(node => ({ kind: 'node', label: node.name ?? node.id })),
        },
        {
          kind: 'collection',
          label: 'Meshes',
          preview: String(scene.meshes.length),
          children: scene.meshes.map(mesh => ({ kind: 'mesh', label: mesh.name ?? mesh.id })),
        },
      ],
    })
    return {
      summary: {
        format: 'gltf',
        version: document.asset.version,
        generator: document.asset.generator ?? null,
        scenes: scenes.length,
        nodes: scene.nodes.length,
        meshes: scene.meshes.length,
        primitives: scene.primitives.length,
        materials: materials.length,
        textures: textures.length,
        animations: animations.length,
        externalBuffers: gltf.externalUris,
        ...(scene.bounds === undefined ? {} : { bounds: scene.bounds }),
      },
      metadata: [
        {
          id: 'gltf-document',
          label: 'glTF document',
          entries: [
            { key: 'version', value: document.asset.version },
            { key: 'generator', value: document.asset.generator ?? '' },
            { key: 'scenes', value: scenes.length },
            { key: 'nodes', value: scene.nodes.length },
            { key: 'meshes', value: scene.meshes.length },
            { key: 'primitives', value: scene.primitives.length },
            { key: 'embeddedBufferBytes', value: gltf.bytes },
            { key: 'externalBuffers', value: gltf.externalUris.length },
          ],
        },
      ],
      traits: [
        ...(scene.primitives.length > 0
          ? [
              {
                id: 'model.geometry',
                parameters: {
                  primitives: scene.primitives.length,
                  ...(scene.bounds === undefined ? {} : { bounds: scene.bounds }),
                },
              },
            ]
          : []),
        ...(materials.length > 0
          ? [{ id: 'model.materials', parameters: { count: materials.length } }]
          : []),
        ...(textures.length > 0
          ? [{ id: 'model.textures', parameters: { count: textures.length } }]
          : []),
        ...(animations.length > 0
          ? [{ id: 'model.animations', parameters: { count: animations.length } }]
          : []),
        { id: 'scene.objects', parameters: { scenes: scenes.length, nodes: scene.nodes.length } },
        { id: 'structure.hierarchy', parameters: { nodeCount: gltf.jsonNodes } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      maxDecodedBytes: scene.decodedBytes,
      dataSources: {
        'common.view/model-scene-source': model,
        'common.view/tree-data-source': tree,
      },
      unsupportedFeatures: [
        ...(gltf.externalUris.length > 0 ? ['external-buffer-resolution'] : []),
        'sparse-accessors',
        'draco-compression',
        'meshopt-compression',
        'animation-playback',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
