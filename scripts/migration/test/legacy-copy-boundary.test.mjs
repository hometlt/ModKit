import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname, basename, resolve } from 'node:path'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { verifiedLegacyPaths } from '../../legacy-copy-boundary.mjs'
import { prepareCopy, writeCopies } from '../lib/mk2-copy.mjs'
import { MK2_PIN, sha256 } from '../lib/legacy-oracle.mjs'

const gate = fileURLToPath(new URL('../../check-legacy.mjs', import.meta.url))

function runGate(root) {
  return spawnSync(process.execPath, [gate, '--root', root], { encoding: 'utf8' })
}

async function copyFixture(t) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'legacy-boundary-test-'))
  t.after(async () => {
    assert.equal(dirname(workspaceRoot), resolve(tmpdir()))
    assert.match(basename(workspaceRoot), /^legacy-boundary-test-/u)
    await rm(workspaceRoot, { recursive: true, force: true })
  })
  const root = join(workspaceRoot, 'modkit-core')
  const text = 'export interface CapabilityDescriptor { capabilities: readonly string[] }\n'
  const sourcePath = 'packages/assets/src/capabilities.ts'
  const destination = 'modkit-core/packages/codec-kit/src/legacy/assets/capabilities.ts'
  const declaration = {
    schemaVersion: 1,
    family: 'sc2',
    oracleCommit: MK2_PIN,
    scopes: {
      'm1-libs': {
        status: 'ready',
        copiedAt: '2026-09-04',
        requiredSources: [sourcePath],
        provenance: 'modkit-core/packages/codec-kit/MK2-PORT-PROVENANCE.json',
      },
    },
    copies: [
      {
        source: sourcePath,
        destination,
        sha256Mk2: sha256(text),
        sha256Mk3: sha256(text),
        rewrites: [],
      },
    ],
  }
  const prepared = await prepareCopy({
    declaration,
    divergences: { schemaVersion: 1, family: 'sc2', entries: [] },
    scope: 'm1-libs',
    workspaceRoot,
    source: {
      commit: MK2_PIN,
      listFiles: () => [sourcePath],
      async read(file) {
        assert.equal(file, sourcePath)
        return { bytes: Buffer.from(text), sha256: sha256(text), gitBlob: 'unit-fixture-blob' }
      },
    },
  })
  await writeCopies(prepared)
  return {
    workspaceRoot,
    root,
    destination,
    prepared,
    canonical: new Map([[destination, sourcePath]]),
  }
}

test('exempts only verified canonical paths, never neighboring authored legacy sources', async t => {
  const f = await copyFixture(t)
  const paths = await verifiedLegacyPaths(f.prepared, f.root, f.canonical)
  assert.deepEqual([...paths], ['packages/codec-kit/src/legacy/assets/capabilities.ts'])
  assert.equal(paths.has('packages/codec-kit/src/legacy/assets/adapter.ts'), false)
  // A folder name alone grants no exception, even at the exact copied directory.
  const fixtureRoot = join(f.workspaceRoot, 'ordinary-fixture')
  const neighbor = join(fixtureRoot, 'packages/codec-kit/src/legacy/assets/adapter.ts')
  await mkdir(dirname(neighbor), { recursive: true })
  await writeFile(neighbor, 'export interface CapabilityDescriptor {}\n')
  const result = runGate(fixtureRoot)
  assert.equal(result.status, 1)
  assert.ok(result.stderr.includes('legacy/assets/adapter.ts:1  [capability-runtime-type]'))
})

test('refuses changed canonical bytes even if their vocabulary is now clean', async t => {
  const f = await copyFixture(t)
  await writeFile(join(f.workspaceRoot, f.destination), 'export const clean = true\n')
  await assert.rejects(
    verifiedLegacyPaths(f.prepared, f.root, f.canonical),
    /tampered canonical copy/u,
  )
})

test('refuses a forged provenance file list instead of trusting its destinations', async t => {
  const f = await copyFixture(t)
  const path = join(f.workspaceRoot, f.prepared.provenancePath)
  const forged = JSON.parse(await readFile(path, 'utf8'))
  forged.files.push({
    ...forged.files[0],
    destination: 'modkit-core/packages/codec-kit/src/legacy/assets/adapter.ts',
  })
  await writeFile(path, JSON.stringify(forged))
  await assert.rejects(verifiedLegacyPaths(f.prepared, f.root, f.canonical), /Provenance differs/u)
})

for (const destination of [
  'modkit-core/packages/codec-kit/src/legacy/assets/adapter.ts',
  'modkit-core/packages/other/src/legacy.ts',
  '../outside.ts',
]) {
  test(`refuses an unapproved reconstructed destination ${destination}`, async t => {
    const f = await copyFixture(t)
    f.prepared.records[0].destination = destination
    await assert.rejects(verifiedLegacyPaths(f.prepared, f.root, f.canonical), /Unapproved|Unsafe/u)
  })
}

test('does not accept fixture-local declarations or provenance as the exception authority', async t => {
  const f = await copyFixture(t)
  const localDeclaration = join(f.root, 'migration/mk2-copy/sc2.json')
  await mkdir(dirname(localDeclaration), { recursive: true })
  await writeFile(
    localDeclaration,
    JSON.stringify({ schemaVersion: 1, copies: [{ destination: f.destination }] }),
  )
  const result = runGate(f.root)
  assert.equal(result.status, 1)
  assert.ok(result.stderr.includes('[canonical-copy-provenance]'))
  assert.ok(result.stderr.includes('[capability-runtime-type]'))
})
