import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify, contractId } from '@modkitx-x3/core'
import { createContributionContractRegistry } from '@modkitx-x3/sdk'
import {
  buildInventory,
  createHostContributionContractRegistry,
  inventoryHasErrors,
  offersFromInventory,
  type ExtensionInput,
} from '@modkitx-x3/host'
import { SERVICE_PROVIDER_CONTRIBUTION_CONTRACT } from '@modkitx-x3/sdk'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

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

  it('loads a real directory through the node adapter (data-only)', async () => {
    const fixturesDir = fileURLToPath(
      new URL('../../../apps/modkit-cli/test/fixtures', import.meta.url),
    )
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
