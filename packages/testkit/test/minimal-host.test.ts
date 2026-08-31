import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contractId, isModkitError, traitId } from '@modkit/core'
import type { ProviderRequest } from '@modkit/sdk'
import { asGreeterModule, greeterSpecEntry, runMinimalHost } from '@modkit/testkit'

const exampleDir = fileURLToPath(
  new URL('../../../examples/modkit-extension-greeter', import.meta.url),
)

const request: ProviderRequest = {
  contract: { contract: contractId('x3.demo/greeter'), major: 1 },
  target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
  preferredOutputs: [{ id: traitId('demo.fancy'), definitionRange: '^1.0' }],
}

describe('testkit minimal host — the one public route (S4)', () => {
  it('load → inventory → resolve → grant → import → execute, deterministically', async () => {
    const run = await runMinimalHost({
      extensionDirs: [exampleDir],
      extensionExecution: { origin: 'installed', allowTrustedInProcess: true },
      contributionContracts: [greeterSpecEntry],
      request,
      grant: { id: 'test-grant', classes: ['read-source'] },
    })
    expect(run.result.state).toBe('resolved')
    if (run.result.state === 'resolved') {
      expect(run.result.selected.offer.providerId).toBe('org.example/x3-greeter-fancy')
      expect(run.result.alternatives.map(a => a.offer.providerId)).toEqual([
        'org.example/x3-greeter-plain',
      ])
    }
    const spec = run.inventory.extensions[0]?.contributions.find(
      c => c.manifest?.id === 'org.example/x3-greeter-fancy',
    )?.manifest?.spec
    const greeter = asGreeterModule(run.activation.module).createGreeter(spec)
    expect(greeter.greet('MK3')).toBe('Salute, MK3!')

    const again = await runMinimalHost({
      extensionDirs: [exampleDir],
      extensionExecution: { origin: 'installed', allowTrustedInProcess: true },
      contributionContracts: [greeterSpecEntry],
      request,
      grant: { id: 'test-grant', classes: ['read-source'] },
    })
    expect(again.lockText).toBe(run.lockText) // canonical lock is byte-stable
  })

  it('deny-by-default: an ungranted pinned provider is refused at resolution', async () => {
    await expect(
      runMinimalHost({
        extensionDirs: [exampleDir],
        extensionExecution: { origin: 'installed', allowTrustedInProcess: true },
        contributionContracts: [greeterSpecEntry],
        request: { ...request, pin: { providerId: 'org.example/x3-greeter-fancy' } },
        grant: { id: 'deny', classes: [] }, // fancy requests read-source → not granted
      }),
    ).rejects.toSatisfy(e => {
      if (!isModkitError(e) || e.code !== 'x3.testkit/unresolved') return false
      // 23 §9 stage order: permissions (stage 4) reject the pinned provider before the
      // pin stage runs, so the aggregate reason is pin-unsatisfied while the rejected
      // list carries the structured permission-required diagnostic for the pinned one.
      const rejected = (e.context as { rejected?: { providerId: string; reason: string }[] })
        .rejected
      return (
        rejected?.some(
          r =>
            r.providerId === 'org.example/x3-greeter-fancy' && r.reason === 'permission-required',
        ) === true
      )
    })
  })

  it('without a pin, an empty grant deterministically falls to the permissionless provider', async () => {
    const run = await runMinimalHost({
      extensionDirs: [exampleDir],
      extensionExecution: { origin: 'installed', allowTrustedInProcess: true },
      contributionContracts: [greeterSpecEntry],
      request,
      grant: { id: 'deny', classes: [] },
    })
    expect(run.result.state).toBe('resolved')
    if (run.result.state === 'resolved') {
      expect(run.result.selected.offer.providerId).toBe('org.example/x3-greeter-plain')
      expect(run.result.rejected).toContainEqual(
        expect.objectContaining({
          providerId: 'org.example/x3-greeter-fancy',
          reason: 'permission-required',
        }),
      )
    }
  })
})
