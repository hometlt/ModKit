// Portable SAGE W3X reader. It validates the XML envelope, decodes the authored triangle-mesh
// subset, and keeps hierarchy, animation, include, collision, and FX planes explicit as debt.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/sage-w3x'
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const ELEMENTS = Object.freeze([
  'W3DContainer',
  'W3DMesh',
  'W3DHierarchy',
  'W3DAnimation',
  'W3DCollisionBox',
  'Texture',
  'Include',
])

function decode(bytes) {
  return new TextDecoder().decode(bytes)
}

function signature(bytes) {
  const text = decode(bytes.subarray(0, Math.min(bytes.byteLength, 2048))).trimStart()
  return (
    text.includes('<AssetDeclaration') ||
    text.includes('<W3DMesh') ||
    text.includes('<W3DContainer')
  )
}

function elements(source, name) {
  const pattern = new RegExp(`<${name}(?:\\s[^<>]*?)?\\s*/?>`, 'gu')
  return [...source.matchAll(pattern)].map(match => match[0])
}

function blocks(source, name) {
  const pattern = new RegExp(`<${name}\\b([^<>]*?)(?:/\\s*>|>([\\s\\S]*?)</${name}\\s*>)`, 'gu')
  return [...source.matchAll(pattern)].map(match => ({
    element: match[0],
    body: match[2],
  }))
}

function attribute(element, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'u').exec(element)
  return match?.[1] ?? match?.[2]
}

function finiteAttribute(element, name, label) {
  const raw = attribute(element, name)
  const value = raw === undefined ? Number.NaN : Number(raw)
  if (!Number.isFinite(value)) throw new TypeError(`W3X ${label} has no finite ${name}`)
  return value
}

function firstSection(source, name) {
  return blocks(source, name)[0]?.body
}

function vectorElements(source, name, dimensions, label) {
  if (source === undefined) return []
  return blocks(source, name).map((block, index) => {
    const axes = ['X', 'Y', 'Z'].slice(0, dimensions)
    return axes.map(axis => finiteAttribute(block.element, axis, `${label} ${index}`))
  })
}

function toUvmVector([x, y, z]) {
  return [x, z, y === 0 ? 0 : -y]
}

function normalized(vector) {
  const length = Math.hypot(...vector)
  return length === 0 ? [0, 0, 0] : vector.map(value => value / length)
}

function boundsFor(positions) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis]
      if (value === undefined) throw new TypeError('W3X position tuple is truncated')
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

function triangleIndices(source, vertexCount, meshName) {
  if (source === undefined) return new Uint32Array()
  const result = []
  for (const [triangleIndex, triangle] of blocks(source, 'T').entries()) {
    const values = [...(triangle.body ?? '').matchAll(/<V(?:\s[^<>]*?)?>([^<]+)<\/V\s*>/gu)].map(
      match => Number.parseInt(match[1] ?? '', 10),
    )
    if (
      values.length !== 3 ||
      values.some(value => !Number.isSafeInteger(value) || value < 0 || value >= vertexCount)
    ) {
      throw new TypeError(`W3X mesh ${meshName} triangle ${triangleIndex} has invalid indices`)
    }
    result.push(...values)
  }
  return Uint32Array.from(result)
}

function textureReferences(source) {
  return Object.freeze([
    ...new Set(
      blocks(source, 'Texture')
        .map(block => {
          const direct =
            attribute(block.element, 'File') ??
            attribute(block.element, 'file') ??
            attribute(block.element, 'id')
          if (direct !== undefined) return direct
          return /<Value(?:\s[^<>]*?)?>([^<]+)<\/Value\s*>/u.exec(block.body ?? '')?.[1]?.trim()
        })
        .filter(Boolean),
    ),
  ])
}

function decodedMeshes(source) {
  return blocks(source, 'W3DMesh').flatMap((block, index) => {
    if (block.body === undefined) return []
    const name = attribute(block.element, 'id') ?? `W3DMesh_${index}`
    const rawPositions = vectorElements(
      firstSection(block.body, 'Vertices'),
      'V',
      3,
      `${name} vertex`,
    )
    if (rawPositions.length === 0) return []
    const positions = Float32Array.from(rawPositions.flatMap(toUvmVector))
    const indices = triangleIndices(
      firstSection(block.body, 'Triangles'),
      rawPositions.length,
      name,
    )
    if (indices.length === 0) return []
    const rawNormals = vectorElements(firstSection(block.body, 'Normals'), 'N', 3, `${name} normal`)
    const normals =
      rawNormals.length === rawPositions.length
        ? Float32Array.from(rawNormals.flatMap(value => normalized(toUvmVector(value))))
        : undefined
    const rawUvs = vectorElements(
      firstSection(block.body, 'TexCoords'),
      'T',
      2,
      `${name} texture coordinate`,
    )
    const textureCoordinates =
      rawUvs.length === rawPositions.length
        ? Float32Array.from(rawUvs.flatMap(([u, v]) => [u, 1 - v]))
        : undefined
    const meshId = `w3x-mesh-${index}`
    const primitiveId = `w3x-primitive-${index}`
    const materialId = `w3x-material-${index}`
    const bounds = boundsFor(positions)
    return [
      Object.freeze({
        id: meshId,
        name,
        primitive: Object.freeze({
          id: primitiveId,
          topology: 'triangles',
          positions,
          indices,
          ...(normals === undefined ? {} : { normals }),
          ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
          materialId,
          bounds,
        }),
      }),
    ]
  })
}

function parseW3x(bytes, budget) {
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('W3X text exceeds maxScalarBytes')
  const source = decode(bytes)
  if (!signature(bytes)) throw new TypeError('W3X AssetDeclaration root is missing')
  const open = /<AssetDeclaration(?:\s[^<>]*?)?>/u.exec(source)
  const close = /<\/AssetDeclaration\s*>/u.exec(source)
  if (open === null || close === null || close.index <= open.index) {
    throw new TypeError('W3X AssetDeclaration is not closed')
  }
  const records = Object.fromEntries(ELEMENTS.map(name => [name, elements(source, name)]))
  const total = ELEMENTS.reduce((sum, name) => sum + (records[name]?.length ?? 0), 1)
  if (total > budget.maxNodes) throw new RangeError('W3X elements exceed maxNodes')
  const ids = Object.freeze(
    ELEMENTS.flatMap(name =>
      (records[name] ?? []).map(element => attribute(element, 'id')).filter(Boolean),
    ),
  )
  const textures = textureReferences(source)
  const includes = Object.freeze(
    (records.Include ?? [])
      .map(element => attribute(element, 'source') ?? attribute(element, 'Source'))
      .filter(Boolean),
  )
  const counts = Object.freeze(
    Object.fromEntries(ELEMENTS.map(name => [name, records[name]?.length ?? 0])),
  )
  const meshes = decodedMeshes(source)
  const geometryNodes = meshes.reduce(
    (sum, mesh) => sum + mesh.primitive.positions.length / 3 + mesh.primitive.indices.length / 3,
    0,
  )
  if (total + geometryNodes > budget.maxNodes) throw new RangeError('W3X elements exceed maxNodes')
  const decodedBytes = meshes.reduce(
    (sum, mesh) =>
      sum +
      mesh.primitive.positions.byteLength +
      mesh.primitive.indices.byteLength +
      (mesh.primitive.normals?.byteLength ?? 0) +
      (mesh.primitive.textureCoordinates?.byteLength ?? 0),
    0,
  )
  if (decodedBytes > budget.maxScalarBytes)
    throw new RangeError('W3X geometry exceeds maxScalarBytes')
  return Object.freeze({
    ids,
    textures,
    includes,
    counts,
    total,
    meshes,
    bounds: unionBounds(meshes),
    decodedBytes,
  })
}

function modelSource(parsed) {
  const animationCount = parsed.counts.W3DAnimation ?? 0
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: parsed.meshes.length,
      primitives: parsed.meshes.length,
      materials: parsed.meshes.length,
      textures: parsed.textures.length,
      animations: animationCount,
      ...(parsed.bounds === undefined ? {} : { bounds: parsed.bounds }),
      geometryAccess: parsed.meshes.length > 0 ? 'decoded' : 'metadata-only',
    },
    nodes: [
      {
        id: 'w3x-root',
        name: 'SAGE W3X structural root',
        childIds: [],
        meshIds: parsed.meshes.map(mesh => mesh.id),
        transform: IDENTITY,
      },
    ],
    meshes: parsed.meshes.map(mesh => ({
      id: mesh.id,
      name: mesh.name,
      primitiveIds: [mesh.primitive.id],
    })),
    primitives: parsed.meshes.map(mesh => mesh.primitive),
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'sage-w3x', label: 'SAGE W3X XML model' }),
  async detect(prefix) {
    return signature(prefix)
      ? { confidence: 0.98, kind: 'structure', note: 'W3X XML elements' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const parsed = parseW3x(bytes, context.budget)
    const meshCount = parsed.counts.W3DMesh ?? 0
    const hierarchyCount = parsed.counts.W3DHierarchy ?? 0
    const animationCount = parsed.counts.W3DAnimation ?? 0
    return {
      summary: {
        format: 'sage-w3x',
        elements: parsed.total,
        containers: parsed.counts.W3DContainer ?? 0,
        declaredMeshes: meshCount,
        declaredHierarchies: hierarchyCount,
        declaredAnimations: animationCount,
        decodedMeshes: parsed.meshes.length,
        decodedVertices: parsed.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.positions.length / 3,
          0,
        ),
        decodedTriangles: parsed.meshes.reduce(
          (sum, mesh) => sum + mesh.primitive.indices.length / 3,
          0,
        ),
        textures: parsed.textures,
        includes: parsed.includes,
        geometryAccess: parsed.meshes.length > 0 ? 'decoded' : 'metadata-only',
      },
      metadata: [
        {
          id: 'sage-w3x-model',
          label: 'SAGE W3X model',
          entries: [
            { key: 'elements', value: parsed.total },
            { key: 'containers', value: parsed.counts.W3DContainer ?? 0 },
            { key: 'declaredMeshes', value: meshCount },
            { key: 'declaredHierarchies', value: hierarchyCount },
            { key: 'declaredAnimations', value: animationCount },
            { key: 'decodedMeshes', value: parsed.meshes.length },
            { key: 'textures', value: parsed.textures.length },
            { key: 'includes', value: parsed.includes.length },
            {
              key: 'geometryAccess',
              value: parsed.meshes.length > 0 ? 'decoded' : 'metadata-only',
            },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: { meshes: parsed.meshes.length, decoded: parsed.meshes.length > 0 },
        },
        ...(parsed.textures.length > 0
          ? [{ id: 'model.textures', parameters: { count: parsed.textures.length } }]
          : []),
        ...(animationCount > 0
          ? [{ id: 'model.animations', parameters: { count: animationCount, decoded: false } }]
          : []),
        { id: 'structure.hierarchy', parameters: { nodes: parsed.total } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      dataSources: {
        'common.view/model-scene-source': modelSource(parsed),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'model',
          label: 'SAGE W3X',
          preview: `${parsed.total} structural elements`,
          children: ELEMENTS.filter(name => (parsed.counts[name] ?? 0) > 0).map(name => ({
            kind: 'section',
            label: name,
            preview: `${parsed.counts[name]} element(s)`,
          })),
        }),
      },
      maxDecodedBytes: Math.max(bytes.byteLength, parsed.decodedBytes),
      unsupportedFeatures: [
        ...(parsed.meshes.length < meshCount ? ['remaining-w3x-geometry-variants'] : []),
        'w3x-skeleton-decoding',
        'w3x-animation-decoding',
        'include-and-companion-resolution',
        'texture-resolution',
        'fx-shader-execution',
        'model-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
