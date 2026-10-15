import { contractId, diagnostic } from '@modkit/core'
import { createContributionContractRegistry, type ContributionContractRegistration } from '@modkit/sdk'
import { expect, it, vi } from 'vitest'
import { buildInventory, type ExtensionInput } from '../src/inventory.js'
import { createHostContributionContractRegistry } from '../src/contribution-registry.js'

const coordinate = { id: contractId('x3.fixture/cache-policy'), major: 1 }
const registration = (): ContributionContractRegistration => ({
  contract: coordinate,
  schema: { type: 'object', properties: { greeting: { type: 'string' } } },
  validator: () => true,
  mode: 'executable',
  project: () => [],
  validateSemantics: () => [],
  moduleAbi: { export: 'createGreeter', abiVersion: 1 },
  conformanceProfile: 'x3.fixture/cache-policy-v1',
})

function fixture(id: string): ExtensionInput {
  const path = 'contributions/policy.json'
  return {
    source: id,
    containers: { standalone: {
      schemaVersion: 1, publisher: 'fixture', id: 'cache-policy', version: '1.0.0', license: 'MIT',
      contributionManifests: ['./contributions/*.json'],
    } },
    files: [path],
    documents: new Map([[path, {
      schemaVersion: 1, contract: coordinate, id: `fixture/${id}`, displayName: id,
      runtimeVariants: [{
        variantId: 'portable', entrypoint: './dist/provider.js', target: { environments: ['node'] },
        executionProfile: 'trusted-in-process', requestedPermissionClasses: [],
      }],
      spec: { greeting: 'hello' },
    }]]),
    documentDigests: new Map([[path, `sha256:${id}`]]),
    artifact: {
      inventoryRecordId: id, artifactDigest: `sha256:${id}`, artifactRoot: new URL(`file:///fixture/${id}/`),
      verifyArtifactDigest: () => true,
    },
    execution: { origin: 'bundled', allowTrustedInProcess: true },
  }
}

it.each(['schema validator', 'semantic validator'] as const)(
  'isolates cached results from another immutable registry with a different %s',
  async policy => {
    const validate = vi.fn(() => true)
    const allowed = createContributionContractRegistry([{ ...registration(), validator: validate }])
    const deny = vi.fn(() => false)
    const semantic = vi.fn(() => [diagnostic('error', 'fixture/denied', 'Policy denied')])
    const refused = createContributionContractRegistry([{
      ...registration(),
      ...(policy === 'schema validator' ? { validator: deny } : { validateSemantics: semantic }),
    }])
    const input = fixture(policy === 'schema validator' ? 'schema-isolation' : 'semantic-isolation')
    expect((await buildInventory([input], allowed)).extensions[0]?.contributions[0]?.specState).toBe('validated')
    expect((await buildInventory([input], allowed)).extensions[0]?.contributions[0]?.specState).toBe('validated')
    expect(validate).toHaveBeenCalledOnce()
    const rejected = (await buildInventory([input], refused)).extensions[0]?.contributions[0]
    expect(rejected?.specState).toBe('invalid')
    expect(rejected?.activationEligible).toBe(false)
    expect(policy === 'schema validator' ? deny : semantic).toHaveBeenCalledOnce()
  },
)

it('reuses the immutable default registry without mixing custom contract sets into it', () => {
  const defaults = createHostContributionContractRegistry()
  const custom = createHostContributionContractRegistry([registration()])
  expect(Object.isFrozen(defaults)).toBe(true)
  expect(Object.isFrozen(defaults.validationRegistry())).toBe(true)
  expect(defaults.get(coordinate.id, coordinate.major)).toBeUndefined()
  expect(custom.get(coordinate.id, coordinate.major)).toBeDefined()
  expect(createHostContributionContractRegistry()).toBe(defaults)
  expect(createHostContributionContractRegistry([])).toBe(defaults)
  expect(createHostContributionContractRegistry().validationRegistry()).toBe(defaults.validationRegistry())
})

it('shares cached validation across wrappers of the same immutable validation policy', async () => {
  const validate = vi.fn(() => true)
  const registry = createContributionContractRegistry([{ ...registration(), validator: validate }])
  const wrapper = { ...registry, validationRegistry: () => registry.validationRegistry() }
  const input = fixture('shared-validation-projection')
  expect((await buildInventory([input], registry)).extensions[0]?.contributions[0]?.specState).toBe('validated')
  expect((await buildInventory([input], wrapper)).extensions[0]?.contributions[0]?.specState).toBe('validated')
  expect(validate).toHaveBeenCalledOnce()
})
