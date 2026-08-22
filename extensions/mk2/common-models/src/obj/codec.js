// Hand-ported from org.modkitx/obj. Polygon faces are triangulated and their independent
// position/texture/normal indices are expanded into a format-neutral decoded primitive.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/obj'
const decoder = new TextDecoder('utf-8', { fatal: true })
const probeDecoder = new TextDecoder('utf-8', { fatal: false })
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

function boundsFromPositions(positions) {
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new TypeError('OBJ positions must contain complete xyz triples')
  }
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis]
      if (!Number.isFinite(value)) throw new TypeError('OBJ position is not finite')
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function geometryByteLength(geometry) {
  return (
    geometry.positions.byteLength +
    geometry.indices.byteLength +
    (geometry.normals?.byteLength ?? 0) +
    (geometry.textureCoordinates?.byteLength ?? 0)
  )
}

function decodedModelSources({ geometry, materials, preview, children }) {
  const primitive = {
    id: 'primitive-0',
    topology: 'triangles',
    positions: geometry.positions,
    indices: geometry.indices,
    ...(geometry.normals === undefined ? {} : { normals: geometry.normals }),
    ...(geometry.textureCoordinates === undefined
      ? {}
      : { textureCoordinates: geometry.textureCoordinates }),
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
        materials,
        textures: 0,
        animations: 0,
        bounds: geometry.bounds,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'root',
          name: 'OBJ root',
          childIds: [],
          meshIds: ['mesh-0'],
          transform: IDENTITY,
        },
      ],
      meshes: [{ id: 'mesh-0', name: 'OBJ mesh', primitiveIds: [primitive.id] }],
      primitives: [primitive],
    }),
    tree: createTreeDataSource({ kind: 'model', label: 'OBJ', preview, children }),
  })
}

function looksLikeObj(bytes) {
  const text = probeDecoder.decode(bytes)
  return (
    /(?:^|\r?\n)\s*v\s+[+-]?(?:\d|\.\d)/u.test(text) &&
    /(?:^|\r?\n)\s*f\s+-?\d+(?:\/[^\s/]*)?(?:\/[^\s/]*)?\s+/u.test(text)
  )
}

function finiteFields(value, minimum, take, label) {
  const fields = value.trim().split(/\s+/u)
  if (fields.length < minimum) throw new TypeError(`OBJ ${label} has too few components`)
  const numbers = fields.slice(0, take).map(Number)
  if (numbers.length !== take || !numbers.every(Number.isFinite)) {
    throw new TypeError(`OBJ ${label} contains a non-finite component`)
  }
  return numbers
}

function resolveIndex(token, count, label) {
  if (!/^-?\d+$/u.test(token ?? '')) throw new TypeError(`OBJ ${label} index is malformed`)
  const parsed = Number(token)
  if (!Number.isSafeInteger(parsed) || parsed === 0)
    throw new TypeError(`OBJ ${label} index is invalid`)
  const index = parsed > 0 ? parsed - 1 : count + parsed
  if (index < 0 || index >= count) throw new TypeError(`OBJ ${label} index is out of range`)
  return index
}

function parseFaceVertex(value, counts) {
  const parts = value.split('/')
  if (parts.length > 3 || parts[0] === '') throw new TypeError('OBJ face vertex is malformed')
  return Object.freeze({
    position: resolveIndex(parts[0], counts.positions, 'position'),
    ...(parts.length >= 2 && parts[1] !== ''
      ? { texture: resolveIndex(parts[1], counts.textures, 'texture') }
      : {}),
    ...(parts.length === 3 && parts[2] !== ''
      ? { normal: resolveIndex(parts[2], counts.normals, 'normal') }
      : {}),
  })
}

function logicalLines(text) {
  const result = []
  let pending = ''
  for (const raw of text.split(/\r?\n|\r/u)) {
    const line = `${pending}${raw}`
    if (/\\\s*$/u.test(line)) pending = `${line.replace(/\\\s*$/u, '')} `
    else {
      result.push(line)
      pending = ''
    }
  }
  if (pending !== '') throw new TypeError('OBJ ends inside a continued statement')
  return result
}

function parseObj(bytes, budget) {
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError('OBJ text exceeds the maxScalarBytes budget')
  }
  const positions = []
  const normals = []
  const textures = []
  const triangles = []
  const groups = new Map([['default', 0]])
  const materials = new Set()
  const materialLibraries = new Set()
  const unsupported = new Set()
  let currentGroup = 'default'
  let statements = 0
  let faces = 0
  for (const raw of logicalLines(decoder.decode(bytes))) {
    const line = raw.replace(/\s+#.*$/u, '').trim()
    if (line === '' || line.startsWith('#')) continue
    statements += 1
    if (statements > budget.maxNodes)
      throw new RangeError('OBJ statements exceed the maxNodes budget')
    const splitAt = line.search(/\s/u)
    const keyword = (splitAt < 0 ? line : line.slice(0, splitAt)).toLowerCase()
    const value = splitAt < 0 ? '' : line.slice(splitAt).trim()
    if (keyword === 'v') positions.push(finiteFields(value, 3, 3, 'vertex'))
    else if (keyword === 'vn') normals.push(finiteFields(value, 3, 3, 'normal'))
    else if (keyword === 'vt') textures.push(finiteFields(value, 2, 2, 'texture coordinate'))
    else if (keyword === 'o' || keyword === 'g') {
      currentGroup = value || `group-${groups.size}`
      if (!groups.has(currentGroup)) groups.set(currentGroup, 0)
    } else if (keyword === 'usemtl') {
      if (value === '') throw new TypeError('OBJ usemtl statement has no material name')
      materials.add(value)
    } else if (keyword === 'mtllib') {
      if (value === '') throw new TypeError('OBJ mtllib statement has no path')
      materialLibraries.add(value)
    } else if (keyword === 'f') {
      const values = value.split(/\s+/u)
      if (values.length < 3) throw new TypeError('OBJ face needs at least three vertices')
      const polygon = values.map(vertex =>
        parseFaceVertex(vertex, {
          positions: positions.length,
          textures: textures.length,
          normals: normals.length,
        }),
      )
      for (let corner = 1; corner + 1 < polygon.length; corner += 1) {
        triangles.push(Object.freeze([polygon[0], polygon[corner], polygon[corner + 1]]))
        if (triangles.length > budget.maxNodes) {
          throw new RangeError('OBJ triangles exceed the maxNodes budget')
        }
      }
      faces += 1
      groups.set(currentGroup, (groups.get(currentGroup) ?? 0) + 1)
    } else if (['p', 'l', 'curv', 'curv2', 'surf'].includes(keyword)) {
      unsupported.add(keyword)
    }
  }
  if (positions.length === 0 || faces === 0 || triangles.length === 0) {
    throw new TypeError('OBJ contains no polygon geometry')
  }
  return Object.freeze({
    positions,
    normals,
    textures,
    triangles,
    faces,
    statements,
    groups: Object.freeze(
      [...groups].map(([name, count]) => Object.freeze({ name, faces: count })),
    ),
    materials: Object.freeze([...materials]),
    materialLibraries: Object.freeze([...materialLibraries]),
    unsupported: Object.freeze([...unsupported]),
  })
}

function buildGeometry(obj, budget) {
  const keys = new Set()
  let allNormals = true
  let allTextures = true
  for (const triangle of obj.triangles) {
    for (const source of triangle) {
      keys.add(`${source.position}/${source.texture ?? ''}/${source.normal ?? ''}`)
      allNormals &&= source.normal !== undefined
      allTextures &&= source.texture !== undefined
    }
  }
  if (keys.size > budget.maxNodes) {
    throw new RangeError('OBJ decoded vertices exceed the maxNodes budget')
  }
  const expectedBytes =
    keys.size * (12 + (allNormals ? 12 : 0) + (allTextures ? 8 : 0)) + obj.triangles.length * 3 * 4
  if (expectedBytes > budget.maxScalarBytes) {
    throw new RangeError('OBJ decoded geometry exceeds the maxScalarBytes budget')
  }
  const positions = []
  const normals = []
  const textureCoordinates = []
  const indices = []
  const decodedVertices = new Map()
  for (const triangle of obj.triangles) {
    for (const source of triangle) {
      const key = `${source.position}/${source.texture ?? ''}/${source.normal ?? ''}`
      let decoded = decodedVertices.get(key)
      if (decoded === undefined) {
        decoded = decodedVertices.size
        decodedVertices.set(key, decoded)
        positions.push(...obj.positions[source.position])
        if (source.normal === undefined) {
          normals.push(0, 0, 1)
        } else normals.push(...obj.normals[source.normal])
        if (source.texture === undefined) {
          textureCoordinates.push(0, 0)
        } else textureCoordinates.push(...obj.textures[source.texture])
      }
      indices.push(decoded)
    }
  }
  const positionData = new Float32Array(positions)
  return Object.freeze({
    topology: 'triangles',
    positions: positionData,
    indices: new Uint32Array(indices),
    ...(allNormals ? { normals: new Float32Array(normals) } : {}),
    ...(allTextures ? { textureCoordinates: new Float32Array(textureCoordinates) } : {}),
    bounds: boundsFromPositions(positionData),
    decodedVertices: decodedVertices.size,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'obj', label: 'Wavefront OBJ', mediaType: 'model/obj' }),
  async detect(prefix) {
    return looksLikeObj(prefix)
      ? { confidence: 0.93, kind: 'structure', note: 'obj-vertex-face-statements' }
      : { confidence: 0, kind: 'structure', note: 'obj-geometry-statements-missing' }
  },
  async inspect(bytes, context) {
    const obj = parseObj(bytes, context.budget)
    const geometry = buildGeometry(obj, context.budget)
    const decodedBytes = geometryByteLength(geometry)
    const sources = decodedModelSources({
      geometry,
      materials: obj.materials.length,
      preview: `${geometry.decodedVertices} vertices, ${obj.triangles.length} triangles`,
      children: [
        ...obj.groups.map(group => ({
          kind: 'group',
          label: group.name,
          preview: `${group.faces} face(s)`,
        })),
        ...obj.materialLibraries.map(path => ({ kind: 'material-library', label: path })),
      ],
    })
    const unsupportedFeatures = [
      ...(obj.materialLibraries.length > 0 ? ['material-library-resolution'] : []),
      ...(obj.materials.length > 1 ? ['material-assignment-segmentation'] : []),
      ...obj.unsupported.map(keyword => `obj-${keyword}-geometry`),
    ]
    return {
      summary: {
        format: 'obj',
        sourceVertices: obj.positions.length,
        decodedVertices: geometry.decodedVertices,
        normals: obj.normals.length,
        textureCoordinates: obj.textures.length,
        faces: obj.faces,
        triangles: obj.triangles.length,
        groups: obj.groups.length,
        materials: obj.materials.length,
        bounds: sources.bounds,
      },
      metadata: [
        {
          id: 'obj-geometry',
          label: 'OBJ geometry',
          entries: [
            { key: 'sourceVertices', value: obj.positions.length },
            { key: 'decodedVertices', value: geometry.decodedVertices },
            { key: 'normals', value: obj.normals.length },
            { key: 'textureCoordinates', value: obj.textures.length },
            { key: 'faces', value: obj.faces },
            { key: 'triangles', value: obj.triangles.length },
            { key: 'groups', value: obj.groups.length },
            { key: 'bounds', value: sources.bounds },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: {
            vertices: geometry.decodedVertices,
            triangles: obj.triangles.length,
            bounds: sources.bounds,
          },
        },
        { id: 'structure.hierarchy', parameters: { groups: obj.groups.length } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
        ...(obj.materials.length > 0
          ? [{ id: 'model.materials', parameters: { count: obj.materials.length } }]
          : []),
      ],
      maxDecodedBytes: decodedBytes,
      dataSources: {
        'common.view/tree-data-source': sources.tree,
        'common.view/model-scene-source': sources.scene,
      },
      unsupportedFeatures,
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
