import type { JsonObject } from '@modkit/sdk'
import { array, field, object } from './values.js'
import { snapshotModelBillboards, type ModelBillboardConstraint } from '../model/billboards.js'
export const UVM_NODE_BILLBOARD = 'UV_node_billboard'
/** Node constraint is executable common scene data; native flags and source extras are never read. */
export function readUvmBillboards(
  document: JsonObject,
  maxBytes: number,
  signal?: AbortSignal,
): readonly ModelBillboardConstraint[] {
  signal?.throwIfAborted()
  const nodes = array(document, 'nodes'),
    values: ModelBillboardConstraint[] = []
  let bytes = 0
  for (const [index, node] of nodes.entries()) {
    signal?.throwIfAborted()
    const raw = field(field(node, 'extensions'), UVM_NODE_BILLBOARD)
    if (raw === undefined) continue
    bytes += 512
    if (bytes > maxBytes) throw new RangeError('UVM billboard constraints exceed byte budget')
    const value = object(raw, 'node billboard')
    if (value['schemaVersion'] === 1 && value['mode'] === 'inverse-camera') {
      if (Object.keys(value).some(key => !['schemaVersion', 'mode', 'basisRotations'].includes(key)))
        throw new TypeError('unsupported UVM node billboard')
      values.push({
        nodeId: `node-${index}`,
        mode: 'inverse-camera',
        basisRotations: value['basisRotations'],
      } as unknown as ModelBillboardConstraint)
    } else if (value['schemaVersion'] === 1 && value['mode'] === 'face-camera') {
      if (
        Object.keys(value).some(
          key => !['schemaVersion', 'mode', 'rotationAxes', 'pivot'].includes(key),
        )
      ) throw new TypeError('unsupported UVM node billboard')
      values.push({
        nodeId: `node-${index}`,
        mode: 'face-camera',
        rotationAxes: value['rotationAxes'],
        pivot: value['pivot'],
      } as unknown as ModelBillboardConstraint)
    } else if (value['schemaVersion'] === 1 && value['mode'] === 'aim') {
      if (
        Object.keys(value).some(
          key =>
            !['schemaVersion', 'mode', 'aim', 'lock', 'correction', 'rootCorrection'].includes(key),
        )
      )
        throw new TypeError('unsupported UVM node billboard')
      values.push({
        nodeId: `node-${index}`,
        mode: 'aim',
        aim: value['aim'],
        lock: value['lock'],
        ...(value['correction'] === undefined ? {} : { correction: value['correction'] }),
        ...(value['rootCorrection'] === undefined ? {} : { rootCorrection: value['rootCorrection'] }),
      } as unknown as ModelBillboardConstraint)
    } else throw new TypeError('unsupported UVM node billboard')
  }
  if (values.length > 0 && !array(document, 'extensionsUsed').includes(UVM_NODE_BILLBOARD))
    throw new TypeError('UVM node billboard declaration absent')
  return snapshotModelBillboards(values, maxBytes, signal)
}
