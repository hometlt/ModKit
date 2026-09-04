import assert from 'node:assert/strict'
import test from 'node:test'

import { createBrowserExtensionVfs } from '../dist/browser.js'
import {
  ExtensionManagerError,
  GAME_SUBJECT_KIND,
  VENDOR_SUBJECT_KIND,
  loadRepositorySubjectProfiles,
  normalizeGameSubjectProfile,
  normalizeRepositoryManifest,
  normalizeVendorSubjectProfile,
  openRepositorySource,
  projectExtensionSubjects,
  projectVendorGameSubjects,
  subjectFactsSourceFromWire,
  subjectRecordToWire,
} from '../dist/index.js'

const json = value => new TextEncoder().encode(JSON.stringify(value))

const vendor = Object.freeze({
  schemaVersion: 1,
  kind: 'vendor',
  id: 'example.vendor',
  displayName: 'Example Vendor',
  description: 'A vendor profile loaded as inert repository data.',
  officialSite: 'https://vendor.example/',
  resources: [
    {
      id: 'modding',
      label: 'Modding documentation',
      url: 'https://docs.example/modding',
      kind: 'modding',
    },
  ],
})

const game = Object.freeze({
  schemaVersion: 1,
  kind: 'game',
  id: 'example.vendor/example-game',
  vendorId: 'example.vendor',
  displayName: 'Example Game',
  description: 'A game profile with extension and capability requirements.',
  officialSite: 'https://game.example/',
  resources: [
    {
      id: 'wiki',
      label: 'Modding wiki',
      url: 'https://wiki.example/game',
      kind: 'community',
    },
  ],
  extensionRequirements: [{ id: 'example.vendor/data', importance: 'required' }],
  capabilityRequirements: [
    {
      id: 'game-data',
      displayName: 'Game data',
      importance: 'required',
      contributionIds: ['example.vendor/data-codec'],
    },
  ],
})

function extensionProjection() {
  return projectExtensionSubjects({
    extension: {
      schemaVersion: 1,
      publisher: 'example.vendor',
      id: 'data',
      version: '1.0.0',
      license: 'MIT',
      contributionManifests: [],
      presentation: {
        displayName: 'Example Game Data',
        vendor: { id: 'example.vendor', displayName: 'Example Vendor' },
        games: [{ id: 'example.vendor/example-game', displayName: 'Example Game' }],
      },
    },
    contributions: [
      {
        schemaVersion: 1,
        id: 'example.vendor/data-codec',
        displayName: 'Example data codec',
        contract: { id: 'modkit/codec-contribution', major: 1 },
        spec: {},
      },
    ],
  })
}

test('loads repository JSON profiles through VFS and projects navigable subject wires', async () => {
  const manifest = {
    schemaVersion: 1,
    extensions: [],
    subjects: {
      vendors: ['./subjects/vendors/example.json'],
      games: ['subjects/games/example-game.json'],
    },
  }
  const created = createBrowserExtensionVfs({
    memoryEntries: {
      'repository/modkit.repository.json': json(manifest),
      'repository/subjects/vendors/example.json': json(vendor),
      'repository/subjects/games/example-game.json': json(game),
    },
  })
  let repository
  try {
    repository = await openRepositorySource(created.vfs, {
      id: 'example',
      uri: 'memory://workspace/repository',
      enabled: true,
    })
    assert.deepEqual(repository.manifest.subjects, {
      vendors: ['subjects/vendors/example.json'],
      games: ['subjects/games/example-game.json'],
    })
    const profiles = await loadRepositorySubjectProfiles(repository.mount, repository.manifest)
    const extensions = extensionProjection()
    const sharedComponent = projectExtensionSubjects({
      extension: {
        schemaVersion: 1,
        publisher: 'example.vendor',
        id: 'shared',
        version: '1.0.0',
        license: 'MIT',
        contributionManifests: [],
        presentation: {
          displayName: 'Shared Component',
          description: 'Formats shared across games.',
          vendor: { id: 'example.vendor', displayName: 'Example Vendor' },
        },
      },
      contributions: [],
    })
    const projected = projectVendorGameSubjects({
      ...profiles,
      records: [...extensions.records, ...sharedComponent.records],
      source: { id: 'modkit-repository:example' },
    })

    assert.equal(projected.vendor('example.vendor').kind, VENDOR_SUBJECT_KIND)
    assert.equal(projected.game('example.vendor/example-game').kind, GAME_SUBJECT_KIND)
    const vendorWire = JSON.parse(
      JSON.stringify(await subjectRecordToWire(projected.vendor('example.vendor'))),
    )
    const offerings = vendorWire.groups.find(group => group.id === 'offerings')
    assert.deepEqual(
      offerings.facts.map(item => [item.label, item.value.description]),
      [
        ['Example Game', game.description],
        ['Shared Component', 'Formats shared across games.'],
      ],
    )
    assert.equal(offerings.facts[0].value.subjectId, projected.game(game.id).subjectId)
    assert.equal(offerings.facts[1].value.subjectId, sharedComponent.extension.subjectId)
    const gameWire = JSON.parse(
      JSON.stringify(await subjectRecordToWire(projected.game('example.vendor/example-game'))),
    )
    assert.equal(gameWire.subject.profile.description, game.description)
    assert.equal(gameWire.subject.resources[0].url, 'https://game.example/')
    assert.deepEqual(gameWire.relations.map(item => item.role).sort(), [
      'belongs-to-vendor',
      'requires-capability',
      'requires-extension',
      'supported-by',
    ])
    const restored = subjectFactsSourceFromWire(gameWire)
    assert.equal((await restored.summary()).identity.kind, GAME_SUBJECT_KIND)
    assert.equal((await restored.facts('resources', { limit: 10 })).items.length, 2)
  } finally {
    await repository?.mount.dispose()
    await created.vfs.dispose()
  }
})

test('keeps extension and contribution records distinct when their coordinates match', async () => {
  const extension = projectExtensionSubjects({
    extension: {
      schemaVersion: 1,
      publisher: 'example.vendor',
      id: 'data',
      version: '1.0.0',
      license: 'MIT',
      contributionManifests: [],
      presentation: {
        displayName: 'Example Game Data',
        vendor: { id: 'example.vendor', displayName: 'Example Vendor' },
        games: [{ id: 'example.vendor/example-game', displayName: 'Example Game' }],
      },
    },
    contributions: [
      {
        schemaVersion: 1,
        id: 'example.vendor/data',
        displayName: 'Example data codec',
        contract: { id: 'modkit/codec-contribution', major: 1 },
        spec: {},
      },
    ],
  })
  const projected = projectVendorGameSubjects({
    vendors: [vendor],
    games: [
      {
        ...game,
        capabilityRequirements: [
          {
            ...game.capabilityRequirements[0],
            contributionIds: ['example.vendor/data'],
          },
        ],
      },
    ],
    records: extension.records,
  })
  const wire = await subjectRecordToWire(projected.game(game.id))
  assert.deepEqual(wire.relations.map(item => item.role).sort(), [
    'belongs-to-vendor',
    'requires-capability',
    'requires-extension',
    'supported-by',
  ])
})

test('normalizes strict profiles, confined paths and safe resource URLs', () => {
  assert.equal(normalizeVendorSubjectProfile(vendor).officialSite, 'https://vendor.example/')
  assert.equal(normalizeGameSubjectProfile(game).extensionRequirements[0].importance, 'required')
  assert.throws(
    () =>
      normalizeRepositoryManifest({
        schemaVersion: 1,
        extensions: [],
        subjects: { vendors: ['../vendor.json'] },
      }),
    error =>
      error instanceof ExtensionManagerError && error.code === 'extension-manager/schema-invalid',
  )
  assert.throws(
    () => normalizeVendorSubjectProfile({ ...vendor, officialSite: 'https://user@example.test/' }),
    error =>
      error instanceof ExtensionManagerError &&
      error.code === 'extension-manager/subject-profile-invalid',
  )
  assert.throws(
    () => normalizeGameSubjectProfile({ ...game, vendorId: 'other.vendor' }),
    error =>
      error instanceof ExtensionManagerError &&
      error.code === 'extension-manager/subject-profile-invalid',
  )
  const hostile = { ...vendor }
  Object.defineProperty(hostile, 'description', { enumerable: true, get: () => 'unexpected' })
  assert.throws(
    () => normalizeVendorSubjectProfile(hostile),
    error =>
      error instanceof ExtensionManagerError &&
      error.code === 'extension-manager/subject-profile-invalid',
  )
})
