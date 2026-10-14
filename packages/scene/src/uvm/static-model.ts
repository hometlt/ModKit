// Intended for packages/scene/src/uvm. Generic static UVM -> RenderModel JSON projection.
import type { JsonObject, JsonValue } from '@modkit/sdk'
import type { UvmContainer } from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { readUvmAccessor } from '@modkit/uv/model/accessor'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { createRenderMaterialSampler } from '../materials/index.js'
import { readUvmModel } from './model.js'
import { readUvmFacets } from './facets.js'
import { array, object } from './values.js'
import {
  IDENTITY_MATERIAL_FRAME,
  multiplyMaterialFrames,
  invertMaterialFrame,
} from '../materials/frame.js'

export interface StaticModelBudget {
  readonly maxScalarBytes: number
  readonly maxNodes: number
}
function keys(value: JsonObject, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new TypeError(`${label}.${key} cannot be represented by the static model projection`)
}
function empty(value: JsonValue | undefined, label: string): void {
  if (value !== undefined && (!Array.isArray(value) || value.length !== 0))
    throw new TypeError(`${label} is outside static authoring`)
}
function at(values: readonly number[], index: number): number {
  const value = values[index]
  if (value === undefined || !Number.isFinite(value))
    throw new TypeError('nonfinite static transform')
  return value
}
function vector(
  values: Float32Array,
  width: number,
  matrix: readonly number[],
  direction: boolean,
): number[] {
  const result: number[] = []
  for (let offset = 0; offset < values.length; offset += width) {
    const x = values[offset] ?? 0,
      y = values[offset + 1] ?? 0,
      z = values[offset + 2] ?? 0
    if (direction && Math.abs(Math.hypot(x, y, z) - 1) > 0.0001)
      throw new TypeError('static directions must be unit vectors')
    if (width === 4 && values[offset + 3] !== 1 && values[offset + 3] !== -1)
      throw new TypeError('static tangent handedness must be +1 or -1')
    const components = [0, 1, 2].map(
      row =>
        at(matrix, row) * x +
        at(matrix, row + 4) * y +
        at(matrix, row + 8) * z +
        (direction ? 0 : at(matrix, row + 12)),
    )
    const length = direction ? Math.hypot(...components) : 1
    if (!(length > 0)) throw new TypeError('static direction is zero')
    result.push(
      ...components.map(value => {
        const encoded = Math.fround(value / length)
        if (!Number.isFinite(encoded)) throw new RangeError('static transform exceeds float32')
        return encoded
      }),
    )
    if (width === 4) result.push(values[offset + 3] ?? 1)
  }
  return result
}

/** Transform owned triangle geometry without changing UVs, colors, influences or material identity.
 * Normals use inverse transpose; mirrored frames reverse winding and tangent handedness. */
export function transformUvmPrimitiveGeometry(
  primitive: { readonly positions: Float32Array; readonly indices: ArrayLike<number>; readonly normals?: Float32Array; readonly tangents?: Float32Array },
  matrix: readonly number[],
) {
  const {positions,indices,normals,tangents}=primitive,vertices=positions.length/3
  if(matrix.length!==16||!matrix.every(Number.isFinite)||[3,7,11].some(i=>matrix[i]!==0)||matrix[15]!==1)
    throw new TypeError('geometry transform requires a finite affine matrix')
  if(!positions.length||positions.length%3||indices.length%3||normals&&normals.length!==positions.length||tangents&&tangents.length!==vertices*4)
    throw new TypeError('geometry transform vector counts differ')
  const ownedIndices=Array.from(indices)
  if(ownedIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=vertices))throw new RangeError('geometry transform index is outside primitive')
  const inverse=invertMaterialFrame(matrix),normal=Array.from({length:16},(_,i)=>inverse[(i%4)*4+Math.floor(i/4)]!)
  const determinant=at(matrix,0)*(at(matrix,5)*at(matrix,10)-at(matrix,9)*at(matrix,6))-
    at(matrix,4)*(at(matrix,1)*at(matrix,10)-at(matrix,9)*at(matrix,2))+
    at(matrix,8)*(at(matrix,1)*at(matrix,6)-at(matrix,5)*at(matrix,2))
  if(determinant<0)for(let i=0;i<ownedIndices.length;i+=3)[ownedIndices[i+1],ownedIndices[i+2]]=[ownedIndices[i+2]!,ownedIndices[i+1]!]
  const result={positions:vector(positions,3,matrix,false),indices:ownedIndices,
    ...(normals?{normals:vector(normals,3,normal,true)}:{}),
    ...(tangents?{tangents:vector(tangents,4,matrix,true)}:{})}
  if(determinant<0&&result.tangents)for(let i=3;i<result.tangents.length;i+=4)result.tangents[i]=-result.tangents[i]!
  return result
}

/** Explicit anonymous static scene correspondence. Node transforms/instances become owned draw
 * geometry; labels, rigs, clips and unsupported extensions refuse instead of disappearing. */
export function projectUvmStaticModel(
  container: UvmContainer,
  budget: StaticModelBudget,
  signal?: AbortSignal,
) {
  const document = container.document
  validateUvmDocument(document, {
    binaryByteLength: container.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  keys(
    document,
    [
      'asset',
      'scene',
      'scenes',
      'nodes',
      'meshes',
      'materials',
      'accessors',
      'bufferViews',
      'buffers',
      'extensions',
      'extensionsUsed',
      'extensionsRequired',
      'skins',
      'animations',
      'textures',
      'images',
      'samplers',
      // glTF extras are explicitly application metadata. A target-format exporter may
      // ignore opaque foreign metadata while projecting the portable scene itself.
      'extras',
    ],
    'document',
  )
  // Texture/image/sampler arrays are the ordinary glTF fallback for generic viewers. Native
  // exporters consume the authoritative UV_game_material resource ids, so validated fallback
  // declarations may coexist without becoming native state or being silently interpreted.
  for (const key of ['skins', 'animations'])
    empty(document[key], key)
  const extensions = object(document['extensions'] ?? {}, 'extensions')
  keys(
    extensions,
    ['UV_asset', 'UV_provenance', 'UV_units', 'UV_game_animation_clips'],
    'extensions',
  )
  for (const key of ['extensionsUsed', 'extensionsRequired'])
    for (const name of array(document, key))
      if (![
        'UV_asset',
        'UV_provenance',
        'UV_units',
        'UV_game_material',
        'UV_game_animation_clips',
        // a clip's events ride on its animation (П18), which the rig path writes
        'UV_game_animation_events',
        // the glTF fallback's look, as doubleSided is: the program states what the target writes
        'KHR_materials_unlit',
      ].includes(String(name)))
        throw new TypeError(`unsupported static extension ${String(name)}`)
  const scenes = array(document, 'scenes'),
    nodes = array(document, 'nodes'),
    meshes = array(document, 'meshes')
  if (scenes.length !== 1 || (document['scene'] ?? 0) !== 0)
    throw new TypeError('static authoring requires one scene')
  keys(object(scenes[0], 'scene'), ['nodes'], 'scene')
  for (const raw of nodes)
    keys(
      object(raw, 'node'),
      ['name', 'children', 'mesh', 'matrix', 'translation', 'rotation', 'scale'],
      'node',
    )
  let preflightBytes = 0
  for (const raw of meshes) {
    const mesh = object(raw, 'mesh')
    keys(mesh, ['name', 'primitives'], 'mesh')
    for (const value of array(mesh, 'primitives')) {
      const primitive = object(value, 'primitive')
      keys(primitive, ['attributes', 'indices', 'material', 'mode'], 'primitive')
      keys(
        object(primitive['attributes'], 'attributes'),
        [
          'POSITION',
          'NORMAL',
          'TANGENT',
          'COLOR_0',
          'TEXCOORD_0',
          'TEXCOORD_1',
          'TEXCOORD_2',
          'TEXCOORD_3',
        ],
        'attributes',
      )
      const attributes = object(primitive['attributes'], 'attributes')
      if (attributes['COLOR_0'] !== undefined) {
        const color = readUvmAccessor(
          document,
          container.binary,
          attributes['COLOR_0'],
          { maxScalarBytes: budget.maxScalarBytes - preflightBytes },
          'static colors',
          signal,
        )
        preflightBytes += color.values.byteLength
        // The shared reader normalizes then expands RGB integer colors from the original
        // integer buffer. Refuse that currently lossy path until its general fix lands.
        if (color.componentType !== 5126 && color.width === 3)
          throw new TypeError(
            'normalized RGB integer colors need the common reader normalization fix',
          )
        const maximum =
          color.componentType === 5126 ? 1 : color.componentType === 5121 ? 255 : 65535
        if (color.values.some(value => !Number.isFinite(value) || value < 0 || value > maximum))
          throw new TypeError('static colors must be within their declared unit range')
      }
    }
  }
  const parsed = readUvmModel(document, container.binary, budget, signal)
  if (
    parsed.rig.bindings.length ||
    parsed.rig.incompleteBindings ||
    parsed.rig.clips.some(clip => clip.channels.length > 0)
  ) throw new TypeError('static authoring cannot drop rig or transform clip data')
  parsed.rig.clips.forEach((clip, index) => {
    if (clip.sequenceIndex !== undefined && clip.sequenceIndex !== index)
      throw new TypeError('static material clips require dense ordered sequence indices')
  })
  const facets = readUvmFacets(document, container.binary, budget, signal)
  const materialRequirements = array(document, 'materials').map((raw, index): JsonObject => {
    const material = object(raw, 'material')
    // UV_game_material is the authoritative portable render program. The glTF PBR
    // fallback — its texture slots, coverage and culling included — and Modkit authoring extras
    // may coexist for generic viewers/editors; the program states what the target writes.
    keys(
      material,
      [
        'name',
        'pbrMetallicRoughness',
        'normalTexture',
        'occlusionTexture',
        'emissiveTexture',
        'emissiveFactor',
        'alphaMode',
        'alphaCutoff',
        'doubleSided',
        'extras',
        'extensions',
      ],
      'material',
    )
    keys(
      object(material['extensions'], 'material extensions'),
      ['UV_game_material', 'KHR_materials_unlit'],
      'material extensions',
    )
    const ref = facets.materialRefs[index],
      params = ref?.shader?.parameters
    if (ref?.shader?.id !== 'modkit.render-material.v1' || params === undefined)
      throw new TypeError('static authoring requires an explicit common RenderMaterial program')
    keys(params, ['renderModel'], 'material parameters')
    const render = object(params['renderModel'], 'renderModel')
    if (render['version'] !== 1 || render['composite'] !== undefined)
      throw new TypeError('static authoring requires a standard RenderMaterial v1')
    const fields = { ...render }
    delete fields['version']
    const sampled = createRenderMaterialSampler(
      params,
      { maxDepth: 96, maxNodes: budget.maxNodes, maxBytes: budget.maxScalarBytes },
      signal,
    ).sample({ time: 0 }, signal)
    // Distortion has no color pass, but its validated program is still authored data.
    const colorlessStandard =
      sampled.length === 0 &&
      render['presentation'] === 'screen-distortion' &&
      render['standard'] !== undefined
    if (sampled.length !== 1 && !colorlessStandard)
      throw new TypeError('static authoring requires one material pass')
    // Every authored material field remains a requirement for the native encoder's read-back check.
    return snapshotJson(
      { name: material['name'] ?? `Material_${index}`, ...fields },
      { maxDepth: 96, maxNodes: budget.maxNodes, maxBytes: budget.maxScalarBytes },
      signal,
    ) as JsonObject
  })
  if (materialRequirements.length === 0)
    throw new TypeError('static authoring requires explicit materials')
  const byNode = new Map(parsed.scene.nodes.map(node => [node.id, node]))
  const byMesh = new Map(parsed.scene.meshes.map(mesh => [mesh.id, mesh]))
  const byPrimitive = new Map(parsed.scene.primitives.map(primitive => [primitive.id, primitive]))
  const visited = new Set<string>(),
    usedMeshes = new Set<string>(),
    output: JsonObject[] = []
  let bytes = parsed.scene.decodedGeometryBytes,
    work = 0
  const visit = (id: string, parent: readonly number[], depth = 0) => {
    signal?.throwIfAborted()
    if (++work > budget.maxNodes || depth > 96 || visited.has(id))
      throw new TypeError('static scene repeats nodes or exceeds budget')
    visited.add(id)
    const node = byNode.get(id)
    if (!node) throw new TypeError('static node absent')
    const matrix = multiplyMaterialFrames(parent, node.transform)
    // Validate helper nodes too: a singular ancestor is invalid even without a draw.
    invertMaterialFrame(matrix)
    for (const meshId of node.meshIds) {
      const mesh = byMesh.get(meshId)
      if (!mesh) throw new TypeError('static mesh absent')
      usedMeshes.add(meshId)
      for (const primitiveId of mesh.primitiveIds) {
        const primitive = byPrimitive.get(primitiveId)
        if (!primitive?.indices || !primitive.materialId)
          throw new TypeError('static primitive lacks indices/material')
        const materialIndex = facets.materialRefs.findIndex(
          material => material.id === primitive.materialId,
        )
        if (materialIndex < 0) throw new TypeError('static primitive material absent')
        const geometry = transformUvmPrimitiveGeometry({
          positions: primitive.positions, indices: primitive.indices,
          ...(primitive.normals ? { normals: primitive.normals } : {}),
          ...(primitive.tangents ? { tangents: primitive.tangents } : {}),
        }, matrix)
        const record: Record<string, JsonValue> = {
          name: node.name ?? mesh.name ?? `Primitive_${output.length}`,
          primitiveTopology: 'triangles',
          materialIndex,
          positions: geometry.positions,
          indices: geometry.indices,
        }
        if (geometry.normals) record['normals'] = geometry.normals
        if (geometry.tangents) record['tangents'] = geometry.tangents
        if (primitive.colors) record['colors'] = [...primitive.colors]
        for (const set of primitive.textureCoordinateSets ?? [])
          record[set.set === 0 ? 'uvs' : `uvs${set.set}`] = [...set.coordinates]
        bytes += Object.values(record).reduce<number>(
          (sum, value) => sum + (Array.isArray(value) ? value.length * 8 : 0),
          0,
        )
        if (bytes > budget.maxScalarBytes || output.length >= budget.maxNodes)
          throw new RangeError('static model exceeds budget')
        output.push(record)
      }
    }
    for (const child of node.childIds) visit(child, matrix, depth + 1)
  }
  for (const root of array(object(scenes[0], 'scene'), 'nodes'))
    visit(`node-${String(root)}`, IDENTITY_MATERIAL_FRAME)
  if (visited.size !== nodes.length || usedMeshes.size !== meshes.length || output.length === 0)
    throw new TypeError('static authoring refuses unused/unreachable scene content')
  return {
    model: {
      meshes: output,
      materials: materialRequirements.map(material => ({ layers: [], ...material })),
      skeleton: { bones: [] },
      animations: parsed.rig.clips.map(clip => ({
        name: clip.name,
        durationSeconds: clip.durationSeconds ?? 0,
        looping: clip.looping ?? false,
        nodeTracks: [],
      })),
      effects: { particles: [], ribbons: [] },
      bounds: null,
      metadata: { coordinateSystem: 'Y_UP' },
    } satisfies JsonObject,
    materialRequirements,
  }
}
