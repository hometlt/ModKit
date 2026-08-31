import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkit/codec-kit'
import { decodeEmbeddedGltfBuffers, decodeGltfGeometry } from './geometry.js'

const decoder = new TextDecoder('utf-8', { fatal: true })

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
  while (offset < bytes.byteLength) {
    const length = u32(bytes, offset)
    const type = u32(bytes, offset + 4)
    const end = offset + 8 + length
    if (length % 4 !== 0 || end > bytes.byteLength) throw new TypeError('GLB chunk is invalid')
    const payload = bytes.subarray(offset + 8, end)
    if (type === 0x4e4f534a && jsonBytes === undefined) jsonBytes = payload
    else if (type === 0x004e4942) binaryChunks.push(payload)
    offset = end
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

function category(label, values, kind) {
  return {
    kind: 'collection',
    label,
    preview: `${values.length}`,
    children: values.map((value, index) => ({
      kind,
      label: typeof value?.name === 'string' ? value.name : `${kind} ${index}`,
      preview: typeof value?.uri === 'string' ? value.uri : undefined,
    })),
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
    const primitiveCount = meshes.reduce(
      (total, mesh) => total + (Array.isArray(mesh?.primitives) ? mesh.primitives.length : 0),
      0,
    )
    const decoded = gltf.decoded ?? decodeEmbeddedGltfBuffers(document, context.budget)
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
    const tree = createTreeDataSource({
      kind: 'model',
      label: 'glTF',
      preview: `${nodes.length} nodes, ${meshes.length} meshes`,
      children: [
        category('Scenes', scenes, 'scene'),
        category('Nodes', nodes, 'node'),
        category('Meshes', meshes, 'mesh'),
        category('Materials', materials, 'material'),
        category('Animations', animations, 'animation'),
      ],
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
      },
      unsupportedFeatures: [
        ...(gltf.externalUris.length > 0 ? ['external-resource-resolution'] : []),
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
