import type { JsonObject, ModelSocketOrientation } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { array, field, object, safeIndex, string } from './values.js'

export interface UvmSocketInput {
  readonly id: string
  /** Existing UVM node index; several sockets may attach to the same parent. */
  readonly parent: number
  readonly role: string
  readonly sourceName?: string
  /** Authored axes only. Their absence does not assert that a native source declared UVM defaults. */
  readonly orientation?: ModelSocketOrientation
  /** Local affine transform. Absence explicitly means identity relative to the parent. */
  readonly transform?: readonly number[]
}

export interface UvmSocketBinding {
  readonly id: string
  readonly node: number
  readonly parent: number
}

/** Add distinct empty socket nodes to a UVM scene. Their transforms follow the ordinary node
 * hierarchy, including animation, with no native-format branch. Nonempty results own JSON/BIN;
 * an empty request borrows the unchanged source. Serialization and profile checks stay in UV.
 */
export function addUvmSockets(
  source: UvmContainer,
  inputs: readonly UvmSocketInput[],
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
): { readonly container: UvmContainer; readonly bindings: readonly UvmSocketBinding[] } {
  signal?.throwIfAborted()
  writeUvmContainer(source, budget, signal)
  const validationOptions = {
    binaryByteLength: source.binary.length,
    ...(signal === undefined ? {} : { signal }),
  }
  validateUvmDocument(source.document, validationOptions)
  const jsonBudget = {
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
    maxBytes: budget.maxJsonBytes,
  }
  const requests = snapshotJson(inputs, jsonBudget, signal) as unknown as readonly UvmSocketInput[]
  if (!Array.isArray(requests)) throw new TypeError('UVM sockets must be an array')
  if (requests.length === 0) return { container: source, bindings: [] }
  if (!Array.isArray(source.document['nodes'])) throw new TypeError('UVM nodes must be an array')
  const nodes = array(source.document, 'nodes').map((node, index) => object(node, `node ${index}`))
  const ids = new Set<string>()
  const roleOrdinals = new Map<string, number>()
  let count = 0
  for (const [index, node] of nodes.entries()) {
    signal?.throwIfAborted()
    if (node['children'] !== undefined && !Array.isArray(node['children']))
      throw new TypeError('UVM node children must be an array')
    const children = array(node, 'children')
    for (const child of children) safeIndex(child, nodes.length, 'node child')
    if (new Set(children).size !== children.length) throw new TypeError('duplicate UVM node child')
    const candidate = field(node['extensions'], 'UV_game_socket')
    if (candidate === undefined) continue
    const socket = object(candidate, 'socket')
    const id = field(field(socket['extras'], 'modkit'), 'id') ?? `uvm-socket-${index}`
    if (ids.has(string(id, 'socket id'))) throw new TypeError('duplicate UVM socket id')
    ids.add(string(id, 'socket id'))
    const role = string(socket['role'], 'socket role')
    roleOrdinals.set(role, Math.max(roleOrdinals.get(role) ?? 0, Number(socket['index'] ?? 0) + 1))
    count++
  }
  const bindings: UvmSocketBinding[] = []
  const additions: JsonObject[] = []
  const childrenByParent = new Map<number, number[]>()
  for (const input of requests) {
    signal?.throwIfAborted()
    const id = string(input.id, 'socket id'),
      role = string(input.role, 'socket role')
    if (ids.has(id)) throw new TypeError('duplicate UVM socket id')
    ids.add(id)
    const parent = safeIndex(input.parent, nodes.length, 'socket parent')
    const orientation = input.orientation
    const axes: readonly string[] = ['+x', '-x', '+y', '-y', '+z', '-z']
    if (
      orientation !== undefined &&
      (orientation === null ||
        !axes.includes(orientation.forward) ||
        !axes.includes(orientation.up) ||
        orientation.forward.slice(1) === orientation.up.slice(1))
    )
      throw new TypeError('socket orientation requires two distinct orthogonal axes')
    const transform = input.transform
    if (
      transform !== undefined &&
      (transform.length !== 16 ||
        !transform.every(Number.isFinite) ||
        [3, 7, 11].some(index => transform[index] !== 0) ||
        transform[15] !== 1)
    )
      throw new TypeError('socket transform must be finite affine')
    const node = nodes.length + additions.length
    const ordinal = roleOrdinals.get(role) ?? 0
    if (!Number.isSafeInteger(ordinal + 1))
      throw new RangeError('socket ordinal exceeds safe integer range')
    roleOrdinals.set(role, ordinal + 1)
    const socket = {
      role,
      index: ordinal,
      ...(input.sourceName === undefined ? {} : { sourceName: input.sourceName }),
      ...(orientation === undefined ? {} : { forward: orientation.forward, up: orientation.up }),
      extras: { modkit: { id, nodeId: `node-${node}` } },
    }
    additions.push({
      ...(input.sourceName === undefined ? {} : { name: input.sourceName }),
      ...(transform === undefined ? {} : { matrix: transform }),
      extensions: { UV_game_socket: socket },
    })
    const children = childrenByParent.get(parent) ?? []
    children.push(node)
    childrenByParent.set(parent, children)
    bindings.push({ id, node, parent })
  }
  const extensions = object(source.document['extensions'], 'UVM extensions')
  const document = snapshotJson(
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
      extensionsUsed: [...new Set([...array(source.document, 'extensionsUsed'), 'UV_game_socket'])],
      extensions: {
        ...extensions,
        UV_asset: {
          ...object(extensions['UV_asset'], 'UV_asset'),
          sockets: count + additions.length,
        },
      },
    },
    jsonBudget,
    signal,
  )
  const container: UvmContainer = {
    format: source.format,
    document: object(document, 'socket document'),
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map(chunk => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes),
    })),
  }
  validateUvmDocument(container.document, validationOptions)
  writeUvmContainer(container, budget, signal)
  return { container, bindings: Object.freeze(bindings.map(binding => Object.freeze(binding))) }
}
