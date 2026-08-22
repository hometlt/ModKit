// Blender's native file header and BHead sequence are validated before the embedded SDNA schema
// is decoded. Legacy MVert/MFace blocks are exposed as genuine indexed mesh geometry.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/blend'
const ascii = new TextDecoder('latin1')
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function text(bytes, offset, length) {
  return ascii.decode(bytes.subarray(offset, offset + length))
}

function aligned4(value) {
  return (value + 3) & ~3
}

function charge(state, budget, nodes, scalarBytes) {
  state.nodes += nodes
  state.scalarBytes += scalarBytes
  if (state.nodes > budget.maxNodes)
    throw new RangeError('Blender structure exceeds maxNodes budget')
  if (state.scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('Blender decoded data exceeds maxScalarBytes budget')
  }
}

class Reader {
  constructor(bytes, littleEndian, start = 0, end = bytes.byteLength) {
    this.bytes = bytes
    this.littleEndian = littleEndian
    this.offset = start
    this.end = end
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  need(length, label) {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.end) {
      throw new TypeError(`Blender ${label} exceeds its block bounds`)
    }
  }

  u16(label) {
    this.need(2, label)
    const value = this.view.getUint16(this.offset, this.littleEndian)
    this.offset += 2
    return value
  }

  i32(label) {
    this.need(4, label)
    const value = this.view.getInt32(this.offset, this.littleEndian)
    this.offset += 4
    return value
  }

  u32(label) {
    this.need(4, label)
    const value = this.view.getUint32(this.offset, this.littleEndian)
    this.offset += 4
    return value
  }

  pointer(size, label) {
    if (size === 4) return `0x${this.u32(label).toString(16)}`
    this.need(8, label)
    const value = this.view.getBigUint64(this.offset, this.littleEndian)
    this.offset += 8
    return `0x${value.toString(16)}`
  }

  fourCc(label) {
    this.need(4, label)
    const value = text(this.bytes, this.offset, 4)
    this.offset += 4
    return value
  }

  string0(label) {
    const start = this.offset
    while (this.offset < this.end && this.bytes[this.offset] !== 0) this.offset += 1
    if (this.offset === this.end) throw new TypeError(`Blender ${label} is not NUL-terminated`)
    const value = text(this.bytes, start, this.offset - start)
    this.offset += 1
    return value
  }

  align(label) {
    const next = aligned4(this.offset)
    this.need(next - this.offset, label)
    while (this.offset < next) {
      if (this.bytes[this.offset++] !== 0) throw new TypeError(`Blender ${label} is non-zero`)
    }
  }

  skip(length, label) {
    this.need(length, label)
    this.offset += length
  }

  finish(label) {
    if (this.offset !== this.end) throw new TypeError(`Blender ${label} has trailing bytes`)
  }
}

function arraySize(name) {
  let size = 1
  for (const match of name.matchAll(/\[(\d+)\]/gu)) {
    const extent = Number(match[1])
    if (!Number.isSafeInteger(extent) || extent < 1)
      throw new TypeError(`Blender DNA array ${name} is invalid`)
    size *= extent
    if (!Number.isSafeInteger(size)) throw new RangeError(`Blender DNA array ${name} is too large`)
  }
  return size
}

function baseName(name) {
  return name.replaceAll('*', '').replace(/[()]/gu, '').replace(/\[.*$/u, '')
}

function parseSdna(bytes, block, header, state, budget) {
  const reader = new Reader(bytes, header.littleEndian, block.payloadOffset, block.payloadEnd)
  if (reader.fourCc('SDNA signature') !== 'SDNA')
    throw new TypeError('Blender DNA1 lacks SDNA signature')
  if (reader.fourCc('SDNA NAME tag') !== 'NAME')
    throw new TypeError('Blender SDNA NAME tag is missing')
  const nameCount = reader.u32('SDNA name count')
  charge(state, budget, nameCount, 32)
  const names = []
  for (let index = 0; index < nameCount; index += 1) {
    const value = reader.string0('SDNA name')
    charge(state, budget, 0, value.length * 2)
    names.push(value)
  }
  reader.align('SDNA NAME padding')

  if (reader.fourCc('SDNA TYPE tag') !== 'TYPE')
    throw new TypeError('Blender SDNA TYPE tag is missing')
  const typeCount = reader.u32('SDNA type count')
  charge(state, budget, typeCount, 32)
  const types = []
  for (let index = 0; index < typeCount; index += 1) {
    const value = reader.string0('SDNA type')
    charge(state, budget, 0, value.length * 2)
    types.push(value)
  }
  reader.align('SDNA TYPE padding')

  if (reader.fourCc('SDNA TLEN tag') !== 'TLEN')
    throw new TypeError('Blender SDNA TLEN tag is missing')
  const typeLengths = []
  for (let index = 0; index < typeCount; index += 1)
    typeLengths.push(reader.u16('SDNA type length'))
  reader.align('SDNA TLEN padding')

  if (reader.fourCc('SDNA STRC tag') !== 'STRC')
    throw new TypeError('Blender SDNA STRC tag is missing')
  const structCount = reader.u32('SDNA structure count')
  charge(state, budget, structCount, structCount * 48)
  const structs = []
  for (let index = 0; index < structCount; index += 1) {
    const typeIndex = reader.u16('SDNA structure type')
    const fieldCount = reader.u16('SDNA structure field count')
    if (typeIndex >= types.length)
      throw new TypeError('Blender SDNA structure type index is invalid')
    charge(state, budget, fieldCount, fieldCount * 32)
    const fields = []
    let offset = 0
    for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
      const fieldTypeIndex = reader.u16('SDNA field type')
      const nameIndex = reader.u16('SDNA field name')
      if (fieldTypeIndex >= types.length || nameIndex >= names.length) {
        throw new TypeError('Blender SDNA field index is invalid')
      }
      const name = names[nameIndex]
      const count = arraySize(name)
      const size = (name.includes('*') ? header.pointerSize : typeLengths[fieldTypeIndex]) * count
      if (!Number.isSafeInteger(size)) throw new RangeError('Blender SDNA field size is too large')
      fields.push(
        Object.freeze({
          type: types[fieldTypeIndex],
          name,
          baseName: baseName(name),
          count,
          offset,
          size,
        }),
      )
      offset += size
    }
    const declaredLength = typeLengths[typeIndex]
    if (offset > declaredLength) {
      throw new TypeError(`Blender SDNA structure ${types[typeIndex]} exceeds its declared length`)
    }
    structs.push(
      Object.freeze({
        type: types[typeIndex],
        typeIndex,
        length: declaredLength,
        fields: Object.freeze(fields),
      }),
    )
  }
  reader.finish('SDNA block')
  return Object.freeze({
    names: Object.freeze(names),
    types: Object.freeze(types),
    typeLengths: Object.freeze(typeLengths),
    structs: Object.freeze(structs),
  })
}

function field(structure, name) {
  return structure.fields.find(value => value.baseName === name)
}

function floatAt(bytes, offset, littleEndian) {
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(
    offset,
    littleEndian,
  )
  if (!Number.isFinite(value)) throw new TypeError('Blender mesh position is not finite')
  return value
}

function indexAt(bytes, offset, littleEndian) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    littleEndian,
  )
}

function boundsFromPositions(positions) {
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

function decodeLegacyGeometry(bytes, blocks, sdna, header, budget) {
  const typed = blocks
    .filter(
      block =>
        block.code !== 'DNA1' && block.sdnaIndex >= 0 && block.sdnaIndex < sdna.structs.length,
    )
    .map(block => ({ block, structure: sdna.structs[block.sdnaIndex] }))
  const vertexEntries = typed.filter(entry => entry.structure.type === 'MVert')
  const faceEntries = typed.filter(entry => entry.structure.type === 'MFace')
  if (vertexEntries.length === 0 || faceEntries.length === 0) return undefined
  const vertexEntry = vertexEntries[0]
  const faceEntry = faceEntries[0]
  const coordinate = field(vertexEntry.structure, 'co')
  const corners = ['v1', 'v2', 'v3', 'v4'].map(name => field(faceEntry.structure, name))
  if (
    coordinate?.type !== 'float' ||
    coordinate.count < 3 ||
    corners.some(value => value?.size !== 4)
  ) {
    throw new TypeError('Blender legacy mesh SDNA fields are incompatible')
  }
  const vertexCount = vertexEntry.block.count
  const positions = new Float32Array(vertexCount * 3)
  for (let index = 0; index < vertexCount; index += 1) {
    const start =
      vertexEntry.block.payloadOffset + index * vertexEntry.structure.length + coordinate.offset
    for (let axis = 0; axis < 3; axis += 1) {
      positions[index * 3 + axis] = floatAt(bytes, start + axis * 4, header.littleEndian)
    }
  }
  const indices = []
  let faces = 0
  for (let index = 0; index < faceEntry.block.count; index += 1) {
    const start = faceEntry.block.payloadOffset + index * faceEntry.structure.length
    const values = corners.map(value => indexAt(bytes, start + value.offset, header.littleEndian))
    const used = values[3] === 0 ? values.slice(0, 3) : values
    if (new Set(used).size < 3 || used.some(value => value >= vertexCount)) {
      throw new TypeError('Blender legacy mesh face references invalid vertices')
    }
    indices.push(used[0], used[1], used[2])
    if (used.length === 4) indices.push(used[0], used[2], used[3])
    faces += 1
  }
  const decodedBytes = positions.byteLength + indices.length * 4
  if (decodedBytes > budget.maxScalarBytes) {
    throw new RangeError('Blender decoded geometry exceeds maxScalarBytes budget')
  }
  return Object.freeze({
    positions,
    indices: new Uint32Array(indices),
    vertices: vertexCount,
    faces,
    triangles: indices.length / 3,
    bounds: boundsFromPositions(positions),
    decodedBytes,
    vertexBlocks: vertexEntries.length,
    faceBlocks: faceEntries.length,
  })
}

function parseBlend(bytes, budget) {
  if (budget.maxDepth < 2) throw new RangeError('Blender structure exceeds maxDepth budget')
  if (bytes.byteLength < 20 || text(bytes, 0, 7) !== 'BLENDER') {
    throw new TypeError('Blender file header is missing')
  }
  const pointerFlag = text(bytes, 7, 1)
  const endianFlag = text(bytes, 8, 1)
  const versionText = text(bytes, 9, 3)
  const pointerSize = pointerFlag === '-' ? 8 : pointerFlag === '_' ? 4 : undefined
  const littleEndian = endianFlag === 'v' ? true : endianFlag === 'V' ? false : undefined
  if (pointerSize === undefined) throw new TypeError('Blender pointer-size flag is invalid')
  if (littleEndian === undefined) throw new TypeError('Blender endian flag is invalid')
  if (!/^\d{3}$/u.test(versionText)) throw new TypeError('Blender version is invalid')
  const header = Object.freeze({
    pointerFlag,
    pointerSize,
    endianFlag,
    littleEndian,
    version: Number(versionText),
  })
  const reader = new Reader(bytes, littleEndian, 12)
  const state = { nodes: 1, scalarBytes: 160 }
  charge(state, budget, 0, 0)
  const blocks = []
  let sawEnd = false
  while (reader.offset < reader.end) {
    const headerOffset = reader.offset
    const code = reader.fourCc('BHead code')
    const length = reader.i32('BHead length')
    if (length < 0) throw new TypeError('Blender BHead length is negative')
    if (code === 'ENDB') {
      if (length !== 0 || reader.offset !== reader.end) {
        throw new TypeError('Blender ENDB block is malformed or not final')
      }
      blocks.push(
        Object.freeze({
          code,
          length,
          headerOffset,
          payloadOffset: reader.offset,
          payloadEnd: reader.offset,
          sdnaIndex: -1,
          count: 0,
          oldAddress: '0x0',
        }),
      )
      charge(state, budget, 1, 32)
      sawEnd = true
      break
    }
    const oldAddress = reader.pointer(pointerSize, 'BHead old pointer')
    const sdnaIndex = reader.i32('BHead SDNA index')
    const count = reader.i32('BHead count')
    if (count < 0) throw new TypeError('Blender BHead count is negative')
    const payloadOffset = reader.offset
    reader.skip(length, `${code} payload`)
    blocks.push(
      Object.freeze({
        code,
        length,
        oldAddress,
        sdnaIndex,
        count,
        headerOffset,
        payloadOffset,
        payloadEnd: reader.offset,
      }),
    )
    charge(state, budget, 1, 64)
  }
  if (!sawEnd) throw new TypeError('Blender ENDB block is missing')
  const dnaBlocks = blocks.filter(block => block.code === 'DNA1')
  if (dnaBlocks.length !== 1)
    throw new TypeError('Blender file must contain exactly one DNA1 block')
  const sdna = parseSdna(bytes, dnaBlocks[0], header, state, budget)
  for (const block of blocks) {
    if (block.code === 'DNA1' || block.code === 'ENDB' || block.count === 0) continue
    if (block.sdnaIndex < 0 || block.sdnaIndex >= sdna.structs.length) {
      throw new TypeError(`Blender block ${block.code} has an invalid SDNA index`)
    }
    const minimum = sdna.structs[block.sdnaIndex].length * block.count
    if (!Number.isSafeInteger(minimum) || minimum > block.length) {
      throw new TypeError(`Blender block ${block.code} is shorter than its SDNA records`)
    }
  }
  const geometry = decodeLegacyGeometry(bytes, blocks, sdna, header, budget)
  if (geometry !== undefined) charge(state, budget, 0, geometry.decodedBytes)
  return Object.freeze({
    header,
    blocks: Object.freeze(blocks),
    sdna,
    geometry,
    decodedBytes: state.scalarBytes,
  })
}

function detect(prefix) {
  if (prefix.byteLength < 7 || text(prefix, 0, 7) !== 'BLENDER') {
    return { confidence: 0, kind: 'magic', note: 'blender-signature-missing' }
  }
  if (prefix.byteLength < 12)
    return { confidence: 0.9, kind: 'magic', note: 'blender-header-prefix' }
  const pointer = text(prefix, 7, 1)
  const endian = text(prefix, 8, 1)
  const version = text(prefix, 9, 3)
  const valid =
    (pointer === '-' || pointer === '_') &&
    (endian === 'v' || endian === 'V') &&
    /^\d{3}$/u.test(version)
  return valid
    ? {
        confidence: 0.995,
        kind: 'structure',
        note: `blend-${pointer === '-' ? '64' : '32'}-${endian === 'v' ? 'le' : 'be'}-v${version}`,
      }
    : { confidence: 0, kind: 'structure', note: 'blender-header-invalid' }
}

function modelSource(blend) {
  const geometry = blend.geometry
  if (geometry === undefined) {
    return createModelSceneSource({
      info: {
        scenes: 1,
        nodes: 0,
        meshes: 0,
        primitives: 0,
        materials: 0,
        textures: 0,
        animations: 0,
        geometryAccess: 'unavailable',
      },
      nodes: [],
      meshes: [],
    })
  }
  const primitive = {
    id: 'primitive-0',
    topology: 'triangles',
    positions: geometry.positions,
    indices: geometry.indices,
    bounds: geometry.bounds,
  }
  return createModelSceneSource({
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
        name: 'Blender legacy mesh',
        childIds: [],
        meshIds: ['mesh-0'],
        transform: IDENTITY,
      },
    ],
    meshes: [{ id: 'mesh-0', name: 'Blender MVert/MFace mesh', primitiveIds: [primitive.id] }],
    primitives: [primitive],
  })
}

export function createBlendCodec(context) {
  return createInspectionCodec(
    Object.freeze({
      id: ID,
      format: Object.freeze({
        id: 'blend',
        label: 'Blender scene',
        mediaType: 'application/x-blender',
      }),
      async detect(prefix) {
        return detect(prefix)
      },
      async inspect(bytes, inspectionContext) {
        const blend = parseBlend(bytes, inspectionContext.budget)
        const geometry = blend.geometry
        const summary = {
          format: 'blend',
          version: blend.header.version,
          pointerSize: blend.header.pointerSize,
          endianness: blend.header.littleEndian ? 'little' : 'big',
          blocks: blend.blocks.length,
          dataBlocks: blend.blocks.filter(block => block.code !== 'DNA1' && block.code !== 'ENDB')
            .length,
          names: blend.sdna.names.length,
          types: blend.sdna.types.length,
          structs: blend.sdna.structs.length,
          vertices: geometry?.vertices ?? 0,
          faces: geometry?.faces ?? 0,
          triangles: geometry?.triangles ?? 0,
          geometryAccess: geometry === undefined ? 'unavailable' : 'decoded',
          ...(geometry === undefined ? {} : { bounds: geometry.bounds }),
        }
        const tree = createTreeDataSource({
          kind: 'model',
          label: `Blender ${summary.version}`,
          preview: `${summary.blocks} block(s), ${summary.structs} SDNA struct(s), ${summary.triangles} triangle(s)`,
          children: [
            {
              kind: 'section',
              label: 'File blocks',
              preview: `${summary.blocks} block(s)`,
              children: blend.blocks.map(block => ({
                kind: 'block',
                label: block.code.replaceAll('\0', '').trim() || '(anonymous)',
                preview: `${block.length} bytes, ${block.count} record(s)`,
              })),
            },
            {
              kind: 'schema',
              label: 'SDNA',
              preview: `${summary.names} names, ${summary.types} types, ${summary.structs} structs`,
              children: blend.sdna.structs.map(structure => ({
                kind: 'struct',
                label: structure.type,
                preview: `${structure.length} bytes, ${structure.fields.length} field(s)`,
              })),
            },
          ],
        })
        return {
          summary,
          metadata: [
            {
              id: 'blend-scene',
              label: 'Blender scene',
              entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            {
              id: 'model.geometry',
              parameters: {
                vertices: summary.vertices,
                triangles: summary.triangles,
                access: summary.geometryAccess,
              },
            },
            {
              id: 'structure.hierarchy',
              parameters: { blocks: summary.blocks, structs: summary.structs },
            },
            {
              id: 'content.binary',
              parameters: { pointerSize: summary.pointerSize, endianness: summary.endianness },
            },
          ],
          dataSources: {
            'common.view/model-scene-source': modelSource(blend),
            'common.view/tree-data-source': tree,
          },
          maxDecodedBytes: blend.decodedBytes,
          unsupportedFeatures: [
            'modern-customdata-mesh-decoding',
            'multiple-legacy-mesh-association',
            'object-transforms-and-materials',
            'compressed-blend-files',
            'source-editing',
          ],
        }
      },
    }),
    context,
  )
}
