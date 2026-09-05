import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, chmod, cp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyPreparedOracle } from '../lib/port-oracle-proof.mjs'
import { digestManifest, sha256 } from '../lib/legacy-oracle.mjs'

const repoRoot = fileURLToPath(new URL('../../../../references/modkitmk2', import.meta.url))
const engineUrl = new URL('../lib/legacy-oracle.mjs', import.meta.url).href
const entry = 'extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/sha1.ts'
const operation = 'sha1Hex'
const corpus = { kind: 'fixture', cases: [{ id: 'abc', input: 'abc' }] }

async function withChangedFile(file, bytes, callback) {
  const original = await readFile(file)
  await chmod(file, 0o644)
  try {
    await writeFile(file, bytes)
    await callback()
  } finally {
    await writeFile(file, original)
  }
}

test('actual pinned SHA1 preparation binds artifacts, full identity and wrapper', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modkit-oracle-proof-'))
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('modkit-oracle-proof-'))
    await rm(root, { recursive: true, force: true })
  })
  const adapterPath = path.join(root, 'adapter.mjs')
  const cacheDir = path.join(root, 'cache')
  await writeFile(
    adapterPath,
    `import { loadMk2 } from ${JSON.stringify(engineUrl)}
import { fileURLToPath } from 'node:url'
export async function prepareOracle({ operation, corpus, variant = 'first', observeWorkingTree = true }) {
  return loadMk2(${JSON.stringify(entry)}, { repoRoot: ${JSON.stringify(repoRoot)}, cacheDir: ${JSON.stringify(cacheDir)}, operation, operationOptions: { variant }, corpusManifest: corpus, loaderFiles: [fileURLToPath(import.meta.url)], observeWorkingTree })
}
`,
  )
  const adapter = await import(pathToFileURL(adapterPath).href)
  const first = await adapter.prepareOracle({ operation, corpus })
  assert.equal(first.module.sha1Hex('abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d')
  const evidence = first.evidence
  const options = { corpus, adapterPath, operation, repoRoot }
  const verify = (value = evidence, overrides = {}) =>
    verifyPreparedOracle(value, { ...options, ...overrides })

  await t.test(
    'nonempty genuine loadMk2 evidence passes and still calls for adapter review',
    async () => {
      const result = await verify()
      assert.equal(result.verified, true)
      assert.equal(result.adapterReviewRequired, true)
      assert.equal(result.modules.length, 1)
      assert.ok(result.modules[0].sourceFiles > 0)
      assert.equal(result.adapterSha256, sha256(await readFile(adapterPath)))
    },
  )

  await t.test(
    'multiple real modules and an insignificant cacheHit change are accepted',
    async () => {
      const second = await adapter.prepareOracle({ operation, corpus, variant: 'second' })
      assert.notEqual(second.evidence.cacheKey, evidence.cacheKey)
      const result = await verify({
        modules: [{ ...evidence, cacheHit: !evidence.cacheHit }, second.evidence],
      })
      assert.equal(result.modules.length, 2)
    },
  )

  await t.test('ODB-only cache identity is preserved and verified', async () => {
    const pinnedOnly = await adapter.prepareOracle({
      operation,
      corpus,
      variant: 'pinned-only',
      observeWorkingTree: false,
    })
    assert.equal(pinnedOnly.evidence.observeWorkingTree, false)
    assert.equal((await verify(pinnedOnly.evidence)).verified, true)
  })

  await t.test('self-consistent metadata without actual cache files is rejected', async () => {
    const fabricated = {
      ...evidence,
      directory: path.join(root, 'missing-cache', evidence.cacheKey),
    }
    await assert.rejects(() => verify(fabricated), /ENOENT/u)
    await assert.rejects(() => verify({ modules: [] }), /nonempty module evidence/u)
  })

  await t.test('tampered actual bundle is rejected', async () => {
    await withChangedFile(
      path.join(evidence.directory, 'oracle.mjs'),
      'export const counterfeit = true',
      async () => {
        await assert.rejects(() => verify(), /Oracle bundle bytes differ/u)
      },
    )
  })

  await t.test('tampered actual source snapshot is rejected', async () => {
    await withChangedFile(
      path.join(evidence.directory, 'source', entry),
      'export const counterfeit = true',
      async () => {
        await assert.rejects(() => verify(), /Oracle source snapshot bytes differ/u)
      },
    )
  })

  await t.test(
    'even consistent on-disk source metadata must match the pinned Git blob',
    async () => {
      const fake = structuredClone(evidence)
      fake.source.find(row => row.path === entry).gitBlob = 'f'.repeat(40)
      fake.sourceFiles.find(row => row.path === entry).gitBlob = 'f'.repeat(40)
      fake.sourceClosureDigest = digestManifest(fake.source)
      const identityKeys = [
        'schemaVersion',
        'oracleCommit',
        'entry',
        'source',
        'loader',
        'dependencies',
        'runtime',
        'build',
        'operation',
        'operationOptions',
        'corpusManifest',
        'additionalFiles',
        'runtimeDependencies',
        'workspaceScopes',
        'stubs',
      ]
      fake.cacheKey = digestManifest(Object.fromEntries(identityKeys.map(key => [key, fake[key]])))
      fake.directory = path.join(cacheDir, fake.cacheKey)
      fake.loaderSnapshots = fake.loaderSnapshots.map((row, index) => ({
        ...row,
        snapshot: path.join(fake.directory, 'loader', `${index}-${path.basename(row.path)}`),
      }))
      await cp(evidence.directory, fake.directory, { recursive: true })
      await writeFile(path.join(fake.directory, 'manifest.json'), JSON.stringify(fake))
      await assert.rejects(() => verify(fake), /differs from pinned Git blob/u)
    },
  )

  await t.test('adapter edits and substituting a different wrapper path are rejected', async () => {
    await withChangedFile(adapterPath, '// changed wrapper', async () => {
      await assert.rejects(() => verify(), /Oracle loader\/adapter bytes differ/u)
    })
    const substitute = path.join(root, 'other-adapter.mjs')
    await writeFile(substitute, await readFile(adapterPath))
    await assert.rejects(
      () => verify(evidence, { adapterPath: substitute }),
      /bind the actual adapter/u,
    )
  })

  await t.test('corpus and operation must match the executed call', async () => {
    await assert.rejects(
      () =>
        verify(evidence, { corpus: { ...corpus, cases: [{ id: 'changed', input: 'different' }] } }),
      /corpusDigest mismatch/u,
    )
    await assert.rejects(
      () => verify(evidence, { operation: 'different-operation' }),
      /operation differs/u,
    )
    await assert.rejects(
      () => verify(evidence, { corpus: { cases: [] } }),
      /nonempty executed corpus/u,
    )
  })

  await t.test(
    'options and dependency identities cannot be swapped independently of the artifact',
    async () => {
      await assert.rejects(
        () => verify({ ...evidence, operationOptions: { variant: 'tampered' } }),
        /cache identity mismatch/u,
      )
      const changed = structuredClone(evidence)
      changed.dependencies[0].version = 'fabricated'
      changed.dependenciesDigest = digestManifest(changed.dependencies)
      await assert.rejects(() => verify(changed), /cache identity mismatch/u)
    },
  )

  await t.test(
    'tampered on-disk manifest, loader snapshot and dependency snapshot are rejected',
    async () => {
      await withChangedFile(
        path.join(evidence.directory, 'manifest.json'),
        JSON.stringify({ ...evidence, bundleSha256: '0'.repeat(64) }),
        async () => {
          await assert.rejects(() => verify(), /manifest\/cache identity mismatch/u)
        },
      )
      await withChangedFile(
        evidence.loaderSnapshots[1].snapshot,
        '// changed stored wrapper',
        async () => {
          await assert.rejects(() => verify(), /Oracle loader snapshot bytes differ/u)
        },
      )
      const dependency = evidence.dependencies.find(row => row.name === 'esbuild')
      const snapshot = path.join(
        cacheDir,
        'dependencies',
        evidence.dependenciesDigest,
        sha256(dependency.root),
        'package.json',
      )
      await withChangedFile(snapshot, '{}', async () => {
        await assert.rejects(() => verify(), /Oracle dependency snapshot bytes differ/u)
      })
    },
  )

  await t.test('restored original artifacts still verify after negative probes', async () => {
    assert.equal((await verify()).verified, true)
  })
})
