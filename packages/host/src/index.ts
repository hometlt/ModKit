export {
  buildInventory,
  inventoryHasErrors,
  type ArtifactAttestationInput,
  type ExtensionInput,
  type ExtensionExecutionPolicy,
  type ExtensionOrigin,
  type Inventory,
  type InventoryBuildOptions,
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
  LOCALIZATION_CATALOG_MAXIMUM_JSON_BYTES,
  loadLocalizationCatalogs,
  type LoadedLocalizationCatalogs,
  type LoadLocalizationCatalogsOptions,
  type LocalizationCatalogLike,
  type LocalizationCatalogParseOptions,
  type LocalizationCatalogParser,
  type LocalizationMessagePrefixAuthorizationRequest,
  type LocalizationMessagePrefixAuthorizer,
  type LocalizationVfsPort,
} from './localization.js'
// Block 13 works 4–6: one command runtime, composed by every application, owned by none.
export {
  commandSubjectsFrom,
  commandRequest,
  createCommandRuntime,
  createModkitCommandRuntime,
  createSubjectCommandEndpoint,
  createSubjectCommandRuntime,
  describeCommandContracts,
  describeModkitCommandContracts,
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
  SERVICE_OPERATION_COMMANDS,
  SERVICE_OPERATION_COMMAND_TARGETS,
  SERVICE_OPERATIONS_COMMAND,
  SERVICE_OPERATION_INVOKE_COMMAND,
  SUBJECT_COMMAND_TARGETS,
  SUBJECT_EDIT_COMMAND,
  SUBJECT_EDIT_COMMANDS,
  SUBJECT_EDIT_COMMAND_TARGETS,
  SUBJECT_EDIT_OPERATION_IDS,
  summarizeEditPlan,
  type CommandContext,
  type CommandContract,
  type CommandRoutingTarget,
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
export {
  invokeContainerPack,
  type ContainerPackResult,
  type InvokeContainerPackOptions,
} from './container-pack.js'
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
  openNestedSubjectRef,
  NESTED_ENTRY_UNREADABLE,
  NESTED_SUBJECT_REF_UNAVAILABLE,
  NESTED_SUBJECT_UNSUPPORTED,
  type NestedSubjectOptions,
  type NestedLogicalResourceSearch,
  type NestedSubjectRefOptions,
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
/**
 * Mounting a container behind a subject so its assets are reachable as a dependency layer — the
 * shape `createLayeredCompanionOrigin` composes with a filesystem origin, and the way a model on
 * disk reaches a texture that ships inside the game.
 */
export {
  createCompositeWorkspaceNamespaceCompanionOrigin,
  createWorkspaceNamespaceCompanionOrigin,
  type CompositeWorkspaceNamespaceCompanionOriginOptions,
  type CompositeWorkspaceNamespaceRoot,
  type WorkspaceNamespaceCompanionOriginOptions,
} from './namespace-origin.js'
export { createLayeredCompanionOrigin, type CompanionOrigin } from './input-resolution.js'
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
  answerCatalogQueries,
  modContextCatalogEntities,
  operationCatalogQueries,
  subjectCatalogEntities,
  type CatalogEntities,
  type SubjectCatalogOptions,
} from './catalog-questions.js'
export {
  baseModsFor,
  composeLanguageDocumentSources,
  modContextResolution,
  resolveSubjectClosure,
  subjectTarget,
  resolveContentAssetOrigins,
  resolveContentLanguageSources,
  type BaseModSetting,
  type ContentSubject,
  type ContentAssetOrigins,
  type ContentAssetOriginsRequest,
  type ContentLanguageSourceLimits,
  type ContentLanguageSources,
  type ContentLanguageSourcesRequest,
} from './content-dependency-operations.js'
export { openModContextLayerSource } from './mod-context-layer-source.js'
export {
  createBundledServiceDefinitionRegistry,
  createSubjectServices,
  registerServiceDefinitionsOrThrow,
  serviceDefinitionSurfaces,
  CONTRIBUTION_DISABLED_CODE,
  EXTENSION_DISABLED_CODE,
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
  type SubjectNavigationOpenRequest,
  type SubjectNavigationSnapshot,
  type SubjectNavigator,
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
export * from './knowledge/index.js'
export * from './runtime/index.js'
export * from './service-operations.js'
export * from './renderer/index.js'
export * from './model-encoding.js'
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
export {
  createCompositeRelationGraphSource,
  createCompositeSubjectFactsSource,
  createDescriptorFallbackSubjectFactsSource,
  createFieldRelationGraphSource,
  descriptorSubjectRef,
  metadataFieldProjections,
  DEFAULT_SUBJECT_RELATION_PROJECTION_BUDGET,
  type FieldRelationGraphProjectionOptions,
  type RelationGraphMergeOptions,
  type SubjectFactsMergeOptions,
  type SubjectFieldProjection,
  type SubjectFieldReferenceRequest,
  type SubjectFieldReferenceResolver,
  type SubjectRelationProjectionBudget,
  type SubjectRelationTarget,
} from './subject-projection.js'
export {
  createScopedViewerSubjectNavigation,
  type ManagedViewerSubjectNavigation,
  type ScopedViewerSubjectNavigationOptions,
} from './subject-navigation.js'
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
  resolveCommonPresentationPlan,
  resolveModelWorldPresentationPlan,
  resolvePresentationPlan,
  resolveSessionPresentationPlan,
  switchPresentationStage,
  type CatalogPresentationCandidate,
  type CommonPresentationOptions,
  type PresentationResolverOptions,
  type PresentationValidatorOptions,
  type SessionPresentationSelection,
  type SessionPresentationCatalogEntry,
  type ViewerApplicabilityFacts,
  type ViewerApplicabilityResult,
  type ViewerContributionEligibility,
} from './presentation.js'
export { COMMON_PRESENTATION_CATALOG } from './presentation-catalog.generated.js'
export {
  presentationSemanticHash,
  type PresentationSemanticHashRequest,
} from './presentation-semantic.js'
export {
  createCommitCoordinator,
  createEditSession,
  createGrantSnapshot,
  type EditingBackend,
  type EditingBackendApplyResult,
  type HostCommitCoordinatorOptions,
  type ManagedEditSession,
} from './editing.js'
export { replacedBytes } from './editing-splice.js'
export {
  createHostComposition,
  type HostComposition,
  type HostCompositionOptions,
} from './composition.js'
export {
  defineBuiltinModule,
  defineLinkedExtension,
  linkedExtensionInputs,
  type BuiltinModule,
  type BuiltinModuleInit,
  type LinkedContributionExclusion,
  type LinkedContributionInit,
  type LinkedExtension,
  type LinkedExtensionInit,
  type LinkedExtensionSet,
  type LinkedModule,
} from './linked.js'
export { NATIVE_TEXT_INPUT, NATIVE_TEXT_MODULES, withNativeTextModules } from './native-text.js'
export {
  resolveFormatWriter,
  type FormatWriterRequest,
  type FormatWriterResolution,
} from './format-writer.js'
export type {
  HostLogicalResourceDiscoveryContext,
  HostLogicalResourceDiscoveryPolicy,
} from './logical-resources.js'
export {
  createWorkspaceReferenceIndex,
  type ReferenceTargetResolver,
  type WorkspaceReferenceIndex,
  type WorkspaceReferenceIndexSnapshot,
} from './references.js'
export {
  createContentDependencyLanguageDocumentSource,
  contentDependencyDiagnostics,
  type ContentDependencyLanguageDocumentSourceOptions,
} from './content-dependencies.js'
export {
  createContainerNamespaceComposition,
  type ContainerNamespaceComposition,
  type CreateContainerNamespaceCompositionOptions,
} from './container-composition.js'
