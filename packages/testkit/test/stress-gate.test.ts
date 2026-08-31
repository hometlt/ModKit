import { describe, expect, it } from 'vitest'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  CODEC_CONTRIBUTION_CONTRACT,
  createSpecSchemaRegistry,
  validateContributionManifest,
  validateSubjectDescriptorV2,
  type CodecContributionSpecV1Wire,
  type ContributionManifestV1Wire,
  type UnresolvedSourceDescriptorWire,
} from '@modkit/sdk'

const budgets = {
  maxInputBytes: '1073741824',
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 10_000,
} as const

const byteProbe = {
  kind: 'bytes' as const,
  ranges: [{ from: 'start' as const, length: 4096 }],
  maxBytes: 4096,
}

function manifest(
  id: string,
  spec: CodecContributionSpecV1Wire,
  variants: ContributionManifestV1Wire<CodecContributionSpecV1Wire>['runtimeVariants'] = [
    {
      variantId: 'portable',
      entrypoint: './dist/index.js',
      target: { environments: ['browser-worker', 'node-worker'] },
      executionProfile: 'worker-brokered',
      requestedPermissionClasses: ['read-source'],
    },
  ],
): ContributionManifestV1Wire<CodecContributionSpecV1Wire> {
  return {
    schemaVersion: 1,
    contract: { id: CODEC_CONTRIBUTION_CONTRACT, major: 1 },
    id,
    displayName: id,
    runtimeVariants: variants,
    spec,
  }
}

const stressManifests = [
  manifest('org.stress/json-xml', {
    formatRefs: [
      { formatId: 'json', label: 'JSON', mediaType: 'application/json' },
      { formatId: 'xml', label: 'XML', mediaType: 'application/xml' },
    ],
    roles: ['semantic'],
    sourceTopology: 'single',
    artifactStages: ['authored'],
    openIntents: ['probe', 'inspect', 'full'],
    match: { extensions: ['json', 'xml'] },
    probe: byteProbe,
    requires: [{ contract: 'org.stress/syntax-provider', major: 1, range: '^1.0' }],
    representations: [
      {
        id: 'syntax-tree',
        contract: 'org.stress/syntax-tree',
        major: 1,
        stage: 'compiled',
        lossy: false,
      },
    ],
    publishesDataSources: [{ contract: 'common.view/tree-data-source', major: 1 }],
    operations: [],
    traitDeclarations: [
      { id: 'structure.hierarchy', representation: 'compiled', presence: 'will-expose' },
    ],
    implementationTier: { claimed: 1 },
    budgets,
  }),
  manifest('org.stress/seven-zip', {
    formatRefs: [{ formatId: '7z', label: '7-Zip', mediaType: 'application/x-7z-compressed' }],
    roles: ['container', 'byte-transform'],
    sourceTopology: 'single',
    artifactStages: ['authored', 'runtime'],
    openIntents: ['probe', 'inspect', 'full', 'stream'],
    match: { extensions: ['7z'] },
    probe: byteProbe,
    requires: [{ contract: 'org.stress/lzma-decoder', major: 1, range: '^1.0' }],
    representations: [
      {
        id: 'entries',
        contract: 'org.stress/archive-entries',
        major: 1,
        stage: 'runtime',
        lossy: false,
      },
    ],
    publishesDataSources: [
      { contract: 'org.stress/namespace-entry-source', major: 1, opaque: true },
    ],
    operations: [],
    traitDeclarations: [
      { id: 'container.entries', representation: 'runtime', presence: 'will-expose' },
      { id: 'content.binary', representation: 'source', presence: 'will-expose' },
    ],
    implementationTier: { claimed: 2 },
    budgets,
  }),
  manifest('org.stress/media-container', {
    formatRefs: [
      { formatId: 'mp4', label: 'MP4', mediaType: 'video/mp4' },
      { formatId: 'mkv', label: 'Matroska', mediaType: 'video/x-matroska' },
      { formatId: 'bnk', label: 'Audio bank' },
    ],
    roles: ['container', 'media'],
    sourceTopology: 'single',
    artifactStages: ['authored', 'runtime'],
    openIntents: ['probe', 'inspect', 'stream'],
    match: { extensions: ['mp4', 'mkv', 'bnk'] },
    probe: byteProbe,
    representations: [
      {
        id: 'audio-tracks',
        contract: 'org.stress/audio-tracks',
        major: 1,
        stage: 'runtime',
        lossy: false,
      },
      {
        id: 'video-tracks',
        contract: 'org.stress/video-tracks',
        major: 1,
        stage: 'runtime',
        lossy: false,
      },
    ],
    publishesDataSources: [{ contract: 'org.stress/transport-source', major: 1, opaque: true }],
    operations: [],
    implementationTier: { claimed: 2 },
    budgets,
  }),
  manifest(
    'org.stress/gpu-texture',
    {
      formatRefs: [
        { formatId: 'dds', label: 'DDS', mediaType: 'image/vnd-ms.dds' },
        { formatId: 'ktx2', label: 'KTX2', mediaType: 'image/ktx2' },
        { formatId: 'basis', label: 'Basis Universal' },
      ],
      roles: ['media', 'byte-transform'],
      sourceTopology: 'single',
      artifactStages: ['authored', 'runtime'],
      openIntents: ['probe', 'inspect', 'thumbnail', 'full'],
      match: { extensions: ['dds', 'ktx2', 'basis'] },
      probe: byteProbe,
      representations: [
        {
          id: 'native',
          contract: 'org.stress/compressed-texture',
          major: 1,
          stage: 'authored',
          lossy: false,
        },
        {
          id: 'decoded',
          contract: 'org.stress/raster-image',
          major: 1,
          stage: 'runtime',
          lossy: false,
        },
      ],
      publishesDataSources: [{ contract: 'org.stress/raster-source', major: 1, opaque: true }],
      operations: [],
      traitDeclarations: [
        { id: 'image.raster', representation: 'runtime', presence: 'will-expose' },
        { id: 'image.mipmaps', representation: 'source', presence: 'may-expose' },
      ],
      implementationTier: { claimed: 2 },
      budgets,
    },
    [
      {
        variantId: 'wasm',
        entrypoint: './dist/wasm.js',
        target: { environments: ['browser-worker', 'node-worker'], architectures: ['wasm32'] },
        executionProfile: 'wasm-brokered',
        requestedPermissionClasses: ['read-source'],
      },
    ],
  ),
  manifest('org.stress/cue-bin', {
    formatRefs: [{ formatId: 'cue-bin', label: 'CUE + BIN' }],
    roles: ['container', 'media', 'sidecar'],
    sourceTopology: 'bundle',
    artifactStages: ['authored'],
    openIntents: ['probe', 'inspect', 'stream'],
    match: { extensions: ['cue'] },
    companions: [
      {
        id: 'tracks',
        role: 'audio-track',
        required: true,
        patterns: ['*.bin'],
        expected: { all: [{ id: 'content.binary' }] },
        searchScopes: ['sibling-directory', 'enclosing-container'],
      },
    ],
    probe: byteProbe,
    representations: [
      {
        id: 'disc-tracks',
        contract: 'org.stress/disc-tracks',
        major: 1,
        stage: 'runtime',
        lossy: false,
      },
    ],
    publishesDataSources: [{ contract: 'org.stress/transport-source', major: 1, opaque: true }],
    operations: [],
    traitDeclarations: [
      { id: 'content.binary', representation: 'source', presence: 'will-expose' },
    ],
    implementationTier: { claimed: 2 },
    budgets,
  }),
  manifest('org.stress/casc-namespace', {
    formatRefs: [
      { formatId: 'casc', label: 'CASC' },
      { formatId: 'unityfs', label: 'UnityFS' },
      { formatId: 'samplemap', label: 'samplemap' },
    ],
    roles: ['container', 'index'],
    sourceTopology: 'namespace',
    artifactStages: ['authored', 'runtime'],
    openIntents: ['probe', 'inspect', 'full'],
    match: { pathGlobs: ['**/*.samplemap'] },
    probe: {
      kind: 'namespace',
      markers: ['Base.Data', 'DocumentInfo'],
      prefixes: ['Base.Data', 'DocumentInfo'],
      maxEntries: 10_000,
      maxBytes: 65_536,
      maxDepth: 16,
      maxPathBytes: 4096,
    },
    representations: [
      {
        id: 'namespace-index',
        contract: 'org.stress/namespace-index',
        major: 1,
        stage: 'runtime',
        lossy: false,
      },
    ],
    publishesDataSources: [
      { contract: 'org.stress/namespace-entry-source', major: 1, opaque: true },
    ],
    operations: [],
    traitDeclarations: [
      { id: 'container.entries', representation: 'runtime', presence: 'will-expose' },
    ],
    implementationTier: { claimed: 2 },
    budgets,
  }),
  manifest('org.stress/document-workbook', {
    formatRefs: [
      { formatId: 'blend', label: 'Blender' },
      {
        formatId: 'xlsx',
        label: 'Excel workbook',
        mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
    roles: ['semantic', 'container'],
    sourceTopology: 'single',
    artifactStages: ['authored', 'compiled', 'runtime'],
    openIntents: ['probe', 'inspect', 'full'],
    match: { extensions: ['blend', 'xlsx'] },
    probe: byteProbe,
    representations: [
      {
        id: 'scene',
        contract: 'org.stress/scene',
        major: 1,
        stage: 'runtime',
        lossy: false,
      },
      {
        id: 'sheets',
        contract: 'org.stress/workbook',
        major: 1,
        stage: 'compiled',
        lossy: false,
      },
    ],
    publishesDataSources: [
      { contract: 'common.view/tree-data-source', major: 1 },
      { contract: 'common.view/table-data-source', major: 1 },
    ],
    operations: [],
    traitDeclarations: [
      { id: 'structure.hierarchy', representation: 'runtime', presence: 'may-expose' },
      { id: 'table.cells', representation: 'compiled', presence: 'may-expose' },
    ],
    implementationTier: { claimed: 2 },
    budgets,
  }),
] as const

const unknownBinary: UnresolvedSourceDescriptorWire = {
  schemaVersion: 2,
  subjectUri: 'memory://fixtures/unknown.bin',
  origin: {
    kind: 'single',
    binding: {
      id: 'content',
      role: 'content',
      source: { id: 'unknown', uri: 'memory://fixtures/unknown.bin' },
      required: true,
      ownership: 'owned',
      revision: 'content-hash.sha256:unknown-1',
    },
  },
  interpretation: 'none',
  traits: [
    { id: 'content.binary', descriptorVersion: 1, state: 'available', parameters: { bytes: 8 } },
  ],
  operations: [],
  constraints: {
    readOnly: true,
    seekable: true,
    randomAccess: true,
    trusted: false,
  },
  dataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],
  diagnostics: [],
  revision: 'content-hash.sha256:unknown-1',
  candidates: [],
}

describe('A-5 eight-case schema stress gate', () => {
  const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)

  it('validates the seven executable manifest families through the same codec authority', async () => {
    expect(stressManifests).toHaveLength(7)
    for (const item of stressManifests) {
      const result = await validateContributionManifest(item, registry)
      expect(result.specState, `${item.id}: ${JSON.stringify(result.diagnostics)}`).toBe(
        'validated',
      )
    }
  })

  it('keeps the eighth, codec-less unknown binary fully inspectable', async () => {
    const result = await validateSubjectDescriptorV2(unknownBinary)
    expect(result.descriptor).toBeDefined()
    expect(result.descriptor).toMatchObject({
      interpretation: 'none',
      traits: [{ id: 'content.binary' }],
      dataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],
    })
  })

  it('pins every stress axis so the fixtures cannot collapse into seven copies of one shape', () => {
    const specs = stressManifests.map(item => item.spec)
    expect(specs[0]?.requires).toHaveLength(1)
    expect(specs[1]?.roles).toEqual(expect.arrayContaining(['container', 'byte-transform']))
    expect(specs[2]?.representations.map(item => item.id)).toEqual(['audio-tracks', 'video-tracks'])
    expect(stressManifests[3]?.runtimeVariants?.[0]?.executionProfile).toBe('wasm-brokered')
    expect(specs[4]).toMatchObject({ sourceTopology: 'bundle', companions: [{ id: 'tracks' }] })
    expect(specs[5]).toMatchObject({ sourceTopology: 'namespace', probe: { kind: 'namespace' } })
    expect(specs[6]?.artifactStages).toEqual(['authored', 'compiled', 'runtime'])
  })
})
