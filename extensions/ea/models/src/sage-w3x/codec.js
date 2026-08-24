// Hand-ported structural SAGE W3X reader. It validates the XML envelope and inventories authored
// model references without claiming the MK2 renderer's geometry, skeleton, or FX fidelity.

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

function attribute(element, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'u').exec(element)
  return match?.[1] ?? match?.[2]
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
  const textures = Object.freeze(
    (records.Texture ?? [])
      .map(
        element =>
          attribute(element, 'File') ?? attribute(element, 'file') ?? attribute(element, 'id'),
      )
      .filter(Boolean),
  )
  const includes = Object.freeze(
    (records.Include ?? [])
      .map(element => attribute(element, 'source') ?? attribute(element, 'Source'))
      .filter(Boolean),
  )
  const counts = Object.freeze(
    Object.fromEntries(ELEMENTS.map(name => [name, records[name]?.length ?? 0])),
  )
  return Object.freeze({ ids, textures, includes, counts, total })
}

function modelSource(parsed) {
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 0,
      primitives: 0,
      materials: 0,
      textures: parsed.textures.length,
      animations: 0,
      geometryAccess: 'metadata-only',
    },
    nodes: [
      {
        id: 'w3x-root',
        name: 'SAGE W3X structural root',
        childIds: [],
        meshIds: [],
        transform: IDENTITY,
      },
    ],
    meshes: [],
    primitives: [],
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
        textures: parsed.textures,
        includes: parsed.includes,
        geometryAccess: 'metadata-only',
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
            { key: 'textures', value: parsed.textures.length },
            { key: 'includes', value: parsed.includes.length },
            { key: 'geometryAccess', value: 'metadata-only' },
          ],
        },
      ],
      traits: [
        { id: 'model.geometry', parameters: { meshes: meshCount, decoded: false } },
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
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: [
        'w3x-geometry-decoding',
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
