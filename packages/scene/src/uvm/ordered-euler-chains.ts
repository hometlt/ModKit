import type { JsonObject } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { array, field, object, safeIndex } from './values.js'

export const UVM_ORDERED_EULER_CHAINS = 'UV_ordered_euler_chains'

export interface UvmOrderedEulerChain {
  readonly node: number
  readonly rotationNodes: readonly [number, number, number]
  readonly scaleNode: number
  readonly order: 'xyz'
}

export function readUvmOrderedEulerChains(document: JsonObject): readonly UvmOrderedEulerChain[] {
  const raw = field(document['extensions'], UVM_ORDERED_EULER_CHAINS)
  if (raw === undefined) return []
  const extension = object(raw, 'ordered Euler chains')
  if (
    extension['schemaVersion'] !== 1 ||
    Object.keys(extension).some(key => !['schemaVersion', 'chains'].includes(key)) ||
    !array(document, 'extensionsUsed').includes(UVM_ORDERED_EULER_CHAINS)
  ) throw new TypeError('unsupported UVM ordered Euler chains')
  const nodes = array(document, 'nodes'), used = new Set<number>()
  return Object.freeze(array(extension, 'chains').map(candidate => {
    const value = object(candidate, 'ordered Euler chain')
    if (Object.keys(value).some(key => !['node', 'rotationNodes', 'scaleNode', 'order'].includes(key)))
      throw new TypeError('unsupported UVM ordered Euler chain')
    const node = safeIndex(value['node'], nodes.length, 'ordered Euler node')
    const rotations = array(value, 'rotationNodes')
    if (rotations.length !== 3 || value['order'] !== 'xyz')
      throw new TypeError('invalid or duplicate UVM ordered Euler chain')
    const rotationNodes = rotations.map((entry, axis) =>
      safeIndex(entry, nodes.length, `ordered Euler rotation ${axis}`),
    ) as [number, number, number]
    const scaleNode = safeIndex(value['scaleNode'], nodes.length, 'ordered Euler scale node')
    const chainNodes = [node, ...rotationNodes]
    if (new Set(chainNodes).size !== 4 || chainNodes.some(index => used.has(index)))
      throw new TypeError('ordered Euler nodes must be distinct')
    const children = (index: number) => array(object(nodes[index], `node ${index}`), 'children')
    if (
      !children(node).includes(rotationNodes[0]) ||
      !children(rotationNodes[0]!).includes(rotationNodes[1]) ||
      !children(rotationNodes[1]!).includes(rotationNodes[2]) ||
      scaleNode !== rotationNodes[2]
    ) throw new TypeError('ordered Euler hierarchy does not match its declaration')
    chainNodes.forEach(index => used.add(index))
    return Object.freeze({ node, rotationNodes, scaleNode, order: 'xyz' as const })
  }))
}

export function addUvmOrderedEulerChains(
  source: UvmContainer,
  inputs: readonly UvmOrderedEulerChain[],
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
): UvmContainer {
  signal?.throwIfAborted()
  validateUvmDocument(source.document, { binaryByteLength: source.binary.length, ...(signal ? { signal } : {}) })
  if (inputs.length === 0) return source
  const extensions = object(source.document['extensions'], 'extensions')
  if (extensions[UVM_ORDERED_EULER_CHAINS] !== undefined)
    throw new TypeError('UVM ordered Euler chains already exist')
  const document = snapshotJson({
    ...source.document,
    extensionsUsed: [...new Set([...array(source.document, 'extensionsUsed'), UVM_ORDERED_EULER_CHAINS])],
    extensions: {
      ...extensions,
      [UVM_ORDERED_EULER_CHAINS]: { schemaVersion: 1, chains: inputs },
    },
  }, { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes }, signal) as JsonObject
  readUvmOrderedEulerChains(document)
  const result = {
    ...source,
    document,
    binary: new Uint8Array(source.binary),
    extraChunks: source.extraChunks.map(chunk => ({ type: chunk.type, bytes: new Uint8Array(chunk.bytes) })),
  }
  writeUvmContainer(result, budget, signal)
  return result
}
