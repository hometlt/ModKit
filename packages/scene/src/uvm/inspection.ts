import type { FieldEditable, JsonValue, ProjectionReceipt } from '@modkit/sdk'
import type { InspectionResult } from '@modkit/codec-kit'
import {
  createModelSceneSource,
  createModelSkeletonSource,
  createModelAnimationSource,
  createModelCollisionSource,
  createModelSocketSource,
  createModelMaterialSource,
} from '@modkit/codec-kit/model/sources'
import { animationSnapshotBudget } from '@modkit/codec-kit/model/animation'
import { createProjectionReceipt } from '@modkit/codec-kit/projection'
import { createJsonTreeSource } from '@modkit/codec-kit/tree/json'
import type { UvmContainer } from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { readUvmModel } from './model.js'
import { readUvmFacets } from './facets.js'
import { array, field, object, string, required } from './values.js'

export interface UvmInspectionBudget {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxScalarBytes: number
  readonly maxJsonBytes: number
}
export interface UvmInspectionOptions {
  readonly budget: UvmInspectionBudget
  readonly subjectRevision: ProjectionReceipt['subjectRevision']
  readonly adapter: ProjectionReceipt['adapter']
  readonly bytesRead: bigint
  readonly treeWrite?: FieldEditable['write']
  readonly signal?: AbortSignal
}

const UVM_BASIS = Object.freeze({
  handedness: 'right',
  upAxis: 'y',
  forwardAxis: '-z',
  unit: 'meter',
  metersPerUnit: 1,
})

function countJsonNodes(
  value: JsonValue,
  budget: UvmInspectionBudget,
  signal?: AbortSignal,
): number {
  const pending = [{ value, depth: 0 }]
  let nodes = 0
  while (pending.length > 0) {
    signal?.throwIfAborted()
    const current = required(pending.pop(), 'JSON node')
    if (++nodes > budget.maxNodes) throw new RangeError('UVM JSON exceeds maxNodes budget')
    if (current.depth > budget.maxDepth) throw new RangeError('UVM JSON exceeds maxDepth budget')
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 })
    } else if (current.value !== null && typeof current.value === 'object') {
      for (const child of Object.values(current.value))
        pending.push({ value: child, depth: current.depth + 1 })
    }
  }
  return nodes
}

/** Publish validated UVM model data through the same sources and receipts used by the common codec.
 * No host, file lookup, renderer or native parser is loaded. The receipt describes this UVM
 * projection; a native importer must also account for its preceding conversion and losses.
 * Operations and durable writes remain with the caller/host. Tree editing is opt-in.
 */
export function createUvmInspection(
  container: UvmContainer,
  options: UvmInspectionOptions,
): InspectionResult {
  const { budget, signal } = options
  signal?.throwIfAborted()
  for (const value of [
    budget.maxDepth,
    budget.maxNodes,
    budget.maxScalarBytes,
    budget.maxJsonBytes,
  ])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError('invalid UVM inspection budget')
  if (typeof options.bytesRead !== 'bigint' || options.bytesRead < 0n)
    throw new TypeError('invalid UVM inspection byte count')
  const document = container.document
  validateUvmDocument(document, {
    binaryByteLength: container.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  const jsonNodes = countJsonNodes(document, budget, signal)
  const { scene, rig } = readUvmModel(document, container.binary, budget, signal)
  const clipBudget = animationSnapshotBudget(rig.clips)
  const { collisions, teamColors, advancedMaterials, effects, sockets, materialRefs } =
    readUvmFacets(document, container.binary, budget, signal)
  const extensions = object(document['extensions'], 'UVM extensions')
  const identity = object(extensions['UV_asset'], 'UV_asset')
  const provenance = object(extensions['UV_provenance'], 'UV_provenance')
  const asset = object(document['asset'], 'UVM asset')
  const profile = object(field(asset['extras'], 'uv'), 'UVM profile')
  const source = object(provenance['source'], 'UV_provenance source')
  const importer = object(provenance['importer'], 'UV_provenance importer')
  const version = string(profile['version'], 'profile version')
  const profileName = string(profile['profile'], 'profile name')
  const assetId = string(identity['id'], 'asset id')
  const assetClass = string(identity['class'], 'asset class')
  const sourceFormat = string(source['format'], 'source format')
  const losses = array(provenance, 'lost')
  const bounds = (() => {
    if (scene.primitives.length === 0) return undefined
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const primitive of scene.primitives) {
      for (let offset = 0; offset < primitive.positions.length; offset += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = required(primitive.positions[offset + axis], 'position axis')
          min[axis] = Math.min(required(min[axis], 'bounds axis'), value)
          max[axis] = Math.max(required(max[axis], 'bounds axis'), value)
        }
      }
    }
    return { min, max }
  })()
  const model = createModelSceneSource({
    info: {
      scenes: array(document, 'scenes').length,
      nodes: scene.nodes.length,
      meshes: scene.meshes.length,
      primitives: scene.primitives.length,
      materials: scene.materials,
      textures: scene.textures,
      animations: rig.clips.length,
      ...(bounds === undefined ? {} : { bounds }),
      geometryAccess: 'decoded',
    },
    nodes: scene.nodes,
    meshes: scene.meshes,
    primitives: scene.primitives,
  })
  return {
    summary: {
      format: 'uvm',
      version: version,
      profile: profileName,
      assetId: assetId,
      assetClass: assetClass,
      sourceFormat: sourceFormat,
      importer: importer,
      nodes: scene.nodes.length,
      meshes: scene.meshes.length,
      primitives: scene.primitives.length,
      collisionShapes: collisions.total,
      collisionKinds: collisions.byKind,
      teamColorMaterials: teamColors.total,
      teamColorOperations: teamColors.byOperation,
      advancedMaterialContracts: advancedMaterials.total,
      advancedMaterialKinds: advancedMaterials.byContract,
      effects: effects.total,
      sockets: sockets.length,
      ...(effects.profile === undefined ? {} : { effectProfile: effects.profile }),
      effectKinds: effects.byKind,
      animatedEffectProperties: effects.animated,
      losses: losses,
    },
    metadata: [
      {
        id: 'uvm-document',
        label: 'Universal Verse Model',
        entries: [
          { key: 'version', value: version },
          { key: 'profile', value: profileName },
          { key: 'assetId', value: assetId },
          { key: 'assetClass', value: assetClass },
          { key: 'sourceFormat', value: sourceFormat },
          { key: 'meshes', value: scene.meshes.length },
          { key: 'primitives', value: scene.primitives.length },
          { key: 'collisionShapes', value: collisions.total },
          { key: 'teamColorMaterials', value: teamColors.total },
          { key: 'advancedMaterialContracts', value: advancedMaterials.total },
          { key: 'effects', value: effects.total },
          { key: 'sockets', value: sockets.length },
          { key: 'animatedEffectProperties', value: effects.animated },
        ],
      },
    ],
    traits: [
      ...(scene.primitives.length > 0
        ? [{ id: 'model.geometry', parameters: { primitives: scene.primitives.length } }]
        : []),
      ...(scene.materials > 0
        ? [{ id: 'model.materials', parameters: { count: scene.materials } }]
        : []),
      ...(scene.textures > 0
        ? [{ id: 'model.textures', parameters: { count: scene.textures } }]
        : []),
      ...(rig.clips.length > 0
        ? [{ id: 'model.animations', parameters: { count: rig.clips.length } }]
        : []),
      ...(rig.bindings.length > 0
        ? [{ id: 'model.skeleton', parameters: { bindings: rig.bindings.length } }]
        : []),
      { id: 'scene.objects', parameters: { nodes: scene.nodes.length } },
      { id: 'structure.hierarchy', parameters: { nodeCount: jsonNodes, lazy: true } },
    ],
    projectionReceipt: createProjectionReceipt({
      adapter: options.adapter,
      subjectRevision: options.subjectRevision,
      companions: [],
      basis: UVM_BASIS,
      planes: [
        {
          planeId: 'skeleton',
          state: rig.incompleteBindings === 0 ? 'preserved' : 'lost',
          note: `${rig.bindings.length} positional skin bindings; ${rig.incompleteBindings} lack a TRS or direct parent join`,
        },
        {
          planeId: 'animations',
          state: rig.clips.some(clip => (clip.unsupportedChannels ?? 0) > 0) ? 'lost' : 'preserved',
          note: `${rig.clips.length} selectable clips retain material sequence identities, STEP/LINEAR TRS and primitive visibility channels, including channel-less catalog entries; unsupported channels are counted explicitly`,
        },
        {
          planeId: 'geometry',
          state: 'preserved',
          // the document already is the UV space; there is nothing to convert
          note: 'positions are read in the profile’s own right-handed Y-up metre space',
        },
        {
          planeId: 'structure',
          state: 'preserved',
          note: 'the node graph, positionally identified',
        },
        {
          planeId: 'materials',
          state: scene.materials > 0 ? 'preserved' : 'lost',
          note: `${scene.materials} material(s), ${advancedMaterials.total} carrying a render-model contract`,
        },
        {
          planeId: 'collision',
          state: collisions.total > 0 ? 'preserved' : 'lost',
          note: `${collisions.total} declared UV_game_collision shape(s)`,
        },
        {
          planeId: 'attachments',
          state: sockets.length > 0 ? 'preserved' : 'lost',
          note: `${sockets.length} UV_game_socket node extension(s) published with stable identity`,
        },
        {
          planeId: 'resources',
          state: 'lost',
          note: `${scene.textures} texture(s) are counted from the document; this reader does not surface their references, so no resource facet is published`,
        },
        {
          planeId: 'effects',
          state: effects.total > 0 ? 'lost' : 'preserved',
          note:
            effects.total > 0
              ? `${effects.total} UV_game_effects entry(ies) are counted by kind; per-emitter records have no contract to be published through`
              : 'the document declares no effects',
        },
      ],
      evidence: [
        {
          kind: 'observed',
          statement: `UVM ${version}/${profileName}: ${scene.nodes.length} node(s), ${scene.primitives.length} primitive(s), ${sockets.length} socket(s)`,
          bytesRead: options.bytesRead,
        },
        {
          kind: 'declared',
          statement: `the document declares its source format as «${sourceFormat}» and its importer as ${importer['id'] ?? 'unnamed'}`,
          source: 'UV_provenance',
        },
        ...(losses.length > 0
          ? [
              {
                kind: 'declared' as const,
                statement: `the producing importer recorded ${losses.length} loss(es) in UV_provenance.lost`,
                source: 'UV_provenance',
              },
            ]
          : []),
      ],
      confidence: 'exact',
    }),
    dataSources: {
      'common.view/model-scene-source': model,
      ...(rig.bindings.length === 0
        ? {}
        : {
            'common.view/model-skeleton-source': createModelSkeletonSource({
              bindings: rig.bindings,
              hierarchies: array(document, 'skins').length,
              budget: {
                maxDepth: budget.maxDepth,
                maxNodes: budget.maxNodes,
                maxBytes: budget.maxScalarBytes,
              },
            }),
          }),
      ...(rig.clips.length === 0
        ? {}
        : {
            // Sized by the clips already decoded out of the bounded binary: a pose per frame
            // (Grey Goo ALA, Earth 2160) is millions of snapshot nodes, over the host's node budget.
            'common.view/model-animation-source': createModelAnimationSource({
              clips: rig.clips,
              budget: {
                maxDepth: budget.maxDepth,
                maxNodes: Math.max(budget.maxNodes, clipBudget.maxNodes),
                maxBytes: Math.max(budget.maxScalarBytes, clipBudget.maxBytes),
              },
            }),
          }),
      ...(collisions.volumes.length === 0
        ? {}
        : {
            'common.view/model-collision-source': createModelCollisionSource({
              volumes: collisions.volumes,
            }),
          }),
      ...(sockets.length === 0
        ? {}
        : {
            'common.view/model-socket-source': createModelSocketSource({ sockets }),
          }),
      ...(materialRefs.length === 0
        ? {}
        : {
            'common.view/model-material-source': createModelMaterialSource({
              // UVM has no material-library concept, so `libraries` is absent rather than zero
              materials: materialRefs,
              budget: {
                maxDepth: budget.maxDepth,
                maxNodes: budget.maxNodes,
                maxBytes: budget.maxScalarBytes,
              },
            }),
          }),
      'common.view/tree-data-source': createJsonTreeSource(document, {
        label: 'Universal Verse Model',
        budget: {
          maxDepth: budget.maxDepth,
          maxNodes: budget.maxNodes,
          maxBytes: budget.maxJsonBytes,
        },
        ...(options.treeWrite === undefined ? {} : { write: options.treeWrite }),
        ...(signal === undefined ? {} : { signal }),
      }),
    },
  }
}
