import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'

import { ownerOfLegacyExtension, resolveLegacyExtension } from '../../parity/repositories.mjs'
import { validateOwnerParityDocuments } from '../../parity/receipt.mjs'

const coreRoot = process.cwd()
const sameRootEnvironment = {
  ...process.env,
  MODKIT_BLIZZARD_ROOT: coreRoot,
  MODKIT_EA_ROOT: coreRoot,
  MODKIT_OTHER_EXTENSIONS_ROOT: coreRoot,
  MODKIT_SPRING_ROOT: coreRoot,
  MODKIT_WARZONE_ROOT: coreRoot,
}

test('legacy extension paths resolve to their current repository owner', () => {
  assert.equal(ownerOfLegacyExtension('extensions/ea/big'), 'ea')
  assert.equal(ownerOfLegacyExtension('extensions/blizzard/models'), 'blizzard')
  assert.equal(ownerOfLegacyExtension('extensions/opensource/spring'), 'spring')
  assert.equal(ownerOfLegacyExtension('extensions/opensource/warzone-2100'), 'warzone')
  assert.equal(ownerOfLegacyExtension('extensions/ps1'), 'other')
  assert.equal(ownerOfLegacyExtension('extensions/common/images'), 'core')
  assert.equal(
    resolveLegacyExtension(coreRoot, 'extensions/common/images', sameRootEnvironment),
    resolve(coreRoot, 'extensions/images'),
  )
  assert.equal(
    resolveLegacyExtension(coreRoot, 'extensions/common/data/plain-text', sameRootEnvironment),
    resolve(coreRoot, 'packages/host/native-text'),
  )
  assert.equal(
    resolveLegacyExtension(coreRoot, 'extensions/common/data/text-delimited', sameRootEnvironment),
    resolve(coreRoot, 'extensions/data'),
  )
  assert.equal(
    resolveLegacyExtension(coreRoot, 'extensions/ea/big', sameRootEnvironment),
    resolve(coreRoot, 'big'),
  )
})

test('owner parity documents require explicit result-to-repository bindings', () => {
  const repositories = [{ id: 'core', repository: 'modkit-core', commit: 'a'.repeat(40) }]
  const counts = { total: 1 }
  const receipt = {
    schemaVersion: 'owner-parity-aggregation-1',
    verdict: 'pass',
    report: { schemaVersion: 4, counts },
    repositories,
    ownerResultCounts: { core: 1 },
    blockingResultIds: [],
  }
  const report = {
    schemaVersion: 4,
    x3: { repositories },
    counts,
    results: [{ id: 'fixture', repositories: ['core'] }],
  }
  assert.deepEqual(validateOwnerParityDocuments({ receipt, report }), {
    rows: 1,
    repositories: 1,
  })
  assert.throws(
    () =>
      validateOwnerParityDocuments({
        receipt,
        report: { ...report, results: [{ id: 'fixture', repositories: [] }] },
      }),
    /no repository binding/u,
  )
})
