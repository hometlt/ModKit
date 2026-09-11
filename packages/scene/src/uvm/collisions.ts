import type { JsonObject } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { array, field, object, safeIndex, string } from './values.js'

export interface UvmCollisionInput {
  readonly id: string
  /** Existing scene node; each volume gets a distinct child, even on a shared parent. */
  readonly parent: number
  /** UV_game_collision role. The UV schema validates this value and the shape. */
  readonly role: string
  readonly shape: JsonObject
}

/** Pure document operation. Shape fields/accessor indices use the UV schema directly; scene
 * introduces no second format or binary writer. The nonempty result owns JSON/BIN/opaque chunks.
 */
export function addUvmCollisions(
  source: UvmContainer,
  inputs: readonly UvmCollisionInput[],
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  writeUvmContainer(source, budget, signal)
  const validation = {
    binaryByteLength: source.binary.length,
    ...(signal === undefined ? {} : { signal }),
  }
  validateUvmDocument(source.document, validation)
  const jsonBudget = {
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
    maxBytes: budget.maxJsonBytes,
  }
  const requests = snapshotJson(inputs, jsonBudget, signal)
  if (!Array.isArray(requests)) throw new TypeError('UVM collisions must be an array')
  if (requests.length === 0) return { container: source, bindings: [] }
  if (!Array.isArray(source.document['nodes'])) throw new TypeError('UVM nodes must be an array')
  const nodes = array(source.document, 'nodes').map((node, i) => object(node, `node ${i}`))
  const ids = new Set<string>()
  for (const node of nodes) {
    signal?.throwIfAborted()
    const identity = field(
      field(field(node['extensions'], 'UV_game_collision'), 'extras'),
      'modkit',
    )
    const id = field(identity, 'id')
    if (id !== undefined) {
      if (ids.has(string(id, 'collision id'))) throw new TypeError('duplicate UVM collision id')
      ids.add(string(id, 'collision id'))
    }
    if (node['children'] !== undefined && !Array.isArray(node['children']))
      throw new TypeError('UVM node children must be an array')
    const children = array(node, 'children')
    for (const child of children) safeIndex(child, nodes.length, 'node child')
    if (new Set(children).size !== children.length) throw new TypeError('duplicate UVM node child')
  }
  const childrenByParent = new Map<number, number[]>()
  const additions: JsonObject[] = []
  const bindings: { readonly id: string; readonly node: number; readonly parent: number }[] = []
  for (const candidate of requests) {
    signal?.throwIfAborted()
    const input = object(candidate, 'collision input')
    const id = string(input['id'], 'collision id'),
      role = string(input['role'], 'collision role')
    if (ids.has(id)) throw new TypeError('duplicate UVM collision id')
    ids.add(id)
    const parent = safeIndex(input['parent'], nodes.length, 'collision parent')
    const shape = object(input['shape'], 'collision shape')
    const node = nodes.length + additions.length
    additions.push({
      extensions: { UV_game_collision: { role, shapes: [shape], extras: { modkit: { id } } } },
    })
    const children = childrenByParent.get(parent) ?? []
    children.push(node)
    childrenByParent.set(parent, children)
    bindings.push(Object.freeze({ id, node, parent }))
  }
  const extensions = object(source.document['extensions'], 'extensions')
  const document = object(
    snapshotJson(
      {
        ...source.document,
        nodes: [
          ...nodes.map((node, index) => {
            const children = childrenByParent.get(index)
            return children === undefined
              ? node
              : { ...node, children: [...array(node, 'children'), ...children] }
          }),
          ...additions,
        ],
        extensionsUsed: [
          ...new Set([...array(source.document, 'extensionsUsed'), 'UV_game_collision']),
        ],
        extensions: {
          ...extensions,
          UV_asset: { ...object(extensions['UV_asset'], 'UV_asset'), collision: true },
        },
      },
      jsonBudget,
      signal,
    ),
    'collision document',
  )
  const container: UvmContainer = {
    format: source.format,
    document,
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map(chunk => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes),
    })),
  }
  validateUvmDocument(document, validation)
  writeUvmContainer(container, budget, signal)
  return { container, bindings: Object.freeze(bindings) }
}
