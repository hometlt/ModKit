import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkitx-x3/codec-kit'

const decoder = new TextDecoder('utf-8', { fatal: true })

function looksLikeObj(bytes) {
  try {
    return /(^|\n)\s*(?:v|vn|vt|f|o|g|mtllib|usemtl)\s+/iu.test(decoder.decode(bytes))
  } catch {
    return false
  }
}

function finiteFields(value, count) {
  const fields = value.trim().split(/\s+/u).slice(0, count).map(Number)
  return fields.length === count && fields.every(Number.isFinite) ? fields : undefined
}

function parseIndex(value, count) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed === 0) return -1
  return parsed > 0 ? parsed - 1 : count + parsed
}

function parseObj(text, maxNodes) {
  const positions = []
  const triangleIndices = []
  let normals = 0
  let texcoords = 0
  let faces = 0
  let triangles = 0
  let currentGroup = 'default'
  const groups = new Map([[currentGroup, 0]])
  const materials = new Set()
  const materialLibraries = new Set()
  let statements = 0
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, '').trim()
    if (line === '' || line.startsWith('#')) continue
    statements += 1
    if (statements > maxNodes) throw new RangeError('OBJ statements exceed maxNodes budget')
    const splitAt = line.search(/\s/u)
    const keyword = (splitAt < 0 ? line : line.slice(0, splitAt)).toLowerCase()
    const value = splitAt < 0 ? '' : line.slice(splitAt).trim()
    if (keyword === 'v') {
      const fields = finiteFields(value, 3)
      if (fields === undefined) throw new TypeError('OBJ vertex contains non-finite coordinates')
      positions.push(fields)
    } else if (keyword === 'vn') {
      if (finiteFields(value, 3) === undefined) throw new TypeError('OBJ normal is malformed')
      normals += 1
    } else if (keyword === 'vt') {
      if (finiteFields(value, 2) === undefined)
        throw new TypeError('OBJ texture coordinate is malformed')
      texcoords += 1
    } else if (keyword === 'o' || keyword === 'g') {
      currentGroup = value || `group-${groups.size}`
      if (!groups.has(currentGroup)) groups.set(currentGroup, 0)
    } else if (keyword === 'usemtl') {
      if (value !== '') materials.add(value)
    } else if (keyword === 'mtllib') {
      if (value !== '') materialLibraries.add(value)
    } else if (keyword === 'f') {
      const vertices = value.split(/\s+/u)
      if (vertices.length < 3) throw new TypeError('OBJ face needs at least three vertices')
      const faceIndices = []
      for (const vertex of vertices) {
        const [position] = vertex.split('/')
        const index = parseIndex(position ?? '', positions.length)
        if (index < 0 || index >= positions.length)
          throw new TypeError('OBJ face references an invalid vertex')
        faceIndices.push(index)
      }
      for (let index = 1; index + 1 < faceIndices.length; index += 1) {
        triangleIndices.push(faceIndices[0], faceIndices[index], faceIndices[index + 1])
      }
      faces += 1
      triangles += vertices.length - 2
      groups.set(currentGroup, (groups.get(currentGroup) ?? 0) + 1)
    }
  }
  if (positions.length === 0 || faces === 0)
    throw new TypeError('OBJ geometry has no vertices or faces')
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const position of positions) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], position[axis])
      max[axis] = Math.max(max[axis], position[axis])
    }
  }
  return Object.freeze({
    positions: positions.length,
    normals,
    texcoords,
    faces,
    triangles,
    statements,
    groups: Object.freeze(
      [...groups].map(([name, groupFaces]) => Object.freeze({ name, faces: groupFaces })),
    ),
    materials: Object.freeze([...materials]),
    materialLibraries: Object.freeze([...materialLibraries]),
    bounds: Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) }),
    positionData: new Float32Array(positions.flat()),
    indexData: new Uint32Array(triangleIndices),
  })
}

const definition = Object.freeze({
  id: 'org.modkitx/model-obj',
  format: Object.freeze({ id: 'obj', label: 'Wavefront OBJ', mediaType: 'model/obj' }),
  async detect(bytes) {
    const match = looksLikeObj(bytes)
    return {
      confidence: match ? 0.92 : 0.02,
      kind: 'structure',
      note: match ? 'obj-statements' : 'obj-statements-missing',
    }
  },
  async inspect(bytes, context) {
    const text = decoder.decode(bytes)
    const obj = parseObj(text, context.budget.maxNodes)
    const model = createModelSceneSource({
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: obj.materials.length,
        textures: 0,
        animations: 0,
        bounds: obj.bounds,
        geometryAccess: 'decoded',
      },
      nodes: [
        {
          id: 'root',
          name: 'OBJ root',
          childIds: [],
          meshIds: ['mesh-0'],
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
      ],
      meshes: [{ id: 'mesh-0', name: 'OBJ mesh', primitiveIds: ['primitive-0'] }],
      primitives: [
        {
          id: 'primitive-0',
          topology: 'triangles',
          positions: obj.positionData,
          indices: obj.indexData,
          bounds: obj.bounds,
        },
      ],
    })
    const tree = createTreeDataSource({
      kind: 'model',
      label: 'OBJ',
      preview: `${obj.positions} vertices, ${obj.triangles} triangles`,
      children: [
        ...obj.groups.map(group => ({
          kind: 'group',
          label: group.name,
          preview: `${group.faces} faces`,
        })),
        ...obj.materialLibraries.map(name => ({ kind: 'material-library', label: name })),
      ],
    })
    return {
      summary: {
        format: 'obj',
        vertices: obj.positions,
        normals: obj.normals,
        textureCoordinates: obj.texcoords,
        faces: obj.faces,
        triangles: obj.triangles,
        groups: obj.groups.length,
        materials: obj.materials.length,
        bounds: obj.bounds,
      },
      metadata: [
        {
          id: 'obj-geometry',
          label: 'OBJ geometry',
          entries: [
            { key: 'vertices', value: obj.positions },
            { key: 'normals', value: obj.normals },
            { key: 'textureCoordinates', value: obj.texcoords },
            { key: 'faces', value: obj.faces },
            { key: 'triangles', value: obj.triangles },
            { key: 'groups', value: obj.groups.length },
            { key: 'bounds', value: obj.bounds },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: { vertices: obj.positions, triangles: obj.triangles, bounds: obj.bounds },
        },
        ...(obj.materials.length > 0 || obj.materialLibraries.length > 0
          ? [
              {
                id: 'model.materials',
                parameters: {
                  named: obj.materials.length,
                  libraries: obj.materialLibraries.length,
                },
              },
            ]
          : []),
        { id: 'structure.hierarchy', parameters: { groups: obj.groups.length, lazy: true } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      text: true,
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/model-scene-source': model,
      },
      unsupportedFeatures: obj.materialLibraries.length > 0 ? ['material-library-resolution'] : [],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
