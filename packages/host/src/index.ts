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
  artifactByteSourceFromRandomAccess,
  type ArtifactByteSourceBridgeOptions,
} from './source-bridge.js'
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
export {
  createBundledServiceDefinitionRegistry,
  createSubjectServices,
  registerServiceDefinitionsOrThrow,
  serviceDefinitionSurfaces,
  supportedExtensionHints,
  type BundledServiceDefinitionRegistryOptions,
  type SubjectOpenRequest,
  type SubjectServices,
  type SubjectServicesOptions,
} from './subject-services.js'
export {
  connectSubjectRpc,
  exposeSubjectRpc,
  SUBJECT_SERVICES,
  SUBJECT_SERVICES_URL,
  subjectRpcSurfaces,
  type ConnectSubjectRpcOptions,
  type ExposeSubjectRpcOptions,
  type SubjectClientOpenResult,
  type SubjectOpenedSnapshot,
  type SubjectOpener,
  type SubjectOpenSnapshot,
  type SubjectPreviewSession,
  type SubjectRpcClient,
  type SubjectRpcExposure,
  type SubjectUnresolvedSnapshot,
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
  createEvidenceRegistry,
  createRawWriter,
  HOST_RAW_WRITER_EVIDENCE_ID,
  HOST_RAW_WRITER_EVIDENCE_RECORD,
  HOST_RAW_WRITER_IDENTITY,
  type EvidenceRegistry,
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
