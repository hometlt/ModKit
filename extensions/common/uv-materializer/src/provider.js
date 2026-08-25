/**
 * The `common.uv/model-materializer@1` provider.
 *
 * ADR-UV-001 path B for the *content* half: a materializer takes a lazy faceted projection and a
 * semantic scope and returns bytes plus a `MaterializationReceipt`. Neither of those fits the
 * writer seam — a `ChangeSet` cannot carry typed geometry (its `semanticIntent` is `JsonValue`) and
 * an `AssetEditPlan`/`CommitReceipt` has nowhere to put a scope reference, a lost/excluded facet
 * list or a structured diff. So the service produces; the one writer seam still commits.
 *
 * The provider is a thin, session-scoped wrapper: all the format knowledge is in `materializer.js`,
 * which is dependency-free and therefore equally usable from the testkit harness and from a worker.
 */
import { simpleLease } from '@modkitx-x3/codec-kit'

import { MATERIALIZER_COORDINATE, materializeUvmCore } from './materializer.js'

const OFFER_ID = 'uvm-core-materializer-v1'

/**
 * `materialize(projection, request, options?)`.
 *
 * `options.digest` stays a caller-supplied function on purpose: this module has no crypto and no
 * platform built-ins, and a content digest is optional evidence rather than something a
 * materializer must manufacture.
 */
const materializer = Object.freeze({
  coordinate: MATERIALIZER_COORDINATE,
  materialize(projection, request, options) {
    return Promise.resolve(materializeUvmCore(projection, request, options ?? {}))
  },
})

export const abiVersion = 1
export const provides = Object.freeze(['common.uv/model-materializer'])

export function createProvider(selection) {
  if (selection.offerId !== OFFER_ID) {
    throw new TypeError(`unknown materializer offer ${selection.offerId}`)
  }
  return Promise.resolve(simpleLease(materializer))
}
