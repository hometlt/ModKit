import { describe, expect, it } from 'vitest'
import { LOCALIZATION_CONTRIBUTION_CONTRACT, LOCALIZATION_CONTRIBUTION_FACT } from '@modkit/sdk'
import { createHostContributionContractRegistry } from '@modkit/host'

describe('host contribution registry', () => {
  it('ships the localization contribution as an inert data-only contract', () => {
    const registration = createHostContributionContractRegistry().get(
      LOCALIZATION_CONTRIBUTION_CONTRACT,
      1,
    )
    expect(registration?.mode).toBe('data-only')
    expect(registration?.conformanceProfile).toBe('modkit/localization-contribution-v1')
    if (registration === undefined) throw new Error('localization registration is missing')
    const projected = registration.project(
      {
        schemaVersion: 1,
        contract: { id: LOCALIZATION_CONTRIBUTION_CONTRACT, major: 1 },
        id: 'org.example/localization' as never,
        displayName: 'Example localization',
        spec: {
          catalogs: [
            {
              locale: 'en',
              path: 'localization/messages.en.json',
              messagePrefixes: ['org-example.'],
            },
          ],
        },
      },
      {
        ownerExtensionId: 'org.example/localization-pack' as never,
        extensionVersion: '1.0.0',
        inventoryRecordId: 'fixture:localization',
        manifestDigest: 'sha256:manifest',
        artifactDigest: 'sha256:artifact',
        artifactRoot: 'file:///fixture/localization/',
        manifestPath: 'contributions/localization.json',
      },
    )
    expect(projected[0]?.contract).toEqual({ id: LOCALIZATION_CONTRIBUTION_FACT, major: 1 })
  })
})
