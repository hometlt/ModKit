import { describe, expect, it } from 'vitest'
import { contractId } from '@modkitx-x3/core'
import {
  createSpecSchemaRegistry,
  validateContributionManifest,
  type ContributionManifestV1Wire,
  type PrecompiledSchemaValidator,
} from '@modkitx-x3/sdk'

// Lab demo contract (used through S3/S4): x3.demo/greeter@1.
const greeterSpecSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { greeting: { type: 'string', minLength: 1 } },
} as const

const greeterSpecValidator = ((value: unknown) => {
  const valid =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { readonly greeting?: unknown }).greeting === 'string' &&
    (value as { readonly greeting: string }).greeting.length > 0
  greeterSpecValidator.errors = valid
    ? null
    : [
        {
          instancePath: '/greeting',
          keyword: 'minLength',
          message: 'must be a non-empty string and the only property',
          params: { limit: 1 },
        },
      ]
  return valid
}) as PrecompiledSchemaValidator
greeterSpecValidator.errors = null

const registry = createSpecSchemaRegistry([
  {
    contract: contractId('x3.demo/greeter'),
    major: 1,
    schema: greeterSpecSchema,
    validator: greeterSpecValidator,
    registration: {
      mode: 'executable',
      project: () => [],
      moduleAbi: { export: 'createGreeter', abiVersion: 1 },
      conformanceProfile: 'x3.demo/greeter-v1',
    },
  },
])

const greeterContribution: ContributionManifestV1Wire = {
  schemaVersion: 1,
  contract: { id: 'x3.demo/greeter', major: 1 },
  id: 'org.x3lab/greeter-plain',
  displayName: 'Plain greeter',
  runtimeVariants: [
    {
      variantId: 'portable',
      entrypoint: './dist/greeter.js',
      target: { environments: ['node', 'node-worker'] },
      executionProfile: 'trusted-in-process',
      requestedPermissionClasses: [],
    },
  ],
  spec: { greeting: 'Hello' },
}

// Provenance fixture (PORTED.md): converted from modkitx
// extensions/images/codecs/dds/codec.manifest.json@8a21060f — v1 kind/capabilities/
// entrypoints-map become contract + spec + single-entrypoint runtime variants; the
// legacy `capabilities` verbs are dropped (final vocabulary MK3/02 §1).
const convertedDds: ContributionManifestV1Wire = {
  schemaVersion: 1,
  contract: { id: 'x3.compat/codec-v1', major: 1 },
  id: 'org.modkitx/dds',
  displayName: 'DirectDraw Surface',
  status: 'partial',
  runtimeVariants: [
    {
      variantId: 'node',
      entrypoint: './codec.js',
      target: { environments: ['node', 'node-worker'] },
      executionProfile: 'trusted-in-process',
      requestedPermissionClasses: ['read-source'],
    },
  ],
  limitations: ['BC6H/BC7 decode via WASM path; uncommon DXGI formats diagnostic-only.'],
  spec: {
    formatId: 'dds',
    match: { extensions: ['.dds'], magic: [{ offset: 0, bytes: 'DDS ', encoding: 'ascii' }] },
    operations: ['image.read', 'image.inspect', 'image.write'],
  },
}

describe('ContributionManifestV1 envelope (27 §6 + §0.5)', () => {
  it('rejects unknown unqualified facilities but preserves extension-owned qualified IDs', async () => {
    const withFacilities = (
      requiredHostCapabilities: readonly string[],
    ): ContributionManifestV1Wire => ({
      ...greeterContribution,
      runtimeVariants: (greeterContribution.runtimeVariants ?? []).map(variant => ({
        ...variant,
        target: { ...variant.target, requiredHostCapabilities },
      })),
    })
    const invalid = withFacilities(['custom.broker'])
    const invalidResult = await validateContributionManifest(invalid, registry)
    expect(invalidResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'x3.sdk/unknown-host-facility', severity: 'error' }),
      ]),
    )

    const extensionOwned = withFacilities(['example.vendor/custom-broker'])
    const validResult = await validateContributionManifest(extensionOwned, registry)
    expect(validResult.specState).toBe('validated')
    expect(validResult.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'x3.sdk/unknown-host-facility' })]),
    )
  })

  it('validates a known contract strictly (spec schema selected by contract)', async () => {
    const result = await validateContributionManifest(greeterContribution, registry)
    expect(result.specState).toBe('validated')
    expect(result.activationEligible).toBe(true)
  })

  it('keeps an unknown contract inspectable but not activatable', async () => {
    const result = await validateContributionManifest(convertedDds, registry)
    expect(result.specState).toBe('unknown-contract')
    expect(result.activationEligible).toBe(false)
    expect(result.manifest?.id).toBe('org.modkitx/dds') // data preserved for inspection
    expect(result.diagnostics.some(d => d.code === 'x3.sdk/unknown-contract')).toBe(true)
  })

  it('rejects an invalid spec for a known contract', async () => {
    const bad = { ...greeterContribution, spec: { greeting: '' } }
    const result = await validateContributionManifest(bad, registry)
    expect(result.specState).toBe('invalid')
    expect(result.activationEligible).toBe(false)
    expect(result.diagnostics.some(d => d.code === 'x3.sdk/invalid-spec')).toBe(true)
    expect(result.diagnostics.some(d => d.path?.[0] === 'spec')).toBe(true)
  })

  it('status is an optional display hint (27 §0.5.2); no per-contribution version exists', async () => {
    const withoutStatus = await validateContributionManifest(greeterContribution, registry)
    expect(withoutStatus.specState).toBe('validated')
    const withVersion = { ...greeterContribution, version: '1.0.0' }
    const result = await validateContributionManifest(withVersion, registry)
    expect(result.specState).toBe('invalid') // additionalProperties: false
  })

  it('enforces grammars: qualified ids, segment variant ids, Q77 profiles, 24 §3 classes', async () => {
    const cases: [string, unknown][] = [
      ['plain contribution id', { ...greeterContribution, id: 'dds' }],
      [
        'legacy §5 profile name',
        {
          ...greeterContribution,
          runtimeVariants: [
            {
              ...(greeterContribution.runtimeVariants?.[0] ?? {}),
              executionProfile: 'wasm-sandbox',
            },
          ],
        },
      ],
      [
        'legacy permission vocabulary',
        {
          ...greeterContribution,
          runtimeVariants: [
            {
              ...(greeterContribution.runtimeVariants?.[0] ?? {}),
              requestedPermissionClasses: ['launch-process'],
            },
          ],
        },
      ],
      [
        'non-segment variant id',
        {
          ...greeterContribution,
          runtimeVariants: [
            { ...(greeterContribution.runtimeVariants?.[0] ?? {}), variantId: 'Node.X' },
          ],
        },
      ],
    ]
    for (const [label, value] of cases) {
      expect((await validateContributionManifest(value, registry)).specState, label).toBe('invalid')
    }
  })

  it('accepts scoped contract requirements (23 §8) with mandatory mode/scope', async () => {
    const withDeps = {
      ...greeterContribution,
      dependsOn: [
        {
          contract: 'common.image/decoded',
          major: 1,
          range: '^1.3',
          mode: 'integrates',
          scope: { kind: 'operation', id: 'demo.greet' },
        },
      ],
    }
    expect((await validateContributionManifest(withDeps, registry)).specState).toBe('validated')
  })

  it('rejects the legacy v1 codec.manifest.json shape as an envelope', async () => {
    const legacy = (
      await import('./fixtures/legacy/legacy-codec-manifest.json', { with: { type: 'json' } })
    ).default
    const result = await validateContributionManifest(legacy, registry)
    expect(result.specState).toBe('invalid')
    expect(result.manifest).toBeUndefined()
  })
})
