import { describe, expect, it } from 'vitest'
import {
  A1_SPEC_SCHEMA_ENTRIES,
  CODEC_CONTRIBUTION_CONTRACT,
  SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
  VIEWER_CONTRIBUTION_CONTRACT,
  createContributionContractRegistry,
  createSpecSchemaRegistry,
  dataSourceContributionSpecV1Schema,
  validateWithSchema,
  validateContributionManifest,
  type CodecContributionSpecV1Wire,
  type ContributionContractRegistration,
  type ContributionManifestV1Wire,
  type DataSourceContributionSpecV1,
  type PrecompiledSchemaValidator,
  type ServiceProviderContributionSpecV1Wire,
  type SpecSchemaEntry,
  type ViewerContributionSpecV1Wire,
} from '@modkitx-x3/sdk'

const codecSpec: CodecContributionSpecV1Wire = {
  formatRefs: [{ formatId: 'json', label: 'JSON', mediaType: 'application/json' }],
  roles: ['semantic'],
  sourceTopology: 'single',
  artifactStages: ['authored'],
  openIntents: ['probe', 'inspect', 'full'],
  match: { extensions: ['.json'], mediaTypes: ['application/json'] },
  probe: { kind: 'bytes', ranges: [{ from: 'start', length: 4096 }], maxBytes: 4096 },
  representations: [
    {
      id: 'native',
      contract: 'common.data/json-document',
      major: 1,
      stage: 'authored',
      lossy: false,
    },
  ],
  publishesDataSources: [{ contract: 'common.view/tree-data-source', major: 1 }],
  operations: [
    {
      id: 'data.parse',
      handlerId: 'parse',
      mutatesSource: false,
      outputKinds: ['json'],
    },
  ],
  traitDeclarations: [
    {
      id: 'structure.hierarchy',
      representation: 'source',
      presence: 'may-expose',
    },
  ],
  implementationTier: { claimed: 1 },
  budgets: {
    maxInputBytes: '1048576',
    maxDepth: 128,
    maxNodes: 100_000,
    maxScalarBytes: 1_048_576,
    maxDiagnostics: 1_000,
  },
}

const serviceSpec: ServiceProviderContributionSpecV1Wire = {
  provides: [
    {
      offerId: 'json-v1',
      contract: 'common.text-data/json-syntax',
      major: 1,
      version: '1.0.0',
      facet: { dialect: 'json' },
    },
  ],
  lifecycleScope: 'session',
  outputs: [
    {
      id: 'structure.hierarchy',
      representation: 'runtime',
      presence: 'will-expose',
    },
  ],
}

const viewerSpec: ViewerContributionSpecV1Wire = {
  kind: 'stage',
  requiresTraits: [{ id: 'structure.hierarchy', states: ['available'] }],
  requiresOperations: ['view.inspect'],
  consumesDataSources: [{ contract: 'common.view/tree-data-source', major: 1 }],
  applicability: { interpretation: 'any' },
  priority: 100,
  singletonGroup: 'primary-structure',
}

const dataSourceSpec: DataSourceContributionSpecV1 = {
  schemaVersion: 1,
  kind: 'data-source',
  contract: 'org.example/raster-source',
  major: 2,
  schema: { $ref: './schemas/raster-source.v2.schema.json' },
  conformanceProfile: 'org.example/raster-source-v2',
}

const emptyObjectValidator = ((value: unknown) => {
  const valid =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  emptyObjectValidator.errors = valid
    ? null
    : [
        {
          instancePath: '/',
          keyword: 'additionalProperties',
          message: 'must not have additional properties',
          params: {},
        },
      ]
  return valid
}) as PrecompiledSchemaValidator
emptyObjectValidator.errors = null

const asyncOkValidator = (async (value: unknown) => {
  const valid =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { readonly ok?: unknown }).ok === true
  if (valid) return true
  throw Object.assign(new Error('async schema validation failed'), {
    errors: [
      {
        instancePath: '/ok',
        keyword: 'const',
        message: 'must be equal to constant',
        params: { allowedValue: true },
      },
    ],
  })
}) as PrecompiledSchemaValidator

function manifest<T>(
  contract: string,
  id: string,
  spec: ContributionManifestV1Wire<T>['spec'],
): ContributionManifestV1Wire<T> {
  return {
    schemaVersion: 1,
    contract: { id: contract, major: 1 },
    id,
    displayName: id,
    spec,
  }
}

describe('A-1 contribution spec schemas', () => {
  const registry = createSpecSchemaRegistry(A1_SPEC_SCHEMA_ENTRIES)

  it('validates data-source inventory records outside the executable contribution registry', async () => {
    expect(await validateWithSchema(dataSourceContributionSpecV1Schema, dataSourceSpec)).toEqual([])
    expect(A1_SPEC_SCHEMA_ENTRIES).toHaveLength(6)
  })

  it.each([
    [CODEC_CONTRIBUTION_CONTRACT, 'org.example/json', codecSpec],
    [SERVICE_PROVIDER_CONTRIBUTION_CONTRACT, 'org.example/json-provider', serviceSpec],
    [VIEWER_CONTRIBUTION_CONTRACT, 'org.example/tree-viewer', viewerSpec],
  ] as const)('validates %s through the envelope-selected schema', async (contract, id, spec) => {
    const result = await validateContributionManifest(manifest(contract, id, spec), registry)
    expect(result.specState).toBe('validated')
    expect(result.activationEligible).toBe(false)
    expect(
      result.diagnostics.some(diagnostic => diagnostic.code === 'x3.sdk/schema-only-contract'),
    ).toBe(true)
  })

  it('binds producer trait claims to exact custom definition versions', async () => {
    const exact = {
      ...serviceSpec,
      outputs: [
        {
          id: 'org.example.syntax-tree',
          definitionVersion: '2.3.4',
          representation: 'runtime',
          presence: 'will-expose',
        },
      ],
    }
    const valid = await validateContributionManifest(
      manifest(SERVICE_PROVIDER_CONTRIBUTION_CONTRACT, 'org.example/exact-output', exact),
      registry,
    )
    expect(valid.specState).toBe('validated')

    const missing = await validateContributionManifest(
      manifest(SERVICE_PROVIDER_CONTRIBUTION_CONTRACT, 'org.example/unbound-output', {
        ...serviceSpec,
        outputs: [
          {
            id: 'org.example.syntax-tree',
            representation: 'runtime',
            presence: 'will-expose',
          },
        ],
      }),
      registry,
    )
    expect(missing.specState).toBe('invalid')
    expect(
      missing.diagnostics.some(item => item.code === 'x3.sdk/custom-trait-definition-unbound'),
    ).toBe(true)

    const consumerRange = await validateContributionManifest(
      manifest(SERVICE_PROVIDER_CONTRIBUTION_CONTRACT, 'org.example/range-output', {
        ...serviceSpec,
        outputs: [
          {
            id: 'org.example.syntax-tree',
            definitionRange: '^2.0.0',
            representation: 'runtime',
            presence: 'will-expose',
          },
        ],
      }),
      registry,
    )
    expect(consumerRange.specState).toBe('invalid')
    expect(consumerRange.diagnostics.some(item => item.code === 'x3.sdk/invalid-spec')).toBe(true)
  })

  it('rejects contradictory duplicate trait declarations per representation', async () => {
    const duplicate = [
      {
        id: 'structure.hierarchy',
        representation: 'runtime',
        presence: 'may-expose',
      },
      {
        id: 'structure.hierarchy',
        representation: 'runtime',
        presence: 'will-expose',
      },
    ] as const
    for (const [contract, id, spec] of [
      [
        CODEC_CONTRIBUTION_CONTRACT,
        'org.example/duplicate-codec-trait',
        { ...codecSpec, traitDeclarations: duplicate },
      ],
      [
        SERVICE_PROVIDER_CONTRIBUTION_CONTRACT,
        'org.example/duplicate-service-trait',
        { ...serviceSpec, outputs: duplicate },
      ],
    ] as const) {
      const result = await validateContributionManifest(manifest(contract, id, spec), registry)
      expect(result.specState).toBe('invalid')
      expect(result.diagnostics.some(item => item.code === 'x3.sdk/duplicate-semantic-id')).toBe(
        true,
      )
    }
  })

  it('rejects extra fields and invalid u64 budgets', async () => {
    const cases = [
      { ...codecSpec, implementationTier: { claimed: 1, proven: 1 } },
      {
        ...codecSpec,
        fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      },
      { ...codecSpec, budgets: { ...codecSpec.budgets, maxInputBytes: '01' } },
      {
        ...codecSpec,
        publishesDataSources: [{ contract: 'org.example/raster-source', major: 1 }],
      },
      {
        ...codecSpec,
        publishesDataSources: [
          { contract: 'common.view/tree-data-source', major: 1, opaque: true },
        ],
      },
    ]
    for (const spec of cases) {
      const result = await validateContributionManifest(
        manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/bad-codec', spec),
        registry,
      )
      expect(result.specState).toBe('invalid')
      expect(result.activationEligible).toBe(false)
    }
  })

  it('rejects ambiguous operation dispatch when two declarations share one handler', async () => {
    const firstOperation = codecSpec.operations[0]
    if (firstOperation === undefined) throw new Error('codec fixture needs an operation')
    const duplicateHandler = {
      ...codecSpec,
      operations: [
        firstOperation,
        {
          id: 'data.validate',
          handlerId: firstOperation.handlerId,
          mutatesSource: false,
          outputKinds: ['json'],
        },
      ],
    }
    const result = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/ambiguous-dispatch', duplicateHandler),
      registry,
    )
    expect(result.specState).toBe('invalid')
    expect(
      result.diagnostics.some(diagnostic => diagnostic.code === 'x3.sdk/duplicate-semantic-id'),
    ).toBe(true)
  })

  it('rejects executable codec variants that underdeclare source and operation permissions', async () => {
    const mutating = {
      ...codecSpec,
      operations: [
        ...codecSpec.operations,
        {
          id: 'data.save',
          handlerId: 'save',
          mutatesSource: true,
          requiredPermissions: ['filesystem-write'],
        },
      ],
    }
    const authored = {
      ...manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/underdeclared-codec', mutating),
      runtimeVariants: [
        {
          variantId: 'node',
          entrypoint: './dist/node.js',
          target: { environments: ['node'] },
          executionProfile: 'process-brokered',
          requestedPermissionClasses: ['read-source'],
        },
      ],
    }
    const result = await validateContributionManifest(authored, registry)
    expect(result.specState).toBe('invalid')
    expect(
      result.diagnostics.filter(
        diagnostic => diagnostic.code === 'x3.sdk/variant-permission-underdeclared',
      ),
    ).toHaveLength(2)
  })

  it('rejects non-JSON facets before schema evaluation', async () => {
    const facets: unknown[] = [{ fn: () => undefined }, { value: 1n }, { value: undefined }]
    for (const facet of facets) {
      const result = await validateContributionManifest(
        manifest(SERVICE_PROVIDER_CONTRIBUTION_CONTRACT, 'org.example/non-json', {
          ...serviceSpec,
          provides: [{ ...serviceSpec.provides[0], facet }],
        } as unknown as ServiceProviderContributionSpecV1Wire),
        registry,
      )
      expect(result.specState).toBe('invalid')
      expect(result.activationEligible).toBe(false)
      expect(
        result.diagnostics.some(diagnostic => diagnostic.code === 'x3.sdk/non-json-wire-value'),
      ).toBe(true)
    }
  })

  it('rejects writer evidence whose claim does not match its exact offer', async () => {
    const providerId = 'org.example/writer-proof-mismatch'
    const result = await validateContributionManifest(
      manifest(SERVICE_PROVIDER_CONTRIBUTION_CONTRACT, providerId, {
        provides: [
          {
            offerId: 'source',
            contract: 'common.edit/writer',
            major: 1,
            version: '1.0.0',
            facet: {
              providerId,
              fidelityEvidenceId: 'source-proof-v1',
              formatId: 'example',
              representationId: 'source',
              mutationMode: 'mutate',
              minimumRoundTrip: 'byte-identical',
            },
          },
        ],
        fidelityEvidence: [
          {
            offerId: 'source',
            evidenceId: 'source-proof-v1',
            claim: { roundTrip: 'semantic', preservesUnknownData: true },
            corpusId: 'org.example.corpus/source-v1',
            corpusDigest: 'sha256:source-corpus',
            conformanceProfile: 'org.example/source-writer-v1',
            optionsFingerprint: 'options:default',
            inputClass: 'source',
            provenAt: '2026-08-28T00:00:00Z',
          },
        ],
        lifecycleScope: 'session',
      }),
      registry,
    )
    expect(result.specState).toBe('invalid')
    expect(
      result.diagnostics.some(
        diagnostic => diagnostic.code === 'x3.sdk/writer-evidence-claim-mismatch',
      ),
    ).toBe(true)
  })

  it('accepts a zero deadline and rejects negative or fractional deadlines', async () => {
    const withDeadline = (deadlineMs: number) => ({
      ...codecSpec,
      budgets: { ...codecSpec.budgets, deadlineMs },
    })
    expect(
      (
        await validateContributionManifest(
          manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/deadline-zero', withDeadline(0)),
          registry,
        )
      ).specState,
    ).toBe('validated')
    for (const deadlineMs of [-1, 0.5]) {
      expect(
        (
          await validateContributionManifest(
            manifest(
              CODEC_CONTRIBUTION_CONTRACT,
              'org.example/invalid-deadline',
              withDeadline(deadlineMs),
            ),
            registry,
          )
        ).specState,
      ).toBe('invalid')
    }
  })

  it('uses topology-specific bounded probe policies', async () => {
    const namespaceSpec: CodecContributionSpecV1Wire = {
      ...codecSpec,
      sourceTopology: 'namespace',
      probe: {
        kind: 'namespace',
        markers: ['base/project.marker'],
        prefixes: ['base/'],
        maxEntries: 10_000,
        maxBytes: 65_536,
        maxDepth: 32,
        maxPathBytes: 4_096,
      },
    }
    const derivedSpec: CodecContributionSpecV1Wire = {
      ...codecSpec,
      sourceTopology: 'derived',
      probe: { kind: 'derived', maxSubjects: 32, maxRelationDepth: 8 },
    }
    for (const [id, spec] of [
      ['org.example/namespace-codec', namespaceSpec],
      ['org.example/derived-codec', derivedSpec],
    ] as const) {
      expect(
        (
          await validateContributionManifest(
            manifest(CODEC_CONTRIBUTION_CONTRACT, id, spec),
            registry,
          )
        ).specState,
      ).toBe('validated')
    }

    const mismatch = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/unbounded-namespace', {
        ...codecSpec,
        sourceTopology: 'namespace',
      }),
      registry,
    )
    expect(mismatch.specState).toBe('invalid')
    expect(
      mismatch.diagnostics.some(
        diagnostic =>
          diagnostic.code === 'x3.sdk/invalid-spec' ||
          diagnostic.code === 'x3.sdk/probe-topology-mismatch',
      ),
    ).toBe(true)
  })

  it('validates codec fidelity citations and their declared format/representation coordinates', async () => {
    const proof = {
      formatId: 'json',
      representationId: 'native',
      claim: { roundTrip: 'semantic' as const, preservesUnknownData: true },
      evidenceId: 'json-roundtrip-v1',
      corpusId: 'corpus:json-roundtrip',
      corpusDigest: 'sha256:proof',
      conformanceProfile: 'org.example/json-roundtrip-v1',
      optionsFingerprint: 'options:none',
      inputClass: 'json-document',
      provenAt: '2026-08-20T00:00:00Z',
    }
    const valid = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/json-proof', {
        ...codecSpec,
        fidelityEvidence: [proof],
      }),
      registry,
    )
    expect(valid.specState).toBe('validated')

    const unknown = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/json-proof-bad-ref', {
        ...codecSpec,
        fidelityEvidence: [
          { ...proof, formatId: 'other' },
          { ...proof, evidenceId: 'json-other-representation', representationId: 'other' },
        ],
      }),
      registry,
    )
    expect(unknown.specState).toBe('invalid')
    expect(unknown.diagnostics.map(diagnostic => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'x3.sdk/fidelity-evidence-format-unknown',
        'x3.sdk/fidelity-evidence-representation-unknown',
      ]),
    )

    const malformed = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/json-proof-malformed', {
        ...codecSpec,
        fidelityEvidence: [
          {
            ...proof,
            claim: { roundTrip: 'byte-identical', preservesUnknownData: false },
            provenAt: 'yesterday',
          },
        ],
      } as unknown as CodecContributionSpecV1Wire),
      registry,
    )
    expect(malformed.specState).toBe('invalid')
    expect(
      malformed.diagnostics.some(diagnostic => diagnostic.code === 'x3.sdk/invalid-spec'),
    ).toBe(true)
  })

  it('rejects duplicate schema and full registration keys deterministically', () => {
    const firstSchemaEntry = A1_SPEC_SCHEMA_ENTRIES[0]
    if (firstSchemaEntry === undefined) throw new Error('A-1 schema entries are empty')
    expect(() => createSpecSchemaRegistry([firstSchemaEntry, firstSchemaEntry])).toThrow(
      /duplicate spec schema/,
    )

    const registration: ContributionContractRegistration = {
      contract: { id: CODEC_CONTRIBUTION_CONTRACT, major: 1 },
      schema: {},
      mode: 'executable',
      project: () => [],
      validateSemantics: () => [],
      moduleAbi: { export: 'default', abiVersion: 1 },
      conformanceProfile: 'org.modkitx/codec-contribution-v1',
    }
    const open = createContributionContractRegistry([registration])
    expect(open.get(CODEC_CONTRIBUTION_CONTRACT, 1)).toEqual(registration)
    expect(open.get(CODEC_CONTRIBUTION_CONTRACT, 1)).not.toBe(registration)
    expect(Object.isFrozen(open.get(CODEC_CONTRIBUTION_CONTRACT, 1))).toBe(true)
    expect(open.list()).toEqual([registration])
    const executableRegistry = open.validationRegistry()
    const projectedRegistration = executableRegistry.list()[0]?.registration
    expect(projectedRegistration?.mode).toBe('executable')
    if (projectedRegistration?.mode === 'executable') {
      expect(projectedRegistration.moduleAbi.export).toBe('default')
    }
    expect(() => createContributionContractRegistry([registration, registration])).toThrow(
      /duplicate contribution contract/,
    )
  })

  it('fails closed when a hostile semantic hook returns malformed diagnostics', async () => {
    const hostile = createSpecSchemaRegistry([
      {
        contract: CODEC_CONTRIBUTION_CONTRACT,
        major: 1,
        schema: { type: 'object' },
        validator: emptyObjectValidator,
        validateSemantics: (() => 'ok') as unknown as NonNullable<
          SpecSchemaEntry['validateSemantics']
        >,
        registration: {
          mode: 'data-only',
          project: () => [],
          conformanceProfile: 'org.modkitx/hostile-semantic-hook',
        },
      },
    ])
    const result = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/hostile-hook', {}),
      hostile,
    )
    expect(result.inventoryEligible).toBe(false)
    expect(result.activationEligible).toBe(false)
    expect(result.diagnostics.some(item => item.code === 'x3.sdk/semantic-validator-failed')).toBe(
      true,
    )
  })

  it('fails closed on hostile runtime contract coordinates in both open registries', () => {
    const validContribution: ContributionContractRegistration = {
      contract: { id: CODEC_CONTRIBUTION_CONTRACT, major: 1 },
      schema: {},
      mode: 'data-only',
      project: () => [],
      validateSemantics: () => [],
      conformanceProfile: 'org.modkitx/codec-contribution-v1',
    }
    const invalidCoordinates: readonly [string, unknown, unknown][] = [
      ['unqualified contract', 'not-qualified', 1],
      ['non-string contract', 42, 1],
      ['NaN major', CODEC_CONTRIBUTION_CONTRACT, Number.NaN],
      ['negative major', CODEC_CONTRIBUTION_CONTRACT, -1],
      ['fractional major', CODEC_CONTRIBUTION_CONTRACT, 1.5],
      ['unsafe major', CODEC_CONTRIBUTION_CONTRACT, Number.MAX_SAFE_INTEGER + 1],
    ]
    for (const [label, contract, major] of invalidCoordinates) {
      const specEntry = {
        contract,
        major,
        schema: {},
      } as unknown as SpecSchemaEntry
      expect(() => createSpecSchemaRegistry([specEntry]), label).toThrow(
        /invalid-spec-registration|qualified id|safe non-negative integer/,
      )

      const contributionEntry = {
        ...validContribution,
        contract: { id: contract, major },
      } as unknown as ContributionContractRegistration
      expect(() => createContributionContractRegistry([contributionEntry]), label).toThrow(
        /invalid-contribution-contract-registration|qualified id|safe non-negative integer/,
      )
    }
  })

  it('rejects blank conformance profiles and malformed executable module ABIs', () => {
    const project = () => [] as const
    const validateSemantics = () => [] as const
    const specBase = {
      contract: CODEC_CONTRIBUTION_CONTRACT,
      major: 1,
      schema: {},
    } as const
    const contributionBase = {
      contract: { id: CODEC_CONTRIBUTION_CONTRACT, major: 1 },
      schema: {},
      project,
      validateSemantics,
    } as const

    for (const profile of ['', ' \t', 17] as const) {
      const specEntry = {
        ...specBase,
        registration: {
          mode: 'data-only',
          project,
          conformanceProfile: profile,
        },
      } as unknown as SpecSchemaEntry
      expect(() => createSpecSchemaRegistry([specEntry])).toThrow(/conformance profile/)

      const contributionEntry = {
        ...contributionBase,
        mode: 'data-only',
        conformanceProfile: profile,
      } as unknown as ContributionContractRegistration
      expect(() => createContributionContractRegistry([contributionEntry])).toThrow(
        /conformance profile/,
      )
    }

    const invalidModuleAbis: readonly unknown[] = [
      undefined,
      null,
      [],
      {},
      { export: '', abiVersion: 1 },
      { export: '  ', abiVersion: 1 },
      { export: 7, abiVersion: 1 },
      { export: 'create', abiVersion: Number.NaN },
      { export: 'create', abiVersion: -1 },
      { export: 'create', abiVersion: 1.5 },
      { export: 'create', abiVersion: Number.MAX_SAFE_INTEGER + 1 },
      { export: 'create', abiVersion: '1' },
    ]
    for (const moduleAbi of invalidModuleAbis) {
      const specEntry = {
        ...specBase,
        registration: {
          mode: 'executable',
          project,
          conformanceProfile: 'org.modkitx/codec-contribution-v1',
          moduleAbi,
        },
      } as unknown as SpecSchemaEntry
      expect(() => createSpecSchemaRegistry([specEntry])).toThrow(/module ABI/)

      const contributionEntry = {
        ...contributionBase,
        mode: 'executable',
        conformanceProfile: 'org.modkitx/codec-contribution-v1',
        moduleAbi,
      } as unknown as ContributionContractRegistration
      expect(() => createContributionContractRegistry([contributionEntry])).toThrow(/module ABI/)
    }

    expect(() =>
      createSpecSchemaRegistry([
        {
          ...specBase,
          registration: {
            mode: 'data-only',
            project: undefined,
            conformanceProfile: 'org.modkitx/codec-contribution-v1',
          },
        } as unknown as SpecSchemaEntry,
      ]),
    ).toThrow(/projector/)

    expect(() =>
      createContributionContractRegistry([
        {
          ...contributionBase,
          project: undefined,
          mode: 'data-only',
          conformanceProfile: 'org.modkitx/codec-contribution-v1',
        } as unknown as ContributionContractRegistration,
      ]),
    ).toThrow(/projector/)
  })

  it('snapshots schema registrations before compiling and caching them', async () => {
    const mutableSchema: { type: string; additionalProperties: boolean } = {
      type: 'object',
      additionalProperties: false,
    }
    const snapshotted = createSpecSchemaRegistry([
      {
        contract: CODEC_CONTRIBUTION_CONTRACT,
        major: 1,
        schema: mutableSchema,
        validator: emptyObjectValidator,
      },
    ])
    mutableSchema.additionalProperties = true
    const result = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/schema-snapshot', { unexpected: true }),
      snapshotted,
    )
    expect(result.specState).toBe('invalid')
    expect(Object.isFrozen(snapshotted.get(CODEC_CONTRIBUTION_CONTRACT, 1))).toBe(true)
  })

  it('fails closed with diagnostics when an open registration supplies an invalid schema', async () => {
    const invalidRegistry = createSpecSchemaRegistry([
      {
        contract: CODEC_CONTRIBUTION_CONTRACT,
        major: 1,
        schema: { type: 'definitely-not-json-schema' },
      },
    ])
    const result = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/invalid-schema', codecSpec),
      invalidRegistry,
    )
    expect(result.specState).toBe('invalid')
    expect(result.activationEligible).toBe(false)
    expect(
      result.diagnostics.some(diagnostic => diagnostic.code === 'x3.sdk/invalid-schema-authority'),
    ).toBe(true)
  })

  it('awaits async precompiled validators instead of treating their Promise as success', async () => {
    const asyncRegistry = createSpecSchemaRegistry([
      {
        contract: CODEC_CONTRIBUTION_CONTRACT,
        major: 1,
        schema: {
          $async: true,
          type: 'object',
          additionalProperties: false,
          required: ['ok'],
          properties: { ok: { const: true } },
        },
        validator: asyncOkValidator,
      },
    ])
    const valid = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/async-valid', { ok: true }),
      asyncRegistry,
    )
    expect(valid.specState).toBe('validated')
    expect(valid.activationEligible).toBe(false)

    const invalid = await validateContributionManifest(
      manifest(CODEC_CONTRIBUTION_CONTRACT, 'org.example/async-invalid', { ok: false }),
      asyncRegistry,
    )
    expect(invalid.specState).toBe('invalid')
    expect(invalid.activationEligible).toBe(false)
    expect(invalid.diagnostics.some(diagnostic => diagnostic.code === 'x3.sdk/invalid-spec')).toBe(
      true,
    )
  })
})
