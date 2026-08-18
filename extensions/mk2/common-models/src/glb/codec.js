// Hand-ported from the MK2 codec org.modkitx/glb (OPUS-MK2-01 task C pilot).
//
// GLB 2.0 is a header plus length-prefixed chunks; the structured JSON chunk carries the whole
// scene graph. This port inventories that graph (nodes, meshes, materials, textures, animations)
// and publishes it as a metadata-only model scene — decoding the BIN chunk into primitives is a
// separate job the v1 codec did not claim either.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/glb'
const MAGIC = 0x46546c67 // 'glTF' little-endian
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function u32le(bytes, offset) {
  if (offset + 4 > bytes.byteLength) throw new RangeError('truncated GLB u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function headerOf(bytes) {
  if (bytes.byteLength < 12 || u32le(bytes, 0) !== MAGIC) return undefined
  return { version: u32le(bytes, 4), length: u32le(bytes, 8) }
}

function chunkLabel(type) {
  if (type === JSON_CHUNK) return 'JSON'
  return type === BIN_CHUNK ? 'BIN' : 'other'
}

function parseGlb(bytes, budget) {
  const header = headerOf(bytes)
  if (header === undefined) throw new TypeError('GLB magic is invalid')
  if (header.version !== 2) throw new TypeError(`GLB version ${header.version} is unsupported`)
  const end = Math.min(bytes.byteLength, header.length)
  const chunks = []
  let offset = 12
  while (offset + 8 <= end) {
    const length = u32le(bytes, offset)
    const type = u32le(bytes, offset + 4)
    const dataOffset = offset + 8
    if (dataOffset + length > bytes.byteLength) throw new TypeError('GLB chunk is truncated')
    chunks.push(Object.freeze({ type, length, dataOffset }))
    offset = dataOffset + length + ((4 - (length % 4)) % 4)
  }
  const jsonChunk = chunks.find(chunk => chunk.type === JSON_CHUNK)
  if (jsonChunk === undefined) throw new TypeError('GLB carries no JSON chunk')
  if (jsonChunk.length > budget.maxScalarBytes) {
    throw new RangeError('GLB JSON chunk exceeds the maxScalarBytes budget')
  }
  const document = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(jsonChunk.dataOffset, jsonChunk.dataOffset + jsonChunk.length),
    ),
  )
  if (document === null || typeof document !== 'object') {
    throw new TypeError('GLB JSON chunk is not an object')
  }
  return Object.freeze({
    header,
    chunks: Object.freeze(chunks),
    document,
    binaryBytes: chunks.find(chunk => chunk.type === BIN_CHUNK)?.length ?? 0,
  })
}

const list = (document, key) => (Array.isArray(document[key]) ? document[key] : [])

function sceneSource(glb, budget) {
  const document = glb.document
  const nodes = list(document, 'nodes').slice(0, budget.maxNodes)
  const meshes = list(document, 'meshes').slice(0, budget.maxNodes)
  let primitives = 0
  for (const mesh of meshes) primitives += list(mesh, 'primitives').length
  return createModelSceneSource({
    info: {
      scenes: list(document, 'scenes').length,
      nodes: nodes.length,
      meshes: meshes.length,
      primitives,
      materials: list(document, 'materials').length,
      textures: list(document, 'textures').length,
      animations: list(document, 'animations').length,
      geometryAccess: 'metadata-only',
    },
    nodes: nodes.map((node, index) => ({
      id: `node/${index}`,
      ...(typeof node.name === 'string' ? { name: node.name } : {}),
      childIds: (Array.isArray(node.children) ? node.children : []).map(child => `node/${child}`),
      meshIds: typeof node.mesh === 'number' ? [`mesh/${node.mesh}`] : [],
      transform:
        Array.isArray(node.matrix) && node.matrix.length === 16 ? [...node.matrix] : [...IDENTITY],
    })),
    meshes: meshes.map((mesh, index) => ({
      id: `mesh/${index}`,
      ...(typeof mesh.name === 'string' ? { name: mesh.name } : {}),
      primitiveIds: list(mesh, 'primitives').map((_, slot) => `mesh/${index}/${slot}`),
    })),
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'glb',
    label: 'GLB 2.0 binary glTF model',
    mediaType: 'model/gltf-binary',
  }),
  async detect(prefix) {
    const header = headerOf(prefix)
    if (header === undefined) return { confidence: 0, kind: 'magic', note: 'gltf-magic-mismatch' }
    return header.version === 2
      ? { confidence: 0.99, kind: 'magic', note: 'gltf-binary-2' }
      : { confidence: 0.4, kind: 'magic', note: `gltf-binary-${header.version}` }
  },
  async inspect(bytes, context) {
    const glb = parseGlb(bytes, context.budget)
    const document = glb.document
    const asset =
      typeof document.asset === 'object' && document.asset !== null ? document.asset : {}
    const scene = sceneSource(glb, context.budget)
    const info = await scene.info()
    const tree = createTreeDataSource({
      kind: 'model',
      label: 'GLB',
      preview: `${info.nodes} node(s), ${info.meshes} mesh(es)`,
      children: [
        {
          kind: 'chunks',
          label: 'chunks',
          preview: String(glb.chunks.length),
          children: glb.chunks.map((chunk, index) => ({
            kind: 'chunk',
            label: `${index}: ${chunkLabel(chunk.type)}`,
            preview: `${chunk.length} bytes`,
          })),
        },
        {
          kind: 'meshes',
          label: 'meshes',
          preview: String(info.meshes),
          children: list(document, 'meshes').map((mesh, index) => ({
            kind: 'mesh',
            label: typeof mesh.name === 'string' ? mesh.name : `mesh ${index}`,
            preview: `${list(mesh, 'primitives').length} primitive(s)`,
          })),
        },
      ],
    })
    const extensionsUsed = list(document, 'extensionsUsed').filter(item => typeof item === 'string')
    return {
      summary: {
        format: 'glb',
        version: glb.header.version,
        generator: typeof asset.generator === 'string' ? asset.generator : null,
        nodes: info.nodes,
        meshes: info.meshes,
        primitives: info.primitives,
        animations: info.animations,
        binaryBytes: glb.binaryBytes,
      },
      metadata: [
        {
          id: 'glb-container',
          label: 'GLB container',
          entries: [
            { key: 'version', value: glb.header.version },
            { key: 'declaredBytes', value: glb.header.length },
            { key: 'chunks', value: glb.chunks.length },
            { key: 'binaryBytes', value: glb.binaryBytes },
            { key: 'generator', value: typeof asset.generator === 'string' ? asset.generator : '' },
            { key: 'extensionsUsed', value: extensionsUsed.join(', ') },
          ],
        },
      ],
      traits: [
        { id: 'model.geometry', parameters: { meshes: info.meshes, primitives: info.primitives } },
        ...(info.materials > 0
          ? [{ id: 'model.materials', parameters: { count: info.materials } }]
          : []),
        ...(info.textures > 0
          ? [{ id: 'model.textures', parameters: { count: info.textures } }]
          : []),
        ...(info.animations > 0
          ? [{ id: 'model.animations', parameters: { count: info.animations } }]
          : []),
        { id: 'structure.hierarchy', parameters: { nodes: info.nodes } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/model-scene-source': scene,
      },
      unsupportedFeatures: ['decoded-geometry', 'draco-compression', 'animation-playback'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
