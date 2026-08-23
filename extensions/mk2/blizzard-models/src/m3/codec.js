import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/m3'
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function reversedTag(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TypeError('M3 tag is truncated')
  return String.fromCharCode(
    bytes[offset + 3],
    bytes[offset + 2],
    bytes[offset + 1],
    bytes[offset],
  ).replaceAll('\0', '')
}

function parseM3(bytes, maxNodes) {
  const tag = reversedTag(bytes, 0)
  if (tag !== 'MD33' && tag !== 'MD34') throw new TypeError(`unsupported M3 header ${tag}`)
  const headerBytes = tag === 'MD33' ? 20 : 24
  if (bytes.byteLength < headerBytes) throw new TypeError('M3 header is truncated')
  const view = viewOf(bytes)
  const indexOffset = view.getUint32(4, true)
  const indexCount = view.getUint32(8, true)
  if (indexCount > maxNodes) throw new RangeError('M3 section index exceeds maxNodes budget')
  const indexBytes = indexCount * 16
  if (
    !Number.isSafeInteger(indexBytes) ||
    indexOffset < headerBytes ||
    indexOffset + indexBytes > bytes.byteLength
  ) {
    throw new TypeError('M3 section index is outside the file')
  }
  const sections = []
  for (let index = 0; index < indexCount; index += 1) {
    const offset = indexOffset + index * 16
    const sectionOffset = view.getUint32(offset + 4, true)
    if (sectionOffset > bytes.byteLength)
      throw new TypeError(`M3 section ${index} is outside the file`)
    sections.push({
      index,
      tag: reversedTag(bytes, offset),
      offset: sectionOffset,
      repetitions: view.getUint32(offset + 8, true),
      version: view.getUint32(offset + 12, true),
      byteLength: 0,
    })
  }
  const orderedOffsets = [...new Set([...sections.map(section => section.offset), indexOffset])]
    .filter(offset => offset >= 0 && offset <= bytes.byteLength)
    .sort((left, right) => left - right)
  for (const section of sections) {
    const next = orderedOffsets.find(offset => offset > section.offset) ?? bytes.byteLength
    section.byteLength = Math.max(0, next - section.offset)
  }
  return Object.freeze({ tag, indexOffset, sections: Object.freeze(sections) })
}

function metadataSceneOf(model) {
  const sectionNodes = model.sections.map(section => ({
    id: `section/${section.index}`,
    name: `${section.tag} v${section.version}`,
    childIds: [],
    meshIds: [],
    transform: IDENTITY,
  }))
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: sectionNodes.length + 1,
      meshes: 0,
      primitives: 0,
      materials: model.sections.filter(section => section.tag.startsWith('MAT')).length,
      textures: model.sections.filter(section => section.tag === 'LAYR').length,
      animations: model.sections.filter(section => section.tag === 'SEQS').length,
      geometryAccess: 'metadata-only',
    },
    nodes: [
      {
        id: 'model',
        name: `${model.tag} section graph`,
        childIds: sectionNodes.map(node => node.id),
        meshIds: [],
        transform: IDENTITY,
      },
      ...sectionNodes,
    ],
    meshes: [],
  })
}

function decodedSceneOf(model, geometry) {
  return createModelSceneSource({
    info: {
      scenes: 1,
      nodes: geometry.nodes.length,
      meshes: geometry.meshes.length,
      primitives: geometry.primitives.length,
      materials: model.sections.filter(section => section.tag.startsWith('MAT')).length,
      textures: model.sections.filter(section => section.tag === 'LAYR').length,
      animations: model.sections.filter(section => section.tag === 'SEQS').length,
      ...(geometry.bounds === undefined ? {} : { bounds: geometry.bounds }),
      geometryAccess: 'decoded',
    },
    nodes: geometry.nodes,
    meshes: geometry.meshes,
    primitives: geometry.primitives,
  })
}

async function geometryOf(bytes, budget) {
  if (globalThis.process?.versions?.node === undefined) return undefined
  const { decodeM3Geometry } = await import('./geometry.node.js')
  return decodeM3Geometry(bytes, budget)
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'm3', label: 'StarCraft II M3/M3A' }),
  async detect(prefix) {
    const tag = prefix.byteLength >= 4 ? reversedTag(prefix, 0) : ''
    return tag === 'MD33' || tag === 'MD34'
      ? { confidence: 0.99, kind: 'magic', note: tag }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const model = parseM3(bytes, context.budget.maxNodes)
    const geometry = await geometryOf(bytes, context.budget)
    const tree = createTreeDataSource({
      kind: 'model',
      label: model.tag,
      preview: `${model.sections.length} indexed sections`,
      children: model.sections.map(section => ({
        kind: 'section',
        label: `${section.index}: ${section.tag}`,
        preview: `v${section.version}, ${section.repetitions} record(s), ${section.byteLength} bytes`,
      })),
    })
    const scene =
      geometry === undefined || geometry.primitives.length === 0
        ? metadataSceneOf(model)
        : decodedSceneOf(model, geometry)
    const info = await scene.info()
    const geometryAccess = info.geometryAccess
    return {
      summary: {
        format: 'm3',
        container: model.tag,
        sections: model.sections.length,
        sectionTags: [...new Set(model.sections.map(section => section.tag))],
        geometryAccess,
        nodes: info.nodes,
        meshes: info.meshes,
        primitives: info.primitives,
        scenes: info.scenes,
        materials: info.materials,
        textures: info.textures,
        animations: info.animations,
      },
      metadata: [
        {
          id: 'm3-container',
          label: 'M3 container',
          entries: [
            { key: 'container', value: model.tag },
            { key: 'indexOffset', value: model.indexOffset },
            { key: 'sections', value: model.sections.length },
            { key: 'geometryAccess', value: geometryAccess },
            { key: 'nodes', value: info.nodes },
            { key: 'meshes', value: info.meshes },
            { key: 'primitives', value: info.primitives },
            { key: 'scenes', value: info.scenes },
            { key: 'materials', value: info.materials },
            { key: 'textures', value: info.textures },
            { key: 'animations', value: info.animations },
          ],
        },
      ],
      traits: [
        ...(geometryAccess === 'decoded'
          ? [
              {
                id: 'model.geometry',
                parameters: { meshes: info.meshes, primitives: info.primitives },
              },
            ]
          : []),
        { id: 'structure.hierarchy', parameters: { sections: model.sections.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/model-scene-source': scene,
      },
      maxDecodedBytes: BigInt(Math.max(bytes.byteLength, geometry?.decodedBytes ?? 0)),
      unsupportedFeatures: [
        ...(geometryAccess === 'decoded' ? [] : ['decoded-geometry-buffers']),
        'materials',
        'textures',
        'skeleton',
        'animations',
        'external-m3a-sidecars',
        'm3-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = () => createInspectionCodec(definition)
