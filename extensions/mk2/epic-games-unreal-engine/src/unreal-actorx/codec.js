// ActorX PSK/PSKX is a sequence of 32-byte chunk headers followed by fixed-size records.
// The layout and coordinate/winding rules are cross-checked against UE Viewer's exporter and
// ActorX importer, which are the primary open implementations used for the fixture below:
// https://github.com/gildor2/UEViewer/blob/master/Exporters/ExportPsk.cpp
// https://github.com/gildor2/UEViewer/blob/master/Tools/MaxActorXImport/ActorXImporter.ms

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/unreal-actorx'
const HEADER_BYTES = 32
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const RECORD_SIZES = Object.freeze({
  PNTS0000: 12,
  VTXW0000: 16,
  FACE0000: 12,
  FACE3200: 18,
  MATT0000: 88,
  REFSKELT: 120,
  RAWWEIGHTS: 12,
})

function fixedAscii(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength)
    throw new RangeError(`ActorX ${label} is truncated`)
  const raw = bytes.subarray(offset, offset + length)
  const zero = raw.indexOf(0)
  const value = String.fromCharCode(...raw.subarray(0, zero < 0 ? raw.length : zero))
  if (!/^[\x20-\x7e]*$/u.test(value)) throw new TypeError(`ActorX ${label} is not ASCII`)
  return value
}

function finiteFloat(view, offset, label) {
  const value = view.getFloat32(offset, true)
  if (!Number.isFinite(value)) throw new TypeError(`ActorX ${label} is not finite`)
  return value
}

function parseSections(bytes, budget) {
  if (budget.maxDepth < 3) throw new RangeError('ActorX structure exceeds maxDepth budget')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sections = []
  let nodes = 0
  let offset = 0
  while (offset < bytes.byteLength) {
    if (offset + HEADER_BYTES > bytes.byteLength)
      throw new RangeError('ActorX chunk header is truncated')
    const name = fixedAscii(bytes, offset, 20, 'chunk name')
    const typeFlags = view.getInt32(offset + 20, true)
    const recordSize = view.getInt32(offset + 24, true)
    const count = view.getInt32(offset + 28, true)
    if (name.length === 0 || recordSize < 0 || count < 0)
      throw new TypeError('ActorX chunk header is invalid')
    const byteLength = recordSize * count
    const dataOffset = offset + HEADER_BYTES
    if (!Number.isSafeInteger(byteLength) || byteLength > bytes.byteLength - dataOffset)
      throw new RangeError(`ActorX ${name} records are truncated`)
    nodes += 1 + count
    if (nodes > budget.maxNodes) throw new RangeError('ActorX records exceed maxNodes budget')
    sections.push(
      Object.freeze({
        name,
        typeFlags,
        recordSize,
        count,
        dataOffset,
        end: dataOffset + byteLength,
      }),
    )
    offset = dataOffset + byteLength
  }
  const header = sections[0]?.name
  if (header !== 'ACTRHEAD' && header !== 'ANIMHEAD')
    throw new TypeError('ActorX ACTRHEAD/ANIMHEAD chunk is missing')
  if (sections[0].recordSize !== 0 || sections[0].count !== 0)
    throw new TypeError(`ActorX ${header} chunk must not contain records`)
  return Object.freeze(sections)
}

function sectionsNamed(sections, name) {
  return sections.filter(section => section.name === name)
}

function requireSection(sections, name) {
  const matches = sectionsNamed(sections, name)
  if (matches.length !== 1) throw new TypeError(`ActorX requires exactly one ${name} chunk`)
  const section = matches[0]
  const expected = RECORD_SIZES[name]
  if (expected !== undefined && section.recordSize !== expected)
    throw new TypeError(`ActorX ${name} record size must be ${expected}`)
  return section
}

function records(section, read) {
  return Object.freeze(
    Array.from({ length: section.count }, (_, index) =>
      Object.freeze(read(section.dataOffset + index * section.recordSize, index)),
    ),
  )
}

function parsePsk(bytes, sections, budget) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const points = records(requireSection(sections, 'PNTS0000'), offset => [
    finiteFloat(view, offset, 'point x'),
    finiteFloat(view, offset + 4, 'point y'),
    finiteFloat(view, offset + 8, 'point z'),
  ])
  const wedges = records(requireSection(sections, 'VTXW0000'), offset => {
    let pointIndex = view.getUint32(offset, true)
    if (points.length <= 65_536) pointIndex &= 0xffff
    if (pointIndex >= points.length) throw new TypeError('ActorX wedge references a missing point')
    return {
      pointIndex,
      u: finiteFloat(view, offset + 4, 'wedge u'),
      v: finiteFloat(view, offset + 8, 'wedge v'),
      materialIndex: bytes[offset + 12],
    }
  })
  const faces = []
  for (const section of sections.filter(
    candidate => candidate.name === 'FACE0000' || candidate.name === 'FACE3200',
  )) {
    const expected = RECORD_SIZES[section.name]
    if (section.recordSize !== expected)
      throw new TypeError(`ActorX ${section.name} record size must be ${expected}`)
    faces.push(
      ...records(section, offset => ({
        wedges:
          section.name === 'FACE3200'
            ? [
                view.getUint32(offset, true),
                view.getUint32(offset + 4, true),
                view.getUint32(offset + 8, true),
              ]
            : [
                view.getUint16(offset, true),
                view.getUint16(offset + 2, true),
                view.getUint16(offset + 4, true),
              ],
        materialIndex: bytes[offset + (section.name === 'FACE3200' ? 12 : 6)],
        smoothingGroups: view.getUint32(offset + (section.name === 'FACE3200' ? 14 : 8), true),
      })),
    )
  }
  if (faces.length === 0) throw new TypeError('ActorX PSK has no face chunk')
  if (faces.some(face => face.wedges.some(index => index >= wedges.length)))
    throw new TypeError('ActorX face references a missing wedge')

  const materials = sectionsNamed(sections, 'MATT0000').flatMap(section => {
    if (section.recordSize !== RECORD_SIZES.MATT0000)
      throw new TypeError('ActorX MATT0000 record size must be 88')
    return records(section, offset => ({
      name: fixedAscii(bytes, offset, 64, 'material name'),
      textureIndex: view.getInt32(offset + 64, true),
      polyFlags: view.getInt32(offset + 68, true),
    }))
  })
  const bones = sectionsNamed(sections, 'REFSKELT').flatMap(section => {
    if (section.recordSize !== RECORD_SIZES.REFSKELT)
      throw new TypeError('ActorX REFSKELT record size must be 120')
    return records(section, (offset, index) => {
      const parentIndex = view.getInt32(offset + 72, true)
      if (
        index === 0
          ? parentIndex !== -1 && parentIndex !== 0
          : parentIndex < 0 || parentIndex >= index
      )
        throw new TypeError(`ActorX bone ${index} has invalid parent ${parentIndex}`)
      return { name: fixedAscii(bytes, offset, 64, 'bone name'), parentIndex }
    })
  })
  const weights = sectionsNamed(sections, 'RAWWEIGHTS').flatMap(section => {
    if (section.recordSize !== RECORD_SIZES.RAWWEIGHTS)
      throw new TypeError('ActorX RAWWEIGHTS record size must be 12')
    return records(section, offset => {
      const weight = finiteFloat(view, offset, 'skin weight')
      const pointIndex = view.getInt32(offset + 4, true)
      const boneIndex = view.getInt32(offset + 8, true)
      if (weight < 0 || weight > 1 || pointIndex < 0 || pointIndex >= points.length)
        throw new TypeError('ActorX skin weight is invalid')
      if (boneIndex < 0 || boneIndex >= bones.length)
        throw new TypeError('ActorX skin weight references a missing bone')
      return { weight, pointIndex, boneIndex }
    })
  })

  const positions = new Float32Array(faces.length * 9)
  const textureCoordinates = new Float32Array(faces.length * 6)
  const normals = new Float32Array(faces.length * 9)
  const indices = new Uint32Array(faces.length * 3)
  let vertex = 0
  for (const face of faces) {
    const triangleStart = vertex
    for (const wedgeIndex of face.wedges) {
      const wedge = wedges[wedgeIndex]
      const point = points[wedge.pointIndex]
      positions.set(point, vertex * 3)
      textureCoordinates.set([wedge.u, wedge.v], vertex * 2)
      indices[vertex] = vertex
      vertex += 1
    }
    const base = triangleStart * 3
    const ax = positions[base + 3] - positions[base]
    const ay = positions[base + 4] - positions[base + 1]
    const az = positions[base + 5] - positions[base + 2]
    const bx = positions[base + 6] - positions[base]
    const by = positions[base + 7] - positions[base + 1]
    const bz = positions[base + 8] - positions[base + 2]
    const nx = ay * bz - az * by
    const ny = az * bx - ax * bz
    const nz = ax * by - ay * bx
    const length = Math.hypot(nx, ny, nz)
    if (!(length > 0)) throw new TypeError('ActorX face is degenerate')
    for (let corner = 0; corner < 3; corner += 1)
      normals.set([nx / length, ny / length, nz / length], (triangleStart + corner) * 3)
  }
  const decodedBytes =
    positions.byteLength + textureCoordinates.byteLength + normals.byteLength + indices.byteLength
  if (decodedBytes > budget.maxScalarBytes)
    throw new RangeError('ActorX decoded geometry exceeds maxScalarBytes budget')
  return Object.freeze({
    points,
    wedges,
    faces,
    materials,
    bones,
    weights,
    positions,
    textureCoordinates,
    normals,
    indices,
    decodedBytes,
  })
}

function parsePsa(bytes, sections, budget) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bones = requireSection(sections, 'BONENAMES')
  if (bones.recordSize !== 120) throw new TypeError('ActorX BONENAMES record size must be 120')
  const sequences = requireSection(sections, 'ANIMINFO')
  if (sequences.recordSize !== 168) throw new TypeError('ActorX ANIMINFO record size must be 168')
  const keys = requireSection(sections, 'ANIMKEYS')
  if (keys.recordSize !== 32) throw new TypeError('ActorX ANIMKEYS record size must be 32')
  if (keys.count * keys.recordSize > budget.maxScalarBytes)
    throw new RangeError('ActorX animation keys exceed maxScalarBytes budget')
  return Object.freeze({
    bones: records(bones, offset => ({
      name: fixedAscii(bytes, offset, 64, 'animation bone name'),
    })),
    sequences: records(sequences, offset => ({
      name: fixedAscii(bytes, offset, 64, 'sequence name'),
      groups: fixedAscii(bytes, offset + 64, 64, 'sequence group'),
      totalBones: view.getInt32(offset + 128, true),
      firstRawFrame: view.getInt32(offset + 160, true),
      rawFrames: view.getInt32(offset + 164, true),
    })),
    keyCount: keys.count,
  })
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3)
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[offset + axis])
      max[axis] = Math.max(max[axis], positions[offset + axis])
    }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function pskSources(model) {
  const bounds = boundsOf(model.positions)
  const primitive = Object.freeze({
    id: 'primitive-0',
    topology: 'triangles',
    positions: model.positions,
    indices: model.indices,
    normals: model.normals,
    textureCoordinates: model.textureCoordinates,
    bounds,
  })
  return Object.freeze({
    bounds,
    scene: createModelSceneSource({
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: model.materials.length,
        textures: 0,
        animations: 0,
        bounds,
        geometryAccess: 'decoded',
      },
      nodes: [
        { id: 'root', name: 'ActorX root', childIds: [], meshIds: ['mesh-0'], transform: IDENTITY },
      ],
      meshes: [{ id: 'mesh-0', name: 'ActorX mesh', primitiveIds: [primitive.id] }],
      primitives: [primitive],
    }),
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'unreal-actorx', label: 'Unreal ActorX' }),
  async detect(prefix) {
    const header = prefix.byteLength >= 8 ? fixedAscii(prefix, 0, 8, 'probe header') : ''
    return header === 'ACTRHEAD' || header === 'ANIMHEAD'
      ? { confidence: 0.99, kind: 'magic', note: header }
      : { confidence: 0, kind: 'magic', note: 'ActorX header missing' }
  },
  async inspect(bytes, context) {
    const sections = parseSections(bytes, context.budget)
    const kind = sections[0].name === 'ACTRHEAD' ? 'psk' : 'psa'
    const parsed =
      kind === 'psk'
        ? parsePsk(bytes, sections, context.budget)
        : parsePsa(bytes, sections, context.budget)
    const tree = createTreeDataSource({
      kind: 'model',
      label: `ActorX ${kind.toUpperCase()}`,
      preview: `${sections.length} chunks`,
      children: sections.map(section => ({
        kind: 'chunk',
        label: section.name,
        preview: `${section.count} × ${section.recordSize} bytes`,
      })),
    })
    if (kind === 'psa') {
      return {
        summary: {
          format: 'unreal-actorx',
          kind,
          chunks: sections.length,
          bones: parsed.bones.length,
          sequences: parsed.sequences.length,
          keys: parsed.keyCount,
        },
        metadata: [
          {
            id: 'actorx-animation',
            label: 'ActorX animation',
            entries: [
              { key: 'bones', value: parsed.bones.length },
              { key: 'sequences', value: parsed.sequences.length },
              { key: 'keys', value: parsed.keyCount },
            ],
          },
        ],
        traits: [
          {
            id: 'model.animation',
            parameters: { sequences: parsed.sequences.length, bones: parsed.bones.length },
          },
          { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
        ],
        dataSources: { 'common.view/tree-data-source': tree },
        maxDecodedBytes: BigInt(parsed.keyCount * 32),
        unsupportedFeatures: [
          'psa-scene-attachment',
          'actorx-sidecar-resolution',
          'actorx-writing',
        ],
      }
    }
    const sources = pskSources(parsed)
    return {
      summary: {
        format: 'unreal-actorx',
        kind,
        chunks: sections.length,
        points: parsed.points.length,
        wedges: parsed.wedges.length,
        faces: parsed.faces.length,
        materials: parsed.materials.length,
        bones: parsed.bones.length,
        weights: parsed.weights.length,
        bounds: sources.bounds,
      },
      metadata: [
        {
          id: 'actorx-mesh',
          label: 'ActorX mesh',
          entries: [
            { key: 'points', value: parsed.points.length },
            { key: 'wedges', value: parsed.wedges.length },
            { key: 'faces', value: parsed.faces.length },
            { key: 'materials', value: parsed.materials.length },
            { key: 'bones', value: parsed.bones.length },
            { key: 'weights', value: parsed.weights.length },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: {
            vertices: parsed.positions.length / 3,
            triangles: parsed.faces.length,
            bounds: sources.bounds,
          },
        },
        { id: 'model.materials', parameters: { count: parsed.materials.length } },
        {
          id: 'model.skeleton',
          parameters: { bones: parsed.bones.length, weights: parsed.weights.length },
        },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/model-scene-source': sources.scene,
      },
      maxDecodedBytes: BigInt(parsed.decodedBytes),
      unsupportedFeatures: [
        'actorx-sidecar-resolution',
        'actorx-animation-attachment',
        'actorx-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
