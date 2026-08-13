import { describe, expect, it } from 'vitest'
import { isModkitError } from '@modkitx-x3/core'
import type { ContributionManifestV1 } from '@modkitx-x3/sdk'
import { activateContribution, checkGrant } from '@modkitx-x3/host'

const baseUrl = new URL('./fixtures/gate-extension/', import.meta.url)

function manifest(profile = 'trusted-in-process'): ContributionManifestV1 {
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
        executionProfile: profile as never,
        requestedPermissionClasses: ['read-source'],
      },
    ],
    spec: { greeting: 'Prived' },
  }
}

declare global {
  var __x3SpyImports: number | undefined
}

describe('deny-by-default gate before entry-point import (S3.3/S3.4)', () => {
  it('denied grant: structured refusal and the entry point is NEVER imported', async () => {
    const before = globalThis.__x3SpyImports ?? 0
    await expect(
      activateContribution({
        manifest: manifest(),
        variantId: 'portable',
        baseUrl,
        grant: { id: 'g-empty', classes: [] }, // deny-by-default: nothing granted
      }),
    ).rejects.toSatisfy(e => isModkitError(e) && e.code === 'x3.host/permission-denied')
    expect(globalThis.__x3SpyImports ?? 0).toBe(before) // spy proof: not even imported
  })

  it('unsupported execution profile refuses without downgrade (24 §6.1 rule 1)', async () => {
    const before = globalThis.__x3SpyImports ?? 0
    await expect(
      activateContribution({
        manifest: manifest('wasm-brokered'),
        variantId: 'portable',
        baseUrl,
        grant: { id: 'g-full', classes: ['read-source'] },
      }),
    ).rejects.toSatisfy(e => isModkitError(e) && e.code === 'x3.host/unsupported-execution-profile')
    expect(globalThis.__x3SpyImports ?? 0).toBe(before)
  })

  it('granted: imports the entry point and the contribution executes', async () => {
    const before = globalThis.__x3SpyImports ?? 0
    const activation = await activateContribution({
      manifest: manifest(),
      variantId: 'portable',
      baseUrl,
      grant: { id: 'g-full', classes: ['read-source'] },
    })
    expect(globalThis.__x3SpyImports ?? 0).toBe(before + 1)
    const factory = activation.module['createGreeter'] as (spec: unknown) => {
      greet(name: string): string
    }
    const greeter = factory({ greeting: 'Privet' })
    expect(greeter.greet('MK3')).toBe('Privet, MK3!')
  })

  it('checkGrant reports missing classes and expiry', () => {
    expect(checkGrant(['network'], { id: 'g', classes: [] })).toEqual(['network'])
    expect(checkGrant(['network'], { id: 'g', classes: ['network'] })).toEqual([])
    expect(
      checkGrant(['network'], {
        id: 'g',
        classes: ['network'],
        expiresAt: '2000-01-01T00:00:00Z',
      }),
    ).toEqual(['network'])
  })
})
