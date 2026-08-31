import type {
  ByteRangeSource,
  DataSourceOf,
  DataSourceRef,
  TextDataSource,
  TextSlice,
} from '../src/asset-capabilities/data-sources.js'
import { foreignDataSource } from '../src/asset-capabilities/data-sources.js'
import type {
  AssetOriginDescriptor,
  AssetOriginDescriptorWire,
  ResolvedAssetDescriptor,
  RevisionId,
  SubjectDescriptor,
  UnresolvedSourceDescriptor,
} from '../src/asset-capabilities/types.js'
import type { OperationId, SourceSpan, UInt64String } from '@modkit/core'
import type { V1DescriptorProjectionResult } from '../src/asset-capabilities/v1-projection.js'

export const knownTextRef = {
  contract: 'common.view/text-data-source',
  major: 1,
} as const satisfies DataSourceRef

export const opaqueForeignRef = foreignDataSource('example.view/custom-source', 7)

export const unconstructedForeignRef = {
  contract: 'example.view/custom-source',
  major: 7,
  opaque: true,
  // @ts-expect-error Foreign authoring refs must come from foreignDataSource().
} as const satisfies DataSourceRef

// @ts-expect-error A known contract cannot bypass its major through the foreign constructor.
export const knownAsForeignRef = foreignDataSource('common.view/text-data-source', 99)

export const unsupportedKnownMajor = {
  contract: 'common.view/text-data-source',
  major: 2,
  // @ts-expect-error Standard data-source majors are closed until the map is augmented.
} as const satisfies DataSourceRef

export type TextSourceLookup = DataSourceOf<'common.view/text-data-source', 1>
export type ByteSourceLookup = DataSourceOf<'common.view/byte-range-source', 1>
export type TextSourceLookupProof = TextSourceLookup extends TextDataSource ? true : never
export type ByteSourceLookupProof = ByteSourceLookup extends ByteRangeSource ? true : never

declare const subject: SubjectDescriptor
export const decodedLimit: UInt64String | undefined = subject.constraints.maxDecodedBytes
export const diagnosticRange: SourceSpan | undefined = subject.diagnostics[0]?.range

export const unresolved = {
  ...subject,
  interpretation: 'none',
  candidates: [],
} as const satisfies UnresolvedSourceDescriptor

export const resolved = {
  ...subject,
  interpretation: 'codec',
  identity: {
    codecId: 'example.codec/text',
    codecVersion: '1.0.0',
    formatId: 'text',
    formatLabel: 'Text',
    confidence: 1,
    detection: [],
  },
  metadata: [],
} as const satisfies ResolvedAssetDescriptor

export const cueWithTwoTrackBindings = {
  kind: 'bundle',
  primary: 'cue',
  bindings: [
    {
      id: 'cue',
      role: 'cue',
      source: { id: 'cue-source', uri: 'memory://album.cue' },
      required: true,
      ownership: 'owned',
      revision: 'provider-token:cue-r1',
    },
    {
      id: 'bin-1',
      role: 'track-data',
      source: { id: 'bin-source-1', uri: 'memory://disc-1.bin' },
      required: true,
      ownership: 'companion',
      revision: 'provider-token:bin-1-r1',
    },
    {
      id: 'bin-2',
      role: 'track-data',
      source: { id: 'bin-source-2', uri: 'memory://disc-2.bin' },
      required: true,
      ownership: 'companion',
      revision: 'provider-token:bin-2-r1',
    },
  ],
} as const satisfies AssetOriginDescriptorWire

export const namespaceWithoutPrimary = {
  kind: 'namespace',
  root: { id: 'casc', uri: 'casc://installation' },
  revision: 'database-version:build-123',
} as const satisfies AssetOriginDescriptorWire

export const unmaterializedDerived = {
  kind: 'derived',
  inputs: [
    {
      bindingId: 'source',
      role: 'source',
      subjectUri: 'memory://source',
      revision: 'provider-token:source-r1',
      compositionFingerprint: 'source-composition-1',
    },
  ],
  recipe: {
    extensionId: 'org.example/export-tools',
    extensionVersion: '1.0.0',
    contributionId: 'org.example/exporter',
    operation: 'export.convert',
    parameters: { target: 'gltf' },
  },
} as const satisfies AssetOriginDescriptorWire

declare const brandedRevision: RevisionId
declare const brandedOperation: OperationId
declare const brandedContribution: import('../src/asset-capabilities/types.js').ContributionId

export const brandedDerivedOrigin = {
  kind: 'derived',
  inputs: [
    {
      bindingId: 'source',
      role: 'source',
      subjectUri: 'memory://source',
      revision: brandedRevision,
      compositionFingerprint: 'source-composition-1',
    },
  ],
  recipe: {
    extensionId: 'org.example/export-tools',
    extensionVersion: '1.0.0',
    contributionId: brandedContribution,
    operation: brandedOperation,
  },
} as const satisfies AssetOriginDescriptor

export const unbrandedRuntimeOrigin = {
  kind: 'namespace',
  root: { id: 'root', uri: 'memory://root' },
  // @ts-expect-error Runtime origins require a validated RevisionId, not a wire string.
  revision: 'provider-token:raw-revision',
} as const satisfies AssetOriginDescriptor

export const partialWireBinding = {
  kind: 'single',
  // @ts-expect-error Every physical binding carries its own revision.
  binding: {
    id: 'main',
    role: 'content',
    source: { id: 'source', uri: 'memory://source' },
    required: true,
    ownership: 'owned',
  },
} as const satisfies AssetOriginDescriptorWire

export const unresolvedWithIdentity = {
  ...unresolved,
  // @ts-expect-error An unresolved descriptor never carries a selected codec identity.
  identity: resolved.identity,
} as const satisfies UnresolvedSourceDescriptor

export const contradictoryTextSlice = {
  complete: true,
  text: 'x',
  fromLine: 0,
  lineCount: 1,
  nextCursor: 'cursor',
  // @ts-expect-error A complete text slice cannot expose a continuation cursor.
} as const satisfies TextSlice

export const unavailableProjection = {
  state: 'unavailable',
  diagnostics: [
    {
      id: 'missing-catalog',
      code: 'modkit/compat-v1-projection-unavailable',
      category: 'dependency',
      severity: 'warning',
      message: 'catalog unavailable',
    },
  ],
} as const satisfies V1DescriptorProjectionResult

export const silentUnavailableProjection = {
  state: 'unavailable',
  // @ts-expect-error Unavailable projection results must carry the canonical diagnostic.
  diagnostics: [],
} as const satisfies V1DescriptorProjectionResult
