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
// Block 13 works 4–6: one command runtime, composed by every application, owned by none.
export {
  commandSubjectsFrom,
  commandRequest,
  createCommandRuntime,
  createSubjectCommandEndpoint,
  createSubjectCommandRuntime,
  describeCommandContracts,
  describeSubjectCommandContracts,
  executeCommandRequest,
  commandDiagnostic,
  failed as commandFailed,
  ok as commandOk,
  unavailable as commandUnavailable,
  COMMAND_CANCELLED,
  COMMAND_INPUT_INVALID,
  COMMAND_SUBJECT_UNRESOLVED,
  COMMAND_UNAVAILABLE,
  COMMAND_UNKNOWN,
  COMMAND_PROTOCOL_SCHEMA_VERSION,
  DEFAULT_COMMAND_MAX_CONCURRENT_RUNS,
  SUBJECT_COMMANDS,
  SUBJECT_COMMAND_TARGETS,
  type CommandContext,
  type CommandContract,
  type CommandContractDocument,
  type CommandDescriptor,
  type CommandDiagnostic,
  type CommandInput,
  type CommandOutputSink,
  type CommandProtocolRunOptions,
  type CommandProgress,
  type CommandResult,
  type CommandReceipt,
  type CommandRequest,
  type CommandRuntime,
  type CommandSubject,
  type CommandSubjectOpener,
  type SubjectCommandEndpoint,
  type SubjectCommandEndpointOptions,
  type SubjectCommandTarget,
} from './commands/index.js'
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
  createVfsCompanionOrigin,
  createVfsInputResolver,
  type VfsCompanionOriginOptions,
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
  nestedSubjectServices,
  openNestedSubject,
  NESTED_ENTRY_UNREADABLE,
  NESTED_SUBJECT_UNSUPPORTED,
  type NestedSubjectOptions,
  type NestedSubjectResult,
} from './nested-subject.js'
/*
 * Bounded candidate enumeration inside game-provider-owned logical roots.
 *
 * Public because a product/game provider must select the exact dependency-composed roots and
 * subtrees to search, while the codec must not receive a namespace handle or invent paths from a
 * base filename. The adapter publishes only revision-pinned logical candidates; bytes still flow
 * through the caller's ResourceSessionPort and its lease/budget policy.
 */
export {
  createWorkspaceNamespaceCandidateDiscovery,
  type WorkspaceNamespaceCandidateDiscovery,
  type WorkspaceNamespaceCandidateDiscoveryLimits,
  type WorkspaceNamespaceCandidateDiscoveryOptions,
  type WorkspaceNamespaceCandidateDiscoveryReceipt,
  type WorkspaceNamespaceCandidateDiscoveryResult,
  type WorkspaceNamespaceCandidateSearch,
  type WorkspaceNamespaceDiscoveredCandidate,
  type WorkspaceNamespaceLogicalRoot,
} from './namespace-origin.js'
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
  serviceProviderFidelityEvidenceRecord,
  createEvidenceRegistry,
  createRawWriter,
  HOST_RAW_WRITER_EVIDENCE_ID,
  HOST_RAW_WRITER_EVIDENCE_RECORD,
  HOST_RAW_WRITER_IDENTITY,
  type EvidenceRegistry,
  type CodecFidelityEvidenceSelection,
  type ServiceProviderFidelityEvidenceSelection,
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
