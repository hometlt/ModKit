import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { externalRepositoryRoot } from '../lib/external-extension-roots.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('SC2 document metadata support matches its partial contribution', () => {
  const capabilities = readFileSync(resolve(repoRoot, 'migration/capabilities.yaml'), 'utf8')
  const row = capabilities.match(
    /capabilityId: 'format\/sc2-document-metadata\/open-inspect'(?<body>[\s\S]*?)(?=\n  - capabilityId:)/u,
  )
  assert.ok(row?.groups?.body, 'SC2 document metadata capability row is missing')
  const supportState = row.groups.body.match(/\n    supportState: '([^']+)'/u)?.[1]

  const blizzardRoot = externalRepositoryRoot(repoRoot, 'blizzard')
  const contribution = JSON.parse(
    readFileSync(
      resolve(blizzardRoot, 'starcraft2/contributions/codec-sc2-document-metadata.json'),
      'utf8',
    ),
  )
  assert.equal(supportState, contribution.status)
  assert.equal(supportState, 'partial')
})

test('registry cross-checks the preserved common coverage ledger', () => {
  const baseline = JSON.parse(
    readFileSync(resolve(repoRoot, 'migration/registry-debt-baseline.json'), 'utf8'),
  )
  const result = spawnSync(process.execPath, ['scripts/migration/check-registry.mjs'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  assert.equal(result.status, 0, output)
  assert.match(
    output,
    new RegExp(
      `known debt ${baseline.problems.length} .*new problems 0, stale baseline entries 0, unavailable checks 0`,
      'u',
    ),
  )
  assert.doesNotMatch(output, /common-coverage\.json not found/u)
})
