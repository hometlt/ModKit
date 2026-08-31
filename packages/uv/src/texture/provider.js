/**
 * The `common.uv/texture-materializer@1` provider.
 *
 * The same shape ADR-UV-001 chose for models, applied to textures: a typed service produces the
 * content, and the one `common.edit/writer@1` seam commits it. The reasoning transfers unchanged —
 * a `ChangeSet` cannot carry a decoded pixel region (its `semanticIntent` is `JsonValue`, so a
 * megabyte of pixels would become tens of megabytes of JSON numbers), and a `CommitReceipt` has
 * nowhere to put a scope reference, an excluded facet list or a structured diff.
 *
 * A texture materialization produces two artifacts rather than one — the KTX 2.0 container and the
 * `.uvt.json` sidecar the profile requires beside it — so `materialize` returns both and the caller
 * writes each through the writer seam. The sidecar is a description of the container, never a
 * second source of truth: every field of its `ktx2` block is a copy of a value in the file.
 *
 * The provider is a thin, session-scoped wrapper; all the format knowledge is in
 * `texture-materializer.js`, which is dependency-free and therefore equally usable from the testkit
 * harness and from a worker.
 */
import { simpleLease } from '../support.js'
import { TEXTURE_MATERIALIZER_COORDINATE, materializeUvtCore } from './materializer.js'

const OFFER_ID = 'uvt-core-materializer-v1'

/**
 * `materialize(source, request, options?)`.
 *
 * `options.digest` stays a caller-supplied function on purpose: this module has no crypto and no
 * platform built-ins, and a content digest is optional evidence rather than something a
 * materializer must manufacture.
 */
const materializer = Object.freeze({
  coordinate: TEXTURE_MATERIALIZER_COORDINATE,
  materialize(source, request, options) {
    return Promise.resolve(materializeUvtCore(source, request, options ?? {}))
  },
})

export const abiVersion = 1
export const provides = Object.freeze(['common.uv/texture-materializer'])

export function createProvider(selection) {
  if (selection.offerId !== OFFER_ID) {
    throw new TypeError(`unknown texture materializer offer ${selection.offerId}`)
  }
  return Promise.resolve(simpleLease(materializer))
}
