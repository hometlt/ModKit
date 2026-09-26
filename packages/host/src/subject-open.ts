/** Host-owned file opening pipeline. No application or codec may bypass this composition root. */

import type { CredentialBroker } from './credentials.js'
import {
  canonicalJsonStringify,
  compareUtf8,
  diagnostic,
  isModkitError,
  ModkitError,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
import {
  CODEC_CONTRIBUTION_CONTRACT,
  grantValidity,
  type AnyDescriptor,
  type AnyDescriptorWire,
  type ArtifactByteSource,
  type ArtifactNamespaceSource,
  type ArtifactSource,
  type AssetNamespace,
  type AssetNamespaceEntry,
  type AssetInput,
  type AssetInputPlan,
  type AssetSession,
  type Codec,
  type CodecContributionSpecV1Wire,
  type SignatureRule,
  type ContributionContext,
  type ContributionSettings,
  type ContractResolverPort,
  type DetectionResult,
  type DetectionResultWire,
  type HostPolicy,
  type Lease,
  type NamespaceProbePlan,
  type OpenIntent,
  type OperationResult,
  type OperationSession,
  type PermissionClass,
  type PermissionGrant,
  type ProviderOffer,
  type ProviderPolicyLockEntry,
  type ProviderRequest,
  type ModelResourcePort,
  type RasterResourcePort,
  type ResourceBudget,
  type ResourceSessionPort,
  type RuntimeTarget,
  type ServiceContractDefinitionRegistry,
  type SelectedServiceOffer,
  type VideoFrameDecoder,
} from '@modkit/sdk'
import { DATA_CATALOG_ENTITIES_INPUT, type JsonValue } from '@modkit/sdk'
import {
  answerCatalogQueries,
  operationCatalogQueries,
  subjectCatalogEntities,
  type CatalogEntities,
  type SubjectCatalogOptions,
} from './catalog-questions.js'
import { inventoryRecordFor, type Inventory, type InventoryContribution } from './inventory.js'
import { activateServiceProvider, serviceTargetFor } from './service-leases.js'
import { offersFromInventory } from './offers.js'
import {
  buildCodecDetectionSelection,
  serializeCodecDetectionSelection,
} from './detection-selection.js'
import { buildLockEntry, parsePolicyLock, serializePolicyLock } from './resolution/lock.js'
import {
  createContractResolverPort,
  type FacetAwareProviderRequest,
} from './resolution/service-resolver.js'
import {
  activateContribution,
  permissionDegradedDiagnostic,
  PROBE_OPERATION,
  PROBE_PERMISSION_CLASSES,
  resolveForActivation,
  type ActivationTicket,
} from './security/gate.js'
import { DEFAULT_EXECUTION_BACKENDS, type ExecutionBackendRegistry } from './execution/backend.js'
import { releaseCodec } from './execution/consumer-adapters.js'
import { matchesSignatures, signatureNeeds, type SignatureWindows } from './detection-index.js'
import { assembleSubjectDescriptor } from './session.js'
import {
  createSubjectRasterResources,
  type RasterCompanionRule,
  type SubjectRasterResourceState,
} from './raster-resources.js'
import {
  createSubjectLogicalResources,
  snapshotLogicalResourceDiscoveryPolicies,
  type HostLogicalResourceDiscoveryPolicy,
  type SubjectLogicalResourceState,
} from './logical-resources.js'
import { createContainerNamespaceComposition } from './container-composition.js'
import {
  DEFAULT_RESOURCE_SESSION_LIMITS,
  type ResourceSessionLimits,
  type ResourceSessionOptions,
} from './resource-session.js'

const DEFAULT_MINIMUM_CONFIDENCE = 0.5
const DEFAULT_MAX_CANDIDATES = 64

export type SubjectOpenCandidateState = 'rejected' | 'detected' | 'selected'

export interface SubjectOpenCandidateExplanation {
  readonly contributionId: string
  readonly extensionId: string
  readonly variantId: string
  /** Declared formats for this actual candidate; retained for fail-closed host receipts. */
  readonly formatIds: readonly string[]
  readonly offerId?: string
  readonly state: SubjectOpenCandidateState
  readonly confidence?: number
  readonly diagnostics: readonly Diagnostic[]
}

export interface SubjectInputResolutionContext {
  readonly source: ArtifactSource
  readonly plan: AssetInputPlan
  readonly detection: DetectionResult
  readonly signal?: AbortSignal
}

/** Host-owned companion/namespace resolver. The default handles direct single and namespace roots. */
export interface SubjectInputResolver {
  (context: SubjectInputResolutionContext): AssetInput | Promise<AssetInput>
  /** Same closed host origin, separate post-open leases. No enumeration handle crosses this API. */
  openResources?(options: Omit<ResourceSessionOptions, 'origin'>): ResourceSessionPort
}

export interface OpenSubjectOptions {
  readonly inventory: Inventory
  readonly source: ArtifactSource
  readonly path?: string
  readonly mediaType?: string
  readonly intent: Exclude<OpenIntent, 'probe'>
  readonly target: RuntimeTarget
  readonly grant: PermissionGrant
  readonly policy?: HostPolicy
  readonly executionBackends?: ExecutionBackendRegistry
  readonly budget: ResourceBudget
  readonly serviceDefinitions?: ServiceContractDefinitionRegistry
  readonly resolveInput?: SubjectInputResolver
  /** Borrowed post-open origin for a scoped child. Parent owns disposal; no pre-open input authority is added. */
  readonly resourceSession?: ResourceSessionPort
  /** Host ceilings for resources discovered after open; narrowed by the effective codec budget. */
  readonly resourceLimits?: Partial<ResourceSessionLimits>
  /** Registered host-owned discovery closures; codecs receive only role/extension requests. */
  readonly logicalResourceDiscovery?: readonly HostLogicalResourceDiscoveryPolicy[]
  /**
   * The host's settings for a contribution, asked for by id when one is activated. A codec that
   * knows a setting reads it from its context; one that does not is unaffected.
   */
  readonly contributionSettings?: (contributionId: string) => ContributionSettings | undefined
  /** Nested raster decoding cannot recursively acquire another subject raster decoder. */
  readonly provideRasterResources?: boolean
  /** The desktop host's video frame decoder, handed to codecs as `context.videoFrames`. */
  readonly videoFrames?: VideoFrameDecoder
  /** The sign-in and key broker; each codec gets its extension's port as `context.credentials`. */
  readonly credentials?: CredentialBroker
  /** What the enclosing container hands this subject's codec (`context.containerContext`). */
  readonly containerContext?: JsonValue
  /**
   * Where the subject's catalog questions are answered: an operation that names the entities it
   * needs (`catalogQueries`) is invoked again with them from the subject's mod context. Absent, an
   * operation answers with what it has.
   */
  readonly subjectCatalog?: SubjectCatalogOptions
  readonly minimumConfidence?: number
  readonly maxCandidates?: number
  readonly signal?: AbortSignal
}

export interface OpenedSubject {
  readonly state: 'opened'
  readonly session: AssetSession
  /**
   * Lazy resources from the same host-owned origin as resolveInput. Available with read-source;
   * disposed with session. A codec receives only its input, never this origin or port.
   */
  readonly resources?: ResourceSessionPort
  /**
   * Subject-bound image decoding over the same confined post-open origin.
   *
   * This is intentionally narrower than `resources`: consumers can ask for a logical image and
   * receive bounded pixels, but they never select a codec or manufacture a filesystem path.
   */
  readonly rasterResources?: RasterResourcePort
  readonly descriptor: AnyDescriptor
  readonly ticket: ActivationTicket
  /** Codec detection provenance is not a provider-policy lock entry. */
  readonly detectionSelectionText: string
  readonly lockText: string
  readonly selected: {
    readonly extensionId: string
    readonly contributionId: string
    readonly variantId: string
    readonly offerId: string
    readonly confidence: number
  }
  readonly candidates: readonly SubjectOpenCandidateExplanation[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface UnresolvedSubject {
  readonly state: 'unresolved'
  readonly reason: 'no-candidate' | 'no-match' | 'ambiguous' | 'input-unresolved'
  readonly descriptor: AnyDescriptor
  readonly fallback: {
    readonly preferred: 'text' | 'hex' | 'none'
    readonly available: readonly ('text' | 'hex')[]
  }
  readonly candidates: readonly SubjectOpenCandidateExplanation[]
  readonly diagnostics: readonly Diagnostic[]
}

export type OpenSubjectResult = OpenedSubject | UnresolvedSubject

const WORKER_REFUSAL_CODES = new Set([
  'x3.host/artifact-digest-mismatch',
  'x3.host/rpc-deadline-exceeded',
  'x3.host/rpc-peer-exited',
  'x3.host/worker-crashed',
  'x3.host/worker-restart-limit',
])

/**
 * A candidate whose worker ran out of time or memory (or whose artifact changed on disk) is only
 * "rejected" in its own explanation; lifted to the subject, the refusal says why nothing opened
 * instead of a bare `no-match`.
 */
function workerRefusals(
  explanations: readonly SubjectOpenCandidateExplanation[],
): readonly Diagnostic[] {
  return explanations.flatMap(explanation =>
    explanation.state !== 'rejected'
      ? []
      : explanation.diagnostics
          .filter(item => WORKER_REFUSAL_CODES.has(item.code))
          .map(item => ({
            code: 'x3.host/subject-open-worker-refused',
            severity: 'error' as const,
            message: `${explanation.contributionId} could not examine this subject in its worker: ${item.message}`,
            data: { contributionId: explanation.contributionId, cause: item.code },
          })),
  )
}

interface RunnableCandidate {
  readonly contribution: InventoryContribution
  readonly extensionId: string
  readonly contributionId: string
  readonly spec: CodecContributionSpecV1Wire
  readonly offer: ProviderOffer
  readonly logicalOffer: ProviderOffer['provides'][number]
  /** NXT-101B: admitted by a declared byte signature (name/media/path rules did not match). */
  readonly viaSignature: boolean
}

interface SubjectOpenRoute {
  /** A semantic alias resolves late resources inside its retained carrier namespace. */
  readonly openResources?: NonNullable<SubjectInputResolver['openResources']>
  /** Restrict a byte open to the exact carrier provider selected by a namespace alias. */
  readonly containerProviderFormatId?: string
  /** Admit only namespace aliases bound to this already-open carrier format. */
  readonly containerAliasFormatId?: string
  /** Preserve the exact path/media selector match that initiated container composition. */
  readonly containerAliasContributionIds?: ReadonlySet<string>
  /** Container choice is a host policy dependency and is included in the composed lock. */
  readonly includeSelectionLock?: boolean
}

interface DetectedCandidate extends RunnableCandidate {
  /** Mutable across the probe → open re-activation (R5): the open phase swaps these. */
  ticket: ActivationTicket
  codec: Codec
  resources: AsyncReleaseScope
  activationDiagnostics: readonly Diagnostic[]
  /** The narrowed grant the codec runs under; host-side operation gating reads it (ADR-HOST-002 §2). */
  effectiveGrant: PermissionGrant
  readonly detection: DetectionResult
  readonly effectiveBudget: ResourceBudget
  readonly nestedLocks: ProviderPolicyLockEntry[]
  readonly rasterState: SubjectRasterResourceState
  readonly logicalState: SubjectLogicalResourceState
  /** The pinned request that resolved this candidate; the open phase re-resolves with it. */
  readonly request: ProviderRequest
  /** Builds a ContributionContext bound to this candidate's *current* resource scope. */
  readonly makeContext: (
    grant: PermissionGrant,
    chain: readonly string[],
    contributionId?: string,
  ) => ContributionContext
  /**
   * R5: the variant requests classes beyond the probe set, so the probe ran under a narrower
   * child grant and the winner must be re-activated under the caller grant before open.
   */
  readonly probeScoped: boolean
  readonly selectionLock?: ProviderPolicyLockEntry
}

interface AsyncReleaseScope {
  add(release: () => void | Promise<void>): void
  release(): Promise<void>
}

function createReleaseScope(): AsyncReleaseScope {
  const releases: (() => void | Promise<void>)[] = []
  let released = false
  return {
    add(release): void {
      if (released) {
        throw new ModkitError({
          code: 'x3.host/resource-scope-closed',
          message: 'cannot retain a resource after its host scope was released',
        })
      }
      releases.push(release)
    },
    async release(): Promise<void> {
      if (released) return
      released = true
      let firstError: unknown
      for (const release of releases.reverse()) {
        try {
          await release()
        } catch (error) {
          firstError ??= error
        }
      }
      if (firstError !== undefined) throw firstError
    },
  }
}

async function releaseCandidate(
  candidate: DetectedCandidate,
  diagnostics: Diagnostic[],
): Promise<void> {
  try {
    await candidate.resources.release()
  } catch (error) {
    diagnostics.push(caughtDiagnostic('cleanup', error))
  }
}

/**
 * ADR-HOST-002 §2: the host checks an operation's required classes (the manifest's declaration,
 * plus `write-source` for a mutating one) against the narrowed grant the codec runs under, before
 * the call reaches the codec — whatever the codec's own session says.
 */
function gatedOperations(
  session: AssetSession,
  spec: CodecContributionSpecV1Wire,
  grant: PermissionGrant,
  catalog?: CatalogEntities,
): OperationSession {
  const inner = session.operations()
  const required = new Map<string, readonly PermissionClass[]>()
  for (const operation of spec.operations) {
    required.set(operation.handlerId, [
      ...(operation.requiredPermissions ?? []),
      ...(operation.mutatesSource ? (['write-source'] as const) : []),
    ])
  }
  const gated: OperationSession = {
    async invoke(handlerId, input, invokeOptions): Promise<OperationResult> {
      const needed = required.get(handlerId) ?? []
      const validity = grantValidity(grant)
      const missing = needed.filter(item => !grant.classes.includes(item))
      if (validity.state !== 'valid' || missing.length > 0) {
        return {
          state: 'rejected',
          reason: 'permission-missing',
          diagnostics: [
            diagnostic(
              'error',
              'x3.host/permission-missing',
              validity.state === 'valid'
                ? `operation ${handlerId} requires classes the grant does not hold: ${missing.join(', ')}`
                : 'the grant the codec runs under is not valid',
              [handlerId],
              { missing },
            ),
          ],
        }
      }
      const first = await inner.invoke(handlerId, input, invokeOptions)
      const options = input === null || input === undefined ? {} : input
      if (
        catalog === undefined ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        operationCatalogQueries(first).length === 0
      ) {
        return first
      }
      try {
        return await answerCatalogQueries({
          run: (entities, round) =>
            round === 0 || entities === undefined
              ? Promise.resolve(first)
              : inner.invoke(
                  handlerId,
                  { ...options, [DATA_CATALOG_ENTITIES_INPUT]: entities as unknown as JsonValue },
                  invokeOptions,
                ),
          queriesOf: operationCatalogQueries,
          catalogEntities: catalog,
          rounds: OPERATION_CATALOG_ROUNDS,
          ...(invokeOptions?.signal === undefined ? {} : { signal: invokeOptions.signal }),
        })
      } catch (error) {
        invokeOptions?.signal?.throwIfAborted()
        return {
          ...first,
          diagnostics: [
            ...first.diagnostics,
            diagnostic(
              'warning',
              'x3.host/subject-catalog-unavailable',
              `the subject's catalog could not answer ${handlerId}: ${error instanceof Error ? error.message : String(error)}`,
              [handlerId],
            ),
          ],
        }
      }
    },
    dispose: () => inner.dispose(),
  }
  return Object.freeze(gated)
}

/** Rounds of catalog questions one operation may ask. */
const OPERATION_CATALOG_ROUNDS = 4

function sessionWithResources(
  session: AssetSession,
  resources: AsyncReleaseScope,
  gating?: {
    readonly spec: CodecContributionSpecV1Wire
    readonly grant: PermissionGrant
    readonly catalog?: CatalogEntities
  },
  beforeDispose?: () => void,
  models?: ModelResourcePort,
): AssetSession {
  let disposed = false
  const operations =
    gating === undefined
      ? undefined
      : gatedOperations(session, gating.spec, gating.grant, gating.catalog)
  return Object.freeze({
    revision: session.revision,
    state: () => session.state(),
    descriptor: () => session.descriptor(),
    dataSource:
      models === undefined
        ? (session.dataSource.bind(session) as AssetSession['dataSource'])
        : subjectModelDataSources(session.dataSource.bind(session), models),
    operations: () => operations ?? session.operations(),
    events: (signal?: AbortSignal) => session.events(signal),
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      beforeDispose?.()
      let firstError: unknown
      try {
        await session.dispose()
      } catch (error) {
        firstError = error
      }
      try {
        await resources.release()
      } catch (error) {
        firstError ??= error
      }
      if (firstError !== undefined) throw firstError
    },
  })
}

function errorDiagnostic(code: string, message: string, error?: unknown): Diagnostic {
  return diagnostic('error', code, message, [], {
    ...(error === undefined
      ? {}
      : { error: error instanceof Error ? error.message : String(error) }),
    // Typed errors carry JSON context (e.g. descriptor validation findings); dropping it hides the cause.
    ...(isModkitError(error) && error.context !== undefined ? { context: error.context } : {}),
  })
}

function caughtDiagnostic(stage: string, error: unknown): Diagnostic {
  const detail = error instanceof Error ? error.message : String(error)
  // A foreign error has already crossed an execution boundary without a domain code. At this
  // layer the missing operation is known, so retaining only `rpc-foreign-error` would hide the
  // actionable step from every app surface. Preserve genuinely typed Modkit errors; re-type only
  // this transport fallback as the subject stage that failed.
  const typed = isModkitError(error) && error.code !== 'x3.host/rpc-foreign-error'
  return errorDiagnostic(
    typed ? error.code : `x3.host/subject-${stage}-failed`,
    typed ? error.message : `subject ${stage} failed closed: ${detail}`,
    error,
  )
}

function normalizeTarget(target: RuntimeTarget, grant: PermissionGrant): RuntimeTarget {
  return JSON.parse(
    canonicalJsonStringify({
      ...target,
      grantedPermissions: [
        ...new Set([...(target.grantedPermissions ?? []), ...grant.classes]),
      ].sort(compareUtf8),
    }),
  ) as RuntimeTarget
}

function matchesGlob(path: string, glob: string): boolean {
  let pattern = '^'
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]
    if (character === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          // `**/name` means "at any depth", including the subject root itself.
          pattern += '(?:.*/)?'
          index += 2
        } else {
          pattern += '.*'
          index += 1
        }
      } else {
        pattern += '[^/]*'
      }
    } else if (character === '?') {
      pattern += '[^/]'
    } else {
      pattern += character?.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&') ?? ''
    }
  }
  return new RegExp(`${pattern}$`, 'u').test(path)
}

function matchesSpec(spec: CodecContributionSpecV1Wire, path: string, mediaType?: string): boolean {
  const normalizedPath = path.replaceAll('\\', '/').split(/[?#]/u, 1)[0]?.toLocaleLowerCase() ?? ''
  const extensionMatch = (spec.match.extensions ?? []).some(extension => {
    const suffix = extension.toLocaleLowerCase().replace(/^\.+/u, '')
    return normalizedPath.endsWith(`.${suffix}`) || normalizedPath === suffix
  })
  const mediaMatch =
    mediaType !== undefined &&
    (spec.match.mediaTypes ?? []).some(candidate => candidate === mediaType)
  const pathMatch = (spec.match.pathGlobs ?? []).some(glob =>
    matchesGlob(normalizedPath, glob.toLocaleLowerCase()),
  )
  const declaresMatch =
    (spec.match.extensions?.length ?? 0) > 0 ||
    (spec.match.mediaTypes?.length ?? 0) > 0 ||
    (spec.match.pathGlobs?.length ?? 0) > 0
  // An empty rule set is not a wildcard. Universal detection needs an explicit, schema-owned
  // declaration; otherwise an installed codec could force activation for every opened artifact.
  return declaresMatch && (extensionMatch || mediaMatch || pathMatch)
}

/** R5: does the variant request anything beyond what a probe may hold? */
/**
 * R5: the probe runs under the probe-scoped child grant; re-activation before open is needed
 * exactly when the open grant would be wider — the variant requests classes beyond the probe set
 * *and* the caller's grant actually holds one of them. A caller holding only `read-source`
 * opens a codec that also requests `write-source` (ADR-HOST-002 §2, degraded) on the probe
 * realm itself: its child grant is already the open grant.
 */
function variantRequestsBeyondProbe(
  requested: readonly string[],
  callerGrant?: PermissionGrant,
): boolean {
  return requested.some(
    item =>
      !(PROBE_PERMISSION_CLASSES as readonly string[]).includes(item) &&
      (callerGrant === undefined || callerGrant.classes.includes(item as PermissionClass)),
  )
}

/**
 * NXT-101B: the two bounded reads that feed the signature shortlist. Sized by the declared needs
 * of the inventory's codec contributions; nothing is read when nothing is declared.
 */
async function readSignatureWindows(
  options: OpenSubjectOptions,
): Promise<SignatureWindows | undefined> {
  if (options.source.kind !== 'bytes') return undefined
  const ruleSets: (readonly SignatureRule[])[] = []
  for (const extension of options.inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (
        !contribution.activationEligible ||
        manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT ||
        manifest.contract.major !== 1
      ) {
        continue
      }
      const signatures = (manifest.spec as unknown as CodecContributionSpecV1Wire).match.signatures
      if (signatures !== undefined && signatures.length > 0) ruleSets.push(signatures)
    }
  }
  const needs = signatureNeeds(ruleSets)
  if (needs.prefix === 0 && needs.suffix === 0) return undefined
  const size = options.source.size
  // a source that does not know its size cannot anchor end signatures and gets no windows —
  // candidates still enter through their name/media/path rules, nothing regresses
  if (size === undefined) return undefined
  const headLength = Number(size < BigInt(needs.prefix) ? size : BigInt(needs.prefix))
  const head =
    headLength === 0 ? new Uint8Array(0) : await options.source.read(0n, headLength, options.signal)
  const tailLength = Number(size < BigInt(needs.suffix) ? size : BigInt(needs.suffix))
  const tail =
    tailLength === 0
      ? new Uint8Array(0)
      : await options.source.read(size - BigInt(tailLength), tailLength, options.signal)
  return { head, tail, size }
}

function runtimeBudget(host: ResourceBudget, spec: CodecContributionSpecV1Wire): ResourceBudget {
  const deadline =
    host.deadlineMs === undefined
      ? spec.budgets.deadlineMs
      : spec.budgets.deadlineMs === undefined
        ? host.deadlineMs
        : Math.min(host.deadlineMs, spec.budgets.deadlineMs)
  return Object.freeze({
    maxInputBytes:
      host.maxInputBytes < BigInt(spec.budgets.maxInputBytes)
        ? host.maxInputBytes
        : BigInt(spec.budgets.maxInputBytes),
    maxDepth: Math.min(host.maxDepth, spec.budgets.maxDepth),
    maxNodes: Math.min(host.maxNodes, spec.budgets.maxNodes),
    maxScalarBytes: Math.min(host.maxScalarBytes, spec.budgets.maxScalarBytes),
    maxDiagnostics: Math.min(host.maxDiagnostics, spec.budgets.maxDiagnostics),
    ...(deadline === undefined ? {} : { deadlineMs: deadline }),
  })
}

function boundedProbeSource(
  source: ArtifactByteSource,
  plan: Extract<CodecContributionSpecV1Wire['probe'], { kind: 'bytes' }>,
): ArtifactByteSource {
  let consumed = 0n
  const maximum = BigInt(plan.maxBytes)
  const ranges = plan.ranges.map(range => {
    const length = BigInt(range.length)
    if (range.from === 'start') return { start: 0n, end: length }
    if (source.size === undefined) {
      throw new ModkitError({
        code: 'x3.host/end-relative-probe-requires-size',
        message: 'an end-relative probe range requires a sized source',
      })
    }
    return { start: source.size > length ? source.size - length : 0n, end: source.size }
  })
  const authorize = (offset: bigint, length: bigint) => {
    if (offset < 0n || length < 0n) {
      throw new ModkitError({
        code: 'x3.host/probe-range-violation',
        message: 'codec requested a negative probe range',
      })
    }
    const end = offset + length
    if (!ranges.some(range => offset >= range.start && end <= range.end)) {
      throw new ModkitError({
        code: 'x3.host/probe-range-violation',
        message: 'codec read outside its declared probe ranges',
        context: { offset: offset.toString(), length: length.toString() },
      })
    }
    if (consumed + length > maximum) {
      throw new ModkitError({
        code: 'x3.host/probe-budget-exceeded',
        message: `codec exceeded its declared ${plan.maxBytes}-byte probe budget`,
      })
    }
    consumed += length
  }
  return Object.freeze({
    ...source,
    async read(offset: bigint, length: number, signal?: AbortSignal) {
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new ModkitError({
          code: 'x3.host/probe-range-violation',
          message: 'codec requested a non-safe probe length',
        })
      }
      authorize(offset, BigInt(length))
      return source.read(offset, length, signal)
    },
    async *stream(
      range?: { readonly offset: bigint; readonly length?: bigint },
      signal?: AbortSignal,
    ) {
      if (range?.length === undefined) {
        throw new ModkitError({
          code: 'x3.host/unbounded-probe-stream',
          message: 'codec probe streams require an explicit bounded range',
        })
      }
      authorize(range.offset, range.length)
      let received = 0n
      for await (const chunk of source.stream(range, signal)) {
        received += BigInt(chunk.byteLength)
        if (received > range.length) {
          throw new ModkitError({
            code: 'x3.host/probe-stream-overrun',
            message: 'probe source returned more bytes than the requested range',
          })
        }
        yield chunk
      }
    },
  })
}

const NAMESPACE_PATH_ENCODER = new TextEncoder()

function normalizeNamespaceProbePath(path: string, plan: NamespaceProbePlan): string {
  if (path.includes('\0')) {
    throw new ModkitError({
      code: 'x3.host/namespace-probe-path-refused',
      message: 'namespace probe paths may not contain NUL bytes',
      context: { path },
    })
  }
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      throw new ModkitError({
        code: 'x3.host/namespace-probe-path-refused',
        message: 'namespace probe paths may not escape their subject root',
        context: { path },
      })
    }
    parts.push(part)
  }
  const normalized = parts.join('/')
  const pathBytes = NAMESPACE_PATH_ENCODER.encode(normalized).byteLength
  if (normalized === '' || parts.length > plan.maxDepth || pathBytes > plan.maxPathBytes) {
    throw new ModkitError({
      code: 'x3.host/namespace-probe-path-budget-exceeded',
      message: 'namespace probe marker exceeds its declared path budget',
      context: {
        path,
        depth: parts.length,
        maxDepth: plan.maxDepth,
        pathBytes,
        maxPathBytes: plan.maxPathBytes,
      },
    })
  }
  return normalized
}

function boundedNamespaceProbeSource(
  source: ArtifactNamespaceSource,
  plan: NamespaceProbePlan,
): ArtifactNamespaceSource {
  if (plan.markers.length > plan.maxEntries) {
    throw new ModkitError({
      code: 'x3.host/namespace-probe-entry-budget-exceeded',
      message: 'namespace probe declares more markers than its entry budget permits',
      context: { markers: plan.markers.length, maxEntries: plan.maxEntries },
    })
  }
  const markers = new Set(plan.markers.map(path => normalizeNamespaceProbePath(path, plan)))
  if (markers.size !== plan.markers.length) {
    throw new ModkitError({
      code: 'x3.host/namespace-probe-marker-duplicate',
      message: 'namespace probe marker paths must be unique after normalization',
    })
  }
  const prefixes = new Set(
    (plan.prefixes ?? []).map(path => normalizeNamespaceProbePath(path, plan)),
  )
  if (prefixes.size !== (plan.prefixes?.length ?? 0)) {
    throw new ModkitError({
      code: 'x3.host/namespace-probe-prefix-duplicate',
      message: 'namespace probe prefixes must be unique after normalization',
    })
  }
  let consumedEntries = 0
  let consumedBytes = 0n
  const maximumBytes = BigInt(plan.maxBytes)
  const consume = (length: bigint): void => {
    if (length < 0n || consumedBytes + length > maximumBytes) {
      throw new ModkitError({
        code: 'x3.host/namespace-probe-byte-budget-exceeded',
        message: `namespace probe exceeded its declared ${plan.maxBytes}-byte budget`,
        context: { consumedBytes: String(consumedBytes), requestedBytes: String(length) },
      })
    }
    consumedBytes += length
  }
  const guardMarkerSource = (marker: string, value: ArtifactSource): ArtifactSource => {
    if (value.kind === 'namespace') {
      return Object.freeze({
        ...value,
        async openNamespace(): Promise<Lease<AssetNamespace>> {
          throw new ModkitError({
            code: 'x3.host/namespace-probe-traversal-refused',
            message: `namespace probe marker «${marker}» is opaque; traversal is forbidden`,
            context: { marker },
          })
        },
      })
    }
    return Object.freeze({
      ...value,
      async read(offset: bigint, length: number, signal?: AbortSignal) {
        if (!Number.isSafeInteger(length) || length < 0) {
          throw new ModkitError({
            code: 'x3.host/namespace-probe-range-refused',
            message: 'namespace probe marker reads require a non-negative safe length',
            context: { marker, offset: String(offset), length },
          })
        }
        consume(BigInt(length))
        return value.read(offset, length, signal)
      },
      async *stream(
        range?: { readonly offset: bigint; readonly length?: bigint },
        signal?: AbortSignal,
      ) {
        if (range?.length === undefined) {
          throw new ModkitError({
            code: 'x3.host/namespace-probe-unbounded-stream-refused',
            message: 'namespace probe marker streams require an explicit length',
            context: { marker },
          })
        }
        consume(range.length)
        yield* value.stream(range, signal)
      },
    })
  }
  return Object.freeze({
    ...source,
    async openNamespace(signal?: AbortSignal): Promise<Lease<AssetNamespace>> {
      const lease = await source.openNamespace(signal)
      const guarded: AssetNamespace = Object.freeze({
        revision: lease.value.revision,
        async *list(prefix: string, listSignal?: AbortSignal): AsyncIterable<AssetNamespaceEntry> {
          throwIfAborted(listSignal)
          if (prefixes.size === 0) {
            throw new ModkitError({
              code: 'x3.host/namespace-probe-traversal-refused',
              message:
                'namespace enumeration is forbidden unless the codec declares probe prefixes',
            })
          }
          const normalized = normalizeNamespaceProbePath(prefix, plan)
          if (!prefixes.has(normalized)) {
            throw new ModkitError({
              code: 'x3.host/namespace-probe-prefix-refused',
              message: `codec attempted to enumerate undeclared namespace prefix «${normalized}»`,
              context: { prefix: normalized, prefixes: [...prefixes] },
            })
          }
          for await (const entry of lease.value.list(normalized, listSignal)) {
            throwIfAborted(listSignal)
            const entryPath = normalizeNamespaceProbePath(entry.path, plan)
            if (entryPath !== normalized && !entryPath.startsWith(`${normalized}/`)) {
              throw new ModkitError({
                code: 'x3.host/namespace-probe-prefix-escape',
                message: `namespace probe entry «${entryPath}» escaped prefix «${normalized}»`,
                context: { prefix: normalized, path: entryPath },
              })
            }
            consumedEntries += 1
            if (consumedEntries > plan.maxEntries) {
              throw new ModkitError({
                code: 'x3.host/namespace-probe-entry-budget-exceeded',
                message: `namespace probe exceeded its declared ${plan.maxEntries}-entry budget`,
              })
            }
            yield Object.freeze({ ...entry, path: entryPath })
          }
        },
        async open(path: string, openSignal?: AbortSignal): Promise<Lease<ArtifactSource>> {
          const normalized = normalizeNamespaceProbePath(path, plan)
          if (!markers.has(normalized)) {
            throw new ModkitError({
              code: 'x3.host/namespace-probe-path-refused',
              message: `codec attempted to inspect undeclared namespace marker «${normalized}»`,
              context: { path: normalized, markers: [...markers] },
            })
          }
          consumedEntries += 1
          if (consumedEntries > plan.maxEntries) {
            throw new ModkitError({
              code: 'x3.host/namespace-probe-entry-budget-exceeded',
              message: `namespace probe exceeded its declared ${plan.maxEntries}-entry budget`,
            })
          }
          const opened = await lease.value.open(normalized, openSignal)
          return Object.freeze({
            value: guardMarkerSource(normalized, opened.value),
            release: () => opened.release(),
          })
        },
      })
      return Object.freeze({ value: guarded, release: () => lease.release() })
    },
  })
}

async function probeCodec(
  codec: Codec,
  source: ArtifactSource,
  probe: CodecContributionSpecV1Wire['probe'],
  signal?: AbortSignal,
): Promise<DetectionResult> {
  if (source.kind === 'bytes' && probe.kind === 'bytes') {
    return codec.probe({ source: boundedProbeSource(source, probe), plan: probe }, signal)
  }
  if (source.kind === 'namespace' && probe.kind === 'namespace') {
    return codec.probe({ source: boundedNamespaceProbeSource(source, probe), plan: probe }, signal)
  }
  throw new ModkitError({
    code: 'x3.host/probe-topology-mismatch',
    message: `codec probe ${probe.kind} cannot inspect a ${source.kind} subject`,
  })
}

function snapshotDetection(value: DetectionResult, contributionId: string): DetectionResult {
  const owned = JSON.parse(canonicalJsonStringify(value)) as DetectionResultWire
  if (
    owned.codecId !== contributionId ||
    typeof owned.confidence !== 'number' ||
    !Number.isFinite(owned.confidence) ||
    owned.confidence < 0 ||
    owned.confidence > 1 ||
    !Array.isArray(owned.evidence) ||
    !Array.isArray(owned.requiredRanges)
  ) {
    throw new ModkitError({
      code: 'x3.host/invalid-detection-result',
      message: `codec ${contributionId} returned a malformed or mismatched detection result`,
    })
  }
  return Object.freeze(owned) as DetectionResult
}

function snapshotPlan(value: AssetInputPlan): AssetInputPlan {
  return Object.freeze(JSON.parse(canonicalJsonStringify(value)) as AssetInputPlan)
}

/**
 * The direct construction: a lone file, or a namespace root with nothing declared beside it.
 *
 * Exported for the host's own companion resolver, which short-circuits into it the moment a plan
 * turns out to carry no requirements — so the overwhelmingly common `single` open keeps taking
 * exactly this path, with no enumeration and no extra source open. Not a public host export; a
 * codec never calls it.
 */
export function defaultResolveInput(context: SubjectInputResolutionContext): AssetInput {
  const plan = context.plan
  if (plan.originKind === 'namespace' && plan.requirements.length === 0) {
    if (context.source.kind !== 'namespace') {
      throw new ModkitError({
        code: 'x3.host/input-topology-mismatch',
        message: 'a namespace input plan requires a namespace subject source',
      })
    }
    const source = context.source
    const compositionFingerprint = canonicalJsonStringify({
      topology: 'namespace',
      root: source.ref,
      revision: source.revision,
    })
    return Object.freeze({
      originKind: 'namespace' as const,
      root: source.ref,
      bindings: Object.freeze([]),
      revisions: Object.freeze({
        topology: 'namespace' as const,
        revision: source.revision,
        namespaceRevision: source.revision,
        bindings: Object.freeze([]),
        compositionFingerprint,
      }),
      bindingsFor: () => Object.freeze([]),
      async openBinding(bindingId: string): Promise<never> {
        throw new ModkitError({
          code: 'x3.host/unknown-asset-input-binding',
          message: `namespace asset input has no binding ${bindingId}`,
        })
      },
      async openNamespace(signal?: AbortSignal): Promise<Lease<AssetNamespace>> {
        throwIfAborted(signal)
        return source.openNamespace(signal)
      },
    })
  }
  /*
   * A bundle whose every companion is optional is still a readable file on its own; without an
   * origin to search there is nothing to bind, so it opens exactly as the lone file it is.
   */
  const loneBundle =
    plan.originKind === 'bundle' && plan.requirements.every(requirement => !requirement.required)
  if (!loneBundle && (plan.originKind !== 'single' || plan.requirements.length !== 0)) {
    throw new ModkitError({
      code: 'x3.host/input-resolver-required',
      message: `the default subject input resolver cannot satisfy ${plan.originKind} topology`,
    })
  }
  if (context.source.kind !== 'bytes') {
    throw new ModkitError({
      code: 'x3.host/input-topology-mismatch',
      message: 'a single-file input plan requires a byte subject source',
    })
  }
  const source = context.source
  const candidate = plan.candidate
  if (
    candidate.bindingId.trim().length === 0 ||
    candidate.role.trim().length === 0 ||
    (candidate.ownership !== 'owned' && candidate.ownership !== 'external')
  ) {
    throw new ModkitError({
      code: 'x3.host/invalid-asset-input-plan',
      message: 'codec returned an invalid single-file candidate binding',
    })
  }
  const binding = Object.freeze({
    sourceKind: 'candidate' as const,
    bindingId: candidate.bindingId,
    role: candidate.role,
    ownership: candidate.ownership,
    source: source.ref,
    revision: source.revision,
  })
  const compositionFingerprint = canonicalJsonStringify({
    topology: 'single',
    bindingId: binding.bindingId,
    source: binding.source,
    revision: binding.revision,
  })
  return Object.freeze({
    originKind: 'single' as const,
    bindings: Object.freeze([binding] as const),
    primaryBindingId: binding.bindingId,
    revisions: Object.freeze({
      topology: 'single' as const,
      revision: source.revision,
      bindings: Object.freeze([
        Object.freeze({ bindingId: binding.bindingId, revision: binding.revision }),
      ] as const),
      compositionFingerprint,
    }),
    bindingsFor: () => Object.freeze([]),
    async openBinding(bindingId: string, signal?: AbortSignal): Promise<Lease<ArtifactByteSource>> {
      throwIfAborted(signal)
      if (bindingId !== binding.bindingId) {
        throw new ModkitError({
          code: 'x3.host/unknown-asset-input-binding',
          message: `asset input has no binding ${bindingId}`,
        })
      }
      return Object.freeze({ value: source, release: async () => undefined })
    },
  })
}

function codecModule(
  module: Record<string, unknown>,
  contributionId: string,
): {
  readonly createCodec: (context: ContributionContext) => Codec
} {
  if (module['abiVersion'] !== 1 || typeof module['createCodec'] !== 'function') {
    throw new ModkitError({
      code: 'x3.host/invalid-codec-module',
      message: `activated contribution ${contributionId} does not implement CodecModule ABI v1`,
    })
  }
  return module as unknown as { readonly createCodec: (context: ContributionContext) => Codec }
}

function assertCodec(value: Codec, contributionId: string): Codec {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.probe !== 'function' ||
    typeof value.open !== 'function'
  ) {
    throw new ModkitError({
      code: 'x3.host/invalid-codec-instance',
      message: `contribution ${contributionId} returned an invalid codec instance`,
    })
  }
  return value
}

function noServiceResolver(): ContractResolverPort {
  const unavailable = (contract: string, major: number): never => {
    throw new ModkitError({
      code: 'x3.host/service-contract-unregistered',
      message: `service contract ${contract}@${major} is unavailable in this composition`,
    })
  }
  return {
    async resolve(request) {
      return unavailable(request.contract, request.major)
    },
    async resolveUnknown(request) {
      return unavailable(request.contract, request.major)
    },
  }
}

/**
 * A contribution whose match rules claimed this file but which could not be a candidate.
 *
 * "No codec claimed this file" and "a codec claimed it and you switched it off" are different
 * facts, and only the first was ever reported: an ineligible contribution dropped out before its
 * rules were even consulted, so an unresolved open carried no trace of it. An application then had
 * to re-derive the reason from the file's suffix and the switched-off codecs' declared extensions —
 * a guess, at the one moment the host knew the answer exactly.
 */
export interface SuppressedCandidate {
  readonly contributionId: string
  readonly extensionId: string
  /** Why it could not run — the contribution's own diagnostic codes (e.g. disabled by settings). */
  readonly reasons: readonly string[]
}

function runnableCandidates(
  options: OpenSubjectOptions,
  offers: readonly ProviderOffer[],
  signatureWindows: SignatureWindows | undefined,
  suppressed: SuppressedCandidate[] = [],
  route: SubjectOpenRoute = {},
): readonly RunnableCandidate[] {
  const candidates: RunnableCandidate[] = []
  const path = options.path ?? options.source.ref.uri
  for (const extension of options.inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue
      }
      if (!contribution.activationEligible) {
        /*
         * Consult the rules anyway, purely to answer "would this have claimed the file?". No code
         * runs and no offer is taken: an ineligible contribution stays ineligible. What changes is
         * that the host can now say which switched-off codec the user is missing.
         */
        const spec = manifest.spec as unknown as CodecContributionSpecV1Wire | undefined
        const claimsSource =
          spec !== undefined &&
          spec.match !== undefined &&
          (options.source.kind === 'namespace'
            ? spec.sourceTopology === 'namespace' && spec.probe?.kind === 'namespace'
            : // a packed file a semantic container alias would have claimed (e.g. an .SC2Map
              // whose codec failed validation) must not open as the bare carrier silently
              (spec.probe?.kind === 'bytes' || spec.container !== undefined) &&
              matchesSpec(spec, path, options.mediaType))
        if (claimsSource) {
          suppressed.push({
            contributionId: manifest.id,
            extensionId: extension.manifest?.id ?? extension.source,
            reasons: contribution.diagnostics.map(item => item.code),
          })
        }
        continue
      }
      const spec = manifest.spec as unknown as CodecContributionSpecV1Wire
      if (!spec.openIntents.includes(options.intent)) continue
      let viaSignature = false
      if (options.source.kind === 'namespace') {
        if (spec.sourceTopology !== 'namespace' || spec.probe.kind !== 'namespace') continue
        if (route.containerAliasFormatId === undefined) {
          if (spec.container !== undefined) continue
        } else if (
          spec.container?.formatId !== route.containerAliasFormatId ||
          !route.containerAliasContributionIds?.has(manifest.id)
        ) {
          continue
        }
      } else {
        if (route.containerAliasFormatId !== undefined) continue
        if (
          route.containerProviderFormatId !== undefined &&
          (!spec.roles.includes('container') ||
            !spec.formatRefs.some(item => item.formatId === route.containerProviderFormatId) ||
            spec.container !== undefined)
        ) {
          continue
        }
        if (
          (spec.sourceTopology !== 'single' && spec.sourceTopology !== 'bundle') ||
          spec.probe.kind !== 'bytes'
        ) {
          continue
        }
        // name/media/path rules first; a declared byte signature admits a renamed file (NXT-101B)
        const byName = matchesSpec(spec, path, options.mediaType)
        viaSignature =
          !byName &&
          signatureWindows !== undefined &&
          matchesSignatures(spec.match.signatures, signatureWindows)
        if (!byName && !viaSignature) continue
      }
      for (const offer of offers) {
        if (offer.providerId !== manifest.id) continue
        const logicalOffer = [...offer.provides].sort((left, right) =>
          compareUtf8(canonicalJsonStringify(left), canonicalJsonStringify(right)),
        )[0]
        if (logicalOffer === undefined) continue
        candidates.push({
          contribution,
          extensionId: offer.extensionId,
          contributionId: manifest.id,
          spec,
          offer,
          logicalOffer,
          viaSignature,
        })
      }
    }
  }
  return Object.freeze(
    candidates.sort(
      (left, right) =>
        compareUtf8(left.contributionId, right.contributionId) ||
        compareUtf8(left.offer.runtimeVariant, right.offer.runtimeVariant) ||
        compareUtf8(left.logicalOffer.offerId, right.logicalOffer.offerId),
    ),
  )
}

async function unresolvedDescriptor(
  options: OpenSubjectOptions,
  detections: readonly DetectionResult[],
): Promise<AnyDescriptor> {
  if (options.source.kind === 'namespace') {
    return assembleSubjectDescriptor({
      schemaVersion: 2,
      subjectUri: options.source.ref.uri,
      origin: {
        kind: 'namespace',
        root: options.source.ref,
        revision: options.source.revision,
      },
      interpretation: 'none',
      candidates: detections,
      traits: [{ id: 'container.directories', descriptorVersion: 1, state: 'available' }],
      operations: [],
      constraints: {
        readOnly: true,
        seekable: false,
        randomAccess: false,
        trusted: false,
      },
      dataSources: [],
      diagnostics: [],
      revision: options.source.revision,
    } as AnyDescriptorWire)
  }
  return assembleSubjectDescriptor({
    schemaVersion: 2,
    subjectUri: options.source.ref.uri,
    origin: {
      kind: 'single',
      binding: {
        id: 'content',
        role: 'content',
        source: options.source.ref,
        required: true,
        ownership: 'owned',
        revision: options.source.revision,
        ...(options.mediaType === undefined ? {} : { mediaType: options.mediaType }),
      },
    },
    interpretation: 'none',
    candidates: detections,
    traits: [
      {
        id: 'content.binary',
        descriptorVersion: 1,
        state: 'available',
        ...(options.source.size === undefined
          ? {}
          : { parameters: { bytes: options.source.size.toString(10) } }),
      },
    ],
    operations: [],
    constraints: {
      readOnly: true,
      seekable: true,
      randomAccess: true,
      trusted: false,
      ...(options.source.size === undefined
        ? {}
        : { maxDecodedBytes: options.source.size.toString(10) }),
    },
    dataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],
    diagnostics: [],
    revision: options.source.revision,
  } as AnyDescriptorWire)
}

async function textFallbackAvailable(
  source: ArtifactSource,
  signal?: AbortSignal,
): Promise<boolean> {
  if (source.kind !== 'bytes') return false
  if (source.size === undefined) return false
  const length = Number(source.size > 65_536n ? 65_536n : source.size)
  try {
    const bytes = await source.read(0n, length, signal)
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

async function unresolvedFallback(
  source: ArtifactSource,
  signal?: AbortSignal,
): Promise<UnresolvedSubject['fallback']> {
  if (source.kind === 'namespace') {
    return Object.freeze({ preferred: 'none' as const, available: Object.freeze([]) })
  }
  const text = await textFallbackAvailable(source, signal)
  return Object.freeze({
    preferred: text ? ('text' as const) : ('hex' as const),
    available: Object.freeze(text ? (['text', 'hex'] as const) : (['hex'] as const)),
  })
}

/**
 * One public host route from an attested inventory plus a pinned artifact source to a session.
 * Unknown or ambiguous content returns a validated unresolved descriptor and explicit fallback.
 */
async function openSubjectDirect(
  options: OpenSubjectOptions,
  route: SubjectOpenRoute = {},
): Promise<OpenSubjectResult> {
  throwIfAborted(options.signal)
  const minimumConfidence = options.minimumConfidence ?? DEFAULT_MINIMUM_CONFIDENCE
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES
  if (
    !Number.isFinite(minimumConfidence) ||
    minimumConfidence < 0 ||
    minimumConfidence > 1 ||
    !Number.isSafeInteger(maxCandidates) ||
    maxCandidates <= 0
  ) {
    throw new ModkitError({
      code: 'x3.host/invalid-subject-open-policy',
      message: 'subject-open confidence and candidate limits are invalid',
    })
  }

  const diagnostics: Diagnostic[] = []
  const explanations: SubjectOpenCandidateExplanation[] = []
  const detected: DetectedCandidate[] = []
  const offers = offersFromInventory(options.inventory)
  const executionBackends = options.executionBackends ?? DEFAULT_EXECUTION_BACKENDS
  // NXT-101B: one bounded head/tail read per open, sized by the declared signature needs of the
  // inventory (nothing is read when no codec declares signatures); no extension code runs here
  const signatureWindows = await readSignatureWindows(options)
  const suppressed: SuppressedCandidate[] = []
  const candidates = runnableCandidates(options, offers, signatureWindows, suppressed, route)
  for (const item of suppressed) {
    // A user's switch is information; a codec the host could not validate is a fault to show.
    const switchedOff = item.reasons.every(
      code => code === 'x3.host/contribution-disabled' || code === 'x3.host/extension-disabled',
    )
    diagnostics.push(
      diagnostic(
        switchedOff ? 'information' : 'warning',
        'x3.host/candidate-suppressed',
        `«${item.contributionId}» matches this file but cannot run${
          item.reasons.length === 0 ? '' : `: ${[...new Set(item.reasons)].join(', ')}`
        }`,
        [item.extensionId, item.contributionId],
      ),
    )
  }
  if (candidates.length > maxCandidates) {
    diagnostics.push(
      errorDiagnostic(
        'x3.host/subject-candidate-limit',
        `subject matched ${candidates.length} codecs, exceeding the host limit ${maxCandidates}`,
      ),
    )
  } else {
    const target = normalizeTarget(options.target, options.grant)
    for (const candidate of candidates) {
      const local: Diagnostic[] = []
      const resources = createReleaseScope()
      const privateRecord = inventoryRecordFor(candidate.contribution)
      const variant = candidate.contribution.manifest?.runtimeVariants?.find(
        item => item.variantId === candidate.offer.runtimeVariant,
      )
      if (
        privateRecord === undefined ||
        variant === undefined ||
        !executionBackends.supports(variant.executionProfile, target, variant) ||
        (variant.executionProfile === 'trusted-in-process' &&
          privateRecord.execution.allowTrustedInProcess !== true)
      ) {
        local.push(
          errorDiagnostic(
            'x3.host/codec-execution-unavailable',
            `codec ${candidate.contributionId}#${candidate.offer.runtimeVariant} has no executable boundary in this host`,
          ),
        )
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          formatIds: Object.freeze(candidate.spec.formatRefs.map(item => item.formatId)),
          offerId: candidate.logicalOffer.offerId,
          state: 'rejected',
          diagnostics: Object.freeze(local),
        })
        continue
      }
      const request: ProviderRequest = {
        contract: {
          contract: candidate.logicalOffer.contract,
          major: candidate.logicalOffer.major,
          range: '*',
        },
        target,
        pin: {
          providerId: candidate.offer.providerId,
          runtimeVariant: candidate.offer.runtimeVariant,
          offerId: candidate.logicalOffer.offerId,
        },
      }
      if (candidate.viaSignature) {
        local.push({
          code: 'x3.host/signature-match',
          severity: 'information',
          message: `${candidate.contributionId} matched by its declared byte signature; name/media/path rules did not match this subject`,
        })
      }
      // R5: detection probes activate as their own operation — the gate narrows the child grant
      // to the probe classes; the winning candidate is re-activated under the caller grant below
      const resolved = resolveForActivation(request, offers, PROBE_OPERATION)
      if (resolved.result.state !== 'resolved' || resolved.ticket === undefined) {
        local.push(
          errorDiagnostic(
            'x3.host/codec-resolution-unresolved',
            `codec candidate did not resolve: ${resolved.result.state === 'resolved' ? 'ticket unavailable' : resolved.result.reason}`,
          ),
        )
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          formatIds: Object.freeze(candidate.spec.formatRefs.map(item => item.formatId)),
          offerId: candidate.logicalOffer.offerId,
          state: 'rejected',
          diagnostics: Object.freeze(local),
        })
        continue
      }
      const record = {
        resources,
        rasterState: { live: false, reservedBytes: 0 } as SubjectRasterResourceState,
        logicalState: {
          live: false,
          reservedBytes: 0,
          resolveCalls: 0,
          discoveryCalls: 0,
        } as SubjectLogicalResourceState,
        nestedLocks: [] as ProviderPolicyLockEntry[],
        ...(route.includeSelectionLock
          ? { selectionLock: buildLockEntry(request, resolved.result) }
          : {}),
      }
      try {
        const activation = await activateContribution({
          ticket: resolved.ticket,
          grant: options.grant,
          executionBackends,
          ...(options.policy === undefined ? {} : { policy: options.policy }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
        record.resources.add(activation.release)
        local.push(...activation.diagnostics)
        {
          // the probe ticket asks only for the probe classes; if this realm will also serve the
          // open (no R5 re-activation because the caller grant holds nothing beyond the probe set),
          // say which requested classes the open runs without — the gate would have, had it seen them
          const requested =
            candidate.contribution.manifest?.runtimeVariants?.find(
              item => item.variantId === candidate.offer.runtimeVariant,
            )?.requestedPermissionClasses ?? []
          const degraded = requested.filter(
            item =>
              !(PROBE_PERMISSION_CLASSES as readonly string[]).includes(item) &&
              !options.grant.classes.includes(item),
          )
          if (degraded.length > 0) {
            local.push(permissionDegradedDiagnostic(candidate.contributionId, degraded))
          }
        }
        const effectiveBudget = runtimeBudget(options.budget, candidate.spec)
        const nestedLocks = record.nestedLocks
        const makeContext = (
          grant: PermissionGrant,
          chain: readonly string[],
          contributionId?: string,
        ): ContributionContext => {
          const settings =
            contributionId === undefined
              ? undefined
              : options.contributionSettings?.(contributionId)
          const owner =
            contributionId === undefined
              ? undefined
              : offers.find(offer => offer.providerId === contributionId)?.extensionId
          const credentials = owner === undefined ? undefined : options.credentials?.portFor(owner)
          const contracts =
            options.serviceDefinitions === undefined
              ? noServiceResolver()
              : createContractResolverPort({
                  offers,
                  definitions: options.serviceDefinitions,
                  target,
                  targetFor: offer => serviceTargetFor(executionBackends, offer, target),
                  onResolved(request: FacetAwareProviderRequest, result) {
                    nestedLocks.push(buildLockEntry(request, result))
                  },
                  async activate(
                    selection: SelectedServiceOffer,
                    result,
                    signal,
                  ): Promise<Lease<unknown>> {
                    const key = `${selection.contract}@${selection.major}:${result.selected.offer.providerId}:${selection.offerId}`
                    if (chain.includes(key)) {
                      throw new ModkitError({
                        code: 'x3.host/service-dependency-cycle',
                        message: `service activation cycle detected at ${key}`,
                      })
                    }
                    // the shared host activation (service-leases.ts): ticket → gate → ABI check →
                    // createProvider with a context bound to the provider's own narrowed grant
                    const nested = await activateServiceProvider({
                      selection,
                      result,
                      target,
                      grant,
                      executionBackends,
                      ...(options.policy === undefined ? {} : { policy: options.policy }),
                      ...(signal === undefined ? {} : { signal }),
                      diagnostics,
                      contextFor: effectiveGrant =>
                        makeContext(
                          effectiveGrant,
                          [...chain, key],
                          result.selected.offer.providerId,
                        ),
                    })
                    record.resources.add(() => nested.release())
                    return Object.freeze({
                      value: nested.lease.value,
                      release: () => nested.release(),
                    })
                  },
                })
          return Object.freeze({
            contracts,
            ...(settings === undefined ? {} : { settings }),
            ...(options.videoFrames === undefined ? {} : { videoFrames: options.videoFrames }),
            ...(credentials === undefined ? {} : { credentials }),
            ...(options.containerContext === undefined
              ? {}
              : { containerContext: options.containerContext }),
            logicalResources: createSubjectLogicalResources({
              state: record.logicalState,
              budget: effectiveBudget,
              ...(options.logicalResourceDiscovery === undefined
                ? {}
                : { policies: options.logicalResourceDiscovery }),
              isAuthorized: () =>
                grantValidity(grant).state === 'valid' && grant.classes.includes('read-source'),
            }),
            modelResources: createSubjectModelResources({
              state: record.rasterState,
              budget: effectiveBudget,
              isAuthorized: () =>
                grantValidity(grant).state === 'valid' && grant.classes.includes('read-source'),
              ancestors: [`${options.source.ref.id}@${options.source.revision}`],
              own: release => record.resources.add(release),
              open: (source, path, signal) =>
                openSubject({
                  inventory: options.inventory,
                  source,
                  path,
                  target,
                  intent: 'full',
                  grant: { ...grant, classes: ['read-source'] },
                  budget: effectiveBudget,
                  executionBackends,
                  ...(record.rasterState.resources === undefined
                    ? {}
                    : { resourceSession: record.rasterState.resources }),
                  ...(options.videoFrames === undefined
                    ? {}
                    : { videoFrames: options.videoFrames }),
                  ...(options.credentials === undefined
                    ? {}
                    : { credentials: options.credentials }),
                  ...(options.resolveInput === undefined
                    ? {}
                    : { resolveInput: options.resolveInput }),
                  ...(options.serviceDefinitions === undefined
                    ? {}
                    : { serviceDefinitions: options.serviceDefinitions }),
                  ...(options.policy === undefined ? {} : { policy: options.policy }),
                  ...(signal === undefined ? {} : { signal }),
                }),
            }),
            ...(options.provideRasterResources === false
              ? {}
              : {
                  rasterResources: createSubjectRasterResources({
                    state: record.rasterState,
                    budget: effectiveBudget,
                    isAuthorized: () =>
                      grantValidity(grant).state === 'valid' &&
                      grant.classes.includes('read-source'),
                    open: (source, hint, signal) =>
                      openSubject({
                        inventory: options.inventory,
                        source,
                        ...hint,
                        target,
                        intent: 'full',
                        grant: { ...grant, classes: ['read-source'] },
                        budget: effectiveBudget,
                        executionBackends,
                        provideRasterResources: false,
                        ...(options.serviceDefinitions === undefined
                          ? {}
                          : { serviceDefinitions: options.serviceDefinitions }),
                        ...(options.policy === undefined ? {} : { policy: options.policy }),
                        ...(signal === undefined ? {} : { signal }),
                      }),
                  }),
                }),
            budgets: effectiveBudget,
            diagnostics: {
              report(item: Diagnostic) {
                diagnostics.push(item)
              },
            },
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          })
        }
        const codec = assertCodec(
          codecModule(activation.module, candidate.contributionId).createCodec(
            makeContext(
              activation.effectiveGrant,
              [candidate.contributionId],
              candidate.contributionId,
            ),
          ),
          candidate.contributionId,
        )
        // Added before any session resource, so the scope lets the codec go after its sessions.
        record.resources.add(() => releaseCodec(codec))
        const detection = snapshotDetection(
          await probeCodec(codec, options.source, candidate.spec.probe, options.signal),
          candidate.contributionId,
        )
        detected.push(
          Object.assign(record, {
            ...candidate,
            ticket: resolved.ticket,
            codec,
            detection,
            effectiveBudget,
            effectiveGrant: activation.effectiveGrant,
            activationDiagnostics: Object.freeze(local) as readonly Diagnostic[],
            request,
            makeContext,
            ...(record.selectionLock === undefined ? {} : { selectionLock: record.selectionLock }),
            probeScoped: variantRequestsBeyondProbe(
              candidate.contribution.manifest?.runtimeVariants?.find(
                item => item.variantId === candidate.offer.runtimeVariant,
              )?.requestedPermissionClasses ?? [],
              options.grant,
            ),
          }),
        )
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          formatIds: Object.freeze(candidate.spec.formatRefs.map(item => item.formatId)),
          offerId: candidate.logicalOffer.offerId,
          state: 'detected',
          confidence: detection.confidence,
          diagnostics: Object.freeze(local),
        })
      } catch (error) {
        local.push(caughtDiagnostic('probe', error))
        try {
          await record.resources.release()
        } catch (cleanupError) {
          local.push(caughtDiagnostic('cleanup', cleanupError))
        }
        explanations.push({
          contributionId: candidate.contributionId,
          extensionId: candidate.extensionId,
          variantId: candidate.offer.runtimeVariant,
          formatIds: Object.freeze(candidate.spec.formatRefs.map(item => item.formatId)),
          offerId: candidate.logicalOffer.offerId,
          state: 'rejected',
          diagnostics: Object.freeze(local),
        })
      }
    }
  }

  const eligible = detected
    .filter(candidate => candidate.detection.confidence >= minimumConfidence)
    .sort(
      (left, right) =>
        right.detection.confidence - left.detection.confidence ||
        compareUtf8(left.contributionId, right.contributionId) ||
        compareUtf8(left.offer.runtimeVariant, right.offer.runtimeVariant),
    )
  const best = eligible[0]
  const tied =
    best === undefined
      ? []
      : eligible.filter(candidate => candidate.detection.confidence === best.detection.confidence)
  if (best === undefined || tied.length !== 1) {
    for (const candidate of detected) await releaseCandidate(candidate, diagnostics)
    const descriptor = await unresolvedDescriptor(
      options,
      detected.map(candidate => candidate.detection),
    )
    return Object.freeze({
      state: 'unresolved' as const,
      reason:
        candidates.length === 0
          ? ('no-candidate' as const)
          : best === undefined
            ? ('no-match' as const)
            : ('ambiguous' as const),
      descriptor,
      fallback: await unresolvedFallback(options.source, options.signal),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze([...diagnostics, ...workerRefusals(explanations)]),
    })
  }

  for (const candidate of detected) {
    if (candidate !== best) await releaseCandidate(candidate, diagnostics)
  }
  let openedSession: AssetSession | undefined
  try {
    if (best.probeScoped) {
      // R5: the probe ran under the probe-scoped child grant; the open runs under the caller
      // grant, so the winner is re-activated (a fresh ticket, no probe operation) and only then
      // is the probe-phase realm released — never a moment without an attested activation
      const reResolved = resolveForActivation(best.request, offers)
      if (reResolved.result.state !== 'resolved' || reResolved.ticket === undefined) {
        throw new ModkitError({
          code: 'x3.host/codec-resolution-unresolved',
          message: 'the selected codec did not re-resolve for open',
        })
      }
      const openScope = createReleaseScope()
      const probeScope = best.resources
      try {
        const activation = await activateContribution({
          ticket: reResolved.ticket,
          grant: options.grant,
          executionBackends,
          ...(options.policy === undefined ? {} : { policy: options.policy }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
        openScope.add(activation.release)
        best.resources = openScope
        const reopened = assertCodec(
          codecModule(activation.module, best.contributionId).createCodec(
            best.makeContext(activation.effectiveGrant, [best.contributionId], best.contributionId),
          ),
          best.contributionId,
        )
        openScope.add(() => releaseCodec(reopened))
        best.codec = reopened
        best.ticket = reResolved.ticket
        best.effectiveGrant = activation.effectiveGrant
        best.activationDiagnostics = Object.freeze([
          ...best.activationDiagnostics,
          ...activation.diagnostics,
        ])
      } catch (error) {
        best.resources = probeScope
        try {
          await openScope.release()
        } catch (cleanupError) {
          diagnostics.push(caughtDiagnostic('cleanup', cleanupError))
        }
        throw error
      }
      try {
        await probeScope.release()
      } catch (cleanupError) {
        diagnostics.push(caughtDiagnostic('cleanup', cleanupError))
      }
    }
    const rawPlan = best.codec.planInput
      ? await best.codec.planInput(options.source, best.detection, options.signal)
      : options.source.kind === 'namespace'
        ? { originKind: 'namespace' as const, requirements: [] as const }
        : {
            originKind: 'single' as const,
            candidate: { bindingId: 'content', role: 'content', ownership: 'owned' as const },
            requirements: [] as const,
          }
    const plan = snapshotPlan(rawPlan)
    /*
     * The codec's own search rule, per role, taken from the plan it just returned.
     *
     * `planInput` states where a format's companions live: the scopes in the order it wants them
     * tried, and — through any pattern that carries a directory — the subdirectories its resources
     * sit in. The raster port applies this to every later logical read, so a viewer asking for a
     * texture never decides which mounts are searched. A role the codec planned nothing for keeps
     * the caller's own scopes.
     */
    const companionRule = (role: string): RasterCompanionRule | undefined => {
      const requirement = ('requirements' in plan ? plan.requirements : []).find(
        item => item.role === role,
      )
      if (requirement === undefined) return undefined
      const directories = ['']
      for (const pattern of requirement.patterns ?? []) {
        const cut = pattern.replaceAll('\\', '/').lastIndexOf('/')
        const directory = cut <= 0 ? '' : pattern.slice(0, cut)
        if (!directories.includes(directory)) directories.push(directory)
      }
      return Object.freeze({ scopes: requirement.scopes, directories: Object.freeze(directories) })
    }
    const input = await (options.resolveInput ?? defaultResolveInput)({
      source: options.source,
      plan,
      detection: best.detection,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    openedSession = await best.codec.open(
      input,
      options.intent,
      best.effectiveBudget,
      options.signal,
    )
    const session = openedSession
    throwIfAborted(options.signal)
    if (session.revision !== options.source.revision) {
      throw new ModkitError({
        code: 'x3.host/subject-session-identity-mismatch',
        message: 'opened codec session revision does not match the selected source',
      })
    }
    if (session.state() === 'disposed' || grantValidity(best.effectiveGrant).state !== 'valid') {
      throw new ModkitError({
        code: 'x3.host/subject-context-unavailable',
        message: 'The opened subject context is no longer live.',
      })
    }
    let postOpenResources: ResourceSessionPort | undefined = best.effectiveGrant.classes.includes(
      'read-source',
    )
      ? options.resourceSession
      : undefined
    const openResources = route.openResources ?? options.resolveInput?.openResources
    if (openResources !== undefined && best.effectiveGrant.classes.includes('read-source')) {
      const requested = { ...DEFAULT_RESOURCE_SESSION_LIMITS, ...options.resourceLimits }
      const openedResources = openResources({
        revision: session.revision,
        revisionPolicy: 'pin',
        isAuthorized: () =>
          grantValidity(best.effectiveGrant).state === 'valid' &&
          best.effectiveGrant.classes.includes('read-source'),
        limits: {
          maxResources: Math.min(requested.maxResources, best.effectiveBudget.maxNodes),
          maxBytes:
            requested.maxBytes < best.effectiveBudget.maxInputBytes
              ? requested.maxBytes
              : best.effectiveBudget.maxInputBytes,
          maxDepth: Math.min(requested.maxDepth, best.effectiveBudget.maxDepth),
          maxEntries: Math.min(requested.maxEntries, best.effectiveBudget.maxNodes),
        },
      })
      postOpenResources = openedResources
      best.resources.add(() => openedResources.dispose())
      best.logicalState.resources = openedResources
    }
    if (postOpenResources !== undefined) best.logicalState.resources = postOpenResources
    best.logicalState.live = true
    best.resources.add(() => {
      best.logicalState.live = false
    })
    const descriptor = await assembleSubjectDescriptor(
      (await session.descriptor()) as AnyDescriptorWire,
    )
    throwIfAborted(options.signal)
    if (session.state() === 'disposed' || grantValidity(best.effectiveGrant).state !== 'valid') {
      throw new ModkitError({
        code: 'x3.host/subject-context-unavailable',
        message: 'The subject context stopped being live while its descriptor was initialized.',
      })
    }
    if (
      descriptor.interpretation !== 'codec' ||
      descriptor.identity.codecId !== best.contributionId ||
      descriptor.subjectUri !== options.source.ref.uri ||
      descriptor.revision !== options.source.revision
    ) {
      throw new ModkitError({
        code: 'x3.host/subject-session-identity-mismatch',
        message: 'opened codec session does not describe the selected source and codec',
      })
    }
    const selectedExplanation = explanations.find(
      item =>
        item.contributionId === best.contributionId &&
        item.variantId === best.offer.runtimeVariant &&
        item.offerId === best.logicalOffer.offerId,
    )
    if (selectedExplanation !== undefined) {
      const index = explanations.indexOf(selectedExplanation)
      explanations[index] = Object.freeze({ ...selectedExplanation, state: 'selected' })
    }
    const record = inventoryRecordFor(best.contribution)?.publicRecord
    if (record === undefined) {
      throw new ModkitError({
        code: 'x3.host/detection-selection-unattested',
        message: 'selected codec has no attested inventory record',
      })
    }
    const detectionSelectionText = serializeCodecDetectionSelection(
      buildCodecDetectionSelection({
        sourceRevision: options.source.revision,
        extensionId: best.extensionId,
        contributionId: best.contributionId,
        variantId: best.offer.runtimeVariant,
        offerId: best.logicalOffer.offerId,
        artifactDigest: record.artifactDigest,
        manifestDigest: record.manifestDigest,
        sourceTopology: best.spec.sourceTopology,
        detection: best.detection,
      }),
    )
    const lockText = serializePolicyLock([
      ...best.nestedLocks,
      ...(best.selectionLock === undefined ? [] : [best.selectionLock]),
    ])
    const isReadAuthorized = () =>
      grantValidity(best.effectiveGrant).state === 'valid' &&
      best.effectiveGrant.classes.includes('read-source')
    // The model a card names is resolved like any other model of this subject (see subject-models).
    const models =
      options.provideRasterResources === false
        ? undefined
        : createSubjectModelResources({
            state: best.rasterState,
            budget: best.effectiveBudget,
            isAuthorized: isReadAuthorized,
            ancestors: [`${options.source.ref.id}@${options.source.revision}`],
            own: release => best.resources.add(release),
            open: (source, path, signal) =>
              openSubject({
                inventory: options.inventory,
                source,
                path,
                target: options.target,
                intent: 'full',
                grant: { ...best.effectiveGrant, classes: ['read-source'] },
                budget: best.effectiveBudget,
                executionBackends,
                ...(best.rasterState.resources === undefined
                  ? {}
                  : { resourceSession: best.rasterState.resources }),
                ...(options.resolveInput === undefined
                  ? {}
                  : { resolveInput: options.resolveInput }),
                ...(options.serviceDefinitions === undefined
                  ? {}
                  : { serviceDefinitions: options.serviceDefinitions }),
                ...(options.policy === undefined ? {} : { policy: options.policy }),
                ...(signal === undefined ? {} : { signal }),
              }),
          })
    const catalog =
      options.subjectCatalog === undefined
        ? undefined
        : subjectCatalogEntities(
            options.subjectCatalog,
            async () => (await session.descriptor()).subjectUri,
          )
    if (catalog !== undefined) best.resources.add(() => catalog.release())
    const managedSession = sessionWithResources(
      session,
      best.resources,
      {
        spec: best.spec,
        grant: best.effectiveGrant,
        ...(catalog === undefined ? {} : { catalog: catalog.entities }),
      },
      () => {
        best.logicalState.live = false
      },
      models,
    )
    if (postOpenResources !== undefined) best.rasterState.resources = postOpenResources
    best.rasterState.live = true
    best.resources.add(() => {
      best.rasterState.live = false
    })
    openedSession = undefined
    const rasterResources =
      options.provideRasterResources === false
        ? undefined
        : createSubjectRasterResources({
            state: best.rasterState,
            budget: best.effectiveBudget,
            companionRule,
            isAuthorized: () =>
              grantValidity(best.effectiveGrant).state === 'valid' &&
              best.effectiveGrant.classes.includes('read-source'),
            open: (source, hint, signal) =>
              openSubject({
                inventory: options.inventory,
                source,
                ...hint,
                target: options.target,
                intent: 'full',
                grant: { ...best.effectiveGrant, classes: ['read-source'] },
                budget: best.effectiveBudget,
                executionBackends,
                provideRasterResources: false,
                ...(options.serviceDefinitions === undefined
                  ? {}
                  : { serviceDefinitions: options.serviceDefinitions }),
                ...(options.policy === undefined ? {} : { policy: options.policy }),
                ...(signal === undefined ? {} : { signal }),
              }),
          })
    return Object.freeze({
      state: 'opened' as const,
      session: managedSession,
      ...(postOpenResources === undefined ? {} : { resources: postOpenResources }),
      ...(rasterResources === undefined ? {} : { rasterResources }),
      descriptor,
      ticket: best.ticket,
      detectionSelectionText,
      lockText,
      selected: Object.freeze({
        extensionId: best.extensionId,
        contributionId: best.contributionId,
        variantId: best.offer.runtimeVariant,
        offerId: best.logicalOffer.offerId,
        confidence: best.detection.confidence,
      }),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze([...diagnostics, ...best.activationDiagnostics]),
    })
  } catch (error) {
    best.logicalState.live = false
    if (openedSession !== undefined) {
      try {
        await openedSession.dispose()
      } catch (disposeError) {
        diagnostics.push(caughtDiagnostic('session-dispose', disposeError))
      }
    }
    await releaseCandidate(best, diagnostics)
    diagnostics.push(caughtDiagnostic('input-open', error))
    const descriptor = await unresolvedDescriptor(
      options,
      detected.map(candidate => candidate.detection),
    )
    return Object.freeze({
      state: 'unresolved' as const,
      reason: 'input-unresolved' as const,
      descriptor,
      fallback: await unresolvedFallback(options.source, options.signal),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze(diagnostics),
    })
  }
}

interface MatchedContainerAlias {
  readonly contributionId: string
  readonly spec: CodecContributionSpecV1Wire
}

/** Why an alias-shaped codec that claims this path never reached detection. */
interface SkippedContainerAlias {
  readonly contributionId: string
  readonly extensionId: string
  readonly reason: string
}

interface ContainerAliasScan {
  readonly aliases: readonly MatchedContainerAlias[]
  /** Alias-shaped codec contributions the inventory carried at this open, eligible or not. */
  readonly aliasShaped: number
  /** Codec contributions of any shape, to tell "inventory not ready" from "nothing matched". */
  readonly codecs: number
  readonly skipped: readonly SkippedContainerAlias[]
}

function scanContainerAliases(options: OpenSubjectOptions): ContainerAliasScan {
  const empty = { aliases: Object.freeze([]), skipped: Object.freeze([]) }
  if (options.source.kind !== 'bytes') {
    return Object.freeze({ ...empty, aliasShaped: 0, codecs: 0 })
  }
  const path = options.path ?? options.source.ref.uri
  const aliases: MatchedContainerAlias[] = []
  const skipped: SkippedContainerAlias[] = []
  let aliasShaped = 0
  let codecs = 0
  for (const extension of options.inventory.extensions) {
    for (const contribution of extension.contributions) {
      const manifest = contribution.manifest
      if (manifest?.contract.id !== CODEC_CONTRIBUTION_CONTRACT || manifest.contract.major !== 1) {
        continue
      }
      codecs += 1
      const spec = manifest.spec as unknown as CodecContributionSpecV1Wire | undefined
      if (spec?.container === undefined || spec.sourceTopology !== 'namespace') continue
      aliasShaped += 1
      // Past this point the codec's own name rules claimed the file, so every remaining
      // rejection is a fact the user needs: silence here reads as "the file is just a carrier".
      if (!matchesSpec(spec, path, options.mediaType)) continue
      const entry = {
        contributionId: manifest.id,
        extensionId: extension.manifest?.id ?? extension.source,
      }
      // An ineligible contribution already gets x3.host/candidate-suppressed from the carrier
      // pass; repeating it here would only double the line.
      if (!contribution.activationEligible) continue
      if (!spec.openIntents.includes(options.intent)) {
        skipped.push(
          Object.freeze({
            ...entry,
            reason: `open intent «${options.intent}» is not declared (${spec.openIntents.join(', ')})`,
          }),
        )
        continue
      }
      aliases.push(Object.freeze({ contributionId: manifest.id, spec }))
    }
  }
  return Object.freeze({
    aliases: Object.freeze(aliases),
    aliasShaped,
    codecs,
    skipped: Object.freeze(skipped),
  })
}

/**
 * The carrier winning because no semantic alias ran is indistinguishable, from the outside, from
 * the carrier winning on merit. These lines are the difference.
 */
function containerAliasAbsence(
  scan: ContainerAliasScan,
  options: OpenSubjectOptions,
): readonly Diagnostic[] {
  // The file name, never where it lives: a diagnostic must not disclose the local directory layout.
  const path = (options.path ?? options.source.ref.uri).split(/[\\/]/u).at(-1) ?? ''
  const explained: Diagnostic[] = scan.skipped.map(item =>
    diagnostic(
      'warning',
      'x3.host/container-alias-skipped',
      `«${item.contributionId}» claims «${path}» but did not enter detection: ${item.reason}`,
      [item.extensionId, item.contributionId],
    ),
  )
  if (scan.aliasShaped === 0 && options.source.kind === 'bytes') {
    // Inventory carried no semantic alias at all — the usual shape of "opened too early".
    explained.push(
      diagnostic(
        'information',
        'x3.host/container-alias-none',
        `no container-alias codec was in the inventory when «${path}» was opened`,
        [path],
        { codecContributions: scan.codecs, extensions: options.inventory.extensions.length },
      ),
    )
  }
  return Object.freeze(explained)
}

/**
 * What the alias explanation is about: an open that failed, or a subject that lists entries — a
 * container carrier that may have won only because no semantic alias ran. A texture or a model
 * that opened as itself has nothing to explain, and saying so on every open is noise.
 */
function carrierShaped(result: OpenSubjectResult): boolean {
  if (result.state !== 'opened') return true
  const descriptor = result.descriptor as {
    readonly traits?: readonly { readonly id?: unknown }[]
    readonly dataSources?: readonly { readonly contract?: unknown }[]
  }
  return (
    (descriptor.traits ?? []).some(
      trait => typeof trait.id === 'string' && trait.id.startsWith('container.'),
    ) ||
    (descriptor.dataSources ?? []).some(
      source => source.contract === 'common.view/namespace-entry-source',
    )
  )
}

function withDiagnostics(
  result: OpenSubjectResult,
  extra: readonly Diagnostic[],
): OpenSubjectResult {
  if (extra.length === 0) return result
  const diagnostics = Object.freeze([...result.diagnostics, ...extra])
  if (result.state === 'opened') return Object.freeze({ ...result, diagnostics })
  return Object.freeze({ ...result, diagnostics })
}

async function disposeOpened(result: OpenSubjectResult): Promise<void> {
  if (result.state === 'opened') await result.session.dispose()
}

/**
 * Public subject route with additive host-owned container composition.
 *
 * A semantic alias sees only the adapter namespace and extracted entry sources. The retained
 * carrier session never crosses into its contribution context or AssetInput. On semantic no-match
 * the already-open generic container is returned; ambiguity and composition failures do not fall
 * back to another interpretation.
 */
export async function openSubject(request: OpenSubjectOptions): Promise<OpenSubjectResult> {
  const policies = request.logicalResourceDiscovery
  const options: OpenSubjectOptions = {
    ...request,
    ...(policies === undefined
      ? {}
      : { logicalResourceDiscovery: snapshotLogicalResourceDiscoveryPolicies(policies) }),
  }
  const compositionStartedAt = Date.now()
  const scan = scanContainerAliases(options)
  const aliases = scan.aliases
  if (aliases.length === 0) {
    const direct = await openSubjectDirect(options)
    return withDiagnostics(
      direct,
      carrierShaped(direct) ? containerAliasAbsence(scan, options) : [],
    )
  }
  const formats = [
    ...new Set(aliases.map(alias => alias.spec.container?.formatId).filter(Boolean)),
  ] as string[]
  if (formats.length !== 1) {
    throw new ModkitError({
      code: 'x3.host/container-alias-ambiguous',
      message: `subject selectors name ${formats.length} different container formats`,
      context: { formats: formats.sort(compareUtf8) },
    })
  }
  if (options.budget.maxDepth < 1) {
    throw new ModkitError({
      code: 'x3.host/container-composition-depth-exceeded',
      message: 'container composition requires one remaining subject depth',
    })
  }
  const formatId = formats[0] as string
  const parent = await openSubjectDirect(options, {
    containerProviderFormatId: formatId,
    includeSelectionLock: true,
  })
  if (parent.state !== 'opened') {
    if (parent.reason === 'no-match') {
      // The carrier itself did not match; its reasons are the only account of this open.
      return withDiagnostics(await openSubjectDirect(options), parent.diagnostics)
    }
    return Object.freeze({
      ...parent,
      reason: 'input-unresolved' as const,
      diagnostics: Object.freeze([
        ...parent.diagnostics,
        diagnostic(
          'error',
          'x3.host/container-provider-unavailable',
          `no unique runnable container provider opened format ${formatId}`,
          [formatId],
        ),
      ]),
    })
  }

  let composition: Awaited<ReturnType<typeof createContainerNamespaceComposition>> | undefined
  let semanticSession: AssetSession | undefined
  try {
    throwIfAborted(options.signal)
    composition = await createContainerNamespaceComposition({
      parent: parent.session,
      root: options.source.ref,
      revision: options.source.revision,
      budget: options.budget,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    throwIfAborted(options.signal)
    const elapsed = Date.now() - compositionStartedAt
    const remainingDeadline =
      options.budget.deadlineMs === undefined ? undefined : options.budget.deadlineMs - elapsed
    if (remainingDeadline !== undefined && remainingDeadline <= 0) {
      throw new ModkitError({
        code: 'x3.host/container-composition-deadline-exceeded',
        message:
          'container composition exhausted the subject-open deadline before semantic probing',
      })
    }
    const semanticBudget = Object.freeze({
      ...options.budget,
      maxDepth: options.budget.maxDepth - 1,
      ...(remainingDeadline === undefined ? {} : { deadlineMs: remainingDeadline }),
    })
    const semantic = await openSubjectDirect(
      { ...options, source: composition.source, budget: semanticBudget },
      {
        containerAliasFormatId: formatId,
        openResources: composition.openResources,
        containerAliasContributionIds: new Set(aliases.map(alias => alias.contributionId)),
      },
    )
    if (semantic.state !== 'opened') {
      await composition.dispose()
      composition = undefined
      if (semantic.reason === 'no-candidate' || semantic.reason === 'no-match') {
        // Falling back to the carrier used to discard the semantic pass entirely, so a map that
        // opened as a bare archive explained itself with nothing at all.
        return withDiagnostics(parent, [
          ...semantic.diagnostics,
          diagnostic(
            'warning',
            'x3.host/container-semantic-unclaimed',
            `no semantic alias claimed the ${formatId} namespace (${semantic.reason}); the carrier view wins`,
            aliases.map(alias => alias.contributionId),
            {
              reason: semantic.reason,
              candidates: semantic.candidates.map(item => ({
                contributionId: item.contributionId,
                state: item.state,
                confidence: item.confidence,
                diagnostics: item.diagnostics.map(entry => entry.code),
              })),
            },
          ),
        ])
      }
      await parent.session.dispose()
      return semantic
    }
    semanticSession = semantic.session
    const selectedAlias = aliases.find(
      alias => alias.contributionId === semantic.selected.contributionId,
    )
    if (selectedAlias === undefined) {
      throw new ModkitError({
        code: 'x3.host/container-semantic-selection-invalid',
        message: 'selected semantic codec is not one of the matched container aliases',
      })
    }
    const selectedSpec = selectedAlias.spec
    const needsPack = selectedSpec.operations.some(
      operation => operation.mutatesSource && operation.outputKinds?.includes('edit-plan'),
    )
    if (needsPack && composition.packHandlerId === undefined) {
      throw new ModkitError({
        code: 'x3.host/container-pack-unavailable',
        message: `container provider for ${formatId} must publish container.pack for mutating semantic aliases`,
      })
    }
    if (
      selectedSpec.operations.some(operation => operation.id === 'export.raw') &&
      composition.exportRawHandlerId === undefined
    ) {
      throw new ModkitError({
        code: 'x3.host/container-export-raw-unavailable',
        message: `container provider for ${formatId} must publish export.raw for semantic raw export`,
      })
    }
    const session = composition.wrapSession(
      semanticSession,
      semantic.descriptor,
      selectedSpec,
      parent.session,
    )
    semanticSession = undefined
    composition = undefined
    const lockText = serializePolicyLock([
      ...parsePolicyLock(parent.lockText).entries,
      ...parsePolicyLock(semantic.lockText).entries,
    ])
    return Object.freeze({
      ...semantic,
      session,
      lockText,
      candidates: Object.freeze([...parent.candidates, ...semantic.candidates]),
      diagnostics: Object.freeze([...parent.diagnostics, ...semantic.diagnostics]),
    })
  } catch (error) {
    if (semanticSession !== undefined) {
      try {
        await semanticSession.dispose()
      } catch {
        // Preserve the triggering error while still releasing the retained carrier below.
      }
    }
    if (composition !== undefined) {
      try {
        await composition.dispose()
      } catch {
        // Composition cleanup is best effort here; the triggering failure remains authoritative.
      }
    }
    try {
      await disposeOpened(parent)
    } catch {
      // Preserve the triggering composition error after every cleanup stage was attempted.
    }
    throw error
  }
}
import { createSubjectModelResources } from './model-resources.js'
import { subjectModelDataSources } from './subject-models.js'
