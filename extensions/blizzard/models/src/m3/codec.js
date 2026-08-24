import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/m3'
const TEXTURE_REQUIREMENT = 'textures'
/** Bytes `planInput` reads from the front of the file to find its string table. */
const PLAN_SCAN_BYTES = 512 * 1024
const MAX_TEXTURE_REFERENCES = 64
/** A reference must be a relative asset path; anything naming a location is refused. */
const LOCATION_LIKE = /^[A-Za-z]:|^[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)|^[a-z][a-z0-9+.-]*:/u
const TEXTURE_FILE = /\.(?:dds|tga)$/iu

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

/**
 * Texture paths an M3 names, read from its own `CHAR` string table.
 *
 * M3 keeps every string in `CHAR` sections and points at them from `LAYR` entries. Following that
 * indirection means decoding the layer records; reading the string table does not, and the paths
 * are unambiguous on their own — `Assets/Textures/SM_HML_Artifact_diff512.dds` is a texture
 * reference whichever layer points at it. So this walks the section index (fixed-size headers, no
 * record decoding) and collects the strings that name a texture file.
 *
 * These are *paths*, not bare names, and that matters on the host side too: the resolver matches a
 * pattern containing `/` against the whole logical id and derives a listing prefix from it, so a
 * container with hundreds of thousands of entries is searched by directory instead of scanned.
 */
function scanTextureReferences(bytes) {
  const empty = Object.freeze({ names: Object.freeze([]), truncated: true })
  const tag = bytes.byteLength >= 4 ? reversedTag(bytes, 0) : ''
  if (tag !== 'MD33' && tag !== 'MD34') return empty
  const headerBytes = tag === 'MD33' ? 20 : 24
  if (bytes.byteLength < headerBytes) return empty
  const view = viewOf(bytes)
  const indexOffset = view.getUint32(4, true)
  const indexCount = view.getUint32(8, true)
  const indexBytes = indexCount * 16
  if (
    !Number.isSafeInteger(indexBytes) ||
    indexOffset < headerBytes ||
    indexOffset + indexBytes > bytes.byteLength
  ) {
    // the scan window cut the index, or the file is malformed: declare nothing rather than guess
    return empty
  }
  const sections = []
  for (let index = 0; index < indexCount; index += 1) {
    const offset = indexOffset + index * 16
    sections.push({ tag: reversedTag(bytes, offset), offset: view.getUint32(offset + 4, true) })
  }
  const bounds = [...new Set([...sections.map(section => section.offset), indexOffset])]
    .filter(offset => offset >= 0 && offset <= bytes.byteLength)
    .sort((left, right) => left - right)
  const decoder = new TextDecoder('latin1')
  const names = []
  const seen = new Set()
  let truncated = false
  for (const section of sections) {
    if (section.tag !== 'CHAR' || section.offset > bytes.byteLength) continue
    const end = bounds.find(offset => offset > section.offset) ?? bytes.byteLength
    for (const part of decoder.decode(bytes.subarray(section.offset, end)).split('\u0000')) {
      const value = part.trim()
      if (!TEXTURE_FILE.test(value) || LOCATION_LIKE.test(value)) continue
      const normalized = value.split(String.fromCharCode(92)).join('/')
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      if (names.length >= MAX_TEXTURE_REFERENCES) {
        truncated = true
        break
      }
      seen.add(key)
      names.push(normalized)
    }
  }
  return Object.freeze({ names: Object.freeze(names), truncated })
}

/** Reads the texture bindings the host resolved; the codec binds them, it does not decode them. */
async function readTextureBindings(input, signal) {
  const bindings = input.bindingsFor?.(TEXTURE_REQUIREMENT) ?? []
  const resolved = []
  for (const binding of bindings) {
    const lease = await input.openBinding(binding.bindingId, signal)
    try {
      if (lease.value.kind !== 'bytes') continue
      resolved.push(
        Object.freeze({
          bindingId: binding.bindingId,
          uri: binding.source.uri,
          bytes: Number(lease.value.size ?? 0n),
        }),
      )
    } finally {
      await lease.release()
    }
  }
  return Object.freeze(resolved)
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'm3', label: 'StarCraft II M3/M3A' }),
  async planInput(source, _detection, signal) {
    const size = Number(source.size ?? 0n)
    const window = Math.min(size, PLAN_SCAN_BYTES)
    const bytes = window === 0 ? new Uint8Array(0) : await source.read(0n, window, signal)
    const scan = scanTextureReferences(bytes)
    if (scan.names.length === 0) {
      return Object.freeze({
        originKind: 'single',
        candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
        requirements: Object.freeze([]),
      })
    }
    return Object.freeze({
      originKind: 'bundle',
      candidate: Object.freeze({ bindingId: 'content', role: 'content', ownership: 'owned' }),
      requirements: Object.freeze([
        Object.freeze({
          id: TEXTURE_REQUIREMENT,
          role: 'texture',
          ownership: 'companion',
          patterns: Object.freeze([...scan.names]),
          scopes: Object.freeze(['sibling-directory', 'current-mount', 'enclosing-container']),
          // an M3 whose textures ship in another mod layer is a complete, readable model
          cardinality: 'many',
          required: false,
        }),
      ]),
    })
  },
  async detect(prefix) {
    const tag = prefix.byteLength >= 4 ? reversedTag(prefix, 0) : ''
    return tag === 'MD33' || tag === 'MD34'
      ? { confidence: 0.99, kind: 'magic', note: tag }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const model = parseM3(bytes, context.budget.maxNodes)
    const geometry = await geometryOf(bytes, context.budget)
    const references = scanTextureReferences(bytes)
    const boundTextures = await readTextureBindings(context.input, context.signal)
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
        textureReferences: references.names.map(value => ({
          value,
          // 'companion' once the host bound a file for it; a reference is published either way
          provenance: boundTextures.length > 0 ? 'companion' : 'reference-only',
        })),
        textureBindings: boundTextures.map(item => ({
          bindingId: item.bindingId,
          bytes: item.bytes,
          provenance: 'companion',
        })),
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
      companions: [
        {
          id: TEXTURE_REQUIREMENT,
          role: 'texture',
          cardinality: 'many',
          required: false,
          ...(boundTextures.length === 0
            ? { state: 'missing' }
            : { state: 'resolved', bindingIds: boundTextures.map(item => item.bindingId) }),
        },
      ],
      unsupportedFeatures: [
        ...(geometryAccess === 'decoded' ? [] : ['decoded-geometry-buffers']),
        'materials',
        'texture-decoding',
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
