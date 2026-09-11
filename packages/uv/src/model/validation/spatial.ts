import type { JsonObject, JsonValue } from '@modkit/sdk'
import { array, field, object, nonBlank, finite, integer, finiteArray, oneOf } from './values.js'

export function validateSocketMetadata(
  document: JsonObject,
  used: readonly JsonValue[],
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted()
  let count = 0
  const axes = ['+x', '-x', '+y', '-y', '+z', '-z'] as const
  for (const [nodeIndex, candidate] of array(document, 'nodes').entries()) {
    signal?.throwIfAborted()
    const node = object(candidate, `node ${nodeIndex}`)
    const candidateSocket = field(node['extensions'], 'UV_game_socket')
    if (candidateSocket === undefined) continue
    count += 1
    const socket = object(candidateSocket, `node ${nodeIndex} UV_game_socket`)
    if (!nonBlank(socket['role'])) throw new TypeError(`node ${nodeIndex} socket needs a role`)
    if (socket['index'] !== undefined && (!integer(socket['index']) || socket['index'] < 0)) {
      throw new RangeError(`node ${nodeIndex} socket index is invalid`)
    }
    if (socket['sourceName'] !== undefined && typeof socket['sourceName'] !== 'string') {
      throw new TypeError(`node ${nodeIndex} socket sourceName is invalid`)
    }
    if (socket['forward'] !== undefined && !oneOf(socket['forward'], axes)) {
      throw new TypeError(`node ${nodeIndex} socket forward axis is invalid`)
    }
    if (socket['up'] !== undefined && !oneOf(socket['up'], axes)) {
      throw new TypeError(`node ${nodeIndex} socket up axis is invalid`)
    }
    const candidateIdentity = field(socket['extras'], 'modkit')
    const identity =
      candidateIdentity === undefined
        ? undefined
        : object(candidateIdentity, 'socket Modkit identity')
    if (identity !== undefined && (!nonBlank(identity['id']) || !nonBlank(identity['nodeId']))) {
      throw new TypeError(`node ${nodeIndex} socket Modkit identity is invalid`)
    }
  }
  if (count > 0 && !used.includes('UV_game_socket')) {
    throw new TypeError('UV_game_socket is not declared in extensionsUsed')
  }
  if (count === 0 && used.includes('UV_game_socket')) {
    throw new TypeError('UV_game_socket is declared but absent')
  }
}

export function validateCollisionMetadata(
  document: JsonObject,
  used: readonly JsonValue[],
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted()
  const nodes = array(document, 'nodes')
  const allowedKinds = [
    'box',
    'sphere',
    'capsule',
    'cylinder',
    'convex-hull',
    'mesh',
    'plane',
  ] as const
  let extensionCount = 0
  for (const [nodeIndex, candidate] of nodes.entries()) {
    signal?.throwIfAborted()
    const node = object(candidate, `node ${nodeIndex}`)
    const extension = field(node['extensions'], 'UV_game_collision')
    if (extension === undefined) continue
    extensionCount += 1
    if (!used.includes('UV_game_collision')) {
      throw new TypeError(`node ${nodeIndex} uses undeclared UV_game_collision`)
    }
    const collision = object(extension, `node ${nodeIndex} UV_game_collision`)
    const shapes = array(collision, 'shapes')
    if (shapes.length === 0) throw new TypeError('UV_game_collision.shapes must not be empty')
    if (
      collision['role'] !== undefined &&
      !oneOf(collision['role'], ['physics', 'hit', 'selection', 'footprint', 'effect', 'vision'])
    ) {
      throw new TypeError(`node ${nodeIndex} has an invalid collision role`)
    }
    for (const [shapeIndex, shapeCandidate] of shapes.entries()) {
      signal?.throwIfAborted()
      const label = `node ${nodeIndex} collision shape ${shapeIndex}`
      const shape = object(shapeCandidate, label)
      if (!oneOf(shape['kind'], allowedKinds)) throw new TypeError(`${label} has an invalid kind`)
      if (shape['matrix'] !== undefined && !finiteArray(shape['matrix'], 16)) {
        throw new TypeError(`${label} has an invalid matrix`)
      }
      if (
        shape['collisionMask'] !== undefined &&
        (!integer(shape['collisionMask']) || shape['collisionMask'] < 0)
      ) {
        throw new TypeError(`${label} has an invalid collisionMask`)
      }
      if (
        shape['kind'] === 'box' &&
        (!finiteArray(shape['size'], 3) || shape['size'].some(value => value <= 0))
      ) {
        throw new TypeError(`${label} has invalid box extents`)
      }
      if (shape['kind'] === 'sphere' && !(finite(shape['radius']) && shape['radius'] > 0)) {
        throw new TypeError(`${label} has an invalid radius`)
      }
      if (
        (shape['kind'] === 'capsule' || shape['kind'] === 'cylinder') &&
        (!(finite(shape['radius']) && shape['radius'] > 0) ||
          !(finite(shape['height']) && shape['height'] > 0) ||
          (shape['axis'] !== undefined && !oneOf(shape['axis'], ['x', 'y', 'z'])))
      ) {
        throw new TypeError(`${label} has invalid dimensions or axis`)
      }
      if (
        shape['kind'] === 'plane' &&
        (!finiteArray(shape['normal'], 3) || Math.hypot(...shape['normal']) <= 1e-12)
      ) {
        throw new TypeError(`${label} has an invalid normal`)
      }
      if (
        (shape['kind'] === 'convex-hull' || shape['kind'] === 'mesh') &&
        !integer(shape['positions'])
      ) {
        throw new TypeError(`${label} has an invalid positions accessor`)
      }
      if (shape['kind'] === 'mesh' && !integer(shape['indices'])) {
        throw new TypeError(`${label} has an invalid indices accessor`)
      }
    }
  }
  if (used.includes('UV_game_collision') && extensionCount === 0) {
    throw new TypeError('UV_game_collision is declared but absent from all nodes')
  }
}
