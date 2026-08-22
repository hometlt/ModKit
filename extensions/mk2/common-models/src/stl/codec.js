// Hand-ported from org.modkitx/stl. This reader validates and decodes both STL encodings into
// an owned triangle primitive. STL has no unit, material, hierarchy, or colour contract.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/stl'
const decoder = new TextDecoder('ascii', { fatal: false })
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?'
const FACET = new RegExp(`^facet\\s+normal\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})$`, 'iu')
const VERTEX = new RegExp(`^vertex\\s+(${NUMBER})\\s+(${NUMBER})\\s+(${NUMBER})$`, 'iu')

function boundsFromPositions(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis]
      if (!Number.isFinite(value)) throw new TypeError('STL position is not finite')
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function decodedModelSources(geometry, preview, children) {
  const primitive = {
    id: 'primitive-0',
    topology: 'triangles',
    positions: geometry.positions,
    indices: geometry.indices,
    normals: geometry.normals,
    bounds: geometry.bounds,
  }
  return Object.freeze({
    bounds: geometry.bounds,
    scene: createModelSceneSource({
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
          name: 'STL root',
          childIds: [],
          meshIds: ['mesh-0'],
          transform: IDENTITY,
        },
      ],
      meshes: [{ id: 'mesh-0', name: 'STL mesh', primitiveIds: [primitive.id] }],
      primitives: [primitive],
    }),
    tree: createTreeDataSource({ kind: 'model', label: 'STL', preview, children }),
  })
}

function binaryHeader(bytes) {
  if (bytes.byteLength < 84) return undefined
  const triangles = new DataView(bytes.buffer, bytes.byteOffset + 80, 4).getUint32(0, true)
  const expectedBytes = 84 + triangles * 50
  return Number.isSafeInteger(expectedBytes) ? { triangles, expectedBytes } : undefined
}

function looksAscii(bytes) {
  const text = decoder.decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096))).trimStart()
  return /^solid(?:\s|$)/iu.test(text) && /(?:^|\r?\n)\s*facet\s+normal\s+/iu.test(text)
}

function finiteTriple(match, label) {
  const value = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (!value.every(Number.isFinite)) throw new TypeError(`STL ${label} contains a non-finite value`)
  return value
}

function normalFor(vertices, declared) {
  if (declared.every(Number.isFinite) && Math.hypot(...declared) > 0) return declared
  const [a, b, c] = vertices
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const value = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]
  const length = Math.hypot(...value)
  return length > 0 ? value.map(component => component / length) : [0, 0, 1]
}

function geometryFromTriangles(triangles) {
  const positions = new Float32Array(triangles.length * 9)
  const normals = new Float32Array(triangles.length * 9)
  const indices = new Uint32Array(triangles.length * 3)
  let vertex = 0
  for (const triangle of triangles) {
    const normal = normalFor(triangle.vertices, triangle.normal)
    for (const point of triangle.vertices) {
      positions.set(point, vertex * 3)
      normals.set(normal, vertex * 3)
      indices[vertex] = vertex
      vertex += 1
    }
  }
  return Object.freeze({
    topology: 'triangles',
    positions,
    normals,
    indices,
    bounds: boundsFromPositions(positions),
  })
}

function parseBinary(bytes, budget) {
  const header = binaryHeader(bytes)
  if (header === undefined || header.expectedBytes !== bytes.byteLength) {
    throw new TypeError('binary STL length does not match its triangle count')
  }
  if (header.triangles === 0) throw new TypeError('binary STL contains no triangles')
  if (header.triangles > budget.maxNodes) {
    throw new RangeError('STL triangle count exceeds the maxNodes budget')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangles = []
  for (let index = 0; index < header.triangles; index += 1) {
    const base = 84 + index * 50
    const read = offset => view.getFloat32(base + offset, true)
    const normal = [read(0), read(4), read(8)]
    const vertices = [
      [read(12), read(16), read(20)],
      [read(24), read(28), read(32)],
      [read(36), read(40), read(44)],
    ]
    if (![...normal, ...vertices.flat()].every(Number.isFinite)) {
      throw new TypeError(`binary STL triangle ${index} contains a non-finite float`)
    }
    triangles.push(Object.freeze({ normal, vertices }))
  }
  return Object.freeze({ encoding: 'binary', triangles })
}

function parseAscii(bytes, budget) {
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError('ASCII STL text exceeds the maxScalarBytes budget')
  }
  const lines = decoder.decode(bytes).split(/\r?\n/u)
  const triangles = []
  let sawSolid = false
  let sawEndSolid = false
  let current
  let inLoop = false
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    if (/^solid(?:\s.*)?$/iu.test(line)) {
      if (sawSolid || current !== undefined)
        throw new TypeError('ASCII STL has a misplaced solid line')
      sawSolid = true
      continue
    }
    if (/^endsolid(?:\s.*)?$/iu.test(line)) {
      if (!sawSolid || current !== undefined || inLoop) {
        throw new TypeError('ASCII STL has a misplaced endsolid line')
      }
      sawEndSolid = true
      continue
    }
    const facet = FACET.exec(line)
    if (facet !== null) {
      if (!sawSolid || sawEndSolid || current !== undefined) {
        throw new TypeError('ASCII STL has a misplaced facet')
      }
      current = { normal: finiteTriple(facet, 'normal'), vertices: [] }
      if (triangles.length + 1 > budget.maxNodes) {
        throw new RangeError('STL triangle count exceeds the maxNodes budget')
      }
      continue
    }
    if (/^outer\s+loop$/iu.test(line)) {
      if (current === undefined || inLoop)
        throw new TypeError('ASCII STL has a misplaced outer loop')
      inLoop = true
      continue
    }
    const vertex = VERTEX.exec(line)
    if (vertex !== null) {
      if (current === undefined || !inLoop || current.vertices.length >= 3) {
        throw new TypeError('ASCII STL has a misplaced vertex')
      }
      current.vertices.push(finiteTriple(vertex, 'vertex'))
      continue
    }
    if (/^endloop$/iu.test(line)) {
      if (current === undefined || !inLoop || current.vertices.length !== 3) {
        throw new TypeError('ASCII STL loop does not contain exactly three vertices')
      }
      inLoop = false
      continue
    }
    if (/^endfacet$/iu.test(line)) {
      if (current === undefined || inLoop || current.vertices.length !== 3) {
        throw new TypeError('ASCII STL facet is incomplete')
      }
      triangles.push(Object.freeze(current))
      current = undefined
      continue
    }
    throw new TypeError(`ASCII STL contains an unsupported statement: ${line.slice(0, 40)}`)
  }
  if (!sawSolid || !sawEndSolid || current !== undefined || inLoop || triangles.length === 0) {
    throw new TypeError('ASCII STL solid or facet structure is incomplete')
  }
  return Object.freeze({ encoding: 'ascii', triangles })
}

function parseStl(bytes, budget) {
  const header = binaryHeader(bytes)
  return header !== undefined && header.expectedBytes === bytes.byteLength
    ? parseBinary(bytes, budget)
    : parseAscii(bytes, budget)
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'stl', label: 'STL triangle mesh', mediaType: 'model/stl' }),
  async detect(prefix) {
    const header = binaryHeader(prefix)
    if (header !== undefined && header.triangles > 0) {
      const complete = header.expectedBytes === prefix.byteLength
      const plausiblePrefix = header.expectedBytes > prefix.byteLength && prefix.byteLength >= 4096
      if (complete || plausiblePrefix) {
        return {
          confidence: complete ? 0.99 : 0.86,
          kind: 'structure',
          note: complete ? 'binary-stl-length' : 'binary-stl-header',
        }
      }
    }
    return looksAscii(prefix)
      ? { confidence: 0.94, kind: 'structure', note: 'ascii-stl-facets' }
      : { confidence: 0, kind: 'structure', note: 'stl-structure-missing' }
  },
  async inspect(bytes, context) {
    const stl = parseStl(bytes, context.budget)
    if (stl.triangles.length * 84 > context.budget.maxScalarBytes) {
      throw new RangeError('STL decoded geometry exceeds the maxScalarBytes budget')
    }
    const geometry = geometryFromTriangles(stl.triangles)
    const decodedBytes =
      geometry.positions.byteLength + geometry.normals.byteLength + geometry.indices.byteLength
    const sources = decodedModelSources(
      geometry,
      `${stl.triangles.length} triangle(s), ${stl.encoding}`,
      [
        { kind: 'encoding', label: stl.encoding },
        { kind: 'triangles', label: 'triangles', preview: String(stl.triangles.length) },
      ],
    )
    return {
      summary: {
        format: 'stl',
        encoding: stl.encoding,
        triangles: stl.triangles.length,
        vertices: stl.triangles.length * 3,
        bounds: sources.bounds,
      },
      metadata: [
        {
          id: 'stl-geometry',
          label: 'STL geometry',
          entries: [
            { key: 'encoding', value: stl.encoding },
            { key: 'triangles', value: stl.triangles.length },
            { key: 'vertices', value: stl.triangles.length * 3 },
            { key: 'units', value: 'unspecified' },
            { key: 'bounds', value: sources.bounds },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: { triangles: stl.triangles.length, bounds: sources.bounds },
        },
        { id: 'structure.hierarchy', parameters: { primitives: 1 } },
        { id: 'content.binary', parameters: { encoding: stl.encoding } },
      ],
      maxDecodedBytes: decodedBytes,
      dataSources: {
        'common.view/tree-data-source': sources.tree,
        'common.view/model-scene-source': sources.scene,
      },
      unsupportedFeatures: ['units', 'materials', 'vertex-colours'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
