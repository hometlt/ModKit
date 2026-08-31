import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { contractId, operationId } from '@modkit/core'
import type {
  CodecAuthoringSpec,
  CodecGroupMember,
  TargetSmokeEvidence,
} from '@modkit/sdk/authoring'
import {
  assertAuthoringPackable,
  defineCodec,
  defineCodecGroup,
  defineViewer,
  verifyAuthoringTargets,
} from '@modkit/sdk/authoring'

const CONTRIBUTION_ID = 'org.example/plain-text'

function codecSpec(overrides: Partial<CodecAuthoringSpec> = {}): CodecAuthoringSpec {
  return {
    id: CONTRIBUTION_ID,
    displayName: 'Plain text',
    format: { formatId: 'plain-text', label: 'Plain text', mediaType: 'text/plain' },
    roles: ['semantic'],
    topology: 'single',
    stages: ['authored'],
    intents: ['probe', 'inspect'],
    match: { extensions: ['txt'] },
    probe: {
      kind: 'bytes',
      ranges: [{ from: 'start', length: 64 }],
      maxBytes: 64,
      run: async () => ({
        codecId: CONTRIBUTION_ID,
        confidence: 1,
        evidence: [{ kind: 'structure', weight: 1 }],
        requiredRanges: [],
      }),
    },
    open: async () => {
      throw new Error('authoring fixture does not open')
    },
    operations: [
      {
        id: operationId('org.example/plain-text.inspect', {
          contributionId: CONTRIBUTION_ID,
        }),
        handlerId: 'inspect',
        mutatesSource: false,
        requiredPermissions: ['read-source'],
        outputKinds: ['json'],
        handler: async input => ({ kind: 'json', value: input }),
      },
    ],
    representations: [
      {
        id: 'text',
        contract: contractId('org.example/text-representation'),
        major: 1,
        stage: 'authored',
        lossy: false,
      },
    ],
    publishesDataSources: [{ contract: 'common.view/text-data-source', major: 1 }],
    budgets: {
      maxInputBytes: 1_048_576n,
      maxDepth: 4,
      maxNodes: 10_000,
      maxScalarBytes: 1_048_576,
      maxDiagnostics: 100,
    },
    implementationTier: { claimed: 1 },
    profile: 'source-reader',
    targets: [
      {
        variantId: 'portable',
        environments: ['browser-worker', 'node-worker'],
        entrypoint: './dist/index.js',
      },
    ],
    ...overrides,
  } as CodecAuthoringSpec
}

describe('A-4 authoring builders and profiles', () => {
  it('derives only profile-owned permissions and strips runtime handlers from wire data', () => {
    const definition = defineCodec(codecSpec())
    expect(definition.requestedPermissionClasses).toEqual(['read-source'])
    expect(definition.runtimeVariants).toEqual([
      {
        variantId: 'portable',
        entrypoint: './dist/index.js',
        target: { environments: ['browser-worker', 'node-worker'] },
        executionProfile: 'worker-brokered',
        requestedPermissionClasses: ['read-source'],
      },
    ])
    expect(definition.contribution.budgets.maxInputBytes).toBe('1048576')
    expect(definition.contribution.operations[0]).not.toHaveProperty('handler')
    expect(Object.isFrozen(definition.contribution)).toBe(true)
  })

  it('requires a passing smoke test for every declared environment before pack', () => {
    const definition = defineCodec(codecSpec())
    const partial = [
      { variantId: 'portable', environment: 'node-worker', state: 'passed' as const },
    ] satisfies readonly TargetSmokeEvidence[]
    expect(verifyAuthoringTargets(definition, partial)).toMatchObject({
      state: 'incomplete',
      missing: [{ variantId: 'portable', environment: 'browser-worker' }],
    })
    expect(() => assertAuthoringPackable(definition, partial)).toThrow(
      /every declared target environment/,
    )
    expect(() =>
      assertAuthoringPackable(definition, [
        ...partial,
        { variantId: 'portable', environment: 'browser-worker', state: 'passed' },
      ]),
    ).not.toThrow()
  })

  it('keeps grouped codec identities independent and snapshots caller-owned defaults', () => {
    const first = codecSpec({ id: 'org.example/first', displayName: 'First' })
    const second = codecSpec({ id: 'org.example/second', displayName: 'Second' })
    const defaults = {
      roles: first.roles,
      topology: first.topology,
      stages: first.stages,
      intents: first.intents,
      budgets: first.budgets,
      targets: first.targets,
      profile: first.profile,
      representations: first.representations,
      publishesDataSources: first.publishesDataSources,
      implementationTier: first.implementationTier,
    } as const
    const omitDefaults = (value: CodecAuthoringSpec) =>
      ({
        id: value.id,
        displayName: value.displayName,
        format: value.format,
        match: value.match,
        probe: value.probe,
        open: value.open,
        ...(value.planInput === undefined ? {} : { planInput: value.planInput }),
        operations: value.operations,
        ...(value.companions === undefined ? {} : { companions: value.companions }),
        ...(value.traitDeclarations === undefined
          ? {}
          : { traitDeclarations: value.traitDeclarations }),
      }) as CodecGroupMember
    const definitions = defineCodecGroup({
      defaults,
      codecs: [omitDefaults(first), omitDefaults(second)],
    })
    expect(definitions.map(item => item.id)).toEqual(['org.example/first', 'org.example/second'])
    expect(definitions[0]?.contribution).not.toBe(definitions[1]?.contribution)
  })

  it('contains no resolver/ranking/lock implementation in the authoring layer', async () => {
    const source = await readFile(new URL('../src/authoring/index.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/resolveProvider|rankCandidates|buildLock|replayPolicyLock/)
  })

  it('snapshots viewer definitions without importing or mounting their implementation', () => {
    let mounted = 0
    const definition = defineViewer({
      id: 'org.example/text-viewer',
      contribution: {
        kind: 'stage',
        consumesDataSources: [{ contract: 'common.view/text-data-source', major: 1 }],
        priority: 10,
      },
      module: {
        abiVersion: 1,
        async mount() {
          mounted += 1
          return { update: async () => undefined, unmount: async () => undefined }
        },
      },
      profile: 'pure-transform',
      targets: [
        {
          variantId: 'browser',
          environments: ['browser-main'],
          entrypoint: './dist/viewer.js',
        },
      ],
    })
    expect(definition.requestedPermissionClasses).toEqual([])
    expect(definition.contribution.kind).toBe('stage')
    expect(mounted).toBe(0)
  })
})

if (false) {
  // @ts-expect-error source-reader permissions are profile-owned and cannot be overridden.
  defineCodec({ ...codecSpec(), profile: 'source-reader', permissions: [] })

  // @ts-expect-error node-only targets cannot claim a browser environment.
  defineCodec({
    ...codecSpec(),
    profile: 'node-only',
    permissions: ['read-source'],
    targets: [{ variantId: 'bad', environments: ['browser-worker'], entrypoint: './bad.js' }],
  })
}
