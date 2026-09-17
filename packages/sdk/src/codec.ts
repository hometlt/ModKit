/**
 * The runtime the codec side of this SDK actually needs: two functions.
 *
 * Everything else a codec takes from `@modkit/sdk` is a type, and types cost nothing at runtime —
 * but the root barrel does: it evaluates every schema, contract registry, language, knowledge,
 * runtime and renderer module, ~45 ms in a fresh worker, once per codec activation. Against ~15 ms
 * for the two modules behind these two functions.
 *
 * Types stay on the root barrel, where they belong. Only value imports move here, and the list is
 * meant to stay this short: an addition is a claim that codec runtimes need it.
 */
export { revisionId } from './asset-capabilities/types.js'
export { toPortableProjectionReceipt } from './asset-capabilities/uv-projection.js'
