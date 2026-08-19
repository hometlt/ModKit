/** Host-owned file opening pipeline. No application or codec may bypass this composition root. */

import {
  canonicalJsonStringify,
  compareUtf8,
  diagnostic,
  isModkitError,
  ModkitError,
  throwIfAborted,
  type Diagnostic,
} from '@modkitx-x3/core'
import {
  CODEC_CONTRIBUTION_CONTRACT,
  grantValidity,
  type AnyDescriptor,
  type AnyDescriptorWire,
  type ArtifactByteSource,
  type AssetInput,
  type AssetInputPlan,
  type AssetSession,
  type Codec,
  type CodecContributionSpecV1Wire,
  type SignatureRule,
  type ContributionContext,
  type ContractResolverPort,
  type DetectionResult,
  type DetectionResultWire,
  type HostPolicy,
  type Lease,
  type OpenIntent,
  type OperationResult,
  type OperationSession,
  type PermissionClass,
  type PermissionGrant,
  type ProviderOffer,
  type ProviderPolicyLockEntry,
  type ProviderRequest,
  type ResourceBudget,
  type RuntimeTarget,
  type ServiceContractDefinitionRegistry,
  type SelectedServiceOffer,
} from '@modkitx-x3/sdk'
import { inventoryRecordFor, type Inventory, type InventoryContribution } from './inventory.js'
import { activateServiceProvider } from './service-leases.js'
import { offersFromInventory } from './offers.js'
import {
  buildCodecDetectionSelection,
  serializeCodecDetectionSelection,
} from './detection-selection.js'
import { buildLockEntry, serializePolicyLock } from './resolution/lock.js'
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
import { matchesSignatures, signatureNeeds, type SignatureWindows } from './detection-index.js'
import { assembleSubjectDescriptor } from './session.js'

const DEFAULT_MINIMUM_CONFIDENCE = 0.5
const DEFAULT_MAX_CANDIDATES = 64

export type SubjectOpenCandidateState = 'rejected' | 'detected' | 'selected'

export interface SubjectOpenCandidateExplanation {
  readonly contributionId: string
  readonly extensionId: string
  readonly variantId: string
  readonly offerId?: string
  readonly state: SubjectOpenCandidateState
  readonly confidence?: number
  readonly diagnostics: readonly Diagnostic[]
}

export interface SubjectInputResolutionContext {
  readonly source: ArtifactByteSource
  readonly plan: AssetInputPlan
  readonly detection: DetectionResult
  readonly signal?: AbortSignal
}

/** Host-owned companion/namespace resolver. The default implementation accepts single files only. */
export type SubjectInputResolver = (
  context: SubjectInputResolutionContext,
) => AssetInput | Promise<AssetInput>

export interface OpenSubjectOptions {
  readonly inventory: Inventory
  readonly source: ArtifactByteSource
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
  readonly minimumConfidence?: number
  readonly maxCandidates?: number
  readonly signal?: AbortSignal
}

export interface OpenedSubject {
  readonly state: 'opened'
  readonly session: AssetSession
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
    readonly preferred: 'text' | 'hex'
    readonly available: readonly ('text' | 'hex')[]
  }
  readonly candidates: readonly SubjectOpenCandidateExplanation[]
  readonly diagnostics: readonly Diagnostic[]
}

export type OpenSubjectResult = OpenedSubject | UnresolvedSubject

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
  /** The pinned request that resolved this candidate; the open phase re-resolves with it. */
  readonly request: ProviderRequest
  /** Builds a ContributionContext bound to this candidate's *current* resource scope. */
  readonly makeContext: (grant: PermissionGrant, chain: readonly string[]) => ContributionContext
  /**
   * R5: the variant requests classes beyond the probe set, so the probe ran under a narrower
   * child grant and the winner must be re-activated under the caller grant before open.
   */
  readonly probeScoped: boolean
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
      return inner.invoke(handlerId, input, invokeOptions)
    },
    dispose: () => inner.dispose(),
  }
  return Object.freeze(gated)
}

function sessionWithResources(
  session: AssetSession,
  resources: AsyncReleaseScope,
  gating?: { readonly spec: CodecContributionSpecV1Wire; readonly grant: PermissionGrant },
): AssetSession {
  let disposed = false
  const operations =
    gating === undefined ? undefined : gatedOperations(session, gating.spec, gating.grant)
  return Object.freeze({
    revision: session.revision,
    state: () => session.state(),
    descriptor: () => session.descriptor(),
    dataSource: session.dataSource.bind(session) as AssetSession['dataSource'],
    operations: () => operations ?? session.operations(),
    events: (signal?: AbortSignal) => session.events(signal),
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
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
  })
}

function caughtDiagnostic(stage: string, error: unknown): Diagnostic {
  return errorDiagnostic(
    isModkitError(error) ? error.code : `x3.host/subject-${stage}-failed`,
    isModkitError(error) ? error.message : `subject ${stage} failed closed`,
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
        pattern += '.*'
        index += 1
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
  const pathMatch = (spec.match.pathGlobs ?? []).some(glob => matchesGlob(normalizedPath, glob))
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

function defaultResolveInput(context: SubjectInputResolutionContext): AssetInput {
  const plan = context.plan
  if (plan.originKind !== 'single' || plan.requirements.length !== 0) {
    throw new ModkitError({
      code: 'x3.host/input-resolver-required',
      message: `the default subject input resolver cannot satisfy ${plan.originKind} topology`,
    })
  }
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
    source: context.source.ref,
    revision: context.source.revision,
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
      revision: context.source.revision,
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
      return Object.freeze({ value: context.source, release: async () => undefined })
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

function runnableCandidates(
  options: OpenSubjectOptions,
  offers: readonly ProviderOffer[],
  signatureWindows: SignatureWindows | undefined,
): readonly RunnableCandidate[] {
  const candidates: RunnableCandidate[] = []
  const path = options.path ?? options.source.ref.uri
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
      const spec = manifest.spec as unknown as CodecContributionSpecV1Wire
      if (
        !spec.openIntents.includes(options.intent) ||
        (spec.sourceTopology !== 'single' && spec.sourceTopology !== 'bundle') ||
        spec.probe.kind !== 'bytes'
      ) {
        continue
      }
      // name/media/path rules first; a declared byte signature admits a renamed file (NXT-101B)
      const byName = matchesSpec(spec, path, options.mediaType)
      const viaSignature =
        !byName &&
        signatureWindows !== undefined &&
        matchesSignatures(spec.match.signatures, signatureWindows)
      if (!byName && !viaSignature) {
        continue
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
  source: ArtifactByteSource,
  signal?: AbortSignal,
): Promise<boolean> {
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

/**
 * One public host route from an attested inventory plus a pinned byte source to a session.
 * Unknown or ambiguous content returns a validated unresolved descriptor and explicit fallback.
 */
export async function openSubject(options: OpenSubjectOptions): Promise<OpenSubjectResult> {
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
  const candidates = runnableCandidates(options, offers, signatureWindows)
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
          offerId: candidate.logicalOffer.offerId,
          state: 'rejected',
          diagnostics: Object.freeze(local),
        })
        continue
      }
      const record = {
        resources,
        nestedLocks: [] as ProviderPolicyLockEntry[],
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
        ): ContributionContext => {
          const contracts =
            options.serviceDefinitions === undefined
              ? noServiceResolver()
              : createContractResolverPort({
                  offers,
                  definitions: options.serviceDefinitions,
                  target,
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
                      contextFor: effectiveGrant => makeContext(effectiveGrant, [...chain, key]),
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
            makeContext(activation.effectiveGrant, [candidate.contributionId]),
          ),
          candidate.contributionId,
        )
        const probeSource = boundedProbeSource(
          options.source,
          candidate.spec.probe as Extract<CodecContributionSpecV1Wire['probe'], { kind: 'bytes' }>,
        )
        const detection = snapshotDetection(
          await codec.probe(
            {
              source: probeSource,
              plan: candidate.spec.probe as Extract<
                CodecContributionSpecV1Wire['probe'],
                { kind: 'bytes' }
              >,
            },
            options.signal,
          ),
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
    const text = await textFallbackAvailable(options.source, options.signal)
    return Object.freeze({
      state: 'unresolved' as const,
      reason:
        candidates.length === 0
          ? ('no-candidate' as const)
          : best === undefined
            ? ('no-match' as const)
            : ('ambiguous' as const),
      descriptor,
      fallback: Object.freeze({
        preferred: text ? ('text' as const) : ('hex' as const),
        available: Object.freeze(text ? (['text', 'hex'] as const) : (['hex'] as const)),
      }),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze(diagnostics),
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
        best.codec = assertCodec(
          codecModule(activation.module, best.contributionId).createCodec(
            best.makeContext(activation.effectiveGrant, [best.contributionId]),
          ),
          best.contributionId,
        )
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
      : {
          originKind: 'single' as const,
          candidate: { bindingId: 'content', role: 'content', ownership: 'owned' as const },
          requirements: [] as const,
        }
    const plan = snapshotPlan(rawPlan)
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
    const descriptor = await assembleSubjectDescriptor(
      (await session.descriptor()) as AnyDescriptorWire,
    )
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
    const lockText = serializePolicyLock(best.nestedLocks)
    const managedSession = sessionWithResources(session, best.resources, {
      spec: best.spec,
      grant: best.effectiveGrant,
    })
    openedSession = undefined
    return Object.freeze({
      state: 'opened' as const,
      session: managedSession,
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
    const text = await textFallbackAvailable(options.source, options.signal)
    return Object.freeze({
      state: 'unresolved' as const,
      reason: 'input-unresolved' as const,
      descriptor,
      fallback: Object.freeze({
        preferred: text ? ('text' as const) : ('hex' as const),
        available: Object.freeze(text ? (['text', 'hex'] as const) : (['hex'] as const)),
      }),
      candidates: Object.freeze(explanations),
      diagnostics: Object.freeze(diagnostics),
    })
  }
}
