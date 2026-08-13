import { describe, expect, it } from 'vitest'
import { isModkitError } from '@modkitx-x3/core'
import {
  assertNotWider,
  narrowGrant,
  type ContributionManifestV1,
  type PermissionGrant,
  type ProviderOffer,
  type ProviderRequest,
  type RuntimeTarget,
} from '@modkitx-x3/sdk'
import {
  activateContribution,
  resolveForActivation,
  resolveProvider,
  type ActivationTicket,
} from '@modkitx-x3/host'
// White-box import: the free issuer is deliberately NOT part of the package surface, so
// the provenance test reaches it through the module it lives in.
import { issueActivationTicket } from '../src/security/gate.js'

/**
 * Security negative suite (R4, post-audit): every path that must NOT reach an import.
 * `globalThis.__x3SpyImports` is bumped by the fixture entry point, so each case proves
 * the refusal happened before the module was loaded — not merely that an error was thrown.
 */

const baseUrl = new URL('./fixtures/gate-extension/', import.meta.url)
const EXTENSION_ID = 'org.x3lab/gate-fixture'
const target: RuntimeTarget = {
  environment: 'node',
  operatingSystem: 'windows',
  architecture: 'x64',
}

declare global {
  var __x3SpyImports: number | undefined
  var __x3Pwned: boolean | undefined
}

function manifest(overrides: Partial<ContributionManifestV1> = {}): ContributionManifestV1 {
  return {
    schemaVersion: 1,
    contract: { id: 'x3.demo/greeter', major: 1 },
    id: 'org.x3lab/spy-greeter',
    displayName: 'Spy greeter',
    runtimeVariants: [
      {
        variantId: 'portable',
        entrypoint: './entry/spy-greeter.mjs',
        target: { environments: ['node'] },
        executionProfile: 'trusted-in-process',
        requestedPermissionClasses: ['read-source'],
      },
    ],
    spec: { greeting: 'Privet' },
    ...overrides,
  }
}

function offerFor(m: ContributionManifestV1): ProviderOffer {
  const variant = m.runtimeVariants?.[0]
  if (!variant) throw new Error('fixture needs a variant')
  return {
    kind: 'primary',
    extensionId: EXTENSION_ID,
    extensionVersion: '1.0.0',
    providerId: m.id,
    runtimeVariant: variant.variantId,
    target: variant.target,
    requiredPermissions: variant.requestedPermissionClasses,
    provides: [{ contract: m.contract.id, version: `${m.contract.major}.0.0` }],
  }
}

function ticketFor(m: ContributionManifestV1, requestTarget: RuntimeTarget = target) {
  const request: ProviderRequest = {
    contract: { contract: m.contract.id, major: m.contract.major },
    target: { ...requestTarget, grantedPermissions: ['read-source'] },
  }
  const { ticket } = resolveForActivation(request, [offerFor(m)])
  if (!ticket) throw new Error('fixture resolution produced no ticket')
  return ticket
}

const fullGrant: PermissionGrant = { id: 'g-full', classes: ['read-source'] }

async function expectRefusedWithoutImport(
  run: () => Promise<unknown>,
  code: string,
  label: string,
): Promise<void> {
  const before = globalThis.__x3SpyImports ?? 0
  await expect(run(), label).rejects.toSatisfy(e => isModkitError(e) && e.code === code)
  expect(globalThis.__x3SpyImports ?? 0, `${label}: entry point must not be imported`).toBe(before)
}

describe('activation gate — refusals never reach an import (MK3/24 §8)', () => {
  it('refuses a forged ticket (no resolver behind it)', async () => {
    const forged = {
      extensionId: EXTENSION_ID,
      contributionId: 'org.x3lab/spy-greeter',
      contract: 'x3.demo/greeter',
      contractMajor: 1,
      variantId: 'portable',
      target,
    } as unknown as ActivationTicket
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket: forged,
          manifest: manifest(),
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: fullGrant,
        }),
      'x3.host/invalid-ticket',
      'forged ticket',
    )
  })

  it('refuses to issue a ticket from a fabricated resolution result (provenance)', () => {
    // The exact laundering the second audit demonstrated: an object of the right *shape*
    // handed to the issuer used to come back as a genuine ticket.
    const fabricated = {
      state: 'resolved',
      selected: {
        offer: offerFor(manifest()),
        resolvedContract: { contract: 'x3.demo/greeter', version: '1.0.0' },
      },
      alternatives: [],
      rejected: [],
    } as unknown as ReturnType<typeof resolveProvider>
    expect(() => issueActivationTicket(fabricated, target)).toThrow(
      /not produced by the host resolver/,
    )
  })

  it('refuses a structural copy of a real ticket, and real tickets are frozen', async () => {
    const real = ticketFor(manifest())
    // A spread copy carries every property (including symbols) but is a different object,
    // so WeakSet membership — the actual check — fails.
    const copy = { ...real, variantId: 'portable' } as ActivationTicket
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket: copy,
          manifest: manifest(),
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: fullGrant,
        }),
      'x3.host/invalid-ticket',
      'spread-copied ticket',
    )
    // …and the issued ticket cannot be edited after the fact (module code is strict mode).
    expect(() => {
      ;(real as { variantId: string }).variantId = 'other'
    }).toThrow(TypeError)
    expect(real.variantId).toBe('portable')
  })

  it('refuses to issue a ticket for an unresolved result', () => {
    const unresolved = resolveProvider(
      { contract: { contract: 'x3.demo/greeter', major: 9 }, target },
      [offerFor(manifest())],
    )
    expect(() => issueActivationTicket(unresolved, target)).toThrow()
  })

  it('refuses a manifest swapped after resolution', async () => {
    const ticket = ticketFor(manifest())
    const swapped = manifest({ id: 'org.evil/other' })
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket,
          manifest: swapped,
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: fullGrant,
        }),
      'x3.host/ticket-manifest-mismatch',
      'swapped manifest',
    )
  })

  it('refuses a foreign extension claiming the same contribution', async () => {
    const ticket = ticketFor(manifest())
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket,
          manifest: manifest(),
          extensionId: 'org.evil/impostor',
          baseUrl,
          grant: fullGrant,
        }),
      'x3.host/ticket-manifest-mismatch',
      'foreign extension',
    )
  })

  it.each([
    [
      'data: URL',
      'data:text/javascript,globalThis.__x3Pwned=true;export const createGreeter=()=>({})',
    ],
    ['http URL', 'http://127.0.0.1:1/evil.js'],
    ['file URL', 'file:///c:/windows/system32/evil.mjs'],
    ['absolute posix path', '/etc/passwd.mjs'],
    ['absolute windows path', 'C:/Windows/evil.mjs'],
    ['parent traversal', '../../outside.mjs'],
    ['nested traversal', 'entry/../../outside.mjs'],
    ['backslash path', 'entry\\spy-greeter.mjs'],
  ])('refuses a %s entry point', async (label, entrypoint) => {
    const m = manifest({
      runtimeVariants: [
        {
          variantId: 'portable',
          entrypoint,
          target: { environments: ['node'] },
          executionProfile: 'trusted-in-process',
          requestedPermissionClasses: ['read-source'],
        },
      ],
    })
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket: ticketFor(m),
          manifest: m,
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: fullGrant,
        }),
      'x3.host/entrypoint-not-contained',
      label,
    )
    expect(globalThis.__x3Pwned, 'no side effect from a rejected entry point').toBeUndefined()
  })

  it('refuses a variant whose target does not match the ticket target', async () => {
    const m = manifest({
      runtimeVariants: [
        {
          variantId: 'portable',
          entrypoint: './entry/spy-greeter.mjs',
          target: { environments: ['node'], operatingSystems: ['linux'], architectures: ['arm64'] },
          executionProfile: 'trusted-in-process',
          requestedPermissionClasses: ['read-source'],
        },
      ],
    })
    // A ticket issued for THIS machine (windows/x64) against a permissive variant…
    const localTicket = ticketFor(manifest())
    // …then activation is attempted with a manifest whose same-named variant actually
    // demands linux/arm64. The gate re-checks the target instead of trusting that the
    // resolution stage saw the same variant.
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket: localTicket,
          manifest: m,
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: fullGrant,
        }),
      'x3.host/target-incompatible',
      'foreign target',
    )
  })

  it.each([
    ['malformed expiry', 'not-a-date'],
    ['past expiry', '2000-01-01T00:00:00Z'],
  ])('refuses a grant with %s (fail-closed)', async (label, expiresAt) => {
    const m = manifest()
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket: ticketFor(m),
          manifest: m,
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: { id: 'g-dead', classes: ['read-source'], expiresAt },
        }),
      'x3.host/grant-not-live',
      label,
    )
  })

  it('refuses when the grant does not cover a declared class', async () => {
    const m = manifest()
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket: ticketFor(m),
          manifest: m,
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: { id: 'g-empty', classes: [] },
        }),
      'x3.host/permission-denied',
      'ungranted class',
    )
  })

  it('refuses when host policy narrows the class away, even with a wide grant', async () => {
    const m = manifest()
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket: ticketFor(m),
          manifest: m,
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: { id: 'g-wide', classes: ['read-source', 'network'] },
          policy: { allowedClasses: ['network'] },
        }),
      'x3.host/permission-denied',
      'policy ceiling',
    )
  })

  it('refuses an execution profile this host cannot honour (no silent downgrade)', async () => {
    const m = manifest({
      runtimeVariants: [
        {
          variantId: 'portable',
          entrypoint: './entry/spy-greeter.mjs',
          target: { environments: ['node'] },
          executionProfile: 'wasm-brokered',
          requestedPermissionClasses: ['read-source'],
        },
      ],
    })
    await expectRefusedWithoutImport(
      () =>
        activateContribution({
          ticket: ticketFor(m),
          manifest: m,
          extensionId: EXTENSION_ID,
          baseUrl,
          grant: fullGrant,
        }),
      'x3.host/unsupported-execution-profile',
      'unsupported profile',
    )
  })
})

describe('activation gate — the granted path', () => {
  it('imports and executes once, under a narrowed grant and an honest diagnostic', async () => {
    // ESM caches by URL, so a successful import registers once per process; this is the
    // only test in the file that is expected to reach the import at all.
    const before = globalThis.__x3SpyImports ?? 0
    const m = manifest()
    const activation = await activateContribution({
      ticket: ticketFor(m),
      manifest: m,
      extensionId: EXTENSION_ID,
      baseUrl,
      grant: { id: 'g-session', classes: ['read-source', 'network'] },
    })
    expect(globalThis.__x3SpyImports ?? 0).toBe(before + 1)

    const factory = activation.module['createGreeter'] as (spec: unknown) => {
      greet(name: string): string
    }
    expect(factory({ greeting: 'Privet' }).greet('MK3')).toBe('Privet, MK3!')

    // narrowed to what the variant actually asked for — never the session's full set
    expect(activation.effectiveGrant.classes).toEqual(['read-source'])
    expect(activation.effectiveGrant.parentGrant).toBe('g-session')
    expect(
      activation.diagnostics.some(d => d.code === 'x3.host/full-process-authority'),
      'trusted-in-process must admit it is not a sandbox',
    ).toBe(true)
  })
})

describe('grant narrowing (MK3/24 §4)', () => {
  const parent: PermissionGrant = {
    id: 'parent',
    classes: ['read-source', 'network', 'filesystem-read'],
    sourceScope: ['src://a', 'src://b'],
    filesystem: [
      { root: 'src://a', access: 'read', recursive: true },
      { root: 'src://b', access: 'read-write', recursive: false },
    ],
    network: [{ origins: ['https://a.example', 'https://b.example'] }],
  }

  it('intersects parent ∩ request ∩ policy ∩ operation and never widens', () => {
    const { child, missing } = narrowGrant(parent, {
      childId: 'child',
      requestedClasses: ['read-source', 'network', 'process-launch'],
      requestedSourceRoots: ['src://a'],
      requestedOrigins: ['https://a.example'],
      operation: 'demo.greet',
      policy: {
        allowedClasses: ['read-source', 'network'],
        operationClasses: { 'demo.greet': ['read-source'] },
      },
    })
    expect(child.classes).toEqual(['read-source'])
    expect(missing).toEqual(['network', 'process-launch'])
    expect(child.sourceScope).toEqual(['src://a'])
    expect(child.filesystem?.map(s => s.root)).toEqual(['src://a'])
    expect(child.network?.[0]?.origins).toEqual(['https://a.example'])
    expect(child.parentGrant).toBe('parent')
    expect(() => assertNotWider(parent, child)).not.toThrow()
  })

  it('a dead parent produces an empty child, not an inherited one', () => {
    const dead: PermissionGrant = { ...parent, expiresAt: 'nonsense' }
    const { child, missing } = narrowGrant(dead, {
      childId: 'child',
      requestedClasses: ['read-source'],
    })
    expect(child.classes).toEqual([])
    expect(missing).toEqual(['read-source'])
  })

  it('assertNotWider catches a hand-built child that adds a class', () => {
    expect(() =>
      assertNotWider(parent, { id: 'evil', classes: ['process-launch'], parentGrant: 'parent' }),
    ).toThrow()
  })
})
