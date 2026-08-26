export {
  buildInventory,
  inventoryHasErrors,
  type ArtifactAttestationInput,
  type ExtensionInput,
  type ExtensionExecutionPolicy,
  type ExtensionOrigin,
  type Inventory,
  type InventoryContribution,
  type InventoryExtension,
  type InventoryRecord,
} from './inventory.js'
export {
  createHostContributionContractRegistry,
  PROVIDER_OFFER_INVENTORY_FACT,
  VIEWER_CONTRIBUTION_INVENTORY_FACT,
} from './contribution-registry.js'
export { offersFromInventory } from './offers.js'
export {
  buildCodecDetectionSelection,
  parseCodecDetectionSelection,
  replayCodecDetectionSelection,
  serializeCodecDetectionSelection,
  type CodecDetectionSelection,
  type CodecDetectionSelectionInput,
  type CodecSourceTopology,
} from './detection-selection.js'
export {
  compareDetectionEvidence,
  DETECTION_EVIDENCE_LADDER,
  DETECTION_UNTIE_RULES,
  isDetectionUntieRule,
  type DetectionEvidenceRung,
  type DetectionUntieRule,
} from './detection-rules.js'
export {
  artifactByteSourceFromRandomAccess,
  type ArtifactByteSourceBridgeOptions,
} from './source-bridge.js'
export {
  artifactNamespaceSourceFromVfsMount,
  type ArtifactNamespaceSourceFromVfsOptions,
} from './vfs-source.js'
export {
  openSubject,
  type OpenedSubject,
  type OpenSubjectOptions,
  type OpenSubjectResult,
  type SubjectInputResolutionContext,
  type SubjectInputResolver,
  type SubjectOpenCandidateExplanation,
  type SubjectOpenCandidateState,
  type UnresolvedSubject,
} from './subject-open.js'
/*
 * Opening one entry of an already-open container as a subject in its own right.
 *
 * Public because a product has to be able to do it: block 9 built the route and left it reachable
 * only from tests, which meant the archive stages in Electron and the web app kept extracting bytes
 * for a preview instead of opening the entry. The origin backend behind it stays private — a caller
 * hands over a parent session and an entry id, never a namespace handle.
 */
export {
  openNestedSubject,
  NESTED_ENTRY_UNREADABLE,
  NESTED_SUBJECT_UNSUPPORTED,
  type NestedSubjectOptions,
  type NestedSubjectResult,
} from './nested-subject.js'
export {
  createBundledServiceDefinitionRegistry,
  createSubjectServices,
  registerServiceDefinitionsOrThrow,
  serviceDefinitionSurfaces,
  CONTRIBUTION_DISABLED_CODE,
  describeInventoryContributions,
  supportedExtensionHints,
  type InventoryContributionRow,
  type BundledServiceDefinitionRegistryOptions,
  type SubjectOpenRequest,
  type SubjectServices,
  type SubjectServicesOptions,
} from './subject-services.js'
export {
  connectSubjectRpc,
  exposeSubjectRpc,
  SUBJECT_EDITING,
  SUBJECT_SERVICES,
  SUBJECT_SERVICES_URL,
  subjectOpenSnapshot,
  subjectRpcSurfaces,
  type ConnectSubjectRpcOptions,
  type ExposeSubjectRpcOptions,
  type OpenedSubjectLike,
  type SubjectClientOpenResult,
  type SubjectEditingArm,
  type SubjectEditingCommitResult,
  type SubjectEditingPrepareResult,
  type SubjectEditingState,
  type SubjectOpenedSnapshot,
  type SubjectOpener,
  type SubjectOpenSnapshot,
  type SubjectOpenSnapshotOptions,
  type SubjectPreviewSession,
  type SubjectRpcClient,
  type SubjectRpcExposure,
  type SubjectUnresolvedSnapshot,
  type UnresolvedOpenLike,
} from './subject-rpc.js'
export {
  activateServiceProvider,
  createHostServiceResolver,
  type HostServiceResolver,
  type HostServiceResolverOptions,
  type ProviderActivation,
  type ProviderActivationOptions,
} from './service-leases.js'
export {
  codecFidelityEvidenceRecords,
  createEvidenceRegistry,
  createRawWriter,
  HOST_RAW_WRITER_EVIDENCE_ID,
  HOST_RAW_WRITER_EVIDENCE_RECORD,
  HOST_RAW_WRITER_IDENTITY,
  type EvidenceRegistry,
  type CodecFidelityEvidenceSelection,
  type FidelityEvidenceRecord,
  type RawWriterOptions,
} from './editing-evidence.js'
export {
  assetRevisionFromDescriptor,
  createSubjectEditing,
  NO_STAGED_PAYLOADS,
  subjectEditTargetsFromDescriptor,
  type SubjectEditing,
  type SubjectEditingOptions,
  type SubjectEditorPorts,
} from './subject-editing.js'
export {
  registerStandardEditingDefinitions,
  STANDARD_EDITING_DEFINITIONS,
  STANDARD_EDITING_OWNER,
  WRITER_CONTRACT_DEFINITION,
  WRITER_FACET_MATCHER,
} from './editing-definitions.js'
export * from './language/index.js'
export * from './runtime/index.js'
export * from './renderer/index.js'
export * from './games/index.js'
export * from './mods/index.js'
export * from './data/index.js'
export * from './maps/index.js'
export {
  createServiceFacetMatcherProfileRegistry,
  createServiceContractDefinitionRegistry,
  FACETLESS_SERVICE_MATCHER_PROFILE,
  registerServiceContractDefinitionsFromInventory,
  type ServiceContractDefinitionRegistryOptions,
} from './service-definitions.js'
export { resolveProvider, RESOLVER_VERSION } from './resolution/resolver.js'
export {
  explainProviderResolution,
  renderProviderResolutionExplanation,
  type ExplainedCandidate,
  type ProviderResolutionExplanation,
} from './resolution/explain.js'
export {
  createContractResolverPort,
  resolveServiceProvider,
  type ContractResolverRuntimeOptions,
  type FacetAwareProviderRequest,
} from './resolution/service-resolver.js'
export {
  buildLockEntry,
  buildLockKey,
  parsePolicyLock,
  replayPolicyLock,
  serializePolicyLock,
  type ProviderPolicyLock,
} from './resolution/lock.js'
export {
  activateContribution,
  resolveForActivation,
  type Activation,
  type ActivationRequest,
  type ActivationTicket,
} from './security/gate.js'
export {
  createExecutionBackendRegistry,
  DEFAULT_EXECUTION_BACKENDS,
  linkedInProcessBackend,
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  type ExecutionBackend,
  type ExecutionBackendActivation,
  type ExecutionBackendRegistry,
  type ExecutionModuleLease,
} from './execution/backend.js'
export { assertRelativeEntrypoint, resolveContainedEntrypoint } from './security/entrypoint.js'
export {
  assembleSubjectDescriptor,
  createAssetSession,
  type AssetSessionOptions,
  type HostOperationContext,
  type HostOperationHandler,
  type ManagedAssetSession,
} from './session.js'
export { createV1DescriptorProjectionPort } from './v1-projection.js'
export {
  createByteRangeSource,
  createLazyTableDataSource,
  createUtf8TextDataSource,
  type LazyTableOptions,
} from './data-sources.js'
export {
  createPresentationPlanValidator,
  createViewerSources,
  evaluateViewerApplicability,
  evaluateViewerContribution,
  resolvePresentationPlan,
  switchPresentationStage,
  type CatalogPresentationCandidate,
  type PresentationResolverOptions,
  type PresentationValidatorOptions,
  type ViewerApplicabilityFacts,
  type ViewerApplicabilityResult,
  type ViewerContributionEligibility,
} from './presentation.js'
export {
  createCommitCoordinator,
  createEditSession,
  createGrantSnapshot,
  type EditingBackend,
  type EditingBackendApplyResult,
  type HostCommitCoordinatorOptions,
  type ManagedEditSession,
} from './editing.js'
export {
  createHostComposition,
  type HostComposition,
  type HostCompositionOptions,
} from './composition.js'
export {
  defineLinkedExtension,
  linkedExtensionInputs,
  type LinkedContributionExclusion,
  type LinkedContributionInit,
  type LinkedExtension,
  type LinkedExtensionInit,
  type LinkedExtensionSet,
  type LinkedModule,
} from './linked.js'
export {
  resolveFormatWriter,
  type FormatWriterRequest,
  type FormatWriterResolution,
} from './format-writer.js'
