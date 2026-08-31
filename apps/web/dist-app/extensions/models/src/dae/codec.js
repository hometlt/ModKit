// Hand-ported from modkit/dae. A bounded, entity-safe XML reader decodes COLLADA 1.4/1.5
// sources, vertices, triangles/polylist/polygons, and the selected visual-scene hierarchy.

import {
  createInspectionCodec,
  createModelSceneSource,
  createTreeDataSource,
} from '@modkit/codec-kit'

const ID = 'modkit/dae'
const decoder = new TextDecoder('utf-8', { fatal: true })
const probeDecoder = new TextDecoder('utf-8', { fatal: false })
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

const localName = name => name.slice(name.lastIndexOf(':') + 1)
const children = (node, name) => node.children.filter(child => localName(child.name) === name)
const child = (node, name) => children(node, name)[0]
const textOf = node => node.text.join('').trim()

function entityText(value) {
  return value.replace(/&([^;]+);/gu, (_match, entity) => {
    if (entity === 'amp') return '&'
    if (entity === 'lt') return '<'
    if (entity === 'gt') return '>'
    if (entity === 'quot') return '"'
    if (entity === 'apos') return "'"
    const hex = /^#x([0-9a-f]+)$/iu.exec(entity)
    const decimal = /^#([0-9]+)$/u.exec(entity)
    const code =
      hex === null
        ? decimal === null
          ? undefined
          : Number(decimal[1])
        : Number.parseInt(hex[1], 16)
    if (
      code === undefined ||
      !Number.isSafeInteger(code) ||
      code < 0 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      throw new TypeError(`COLLADA XML entity &${entity}; is unsupported`)
    }
    return String.fromCodePoint(code)
  })
}

function tagEnd(text, start) {
  let quote
  for (let index = start + 1; index < text.length; index += 1) {
    const value = text[index]
    if (quote !== undefined) {
      if (value === quote) quote = undefined
    } else if (value === '"' || value === "'") quote = value
    else if (value === '>') return index
  }
  throw new TypeError('COLLADA XML tag is truncated')
}

function startTag(value) {
  const selfClosing = /\/\s*$/u.test(value)
  const source = (selfClosing ? value.replace(/\/\s*$/u, '') : value).trim()
  const nameMatch = /^([^\s/>]+)/u.exec(source)
  if (nameMatch === null) throw new TypeError('COLLADA XML start tag has no name')
  const name = nameMatch[1]
  const attributes = Object.create(null)
  let offset = nameMatch[0].length
  while (offset < source.length) {
    while (/\s/u.test(source[offset] ?? '')) offset += 1
    if (offset >= source.length) break
    const attributeMatch = /^([^\s=/>]+)/u.exec(source.slice(offset))
    if (attributeMatch === null) throw new TypeError('COLLADA XML attribute name is malformed')
    const attribute = attributeMatch[1]
    offset += attributeMatch[0].length
    while (/\s/u.test(source[offset] ?? '')) offset += 1
    if (source[offset] !== '=')
      throw new TypeError(`COLLADA XML attribute ${attribute} has no value`)
    offset += 1
    while (/\s/u.test(source[offset] ?? '')) offset += 1
    const quote = source[offset]
    if (quote !== '"' && quote !== "'") throw new TypeError('COLLADA XML attribute is unquoted')
    const end = source.indexOf(quote, offset + 1)
    if (end < 0) throw new TypeError('COLLADA XML attribute value is truncated')
    if (attributes[attribute] !== undefined)
      throw new TypeError(`duplicate COLLADA attribute ${attribute}`)
    attributes[attribute] = entityText(source.slice(offset + 1, end))
    offset = end + 1
  }
  return { name, attributes, selfClosing }
}

function parseXml(text, budget) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) {
    throw new TypeError('COLLADA DTD and entity declarations are not allowed')
  }
  const roots = []
  const stack = []
  let elements = 0
  let offset = 0
  while (offset < text.length) {
    const open = text.indexOf('<', offset)
    if (open < 0) {
      const trailing = entityText(text.slice(offset))
      if (stack.length === 0 && trailing.trim() !== '')
        throw new TypeError('text follows COLLADA root')
      if (stack.length > 0) stack.at(-1).text.push(trailing)
      break
    }
    const plain = entityText(text.slice(offset, open))
    if (stack.length === 0 && plain.trim() !== '') throw new TypeError('text precedes COLLADA root')
    if (stack.length > 0) stack.at(-1).text.push(plain)
    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4)
      if (end < 0) throw new TypeError('COLLADA XML comment is truncated')
      offset = end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9)
      if (end < 0) throw new TypeError('COLLADA XML CDATA is truncated')
      if (stack.length === 0) throw new TypeError('COLLADA XML CDATA is outside the root')
      stack.at(-1).text.push(text.slice(open + 9, end))
      offset = end + 3
      continue
    }
    if (text.startsWith('<?', open)) {
      const end = text.indexOf('?>', open + 2)
      if (end < 0) throw new TypeError('COLLADA processing instruction is truncated')
      offset = end + 2
      continue
    }
    if (text.startsWith('<!', open)) throw new TypeError('COLLADA XML declaration is unsupported')
    const end = tagEnd(text, open)
    const inside = text.slice(open + 1, end)
    if (/^\s*\//u.test(inside)) {
      const name = inside.replace(/^\s*\//u, '').trim()
      const current = stack.pop()
      if (current === undefined || current.name !== name) {
        throw new TypeError(`COLLADA XML closing tag ${name} is mismatched`)
      }
    } else {
      const parsed = startTag(inside)
      const node = { name: parsed.name, attributes: parsed.attributes, children: [], text: [] }
      elements += 1
      if (elements > budget.maxNodes) throw new RangeError('COLLADA XML exceeds maxNodes budget')
      if (stack.length + 1 > budget.maxDepth)
        throw new RangeError('COLLADA XML exceeds maxDepth budget')
      if (stack.length === 0) roots.push(node)
      else stack.at(-1).children.push(node)
      if (!parsed.selfClosing) stack.push(node)
    }
    offset = end + 1
  }
  if (stack.length > 0) throw new TypeError('COLLADA XML has unclosed tags')
  if (roots.length !== 1) throw new TypeError('COLLADA XML must contain exactly one root')
  return Object.freeze({ root: roots[0], elements })
}

function count(value, label, minimum = 0) {
  if (!/^(?:0|[1-9]\d*)$/u.test(value ?? '')) throw new TypeError(`${label} is not a count`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new RangeError(`${label} is invalid`)
  return parsed
}

function numbers(node, label) {
  const text = textOf(node)
  if (text === '') return []
  const result = text.split(/\s+/u).map(Number)
  if (!result.every(Number.isFinite)) throw new TypeError(`${label} contains a non-finite number`)
  return result
}

function integers(node, label) {
  const text = textOf(node)
  if (text === '') return []
  const tokens = text.split(/\s+/u)
  if (!tokens.every(token => /^(?:0|[1-9]\d*)$/u.test(token))) {
    throw new TypeError(`${label} contains an invalid index`)
  }
  return tokens.map(Number)
}

function reference(value, label) {
  if (typeof value !== 'string' || !value.startsWith('#') || value.length === 1) {
    throw new TypeError(`${label} must be a local #id reference`)
  }
  return value.slice(1)
}

function parseSources(mesh) {
  const result = new Map()
  for (const source of children(mesh, 'source')) {
    const id = source.attributes.id
    if (typeof id !== 'string' || id === '' || result.has(id))
      throw new TypeError('COLLADA source id is invalid')
    const floatArrays = new Map(
      children(source, 'float_array').map(arrayNode => [arrayNode.attributes.id, arrayNode]),
    )
    const accessor = child(child(source, 'technique_common') ?? { children: [] }, 'accessor')
    if (accessor === undefined) throw new TypeError(`COLLADA source ${id} has no accessor`)
    const arrayId = reference(accessor.attributes.source, `source ${id} accessor`)
    const arrayNode = floatArrays.get(arrayId)
    if (arrayNode === undefined)
      throw new TypeError(`COLLADA source ${id} accessor array is missing`)
    const values = numbers(arrayNode, `source ${id} float_array`)
    const declaredValues = count(arrayNode.attributes.count, `source ${id} float_array count`)
    if (values.length !== declaredValues)
      throw new TypeError(`COLLADA source ${id} float count differs`)
    const accessorCount = count(accessor.attributes.count, `source ${id} accessor count`)
    const stride =
      accessor.attributes.stride === undefined
        ? 1
        : count(accessor.attributes.stride, `source ${id} stride`, 1)
    const offset =
      accessor.attributes.offset === undefined
        ? 0
        : count(accessor.attributes.offset, `source ${id} offset`)
    if (offset + accessorCount * stride > values.length) {
      throw new RangeError(`COLLADA source ${id} accessor exceeds its float array`)
    }
    result.set(id, Object.freeze({ id, values, count: accessorCount, stride, offset }))
  }
  return result
}

function parseVertices(mesh) {
  const result = new Map()
  for (const vertices of children(mesh, 'vertices')) {
    const id = vertices.attributes.id
    if (typeof id !== 'string' || id === '' || result.has(id))
      throw new TypeError('COLLADA vertices id is invalid')
    const semantics = new Map()
    for (const input of children(vertices, 'input')) {
      const semantic = input.attributes.semantic
      if (typeof semantic !== 'string')
        throw new TypeError('COLLADA vertices input has no semantic')
      semantics.set(semantic, reference(input.attributes.source, `vertices ${id} input`))
    }
    result.set(id, semantics)
  }
  return result
}

function parseInputs(primitive, vertices) {
  const inputs = []
  for (const input of children(primitive, 'input')) {
    const semantic = input.attributes.semantic
    const offset =
      input.attributes.offset === undefined
        ? 0
        : count(input.attributes.offset, 'primitive input offset')
    const sourceId = reference(input.attributes.source, 'primitive input')
    if (semantic === 'VERTEX') {
      const values = vertices.get(sourceId)
      const position = values?.get('POSITION')
      if (position === undefined) throw new TypeError('COLLADA VERTEX input has no POSITION source')
      inputs.push({ semantic: 'POSITION', sourceId: position, offset, set: 0 })
    } else if (semantic === 'POSITION' || semantic === 'NORMAL' || semantic === 'TEXCOORD') {
      const set =
        input.attributes.set === undefined ? 0 : count(input.attributes.set, 'primitive input set')
      inputs.push({ semantic, sourceId, offset, set })
    }
  }
  if (!inputs.some(input => input.semantic === 'POSITION')) {
    throw new TypeError('COLLADA primitive has no POSITION input')
  }
  return inputs
}

function sourceValues(sources, id, index, width, label) {
  const source = sources.get(id)
  if (source === undefined) throw new TypeError(`COLLADA ${label} source ${id} is missing`)
  if (!Number.isSafeInteger(index) || index < 0 || index >= source.count || source.stride < width) {
    throw new RangeError(`COLLADA ${label} index ${String(index)} exceeds source ${id}`)
  }
  const start = source.offset + index * source.stride
  return source.values.slice(start, start + width)
}

function facesFor(primitive, stride) {
  const kind = localName(primitive.name)
  const declared = count(primitive.attributes.count, `COLLADA ${kind} count`)
  if (kind === 'triangles') {
    const values = children(primitive, 'p').flatMap(node =>
      integers(node, 'COLLADA triangles indices'),
    )
    if (values.length !== declared * 3 * stride)
      throw new TypeError('COLLADA triangles index count differs')
    return Array.from({ length: declared }, (_unused, face) =>
      Array.from({ length: 3 }, (_corner, corner) =>
        values.slice((face * 3 + corner) * stride, (face * 3 + corner + 1) * stride),
      ),
    )
  }
  if (kind === 'polylist') {
    const vcount = integers(child(primitive, 'vcount') ?? { text: [] }, 'COLLADA polylist vcount')
    if (vcount.length !== declared || vcount.some(value => value < 3)) {
      throw new TypeError('COLLADA polylist vcount is invalid')
    }
    const values = integers(child(primitive, 'p') ?? { text: [] }, 'COLLADA polylist indices')
    if (values.length !== vcount.reduce((sum, value) => sum + value, 0) * stride) {
      throw new TypeError('COLLADA polylist index count differs')
    }
    const faces = []
    let offset = 0
    for (const corners of vcount) {
      faces.push(
        Array.from({ length: corners }, () => {
          const tuple = values.slice(offset, offset + stride)
          offset += stride
          return tuple
        }),
      )
    }
    return faces
  }
  const polygons = children(primitive, 'p')
  if (polygons.length !== declared || children(primitive, 'ph').length > 0) {
    throw new TypeError('COLLADA polygons count or hole topology is unsupported')
  }
  return polygons.map(node => {
    const values = integers(node, 'COLLADA polygon indices')
    if (values.length < 3 * stride || values.length % stride !== 0) {
      throw new TypeError('COLLADA polygon index count is invalid')
    }
    return Array.from({ length: values.length / stride }, (_unused, corner) =>
      values.slice(corner * stride, (corner + 1) * stride),
    )
  })
}

function decodePrimitive(primitive, sources, vertices, budget, scalarState, id) {
  const inputs = parseInputs(primitive, vertices)
  const stride = Math.max(...inputs.map(input => input.offset)) + 1
  const faces = facesFor(primitive, stride)
  if (faces.length === 0) throw new TypeError('COLLADA primitive contains no polygon faces')
  const positionInput = inputs.find(input => input.semantic === 'POSITION')
  const normalInput = inputs.find(input => input.semantic === 'NORMAL')
  const textureInput = inputs.find(input => input.semantic === 'TEXCOORD' && input.set === 0)
  const positions = []
  const normals = []
  const textures = []
  const indices = []
  const decoded = new Map()
  let triangles = 0
  for (const face of faces) {
    triangles += face.length - 2
    if (triangles > budget.maxNodes)
      throw new RangeError('COLLADA triangles exceed maxNodes budget')
    for (let corner = 1; corner + 1 < face.length; corner += 1) {
      for (const tuple of [face[0], face[corner], face[corner + 1]]) {
        const key = `${tuple[positionInput.offset]}/${normalInput === undefined ? '' : tuple[normalInput.offset]}/${textureInput === undefined ? '' : tuple[textureInput.offset]}`
        let index = decoded.get(key)
        if (index === undefined) {
          index = decoded.size
          if (index + 1 > budget.maxNodes)
            throw new RangeError('COLLADA vertices exceed maxNodes budget')
          decoded.set(key, index)
          positions.push(
            ...sourceValues(
              sources,
              positionInput.sourceId,
              tuple[positionInput.offset],
              3,
              'POSITION',
            ),
          )
          if (normalInput !== undefined) {
            normals.push(
              ...sourceValues(
                sources,
                normalInput.sourceId,
                tuple[normalInput.offset],
                3,
                'NORMAL',
              ),
            )
          }
          if (textureInput !== undefined) {
            textures.push(
              ...sourceValues(
                sources,
                textureInput.sourceId,
                tuple[textureInput.offset],
                2,
                'TEXCOORD',
              ),
            )
          }
        }
        indices.push(index)
      }
    }
  }
  const decodedBytes =
    positions.length * 4 + normals.length * 4 + textures.length * 4 + indices.length * 4
  scalarState.bytes += decodedBytes
  if (scalarState.bytes > budget.maxScalarBytes) {
    throw new RangeError('COLLADA decoded geometry exceeds maxScalarBytes budget')
  }
  const positionData = new Float32Array(positions)
  return Object.freeze({
    id,
    topology: 'triangles',
    positions: positionData,
    indices: new Uint32Array(indices),
    ...(normalInput === undefined ? {} : { normals: new Float32Array(normals) }),
    ...(textureInput === undefined ? {} : { textureCoordinates: new Float32Array(textures) }),
    bounds: boundsForPositions(positionData),
    triangles,
  })
}

function boundsForPositions(positions) {
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

function unionBounds(primitives) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const primitive of primitives) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], primitive.bounds.min[axis])
      max[axis] = Math.max(max[axis], primitive.bounds.max[axis])
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) })
}

function decodeGeometry(root, budget) {
  const scalarState = { bytes: 0 }
  const primitives = []
  const meshes = []
  const geometryById = new Map()
  const library = child(root, 'library_geometries')
  for (const [geometryIndex, geometry] of children(
    library ?? { children: [] },
    'geometry',
  ).entries()) {
    const geometryId = geometry.attributes.id
    if (typeof geometryId !== 'string' || geometryId === '' || geometryById.has(geometryId)) {
      throw new TypeError('COLLADA geometry id is invalid')
    }
    const mesh = child(geometry, 'mesh')
    if (mesh === undefined) continue
    const sources = parseSources(mesh)
    const vertices = parseVertices(mesh)
    const primitiveIds = []
    const supported = mesh.children.filter(node =>
      ['triangles', 'polylist', 'polygons'].includes(localName(node.name)),
    )
    for (const [primitiveIndex, primitive] of supported.entries()) {
      const id = `geometry-${geometryIndex}-primitive-${primitiveIndex}`
      const decoded = decodePrimitive(primitive, sources, vertices, budget, scalarState, id)
      primitives.push(decoded)
      primitiveIds.push(id)
    }
    if (primitiveIds.length > 0) {
      const modelId = `geometry-${geometryIndex}`
      meshes.push({
        id: modelId,
        name: geometry.attributes.name ?? geometryId,
        primitiveIds,
      })
      geometryById.set(geometryId, modelId)
    }
  }
  if (primitives.length === 0) throw new TypeError('COLLADA contains no supported polygon geometry')
  return Object.freeze({
    meshes,
    primitives,
    geometryById,
    decodedBytes: scalarState.bytes,
    bounds: unionBounds(primitives),
  })
}

function multiply(left, right) {
  const result = new Array(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner]
      }
    }
  }
  return result
}

function nodeTransform(node) {
  let transform = [...IDENTITY]
  for (const operation of node.children) {
    const kind = localName(operation.name)
    let matrix
    const values = numbers(operation, `COLLADA node ${kind}`)
    if (kind === 'matrix') {
      if (values.length !== 16) throw new TypeError('COLLADA node matrix needs 16 values')
      matrix = values
    } else if (kind === 'translate') {
      if (values.length !== 3) throw new TypeError('COLLADA translate needs 3 values')
      matrix = [...IDENTITY]
      matrix[12] = values[0]
      matrix[13] = values[1]
      matrix[14] = values[2]
    } else if (kind === 'scale') {
      if (values.length !== 3) throw new TypeError('COLLADA scale needs 3 values')
      matrix = [...IDENTITY]
      matrix[0] = values[0]
      matrix[5] = values[1]
      matrix[10] = values[2]
    } else if (kind === 'rotate') {
      if (values.length !== 4) throw new TypeError('COLLADA rotate needs axis and angle')
      const length = Math.hypot(values[0], values[1], values[2])
      if (length === 0) throw new TypeError('COLLADA rotate axis is zero')
      const [x, y, z] = values.slice(0, 3).map(value => value / length)
      const angle = (values[3] * Math.PI) / 180
      const c = Math.cos(angle)
      const s = Math.sin(angle)
      const t = 1 - c
      matrix = [
        t * x * x + c,
        t * x * y + s * z,
        t * x * z - s * y,
        0,
        t * x * y - s * z,
        t * y * y + c,
        t * y * z + s * x,
        0,
        t * x * z + s * y,
        t * y * z - s * x,
        t * z * z + c,
        0,
        0,
        0,
        0,
        1,
      ]
    } else continue
    transform = multiply(transform, matrix)
  }
  return Object.freeze(transform)
}

function decodeNodes(root, geometry) {
  const libraries = children(
    child(root, 'library_visual_scenes') ?? { children: [] },
    'visual_scene',
  )
  const selectedRef = child(child(root, 'scene') ?? { children: [] }, 'instance_visual_scene')
    ?.attributes.url
  const selectedId =
    selectedRef === undefined ? undefined : reference(selectedRef, 'instance_visual_scene')
  const selected =
    selectedId === undefined
      ? libraries[0]
      : libraries.find(scene => scene.attributes.id === selectedId)
  if (selectedId !== undefined && selected === undefined)
    throw new TypeError('COLLADA visual scene reference is missing')
  if (selected === undefined) {
    return geometry.meshes.map((mesh, index) => ({
      id: `node-${index}`,
      name: mesh.name,
      childIds: [],
      meshIds: [mesh.id],
      transform: IDENTITY,
    }))
  }
  const nodes = []
  const walk = node => {
    const id = `node-${nodes.length}`
    const result = {
      id,
      name: node.attributes.name ?? node.attributes.id ?? id,
      childIds: [],
      meshIds: children(node, 'instance_geometry').map(instance => {
        const source = reference(instance.attributes.url, 'instance_geometry')
        const mesh = geometry.geometryById.get(source)
        if (mesh === undefined)
          throw new TypeError(`COLLADA instance_geometry ${source} is unsupported`)
        return mesh
      }),
      transform: nodeTransform(node),
    }
    nodes.push(result)
    for (const nested of children(node, 'node')) result.childIds.push(walk(nested))
    return id
  }
  for (const node of children(selected, 'node')) walk(node)
  return nodes.length === 0
    ? geometry.meshes.map((mesh, index) => ({
        id: `node-${index}`,
        name: mesh.name,
        childIds: [],
        meshIds: [mesh.id],
        transform: IDENTITY,
      }))
    : nodes
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'dae',
    label: 'COLLADA DAE model',
    mediaType: 'model/vnd.collada+xml',
  }),
  async detect(prefix) {
    const text = probeDecoder
      .decode(prefix)
      .replace(/^\uFEFF/u, '')
      .trimStart()
    return /<(?:[A-Za-z_][\w.-]*:)?COLLADA(?:\s|\/|>)/iu.test(text)
      ? { confidence: 0.95, kind: 'structure', note: 'collada-root' }
      : { confidence: 0, kind: 'structure', note: 'collada-root-missing' }
  },
  async inspect(bytes, context) {
    if (bytes.byteLength > context.budget.maxScalarBytes) {
      throw new RangeError('COLLADA XML exceeds maxScalarBytes budget')
    }
    const xml = parseXml(decoder.decode(bytes).replace(/^\uFEFF/u, ''), context.budget)
    const root = xml.root
    if (localName(root.name) !== 'COLLADA') throw new TypeError('COLLADA root element is missing')
    const version = root.attributes.version
    if (typeof version !== 'string' || !/^1\.(?:4(?:\.\d+)?|5(?:\.\d+)?)$/u.test(version)) {
      throw new TypeError(`COLLADA version ${String(version)} is unsupported`)
    }
    const geometry = decodeGeometry(root, context.budget)
    const nodes = decodeNodes(root, geometry)
    const materials = children(child(root, 'library_materials') ?? { children: [] }, 'material')
    const images = children(child(root, 'library_images') ?? { children: [] }, 'image')
    const animations = children(child(root, 'library_animations') ?? { children: [] }, 'animation')
    const upAxis =
      textOf(child(child(root, 'asset') ?? { children: [] }, 'up_axis') ?? { text: [] }) || 'Y_UP'
    const model = createModelSceneSource({
      info: {
        scenes: 1,
        nodes: nodes.length,
        meshes: geometry.meshes.length,
        primitives: geometry.primitives.length,
        materials: materials.length,
        textures: images.length,
        animations: animations.length,
        bounds: geometry.bounds,
        geometryAccess: 'decoded',
      },
      nodes,
      meshes: geometry.meshes,
      primitives: geometry.primitives,
    })
    const triangles = geometry.primitives.reduce(
      (total, primitive) => total + primitive.triangles,
      0,
    )
    const tree = createTreeDataSource({
      kind: 'model',
      label: 'COLLADA',
      preview: `${geometry.meshes.length} meshes, ${triangles} triangles`,
      children: [
        {
          kind: 'collection',
          label: 'Visual scene nodes',
          preview: String(nodes.length),
          children: nodes.map(node => ({ kind: 'node', label: node.name ?? node.id })),
        },
        {
          kind: 'collection',
          label: 'Geometries',
          preview: String(geometry.meshes.length),
          children: geometry.meshes.map(mesh => ({ kind: 'mesh', label: mesh.name ?? mesh.id })),
        },
      ],
    })
    return {
      summary: {
        format: 'dae',
        version,
        upAxis,
        nodes: nodes.length,
        meshes: geometry.meshes.length,
        primitives: geometry.primitives.length,
        triangles,
        materials: materials.length,
        images: images.length,
        animations: animations.length,
        bounds: geometry.bounds,
      },
      metadata: [
        {
          id: 'collada-document',
          label: 'COLLADA document',
          entries: [
            { key: 'version', value: version },
            { key: 'upAxis', value: upAxis },
            { key: 'xmlElements', value: xml.elements },
            { key: 'nodes', value: nodes.length },
            { key: 'meshes', value: geometry.meshes.length },
            { key: 'primitives', value: geometry.primitives.length },
            { key: 'triangles', value: triangles },
            { key: 'bounds', value: geometry.bounds },
          ],
        },
      ],
      traits: [
        {
          id: 'model.geometry',
          parameters: {
            primitives: geometry.primitives.length,
            triangles,
            bounds: geometry.bounds,
          },
        },
        ...(materials.length > 0
          ? [{ id: 'model.materials', parameters: { count: materials.length } }]
          : []),
        ...(images.length > 0
          ? [{ id: 'model.textures', parameters: { count: images.length } }]
          : []),
        ...(animations.length > 0
          ? [{ id: 'model.animations', parameters: { count: animations.length } }]
          : []),
        { id: 'scene.objects', parameters: { nodes: nodes.length } },
        { id: 'structure.hierarchy', parameters: { xmlElements: xml.elements } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      maxDecodedBytes: geometry.decodedBytes,
      dataSources: {
        'common.view/model-scene-source': model,
        'common.view/tree-data-source': tree,
      },
      unsupportedFeatures: [
        'line-topology',
        'polygon-holes',
        'controllers-and-skins',
        'external-texture-resolution',
        'animation-playback',
        'lookat-and-skew-transforms',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
