import { describe, expect, it } from 'vitest'
import { hasErrors } from '@modkit/core'
import {
  expandContributionManifests,
  normalizeExtensionManifest,
  validateWithSchema,
  extensionManifestSchema,
} from '@modkit/sdk'

// Provenance fixture (PORTED.md): converted from modkit
// extensions/images/extension.json@8a21060f — legacy `contributes.codecs` list and
// display metadata dropped; discovery becomes an explicit contributionManifests pattern.
const convertedImagesPackageJson = {
  name: '@modkit-fixture/images',
  version: '0.1.0',
  license: 'MIT',
  modkit: {
    schemaVersion: 1,
    publisher: 'modkit',
    id: 'images',
    contributionManifests: ['./contributions/*.json'],
  },
}

const standaloneManifest = {
  schemaVersion: 1,
  publisher: 'org.example',
  id: 'homeworld',
  version: '1.0.0',
  license: 'MIT',
  contributionManifests: ['./contributions/*.json'],
}

const presentation = {
  displayName: 'Homeworld tools',
  description: 'Formats and workflows for Homeworld modding.',
  vendor: { id: 'blackbird.interactive', displayName: 'Blackbird Interactive' },
  games: [{ id: 'blackbird.interactive/homeworld-3', displayName: 'Homeworld 3' }],
  icon: { path: 'assets/homeworld.png', mediaType: 'image/png' },
  source: { kind: 'url', url: 'https://example.invalid/homeworld-tools' },
  licenseFiles: [{ path: './licenses/MIT.txt', displayName: 'MIT License' }],
} as const

describe('normalizeExtensionManifest (canon §5.13, 27 §0.2, Q75/Q76)', () => {
  it('normalizes the npm container, inheriting version/license from package.json', async () => {
    const result = await normalizeExtensionManifest({ packageJson: convertedImagesPackageJson })
    expect(hasErrors([...result.diagnostics])).toBe(false)
    expect(result.container).toBe('package-json')
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      publisher: 'modkit',
      id: 'images',
      version: '0.1.0',
      license: 'MIT',
      contributionManifests: ['./contributions/*.json'],
    })
  })

  it('normalizes the standalone container to the identical contract', async () => {
    const result = await normalizeExtensionManifest({ standalone: standaloneManifest })
    expect(hasErrors([...result.diagnostics])).toBe(false)
    expect(result.container).toBe('standalone')
    expect(result.manifest).toEqual(standaloneManifest)
  })

  it('preserves data-only presentation metadata in both authored containers', async () => {
    const standalone = await normalizeExtensionManifest({
      standalone: { ...standaloneManifest, presentation },
    })
    expect(hasErrors([...standalone.diagnostics])).toBe(false)
    expect(standalone.manifest?.presentation).toEqual(presentation)

    const packageJson = {
      ...convertedImagesPackageJson,
      modkit: { ...convertedImagesPackageJson.modkit, presentation },
    }
    const npm = await normalizeExtensionManifest({ packageJson })
    expect(hasErrors([...npm.diagnostics])).toBe(false)
    expect(npm.manifest?.presentation).toEqual(presentation)
    expect(JSON.parse(JSON.stringify(npm.manifest?.presentation))).toEqual(presentation)
  })

  it('canonicalizes pre-rename ModkitX extension identities and dependencies', async () => {
    const result = await normalizeExtensionManifest({
      packageJson: {
        name: '@modkit-fixture/legacy-blizzard',
        version: '0.1.0',
        license: 'MIT',
        modkit: {
          schemaVersion: 1,
          publisher: 'org.modkitx.blizzard',
          id: 'starcraft-2',
          presentation: {
            games: [
              { id: 'org.modkitx/starcraft-2', displayName: 'StarCraft II' },
              { id: 'org.modkitx/warzone-2100', displayName: 'Warzone 2100' },
            ],
          },
          contributionManifests: ['./contributions/*.json'],
          dependsOn: [
            {
              extension: 'org.modkitx/images',
              range: '^1.0',
              mode: 'required',
              scope: { kind: 'contribution', id: 'org.modkitx/image-png' },
            },
          ],
        },
      },
    })

    expect(hasErrors([...result.diagnostics])).toBe(false)
    expect(result.manifest).toMatchObject({
      publisher: 'blizzard',
      id: 'starcraft-2',
      presentation: {
        games: [
          { id: 'blizzard/starcraft-2', displayName: 'StarCraft II' },
          { id: 'wz2100project/warzone-2100', displayName: 'Warzone 2100' },
        ],
      },
      dependsOn: [expect.objectContaining({ extension: 'modkit/images' })],
    })
  })

  it.each([
    ['icon traversal', { ...presentation, icon: { path: '../icon.png' } }],
    ['icon absolute path', { ...presentation, icon: { path: '/icon.png' } }],
    ['icon drive path', { ...presentation, icon: { path: 'C:/icon.png' } }],
    ['icon backslash path', { ...presentation, icon: { path: 'assets\\icon.png' } }],
    ['source traversal', { ...presentation, source: { kind: 'root', root: 'assets/../src' } }],
    ['non-http source URL', { ...presentation, source: { kind: 'url', url: 'file:///src' } }],
    ['license traversal', { ...presentation, licenseFiles: [{ path: '../../LICENSE' }] }],
  ])('rejects non-confined presentation data: %s', async (_label, badPresentation) => {
    const result = await normalizeExtensionManifest({
      standalone: { ...standaloneManifest, presentation: badPresentation },
    })
    expect(result.manifest).toBeUndefined()
    expect(hasErrors([...result.diagnostics])).toBe(true)
  })

  it('both containers at once = packaging error', async () => {
    const result = await normalizeExtensionManifest({
      packageJson: convertedImagesPackageJson,
      standalone: standaloneManifest,
    })
    expect(result.manifest).toBeUndefined()
    expect(result.diagnostics.some(d => d.code === 'x3.sdk/two-authored-containers')).toBe(true)
  })

  it('neither container = error', async () => {
    const result = await normalizeExtensionManifest({ packageJson: { name: 'x' } })
    expect(result.diagnostics.some(d => d.code === 'x3.sdk/no-authored-container')).toBe(true)
  })

  it('Q76: version/license inside #modkit block are packaging errors', async () => {
    const bad = structuredClone(convertedImagesPackageJson) as {
      modkit: Record<string, unknown>
    }
    bad.modkit['version'] = '9.9.9'
    bad.modkit['license'] = 'MIT'
    const result = await normalizeExtensionManifest({ packageJson: bad })
    const dupes = result.diagnostics.filter(d => d.code === 'x3.sdk/npm-field-duplicated-in-block')
    expect(dupes).toHaveLength(2)
    expect(result.manifest).toBeUndefined()
  })

  it('Q76: standalone without version/license is invalid', async () => {
    const rest: Record<string, unknown> = { ...standaloneManifest }
    delete rest['version']
    delete rest['license']
    const result = await normalizeExtensionManifest({ standalone: rest })
    expect(result.manifest).toBeUndefined()
    expect(hasErrors([...result.diagnostics])).toBe(true)
  })

  it('missing/invalid npm version or license is an error', async () => {
    const noVersion = structuredClone(convertedImagesPackageJson) as Record<string, unknown>
    delete noVersion['version']
    const r1 = await normalizeExtensionManifest({ packageJson: noVersion })
    expect(r1.diagnostics.some(d => d.code === 'x3.sdk/invalid-npm-version')).toBe(true)

    const badLicense = { ...convertedImagesPackageJson, license: '' }
    const r2 = await normalizeExtensionManifest({ packageJson: badLicense })
    expect(r2.diagnostics.some(d => d.code === 'x3.sdk/invalid-npm-license')).toBe(true)
  })

  it('Q75: dependsOn validates shape with mandatory scope and is preserved', async () => {
    const withDeps = {
      ...standaloneManifest,
      dependsOn: [
        {
          extension: 'modkit/archives',
          range: '^1.0',
          mode: 'required',
          scope: { kind: 'contribution', id: 'modkit/zip' },
        },
      ],
    }
    const ok = await normalizeExtensionManifest({ standalone: withDeps })
    expect(hasErrors([...ok.diagnostics])).toBe(false)
    expect(ok.manifest?.dependsOn?.[0]?.scope.kind).toBe('contribution')

    const missingScope = {
      ...standaloneManifest,
      dependsOn: [{ extension: 'modkit/archives', mode: 'required' }],
    }
    const bad = await normalizeExtensionManifest({ standalone: missingScope })
    expect(bad.manifest).toBeUndefined()
    expect(hasErrors([...bad.diagnostics])).toBe(true)
  })

  it('rejects the legacy authored form as data (no silent acceptance)', async () => {
    const legacy = (
      await import('./fixtures/legacy/legacy-extension-manifest.json', { with: { type: 'json' } })
    ).default
    const diagnostics = await validateWithSchema(extensionManifestSchema, legacy)
    expect(diagnostics.length).toBeGreaterThan(0)
  })
})

describe('contributionManifests patterns (27 §5.1)', () => {
  const files = [
    './contributions/hod-codec.json',
    'contributions/hod-format.json',
    'src/contribution.manifest.json',
  ]

  it('expands deterministically regardless of listing order', async () => {
    const a = expandContributionManifests(['./contributions/*.json'], files)
    const b = expandContributionManifests(['./contributions/*.json'], [...files].reverse())
    expect(a.entries).toEqual(b.entries)
    expect(a.entries.map(e => e.path)).toEqual([
      'contributions/hod-codec.json',
      'contributions/hod-format.json',
    ])
  })

  it('flags orphans, zero-match patterns, duplicates and forbidden patterns', async () => {
    const orphan = expandContributionManifests(['./contributions/*.json'], files)
    expect(orphan.diagnostics.some(d => d.code === 'x3.sdk/orphan-contribution-manifest')).toBe(
      true,
    )
    const zero = expandContributionManifests(['./nothing/*.json'], files)
    expect(zero.diagnostics.some(d => d.code === 'x3.sdk/pattern-without-matches')).toBe(true)
    const dupe = expandContributionManifests(
      ['./contributions/*.json', 'contributions/hod-codec.json'],
      files,
    )
    expect(dupe.diagnostics.some(d => d.code === 'x3.sdk/duplicate-pattern-match')).toBe(true)
    for (const bad of ['../up/*.json', 'a/**/b.json', '/abs/*.json', 'two/*/*.json']) {
      const result = expandContributionManifests([bad], files)
      expect(
        result.diagnostics.some(d => d.code === 'x3.sdk/invalid-contribution-pattern'),
        bad,
      ).toBe(true)
    }
  })
})
