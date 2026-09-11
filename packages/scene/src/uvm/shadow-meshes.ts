import type { JsonObject } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { array, field, object, safeIndex } from './values.js'

export const UVM_MODEL_SHADOW_MESHES = 'UV_model_shadow_meshes'

export interface UvmShadowMeshInput {
  readonly node: number
  readonly positions: Float32Array
  readonly indices: Uint16Array | Uint32Array
}

export interface UvmShadowMeshBinding {
  readonly node: number
  readonly mesh: number
}

export function readUvmShadowMeshBindings(document: JsonObject): readonly UvmShadowMeshBinding[] {
  const raw = field(document['extensions'], UVM_MODEL_SHADOW_MESHES)
  if (raw === undefined) return []
  const extension = object(raw, 'shadow meshes')
  if (
    extension['schemaVersion'] !== 1 ||
    Object.keys(extension).some(key => !['schemaVersion', 'shadows'].includes(key)) ||
    !array(document, 'extensionsUsed').includes(UVM_MODEL_SHADOW_MESHES)
  ) throw new TypeError('unsupported UVM shadow meshes')
  const nodes = array(document, 'nodes'), meshes = array(document, 'meshes'), seen = new Set<number>()
  return Object.freeze(array(extension, 'shadows').map(candidate => {
    const value = object(candidate, 'shadow mesh')
    if (Object.keys(value).some(key => !['node', 'mesh'].includes(key)))
      throw new TypeError('unsupported UVM shadow mesh binding')
    const node = safeIndex(value['node'], nodes.length, 'shadow node')
    if (seen.has(node)) throw new TypeError('duplicate UVM shadow node')
    seen.add(node)
    return Object.freeze({ node, mesh: safeIndex(value['mesh'], meshes.length, 'shadow mesh') })
  }))
}

/** Adds standard glTF triangle meshes and only the portable node-to-shadow-role relation. */
export function addUvmShadowMeshes(
  source: UvmContainer,
  inputs: readonly UvmShadowMeshInput[],
  budget: UvmContainerBudget & { readonly maxScalarBytes: number } = {
    ...DEFAULT_UVM_CONTAINER_BUDGET,
    maxScalarBytes: 536_870_912,
  },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  validateUvmDocument(source.document, { binaryByteLength: source.binary.length, ...(signal ? { signal } : {}) })
  const nodes = array(source.document, 'nodes'), existingMeshes = array(source.document, 'meshes')
  const owned = inputs.map((input, ordinal) => {
    const node = safeIndex(input.node, nodes.length, `shadow ${ordinal} node`)
    if (!(input.positions instanceof Float32Array) || input.positions.length < 9 || input.positions.length % 3)
      throw new TypeError('shadow positions must contain complete triangles')
    if (!(input.indices instanceof Uint16Array || input.indices instanceof Uint32Array) || input.indices.length < 3 || input.indices.length % 3)
      throw new TypeError('shadow indices must contain complete triangles')
    for (const value of input.indices)
      if (value >= input.positions.length / 3) throw new RangeError('shadow index exceeds positions')
    return { node, positions: input.positions.slice(), indices: input.indices.slice() }
  })
  if (new Set(owned.map(value => value.node)).size !== owned.length)
    throw new TypeError('duplicate UVM shadow node')
  if (owned.length === 0) return { container: source, bindings: [] }
  const appended = appendUvmAccessors(
    source,
    owned.flatMap(value => [
      { values: value.positions, type: 'VEC3' as const, target: 34962 as const },
      { values: value.indices, type: 'SCALAR' as const, target: 34963 as const },
    ]),
    budget,
    signal,
  )
  const bindings = owned.map((value, ordinal) => ({ node: value.node, mesh: existingMeshes.length + ordinal }))
  const extension = field(source.document['extensions'], UVM_MODEL_SHADOW_MESHES)
  const existingBindings = extension === undefined ? [] : readUvmShadowMeshBindings(source.document)
  const occupiedNodes = new Set(existingBindings.map(binding => binding.node))
  if (owned.some(value => occupiedNodes.has(value.node)))
    throw new TypeError('duplicate UVM shadow node')
  const previous = extension === undefined ? [] : array(extension, 'shadows')
  const document = snapshotJson({
    ...appended.container.document,
    meshes: [
      ...existingMeshes,
      ...owned.map((_value, ordinal) => ({
        name: `Shadow mesh ${ordinal}`,
        primitives: [{
          attributes: { POSITION: appended.accessors[ordinal * 2] },
          indices: appended.accessors[ordinal * 2 + 1],
          mode: 4,
        }],
      })),
    ],
    extensionsUsed: [...new Set([...array(source.document, 'extensionsUsed'), UVM_MODEL_SHADOW_MESHES])],
    extensions: {
      ...object(source.document['extensions'], 'extensions'),
      [UVM_MODEL_SHADOW_MESHES]: { schemaVersion: 1, shadows: [...previous, ...bindings] },
    },
  }, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal) as JsonObject
  const container = { ...appended.container, document }
  validateUvmDocument(document, { binaryByteLength: container.binary.length, ...(signal ? { signal } : {}) })
  writeUvmContainer(container, budget, signal)
  return { container, bindings: Object.freeze(bindings.map(Object.freeze)) }
}
