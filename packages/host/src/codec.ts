/**
 * The three host helpers a codec runtime needs, and nothing else.
 *
 * `@modkit/codec-kit` used to reach them through this package's root barrel, which meant every
 * codec activation — in a fresh worker, with an empty module cache — evaluated the whole host:
 * measured at ~106 ms against ~8 ms for these two modules, on every open of every file. A codec
 * does not compose a host, so it has no business importing one.
 *
 * Kept deliberately narrow: an addition here is a claim that codec runtimes need it.
 */
export { assembleSubjectDescriptor, createAssetSession } from './session.js'
export type { AssetSessionOptions, HostOperationHandler, ManagedAssetSession } from './session.js'
export { createUtf8TextDataSource } from './data-sources.js'
