/**
 * Operation contract v1 — `ASSET_CAPABILITIES.md` sections 2, 3.3, and 5.
 *
 * Operations describe actions that can *actually run* for the selected source and runtime.
 * They are declared separately from traits: `content.text` does not imply `edit.text`,
 * `container.entries` does not imply repacking, and editing is gated by both codec capability
 * and source guarantees (canonical architecture, section 5, pipeline rules 5 and 7).
 *
 * "An operation declares its handler ID, permission requirements, runtime dependency,
 * mutability, input schema, and possible outputs. Disabled operations include a reason."
 */

/**
 * Operation identifiers from `ASSET_CAPABILITIES.md` section 5, in document order, followed by
 * the content-resolver operations required by canonical architecture section 5.3.
 */
export const ASSET_OPERATION_IDS = [
  'view.render',
  'view.inspect',
  'view.thumbnail',
  'view.hex',
  'media.play',
  'media.seek',
  'edit.content',
  'edit.structure',
  /**
   * Write one field of the descriptor's metadata. Domain-neutral by construction: the entry
   * declares the operation through {@link import('./descriptor.js').MetadataEditable}, and the
   * codec decides what writing means — an XML splice, a binary patch, a pixel operation.
   */
  'edit.field',
  'edit.undo-redo',
  'source.save',
  'source.save-as',
  'export.raw',
  'export.convert',
  'container.extract',
  'container.pack',
  'asset.search',
  'asset.validate',
  'asset.compare',
  // --- content-resolver operations (canonical architecture section 5.3) ------------------
  // Not yet listed in `ASSET_CAPABILITIES.md` section 5's table: that table predates the
  // `GameContentResolver` contract, whose two verbs have no representation among the
  // format-shaped IDs above. They live here rather than in a codec namespace because they are
  // domain-neutral by construction — mods, maps, campaigns, and replays all resolve a declared
  // dependency chain and mount an ordered content chain, and a host must be able to invoke the
  // same operation ID across all of them. Their value types (`ContentMount`,
  // `ContentDependency`) already live in `./content.js`.
  /** Resolve the declared dependency chain into {@link import('./content.js').ContentDependency}. */
  'content.resolve-dependencies',
  /** Mount the resolved content chain into ordered {@link import('./content.js').ContentMount}s. */
  'content.mount',
] as const

export type KnownAssetOperationId = (typeof ASSET_OPERATION_IDS)[number]

/** Open union: codecs may add dot-namespaced operations, e.g. `sc2-map.launch`. */
export type AssetOperationId = KnownAssetOperationId | (string & Record<never, never>)

export function isKnownAssetOperationId(value: string): value is KnownAssetOperationId {
  return (ASSET_OPERATION_IDS as readonly string[]).includes(value)
}

/** No `partial` state: an action either runs, is blocked, or needs a declared dependency. */
export type AssetOperationState = 'available' | 'disabled' | 'dependency-required'

/**
 * Permission classes an operation may require. Kept deliberately coarse and
 * presentation-neutral; the manifest contract (deferred slice C0) is what will bind these to
 * install-time consent.
 */
export const ASSET_PERMISSIONS = [
  'read-source',
  'write-source',
  'write-workspace',
  'network',
  'external-tool',
  'native-module',
  'launch-process',
  'clipboard',
] as const

export type KnownAssetPermission = (typeof ASSET_PERMISSIONS)[number]
export type AssetPermission = KnownAssetPermission | (string & Record<never, never>)

/**
 * An optional engine (FFmpeg, Ruffle, 7z, BasisU, vgmstream) or runtime codec the operation
 * needs. Runtimes are lazy, versioned, capability-gated artifacts injected per codec session —
 * never implicit global state (canonical architecture, section 5).
 */
export interface RuntimeDependencyRef {
  /** Stable runtime/codec ID, qualified where the coordinate is known. */
  readonly id: string
  /** SemVer range the operation was authored against. */
  readonly range?: string
  /** When true, absence downgrades rather than blocks the operation. */
  readonly optional?: boolean
}

/** Why an operation is `disabled` or `dependency-required`. Always user-explainable. */
export interface OperationUnavailableReason {
  readonly code:
    | 'read-only-source'
    | 'unsupported-variant'
    | 'runtime-unavailable'
    | 'missing-companion'
    | 'permission-required'
    | 'host-unsupported'
    | 'resource-limit'
    | 'not-implemented'
    | 'other'
  readonly message: string
  readonly diagnosticIds?: readonly string[]
}

/**
 * A *possible* output shape of an operation, as advertised in the descriptor. The produced
 * bytes are {@link import('./editing.js').AssetOutput}, which is a runtime value and never
 * part of a descriptor.
 */
export interface AssetOutputDescriptor {
  /** Stable within the operation, e.g. `png`, `catalog-xml`, `entries`. */
  readonly id: string
  readonly label?: string
  /** Role matching {@link import('./companions.js').AssetRequest.role} where applicable. */
  readonly role?: string
  readonly mediaType?: string
  /** Normalized default extension including the dot. */
  readonly extension?: string
  /** Target format ID when the output is another recognized format. */
  readonly formatId?: string
  /** True when one invocation can emit several files (extraction, texture sets, sidecars). */
  readonly multiple?: boolean
  /** True when producing this output loses data the codec could not represent. */
  readonly lossy?: boolean
}

export interface AssetOperationDescriptor {
  readonly id: AssetOperationId
  readonly state: AssetOperationState
  /** Whether running it writes back to the current source. Save As and export are `false`. */
  readonly mutatesSource: boolean
  /** Serializable input-schema description or default parameters, per operation. */
  readonly input?: unknown
  readonly outputs?: readonly AssetOutputDescriptor[]
  readonly diagnosticIds?: readonly string[]
  /**
   * Deterministic runtime handler ID resolved against the selected codec session
   * (`ASSET_CAPABILITIES.md` section 10). Defaults to {@link AssetOperationDescriptor.id}.
   * A handler function is never embedded in a descriptor.
   */
  readonly handlerId?: string
  /** Display label for command surfaces; the shell supplies a default per known operation. */
  readonly label?: string
  readonly permissions?: readonly AssetPermission[]
  readonly runtimeDependencies?: readonly RuntimeDependencyRef[]
  /** Required whenever `state` is not `available`. */
  readonly reason?: OperationUnavailableReason
  /** Whether the operation preserves fields/features the codec does not understand. */
  readonly preservesUnknownData?: boolean
  /** Whether a decode/encode cycle through this operation round-trips byte-faithfully. */
  readonly roundTripSafe?: boolean
}

export function findOperation(
  operations: readonly AssetOperationDescriptor[],
  id: AssetOperationId,
): AssetOperationDescriptor | undefined {
  return operations.find(operation => operation.id === id)
}

export function isOperationAvailable(
  operations: readonly AssetOperationDescriptor[],
  id: AssetOperationId,
): boolean {
  return findOperation(operations, id)?.state === 'available'
}

/** The handler ID a host should invoke, falling back to the operation ID itself. */
export function operationHandlerId(operation: AssetOperationDescriptor): string {
  return operation.handlerId ?? operation.id
}
