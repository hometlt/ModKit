/**
 * A-1 wire contracts selected by ContributionManifestV1.contract.
 *
 * These are JSON-facing declarations. Runtime-only branded authoring handles belong to A-4;
 * keeping them out of the wire DTOs lets the schema const remain the exact authority.
 */

import type { ContractId, TraitId } from '@modkit/core'
import type { ConformanceProfileId, DataSourceRefFor } from '../asset-capabilities/data-sources.js'
import type {
  AssetOperationId,
  JsonSchemaRef,
  JsonValue,
  TraitQueryRequirementFor,
} from '../asset-capabilities/types.js'
import type { PermissionClass } from './contribution-types.js'
import type { ContractRequirement, ContractRequirementWire } from '../resolution/types.js'
import type {
  ForeignServiceContractId,
  ContractMajor,
  KnownContractId,
  ServiceContractOfferFacet,
} from '../service-contracts.js'

export type JsonSchema = Readonly<Record<string, unknown>>

export type HostId = string

/** One inert UI message catalog resource owned by an extension artifact. */
export interface LocalizationCatalogResourceV1Wire {
  /** BCP-47 locale declared by the catalog document. */
  readonly locale: string
  /** Confined, portable POSIX-relative path to a JSON catalog inside the extension artifact. */
  readonly path: string
  /** Requested message-key privileges; the host remains the authority that grants them. */
  readonly messagePrefixes: readonly string[]
}

/** Data-only localization contribution. It never declares a runtime variant or executable code. */
export interface LocalizationContributionSpecV1Wire {
  readonly catalogs: readonly LocalizationCatalogResourceV1Wire[]
}

export interface ContributionSpecIdPlane {
  readonly contract: string
  readonly trait: string
  readonly operation: string
  readonly requirement: ContractRequirementWire
}

export interface ValidatedContributionSpecIdPlane extends ContributionSpecIdPlane {
  readonly contract: ContractId
  readonly trait: TraitId
  readonly operation: AssetOperationId
  readonly requirement: ContractRequirement
}

export interface WireContributionSpecIdPlane extends ContributionSpecIdPlane {
  readonly contract: string
  readonly trait: string
  readonly operation: string
  readonly requirement: ContractRequirementWire
}

export interface ResourceBudgetWire {
  /** Canonical decimal u64. Runtime code receives bigint after validated conversion. */
  readonly maxInputBytes: string
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxScalarBytes: number
  readonly maxDiagnostics: number
  readonly deadlineMs?: number
}

export interface FormatRef {
  readonly formatId: string
  readonly label: string
  readonly mediaType?: string
}

/** NXT-101B declared byte signature (data only; the host never derives one). */
export interface SignatureRule {
  readonly from: 'start' | 'end'
  /** Bytes from the anchor to the pattern start; for 'end' the pattern ends at `size - offset + length`. */
  readonly offset: number
  /** Lowercase hex, 1–64 bytes. */
  readonly bytesHex: string
  /** Optional AND-mask over both sides, same length as `bytesHex`. */
  readonly maskHex?: string
}

export interface MatchRules {
  readonly extensions?: readonly string[]
  readonly mediaTypes?: readonly string[]
  readonly pathGlobs?: readonly string[]
  /** Byte signatures that admit a candidate when name/media/path rules do not (renamed files). */
  readonly signatures?: readonly SignatureRule[]
}

export type FormatRole = 'container' | 'media' | 'byte-transform' | 'semantic' | 'index' | 'sidecar'

export type SourceTopology = 'single' | 'bundle' | 'namespace' | 'derived'
export type ArtifactStage = 'authored' | 'compiled' | 'runtime'
export type OpenIntent = 'probe' | 'inspect' | 'thumbnail' | 'full' | 'stream' | 'export'

export interface ByteProbePlan {
  readonly kind: 'bytes'
  readonly ranges: readonly {
    readonly from: 'start' | 'end'
    readonly length: number
  }[]
  readonly maxBytes: number
}

export interface NamespaceProbePlan {
  readonly kind: 'namespace'
  /** Exact marker paths a codec may inspect; namespace-wide traversal is never a probe. */
  readonly markers: readonly string[]
  readonly prefixes?: readonly string[]
  readonly maxEntries: number
  readonly maxBytes: number
  readonly maxDepth: number
  readonly maxPathBytes: number
}

/**
 * Host-owned composition alias for a semantic namespace codec carried by a container format.
 *
 * The alias is data only. It does not grant the semantic codec the container session, its byte
 * source, or any container operation. The host selects and retains that provider independently.
 */
/**
 * Entry paths inside one source that stand for the whole source.
 *
 * Opening such an entry opens the source instead: `MapInfo` names a StarCraft II map and carries
 * little beyond that name, and a person who opened it came for the map. Compared case-insensitively
 * against the entry path relative to the source root, so common code never learns a format's names.
 */
export type CodecAnchorDocuments = readonly string[]

export interface ContainerTopologyAlias {
  readonly formatId: string
  /**
   * Directories inside the container that logical resource ids (`Assets/…`) resolve under, in
   * lookup order. `''` is the container root; `*.Suffix` matches every top-level directory with that
   * suffix (per-locale asset folders). Absent means the container root only.
   */
  readonly assetRoots?: readonly string[]
  /**
   * File names that make a folder this container, unpacked, when the container has no extension of
   * its own (a Minecraft resource pack is any folder holding `pack.mcmeta`). Compared
   * case-insensitively; the nearest such folder above a file bounds its `enclosing-container` scope.
   */
  readonly markers?: readonly string[]
}

export interface DerivedProbePlan {
  readonly kind: 'derived'
  readonly maxSubjects: number
  readonly maxRelationDepth: number
}

export type ProbePlan = ByteProbePlan | NamespaceProbePlan | DerivedProbePlan
export type TopologyProbePlan =
  | {
      readonly sourceTopology: 'single' | 'bundle'
      readonly container?: never
      readonly probe: ByteProbePlan
    }
  | {
      readonly sourceTopology: 'namespace'
      readonly container?: ContainerTopologyAlias
      readonly probe: NamespaceProbePlan
    }
  | {
      readonly sourceTopology: 'derived'
      readonly container?: never
      readonly probe: DerivedProbePlan
    }

export type CompanionSearchScope =
  | 'sibling-directory'
  | 'current-mount'
  | 'enclosing-container'
  | 'workspace-dependency-layer'
  | 'explicit-user-selection'

export interface CompanionRule<
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> {
  /** Stable identity reused by `AssetInputRequirement.id` in the resolved planning phase. */
  readonly id: string
  readonly role: string
  /** Static availability requirement; `planInput` refines it to exact cardinality. */
  readonly required: boolean
  readonly patterns: readonly string[]
  readonly expected?: {
    readonly all?: readonly TraitQueryRequirementFor<Ids['trait']>[]
    readonly any?: readonly TraitQueryRequirementFor<Ids['trait']>[]
    readonly none?: readonly TraitQueryRequirementFor<Ids['trait']>[]
  }
  readonly searchScopes: readonly CompanionSearchScope[]
}

export interface RepresentationDecl<
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> {
  readonly id: string
  readonly contract: Ids['contract']
  readonly major: number
  readonly stage: ArtifactStage
  readonly lossy: boolean
}

export type OperationOutputKind =
  'json' | 'bytes' | 'stream' | 'source' | 'artifact' | 'none' | 'edit-plan' | 'transaction'

export interface OperationDecl<
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> {
  readonly id: Ids['operation']
  readonly handlerId: string
  readonly mutatesSource: boolean
  readonly requiredPermissions?: readonly PermissionClass[]
  readonly requiresContract?: Ids['requirement']
  readonly inputSchema?: JsonSchemaRef
  readonly outputKinds?: readonly OperationOutputKind[]
}

export type TraitPresence = 'may-expose' | 'will-expose'
export type TraitRepresentation = 'source' | 'compiled' | 'runtime'

/** Authored release metadata only; evidence, probe results and observed instances are separate. */
export interface TraitDeclaration<
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> {
  readonly id: Ids['trait']
  /** Exact installed definition selected by a producer; consumers use definitionRange. */
  readonly definitionVersion?: string
  readonly representation: TraitRepresentation
  readonly presence: TraitPresence
  readonly prerequisites?: readonly Ids['requirement'][]
  readonly evidenceRefs?: readonly string[]
}

/** MK3/30 §7 execution tiers; not a read/render/edit capability claim. */
export type ImplementationTier = 1 | 2 | 3 | 4 | 5

/** Authored contribution data contains only the claimed tier. */
export interface ImplementationTierClaim {
  readonly claimed: ImplementationTier
}

/** Host/conformance-owned projection; never accepted from an authored spec. */
export interface ImplementationTierRecord extends ImplementationTierClaim {
  readonly proven: ImplementationTier
  readonly evidenceId: string
  readonly conformanceProfile: ConformanceProfileId
}

/**
 * An authored citation for a codec fidelity proof. The writer's provider/version/artifact
 * coordinates are deliberately absent: the host derives those from the inventory record that
 * carried this declaration, so applications never have to copy extension identity literals.
 */
export interface CodecFidelityEvidenceDeclaration {
  readonly formatId: string
  readonly representationId: string
  readonly claim:
    | {
        readonly roundTrip: 'byte-identical'
        readonly preservesUnknownData: true
        readonly notes?: readonly string[]
      }
    | {
        readonly roundTrip: 'semantic'
        readonly preservesUnknownData: boolean
        readonly notes?: readonly string[]
      }
    | {
        readonly roundTrip: 'lossy' | 'none'
        readonly preservesUnknownData: false
        readonly notes?: readonly string[]
      }
  readonly evidenceId: string
  readonly corpusId: string
  readonly corpusDigest: string
  readonly conformanceProfile: string
  readonly optionsFingerprint: string
  readonly inputClass: string
  readonly provenAt: string
}

/**
 * An authored citation for one concrete service offer's writer fidelity proof.
 *
 * `offerId` joins the citation to the exact logical `common.edit/writer@1` offer while
 * `evidenceId` must agree with that offer's facet. Provider/version/artifact coordinates remain
 * host-owned and are materialized from trusted inventory, just as they are for codec evidence.
 */
export interface ServiceProviderFidelityEvidenceDeclaration {
  readonly offerId: string
  readonly evidenceId: string
  readonly claim: CodecFidelityEvidenceDeclaration['claim']
  readonly corpusId: string
  readonly corpusDigest: string
  readonly conformanceProfile: string
  readonly optionsFingerprint: string
  readonly inputClass: string
  readonly provenAt: string
}

interface CodecContributionSpecV1Base<
  DataSourceContract extends string = string,
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> {
  readonly formatRefs: readonly FormatRef[]
  readonly roles: readonly FormatRole[]
  readonly artifactStages: readonly ArtifactStage[]
  readonly openIntents: readonly OpenIntent[]
  readonly match: MatchRules
  readonly anchorDocuments?: CodecAnchorDocuments
  readonly companions?: readonly CompanionRule<Ids>[]
  readonly representations: readonly RepresentationDecl<Ids>[]
  readonly publishesDataSources: readonly DataSourceRefFor<DataSourceContract>[]
  readonly requires?: readonly Ids['requirement'][]
  readonly operations: readonly OperationDecl<Ids>[]
  readonly traitDeclarations?: readonly TraitDeclaration<Ids>[]
  readonly fidelityEvidence?: readonly CodecFidelityEvidenceDeclaration[]
  readonly implementationTier: ImplementationTierClaim
  readonly budgets: ResourceBudgetWire
}

export type CodecContributionSpecV1<
  DataSourceContract extends string = string,
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> = CodecContributionSpecV1Base<DataSourceContract, Ids> & TopologyProbePlan

export type CodecContributionSpecV1Wire = CodecContributionSpecV1<
  string,
  WireContributionSpecIdPlane
>

/**
 * Authored logical offer. Named separately from the resolver's selected ContractOffer so the
 * contribution plane and resolution plane cannot be confused in public imports.
 */
export interface ServiceContractOfferDeclaration<
  Contract extends string = ContractId,
  Facet = JsonValue,
> {
  readonly offerId: string
  readonly contract: Contract
  readonly major: number
  readonly version: string
  /** Contract-specific inventory facet; its selected contract registration validates the value. */
  readonly facet?: Facet
}

export type KnownServiceContractOfferDeclaration<
  Contract extends KnownContractId,
  Major extends ContractMajor<Contract>,
> = {
  readonly offerId: string
  readonly contract: Contract
  readonly major: Major
  readonly version: string
} & ServiceContractOfferFacet<Contract, Major>

/** A contract unknown to this build has no inferred facet, but its wire data remains JSON-safe. */
export interface OpaqueServiceContractOfferDeclaration<
  Contract extends string,
  Major extends number,
> {
  readonly offerId: string
  readonly contract: ForeignServiceContractId<Contract>
  readonly major: Major
  readonly version: string
  readonly facet?: JsonValue
}

/**
 * A literal contract keeps its contract/facet correlation. The default `string` branch is the raw
 * schema-shaped DTO used after JSON validation; authoring APIs should always retain a literal K.
 */
export type ServiceContractOfferFor<
  Contract extends string,
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> = string extends Contract
  ? ServiceContractOfferDeclaration<Ids['contract'], JsonValue>
  : Contract extends KnownContractId
    ? {
        [Major in ContractMajor<Contract>]: KnownServiceContractOfferDeclaration<Contract, Major>
      }[ContractMajor<Contract>]
    : OpaqueServiceContractOfferDeclaration<Contract, number>

export interface ServiceProviderContributionSpecV1<
  Contract extends string = string,
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> {
  readonly provides: readonly ServiceContractOfferFor<Contract, Ids>[]
  readonly fidelityEvidence?: readonly ServiceProviderFidelityEvidenceDeclaration[]
  readonly requires?: readonly Ids['requirement'][]
  readonly inputs?: readonly string[]
  readonly outputs?: readonly TraitDeclaration<Ids>[]
  readonly protocolOperations?: readonly string[]
  readonly replacement?: {
    readonly target: Ids['requirement']
    readonly compatible: boolean
  }
  readonly lifecycleScope: 'session' | 'operation' | 'process'
  readonly applicableVariants?: readonly string[]
}

export type ServiceProviderContributionSpecV1Wire = ServiceProviderContributionSpecV1<
  string,
  WireContributionSpecIdPlane
>

export type TraitRequirement<
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> = TraitQueryRequirementFor<Ids['trait']>

/** Data-only eligibility evaluated before singleton selection; no viewer code is activated. */
export interface ViewerApplicability {
  readonly interpretation?: 'none' | 'codec' | 'any'
  readonly sourceBytes?: {
    readonly maximum?: string
  }
  readonly longestLineBytes?: {
    readonly maximum: number
    readonly whenUnknown: 'eligible' | 'ineligible'
  }
}

export interface ViewerContributionSpecV1<
  DataSourceContract extends string = string,
  Ids extends ContributionSpecIdPlane = ValidatedContributionSpecIdPlane,
> {
  readonly kind: 'stage' | 'tree' | 'panel' | 'toolbar' | 'transport' | 'status' | 'fallback'
  readonly requiresTraits?: readonly TraitRequirement<Ids>[]
  readonly requiresOperations?: readonly Ids['operation'][]
  readonly consumesDataSources: readonly DataSourceRefFor<DataSourceContract>[]
  /**
   * Sources read when the subject publishes them, ignored when it does not.
   *
   * Separate from `consumesDataSources` because eligibility is decided by that list alone: a facet
   * named here can never cost a stage a subject that publishes none of them, which is what lets one
   * generic viewer read optional facets without splitting into two contributions.
   */
  readonly optionalDataSources?: readonly DataSourceRefFor<DataSourceContract>[]
  /**
   * Service contracts the viewer asks the host for, and does without when the host has none.
   *
   * A data source belongs to the opened subject; a service belongs to the realm the viewer runs
   * in. `common.render/scene-3d` is the first of these: the model stage renders through a resolved
   * provider where one is offered and through its own 2D fallback where none is, and neither
   * answer may cost it the stage. Naming it here is what gives the eligibility system a path to
   * the renderer at all — before this key the dependency could only be written as a data source,
   * which is a binding the resolver can never make.
   */
  readonly optionalServices?: readonly Ids['requirement'][]
  readonly applicability?: ViewerApplicability
  readonly hosts?: readonly HostId[]
  readonly priority: number
  readonly conflicts?: readonly string[]
  readonly singletonGroup?: string
}

export type ViewerContributionSpecV1Wire = ViewerContributionSpecV1<
  string,
  WireContributionSpecIdPlane
>
