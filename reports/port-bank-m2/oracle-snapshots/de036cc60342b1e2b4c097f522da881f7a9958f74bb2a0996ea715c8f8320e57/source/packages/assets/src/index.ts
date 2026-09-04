/**
 * `@modkitx/assets` — presentation-neutral asset contracts.
 *
 * Two layers live here:
 *
 * 1. the current domain-neutral codec primitives shared by every `<domain>-processing` package
 *    (`FormatRegistry`, `AssetResolver`, `CompanionSpec`); and
 * 2. the normative v1 asset pipeline contract from
 *    [`docs/architecture/ASSET_CAPABILITIES.md`](../../../docs/architecture/ASSET_CAPABILITIES.md)
 *    and canonical architecture section 5: `AssetSource` -> detection/ranking ->
 *    `AssetDescriptor` -> viewer contributions, plus cancellation, diagnostics, and the
 *    operation/edit/output contracts of section 5.5.
 *
 * The package stays browser-safe and depends only on `@modkitx/core`: no `node:*`, no DOM API,
 * no VS Code, no game or semantic codec. Descriptors are serializable by contract — runtime handlers,
 * workers, sessions, and file handles are referenced by stable IDs and never embedded.
 *
 * The v1 codec manifest contract and browser-safe structural validator are also owned here.
 * Provider, extension, and preset manifests remain separate future contracts.
 */

// --- serializability -------------------------------------------------------------------
export { isJsonSerializable, type JsonObject, type JsonPrimitive, type JsonValue } from './json.js'

// --- cancellation ----------------------------------------------------------------------
export {
  CancellationError,
  CancellationTokenCancelled,
  CancellationTokenNone,
  CancellationTokenSource,
  abortSignalFromCancellationToken,
  cancellationTokenFromAbortSignal,
  isCancellationError,
  throwIfCancelled,
  type CancellationSubscription,
  type CancellationToken,
} from './cancellation.js'

// --- progress --------------------------------------------------------------------------
export {
  ASSET_PROGRESS_SCHEMA_VERSION,
  createAssetProgressReporter,
  type AssetProgress,
  type AssetProgressListener,
  type AssetProgressRange,
  type AssetProgressReporter,
  type AssetProgressReporterOptions,
  type AssetProgressUpdate,
} from './progress.js'

// --- diagnostics -----------------------------------------------------------------------
export {
  collectDiagnosticsById,
  compareDiagnosticSeverity,
  findDanglingDiagnosticIds,
  worstDiagnosticSeverity,
  type AssetDiagnostic,
  type AssetDiagnosticCategory,
  type AssetDiagnosticSeverity,
} from './diagnostics.js'

// --- sources ---------------------------------------------------------------------------
export {
  ASSET_SOURCE_KINDS,
  ASSET_SOURCE_ORIGINS,
  createAssetSourceDescriptor,
  createMemoryAssetSource,
  formatSourceLocation,
  isKnownAssetSourceKind,
  readSourceHeader,
  readSourceTail,
  sourceIdentityKey,
  sourceNestingDepth,
  type AssetChild,
  type AssetChildListOptions,
  type AssetReadOptions,
  type AssetSource,
  type AssetSourceContext,
  type AssetSourceDescriptor,
  type AssetSourceDescriptorInit,
  type AssetSourceKind,
  type AssetSourceOrigin,
  type SourceRange,
} from './source.js'

// --- provenance ------------------------------------------------------------------------
export {
  ASSET_PROVENANCE_SCHEMA_VERSION,
  ASSET_PROVENANCE_STEP_KINDS,
  appendAssetProvenanceStep,
  assetProvenanceFromSourceDescriptor,
  isAssetProvenance,
  type AssetProvenance,
  type AssetProvenanceStep,
  type AssetProvenanceStepKind,
} from './provenance.js'

// --- capabilities (traits) -------------------------------------------------------------
export {
  CAPABILITY_IDS,
  findCapability,
  isKnownCapabilityId,
  isWellFormedCapabilityId,
  satisfiesCapabilityRequirement,
  type CapabilityId,
  type CapabilityInstance,
  type CapabilityRequirement,
  type CapabilityState,
  type KnownCapabilityId,
} from './capabilities.js'

// --- operations ------------------------------------------------------------------------
export {
  ASSET_OPERATION_IDS,
  ASSET_PERMISSIONS,
  findOperation,
  isKnownAssetOperationId,
  isOperationAvailable,
  operationHandlerId,
  type AssetOperationDescriptor,
  type AssetOperationId,
  type AssetOperationState,
  type AssetOutputDescriptor,
  type AssetPermission,
  type KnownAssetOperationId,
  type KnownAssetPermission,
  type OperationUnavailableReason,
  type RuntimeDependencyRef,
} from './operations.js'

// --- detection and ambiguity -----------------------------------------------------------
export {
  DETECTION_EVIDENCE_KINDS,
  candidateEvidenceTier,
  detectionEvidenceWeight,
  rankDetectionCandidates,
  type AssetCandidate,
  type AssetRoute,
  type CandidateRejectionCode,
  type DetectionEvidence,
  type DetectionEvidenceKind,
  type DetectionRankingOptions,
  type DetectionResult,
  type RejectedCandidate,
} from './detection.js'

// --- viewer contributions --------------------------------------------------------------
export {
  CONTRIBUTION_KINDS,
  HOST_IDS,
  resolveContributions,
  type ContributionKind,
  type ContributionRejectionCode,
  type ContributionResolution,
  type ContributionResolutionInput,
  type HostId,
  type KnownHostId,
  type RejectedContribution,
  type ViewerContributionDescriptor,
} from './contributions.js'

// --- shared code/hex view descriptors -------------------------------------------------
export {
  DEFAULT_CODE_VIEW_POLICY,
  DEFAULT_HEX_VIEW_POLICY,
  VIEW_DESCRIPTOR_SCHEMA_VERSION,
  routeViewFallback,
  sampleLooksText,
  type AssetViewDescriptor,
  type CodeViewDescriptor,
  type CodeViewDiffDescriptor,
  type CodeViewSelection,
  type HexViewDescriptor,
  type HexViewDiffDescriptor,
  type HexViewSelection,
  type StructureRangeAnnotation,
  type TextPosition,
  type TextRange,
  type ViewCommandDescriptor,
  type ViewEditCapability,
  type ViewFallbackInput,
  type ViewFallbackRoute,
  type ViewResourcePolicy,
  type ViewSourceVersion,
} from './view-descriptors.js'

// --- descriptor v1 ---------------------------------------------------------------------
export {
  ASSET_CATEGORIES,
  ASSET_DESCRIPTOR_SCHEMA_VERSION,
  canRunOperation,
  getOperation,
  getTrait,
  hasTrait,
  isKnownAssetCategory,
  isSerializableDescriptor,
  referencedDiagnosticIds,
  subjectOf,
  type AssetCategory,
  type AssetConstraints,
  type AssetDescriptor,
  type AssetIdentity,
  type CompanionDescriptor,
  type FieldWriteRequest,
  type MetadataEditable,
  type MetadataEditorKind,
  type MetadataEntry,
  type MetadataEnumOption,
  type MetadataGroup,
  type MetadataValueKind,
  type SubjectDescriptor,
  type SubjectIdentity,
  type ViewableDescriptor,
} from './descriptor.js'

// --- operation, editing, and output contracts (architecture section 5.5) ---------------
export {
  sortSourceEdits,
  validateEditPlan,
  type AssetEditPlan,
  type AssetEditTransaction,
  type AssetOutput,
  type SourceEdit,
} from './editing.js'

// --- game content resolver value types (architecture section 5.3) ----------------------
export {
  flattenContentDependencies,
  orderContentMounts,
  type ContentDependency,
  type ContentDependencyKind,
  type ContentDependencyState,
  type ContentListRequest,
  type ContentMount,
  type ContentMountRole,
  type ContentResolveRequest,
  type ContentSourceOrder,
  type ResolvedContentSource,
} from './content.js'

// --- companions ------------------------------------------------------------------------
export type { AssetRequest, AssetResolver, CompanionSpec } from './companions.js'

export {
  assetByteResolverFromAssetResolver,
  assetResolverFromAssetByteResolver,
  assetSourceResolverFromSource,
  type AssetByteResolver,
  type AssetSourceResolver,
} from './resolvers.js'

// --- semantic artifact codec and game content resolver (architecture sections 5.2, 5.3) ---
export type {
  ArtifactContext,
  ArtifactOpenOptions,
  GameArtifactCodec,
  GameArtifactKind,
  GameContentResolver,
} from './artifact-codec.js'

// --- semantic artifact operation sessions -----------------------------------------------
export {
  createAssetOperationSession,
  type AssetOperationContext,
  type AssetOperationHandler,
  type AssetOperationHandlers,
  type AssetOperationInput,
  type AssetOperationInvocation,
  type AssetOperationSession,
  type AssetOperationSessionOptions,
  type CreateAssetOperationSessionInit,
} from './asset-session.js'

export {
  createArtifactOperationSession,
  type ArtifactOperationHandler,
  type ArtifactOperationHandlers,
  type ArtifactOperationInput,
  type ArtifactOperationInvocation,
  type ArtifactOperationSession,
  type ArtifactOperationSessionOptions,
  type CreateArtifactOperationSessionInit,
} from './artifact-session.js'

// --- semantic artifact registry -----------------------------------------------------------
export {
  ArtifactCodecRegistry,
  type ArtifactCodecSummary,
  type ArtifactRegistryOpenOptions,
  type ArtifactRouteOptions,
  type OpenedArtifact,
} from './artifact-registry.js'

// --- codec manifest v1 (architecture section 5.8; runbook slice C0) --------------------
export {
  loadAndActivateCodecRuntime,
  type CodecActivationContext,
  type CodecActivationHandle,
  type CodecActivationResult,
  type CodecCleanup,
  type CodecRuntimeActivator,
  type CodecRuntimeEntrypointKind,
  type CodecRuntimeLoadInput,
} from './codec-host.js'

export {
  CODEC_ARCHITECTURES,
  CODEC_CAPABILITIES,
  CODEC_CONFLICT_SCOPES,
  CODEC_DEPENDENCY_RELATIONS,
  CODEC_HOST_CAPABILITIES,
  CODEC_MANIFEST_KINDS,
  CODEC_MANIFEST_SCHEMA_VERSION,
  CODEC_OPERATING_SYSTEMS,
  CODEC_PERMISSION_CLASSES,
  CODEC_RUNTIME_AVAILABILITY,
  CODEC_RUNTIME_ENVIRONMENTS,
  CODEC_SUPPORT_STATUSES,
  CODEC_WEB_APIS,
  GAME_CONTRIBUTION_MODES,
  GAME_INSTALL_PRESET_MODES,
  codecManifestCoordinate,
  isCodecManifestV1,
  matchesCodecManifestPrefilter,
  runtimeTargetCompatible,
  selectCodecRuntimeVariants,
  validateCodecManifest,
  validateCodecManifestForRepository,
  type CodecArchitecture,
  type CodecCapability,
  type CodecConflictRef,
  type CodecConflictScope,
  type CodecDependencyRef,
  type CodecDependencyRelation,
  type CodecHostCapability,
  type CodecManifestDependencies,
  type CodecManifestDiagnostic,
  type CodecManifestDiagnosticSeverity,
  type CodecManifestEntrypoints,
  type CodecManifestKind,
  type CodecManifestMagicMatch,
  type CodecManifestMatch,
  type CodecManifestReference,
  type CodecManifestPrefilterInput,
  type CodecManifestRepositoryValidationContext,
  type CodecManifestSourceKind,
  type CodecManifestV1,
  type CodecManifestValidationContext,
  type CodecManifestValidationResult,
  type CodecOperatingSystem,
  type CodecPermissionClass,
  type CodecRuntimeAvailability,
  type CodecRuntimeEnvironment,
  type CodecRuntimeRejection,
  type CodecRuntimeSelection,
  type CodecRuntimeTarget,
  type CodecRuntimeVariant,
  type CodecSupportStatus,
  type CodecWebApi,
  type GameContributionConfig,
  type GameContributionMode,
  type GameFeatureGroup,
  type GameInstallPresetMode,
} from './codec-manifest.js'

// --- game contribution settings (runbook slice C3) --------------------------------------
export {
  GAME_CONTRIBUTION_STATUS_FACETS,
  gameContributionOverrideKey,
  resolveGameContributions,
  type EffectiveGameContribution,
  type GameContributionStatusFacet,
  type InstalledGameContribution,
  type ResolveGameContributionsInput,
} from './game-contributions.js'

// --- generated codec registry matching (runbook slice C1) ------------------------------
export {
  CODEC_DETECT_EXPORT,
  DEFAULT_CODEC_PREFILTER_CONFIDENCE,
  detectHeaderFromModule,
  matchCodecRegistry,
  type CodecDetectResult,
  type CodecEntrypointKind,
  type CodecEntrypointLoader,
  type CodecMatchedCandidate,
  type CodecMatchedCandidates,
  type CodecMatchingDiagnostic,
  type CodecMatchingDiagnosticCode,
  type CodecMatchingEntrypointLoaders,
  type CodecMatchingOptions,
  type CodecMatchingRegistryEntry,
  type CodecMatchingResult,
  type CodecMatchingStage,
  type CodecMatchingVariant,
} from './codec-matching.js'

// --- current codec registry base --------------------------------------------------------
export {
  FormatRegistry,
  normalizeFormatExtension,
  type FormatRegistration,
} from './format-registry.js'

// --- FormatRegistry <-> generated codec catalog adapter (runbook Slice C4 item 5) ------
export {
  buildFormatRegistrationsFromCatalog,
  resolveCodecExportById,
  type FormatRegistryCatalogDetector,
  type FormatRegistryCatalogOptions,
} from './format-registry-catalog-adapter.js'
