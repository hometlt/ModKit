import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { contractId, operationId } from '@modkit/core'
import type { ProviderOffer, RuntimeTarget } from '@modkit/sdk'
import { resolveProvider } from '../src/resolution/resolver.js'
import { createModkit } from '@modkit/host/node'
import { resolveLanguageProvider } from '@modkit/host/language'
import { LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT } from '@modkit/sdk/language'

const SERVICE = contractId('org.example/service')
const worker: RuntimeTarget = {
  environment: 'node-worker',
  operatingSystem: 'windows',
  architecture: 'x64',
}
const host: RuntimeTarget = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' }
const trusted: ProviderOffer = {
  kind: 'primary',
  extensionId: 'org.example/game',
  extensionVersion: '1.0.0',
  providerId: 'org.example/service-provider',
  runtimeVariant: 'trusted-node',
  target: { environments: ['node'] },
  provides: [{ offerId: 'service-v1', contract: SERVICE, major: 1, version: '1.0.0' }],
}
const portable: ProviderOffer = {
  ...trusted,
  runtimeVariant: 'portable',
  target: { environments: ['node-worker'] },
}
const request = { contract: { contract: SERVICE, major: 1 }, target: worker }
const targetFor = (offer: ProviderOffer) =>
  offer.runtimeVariant === 'trusted-node' ? host : worker
const variant = (result: ReturnType<typeof resolveProvider>) =>
  result.state === 'resolved' ? result.selected.offer.runtimeVariant : result.reason

describe('a service checked against where it runs', () => {
  it('prefers the variant running in the requested target over its in-process twin', () => {
    expect(variant(resolveProvider(request, [trusted, portable], { targetFor }))).toBe('portable')
  })
  it('falls back to the in-process variant when it is the only one', () => {
    expect(variant(resolveProvider(request, [trusted], { targetFor }))).toBe('trusted-node')
  })
  it('lets the host prefer an already admissible in-process placement', () => {
    for (const offers of [[trusted, portable], [portable, trusted]]) {
      expect(variant(resolveProvider(request, offers, { targetFor, preferAlternateTarget: true }))).toBe('trusted-node')
    }
  })
  it('keeps a worker fallback when the host offers no admitted alternate placement', () => {
    expect(variant(resolveProvider(request, [trusted, portable], {
      targetFor: () => worker, preferAlternateTarget: true,
    }))).toBe('portable')
    expect(variant(resolveProvider(request, [trusted, portable], { preferAlternateTarget: true }))).toBe('portable')
  })
  it('does not prefer a trusted placement that lacks required permissions', () => {
    const needsWrite = { ...trusted, requiredPermissions: ['write-source' as const] }
    expect(variant(resolveProvider(request, [needsWrite, portable], { targetFor, preferAlternateTarget: true }))).toBe('portable')
  })
  it('preserves explicit runtime pins before placement preference', () => {
    expect(variant(resolveProvider({ ...request, pin: {
      providerId: portable.providerId, runtimeVariant: 'portable',
    } }, [trusted, portable], { targetFor, preferAlternateTarget: true }))).toBe('portable')
  })
  it('does not change operation preference or provider ambiguity', () => {
    const operation = operationId('org.example/service-provider.preferred', {
      contributionId: 'org.example/service-provider',
    })
    expect(variant(resolveProvider({ ...request, operation }, [
      trusted, { ...portable, operations: [operation] },
    ], { targetFor, preferAlternateTarget: true }))).toBe('portable')
    expect(variant(resolveProvider(request, [trusted, { ...trusted, providerId: 'org.example/second' }], {
      targetFor, preferAlternateTarget: true,
    }))).toBe('ambiguous')
  })
  it('without a reroute the in-process variant stays out of a worker target', () => {
    expect(variant(resolveProvider(request, [trusted]))).toBe('target-incompatible')
  })
})

describe('language placement through the public Host and real execution backends', () => {
  it.each([true, false])('keeps the same answer and respects the artifact trust decision %s', async trustedRoot => {
    const root = mkdtempSync(join(tmpdir(), 'x3-language-placement-'))
    mkdirSync(join(root, 'contributions'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'language-placement-fixture', version: '1.0.0', license: 'MIT', type: 'module',
      modkit: { schemaVersion: 1, publisher: 'org.modkitx.test', id: 'language-placement',
        contributionManifests: ['./contributions/language.json'] },
    }))
    writeFileSync(join(root, 'contributions/language.json'), JSON.stringify({
      schemaVersion: 1, contract: { id: 'modkit/service-provider-contribution', major: 1 },
      id: 'org.modkitx.test/language-placement', displayName: 'Language placement fixture',
      runtimeVariants: [
        { variantId: 'trusted-node', entrypoint: './provider.js', target: { environments: ['node'] },
          executionProfile: 'trusted-in-process', requestedPermissionClasses: [] },
        { variantId: 'portable', entrypoint: './provider.js', target: { environments: ['node-worker', 'browser-worker'] },
          executionProfile: 'worker-brokered', requestedPermissionClasses: [] },
      ],
      spec: { lifecycleScope: 'session', provides: [{ offerId: 'language',
        contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT, major: 1, version: '1.0.0', facet: { languageIds: ['fixture'] } }] },
    }))
    writeFileSync(join(root, 'provider.js'), `
      export const abiVersion = 1
      export const provides = ['common.language/document-analysis']
      export function createProvider() {
        return { value: { contract: provides[0], languageIds: ['fixture'],
          analyze: async ({ document }) => ({ documentUri: document.uri, documentVersion: document.version,
            tokens: [], diagnostics: [], symbols: [] }),
          completion: async () => ({ items: [{ label: 'retained-owner', kind: 'value' }], isIncomplete: false }),
        }, release: async () => {} }
      }
    `)
    const modkit = await createModkit({ extensions: [], roots: [root],
      ...(trustedRoot ? { trustedExtensions: [root] } : { userExtensions: [root] }),
    })
    try {
      expect(modkit.extensionFailures).toEqual([])
      const resolution = await resolveLanguageProvider({ services: modkit.services, languageId: 'fixture',
        grant: { id: 'placement-test', classes: [] }, budgets: { maxInputBytes: 1000000n,
          maxDepth: 64, maxNodes: 100000, maxScalarBytes: 1000000, maxDiagnostics: 100 },
      })
      expect(resolution.state, JSON.stringify(resolution.diagnostics)).toBe('resolved')
      if (resolution.state !== 'resolved') throw new Error(JSON.stringify(resolution.diagnostics))
      try {
        expect(resolution.semanticInput.id.endsWith(trustedRoot ? '/trusted-node' : '/portable')).toBe(true)
        const document = { uri: 'file:///fixture.fixture', languageId: 'fixture', version: 1, text: 'owner' }
        expect(await resolution.provider.completion!({ document, workspaceDocuments: [document],
          workspaceIncomplete: false, maxDocuments: 20,
          position: { line: 0, character: 1 }, maxResults: 20 })).toEqual({
          items: [{ label: 'retained-owner', kind: 'value' }], isIncomplete: false,
        })
        expect(resolution.diagnostics.some(item => item.code === 'x3.host/worker-shared-process')).toBe(!trustedRoot)
      } finally { await resolution.release() }
    } finally {
      await modkit.close()
      const parent = `${resolve(tmpdir())}${sep}`
      if (!resolve(root).startsWith(parent) || !basename(root).startsWith('x3-language-placement-')) {
        throw new Error('refusing fixture cleanup outside the temporary placement root')
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
