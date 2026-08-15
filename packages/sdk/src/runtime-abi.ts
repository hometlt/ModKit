/** Interface-only runtime ABI. Host behavior lands in A-2/A-3; no extension code runs here. */

import type { Diagnostic, OperationId } from '@modkitx-x3/core'
import type {
  AnyDescriptor,
  AssetDiagnostic,
  AssetSourceRef,
  ContributionId,
  DetectionResult,
  JsonValue,
  RevisionId,
  TraitQueryRequirement,
} from './asset-capabilities/types.js'
import type {
  DataSourceMajor,
  DataSourceOf,
  KnownDataSourceId,
  Lease,
} from './asset-capabilities/data-sources.js'
import type {
  ByteProbePlan,
  CompanionSearchScope,
  DerivedProbePlan,
  NamespaceProbePlan,
  OpenIntent,
} from './manifest/contribution-spec-types.js'
import type {
  ContractMajor,
  ContractMap,
  ContractOf,
  ContractResolverPort,
  KnownContractId,
} from './service-contracts.js'

export interface Progress {
  readonly completed: number
  readonly total?: number
  readonly message?: string
}

export interface DiagnosticSink {
  report(diagnostic: Diagnostic): void
}

export interface ResourceBudget {
  readonly maxInputBytes: bigint
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxScalarBytes: number
  readonly maxDiagnostics: number
  readonly deadlineMs?: number
}

export interface ContributionContext {
  readonly contracts: ContractResolverPort
  readonly diagnostics: DiagnosticSink
  readonly budgets: ResourceBudget
  readonly signal?: AbortSignal
}

export type InputSearchScope = CompanionSearchScope

export interface TraitQuery {
  readonly all?: readonly TraitQueryRequirement[]
  readonly any?: readonly TraitQueryRequirement[]
  readonly none?: readonly TraitQueryRequirement[]
}

interface AssetInputRequirementBase {
  readonly id: string
  readonly role: string
  readonly ownership: 'owned' | 'companion' | 'external'
  readonly patterns?: readonly string[]
  readonly expected?: TraitQuery
  readonly scopes: readonly InputSearchScope[]
}

type RequirementCardinality =
  | { readonly cardinality: 'one' | 'one-or-more'; readonly required: true }
  | { readonly cardinality: 'zero-or-one' | 'many'; readonly required: false }

export type AssetInputRequirement = AssetInputRequirementBase & RequirementCardinality
export type SingularAssetInputRequirement = AssetInputRequirementBase &
  (
    | { readonly cardinality: 'one'; readonly required: true }
    | { readonly cardinality: 'zero-or-one'; readonly required: false }
  )

/** Declarative and bounded. The codec never resolves or forges companion source URIs. */
export interface CandidateBindingPlan {
  readonly bindingId: string
  readonly role: string
  readonly ownership: 'owned' | 'external'
}

export type PhysicalAssetInputPlan =
  | {
      readonly originKind: 'single'
      /** Stable binding assigned to the exact candidate passed to probe/planInput. */
      readonly candidate: CandidateBindingPlan
      readonly requirements: readonly []
    }
  | {
      readonly originKind: 'bundle'
      readonly candidate: CandidateBindingPlan
      readonly requirements: readonly AssetInputRequirement[]
    }
  | {
      readonly originKind: 'namespace'
      readonly candidate?: never
      readonly requirements: readonly AssetInputRequirement[]
    }

export type SubjectSearchScope = 'workspace-subjects' | 'explicit-user-selection'

interface DerivedSubjectRequirementBase {
  readonly id: string
  readonly role: string
  readonly expected?: TraitQuery
  readonly scopes: readonly SubjectSearchScope[]
}

export type DerivedSubjectRequirement = DerivedSubjectRequirementBase & RequirementCardinality
export type RequiredDerivedSubjectRequirement = DerivedSubjectRequirementBase & {
  readonly cardinality: 'one' | 'one-or-more'
  readonly required: true
}

export interface DerivedRecipe {
  readonly operation: OperationId
  /** Stable declared contribution coordinate, not an inventory/session handle. */
  readonly extensionId: string
  readonly extensionVersion: string
  readonly contributionId: ContributionId
  readonly options?: JsonValue
}

export interface DerivedAssetInputPlan {
  readonly originKind: 'derived'
  readonly subjects: readonly [RequiredDerivedSubjectRequirement, ...DerivedSubjectRequirement[]]
  readonly recipe?: DerivedRecipe
  readonly materialized?: SingularAssetInputRequirement
}

/** A codec may declare either bounded physical bindings or derived subject inputs. */
export type AssetInputPlan = PhysicalAssetInputPlan | DerivedAssetInputPlan

interface ArtifactSourceBase {
  readonly ref: AssetSourceRef
  /** Snapshot pinned by the host for the lifetime of the lease. */
  readonly revision: RevisionId
}

/** Host-owned lazy byte source. Consumers release the enclosing lease, never this value. */
export interface ArtifactByteSource extends ArtifactSourceBase {
  readonly kind: 'bytes'
  readonly size?: bigint
  read(offset: bigint, length: number, signal?: AbortSignal): Promise<Uint8Array>
  stream(
    range?: { readonly offset: bigint; readonly length?: bigint },
    signal?: AbortSignal,
  ): AsyncIterable<Uint8Array>
}

/** Directory, mount-root, CASC, and other bounded namespace candidates. */
export interface ArtifactNamespaceSource extends ArtifactSourceBase {
  readonly kind: 'namespace'
  openNamespace(signal?: AbortSignal): Promise<Lease<AssetNamespace>>
}

export type ArtifactSource = ArtifactByteSource | ArtifactNamespaceSource

export interface DerivedSubjectInputBinding {
  readonly bindingId: string
  readonly requirementId: string
  readonly role: string
  readonly subjectUri: string
  readonly revision: RevisionId
  readonly compositionFingerprint: string
}

/**
 * Host-owned derived candidate. It has no fake primary file: input subjects and the
 * optional materialization remain separate and revision-pinned.
 */
export interface DerivedArtifactSource {
  readonly kind: 'derived'
  readonly subjectUri: string
  readonly revision: RevisionId
  readonly inputs: readonly [DerivedSubjectInputBinding, ...DerivedSubjectInputBinding[]]
  readonly recipe?: DerivedRecipe
  readonly materialized?: ArtifactSource
  openInput(bindingId: string, signal?: AbortSignal): Promise<Lease<AssetSession>>
}

export type CodecCandidateSource = ArtifactSource | DerivedArtifactSource

export type CodecProbeRequest =
  | { readonly source: ArtifactByteSource; readonly plan: ByteProbePlan }
  | { readonly source: ArtifactNamespaceSource; readonly plan: NamespaceProbePlan }
  | { readonly source: DerivedArtifactSource; readonly plan: DerivedProbePlan }

export interface AssetNamespaceEntry {
  readonly path: string
  readonly kind: 'file' | 'directory'
  readonly size?: bigint
}

export interface AssetNamespace {
  readonly revision: RevisionId
  list(prefix: string, signal?: AbortSignal): AsyncIterable<AssetNamespaceEntry>
  open(path: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>>
}

interface ResolvedAssetInputBindingBase<
  Ownership extends AssetInputRequirement['ownership'] = AssetInputRequirement['ownership'],
> {
  readonly bindingId: string
  readonly role: string
  readonly ownership: Ownership
  readonly source: AssetSourceRef
  readonly revision: RevisionId
}

export type ResolvedCandidateInputBinding = ResolvedAssetInputBindingBase<'owned' | 'external'> & {
  readonly sourceKind: 'candidate'
  readonly requirementId?: never
}

export type ResolvedRequirementInputBinding = ResolvedAssetInputBindingBase & {
  readonly sourceKind: 'requirement'
  readonly requirementId: string
}

export type ResolvedAssetInputBinding =
  ResolvedCandidateInputBinding | ResolvedRequirementInputBinding

interface AssetInputRevisionBinding {
  readonly bindingId: string
  readonly revision: RevisionId
}

interface AssetInputRevisionVectorBase<
  Bindings extends readonly AssetInputRevisionBinding[] = readonly AssetInputRevisionBinding[],
> {
  readonly revision: RevisionId
  readonly bindings: Bindings
  readonly compositionFingerprint: string
}

export type AssetInputRevisionVector =
  | (AssetInputRevisionVectorBase<readonly [AssetInputRevisionBinding]> & {
      readonly topology: 'single'
      readonly namespaceRevision?: never
      readonly subjects?: never
    })
  | (AssetInputRevisionVectorBase<
      readonly [AssetInputRevisionBinding, ...AssetInputRevisionBinding[]]
    > & {
      readonly topology: 'bundle'
      readonly namespaceRevision?: never
      readonly subjects?: never
    })
  | (AssetInputRevisionVectorBase & {
      readonly topology: 'namespace'
      readonly namespaceRevision: RevisionId
      readonly subjects?: never
    })
  | (AssetInputRevisionVectorBase & {
      readonly topology: 'derived'
      readonly namespaceRevision?: never
      readonly subjects: readonly [
        {
          readonly bindingId: string
          readonly revision: RevisionId
          readonly compositionFingerprint: string
        },
        ...{
          readonly bindingId: string
          readonly revision: RevisionId
          readonly compositionFingerprint: string
        }[],
      ]
    })

interface AssetInputBase<
  RevisionVector extends AssetInputRevisionVector,
  Bindings extends readonly ResolvedAssetInputBinding[],
> {
  readonly bindings: Bindings
  readonly revisions: RevisionVector
  bindingsFor(
    requirementId: string,
  ): readonly Extract<ResolvedAssetInputBinding, { readonly sourceKind: 'requirement' }>[]
  openBinding(bindingId: string, signal?: AbortSignal): Promise<Lease<ArtifactSource>>
}

interface PhysicalResolvedAssetInput<
  Topology extends 'single' | 'bundle',
  Bindings extends readonly ResolvedAssetInputBinding[],
> extends AssetInputBase<
  Extract<AssetInputRevisionVector, { readonly topology: Topology }>,
  Bindings
> {
  readonly originKind: Topology
  /** Names one member of `bindings`; host validation rejects a dangling id. */
  readonly primaryBindingId: string
  readonly openNamespace?: never
}

export type SingleAssetInput = PhysicalResolvedAssetInput<
  'single',
  readonly [ResolvedCandidateInputBinding]
>
export type BundleAssetInput = PhysicalResolvedAssetInput<
  'bundle',
  readonly [ResolvedCandidateInputBinding, ...ResolvedRequirementInputBinding[]]
>
export type SingleOrBundleAssetInput = SingleAssetInput | BundleAssetInput

export interface NamespaceAssetInput extends AssetInputBase<
  Extract<AssetInputRevisionVector, { readonly topology: 'namespace' }>,
  readonly ResolvedRequirementInputBinding[]
> {
  readonly originKind: 'namespace'
  openNamespace(signal?: AbortSignal): Promise<Lease<AssetNamespace>>
}

interface DerivedAssetInputBase {
  readonly originKind: 'derived'
  readonly subjects: readonly [DerivedSubjectInputBinding, ...DerivedSubjectInputBinding[]]
  readonly recipe?: DerivedRecipe
  readonly revisions: Extract<AssetInputRevisionVector, { readonly topology: 'derived' }>
  subjectsFor(requirementId: string): readonly DerivedSubjectInputBinding[]
  openSubject(bindingId: string, signal?: AbortSignal): Promise<Lease<AssetSession>>
}

export type DerivedAssetInput = DerivedAssetInputBase &
  (
    | { readonly materialized?: never; readonly openMaterialized?: never }
    | {
        readonly materialized: ResolvedRequirementInputBinding
        openMaterialized(signal?: AbortSignal): Promise<Lease<ArtifactSource>>
      }
  )

/** Complete host-resolved input; topology and revision vector are immutable. */
export type AssetInput = SingleOrBundleAssetInput | NamespaceAssetInput | DerivedAssetInput

export interface Codec {
  probe(request: CodecProbeRequest, signal?: AbortSignal): Promise<DetectionResult>
  planInput?(
    source: CodecCandidateSource,
    evidence: DetectionResult,
    signal?: AbortSignal,
  ): Promise<AssetInputPlan>
  open(
    input: AssetInput,
    intent: OpenIntent,
    budget: ResourceBudget,
    signal?: AbortSignal,
  ): Promise<AssetSession>
}

export interface CodecModule {
  readonly abiVersion: 1
  createCodec(context: ContributionContext): Codec
}

export interface ByteStreamSource {
  readonly bytes?: bigint
  chunks(signal?: AbortSignal): AsyncIterable<Uint8Array>
}

/** Open registry; editing/conversion packages may augment it before A-5 freezes the seam. */
export interface OperationOutputMap {
  json: { readonly kind: 'json'; readonly value: JsonValue }
  bytes: { readonly kind: 'bytes'; readonly value: Uint8Array }
  stream: { readonly kind: 'stream'; readonly stream: Lease<ByteStreamSource> }
  source: { readonly kind: 'source'; readonly source: AssetSourceRef }
  artifact: {
    readonly kind: 'artifact'
    readonly artifactId: string
    readonly digest: string
    readonly bytes: bigint
  }
  none: { readonly kind: 'none' }
}

export type OperationOutput = OperationOutputMap[keyof OperationOutputMap]
export type OperationRejection =
  | 'not-declared'
  | 'disabled'
  | 'dependency-required'
  | 'permission-missing'
  | 'input-not-serializable'
  | 'handler-unregistered'
  | 'cancelled'
  | 'stale-revision'

export type OperationResult =
  | {
      readonly state: 'ok'
      readonly output: OperationOutput
      readonly diagnostics: readonly Diagnostic[]
    }
  | {
      readonly state: 'rejected'
      readonly reason: OperationRejection
      readonly diagnostics: readonly Diagnostic[]
    }

export interface OperationSession {
  invoke(
    handlerId: string,
    input: JsonValue,
    options?: {
      readonly signal?: AbortSignal
      readonly onProgress?: (progress: Progress) => void
    },
  ): Promise<OperationResult>
  dispose(): Promise<void>
}

export type SessionState = 'live' | 'stale-revision' | 'disposed'
export type AssetSessionEvent =
  | { readonly kind: 'descriptor'; readonly descriptor: AnyDescriptor }
  | { readonly kind: 'state'; readonly state: SessionState }
  | { readonly kind: 'diagnostic'; readonly diagnostic: AssetDiagnostic }

export interface AssetSession {
  readonly revision: RevisionId
  state(): SessionState
  descriptor(): Promise<AnyDescriptor>
  dataSource<Contract extends KnownDataSourceId, Major extends DataSourceMajor<Contract>>(
    contract: Contract,
    major: Major,
  ): Promise<Lease<DataSourceOf<Contract, Major>>>
  operations(): OperationSession
  events(signal?: AbortSignal): AsyncIterable<AssetSessionEvent>
  dispose(): Promise<void>
}

/** Parameterized at module level: a single-contract module cannot claim another contract. */
type ContractMajorOfUnion<Contract extends KnownContractId> = Contract extends KnownContractId
  ? ContractMajor<Contract>
  : never

/**
 * Resolver-selected logical offer presented at provider activation.
 *
 * `offerId` preserves multiple offers for the same contract major. The optional selection key is
 * the contract-owned, canonical, non-secret matcher result. Raw request/offer facets are
 * deliberately absent: neither activation tickets nor provider-policy locks may become a secret
 * transport, and a provider can branch on this stable binding without repeating resolution.
 */
export type SelectedServiceOffer<
  Contract extends KnownContractId = KnownContractId,
  AllowedMajor extends number = ContractMajorOfUnion<Contract>,
> = Contract extends KnownContractId
  ? AllowedMajor extends ContractMajor<Contract>
    ? {
        readonly offerId: string
        readonly contract: Contract
        readonly major: AllowedMajor
        readonly contractSelectionKey?: string
        readonly facet?: never
        readonly requestFacet?: never
        readonly offerFacet?: never
      }
    : never
  : never

export interface ServiceProviderModule<
  Contract extends KnownContractId = KnownContractId,
  AllowedMajor extends number = ContractMajorOfUnion<Contract>,
> {
  readonly abiVersion: 1
  readonly provides: readonly Contract[]
  createProvider<Selected extends Contract, Major extends ContractMajor<Selected> & AllowedMajor>(
    selection: SelectedServiceOffer<Selected, Major>,
    context: ContributionContext,
  ): Promise<Lease<ContractOf<Selected, Major>>>
}

/** Compile-only aliases make the open-map ownership explicit on this ABI surface. */
export type RuntimeContractMap = ContractMap
