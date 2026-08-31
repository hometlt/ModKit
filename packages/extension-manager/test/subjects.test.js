import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'

import { parseSubjectRef, serializeSubjectRef } from '@modkit/sdk/subjects'

import {
  CONTRIBUTION_SUBJECT_KIND,
  EXTENSION_SUBJECT_KIND,
  ExtensionManagerError,
  extensionSubjectRecordToWire,
  projectExtensionSubjects,
  subjectFactsSourceFromWire,
} from '../src/index.js'

const extension = Object.freeze({
  schemaVersion: 1,
  publisher: 'example.vendor',
  id: 'models',
  version: '1.2.3',
  license: 'MIT',
  contributionManifests: ['./contributions/*.json'],
  presentation: {
    displayName: 'Model tools from manifest',
    vendor: { id: 'example.vendor', displayName: 'Example Vendor' },
    games: [{ id: 'example.vendor/model-game', displayName: 'Model Game' }],
    icon: { path: 'assets/model-tools.png', mediaType: 'image/png' },
    source: { kind: 'url', url: 'https://example.invalid/model-tools' },
    licenseFiles: [{ path: './LICENSE.txt', displayName: 'MIT License' }],
  },
})

const contribution = ({ id, displayName, contract, spec = {}, status }) => ({
  schemaVersion: 1,
  contract,
  id,
  displayName,
  ...(status === undefined ? {} : { status }),
  spec,
})

test('projects extension and contribution subjects grouped by exact manifest contract', async () => {
  const projection = projectExtensionSubjects({
    extension,
    metadata: { displayName: 'Model tools', description: 'Model support' },
    enabled: false,
    contributionEnablement: { 'example.vendor/gltf': true, 'example.vendor/obj': false },
    contributions: [
      contribution({
        id: 'example.vendor/viewer',
        displayName: 'Model viewer',
        contract: { id: 'modkit/viewer-contribution', major: 1 },
      }),
      contribution({
        id: 'example.vendor/obj',
        displayName: 'OBJ',
        contract: { id: 'modkit/codec-contribution', major: 2 },
      }),
      contribution({
        id: 'example.vendor/gltf',
        displayName: 'glTF',
        contract: { id: 'modkit/codec-contribution', major: 1 },
        spec: {
          formatRefs: [{ formatId: 'gltf', label: 'glTF' }],
          operations: [{ id: 'view.inspect' }],
        },
      }),
    ],
  })

  assert.equal(projection.extension.kind, EXTENSION_SUBJECT_KIND)
  assert.equal(projection.extension.id, 'example.vendor/models')
  assert.equal(projection.contributions.length, 3)
  assert.deepEqual(
    projection.contractGroups.map(group => group.key),
    ['modkit/codec-contribution@1', 'modkit/codec-contribution@2', 'modkit/viewer-contribution@1'],
  )
  assert.equal(projection.contractGroups[0].contributions[0].id, 'example.vendor/gltf')
  assert.equal(projection.contributions[0].kind, CONTRIBUTION_SUBJECT_KIND)

  const gltf = projection.contributions.find(item => item.id === 'example.vendor/gltf')
  const obj = projection.contributions.find(item => item.id === 'example.vendor/obj')
  assert.ok(gltf)
  assert.ok(obj)
  assert.equal(gltf.enabled, true)
  assert.equal(gltf.effectiveEnabled, false)
  assert.equal(obj.enabled, false)
  assert.equal(obj.effectiveEnabled, false)
  assert.equal(projection.subject(gltf.subjectId), gltf)

  for (const record of projection.records) {
    assert.equal(serializeSubjectRef(parseSubjectRef(record.subjectId)), record.subjectId)
  }

  const extensionRelations = await projection.extension.facts.relations({ limit: 10 })
  assert.deepEqual(
    extensionRelations.items.map(item => [item.role, item.subjectId]),
    projection.contributions.map(item => ['owns', item.subjectId]),
  )
  assert.deepEqual(
    projection.extension.contributions.map(item => [item.role, item.id, item.contractKey]),
    projection.contributions.map(item => ['owns', item.id, item.contractKey]),
  )
  const contributionRelations = await gltf.facts.relations({ limit: 10 })
  assert.deepEqual(contributionRelations.items, [
    {
      role: 'belongs-to',
      subjectId: projection.extension.subjectId,
      label: 'Model tools',
      kind: EXTENSION_SUBJECT_KIND,
    },
  ])

  const specification = await gltf.facts.facts('specification', { limit: 1 })
  assert.equal(specification.items[0].id, 'spec.formatRefs')
  assert.equal(specification.nextCursor, '1')
  const secondPage = await gltf.facts.facts('specification', {
    cursor: specification.nextCursor,
    limit: 1,
  })
  assert.equal(secondPage.items[0].id, 'spec.operations')
  assert.equal(secondPage.nextCursor, undefined)

  const overview = await gltf.facts.facts('overview', { limit: 20 })
  assert.equal(
    overview.items.find(item => item.id === 'description').value,
    'glTF support for glTF.',
  )

  const wire = await extensionSubjectRecordToWire(gltf)
  const transferred = JSON.parse(JSON.stringify(wire))
  assert.equal(transferred.subject.contractKey, 'modkit/codec-contribution@1')
  assert.equal(transferred.groups.find(item => item.id === 'specification').facts.length, 2)
  assert.deepEqual(transferred.relations, contributionRelations.items)
  const restored = subjectFactsSourceFromWire(transferred)
  assert.deepEqual(await restored.summary(), await gltf.facts.summary())
  assert.deepEqual(
    await restored.relations({ limit: 10 }),
    await gltf.facts.relations({ limit: 10 }),
  )

  const extensionWire = JSON.parse(
    JSON.stringify(await extensionSubjectRecordToWire(projection.extension)),
  )
  assert.equal(extensionWire.subject.presentation.vendor.displayName, 'Example Vendor')
  assert.equal(extensionWire.subject.contributions.length, 3)
  assert.deepEqual(
    extensionWire.subject.contributions.map(item => item.subjectId),
    extensionWire.relations.map(item => item.subjectId),
  )
  assert.equal(
    extensionWire.groups.some(item => item.id === 'contracts'),
    false,
  )
  const contributionGroup = extensionWire.groups.find(item => item.id === 'contributions')
  assert.equal(contributionGroup.facts.length, 3)
  assert.equal(contributionGroup.facts[0].value.role, 'owns')
  assert.equal(typeof contributionGroup.facts[0].value.subjectId, 'string')
  assert.equal(typeof contributionGroup.facts[0].value.contractKey, 'string')
  assert.deepEqual(
    await restored.facts('specification', { limit: 10 }),
    await gltf.facts.facts('specification', { limit: 10 }),
  )
})

test('projects a real common extension root and contribution manifest', async () => {
  const root = resolve(import.meta.dirname, '../../../extensions/models')
  const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const gltf = JSON.parse(await readFile(resolve(root, 'contributions/codec-gltf.json'), 'utf8'))
  const projection = projectExtensionSubjects({
    extension: {
      ...packageJson.modkit,
      version: packageJson.version,
      license: packageJson.license,
    },
    metadata: {
      displayName: packageJson.name,
      description: packageJson.description,
    },
    contributions: [gltf],
  })

  assert.equal(projection.extension.id, 'modkit/models')
  assert.equal(projection.contractGroups[0].key, 'modkit/codec-contribution@1')
  assert.equal(projection.contractGroups[0].contributions[0].id, 'modkit/model-gltf')
  const summary = await projection.contractGroups[0].contributions[0].facts.summary()
  assert.equal(summary.identity.type, 'modkit/codec-contribution@1')
})

test('rejects duplicate contributions and malformed pagination', async () => {
  const duplicate = contribution({
    id: 'example.vendor/repeated',
    displayName: 'Repeated',
    contract: { id: 'modkit/codec-contribution', major: 1 },
  })
  assert.throws(
    () =>
      projectExtensionSubjects({
        extension,
        contributions: [duplicate, duplicate],
      }),
    error =>
      error instanceof ExtensionManagerError &&
      error.code === 'extension-manager/subject-projection-invalid',
  )

  const projection = projectExtensionSubjects({ extension, contributions: [duplicate] })
  await assert.rejects(
    projection.extension.facts.groups({ cursor: '-1', limit: 1 }),
    error =>
      error instanceof ExtensionManagerError &&
      error.code === 'extension-manager/subject-projection-invalid',
  )
})
