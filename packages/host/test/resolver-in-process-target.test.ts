import { describe, expect, it } from 'vitest'
import { contractId } from '@modkit/core'
import type { ProviderOffer, RuntimeTarget } from '@modkit/sdk'
import { resolveProvider } from '../src/resolution/resolver.js'

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
  it('without a reroute the in-process variant stays out of a worker target', () => {
    expect(variant(resolveProvider(request, [trusted]))).toBe('target-incompatible')
  })
})
