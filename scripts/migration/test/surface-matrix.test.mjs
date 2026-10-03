import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSurfaceMatrix, surfaceClaimsForCodec } from '../lib/surface-matrix.mjs'

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const fixture = path.join(repoRoot, 'packages/testkit/fixtures/extension-surface-sample')
const scratch = mkdtempSync(path.join(tmpdir(), 'modkit-surface-matrix-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const spec = {
  formatRefs: [{ formatId: 'sample', label: 'Sample' }],
  publishesDataSources: [
    { contract: 'common.view/tree-data-source', major: 1 },
    { contract: 'common.view/byte-range-source', major: 1 },
  ],
  operations: [
    { id: 'view.inspect', handlerId: 'inspect', mutatesSource: false, outputKinds: ['json'] },
    { id: 'edit.field', handlerId: 'edit', mutatesSource: true, outputKinds: ['edit-plan'] },
  ],
}

test('surface claims are derived only from authored data sources, operations and writer offers', () => {
  const claims = surfaceClaimsForCodec(spec, [
    {
      source: 'writer.json#spec.provides[0]',
      contributionId: 'org.example/writer',
      offerId: 'one',
    },
  ])
  assert.equal(claims.sections.applicable, true)
  assert.deepEqual(claims.tree.sources, ['spec.publishesDataSources[0]'])
  assert.equal(claims.hex.applicable, true)
  assert.equal(claims.card.applicable, true)
  assert.equal(claims.preview.applicable, false)
  assert.equal(claims['mcp-inspect'].applicable, true)
  assert.equal(claims.script.applicable, true)
  assert.equal(claims['no-op-edit'].sources.length, 2)
})

test('matrix refuses duplicate contribution/format rows and keeps missing smoke visible', () => {
  const contribution = {
    path: 'contributions/codec.json',
    manifest: {
      id: 'org.example/codec',
      contract: { id: 'modkit/codec-contribution', major: 1 },
      spec,
    },
    inventoryEligible: true,
    diagnostics: [],
  }
  const extension = {
    manifest: { publisher: 'org.example', id: 'sample' },
    contributions: [contribution],
  }
  const input = {
    label: 'fixture',
    provenance: { label: 'fixture', kind: 'explicit-root', path: '/fixture' },
    inventory: { extensions: [extension], diagnostics: [] },
  }
  const matrix = buildSurfaceMatrix([input])
  assert.equal(matrix.counts.rows, 1)
  assert.equal(matrix.rows[0].smoke.status, 'missing')
  assert.throws(() => buildSurfaceMatrix([input, input]), /duplicate format surface row/u)
})

test('CLI check covers both outputs and immutable Git snapshots ignore dirty working-tree edits', () => {
  const repository = path.join(scratch, 'owner-repository')
  cpSync(fixture, repository, { recursive: true })
  execFileSync('git', ['init', '-q', repository])
  execFileSync('git', ['-C', repository, 'config', 'user.email', 'surface-fixture@example.invalid'])
  execFileSync('git', ['-C', repository, 'config', 'user.name', 'Surface Fixture'])
  execFileSync('git', ['-C', repository, 'add', '.'])
  execFileSync('git', ['-C', repository, 'commit', '-q', '-m', 'fixture snapshot'])
  const commit = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  // If the generator read the working tree, this malformed edit would fail inventory validation.
  writeFileSync(path.join(repository, 'package.json'), '{ dirty and invalid')

  const json = path.join(scratch, 'matrix.json')
  const markdown = path.join(scratch, 'matrix.md')
  const args = [
    'scripts/migration/emit-surface-matrix.mjs',
    '--snapshot',
    `fixture=${repository}@${commit}`,
    '--json-output',
    json,
    '--markdown-output',
    markdown,
    '--quiet',
  ]
  execFileSync(process.execPath, args, { cwd: repoRoot, timeout: 30_000 })
  const emitted = JSON.parse(readFileSync(json, 'utf8'))
  assert.equal(emitted.counts.rows, 1)
  assert.deepEqual(emitted.repositories, [{ label: 'fixture', kind: 'git-snapshot', commit }])
  execFileSync(process.execPath, [...args, '--check'], { cwd: repoRoot, timeout: 30_000 })

  writeFileSync(markdown, `${readFileSync(markdown, 'utf8')}stale\n`)
  const stale = spawnSync(process.execPath, [...args, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(stale.status, 1)
  assert.match(stale.stderr, /matrix\.md is stale/u)
})
