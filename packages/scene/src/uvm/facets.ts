import type {
  JsonObject,
  JsonValue,
  ModelCollisionVolume,
  ModelMaterialRef,
  ModelMaterialLayerRef,
  ModelSocketRef,
  ModelSocketOrientation,
} from '@modkit/sdk'
import type { UvmScalarBudget } from '@modkit/uv/model/accessor'
import { readCollisionMesh } from './collision-mesh.js'
import { array, field, finiteArray, object, nonBlank, string, safeIndex } from './values.js'
import { uvmImageResourceId } from './images.js'

function axis(value: unknown): ModelSocketOrientation['forward'] {
  if (
    value === '+x' ||
    value === '-x' ||
    value === '+y' ||
    value === '-y' ||
    value === '+z' ||
    value === '-z'
  )
    return value
  throw new TypeError('invalid UVM socket axis')
}

/** Project supported metadata facets from a validated document. Unknown metadata stays in the document.
 * No texture lookup, native interpretation or effect simulation is performed here.
 */
export function readUvmFacets(
  document: JsonObject,
  binary: Uint8Array,
  budget: UvmScalarBudget,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError('invalid UVM scalar budget')
  return Object.freeze({
    collisions: decodeCollisions(document, binary, budget, signal),
    teamColors: decodeTeamColors(document),
    advancedMaterials: decodeAdvancedMaterials(document),
    effects: decodeEffects(document),
    sockets: decodeSockets(document),
    materialRefs: decodeMaterialRefs(document),
  })
}

function decodeSockets(document: JsonObject): readonly ModelSocketRef[] {
  const sockets: ModelSocketRef[] = []
  for (const [nodeIndex, candidate] of array(document, 'nodes').entries()) {
    const node = object(candidate, `node ${nodeIndex}`)
    const extension = field(node['extensions'], 'UV_game_socket')
    if (extension === undefined) continue
    const socket = object(extension, `node ${nodeIndex} UV_game_socket`)
    const identity = field(socket['extras'], 'modkit')
    sockets.push({
      id: nonBlank(field(identity, 'id'))
        ? string(field(identity, 'id'), 'socket id')
        : `uvm-socket-${nodeIndex}`,
      // Publisher ids remain in extras. The live target must join the actual reopened scene,
      // whose node ids are positional; restoring an old native id would orphan the socket.
      nodeId: `node-${nodeIndex}`,
      role: string(socket['role'], 'socket role'),
      ...(typeof socket['sourceName'] === 'string' ? { sourceName: socket['sourceName'] } : {}),
      ...(socket['forward'] === undefined || socket['up'] === undefined
        ? {}
        : { orientation: { forward: axis(socket['forward']), up: axis(socket['up']) } }),
    })
  }
  return Object.freeze(sockets)
}

function decodeCollisions(
  document: JsonObject,
  binary: Uint8Array,
  budget: UvmScalarBudget,
  signal?: AbortSignal,
) {
  const byKind: Record<string, number> = Object.create(null)
  const volumes: ModelCollisionVolume[] = []
  let total = 0
  let scalarBytes = 0
  for (const [nodeIndex, nodeCandidate] of array(document, 'nodes').entries()) {
    const node = object(nodeCandidate, `node ${nodeIndex}`)
    const extension = field(node['extensions'], 'UV_game_collision')
    if (extension === undefined) continue
    for (const [shapeIndex, shapeCandidate] of array(
      object(extension, 'UV_game_collision'),
      'shapes',
    ).entries()) {
      const shape = object(shapeCandidate, `node ${nodeIndex} collision shape ${shapeIndex}`)
      if (shape['kind'] === 'convex-hull' || shape['kind'] === 'mesh') {
        const mesh = readCollisionMesh(
          document,
          binary,
          shape,
          { maxScalarBytes: budget.maxScalarBytes - scalarBytes },
          signal,
        )
        scalarBytes += mesh.scalarBytes
      }
      total += 1
      const kind = string(shape['kind'], 'collision kind')
      byKind[kind] = (byKind[kind] ?? 0) + 1
      const meshId = collisionNodeMesh(node)
      const role = extensionRole(extension)
      /*
       * The per-volume records `common.view/model-collision-source@1` publishes. UVM is the
       * `declared-volume` publisher of that contract: a `UV_game_collision` shape is a volume the
       * document declares, not a render mesh wearing a collision bit. The role travels as a
       * publisher-qualified type, and stays absent when the document does not state one.
       */
      volumes.push(
        Object.freeze({
          id: `node-${nodeIndex}-collision-${shapeIndex}`,
          kind,
          origin: 'declared-volume',
          ...(meshId === undefined ? {} : { meshId }),
          ...(role !== undefined ? { types: Object.freeze([role]) } : {}),
        }),
      )
    }
  }
  return Object.freeze({ total, byKind: Object.freeze(byKind), volumes: Object.freeze(volumes) })
}

/** The mesh a collision node also draws, when it draws one; a volume-only node has none. */
function collisionNodeMesh(node: JsonObject): string | undefined {
  return typeof node['mesh'] === 'number' ? `mesh-${node['mesh']}` : undefined
}

function extensionRole(extension: unknown): string | undefined {
  const role = object(extension, 'UV_game_collision')['role']
  return typeof role === 'string' ? role : undefined
}

/** Describe declared glTF image bindings when no native material layer metadata was retained. */
function materialImageLayers(
  document: JsonObject,
  material: JsonObject,
): readonly ModelMaterialLayerRef[] {
  const pbr =
    material['pbrMetallicRoughness'] === undefined
      ? {}
      : object(material['pbrMetallicRoughness'], 'PBR material')
  const textures = array(document, 'textures'),
    images = array(document, 'images')
  const layers: ModelMaterialLayerRef[] = []
  for (const [slot, reference] of [
    ['baseColor', pbr['baseColorTexture']],
    ['metallicRoughness', pbr['metallicRoughnessTexture']],
    ['normal', material['normalTexture']],
    ['emissive', material['emissiveTexture']],
    ['occlusion', material['occlusionTexture']],
  ] as const) {
    if (reference === undefined) continue
    const binding = object(reference, `${slot} texture`)
    const texture = object(
      textures[safeIndex(binding['index'], textures.length, 'texture')],
      'texture',
    )
    const image = safeIndex(texture['source'], images.length, 'texture image')
    const uvSource = binding['texCoord'] ?? 0
    if (typeof uvSource !== 'number' || !Number.isSafeInteger(uvSource) || uvSource < 0)
      throw new TypeError('material texture texCoord must be a nonnegative integer')
    layers.push(Object.freeze({ slot, resourceId: uvmImageResourceId(document, image), uvSource }))
  }
  return Object.freeze(layers)
}

/** Material identities, declared image bindings and extension contracts; no shader simulation. */
function decodeMaterialRefs(document: JsonObject): readonly ModelMaterialRef[] {
  return array(document, 'materials').map((candidate, index) => {
    const material = object(candidate, `material ${index}`)
    const contracts: string[] = []
    const snapshot = field(
      field(field(material['extensions'], 'UV_game_material'), 'params'),
      'renderModel',
    )
    if (field(snapshot, 'version') === 1) {
      if (field(snapshot, 'standard') !== undefined) contracts.push('UV_game_material/standard')
      if (field(snapshot, 'composite') !== undefined) contracts.push('UV_game_material/composite')
    }
    if (field(material['extensions'], 'UV_game_material_team_color') !== undefined) {
      contracts.push('UV_game_material_team_color')
    }
    const stored = field(field(material['extras'], 'modkit'), 'material')
    let fields: JsonObject = {}
    if (stored !== undefined) {
      const metadata = object(stored, `material ${index} Modkit metadata`)
      if (metadata['version'] !== 1)
        throw new TypeError(`material ${index} has unsupported Modkit metadata version`)
      fields = object(metadata['fields'], `material ${index} Modkit fields`)
      for (const key of [
        'id',
        'name',
        'shader',
        'contracts',
        'alphaMode',
        'alphaCutoff',
        'doubleSided',
        'baseColorFactor',
        'emissiveFactor',
        'unlit',
      ]) {
        if (Object.hasOwn(fields, key))
          throw new TypeError(`material ${index} metadata shadows ${key}`)
      }
    }
    const storedAlphaMode = material['alphaMode']
    const alphaMode =
      storedAlphaMode === undefined
        ? undefined
        : storedAlphaMode === 'MASK'
          ? ('mask' as const)
          : storedAlphaMode === 'BLEND'
            ? ('blend' as const)
            : ('opaque' as const)
    const alphaCutoff = material['alphaCutoff']
    if (
      alphaCutoff !== undefined &&
      (typeof alphaCutoff !== 'number' || !Number.isFinite(alphaCutoff) || alphaCutoff < 0)
    ) {
      throw new TypeError(`material ${index} alphaCutoff must be finite and nonnegative`)
    }
    const layers = fields['layers'] === undefined ? materialImageLayers(document, material) : []
    const factor = (value: JsonValue | undefined, length: number, label: string) => {
      if (value === undefined) return undefined
      if (!finiteArray(value, length) || value.some(component => component < 0 || component > 1))
        throw new TypeError(`material ${index} ${label} must be ${length} components in 0..1`)
      return Object.freeze([...value])
    }
    const baseColorFactor = factor(
      field(material['pbrMetallicRoughness'], 'baseColorFactor'),
      4,
      'baseColorFactor',
    ) as ModelMaterialRef['baseColorFactor']
    const emissiveFactor = factor(
      material['emissiveFactor'],
      3,
      'emissiveFactor',
    ) as ModelMaterialRef['emissiveFactor']
    // a document from elsewhere states these only in its game material
    const gameMaterial = field(material['extensions'], 'UV_game_material')
    const depthWrite = field(gameMaterial, 'depthWrite')
    const sortPriority = field(gameMaterial, 'sortPriority')
    return Object.freeze({
      ...(typeof depthWrite === 'boolean' ? { depthWrite } : {}),
      ...(typeof sortPriority === 'number' ? { priority: sortPriority } : {}),
      ...fields,
      ...(layers.length === 0 ? {} : { layers }),
      ...(material['doubleSided'] === true ? { doubleSided: true } : {}),
      ...(baseColorFactor === undefined ? {} : { baseColorFactor }),
      ...(emissiveFactor === undefined ? {} : { emissiveFactor }),
      ...(field(material['extensions'], 'KHR_materials_unlit') === undefined
        ? {}
        : { unlit: true }),
      // the identity the artifact binding fixes, so a primitive and its material can be joined
      id: `material-${index}`,
      ...(typeof material['name'] === 'string' ? { name: material['name'] } : {}),
      ...(alphaMode === undefined ? {} : { alphaMode }),
      ...(alphaMode !== 'mask'
        ? {}
        : { alphaCutoff: typeof alphaCutoff === 'number' ? alphaCutoff : 0.5 }),
      ...(contracts.length === 0 ? {} : { contracts: Object.freeze(contracts) }),
      ...(field(material['extensions'], 'UV_game_material') === undefined
        ? {}
        : {
            shader: {
              id: string(
                field(field(material['extensions'], 'UV_game_material'), 'shader'),
                'shader identity',
              ),
              parameters: object(
                field(field(material['extensions'], 'UV_game_material'), 'params') ?? {},
                'UVM shader parameters',
              ),
            },
          }),
    })
  })
}

function decodeTeamColors(document: JsonObject) {
  const byOperation: Record<string, number> = Object.create(null)
  let total = 0
  for (const candidate of array(document, 'materials')) {
    const material = object(candidate, 'UVM material')
    const extension = field(material['extensions'], 'UV_game_material_team_color')
    if (extension === undefined) continue
    const teamColor = object(extension, 'UV_game_material_team_color')
    const remap = field(teamColor['extras'], 'renderModel')
    const operation = string(
      field(remap, 'operation') ?? (teamColor['blend'] === 'replace' ? 'replace' : 'multiply'),
      'team color operation',
    )
    total += 1
    byOperation[operation] = (byOperation[operation] ?? 0) + 1
  }
  return Object.freeze({ total, byOperation: Object.freeze(byOperation) })
}

function decodeAdvancedMaterials(document: JsonObject) {
  const byContract = { standard: 0, composite: 0 }
  let total = 0
  for (const candidate of array(document, 'materials')) {
    const material = object(candidate, 'UVM material')
    const snapshot = field(
      field(field(material['extensions'], 'UV_game_material'), 'params'),
      'renderModel',
    )
    if (field(snapshot, 'version') !== 1) continue
    let represented = false
    if (field(snapshot, 'standard') !== undefined) {
      byContract.standard += 1
      represented = true
    }
    if (field(snapshot, 'composite') !== undefined) {
      byContract.composite += 1
      represented = true
    }
    if (represented) total += 1
  }
  return Object.freeze({ total, byContract: Object.freeze(byContract) })
}

function decodeEffects(document: JsonObject) {
  const extension = field(document['extensions'], 'UV_game_effects')
  if (extension === undefined) {
    return Object.freeze({ total: 0, profile: undefined, byKind: Object.freeze({}), animated: 0 })
  }
  const effects = object(extension, 'UV_game_effects')
  const byKind: Record<string, number> = Object.create(null)
  let total = 0
  for (const kind of ['particles', 'ribbons', 'forces', 'warps', 'projectors']) {
    const count = array(effects, kind).length
    byKind[kind] = count
    total += count
  }
  let animated = 0
  for (const candidate of array(document, 'animations')) {
    const animation = object(candidate, 'UVM animation')
    animated += array(animation, 'channels').filter(channel => {
      const target = field(channel, 'target')
      return (
        field(target, 'path') === 'pointer' &&
        field(field(target, 'extensions'), 'KHR_animation_pointer') !== undefined
      )
    }).length
  }
  return Object.freeze({
    total,
    profile: string(effects['profile'] ?? 'common', 'effects profile'),
    byKind: Object.freeze(byKind),
    animated,
  })
}
