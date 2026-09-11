import type { ModelAnimationChannel, ModelNode } from '@modkit/sdk'
import { snapshotJson, type JsonSnapshotBudget } from '@modkit/codec-kit/json-snapshot'

export interface OrderedEulerKey {
  readonly timeSeconds: number
  /** Radians, interpolated as authored scalar values, without wrapping or shortest-arc rewriting. */
  readonly value: readonly [number, number, number]
}

/** Expand an identity node into T * Rx * Ry * Rz * S using ordinary scene nodes and glTF
 * rotation channels. Per-axis arc subdivision preserves long rotations under quaternion SLERP;
 * this is an analytic representation, not a fixed-frame-rate bake. Translation targets the
 * original node; scale targets scaleNodeId. Existing geometry and children follow the full chain.
 */
export function expandOrderedEulerNode(
  source: readonly ModelNode[],
  nodeId: string,
  sourceKeys: readonly OrderedEulerKey[],
  interpolation: 'step' | 'linear',
  budget: JsonSnapshotBudget,
  signal?: AbortSignal,
): {
  readonly nodes: readonly ModelNode[]
  readonly channels: readonly ModelAnimationChannel[]
  readonly scaleNodeId: string
} {
  signal?.throwIfAborted()
  const owned = snapshotJson({ nodes: source, keys: sourceKeys }, budget, signal) as unknown as {
    nodes: readonly ModelNode[]
    keys: readonly OrderedEulerKey[]
  }
  if (!['step', 'linear'].includes(interpolation) || !owned.keys.length)
    throw new TypeError('ordered rotation requires keys and step or linear interpolation')
  const ids = new Set(owned.nodes.map(node => node.id))
  const target = owned.nodes.find(node => node.id === nodeId)
  if (
    ids.size !== owned.nodes.length ||
    target === undefined ||
    target.transform.length !== 16 ||
    target.transform.some((value, index) => value !== (index % 5 === 0 ? 1 : 0))
  )
    throw new TypeError('ordered rotation requires a unique identity scene node')
  const axisIds = ['x', 'y', 'z'].map(axis => `${nodeId}/rotation-${axis}`)
  if (axisIds.some(id => ids.has(id))) throw new TypeError('ordered rotation node id collision')
  let previous = -Infinity
  for (const key of owned.keys) {
    if (
      !Number.isFinite(key.timeSeconds) ||
      key.timeSeconds < 0 ||
      key.timeSeconds <= previous ||
      key.value.length !== 3 ||
      !key.value.every(Number.isFinite)
    )
      throw new TypeError(
        'ordered rotation requires finite increasing times and three finite angles',
      )
    previous = key.timeSeconds
  }
  let generatedKeys = 0
  const channels: ModelAnimationChannel[] = axisIds.map((id, axis) => {
    const samples: { frame: number; timeSeconds: number; value: number[] }[] = []
    const append = (timeSeconds: number, angle: number) => {
      signal?.throwIfAborted()
      if (++generatedKeys > budget.maxNodes || generatedKeys * 64 > budget.maxBytes)
        throw new RangeError('ordered rotation expansion exceeds budget')
      const value = [0, 0, 0, Math.cos(angle / 2)]
      value[axis] = Math.sin(angle / 2)
      samples.push({ frame: samples.length, timeSeconds, value })
    }
    for (let index = 0; index < owned.keys.length; index++) {
      const key = owned.keys[index]!
      const next = owned.keys[index + 1]
      append(key.timeSeconds, key.value[axis]!)
      if (next === undefined || interpolation === 'step') continue
      const delta = next.value[axis]! - key.value[axis]!
      const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)))
      if (!Number.isSafeInteger(pieces) || pieces > budget.maxNodes - generatedKeys)
        throw new RangeError('ordered rotation expansion exceeds budget')
      for (let part = 1; part < pieces; part++) {
        const fraction = part / pieces
        append(
          key.timeSeconds + (next.timeSeconds - key.timeSeconds) * fraction,
          key.value[axis]! + delta * fraction,
        )
      }
    }
    return {
      target: id,
      kind: 'rotation',
      firstFrame: 0,
      lastFrame: samples.length - 1,
      interpolation: interpolation === 'step' ? 'step' : 'spherical-linear',
      samples,
    }
  })
  const nodes: ModelNode[] = [
    ...owned.nodes.map(node =>
      node.id === nodeId ? { ...node, meshIds: [], childIds: [axisIds[0]!] } : node,
    ),
    ...axisIds.map((id, axis) => ({
      id,
      name: `Rotation ${['X', 'Y', 'Z'][axis]}`,
      transform: [...target.transform],
      childIds: axis === 2 ? [...target.childIds] : [axisIds[axis + 1]!],
      meshIds: axis === 2 ? [...target.meshIds] : [],
    })),
  ]
  return snapshotJson({ nodes, channels, scaleNodeId: axisIds[2]! }, budget, signal) as unknown as {
    nodes: readonly ModelNode[]
    channels: readonly ModelAnimationChannel[]
    scaleNodeId: string
  }
}
