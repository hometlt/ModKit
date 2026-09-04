import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  prepareCopy,
  writeCopies,
  checkCopies,
  importsOf,
  rewriteSource,
  copyCli,
  safeRelative,
} from '../lib/mk2-copy.mjs'
import { MK2_PIN, sha256 } from '../lib/legacy-oracle.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mk2-copy-test-'))
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir())
    assert.ok(path.basename(root).startsWith('mk2-copy-test-'))
    await rm(root, { recursive: true, force: true })
  })
  const files = new Map([
    ['src/main.ts', "import type { Value } from './value.js'\nexport const answer: Value = 42\n"],
    ['src/value.ts', 'export type Value = number\n'],
  ])
  const source = {
    commit: MK2_PIN,
    has: file => files.has(file),
    listFiles: () => [...files.keys()],
    async read(file) {
      assert.ok(files.has(file), `Missing pinned ${file}`)
      const bytes = Buffer.from(files.get(file))
      return { bytes, sha256: sha256(bytes), gitBlob: 'pinned-test-blob' }
    },
  }
  const declaration = {
    schemaVersion: 1,
    family: 'sc2',
    oracleCommit: MK2_PIN,
    scopes: {
      'm1-libs': {
        status: 'ready',
        copiedAt: '2026-09-04',
        requiredSources: [...files.keys()],
        provenance: 'target/MK2-PORT-PROVENANCE.json',
      },
    },
    copies: [...files].map(([file, text]) => ({
      source: file,
      destination: file.replace('src/', 'target/'),
      sha256Mk2: sha256(text),
      sha256Mk3: sha256(text),
      rewrites: [],
    })),
  }
  const divergences = { schemaVersion: 1, family: 'sc2', entries: [] }
  const options = { declaration, divergences, scope: 'm1-libs', workspaceRoot: root, source }
  return {
    root,
    files,
    source,
    declaration,
    divergences,
    options,
    prepare: () => prepareCopy(options),
  }
}

test('nonempty pinned closure copies type-only imports and reconstructs provenance', async t => {
  const f = await fixture(t)
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.closure[0].sourceTarget, 'src/value.ts')
  assert.deepEqual(await writeCopies(prepared), { scope: 'm1-libs', files: 2, imports: 1 })
  assert.equal(
    await readFile(path.join(f.root, 'target/main.ts'), 'utf8'),
    f.files.get('src/main.ts'),
  )
  assert.equal((await checkCopies(await f.prepare())).files, 2)
})

test('registered exact import relocation preserves before/after hashes', async t => {
  const f = await fixture(t)
  const row = f.declaration.copies[0]
  row.rewrites = [{ from: "'./value.js'", to: "'./renamed.js'", count: 1 }]
  f.declaration.copies[1].destination = 'target/renamed.ts'
  row.sha256Mk3 = sha256(f.files.get(row.source).replace('./value.js', './renamed.js'))
  const prepared = await f.prepare()
  assert.equal(prepared.provenance.files[0].rewrites[0].sha256Before, row.sha256Mk2)
  assert.equal(prepared.provenance.files[0].rewrites[0].sha256After, row.sha256Mk3)
  await writeCopies(prepared)
})

for (const [name, mutate, expected] of [
  [
    'empty closure',
    f => {
      f.declaration.scopes['m1-libs'].requiredSources = []
    },
    /Empty required closure/u,
  ],
  [
    'empty copy list',
    f => {
      f.declaration.copies = []
    },
    /Incomplete declared closure/u,
  ],
  [
    'incomplete copy list',
    f => {
      f.declaration.copies.pop()
    },
    /Incomplete declared closure/u,
  ],
  [
    'type-only dependency omitted from roots',
    f => {
      f.declaration.scopes['m1-libs'].requiredSources.pop()
    },
    /Incomplete type\/runtime import closure/u,
  ],
  [
    'missing pinned source',
    f => {
      f.files.delete('src/value.ts')
    },
    /Missing pinned/u,
  ],
  [
    'tampered pinned hash',
    f => {
      f.declaration.copies[0].sha256Mk2 = 'bad'
    },
    /Pinned source hash mismatch/u,
  ],
  [
    'tampered destination hash',
    f => {
      f.declaration.copies[0].sha256Mk3 = 'bad'
    },
    /Declared destination hash mismatch/u,
  ],
  [
    'duplicate source',
    f => {
      f.declaration.copies.push({ ...f.declaration.copies[0], destination: 'other.ts' })
    },
    /Duplicate canonical source/u,
  ],
  [
    'duplicate destination',
    f => {
      f.declaration.copies[1].destination = f.declaration.copies[0].destination.toUpperCase()
    },
    /Duplicate canonical destination/u,
  ],
  [
    'unsafe destination',
    f => {
      f.declaration.copies[0].destination = '../outside.ts'
    },
    /Unsafe canonical path/u,
  ],
  [
    'noncanonical import relocation',
    f => {
      f.declaration.copies[1].destination = 'target/wrong.ts'
    },
    /Unresolved copied relative import/u,
  ],
  [
    'source pin mismatch',
    f => {
      f.source.commit = '0'.repeat(40)
    },
    /Pinned source commit mismatch/u,
  ],
  [
    'family remains pending',
    f => {
      f.declaration.scopes['m1-libs'].status = 'pending-m3'
    },
    /remains pending/u,
  ],
  [
    'scope must be explicit',
    f => {
      f.options.scope = undefined
    },
    /Explicit --scope/u,
  ],
])
  test(`fails closed: ${name}`, async t => {
    const f = await fixture(t)
    mutate(f)
    await assert.rejects(f.prepare, expected)
  })

test('missing, tampered copies and missing/tampered provenance fail', async t => {
  const f = await fixture(t)
  const prepared = await f.prepare()
  await assert.rejects(() => checkCopies(prepared), /ENOENT/u)
  await writeCopies(prepared)
  await writeFile(path.join(f.root, 'target/main.ts'), 'different runtime')
  await assert.rejects(() => checkCopies(prepared), /tampered canonical copy/u)
  await assert.rejects(() => writeCopies(prepared), /Refusing to overwrite/u)
  await writeFile(path.join(f.root, 'target/main.ts'), f.files.get('src/main.ts'))
  await writeFile(path.join(f.root, prepared.provenancePath), '{}')
  await assert.rejects(() => checkCopies(prepared), /Provenance differs/u)
})

test('provenance-only validates existing copies and never creates runtime files', async t => {
  const f = await fixture(t)
  const prepared = await f.prepare()
  await assert.rejects(() => writeCopies(prepared, { provenanceOnly: true }), /ENOENT/u)
  await writeCopies(prepared)
  await writeCopies(prepared, { provenanceOnly: true })
})

test('arbitrary non-import replacements cannot masquerade as import rewrites', () => {
  assert.throws(
    () => rewriteSource('export const n = 1', [{ from: '1', to: '2' }], 'a.ts'),
    /not exclusively an import/u,
  )
  assert.throws(
    () => rewriteSource("import 'x'", [{ from: "'missing'", to: "'y'" }], 'a.ts'),
    /occurrence mismatch/u,
  )
  assert.throws(
    () => rewriteSource("import 'x'", [{ from: "'x'", to: "'y';evil()" }], 'a.ts'),
    /Invalid rewritten import/u,
  )
})

test('AST closure includes import types, reexports, references and computed imports', () => {
  const parsed = importsOf(
    '/// <reference path="types.d.ts" />\nexport * from "./a.js"; type T = import("./b.js").T; import(variable)',
    'a.ts',
  )
  assert.deepEqual(
    parsed.map(item => item.specifier),
    ['./a.js', './b.js', null, './types.d.ts'],
  )
  assert.equal(parsed[2].expression, 'variable')
})

test('bare modules and computed imports require explicit dependency bindings', async t => {
  const f = await fixture(t)
  const text = "import 'crypto'; import(packageName)"
  f.files.set('src/value.ts', text)
  Object.assign(f.declaration.copies[1], { sha256Mk2: sha256(text), sha256Mk3: sha256(text) })
  await assert.rejects(f.prepare, /Undeclared bare module/u)
  const selected = f.declaration.scopes['m1-libs']
  selected.dependencies = [
    { specifier: 'crypto', kind: 'node-builtin', reason: 'Pinned hashing API' },
  ]
  await assert.rejects(f.prepare, /Undeclared computed import/u)
  selected.dynamicImports = [
    {
      source: 'src/value.ts',
      expression: 'packageName',
      specifier: 'crypto',
      reason: 'Explicit test runtime binding',
    },
  ]
  await writeCopies(await f.prepare())
})

test('bounded divergence requires exact edits, proof hash and contract', async t => {
  const f = await fixture(t)
  const proof = 'proof.test.ts'
  await writeFile(path.join(f.root, proof), 'assert.equal(answer, 42)')
  const original = f.files.get('src/value.ts')
  const replacement = original.replace('number', '42')
  f.declaration.copies[1].sha256Mk3 = sha256(replacement)
  const divergence = {
    file: 'target/value.ts',
    reason: 'Narrow erased type',
    mk3Contract: 'literal answer type',
    proof: [{ path: proof, sha256: sha256('assert.equal(answer, 42)') }],
    edits: [
      {
        from: 'number',
        to: '42',
        count: 1,
        sha256Before: sha256(original),
        sha256After: sha256(replacement),
      },
    ],
  }
  f.divergences.entries.push(divergence)
  await writeCopies(await f.prepare())
  divergence.proof[0].sha256 = 'tampered'
  await assert.rejects(f.prepare, /proof hash mismatch/u)
  divergence.proof = []
  await assert.rejects(f.prepare, /Unbounded divergence/u)
})

test('gate rejects copy-only bypass flags', async () => {
  await assert.rejects(
    () => copyCli('check', ['--family', 'sc2', '--scope', 'm1-libs', '--dry-run']),
    /copy-only flags/u,
  )
})

test('registered import-type rewrite preserves emitted behavior and import identity', () => {
  const original = "import { Value } from './value.js';\nexport const value: Value = 42"
  const result = rewriteSource(
    original,
    [
      {
        kind: 'import-type',
        from: "import { Value } from './value.js';",
        to: "import type { Value } from './value.js';",
      },
    ],
    'source.ts',
  )
  assert.equal(result.evidence[0].kind, 'import-type')
  assert.throws(
    () =>
      rewriteSource(
        "import { Value } from './value.js';\nValue()",
        [
          {
            kind: 'import-type',
            from: "import { Value } from './value.js';",
            to: "import type { Value } from './value.js';",
          },
        ],
        'source.ts',
      ),
    /changes emitted runtime/u,
  )
})

test('planned canonical destination cannot disagree with the actual relocation', async t => {
  const f = await fixture(t)
  f.declaration.plannedCopies = [{ source: 'src/main.ts', destination: 'other/main.ts' }]
  await assert.rejects(f.prepare, /second canonical destination/u)
})

test('adapter closure is explicit, hash-checked and cannot hide unresolved imports', async t => {
  const f = await fixture(t)
  const text = "import 'legacy-contract'"
  const copied = "import './adapter.js'"
  f.files.set('src/value.ts', text)
  Object.assign(f.declaration.copies[1], {
    sha256Mk2: sha256(text),
    sha256Mk3: sha256(copied),
    rewrites: [{ from: "'legacy-contract'", to: "'./adapter.js'" }],
  })
  await mkdir(path.join(f.root, 'target'))
  await writeFile(path.join(f.root, 'target/adapter.ts'), 'export {}')
  await assert.rejects(f.prepare, /Unresolved copied relative import/u)
  const adapter = {
    destination: 'target/adapter.ts',
    sha256: sha256('export {}'),
    reason: 'New host contract boundary',
  }
  f.declaration.scopes['m1-libs'].adapters = [adapter]
  await writeCopies(await f.prepare())
  await writeFile(path.join(f.root, 'target/adapter.ts'), "import './missing.js'")
  await assert.rejects(f.prepare, /Adapter hash mismatch/u)
  adapter.sha256 = sha256("import './missing.js'")
  await assert.rejects(f.prepare, /Unresolved adapter relative import/u)
})

test('binary fixture copies preserve exact bytes without UTF-8 conversion', async t => {
  const f = await fixture(t)
  const bytes = Buffer.from([0, 255, 254, 128, 13, 10])
  f.files.set('fixtures/sample.bin', bytes)
  f.declaration.scopes['m1-libs'].requiredSources.push('fixtures/sample.bin')
  f.declaration.copies.push({
    source: 'fixtures/sample.bin',
    destination: 'target/sample.bin',
    sha256Mk2: sha256(bytes),
    sha256Mk3: sha256(bytes),
    rewrites: [],
  })
  await writeCopies(await f.prepare())
  assert.deepEqual(await readFile(path.join(f.root, 'target/sample.bin')), bytes)
})

test('Windows canonical paths reject aliases and alternate data streams', () => {
  for (const file of [
    'target/name.ts.',
    'target/name.ts ',
    'target/name.ts:stream',
    'target/NUL.ts',
    'target/CON',
    'target/../outside',
  ])
    assert.throws(() => safeRelative(file), /Unsafe canonical path/u)
})
