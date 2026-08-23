import { readFile } from 'node:fs/promises'
import { DOMParser } from '@xmldom/xmldom'
import { M3SectionList } from './native/binary/sections.js'
import { M3StructureDescription } from './native/binary/structures.js'
import { installM3PlatformAdapters } from './native/platform.js'
import { buildVertexObject } from './native/utils/vertex.js'

installM3PlatformAdapters({ DOMParser })

let structuresXml

async function schemaText() {
  structuresXml ??= await readFile(new URL('./native/structures.xml', import.meta.url), 'utf8')
  return structuresXml
}

function arrayBufferOf(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function boundsOf(primitives) {
  if (primitives.length === 0) return undefined
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const primitive of primitives) {
    for (let offset = 0; offset < primitive.positions.length; offset += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = primitive.positions[offset + axis]
        min[axis] = Math.min(min[axis], value)
        max[axis] = Math.max(max[axis], value)
      }
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function regionIndices(
  faceIndices,
  firstFaceIndex,
  faceCount,
  firstVertexIndex,
  regionVersion,
  vertexCount,
) {
  const values = []
  const faceEnd = firstFaceIndex + faceCount
  for (let index = firstFaceIndex; index < faceEnd && index + 2 < faceIndices.length; index += 3) {
    const origin = regionVersion <= 2 ? firstVertexIndex : 0
    const a = (faceIndices[index] ?? 0) - origin
    const b = (faceIndices[index + 1] ?? 0) - origin
    const c = (faceIndices[index + 2] ?? 0) - origin
    if ([a, b, c].some(value => value < 0 || value >= vertexCount)) {
      throw new RangeError('M3 region face references a vertex outside the region')
    }
    values.push(a, b, c)
  }
  return new Uint32Array(values)
}

function decodeSections(sections, budget) {
  const model = sections.model
  if (model === null) throw new TypeError('M3 model section is missing')
  const vertexFlags = Number(model.vertex_flags ?? 0)
  const vertexSection = sections.getSectionByReference(model.vertices)
  const divisionSection = sections.getSectionByReference(model.divisions)
  if (vertexSection?.rawBytes === null || vertexSection === null || divisionSection === null) {
    return Object.freeze({ nodes: [], meshes: [], primitives: [], decodedBytes: 0 })
  }
  const vertexDescription = M3StructureDescription.getVertexDescription(
    vertexFlags,
    sections.structureHistories,
  )
  const vertexCount = Math.floor(vertexSection.rawBytes.byteLength / vertexDescription.size)
  if (vertexCount > budget.maxNodes) throw new RangeError('M3 vertices exceed maxNodes budget')
  const vertices = vertexDescription.instances(vertexSection.rawBytes, vertexCount)
  const meshes = []
  const primitives = []
  let decodedBytes = 0

  for (const [divisionIndex, division] of divisionSection.content.entries()) {
    const faceSection = sections.getSectionByReference(division.faces)
    const regionSection = sections.getSectionByReference(division.regions)
    if (faceSection === null || regionSection === null) continue
    const faces = faceSection.content
    for (const [regionIndex, region] of regionSection.content.entries()) {
      const firstVertexIndex = Number(region.first_vertex_index ?? 0)
      const count = Number(region.vertex_count ?? 0)
      const firstFaceIndex = Number(region.first_face_index ?? 0)
      const faceCount = Number(region.face_count ?? 0)
      const uvMultiply = Number(region.uv_multiply ?? 16)
      const uvOffset = Number(region.uv_offset ?? 0)
      if (
        !Number.isSafeInteger(firstVertexIndex) ||
        !Number.isSafeInteger(count) ||
        firstVertexIndex < 0 ||
        count < 0 ||
        firstVertexIndex + count > vertices.length
      ) {
        throw new RangeError('M3 region vertex range is invalid')
      }
      const positions = new Float32Array(count * 3)
      const normals = new Float32Array(count * 3)
      const textureCoordinates = new Float32Array(count * 2)
      let normalCount = 0
      for (let index = 0; index < count; index += 1) {
        const vertex = buildVertexObject(vertices[firstVertexIndex + index], uvMultiply, uvOffset)
        positions.set(vertex.position, index * 3)
        if (vertex.normal !== undefined) {
          normals.set(vertex.normal, index * 3)
          normalCount += 1
        }
        textureCoordinates.set(vertex.uv0 ?? vertex.fuv0 ?? [0, 0], index * 2)
      }
      const indices = regionIndices(
        faces,
        firstFaceIndex,
        faceCount,
        firstVertexIndex,
        Number(region.desc?.version ?? 0),
        count,
      )
      decodedBytes += positions.byteLength + indices.byteLength + textureCoordinates.byteLength
      if (normalCount > 0) decodedBytes += normals.byteLength
      if (decodedBytes > budget.maxScalarBytes) {
        throw new RangeError('M3 decoded geometry exceeds maxScalarBytes budget')
      }
      const primitiveId = `division-${divisionIndex}-region-${regionIndex}`
      primitives.push({
        id: primitiveId,
        topology: 'triangles',
        positions,
        indices,
        ...(normalCount > 0 ? { normals } : {}),
        textureCoordinates,
      })
      meshes.push({
        id: primitiveId,
        name: `M3 region ${regionIndex}`,
        primitiveIds: [primitiveId],
      })
    }
  }
  const bounds = boundsOf(primitives)
  return Object.freeze({
    nodes:
      meshes.length === 0
        ? []
        : [
            {
              id: 'model',
              name: 'M3 model',
              childIds: [],
              meshIds: meshes.map(mesh => mesh.id),
              transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            },
          ],
    meshes,
    primitives,
    decodedBytes,
    ...(bounds === undefined ? {} : { bounds }),
  })
}

export async function decodeM3Geometry(bytes, budget) {
  const sections = await M3SectionList.load(arrayBufferOf(bytes), await schemaText())
  return decodeSections(sections, budget)
}
