import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import { compactRepositoryManifest, normalizeRepositoryManifest } from '../dist/index.js'
import { createNodeArtifactStore } from '../dist/node.js'
import { createBrowserExtensionVfs, openRepositorySource } from '../dist/browser.js'

const encode = value => Buffer.from(value).toString('base64')
const document = () => ({
  schemaVersion: 1,
  extensions: ['example/one', 'example/two'].map(id => ({
    id,
    files: {
      'package.json': encode(
        JSON.stringify({
          name: `@${id}`,
          version: '1.0.0',
          type: 'module',
          modkit: { publisher: 'example', id: id.split('/')[1] },
        }),
      ),
      'common.txt': encode('shared data '.repeat(100)),
      'empty.dat': '',
    },
  })),
})
const bytesOf = value => Buffer.from(JSON.stringify(value))
// Reuse the SDK's declared schema-checking dependency; the manager runtime needs no new dependency.
const { default: Ajv2020 } = createRequire(import.meta.resolve('@modkit/sdk'))('ajv/dist/2020.js')

test('published repository schema admits both formats and refuses mixed file representations', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../schemas/modkit.repository.schema.json', import.meta.url), 'utf8'),
  )
  const validate = new Ajv2020({ strict: false }).compile(schema)
  assert.equal(validate(document()), true, JSON.stringify(validate.errors))
  const compact = compactRepositoryManifest(document())
  assert.equal(validate(compact), true, JSON.stringify(validate.errors))
  assert.equal(validate({ ...compact, schemaVersion: 1 }), false)
  const invalid = structuredClone(compact)
  invalid.extensions[0].files['common.txt'] = 'AA=='
  assert.equal(validate(invalid), false)
})

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'modkit-compact-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function installRequest(manifest) {
  const bytes = bytesOf(manifest)
  return {
    entry: {
      id: 'example/toolkit',
      displayName: 'Test',
      publisher: 'example',
      version: '1.0.0',
      extensions: manifest.extensions.map(entry => entry.id),
      source: { kind: 'bundle', uri: 'memory://registry/bundle.json', trust: { mode: 'signed' } },
      remote: false,
      trusted: true,
    },
    artifact: { kind: 'portable-repository', bytes },
    integrity: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  }
}

test('compact round trip preserves every file, order and metadata, and is idempotent', () => {
  const input = document()
  input.extensions[1].enabled = false
  input.subjects = { games: ['subjects/game.json'] }
  const compact = compactRepositoryManifest(input)
  assert.equal(compact.blobs.length, 4)
  assert.equal(compact.extensions[0].files['common.txt'], compact.extensions[1].files['common.txt'])
  assert.deepEqual(normalizeRepositoryManifest(compact), normalizeRepositoryManifest(input))
  assert.deepEqual(compactRepositoryManifest(compact), compact)
  assert.ok(bytesOf(compact).length < bytesOf(input).length)
})

test('compact references reject missing tables, out of range, fractions, strings and invalid entries', () => {
  for (const reference of [-1, 0.5, 999, '0', null, {}, Number.MAX_SAFE_INTEGER + 1]) {
    const compact = structuredClone(compactRepositoryManifest(document()))
    compact.extensions[0].files['common.txt'] = reference
    assert.throws(() => normalizeRepositoryManifest(compact), {
      code: 'extension-manager/schema-invalid',
    })
  }
  for (const blobs of [undefined, {}, [0]]) {
    assert.throws(
      () => normalizeRepositoryManifest({ ...compactRepositoryManifest(document()), blobs }),
      { code: 'extension-manager/schema-invalid' },
    )
  }
})

test('browser discovery resolves the same compact manifest without Node decoding', async () => {
  const compact = compactRepositoryManifest(document())
  const created = createBrowserExtensionVfs({
    memoryEntries: { 'modkit.repository.json': bytesOf(compact) },
  })
  try {
    const opened = await openRepositorySource(created.vfs, {
      id: 'fixture',
      uri: 'memory://local/',
      enabled: true,
    })
    assert.deepEqual(opened.manifest, normalizeRepositoryManifest(document()))
    await opened.mount.dispose()
  } finally {
    await created.vfs.dispose()
  }
})

test('compact installation writes ordinary complete files and can reopen the same artifact', async t => {
  const store = createNodeArtifactStore({ root: await temporary(t) })
  const compact = compactRepositoryManifest(document())
  const request = installRequest(compact)
  const installed = await store.install(request)
  for (const root of installed.roots) {
    assert.equal(await readFile(join(root.root, 'common.txt'), 'utf8'), 'shared data '.repeat(100))
    assert.equal((await readFile(join(root.root, 'empty.dat'))).length, 0)
  }
  assert.deepEqual(await store.install(request), installed)
})

test('compact aliases cannot bypass expanded byte limits, integrity or safe paths', async t => {
  const compact = compactRepositoryManifest(document())
  const request = installRequest(compact)
  const limited = createNodeArtifactStore({ root: await temporary(t), maxMaterializedBytes: 1800 })
  await assert.rejects(limited.install(request), { code: 'extension-manager/artifact-byte-limit' })
  assert.deepEqual(await limited.list(), [])
  const store = createNodeArtifactStore({ root: await temporary(t) })
  await assert.rejects(store.install({ ...request, integrity: `sha256:${'0'.repeat(64)}` }), {
    code: 'extension-manager/integrity-mismatch',
  })
  const escaping = structuredClone(compact)
  escaping.extensions[0].files['../outside.txt'] = 0
  await assert.rejects(store.install(installRequest(escaping)), error => /path/.test(error.code))
  const malformed = structuredClone(compact)
  malformed.blobs[0] = 'not base64!'
  await assert.rejects(store.install(installRequest(malformed)), {
    code: 'extension-manager/artifact-base64-invalid',
  })
  assert.deepEqual(await store.list(), [])
})

test('compact CLI selects explicit roots, rejects missing roots and never overwrites output', async t => {
  const root = await temporary(t)
  const input = join(root, 'input.json')
  const output = join(root, 'output.json')
  await writeFile(input, bytesOf(document()))
  const command = [
    join(import.meta.dirname, '../dist/cli.js'),
    'compact',
    '--input',
    input,
    '--out',
    output,
    '--extension',
    'example/two',
  ]
  const run = args => spawnSync(process.execPath, args, { encoding: 'utf8' })
  const first = run(command)
  assert.equal(first.status, 0, first.stderr)
  const kept = await readFile(output)
  assert.deepEqual(
    JSON.parse(kept).extensions.map(entry => entry.id),
    ['example/two'],
  )
  assert.notEqual(run(command).status, 0)
  assert.deepEqual(await readFile(output), kept)
  assert.notEqual(run([...command.slice(0, -1), 'example/missing']).status, 0)
})

test('failed concurrent writes finish before staging cleanup and never publish an artifact', async t => {
  const root = await temporary(t)
  const store = createNodeArtifactStore({ root })
  const input = document()
  for (let index = 0; index < 24; index++)
    input.extensions[0].files[`extra/${index}.txt`] = encode('data')
  input.extensions[0].files['collision'] = encode('file')
  input.extensions[0].files['collision/child.txt'] = encode('child')
  await assert.rejects(store.install(installRequest(compactRepositoryManifest(input))))
  assert.deepEqual(await readdir(join(root, '.staging')), [])
  assert.deepEqual(await store.list(), [])
})
