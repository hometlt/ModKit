import type { JsonObject, ModelMesh, ModelNode, ModelPrimitive } from '@modkit/sdk'
import { readUvmAccessor, type UvmAccessor, type UvmScalarBudget } from '@modkit/uv/model/accessor'
import { composeTrsMatrix } from '@modkit/codec-kit/model-math/sequence-pose'
import { uvmMeshSkins } from './rig.js'
import { array, object, finiteArray, safeIndex, required } from './values.js'

export interface UvmGeometry {
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
  readonly primitives: readonly ModelPrimitive[]
  readonly materials: number
  readonly textures: number
  readonly animations: number
  readonly decodedGeometryBytes: number
}

function floatValues(accessor: UvmAccessor): Float32Array {
  if (!(accessor.values instanceof Float32Array))
    throw new TypeError('UVM vertex values must be float32')
  return accessor.values
}

function identityTransform() {
  return Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

/** A node's matrix, or its TRS both composed and kept, so a re-export writes TRS again. */
function nodeTransform(node: JsonObject): Pick<ModelNode, 'transform' | 'trs'> {
  const hasTrs = ['translation', 'rotation', 'scale'].some(key => node[key] !== undefined)
  if (node['matrix'] !== undefined) {
    if (hasTrs || !finiteArray(node['matrix'], 16))
      throw new TypeError('UVM node matrix must be finite and cannot coexist with TRS')
    return { transform: Object.freeze([...node['matrix']]) }
  }
  if (!hasTrs) return { transform: identityTransform() }
  const translation = node['translation'] === undefined ? [0, 0, 0] : node['translation']
  const rotation = node['rotation'] === undefined ? [0, 0, 0, 1] : node['rotation']
  const scale = node['scale'] === undefined ? [1, 1, 1] : node['scale']
  if (!finiteArray(translation, 3) || !finiteArray(rotation, 4) || !finiteArray(scale, 3))
    throw new TypeError('UVM node TRS must contain finite VEC3/VEC4 values')
  if (Math.abs(Math.hypot(...rotation) - 1) > 0.0001)
    throw new TypeError('UVM node rotation must be a unit quaternion')
  const transform = new Float32Array(16)
  composeTrsMatrix(transform, 0, translation, rotation, scale)
  if (!transform.every(Number.isFinite))
    throw new RangeError('UVM node TRS exceeds the finite transform range')
  return {
    transform: Object.freeze(Array.from(transform)),
    trs: Object.freeze({
      translation: Object.freeze([...translation]) as [number, number, number],
      rotation: Object.freeze([...rotation]) as [number, number, number, number],
      scale: Object.freeze([...scale]) as [number, number, number],
    }),
  }
}

export function decodeUvmGeometry(
  document: JsonObject,
  binary: Uint8Array,
  budget: UvmScalarBudget,
  signal?: AbortSignal,
): UvmGeometry {
  const nodes = array(document, 'nodes')
  const meshes = array(document, 'meshes')
  const materials = array(document, 'materials')
  const textures = array(document, 'textures')
  const animations = array(document, 'animations')
  signal?.throwIfAborted()
  const meshSkins = uvmMeshSkins(document)
  const primitives: ModelPrimitive[] = []
  let decodedGeometryBytes = 0
  const remaining = (): UvmScalarBudget => ({
    maxScalarBytes: budget.maxScalarBytes - decodedGeometryBytes,
  })
  const charge = (bytes: number): void => {
    if (!Number.isSafeInteger(bytes) || bytes > budget.maxScalarBytes - decodedGeometryBytes)
      throw new RangeError('UVM geometry exceeds maxScalarBytes budget')
    decodedGeometryBytes += bytes
  }
  const modelMeshes = meshes.map((candidate, meshIndex) => {
    signal?.throwIfAborted()
    const mesh = object(candidate, `mesh ${meshIndex}`)
    const primitiveIds = array(mesh, 'primitives').map((candidatePrimitive, primitiveIndex) => {
      const primitive = object(candidatePrimitive, `mesh ${meshIndex} primitive ${primitiveIndex}`)
      if ((primitive['mode'] ?? 4) !== 4)
        throw new TypeError('UVM/core currently requires triangles')
      const attributes = object(primitive['attributes'], 'UVM primitive attributes')
      const position = readUvmAccessor(
        document,
        binary,
        attributes['POSITION'],
        remaining(),
        'positions',
        signal,
      )
      const positions = floatValues(position)
      if (position.width !== 3 || position.componentType !== 5126 || position.normalized) {
        throw new TypeError('UVM POSITION must be a float VEC3 accessor')
      }
      if (!positions.every(Number.isFinite))
        throw new TypeError('UVM POSITION contains non-finite values')
      charge(positions.byteLength)
      let indices: Uint32Array
      if (primitive['indices'] === undefined) {
        charge(position.count * 4)
        indices = Uint32Array.from({ length: position.count }, (_unused, index) => index)
      } else {
        const accessor = readUvmAccessor(
          document,
          binary,
          primitive['indices'],
          remaining(),
          'indices',
          signal,
        )
        if (
          accessor.width !== 1 ||
          accessor.normalized ||
          ![5121, 5123, 5125].includes(accessor.componentType)
        )
          throw new TypeError('UVM indices must be unsigned integer SCALAR values')
        indices = accessor.values
        charge(indices.byteLength)
      }
      if (indices.length % 3 !== 0) throw new TypeError('UVM indices must form triangles')
      if (indices.some(index => index >= position.count))
        throw new RangeError('UVM index exceeds POSITION count')
      const vertexAttribute = (semantic: string, width: number): Float32Array | undefined => {
        if (attributes[semantic] === undefined) return undefined
        const attribute = readUvmAccessor(
          document,
          binary,
          attributes[semantic],
          remaining(),
          semantic,
          signal,
        )
        const color = semantic === 'COLOR_0'
        if (attribute.componentType === 5126 && attribute.normalized)
          throw new TypeError(`UVM ${semantic} float accessor cannot use normalized`)
        const normalizedInteger =
          (color || semantic === 'WEIGHTS_0' || semantic.startsWith('TEXCOORD_')) &&
          attribute.normalized &&
          [5121, 5123].includes(attribute.componentType)
        if (
          (attribute.width !== width && !(color && attribute.width === 3)) ||
          attribute.count !== position.count ||
          (attribute.componentType !== 5126 && !normalizedInteger)
        ) {
          throw new TypeError(
            `UVM ${semantic} must be a supported VEC${width} matching POSITION count`,
          )
        }
        if (!attribute.values.every(Number.isFinite))
          throw new TypeError(`UVM ${semantic} contains non-finite values`)
        let values = floatValues(attribute)
        if (normalizedInteger) {
          const divisor = attribute.componentType === 5121 ? 255 : 65535
          for (let index = 0; index < values.length; index += 1)
            values[index] = required(values[index], semantic) / divisor
        }
        if (color && attribute.width === 3) {
          charge(position.count * 16)
          values = new Float32Array(position.count * 4)
          for (let index = 0; index < position.count; index += 1) {
            values.set(attribute.values.subarray(index * 3, index * 3 + 3), index * 4)
            values[index * 4 + 3] = 1
          }
        } else charge(values.byteLength)
        if (color) {
          for (let index = 0; index < values.length; index += 1)
            values[index] = Math.min(1, Math.max(0, required(values[index], semantic)))
        }
        return values
      }
      const normals = vertexAttribute('NORMAL', 3)
      const tangents = vertexAttribute('TANGENT', 4)
      const colors = vertexAttribute('COLOR_0', 4)
      const boneWeights = vertexAttribute('WEIGHTS_0', 4)
      let boneIndices: Uint32Array | undefined
      let hierarchyId: string | undefined
      if (attributes['JOINTS_0'] !== undefined || boneWeights !== undefined) {
        if (attributes['JOINTS_1'] !== undefined || attributes['WEIGHTS_1'] !== undefined)
          throw new TypeError('UVM joint sets beyond four influences need a richer geometry facet')
        const skin = meshSkins.get(meshIndex)
        if (
          skin === undefined ||
          skin === null ||
          boneWeights === undefined ||
          attributes['JOINTS_0'] === undefined
        )
          throw new TypeError('UVM joint indices and weights need a paired mesh skin binding')
        const joints = readUvmAccessor(
          document,
          binary,
          attributes['JOINTS_0'],
          remaining(),
          'joint indices',
          signal,
        )
        const jointCount = array(array(document, 'skins')[skin], 'joints').length
        if (
          joints.width !== 4 ||
          joints.count !== position.count ||
          joints.normalized ||
          ![5121, 5123].includes(joints.componentType) ||
          joints.values.some(value => value >= jointCount)
        )
          throw new TypeError('UVM joint indices must reference valid skin slots')
        charge(joints.values.byteLength)
        boneIndices = Uint32Array.from(joints.values)
        if (boneWeights.some(value => value < 0 || value > 1))
          throw new TypeError('UVM skin weights are outside zero to one')
        for (let offset = 0; offset < boneWeights.length; offset += 4) {
          const sum =
            required(boneWeights[offset], 'skin weight') +
            required(boneWeights[offset + 1], 'skin weight') +
            required(boneWeights[offset + 2], 'skin weight') +
            required(boneWeights[offset + 3], 'skin weight')
          if (Math.abs(sum - 1) > 0.0001) throw new TypeError('UVM skin weights must sum to one')
        }
        hierarchyId = `skin-${skin}`
      }
      const textureCoordinateSets = Object.keys(attributes)
        .filter(semantic => /^TEXCOORD_(?:0|[1-9][0-9]*)$/u.test(semantic))
        .map(semantic => {
          const set = Number(semantic.slice('TEXCOORD_'.length))
          if (!Number.isSafeInteger(set)) throw new TypeError('UVM UV set index is invalid')
          return { set, coordinates: required(vertexAttribute(semantic, 2), semantic) }
        })
        .sort((a, b) => a.set - b.set)
      if (textureCoordinateSets.some((channel, index) => channel.set !== index)) {
        throw new TypeError('UVM UV sets must be consecutive from zero')
      }
      const textureCoordinates = textureCoordinateSets.find(
        channel => channel.set === 0,
      )?.coordinates
      // The common source owns both the legacy UV0 buffer and the set-indexed buffers.
      charge(textureCoordinates?.byteLength ?? 0)
      const id = `mesh-${meshIndex}-primitive-${primitiveIndex}`
      primitives.push({
        id,
        topology: 'triangles',
        positions,
        indices,
        ...(normals === undefined ? {} : { normals }),
        ...(tangents === undefined ? {} : { tangents }),
        ...(colors === undefined ? {} : { colors }),
        ...(boneIndices === undefined
          ? {}
          : {
              boneIndices,
              boneWeights: required(boneWeights, 'skin weights'),
              hierarchyId: required(hierarchyId, 'skin hierarchy'),
            }),
        ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
        ...(textureCoordinateSets.length === 0 ? {} : { textureCoordinateSets }),
        ...(primitive['material'] !== undefined
          ? {
              materialId: `material-${safeIndex(primitive['material'], materials.length, 'primitive material')}`,
            }
          : {}),
      })
      return id
    })
    return {
      id: `mesh-${meshIndex}`,
      ...(typeof mesh['name'] === 'string' ? { name: mesh['name'] } : {}),
      primitiveIds,
    }
  })
  const modelNodes = nodes.map((candidate, nodeIndex) => {
    const node = object(candidate, `node ${nodeIndex}`)
    const childIds = (Array.isArray(node['children']) ? node['children'] : []).map(
      child => `node-${safeIndex(child, nodes.length, `node ${nodeIndex} child`)}`,
    )
    const meshIds =
      node['mesh'] === undefined
        ? []
        : [`mesh-${safeIndex(node['mesh'], meshes.length, 'node mesh')}`]
    return {
      id: `node-${nodeIndex}`,
      ...(typeof node['name'] === 'string' ? { name: node['name'] } : {}),
      childIds,
      meshIds,
      ...nodeTransform(node),
    }
  })
  return Object.freeze({
    nodes: modelNodes,
    meshes: modelMeshes,
    primitives,
    materials: materials.length,
    textures: textures.length,
    animations: animations.length,
    decodedGeometryBytes,
  })
}
