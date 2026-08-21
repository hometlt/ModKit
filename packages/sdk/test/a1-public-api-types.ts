/** Compile-only proof that the landed A-1 package subpaths expose one coherent public API. */

import type {
  CodecContributionSpecV1,
  DataSourceContributionSpecV1,
  ViewerContributionSpecV1,
} from '@modkitx-x3/sdk/formats'
import {
  bindingId,
  definePresentationPlan,
  presentationSlotId,
  subjectDescriptorV2Schema,
  type BindingRef,
  type ViewerModule,
  type UnresolvedSourceDescriptor,
} from '@modkitx-x3/sdk/ui-contracts'
import type {
  ArtifactNamespaceSource,
  ArtifactByteSource,
  AssetInputRevisionVector,
  AssetSourceRef,
  AssetInputPlan,
  BundleAssetInput,
  Codec,
  CodecCandidateSource,
  CodecModule,
  DerivedAssetInput,
  DerivedArtifactSource,
  DetectionResult,
  ResolvedAssetInputBinding,
  ResolvedCandidateInputBinding,
  ResolvedRequirementInputBinding,
  ServiceProviderModule,
  SingleAssetInput,
  SingleOrBundleAssetInput,
  NamespaceAssetInput,
  StandardTraitInstance,
} from '@modkitx-x3/sdk'
import type {
  DataSourceOf,
  DataSourceRef,
  DataSourceRefWire,
  ModelSceneSource,
  RasterImageSource,
} from '@modkitx-x3/sdk/data-sources'
import { foreignDataSource } from '@modkitx-x3/sdk/data-sources'

interface RasterSource {
  tile(x: number, y: number, signal?: AbortSignal): Promise<Uint8Array>
}

declare module '@modkitx-x3/sdk/data-sources' {
  interface DataSourceContractMap {
    'org.example/raster-source': { 2: RasterSource }
  }
}

export type RasterSourceLookup = DataSourceOf<'org.example/raster-source', 2>
export type RasterSourceLookupProof = RasterSourceLookup extends RasterSource ? true : never
export type StandardRasterSourceLookup = DataSourceOf<'common.view/raster-image-source', 1>
export type StandardRasterSourceProof = StandardRasterSourceLookup extends RasterImageSource
  ? true
  : never
export type StandardModelSourceLookup = DataSourceOf<'common.view/model-scene-source', 1>
export type StandardModelSourceProof = StandardModelSourceLookup extends ModelSceneSource
  ? true
  : never

export const typedRasterTrait = {
  id: 'image.raster',
  descriptorVersion: 1,
  state: 'available',
  parameters: { width: 1920, height: 1080, bitDepth: 8 },
} as const satisfies StandardTraitInstance<'image.raster'>

export const invalidRasterTrait = {
  id: 'image.raster',
  descriptorVersion: 1,
  state: 'available',
  // @ts-expect-error A raster capability must carry both dimensions.
  parameters: { width: 1920 },
} as const satisfies StandardTraitInstance<'image.raster'>

export const typedRasterRef = {
  contract: 'org.example/raster-source',
  major: 2,
} as const satisfies DataSourceRef

export const rasterWireRef = {
  contract: 'org.example/raster-source',
  major: 2,
  opaque: true,
} as const satisfies DataSourceRefWire

export const rasterRegistration = {
  schemaVersion: 1,
  kind: 'data-source',
  contract: 'org.example/raster-source',
  major: 2,
  schema: { $ref: './raster-source.v2.schema.json' },
  conformanceProfile: 'org.example/raster-source-v2',
} as const satisfies DataSourceContributionSpecV1

declare const unresolved: UnresolvedSourceDescriptor
export const descriptorSchema = subjectDescriptorV2Schema
export const unresolvedInterpretation: 'none' = unresolved.interpretation

declare const codecSpec: CodecContributionSpecV1
export const codecWireRefs: readonly DataSourceRefWire[] = codecSpec.publishesDataSources

export const typedRasterCodec = {
  ...({} as Omit<
    CodecContributionSpecV1<'org.example/raster-source'>,
    'publishesDataSources' | 'sourceTopology' | 'probe'
  >),
  sourceTopology: 'single',
  probe: { kind: 'bytes', ranges: [], maxBytes: 0 },
  publishesDataSources: [{ contract: 'org.example/raster-source', major: 2, opaque: true }],
} satisfies CodecContributionSpecV1<'org.example/raster-source'>

export const typedRasterViewer = {
  kind: 'stage',
  consumesDataSources: [{ contract: 'org.example/raster-source', major: 2, opaque: true }],
  priority: 1,
} satisfies ViewerContributionSpecV1<'org.example/raster-source'>

export const rasterCodecWrongMajor = {
  ...({} as Omit<
    CodecContributionSpecV1<'org.example/raster-source'>,
    'publishesDataSources' | 'sourceTopology' | 'probe'
  >),
  sourceTopology: 'single',
  probe: { kind: 'bytes', ranges: [], maxBytes: 0 },
  publishesDataSources: [
    {
      contract: 'org.example/raster-source',
      opaque: true,
      // @ts-expect-error The augmented raster contract only publishes major 2.
      major: 1,
    },
  ],
} satisfies CodecContributionSpecV1<'org.example/raster-source'>

declare const widenedDataSourceContract: string
// @ts-expect-error A widened string cannot bypass the nominal foreign reference constructor.
foreignDataSource(widenedDataSourceContract, 2)
// @ts-expect-error An augmented known contract cannot be laundered as opaque.
foreignDataSource('org.example/raster-source', 2)

const mainStage = presentationSlotId('main')
const metadataPanel = presentationSlotId('metadata')
const rasterBinding = {
  bindingId: bindingId('raster'),
  contract: 'org.example/raster-source',
  major: 2,
} as const satisfies BindingRef

const presentationSlots = [
  {
    slotId: mainStage,
    kind: 'stage',
    contributionId: 'org.example/raster-viewer',
    extensionId: 'org.example/raster-tools',
    priority: 10,
    bindings: [rasterBinding],
  },
  {
    slotId: metadataPanel,
    kind: 'panel',
    contributionId: 'org.example/metadata-panel',
    extensionId: 'org.example/raster-tools',
    priority: 0,
    bindings: [],
  },
] as const

export const rasterPresentation = definePresentationPlan({
  subjectUri: 'asset://raster',
  revision: unresolved.revision,
  slots: presentationSlots,
  activeStage: mainStage,
  alternateStages: [],
  unsatisfied: [],
})

definePresentationPlan({
  subjectUri: 'asset://raster',
  revision: unresolved.revision,
  slots: presentationSlots,
  // @ts-expect-error A panel id cannot be selected as the active stage.
  activeStage: metadataPanel,
  alternateStages: [],
  unsatisfied: [],
})

export declare const codecModuleProof: CodecModule
export declare const viewerModuleProof: ViewerModule
export declare const serviceModuleProof: ServiceProviderModule

export const compositeInputPlan = {
  originKind: 'bundle',
  candidate: { bindingId: 'cue', role: 'cue', ownership: 'owned' },
  requirements: [
    {
      id: 'tracks',
      role: 'audio-track',
      cardinality: 'one-or-more',
      required: true,
      ownership: 'companion',
      patterns: ['*.bin'],
      scopes: ['sibling-directory'],
    },
  ],
} as const satisfies AssetInputPlan

declare const codec: Codec
declare const candidateSource: CodecCandidateSource
declare const detection: DetectionResult
declare const persistentSourceRef: AssetSourceRef
export const plannedComposite = codec.planInput?.(candidateSource, detection)
// @ts-expect-error A persistent source reference is not a readable probe candidate.
codec.planInput?.(persistentSourceRef, detection)

declare const resolvedComposite: SingleOrBundleAssetInput
export const trackBindings = resolvedComposite.bindingsFor('tracks')
export const openedTracks = trackBindings.map(binding =>
  resolvedComposite.openBinding(binding.bindingId),
)

export const twoTrackBindings = [
  {
    bindingId: 'track-1',
    sourceKind: 'requirement',
    requirementId: 'tracks',
    role: 'audio-track',
    ownership: 'companion',
    source: { id: 'bin-1', uri: 'memory://disc/track-1.bin' },
    revision: unresolved.revision,
  },
  {
    bindingId: 'track-2',
    sourceKind: 'requirement',
    requirementId: 'tracks',
    role: 'audio-track',
    ownership: 'companion',
    source: { id: 'bin-2', uri: 'memory://disc/track-2.bin' },
    revision: unresolved.revision,
  },
] as const satisfies readonly ResolvedAssetInputBinding[]

declare const resolvedCandidateBinding: ResolvedCandidateInputBinding
declare const resolvedRequirementBinding: ResolvedRequirementInputBinding
export const singleBindingTuple = [
  resolvedCandidateBinding,
] as const satisfies SingleAssetInput['bindings']
// @ts-expect-error A single input always contains exactly its one candidate binding.
export const emptySingleBindings = [] as const satisfies SingleAssetInput['bindings']
const candidateAndRequirement = [resolvedCandidateBinding, resolvedRequirementBinding] as const
// @ts-expect-error Requirement bindings cannot be hidden inside a single-source input.
export const expandedSingleBindings: SingleAssetInput['bindings'] = candidateAndRequirement

export const bundleBindingTuple = candidateAndRequirement satisfies BundleAssetInput['bindings']
const twoCandidates = [resolvedCandidateBinding, resolvedCandidateBinding] as const
// @ts-expect-error A bundle has exactly one candidate; another candidate is not a requirement.
export const duplicateBundleCandidate: BundleAssetInput['bindings'] = twoCandidates

export const namespaceRequirementBindings = [
  resolvedRequirementBinding,
] as const satisfies NamespaceAssetInput['bindings']
const oneCandidate = [resolvedCandidateBinding] as const
// @ts-expect-error Namespace roots are not represented as fake candidate bindings.
export const namespaceCandidateBinding: NamespaceAssetInput['bindings'] = oneCandidate

export const companionOwnedCandidate = {
  ...resolvedCandidateBinding,
  // @ts-expect-error Candidate ownership is limited to the authored candidate plan vocabulary.
  ownership: 'companion',
} as const satisfies ResolvedCandidateInputBinding

export const singleRevisionVector = {
  topology: 'single',
  revision: unresolved.revision,
  bindings: [{ bindingId: 'content', revision: unresolved.revision }],
  compositionFingerprint: 'sha256:single-composition',
} as const satisfies Extract<AssetInputRevisionVector, { readonly topology: 'single' }>

export const bundleRevisionVector = {
  topology: 'bundle',
  revision: unresolved.revision,
  bindings: [{ bindingId: 'cue', revision: unresolved.revision }],
  compositionFingerprint: 'sha256:bundle-composition',
} as const satisfies Extract<AssetInputRevisionVector, { readonly topology: 'bundle' }>

declare const namespaceCandidate: ArtifactNamespaceSource
export const candidateNamespace = namespaceCandidate.openNamespace()
export const namespaceProbe = codec.probe({
  source: namespaceCandidate,
  plan: {
    kind: 'namespace',
    markers: ['project.marker'],
    maxEntries: 100,
    maxBytes: 4096,
    maxDepth: 4,
    maxPathBytes: 1024,
  },
})

declare const byteCandidate: ArtifactByteSource
// @ts-expect-error A byte candidate cannot be paired with a namespace traversal policy.
codec.probe({
  source: byteCandidate,
  plan: {
    kind: 'namespace',
    markers: ['project.marker'],
    maxEntries: 100,
    maxBytes: 4096,
    maxDepth: 4,
    maxPathBytes: 1024,
  },
})

export const derivedInputPlan = {
  originKind: 'derived',
  subjects: [
    {
      id: 'source-images',
      role: 'source-image',
      cardinality: 'one-or-more',
      required: true,
      scopes: ['workspace-subjects'],
    },
  ],
} as const satisfies AssetInputPlan

export const contradictoryRequirement = {
  originKind: 'bundle',
  candidate: { bindingId: 'main', role: 'content', ownership: 'owned' },
  requirements: [
    // @ts-expect-error Optional cardinality cannot be marked required.
    {
      id: 'optional-but-required',
      role: 'sidecar',
      cardinality: 'zero-or-one',
      required: true,
      ownership: 'companion',
      scopes: ['sibling-directory'],
    },
  ],
} as const satisfies AssetInputPlan

declare const derivedCandidate: DerivedArtifactSource
export const plannedDerived = codec.planInput?.(derivedCandidate, detection)
const firstDerivedCandidateInput = derivedCandidate.inputs[0]
if (firstDerivedCandidateInput === undefined) throw new Error('derived candidate has no inputs')
export const openedDerivedInput = derivedCandidate.openInput(firstDerivedCandidateInput.bindingId)

declare const derivedInput: DerivedAssetInput
export const derivedSources = derivedInput.subjectsFor('source-images')
const firstDerivedSource = derivedSources[0]
if (firstDerivedSource === undefined) throw new Error('derived input has no source images')
export const openedDerivedSubject = derivedInput.openSubject(firstDerivedSource.bindingId)

// @ts-expect-error A derived input cannot pretend to expose a namespace root.
derivedInput.openNamespace()
