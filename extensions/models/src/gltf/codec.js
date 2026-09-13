import {
  createInspectionCodec,
  createModelResourceRefsSource,
  createModelSceneSource,
  editPlanFromInput,
  replaceBytes,
} from '@modkit/codec-kit'
import { applyJsonEdit } from '@modkit/codec-kit/json-edit'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { createJsonTreeSource } from '@modkit/codec-kit/tree/json'
import { sha256Hex } from '@modkit/codec-kit/crypto/digest'
import { decodeEmbeddedGltfBuffers, decodeGltfGeometry } from './geometry.js'

const decoder = new TextDecoder('utf-8', { fatal: true })
const SUPPORTED_REQUIRED_EXTENSIONS = new Set(['KHR_materials_unlit'])
const RESOURCE_SCOPES = Object.freeze([
  'sibling-directory',
  'current-mount',
  'enclosing-container',
  'workspace-dependency-layer',
])

function looksLikeGltf(bytes) {
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  ) {
    return true
  }
  try {
    const prefix = decoder
      .decode(bytes)
      .replace(/^\uFEFF/u, '')
      .trimStart()
    return (
      prefix.startsWith('{') &&
      /"asset"\s*:\s*\{/u.test(prefix) &&
      /"version"\s*:\s*"2(?:\.|\x22)/u.test(prefix)
    )
  } catch {
    return false
  }
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TypeError('GLB header is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function parseGlb(bytes, budget) {
  if (u32(bytes, 0) !== 0x46546c67 || u32(bytes, 4) !== 2 || u32(bytes, 8) !== bytes.byteLength) {
    throw new TypeError('GLB 2.0 header is invalid')
  }
  let offset = 12
  let jsonBytes
  const binaryChunks = []
  const unknownChunks = []
  let chunkIndex = 0
  while (offset < bytes.byteLength) {
    const length = u32(bytes, offset)
    const type = u32(bytes, offset + 4)
    const end = offset + 8 + length
    if (length % 4 !== 0 || end > bytes.byteLength) throw new TypeError('GLB chunk is invalid')
    const payload = bytes.subarray(offset + 8, end)
    if (chunkIndex === 0 && type !== 0x4e4f534a) {
      throw new TypeError('GLB JSON chunk must be first')
    }
    if (type === 0x4e4f534a) {
      if (jsonBytes !== undefined) throw new TypeError('GLB contains multiple JSON chunks')
      jsonBytes = payload
    } else if (type === 0x004e4942) {
      if (binaryChunks.length > 0) throw new TypeError('GLB contains multiple BIN chunks')
      binaryChunks.push(payload)
    } else {
      unknownChunks.push(type)
    }
    offset = end
    chunkIndex += 1
  }
  if (jsonBytes === undefined) throw new TypeError('GLB JSON chunk is missing')
  const parsed = parseGltf(decoder.decode(jsonBytes).trimEnd(), budget)
  const buffers = array(parsed.document, 'buffers')
  const decodedBuffers = []
  const externalUris = []
  let binaryIndex = 0
  let decodedBytes = 0
  for (const [bufferIndex, buffer] of buffers.entries()) {
    if (typeof buffer?.uri === 'string') {
      const decoded = decodeEmbeddedGltfBuffers({ buffers: [buffer] }, budget)
      decodedBuffers.push(decoded.buffers[0])
      decodedBytes += decoded.bytes
      externalUris.push(...decoded.externalUris)
      continue
    }
    const chunk = binaryChunks[binaryIndex]
    binaryIndex += 1
    if (chunk === undefined || !Number.isSafeInteger(buffer?.byteLength)) {
      externalUris.push(`buffer:${bufferIndex}:missing-bin-chunk`)
      decodedBuffers.push(undefined)
      continue
    }
    if (chunk.byteLength < buffer.byteLength) {
      throw new TypeError(`GLB buffer ${bufferIndex} is shorter than its declared byteLength`)
    }
    decodedBuffers.push(chunk.subarray(0, buffer.byteLength))
    decodedBytes += buffer.byteLength
    if (decodedBytes > budget.maxScalarBytes) {
      throw new RangeError('GLB buffers exceed maxScalarBytes budget')
    }
  }
  return Object.freeze({
    ...parsed,
    binary: true,
    decoded: Object.freeze({
      buffers: Object.freeze(decodedBuffers),
      externalUris: Object.freeze(externalUris),
      bytes: decodedBytes,
    }),
    unknownChunks: Object.freeze(unknownChunks),
  })
}

function parseGltfBytes(bytes, budget) {
  return looksLikeGltf(bytes) && u32(bytes, 0) === 0x46546c67
    ? parseGlb(bytes, budget)
    : Object.freeze({
        ...parseGltf(decoder.decode(bytes).replace(/^\uFEFF/u, ''), budget),
        binary: false,
      })
}

function array(value, key) {
  const candidate = value[key]
  return Array.isArray(candidate) ? candidate : []
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
      for (const child of Object.values(current.value))
        pending.push({ value: child, depth: current.depth + 1 })
    }
  }
  return nodes
}

function parseGltf(text, budget) {
  let document
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw new TypeError(
      `invalid glTF JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('glTF root must be an object')
  }
  const version = document.asset?.version
  if (typeof version !== 'string' || !/^2(?:\.\d+)?$/u.test(version)) {
    throw new TypeError('only glTF 2.x documents are supported')
  }
  const requiredExtensions = array(document, 'extensionsRequired')
  for (const extension of requiredExtensions) {
    if (typeof extension !== 'string') {
      throw new TypeError('glTF extensionsRequired entries must be strings')
    }
    if (!SUPPORTED_REQUIRED_EXTENSIONS.has(extension)) {
      throw new TypeError(`glTF required extension ${extension} is unsupported`)
    }
  }
  const nodes = array(document, 'nodes')
  for (const node of nodes) {
    if (node === null || typeof node !== 'object' || Array.isArray(node))
      throw new TypeError('glTF node must be an object')
    for (const child of Array.isArray(node.children) ? node.children : []) {
      if (!Number.isSafeInteger(child) || child < 0 || child >= nodes.length)
        throw new TypeError('glTF node has an invalid child index')
    }
  }
  const externalUris = [...array(document, 'buffers'), ...array(document, 'images')]
    .map(item => item?.uri)
    .filter(uri => typeof uri === 'string' && !uri.startsWith('data:'))
  return Object.freeze({
    document,
    nodes: boundedJson(document, budget),
    externalUris: Object.freeze(externalUris),
  })
}

async function resolveExternalGltfBuffers(document, decoded, context) {
  const buffers = array(document, 'buffers')
  const pending = []
  for (const [index, buffer] of buffers.entries()) {
    if (
      decoded.buffers[index] === undefined &&
      typeof buffer?.uri === 'string' &&
      !buffer.uri.startsWith('data:') &&
      Number.isSafeInteger(buffer.byteLength) &&
      buffer.byteLength >= 0
    ) {
      pending.push({ index, uri: buffer.uri, byteLength: buffer.byteLength })
    }
  }
  if (pending.length === 0 || context.logicalResources === undefined) return decoded
  const maximum =
    context.budget.maxInputBytes < BigInt(context.budget.maxScalarBytes)
      ? context.budget.maxInputBytes
      : BigInt(context.budget.maxScalarBytes)
  const batch = await context.logicalResources.readBatch(
    {
      items: pending.map(item => ({
        requirement: {
          id: `gltf-buffer-${item.index}`,
          logicalId: item.uri,
          role: 'buffer',
          scopes: RESOURCE_SCOPES,
        },
        size: BigInt(item.byteLength),
      })),
      concurrency: Math.min(4, pending.length),
      readTimeoutMs: 8_000,
      totalTimeoutMs: 10_000,
      maxBytes: maximum,
    },
    context.signal,
  )
  if (batch.state !== 'complete') return decoded
  const resolvedBuffers = [...decoded.buffers]
  let decodedBytes = decoded.bytes
  const unresolved = new Set(decoded.externalUris)
  for (const [position, item] of pending.entries()) {
    const outcome = batch.items[position]
    if (outcome?.state !== 'read') continue
    if (outcome.bytes.byteLength < item.byteLength) {
      throw new RangeError(`glTF external buffer ${item.index} is shorter than byteLength`)
    }
    resolvedBuffers[item.index] = outcome.bytes.subarray(0, item.byteLength)
    decodedBytes += item.byteLength
    if (decodedBytes > context.budget.maxScalarBytes) {
      throw new RangeError('glTF buffers exceed maxScalarBytes budget')
    }
    unresolved.delete(item.uri)
  }
  return Object.freeze({
    buffers: Object.freeze(resolvedBuffers),
    externalUris: Object.freeze([...unresolved]),
    bytes: decodedBytes,
  })
}

const GLTF_EDIT_OPERATIONS = Object.freeze([
  Object.freeze({
    id: 'edit.field',
    handlerId: 'set-gltf-field',
    mutatesSource: true,
    requiredPermissions: Object.freeze(['read-source', 'write-source']),
    outputKinds: Object.freeze(['edit-plan']),
  }),
  Object.freeze({
    id: 'model.edit',
    handlerId: 'edit-gltf-document',
    mutatesSource: true,
    requiredPermissions: Object.freeze(['read-source', 'write-source']),
    outputKinds: Object.freeze(['edit-plan']),
  }),
])

function editObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`)
  return value
}

function jsonPointer(path) {
  return '/' + path.map(key => key.replace(/~/gu, '~0').replace(/\//gu, '~1')).join('/')
}

function fieldEdits(input, budget, signal) {
  const request = editObject(
    snapshotJson(
      input,
      {
        maxBytes: budget.maxScalarBytes,
        maxNodes: budget.maxNodes,
        maxDepth: budget.maxDepth + 2,
      },
      signal,
    ),
    'glTF field request',
  )
  const path = request.path
  if (
    !Array.isArray(path) ||
    path.length === 0 ||
    !path.every(key => typeof key === 'string') ||
    request.groupId !== 'tree' ||
    request.key !== path.at(-1) ||
    !Object.hasOwn(request, 'value') ||
    Object.keys(request).some(key => !['groupId', 'key', 'path', 'value'].includes(key))
  )
    throw new TypeError('glTF field write requires a complete tree semantic path and value')
  return [{ op: 'replace', path: jsonPointer(path), value: request.value }]
}

function documentEdits(input, budget, signal) {
  const request = editObject(
    snapshotJson(
      input,
      {
        maxBytes: budget.maxScalarBytes,
        maxNodes: budget.maxNodes,
        maxDepth: budget.maxDepth + 3,
      },
      signal,
    ),
    'glTF edit request',
  )
  if (
    Object.keys(request).some(key => key !== 'json') ||
    !Array.isArray(request.json) ||
    request.json.length === 0
  )
    throw new TypeError('glTF model.edit requires a nonempty json edit array')
  if (request.json.length > 4096) throw new RangeError('glTF edit batch exceeds maxEdits')
  return request.json.map(raw => {
    const edit = editObject(raw, 'glTF JSON edit')
    if (
      typeof edit.path !== 'string' ||
      !['add', 'replace', 'remove'].includes(edit.op) ||
      Object.keys(edit).some(key => !['op', 'path', 'value'].includes(key)) ||
      (edit.op === 'remove' ? Object.hasOwn(edit, 'value') : !Object.hasOwn(edit, 'value'))
    )
      throw new TypeError('invalid glTF JSON edit')
    return edit.op === 'remove'
      ? { op: edit.op, path: edit.path }
      : { op: edit.op, path: edit.path, value: edit.value }
  })
}

function padded(bytes, value) {
  const result = new Uint8Array(Math.ceil(bytes.length / 4) * 4)
  result.fill(value)
  result.set(bytes)
  return result
}

function encodeEditedGltf(source, binary, document, budget) {
  const json = new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`)
  if (json.byteLength > budget.maxScalarBytes || BigInt(json.byteLength) > budget.maxInputBytes)
    throw new RangeError('edited glTF JSON exceeds budget')
  if (!binary) return json
  const jsonChunk = padded(json, 0x20)
  const chunks = []
  let offset = 12
  let replaced = false
  while (offset < source.byteLength) {
    const length = u32(source, offset)
    const type = u32(source, offset + 4)
    const end = offset + 8 + length
    if (length % 4 !== 0 || end > source.byteLength) throw new TypeError('GLB chunk is invalid')
    const payload = !replaced && type === 0x4e4f534a ? jsonChunk : source.slice(offset + 8, end)
    if (!replaced && type === 0x4e4f534a) replaced = true
    chunks.push({ type, payload })
    offset = end
  }
  if (!replaced) throw new TypeError('GLB JSON chunk is missing')
  const length = 12 + chunks.reduce((total, chunk) => total + 8 + chunk.payload.byteLength, 0)
  if (BigInt(length) > budget.maxInputBytes) throw new RangeError('edited GLB exceeds budget')
  const result = new Uint8Array(length)
  const view = new DataView(result.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, length, true)
  offset = 12
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.payload.byteLength, true)
    view.setUint32(offset + 4, chunk.type, true)
    result.set(chunk.payload, offset + 8)
    offset += 8 + chunk.payload.byteLength
  }
  return result
}

function editHandler(source, parsed, context, editsFromInput) {
  return async (input, operationContext = {}) => {
    const signal = operationContext.signal
    signal?.throwIfAborted()
    const base = editPlanFromInput(context.input, {
      planId: `gltf-edit:${context.input.revisions.revision}`,
      edits: [],
      fidelity: {
        roundTrip: 'semantic',
        preservesUnknownData: true,
        notes: [
          'JSON values and all non-JSON GLB chunks are retained; JSON whitespace is normalized',
        ],
      },
    })
    const edits = editsFromInput(input, context.budget, signal)
    let document = parsed.document
    for (const edit of edits) document = applyJsonEdit(document, edit, context.budget.maxDepth)
    const candidate = encodeEditedGltf(source, parsed.binary, document, context.budget)
    parseGltfBytes(candidate, context.budget)
    const digest = await sha256Hex(candidate)
    signal?.throwIfAborted()
    const target = base.targets[0]
    return {
      kind: 'edit-plan',
      plan: Object.freeze({
        ...base,
        planId: `${base.planId}:${digest}`,
        edits: Object.freeze([
          Object.freeze({
            ...replaceBytes(0, source.length, candidate, 'Edit glTF document'),
            targetId: target.targetId,
            source: target.ownerSource,
          }),
        ]),
      }),
    }
  }
}

function finiteVector(value, length, fallback) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite)
    ? value
    : fallback
}

function nodeTransform(node) {
  if (
    Array.isArray(node.matrix) &&
    node.matrix.length === 16 &&
    node.matrix.every(Number.isFinite)
  ) {
    return Object.freeze([...node.matrix])
  }
  const [x, y, z, w] = finiteVector(node.rotation, 4, [0, 0, 0, 1])
  const [sx, sy, sz] = finiteVector(node.scale, 3, [1, 1, 1])
  const [tx, ty, tz] = finiteVector(node.translation, 3, [0, 0, 0])
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

const GRAPH_COLLECTIONS = Object.freeze([
  ['scene', 'scenes', 'Scenes'],
  ['node', 'nodes', 'Nodes'],
  ['mesh', 'meshes', 'Meshes'],
  ['material', 'materials', 'Materials'],
  ['texture', 'textures', 'Textures'],
  ['image', 'images', 'Images'],
  ['buffer', 'buffers', 'Buffers'],
  ['buffer-view', 'bufferViews', 'Buffer views'],
  ['accessor', 'accessors', 'Accessors'],
  ['animation', 'animations', 'Animations'],
  ['skin', 'skins', 'Skins'],
  ['sampler', 'samplers', 'Samplers'],
  ['camera', 'cameras', 'Cameras'],
])

function createRelationGraphSource(document, snapshotId) {
  const nodes = []
  const edges = []
  const ids = new Set()
  const typeCounts = new Map()
  const collections = new Map(GRAPH_COLLECTIONS.map(([type, key]) => [type, array(document, key)]))

  const addNode = (id, label, type) => {
    if (ids.has(id)) return id
    ids.add(id)
    nodes.push(Object.freeze({ id, label, type }))
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
    return id
  }
  const addEdge = (from, to, role, dead = false) => {
    edges.push(
      Object.freeze({
        from,
        to,
        ...(role === undefined ? {} : { role }),
        ...(dead ? { dead: true } : {}),
      }),
    )
  }
  const idFor = (type, index) => `${type}-${index}`
  const reference = (from, type, index, role) => {
    const values = collections.get(type) ?? []
    if (Number.isSafeInteger(index) && index >= 0 && index < values.length) {
      addEdge(from, idFor(type, index), role)
      return
    }
    const missing = addNode(
      `missing-${type}-${String(index)}`,
      `Missing ${type} ${String(index)}`,
      'unresolved',
    )
    addEdge(from, missing, role, true)
  }
  const externalIds = new Map()
  const external = (from, uri, role) => {
    let id = externalIds.get(uri)
    if (id === undefined) {
      id = addNode(`external-${externalIds.size}`, uri, 'external-resource')
      externalIds.set(uri, id)
    }
    addEdge(from, id, role, true)
  }

  const root = addNode('gltf-document', 'glTF document', 'document')
  for (const collection of GRAPH_COLLECTIONS) {
    const [type, , plural] = collection
    const values = collections.get(type) ?? []
    for (const [index, value] of values.entries()) {
      const label = typeof value?.name === 'string' ? value.name : `${plural.slice(0, -1)} ${index}`
      addNode(idFor(type, index), label, type)
      addEdge(root, idFor(type, index), type)
    }
  }

  for (const [index, scene] of (collections.get('scene') ?? []).entries()) {
    for (const node of Array.isArray(scene?.nodes) ? scene.nodes : [])
      reference(idFor('scene', index), 'node', node, 'root')
  }
  for (const [index, node] of (collections.get('node') ?? []).entries()) {
    const from = idFor('node', index)
    for (const child of Array.isArray(node?.children) ? node.children : [])
      reference(from, 'node', child, 'child')
    if (node?.mesh !== undefined) reference(from, 'mesh', node.mesh, 'mesh')
    if (node?.camera !== undefined) reference(from, 'camera', node.camera, 'camera')
    if (node?.skin !== undefined) reference(from, 'skin', node.skin, 'skin')
  }
  for (const [meshIndex, mesh] of (collections.get('mesh') ?? []).entries()) {
    for (const [primitiveIndex, primitive] of (Array.isArray(mesh?.primitives)
      ? mesh.primitives
      : []
    ).entries()) {
      const primitiveId = addNode(
        `mesh-${meshIndex}-primitive-${primitiveIndex}`,
        `Primitive ${primitiveIndex}`,
        'primitive',
      )
      addEdge(idFor('mesh', meshIndex), primitiveId, 'primitive')
      if (primitive?.material !== undefined)
        reference(primitiveId, 'material', primitive.material, 'material')
      if (primitive?.indices !== undefined)
        reference(primitiveId, 'accessor', primitive.indices, 'indices')
      for (const [semantic, accessor] of Object.entries(primitive?.attributes ?? {})) {
        reference(primitiveId, 'accessor', accessor, `attribute:${semantic}`)
      }
    }
  }
  const materialTexture = (materialId, slot, role) => {
    if (slot?.index !== undefined) reference(materialId, 'texture', slot.index, role)
  }
  for (const [index, material] of (collections.get('material') ?? []).entries()) {
    const from = idFor('material', index)
    materialTexture(from, material?.pbrMetallicRoughness?.baseColorTexture, 'base-color')
    materialTexture(
      from,
      material?.pbrMetallicRoughness?.metallicRoughnessTexture,
      'metallic-roughness',
    )
    materialTexture(from, material?.normalTexture, 'normal')
    materialTexture(from, material?.occlusionTexture, 'occlusion')
    materialTexture(from, material?.emissiveTexture, 'emissive')
  }
  for (const [index, texture] of (collections.get('texture') ?? []).entries()) {
    if (texture?.source !== undefined)
      reference(idFor('texture', index), 'image', texture.source, 'source')
    if (texture?.sampler !== undefined)
      reference(idFor('texture', index), 'sampler', texture.sampler, 'sampler')
  }
  for (const type of ['image', 'buffer']) {
    for (const [index, value] of (collections.get(type) ?? []).entries()) {
      const from = idFor(type, index)
      if (typeof value?.uri === 'string' && !value.uri.startsWith('data:'))
        external(from, value.uri, 'uri')
      if (type === 'image' && value?.bufferView !== undefined)
        reference(from, 'buffer-view', value.bufferView, 'buffer-view')
    }
  }
  for (const [index, view] of (collections.get('buffer-view') ?? []).entries()) {
    reference(idFor('buffer-view', index), 'buffer', view?.buffer, 'buffer')
  }
  for (const [index, accessor] of (collections.get('accessor') ?? []).entries()) {
    if (accessor?.bufferView !== undefined)
      reference(idFor('accessor', index), 'buffer-view', accessor.bufferView, 'buffer-view')
  }
  for (const [index, skin] of (collections.get('skin') ?? []).entries()) {
    const from = idFor('skin', index)
    for (const joint of Array.isArray(skin?.joints) ? skin.joints : [])
      reference(from, 'node', joint, 'joint')
    if (skin?.skeleton !== undefined) reference(from, 'node', skin.skeleton, 'skeleton')
    if (skin?.inverseBindMatrices !== undefined)
      reference(from, 'accessor', skin.inverseBindMatrices, 'inverse-bind-matrices')
  }
  for (const [animationIndex, animation] of (collections.get('animation') ?? []).entries()) {
    const animationId = idFor('animation', animationIndex)
    for (const [samplerIndex, sampler] of (Array.isArray(animation?.samplers)
      ? animation.samplers
      : []
    ).entries()) {
      const samplerId = addNode(
        `animation-${animationIndex}-sampler-${samplerIndex}`,
        `Animation sampler ${samplerIndex}`,
        'animation-sampler',
      )
      addEdge(animationId, samplerId, 'sampler')
      reference(samplerId, 'accessor', sampler?.input, 'input')
      reference(samplerId, 'accessor', sampler?.output, 'output')
    }
    for (const channel of Array.isArray(animation?.channels) ? animation.channels : []) {
      if (channel?.target?.node !== undefined)
        reference(
          animationId,
          'node',
          channel.target.node,
          `channel:${channel.target.path ?? 'unknown'}`,
        )
    }
  }

  const typeLabels = new Map(GRAPH_COLLECTIONS.map(collection => [collection[0], collection[2]]))
  typeLabels.set('document', 'Documents')
  typeLabels.set('primitive', 'Primitives')
  typeLabels.set('animation-sampler', 'Animation samplers')
  typeLabels.set('external-resource', 'Unresolved external resources')
  typeLabels.set('unresolved', 'Invalid references')
  const types = [...typeCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count], tone) => Object.freeze({ id, label: typeLabels.get(id) ?? id, count, tone }))
  const frozenNodes = Object.freeze(nodes)
  const frozenEdges = Object.freeze(edges)
  const summary = Object.freeze({
    snapshotId,
    totalNodes: frozenNodes.length,
    totalEdges: frozenEdges.length,
    types: Object.freeze(types),
    completeness: 'complete',
  })
  const page = (items, request, signal) => {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(request?.limit) || request.limit <= 0)
      throw new RangeError('graph page limit must be positive')
    const offset = request.cursor === undefined ? 0 : Number(request.cursor)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length)
      throw new RangeError('invalid graph page cursor')
    const end = Math.min(items.length, offset + request.limit)
    return Promise.resolve(
      Object.freeze({
        items: Object.freeze(items.slice(offset, end)),
        ...(end < items.length ? { nextCursor: String(end) } : {}),
      }),
    )
  }
  return Object.freeze({
    summary: async signal => {
      signal?.throwIfAborted()
      return summary
    },
    nodes: (request, signal) => page(frozenNodes, request, signal),
    edges: (request, signal) => page(frozenEdges, request, signal),
  })
}

function createSubjectFactsSource(document, context) {
  const source = context.primary.source
  const provenance = Object.freeze([
    Object.freeze({ label: source.uri, source, semanticPath: Object.freeze([]) }),
  ])
  const facts = new Map()
  const addGroup = (id, label, entries) => {
    const values = Object.freeze(
      entries.map(([factId, factLabel, value, semanticPath]) =>
        Object.freeze({
          id: factId,
          label: factLabel,
          value,
          provenance: Object.freeze([
            Object.freeze({
              label: source.uri,
              source,
              semanticPath: Object.freeze(semanticPath),
            }),
          ]),
        }),
      ),
    )
    facts.set(id, values)
    return Object.freeze({ id, label, factCount: values.length })
  }
  const groups = Object.freeze([
    addGroup('asset', 'Asset', [
      ['version', 'Version', document.asset.version, ['asset', 'version']],
      ...(typeof document.asset.generator === 'string'
        ? [['generator', 'Generator', document.asset.generator, ['asset', 'generator']]]
        : []),
    ]),
    addGroup('contents', 'Contents', [
      ['scenes', 'Scenes', array(document, 'scenes').length, ['scenes']],
      ['nodes', 'Nodes', array(document, 'nodes').length, ['nodes']],
      ['meshes', 'Meshes', array(document, 'meshes').length, ['meshes']],
      ['materials', 'Materials', array(document, 'materials').length, ['materials']],
      ['textures', 'Textures', array(document, 'textures').length, ['textures']],
      ['animations', 'Animations', array(document, 'animations').length, ['animations']],
      ['skins', 'Skins', array(document, 'skins').length, ['skins']],
    ]),
    addGroup('resources', 'Resources', [
      ['buffers', 'Buffers', array(document, 'buffers').length, ['buffers']],
      ['images', 'Images', array(document, 'images').length, ['images']],
    ]),
  ])
  const relations = []
  for (const [kind, key, label] of [
    ['scene', 'scenes', 'Scene'],
    ['node', 'nodes', 'Node'],
    ['mesh', 'meshes', 'Mesh'],
    ['material', 'materials', 'Material'],
  ]) {
    for (const [index, value] of array(document, key).entries()) {
      relations.push(
        Object.freeze({
          role: 'contains',
          subjectId: `${source.uri}#/${key}/${index}`,
          label: typeof value?.name === 'string' ? value.name : `${label} ${index}`,
          kind,
          provenance: Object.freeze([
            Object.freeze({
              label: source.uri,
              source,
              semanticPath: Object.freeze([key, String(index)]),
            }),
          ]),
        }),
      )
    }
  }
  const frozenRelations = Object.freeze(relations)
  const summary = Object.freeze({
    snapshotId: String(context.primary.revision),
    identity: Object.freeze({
      subjectId: source.id,
      label: source.uri.split(/[\\/]/u).at(-1) || 'glTF document',
      kind: 'file',
      type: 'glTF 2.x',
      origins: provenance,
    }),
    groupCount: groups.length,
    relationCount: frozenRelations.length,
  })
  const page = (items, request, signal) => {
    signal?.throwIfAborted()
    if (!Number.isSafeInteger(request?.limit) || request.limit <= 0)
      throw new RangeError('subject facts page limit must be positive')
    const offset = request.cursor === undefined ? 0 : Number(request.cursor)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length)
      throw new RangeError('invalid subject facts page cursor')
    const end = Math.min(items.length, offset + request.limit)
    return Promise.resolve(
      Object.freeze({
        items: Object.freeze(items.slice(offset, end)),
        ...(end < items.length ? { nextCursor: String(end) } : {}),
      }),
    )
  }
  return Object.freeze({
    summary: async signal => {
      signal?.throwIfAborted()
      return summary
    },
    groups: (request, signal) => page(groups, request, signal),
    facts: (groupId, request, signal) => {
      const values = facts.get(groupId)
      if (values === undefined) throw new RangeError(`unknown subject fact group: ${groupId}`)
      return page(values, request, signal)
    },
    relations: (request, signal) => page(frozenRelations, request, signal),
  })
}

const definition = Object.freeze({
  id: 'modkit/model-gltf',
  operations: GLTF_EDIT_OPERATIONS,
  format: Object.freeze({ id: 'gltf', label: 'glTF 2.x', mediaType: 'model/gltf+json' }),
  async detect(bytes) {
    const match = looksLikeGltf(bytes)
    return {
      confidence: match ? 0.97 : 0.02,
      kind: 'structure',
      note: match ? 'gltf-2-asset' : 'gltf-asset-missing',
    }
  },
  async inspect(bytes, context) {
    const gltf = parseGltfBytes(bytes, context.budget)
    const document = gltf.document
    const scenes = array(document, 'scenes')
    const nodes = array(document, 'nodes')
    const meshes = array(document, 'meshes')
    const materials = array(document, 'materials')
    const textures = array(document, 'textures')
    const animations = array(document, 'animations')
    const skins = array(document, 'skins')
    const buffers = array(document, 'buffers')
    const images = array(document, 'images')
    const externalImages = images.flatMap(image =>
      typeof image?.uri === 'string' && !image.uri.startsWith('data:')
        ? [
            Object.freeze({
              id: image.uri,
              role: 'texture',
              provenance: 'reference-only',
            }),
          ]
        : [],
    )
    const primitiveCount = meshes.reduce(
      (total, mesh) => total + (Array.isArray(mesh?.primitives) ? mesh.primitives.length : 0),
      0,
    )
    const embedded = gltf.decoded ?? decodeEmbeddedGltfBuffers(document, context.budget)
    const decoded = await resolveExternalGltfBuffers(document, embedded, context)
    const geometry =
      decoded.externalUris.length === 0
        ? decodeGltfGeometry(document, decoded.buffers, context.budget, decoded.bytes)
        : undefined
    const sceneNodes =
      geometry?.scene.nodes ??
      nodes.map((node, index) => ({
        id: `node-${index}`,
        ...(typeof node.name === 'string' ? { name: node.name } : {}),
        childIds: (Array.isArray(node.children) ? node.children : []).map(child => `node-${child}`),
        meshIds: Number.isSafeInteger(node.mesh) ? [`mesh-${node.mesh}`] : [],
        transform: nodeTransform(node),
      }))
    const sceneMeshes =
      geometry?.scene.meshes ??
      meshes.map((mesh, index) => ({
        id: `mesh-${index}`,
        ...(typeof mesh?.name === 'string' ? { name: mesh.name } : {}),
        primitiveIds: (Array.isArray(mesh?.primitives) ? mesh.primitives : []).map(
          (_primitive, primitiveIndex) => `mesh-${index}-primitive-${primitiveIndex}`,
        ),
      }))
    const model = createModelSceneSource({
      info: {
        scenes: scenes.length,
        nodes: sceneNodes.length,
        meshes: sceneMeshes.length,
        primitives: geometry?.scene.primitives.length ?? primitiveCount,
        materials: materials.length,
        textures: textures.length,
        animations: animations.length,
        ...(geometry?.scene.bounds === undefined ? {} : { bounds: geometry.scene.bounds }),
        geometryAccess: geometry === undefined ? 'metadata-only' : 'decoded',
      },
      nodes: sceneNodes,
      meshes: sceneMeshes,
      primitives: geometry?.scene.primitives ?? [],
    })
    const relations = createRelationGraphSource(document, String(context.primary.revision))
    const subjectFacts = createSubjectFactsSource(document, context)
    const tree = createJsonTreeSource(document, {
      label: 'glTF 2.x native document',
      budget: {
        maxBytes: context.budget.maxScalarBytes,
        maxNodes: context.budget.maxNodes,
        maxDepth: context.budget.maxDepth,
      },
      ...(context.input.originKind === 'single' ? { write: { operation: 'edit.field' } } : {}),
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    return {
      summary: {
        format: gltf.binary ? 'glb' : 'gltf',
        version: document.asset.version,
        generator: document.asset.generator ?? null,
        scenes: scenes.length,
        nodes: nodes.length,
        meshes: meshes.length,
        primitives: geometry?.scene.primitives.length ?? primitiveCount,
        materials: materials.length,
        textures: textures.length,
        animations: animations.length,
        skins: skins.length,
        buffers: buffers.length,
        images: images.length,
        externalUris: gltf.externalUris,
        unknownGlbChunks: gltf.unknownChunks ?? [],
      },
      metadata: [
        {
          id: 'gltf-document',
          label: 'glTF document',
          entries: [
            { key: 'version', value: document.asset.version },
            { key: 'generator', value: document.asset.generator ?? null },
            { key: 'scenes', value: scenes.length },
            { key: 'nodes', value: nodes.length },
            { key: 'meshes', value: meshes.length },
            { key: 'primitives', value: geometry?.scene.primitives.length ?? primitiveCount },
            { key: 'materials', value: materials.length },
            { key: 'textures', value: textures.length },
            { key: 'animations', value: animations.length },
            { key: 'skins', value: skins.length },
            { key: 'externalResources', value: gltf.externalUris.length },
            { key: 'unknownGlbChunks', value: gltf.unknownChunks?.length ?? 0 },
          ],
        },
      ],
      traits: [
        ...(meshes.length > 0
          ? [
              {
                id: 'model.geometry',
                parameters: {
                  meshes: meshes.length,
                  primitives: geometry?.scene.primitives.length ?? primitiveCount,
                },
              },
            ]
          : []),
        ...(materials.length > 0
          ? [{ id: 'model.materials', parameters: { count: materials.length } }]
          : []),
        ...(textures.length > 0 || images.length > 0
          ? [
              {
                id: 'model.textures',
                parameters: { textures: textures.length, images: images.length },
              },
            ]
          : []),
        ...(animations.length > 0
          ? [{ id: 'model.animations', parameters: { count: animations.length } }]
          : []),
        ...(skins.length > 0
          ? [{ id: 'model.skeleton', parameters: { skins: skins.length } }]
          : []),
        { id: 'scene.objects', parameters: { scenes: scenes.length, nodes: nodes.length } },
        { id: 'structure.hierarchy', parameters: { nodeCount: gltf.nodes, lazy: true } },
        ...(gltf.binary ? [] : [{ id: 'content.text', parameters: { encoding: 'utf-8' } }]),
      ],
      text: !gltf.binary,
      maxDecodedBytes: geometry?.scene.decodedBytes ?? decoded.bytes,
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/model-scene-source': model,
        'common.view/relation-graph-source': relations,
        'common.view/subject-facts-source': subjectFacts,
        ...(externalImages.length === 0
          ? {}
          : {
              'common.view/model-resource-refs-source': createModelResourceRefsSource({
                references: externalImages,
              }),
            }),
      },
      handlers: {
        'set-gltf-field': editHandler(bytes, gltf, context, fieldEdits),
        'edit-gltf-document': editHandler(bytes, gltf, context, documentEdits),
      },
      unsupportedFeatures: [
        ...(decoded.externalUris.length > 0 ? ['external-buffer-resolution'] : []),
        ...(geometry === undefined ? ['decoded-geometry'] : []),
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
