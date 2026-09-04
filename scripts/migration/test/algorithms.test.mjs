import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  algorithmDefinitions,
  scanAlgorithms,
  checkAlgorithmDebt,
  checkBaselineRatchet,
} from '../lib/algorithms.mjs'
import { sha256 } from '../lib/legacy-oracle.mjs'

test('baseline editing cannot grant new debt or modify an existing allowance', () => {
  const row = {
    id: 'repo/file.ts:crc32#0',
    disposition: 'existing-debt',
    implementationSha256: 'original',
  }
  const previous = { implementations: [row] }
  assert.deepEqual(checkBaselineRatchet({ implementations: [] }, previous), [])
  assert.match(
    checkBaselineRatchet({ implementations: [{ ...row, id: 'repo/new.ts:crc32#0' }] }, previous)[0],
    /introduces algorithm debt/u,
  )
  assert.match(
    checkBaselineRatchet(
      { implementations: [{ ...row, implementationSha256: 'changed' }] },
      previous,
    )[0],
    /changes existing algorithm allowance/u,
  )
})

test('AST finds named implementation bodies and ignores calls, comments and import declarations', () => {
  const rows = algorithmDefinitions(
    `// function crc32() {}
    import { sha1 } from 'crypto'; crc32(bytes); const text = 'function md5() {}';
    function crc32() { return 42 }
    const inflateRaw = () => 1;
    class Parser { parseXmlDocument() { return {} } }
    const codecs = { decodeBc1: function () { return 2 } };
    exports.adler32 = value => value;
    function md5(value: string): string;
  `,
    'source.ts',
  )
  assert.deepEqual(
    rows.map(row => row.name),
    ['crc32', 'inflateRaw', 'parseXmlDocument', 'decodeBc1', 'adler32'],
  )
})

test('ratchet accepts debt deletion and canonical copies, rejects new peers and changed algorithms', () => {
  const row = { id: 'repo/a.ts:crc32#0', disposition: 'existing-debt', implementationSha256: 'a' }
  const baseline = { schemaVersion: 1, scanned: [{ repository: 'repo' }], implementations: [row] }
  assert.deepEqual(checkAlgorithmDebt(baseline, baseline).failures, [])
  assert.equal(checkAlgorithmDebt({ ...baseline, implementations: [] }, baseline).retired.length, 1)
  assert.match(
    checkAlgorithmDebt(
      { ...baseline, implementations: [{ ...row, id: 'repo/new.ts:crc32#0' }] },
      baseline,
    ).failures[0],
    /New undeclared/u,
  )
  assert.match(
    checkAlgorithmDebt(
      { ...baseline, implementations: [{ ...row, implementationSha256: 'b' }] },
      baseline,
    ).failures[0],
    /debt changed/u,
  )
  assert.equal(
    checkAlgorithmDebt(
      {
        ...baseline,
        implementations: [{ ...row, id: 'canonical.ts', disposition: 'canonical-copy' }],
      },
      baseline,
    ).canonical,
    1,
  )
  assert.throws(
    () => checkAlgorithmDebt(baseline, { ...baseline, implementations: [] }),
    /Empty\/invalid/u,
  )
})

test('actual repository scan excludes build/tests/vendor and validates canonical uniqueness and hashes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'algorithm-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('algorithm-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const text = 'export function sha1() { return 1 }'
  for (const file of [
    'repo/src/hash.ts',
    'repo/test/hash.ts',
    'repo/dist/hash.js',
    'repo/vendor/hash.ts',
    'repo/reports/port-libs-m1/hash.ts',
    'repo/src/hash.test.ts',
  ]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), text)
  }
  const canonical = {
    mk2Path: 'legacy/hash.ts',
    destination: 'repo/src/hash.ts',
    sha256Mk3: sha256(text),
  }
  const options = { workspaceRoot: root, repositories: ['repo'], canonicalFiles: [canonical] }
  const scan = await scanAlgorithms(options)
  assert.equal(scan.implementations.length, 1)
  assert.equal(scan.implementations[0].disposition, 'canonical-copy')
  await writeFile(
    path.join(root, 'repo/src/new-peer.ts'),
    'export function sha1Hex() { return 123 }',
  )
  const peerScan = await scanAlgorithms(options)
  assert.match(
    checkAlgorithmDebt(peerScan, scan).failures[0],
    /New undeclared algorithm implementation: .*sha1Hex/u,
  )
  await assert.rejects(
    () =>
      scanAlgorithms({
        ...options,
        canonicalFiles: [canonical, { ...canonical, destination: 'repo/other.ts' }],
      }),
    /Multiple canonical paths/u,
  )
  await writeFile(path.join(root, 'repo/src/hash.ts'), `${text}\n// tamper`)
  await assert.rejects(() => scanAlgorithms(options), /hash mismatch/u)
})
