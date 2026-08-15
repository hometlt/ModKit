import { describe, expect, it } from 'vitest'
import type {
  ResolvedAssetDescriptorWire,
  UnresolvedSourceDescriptorWire,
} from '../src/asset-capabilities/types.js'
import { validateWithSchema } from '../src/manifest/validate.js'
import { subjectDescriptorV2Schema } from '../src/schemas/subject-descriptor.js'
import { validateSubjectDescriptorV2 } from '../src/asset-capabilities/validate-descriptor.js'

const common = {
  schemaVersion: 2,
  subjectUri: 'memory://fixtures/example.txt',
  origin: {
    kind: 'single',
    binding: {
      id: 'content',
      role: 'content',
      source: { id: 'source-example', uri: 'memory://fixtures/example.txt' },
      required: true,
      ownership: 'owned',
      revision: 'content-hash.sha256:source-example-1',
      mediaType: 'text/plain',
    },
  },
  traits: [
    {
      id: 'content.text',
      descriptorVersion: 1,
      state: 'available',
      parameters: { encoding: 'utf-8', lines: 2 },
    },
  ],
  operations: [
    {
      id: 'view.inspect',
      handlerId: 'host.view.inspect',
      state: 'available',
      mutatesSource: false,
    },
  ],
  constraints: {
    readOnly: true,
    seekable: true,
    randomAccess: true,
    trusted: false,
    maxDecodedBytes: '18446744073709551615',
  },
  dataSources: [
    { contract: 'common.view/text-data-source', major: 1 },
    { contract: 'common.view/byte-range-source', major: 1 },
  ],
  diagnostics: [],
  revision: 'content-hash.sha256:fixture-1',
} as const

const unresolved: UnresolvedSourceDescriptorWire = {
  ...common,
  interpretation: 'none',
  candidates: [
    {
      codecId: 'example.codec/plain-text',
      confidence: 0.6,
      evidence: [{ kind: 'extension', weight: 0.1, note: '.txt candidate only' }],
      requiredRanges: [{ byteOffset: '0', byteLength: '128' }],
    },
  ],
}

const resolved: ResolvedAssetDescriptorWire = {
  ...common,
  interpretation: 'codec',
  identity: {
    codecId: 'example.codec/plain-text',
    codecVersion: '1.0.0',
    formatId: 'plain-text',
    formatLabel: 'Plain text',
    mediaType: 'text/plain',
    confidence: 0.99,
    detection: [{ kind: 'structure', weight: 0.9 }],
  },
  metadata: [
    {
      id: 'text',
      label: 'Text',
      entries: [{ key: 'encoding', value: 'utf-8' }],
    },
  ],
}

async function expectValidRoundTrip(
  value: UnresolvedSourceDescriptorWire | ResolvedAssetDescriptorWire,
) {
  const wire = JSON.parse(JSON.stringify(value)) as unknown
  expect(await validateWithSchema(subjectDescriptorV2Schema, wire)).toEqual([])
  expect(wire).toEqual(value)
}

describe('SubjectDescriptor v2 schema', () => {
  it('keeps the exported schema authority deeply immutable', () => {
    expect(Object.isFrozen(subjectDescriptorV2Schema)).toBe(true)
    expect(Object.isFrozen(subjectDescriptorV2Schema.oneOf[0])).toBe(true)
    expect(
      () =>
        ((
          subjectDescriptorV2Schema.oneOf[0] as unknown as { additionalProperties: boolean }
        ).additionalProperties = true),
    ).toThrow(TypeError)
  })

  it('validates the unresolved codec-less wire state after a JSON round-trip', async () => {
    await expectValidRoundTrip(unresolved)
  })

  it('fails closed without throwing for whitespace-only persistent identities', async () => {
    for (const value of [
      { ...unresolved, revision: ' ' },
      { ...unresolved, subjectUri: '\t' },
      {
        ...unresolved,
        origin: {
          kind: 'single',
          binding: {
            ...common.origin.binding,
            source: { ...common.origin.binding.source, id: ' ' },
          },
        },
      },
    ]) {
      const result = await validateSubjectDescriptorV2(value)
      expect(result.descriptor).toBeUndefined()
      expect(result.diagnostics.length).toBeGreaterThan(0)
    }
  })

  it('rejects non-canonical or ambiguous persistent subject references', async () => {
    for (const subjectUri of ['x3-subject:garbage', 'https://example.test/file#fragment']) {
      const result = await validateSubjectDescriptorV2({ ...unresolved, subjectUri })
      expect(result.descriptor).toBeUndefined()
      expect(
        result.diagnostics.some(item => item.code === 'x3.sdk/invalid-subject-reference'),
      ).toBe(true)
    }

    const derived = {
      ...resolved,
      origin: {
        kind: 'derived',
        inputs: [
          {
            bindingId: 'input',
            role: 'source',
            subjectUri: 'x3-subject:garbage',
            revision: 'content-hash.sha256:input',
            compositionFingerprint: 'input-1',
          },
        ],
      },
    }
    const result = await validateSubjectDescriptorV2(derived)
    expect(result.descriptor).toBeUndefined()
    expect(result.diagnostics.some(item => item.code === 'x3.sdk/invalid-subject-reference')).toBe(
      true,
    )
  })

  it('validates the resolved codec interpretation after a JSON round-trip', async () => {
    await expectValidRoundTrip(resolved)
  })

  it('rejects duplicate operation and handler dispatch identities', async () => {
    const firstOperation = resolved.operations[0]
    if (firstOperation === undefined) throw new Error('resolved fixture has no operation')
    const duplicate = {
      ...resolved,
      operations: [
        ...resolved.operations,
        {
          id: 'view.export',
          handlerId: firstOperation.handlerId,
          state: 'available',
          mutatesSource: false,
        },
      ],
    }
    const result = await validateSubjectDescriptorV2(duplicate)
    expect(result.descriptor).toBeUndefined()
    expect(
      result.diagnostics.some(item => item.code === 'x3.sdk/duplicate-descriptor-handler'),
    ).toBe(true)
  })

  it('rejects duplicate diagnostic and trait identities', async () => {
    const duplicate = {
      ...resolved,
      diagnostics: [
        {
          id: 'same-diagnostic',
          code: 'org.modkitx/duplicate-descriptor-fact',
          category: 'structure',
          severity: 'warning',
          message: 'first',
        },
        {
          id: 'same-diagnostic',
          code: 'org.modkitx/duplicate-descriptor-fact',
          category: 'structure',
          severity: 'warning',
          message: 'second',
        },
      ],
      traits: [...resolved.traits, resolved.traits[0]],
    }
    const result = await validateSubjectDescriptorV2(duplicate)
    expect(result.descriptor).toBeUndefined()
    expect(result.diagnostics.map(item => item.code)).toEqual(
      expect.arrayContaining([
        'x3.sdk/duplicate-descriptor-diagnostic',
        'x3.sdk/duplicate-descriptor-trait',
      ]),
    )
  })

  it('binds custom trait parameters to an exact definition version', async () => {
    const custom = {
      ...unresolved,
      traits: [
        {
          id: 'org.example.custom-trait',
          descriptorVersion: 1,
          state: 'available',
          parameters: { mode: 'strict' },
        },
      ],
    }
    const missing = await validateSubjectDescriptorV2(custom)
    expect(missing.descriptor).toBeUndefined()
    expect(
      missing.diagnostics.some(item => item.code === 'x3.sdk/custom-trait-definition-unbound'),
    ).toBe(true)

    const bound = {
      ...custom,
      traits: [{ ...custom.traits[0], definitionVersion: '1.2.3' }],
    }
    expect((await validateSubjectDescriptorV2(bound)).descriptor).toBeDefined()

    const versionedStandard = {
      ...unresolved,
      traits: [{ ...unresolved.traits[0], definitionVersion: '1.0.0' }],
    }
    const standard = await validateSubjectDescriptorV2(versionedStandard)
    expect(standard.descriptor).toBeUndefined()
    expect(standard.diagnostics.some(item => item.code === 'x3.sdk/standard-trait-versioned')).toBe(
      true,
    )

    const availableWithDiagnostics = {
      ...unresolved,
      traits: [{ ...unresolved.traits[0], diagnosticIds: ['unused'] }],
    }
    expect((await validateSubjectDescriptorV2(availableWithDiagnostics)).descriptor).toBeUndefined()
  })

  it('represents CUE plus two same-role BIN tracks as stable bundle bindings', async () => {
    const cueBundle: ResolvedAssetDescriptorWire = {
      ...resolved,
      subjectUri: 'memory://fixtures/album.cue',
      origin: {
        kind: 'bundle',
        primary: 'cue-sheet',
        bindings: [
          {
            id: 'cue-sheet',
            role: 'cue',
            source: { id: 'cue', uri: 'memory://fixtures/album.cue' },
            required: true,
            ownership: 'owned',
            revision: 'content-hash.sha256:cue-1',
            mediaType: 'application/x-cue',
          },
          {
            id: 'track-bin-01',
            role: 'track-data',
            source: { id: 'bin-01', uri: 'memory://fixtures/disc-01.bin' },
            required: true,
            ownership: 'companion',
            revision: 'content-hash.sha256:bin-01',
          },
          {
            id: 'track-bin-02',
            role: 'track-data',
            source: { id: 'bin-02', uri: 'memory://fixtures/disc-02.bin' },
            required: true,
            ownership: 'companion',
            revision: 'content-hash.sha256:bin-02',
          },
        ],
      },
      companions: [
        {
          id: 'tracks',
          role: 'track-data',
          required: true,
          cardinality: 'one-or-more',
          state: 'resolved',
          bindingIds: ['track-bin-01', 'track-bin-02'],
        },
      ],
    }
    await expectValidRoundTrip(cueBundle)
    const result = await validateSubjectDescriptorV2(cueBundle)
    expect(result.diagnostics).toEqual([])
    expect(result.descriptor?.origin.kind).toBe('bundle')
    if (
      result.descriptor?.interpretation !== 'codec' ||
      result.descriptor.origin.kind !== 'bundle'
    ) {
      throw new Error('expected resolved bundle')
    }
    expect(result.descriptor.origin.bindings.map(binding => binding.id)).toEqual([
      'cue-sheet',
      'track-bin-01',
      'track-bin-02',
    ])
    expect(result.descriptor.origin.bindings.slice(1).map(binding => binding.role)).toEqual([
      'track-data',
      'track-data',
    ])
    const tracks = result.descriptor.companions?.[0]
    expect(tracks?.state).toBe('resolved')
    if (tracks?.state !== 'resolved') throw new Error('expected resolved tracks')
    expect(tracks.bindingIds).toEqual(['track-bin-01', 'track-bin-02'])
  })

  it('preserves an unresolved required companion as diagnostic-backed requirement state', async () => {
    const missing: ResolvedAssetDescriptorWire = {
      ...resolved,
      diagnostics: [
        {
          id: 'missing-palette',
          code: 'org.modkitx/missing-companion',
          category: 'dependency',
          severity: 'error',
          message: 'Required palette was not found',
        },
      ],
      companions: [
        {
          id: 'palette',
          role: 'palette',
          required: true,
          cardinality: 'one',
          state: 'missing',
          diagnosticIds: ['missing-palette'],
        },
      ],
    }
    await expectValidRoundTrip(missing)
    const result = await validateSubjectDescriptorV2(missing)
    expect(result.descriptor?.interpretation).toBe('codec')
    if (result.descriptor?.interpretation !== 'codec') throw new Error('expected codec')
    expect(result.descriptor.companions?.[0]?.state).toBe('missing')
  })

  it('preserves a diagnostic-backed ambiguous singular companion without guessing', async () => {
    const ambiguous: ResolvedAssetDescriptorWire = {
      ...resolved,
      diagnostics: [
        {
          id: 'ambiguous-palette',
          code: 'org.modkitx/ambiguous-companion',
          category: 'dependency',
          severity: 'error',
          message: 'Two palettes match the singular requirement',
        },
      ],
      companions: [
        {
          id: 'palette',
          role: 'palette',
          required: true,
          cardinality: 'one',
          state: 'ambiguous',
          candidates: [
            {
              source: { id: 'palette-a', uri: 'memory://fixtures/palette-a.pal' },
              revision: 'content-hash.sha256:palette-a',
            },
            {
              source: { id: 'palette-b', uri: 'memory://fixtures/palette-b.pal' },
              revision: 'content-hash.sha256:palette-b',
            },
          ],
          diagnosticIds: ['ambiguous-palette'],
        },
      ],
    }
    await expectValidRoundTrip(ambiguous)
    const result = await validateSubjectDescriptorV2(ambiguous)
    expect(result.diagnostics).toEqual([])
    if (result.descriptor?.interpretation !== 'codec') throw new Error('expected codec')
    const palette = result.descriptor.companions?.[0]
    expect(palette?.state).toBe('ambiguous')
    if (palette?.state !== 'ambiguous') throw new Error('expected ambiguous palette')
    expect(palette.candidates.map(candidate => candidate.revision)).toEqual([
      'content-hash.sha256:palette-a',
      'content-hash.sha256:palette-b',
    ])
  })

  it('rejects untracked and requiredness-mismatched companion bindings', async () => {
    const bundle: ResolvedAssetDescriptorWire = {
      ...resolved,
      origin: {
        kind: 'bundle',
        bindings: [
          {
            id: 'primary',
            role: 'content',
            source: { id: 'primary', uri: 'memory://fixtures/primary.bin' },
            required: true,
            ownership: 'owned',
            revision: 'content-hash.sha256:primary',
          },
          {
            id: 'palette',
            role: 'palette',
            source: { id: 'palette', uri: 'memory://fixtures/palette.pal' },
            required: true,
            ownership: 'companion',
            revision: 'content-hash.sha256:palette',
          },
        ],
        primary: 'primary',
      },
    }
    const untracked = await validateSubjectDescriptorV2(bundle)
    expect(untracked.descriptor).toBeUndefined()
    expect(
      untracked.diagnostics.some(item => item.code === 'x3.sdk/untracked-companion-binding'),
    ).toBe(true)

    const mismatch = await validateSubjectDescriptorV2({
      ...bundle,
      companions: [
        {
          id: 'palette',
          role: 'palette',
          required: false,
          cardinality: 'zero-or-one',
          state: 'resolved',
          bindingIds: ['palette'],
        },
      ],
    })
    expect(mismatch.descriptor).toBeUndefined()
    expect(
      mismatch.diagnostics.some(item => item.code === 'x3.sdk/invalid-companion-binding'),
    ).toBe(true)

    if (bundle.origin.kind !== 'bundle') throw new Error('expected bundle fixture')
    const tooMany = await validateSubjectDescriptorV2({
      ...bundle,
      origin: {
        ...bundle.origin,
        bindings: [
          ...bundle.origin.bindings,
          {
            id: 'palette-2',
            role: 'palette',
            source: { id: 'palette-2', uri: 'memory://fixtures/palette-2.pal' },
            required: true,
            ownership: 'companion',
            revision: 'content-hash.sha256:palette-2',
          },
        ],
      },
      companions: [
        {
          id: 'palette',
          role: 'palette',
          required: true,
          cardinality: 'one',
          state: 'resolved',
          bindingIds: ['palette', 'palette-2'],
        },
      ],
    })
    expect(tooMany.descriptor).toBeUndefined()
    expect(tooMany.diagnostics.length).toBeGreaterThan(0)
  })

  it('represents a namespace root and revision without a fake primary source', async () => {
    const namespace: UnresolvedSourceDescriptorWire = {
      ...unresolved,
      subjectUri: 'casc://installation/root',
      origin: {
        kind: 'namespace',
        root: { id: 'casc-installation', uri: 'casc://installation/root' },
        revision: 'database-version:12345',
      },
    }
    await expectValidRoundTrip(namespace)
    expect('primary' in namespace.origin).toBe(false)
    expect('source' in namespace).toBe(false)
  })

  it('represents an unmaterialized derived subject from exact input snapshots', async () => {
    const derived: ResolvedAssetDescriptorWire = {
      ...resolved,
      subjectUri: 'modkit-derived:export.convert/example',
      origin: {
        kind: 'derived',
        inputs: [
          {
            bindingId: 'model',
            role: 'model',
            subjectUri: 'memory://fixtures/model.m3',
            revision: 'content-hash.sha256:model-1',
            compositionFingerprint: 'model-composition-1',
          },
          {
            bindingId: 'texture',
            role: 'texture',
            subjectUri: 'memory://fixtures/texture.dds',
            revision: 'content-hash.sha256:texture-1',
            compositionFingerprint: 'texture-composition-1',
          },
        ],
        recipe: {
          extensionId: 'org.example/export-tools',
          extensionVersion: '2.1.0',
          contributionId: 'org.example/gltf-exporter',
          operation: 'org.example/gltf-exporter.convert',
          parameters: { target: 'gltf', embedTextures: true },
        },
      },
    }
    await expectValidRoundTrip(derived)
    const result = await validateSubjectDescriptorV2(derived)
    expect(result.diagnostics).toEqual([])
    expect(result.descriptor?.origin.kind).toBe('derived')
    if (result.descriptor?.origin.kind !== 'derived') throw new Error('expected derived')
    expect(result.descriptor.origin.materialization).toBeUndefined()
    expect(result.descriptor.origin.recipe?.operation).toBe('org.example/gltf-exporter.convert')
    expect(result.descriptor.origin.recipe?.contributionId).toBe('org.example/gltf-exporter')
  })

  it('rejects duplicate stable binding ids in a derived origin', async () => {
    const input = {
      bindingId: 'same',
      role: 'source',
      subjectUri: 'memory://source-a',
      revision: 'provider-token:source-a-r1',
      compositionFingerprint: 'source-a-composition',
    }
    const duplicate = {
      ...resolved,
      origin: {
        kind: 'derived',
        inputs: [input, { ...input, subjectUri: 'memory://source-b' }],
      },
    }
    const result = await validateSubjectDescriptorV2(duplicate)
    expect(result.descriptor).toBeUndefined()
    expect(result.diagnostics.some(item => item.code === 'x3.sdk/duplicate-derived-input')).toBe(
      true,
    )
  })

  it('strictly rejects installed bindings and presentation-plan state', async () => {
    const cases: readonly [string, unknown][] = [
      ['viewer ID', { ...resolved, viewerId: 'common.ui/text-stage' }],
      ['provider ID', { ...resolved, providerId: 'example.provider/text' }],
      ['selected provider ID', { ...resolved, selectedProviderId: 'example.provider/text' }],
      ['presentation plan', { ...resolved, presentationPlan: { activeStage: 'text' } }],
      ['activation ticket', { ...resolved, ticket: { artifactDigest: 'sha256:bad' } }],
      [
        'nested viewer binding',
        { ...resolved, identity: { ...resolved.identity, viewerId: 'common.ui/text-stage' } },
      ],
      [
        'diagnostic provider binding',
        {
          ...resolved,
          diagnostics: [
            {
              id: 'provider-leak',
              code: 'x3.test/provider-leak',
              category: 'dependency',
              severity: 'warning',
              message: 'must not persist a selected provider',
              source: { providerId: 'example.provider/text' },
            },
          ],
        },
      ],
    ]

    for (const [label, value] of cases) {
      expect(
        (await validateWithSchema(subjectDescriptorV2Schema, value)).length,
        label,
      ).toBeGreaterThan(0)
    }
  })

  it('keeps unresolved and resolved state fields mutually exclusive', async () => {
    expect(
      (
        await validateWithSchema(subjectDescriptorV2Schema, {
          ...unresolved,
          identity: resolved.identity,
        })
      ).length,
    ).toBeGreaterThan(0)
    expect(
      (await validateWithSchema(subjectDescriptorV2Schema, { ...resolved, candidates: [] })).length,
    ).toBeGreaterThan(0)
  })

  it('rejects partial or cross-kind origin forms strictly', async () => {
    const withoutOrigin: Record<string, unknown> = { ...resolved }
    delete withoutOrigin['origin']
    const invalid: readonly unknown[] = [
      {
        ...withoutOrigin,
        source: { id: 'legacy-primary', uri: 'memory://fixtures/example.txt' },
      },
      {
        ...resolved,
        origin: {
          kind: 'bundle',
          bindings: [
            {
              id: common.origin.binding.id,
              role: common.origin.binding.role,
              source: common.origin.binding.source,
              required: common.origin.binding.required,
              ownership: common.origin.binding.ownership,
            },
          ],
        },
      },
      {
        ...resolved,
        origin: {
          kind: 'namespace',
          root: { id: 'root', uri: 'memory://namespace' },
        },
      },
      {
        ...resolved,
        origin: {
          kind: 'namespace',
          root: { id: 'root', uri: 'memory://namespace' },
          revision: 'provider-token:root-1',
          primary: 'invented',
        },
      },
      {
        ...resolved,
        origin: {
          kind: 'derived',
          inputs: [{ subjectUri: 'memory://input', revision: 'provider-token:input-1' }],
        },
      },
      {
        ...resolved,
        origin: {
          kind: 'derived',
          inputs: [{ subjectUri: 'memory://input' }],
          recipe: { operation: 'export.convert' },
        },
      },
      {
        ...resolved,
        origin: {
          kind: 'derived',
          inputs: [{ subjectUri: 'memory://input', revision: 'provider-token:input-1' }],
          recipe: { operation: 'export.convert' },
          materialization: { source: { id: 'output', uri: 'memory://output' } },
        },
      },
    ]
    for (const value of invalid) {
      expect((await validateWithSchema(subjectDescriptorV2Schema, value)).length).toBeGreaterThan(0)
    }
  })

  it('rejects duplicate bundle ids and a primary that is not a binding', async () => {
    const binding = common.origin.binding
    const duplicate = {
      ...resolved,
      origin: {
        kind: 'bundle',
        primary: 'missing',
        bindings: [binding, { ...binding, role: 'second' }],
      },
    }
    const result = await validateSubjectDescriptorV2(duplicate)
    expect(result.descriptor).toBeUndefined()
    expect(result.diagnostics.map(item => item.code)).toEqual(
      expect.arrayContaining(['x3.sdk/duplicate-origin-binding', 'x3.sdk/unknown-origin-primary']),
    )
  })

  it('rejects non-wire numeric and incomplete coordinate values', async () => {
    const bigintBudget = {
      ...resolved,
      constraints: { ...resolved.constraints, maxDecodedBytes: 1n },
    }
    const incompleteRange = {
      ...unresolved,
      candidates: [
        {
          ...unresolved.candidates[0],
          requiredRanges: [{ byteOffset: '0' }],
        },
      ],
    }

    expect(
      (await validateWithSchema(subjectDescriptorV2Schema, bigintBudget)).length,
    ).toBeGreaterThan(0)
    expect(
      (await validateWithSchema(subjectDescriptorV2Schema, incompleteRange)).length,
    ).toBeGreaterThan(0)
  })

  it('rejects unqualified persistent diagnostic codes at every nesting level', async () => {
    const rootCode = {
      ...resolved,
      diagnostics: [
        {
          id: 'bad-code',
          code: 'oops',
          category: 'structure',
          severity: 'warning',
          message: 'not a qualified persistent diagnostic code',
        },
      ],
    }
    const candidateCode = {
      ...unresolved,
      candidates: [
        {
          ...unresolved.candidates[0],
          diagnostics: [
            {
              id: 'bad-candidate-code',
              code: 'oops',
              category: 'structure',
              severity: 'warning',
              message: 'nested code must follow the same grammar',
            },
          ],
        },
      ],
    }
    expect((await validateSubjectDescriptorV2(rootCode)).descriptor).toBeUndefined()
    expect((await validateSubjectDescriptorV2(candidateCode)).descriptor).toBeUndefined()
  })

  it('normalizes every nested u64/span and branded id after semantic validation', async () => {
    const value = {
      ...unresolved,
      diagnostics: [
        {
          id: 'root-range',
          code: 'x3.test/root-range',
          category: 'structure',
          severity: 'warning',
          message: 'bounded root range',
          range: { byteOffset: '1', byteLength: '2' },
        },
      ],
      candidates: [
        {
          ...unresolved.candidates[0],
          diagnostics: [
            {
              id: 'candidate-range',
              code: 'x3.test/candidate-range',
              category: 'structure',
              severity: 'warning',
              message: 'bounded candidate range',
              range: { byteOffset: '3', byteLength: '4' },
            },
          ],
        },
      ],
    }
    const result = await validateSubjectDescriptorV2(value)
    expect(result.diagnostics).toEqual([])
    expect(result.descriptor?.constraints.maxDecodedBytes).toBe('18446744073709551615')
    if (result.descriptor?.interpretation !== 'none') throw new Error('expected unresolved')
    expect(result.descriptor.diagnostics[0]?.range).toEqual({
      byteOffset: '1',
      byteLength: '2',
    })
    expect(result.descriptor.candidates[0]?.diagnostics?.[0]?.range).toEqual({
      byteOffset: '3',
      byteLength: '4',
    })
  })

  it('rejects semantically unsafe versions and operation ownership mismatches', async () => {
    const unsafeVersion = {
      ...resolved,
      identity: { ...resolved.identity, codecVersion: '9007199254740992.0.0' },
    }
    const badOperation = {
      ...resolved,
      operations: [
        {
          id: 'evil.run',
          handlerId: 'evil.run',
          state: 'available',
          mutatesSource: false,
        },
      ],
    }
    expect((await validateSubjectDescriptorV2(unsafeVersion)).descriptor).toBeUndefined()
    expect((await validateSubjectDescriptorV2(badOperation)).descriptor).toBeUndefined()
  })
})
