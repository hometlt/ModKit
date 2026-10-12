/** Interface-only runtime ABI. Host behavior lands in A-2/A-3; no extension code runs here. */

import type { Diagnostic, OperationId } from '@modkit/core'
import type { RasterResourcePort } from './raster-resources.js'
import type { ModelResourcePort } from './model-resources.js'
import type { LogicalResourcePort } from './logical-resources.js'
import type { InstallationProbes } from './installation-probes.js'
import type { VideoFrameDecoder } from './video-frames.js'
import type { InstallationFiles } from './installation-files.js'
import type { CredentialPort } from './credentials.js'
import type { DataEntityRef, DataLocalizedString, DataResolvedEntity } from './data/index.js'
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

/** Host-attested identity of the contribution currently being activated. */
export interface ContributionProviderIdentity {
  readonly providerId: string
  readonly providerVersion: string
  readonly artifactDigest: string
}

/**
 * Settings a host hands one contribution — the user's answer to questions only that codec or
 * provider can ask ("cache this installation's index", "stream these prefixes"). Plain data, so
 * it crosses the worker boundary as a copy; a contribution reads what it knows and ignores the
 * rest, and supplies its own default for a key the host did not set.
 *
 * `bySource` narrows the same keys per opened source, keyed by that source's uri: one installed
 * game may cache its index while another does not.
 */
export interface ContributionSettings {
  readonly values: Readonly<Record<string, unknown>>
  readonly bySource?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

/** The settings that apply to one source: the contribution's values with its overrides on top. */
export function contributionSettingsFor(
  settings: ContributionSettings | undefined,
  sourceUri: string | undefined,
): Readonly<Record<string, unknown>> {
  if (settings === undefined) return Object.freeze({})
  const override = sourceUri === undefined ? undefined : settings.bySource?.[sourceUri]
  return Object.freeze(
    override === undefined ? { ...settings.values } : { ...settings.values, ...override },
  )
}

export interface ContributionContext {
  readonly contracts: ContractResolverPort
  /** Available after the owning subject opens; sources and codecs are selected by its host. */
  readonly rasterResources?: RasterResourcePort
  readonly modelResources?: ModelResourcePort
  /** Host-owned logical resources, live after open and before initial descriptor inspection. */
  readonly logicalResources?: LogicalResourcePort
  readonly diagnostics: DiagnosticSink
  readonly budgets: ResourceBudget
  /** Present for service providers activated from trusted inventory; never extension-authored. */
  readonly providerIdentity?: ContributionProviderIdentity
  /** The host's settings for this contribution; absent when the host configures none. */
  readonly settings?: ContributionSettings
  /** Where platforms installed games, for installation providers on a trusted desktop host. */
  readonly installationProbes?: InstallationProbes
  /** Decodes one video frame (a desktop host with ffmpeg); absent where no decoder exists. */
  readonly videoFrames?: VideoFrameDecoder
  /** Files of a game's confirmed installation, read-only by path (a desktop host that knows one). */
  readonly installationFiles?: InstallationFiles
  /** What the enclosing container hands a subject opened from one of its entries (inert JSON). */
  readonly containerContext?: JsonValue
  /** The sign-ins and keys this extension declared, through the host's broker. */
  readonly credentials?: CredentialPort
  /**
   * The opened subject's place in its mod context: resolved catalog entities by reference, with the
   * values the whole dependency chain gives them (parents, overrides, layers). A host that places
   * subjects in mod contexts hands it over; a card asks for the entities it shows, never a catalog.
   */
  readonly catalog?: SubjectCatalogPort
  /**
   * The servers of the mods the host has loaded (owner decision 07.10: a loaded mod's ModContext is
   * the one holder of its data). A language provider whose request names a mod context
   * (`LanguageWorkspaceContext.modContext`) asks that server game-defined questions a few entities
   * at a time instead of receiving resolved data whole. Absent where the host loads no mods.
   */
  readonly modContexts?: ModContextQueryPort
  readonly signal?: AbortSignal
}

/**
 * A host's port to the server of one loaded mod, addressed by the scope a language request names
 * (`LanguageWorkspaceContext.modContext`). `question` is the game's own (`ModContext.query`); the
 * answer is bounded JSON. Files are named in an answer by the context's layer and a layer-relative
 * path: when the answer has a top-level `documents` array of `{ layerId, path }`, the host completes
 * each entry with the `uri` it addresses that file by in language requests, so a provider never
 * builds one. A scope the host no longer serves is refused.
 */
export interface ModContextQueryPort {
  query(scope: string, question: JsonValue, signal?: AbortSignal): Promise<JsonValue>
}

export interface SubjectCatalogPort {
  entities(
    refs: readonly DataEntityRef[],
    signal?: AbortSignal,
  ): Promise<readonly DataResolvedEntity[]>
  /**
   * Localized strings by key (names, tooltips, hotkeys), each in the first of `locales` that has
   * it, else along the game's fallback chain (`fallback: true`); a key nothing defines is left
   * out. Absent where the host places no subject in a mod context that keeps strings.
   */
  strings?(
    keys: readonly string[],
    locales?: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly DataLocalizedString[]>
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
  /** Host-snapshotted inert facts from this exact entry, pinned into its resource revision. */
  readonly containerContext?: JsonValue
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
  /** Bounded carrier bytes before the namespace payload, when the carrier exposes them. */
  readPreamble?(maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
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
  /** Exact host-pinned namespace root; it is not represented as a fake byte binding. */
  readonly root: AssetSourceRef
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
  bytes: {
    readonly kind: 'bytes'
    readonly value: Uint8Array
    /** The file extension the bytes are, without its dot (`m3`, `map`), when the producer knows it. */
    readonly extension?: string
    readonly mediaType?: string
  }
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
