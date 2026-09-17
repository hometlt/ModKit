import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify, contractId } from '@modkit/core'
import { createContributionContractRegistry } from '@modkit/sdk'
import {
  buildInventory,
  CONTRIBUTION_DISABLED_CODE,
  createHostContributionContractRegistry,
  describeInventoryContributions,
  EXTENSION_DISABLED_CODE,
  inventoryHasErrors,
  offersFromInventory,
  type ExtensionInput,
} from '@modkit/host'
import { SERVICE_PROVIDER_CONTRIBUTION_CONTRACT } from '@modkit/sdk'
import { loadExtensionDirectory } from '@modkit/host/node'

const registry = createContributionContractRegistry([
  {
    contract: { id: contractId('x3.demo/greeter'), major: 1 },
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { greeting: { type: 'string', minLength: 1 } },
    },
    validator: value =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).every(key => key === 'greeting') &&
      ((value as { readonly greeting?: unknown }).greeting === undefined ||
        (typeof (value as { readonly greeting?: unknown }).greeting === 'string' &&
          (value as { readonly greeting: string }).greeting.length > 0)),
    mode: 'executable',
    project: () => [],
    validateSemantics: () => [],
    moduleAbi: { export: 'createGreeter', abiVersion: 1 },
    conformanceProfile: 'x3.demo/greeter-v1',
  },
])

function contribution(id: string, spec: unknown = { greeting: 'hi' }) {
  return {
    schemaVersion: 1,
    contract: { id: 'x3.demo/greeter', major: 1 },
    id,
    displayName: id,
    runtimeVariants: [
      {
        variantId: 'portable',
        entrypoint: './dist/provider.js',
        target: { environments: ['node'] },
        executionProfile: 'trusted-in-process',
        requestedPermissionClasses: [],
      },
    ],
    spec,
  }
}

function input(
  source: string,
  publisher: string,
  id: string,
  contributions: Record<string, unknown>,
): ExtensionInput {
  const paths = Object.keys(contributions)
  return {
    source,
    containers: {
      standalone: {
        schemaVersion: 1,
        publisher,
        id,
        version: '1.0.0',
        license: 'MIT',
        contributionManifests: ['./contributions/*.json'],
      },
    },
    files: paths,
    documents: new Map(Object.entries(contributions)),
    documentDigests: new Map(paths.map(path => [path, `sha256:${source}:${path}`])),
    artifact: {
      inventoryRecordId: `artifact:${source}`,
      artifactDigest: `sha256:${source}`,
      artifactRoot: new URL(`file:///inventory/${source}/`),
      verifyArtifactDigest: expected => expected === `sha256:${source}`,
    },
  }
}

describe('buildInventory (S1 acceptance)', () => {
  it('is deterministic under shuffled input and listing order (byte-identical)', async () => {
    const a = input('dir-a', 'org.zeta', 'pack', {
      'contributions/b.json': contribution('org.zeta/b'),
      'contributions/a.json': contribution('org.zeta/a'),
    })
    const b = input('dir-b', 'org.alpha', 'pack', {
      'contributions/x.json': contribution('org.alpha/x'),
    })
    const forward = await buildInventory([a, b], registry)
    const shuffledFiles: ExtensionInput = { ...a, files: [...a.files].reverse() }
    const reversed = await buildInventory([b, shuffledFiles], registry)
    expect(canonicalJsonStringify(reversed)).toBe(canonicalJsonStringify(forward))
    expect(forward.extensions.map(e => e.manifest.publisher)).toEqual(['org.alpha', 'org.zeta'])
    expect(forward.extensions[1]?.contributions.map(c => c.path)).toEqual([
      'contributions/a.json',
      'contributions/b.json',
    ])
    expect(inventoryHasErrors(forward)).toBe(false)
  })

  /*
   * Repeated composition is the common case — the host realm, the worker realm, every container a
   * window opens — and validating each manifest again was most of what that cost. The cache is
   * keyed by the document's own text, so what has to hold is that identical documents reuse the
   * answer and different ones never do, however they are labelled.
   */
  it('reuses validation for an identical manifest and never across different ones', async () => {
    const first = input('dir-cache-1', 'org.cache', 'one', {
      'contributions/a.json': contribution('org.cache/a', { greeting: 'hello' }),
    })
    const again = await buildInventory([first], registry)
    const repeated = await buildInventory([first], registry)
    expect(canonicalJsonStringify(repeated)).toBe(canonicalJsonStringify(again))

    // Same path, same declared digest, different document: the answer must follow the document.
    const relabelled: ExtensionInput = {
      ...first,
      documents: new Map([
        ['contributions/a.json', contribution('org.cache/a', { greeting: 'different' })],
      ]),
    }
    const changed = await buildInventory([relabelled], registry)
    expect(changed.extensions[0]?.contributions[0]?.manifest?.spec).toEqual({
      greeting: 'different',
    })
    // And an invalid spec is still refused, even behind a digest that once validated.
    const broken: ExtensionInput = {
      ...first,
      documents: new Map([
        ['contributions/a.json', contribution('org.cache/a', { greeting: 'hi', extra: true })],
      ]),
    }
    const refused = await buildInventory([broken], registry)
    expect(refused.extensions[0]?.contributions[0]?.specState).toBe('invalid')
  })

  it('keeps unknown contributions inspectable but never activatable', async () => {
    const unknown = input('dir-u', 'org.u', 'pack', {
      'contributions/mystery.json': {
        schemaVersion: 1,
        contract: { id: 'x3.unknown/thing', major: 3 },
        id: 'org.u/mystery',
        displayName: 'Mystery',
        spec: { anything: true },
      },
    })
    const inventory = await buildInventory([unknown], registry)
    const entry = inventory.extensions[0]?.contributions[0]
    expect(entry?.specState).toBe('unknown-contract')
    expect(entry?.activationEligible).toBe(false)
    expect(entry?.manifest?.spec).toEqual({ anything: true }) // inspectable data preserved
    expect(inventoryHasErrors(inventory)).toBe(false) // unknown is a warning, not an error
  })

  it('flags duplicate extension coordinates and duplicate contribution ids', async () => {
    const one = input('dir-1', 'org.dup', 'pack', {
      'contributions/a.json': contribution('org.dup/same'),
    })
    const two = input('dir-2', 'org.dup', 'pack', {
      'contributions/b.json': contribution('org.dup/same'),
    })
    const inventory = await buildInventory([one, two], registry)
    expect(
      inventory.diagnostics.some(d => d.code === 'x3.host/duplicate-extension-coordinate'),
    ).toBe(true)
    expect(inventory.diagnostics.some(d => d.code === 'x3.host/duplicate-contribution-id')).toBe(
      true,
    )
  })

  it('never globs beyond the declared patterns: undeclared files stay out', async () => {
    const sneaky = input('dir-s', 'org.s', 'pack', {
      'contributions/a.json': contribution('org.s/a'),
      'codecs/hidden.json': contribution('org.s/hidden'),
    })
    const inventory = await buildInventory([sneaky], registry)
    expect(inventory.extensions[0]?.contributions.map(c => c.path)).toEqual([
      'contributions/a.json',
    ])
  })

  it('keeps every contribution of a disabled extension visible but ineligible for activation', async () => {
    const extension = input('dir-off', 'org.off', 'pack', {
      'contributions/a.json': contribution('org.off/a'),
      'contributions/b.json': contribution('org.off/b'),
    })
    const inventory = await buildInventory([extension], registry, {
      disabledExtensions: ['org.off/pack'],
    })
    const contributions = inventory.extensions[0]?.contributions ?? []
    expect(contributions).toHaveLength(2)
    expect(contributions.every(item => !item.activationEligible)).toBe(true)
    expect(
      contributions.every(item =>
        item.diagnostics.some(diagnostic => diagnostic.code === EXTENSION_DISABLED_CODE),
      ),
    ).toBe(true)
  })

  it('preserves an individual contribution switch while its owning extension is disabled', async () => {
    const extension = input('dir-layered-off', 'org.layered', 'pack', {
      'contributions/a.json': contribution('org.layered/a'),
      'contributions/b.json': contribution('org.layered/b'),
    })
    const disabledContributions = ['org.layered/a']
    const whileExtensionIsOff = await buildInventory([extension], registry, {
      disabledExtensions: ['org.layered/pack'],
      disabledContributions,
    })
    expect(describeInventoryContributions(whileExtensionIsOff)).toEqual([
      expect.objectContaining({
        id: 'org.layered/a',
        activationEligible: false,
        disabled: true,
        extensionDisabled: true,
      }),
      expect.objectContaining({
        id: 'org.layered/b',
        activationEligible: false,
        disabled: false,
        extensionDisabled: true,
      }),
    ])
    const contributionA = whileExtensionIsOff.extensions[0]?.contributions[0]
    expect(contributionA?.diagnostics.map(item => item.code)).toEqual(
      expect.arrayContaining([EXTENSION_DISABLED_CODE, CONTRIBUTION_DISABLED_CODE]),
    )

    const afterExtensionIsEnabled = await buildInventory([extension], registry, {
      disabledContributions,
    })
    expect(describeInventoryContributions(afterExtensionIsEnabled)).toEqual([
      expect.objectContaining({
        id: 'org.layered/a',
        activationEligible: false,
        disabled: true,
        extensionDisabled: false,
      }),
      expect.objectContaining({
        id: 'org.layered/b',
        activationEligible: true,
        disabled: false,
        extensionDisabled: false,
      }),
    ])
  })

  it('matches legacy ModkitX disabled settings against canonical inventory identities', async () => {
    const extension = input('dir-legacy-off', 'org.modkitx', 'images', {
      'contributions/png.json': contribution('org.modkitx/image-png'),
    })
    const inventory = await buildInventory([extension], registry, {
      disabledExtensions: ['org.modkitx/images'],
      disabledContributions: ['org.modkitx/image-png'],
    })

    expect(inventory.extensions[0]?.manifest).toMatchObject({ publisher: 'modkit', id: 'images' })
    expect(describeInventoryContributions(inventory)).toEqual([
      expect.objectContaining({
        id: 'modkit/image-png',
        activationEligible: false,
        disabled: true,
        extensionDisabled: true,
      }),
    ])
  })

  it('loads a real directory through the node adapter (data-only)', async () => {
    const fixturesDir = fileURLToPath(new URL('../../../apps/cli/test/fixtures', import.meta.url))
    const loaded = await loadExtensionDirectory(join(fixturesDir, 'valid-extension'))
    const inventory = await buildInventory([loaded], registry)
    expect(inventory.extensions).toHaveLength(1)
    const ext = inventory.extensions[0]
    expect(ext?.manifest.id).toBe('greeter')
    expect(ext?.manifest.version).toBe('1.2.0')
    expect(ext?.contributions[0]?.path).toBe('contributions/greeter.json')
  })

  it('projects logical offers from service spec.provides, not the envelope contract', async () => {
    const service = input('dir-service', 'org.service', 'pack', {
      'contributions/provider.json': {
        schemaVersion: 1,
        contract: { id: SERVICE_PROVIDER_CONTRIBUTION_CONTRACT, major: 1 },
        id: 'org.service/provider',
        displayName: 'Service provider',
        runtimeVariants: [
          {
            variantId: 'portable',
            entrypoint: './dist/provider.js',
            target: { environments: ['node'] },
            executionProfile: 'trusted-in-process',
            requestedPermissionClasses: [],
          },
        ],
        spec: {
          provides: [
            {
              offerId: 'jsonc',
              contract: 'x3.demo/greeter',
              major: 1,
              version: '1.4.0',
              facet: { dialect: 'jsonc' },
            },
          ],
          lifecycleScope: 'session',
        },
      },
    })
    const inventory = await buildInventory([service], createHostContributionContractRegistry())
    const offers = offersFromInventory(inventory)
    expect(offers).toHaveLength(1)
    expect(offers[0]?.provides).toEqual([
      {
        offerId: 'jsonc',
        contract: 'x3.demo/greeter',
        major: 1,
        version: '1.4.0',
        facet: { dialect: 'jsonc' },
      },
    ])
    expect(offers[0]?.provides[0]?.contract).not.toBe(SERVICE_PROVIDER_CONTRIBUTION_CONTRACT)
  })
})
